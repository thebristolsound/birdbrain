import type { Readable, Writable } from 'stream'
import {
  LAUNCHED_BROWSER_COMMANDS,
  REFUSED_PARAMS,
  type CdpEventMap,
  type CdpEventName,
  type CdpMethod,
  type CdpParams,
  type CdpResult
} from '@main/services/launchedBrowser/commands'

// The launched browser's debugging connection over `--remote-debugging-pipe` (rulings 37 and
// 38b). The browser reads commands on descriptor 3 and writes replies and events on
// descriptor 4, each a JSON message ended by a NUL byte. Every target's flattened session
// shares the pipe, and its messages carry its `sessionId`. Any end of the pipe, or a message
// the client cannot read, fails every command still waiting and closes both streams.

// The stage-2 probe's client waited this long for a reply.
export const DEFAULT_COMMAND_TIMEOUT_MS = 20_000

export interface CdpSendOptions {
  timeoutMs?: number
}

export type CdpSend = <M extends CdpMethod>(
  method: M,
  params: CdpParams<M>,
  options?: CdpSendOptions
) => Promise<CdpResult<M>>

export type CdpSubscribe = <E extends CdpEventName>(
  event: E,
  handler: (params: CdpEventMap[E]) => void
) => () => void

export interface CdpSession {
  readonly sessionId: string
  send: CdpSend
  // This session's events only; returns the unsubscribe.
  on: CdpSubscribe
}

export interface CdpClient {
  // Commands to the browser itself, and events that carry no sessionId.
  send: CdpSend
  on: CdpSubscribe
  session: (sessionId: string) => CdpSession
  // Every method written to the pipe, in order.
  commandLog: () => CdpMethod[]
  // Resolves once, with the reason, when the connection ends for any cause.
  disconnected: Promise<Error>
  // Closes the pipe from Birdbrain's side.
  close: () => void
}

export interface CdpClientOptions {
  toBrowser: Writable
  fromBrowser: Readable
  timeoutMs?: number
}

interface Pending {
  method: CdpMethod
  sessionId: string | undefined
  resolve: (result: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

interface Incoming {
  id?: unknown
  method?: unknown
  params?: unknown
  sessionId?: unknown
  result?: unknown
  error?: { message?: string }
}

type Handler = (params: unknown) => void

const LISTED: ReadonlySet<string> = new Set(LAUNCHED_BROWSER_COMMANDS)
// JSON escapes U+0000 and no other character's UTF-8 bytes include 0x00, so a 0x00 byte can only
// end a frame, and frames can be split before they are decoded.
const NUL = 0
const NUL_BYTE = Buffer.from([NUL])
// Browser-level events are filed under this key, beside each session's.
const BROWSER = ''

function codedError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code })
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

