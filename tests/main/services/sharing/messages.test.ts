import { describe, it, expect } from 'vitest'
import { encode } from 'cborg'
import {
  CHALLENGE_BYTES,
  MAX_FRAME_BYTES,
  MAX_HANDSHAKE_FRAME_BYTES,
  MessageReader,
  PeerByeError,
  ProtocolError,
  decodeMessage,
  encodeMessage,
  expectMessage,
  writeMessage,
  type SyncMessage
} from '@main/services/sharing/messages'
import { MemoryHub, type ByteStream } from '@main/services/sharing/transport'

// The CBOR wire format (#1512): every message type round-trips through a
// frame, a frame survives a transport that re-chunks it, and anything a peer
// sends that is not a well-formed message of the known shape is a
// ProtocolError before the session reads a field.

async function pair(chunkSize?: number): Promise<[ByteStream, ByteStream]> {
  const hub = new MemoryHub(chunkSize === undefined ? {} : { chunkSize })
  const dialer = hub.createTransport('a')
  const listener = hub.createTransport('b')
  const far = new Promise<ByteStream>((resolve) => {
    void listener.listen((stream) => resolve(stream))
  })
  const near = await dialer.openStream(await dialer.dial(listener.ticket))
  return [near, await far]
}

const challenge = () => new Uint8Array(CHALLENGE_BYTES).fill(7)

const SAMPLES: SyncMessage[] = [
  { t: 'hello', caseId: 'case-1', installationId: 'inst-a', challenge: challenge(), proof: null },
  { t: 'hello', caseId: 'case-1', installationId: 'inst-b', challenge: challenge(), proof: 'sig' },
  { t: 'proof', signature: 'sig' },
  { t: 'heads', heads: [{ installationId: 'inst-a', index: 3, entryHash: 'h' }] },
  { t: 'heads', heads: [] },
  { t: 'entries-request', installationId: 'inst-a', fromIndex: 2 },
  { t: 'entries', installationId: 'inst-a', fromIndex: 2, lines: ['{"a":1}', '{"b":2}'] },
  { t: 'blobs-request', paths: ['case-1/x.mhtml'] },
  { t: 'blobs', path: 'case-1/x.mhtml', bytes: new Uint8Array([1, 2, 3]) },
  { t: 'blobs', path: 'case-1/missing.png', bytes: null },
  { t: 'rows-request', installationId: 'inst-a', sinceVersion: 0 },
  {
    t: 'rows',
    installationId: 'inst-a',
    sinceVersion: 0,
    more: true,
    rows: [
      {
        table: 'notes',
        author: 'inst-a',
        version: 4,
        deletedAt: null,
        caseId: 'case-1',
        fields: { id: 'n1', title: 'T', image_width: 12, body_doc: null },
        signature: 'sig'
      }
    ]
  },
  { t: 'bye', reason: 'not a member' },
  // The join handshake (#1810).
  {
    t: 'join',
    caseId: 'case-1',
    secret: new Uint8Array(16).fill(9),
    installationId: 'inst-b',
    publicKeyPem: '-----BEGIN PUBLIC KEY-----\nMIIB\n-----END PUBLIC KEY-----\n',
    operatorName: 'Bob Member',
    ticket: 'mem:bob',
    signature: 'sig'
  },
  { t: 'join-pending' },
  {
    t: 'welcome',
    caseId: 'case-1',
    caseName: 'Shared',
    ownerPublicKeyPem: '-----BEGIN PUBLIC KEY-----\nMIIA\n-----END PUBLIC KEY-----\n',
    roster: [
      {
        installationId: 'inst-a',
        publicKeyPem: '-----BEGIN PUBLIC KEY-----\nMIIA\n-----END PUBLIC KEY-----\n',
        memberCode: 'AO',
        operatorName: 'Alice Owner',
        nodeId: 'node-a',
        role: 'owner',
        addedAtIndex: 0,
        revokedAtIndex: null
      },
      {
        installationId: 'inst-b',
        publicKeyPem: '-----BEGIN PUBLIC KEY-----\nMIIB\n-----END PUBLIC KEY-----\n',
        memberCode: 'BM',
        operatorName: 'Bob Member',
        nodeId: 'node-b',
        role: 'member',
        addedAtIndex: 1,
        revokedAtIndex: 3
      }
    ],
    tickets: { 'inst-a': 'mem:alice', 'inst-b': 'mem:bob' }
  },
  { t: 'join-refused', reason: 'invite-expired' }
]

