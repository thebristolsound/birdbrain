import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { IpcMainInvokeEvent } from 'electron'

// --- Module mocks -----------------------------------------------------------
// Electron is mocked so registerIpcHandlers can register against a fake
// ipcMain whose handlers we capture and invoke directly. dialog/shell are
// configurable per-test stubs.
const registered = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
const showSaveDialog = vi.fn()
const showOpenDialog = vi.fn()
const openExternal = vi.fn()
const openPath = vi.fn()
const showItemInFolder = vi.fn()

let userDataPath = ''

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getVersion: () => '1.2.3',
    getPath: () => userDataPath,
    // diagnostics.ts's collectEnv() calls this for the process list in a
    // DiagnosticsSnapshot; the create-report handler builds one for real.
    getAppMetrics: () => []
  },
  ipcMain: {
    handle: (channel: string, fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => {
      registered.set(channel, fn)
    }
  },
  dialog: {
    showSaveDialog: (...args: unknown[]) => showSaveDialog(...args),
    showOpenDialog: (...args: unknown[]) => showOpenDialog(...args)
  },
  shell: {
    openExternal: (...args: unknown[]) => openExternal(...args),
    openPath: (...args: unknown[]) => openPath(...args),
    showItemInFolder: (...args: unknown[]) => showItemInFolder(...args)
  },
  nativeImage: {
    createFromBuffer: () => ({
      isEmpty: () => true,
      resize: () => ({ toJPEG: () => Buffer.from('') })
    })
  }
}))

// Network / heavy-IO leaves are stubbed; the handler wiring is what we test.
const analyzeCapture = vi.fn()
const saveAnalysis = vi.fn()
const getAnalysis = vi.fn()
vi.mock('@main/services/ai/analysisService', () => ({
  analyzeCapture: (...a: unknown[]) => analyzeCapture(...a),
  saveAnalysis: (...a: unknown[]) => saveAnalysis(...a),
  getAnalysis: (...a: unknown[]) => getAnalysis(...a)
}))

const testApiKey = vi.fn()
const listModels = vi.fn()
vi.mock('@main/services/openrouter', () => ({
  testApiKey: (...a: unknown[]) => testApiKey(...a),
  listModels: (...a: unknown[]) => listModels(...a)
}))

const generateReport = vi.fn()
const getExportPreflight = vi.fn()
vi.mock('@main/services/export', () => ({
  generateReport: (...a: unknown[]) => generateReport(...a),
  getExportPreflight: (...a: unknown[]) => getExportPreflight(...a)
}))

const exportCaseArchive = vi.fn()
const inspectCaseArchive = vi.fn()
const importCaseArchive = vi.fn()
vi.mock('@main/services/caseArchive', () => ({
  exportCaseArchive: (...a: unknown[]) => exportCaseArchive(...a),
  inspectCaseArchive: (...a: unknown[]) => inspectCaseArchive(...a),
  importCaseArchive: (...a: unknown[]) => importCaseArchive(...a)
}))

const lookupSnapshots = vi.fn()
vi.mock('@main/services/waybackMachine', async (importActual) => {
  const actual = await importActual<typeof import('@main/services/waybackMachine')>()
  return {
    ...actual,
    lookupSnapshots: (...a: unknown[]) => lookupSnapshots(...a)
  }
})

// --- Real services ----------------------------------------------------------
import { IPC_CHANNELS } from '@shared/ipc'
import { registerIpcHandlers } from '@main/ipcHandlers'
import type { BugReportResult, Capture, Case, LogEntry, SessionRecord } from '@shared/types'
import {
  disposeLogger,
  flushSync as flushLogger,
  getLogDir,
  getLogPath,
  initLogger,
  readRecentEntries
} from '@main/services/logger'
import Database from 'better-sqlite3'
import { closeDatabase, initDatabase, LATEST_SCHEMA_VERSION } from '@main/services/db/core'
import { createPreMigrationSnapshot } from '@main/services/db/dbSnapshots'
import * as caseRepo from '@main/services/db/caseRepo'
import * as captureRepo from '@main/services/db/captureRepo'
import * as extractedDataRepo from '@main/services/db/extractedDataRepo'
import { createCase } from '@main/services/db/caseRepo'
import { insertCapture } from '@main/services/db/captureRepo'
import * as storage from '@main/services/storage'
import { defaultCaptureStore } from '@main/services/captureStore'
import * as settings from '@main/services/settings'
import { initInstallationId } from '@main/services/installationId'
import { initServerToken } from '@main/services/serverToken'
import { createSelectorLifecycle } from '@main/services/selectorLifecycle'
import { createCaptureLifecycle } from '@main/services/captureLifecycle'
import { createSessionService, type SessionService } from '@main/services/session'
import { initManifest } from '@main/services/manifest'

const fakeEvent = {} as IpcMainInvokeEvent

// Invoke a registered handler by channel. Returns the raw handler result;
// `handle()`-wrapped channels return `{ ok, data }`, raw ones return the value.
async function invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  const fn = registered.get(channel)
  if (!fn) throw new Error(`No handler registered for ${channel}`)
  return (await fn(fakeEvent, ...args)) as T
}

// Unwrap a `handle()` IpcResult, asserting success.
function expectOk<T = unknown>(res: { ok: boolean; data?: T; error?: string }): T {
  expect(res.ok).toBe(true)
  return res.data as T
}

let sessionService: SessionService
let dbPath = ''
let caseId = ''
let captureId = ''
let recaptureService: {
  enqueue: ReturnType<typeof vi.fn>
  status: ReturnType<typeof vi.fn>
  idle: ReturnType<typeof vi.fn>
}
let updaterService: {
  start: ReturnType<typeof vi.fn>
  getStatus: ReturnType<typeof vi.fn>
  check: ReturnType<typeof vi.fn>
  download: ReturnType<typeof vi.fn>
  install: ReturnType<typeof vi.fn>
  applySettingsChange: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
}

function seedCapture(overrides: Partial<captureRepo.InsertCaptureParams> = {}): Capture {
  const cap = captureRepo.insertCapture({
    caseId,
    url: 'https://example.com',
    title: 'Example',
    hash: 'seedhash',
    timestamp: '2026-04-05T12:00:00.000Z',
    textContent: 'hello world content',
    ...overrides
  })
  defaultCaptureStore.writeScreenshot(caseId, cap.id, Buffer.from('png-bytes'))
  defaultCaptureStore.writeText(caseId, cap.id, 'hello world content')
  // Legacy .html artifact: the store never writes html, so seed it directly.
  writeFileSync(defaultCaptureStore.artifactPaths(caseId, cap.id, 'html').abs, '<html>hi</html>')
  // Pre-write a thumbnail so getThumbnail returns without invoking nativeImage.
  defaultCaptureStore.writeThumbnail(caseId, cap.id, Buffer.from('jpg'))
  return cap
}

beforeAll(() => {
  // Default dialog behaviour: cancelled.
  showSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined })
  showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
})

beforeEach(async () => {
  registered.clear()
  vi.clearAllMocks()
  showSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined })
  showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })

  userDataPath = mkdtempSync(join(tmpdir(), 'birdbrain-ipc-'))
  process.env.BIRDBRAIN_USER_DATA = userDataPath
  dbPath = join(userDataPath, 'birdbrain.db')

  storage.initStorage(join(userDataPath, 'captures'))
  await initDatabase(dbPath)
  settings.initSettings(userDataPath)
  initInstallationId(userDataPath)
  initServerToken(userDataPath)

  const selectorLifecycle = createSelectorLifecycle({ emitRematched: vi.fn() })
  const captureLifecycle = createCaptureLifecycle({ selectorLifecycle })
  recaptureService = {
    enqueue: vi.fn(() => ({ accepted: 1, rejected: [] })),
    status: vi.fn(() => ({ pending: 0, activeUrl: null })),
    idle: vi.fn()
  }
  updaterService = {
    start: vi.fn(),
    getStatus: vi.fn(() => ({
      state: 'idle',
      currentVersion: '1.2.3',
      supportsAutoInstall: false,
      installOnQuit: false
    })),
    check: vi.fn(async () => ({
      state: 'up-to-date',
      currentVersion: '1.2.3',
      supportsAutoInstall: false,
      installOnQuit: false
    })),
    download: vi.fn(async () => undefined),
    install: vi.fn(),
    applySettingsChange: vi.fn(),
    dispose: vi.fn()
  }
  sessionService = createSessionService()
  registerIpcHandlers({
    selectorLifecycle,
    captureLifecycle,
    recaptureService,
    updaterService,
    sessionService
  })

  const created = caseRepo.createCase({ name: 'Test Case' })
  caseId = created.id
  storage.ensureCaseDir(caseId)
  initManifest(join(storage.getStorageRoot(), caseId))
  captureId = seedCapture().id
})

