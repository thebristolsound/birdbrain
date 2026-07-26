import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { IpcChannel, IpcInvokeContract } from '@shared/ipc'

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

// The handler signature a channel must have. For a channel declared in
// IpcInvokeContract the argument tuple and return type are pinned by its entry;
// for one not yet declared the signature is inferred as before. As domains move
// into the contract the unconstrained branch shrinks to nothing.
type IpcHandler<C extends IpcChannel, T, A extends unknown[]> = C extends keyof IpcInvokeContract
  ? (
      event: IpcMainInvokeEvent,
      ...args: IpcInvokeContract[C]['args']
    ) => IpcInvokeContract[C]['result'] | Promise<IpcInvokeContract[C]['result']>
  : (event: IpcMainInvokeEvent, ...args: A) => T | Promise<T>

// Registers an ipcMain.handle that wraps the handler's return value in an
// IpcResult. Translates `IpcFailure` and known SQLite errors into structured
// `{ ok: false }` responses; other errors are rethrown so Electron surfaces
// them as rejected promises in the renderer.
export function handle<C extends IpcChannel, T, A extends unknown[]>(
  channel: C,
  fn: IpcHandler<C, T, A>
): void {
  const invoke = fn as (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
  ipcMain.handle(channel, async (event, ...args) => {
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
