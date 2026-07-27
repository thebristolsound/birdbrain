import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appendFileSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindow } from 'electron'
import {
  createLogger,
  disposeLogger,
  flushSync as flushModuleLogger,
  getLogDir,
  getLogPath,
  initLogger,
  logger,
  readRecentEntries,
  setMainWindow
} from '@main/services/logger'
import { code, ident, ValidatedError } from '@main/services/logSafe'
import { IPC_CHANNELS } from '@shared/ipc'
import type { LogEntry } from '@shared/types'

// Note on this suite's provenance: the brief's Step 1 test block assumed a
// free-form `message` field on LogEntry and passed prose (`'server started'`)
// as the `code` argument. The landed @shared/types (Task 2) has no `message`
// field at all — see the "No free-form prose reaches disk" design change in
// the plan — and `code` is one of the fixed LOG_CODES literals. This suite is
// rewritten against the real, landed types rather than widening them to make
// the stale test block compile.

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bb-logger-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function lines(logDir: string): LogEntry[] {
  return readFileSync(join(logDir, 'birdbrain.log'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as LogEntry)
}

describe('createLogger', () => {
  it('writes a json line per entry after flush', () => {
    const log = createLogger({ logDir: dir, sessionId: 's1' })
    log.info('captureServer', 'capture.server_started', { port: 19845 })
    log.flushSync()

    const [entry] = lines(dir)
    expect(entry.level).toBe('info')
    expect(entry.source).toBe('captureServer')
    expect(entry.code).toBe('capture.server_started')
    expect(entry.context).toEqual({ port: 19845 })
    expect(entry.sessionId).toBe('s1')
  })

  it('returns a correlation id that matches the written entry', () => {
    const log = createLogger({ logDir: dir, sessionId: 's1' })
    const id = log.error('ipc', 'ipc.handler_threw')
    log.flushSync()
    expect(lines(dir)[0].id).toBe(id)
  })

  it('mints a 16-hex-character correlation id', () => {
    const log = createLogger({ logDir: dir, sessionId: 's1' })
    const id = log.info('app', 'app.session_start')
    expect(id).toMatch(/^[0-9a-f]{16}$/)
  })

  it('stores branded context values as plain strings', () => {
    const log = createLogger({ logDir: dir, sessionId: 's1' })
    log.warn('captureServer', 'capture.screenshot_dropped', {
      captureId: ident('3f2b9c14-7d8e-4a51-9b62-0c1d2e3f4a5b'),
      errorCode: code('TOO_LARGE')
    })
    log.flushSync()
    expect(lines(dir)[0].context).toEqual({
      captureId: '3f2b9c14-7d8e-4a51-9b62-0c1d2e3f4a5b',
      errorCode: 'TOO_LARGE'
    })
  })

  it('omits the context field entirely when none is given', () => {
    const log = createLogger({ logDir: dir, sessionId: 's1' })
    log.info('app', 'app.session_start')
    log.flushSync()
    expect(lines(dir)[0].context).toBeUndefined()
  })

  it('omits the error field entirely when no error is given', () => {
    const log = createLogger({ logDir: dir, sessionId: 's1' })
    log.info('app', 'app.session_start')
    log.flushSync()
    expect(lines(dir)[0].error).toBeUndefined()
  })

  it('sanitizes an attached error and never persists its message', () => {
    const log = createLogger({ logDir: dir, sessionId: 's1' })
    log.error(
      'app',
      'app.storage_init_failed',
      undefined,
      new Error('open /home/tester/case/a.mhtml')
    )
    log.flushSync()
    const { error } = lines(dir)[0]
    expect(error?.name).toBe('Error')
    expect(error).not.toHaveProperty('message')
    // The raw message text must not leak through any surviving field either.
    expect(JSON.stringify(error)).not.toContain('tester')
  })

  it('passes a pre-validated error through untouched instead of re-sanitizing it', () => {
    const log = createLogger({ logDir: dir, sessionId: 's1' })
    const validated = new ValidatedError({ name: 'IpcFailure', code: 'ENOENT', stack: null })
    log.error('ipc', 'ipc.handler_threw', undefined, validated)
    log.flushSync()
    // Re-running sanitizeError on this would flatten it to UnknownError, since
    // a ValidatedError is not an Error instance.
    expect(lines(dir)[0].error).toEqual({ name: 'IpcFailure', code: 'ENOENT', stack: null })
  })

  it('emits each entry to the renderer callback', () => {
    const seen: LogEntry[] = []
    const log = createLogger({ logDir: dir, sessionId: 's1', emit: (e) => seen.push(e) })
    log.info('app', 'app.session_start')
    expect(seen).toHaveLength(1)
    expect(seen[0].code).toBe('app.session_start')
  })

  it('does not throw when the emit callback itself throws', () => {
    const log = createLogger({
      logDir: dir,
      sessionId: 's1',
      emit: () => {
        throw new Error('dead renderer')
      }
    })
    expect(() => log.info('app', 'app.session_start')).not.toThrow()
  })

  it('rotates when the file exceeds the limit and keeps one backup', () => {
    const log = createLogger({ logDir: dir, sessionId: 's1', maxBytes: 1024 })
    for (let i = 0; i < 200; i++) log.info('app', 'app.session_start', { count: i })
    log.flushSync()

    expect(statSync(join(dir, 'birdbrain.log.1')).size).toBeGreaterThan(0)
    expect(statSync(join(dir, 'birdbrain.log')).size).toBeLessThan(2048)
  })

  it('flushes buffered entries when the buffer fills without an explicit flush', () => {
    const log = createLogger({ logDir: dir, sessionId: 's1', maxBuffer: 4 })
    for (let i = 0; i < 4; i++) log.info('app', 'app.session_start', { count: i })
    expect(lines(dir)).toHaveLength(4)
  })

  it('keeps a batch buffered after a transient write failure instead of discarding it', () => {
    // A file in place of the parent directory makes mkdirSync/appendFileSync
    // fail deterministically (ENOTDIR) without needing to mock node:fs.
    writeFileSync(join(dir, 'blocked'), '')
    const blockedDir = join(dir, 'blocked', 'sub')
    const log = createLogger({ logDir: blockedDir, sessionId: 's1' })

    log.error('app', 'app.unclassified_error')
    expect(() => log.flushSync()).not.toThrow()

    // Filesystem recovers; the entry from the failed attempt must still be
    // there to write, not silently dropped.
    rmSync(join(dir, 'blocked'), { force: true })
    log.flushSync()
    expect(lines(blockedDir)).toHaveLength(1)
  })

  it('drops the oldest retried entries once a permanently unwritable directory overruns the buffer', () => {
    writeFileSync(join(dir, 'blocked'), '')
    const blockedDir = join(dir, 'blocked', 'sub')
    const log = createLogger({ logDir: blockedDir, sessionId: 's1', maxBuffer: 2 })

    for (let i = 0; i < 40; i++) {
      expect(() => log.info('app', 'app.session_start', { count: i })).not.toThrow()
    }

    rmSync(join(dir, 'blocked'), { force: true })
    log.flushSync()
    const written = lines(blockedDir)
    expect(written.length).toBeGreaterThan(0)
    expect(written.length).toBeLessThan(40)
  })

  it('survives a log directory that does not exist yet by creating it', () => {
    const log = createLogger({ logDir: join(dir, 'nested', 'deep'), sessionId: 's1' })
    expect(() => {
      log.error('app', 'app.unclassified_error')
      log.flushSync()
    }).not.toThrow()
    expect(lines(join(dir, 'nested', 'deep'))).toHaveLength(1)
  })

  it('exposes its file path', () => {
    const log = createLogger({ logDir: dir, sessionId: 's1' })
    expect(log.logPath()).toBe(join(dir, 'birdbrain.log'))
  })

  it('dispose is a no-op when nothing was ever buffered', () => {
    const log = createLogger({ logDir: dir, sessionId: 's1' })
    expect(() => log.dispose()).not.toThrow()
  })

  it('dispose flushes any buffered entries and stops the flush timer', () => {
    const log = createLogger({ logDir: dir, sessionId: 's1' })
    log.info('app', 'app.session_start')
    log.dispose()
    expect(lines(dir)).toHaveLength(1)
  })
})

describe('logger module singleton', () => {
  afterEach(() => {
    disposeLogger()
  })

  it('is inert and returns empty ids before initLogger has run', () => {
    expect(logger.error('app', 'app.unclassified_error')).toBe('')
    expect(logger.warn('app', 'app.session_start')).toBe('')
    expect(logger.info('app', 'app.session_start')).toBe('')
    expect(getLogPath()).toBe('')
    expect(getLogDir()).toBe('')
    expect(readRecentEntries(10)).toEqual([])
    expect(() => flushModuleLogger()).not.toThrow()
    expect(() => disposeLogger()).not.toThrow()
  })

  it('initializes the log directory under userData/logs', () => {
    initLogger(dir, 's2')
    expect(getLogDir()).toBe(join(dir, 'logs'))
    expect(getLogPath()).toBe(join(dir, 'logs', 'birdbrain.log'))
  })

  it('writes through the singleton once initialized, across all three levels', () => {
    initLogger(dir, 's2')
    const infoId = logger.info('app', 'app.session_start')
    const warnId = logger.warn('app', 'app.session_start')
    const errorId = logger.error('app', 'app.unclassified_error')
    expect([infoId, warnId, errorId].every((id) => id.length === 16)).toBe(true)
    flushModuleLogger()
    expect(readRecentEntries(10)).toHaveLength(3)
  })

  it('returns no entries before anything has reached disk', () => {
    initLogger(dir, 's3')
    expect(readRecentEntries(5)).toEqual([])
  })

  it('emits to the main window via sendEvent, and stops once the window is destroyed', () => {
    initLogger(dir, 's4')
    const sent: Array<[string, unknown]> = []
    let destroyed = false
    const fakeWindow = {
      isDestroyed: () => destroyed,
      webContents: {
        send: (channel: string, payload: unknown) => sent.push([channel, payload])
      }
    } as unknown as BrowserWindow

    setMainWindow(fakeWindow)
    logger.info('app', 'app.session_start')
    expect(sent).toHaveLength(1)
    expect(sent[0][0]).toBe(IPC_CHANNELS.LOG_ENTRY)

    destroyed = true
    logger.info('app', 'app.session_start')
    expect(sent).toHaveLength(1)
  })

  it('does not emit anywhere when no main window has been set', () => {
    initLogger(dir, 's5')
    expect(() => logger.info('app', 'app.session_start')).not.toThrow()
  })

  it('readRecentEntries returns newest-first and skips a malformed trailing line', () => {
    initLogger(dir, 's6')
    logger.info('app', 'app.session_start', { count: 1 })
    logger.info('app', 'app.session_start', { count: 2 })
    flushModuleLogger()
    appendFileSync(getLogPath(), 'not-json\n')

    const entries = readRecentEntries(5)
    expect(entries).toHaveLength(2)
    expect(entries[0].context?.count).toBe(2)
    expect(entries[1].context?.count).toBe(1)
  })

  it('disposeLogger flushes, clears the instance, and later calls are inert again', () => {
    initLogger(dir, 's7')
    logger.warn('app', 'app.session_start')
    disposeLogger()
    expect(readFileSync(join(dir, 'logs', 'birdbrain.log'), 'utf8')).toContain('app.session_start')
    expect(logger.info('app', 'app.session_start')).toBe('')
  })
})