afterEach(() => {
  closeDatabase()
  rmSync(userDataPath, { recursive: true, force: true })
  delete process.env.BIRDBRAIN_USER_DATA
})

describe('ipcHandlers — registration', () => {
  // Every declared channel is an invoke channel or an `event:` push — the
  // compile-time ChannelsAreExhaustive check in @shared/ipc enforces that split.
  // Here we close the other half of the loop at runtime: every invoke channel
  // has a handler, and no handler exists for a channel nobody declared.
  const invokeChannels = Object.values(IPC_CHANNELS).filter((ch) => !ch.startsWith('event:'))

  it('registers a handler for every declared invoke channel', () => {
    const missing = invokeChannels.filter((ch) => !registered.has(ch))
    expect(missing).toEqual([])
  })

  it('registers no handler for an undeclared channel', () => {
    const declared = new Set<string>(invokeChannels)
    const unexpected = [...registered.keys()].filter((ch) => !declared.has(ch))
    expect(unexpected).toEqual([])
  })
})

describe('ipcHandlers — cases', () => {
  it('lists, gets, creates, updates and deletes cases', async () => {
    const list = expectOk<Case[]>(await invoke(IPC_CHANNELS.CASES_LIST))
    expect(list.some((c) => c.id === caseId)).toBe(true)

    const one = expectOk<Case>(await invoke(IPC_CHANNELS.CASES_GET, caseId))
    expect(one.name).toBe('Test Case')

    const created = expectOk<Case>(await invoke(IPC_CHANNELS.CASES_CREATE, { name: 'Another' }))
    expect(created.name).toBe('Another')

    const updated = expectOk<Case>(
      await invoke(IPC_CHANNELS.CASES_UPDATE, { id: created.id, name: 'Renamed' })
    )
    expect(updated.name).toBe('Renamed')

    expectOk(await invoke(IPC_CHANNELS.CASES_DELETE, created.id))
    const after = expectOk<Case[]>(await invoke(IPC_CHANNELS.CASES_LIST))
    expect(after.some((c) => c.id === created.id)).toBe(false)
  })

  it('translates a unique-constraint violation into a structured failure', async () => {
    // Re-creating a case is fine, but duplicate tag names are constrained.
    expectOk(await invoke(IPC_CHANNELS.TAGS_CREATE, { name: 'dup', color: '#fff' }))
    const res = await invoke<{ ok: boolean; code?: string }>(IPC_CHANNELS.TAGS_CREATE, {
      name: 'dup',
      color: '#000'
    })
    expect(res.ok).toBe(false)
    expect(res.code).toBe('SQLITE_CONSTRAINT_UNIQUE')
  })
})

describe('ipcHandlers — session', () => {
  it('reports an empty snapshot before anything is activated', async () => {
    expect(expectOk(await invoke(IPC_CHANNELS.SESSION_SNAPSHOT))).toEqual({
      sessionActive: false,
      activeCaseId: null,
      captureCount: 0
    })
  })

  it('activates a case and reflects it in the snapshot', async () => {
    const snap = expectOk<{ activeCaseId: string | null }>(
      await invoke(IPC_CHANNELS.SESSION_ACTIVATE_CASE, caseId)
    )
    expect(snap.activeCaseId).toBe(caseId)
    expect(
      expectOk<{ activeCaseId: string | null }>(await invoke(IPC_CHANNELS.SESSION_SNAPSHOT))
        .activeCaseId
    ).toBe(caseId)
  })

  it('rejects activating a case that does not exist', async () => {
    const res = (await invoke(IPC_CHANNELS.SESSION_ACTIVATE_CASE, 'nope')) as {
      ok: boolean
      code?: string
    }
    expect(res.ok).toBe(false)
    expect(res.code).toBe('NOT_FOUND')
  })

  it('refuses to start without an active case', async () => {
    const res = (await invoke(IPC_CHANNELS.SESSION_START)) as { ok: boolean; code?: string }
    expect(res.ok).toBe(false)
    expect(res.code).toBe('NO_ACTIVE_CASE')
  })

  it('starts and stops a session', async () => {
    expectOk(await invoke(IPC_CHANNELS.SESSION_ACTIVATE_CASE, caseId))

    const started = expectOk<{ sessionActive: boolean }>(await invoke(IPC_CHANNELS.SESSION_START))
    expect(started.sessionActive).toBe(true)

    const stopped = expectOk<{ sessionActive: boolean }>(await invoke(IPC_CHANNELS.SESSION_STOP))
    expect(stopped.sessionActive).toBe(false)
  })

  it('shares one service instance with the capture-server session state', async () => {
    expectOk(await invoke(IPC_CHANNELS.SESSION_ACTIVATE_CASE, caseId))
    expect(sessionService.snapshot().activeCaseId).toBe(caseId)
  })
})

describe('ipcHandlers — captures', () => {
  it('lists and gets captures', async () => {
    const list = expectOk<Capture[]>(await invoke(IPC_CHANNELS.CAPTURES_LIST, caseId))
    expect(list).toHaveLength(1)
    const one = expectOk<Capture>(await invoke(IPC_CHANNELS.CAPTURES_GET, captureId))
    expect(one.id).toBe(captureId)
  })

  it('returns capture content for html, png and txt', async () => {
    const html = expectOk<string>(
      await invoke(IPC_CHANNELS.CAPTURES_GET_CONTENT, captureId, 'html')
    )
    expect(html).toContain('<html>')
    const png = expectOk<string>(await invoke(IPC_CHANNELS.CAPTURES_GET_CONTENT, captureId, 'png'))
    expect(png).toBe(Buffer.from('png-bytes').toString('base64'))
    const txt = expectOk<string>(await invoke(IPC_CHANNELS.CAPTURES_GET_CONTENT, captureId, 'txt'))
    expect(txt).toContain('hello world')
    const missing = expectOk(await invoke(IPC_CHANNELS.CAPTURES_GET_CONTENT, 'nope', 'html'))
    expect(missing).toBeNull()
  })

  it('returns a thumbnail and matching selectors', async () => {
    const thumb = expectOk<string>(await invoke(IPC_CHANNELS.CAPTURES_GET_THUMBNAIL, captureId))
    expect(typeof thumb).toBe('string')
    expect(expectOk(await invoke(IPC_CHANNELS.CAPTURES_GET_THUMBNAIL, 'missing'))).toBeNull()
    const sel = expectOk(await invoke(IPC_CHANNELS.CAPTURES_GET_MATCHING_SELECTORS, captureId))
    expect(Array.isArray(sel)).toBe(true)
  })

  it('counts captures by case', async () => {
    const counts = expectOk<Record<string, number>>(
      await invoke(IPC_CHANNELS.CAPTURES_COUNTS_BY_CASE)
    )
    expect(counts[caseId]).toBe(1)
  })

  it('toggles, reads and lists favorites', async () => {
    expectOk(await invoke(IPC_CHANNELS.CAPTURES_TOGGLE_FAVORITE, captureId))
    expect(expectOk(await invoke(IPC_CHANNELS.CAPTURES_IS_FAVORITE, captureId))).toBe(true)
    const favs = expectOk<string[]>(await invoke(IPC_CHANNELS.CAPTURES_LIST_FAVORITES, caseId))
    expect(favs).toHaveLength(1)
  })

  it('returns null mhtml url when capture has no mhtml path', async () => {
    expect(expectOk(await invoke(IPC_CHANNELS.CAPTURES_GET_MHTML_URL, captureId))).toBeNull()
  })

  it('opens external http(s) urls and rejects other protocols', async () => {
    openExternal.mockResolvedValue(undefined)
    expectOk(await invoke(IPC_CHANNELS.CAPTURES_OPEN_EXTERNAL, 'https://example.com'))
    expect(openExternal).toHaveBeenCalledWith('https://example.com')

    const bad = await invoke<{ ok: boolean; code?: string }>(
      IPC_CHANNELS.CAPTURES_OPEN_EXTERNAL,
      'file:///etc/passwd'
    )
    expect(bad.ok).toBe(false)
    expect(bad.code).toBe('INVALID_URL_PROTOCOL')

    const malformed = await invoke<{ ok: boolean; code?: string }>(
      IPC_CHANNELS.CAPTURES_OPEN_EXTERNAL,
      'not a url'
    )
    expect(malformed.ok).toBe(false)
    expect(malformed.code).toBe('INVALID_URL')
  })

  it('returns null when downloading a missing capture and writes the file otherwise', async () => {
    expect(expectOk(await invoke(IPC_CHANNELS.CAPTURES_DOWNLOAD, 'missing'))).toBeNull()

    const target = join(userDataPath, 'out.html')
    showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: target })
    const saved = expectOk<string>(await invoke(IPC_CHANNELS.CAPTURES_DOWNLOAD, captureId))
    expect(saved).toBe(target)
    expect(readFileSync(target, 'utf-8')).toBe('<html>hi</html>')
  })

  it('downloads the raw .mhtml artifact for mhtml-format captures', async () => {
    const mhtmlBody = 'MIME-Version: 1.0\r\nContent-Type: multipart/related\r\n\r\nmhtml-bytes'
    const cap = seedCapture({ format: 'mhtml' })
    const mhtmlPaths = defaultCaptureStore.artifactPaths(caseId, cap.id, 'mhtml')
    writeFileSync(mhtmlPaths.abs, mhtmlBody)

    const target = join(userDataPath, 'out.mhtml')
    showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: target })
    const saved = expectOk<string>(await invoke(IPC_CHANNELS.CAPTURES_DOWNLOAD, cap.id))
    expect(saved).toBe(target)
    expect(readFileSync(target, 'utf-8')).toBe(mhtmlBody)

    const dialogArgs = showSaveDialog.mock.calls.at(-1)![0] as {
      defaultPath: string
      filters: Array<{ extensions: string[] }>
    }
    expect(dialogArgs.defaultPath.endsWith('.mhtml')).toBe(true)
    expect(dialogArgs.filters[0].extensions).toContain('mhtml')
  })

  it('verifies a capture and deletes it', async () => {
    const verification = expectOk<{ status: string }>(
      await invoke(IPC_CHANNELS.CAPTURES_VERIFY, captureId)
    )
    expect(verification.status).toBeDefined()

    expectOk(await invoke(IPC_CHANNELS.CAPTURES_DELETE, captureId))
    expect(expectOk<Capture[]>(await invoke(IPC_CHANNELS.CAPTURES_LIST, caseId))).toHaveLength(0)
  })

  it('reports failure for the http/pipeline self-tests when the server is down', async () => {
    const http = expectOk<{ success: boolean }>(await invoke(IPC_CHANNELS.CAPTURES_TEST_HTTP))
    expect(http.success).toBe(false)
    const pipeline = expectOk<{ success: boolean }>(
      await invoke(IPC_CHANNELS.CAPTURES_TEST_PIPELINE)
    )
    expect(pipeline.success).toBe(false)
  })
})

