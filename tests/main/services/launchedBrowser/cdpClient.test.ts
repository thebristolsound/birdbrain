import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { Readable, Writable } from 'stream'
import {
  createCdpClient,
  DEFAULT_COMMAND_TIMEOUT_MS,
  type CdpClient
} from '@main/services/launchedBrowser/cdpClient'
import {
  LAUNCHED_BROWSER_COMMANDS,
  type CdpCommandMap,
  type CdpMethod
} from '@main/services/launchedBrowser/commands'
import { NEVER_SENT } from '../../../helpers/launchedBrowserSuite'

const NUL = Buffer.from([0])

function frame(message: object): Buffer {
  return Buffer.concat([Buffer.from(JSON.stringify(message), 'utf8'), NUL])
}

// Lets the readable side deliver what a test pushed.
function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

interface SentMessage {
  id: number
  method: string
  params: Record<string, unknown>
  sessionId?: string
}

// The two descriptors the browser holds: the client writes commands to `toBrowser` (fd 3)
// and reads replies and events from `fromBrowser` (fd 4).
function fakePipe() {
  const written: Buffer[] = []
  const toBrowser = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      written.push(chunk)
      callback()
    }
  })
  const fromBrowser = new Readable({ read() {} })
  const bytes = (): Buffer => Buffer.concat(written)
  const sent = (): SentMessage[] =>
    bytes()
      .toString('utf8')
      .split('\0')
      .slice(0, -1)
      .map((text) => JSON.parse(text) as SentMessage)
  const deliver = async (...chunks: Buffer[]): Promise<void> => {
    for (const chunk of chunks) fromBrowser.push(chunk)
    await flush()
  }
  return { toBrowser, fromBrowser, bytes, sent, deliver }
}

function connect(timeoutMs?: number): { pipe: ReturnType<typeof fakePipe>; client: CdpClient } {
  const pipe = fakePipe()
  const { toBrowser, fromBrowser } = pipe
  return { pipe, client: createCdpClient({ toBrowser, fromBrowser, timeoutMs }) }
}

// Marks a rejection the test asserts later, so it is not reported as unhandled before then.
function rejecting<T>(promise: Promise<T>): Promise<T> {
  promise.catch(() => {})
  return promise
}

// Reads whether a promise has settled without waiting for it to.
function watch<T>(promise: Promise<T>): () => 'pending' | 'resolved' | 'rejected' {
  let state: 'pending' | 'resolved' | 'rejected' = 'pending'
  promise.then(
    () => (state = 'resolved'),
    () => (state = 'rejected')
  )
  return () => state
}

const VERSION = {
  protocolVersion: '1.3',
  product: 'Chrome/149.0.7827.55',
  revision: '@0',
  userAgent: 'Mozilla/5.0',
  jsVersion: '14.9'
}

describe('LAUNCHED_BROWSER_COMMANDS', () => {
  it('lists exactly the commands the launcher, attaching and Egress checks send', () => {
    expect([...LAUNCHED_BROWSER_COMMANDS].sort()).toEqual([
      'Browser.close',
      'Browser.getVersion',
      'Browser.setPermission',
      'Network.enable',
      'Page.createIsolatedWorld',
      'Runtime.evaluate',
      'Runtime.runIfWaitingForDebugger',
      'Target.getTargets',
      'Target.setAutoAttach',
      'Target.setDiscoverTargets'
    ])
  })

  it.each(NEVER_SENT)('does not list %s', (method) => {
    expect(LAUNCHED_BROWSER_COMMANDS).not.toContain(method)
  })

  it('types exactly the commands it lists', () => {
    expectTypeOf<(typeof LAUNCHED_BROWSER_COMMANDS)[number]>().toEqualTypeOf<keyof CdpCommandMap>()
  })
})

