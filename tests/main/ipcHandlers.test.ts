import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from 'vitest'
import type { MockedObject } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  truncateSync,
  unlinkSync,
  writeFileSync
} from 'fs'
import { join } from 'path'
import { readStoredZip } from '@main/services/zipRead'
import { tmpdir } from 'os'
import { pathToFileURL } from 'url'
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

// The PDF renderer needs a real BrowserWindow, so only the render call is
// replaced — the module itself loads for real, keeping buildPdfMetadataRows
// available to assert what the cover would say (#509).
const renderCapturePdf = vi.fn()
vi.mock('@main/services/pdfExport', async (importActual) => {
  const actual = await importActual<typeof import('@main/services/pdfExport')>()
  return {
    ...actual,
    renderCapturePdf: (...a: unknown[]) => renderCapturePdf(...a)
  }
})

const lookupSnapshots = vi.fn()
vi.mock('@main/services/waybackMachine', async (importActual) => {
  const actual = await importActual<typeof import('@main/services/waybackMachine')>()
  return {
    ...actual,
    lookupSnapshots: (...a: unknown[]) => lookupSnapshots(...a)
  }
})

// The persona session service needs Electron's `session` and `safeStorage`,
// neither of which the mock above provides; the handlers' routing and the
// dialog handshake are what this file checks, so the service is a stub.
const importCookies = vi.fn()
const clearPersona = vi.fn()
const getPersonaStorageState = vi.fn()
const clearOrphanedPartitions = vi.fn()
vi.mock('@main/services/persona/personaSessions', async (importActual) => {
  const actual = await importActual<typeof import('@main/services/persona/personaSessions')>()
  return {
    ...actual,
    importCookies: (...a: unknown[]) => importCookies(...a),
    clearPersona: (...a: unknown[]) => clearPersona(...a),
    getPersonaStorageState: (...a: unknown[]) => getPersonaStorageState(...a),
    clearOrphanedPartitions: (...a: unknown[]) => clearOrphanedPartitions(...a)
  }
})

// --- Real services ----------------------------------------------------------
import { IPC_CHANNELS } from '@shared/ipc'
import { MAX_BATCH_CAPTURE_IDS } from '@shared/constants'
import type { BatchCountResult, BatchDeleteResult, SelfTestResult } from '@shared/ipc'
import { registerIpcHandlers } from '@main/ipcHandlers'
import type {
  BugReportResult,
  Capture,
  Case,
  LogEntry,
  RecentActivityEvent,
  SessionRecord,
  TrustedTime
} from '@shared/types'
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
import type { RecaptureService } from '@main/services/recapture'
import type { UpdaterService } from '@main/services/updater'
import {
  CAPTURE_SERVER_PORT,
  getCaptureServerPort,
  startCaptureServer,
  stopCaptureServer
} from '@main/services/captureServer'
import { appendManifestEntry, initManifest } from '@main/services/manifest'
import { buildPdfMetadataRows } from '@main/services/pdfExport'
import type { TrustedTimeResult } from '@shared/verify/trustedTime'
import { buildSyntheticToken } from '../helpers/timestampFixtures'
import * as personaRepo from '@main/services/db/personaRepo'
import { UnsupportedCookieFileError } from '@main/services/persona/cookieFiles'
import type { Persona, PersonaImportResult } from '@shared/types'

const fakeEvent = {} as IpcMainInvokeEvent

// Invoke a registered handler by channel. Returns the raw handler result;
// `handle()`-wrapped channels return `{ ok, data }`, raw ones return the value.
async function invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T> {
  const fn = registered.get(channel)
  if (!fn) throw new Error(`No handler registered for ${channel}`)
  return (await fn(fakeEvent, ...args)) as T
}

// Unwrap a `handle()` IpcResult, asserting success. `data?: T` rather than
// `data?: unknown` keeps the annotation tied to the result it is read from: a
// caller whose `T` disagrees with the value's shape is a compile error here,
// not a silent cast at the return.
function expectOk<T = unknown>(res: { ok: boolean; data?: T; error?: string }): T {
  expect(res.ok).toBe(true)
  return res.data as T
}