describe('ipcHandlers — tags', () => {
  it('creates, updates, lists, assigns and removes tags', async () => {
    const tag = expectOk<{ id: string }>(
      await invoke(IPC_CHANNELS.TAGS_CREATE, { name: 'urgent', color: '#f00' })
    )
    expectOk(await invoke(IPC_CHANNELS.TAGS_UPDATE, { id: tag.id, name: 'urgent2', color: '#0f0' }))

    const list = expectOk<{ id: string }[]>(await invoke(IPC_CHANNELS.TAGS_LIST))
    expect(list.some((t) => t.id === tag.id)).toBe(true)

    expectOk(await invoke(IPC_CHANNELS.TAGS_ADD_TO_CAPTURE, { captureId, tagId: tag.id }))
    const forCapture = expectOk<{ id: string }[]>(
      await invoke(IPC_CHANNELS.TAGS_GET_FOR_CAPTURE, captureId)
    )
    expect(forCapture.some((t) => t.id === tag.id)).toBe(true)

    expect(
      expectOk<number>(await invoke(IPC_CHANNELS.TAGS_COUNT_FOR_CASE, caseId))
    ).toBeGreaterThan(0)
    expect(expectOk(await invoke(IPC_CHANNELS.TAGS_USAGE_COUNTS_FOR_CASE, caseId))).toBeDefined()

    expectOk(await invoke(IPC_CHANNELS.TAGS_REMOVE_FROM_CAPTURE, { captureId, tagId: tag.id }))
    expectOk(await invoke(IPC_CHANNELS.TAGS_DELETE, tag.id))
  })
})

describe('ipcHandlers — selectors', () => {
  it('creates, bulk-creates, updates, lists and deletes selectors', async () => {
    const sel = expectOk<{ id: string }>(
      await invoke(IPC_CHANNELS.SELECTORS_CREATE, {
        caseId,
        pattern: 'hello',
        isRegex: false,
        label: 'greeting'
      })
    )
    expectOk(
      await invoke(IPC_CHANNELS.SELECTORS_BULK_CREATE, {
        caseId,
        selectors: [{ pattern: 'world', isRegex: false }]
      })
    )
    expectOk(
      await invoke(IPC_CHANNELS.SELECTORS_UPDATE, { id: sel.id, pattern: 'hello2', isRegex: false })
    )

    const list = expectOk<{ id: string }[]>(await invoke(IPC_CHANNELS.SELECTORS_LIST, caseId))
    expect(list.length).toBeGreaterThanOrEqual(2)
    expect(expectOk(await invoke(IPC_CHANNELS.SELECTORS_GET, sel.id))).toBeDefined()
    expect(expectOk(await invoke(IPC_CHANNELS.SELECTORS_LIST_ACTIVE))).toBeDefined()
    expect(expectOk(await invoke(IPC_CHANNELS.SELECTORS_MATCH_COUNTS, caseId))).toBeDefined()
    expect(expectOk(await invoke(IPC_CHANNELS.SELECTORS_COVERAGE, caseId))).toBeDefined()
    expect(
      expectOk(await invoke(IPC_CHANNELS.SELECTORS_MATCHING_CAPTURES, caseId, [sel.id]))
    ).toBeDefined()

    expectOk(await invoke(IPC_CHANNELS.SELECTORS_DELETE, sel.id))
  })

  it('exports selector matches to csv, honouring the save dialog', async () => {
    const cancelled = expectOk<{ exported: boolean }>(
      await invoke(IPC_CHANNELS.SELECTORS_EXPORT_MATCHES, caseId)
    )
    expect(cancelled.exported).toBe(false)

    const target = join(userDataPath, 'matches.csv')
    showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: target })
    const exported = expectOk<{ exported: boolean; path?: string }>(
      await invoke(IPC_CHANNELS.SELECTORS_EXPORT_MATCHES, caseId)
    )
    expect(exported.exported).toBe(true)
    expect(exported.path).toBe(target)

    const missing = expectOk<{ exported: boolean }>(
      await invoke(IPC_CHANNELS.SELECTORS_EXPORT_MATCHES, 'no-such-case')
    )
    expect(missing.exported).toBe(false)
  })
})

