import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import type {
  ContractedChannel,
  IpcEventChannel,
  IpcEventContract,
  IpcInvokeContract
} from '@shared/ipc'

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

// Every contracted channel is privileged (DB writes, file dialogs, API-key
// access), so invocations are only accepted from the top frame of the app's own
// renderer — never from a sub-frame or a <webview>. Defense-in-depth against a
// future renderer-side compromise (issue #88).
function trustedRendererUrl(): string {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) return devUrl
  return pathToFileURL(join(__dirname, '../renderer/index.html')).toString()
}

function isTrustedIpcSender(event: IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame
  if (!frame || frame.parent !== null) return false
  return frame.url.startsWith(trustedRendererUrl())
}

// Rejected senders throw rather than returning `{ ok: false }`: an untrusted
// frame is never an expected failure the renderer should branch on.
function assertTrustedIpcSender(event: IpcMainInvokeEvent): void {
  if (!isTrustedIpcSender(event)) {
    throw new Error('IPC invocation rejected: untrusted sender frame')
  }
}

export type IpcResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string }

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

// Registers an ipcMain.handle that wraps the handler's return value in an
// IpcResult. Translates `IpcFailure` and known SQLite errors into structured
// `{ ok: false }` responses; other errors are rethrown so Electron surfaces
// them as rejected promises in the renderer.
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
    assertTrustedIpcSender(event)
    try {
      const data = await invoke(event, ...args)
      return ipcResult(data)
    } catch (err) {
      if (err instanceof IpcFailure) {
        return { ok: false, error: err.message, code: err.code }
      }
      return ipcError(err)
    }
  })
}
