import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createHash } from 'crypto'
import type { BrowserWindow } from 'electron'
import { initDatabase, closeDatabase } from '@main/services/db/core'
import { createCase, getCase, listCases } from '@main/services/db/caseRepo'
import { listCaptures } from '@main/services/db/captureRepo'
import { initStorage } from '@main/services/storage'
import { initSettings, updateSettings } from '@main/services/settings'
import { initInstallationId, resetInstallationId } from '@main/services/installationId'
import {
  setMainWindow,
  startCaptureServer,
  stopCaptureServer,
  resetManualDedup
} from '@main/services/captureServer'
import { createCaptureLifecycle } from '@main/services/captureLifecycle'
import { createSelectorLifecycle } from '@main/services/selectorLifecycle'
import { createSessionService, type SessionService } from '@main/services/session'
import { readEntries, verifyManifestChain } from '@main/services/manifest'
import { disposeLogger, initLogger, readRecentEntries } from '@main/services/logger'
import {
  createPipelineSelfTestSandbox,
  PIPELINE_SELF_TEST_URL,
  type PipelineSelfTestSandbox
} from '@main/services/pipelineSelfTest'
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
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-selftest-'))
    initLogger(tempDir, 'pipeline-self-test-session')
    await initDatabase(':memory:')
    initStorage(join(tempDir, 'captures'))
    initSettings(tempDir)
    updateSettings({ operatorName: 'Test Operator' })
    resetInstallationId()
    initInstallationId(tempDir)
    sessionService = createSessionService()
    resetManualDedup()
    // Without a window the capture-event emitter is a no-op, so the event
    // assertions below would pass on an absence rather than on the events.
    setMainWindow({
      isDestroyed: () => false,
      webContents: { send: (channel: string, payload: unknown) => sent.push({ channel, payload }) }
    } as unknown as BrowserWindow)
    baseUrl = `http://127.0.0.1:${port}`
    const selectorLifecycle = createSelectorLifecycle({ emitRematched: () => {} })
    const captureLifecycle = createCaptureLifecycle({ selectorLifecycle })
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

  // Teardown failure, case row half. The route's own result stands, the
  // operator is told, and the root is kept: while the sandbox case is still in
  // the database its capture row must keep pointing at files that exist.
  it('keeps the sandbox root and reports it when the case row cannot be deleted', async () => {
    breakTeardown = () => closeDatabase()

    const data = await readJson(await runSelfTest())
    expect(data.success).toBe(true)

    const [sandbox] = observed
    expect(existsSync(sandbox.root)).toBe(true)
    expect(existsSync(join(sandbox.root, sandbox.caseId, MANIFEST_FILENAME))).toBe(true)
    expect(cleanupFailures()).toBe(1)

    rmSync(sandbox.root, { recursive: true, force: true })
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
})