describe('ipcHandlers — notes', () => {
  it('creates, updates, lists, counts, searches and deletes notes', async () => {
    const note = expectOk<{ id: string }>(
      await invoke(IPC_CHANNELS.NOTES_CREATE, { caseId, content: 'a finding about foxes' })
    )
    expectOk(await invoke(IPC_CHANNELS.NOTES_UPDATE, { id: note.id, content: 'updated finding' }))

    expect(expectOk<{ id: string }[]>(await invoke(IPC_CHANNELS.NOTES_LIST, caseId))).toHaveLength(
      1
    )
    expect(expectOk(await invoke(IPC_CHANNELS.NOTES_GET, note.id))).toBeDefined()
    expect(expectOk<number>(await invoke(IPC_CHANNELS.NOTES_COUNT, caseId))).toBe(1)
    expect(expectOk(await invoke(IPC_CHANNELS.NOTES_SEARCH, caseId, 'finding'))).toBeDefined()
    // Malformed FTS query is swallowed and returns [].
    expect(expectOk(await invoke(IPC_CHANNELS.NOTES_SEARCH, caseId, '"unbalanced'))).toEqual([])

    expectOk(await invoke(IPC_CHANNELS.NOTES_DELETE, note.id))
    expect(expectOk<number>(await invoke(IPC_CHANNELS.NOTES_COUNT, caseId))).toBe(0)
  })

  // #234: a cross-case anchor is rejected as a structured IpcFailure (not a
  // rejected promise), so the renderer can branch on it. Exercised at the IPC
  // boundary specifically because that translation (AnchorCaseMismatchError ->
  // IpcFailure) lives in ipcHandlers.ts, not in noteRepo itself.
  it('reports a cross-case anchor as a structured failure, on both create and update', async () => {
    const otherCase = createCase({ name: 'Elsewhere', description: '' })
    const otherCapture = insertCapture({
      caseId: otherCase.id,
      url: 'https://example.com',
      title: 'Elsewhere',
      hash: 'abc123',
      timestamp: new Date().toISOString()
    })
    const anchor = JSON.stringify({ kind: 'capture', captureId: otherCapture.id })

    const createRes = await invoke<{ ok: boolean; error?: string; code?: string }>(
      IPC_CHANNELS.NOTES_CREATE,
      { caseId, anchor }
    )
    expect(createRes.ok).toBe(false)
    expect(createRes.code).toBe('ANCHOR_CASE_MISMATCH')
    // assertAnchorInCase runs before the INSERT in createNote, so a rejected
    // create must not have written a row -- the code alone doesn't prove that.
    expect(expectOk<unknown[]>(await invoke(IPC_CHANNELS.NOTES_LIST, caseId))).toHaveLength(0)

    const note = expectOk<{ id: string }>(await invoke(IPC_CHANNELS.NOTES_CREATE, { caseId }))
    const updateRes = await invoke<{ ok: boolean; error?: string; code?: string }>(
      IPC_CHANNELS.NOTES_UPDATE,
      { id: note.id, anchor }
    )
    expect(updateRes.ok).toBe(false)
    expect(updateRes.code).toBe('ANCHOR_CASE_MISMATCH')
    // Same for update: the rejected anchor must not have been written either.
    const reread = expectOk<{ anchor?: unknown }>(await invoke(IPC_CHANNELS.NOTES_GET, note.id))
    expect(reread.anchor).toBeUndefined()
  })
})

describe('ipcHandlers — annotations', () => {
  it('saves, reads, pins and deletes annotations', async () => {
    expectOk(
      await invoke(IPC_CHANNELS.ANNOTATIONS_SAVE, {
        captureId,
        shapes: [],
        imageWidth: 100,
        imageHeight: 100
      })
    )
    const bundle = expectOk<{ annotations: unknown; pins: unknown[] }>(
      await invoke(IPC_CHANNELS.ANNOTATIONS_GET, captureId)
    )
    expect(bundle.annotations).not.toBeNull()
    expect(Array.isArray(bundle.pins)).toBe(true)

    const pin = expectOk<{ id: string }>(
      await invoke(IPC_CHANNELS.ANNOTATIONS_UPSERT_PIN, { captureId, body: 'note' })
    )
    expect(pin.id).toBeDefined()
    expectOk(await invoke(IPC_CHANNELS.ANNOTATIONS_DELETE_PIN, pin.id))
    expectOk(await invoke(IPC_CHANNELS.ANNOTATIONS_DELETE, captureId))
  })
})

describe('ipcHandlers — search', () => {
  it('searches captures and swallows malformed FTS queries', async () => {
    expect(expectOk(await invoke(IPC_CHANNELS.SEARCH, 'case-1', 'hello'))).toBeDefined()
    expect(expectOk(await invoke(IPC_CHANNELS.SEARCH, 'case-1', '"unbalanced'))).toEqual([])
  })
})

describe('ipcHandlers — settings', () => {
  it('gets, updates, resets and reports identity', async () => {
    const s = expectOk<{ operatorName?: string }>(await invoke(IPC_CHANNELS.SETTINGS_GET))
    expect(s).toBeDefined()

    const updated = expectOk<{ operatorName?: string }>(
      await invoke(IPC_CHANNELS.SETTINGS_UPDATE, { operatorName: 'Agent Smith' })
    )
    expect(updated.operatorName).toBe('Agent Smith')

    const identity = expectOk<{ installationId: string; operatorName: string }>(
      await invoke(IPC_CHANNELS.SETTINGS_GET_IDENTITY)
    )
    expect(identity.installationId).toBeTruthy()
    expect(identity.operatorName).toBe('Agent Smith')

    const reset = expectOk<{ operatorName?: string }>(await invoke(IPC_CHANNELS.SETTINGS_RESET))
    expect(reset).toBeDefined()
  })

  it('delegates openrouter key tests and model listing', async () => {
    testApiKey.mockResolvedValue(true)
    listModels.mockResolvedValue([{ id: 'gpt' }])
    expect(expectOk(await invoke(IPC_CHANNELS.SETTINGS_TEST_OPENROUTER, 'key'))).toBe(true)
    expect(expectOk(await invoke(IPC_CHANNELS.SETTINGS_LIST_MODELS, 'key'))).toEqual([
      { id: 'gpt' }
    ])
  })

  it('returns null when the storage-path picker is cancelled and a path otherwise', async () => {
    expect(expectOk(await invoke(IPC_CHANNELS.SETTINGS_CHOOSE_STORAGE_PATH))).toBeNull()
    showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/data/x'] })
    expect(expectOk(await invoke(IPC_CHANNELS.SETTINGS_CHOOSE_STORAGE_PATH))).toBe('/data/x')
  })
})

describe('ipcHandlers — updates', () => {
  it('reports status and runs a check via the updater service', async () => {
    const status = expectOk(await invoke(IPC_CHANNELS.UPDATES_GET_STATUS))
    expect(status).toEqual({
      state: 'idle',
      currentVersion: '1.2.3',
      supportsAutoInstall: false,
      installOnQuit: false
    })
    expect(updaterService.getStatus).toHaveBeenCalled()

    const checked = expectOk(await invoke(IPC_CHANNELS.UPDATES_CHECK))
    expect(checked).toEqual({
      state: 'up-to-date',
      currentVersion: '1.2.3',
      supportsAutoInstall: false,
      installOnQuit: false
    })
    expect(updaterService.check).toHaveBeenCalled()
  })

  it('delegates download and install to the updater service', async () => {
    await invoke(IPC_CHANNELS.UPDATES_DOWNLOAD)
    expect(updaterService.download).toHaveBeenCalled()

    await invoke(IPC_CHANNELS.UPDATES_INSTALL)
    expect(updaterService.install).toHaveBeenCalled()
  })

  it('reconfigures the updater when settings change', async () => {
    await invoke(IPC_CHANNELS.SETTINGS_UPDATE, { releaseChannel: 'beta' })
    expect(updaterService.applySettingsChange).toHaveBeenCalledWith({ releaseChannel: 'beta' })
  })
})