let sessionService: SessionService
let dbPath = ''
let caseId = ''
let captureId = ''
let recaptureService: MockedObject<RecaptureService>
let updaterService: MockedObject<UpdaterService>

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

  it('clears the session when the deleted demo case was the active one', async () => {
    const demo = expectOk<Case>(await invoke(IPC_CHANNELS.CASES_CREATE, { name: 'Demo' }))
    caseRepo.setCaseDemo(demo.id, true)
    expectOk(await invoke(IPC_CHANNELS.SESSION_ACTIVATE_CASE, demo.id))
    expectOk(await invoke(IPC_CHANNELS.SESSION_START))

    expect(expectOk<boolean>(await invoke(IPC_CHANNELS.CASES_DELETE_DEMO, demo.id))).toBe(true)

    // Recording left on against a deleted row is the harm: the capture server
    // reads the same service instance, and every automatic capture into it
    // would fail on the captures.case_id foreign key.
    expect(sessionService.snapshot()).toMatchObject({ activeCaseId: null, sessionActive: false })
  })

  it('leaves a session on another case alone when the demo case is deleted', async () => {
    const demo = expectOk<Case>(await invoke(IPC_CHANNELS.CASES_CREATE, { name: 'Demo' }))
    caseRepo.setCaseDemo(demo.id, true)
    expectOk(await invoke(IPC_CHANNELS.SESSION_ACTIVATE_CASE, caseId))

    expectOk(await invoke(IPC_CHANNELS.CASES_DELETE_DEMO, demo.id))

    expect(sessionService.snapshot().activeCaseId).toBe(caseId)
  })

  it('refuses a case that is not the demo case, session included', async () => {
    expectOk(await invoke(IPC_CHANNELS.SESSION_ACTIVATE_CASE, caseId))

    expect(expectOk<boolean>(await invoke(IPC_CHANNELS.CASES_DELETE_DEMO, caseId))).toBe(false)

    expect(sessionService.snapshot().activeCaseId).toBe(caseId)
    expect(expectOk<Case>(await invoke(IPC_CHANNELS.CASES_GET, caseId))).toBeDefined()
  })

  it('serves the cross-case activity feed and honours the limit argument', async () => {
    const note = expectOk<{ id: string }>(
      await invoke(IPC_CHANNELS.NOTES_CREATE, { caseId, title: 'Feed note' })
    )

    const feed = async (limit?: number) =>
      expectOk<RecentActivityEvent[]>(await invoke(IPC_CHANNELS.CASES_RECENT_ACTIVITY, limit))

    const events = await feed()
    expect(events.some((e) => e.kind === 'note' && e.noteId === note.id)).toBe(true)
    expect(await feed(1)).toHaveLength(1)
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

  // #906. The legacy viewer is a <webview> that loads the artefact by file URL, so
  // this channel answers for the same file captures:getContent reads — resolved
  // through artifactPaths, not through the capture row's htmlPath column, which
  // this seed capture does not set.
  it('returns the pre-v11 html artefact as a file url', async () => {
    const url = expectOk<string | null>(await invoke(IPC_CHANNELS.CAPTURES_GET_HTML_URL, captureId))
    const expected = pathToFileURL(
      defaultCaptureStore.artifactPaths(caseId, captureId, 'html').abs
    ).toString()
    expect(url).toBe(expected)
  })

  it('returns null html url for an unknown capture and for one with no file on disk', async () => {
    expect(expectOk(await invoke(IPC_CHANNELS.CAPTURES_GET_HTML_URL, 'missing'))).toBeNull()
    const abs = defaultCaptureStore.artifactPaths(caseId, captureId, 'html').abs
    const bytes = readFileSync(abs)
    unlinkSync(abs)
    try {
      expect(expectOk(await invoke(IPC_CHANNELS.CAPTURES_GET_HTML_URL, captureId))).toBeNull()
    } finally {
      writeFileSync(abs, bytes)
    }
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

  // #509: the PDF cover's trusted-time row must come from the case manifest, not
  // from the rebuildable captures.trustedTimeStatus mirror. Both directions of
  // disagreement are pinned, and the assertion runs the real row builder so the
  // wiring and the printed wording are checked together.
  describe('PDF cover trusted time', () => {
    const CONTENT_HASH = 'b'.repeat(64)

    // Seeds an mhtml capture with its artifact on disk, sets the DB mirror to
    // `mirror`, exports the PDF, and returns the exported capture's id together
    // with what the cover would print.
    async function exportPdfCover(
      mirror: TrustedTime
    ): Promise<{ id: string; rows: [string, string][] }> {
      const cap = seedCapture({ format: 'mhtml', hash: CONTENT_HASH })
      writeFileSync(defaultCaptureStore.artifactPaths(caseId, cap.id, 'mhtml').abs, 'mhtml-bytes')
      captureRepo.setCaptureTrustedTime(cap.id, mirror)
      renderCapturePdf.mockResolvedValueOnce(Buffer.from('%PDF-1.4'))
      showSaveDialog.mockResolvedValueOnce({
        canceled: false,
        filePath: join(userDataPath, `${mirror}.pdf`)
      })

      expectOk(await invoke(IPC_CHANNELS.CAPTURES_DOWNLOAD_PDF, cap.id))

      const [capture, , trustedTime] = renderCapturePdf.mock.calls.at(-1) as [
        Capture,
        string,
        TrustedTimeResult
      ]
      expect(capture.trustedTimeStatus).toBe(mirror)
      return { id: cap.id, rows: buildPdfMetadataRows(capture, trustedTime) }
    }

    // Appends a timestamp entry for CONTENT_HASH, so the manifest answers
    // 'rfc3161' for it.
    function stampContentHashInManifest(): void {
      appendManifestEntry(join(storage.getStorageRoot(), caseId), {
        type: 'timestamp',
        caseId,
        captureContentHash: CONTENT_HASH,
        timestamp: '2026-04-05T12:00:05.000Z',
        tsaToken: buildSyntheticToken({
          contentHash: CONTENT_HASH,
          genTime: new Date('2026-04-05T12:00:04.000Z'),
          tsaDnsName: 'tsa.example.net'
        }).toString('base64'),
        operatorId: 'op-1',
        operatorName: 'Operator One',
        toolVersion: '1.2.3'
      })
    }

    function trustedTimeRow(rows: [string, string][]): string | undefined {
      return rows.find(([label]) => label === 'Trusted time')?.[1]
    }

    it('prints the manifest floor when the mirror claims a token the manifest lacks', async () => {
      // Mirror says rfc3161; the manifest holds no entry for this hash at all.
      const { rows } = await exportPdfCover('rfc3161')

      expect(trustedTimeRow(rows)).toBe(
        'Local clock only: no RFC 3161 token is retained for this capture'
      )
    })

    it('prints the retained token when the mirror understates the manifest', async () => {
      stampContentHashInManifest()

      const { rows } = await exportPdfCover('none')

      expect(trustedTimeRow(rows)).toContain('RFC 3161 token retained')
      expect(trustedTimeRow(rows)).toContain('tsa.example.net')
      expect(trustedTimeRow(rows)).toContain('2026-04-05T12:00:04.000Z')
    })

    // #520: the other half of the constraint. Reading the axis from the manifest
    // is not enough — an export is a read path, so it must also leave the mirror
    // alone. reconcileCaptureTrustedTime resolves the same value but writes it
    // through (trustedTime.ts), and the cover assertions above cannot see that:
    // they read the Capture row the handler loaded before any write. These
    // re-read the row from the database afterwards, so swapping the handler to
    // reconcileCaptureTrustedTime fails here in both directions.
    it('leaves the mirror unchanged when it overstates the manifest', async () => {
      const { id } = await exportPdfCover('rfc3161')

      // The manifest holds no entry for CONTENT_HASH, so the export resolved
      // 'none'; a write-through would have demoted the row to it.
      expect(captureRepo.getCapture(id)?.trustedTimeStatus).toBe('rfc3161')
    })

    it('leaves the mirror unchanged when it understates the manifest', async () => {
      stampContentHashInManifest()

      const { id } = await exportPdfCover('none')

      // The export resolved 'rfc3161' from the manifest; a write-through would
      // have promoted the row to it.
      expect(captureRepo.getCapture(id)?.trustedTimeStatus).toBe('none')
    })
  })

  // The Exhibit read paths (#1147). Registration is already asserted above;
  // this is the round trip through the handlers, so a channel wired to the
  // wrong service or argument order fails here rather than in the renderer.
  it('answers the exhibit inventory, manifest snapshot and exhibit verify', async () => {
    const inventory = expectOk<{ caseId: string; rows: Array<{ rowType: string; id: string }> }>(
      await invoke(IPC_CHANNELS.EXHIBITS_INVENTORY, caseId)
    )
    expect(inventory.caseId).toBe(caseId)
    expect(inventory.rows.map((row) => row.id)).toContain(captureId)

    const snapshot = expectOk<{ caseId: string; signers: unknown[] }>(
      await invoke(IPC_CHANNELS.MANIFEST_SNAPSHOT, caseId)
    )
    expect(snapshot.caseId).toBe(caseId)
    expect(Array.isArray(snapshot.signers)).toBe(true)

    const verified = expectOk<{ kind: string; status: string }>(
      await invoke(IPC_CHANNELS.EXHIBITS_VERIFY, caseId, captureId)
    )
    expect(verified.kind).toBe('capture')
    expect(verified.status).toBeDefined()
  })

  // The Staging Pool channels (#1148). The dialog lives in the upload
  // handler, so a cancel is an empty list; commit and discard take an id list
  // that is shape-checked before anything reaches the pool.
  it('uploads, commits and discards pooled files, and treats a cancelled dialog as empty', async () => {
    expect(expectOk(await invoke(IPC_CHANNELS.STAGING_UPLOAD, caseId))).toEqual([])

    const source = join(userDataPath, 'bundle.zip')
    writeFileSync(source, Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('z')]))
    showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [source] })
    const staged = expectOk<Array<{ id: string; kind: string; name: string }>>(
      await invoke(IPC_CHANNELS.STAGING_UPLOAD, caseId)
    )
    expect(staged).toHaveLength(1)
    expect(staged[0]).toMatchObject({ kind: 'attachment', name: 'bundle.zip' })

    const bad = (await invoke(IPC_CHANNELS.STAGING_COMMIT, caseId, 'not-a-list')) as {
      ok: boolean
      code?: string
    }
    expect(bad.ok).toBe(false)
    expect(bad.code).toBe('INVALID_BATCH_PAYLOAD')

    const committed = expectOk<{ outcomes: Array<{ status: string }> }>(
      await invoke(IPC_CHANNELS.STAGING_COMMIT, caseId, [staged[0].id])
    )
    expect(committed.outcomes[0].status).toBe('committed')

    showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [source] })
    const [again] = expectOk<Array<{ id: string }>>(
      await invoke(IPC_CHANNELS.STAGING_UPLOAD, caseId)
    )
    const discarded = expectOk<{ discarded: string[] }>(
      await invoke(IPC_CHANNELS.STAGING_DISCARD, caseId, [again.id])
    )
    expect(discarded).toEqual({ discarded: [again.id] })
  })

  it('verifies a capture and deletes it', async () => {
    const verification = expectOk<{ status: string }>(
      await invoke(IPC_CHANNELS.CAPTURES_VERIFY, captureId)
    )
    expect(verification.status).toBeDefined()

    expectOk(await invoke(IPC_CHANNELS.CAPTURES_DELETE, captureId))
    expect(expectOk<Capture[]>(await invoke(IPC_CHANNELS.CAPTURES_LIST, caseId))).toHaveLength(0)
  })

  // #462. This test used to assert that nothing answers CAPTURE_SERVER_PORT,
  // which is not a property the suite controls: no test file binds 19845 (the
  // three that start the server allocate from 19846, 19960 and 19990), so the
  // binder was always a process outside the suite — on WSL2, a Birdbrain
  // running on the Windows host, forwarded onto the distro's 127.0.0.1 and
  // invisible to `ss` inside it. It also cost two 2s AbortSignal waits, ~4041ms
  // against the 5s default, because that loopback drops SYNs to unbound ports
  // rather than refusing them. Both modes are gone: the handlers resolve the
  // port from the live listener and never probe when there is none.
  it('reports failure for the http/pipeline self-tests when the server is down', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    try {
      const http = expectOk<SelfTestResult>(await invoke(IPC_CHANNELS.CAPTURES_TEST_HTTP))
      expect(http.success).toBe(false)
      expect(http.error).toBe('Capture server is not running')

      const pipeline = expectOk<SelfTestResult>(await invoke(IPC_CHANNELS.CAPTURES_TEST_PIPELINE))
      expect(pipeline.success).toBe(false)
      expect(pipeline.error).toBe('Capture server is not running')

      // The load-bearing assertion: no request left the process, so no listener
      // anywhere on the machine can turn this into a pass or a timeout.
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('runs the self-tests against the port the server actually bound', async () => {
    const selectorLifecycle = createSelectorLifecycle({ emitRematched: vi.fn() })
    const captureLifecycle = createCaptureLifecycle({ selectorLifecycle })
    // Port 0 lets the OS pick, so this test owns its port and contends for
    // nothing — least of all the production constant.
    await startCaptureServer({ selectorLifecycle, captureLifecycle, sessionService }, 0)
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    // Matched by URL, not by call index: the ingest the pipeline test performs
    // may grow its own outbound requests, and a positional [0]/[1] would then
    // fail on the shift rather than on the port.
    const requestedUrls = (): string[] => fetchSpy.mock.calls.map(([input]) => String(input))
    try {
      const port = getCaptureServerPort()
      expect(port).not.toBeNull()
      expect(port).not.toBe(CAPTURE_SERVER_PORT)

      const http = expectOk<SelfTestResult>(await invoke(IPC_CHANNELS.CAPTURES_TEST_HTTP))
      expect(http.success).toBe(true)
      expect(requestedUrls()).toContain(`http://127.0.0.1:${port}/api/status`)

      settings.updateSettings({ operatorName: 'Test Operator' })
      const pipeline = expectOk<SelfTestResult>(await invoke(IPC_CHANNELS.CAPTURES_TEST_PIPELINE))
      expect(pipeline.success).toBe(true)
      expect(requestedUrls()).toContain(`http://127.0.0.1:${port}/api/captures/test`)
      // The regression this file exists to catch: nothing was aimed at the
      // constant, whoever else answers there.
      expect(requestedUrls().filter((u) => u.includes(`:${CAPTURE_SERVER_PORT}/`))).toEqual([])
    } finally {
      fetchSpy.mockRestore()
      await stopCaptureServer()
    }
    expect(getCaptureServerPort()).toBeNull()
    // Stopping again is a no-op rather than a throw, and leaves the port unset.
    await stopCaptureServer()
    expect(getCaptureServerPort()).toBeNull()
  })
})

