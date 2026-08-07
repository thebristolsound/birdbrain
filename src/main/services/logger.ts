import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { BrowserWindow } from 'electron'
import { sendEvent } from '@main/ipcWrap'
import { IPC_CHANNELS } from '@shared/ipc'
import type { LogCode, LogEntry, LogLevel, LogSource } from '@shared/types'
import { isValidatedError, sanitizeError, type LogContext } from '@main/services/logSafe'

// The single durable sink. Writes are buffered and flushed on a timer so
// per-entry sync I/O never lands on the main-process event loop that
// diagnostics.ts is measuring for stalls — but flushSync() is exposed because
// an uncaughtException handler will not survive an async flush.

const LOG_FILE = 'birdbrain.log'
const BACKUP_FILE = 'birdbrain.log.1'
const MAX_BYTES = 2 * 1024 * 1024
const MAX_BUFFER = 32
const FLUSH_MS = 1000
// How far the retry buffer may grow past MAX_BUFFER before a permanently
// unwritable log directory starts costing unbounded memory. On overflow the
// OLDEST entries go: a tester reporting a problem cares about what just
// happened, and the newest entries are the ones whose ids are in live toasts.
const DROP_FACTOR = 8

export interface LoggerDeps {
  logDir: string
  sessionId: string
  emit?: (entry: LogEntry) => void
  maxBytes?: number
  maxBuffer?: number
}

export interface Logger {
  error(source: LogSource, code: LogCode, context?: LogContext, err?: unknown): string
  warn(source: LogSource, code: LogCode, context?: LogContext, err?: unknown): string
  info(source: LogSource, code: LogCode, context?: LogContext, err?: unknown): string
  flushSync(): void
  logPath(): string
  dispose(): void
}

export function createLogger(deps: LoggerDeps): Logger {
  const maxBytes = deps.maxBytes ?? MAX_BYTES
  const maxBuffer = deps.maxBuffer ?? MAX_BUFFER
  const path = join(deps.logDir, LOG_FILE)
  let buffer: string[] = []
  let timer: ReturnType<typeof setInterval> | null = null

  function rotateIfNeeded(): void {
    try {
      if (existsSync(path) && statSync(path).size > maxBytes) {
        renameSync(path, join(deps.logDir, BACKUP_FILE))
      }
    } catch {
      /* rotation is best-effort; never block a write */
    }
  }

  function flushSync(): void {
    if (buffer.length === 0) return
    const pending = buffer
    const payload = pending.join('')
    try {
      mkdirSync(deps.logDir, { recursive: true })
      rotateIfNeeded()
      appendFileSync(path, payload)
      // Cleared only on success. Clearing first discards the batch on any
      // transient error (a locked file, a full disk, an antivirus scan) — and
      // those entries have often already been toasted with a Report this
      // action, so the tester ends up citing a correlation id that appears in
      // neither log file. Keeping them means the next flush retries.
      buffer = buffer.slice(pending.length)
    } catch {
      // A tester with an unwritable userData must still get a working app.
      // Bounded: if the directory is permanently unwritable, the buffer would
      // otherwise grow without limit for the life of the process.
      if (buffer.length > maxBuffer * DROP_FACTOR) {
        buffer = buffer.slice(-maxBuffer)
      }
    }
  }

  function write(
    level: LogLevel,
    source: LogSource,
    code: LogCode,
    context?: LogContext,
    err?: unknown
  ): string {
    const entry: LogEntry = {
      // 16 hex chars (64 bits), not 8. The bundle cites only this id, so a
      // birthday collision across two 2MB logs would point Report this at the
      // wrong entry.
      id: randomUUID().replace(/-/g, '').slice(0, 16),
      sessionId: deps.sessionId,
      timestamp: new Date().toISOString(),
      level,
      // No sanitization needed: both are union members, not free text.
      source,
      code,
      ...(context ? { context } : {}),
      // A ValidatedError passes through untouched — it came from a boundary
      // that already validated it (the IPC handler), and re-running
      // sanitizeError on it would map it to UnknownError, since it is not an
      // Error instance. Everything else is sanitized, including plain objects
      // that merely LOOK like a LoggedError.
      ...(err === undefined
        ? {}
        : { error: isValidatedError(err) ? err.error : sanitizeError(err) })
    }

    buffer.push(`${JSON.stringify(entry)}\n`)

    if (!timer) {
      timer = setInterval(flushSync, FLUSH_MS)
      timer.unref?.()
    }
    if (buffer.length >= maxBuffer) flushSync()

    try {
      deps.emit?.(entry)
    } catch {
      /* a dead renderer must not break logging */
    }

    return entry.id
  }

  return {
    error: (s, c, ctx, e) => write('error', s, c, ctx, e),
    warn: (s, c, ctx, e) => write('warn', s, c, ctx, e),
    info: (s, c, ctx, e) => write('info', s, c, ctx, e),
    flushSync,
    logPath: () => path,
    dispose: () => {
      if (timer) clearInterval(timer)
      timer = null
      flushSync()
    }
  }
}

// --- Module singleton -------------------------------------------------------
// Crash handlers register before app.whenReady(), so every method must be safe
// to call before initLogger() has run.

let instance: Logger | null = null
let mainWindow: BrowserWindow | null = null
let logDir = ''

export function initLogger(userDataPath: string, sessionId: string): void {
  logDir = join(userDataPath, 'logs')
  instance = createLogger({
    logDir,
    sessionId,
    emit: (entry) => {
      // sendEvent, not webContents.send — it pins the payload to the channel's
      // IpcEventContract entry, so emitting the wrong shape is a compile error.
      if (mainWindow && !mainWindow.isDestroyed()) {
        sendEvent(mainWindow.webContents, IPC_CHANNELS.LOG_ENTRY, entry)
      }
    }
  })
}

export function setMainWindow(win: BrowserWindow): void {
  mainWindow = win
}

export function getLogDir(): string {
  return logDir
}

export function getLogPath(): string {
  return instance ? instance.logPath() : ''
}

export function flushSync(): void {
  instance?.flushSync()
}

// Newest-first tail of the durable log, for the Log tab (Task 12). Flushes
// first so entries still sitting in the buffer are included — otherwise the
// most recent failure, the one the tester came to look at, is the one missing.
// A malformed line is skipped rather than throwing: the file is append-only
// from multiple crash paths, so a torn final write is expected, not exceptional.
export function readRecentEntries(limit: number): LogEntry[] {
  instance?.flushSync()
  const path = getLogPath()
  if (!path) return []
  try {
    const raw = readFileSync(path, 'utf8').split('\n').filter(Boolean).slice(-limit)
    const out: LogEntry[] = []
    for (const line of raw.reverse()) {
      try {
        out.push(JSON.parse(line) as LogEntry)
      } catch {
        continue
      }
    }
    return out
  } catch {
    return []
  }
}

export function disposeLogger(): void {
  instance?.dispose()
  instance = null
}

export const logger = {
  error: (source: LogSource, code: LogCode, context?: LogContext, err?: unknown): string =>
    instance ? instance.error(source, code, context, err) : '',
  warn: (source: LogSource, code: LogCode, context?: LogContext, err?: unknown): string =>
    instance ? instance.warn(source, code, context, err) : '',
  info: (source: LogSource, code: LogCode, context?: LogContext, err?: unknown): string =>
    instance ? instance.info(source, code, context, err) : ''
}