describe('ipcHandlers — export', () => {
  it('returns preflight info and runs report generation through the save dialog', async () => {
    getExportPreflight.mockReturnValue({ captureCount: 1 })
    const pre = expectOk<{ captureCount: number }>(
      await invoke(IPC_CHANNELS.EXPORT_PREFLIGHT, caseId)
    )
    expect(pre.captureCount).toBe(1)

    // Cancelled dialog → no report generated, and the result reports canceled.
    const canceled = expectOk<{ canceled: boolean; filePath?: string }>(
      await invoke(IPC_CHANNELS.EXPORT_GENERATE, caseId, { format: 'html' })
    )
    expect(canceled).toEqual({ canceled: true })
    expect(generateReport).not.toHaveBeenCalled()

    const target = join(userDataPath, 'report.html')
    showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: target })
    generateReport.mockResolvedValue(undefined)
    const done = expectOk<{ canceled: boolean; filePath?: string }>(
      await invoke(IPC_CHANNELS.EXPORT_GENERATE, caseId, { format: 'zip' })
    )
    expect(generateReport).toHaveBeenCalledTimes(1)
    expect(done).toEqual({ canceled: false, filePath: target })
  })

  it('forwards onProgress to the renderer via event.sender.send', async () => {
    const target = join(userDataPath, 'evidence.zip')
    showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: target })
    generateReport.mockImplementationOnce(
      async (
        _caseId,
        _options,
        _lifecycle,
        onProgress: (step: string, percent: number) => void
      ) => {
        onProgress('Verifying capture 1 of 2...', 30)
      }
    )

    const send = vi.fn()
    const fn = registered.get(IPC_CHANNELS.EXPORT_GENERATE)!
    await fn({ sender: { send } } as unknown as IpcMainInvokeEvent, caseId, { format: 'zip' })

    expect(send).toHaveBeenCalledWith(IPC_CHANNELS.EXPORT_PROGRESS, {
      caseId,
      step: 'Verifying capture 1 of 2...',
      percent: 30
    })
  })

  it('reveals and opens exported files via the shell', async () => {
    const evidencePath = join(userDataPath, 'evidence.zip')
    // Reveal/open is only permitted for a path this process authored, so run a
    // real export first to register it (#C12).
    showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: evidencePath })
    const done = expectOk(await invoke(IPC_CHANNELS.EXPORT_GENERATE, caseId, { format: 'zip' }))
    expect(done).toEqual({ canceled: false, filePath: evidencePath })

    writeFileSync(evidencePath, '')
    openPath.mockResolvedValueOnce('')
    expectOk(await invoke(IPC_CHANNELS.SHELL_SHOW_ITEM_IN_FOLDER, evidencePath))
    expect(showItemInFolder).toHaveBeenCalledWith(evidencePath)

    expectOk(await invoke(IPC_CHANNELS.SHELL_OPEN_PATH, evidencePath))
    expect(openPath).toHaveBeenCalledWith(evidencePath)
  })

  it('refuses to reveal or open a path it did not author (#C12)', async () => {
    const evil = join(userDataPath, 'evil.exe')
    writeFileSync(evil, '')

    const openRes = await invoke<{ ok: boolean; error?: string }>(
      IPC_CHANNELS.SHELL_OPEN_PATH,
      evil
    )
    expect(openRes.ok).toBe(false)
    expect(openRes.error).toMatch(/not permitted/i)

    const revealRes = await invoke<{ ok: boolean; error?: string }>(
      IPC_CHANNELS.SHELL_SHOW_ITEM_IN_FOLDER,
      evil
    )
    expect(revealRes.ok).toBe(false)
    expect(revealRes.error).toMatch(/not permitted/i)

    expect(openPath).not.toHaveBeenCalled()
    expect(showItemInFolder).not.toHaveBeenCalled()
  })

  it('bounds the reveal/open allowlist with FIFO eviction (#C12)', async () => {
    // Export well past the cap; the earliest paths must be evicted while the
    // most recent stays openable, so the allowlist can't grow unbounded.
    const paths = Array.from({ length: 70 }, (_, i) => join(userDataPath, `evd-${i}.zip`))
    for (const p of paths) {
      showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: p })
      expectOk(await invoke(IPC_CHANNELS.EXPORT_GENERATE, caseId, { format: 'zip' }))
    }

    writeFileSync(paths[0], '')
    const evicted = await invoke<{ ok: boolean; error?: string }>(
      IPC_CHANNELS.SHELL_OPEN_PATH,
      paths[0]
    )
    expect(evicted.ok).toBe(false)
    expect(evicted.error).toMatch(/not permitted/i)

    writeFileSync(paths[69], '')
    openPath.mockResolvedValueOnce('')
    expectOk(await invoke(IPC_CHANNELS.SHELL_OPEN_PATH, paths[69]))
    expect(openPath).toHaveBeenCalledWith(paths[69])
  })

  it('re-exporting a path refreshes its FIFO recency so it is not stale-evicted (#C12)', async () => {
    const target = join(userDataPath, 'repeat.zip')
    const exportPath = async (p: string) => {
      showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: p })
      expectOk(await invoke(IPC_CHANNELS.EXPORT_GENERATE, caseId, { format: 'zip' }))
    }

    // Fill the allowlist to capacity with `target` as the oldest of 64 entries.
    await exportPath(target)
    for (let i = 0; i < 63; i++) await exportPath(join(userDataPath, `filler-${i}.zip`))

    // Re-export the same target: it must move to the newest slot, not stay pinned
    // at its stale position. One more unrelated export then evicts the true
    // oldest (a filler) rather than the just-rewritten target.
    await exportPath(target)
    await exportPath(join(userDataPath, 'newcomer.zip'))

    writeFileSync(target, '')
    openPath.mockResolvedValueOnce('')
    expectOk(await invoke(IPC_CHANNELS.SHELL_OPEN_PATH, target))
    expect(openPath).toHaveBeenCalledWith(target)
  })
})

describe('ipcHandlers — case archive', () => {
  it('writes a file on the export happy path and reports canceled on dialog dismissal', async () => {
    const canceled = expectOk<{ canceled: boolean; filePath?: string }>(
      await invoke(IPC_CHANNELS.CASES_EXPORT_ARCHIVE, caseId)
    )
    expect(canceled).toEqual({ canceled: true })
    expect(exportCaseArchive).not.toHaveBeenCalled()

    const target = join(userDataPath, 'archive.birdbrain')
    showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: target })
    exportCaseArchive.mockResolvedValue(undefined)
    const done = expectOk<{ canceled: boolean; filePath?: string }>(
      await invoke(IPC_CHANNELS.CASES_EXPORT_ARCHIVE, caseId)
    )
    expect(exportCaseArchive).toHaveBeenCalledWith(caseId, target, expect.any(Function))
    expect(done).toEqual({ canceled: false, filePath: target })
  })

  it('fails with NOT_FOUND when exporting an unknown case', async () => {
    const res = await invoke<{ ok: boolean; error?: string; code?: string }>(
      IPC_CHANNELS.CASES_EXPORT_ARCHIVE,
      'missing-case'
    )
    expect(res.ok).toBe(false)
    expect(res.code).toBe('NOT_FOUND')
    expect(showSaveDialog).not.toHaveBeenCalled()
  })

  it('forwards export progress to the renderer via event.sender.send', async () => {
    const target = join(userDataPath, 'archive.birdbrain')
    showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: target })
    exportCaseArchive.mockImplementationOnce(
      async (_caseId, _outputPath, onProgress: (step: string, percent: number) => void) => {
        onProgress('Collecting case data...', 10)
      }
    )

    const send = vi.fn()
    const fn = registered.get(IPC_CHANNELS.CASES_EXPORT_ARCHIVE)!
    await fn({ sender: { send } } as unknown as IpcMainInvokeEvent, caseId)

    expect(send).toHaveBeenCalledWith(IPC_CHANNELS.ARCHIVE_PROGRESS, {
      caseId,
      step: 'Collecting case data...',
      percent: 10
    })
  })

  it('returns null when the archive-inspect dialog is cancelled', async () => {
    expect(expectOk(await invoke(IPC_CHANNELS.CASES_INSPECT_ARCHIVE))).toBeNull()
    expect(inspectCaseArchive).not.toHaveBeenCalled()
  })

  it('inspects the chosen archive and returns its report', async () => {
    const archivePath = join(userDataPath, 'archive.birdbrain')
    showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [archivePath] })
    const report = { archivePath, caseName: 'Test Case' }
    inspectCaseArchive.mockReturnValue(report)

    const result = expectOk(await invoke(IPC_CHANNELS.CASES_INSPECT_ARCHIVE))
    expect(inspectCaseArchive).toHaveBeenCalledWith(archivePath)
    expect(result).toBe(report)
  })

  it('imports an archive and returns the new case id', async () => {
    const archivePath = join(userDataPath, 'archive.birdbrain')
    importCaseArchive.mockResolvedValue({ newCaseId: 'new-case-id', report: {} })

    const result = expectOk<{ newCaseId: string }>(
      await invoke(IPC_CHANNELS.CASES_IMPORT_ARCHIVE, archivePath, false)
    )
    expect(result).toEqual({ newCaseId: 'new-case-id' })
    expect(importCaseArchive).toHaveBeenCalledWith(
      archivePath,
      { overrideTamper: false },
      expect.any(Function)
    )
  })

  it('forwards import progress to the renderer via event.sender.send', async () => {
    const archivePath = join(userDataPath, 'archive.birdbrain')
    importCaseArchive.mockImplementationOnce(
      async (_archivePath, _opts, onProgress: (step: string, percent: number) => void) => {
        onProgress('Verifying archive...', 5)
        return { newCaseId: 'new-case-id', report: {} }
      }
    )

    const send = vi.fn()
    const fn = registered.get(IPC_CHANNELS.CASES_IMPORT_ARCHIVE)!
    await fn({ sender: { send } } as unknown as IpcMainInvokeEvent, archivePath, true)

    expect(send).toHaveBeenCalledWith(IPC_CHANNELS.ARCHIVE_PROGRESS, {
      step: 'Verifying archive...',
      percent: 5
    })
  })
})