export function createCdpClient(options: CdpClientOptions): CdpClient {
  const {
    toBrowser,
    fromBrowser,
    timeoutMs: defaultTimeoutMs = DEFAULT_COMMAND_TIMEOUT_MS
  } = options
  const pending = new Map<number, Pending>()
  const handlers = new Map<string, Map<string, Set<Handler>>>()
  const log: CdpMethod[] = []
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let nextId = 1
  // The bytes of a frame whose NUL has not arrived yet.
  let partial: Buffer[] = []
  let endedBecause: string | null = null
  let settleDisconnected: (reason: Error) => void = () => {}
  const disconnected = new Promise<Error>((resolve) => {
    settleDisconnected = resolve
  })

  function disconnect(reason: string): void {
    if (endedBecause !== null) return
    endedBecause = reason
    for (const { method, reject, timer } of pending.values()) {
      clearTimeout(timer)
      reject(codedError(`${method} was not answered: ${reason}`, 'CDP_DISCONNECTED'))
    }
    pending.clear()
    handlers.clear()
    partial = []
    toBrowser.destroy()
    fromBrowser.destroy()
    settleDisconnected(codedError(capitalized(reason), 'CDP_DISCONNECTED'))
  }

  function dropSession(sessionId: unknown): void {
    if (typeof sessionId !== 'string') return
    handlers.delete(sessionId)
    for (const [id, { method, sessionId: owner, reject, timer }] of pending) {
      if (owner !== sessionId) continue
      pending.delete(id)
      clearTimeout(timer)
      reject(codedError(`${method} was not answered: its target detached`, 'CDP_SESSION_DETACHED'))
    }
  }

  function deliver(key: string, event: string, params: unknown): void {
    const subscribed = handlers.get(key)?.get(event)
    if (!subscribed) return
    for (const handler of [...subscribed]) handler(params)
  }

  function onFrame(bytes: Buffer): void {
    let message: unknown
    try {
      message = JSON.parse(decoder.decode(bytes))
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err)
      disconnect(`the browser sent a debugging message Birdbrain could not read: ${why}`)
      return
    }
    if (typeof message !== 'object' || message === null) {
      disconnect('the browser sent a debugging message Birdbrain could not read: not an object')
      return
    }
    const { id, method, params, sessionId, result, error } = message as Incoming
    if (typeof id === 'number') {
      // A reply whose command already timed out finds nothing here.
      const waiting = pending.get(id)
      if (!waiting) return
      pending.delete(id)
      clearTimeout(waiting.timer)
      if (error) {
        waiting.reject(
          codedError(`${waiting.method} failed: ${error.message}`, 'CDP_COMMAND_FAILED')
        )
      } else {
        waiting.resolve(result)
      }
      return
    }
    if (typeof method !== 'string') return
    deliver(typeof sessionId === 'string' ? sessionId : BROWSER, method, params)
    if (method === 'Target.detachedFromTarget') {
      dropSession((params as { sessionId?: unknown } | undefined)?.sessionId)
    }
  }

  function onData(chunk: Buffer): void {
    let start = 0
    let end = chunk.indexOf(NUL)
    while (end !== -1) {
      partial.push(chunk.subarray(start, end))
      const bytes = partial.length === 1 ? partial[0] : Buffer.concat(partial)
      partial = []
      onFrame(bytes)
      if (endedBecause !== null) return
      start = end + 1
      end = chunk.indexOf(NUL, start)
    }
    if (start < chunk.length) partial.push(chunk.subarray(start))
  }

  function send<M extends CdpMethod>(
    sessionId: string | undefined,
    method: M,
    params: CdpParams<M>,
    { timeoutMs = defaultTimeoutMs }: CdpSendOptions = {}
  ): Promise<CdpResult<M>> {
    if (!LISTED.has(method)) {
      throw codedError(`${method} is not on the launched browser's command list`, 'CDP_NOT_LISTED')
    }
    const refused = REFUSED_PARAMS[method]?.find((key) => key in params)
    if (refused) throw codedError(`${method} may not pass ${refused}`, 'CDP_PARAM_REFUSED')
    if (endedBecause !== null) {
      return Promise.reject(
        codedError(`${method} was not sent: ${endedBecause}`, 'CDP_DISCONNECTED')
      )
    }
    const id = nextId++
    const message =
      sessionId === undefined ? { id, method, params } : { id, method, params, sessionId }
    return new Promise<CdpResult<M>>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(codedError(`${method} was not answered within ${timeoutMs} ms`, 'CDP_TIMEOUT'))
      }, timeoutMs)
      pending.set(id, {
        method,
        sessionId,
        resolve: (value) => resolve(value as CdpResult<M>),
        reject,
        timer
      })
      log.push(method)
      toBrowser.write(Buffer.concat([Buffer.from(JSON.stringify(message), 'utf8'), NUL_BYTE]))
    })
  }

  function subscribe(key: string, event: string, handler: Handler): () => void {
    const byEvent = handlers.get(key) ?? new Map<string, Set<Handler>>()
    handlers.set(key, byEvent)
    const subscribed = byEvent.get(event) ?? new Set<Handler>()
    byEvent.set(event, subscribed)
    subscribed.add(handler)
    return () => {
      subscribed.delete(handler)
    }
  }

  const closedByBrowser = (): void => disconnect('the browser closed its debugging connection')
  const failed = (err: Error): void => disconnect(`the debugging connection failed: ${err.message}`)
  fromBrowser.on('data', onData)
  fromBrowser.on('end', closedByBrowser)
  fromBrowser.on('close', closedByBrowser)
  fromBrowser.on('error', failed)
  toBrowser.on('close', closedByBrowser)
  toBrowser.on('error', failed)

  return {
    send: (method, params, sendOptions) => send(undefined, method, params, sendOptions),
    on: (event, handler) => subscribe(BROWSER, event, handler as Handler),
    session: (sessionId) => ({
      sessionId,
      send: (method, params, sendOptions) => send(sessionId, method, params, sendOptions),
      on: (event, handler) => subscribe(sessionId, event, handler as Handler)
    }),
    commandLog: () => [...log],
    disconnected,
    close: () => disconnect('Birdbrain closed the debugging connection')
  }
}
