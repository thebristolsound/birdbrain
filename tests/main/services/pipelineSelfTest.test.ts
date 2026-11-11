import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'fs'
import { dirname, join } from 'path'
import { tmpdir } from 'os'
import { createHash } from 'crypto'
import type { BrowserWindow } from 'electron'
import { initDatabase, closeDatabase, getDb } from '@main/services/db/core'
import {
  createCase,
  deleteCase,
  getCase,
  listCaseDependentTables,
  listCases,
  markCaseShared,
  setAutoCapturePolicy,
  setCaseDemo,
  updateCase
} from '@main/services/db/caseRepo'
import { listCaptures, toggleFavorite } from '@main/services/db/captureRepo'
import { insertExhibit } from '@main/services/db/exhibitRepo'
import { insertExtractedData } from '@main/services/db/extractedDataRepo'
import { createNote } from '@main/services/db/noteRepo'
import { replaceExhibitFields } from '@main/services/db/searchFieldRepo'
import { createSelector } from '@main/services/db/selectorRepo'
import { addTagToCapture, createTag } from '@main/services/db/tagRepo'
import { initStorage } from '@main/services/storage'
import { initSettings, updateSettings } from '@main/services/settings'
import { initInstallationId, resetInstallationId } from '@main/services/installationId'
import { setMainWindow, startCaptureServer, stopCaptureServer } from '@main/services/captureServer'
import { createCaptureLifecycle } from '@main/services/captureLifecycle'
import { createSelectorLifecycle } from '@main/services/selectorLifecycle'
import { createSessionService, type SessionService } from '@main/services/session'
import { readEntries, verifyManifestChain } from '@main/services/manifest'
import { disposeLogger, initLogger, readRecentEntries } from '@main/services/logger'
import {
  createPipelineSelfTestSandbox,
  isPipelineSelfTestResidue,
  PIPELINE_SELF_TEST_CASE_NAME,
  PIPELINE_SELF_TEST_URL,
  sweepPipelineSelfTestResidue,
  type PipelineSelfTestSandbox
} from '@main/services/pipelineSelfTest'
import type { LogCode } from '@shared/types'
import { IPC_CHANNELS } from '@shared/ipc'
import { MANIFEST_FILENAME } from '@shared/constants'

// Keep ingest hermetic: the corroboration-only TLS re-fetch (#123) would
// otherwise open a real socket on every captured upload.
vi.mock('@main/services/tlsCertChain', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/services/tlsCertChain')>()
  return { ...actual, fetchCertChain: vi.fn(async () => null) }
})

// What the sandbox held at the moment cleanup started — the only window in
// which it can be read, and the only way to prove from outside the route that
// the production ingest really ran and really ran there.
interface SandboxObservation {
  root: string
  caseId: string
  manifest: string
  chainValid: boolean
  captureRows: number
}
const observed: SandboxObservation[] = []

// Injects an ingest failure so the cleanup path can be tested where it matters
// (AC4). Every other test in this file runs the unmocked ingest.
let failIngest = false

// Runs between the sandbox being fully built and its teardown — the only point
// from outside the route at which teardown can be made to fail.
let breakTeardown: ((sandbox: PipelineSelfTestSandbox) => void) | null = null

// Stands in for a process killed between ingest and teardown: the sandbox is
// observed and then left exactly as the kill would leave it.
let simulateKill = false

vi.mock('@main/services/captureLifecycle', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/services/captureLifecycle')>()
  return {
    ...actual,
    ingestMhtmlCapture: (...args: Parameters<typeof actual.ingestMhtmlCapture>) => {
      if (failIngest) return Promise.reject(new Error('injected ingest failure'))
      return actual.ingestMhtmlCapture(...args)
    }
  }
})

vi.mock('@main/services/pipelineSelfTest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/services/pipelineSelfTest')>()
  return {
    ...actual,
    createPipelineSelfTestSandbox: (): PipelineSelfTestSandbox => {
      const sandbox = actual.createPipelineSelfTestSandbox()
      return {
        ...sandbox,
        dispose: () => {
          const caseDir = join(sandbox.root, sandbox.caseId)
          const manifestPath = join(caseDir, MANIFEST_FILENAME)
          observed.push({
            root: sandbox.root,
            caseId: sandbox.caseId,
            manifest: existsSync(manifestPath) ? readFileSync(manifestPath, 'utf-8') : '',
            chainValid: verifyManifestChain(caseDir).valid,
            captureRows: listCaptures(sandbox.caseId).length
          })
          if (simulateKill) return
          breakTeardown?.(sandbox)
          sandbox.dispose()
        }
      }
    }
  }
})

let nextPort = 19970
const TEST_TOKEN = 'test-server-token'
const sent: Array<{ channel: string; payload: unknown }> = []

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped HTTP payloads read by key
type JsonBody = Record<string, any>
const readJson = async (res: Response): Promise<JsonBody> => (await res.json()) as JsonBody

const sha256 = (path: string): string =>
  createHash('sha256').update(readFileSync(path)).digest('hex')

// The durable log is the end of the path a teardown failure travels: the same
// entry the renderer receives over LOG_ENTRY and toasts (notify.ts).
const cleanupFailures = (): number =>
  readRecentEntries(50).filter(
    (e) => e.level === 'error' && e.code === 'captureServer.self_test_cleanup_failed'
  ).length

const logged = (code: LogCode): Array<{ level: string; caseId: unknown }> =>
  readRecentEntries(50)
    .filter((e) => e.code === code)
    .map(({ level, context }) => ({ level, caseId: context?.caseId }))

