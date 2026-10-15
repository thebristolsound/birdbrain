import { describe, it, expect } from 'vitest'
import { encode } from 'cborg'
import {
  CHALLENGE_BYTES,
  MAX_FRAME_BYTES,
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
  { t: 'rows-request', authors: [{ installationId: 'inst-a', sinceVersion: 0 }] },
  {
    t: 'rows',
    rows: [
      {
        table: 'notes',
        author: 'inst-a',
        version: 4,
        deletedAt: null,
        fields: { id: 'n1', title: 'T', image_width: 12, body_doc: null },
        signature: 'sig'
      }
    ]
  },
  { t: 'bye', reason: 'not a member' }
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

  it('rejects frames that are not CBOR, not a message, or of an unknown type', () => {
    expect(() => decodeMessage(new Uint8Array([0xff, 0xff]))).toThrow(ProtocolError)
    expect(() => decodeMessage(encode('a string'))).toThrow('Malformed unknown message')
    expect(() => decodeMessage(encode({ t: 'launch' }))).toThrow('Malformed launch message')
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
          rows: [
            {
              table: 'notes',
              author: 'a',
              version: 0,
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
          rows: [
            {
              table: 'notes',
              author: 'a',
              version: 1,
              deletedAt: null,
              fields: { nested: { a: 1 } },
              signature: 's'
            }
          ]
        })
      )
    ).toThrow('Malformed rows message')
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
