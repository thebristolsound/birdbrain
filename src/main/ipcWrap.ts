import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type {
  ContractedChannel,
  IpcEventChannel,
  IpcEventContract,
  IpcInvokeContract
} from '@shared/ipc'
import { channel as channelName, code, type LogContext } from '@main/services/logSafe'
import type { Logger } from '@main/services/logger'

// Anything that can push a main→renderer event: a WebContents, or the sender
// on an IpcMainInvokeEvent.
interface EventTarget {
  send(channel: string, ...args: unknown[]): void
}

// Pushes a main→renderer event whose payload is pinned by IpcEventContract.
// Sending the wrong shape on a channel is a compile error.
export function sendEvent<C extends IpcEventChannel>(
  target: EventTarget,
  channel: C,
  payload: IpcEventContract[C]
): void {
  target.send(channel, payload)
}

export type IpcResult<T = unknown> =
  { ok: true; data: T } | { ok: false; error: string; code?: string }

export function ipcResult<T>(data: T): IpcResult<T> {
  return { ok: true, data }
}

// Throw inside a `handle()` callback to produce a structured `{ ok: false }`
// response without surfacing as a rejected promise. Use for expected failures
// (validation, missing resource) where the renderer should branch on `ok`.
export class IpcFailure extends Error {
  constructor(
    message: string,
    public readonly code?: string
  ) {
    super(message)
    this.name = 'IpcFailure'
  }
}

export function ipcError(err: unknown): IpcResult<never> {
  const sqliteErr = err as { code?: string; message?: string }
  if (sqliteErr.code === 'SQLITE_CONSTRAINT_UNIQUE') {
    return { ok: false, error: 'A record with that value already exists', code: sqliteErr.code }
  }
  if (sqliteErr.code === 'SQLITE_CONSTRAINT_FOREIGNKEY') {
    return { ok: false, error: 'Referenced record does not exist', code: sqliteErr.code }
  }
  if (sqliteErr.code === 'SQLITE_BUSY') {
    return { ok: false, error: 'Database is busy, please try again', code: sqliteErr.code }
  }
  if (typeof sqliteErr.code === 'string' && sqliteErr.code.startsWith('SQLITE_')) {
    return { ok: false, error: sqliteErr.message ?? 'Database error', code: sqliteErr.code }
  }
  throw err
}

// Where handle() records a failed request. The logger imports sendEvent from
// this module, so initLogger() hands itself over through this setter instead
// of an import, which would close a runtime cycle.
let failureLog: Pick<Logger, 'warn' | 'error'> | null = null

export function logIpcFailuresTo(log: Pick<Logger, 'warn' | 'error'> | null): void {
  failureLog = log
}

// A refusal's code in the log's upper-case form: 'invite-malformed' becomes
// INVITE_MALFORMED. Refusal codes are literals in this codebase, never input.
function refusalCode(err: unknown): string | null {
  const raw = (err as { code?: unknown }).code
  if (typeof raw !== 'string') return null
  const upper = raw.replace(/-/g, '_').toUpperCase()
  return /^[A-Z][A-Z0-9_]{0,47}$/.test(upper) ? upper : null
}

// A refusal reaches the renderer as `{ ok: false }` and logs at warn; any other
// throw is a defect and logs at error with its name, code and stack. Neither
// toasts from main (mainLogBridge): the renderer decides that, since a failed
// query logs without a toast and a failed mutation toasts on its own.
function logFailure(channel: string, err: unknown, refused: boolean): void {
  if (!failureLog) return
  const context: LogContext = { channel: channelName(channel) }
  if (refused) {
    const errorCode = refusalCode(err)
    if (errorCode) context.errorCode = code(errorCode)
    failureLog.warn('ipc', 'ipc.request_refused', context, err)
  } else {
    failureLog.error('ipc', 'ipc.request_threw', context, err)
  }
}

// Registers an ipcMain.handle that wraps the handler's return value in an
// IpcResult. Translates `IpcFailure` and known SQLite errors into structured
// `{ ok: false }` responses; other errors are rethrown so Electron surfaces
// them as rejected promises in the renderer. Every failure is logged once
// initLogger() has run.
//
// The channel must have an IpcInvokeContract entry, and that entry pins the
// handler's argument tuple and return type.
export function handle<C extends ContractedChannel>(
  channel: C,
  fn: (
    event: IpcMainInvokeEvent,
    ...args: IpcInvokeContract[C]['args']
  ) => IpcInvokeContract[C]['result'] | Promise<IpcInvokeContract[C]['result']>
): void {
  const invoke = fn as (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      const data = await invoke(event, ...args)
      return ipcResult(data)
    } catch (err) {
      if (err instanceof IpcFailure) {
        logFailure(channel, err, true)
        return { ok: false, error: err.message, code: err.code }
      }
      let refusal: IpcResult<never>
      try {
        refusal = ipcError(err)
      } catch {
        logFailure(channel, err, false)
        throw err
      }
      logFailure(channel, err, true)
      return refusal
    }
  })
}
