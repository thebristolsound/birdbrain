import { EventEmitter } from 'events'
import { Readable, Writable } from 'stream'
import type { CdpResult, TargetInfo } from '@main/services/launchedBrowser/commands'

// A browser process the launcher can spawn without starting one: descriptor 3 parses the
// commands written to it, descriptor 4 carries scripted replies and events, and stderr is a
// stream the test writes to. Replies go out on a later turn of the event loop through
// setImmediate, so a test that fakes only setTimeout still receives them.

export interface SentCommand {
  id: number
  method: string
  params: Record<string, unknown>
  sessionId?: string
}

export type FakeReply = { result: object } | { error: { message: string } } | 'silent'

export const FAKE_VERSION: CdpResult<'Browser.getVersion'> = {
  protocolVersion: '1.3',
  product: 'Chrome/149.0.7827.55',
  revision: '@0',
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/149.0.0.0 Safari/537.36',
  jsVersion: '14.9'
}

export function targetInfo(targetId: string, type = 'page', url = 'about:blank'): TargetInfo {
  return { targetId, type, title: '', url, attached: true }
}

export interface FakeBrowserOptions {
  // Targets open when the browser starts. Browser-level auto-attach reports each, not paused,
  // before it answers. Defaults to the start tab.
  initialTargets?: TargetInfo[]
  // Overrides the reply to a command; undefined falls through to the default.
  respond?: (command: SentCommand) => FakeReply | undefined
  // Whether Browser.close and a kill end the process. Both default to true.
  exitOnClose?: boolean
  exitOnKill?: boolean
  // Fails the spawn as a missing executable does: no pid, then an 'error' event.
  spawnError?: Error
}

export interface SpawnCall {
  command: string
  args: readonly string[]
  options: object
}

const NUL = 0

function frame(message: object): Buffer {
  return Buffer.concat([Buffer.from(JSON.stringify(message), 'utf8'), Buffer.from([NUL])])
}

export class FakeBrowserProcess extends EventEmitter {
  pid: number | undefined = 4242
  readonly stderr = new Readable({ read() {} })
  readonly toBrowser: Writable
  readonly fromBrowser = new Readable({ read() {} })
  readonly stdio: [null, null, Readable, Writable, Readable]
  readonly signals: Array<NodeJS.Signals | undefined> = []
  readonly commands: SentCommand[] = []
  exited = false
  private nextSession = 1
  private pending = Buffer.alloc(0)

  constructor(private readonly options: FakeBrowserOptions = {}) {
    super()
    this.toBrowser = new Writable({
      write: (chunk: Buffer, _encoding, callback) => {
        this.receive(chunk)
        callback()
      }
    })
    this.stdio = [null, null, this.stderr, this.toBrowser, this.fromBrowser]
  }

  kill(signal?: NodeJS.Signals): boolean {
    this.signals.push(signal)
    if (this.exited || this.pid === undefined) return false
    if (this.options.exitOnKill ?? true) this.exit(null, signal ?? 'SIGTERM')
    return true
  }

  // The process ends: its end of the pipe closes, then Node reports the exit.
  exit(code: number | null, signal: NodeJS.Signals | null = null): void {
    if (this.exited) return
    this.exited = true
    setImmediate(() => {
      this.fromBrowser.push(null)
      setImmediate(() => this.emit('exit', code, signal))
    })
  }

  failSpawn(error: Error): void {
    this.pid = undefined
    setImmediate(() => this.emit('error', error))
  }

  // Reports a target to the browser connection, or to `parentSessionId` for a target that a
  // session's own auto-attach found. Returns the new target's sessionId.
  attach(info: TargetInfo, { waiting = true, parentSessionId = '' } = {}): string {
    const sessionId = `session-${this.nextSession++}`
    this.event(
      'Target.attachedToTarget',
      { sessionId, targetInfo: info, waitingForDebugger: waiting },
      parentSessionId
    )
    return sessionId
  }

  event(method: string, params: object, sessionId = ''): void {
    const message = sessionId ? { method, params, sessionId } : { method, params }
    setImmediate(() => this.fromBrowser.push(frame(message)))
  }

  writeStderr(text: string): void {
    this.stderr.push(Buffer.from(text, 'utf8'))
  }

  // Each command as `method` on the browser connection or `method@sessionId` on a session.
  methods(): string[] {
    return this.commands.map(({ method, sessionId }) =>
      sessionId ? `${method}@${sessionId}` : method
    )
  }

  private receive(chunk: Buffer): void {
    this.pending = Buffer.concat([this.pending, chunk])
    let end = this.pending.indexOf(NUL)
    while (end !== -1) {
      const command = JSON.parse(this.pending.subarray(0, end).toString('utf8')) as SentCommand
      this.pending = this.pending.subarray(end + 1)
      this.commands.push(command)
      this.answer(command)
      end = this.pending.indexOf(NUL)
    }
  }

  private answer(command: SentCommand): void {
    const { id, method, sessionId } = command
    const reply = this.options.respond?.(command) ?? this.defaultReply(command)
    if (reply === 'silent') return
    const message = sessionId ? { id, sessionId, ...reply } : { id, ...reply }
    setImmediate(() => {
      this.fromBrowser.push(frame(message))
      if (method === 'Browser.close' && (this.options.exitOnClose ?? true)) this.exit(0)
    })
  }

  private defaultReply({ method, sessionId }: SentCommand): FakeReply {
    if (method === 'Browser.getVersion') return { result: FAKE_VERSION }
    if (method === 'Target.setAutoAttach' && !sessionId) {
      for (const info of this.options.initialTargets ?? [targetInfo('first-tab')]) {
        this.attach(info, { waiting: false })
      }
    }
    return { result: {} }
  }
}

export function fakeBrowser(options: FakeBrowserOptions = {}) {
  const browser = new FakeBrowserProcess(options)
  const calls: SpawnCall[] = []
  const spawn = (command: string, args: readonly string[], spawnOptions: object) => {
    calls.push({ command, args, options: spawnOptions })
    if (options.spawnError) browser.failSpawn(options.spawnError)
    return browser
  }
  return { browser, spawn, calls }
}

// Lets replies, events and exits scheduled on the event loop arrive.
export async function settle(turns = 10): Promise<void> {
  for (let i = 0; i < turns; i++) await new Promise((resolve) => setImmediate(resolve))
}