describe('createCdpClient', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('writes each command as JSON ended by one NUL byte, with ids counting up from 1', () => {
    const { pipe, client } = connect()
    void client.send('Browser.getVersion', {})
    void client.send('Target.setDiscoverTargets', { discover: true })
    expect(pipe.bytes().toString('utf8')).toBe(
      '{"id":1,"method":"Browser.getVersion","params":{}}\0' +
        '{"id":2,"method":"Target.setDiscoverTargets","params":{"discover":true}}\0'
    )
  })

  it('sends a session command with its sessionId on the same pipe', () => {
    const { pipe, client } = connect()
    void client.session('S1').send('Network.enable', {})
    expect(pipe.sent()).toEqual([{ id: 1, method: 'Network.enable', params: {}, sessionId: 'S1' }])
  })

  it('resolves each command with the reply whose id matches, in any order', async () => {
    const { pipe, client } = connect()
    const version = client.send('Browser.getVersion', {})
    const world = client.session('S1').send('Page.createIsolatedWorld', { frameId: 'T1' })
    await pipe.deliver(
      frame({ id: 2, sessionId: 'S1', result: { executionContextId: 7 } }),
      frame({ id: 1, result: VERSION })
    )
    await expect(version).resolves.toEqual(VERSION)
    await expect(world).resolves.toEqual({ executionContextId: 7 })
  })

  it('reassembles a reply split across chunks and reads several from one chunk', async () => {
    const { pipe, client } = connect()
    const first = client.send('Browser.getVersion', {})
    const reply = frame({ id: 1, result: VERSION })
    const firstState = watch(first)
    await pipe.deliver(reply.subarray(0, 10))
    expect(firstState()).toBe('pending')

    const second = client.send('Target.setDiscoverTargets', { discover: true })
    const third = client.send('Browser.setPermission', {
      permission: { name: 'geolocation' },
      setting: 'denied'
    })
    await pipe.deliver(
      Buffer.concat([
        reply.subarray(10),
        frame({ id: 2, result: {} }),
        frame({ id: 3, result: {} })
      ])
    )
    await expect(first).resolves.toEqual(VERSION)
    await expect(second).resolves.toEqual({})
    await expect(third).resolves.toEqual({})
  })

  it('decodes a multi-byte character split across two chunks', async () => {
    const { pipe, client } = connect()
    const version = client.send('Browser.getVersion', {})
    const product = 'Chrome/149 – Löwe 🦁'
    const reply = frame({ id: 1, result: { ...VERSION, product } })
    // Cut inside the four-byte lion: decoding each chunk on its own would corrupt it.
    const cut = reply.indexOf(Buffer.from('🦁', 'utf8')) + 2
    await pipe.deliver(reply.subarray(0, cut), reply.subarray(cut))
    await expect(version).resolves.toMatchObject({ product })
  })

  it.each(NEVER_SENT)('throws on %s, writing and logging nothing', (method) => {
    const { pipe, client } = connect()
    expect(() => client.send(method as CdpMethod, {} as never)).toThrow(
      expect.objectContaining({ code: 'CDP_NOT_LISTED' })
    )
    expect(() => client.session('S1').send(method as CdpMethod, {} as never)).toThrow(
      `${method} is not on the launched browser's command list`
    )
    expect(pipe.bytes()).toHaveLength(0)
    expect(client.commandLog()).toEqual([])
  })

  it('refuses Network.enable with durable messages, writing and logging nothing', () => {
    const { pipe, client } = connect()
    const params = { enableDurableMessages: true } as never
    expect(() => client.session('S1').send('Network.enable', params)).toThrow(
      expect.objectContaining({ code: 'CDP_PARAM_REFUSED' })
    )
    expect(pipe.bytes()).toHaveLength(0)
    expect(client.commandLog()).toEqual([])
  })

  it('logs every method it sends, in order, on the browser and on sessions', () => {
    const { client } = connect()
    void client.send('Target.setDiscoverTargets', { discover: true })
    void client.send('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true
    })
    void client.session('S1').send('Network.enable', {})
    void client.session('S1').send('Runtime.runIfWaitingForDebugger', {})
    const log = client.commandLog()
    expect(log).toEqual([
      'Target.setDiscoverTargets',
      'Target.setAutoAttach',
      'Network.enable',
      'Runtime.runIfWaitingForDebugger'
    ])
    void client.send('Browser.close', {})
    expect(log).toHaveLength(4)
  })

  it("rejects a command the browser answers with an error, naming the method and Chrome's message", async () => {
    const { pipe, client } = connect()
    const permission = rejecting(
      client.send('Browser.setPermission', {
        permission: { name: 'geolocation' },
        setting: 'denied'
      })
    )
    await pipe.deliver(frame({ id: 1, error: { code: -32000, message: 'Permission not found' } }))
    await expect(permission).rejects.toMatchObject({
      code: 'CDP_COMMAND_FAILED',
      message: 'Browser.setPermission failed: Permission not found'
    })
  })

  it('rejects a command not answered within the default timeout, and only then', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { client } = connect()
    const version = client.send('Browser.getVersion', {})
    const state = watch(version)
    vi.advanceTimersByTime(DEFAULT_COMMAND_TIMEOUT_MS - 1)
    await flush()
    expect(state()).toBe('pending')
    vi.advanceTimersByTime(1)
    await expect(version).rejects.toMatchObject({
      code: 'CDP_TIMEOUT',
      message: `Browser.getVersion was not answered within ${DEFAULT_COMMAND_TIMEOUT_MS} ms`
    })
  })

  it('takes a timeout per client and per command, and ignores a reply that comes too late', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { pipe, client } = connect(500)
    const close = client.send('Browser.close', {})
    const closeState = watch(close)
    const enable = client.session('S1').send('Network.enable', {}, { timeoutMs: 50 })
    vi.advanceTimersByTime(50)
    await expect(enable).rejects.toMatchObject({ code: 'CDP_TIMEOUT' })
    expect(closeState()).toBe('pending')
    vi.advanceTimersByTime(450)
    await expect(close).rejects.toMatchObject({ code: 'CDP_TIMEOUT' })

    await pipe.deliver(frame({ id: 1, result: {} }), frame({ id: 2, sessionId: 'S1', result: {} }))
    const version = client.send('Browser.getVersion', {})
    await pipe.deliver(frame({ id: 3, result: VERSION }))
    await expect(version).resolves.toEqual(VERSION)
  })

  it('delivers browser events to browser handlers and session events to that session only', async () => {
    const { pipe, client } = connect()
    const seen: string[] = []
    const target = { targetId: 'T2', type: 'page', title: '', url: 'about:blank', attached: false }
    client.on('Target.targetCreated', ({ targetInfo }) =>
      seen.push(`browser ${targetInfo.targetId}`)
    )
    client
      .session('S1')
      .on('Network.responseReceived', ({ requestId }) => seen.push(`S1 ${requestId}`))
    const stopS2 = client
      .session('S2')
      .on('Network.responseReceived', ({ requestId }) => seen.push(`S2 ${requestId}`))
    const response = { url: 'https://example.test/', status: 200 }
    const received = (sessionId: string, requestId: string) =>
      frame({
        sessionId,
        method: 'Network.responseReceived',
        params: { requestId, loaderId: 'L', timestamp: 1, type: 'Document', response }
      })

    await pipe.deliver(
      frame({ method: 'Target.targetCreated', params: { targetInfo: target } }),
      received('S1', 'r1'),
      received('S2', 'r2'),
      frame({ method: 'Target.targetDestroyed', params: { targetId: 'T2' } })
    )
    stopS2()
    await pipe.deliver(received('S2', 'r3'), received('S9', 'r4'))
    expect(seen).toEqual(['browser T2', 'S1 r1', 'S2 r2'])
  })

  it('fails the commands of a detached session and stops its events, leaving other sessions alone', async () => {
    const { pipe, client } = connect()
    const seen: string[] = []
    const child = client.session('S3')
    child.on('Network.responseReceived', ({ requestId }) => seen.push(requestId))
    client
      .session('S1')
      .on('Target.detachedFromTarget', ({ sessionId }) => seen.push(`S1 saw ${sessionId} detach`))
    const childEnable = rejecting(child.send('Network.enable', {}))
    const parentEnable = client.session('S1').send('Network.enable', {})

    // An iframe's session detaches on its parent's session, as nested auto-attach reports it.
    await pipe.deliver(
      frame({ sessionId: 'S1', method: 'Target.detachedFromTarget', params: { sessionId: 'S3' } })
    )
    await expect(childEnable).rejects.toMatchObject({
      code: 'CDP_SESSION_DETACHED',
      message: 'Network.enable was not answered: its target detached'
    })
    await pipe.deliver(
      frame({
        sessionId: 'S3',
        method: 'Network.responseReceived',
        params: { requestId: 'late', loaderId: 'L', timestamp: 1, type: 'Document', response: {} }
      }),
      frame({ id: 2, sessionId: 'S1', result: {} })
    )
    await expect(parentEnable).resolves.toEqual({})
    expect(seen).toEqual(['S1 saw S3 detach'])
  })

  it('rejects every pending command when the browser closes its end of the pipe', async () => {
    const { pipe, client } = connect()
    const version = rejecting(client.send('Browser.getVersion', {}))
    const enable = rejecting(client.session('S1').send('Network.enable', {}))
    // An unended frame at the moment of closing is dropped.
    await pipe.deliver(Buffer.from('{"id":1,"res'))
    pipe.fromBrowser.push(null)
    await flush()

    await expect(version).rejects.toMatchObject({ code: 'CDP_DISCONNECTED' })
    await expect(enable).rejects.toMatchObject({
      code: 'CDP_DISCONNECTED',
      message: 'Network.enable was not answered: the browser closed its debugging connection'
    })
    await expect(client.disconnected).resolves.toMatchObject({
      code: 'CDP_DISCONNECTED',
      message: 'The browser closed its debugging connection'
    })
    expect(pipe.toBrowser.destroyed).toBe(true)
  })

  it('refuses to send once disconnected, writing and logging nothing', async () => {
    const { pipe, client } = connect()
    pipe.fromBrowser.push(null)
    await flush()
    const written = pipe.bytes().length
    await expect(client.send('Browser.close', {})).rejects.toMatchObject({
      code: 'CDP_DISCONNECTED',
      message: 'Browser.close was not sent: the browser closed its debugging connection'
    })
    expect(pipe.bytes()).toHaveLength(written)
    expect(client.commandLog()).toEqual([])
  })

  it('disconnects when writing to the browser fails', async () => {
    const { pipe, client } = connect()
    const version = client.send('Browser.getVersion', {})
    pipe.toBrowser.destroy(new Error('write EPIPE'))
    await expect(version).rejects.toMatchObject({ code: 'CDP_DISCONNECTED' })
    await expect(client.disconnected).resolves.toMatchObject({
      message: 'The debugging connection failed: write EPIPE'
    })
    expect(pipe.fromBrowser.destroyed).toBe(true)
  })

  it.each([
    ['not JSON', Buffer.from('{"id":1,')],
    ['not UTF-8', Buffer.from([0x7b, 0xff, 0x7d])],
    ['not an object', Buffer.from('null')]
  ])('fails closed on a frame that is %s', async (_kind, body) => {
    const { pipe, client } = connect()
    const version = rejecting(client.send('Browser.getVersion', {}))
    let delivered = 0
    client.on('Target.targetCreated', () => delivered++)
    const after = frame({ method: 'Target.targetCreated', params: { targetInfo: {} } })
    await pipe.deliver(Buffer.concat([body, NUL, after]))

    await expect(version).rejects.toMatchObject({ code: 'CDP_DISCONNECTED' })
    await expect(client.disconnected).resolves.toMatchObject({
      message: expect.stringMatching(
        /^The browser sent a debugging message Birdbrain could not read/
      )
    })
    expect(delivered).toBe(0)
    expect(pipe.toBrowser.destroyed).toBe(true)
    expect(pipe.fromBrowser.destroyed).toBe(true)
  })

  it('closes the pipe from its own side and fails what was pending', async () => {
    const { pipe, client } = connect()
    const version = client.send('Browser.getVersion', {})
    client.close()
    client.close()
    await expect(version).rejects.toMatchObject({
      code: 'CDP_DISCONNECTED',
      message: 'Browser.getVersion was not answered: Birdbrain closed the debugging connection'
    })
    await expect(client.disconnected).resolves.toMatchObject({
      message: 'Birdbrain closed the debugging connection'
    })
    expect(pipe.toBrowser.destroyed).toBe(true)
    expect(pipe.fromBrowser.destroyed).toBe(true)
  })
})