describe('sync messages', () => {
  it('round-trips every message type through CBOR', () => {
    for (const message of SAMPLES) {
      expect(decodeMessage(encodeMessage(message))).toEqual(message)
    }
  })

  it('round-trips every message type through framed writes on a re-chunking stream', async () => {
    const [near, far] = await pair(3)
    const reader = new MessageReader(far)
    for (const message of SAMPLES) await writeMessage(near, message)
    near.close()
    const received: SyncMessage[] = []
    for (let m = await reader.next(); m !== null; m = await reader.next()) received.push(m)
    expect(received).toEqual(SAMPLES)
    expect(await reader.next()).toBeNull()
  })

  // Scheduled review finding 7: the reader joins what it buffered once per
  // frame. Frames written in one piece, a header split from its payload, and
  // several frames in one write all come out as the messages written.
  it('reassembles frames however the writes fall: joined, split at the header, byte by byte', async () => {
    const encoded = SAMPLES.map((message) => {
      const payload = encodeMessage(message)
      const frame = new Uint8Array(4 + payload.length)
      new DataView(frame.buffer).setUint32(0, payload.length)
      frame.set(payload, 4)
      return frame
    })
    const all = new Uint8Array(encoded.reduce((n, f) => n + f.length, 0))
    let at = 0
    for (const frame of encoded) {
      all.set(frame, at)
      at += frame.length
    }
    const [near, far] = await pair()
    const reader = new MessageReader(far)
    // All frames in one write, then one frame split after two header bytes,
    // then one frame a byte at a time.
    await near.write(all)
    await near.write(encoded[0].subarray(0, 2))
    await near.write(encoded[0].subarray(2))
    for (const byte of encoded[1]) await near.write(new Uint8Array([byte]))
    near.close()
    const received: SyncMessage[] = []
    for (let m = await reader.next(); m !== null; m = await reader.next()) received.push(m)
    expect(received).toEqual([...SAMPLES, SAMPLES[0], SAMPLES[1]])
  })

  it('rejects frames that are not CBOR, not a message, or of an unknown type', () => {
    expect(() => decodeMessage(new Uint8Array([0xff, 0xff]))).toThrow(ProtocolError)
    expect(() => decodeMessage(encode('a string'))).toThrow('Malformed unknown message')
    expect(() => decodeMessage(encode({ t: 'launch' }))).toThrow('Malformed launch message')
    // An installation id names a chain file on the listener (review finding 1).
    for (const installationId of ['./../../other/manifest', 'a/b', 'a\\b', '..', '.']) {
      expect(() =>
        decodeMessage(encode({ t: 'entries-request', installationId, fromIndex: 0 }))
      ).toThrow('Malformed entries-request message')
    }
    expect(() => decodeMessage(encode({ t: 'proof', signature: 'sig', extra: 1 }))).toThrow(
      'Malformed proof message'
    )
    expect(() =>
      decodeMessage(
        encode({ t: 'hello', caseId: 'c', installationId: 'i', challenge: new Uint8Array(5) })
      )
    ).toThrow('Malformed hello message')
    expect(() =>
      decodeMessage(
        encode({
          t: 'rows',
          installationId: 'a',
          sinceVersion: 0,
          more: false,
          rows: [
            {
              table: 'notes',
              author: 'a',
              version: 0,
              caseId: 'c',
              deletedAt: null,
              fields: {},
              signature: 's'
            }
          ]
        })
      )
    ).toThrow('Malformed rows message')
    expect(() =>
      decodeMessage(
        encode({
          t: 'rows',
          installationId: 'a',
          sinceVersion: 0,
          more: false,
          rows: [
            {
              table: 'notes',
              author: 'a',
              version: 1,
              caseId: 'c',
              deletedAt: null,
              fields: { nested: { a: 1 } },
              signature: 's'
            }
          ]
        })
      )
    ).toThrow('Malformed rows message')
    // The join handshake (#1810): a secret of the wrong length, a refusal
    // outside the named codes, a roster row the shape does not admit, and a
    // ticket keyed by an id that could not name a chain file.
    const join = SAMPLES.find((m) => m.t === 'join')!
    expect(() => decodeMessage(encode({ ...join, secret: new Uint8Array(15) }))).toThrow(
      'Malformed join message'
    )
    expect(() => decodeMessage(encode({ ...join, ticket: '' }))).toThrow('Malformed join message')
    expect(() => decodeMessage(encode({ ...join, publicKeyPem: 'x'.repeat(9000) }))).toThrow(
      'Malformed join message'
    )
    expect(() => decodeMessage(encode({ t: 'join-refused', reason: 'because' }))).toThrow(
      'Malformed join-refused message'
    )
    expect(() => decodeMessage(encode({ t: 'join-pending', extra: 1 }))).toThrow(
      'Malformed join-pending message'
    )
    const welcome = SAMPLES.find((m) => m.t === 'welcome')! as Extract<
      SyncMessage,
      { t: 'welcome' }
    >
    expect(() => decodeMessage(encode({ ...welcome, roster: [] }))).toThrow(
      'Malformed welcome message'
    )
    expect(() => decodeMessage(encode({ ...welcome, caseName: '' }))).toThrow(
      'Malformed welcome message'
    )
    expect(() =>
      decodeMessage(
        encode({ ...welcome, roster: [{ ...welcome.roster[0], memberCode: 'TOOLONG' }] })
      )
    ).toThrow('Malformed welcome message')
    expect(() =>
      decodeMessage(encode({ ...welcome, roster: [{ ...welcome.roster[0], role: 'admin' }] }))
    ).toThrow('Malformed welcome message')
    expect(() => decodeMessage(encode({ ...welcome, tickets: { '../escape': 'mem:x' } }))).toThrow(
      'Malformed welcome message'
    )
  })

  it('reports a stream that ends inside a frame as a protocol error', async () => {
    const [near, far] = await pair()
    const frame = new Uint8Array(4 + 10)
    new DataView(frame.buffer).setUint32(0, 10)
    await near.write(frame.subarray(0, 7))
    near.close()
    await expect(new MessageReader(far).next()).rejects.toThrow('ended inside a frame')

    const [near2, far2] = await pair()
    await near2.write(new Uint8Array([0, 0]))
    near2.close()
    await expect(new MessageReader(far2).next()).rejects.toThrow('inside a frame header')
  })

  it('refuses a frame larger than the cap before reading it', async () => {
    const [near, far] = await pair()
    const header = new Uint8Array(4)
    new DataView(header.buffer).setUint32(0, MAX_FRAME_BYTES + 1)
    await near.write(header)
    await expect(new MessageReader(far).next()).rejects.toThrow('exceeds')
    const huge = {
      t: 'blobs',
      path: 'p',
      bytes: new Uint8Array(MAX_FRAME_BYTES + 1)
    } satisfies SyncMessage
    await expect(writeMessage(near, huge)).rejects.toThrow('exceeds')
  })

  it('holds a reader opened at the handshake cap to it until allowFrames raises it', async () => {
    const big = { t: 'blobs', path: 'p', bytes: new Uint8Array(MAX_HANDSHAKE_FRAME_BYTES) } as const
    const [near, far] = await pair()
    const header = new Uint8Array(4)
    new DataView(header.buffer).setUint32(0, MAX_HANDSHAKE_FRAME_BYTES + 1)
    await near.write(header)
    await expect(new MessageReader(far, MAX_HANDSHAKE_FRAME_BYTES).next()).rejects.toThrow(
      `exceeds ${MAX_HANDSHAKE_FRAME_BYTES}`
    )

    const [near2, far2] = await pair()
    const reader = new MessageReader(far2, MAX_HANDSHAKE_FRAME_BYTES)
    await writeMessage(near2, { t: 'heads', heads: [] })
    await writeMessage(near2, big)
    expect((await reader.next())?.t).toBe('heads')
    reader.allowFrames(MAX_FRAME_BYTES * 2)
    expect(await reader.next()).toEqual(big)

    // allowFrames never lifts a reader above the frame cap.
    const [near3, far3] = await pair()
    const capped = new MessageReader(far3, MAX_HANDSHAKE_FRAME_BYTES)
    capped.allowFrames(MAX_FRAME_BYTES * 2)
    const over = new Uint8Array(4)
    new DataView(over.buffer).setUint32(0, MAX_FRAME_BYTES + 1)
    await near3.write(over)
    await expect(capped.next()).rejects.toThrow(`exceeds ${MAX_FRAME_BYTES}`)
  })

  it('expectMessage returns the wanted type and names what it got instead', async () => {
    const [near, far] = await pair()
    const reader = new MessageReader(far)
    await writeMessage(near, { t: 'heads', heads: [] })
    await writeMessage(near, { t: 'proof', signature: 's' })
    await writeMessage(near, { t: 'bye', reason: 'revoked' })
    near.close()
    expect((await expectMessage(reader, 'heads')).heads).toEqual([])
    await expect(expectMessage(reader, 'heads')).rejects.toThrow('Expected heads, received proof')
    await expect(expectMessage(reader, 'heads')).rejects.toThrow(PeerByeError)
    await expect(expectMessage(reader, 'heads')).rejects.toThrow('Stream ended while waiting')
  })
})
