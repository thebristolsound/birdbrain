import { describe, it, expect } from 'vitest'
import { MemoryHub, PeerUnreachableError, type ByteStream } from '@main/services/sharing/transport'

// The in-process transport (#1512): a hub of named nodes, a dial that only a
// listening node answers, and streams that carry bytes both ways until either
// end closes. Nothing here reads a message; the session owns framing.

const text = (chunk: Uint8Array | null): string =>
  chunk === null ? '<closed>' : Buffer.from(chunk).toString('utf-8')

async function readAll(stream: ByteStream): Promise<string> {
  let out = ''
  for (let chunk = await stream.read(); chunk !== null; chunk = await stream.read()) {
    out += text(chunk)
  }
  return out
}

// Dials `to` from `from` and returns both ends of one stream.
async function connect(
  hub: MemoryHub,
  from: string,
  to: string
): Promise<{ near: ByteStream; far: ByteStream; farPeer: string }> {
  const dialer = hub.createTransport(from)
  const listener = hub.createTransport(to)
  const accepted = new Promise<{ far: ByteStream; farPeer: string }>((resolve) => {
    void listener.listen((far, farPeer) => resolve({ far, farPeer }))
  })
  const connection = await dialer.dial(listener.ticket)
  const near = await dialer.openStream(connection)
  const { far, farPeer } = await accepted
  return { near, far, farPeer }
}

describe('MemoryTransport', () => {
  it('carries bytes both ways and names the dialing node to the listener', async () => {
    const { near, far, farPeer } = await connect(new MemoryHub(), 'alice', 'bob')
    expect(farPeer).toBe('alice')
    await near.write(Buffer.from('hello'))
    await far.write(Buffer.from('world'))
    expect(text(await far.read())).toBe('hello')
    expect(text(await near.read())).toBe('world')
  })

  it('delivers a write in pieces when the hub re-chunks, and copies the bytes', async () => {
    const { near, far } = await connect(new MemoryHub({ chunkSize: 2 }), 'alice', 'bob')
    const payload = Buffer.from('abcde')
    await near.write(payload)
    payload.fill(0)
    expect(text(await far.read())).toBe('ab')
    expect(text(await far.read())).toBe('cd')
    expect(text(await far.read())).toBe('e')
  })

  it('ends the reader with null once the other end closes', async () => {
    const { near, far } = await connect(new MemoryHub(), 'alice', 'bob')
    await near.write(Buffer.from('last'))
    near.close()
    expect(await readAll(far)).toBe('last')
    expect(await far.read()).toBeNull()
    await expect(far.write(Buffer.from('x'))).rejects.toThrow('Stream is closed')
  })

  it('wakes a reader that was waiting when the stream closes', async () => {
    const { near, far } = await connect(new MemoryHub(), 'alice', 'bob')
    const pending = far.read()
    near.close()
    expect(await pending).toBeNull()
  })

  it('refuses a ticket no listening node answers', async () => {
    const hub = new MemoryHub()
    const dialer = hub.createTransport('alice')
    const silent = hub.createTransport('bob')
    await expect(dialer.dial('mem:nobody')).rejects.toBeInstanceOf(PeerUnreachableError)
    await expect(dialer.dial(silent.ticket)).rejects.toBeInstanceOf(PeerUnreachableError)
    await expect(dialer.dial('iroh:bob')).rejects.toBeInstanceOf(PeerUnreachableError)
  })

  it('refuses a stream on a connection another transport dialed', async () => {
    const hub = new MemoryHub()
    const alice = hub.createTransport('alice')
    const carol = hub.createTransport('carol')
    const bob = hub.createTransport('bob')
    await bob.listen(() => {})
    const connection = await alice.dial(bob.ticket)
    await expect(carol.openStream(connection)).rejects.toThrow('not dialed from this transport')
  })

  it('listens once per node and refuses to listen or dial after close', async () => {
    const hub = new MemoryHub()
    const bob = hub.createTransport('bob')
    await bob.listen(() => {})
    await expect(bob.listen(() => {})).rejects.toThrow('already listening')
    await bob.close()
    await expect(bob.listen(() => {})).rejects.toThrow('is closed')
    await expect(bob.dial('mem:bob')).rejects.toThrow('is closed')
    expect(() => hub.createTransport('bob')).not.toThrow()
    expect(() => hub.createTransport('bob')).toThrow('already exists')
  })

  it('closes every accepted stream when the listener closes', async () => {
    const hub = new MemoryHub()
    const { near, far } = await connect(hub, 'alice', 'bob')
    expect(hub.listeningNode('mem:bob')?.nodeId).toBe('bob')
    await hub.listeningNode('mem:bob')!.close()
    expect(await near.read()).toBeNull()
    expect(await far.read()).toBeNull()
    expect(hub.listeningNode('mem:bob')).toBeUndefined()
  })

  it('closes a stream opened after the listener went away', async () => {
    const hub = new MemoryHub()
    const alice = hub.createTransport('alice')
    const bob = hub.createTransport('bob')
    await bob.listen(() => {})
    const connection = await alice.dial(bob.ticket)
    await bob.close()
    const near = await alice.openStream(connection)
    expect(await near.read()).toBeNull()
    connection.close()
    await expect(alice.openStream(connection)).rejects.toThrow('is closed')
  })

  it('closes dialed connections and their streams when the dialer closes', async () => {
    const hub = new MemoryHub()
    const { near, far } = await connect(hub, 'alice', 'bob')
    const alice = hub.listeningNode('mem:alice')
    expect(alice).toBeUndefined()
    const dialer = hub.createTransport('alice2')
    const connection = await dialer.dial('mem:bob')
    const second = await dialer.openStream(connection)
    await dialer.close()
    expect(await second.read()).toBeNull()
    near.close()
    expect(await far.read()).toBeNull()
  })

  it('rejects a chunk size below one', () => {
    expect(() => new MemoryHub({ chunkSize: 0 })).toThrow('at least 1')
  })
})