describe('ipcHandlers — AI analysis', () => {
  it('fails when no API key is configured', async () => {
    const res = await invoke<{ ok: boolean; error?: string }>(IPC_CHANNELS.AI_ANALYZE, {
      captureId,
      caseId,
      model: 'gpt'
    })
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/API key/i)
  })

  it('analyzes, saves and reads analysis when a key is present', async () => {
    settings.updateSettings({ openRouterApiKey: 'sk-test' })
    analyzeCapture.mockResolvedValue({ summary: 'done' })
    const out = expectOk<{ summary: string }>(
      await invoke(IPC_CHANNELS.AI_ANALYZE, { captureId, caseId, model: 'gpt' })
    )
    expect(out.summary).toBe('done')
    expect(analyzeCapture).toHaveBeenCalled()

    expectOk(await invoke(IPC_CHANNELS.AI_SAVE_ANALYSIS, { captureId, summary: 'x' }))
    expect(saveAnalysis).toHaveBeenCalled()

    getAnalysis.mockReturnValue({ summary: 'stored' })
    const got = expectOk<{ summary: string }>(
      await invoke(IPC_CHANNELS.AI_GET_ANALYSIS, { captureId })
    )
    expect(got.summary).toBe('stored')
  })

  it('wraps analysis errors as a structured failure', async () => {
    settings.updateSettings({ openRouterApiKey: 'sk-test' })
    analyzeCapture.mockRejectedValue(new Error('upstream 500'))
    const res = await invoke<{ ok: boolean; error?: string }>(IPC_CHANNELS.AI_ANALYZE, {
      captureId,
      caseId,
      model: 'gpt'
    })
    expect(res.ok).toBe(false)
    expect(res.error).toContain('upstream 500')
  })
})

describe('ipcHandlers — extracted data', () => {
  it('lists categories, subcategories, items and counts, and reprocesses', async () => {
    extractedDataRepo.insertExtractedData(captureId, caseId, 'https://example.com', [
      { category: 'ioc', subcategory: 'email', value: 'a@b.com' }
    ])
    const categories = expectOk<unknown[]>(
      await invoke(IPC_CHANNELS.EXTRACTED_DATA_CATEGORIES, caseId)
    )
    expect(categories.length).toBeGreaterThan(0)
    expect(
      expectOk(await invoke(IPC_CHANNELS.EXTRACTED_DATA_SUBCATEGORIES, caseId, 'ioc'))
    ).toBeDefined()
    expect(
      expectOk(await invoke(IPC_CHANNELS.EXTRACTED_DATA_ITEMS, caseId, 'ioc', 'email'))
    ).toBeDefined()
    expect(
      expectOk<number>(await invoke(IPC_CHANNELS.EXTRACTED_DATA_COUNT, caseId))
    ).toBeGreaterThan(0)

    const reprocessed = expectOk<{ processed: number }>(
      await invoke(IPC_CHANNELS.EXTRACTED_DATA_REPROCESS, caseId)
    )
    expect(reprocessed.processed).toBeGreaterThanOrEqual(0)
  })

  it('searches extracted data by substring', async () => {
    extractedDataRepo.insertExtractedData(captureId, caseId, 'https://example.com', [
      { category: 'ioc', subcategory: 'email', value: 'foo@gmail.com' }
    ])
    const results = expectOk<Array<{ value: string }>>(
      await invoke(IPC_CHANNELS.EXTRACTED_DATA_SEARCH, caseId, 'gmail')
    )
    expect(results.map((r) => r.value)).toEqual(['foo@gmail.com'])
  })
})

describe('ipcHandlers — extension', () => {
  it('reports a structured failure when the extension dir is absent', async () => {
    const res = await invoke<{ ok: boolean; code?: string }>(IPC_CHANNELS.EXTENSION_PATH)
    // In CI the built extension dir is usually absent → EXT_NOT_FOUND.
    if (!res.ok) {
      expect(res.code).toBe('EXT_NOT_FOUND')
    } else {
      expect(typeof res.data).toBe('string')
    }
  })
})

describe('ipcHandlers — database admin', () => {
  it('reports stats and table rows', async () => {
    const stats = expectOk<{ schemaVersion: number; tables: unknown[] }>(
      await invoke(IPC_CHANNELS.DB_STATS)
    )
    expect(stats.schemaVersion).toBeGreaterThan(0)
    expect(Array.isArray(stats.tables)).toBe(true)

    const rows = expectOk<{ rows: unknown[]; total: number }>(
      await invoke(IPC_CHANNELS.DB_TABLE_ROWS, { table: 'cases', offset: 0, limit: 10 })
    )
    expect(rows.total).toBeGreaterThan(0)
  })

  it('creates, updates and deletes rows through the admin API', async () => {
    const created = expectOk<Record<string, unknown>>(
      await invoke(IPC_CHANNELS.DB_CREATE_ROW, {
        table: 'tags',
        data: { id: 'tag-x', name: 'admin-tag', color: '#abc' }
      })
    )
    expect(created).toBeDefined()

    expectOk(
      await invoke(IPC_CHANNELS.DB_UPDATE_ROW, {
        table: 'tags',
        pk: { id: 'tag-x' },
        data: { name: 'admin-tag-2' }
      })
    )
    expect(
      expectOk<boolean>(
        await invoke(IPC_CHANNELS.DB_DELETE_ROW, { table: 'tags', pk: { id: 'tag-x' } })
      )
    ).toBe(true)
  })

  // #234: Database Admin is a genuine fourth note-write path, so a cross-case
  // anchor rejected there needs the same structured IpcFailure translation as
  // notes:create/notes:update rather than surfacing as a raw rejected promise.
  it('reports a cross-case anchor as a structured failure on db:createRow and db:updateRow', async () => {
    const otherCase = createCase({ name: 'Elsewhere', description: '' })
    const otherCapture = insertCapture({
      caseId: otherCase.id,
      url: 'https://example.com',
      title: 'Elsewhere',
      hash: 'abc123',
      timestamp: new Date().toISOString()
    })
    const anchor = JSON.stringify({ kind: 'capture', captureId: otherCapture.id })

    const createRes = await invoke<{ ok: boolean; code?: string }>(IPC_CHANNELS.DB_CREATE_ROW, {
      table: 'notes',
      data: {
        id: 'admin-anchor-note',
        case_id: caseId,
        title: 'T',
        body: '',
        created_at: '2026-07-25T00:00:00Z',
        updated_at: '2026-07-25T00:00:00Z',
        anchor_json: anchor
      }
    })
    expect(createRes.ok).toBe(false)
    expect(createRes.code).toBe('ANCHOR_CASE_MISMATCH')

    const note = expectOk<Record<string, unknown>>(
      await invoke(IPC_CHANNELS.DB_CREATE_ROW, {
        table: 'notes',
        data: {
          id: 'admin-anchor-note-2',
          case_id: caseId,
          title: 'T',
          body: '',
          created_at: '2026-07-25T00:00:00Z',
          updated_at: '2026-07-25T00:00:00Z'
        }
      })
    )

    const updateRes = await invoke<{ ok: boolean; code?: string }>(IPC_CHANNELS.DB_UPDATE_ROW, {
      table: 'notes',
      pk: { id: note.id as string },
      data: { anchor_json: anchor }
    })
    expect(updateRes.ok).toBe(false)
    expect(updateRes.code).toBe('ANCHOR_CASE_MISMATCH')
  })

  it('runs maintenance: vacuum, rebuild-fts, purge, orphans and export', async () => {
    expectOk(await invoke(IPC_CHANNELS.DB_VACUUM))
    expectOk(await invoke(IPC_CHANNELS.DB_REBUILD_FTS))
    expectOk(await invoke(IPC_CHANNELS.DB_PURGE_ARCHIVED))

    const orphans = expectOk<{ dbOrphans: unknown[]; fileOrphans: unknown[] }>(
      await invoke(IPC_CHANNELS.DB_FIND_ORPHANS)
    )
    expect(orphans.dbOrphans).toBeDefined()
    expectOk(await invoke(IPC_CHANNELS.DB_CLEAN_ORPHANS, orphans))

    // Export cancelled then completed.
    expect(
      expectOk(await invoke(IPC_CHANNELS.DB_EXPORT_TABLE, { table: 'cases', format: 'json' }))
    ).toBeNull()
    const target = join(userDataPath, 'cases.json')
    showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: target })
    const exported = expectOk<{ path: string }>(
      await invoke(IPC_CHANNELS.DB_EXPORT_TABLE, { table: 'cases', format: 'csv' })
    )
    expect(exported.path).toBe(target)
  })

  it('backs up the database via the save dialog and no-ops when cancelled', async () => {
    expect(expectOk(await invoke(IPC_CHANNELS.DB_BACKUP))).toBeNull()
    const target = join(userDataPath, 'backup.db')
    showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: target })
    const backup = expectOk<{ path: string }>(await invoke(IPC_CHANNELS.DB_BACKUP))
    expect(backup.path).toBe(target)
  })

  it('reports not-restored when the restore dialog is cancelled', async () => {
    const res = expectOk<{ restored: boolean }>(await invoke(IPC_CHANNELS.DB_RESTORE))
    expect(res.restored).toBe(false)
  })

  it('lists pre-migration snapshots and restores one over the live database', async () => {
    expect(expectOk<unknown[]>(await invoke(IPC_CHANNELS.DB_SNAPSHOTS))).toEqual([])

    const conn = new Database(dbPath)
    try {
      await createPreMigrationSnapshot(conn, dbPath, LATEST_SCHEMA_VERSION, LATEST_SCHEMA_VERSION)
    } finally {
      conn.close()
    }

    const listed = expectOk<Array<{ fileName: string; fromVersion: number }>>(
      await invoke(IPC_CHANNELS.DB_SNAPSHOTS)
    )
    expect(listed).toHaveLength(1)
    expect(listed[0].fromVersion).toBe(LATEST_SCHEMA_VERSION)
    // The listing carries no filesystem path across the boundary.
    expect(listed[0]).not.toHaveProperty('path')

    // Written after the snapshot was taken, so a restore that actually puts the
    // file back must lose it. Without this every assertion here would hold for
    // a restore that copied nothing.
    const afterSnapshot = expectOk<{ id: string }>(
      await invoke(IPC_CHANNELS.CASES_CREATE, { name: 'Recorded after the snapshot' })
    )

    const restored = expectOk<{ restored: boolean }>(
      await invoke(IPC_CHANNELS.DB_RESTORE_SNAPSHOT, { fileName: listed[0].fileName })
    )
    expect(restored.restored).toBe(true)
    expect(expectOk(await invoke(IPC_CHANNELS.CASES_GET, afterSnapshot.id))).toBeUndefined()
    // The database is open again on the other side of the restore.
    expectOk(await invoke(IPC_CHANNELS.DB_STATS))
    // And the database the restore replaced is still on disk.
    expect(existsSync(`${dbPath}.pre-restore`)).toBe(true)
  })

  it('rejects a snapshot restore for a filename that is not a snapshot', async () => {
    const res = await invoke<{ ok: boolean; code?: string }>(IPC_CHANNELS.DB_RESTORE_SNAPSHOT, {
      fileName: '../birdbrain.db'
    })
    expect(res.ok).toBe(false)
    expect(res.code).toBe('NOT_FOUND')
    // The rejection happens before the connection is closed.
    expectOk(await invoke(IPC_CHANNELS.DB_STATS))
  })
})