describe('capture-pipeline self-test sandbox (#614)', () => {
  let tempDir: string
  let baseUrl: string
  let sessionService: SessionService

  beforeEach(async () => {
    const port = nextPort++
    observed.length = 0
    sent.length = 0
    failIngest = false
    breakTeardown = null
    simulateKill = false
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-selftest-'))
    initLogger(tempDir, 'pipeline-self-test-session')
    await initDatabase(':memory:')
    initSettings(tempDir)
    updateSettings({ operatorName: 'Test Operator' })
    // An earlier launch: it starts the storage record the sweep requires,
    // before any case of the test is made.
    launch()
    await tick()
    resetInstallationId()
    initInstallationId(tempDir)
    sessionService = createSessionService()
    // Without a window the capture-event emitter is a no-op, so the event
    // assertions below would pass on an absence rather than on the events.
    setMainWindow({
      isDestroyed: () => false,
      webContents: { send: (channel: string, payload: unknown) => sent.push({ channel, payload }) }
    } as unknown as BrowserWindow)
    baseUrl = `http://127.0.0.1:${port}`
    const selectorLifecycle = createSelectorLifecycle({ emitRematched: () => {} })
    // The seed below posts an 'auto' capture, which the lifecycle resolves
    // against the session the server holds.
    const captureLifecycle = createCaptureLifecycle({ selectorLifecycle, sessionService })
    await startCaptureServer(
      { selectorLifecycle, captureLifecycle, token: TEST_TOKEN, sessionService },
      port
    )
  })

  afterEach(async () => {
    await stopCaptureServer()
    closeDatabase()
    disposeLogger()
    rmSync(tempDir, { recursive: true, force: true })
  })

  // One launch as the sweep sees it: the storage half of boot
  // (src/main/index.ts), with its fallback, and then the sweep.
  const launch = (configured = join(tempDir, 'captures'), fallback?: string): void => {
    try {
      initStorage(configured)
    } catch (err) {
      if (!fallback) throw err
      initStorage(fallback)
    }
    sweepPipelineSelfTestResidue(tempDir)
  }

  // A case counts as made after the storage record began only by a later
  // clock reading, so tests let the clock move on before making one.
  const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 2))

  const runSelfTest = (): Promise<Response> =>
    fetch(`${baseUrl}/api/captures/test`, {
      method: 'POST',
      headers: { 'X-Birdbrain-Token': TEST_TOKEN }
    })

  async function seedRealCapture(caseId: string): Promise<void> {
    await fetch(`${baseUrl}/api/cases/${caseId}/activate`, {
      method: 'POST',
      headers: { 'X-Birdbrain-Token': TEST_TOKEN }
    })
    await fetch(`${baseUrl}/api/session/start`, {
      method: 'POST',
      headers: { 'X-Birdbrain-Token': TEST_TOKEN }
    })
    const form = new FormData()
    form.append('source', 'auto')
    form.append('url', 'https://example.com/evidence')
    form.append('title', 'Evidence')
    form.append('timestamp', new Date().toISOString())
    form.append('textContent', 'Evidence page')
    form.append(
      'mhtml',
      new Blob(['<html>evidence</html>'], { type: 'multipart/related' }),
      'c.mhtml'
    )
    const res = await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      body: form,
      headers: { 'X-Birdbrain-Token': TEST_TOKEN }
    })
    expect(res.status).toBe(200)
  }

  // AC1/AC3. The assertion is about an absence, so it is stated against the
  // bytes: with the pre-#614 route this fails, because ingest appended a
  // `capture` entry and the cleanup delete appended a `deletion` beside it.
  it('leaves every real investigation manifest byte-identical', async () => {
    const investigation = createCase({ name: 'Real Investigation' })
    const other = createCase({ name: 'Second Investigation' })
    await seedRealCapture(investigation.id)

    const manifestPath = join(tempDir, 'captures', investigation.id, MANIFEST_FILENAME)
    const before = sha256(manifestPath)
    const beforeUpdatedAt = getCase(investigation.id)?.updatedAt

    const data = await readJson(await runSelfTest())
    expect(data.success).toBe(true)

    expect(sha256(manifestPath)).toBe(before)
    expect(listCaptures(investigation.id)).toHaveLength(1)
    // Nothing appended anywhere else either: the second case never acquired a
    // directory, and neither case was touched.
    expect(existsSync(join(tempDir, 'captures', other.id))).toBe(false)
    expect(listCaptures(other.id)).toHaveLength(0)
    expect(getCase(investigation.id)?.updatedAt).toBe(beforeUpdatedAt)
    expect(
      listCases()
        .map((c) => c.id)
        .sort()
    ).toEqual([investigation.id, other.id].sort())
  })

  // AC2. The production ingest ran, and the chain it built is a real signed
  // chain — it is simply in a directory that is about to cease to exist.
  it('runs the production ingest into the sandbox and builds a verifiable chain', async () => {
    createCase({ name: 'Real Investigation' })

    const data = await readJson(await runSelfTest())
    expect(data.success).toBe(true)

    expect(observed).toHaveLength(1)
    const [sandbox] = observed
    const entries = readEntries(sandbox.manifest)
    expect(entries).toHaveLength(1)
    expect(entries[0].type).toBe('capture')
    expect(entries[0].url).toBe(PIPELINE_SELF_TEST_URL)
    expect(entries[0].index).toBe(0)
    expect(entries[0].prevHash).toBe('')
    expect(entries[0].caseId).toBe(sandbox.caseId)
    expect(sandbox.chainValid).toBe(true)
    expect(sandbox.captureRows).toBe(1)
  })

  // AC4, happy path.
  it('removes the sandbox root and its case row after the run', async () => {
    const data = await readJson(await runSelfTest())
    expect(data.success).toBe(true)

    const [sandbox] = observed
    expect(existsSync(sandbox.root)).toBe(false)
    expect(getCase(sandbox.caseId)).toBeUndefined()
    expect(listCaptures(sandbox.caseId)).toHaveLength(0)
    expect(listCases()).toHaveLength(0)
  })

  // AC4, failure path. The route reports the failure to the caller unchanged
  // (AC5) and still takes the sandbox with it.
  it('removes the sandbox root and its case row when ingest fails', async () => {
    failIngest = true

    const data = await readJson(await runSelfTest())
    expect(data.success).toBe(false)
    expect(data.error).toContain('injected ingest failure')

    expect(observed).toHaveLength(1)
    const [sandbox] = observed
    expect(existsSync(sandbox.root)).toBe(false)
    expect(getCase(sandbox.caseId)).toBeUndefined()
    expect(listCases()).toHaveLength(0)
  })

  // Teardown failure, before the case can be read. The route's own result
  // stands, the operator is told, and the directory still goes. Closing an
  // in-memory database takes the case row with the connection, so this pins
  // the report and the directory, not the state of a case that outlives it.
  it('removes the sandbox root and reports it when the case cannot be read', async () => {
    breakTeardown = () => closeDatabase()

    const data = await readJson(await runSelfTest())
    expect(data.success).toBe(true)

    const [sandbox] = observed
    expect(existsSync(sandbox.root)).toBe(false)
    expect(cleanupFailures()).toBe(1)
  })

  // Teardown failure, case row half: the case passes the residue check and the
  // delete itself is refused. The directory still goes and the row stays.
  it('removes the sandbox root and reports it when the case row cannot be deleted', async () => {
    breakTeardown = () =>
      getDb().exec(
        `CREATE TRIGGER refuse_case_delete BEFORE DELETE ON cases
         BEGIN SELECT RAISE(ABORT, 'injected delete failure'); END`
      )

    const data = await readJson(await runSelfTest())
    expect(data.success).toBe(true)

    const [sandbox] = observed
    expect(getCase(sandbox.caseId)?.name).toBe(PIPELINE_SELF_TEST_CASE_NAME)
    expect(listCaptures(sandbox.caseId)).toHaveLength(1)
    expect(existsSync(sandbox.root)).toBe(false)
    expect(cleanupFailures()).toBe(1)
    expect(logged('captureServer.self_test_sandbox_kept')).toEqual([])
  })

  // The sandbox is listed while the run is in flight, so an operator can delete
  // it before teardown. A case that is gone was not kept: nothing is reported,
  // and the directory still goes.
  it('removes the sandbox root without a warning when the case is already gone', async () => {
    breakTeardown = (sandbox) => deleteCase(sandbox.caseId)

    const data = await readJson(await runSelfTest())
    expect(data.success).toBe(true)

    const [sandbox] = observed
    expect(getCase(sandbox.caseId)).toBeUndefined()
    expect(existsSync(sandbox.root)).toBe(false)
    expect(logged('captureServer.self_test_sandbox_kept')).toEqual([])
    expect(cleanupFailures()).toBe(0)
  })

  // Teardown failure, directory half. Reachable only where the process cannot
  // write its own temp directory, so it is skipped for root.
  it.skipIf(process.getuid?.() === 0)(
    'reports a sandbox root it cannot remove, having already removed the case row',
    async () => {
      breakTeardown = (sandbox) => chmodSync(sandbox.root, 0o500)

      const data = await readJson(await runSelfTest())
      expect(data.success).toBe(true)

      const [sandbox] = observed
      expect(getCase(sandbox.caseId)).toBeUndefined()
      expect(listCases()).toHaveLength(0)
      expect(existsSync(sandbox.root)).toBe(true)
      expect(cleanupFailures()).toBe(1)

      chmodSync(sandbox.root, 0o700)
      rmSync(sandbox.root, { recursive: true, force: true })
    }
  )

  // The one failure with no sandbox for the route's `finally` to dispose, so
  // the directory has to be taken back here or a failing database leaks one per
  // click. TMPDIR is redirected to make the absence provable rather than
  // inferred from a shared directory other tests also write to.
  it('removes the temp root when the sandbox case row cannot be created', () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), 'birdbrain-selftest-tmp-'))
    const previousTmpdir = process.env.TMPDIR
    process.env.TMPDIR = tmpRoot
    try {
      closeDatabase()
      expect(() => createPipelineSelfTestSandbox()).toThrow('Database not initialized')
      expect(readdirSync(tmpRoot)).toEqual([])
    } finally {
      if (previousTmpdir === undefined) delete process.env.TMPDIR
      else process.env.TMPDIR = previousTmpdir
      rmSync(tmpRoot, { recursive: true, force: true })
    }
  })

  // AC5. Same two events, same sentinel URL, as before #614.
  it('emits the received and stored capture events it always did', async () => {
    const data = await readJson(await runSelfTest())
    expect(data.success).toBe(true)

    const activity = sent
      .filter((e) => e.channel === IPC_CHANNELS.CAPTURE_ACTIVITY)
      .map((e) => e.payload as { type: string; url: string; captureId?: string })
    expect(activity.map((e) => e.type)).toEqual(['received', 'stored'])
    expect(activity.every((e) => e.url === PIPELINE_SELF_TEST_URL)).toBe(true)
    expect(activity[1].captureId).toBeTruthy()
  })

  it('reports the operator-name failure without creating a sandbox', async () => {
    updateSettings({ operatorName: '   ' })

    const res = await runSelfTest()
    expect(res.status).toBe(400)
    expect(observed).toHaveLength(0)
    expect(listCases()).toHaveLength(0)
  })

  // #1196: during the run the sandbox is an ordinary case, so a token-holding
  // client can upload into it. Teardown must not cascade over that upload.
  it('keeps a sandbox that gained a foreign capture, and warns', async () => {
    const sandbox = createPipelineSelfTestSandbox()
    await seedRealCapture(sandbox.caseId)
    const foreignDir = join(tempDir, 'captures', sandbox.caseId)
    const foreignFiles = readdirSync(foreignDir)
    expect(foreignFiles.length).toBeGreaterThan(0)

    sandbox.dispose()

    expect(getCase(sandbox.caseId)?.name).toBe(PIPELINE_SELF_TEST_CASE_NAME)
    expect(listCaptures(sandbox.caseId).map((c) => c.url)).toEqual(['https://example.com/evidence'])
    expect(readdirSync(foreignDir)).toEqual(foreignFiles)
    expect(existsSync(sandbox.root)).toBe(true)
    expect(logged('captureServer.self_test_sandbox_kept')).toEqual([
      { level: 'warn', caseId: sandbox.caseId }
    ])
    expect(cleanupFailures()).toBe(0)

    rmSync(sandbox.root, { recursive: true, force: true })
  })

  it('refuses a case by its name, a foreign capture or a folder under the storage root', async () => {
    expect(isPipelineSelfTestResidue(createCase({ name: 'Real Investigation' }).id)).toBe(false)
    expect(isPipelineSelfTestResidue('no-such-case')).toBe(false)

    // A kill between creating the case and ingesting leaves it empty.
    const empty = createCase({ name: PIPELINE_SELF_TEST_CASE_NAME })
    expect(isPipelineSelfTestResidue(empty.id)).toBe(true)

    // The sandbox never writes under the configured root, so anything there is
    // someone else's, whatever URL its capture row carries.
    mkdirSync(join(tempDir, 'captures', empty.id), { recursive: true })
    expect(isPipelineSelfTestResidue(empty.id)).toBe(false)

    simulateKill = true
    expect((await readJson(await runSelfTest())).success).toBe(true)
    const [sandbox] = observed
    expect(isPipelineSelfTestResidue(sandbox.caseId)).toBe(true)
    await seedRealCapture(sandbox.caseId)
    rmSync(join(tempDir, 'captures', sandbox.caseId), { recursive: true, force: true })
    expect(isPipelineSelfTestResidue(sandbox.caseId)).toBe(false)

    rmSync(sandbox.root, { recursive: true, force: true })
  })

  // Search fields and extracted data are derived from a capture without an
  // operator asking (captureLifecycle.ts, fieldIndex.ts), so a leftover that
  // gained them still holds nothing but the self-test's own capture.
  it('still reads a killed run as residue once its capture has derived rows', async () => {
    simulateKill = true
    expect((await readJson(await runSelfTest())).success).toBe(true)
    const [sandbox] = observed
    const [capture] = listCaptures(sandbox.caseId)
    replaceExhibitFields(
      {
        exhibitId: capture.id,
        caseId: sandbox.caseId,
        contentHash: capture.hash,
        textHash: null,
        extractor: 'test',
        builtAt: new Date().toISOString(),
        outcome: 'built',
        skippedJson: null
      },
      [
        {
          field: 'email',
          value: 'a@example.com',
          norm: 'a@example.com',
          source: 'text',
          part: null,
          startOffset: 0,
          endOffset: 13
        }
      ]
    )
    insertExtractedData(capture.id, sandbox.caseId, PIPELINE_SELF_TEST_URL, [
      { category: 'Email', subcategory: 'address', value: 'a@example.com' }
    ])

    expect(listCaseDependentTables(sandbox.caseId)).toEqual([
      'capture_texts',
      'captures',
      'case_change_log',
      'case_revisions',
      'exhibit_search_builds',
      'exhibit_search_fields',
      'exhibits',
      'extracted_data'
    ])
    expect(isPipelineSelfTestResidue(sandbox.caseId)).toBe(true)

    rmSync(sandbox.root, { recursive: true, force: true })
  })

  // F4 of the review at b47ea2556ec4: a case an operator named like the sandbox
  // and wrote anything into is theirs. Each entry is one such write.
  const operatorWrites: Array<[string, (caseId: string) => void]> = [
    ['a description', (id) => updateCase({ id, description: 'Subject of the inquiry' })],
    ['a case number', (id) => updateCase({ id, caseNumber: '2026-014' })],
    [
      'another case type',
      (id) => getDb().prepare(`UPDATE cases SET type = 'fraud' WHERE id = ?`).run(id)
    ],
    [
      'an exclusion list',
      (id) => setAutoCapturePolicy(id, { exclusions: ['example.com'], mode: 'stack' })
    ],
    ['an exclusion mode', (id) => setAutoCapturePolicy(id, { exclusions: [], mode: 'override' })],
    ['a sharing mark', (id) => markCaseShared(id, 'owner-installation')],
    ['the demo mark', (id) => setCaseDemo(id, true)],
    ['a note', (id) => createNote({ caseId: id, body: 'Operator note' })],
    ['a selector', (id) => createSelector({ caseId: id, pattern: 'example.com' })],
    [
      'an exhibit that is not a capture',
      (id) =>
        insertExhibit({
          id: `file-${id}`,
          caseId: id,
          kind: 'file',
          origin: 'upload',
          name: 'statement.pdf',
          contentHash: 'a'.repeat(64),
          committedAt: new Date().toISOString()
        })
    ],
    [
      'a capture exhibit with no capture row',
      (id) =>
        insertExhibit({
          id: `capture-${id}`,
          caseId: id,
          kind: 'capture',
          origin: 'extension',
          name: 'Evidence',
          contentHash: 'b'.repeat(64),
          committedAt: new Date().toISOString()
        })
    ]
  ]

  it.each(operatorWrites)('keeps a sandbox-named case holding %s', (_label, write) => {
    const held = createCase({ name: PIPELINE_SELF_TEST_CASE_NAME })
    write(held.id)

    expect(isPipelineSelfTestResidue(held.id)).toBe(false)
    launch()

    expect(getCase(held.id)?.name).toBe(PIPELINE_SELF_TEST_CASE_NAME)
    expect(logged('captureServer.self_test_residue_kept')).toEqual([
      { level: 'info', caseId: held.id }
    ])
    expect(logged('captureServer.self_test_residue_removed')).toEqual([])
  })

  // Rows on the sentinel capture itself: a tag is keyed by exhibit and a
  // favourite by capture, and neither names the case.
  it('keeps a killed run whose sentinel capture an operator tagged or starred', async () => {
    simulateKill = true
    expect((await readJson(await runSelfTest())).success).toBe(true)
    expect((await readJson(await runSelfTest())).success).toBe(true)
    const [tagged, starred] = observed
    addTagToCapture({
      captureId: listCaptures(tagged.caseId)[0].id,
      tagId: createTag({ name: 'Review' }).id
    })
    toggleFavorite(listCaptures(starred.caseId)[0].id)

    expect(isPipelineSelfTestResidue(tagged.caseId)).toBe(false)
    expect(isPipelineSelfTestResidue(starred.caseId)).toBe(false)
    launch()

    expect(listCaptures(tagged.caseId)).toHaveLength(1)
    expect(listCaptures(starred.caseId)).toHaveLength(1)
    expect(existsSync(tagged.root)).toBe(true)
    expect(existsSync(starred.root)).toBe(true)
    expect(
      logged('captureServer.self_test_residue_kept')
        .map((e) => e.caseId)
        .sort()
    ).toEqual([tagged.caseId, starred.caseId].sort())
    expect(logged('captureServer.self_test_residue_removed')).toEqual([])

    rmSync(tagged.root, { recursive: true, force: true })
    rmSync(starred.root, { recursive: true, force: true })
  })

  // A process killed mid-run leaves the case holding the sentinel capture,
  // plus its temp root. The next boot takes both, and nothing else.
  it('sweeps a killed run at startup and leaves every other case alone', async () => {
    const investigation = createCase({ name: 'Real Investigation' })
    await seedRealCapture(investigation.id)
    // Rows of another case, of each kind the residue check reads: by case, by
    // capture and by exhibit. None of them is the residue's.
    const [evidence] = listCaptures(investigation.id)
    createNote({ caseId: investigation.id, body: 'Operator note' })
    toggleFavorite(evidence.id)
    addTagToCapture({ captureId: evidence.id, tagId: createTag({ name: 'Review' }).id })

    simulateKill = true
    expect((await readJson(await runSelfTest())).success).toBe(true)
    expect((await readJson(await runSelfTest())).success).toBe(true)
    const [residue, foreign] = observed
    expect(listCaptures(residue.caseId)).toHaveLength(1)
    expect(existsSync(residue.root)).toBe(true)
    await seedRealCapture(foreign.caseId)
    // A directory holding a folder named for the residue case, but without the
    // sandbox prefix, is not a sandbox root.
    const lookalike = mkdtempSync(join(tmpdir(), 'birdbrain-selftest-lookalike-'))
    mkdirSync(join(lookalike, residue.caseId))

    launch()

    expect(getCase(residue.caseId)).toBeUndefined()
    expect(listCaptures(residue.caseId)).toHaveLength(0)
    expect(existsSync(residue.root)).toBe(false)
    expect(existsSync(join(lookalike, residue.caseId))).toBe(true)
    expect(logged('captureServer.self_test_residue_removed')).toEqual([
      { level: 'info', caseId: residue.caseId }
    ])

    expect(getCase(foreign.caseId)?.name).toBe(PIPELINE_SELF_TEST_CASE_NAME)
    expect(listCaptures(foreign.caseId)).toHaveLength(2)
    expect(readdirSync(join(tempDir, 'captures', foreign.caseId)).length).toBeGreaterThan(0)
    expect(existsSync(foreign.root)).toBe(true)
    expect(logged('captureServer.self_test_residue_kept')).toEqual([
      { level: 'info', caseId: foreign.caseId }
    ])

    expect(getCase(investigation.id)?.name).toBe('Real Investigation')
    expect(listCaptures(investigation.id)).toHaveLength(1)
    expect(cleanupFailures()).toBe(0)

    rmSync(foreign.root, { recursive: true, force: true })
    rmSync(lookalike, { recursive: true, force: true })
  })

  // Archiving is an operator's act on the case, so the sweep does not read it
  // and the check does not accept it.
  it('does not sweep an archived case with the sandbox name', () => {
    const archived = createCase({ name: PIPELINE_SELF_TEST_CASE_NAME })
    updateCase({ id: archived.id, archived: true })

    expect(isPipelineSelfTestResidue(archived.id)).toBe(false)
    launch()

    expect(getCase(archived.id)?.archived).toBe(true)
    expect(logged('captureServer.self_test_residue_removed')).toEqual([])
    // Not read at all: a case the sweep reads and keeps is logged as kept.
    expect(logged('captureServer.self_test_residue_kept')).toEqual([])
    expect(logged('captureServer.self_test_storage_unconfirmed')).toEqual([])
  })

  // The sweep takes a missing folder as proof only under a root that every
  // launch since the case was made has run on. Each test below leaves a
  // sandbox-named case whose only trace of a foreign write is its folder on a
  // volume, and then launches on something else.
  describe('when the storage root is not the one in use since the case was made', () => {
    let volume: string
    let leftover: SandboxObservation

    // Earlier launches on the volume: the first starts its storage record, a
    // self-test is killed, and something other than the self-test leaves a
    // folder for the case there and no row in the database.
    beforeEach(async () => {
      volume = join(tempDir, 'volume', 'captures')
      mkdirSync(volume, { recursive: true })
      launch(volume)
      await tick()
      simulateKill = true
      expect((await readJson(await runSelfTest())).success).toBe(true)
      ;[leftover] = observed
      mkdirSync(join(volume, leftover.caseId))
      expect(isPipelineSelfTestResidue(leftover.caseId)).toBe(false)
    })

    afterEach(() => {
      rmSync(leftover.root, { recursive: true, force: true })
    })

    // Kept at every launch so far, each logged under the storage code at the
    // level given, oldest first, and never removed. The log reads newest first.
    const expectKept = (levels: string[]): void => {
      expect(getCase(leftover.caseId)?.name).toBe(PIPELINE_SELF_TEST_CASE_NAME)
      expect(listCaptures(leftover.caseId)).toHaveLength(1)
      expect(existsSync(leftover.root)).toBe(true)
      expect(logged('captureServer.self_test_storage_unconfirmed').reverse()).toEqual(
        levels.map((level) => ({ level, caseId: leftover.caseId }))
      )
      expect(logged('captureServer.self_test_residue_removed')).toEqual([])
      expect(cleanupFailures()).toBe(0)
    }

    const unmount = (): void => renameSync(dirname(volume), `${dirname(volume)}-unmounted`)

    // The drive is absent and its mount point cannot be written, so boot falls
    // back to the default root. The second launch is the one an earlier guard
    // lost. When the drive returns, the case's folder on it is read again.
    it('keeps the case on every launch while boot falls back, and when the drive returns', () => {
      unmount()
      writeFileSync(dirname(volume), '')
      launch(volume, join(tempDir, 'captures'))
      launch(volume, join(tempDir, 'captures'))
      expectKept(['warn', 'info'])

      rmSync(dirname(volume))
      renameSync(`${dirname(volume)}-unmounted`, dirname(volume))
      launch(volume)
      expectKept(['warn', 'info'])
      expect(logged('captureServer.self_test_residue_kept')).toEqual([
        { level: 'info', caseId: leftover.caseId }
      ])
    })

    // The same absence, but the folder for the case is gone from the drive when
    // it returns. The drive's marker is from before the fallback launches, so
    // the case predates the new run and is still kept.
    it('keeps the case when the drive returns without its folder for the case', () => {
      unmount()
      writeFileSync(dirname(volume), '')
      launch(volume, join(tempDir, 'captures'))

      rmSync(dirname(volume))
      renameSync(`${dirname(volume)}-unmounted`, dirname(volume))
      rmSync(join(volume, leftover.caseId), { recursive: true })
      launch(volume)
      launch(volume)
      expectKept(['warn', 'warn', 'info'])
    })

    // The drive is absent and its mount point is writable: `initStorage`
    // creates an empty root there, and the next launch finds it in place.
    it('keeps the case on every launch on a root the app had to create', () => {
      unmount()
      launch(volume)
      launch(volume)
      expectKept(['warn', 'info'])
    })

    it('keeps the case when an empty folder already sits at the configured path', () => {
      unmount()
      mkdirSync(volume, { recursive: true })
      launch(volume)
      launch(volume)
      expectKept(['warn', 'info'])
    })

    it('keeps the case after the storage path changes to another existing folder', () => {
      const other = join(tempDir, 'other')
      mkdirSync(other)
      launch(other)
      launch(other)
      expectKept(['warn', 'info'])
    })

    it('keeps the case when the configured path resolves to another folder', () => {
      const other = join(tempDir, 'other')
      mkdirSync(other)
      unmount()
      mkdirSync(dirname(volume))
      symlinkSync(other, volume)
      launch(volume)
      launch(volume)
      expectKept(['warn', 'info'])
    })

    // The copy predates the case's folder and one launch. That launch rewrote
    // the marker, so the restored root carries one the record no longer names.
    it('keeps the case when the root is restored from a copy older than the last launch', () => {
      const backup = join(tempDir, 'backup')
      cpSync(volume, backup, { recursive: true })
      rmSync(join(backup, leftover.caseId), { recursive: true })
      launch(volume)
      expect(logged('captureServer.self_test_residue_kept')).toEqual([
        { level: 'info', caseId: leftover.caseId }
      ])

      rmSync(volume, { recursive: true })
      cpSync(backup, volume, { recursive: true })
      launch(volume)
      launch(volume)
      expectKept(['warn', 'info'])
    })

    // The state of an install that held a leftover before the record existed.
    it('keeps a case made before the storage record began', () => {
      rmSync(join(volume, leftover.caseId), { recursive: true })
      rmSync(join(tempDir, 'storage-root.json'))
      launch(volume)
      launch(volume)
      expectKept(['warn', 'info'])
    })

    it('keeps the case when the storage record cannot be written', () => {
      rmSync(join(volume, leftover.caseId), { recursive: true })
      initStorage(volume)
      sweepPipelineSelfTestResidue(join(tempDir, 'no-such-folder'))
      expectKept(['warn'])
    })

    it.skipIf(process.getuid?.() === 0)(
      'keeps the case when the marker cannot be rewritten',
      () => {
        rmSync(join(volume, leftover.caseId), { recursive: true })
        chmodSync(join(volume, '.birdbrain-storage-root.json'), 0o400)
        launch(volume)
        expectKept(['warn'])
      }
    )

    // The marker can be read and rewritten by name, but the root cannot be
    // listed, so the case having no folder there is not known.
    it.skipIf(process.getuid?.() === 0)(
      'keeps the case when the root is the right one and cannot be listed',
      () => {
        chmodSync(volume, 0o300)
        try {
          expect(isPipelineSelfTestResidue(leftover.caseId)).toBe(false)
          launch(volume)
        } finally {
          chmodSync(volume, 0o700)
        }
        expectKept([])
        expect(logged('captureServer.self_test_storage_unavailable')).toEqual([
          { level: 'warn', caseId: leftover.caseId }
        ])
      }
    )

    // The control: every launch since the case was made ran on the volume,
    // and the volume holds no folder for it.
    it('sweeps the case when the root is the one in use since it was made', () => {
      rmSync(join(volume, leftover.caseId), { recursive: true })

      launch(volume)

      expect(getCase(leftover.caseId)).toBeUndefined()
      expect(existsSync(leftover.root)).toBe(false)
      expect(logged('captureServer.self_test_storage_unconfirmed')).toEqual([])
      expect(logged('captureServer.self_test_residue_removed')).toEqual([
        { level: 'info', caseId: leftover.caseId }
      ])
    })
  })

  // A fresh install: no case, and a root the first launch creates. That launch
  // starts the record, so a run killed afterwards is swept at the next one.
  it('starts the storage record on a fresh install and sweeps a run killed after it', async () => {
    const fresh = join(tempDir, 'fresh', 'captures')
    launch(fresh)
    expect(logged('captureServer.self_test_storage_unconfirmed')).toEqual([])
    await tick()

    simulateKill = true
    expect((await readJson(await runSelfTest())).success).toBe(true)
    const [residue] = observed
    launch(fresh)

    expect(getCase(residue.caseId)).toBeUndefined()
    expect(existsSync(residue.root)).toBe(false)
    expect(logged('captureServer.self_test_residue_removed')).toEqual([
      { level: 'info', caseId: residue.caseId }
    ])
  })

  // A table a later migration adds is found by a foreign key under any column
  // name, through as many tables as the key chain has, or by one of the three
  // column names. `elsewhere` is a row of the new table that names another
  // case, or nothing: it must not keep this one.
  interface LaterTable {
    ddl: string
    column: string
    names: (sandbox: SandboxObservation) => string
    elsewhere: (other: { caseId: string; captureId: string }) => string | null
  }
  const laterTables: Array<[string, LaterTable]> = [
    [
      'a foreign key to the case under another column name',
      {
        ddl: 'CREATE TABLE owner_marks (owner_case TEXT REFERENCES cases(id))',
        column: 'owner_case',
        names: ({ caseId }) => caseId,
        elsewhere: ({ caseId }) => caseId
      }
    ],
    [
      'a foreign key to the case that names no column',
      {
        ddl: 'CREATE TABLE case_flags (flagged TEXT REFERENCES cases)',
        column: 'flagged',
        names: ({ caseId }) => caseId,
        elsewhere: ({ caseId }) => caseId
      }
    ],
    [
      'a foreign key to one of its captures',
      {
        ddl: 'CREATE TABLE capture_flags (flagged TEXT REFERENCES captures(id))',
        column: 'flagged',
        names: ({ caseId }) => listCaptures(caseId)[0].id,
        elsewhere: ({ captureId }) => captureId
      }
    ],
    [
      'a foreign key to a row the app derived from its capture',
      {
        ddl: 'CREATE TABLE build_reviews (build TEXT REFERENCES exhibit_search_builds(exhibit_id))',
        column: 'build',
        names: ({ caseId }) => listCaptures(caseId)[0].id,
        elsewhere: () => null
      }
    ],
    [
      'a foreign key beside one to its own table',
      {
        ddl: 'CREATE TABLE threads (id TEXT PRIMARY KEY, parent TEXT REFERENCES threads(id), owner_case TEXT REFERENCES cases(id))',
        column: 'owner_case',
        names: ({ caseId }) => caseId,
        elsewhere: ({ caseId }) => caseId
      }
    ],
    [
      'a case_id column and no foreign key',
      {
        ddl: 'CREATE TABLE background_jobs (case_id TEXT)',
        column: 'case_id',
        names: ({ caseId }) => caseId,
        elsewhere: ({ caseId }) => caseId
      }
    ]
  ]

  it.each(laterTables)(
    'keeps a killed run that a later table names by %s',
    async (_label, table) => {
      const investigation = createCase({ name: 'Real Investigation' })
      await seedRealCapture(investigation.id)
      simulateKill = true
      expect((await readJson(await runSelfTest())).success).toBe(true)
      const [sandbox] = observed
      const [capture] = listCaptures(sandbox.caseId)
      replaceExhibitFields(
        {
          exhibitId: capture.id,
          caseId: sandbox.caseId,
          contentHash: capture.hash,
          textHash: null,
          extractor: 'test',
          builtAt: new Date().toISOString(),
          outcome: 'no-source',
          skippedJson: null
        },
        []
      )
      const insert = `INSERT INTO ${table.ddl.split(' ')[2]} (${table.column}) VALUES (?)`
      getDb().exec(table.ddl)
      getDb()
        .prepare(insert)
        .run(
          table.elsewhere({
            caseId: investigation.id,
            captureId: listCaptures(investigation.id)[0].id
          })
        )
      expect(isPipelineSelfTestResidue(sandbox.caseId)).toBe(true)

      getDb().prepare(insert).run(table.names(sandbox))
      expect(isPipelineSelfTestResidue(sandbox.caseId)).toBe(false)
      launch()

      expect(listCaptures(sandbox.caseId)).toHaveLength(1)
      expect(logged('captureServer.self_test_residue_kept')).toEqual([
        { level: 'info', caseId: sandbox.caseId }
      ])

      rmSync(sandbox.root, { recursive: true, force: true })
    }
  )

  // Teardown keeps on the same check as the sweep, whatever made it fail.
  const midRunWrites: Array<[string, (caseId: string) => void]> = [
    ['its row was edited', (id) => updateCase({ id, description: 'Edited during the run' })],
    ['it gained a note', (id) => createNote({ caseId: id, body: 'Operator note' })]
  ]

  it.each(midRunWrites)('keeps the sandbox at teardown when %s, and warns', (_label, write) => {
    const sandbox = createPipelineSelfTestSandbox()
    write(sandbox.caseId)

    sandbox.dispose()

    expect(getCase(sandbox.caseId)?.name).toBe(PIPELINE_SELF_TEST_CASE_NAME)
    expect(existsSync(sandbox.root)).toBe(true)
    expect(logged('captureServer.self_test_sandbox_kept')).toEqual([
      { level: 'warn', caseId: sandbox.caseId }
    ])
    expect(cleanupFailures()).toBe(0)

    rmSync(sandbox.root, { recursive: true, force: true })
  })

  // Teardown reads the same root, so a root it cannot list keeps the sandbox
  // too, under its own code rather than as a foreign write.
  it.skipIf(process.getuid?.() === 0)(
    'keeps the sandbox at teardown when the storage root cannot be listed',
    () => {
      const sandbox = createPipelineSelfTestSandbox()
      chmodSync(join(tempDir, 'captures'), 0o000)
      try {
        sandbox.dispose()
      } finally {
        chmodSync(join(tempDir, 'captures'), 0o700)
      }

      expect(getCase(sandbox.caseId)?.name).toBe(PIPELINE_SELF_TEST_CASE_NAME)
      expect(existsSync(sandbox.root)).toBe(true)
      expect(logged('captureServer.self_test_storage_unavailable')).toEqual([
        { level: 'warn', caseId: sandbox.caseId }
      ])
      expect(logged('captureServer.self_test_sandbox_kept')).toEqual([])
      expect(cleanupFailures()).toBe(0)

      rmSync(sandbox.root, { recursive: true, force: true })
    }
  )

  // TMPDIR is redirected so the temp root's parent can be made read-only
  // without touching the shared temp directory.
  it.skipIf(process.getuid?.() === 0)(
    'reports a residue temp root the sweep cannot remove, having removed the case',
    async () => {
      const tmpRoot = mkdtempSync(join(tmpdir(), 'birdbrain-selftest-tmp-'))
      const previousTmpdir = process.env.TMPDIR
      process.env.TMPDIR = tmpRoot
      try {
        simulateKill = true
        expect((await readJson(await runSelfTest())).success).toBe(true)
        const [residue] = observed
        chmodSync(tmpRoot, 0o500)

        launch()

        expect(getCase(residue.caseId)).toBeUndefined()
        expect(existsSync(residue.root)).toBe(true)
        expect(logged('captureServer.self_test_cleanup_failed')).toEqual([
          { level: 'error', caseId: residue.caseId }
        ])
        expect(logged('captureServer.self_test_residue_removed')).toEqual([])
      } finally {
        if (previousTmpdir === undefined) delete process.env.TMPDIR
        else process.env.TMPDIR = previousTmpdir
        chmodSync(tmpRoot, 0o700)
        rmSync(tmpRoot, { recursive: true, force: true })
      }
    }
  )
})

// `src/main/index.ts` is outside the unit runner, so the launch order is read
// from its source: the sweep runs once, straight after the storage root is
// set, and before anything that reads cases or can start a self-test.
describe('the self-test residue sweep at launch', () => {
  const boot = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf-8')
  const sweepCall = 'sweepPipelineSelfTestResidue(userDataPath)'

  it('is called exactly once', () => {
    expect(boot.split(sweepCall)).toHaveLength(2)
  })

  // Directly after the block that sets the storage root, at that block's own
  // depth: not inside its fallback branch, and not behind a condition.
  it('follows the storage initialisation block, outside its fallback branch', () => {
    expect(boot).toMatch(
      /\n {8}initStorage\(defaultCapturesDir\)\n {6}\}\n\n(?: {6}\/\/[^\n]*\n)* {6}sweepPipelineSelfTestResidue\(userDataPath\)\n/
    )
  })

  it.each([
    'await seedDemoCaseIfNeeded()',
    'await runExhibitBackfill(',
    'createTimestampWorker()',
    'await startCaptureServer('
  ])('runs before %s', (later) => {
    expect(boot.split(later)).toHaveLength(2)
    expect(boot.indexOf(sweepCall)).toBeLessThan(boot.indexOf(later))
  })
})