describe('ipcHandlers — batch operations (#394)', () => {
  let otherCaseId = ''
  let foreignId = ''

  beforeEach(() => {
    otherCaseId = caseRepo.createCase({ name: 'Other' }).id
    storage.ensureCaseDir(otherCaseId)
    foreignId = captureRepo.insertCapture({
      caseId: otherCaseId,
      url: 'https://other.example.com',
      title: 'Foreign',
      hash: 'foreign',
      timestamp: '2026-04-05T12:00:00.000Z'
    }).id
  })

  it('captures:deleteMany delegates to the lifecycle and returns the batch result', async () => {
    const second = seedCapture({ url: 'https://example.com/2' }).id
    const result = expectOk<BatchDeleteResult>(
      await invoke(IPC_CHANNELS.CAPTURES_DELETE_MANY, {
        caseId,
        captureIds: [captureId, 'ghost', second]
      })
    )
    // Seeded captures are legacy html rows: deleted without a manifest entry.
    expect(result.outcomes.map((o) => o.status)).toEqual([
      'deleted_unmanifested',
      'rejected',
      'deleted_unmanifested'
    ])
    expect(result.deletedIds).toEqual([captureId, second])
    expect(result.manifest.committedEntries).toBe(0)
    expect(expectOk<Capture[]>(await invoke(IPC_CHANNELS.CAPTURES_LIST, caseId))).toHaveLength(0)
  })

  it('captures:deleteMany fails the whole call with BATCH_CROSS_CASE, writing nothing', async () => {
    const res = (await invoke(IPC_CHANNELS.CAPTURES_DELETE_MANY, {
      caseId,
      captureIds: [captureId, foreignId]
    })) as { ok: boolean; code?: string; error?: string }
    expect(res.ok).toBe(false)
    expect(res.code).toBe('BATCH_CROSS_CASE')
    expect(res.error).toContain(foreignId)
    expect(captureRepo.getCapture(captureId)).toBeDefined()
    expect(captureRepo.getCapture(foreignId)).toBeDefined()
  })

  it('captures:setFavoriteMany applies to the same-case snapshot and reports affected', async () => {
    const second = seedCapture({ url: 'https://example.com/2' }).id
    const set = expectOk<BatchCountResult>(
      await invoke(IPC_CHANNELS.CAPTURES_SET_FAVORITE_MANY, {
        caseId,
        captureIds: [captureId, second, 'ghost'],
        favorite: true
      })
    )
    expect(set.affected).toBe(2)
    expect(expectOk<string[]>(await invoke(IPC_CHANNELS.CAPTURES_LIST_FAVORITES, caseId))).toEqual(
      expect.arrayContaining([captureId, second])
    )
    const unset = expectOk<BatchCountResult>(
      await invoke(IPC_CHANNELS.CAPTURES_SET_FAVORITE_MANY, {
        caseId,
        captureIds: [captureId],
        favorite: false
      })
    )
    expect(unset.affected).toBe(1)
    expect(expectOk<string[]>(await invoke(IPC_CHANNELS.CAPTURES_LIST_FAVORITES, caseId))).toEqual([
      second
    ])
  })

  it('captures:setFavoriteMany rejects cross-case ids before writing', async () => {
    const res = (await invoke(IPC_CHANNELS.CAPTURES_SET_FAVORITE_MANY, {
      caseId,
      captureIds: [captureId, foreignId],
      favorite: true
    })) as { ok: boolean; code?: string }
    expect(res.ok).toBe(false)
    expect(res.code).toBe('BATCH_CROSS_CASE')
    expect(expectOk<string[]>(await invoke(IPC_CHANNELS.CAPTURES_LIST_FAVORITES, caseId))).toEqual(
      []
    )
  })

  it('tags:addToCaptures tags the same-case snapshot in one call', async () => {
    const second = seedCapture({ url: 'https://example.com/2' }).id
    const tag = expectOk<{ id: string }>(await invoke(IPC_CHANNELS.TAGS_CREATE, { name: 'batch' }))
    const res = expectOk<BatchCountResult>(
      await invoke(IPC_CHANNELS.TAGS_ADD_TO_CAPTURES, {
        caseId,
        captureIds: [captureId, second, second, 'ghost'],
        tagId: tag.id
      })
    )
    expect(res.affected).toBe(2)
    for (const id of [captureId, second]) {
      const tags = expectOk<{ id: string }[]>(await invoke(IPC_CHANNELS.TAGS_GET_FOR_CAPTURE, id))
      expect(tags.map((t) => t.id)).toEqual([tag.id])
    }
    const cross = (await invoke(IPC_CHANNELS.TAGS_ADD_TO_CAPTURES, {
      caseId,
      captureIds: [foreignId],
      tagId: tag.id
    })) as { ok: boolean; code?: string }
    expect(cross.code).toBe('BATCH_CROSS_CASE')
  })

  it('tags:removeFromCaptures clears the tag from the same-case snapshot only', async () => {
    const second = seedCapture({ url: 'https://example.com/2' }).id
    const tag = expectOk<{ id: string }>(await invoke(IPC_CHANNELS.TAGS_CREATE, { name: 'batch' }))
    expectOk(
      await invoke(IPC_CHANNELS.TAGS_ADD_TO_CAPTURES, {
        caseId,
        captureIds: [captureId, second],
        tagId: tag.id
      })
    )
    expectOk(
      await invoke(IPC_CHANNELS.TAGS_ADD_TO_CAPTURE, { captureId: foreignId, tagId: tag.id })
    )

    const res = expectOk<BatchCountResult>(
      await invoke(IPC_CHANNELS.TAGS_REMOVE_FROM_CAPTURES, {
        caseId,
        captureIds: [captureId, second, 'ghost'],
        tagId: tag.id
      })
    )
    expect(res.affected).toBe(2)
    for (const id of [captureId, second]) {
      expect(
        expectOk<{ id: string }[]>(await invoke(IPC_CHANNELS.TAGS_GET_FOR_CAPTURE, id))
      ).toEqual([])
    }
    // The other case's capture kept the tag: the guard refuses the call rather
    // than silently narrowing it.
    const cross = (await invoke(IPC_CHANNELS.TAGS_REMOVE_FROM_CAPTURES, {
      caseId,
      captureIds: [foreignId],
      tagId: tag.id
    })) as { ok: boolean; code?: string }
    expect(cross.code).toBe('BATCH_CROSS_CASE')
    expect(
      expectOk<{ id: string }[]>(await invoke(IPC_CHANNELS.TAGS_GET_FOR_CAPTURE, foreignId)).map(
        (t) => t.id
      )
    ).toEqual([tag.id])
  })

  it('tags:countsForCaptures answers for the selection, not the case', async () => {
    const second = seedCapture({ url: 'https://example.com/2' }).id
    const third = seedCapture({ url: 'https://example.com/3' }).id
    const tag = expectOk<{ id: string }>(
      await invoke(IPC_CHANNELS.TAGS_CREATE, { name: 'partial' })
    )
    expectOk(await invoke(IPC_CHANNELS.TAGS_ADD_TO_CAPTURE, { captureId, tagId: tag.id }))

    expect(
      expectOk<Record<string, number>>(
        await invoke(IPC_CHANNELS.TAGS_COUNTS_FOR_CAPTURES, {
          caseId,
          captureIds: [captureId, second, third]
        })
      )
    ).toEqual({ [tag.id]: 1 })
    // A selection carrying nothing gets an empty object, not a zero row.
    expect(
      expectOk<Record<string, number>>(
        await invoke(IPC_CHANNELS.TAGS_COUNTS_FOR_CAPTURES, { caseId, captureIds: [second] })
      )
    ).toEqual({})
    const cross = (await invoke(IPC_CHANNELS.TAGS_COUNTS_FOR_CAPTURES, {
      caseId,
      captureIds: [foreignId]
    })) as { ok: boolean; code?: string }
    expect(cross.code).toBe('BATCH_CROSS_CASE')
  })

  it('recapture:enqueueCaptures fans the same-case snapshot out as self-superseding jobs', async () => {
    const second = seedCapture({ url: 'https://example.com/2' }).id
    expectOk(
      await invoke(IPC_CHANNELS.RECAPTURE_ENQUEUE_CAPTURES, {
        caseId,
        captureIds: [captureId, second, 'ghost']
      })
    )
    expect(recaptureService.enqueue).toHaveBeenCalledTimes(1)
    const jobs = recaptureService.enqueue.mock.calls[0][0] as Array<{
      url: string
      caseId: string
      supersedesCaptureId: string
    }>
    expect(jobs).toHaveLength(2)
    expect(jobs).toEqual(
      expect.arrayContaining([
        { url: 'https://example.com', caseId, supersedesCaptureId: captureId },
        { url: 'https://example.com/2', caseId, supersedesCaptureId: second }
      ])
    )
    const cross = (await invoke(IPC_CHANNELS.RECAPTURE_ENQUEUE_CAPTURES, {
      caseId,
      captureIds: [foreignId]
    })) as { ok: boolean; code?: string }
    expect(cross.code).toBe('BATCH_CROSS_CASE')
    expect(recaptureService.enqueue).toHaveBeenCalledTimes(1)
  })

  it('every batch channel rejects malformed or oversized payloads before any lookup', async () => {
    const bad = [
      undefined,
      null,
      {},
      { caseId },
      { caseId, captureIds: 'x' },
      { caseId, captureIds: [1] },
      // One over the bound: the snapshot query binds a parameter per id.
      { caseId, captureIds: Array.from({ length: MAX_BATCH_CAPTURE_IDS + 1 }, (_, i) => `id${i}`) }
    ]
    for (const channel of [
      IPC_CHANNELS.CAPTURES_DELETE_MANY,
      IPC_CHANNELS.CAPTURES_SET_FAVORITE_MANY,
      IPC_CHANNELS.TAGS_ADD_TO_CAPTURES,
      IPC_CHANNELS.TAGS_REMOVE_FROM_CAPTURES,
      IPC_CHANNELS.TAGS_COUNTS_FOR_CAPTURES,
      IPC_CHANNELS.RECAPTURE_ENQUEUE_CAPTURES
    ]) {
      for (const payload of bad) {
        const res = (await invoke(channel, payload)) as { ok: boolean; code?: string }
        expect(res.ok).toBe(false)
        expect(res.code).toBe('INVALID_BATCH_PAYLOAD')
      }
    }
    // The extra field each metadata channel needs is checked too.
    const fav = (await invoke(IPC_CHANNELS.CAPTURES_SET_FAVORITE_MANY, {
      caseId,
      captureIds: [captureId],
      favorite: 'yes'
    })) as { ok: boolean; code?: string }
    expect(fav.code).toBe('INVALID_BATCH_PAYLOAD')
    for (const channel of [
      IPC_CHANNELS.TAGS_ADD_TO_CAPTURES,
      IPC_CHANNELS.TAGS_REMOVE_FROM_CAPTURES
    ]) {
      const tag = (await invoke(channel, { caseId, captureIds: [captureId] })) as {
        ok: boolean
        code?: string
      }
      expect(tag.code).toBe('INVALID_BATCH_PAYLOAD')
    }
    expect(recaptureService.enqueue).not.toHaveBeenCalled()
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

  // The batch picker's create path (#665). Driven at the boundary because the
  // point of the channel is that `tags:create` throws here: the UNIQUE name
  // constraint is what #811 records, and a picker whose input doubles as its
  // filter will be handed an existing name routinely.
  it('resolves a tag by name, creating one only when there is no match', async () => {
    const made = expectOk<{ id: string; name: string; color?: string }>(
      await invoke(IPC_CHANNELS.TAGS_FIND_OR_CREATE, { name: 'reused', color: '#10b981' })
    )
    expect(made.color).toBe('#10b981')

    const dupe = (await invoke(IPC_CHANNELS.TAGS_CREATE, { name: 'reused' })) as { ok: boolean }
    expect(dupe.ok).toBe(false)

    // Same name, different case, different colour: the existing tag comes
    // back unrepainted rather than a second row being minted.
    const again = expectOk<{ id: string; color?: string }>(
      await invoke(IPC_CHANNELS.TAGS_FIND_OR_CREATE, { name: '  REUSED  ', color: '#ef4444' })
    )
    expect(again.id).toBe(made.id)
    expect(again.color).toBe('#10b981')
    expect(
      expectOk<{ name: string }[]>(await invoke(IPC_CHANNELS.TAGS_LIST)).filter(
        (t) => t.name.toLowerCase() === 'reused'
      )
    ).toHaveLength(1)

    for (const bad of [undefined, null, {}, { name: '' }, { name: '   ' }, { name: 7 }]) {
      const res = (await invoke(IPC_CHANNELS.TAGS_FIND_OR_CREATE, bad)) as {
        ok: boolean
        code?: string
      }
      expect(res.code).toBe('INVALID_TAG_PAYLOAD')
    }

    expectOk(await invoke(IPC_CHANNELS.TAGS_DELETE, made.id))
  })

  // The capture list's tag filter reads through this channel (#918). Driven at
  // the boundary because the renderer writes the result straight into the app
  // store: an argument order swapped here would narrow the list to nothing.
  it('answers which captures carry any of the given tags', async () => {
    const tag = expectOk<{ id: string }>(await invoke(IPC_CHANNELS.TAGS_CREATE, { name: 'filter' }))
    expectOk(await invoke(IPC_CHANNELS.TAGS_ADD_TO_CAPTURE, { captureId, tagId: tag.id }))

    expect(
      expectOk<string[]>(await invoke(IPC_CHANNELS.TAGS_CAPTURES_WITH_ANY_TAG, caseId, [tag.id]))
    ).toEqual([captureId])
    expect(
      expectOk<string[]>(await invoke(IPC_CHANNELS.TAGS_CAPTURES_WITH_ANY_TAG, caseId, []))
    ).toEqual([])

    expectOk(await invoke(IPC_CHANNELS.TAGS_DELETE, tag.id))
  })

  // #391 note-level tags. Driven at the IPC boundary rather than through
  // noteTags directly because both translations live in ipcHandlers.ts: the
  // payload rejection and NoteNotFoundError -> IpcFailure. A renderer that
  // branches on either code is reading this handler, not the service.
  it('applies, reads and removes a note tag, and reports both failure paths', async () => {
    const note = expectOk<{ id: string }>(
      await invoke(IPC_CHANNELS.NOTES_CREATE, { caseId, content: 'wire transfer to Meridian' })
    )

    const applied = expectOk<{ tag: { id: string; name: string }; captureId?: string }>(
      await invoke(IPC_CHANNELS.TAGS_APPLY_TO_NOTE, { noteId: note.id, name: 'wire-transfer' })
    )
    expect(applied.tag.name).toBe('wire-transfer')
    // Unanchored note, so R15's capture half must not have run.
    expect(applied.captureId).toBeUndefined()

    const forNote = expectOk<{ id: string }[]>(
      await invoke(IPC_CHANNELS.TAGS_GET_FOR_NOTE, note.id)
    )
    expect(forNote.map((t) => t.id)).toEqual([applied.tag.id])

    expectOk(
      await invoke(IPC_CHANNELS.TAGS_REMOVE_FROM_NOTE, { noteId: note.id, tagId: applied.tag.id })
    )
    expect(expectOk(await invoke(IPC_CHANNELS.TAGS_GET_FOR_NOTE, note.id))).toEqual([])

    const blank = (await invoke(IPC_CHANNELS.TAGS_APPLY_TO_NOTE, {
      noteId: note.id,
      name: '   '
    })) as { ok: boolean; code?: string }
    expect(blank.ok).toBe(false)
    expect(blank.code).toBe('INVALID_NOTE_TAG_PAYLOAD')

    const missing = (await invoke(IPC_CHANNELS.TAGS_APPLY_TO_NOTE, {
      noteId: 'no-such-note',
      name: 'x'
    })) as { ok: boolean; code?: string }
    expect(missing.ok).toBe(false)
    expect(missing.code).toBe('NOTE_NOT_FOUND')
  })

  // The other half of R15, and the reason the result carries captureId at all:
  // the renderer's confirmation says which capture was tagged, so the handler
  // has to report it rather than let the caller assume.
  it('also tags the anchored capture and names it in the result', async () => {
    const note = expectOk<{ id: string }>(
      await invoke(IPC_CHANNELS.NOTES_CREATE, {
        caseId,
        content: 'on this page',
        anchor: JSON.stringify({ kind: 'capture', captureId })
      })
    )

    const applied = expectOk<{ tag: { id: string }; captureId?: string }>(
      await invoke(IPC_CHANNELS.TAGS_APPLY_TO_NOTE, { noteId: note.id, name: 'anchored' })
    )
    expect(applied.captureId).toBe(captureId)

    const forCapture = expectOk<{ id: string }[]>(
      await invoke(IPC_CHANNELS.TAGS_GET_FOR_CAPTURE, captureId)
    )
    expect(forCapture.some((t) => t.id === applied.tag.id)).toBe(true)
  })

  // #828 merge. Driven at the IPC boundary because the three refusals live in
  // the handler — shape, self-merge, missing tag — and a renderer branching on
  // their codes is reading this handler, not the repo.
  it('merges one tag into another and reports the survivor with its totals', async () => {
    const source = expectOk<{ id: string }>(
      await invoke(IPC_CHANNELS.TAGS_CREATE, { name: 'src-828' })
    )
    const target = expectOk<{ id: string }>(
      await invoke(IPC_CHANNELS.TAGS_CREATE, { name: 'dst-828', color: '#22c55e' })
    )
    expectOk(await invoke(IPC_CHANNELS.TAGS_ADD_TO_CAPTURE, { captureId, tagId: source.id }))

    const merged = expectOk<{ target: { id: string }; captureLinks: number; noteLinks: number }>(
      await invoke(IPC_CHANNELS.TAGS_MERGE, { sourceId: source.id, targetId: target.id })
    )
    expect(merged.target.id).toBe(target.id)
    expect(merged.captureLinks).toBe(1)
    expect(merged.noteLinks).toBe(0)

    const forCapture = expectOk<{ id: string }[]>(
      await invoke(IPC_CHANNELS.TAGS_GET_FOR_CAPTURE, captureId)
    )
    expect(forCapture.map((t) => t.id)).toEqual([target.id])
    const list = expectOk<{ id: string }[]>(await invoke(IPC_CHANNELS.TAGS_LIST))
    expect(list.some((t) => t.id === source.id)).toBe(false)
  })

  it('refuses a malformed, self-targeted or missing-tag merge with distinct codes', async () => {
    const tag = expectOk<{ id: string }>(
      await invoke(IPC_CHANNELS.TAGS_CREATE, { name: 'keep-828' })
    )

    const malformed = (await invoke(IPC_CHANNELS.TAGS_MERGE, { sourceId: tag.id })) as {
      ok: boolean
      code?: string
    }
    expect(malformed.ok).toBe(false)
    expect(malformed.code).toBe('INVALID_MERGE_PAYLOAD')

    const self = (await invoke(IPC_CHANNELS.TAGS_MERGE, {
      sourceId: tag.id,
      targetId: tag.id
    })) as { ok: boolean; code?: string }
    expect(self.ok).toBe(false)
    expect(self.code).toBe('TAG_MERGE_SELF')

    const missing = (await invoke(IPC_CHANNELS.TAGS_MERGE, {
      sourceId: tag.id,
      targetId: 'no-such-tag'
    })) as { ok: boolean; code?: string }
    expect(missing.ok).toBe(false)
    expect(missing.code).toBe('TAG_NOT_FOUND')

    // Every refusal left the tag standing.
    const list = expectOk<{ id: string }[]>(await invoke(IPC_CHANNELS.TAGS_LIST))
    expect(list.some((t) => t.id === tag.id)).toBe(true)
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

  // An empty pattern matches every capture and stalls the extension's page scan.
  it('refuses to create a selector with an empty or blank pattern, and writes no row', async () => {
    for (const pattern of ['', '   ', undefined]) {
      const res = await invoke<{ ok: boolean; code?: string }>(IPC_CHANNELS.SELECTORS_CREATE, {
        caseId,
        pattern,
        isRegex: false,
        origin: 'note'
      })
      expect(res.ok).toBe(false)
      expect(res.code).toBe('SELECTOR_PATTERN_EMPTY')
    }
    expect(expectOk<unknown[]>(await invoke(IPC_CHANNELS.SELECTORS_LIST, caseId))).toHaveLength(0)
  })

  // #829. The channel answers once the pass is scheduled, so the boolean is the
  // whole contract: true for a selector that exists, false for one that does not.
  it('schedules a rescan for a known selector and refuses an unknown id', async () => {
    const sel = expectOk<{ id: string }>(
      await invoke(IPC_CHANNELS.SELECTORS_CREATE, { caseId, pattern: 'rescan-me', isRegex: false })
    )

    expect(expectOk<boolean>(await invoke(IPC_CHANNELS.SELECTORS_RESCAN, sel.id))).toBe(true)
    expect(expectOk<boolean>(await invoke(IPC_CHANNELS.SELECTORS_RESCAN, 'no-such-selector'))).toBe(
      false
    )
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
    // A query FTS5 cannot parse is reported as a failure, not as zero matches.
    const bad = (await invoke(IPC_CHANNELS.NOTES_SEARCH, caseId, 'example.com')) as {
      ok: boolean
      code?: string
    }
    expect(bad.ok).toBe(false)
    expect(bad.code).toBe('SEARCH_FAILED')

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

  // #389: the reference reads are the whole renderer-facing surface of the
  // index (the write side has no channel of its own — it rides the note
  // write), so the wiring is what this covers.
  it('serves references, backlinks and whole-case backlink counts', async () => {
    const capture = insertCapture({
      caseId,
      url: 'https://mentioned.example',
      title: 'Mentioned capture',
      hash: 'abc123',
      timestamp: new Date().toISOString()
    })
    const bodyDoc = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'mention',
              attrs: { targetType: 'capture', targetId: capture.id, label: 'stale' }
            }
          ]
        }
      ]
    })
    const note = expectOk<{ id: string }>(
      await invoke(IPC_CHANNELS.NOTES_CREATE, { caseId, title: 'Mentions', bodyDoc })
    )

    expect(
      expectOk<Array<Record<string, unknown>>>(await invoke(IPC_CHANNELS.NOTES_REFERENCES, note.id))
    ).toMatchObject([
      { targetType: 'capture', targetId: capture.id, label: 'Mentioned capture', resolved: true }
    ])

    expect(
      expectOk<Array<Record<string, unknown>>>(
        await invoke(IPC_CHANNELS.NOTES_BACKLINKS, {
          caseId,
          targetType: 'capture',
          targetId: capture.id
        })
      )
    ).toMatchObject([{ noteId: note.id, noteTitle: 'Mentions', mentionCount: 1 }])

    expect(
      expectOk<Array<Record<string, unknown>>>(
        await invoke(IPC_CHANNELS.NOTES_BACKLINK_COUNTS, caseId)
      )
    ).toMatchObject([
      { targetType: 'capture', targetId: capture.id, noteCount: 1, mentionCount: 1 }
    ])
  })

  // Backlinks is the one reference channel taking a payload object, and the
  // contract's types are compile-time only. An off-enum targetType reaching
  // the query would come back as an empty list — an answer, not a refusal.
  it('refuses a malformed backlinks payload instead of answering it', async () => {
    for (const payload of [
      undefined,
      { caseId, targetType: 'bogus', targetId: 'x' },
      { caseId, targetType: 'capture' },
      { targetType: 'capture', targetId: 'x' },
      { caseId, targetType: 'capture', targetId: 42 }
    ]) {
      const res = await invoke<{ ok: boolean; code?: string }>(
        IPC_CHANNELS.NOTES_BACKLINKS,
        payload
      )
      expect(res.ok).toBe(false)
      expect(res.code).toBe('INVALID_BACKLINKS_PAYLOAD')
    }
  })

  // Mirrors the anchor translation above: a cross-case Mention is a distinct
  // structured failure, not a generic rejected promise.
  it('reports a cross-case Mention as a structured failure on create', async () => {
    const otherCase = createCase({ name: 'Elsewhere', description: '' })
    const otherCapture = insertCapture({
      caseId: otherCase.id,
      url: 'https://example.com',
      title: 'Elsewhere',
      hash: 'abc123',
      timestamp: new Date().toISOString()
    })
    const bodyDoc = JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'mention',
              attrs: { targetType: 'capture', targetId: otherCapture.id, label: '' }
            }
          ]
        }
      ]
    })

    const res = await invoke<{ ok: boolean; code?: string }>(IPC_CHANNELS.NOTES_CREATE, {
      caseId,
      bodyDoc
    })

    expect(res.ok).toBe(false)
    expect(res.code).toBe('MENTION_CASE_MISMATCH')
    expect(expectOk<unknown[]>(await invoke(IPC_CHANNELS.NOTES_LIST, caseId))).toHaveLength(0)
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
  it('searches captures and reports a query FTS5 cannot parse as a failure', async () => {
    expect(expectOk(await invoke(IPC_CHANNELS.SEARCH, 'case-1', 'hello'))).toBeDefined()
    for (const query of ['"unbalanced', 'example.com', 'alice@example.org']) {
      const res = (await invoke(IPC_CHANNELS.SEARCH, 'case-1', query)) as {
        ok: boolean
        code?: string
      }
      expect(res.ok).toBe(false)
      expect(res.code).toBe('SEARCH_FAILED')
    }
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

  it('names the class in the save dialog for both export classes (#399)', async () => {
    generateReport.mockResolvedValue(undefined)

    await invoke(IPC_CHANNELS.EXPORT_GENERATE, caseId, { format: 'zip', exportClass: 'evidence' })
    expect(showSaveDialog).toHaveBeenLastCalledWith({
      defaultPath: 'evidence.zip',
      filters: [{ name: 'Evidence Package', extensions: ['zip'] }]
    })

    await invoke(IPC_CHANNELS.EXPORT_GENERATE, caseId, {
      format: 'zip',
      exportClass: 'working-copy'
    })
    expect(showSaveDialog).toHaveBeenLastCalledWith({
      defaultPath: 'working-copy.zip',
      filters: [{ name: 'Working Copy (non-evidentiary)', extensions: ['zip'] }]
    })
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

  it('reveals a case archive it just exported (#362, #C12)', async () => {
    const archivePath = join(userDataPath, 'case.birdbrain')
    showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: archivePath })
    exportCaseArchive.mockImplementationOnce(async (_caseId, outputPath: string) => {
      writeFileSync(outputPath, '')
    })
    const done = expectOk(await invoke(IPC_CHANNELS.CASES_EXPORT_ARCHIVE, caseId))
    expect(done).toEqual({ canceled: false, filePath: archivePath })

    expectOk(await invoke(IPC_CHANNELS.SHELL_SHOW_ITEM_IN_FOLDER, archivePath))
    expect(showItemInFolder).toHaveBeenCalledWith(archivePath)
  })

  it('registers nothing when the archive save dialog is canceled (#362, #C12)', async () => {
    const archivePath = join(userDataPath, 'canceled.birdbrain')
    showSaveDialog.mockResolvedValueOnce({ canceled: true, filePath: archivePath })
    expect(expectOk(await invoke(IPC_CHANNELS.CASES_EXPORT_ARCHIVE, caseId))).toEqual({
      canceled: true
    })

    writeFileSync(archivePath, '')
    const res = await invoke<{ ok: boolean; error?: string; code?: string }>(
      IPC_CHANNELS.SHELL_SHOW_ITEM_IN_FOLDER,
      archivePath
    )
    expect(res.ok).toBe(false)
    expect(res.code).toBe('FORBIDDEN_PATH')
    expect(showItemInFolder).not.toHaveBeenCalled()
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
    const res = await invoke<{ ok: boolean; code?: string; data?: string }>(
      IPC_CHANNELS.EXTENSION_PATH
    )
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

  // Database Admin lets an operator write any row into any table, so the
  // constraint errors it can provoke have to come back as `{ ok: false }` with
  // a code the renderer can branch on, not as a rejected invoke.
  it('reports a foreign-key violation as a structured failure, not a rejection', async () => {
    const res = await invoke<{ ok: boolean; error?: string; code?: string }>(
      IPC_CHANNELS.DB_CREATE_ROW,
      { table: 'exhibit_tags', data: { exhibit_id: 'no-such-exhibit', tag_id: 'no-such-tag' } }
    )

    expect(res.ok).toBe(false)
    expect(res.code).toBe('SQLITE_CONSTRAINT_FOREIGNKEY')
    expect(res.error).toBe('Referenced record does not exist')
  })

  it('passes a constraint failure it has no wording for through with its code', async () => {
    const res = await invoke<{ ok: boolean; error?: string; code?: string }>(
      IPC_CHANNELS.DB_CREATE_ROW,
      { table: 'captures', data: { id: 'orphan-capture', url: 'https://example.com' } }
    )

    // No case_id at all: not one of the three cases with a written message, so
    // SQLite's own wording is what reaches the renderer rather than nothing.
    expect(res.ok).toBe(false)
    expect(res.code).toBe('SQLITE_CONSTRAINT_NOTNULL')
    expect(res.error).toContain('NOT NULL')
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

  // #389: body_doc joined anchor_json as a guarded column on the admin hatch,
  // so its rejection needs the same structured code rather than a raw
  // rejected promise.
  it('reports a cross-case Mention as a structured failure on db:updateRow', async () => {
    const otherCase = createCase({ name: 'Elsewhere', description: '' })
    const otherCapture = insertCapture({
      caseId: otherCase.id,
      url: 'https://example.com',
      title: 'Elsewhere',
      hash: 'abc123',
      timestamp: new Date().toISOString()
    })
    const note = expectOk<Record<string, unknown>>(
      await invoke(IPC_CHANNELS.DB_CREATE_ROW, {
        table: 'notes',
        data: {
          id: 'admin-mention-note',
          case_id: caseId,
          title: 'T',
          body: '',
          created_at: '2026-08-20T00:00:00Z',
          updated_at: '2026-08-20T00:00:00Z'
        }
      })
    )

    const res = await invoke<{ ok: boolean; code?: string }>(IPC_CHANNELS.DB_UPDATE_ROW, {
      table: 'notes',
      pk: { id: note.id as string },
      data: {
        body_doc: JSON.stringify({
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'mention',
                  attrs: { targetType: 'capture', targetId: otherCapture.id, label: '' }
                }
              ]
            }
          ]
        })
      }
    })

    expect(res.ok).toBe(false)
    expect(res.code).toBe('MENTION_CASE_MISMATCH')
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
    expect(clearOrphanedPartitions).toHaveBeenCalledWith(userDataPath)
    expect(expectOk(await invoke(IPC_CHANNELS.CASES_GET, afterSnapshot.id))).toBeUndefined()
    // The database is open again on the other side of the restore.
    expectOk(await invoke(IPC_CHANNELS.DB_STATS))
    // And the database it replaced is gone rather than kept under another
    // name: the restore is irreversible, as the confirm dialog says. Only
    // dotted suffixes are checked — `-wal`/`-shm` belong to the connection
    // that was just re-opened, while anything at `birdbrain.db.<something>`
    // would be a second copy of the database.
    expect(readdirSync(userDataPath).filter((f) => f.startsWith('birdbrain.db.'))).toEqual([])
  })

  it('restores a database file chosen from the open dialog', async () => {
    const backupPath = join(userDataPath, 'chosen-backup.db')
    showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: backupPath })
    expectOk(await invoke(IPC_CHANNELS.DB_BACKUP))
    const afterBackup = expectOk<{ id: string }>(
      await invoke(IPC_CHANNELS.CASES_CREATE, { name: 'Recorded after the backup' })
    )

    showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [backupPath] })
    const res = expectOk<{ restored: boolean }>(await invoke(IPC_CHANNELS.DB_RESTORE))

    expect(res.restored).toBe(true)
    expect(clearOrphanedPartitions).toHaveBeenCalledWith(userDataPath)
    // Re-opened on the other side, and holding the backup rather than the
    // database that was running when it was chosen.
    expectOk(await invoke(IPC_CHANNELS.DB_STATS))
    expect(expectOk(await invoke(IPC_CHANNELS.CASES_GET, afterBackup.id))).toBeUndefined()
  })

  it('reports a failed snapshot restore without the filesystem error behind it', async () => {
    const conn = new Database(dbPath)
    try {
      await createPreMigrationSnapshot(conn, dbPath, LATEST_SCHEMA_VERSION, LATEST_SCHEMA_VERSION)
    } finally {
      conn.close()
    }
    const listed = expectOk<Array<{ fileName: string }>>(await invoke(IPC_CHANNELS.DB_SNAPSHOTS))
    // Truncated after the handler's own resolve would have passed: the restore
    // itself rejects it, which is the failure path this exercises.
    truncateSync(join(userDataPath, 'db-snapshots', listed[0].fileName), 24576)

    const res = await invoke<{ ok: boolean; error?: string; code?: string }>(
      IPC_CHANNELS.DB_RESTORE_SNAPSHOT,
      { fileName: listed[0].fileName }
    )

    expect(res.ok).toBe(false)
    expect(res.code).toBe('DB_RESTORE_FAILED')
    // A fixed message: the underlying copyFileSync/rmSync errors name absolute
    // paths, and `handle()` passes anything that is not an IpcFailure straight
    // through to the renderer.
    expect(res.error).not.toContain(userDataPath)
    // The database is back — the restore stopped before it moved anything.
    expectOk(await invoke(IPC_CHANNELS.DB_STATS))
  })

  it('does not migrate a truncated database forward when the restore failed', async () => {
    const conn = new Database(dbPath)
    try {
      await createPreMigrationSnapshot(conn, dbPath, LATEST_SCHEMA_VERSION, LATEST_SCHEMA_VERSION)
    } finally {
      conn.close()
    }
    const listed = expectOk<Array<{ fileName: string }>>(await invoke(IPC_CHANNELS.DB_SNAPSHOTS))
    // A snapshot the restore will reject, so the handler reaches its failure
    // path with `restoreErr` set.
    truncateSync(join(userDataPath, 'db-snapshots', listed[0].fileName), 24576)

    // And the state the guard exists for: the file the restore was writing
    // over is no longer a database. Produced directly here, because the staged
    // copy means the restore itself can no longer leave one behind — the guard
    // is what stops that from being the only thing standing between a failed
    // restore and a migrated empty database.
    closeDatabase()
    truncateSync(dbPath, 0)

    const res = await invoke<{ ok: boolean; error?: string; code?: string }>(
      IPC_CHANNELS.DB_RESTORE_SNAPSHOT,
      { fileName: listed[0].fileName }
    )

    expect(res.ok).toBe(false)
    expect(res.code).toBe('DB_RESTORE_FAILED')
    expect(res.error).not.toContain(userDataPath)
    // The whole point: nothing migrated the empty file forward. A fresh schema
    // written here would leave the operator with a healthy-looking, empty
    // database and only a "could not be restored" message to explain it (#428).
    expect(statSync(dbPath).size).toBe(0)
    await expect(invoke(IPC_CHANNELS.DB_STATS)).rejects.toThrow('Database not initialized')
  })

  it('reports a re-open failure as such when the restored snapshot cannot be migrated', async () => {
    // A snapshot that restores cleanly and then cannot be brought forward: it
    // reports schema v26, so the v27 block runs against it, and it has no
    // notes table for that block to alter.
    const fileName = 'pre-migration-v26-to-v27-2026-01-01T00-00-00-000Z.db'
    const snapshotDir = join(userDataPath, 'db-snapshots')
    mkdirSync(snapshotDir, { recursive: true })
    const broken = new Database(join(snapshotDir, fileName))
    try {
      broken.exec(`CREATE TABLE cases (id TEXT PRIMARY KEY)`)
      broken.pragma('user_version = 26')
    } finally {
      broken.close()
    }

    const res = await invoke<{ ok: boolean; error?: string; code?: string }>(
      IPC_CHANNELS.DB_RESTORE_SNAPSHOT,
      { fileName }
    )

    expect(res.ok).toBe(false)
    expect(res.code).toBe('DB_REOPEN_FAILED')
    // Named as a re-open failure, not a restore failure: the restore worked,
    // and every later call in this session fails until the app is restarted.
    await expect(invoke(IPC_CHANNELS.DB_STATS)).rejects.toThrow('Database not initialized')
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
    type WaybackRefRow = { snapshotUrl: string; checkedAt: string }
    const refs = expectOk<WaybackRefRow[]>(
      (await list({} as never, cap.id)) as { ok: boolean; data?: WaybackRefRow[] }
    )
    expect(refs).toHaveLength(1)
    expect(refs[0].snapshotUrl).toBe(snapshot.snapshotUrl)
    expect(refs[0].checkedAt).toBe('2026-06-30T00:00:00.000Z')

    // The case-wide read the export dialog uses: same pins, each carrying the
    // capture time it corroborates.
    const listForCase = registered.get('wayback:listForCase')!
    const caseRefs = expectOk<Array<WaybackRefRow & { captureTimestamp: string }>>(
      (await listForCase({} as never, c.id)) as {
        ok: boolean
        data?: Array<WaybackRefRow & { captureTimestamp: string }>
      }
    )
    expect(caseRefs).toHaveLength(1)
    expect(caseRefs[0].snapshotUrl).toBe(snapshot.snapshotUrl)
    expect(caseRefs[0].captureTimestamp).toBe('2020-01-15T12:00:00.000Z')

    const unpin = registered.get('wayback:unpin')!
    const removed = (await unpin({} as never, pinned.data.id)) as { ok: boolean; data: boolean }
    expect(removed.ok).toBe(true)
    expect(
      expectOk<unknown[]>((await list({} as never, cap.id)) as { ok: boolean; data?: unknown[] })
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
      expectOk<unknown[]>((await list({} as never, cap.id)) as { ok: boolean; data?: unknown[] })
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

  it('exports only current and rotated logs, including buffered entries', async () => {
    const target = join(userDataPath, 'logs.zip')
    const logDir = join(userDataPath, 'logs')
    mkdirSync(logDir, { recursive: true })
    writeFileSync(join(logDir, 'birdbrain.log.1'), 'rotated-log-fixture')
    writeFileSync(join(logDir, 'settings.json'), 'private-settings-fixture')
    await invoke(IPC_CHANNELS.DIAGNOSTICS_LOG, { level: 'info', code: 'query.failed' })
    showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: target })

    expect(expectOk(await invoke(IPC_CHANNELS.DIAGNOSTICS_EXPORT_LOGS))).toEqual({ path: target })
    const exported = readStoredZip(readFileSync(target))
    expect([...exported.keys()].sort()).toEqual(['birdbrain.log', 'birdbrain.log.1'])
    expect(exported.get('birdbrain.log')?.toString()).toContain('query.failed')
    expect(exported.get('birdbrain.log.1')?.toString()).toBe('rotated-log-fixture')
    expect(showItemInFolder).toHaveBeenCalledWith(target)
  })

  it('cancels log export without writing or revealing a file', async () => {
    const target = join(userDataPath, 'cancelled-logs.zip')
    showSaveDialog.mockResolvedValueOnce({ canceled: true, filePath: target })
    expect(expectOk(await invoke(IPC_CHANNELS.DIAGNOSTICS_EXPORT_LOGS))).toBeNull()
    expect(existsSync(target)).toBe(false)
    expect(showItemInFolder).not.toHaveBeenCalled()
  })

  it('returns the database integrity check over its dedicated channel', async () => {
    expect(expectOk(await invoke(IPC_CHANNELS.DB_INTEGRITY_CHECK))).toEqual({
      ok: true,
      issues: []
    })
  })

  it('diagnostics:revealLog reveals the current log file via the shell', async () => {
    await invoke(IPC_CHANNELS.DIAGNOSTICS_LOG, { level: 'info', code: 'query.failed' })
    expectOk(await invoke(IPC_CHANNELS.DIAGNOSTICS_REVEAL_LOG))
    expect(showItemInFolder).toHaveBeenCalledWith(getLogPath())
  })

  // #363: the storage root is opened on its own channel and never registered
  // on the reveal allowlist. The renderer supplies no path; main reads the live
  // root, so the outcome cannot depend on export history or on a boot-time
  // registration going stale.
  it('diagnostics:openStorageRoot opens the live storage root without a caller-supplied path', async () => {
    const root = storage.getStorageRoot()
    openPath.mockResolvedValueOnce('')
    expectOk(await invoke(IPC_CHANNELS.DIAGNOSTICS_OPEN_STORAGE_ROOT))
    expect(openPath).toHaveBeenCalledWith(root)
    // The same root is still refused on the generic channel: no allowlist entry
    // was created as a side effect, so the #C12 guard is untouched.
    const generic = await invoke<{ ok: boolean; code?: string }>(IPC_CHANNELS.SHELL_OPEN_PATH, root)
    expect(generic.ok).toBe(false)
    expect(generic.code).toBe('FORBIDDEN_PATH')
  })

  it('diagnostics:openStorageRoot still works after the reveal allowlist has fully cycled', async () => {
    // Exceed MAX_REVEALABLE_PATHS so every allowlist entry that existed at boot
    // would have been evicted. A boot-time registration would fail here.
    for (let i = 0; i < 70; i++) {
      showSaveDialog.mockResolvedValueOnce({
        canceled: false,
        filePath: join(userDataPath, `cycle-${i}.zip`)
      })
      expectOk(await invoke(IPC_CHANNELS.EXPORT_GENERATE, caseId, { format: 'zip' }))
    }
    openPath.mockClear()
    openPath.mockResolvedValueOnce('')
    expectOk(await invoke(IPC_CHANNELS.DIAGNOSTICS_OPEN_STORAGE_ROOT))
    expect(openPath).toHaveBeenCalledWith(storage.getStorageRoot())
  })

  it('diagnostics:openStorageRoot follows a storage root changed after boot', async () => {
    const moved = join(userDataPath, 'captures-moved')
    storage.initStorage(moved)
    openPath.mockResolvedValueOnce('')
    expectOk(await invoke(IPC_CHANNELS.DIAGNOSTICS_OPEN_STORAGE_ROOT))
    expect(openPath).toHaveBeenCalledWith(moved)
    expect(openPath).not.toHaveBeenCalledWith(join(userDataPath, 'captures'))
  })

  it('diagnostics:openStorageRoot keeps its failure modes distinguishable', async () => {
    const missing = join(userDataPath, 'captures-gone')
    storage.initStorage(missing)
    rmSync(missing, { recursive: true, force: true })
    const gone = await invoke<{ ok: boolean; error?: string; code?: string }>(
      IPC_CHANNELS.DIAGNOSTICS_OPEN_STORAGE_ROOT
    )
    expect(gone.ok).toBe(false)
    expect(gone.code).toBe('NOT_FOUND')
    expect(gone.error).not.toMatch(/not permitted/i)
    expect(openPath).not.toHaveBeenCalled()

    storage.initStorage(join(userDataPath, 'captures'))
    openPath.mockResolvedValueOnce('No application is registered for this file type')
    const refused = await invoke<{ ok: boolean; error?: string; code?: string }>(
      IPC_CHANNELS.DIAGNOSTICS_OPEN_STORAGE_ROOT
    )
    expect(refused.ok).toBe(false)
    expect(refused.code).toBe('OPEN_PATH_FAILED')
    expect(refused.error).toBe('No application is registered for this file type')

    const rootSpy = vi.spyOn(storage, 'getStorageRoot').mockImplementation(() => {
      throw new Error('Storage not initialized')
    })
    try {
      const uninit = await invoke<{ ok: boolean; error?: string; code?: string }>(
        IPC_CHANNELS.DIAGNOSTICS_OPEN_STORAGE_ROOT
      )
      expect(uninit.ok).toBe(false)
      expect(uninit.code).toBe('STORAGE_NOT_INITIALISED')
    } finally {
      rootSpy.mockRestore()
    }
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

describe('ipcHandlers — personas (#1497)', () => {
  beforeEach(() => {
    importCookies.mockReset()
    clearPersona.mockReset()
    getPersonaStorageState.mockReset()
  })

  it('creates with a trimmed label, lists, and refuses an empty label', async () => {
    const created = expectOk<Persona>(
      await invoke(IPC_CHANNELS.PERSONAS_CREATE, { label: '  Research account  ' })
    )
    expect(created.label).toBe('Research account')
    expect(expectOk<Persona[]>(await invoke(IPC_CHANNELS.PERSONAS_LIST))).toEqual([created])

    const res = (await invoke(IPC_CHANNELS.PERSONAS_CREATE, { label: '   ' })) as {
      ok: boolean
      code?: string
    }
    expect(res.ok).toBe(false)
    expect(res.code).toBe('PERSONA_LABEL_REQUIRED')
  })

  it('renames with a trimmed label and refuses a blank one', async () => {
    const created = personaRepo.createPersona({ label: 'before' })
    const renamed = expectOk<Persona | undefined>(
      await invoke(IPC_CHANNELS.PERSONAS_UPDATE, { id: created.id, label: ' after ' })
    )
    expect(renamed?.label).toBe('after')
    const res = (await invoke(IPC_CHANNELS.PERSONAS_UPDATE, { id: created.id, label: ' ' })) as {
      ok: boolean
      code?: string
    }
    expect(res.ok).toBe(false)
    expect(res.code).toBe('PERSONA_LABEL_REQUIRED')
    expect(personaRepo.getPersona(created.id)?.label).toBe('after')
  })

  it('delete goes through the session service, which clears the partition first', async () => {
    clearPersona.mockResolvedValueOnce(true)
    expect(expectOk<boolean>(await invoke(IPC_CHANNELS.PERSONAS_DELETE, 'p-1'))).toBe(true)
    expect(clearPersona).toHaveBeenCalledWith('p-1')
  })

  it('import opens the file dialog and returns null when it is cancelled', async () => {
    showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    expect(expectOk(await invoke(IPC_CHANNELS.PERSONAS_IMPORT, 'p-1'))).toBeNull()
    expect(importCookies).not.toHaveBeenCalled()
    const options = showOpenDialog.mock.calls.at(-1)?.[0] as { properties: string[] }
    expect(options.properties).toEqual(['openFile'])
  })

  it('import hands the chosen path, never its contents, to the service', async () => {
    const result: PersonaImportResult = {
      accepted: 2,
      rejected: [{ line: 3, reason: 'expired' }],
      importedAt: '2026-09-23T12:00:00.000Z'
    }
    showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: ['/tmp/cookies.txt'] })
    importCookies.mockResolvedValueOnce(result)
    expect(expectOk(await invoke(IPC_CHANNELS.PERSONAS_IMPORT, 'p-1'))).toEqual(result)
    expect(importCookies).toHaveBeenCalledWith('p-1', '/tmp/cookies.txt')
  })

  it('import maps an unsupported file and a missing persona to coded failures', async () => {
    showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/tmp/Cookies'] })
    importCookies.mockRejectedValueOnce(new UnsupportedCookieFileError())
    const unsupported = (await invoke(IPC_CHANNELS.PERSONAS_IMPORT, 'p-1')) as {
      ok: boolean
      code?: string
      error?: string
    }
    expect(unsupported.ok).toBe(false)
    expect(unsupported.code).toBe('PERSONA_COOKIE_FILE_UNSUPPORTED')
    expect(unsupported.error).toMatch(/Netscape cookies.txt/)

    const { PersonaNotFoundError } = await import('@main/services/persona/personaSessions')
    importCookies.mockRejectedValueOnce(new PersonaNotFoundError('p-1'))
    const missing = (await invoke(IPC_CHANNELS.PERSONAS_IMPORT, 'p-1')) as {
      ok: boolean
      code?: string
    }
    expect(missing.ok).toBe(false)
    expect(missing.code).toBe('PERSONA_NOT_FOUND')

    importCookies.mockRejectedValueOnce(new Error('disk on fire'))
    await expect(invoke(IPC_CHANNELS.PERSONAS_IMPORT, 'p-1')).rejects.toThrow('disk on fire')
  })

  it('storage state comes from the session service', async () => {
    getPersonaStorageState.mockReturnValueOnce({ encryptionAvailable: false })
    expect(expectOk(await invoke(IPC_CHANNELS.PERSONAS_STORAGE_STATE))).toEqual({
      encryptionAvailable: false
    })
  })
})
