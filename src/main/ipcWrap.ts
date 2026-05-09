import { ipcMain, type IpcMainInvokeEvent } from 'electron'

export type IpcResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string }

function ipcResult<T>(data: T): IpcResult<T> {
  return { ok: true, data }
}

function ipcError(err: unknown): IpcResult<never> {
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
// IpcResult and translates known SQLite errors into structured `{ ok: false }`
// responses. Non-SQLite errors are rethrown so Electron surfaces them as
// rejected promises in the renderer (preserving existing behaviour).
export function handle<T, A extends unknown[]>(
  channel: string,
  fn: (event: IpcMainInvokeEvent, ...args: A) => T | Promise<T>
): void {
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      const data = await fn(event, ...(args as A))
      return ipcResult(data)
    } catch (err) {
      return ipcError(err)
    }
  })
}