describe('archive handlers', () => {
  it('archive:lookup reads the capture URL and returns CDX results', async () => {
    const c = createCase({ name: 'C' })
    const cap = insertCapture({
      caseId: c.id,
      url: 'https://example.com/',
      title: 'Example',
      hash: 'h',
      timestamp: '2020-01-15T12:00:00.000Z',
      format: 'mhtml'
    })
    lookupSnapshots.mockResolvedValueOnce({
      snapshots: [
        {
          timestamp: '2020-01-15T12:00:00.000Z',
          snapshotUrl: 'https://web.archive.org/web/20200115120000/https://example.com/',
          originalUrl: 'https://example.com/',
          statusCode: 200
        }
      ],
      closestIndex: 0,
      checkedAt: '2026-06-30T00:00:00.000Z'
    })
    const handler = registered.get('wayback:lookup')!
    const result = (await handler({} as never, cap.id)) as { ok: boolean; data: unknown }
    expect(lookupSnapshots).toHaveBeenCalledWith('https://example.com/', '2020-01-15T12:00:00.000Z')
    expect(result.ok).toBe(true)
  })

  it('archive:pin then archive:list round-trips a reference', async () => {
    const c = createCase({ name: 'C' })
    const cap = insertCapture({
      caseId: c.id,
      url: 'https://example.com/',
      title: 'Example',
      hash: 'h',
      timestamp: '2020-01-15T12:00:00.000Z',
      format: 'mhtml'
    })
    const snapshot = {
      timestamp: '2020-01-15T12:00:00.000Z',
      snapshotUrl: 'https://web.archive.org/web/20200115120000/https://example.com/',
      originalUrl: 'https://example.com/',
      statusCode: 200
    }
    const pin = registered.get('wayback:pin')!
    const pinned = (await pin({} as never, {
      captureId: cap.id,
      snapshot,
      checkedAt: '2026-06-30T00:00:00.000Z'
    })) as {
      ok: boolean
      data: { id: string }
    }
    expect(pinned.ok).toBe(true)

    const list = registered.get('wayback:list')!
    const refs = expectOk<
      Array<{
        snapshotUrl: string
        checkedAt: string
      }>
    >((await list({} as never, cap.id)) as { ok: boolean; data: unknown })
    expect(refs).toHaveLength(1)
    expect(refs[0].snapshotUrl).toBe(snapshot.snapshotUrl)
    expect(refs[0].checkedAt).toBe('2026-06-30T00:00:00.000Z')

    const unpin = registered.get('wayback:unpin')!
    const removed = (await unpin({} as never, pinned.data.id)) as { ok: boolean; data: boolean }
    expect(removed.ok).toBe(true)
    expect(
      expectOk<unknown[]>((await list({} as never, cap.id)) as { ok: boolean; data: unknown })
    ).toHaveLength(0)
  })

  it('archive:pin rejects a snapshot with a forged snapshotUrl', async () => {
    const c = createCase({ name: 'C' })
    const cap = insertCapture({
      caseId: c.id,
      url: 'https://example.com/',
      title: 'Example',
      hash: 'h',
      timestamp: '2020-01-15T12:00:00.000Z',
      format: 'mhtml'
    })
    const pin = registered.get('wayback:pin')!
    const result = (await pin({} as never, {
      captureId: cap.id,
      // snapshotUrl does not point at web.archive.org — must be rejected.
      snapshot: {
        timestamp: '2020-01-15T12:00:00.000Z',
        snapshotUrl: 'https://evil.example/web/20200115120000/https://example.com/',
        originalUrl: 'https://example.com/',
        statusCode: 200
      },
      checkedAt: '2026-06-30T00:00:00.000Z'
    })) as { ok: boolean; code?: string }
    expect(result.ok).toBe(false)
    expect(result.code).toBe('WAYBACK_INVALID_SNAPSHOT')

    const list = registered.get('wayback:list')!
    expect(
      expectOk<unknown[]>((await list({} as never, cap.id)) as { ok: boolean; data: unknown })
    ).toHaveLength(0)
  })
})

describe('ipcHandlers — recapture', () => {
  it('recapture:enqueue fans urls out to jobs', async () => {
    await invoke(IPC_CHANNELS.RECAPTURE_ENQUEUE, {
      urls: ['https://a.com/', 'https://b.com/'],
      caseId: 'case-1',
      supersedesCaptureId: 'cap-9'
    })
    expect(recaptureService.enqueue).toHaveBeenCalledWith([
      { url: 'https://a.com/', caseId: 'case-1', supersedesCaptureId: 'cap-9' },
      { url: 'https://b.com/', caseId: 'case-1', supersedesCaptureId: 'cap-9' }
    ])
  })

  it('recapture:enqueue rejects malformed payloads without reaching the service', async () => {
    for (const payload of [undefined, {}, { caseId: 'case-1' }, { urls: 'not-an-array' }]) {
      const res = (await invoke(IPC_CHANNELS.RECAPTURE_ENQUEUE, payload)) as {
        ok: boolean
        code?: string
      }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('INVALID_RECAPTURE_PAYLOAD')
    }
    expect(recaptureService.enqueue).not.toHaveBeenCalled()
  })

  it('recapture:queueStatus reads the service status', async () => {
    const status = expectOk(await invoke(IPC_CHANNELS.RECAPTURE_QUEUE_STATUS))
    expect(status).toEqual({ pending: 0, activeUrl: null })
    expect(recaptureService.status).toHaveBeenCalled()
  })
})

describe('ipcHandlers — diagnostics logging', () => {
  // The module-level logger singleton is inert (returns '' and does nothing)
  // until initLogger runs, so this block owns its own init/dispose around the
  // real logger rather than mocking it — the point of these tests is that the
  // handler's re-validation actually reaches disk correctly.
  beforeEach(() => {
    initLogger(userDataPath, 'renderer-test-session')
  })

  afterEach(() => {
    disposeLogger()
  })

  it('records a valid renderer entry under source "renderer" and returns its correlation id', async () => {
    const id = expectOk<string>(
      await invoke(IPC_CHANNELS.DIAGNOSTICS_LOG, {
        level: 'error',
        code: 'query.failed',
        context: { domain: 'cases' }
      })
    )
    expect(id).toMatch(/^[0-9a-f]{16}$/)

    flushLogger()
    const [entry] = readRecentEntries(1)
    expect(entry.source).toBe('renderer')
    expect(entry.level).toBe('error')
    expect(entry.code).toBe('query.failed')
    expect(entry.context).toEqual({ domain: 'cases' })
    expect(entry.id).toBe(id)
  })

  it('clamps an unrecognised level to info', async () => {
    await invoke(IPC_CHANNELS.DIAGNOSTICS_LOG, { level: 'debug', code: 'query.failed' })
    flushLogger()
    expect(readRecentEntries(1)[0].level).toBe('info')
  })

  it('drops the entry when the code is not a recognised LogCode', async () => {
    const id = expectOk<string>(
      await invoke(IPC_CHANNELS.DIAGNOSTICS_LOG, { level: 'error', code: 'not.a.real.code' })
    )
    expect(id).toBe('')
    flushLogger()
    expect(readRecentEntries(1)).toEqual([])
  })

  it('drops the entry when the payload is missing entirely', async () => {
    const id = expectOk<string>(await invoke(IPC_CHANNELS.DIAGNOSTICS_LOG, undefined))
    expect(id).toBe('')
  })

  it('re-validates context per-key, dropping a case name sent under caseId', async () => {
    // 'OperationBlackbird' passes the generic ident() rule but fails caseId's
    // uuid format — the exact leak this handler exists to close (see
    // logSafe.test.ts for context()'s own dev/packaged behaviour). In this
    // dev-mode test environment (electron.app.isPackaged is mocked false
    // above), logSafe's context() throws on that rejection, and the handler
    // must catch it and drop the WHOLE context rather than propagate the
    // throw or silently coerce the value.
    await invoke(IPC_CHANNELS.DIAGNOSTICS_LOG, {
      level: 'info',
      code: 'query.failed',
      context: { caseId: 'OperationBlackbird' }
    })
    flushLogger()
    // The offending key is dropped, not coerced or passed through — the
    // resulting context is empty rather than containing a case name.
    expect(readRecentEntries(1)[0].context).toEqual({})
  })

  it('records a validated error name, never a raw string, for a recognised ERROR_NAMES member', async () => {
    await invoke(IPC_CHANNELS.DIAGNOSTICS_LOG, {
      level: 'error',
      code: 'query.failed',
      error: 'TypeError'
    })
    flushLogger()
    expect(readRecentEntries(1)[0].error).toEqual({ name: 'TypeError', code: null, stack: null })
  })

  it('maps an unrecognised error name to UnknownError rather than passing it through', async () => {
    await invoke(IPC_CHANNELS.DIAGNOSTICS_LOG, {
      level: 'error',
      code: 'query.failed',
      error: 'CaseNameLookingError'
    })
    flushLogger()
    expect(readRecentEntries(1)[0].error?.name).toBe('UnknownError')
  })

  it('omits the error field when no error is given', async () => {
    await invoke(IPC_CHANNELS.DIAGNOSTICS_LOG, { level: 'info', code: 'query.failed' })
    flushLogger()
    expect(readRecentEntries(1)[0].error).toBeUndefined()
  })

  it('diagnostics:recent reads back the tail of the durable log', async () => {
    await invoke(IPC_CHANNELS.DIAGNOSTICS_LOG, { level: 'info', code: 'query.failed' })
    await invoke(IPC_CHANNELS.DIAGNOSTICS_LOG, { level: 'info', code: 'mutation.failed' })
    const entries = expectOk<LogEntry[]>(await invoke(IPC_CHANNELS.DIAGNOSTICS_RECENT, 50))
    expect(entries).toHaveLength(2)
  })

  it('diagnostics:recent clamps an out-of-range or non-numeric limit to the default', async () => {
    for (let i = 0; i < 3; i++) {
      await invoke(IPC_CHANNELS.DIAGNOSTICS_LOG, { level: 'info', code: 'query.failed' })
    }
    const viaNegativeLimit = expectOk<LogEntry[]>(await invoke(IPC_CHANNELS.DIAGNOSTICS_RECENT, -5))
    expect(viaNegativeLimit).toHaveLength(3)
    const viaStringLimit = expectOk<LogEntry[]>(
      await invoke(IPC_CHANNELS.DIAGNOSTICS_RECENT, 'not-a-number')
    )
    expect(viaStringLimit).toHaveLength(3)
  })

  it('diagnostics:revealLog reveals the current log file via the shell', async () => {
    await invoke(IPC_CHANNELS.DIAGNOSTICS_LOG, { level: 'info', code: 'query.failed' })
    expectOk(await invoke(IPC_CHANNELS.DIAGNOSTICS_REVEAL_LOG))
    expect(showItemInFolder).toHaveBeenCalledWith(getLogPath())
  })

  it('diagnostics:lastSession reports null when no unclean session is on record', async () => {
    const result = expectOk<SessionRecord | null>(
      await invoke(IPC_CHANNELS.DIAGNOSTICS_LAST_SESSION)
    )
    expect(result).toBeNull()
  })

  it('diagnostics:lastSession surfaces an unclean prior session recorded in the log dir', async () => {
    // The log dir is created lazily on first flush, not by initLogger itself —
    // write and flush an entry first so it exists to hold sessions.json.
    await invoke(IPC_CHANNELS.DIAGNOSTICS_LOG, { level: 'info', code: 'query.failed' })
    flushLogger()

    const record = {
      sessionId: 'aaaa1111-bbbb-2222-cccc-333344445555',
      startedAt: '2026-01-01T00:00:00.000Z',
      endedAt: null,
      version: '1.0.0',
      platform: 'win32',
      installFormat: 'nsis',
      cleanExit: false
    }
    writeFileSync(join(getLogDir(), 'sessions.json'), JSON.stringify([record]))

    const result = expectOk<{ sessionId: string } | null>(
      await invoke(IPC_CHANNELS.DIAGNOSTICS_LAST_SESSION)
    )
    expect(result?.sessionId).toBe(record.sessionId)
  })
})

describe('ipcHandlers — diagnostics create report', () => {
  // Reuses the real logger/db/installation-id services already initialised in
  // the outer beforeEach, the same way the diagnostics-logging block above
  // does — the point of this test is that the handler actually reaches disk.
  beforeEach(() => {
    initLogger(userDataPath, 'report-test-session')
  })

  afterEach(() => {
    disposeLogger()
  })

  it('writes the bundle to the chosen path, reveals it, and returns that path', async () => {
    const target = join(userDataPath, 'report.zip')
    showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: target })

    const result = expectOk<BugReportResult | null>(
      await invoke(IPC_CHANNELS.DIAGNOSTICS_CREATE_REPORT, {
        whatYouDid: 'Captured a page',
        whatYouExpected: 'It saves',
        whatHappened: 'Nothing happened'
      })
    )

    expect(result?.path).toBe(target)
    expect(existsSync(target)).toBe(true)
    expect(showItemInFolder).toHaveBeenCalledWith(target)
  })

  it('returns null and writes nothing when the save dialog is cancelled', async () => {
    showSaveDialog.mockResolvedValueOnce({ canceled: true, filePath: undefined })

    const result = expectOk<BugReportResult | null>(
      await invoke(IPC_CHANNELS.DIAGNOSTICS_CREATE_REPORT, {
        whatYouDid: 'x',
        whatYouExpected: 'y',
        whatHappened: 'z'
      })
    )

    expect(result).toBeNull()
    expect(showItemInFolder).not.toHaveBeenCalled()
  })
})
