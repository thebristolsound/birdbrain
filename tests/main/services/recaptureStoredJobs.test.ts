import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { initStorage, ensureCaseDir, getStorageRoot } from '@main/services/storage'
import { initDatabase, closeDatabase, getDb } from '@main/services/db/core'
import { createCase, deleteCase, setAutoCapturePolicy } from '@main/services/db/caseRepo'
import { getCapture, insertCapture, listCaptures } from '@main/services/db/captureRepo'
import * as backgroundJobRepo from '@main/services/db/backgroundJobRepo'
import { defaultCaptureStore } from '@main/services/captureStore'
import { initInstallationId, resetInstallationId } from '@main/services/installationId'
import { initSettings, updateSettings } from '@main/services/settings'
import { createCaptureLifecycle } from '@main/services/captureLifecycle'
import type { SelectorLifecycle } from '@main/services/selectorLifecycle'
import {
  CANCELLED_JOB_ERROR,
  INTERRUPTED_JOB_ERROR,
  QUEUE_STOPPED_JOB_ERROR,
  RESTORE_REMOVED_CAPTURE_ERROR,
  RESTORE_REMOVED_JOB_ERROR,
  RecaptureCancelled,
  RecaptureTimeout,
  STORED_JOB_RETENTION_MS,
  createRecaptureService,
  type RenderedPage,
  type RenderPage
} from '@main/services/recapture'
import { restoreDatabase } from '@main/services/db/dbRestore'
import { logger } from '@main/services/logger'
import { RefusedAddressError } from '@main/services/localAddressPolicy'
import { MANIFEST_FILENAME } from '@shared/constants'
import type { BackgroundJobView, RecaptureCancelResult } from '@shared/ipc'
import type { CaptureEvent, Capture } from '@shared/types'

vi.mock('@main/services/tlsCertChain', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/services/tlsCertChain')>()
  return { ...actual, fetchCertChain: vi.fn(async () => null) }
})

// The queue's stored job table (docs/specs/2026-11-09-batch-capture-throughput-design.md,
// "Stored job table"): rows instead of an in-memory array, and the pass before the queue runs.

function page(url: string, overrides: Partial<RenderedPage> = {}): RenderedPage {
  return {
    mhtmlStream: (async function* () {
      yield Buffer.from(`mhtml-of-${url}`)
    })(),
    screenshot: Buffer.from('png-bytes'),
    screenshotRecord: {
      scaled: false,
      truncated: false,
      trimmed: false,
      contentWidth: 1280,
      contentHeight: 800,
      width: 1280,
      height: 800
    },
    scrollToLoad: {
      requested: true,
      ran: true,
      outcome: 'stopped-growing',
      endHeight: 800,
      scrollLockLifted: true
    },
    imageSourcePinning: { present: true, pinnedImages: 0, pinnedImagesNotLoaded: 0 },
    text: 'page text',
    title: 'Page Title',
    finalUrl: url,
    httpStatus: 200,
    userAgent: 'HiddenWindow UA',
    browserVersion: 'Chrome/130',
    transactionRecord: { present: false, reason: 'failed', error: new Error('not recorded') },
    pdf: { present: false, reason: 'failed', error: new Error('not printed') },
    cleanup: async () => {},
    ...overrides
  }
}

const render: RenderPage = async (url) => page(url)

const DAY_MS = 24 * 60 * 60 * 1000

describe('stored background jobs', () => {
  let tempDir: string
  let caseId: string
  let events: CaptureEvent[]
  let jobs: BackgroundJobView[]
  let newCaptures: Capture[]
  const selectorLifecycle = {
    runActiveSelectorsForCapture: vi.fn()
  } as unknown as SelectorLifecycle

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-stored-jobs-'))
    initStorage(join(tempDir, 'captures'))
    await initDatabase(':memory:')
    initSettings(tempDir)
    resetInstallationId()
    initInstallationId(tempDir)
    updateSettings({ operatorName: 'Op' })
    caseId = createCase({ name: 'Stored jobs' }).id
    ensureCaseDir(caseId)
    events = []
    jobs = []
    newCaptures = []
  })

  afterEach(() => {
    vi.restoreAllMocks()
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  function makeService(renderPage: RenderPage = render, timeoutMs = 45_000) {
    return createRecaptureService({
      renderPage,
      captureLifecycle: createCaptureLifecycle({ selectorLifecycle }),
      emitEvent: (e) => events.push(e),
      emitNewCapture: (c) => newCaptures.push(c),
      emitJob: (job) => jobs.push(job),
      timeoutMs
    })
  }

  // A render that waits until the test releases it, so a job can be caught `running`.
  function gatedRender(): { renderPage: RenderPage; gate: Array<() => void>; urls: string[] } {
    const gate: Array<() => void> = []
    const urls: string[] = []
    return {
      gate,
      urls,
      renderPage: async (url, opts) => {
        urls.push(url)
        await new Promise<void>((resolve) => gate.push(resolve))
        return render(url, opts)
      }
    }
  }

  // Rows a session before this one left behind, written as that session's queue wrote them.
  function earlierSession(urls: string[], targetCase = caseId, batchId = randomUUID()): string[] {
    const ids = urls.map(() => randomUUID())
    backgroundJobRepo.insertQueuedJobs(
      urls.map((url, i) => ({
        id: ids[i],
        batchId,
        caseId: targetCase,
        url,
        queuedAt: new Date(Date.now() - DAY_MS).toISOString()
      }))
    )
    return ids
  }

  const stateOf = (id: string) => backgroundJobRepo.getJob(id)?.state

  describe('the queue reads and writes rows', () => {
    it('stores one queued row per accepted URL, then runs it to stored with its Capture id', async () => {
      const svc = makeService()
      const { batchId, jobIds } = svc.enqueue([
        { url: 'https://example.com/a', caseId },
        { url: 'not a url', caseId }
      ])
      expect(jobIds).toHaveLength(1)
      await svc.idle()

      const [row] = svc.listJobs({ batchId })
      expect(svc.listJobs({ caseId })).toEqual([row])
      expect(row).toEqual({
        jobId: jobIds[0],
        batchId,
        caseId,
        url: 'https://example.com/a',
        state: 'stored',
        attempts: 1,
        queuedAt: expect.any(String),
        startedAt: expect.any(String),
        finishedAt: expect.any(String),
        captureId: newCaptures[0].id
      })
      const stored = events.find(({ type }) => type === 'stored')!
      expect(stored.captureId).toBe(row.captureId)
      // The Capture's timestamp is the attempt's start, which the row records.
      expect(listCaptures(caseId)[0].timestamp).toBe(row.startedAt)
    })

    it('sends a view of the job on every change of state and phase', async () => {
      const svc = makeService()
      const { jobIds } = svc.enqueue([{ url: 'https://example.com/a', caseId }])
      await svc.idle()
      // This render reports no step, so the only phase is the ingest.
      expect(jobs.map(({ jobId, state, phase }) => [jobId, state, phase])).toEqual([
        [jobIds[0], 'queued', undefined],
        [jobIds[0], 'running', undefined],
        [jobIds[0], 'running', 'ingesting'],
        [jobIds[0], 'stored', undefined]
      ])
      // The attempt's id names a Capture only once one is stored under it.
      expect(jobs[1].captureId).toBeUndefined()
      expect(jobs[3].captureId).toBe(newCaptures[0].id)
    })

    it('keeps the supersede and link fields a job was queued with', async () => {
      const svc = makeService(gatedRender().renderPage)
      const { batchId } = svc.enqueue([
        { url: 'https://example.com/a', caseId, supersedesCaptureId: 'cap-old' }
      ])
      expect(svc.listJobs({ batchId })[0].supersedesCaptureId).toBe('cap-old')
    })

    it('refuses a job for a Case that does not exist, and stores nothing for it', async () => {
      const svc = makeService()
      const res = svc.enqueue([
        { url: 'https://example.com/gone', caseId: 'no-such-case' },
        { url: 'https://example.com/kept', caseId }
      ])
      expect(res.rejected).toEqual([{ url: 'https://example.com/gone', reason: 'Case not found' }])
      expect(svc.listJobs({ batchId: res.batchId }).map(({ url }) => url)).toEqual([
        'https://example.com/kept'
      ])
      await svc.idle()
    })

    it.each([
      [
        'a render that throws',
        (async () => {
          throw new Error('net::ERR_CONNECTION_RESET')
        }) as RenderPage,
        { state: 'failed', failureKind: 'render', error: 'net::ERR_CONNECTION_RESET' }
      ],
      [
        'a render that runs out of time',
        (async () => {
          throw new RecaptureTimeout(45_000)
        }) as RenderPage,
        { state: 'failed', failureKind: 'timeout', error: 'Recapture timed out after 45000ms' }
      ],
      [
        'a redirect to a local address',
        (async (url) => page(url, { finalUrl: 'http://127.0.0.1/admin' })) as RenderPage,
        {
          state: 'skipped',
          failureKind: 'refused-address',
          error: 'Redirects to a loopback address'
        }
      ]
    ])('records %s with its failure kind and message', async (_, renderPage, expected) => {
      const svc = makeService(renderPage)
      const { batchId } = svc.enqueue([{ url: 'https://example.com/a', caseId }])
      await svc.idle()
      const [row] = svc.listJobs({ batchId })
      expect(row).toMatchObject({ ...expected, attempts: 1, finishedAt: expect.any(String) })
      expect(row.captureId).toBeUndefined()
    })

    it('records an ingest that fails as failed with kind ingest', async () => {
      const lifecycle = createCaptureLifecycle({ selectorLifecycle })
      const svc = createRecaptureService({
        renderPage: render,
        captureLifecycle: { ...lifecycle, ingest: () => Promise.reject(new Error('disk full')) },
        emitEvent: (e) => events.push(e),
        emitNewCapture: (c) => newCaptures.push(c)
      })
      const { batchId } = svc.enqueue([{ url: 'https://example.com/a', caseId }])
      await svc.idle()
      expect(svc.listJobs({ batchId })[0]).toMatchObject({
        state: 'failed',
        failureKind: 'ingest',
        error: 'disk full'
      })
    })

    it('records a final address the exclusion list refuses as skipped with kind excluded', async () => {
      setAutoCapturePolicy(caseId, { exclusions: ['secret.example.com'], mode: 'stack' })
      const svc = makeService(async (url) => page(url, { finalUrl: 'https://secret.example.com/' }))
      const { batchId } = svc.enqueue([{ url: 'https://example.com/a', caseId }])
      await svc.idle()
      const [row] = svc.listJobs({ batchId })
      expect(row).toMatchObject({ state: 'skipped', failureKind: 'excluded' })
      expect(row.error).toBe(events.find(({ type }) => type === 'skipped')!.skipReason)
    })

    it('records a refused link source as skipped with kind link-source', async () => {
      insertCapture({
        id: 'source',
        caseId,
        url: 'https://example.com/source',
        title: 'Source',
        hash: 'a'.repeat(64),
        timestamp: '2026-11-09T00:00:00.000Z',
        format: 'mhtml',
        method: 'background'
      })
      const svc = makeService()
      const link = 'https://example.com/linked'
      const { batchId } = svc.enqueueLink({
        urls: [link],
        caseId,
        linkedFrom: { captureId: 'source', linkHref: link }
      })
      await svc.idle()
      expect(svc.listJobs({ batchId })[0]).toMatchObject({
        state: 'skipped',
        failureKind: 'link-source',
        error: 'Link source has no manifest entry',
        linkedFrom: { captureId: 'source', linkHref: link }
      })
    })

    it('stops the loop with an error line when it cannot write a row, and starts again on the next enqueue', async () => {
      const error = vi.spyOn(logger, 'error')
      const { renderPage, gate } = gatedRender()
      const svc = makeService(renderPage)
      svc.enqueue([{ url: 'https://example.com/a', caseId }])
      await vi.waitFor(() => expect(gate).toHaveLength(1))
      closeDatabase()
      gate.shift()!()
      await svc.idle()
      expect(error.mock.calls.map(([, code]) => code)).toContain(
        'backgroundRenderer.job_queue_failed'
      )

      await initDatabase(':memory:')
      caseId = createCase({ name: 'Reopened' }).id
      ensureCaseDir(caseId)
      const { batchId } = svc.enqueue([{ url: 'https://example.com/b', caseId }])
      await vi.waitFor(() => expect(gate).toHaveLength(1))
      gate.shift()!()
      await svc.idle()
      expect(svc.listJobs({ batchId })[0].state).toBe('stored')
    })

    // Review of #2141, second verdict, finding 4: a row must not stay `running` with no job
    // behind it once the database takes a write again.
    it('ends the row of a job whose report threw, and leaves the next job queued', async () => {
      const error = vi.spyOn(logger, 'error')
      vi.spyOn(logger, 'warn').mockImplementation((_source: unknown, code: unknown) => {
        if (code === 'backgroundRenderer.job_failed') throw new Error('log call threw')
        return 'log-id'
      })
      const svc = makeService(async () => {
        throw new Error('render failed')
      })
      const {
        jobIds: [first, second]
      } = svc.enqueue([
        { url: 'https://example.com/a', caseId },
        { url: 'https://example.com/b', caseId }
      ])
      await svc.idle()

      expect(backgroundJobRepo.getJob(first)).toMatchObject({
        state: 'failed',
        failureKind: 'interrupted',
        error: QUEUE_STOPPED_JOB_ERROR,
        finishedAt: expect.any(String)
      })
      expect(stateOf(second)).toBe('queued')
      expect(svc.status()).toMatchObject({ pending: 1, queued: 1, running: 0 })
      expect(error.mock.calls.map(([, code]) => code)).toContain(
        'backgroundRenderer.job_queue_failed'
      )
    })

    it('settles rows an earlier stop left running when the loop next starts', async () => {
      const [orphan, landed] = earlierSession(['https://example.com/o', 'https://example.com/l'])
      const captureId = randomUUID()
      const startedAt = new Date().toISOString()
      backgroundJobRepo.claimNextQueued({ startedAt, captureId: randomUUID() })
      backgroundJobRepo.claimNextQueued({ startedAt, captureId })
      insertCapture({
        id: captureId,
        caseId,
        url: 'https://example.com/l',
        title: 'L',
        hash: 'b'.repeat(64),
        timestamp: '2026-11-09T00:00:00.000Z',
        format: 'mhtml',
        method: 'background'
      })
      const svc = makeService()
      expect(svc.status()).toMatchObject({ running: 2 })

      const { batchId } = svc.enqueue([{ url: 'https://example.com/new', caseId }])
      await svc.idle()

      expect(backgroundJobRepo.getJob(orphan)).toMatchObject({
        state: 'failed',
        failureKind: 'interrupted',
        error: QUEUE_STOPPED_JOB_ERROR
      })
      expect(backgroundJobRepo.getJob(landed)).toMatchObject({ state: 'stored', captureId })
      expect(svc.listJobs({ batchId })[0].state).toBe('stored')
      expect(svc.status()).toMatchObject({ running: 0 })
      expect(jobs.filter(({ jobId }) => jobId === orphan || jobId === landed)).toHaveLength(2)
    })

    it('starts the loop again when asked, as the restore handlers do after a failed restore', async () => {
      const [id] = earlierSession(['https://example.com/a'])
      const renderPage = vi.fn(render)
      const svc = makeService(renderPage)
      await svc.idle()
      expect(renderPage).not.toHaveBeenCalled()

      svc.restartQueue()
      await svc.idle()

      expect(stateOf(id)).toBe('stored')
    })
  })

  describe('the pass before the queue runs', () => {
    it('keeps a stored row for seven days', () => {
      expect(STORED_JOB_RETENTION_MS).toBe(604_800_000)
    })

    // Review of #2141, second verdict, item 3: the operator gate that enqueue applies (X47).
    it.each(['', '  '])(
      'refuses a resume while the operator name is %j, renders nothing and leaves the jobs held',
      async (blank) => {
        const [id] = earlierSession(['https://held.example.com/'])
        const batchId = backgroundJobRepo.getJob(id)!.batchId
        const renderPage = vi.fn(render)
        const svc = makeService(renderPage)
        svc.recoverStoredJobs()
        updateSettings({ operatorName: blank })

        expect(svc.resume(batchId)).toEqual({ resumed: 0, reason: 'Operator name required' })
        await svc.idle()
        expect(renderPage).not.toHaveBeenCalled()
        expect(stateOf(id)).toBe('held')
        expect(events).toEqual([])

        updateSettings({ operatorName: 'Op' })
        expect(svc.resume(batchId)).toEqual({ resumed: 1 })
        await svc.idle()
        expect(stateOf(id)).toBe('stored')
      }
    )

    it('marks a running job interrupted, logs it, and leaves no Capture', async () => {
      const [id] = earlierSession(['https://example.com/a'])
      const captureId = randomUUID()
      backgroundJobRepo.claimNextQueued({ startedAt: new Date().toISOString(), captureId })
      const warn = vi.spyOn(logger, 'warn')

      makeService().recoverStoredJobs()

      expect(backgroundJobRepo.getJob(id)).toMatchObject({
        state: 'failed',
        failureKind: 'interrupted',
        error: INTERRUPTED_JOB_ERROR,
        finishedAt: expect.any(String)
      })
      expect(backgroundJobRepo.getJob(id)?.captureId).toBeUndefined()
      expect(listCaptures(caseId)).toEqual([])
      expect(warn.mock.calls).toEqual([
        [
          'backgroundRenderer',
          'backgroundRenderer.job_failed',
          { captureId, caseId, failureKind: 'interrupted' }
        ]
      ])
      expect(jobs.map(({ jobId, state }) => [jobId, state])).toEqual([[id, 'failed']])
    })

    it('marks a running job stored when the Capture its attempt names is in its Case', async () => {
      const [id] = earlierSession(['https://example.com/a'])
      const captureId = randomUUID()
      backgroundJobRepo.claimNextQueued({ startedAt: new Date().toISOString(), captureId })
      // The app closed after the ingest wrote the Capture and before the row was finished.
      insertCapture({
        id: captureId,
        caseId,
        url: 'https://example.com/a',
        title: 'A',
        hash: 'a'.repeat(64),
        timestamp: '2026-11-09T00:00:00.000Z',
        format: 'mhtml',
        method: 'background'
      })
      const info = vi.spyOn(logger, 'info')
      const warn = vi.spyOn(logger, 'warn')
      const svc = makeService()

      svc.recoverStoredJobs()

      expect(backgroundJobRepo.getJob(id)).toMatchObject({
        state: 'stored',
        captureId,
        finishedAt: expect.any(String)
      })
      expect(backgroundJobRepo.getJob(id)).not.toHaveProperty('failureKind')
      expect(
        info.mock.calls.filter(([, code]) => code === 'backgroundRenderer.job_stored')
      ).toEqual([['backgroundRenderer', 'backgroundRenderer.job_stored', { captureId, caseId }]])
      expect(warn).not.toHaveBeenCalled()
      expect(jobs.map(({ jobId, state }) => [jobId, state])).toEqual([[id, 'stored']])
      // Its Capture is the observation, so there is nothing to retry.
      expect(svc.retry({ jobId: id })).toEqual({ retried: 0 })
    })

    it('holds a queued job, which sends no request', async () => {
      const [id] = earlierSession(['https://held.example.com/'])
      const renderPage = vi.fn(render)
      const svc = makeService(renderPage)

      svc.recoverStoredJobs()
      await svc.idle()

      expect(stateOf(id)).toBe('held')
      expect(renderPage).not.toHaveBeenCalled()
      expect(svc.status()).toMatchObject({
        pending: 0,
        queued: 0,
        held: 1,
        heldBatches: [
          {
            batchId: backgroundJobRepo.getJob(id)!.batchId,
            caseId,
            caseName: 'Stored jobs',
            held: 1
          }
        ]
      })
      expect(jobs.map(({ jobId, state }) => [jobId, state])).toEqual([[id, 'held']])
    })

    it('deletes stored rows past seven days and keeps every other ended row', async () => {
      const ended = (url: string, state: 'stored' | 'failed' | 'skipped', ageMs: number) => {
        const [id] = earlierSession([url])
        backgroundJobRepo.claimNextQueued({ startedAt: new Date().toISOString(), captureId: id })
        backgroundJobRepo.finishJob(id, {
          state,
          finishedAt: new Date(Date.now() - ageMs).toISOString()
        })
        return id
      }
      const oldStored = ended('https://example.com/old', 'stored', STORED_JOB_RETENTION_MS + 1000)
      const newStored = ended('https://example.com/new', 'stored', STORED_JOB_RETENTION_MS - 60_000)
      const oldFailed = ended('https://example.com/f', 'failed', 30 * DAY_MS)
      const oldSkipped = ended('https://example.com/s', 'skipped', 30 * DAY_MS)

      makeService().recoverStoredJobs()

      expect(backgroundJobRepo.getJob(oldStored)).toBeUndefined()
      expect([newStored, oldFailed, oldSkipped].map(stateOf)).toEqual([
        'stored',
        'failed',
        'skipped'
      ])
    })

    it('runs a Batch queued in this session ahead of held ones, and a held one only once resumed', async () => {
      const heldIds = earlierSession(['https://held.example.com/1', 'https://held.example.com/2'])
      const heldBatch = backgroundJobRepo.getJob(heldIds[0])!.batchId
      const { renderPage, gate, urls } = gatedRender()
      const svc = makeService(renderPage)
      svc.recoverStoredJobs()

      const fresh = svc.enqueue([{ url: 'https://fresh.example.com/', caseId }])
      await vi.waitFor(() => expect(gate).toHaveLength(1))
      gate.shift()!()
      await svc.idle()
      expect(urls).toEqual(['https://fresh.example.com/'])
      expect(svc.listJobs({ batchId: fresh.batchId })[0].state).toBe('stored')
      expect(heldIds.map(stateOf)).toEqual(['held', 'held'])

      expect(svc.resume('another-batch')).toEqual({ resumed: 0 })
      expect(svc.resume(heldBatch)).toEqual({ resumed: 2 })
      for (let i = 0; i < 2; i++) {
        await vi.waitFor(() => expect(gate).toHaveLength(1))
        gate.shift()!()
      }
      await svc.idle()
      expect(urls).toEqual([
        'https://fresh.example.com/',
        'https://held.example.com/1',
        'https://held.example.com/2'
      ])
      expect(heldIds.map(stateOf)).toEqual(['stored', 'stored'])
      expect(svc.status().held).toBe(0)
    })

    it('holds a queued job and interrupts a running one in a restored copy, as at startup', async () => {
      // A restore re-opens the database in the running app; ipcHandlers runs the pass after it.
      const svc = makeService()
      const [running, queued] = earlierSession(['https://example.com/r', 'https://example.com/q'])
      backgroundJobRepo.claimNextQueued({ startedAt: new Date().toISOString(), captureId: 'c' })
      svc.recoverStoredJobs()
      expect([running, queued].map(stateOf)).toEqual(['failed', 'held'])
    })

    it('runs a resumed Batch after the jobs already queued, and before a Batch queued later', async () => {
      const tick = () => new Promise((resolve) => setTimeout(resolve, 5))
      const heldIds = earlierSession(['https://held.example.com/1', 'https://held.example.com/2'])
      const heldBatch = backgroundJobRepo.getJob(heldIds[0])!.batchId
      const { renderPage, gate, urls } = gatedRender()
      const svc = makeService(renderPage)
      svc.recoverStoredJobs()

      svc.enqueue([
        { url: 'https://fresh.example.com/1', caseId },
        { url: 'https://fresh.example.com/2', caseId }
      ])
      await vi.waitFor(() => expect(gate).toHaveLength(1))
      await tick()
      expect(svc.resume(heldBatch)).toEqual({ resumed: 2 })
      await tick()
      svc.enqueue([{ url: 'https://later.example.com/', caseId }])
      for (let i = 0; i < 5; i++) {
        await vi.waitFor(() => expect(gate).toHaveLength(1))
        gate.shift()!()
      }
      await svc.idle()

      expect(urls).toEqual([
        'https://fresh.example.com/1',
        'https://fresh.example.com/2',
        'https://held.example.com/1',
        'https://held.example.com/2',
        'https://later.example.com/'
      ])
    })
  })

  describe('a restore in the running app', () => {
    let dbPath: string
    let backup: string

    // A file database, as a restore replaces one; the Case exists in every copy taken after this.
    beforeEach(async () => {
      closeDatabase()
      dbPath = join(tempDir, 'birdbrain.db')
      backup = join(tempDir, 'backup.db')
      await initDatabase(dbPath)
      caseId = createCase({ name: 'Restored' }).id
      ensureCaseDir(caseId)
    })

    const takeBackup = () => getDb().exec(`VACUUM INTO '${backup}'`)

    // What the restore handlers do: read this session's jobs, replace the file, re-open, finish.
    async function restore(svc: ReturnType<typeof makeService>): Promise<void> {
      const before = svc.beginRestore()
      closeDatabase()
      copyFileSync(backup, dbPath)
      await initDatabase(dbPath)
      svc.finishRestore(before)
    }

    it('lets the job still running end stored when the restored copy holds its row as running', async () => {
      const { renderPage, gate } = gatedRender()
      const svc = makeService(renderPage)
      const {
        jobIds: [running]
      } = svc.enqueue([{ url: 'https://example.com/x', caseId }])
      await vi.waitFor(() => expect(gate).toHaveLength(1))
      // Another row left `running`, as by a process that is gone, still ends interrupted.
      const [orphan] = earlierSession(['https://example.com/orphan'])
      getDb().prepare("UPDATE background_jobs SET state = 'running' WHERE id = ?").run(orphan)
      takeBackup()

      await restore(svc)
      expect([running, orphan].map(stateOf)).toEqual(['running', 'failed'])
      expect(backgroundJobRepo.getJob(orphan)?.failureKind).toBe('interrupted')

      gate.shift()!()
      await svc.idle()
      expect(backgroundJobRepo.getJob(running)).toMatchObject({
        state: 'stored',
        captureId: newCaptures[0].id
      })
    })

    it('lets a render go on when its phase cannot be written while the database is closed', async () => {
      const warn = vi.spyOn(logger, 'warn')
      const svc = makeService(async (url, opts) => {
        opts.onStep?.('setup')
        closeDatabase()
        opts.onStep?.('scroll')
        opts.onStep?.('settle')
        await initDatabase(dbPath)
        return render(url, opts)
      })
      const {
        jobIds: [id]
      } = svc.enqueue([{ url: 'https://example.com/x', caseId }])
      await svc.idle()
      expect(backgroundJobRepo.getJob(id)).toMatchObject({
        state: 'stored',
        captureId: newCaptures[0].id
      })
      expect(jobs.filter(({ state }) => state === 'running').map(({ phase }) => phase)).toEqual([
        undefined,
        'loading',
        'ingesting'
      ])
      // Once per job, by its ids, though two phases went unwritten.
      const lines = warn.mock.calls.filter(
        ([, code]) => code === 'backgroundRenderer.job_phase_failed'
      )
      expect(lines).toEqual([
        [
          'backgroundRenderer',
          'backgroundRenderer.job_phase_failed',
          { captureId: newCaptures[0].id, caseId },
          expect.any(Error)
        ]
      ])
      expect(JSON.stringify(lines)).not.toContain('example.com')
    })

    // Review of #2141, finding 1: the copy can predate the claim, or the resume before it.
    it.each(['queued', 'held'] as const)(
      'lets the job still running end stored when the restored copy holds its row as %s',
      async (copied) => {
        const { renderPage, gate, urls } = gatedRender()
        const svc = makeService(renderPage)
        const {
          batchId,
          jobIds: [running]
        } = svc.enqueue([{ url: 'https://example.com/x', caseId }])
        await vi.waitFor(() => expect(gate).toHaveLength(1))
        const claimed = backgroundJobRepo.getJob(running)
        // The row as a backup taken before the claim holds it.
        getDb()
          .prepare(
            `UPDATE background_jobs
                SET state = ?, attempts = 0, started_at = NULL, capture_id = NULL WHERE id = ?`
          )
          .run(copied, running)
        takeBackup()

        await restore(svc)
        expect(backgroundJobRepo.getJob(running)).toEqual(claimed)
        expect(svc.status()).toMatchObject({ running: 1, held: 0 })

        gate.shift()!()
        await svc.idle()
        expect(backgroundJobRepo.getJob(running)).toMatchObject({
          state: 'stored',
          captureId: newCaptures[0].id
        })
        expect(jobs.at(-1)).toMatchObject({ jobId: running, state: 'stored' })
        // Nothing is left to resume, so the page is not captured a second time.
        expect(svc.resume(batchId)).toEqual({ resumed: 0 })
        await svc.idle()
        expect(urls).toEqual(['https://example.com/x'])
        expect(listCaptures(caseId)).toHaveLength(1)
      }
    )

    // Review of #2146, second verdict, finding 5: the row goes back with the phase the job has
    // reached, not the phase the claim read.
    it('writes the running job back with the phase it has reached', async () => {
      const gate: Array<() => void> = []
      const svc = makeService(async (url, opts) => {
        opts.onStep?.('setup')
        opts.onStep?.('scroll')
        await new Promise<void>((resolve) => gate.push(resolve))
        return render(url, opts)
      })
      const {
        jobIds: [running]
      } = svc.enqueue([{ url: 'https://example.com/x', caseId }])
      await vi.waitFor(() => expect(gate).toHaveLength(1))
      expect(backgroundJobRepo.getJob(running)?.phase).toBe('scrolling')
      // The row as a backup taken before the claim holds it: queued, with no phase.
      getDb()
        .prepare(
          `UPDATE background_jobs
              SET state = 'queued', phase = NULL, attempts = 0, started_at = NULL,
                  capture_id = NULL
            WHERE id = ?`
        )
        .run(running)
      takeBackup()

      await restore(svc)
      expect(backgroundJobRepo.getJob(running)).toMatchObject({
        state: 'running',
        phase: 'scrolling'
      })

      gate.shift()!()
      await svc.idle()
      expect(stateOf(running)).toBe('stored')
    })

    // Review of #2141, second verdict, finding 1: after a restore that left the file unreadable
    // the app tells the Operator to restore a backup with no database open.
    it('restores with no database open, reading no job and leaving no staging copy', async () => {
      takeBackup()
      const svc = makeService()
      closeDatabase()
      expect(svc.beginRestore()).toEqual([])

      let before: BackgroundJobView[] | undefined
      const outcome = await restoreDatabase(
        { kind: 'file', path: backup },
        {
          dbPath,
          beforeClose: () => {
            before = svc.beginRestore()
          }
        }
      )

      expect(outcome).toEqual({ status: 'restored' })
      expect(before).toEqual([])
      svc.finishRestore(before ?? [])
      expect(svc.status()).toMatchObject({ pending: 0, held: 0 })
      expect(readdirSync(tempDir).filter((name) => name.startsWith('birdbrain.db.'))).toEqual([])
    })

    it('ends with a failed event each job of this session that the restored copy does not hold', async () => {
      takeBackup()
      const { renderPage, gate } = gatedRender()
      const svc = makeService(renderPage)
      const {
        jobIds: [running, queued]
      } = svc.enqueue([
        { url: 'https://example.com/a', caseId },
        { url: 'https://example.com/b', caseId }
      ])
      await vi.waitFor(() => expect(gate).toHaveLength(1))

      await restore(svc)
      const removed = events.filter(({ error }) => error === RESTORE_REMOVED_JOB_ERROR)
      expect(removed).toEqual([
        expect.objectContaining({ type: 'failed', jobId: queued, url: 'https://example.com/b' })
      ])
      expect(jobs.at(-1)).toMatchObject({
        jobId: queued,
        state: 'failed',
        error: RESTORE_REMOVED_JOB_ERROR,
        finishedAt: expect.any(String)
      })

      // The running job's row was written back, so it reports its own end, and nothing is left
      // to claim.
      expect(stateOf(running)).toBe('running')
      gate.shift()!()
      await svc.idle()
      expect(events.filter(({ jobId }) => jobId === running).map(({ type }) => type)).toEqual([
        'queued',
        'received',
        'stored'
      ])
      expect(backgroundJobRepo.getJob(running)).toMatchObject({
        state: 'stored',
        captureId: newCaptures[0].id
      })
      expect(gate).toHaveLength(0)
    })

    // The restore lands after the ingest committed the Capture, while the job's cleanup runs.
    it('ends failed a job whose Capture the restored copy lacks, though its ingest stored it', async () => {
      const warn = vi.spyOn(logger, 'warn')
      const info = vi.spyOn(logger, 'info')
      let releaseCleanup: () => void = () => {}
      const cleanupHeld = new Promise<void>((resolve) => (releaseCleanup = resolve))
      let cleaning = false
      const svc = makeService(async (url) =>
        page(url, {
          cleanup: () => {
            cleaning = true
            return cleanupHeld
          }
        })
      )
      takeBackup()
      const {
        jobIds: [id]
      } = svc.enqueue([{ url: 'https://example.com/a', caseId }])
      await vi.waitFor(() => expect(cleaning).toBe(true))
      const [{ id: captureId }] = listCaptures(caseId)

      await restore(svc)
      expect(stateOf(id)).toBe('running')
      expect(listCaptures(caseId)).toEqual([])

      releaseCleanup()
      await svc.idle()
      const row = backgroundJobRepo.getJob(id)!
      expect(row).toMatchObject({
        state: 'failed',
        failureKind: 'interrupted',
        error: RESTORE_REMOVED_CAPTURE_ERROR
      })
      expect(row).not.toHaveProperty('captureId')
      expect(
        warn.mock.calls.filter(([, code]) => code === 'backgroundRenderer.job_failed')
      ).toEqual([
        [
          'backgroundRenderer',
          'backgroundRenderer.job_failed',
          { captureId, caseId, failureKind: 'interrupted' }
        ]
      ])
      // No stored line for a job whose row says it failed.
      expect(info.mock.calls.map(([, code]) => code)).not.toContain('backgroundRenderer.job_stored')
    })
  })

  describe('the exclusion check before the render', () => {
    it('skips a held job whose address the list refuses by the time it resumes, sending no request', async () => {
      const [id] = earlierSession(['https://secret.example.com/page'])
      const renderPage = vi.fn(render)
      const svc = makeService(renderPage)
      svc.recoverStoredJobs()
      setAutoCapturePolicy(caseId, { exclusions: ['secret.example.com'], mode: 'stack' })

      svc.resume(backgroundJobRepo.getJob(id)!.batchId)
      await svc.idle()

      expect(renderPage).not.toHaveBeenCalled()
      expect(backgroundJobRepo.getJob(id)).toMatchObject({
        state: 'skipped',
        failureKind: 'excluded'
      })
      expect(events.map(({ type }) => type)).toEqual(['received', 'skipped'])
      expect(backgroundJobRepo.getJob(id)?.error).toBe(events[1].skipReason)
    })
  })

  describe('dismiss', () => {
    const STATES = [
      'queued',
      'held',
      'running',
      'stored',
      'skipped',
      'failed',
      'cancelled'
    ] as const

    // One row in each state, set directly: no route of this slice ends a job `cancelled`.
    function oneOfEach(batchId = randomUUID()): string[] {
      const ids = earlierSession(
        STATES.map((state) => `https://example.com/${state}`),
        caseId,
        batchId
      )
      const set = getDb().prepare('UPDATE background_jobs SET state = ? WHERE id = ?')
      STATES.forEach((state, i) => set.run(state, ids[i]))
      return ids
    }

    it('deletes a failed, skipped or cancelled job and refuses every other state', () => {
      const svc = makeService()
      const ids = oneOfEach()
      STATES.forEach((state, i) => {
        const dismissable = ['failed', 'skipped', 'cancelled'].includes(state)
        expect([state, svc.dismiss({ jobId: ids[i] })]).toEqual([
          state,
          { dismissed: dismissable ? 1 : 0 }
        ])
      })
      expect(ids.map(stateOf)).toEqual([
        'queued',
        'held',
        'running',
        'stored',
        undefined,
        undefined,
        undefined
      ])
    })

    it('dismisses only the ended rows of the Batch it names', () => {
      const svc = makeService()
      const batchId = randomUUID()
      const ids = oneOfEach(batchId)
      const [otherFailed] = earlierSession(['https://example.com/other'])
      getDb().prepare("UPDATE background_jobs SET state = 'failed' WHERE id = ?").run(otherFailed)

      expect(svc.dismiss({ batchId })).toEqual({ dismissed: 3 })
      expect(svc.listJobs({ batchId }).map(({ state }) => state)).toEqual([
        'queued',
        'held',
        'running',
        'stored'
      ])
      expect(stateOf(otherFailed)).toBe('failed')
      expect(ids).toHaveLength(STATES.length)
    })
  })

  describe('Case delete', () => {
    it('deletes the Case’s jobs through the foreign key', async () => {
      const other = createCase({ name: 'Other' }).id
      earlierSession(['https://example.com/a'])
      const [kept] = earlierSession(['https://example.com/b'], other)
      const svc = makeService()
      svc.recoverStoredJobs()

      expect(deleteCase(caseId)).toBe(true)
      expect(svc.listJobs({ caseId })).toEqual([])
      expect(stateOf(kept)).toBe('held')
    })

    it('fails a running job at ingest when its Case is deleted during the render', async () => {
      const { renderPage, gate } = gatedRender()
      const svc = makeService(renderPage)
      svc.enqueue([{ url: 'https://example.com/a', caseId }])
      await vi.waitFor(() => expect(gate).toHaveLength(1))
      const sent = jobs.length

      deleteCase(caseId)
      gate.shift()!()
      await svc.idle()

      expect(events.map(({ type }) => type)).toEqual(['queued', 'received', 'failed'])
      expect(listCaptures(caseId)).toEqual([])
      expect(newCaptures).toEqual([])
      // The row went with its Case, so there is no state left to report.
      expect(jobs).toHaveLength(sent)
      expect(svc.status()).toMatchObject({ pending: 0, running: 0 })
    })
  })

  // The Case's manifest lines that record a Capture.
  function captureEntries(): string[] {
    const manifest = join(getStorageRoot(), caseId, MANIFEST_FILENAME)
    if (!existsSync(manifest)) return []
    return readFileSync(manifest, 'utf-8')
      .split('\n')
      .filter((line) => line.includes('"type":"capture"'))
  }

  const rawCaptureId = (id: string): unknown =>
    (
      getDb().prepare('SELECT capture_id FROM background_jobs WHERE id = ?').get(id) as {
        capture_id: unknown
      }
    ).capture_id

  const RENDER_STEPS = [
    'setup',
    'load',
    'network-idle',
    'scroll',
    'post-scroll-idle',
    'settle',
    'images',
    'artifacts',
    'transaction-record',
    'pdf'
  ] as const

  describe('the phase of a running job', () => {
    it('moves the row and the view through the phases in order, and clears it at the end', async () => {
      const rowPhases: Array<string | undefined> = []
      const svc = makeService(async (url, opts) => {
        for (const step of RENDER_STEPS) {
          opts.onStep?.(step)
          rowPhases.push(backgroundJobRepo.listJobs({ caseId })[0].phase)
        }
        return render(url, opts)
      })
      const {
        jobIds: [id]
      } = svc.enqueue([{ url: 'https://example.com/a', caseId }])
      await svc.idle()

      expect(rowPhases).toEqual([
        'loading',
        'loading',
        'loading',
        'scrolling',
        'scrolling',
        'settling',
        'settling',
        'artifacts',
        'transaction-record',
        'pdf'
      ])
      // One view per change of phase, with no timing in it.
      expect(jobs.map(({ state, phase }) => [state, phase])).toEqual([
        ['queued', undefined],
        ['running', undefined],
        ['running', 'loading'],
        ['running', 'scrolling'],
        ['running', 'settling'],
        ['running', 'artifacts'],
        ['running', 'transaction-record'],
        ['running', 'pdf'],
        ['running', 'ingesting'],
        ['stored', undefined]
      ])
      expect(Object.keys(jobs[2]).sort()).toEqual(Object.keys(jobs[1]).concat('phase').sort())
      expect(backgroundJobRepo.getJob(id)).not.toHaveProperty('phase')
      expect(getDb().prepare('SELECT phase FROM background_jobs').all()).toEqual([{ phase: null }])
    })

    it('clears the phase of a job whose render fails', async () => {
      const svc = makeService(async (_url, { onStep }) => {
        onStep?.('setup')
        onStep?.('scroll')
        throw new Error('net::ERR_CONNECTION_RESET')
      })
      svc.enqueue([{ url: 'https://example.com/a', caseId }])
      await svc.idle()
      expect(jobs.map(({ state, phase }) => [state, phase])).toEqual([
        ['queued', undefined],
        ['running', undefined],
        ['running', 'loading'],
        ['running', 'scrolling'],
        ['failed', undefined]
      ])
      expect(getDb().prepare('SELECT phase FROM background_jobs').all()).toEqual([{ phase: null }])
    })
  })

  describe('cancel', () => {
    // A render that ends only when its signal is aborted. As the renderer does, it reports its
    // end the moment the abort lands and rejects after its wind-down, so a cancel in between
    // meets a job that is ending.
    const abortableRender: RenderPage = (_url, { onStep, signal, onEnd }) =>
      new Promise((_, reject) => {
        onStep?.('setup')
        onStep?.('load')
        signal?.addEventListener('abort', () => {
          onEnd?.()
          setTimeout(() => reject(new RecaptureCancelled()), 20)
        })
      })

    it('cancels a queued job, which sends no request', async () => {
      const info = vi.spyOn(logger, 'info')
      const { renderPage, gate, urls } = gatedRender()
      const svc = makeService(renderPage)
      const {
        jobIds: [first, second]
      } = svc.enqueue([
        { url: 'https://example.com/a', caseId },
        { url: 'https://example.com/b', caseId }
      ])
      await vi.waitFor(() => expect(gate).toHaveLength(1))

      expect(svc.cancel({ jobId: second })).toEqual({ cancelled: 1, refused: 0 })
      expect(backgroundJobRepo.getJob(second)).toEqual({
        jobId: second,
        batchId: expect.any(String),
        caseId,
        url: 'https://example.com/b',
        state: 'cancelled',
        attempts: 0,
        queuedAt: expect.any(String),
        finishedAt: expect.any(String),
        error: CANCELLED_JOB_ERROR
      })
      expect(jobs.at(-1)).toMatchObject({ jobId: second, state: 'cancelled' })
      expect(svc.cancel({ jobId: second })).toEqual({ cancelled: 0, refused: 0 })

      gate.shift()!()
      await svc.idle()
      expect(urls).toEqual(['https://example.com/a'])
      expect(stateOf(first)).toBe('stored')
      expect(
        events
          .filter(({ jobId }) => jobId === second)
          .map(({ type, skipReason }) => [type, skipReason])
      ).toEqual([
        ['queued', undefined],
        ['skipped', CANCELLED_JOB_ERROR]
      ])
      expect(
        info.mock.calls.filter(([, code]) => code === 'backgroundRenderer.job_cancelled')
      ).toEqual([['backgroundRenderer', 'backgroundRenderer.job_cancelled', { caseId }]])
    })

    it('cancels a held Batch, which then has nothing to resume', async () => {
      const ids = earlierSession(['https://held.example.com/1', 'https://held.example.com/2'])
      const { batchId } = backgroundJobRepo.getJob(ids[0])!
      const renderPage = vi.fn(render)
      const svc = makeService(renderPage)
      svc.recoverStoredJobs()

      expect(svc.cancel({ batchId: 'another-batch' })).toEqual({ cancelled: 0, refused: 0 })
      expect(svc.cancel({ batchId })).toEqual({ cancelled: 2, refused: 0 })
      expect(ids.map(stateOf)).toEqual(['cancelled', 'cancelled'])
      expect(svc.resume(batchId)).toEqual({ resumed: 0 })
      await svc.idle()
      expect(renderPage).not.toHaveBeenCalled()
      expect(svc.status()).toMatchObject({ held: 0, heldBatches: [] })
    })

    it('aborts a running job before its ingest, which stores no Capture and no manifest entry', async () => {
      const info = vi.spyOn(logger, 'info')
      const svc = makeService(abortableRender)
      const {
        batchId,
        jobIds: [id]
      } = svc.enqueue([{ url: 'https://example.com/a', caseId }])
      await vi.waitFor(() => expect(backgroundJobRepo.getJob(id)?.phase).toBe('loading'))

      expect(svc.cancel({ jobId: id })).toEqual({ cancelled: 1, refused: 0 })
      // The job is ending cancelled, so a second cancel during its wind-down counts it so.
      expect(svc.cancel({ batchId })).toEqual({ cancelled: 1, refused: 0 })
      await svc.idle()

      expect(backgroundJobRepo.getJob(id)).toEqual({
        jobId: id,
        batchId,
        caseId,
        url: 'https://example.com/a',
        state: 'cancelled',
        attempts: 1,
        queuedAt: expect.any(String),
        startedAt: expect.any(String),
        finishedAt: expect.any(String),
        error: CANCELLED_JOB_ERROR
      })
      expect(listCaptures(caseId)).toEqual([])
      expect(newCaptures).toEqual([])
      expect(captureEntries()).toEqual([])
      expect(events.map(({ type, skipReason }) => [type, skipReason])).toEqual([
        ['queued', undefined],
        ['received', undefined],
        ['skipped', CANCELLED_JOB_ERROR]
      ])
      expect(
        info.mock.calls.filter(([, code]) => code === 'backgroundRenderer.job_cancelled')
      ).toEqual([
        [
          'backgroundRenderer',
          'backgroundRenderer.job_cancelled',
          { captureId: rawCaptureId(id), caseId, ms: expect.any(Number), step: 'load' }
        ]
      ])
    })

    it('stores nothing when the render returns its page after the cancel', async () => {
      const destroy = vi.fn()
      const gate: Array<() => void> = []
      const svc = makeService(async (url) => {
        await new Promise<void>((resolve) => gate.push(resolve))
        const mhtmlStream = Object.assign(
          (async function* () {
            yield Buffer.from('mhtml')
          })(),
          { destroy }
        )
        return page(url, { mhtmlStream })
      })
      const {
        jobIds: [id]
      } = svc.enqueue([{ url: 'https://example.com/a', caseId }])
      await vi.waitFor(() => expect(gate).toHaveLength(1))

      expect(svc.cancel({ jobId: id })).toEqual({ cancelled: 1, refused: 0 })
      gate.shift()!()
      await svc.idle()

      expect(stateOf(id)).toBe('cancelled')
      // The cancel path destroys the stream, and the job's cleanup destroys it again.
      expect(destroy).toHaveBeenCalled()
      expect(listCaptures(caseId)).toEqual([])
      expect(captureEntries()).toEqual([])
      expect(jobs.map(({ phase }) => phase)).not.toContain('ingesting')
    })

    it('refuses a cancel from the moment the render hands over its page, and the job ends stored', async () => {
      const lifecycle = createCaptureLifecycle({ selectorLifecycle })
      const ingestGate: Array<() => void> = []
      const refusals: RecaptureCancelResult[] = []
      const svc = createRecaptureService({
        renderPage: render,
        captureLifecycle: {
          ...lifecycle,
          ingest: async (params) => {
            await new Promise<void>((resolve) => ingestGate.push(resolve))
            return lifecycle.ingest(params)
          }
        },
        emitEvent: (e) => events.push(e),
        emitNewCapture: (c) => newCaptures.push(c),
        // The first thing to hear that the job is ingesting asks to cancel it.
        emitJob: (job) => {
          jobs.push(job)
          if (job.phase === 'ingesting') refusals.push(svc.cancel({ jobId: job.jobId }))
        }
      })
      const {
        batchId,
        jobIds: [id, queued]
      } = svc.enqueue([
        { url: 'https://example.com/a', caseId },
        { url: 'https://example.com/b', caseId }
      ])
      await vi.waitFor(() => expect(ingestGate).toHaveLength(1))

      expect(refusals).toEqual([{ cancelled: 0, refused: 1 }])
      expect(backgroundJobRepo.getJob(id)).toMatchObject({ state: 'running', phase: 'ingesting' })
      // During the ingest, the Batch's cancel ends only the job still queued.
      expect(svc.cancel({ batchId })).toEqual({ cancelled: 1, refused: 1 })
      expect(stateOf(queued)).toBe('cancelled')

      ingestGate.shift()!()
      await svc.idle()
      expect(backgroundJobRepo.getJob(id)).toMatchObject({
        state: 'stored',
        captureId: newCaptures[0].id
      })
      expect(listCaptures(caseId).map(({ id: captureId }) => captureId)).toEqual([
        newCaptures[0].id
      ])
      expect(captureEntries()).toHaveLength(1)
    })

    // A render the deadline or a refused hop has ended takes up to 2 s more to reject.
    function endedRender(error: Error): { renderPage: RenderPage; gate: Array<() => void> } {
      const gate: Array<() => void> = []
      return {
        gate,
        renderPage: async (_url, { onStep, onEnd }) => {
          onStep?.('setup')
          onStep?.('load')
          onEnd?.()
          await new Promise<void>((resolve) => gate.push(resolve))
          throw error
        }
      }
    }

    it.each([
      {
        ending: 'a refused hop',
        error: new RefusedAddressError('a loopback address'),
        row: {
          state: 'skipped',
          failureKind: 'refused-address',
          error: 'Redirects to a loopback address'
        },
        event: 'skipped',
        line: 'backgroundRenderer.job_skipped'
      },
      {
        ending: 'the deadline',
        error: new RecaptureTimeout(45_000),
        row: {
          state: 'failed',
          failureKind: 'timeout',
          error: 'Recapture timed out after 45000ms'
        },
        event: 'failed',
        line: 'backgroundRenderer.job_failed'
      }
    ])(
      'refuses a cancel after $ending ended the render, which keeps that ending',
      async ({ error, row, event, line }) => {
        const info = vi.spyOn(logger, 'info')
        const warn = vi.spyOn(logger, 'warn')
        const { renderPage, gate } = endedRender(error)
        const svc = makeService(renderPage)
        const {
          jobIds: [id]
        } = svc.enqueue([{ url: 'https://example.com/a', caseId }])
        await vi.waitFor(() => expect(gate).toHaveLength(1))

        expect(svc.cancel({ jobId: id })).toEqual({ cancelled: 0, refused: 1 })
        gate.shift()!()
        await svc.idle()

        expect(backgroundJobRepo.getJob(id)).toMatchObject(row)
        expect(events.at(-1)?.type).toBe(event)
        const codes = [...info.mock.calls, ...warn.mock.calls].map(([, code]) => code)
        expect(codes).toContain(line)
        expect(codes).not.toContain('backgroundRenderer.job_cancelled')
        if (row.state === 'skipped') expect(svc.retry({ jobId: id })).toEqual({ retried: 0 })
      }
    )

    it('cancels a link job while its source is checked, before anything is sent', async () => {
      const renderPage = vi.fn(render)
      const svc = makeService(renderPage)
      svc.enqueue([{ url: 'https://example.com/source', caseId }])
      await svc.idle()
      const [source] = newCaptures
      const link = 'https://example.com/linked'

      const {
        jobIds: [id]
      } = svc.enqueueLink({
        urls: [link],
        caseId,
        linkedFrom: { captureId: source.id, linkHref: link }
      })
      expect(stateOf(id)).toBe('running')
      expect(svc.cancel({ jobId: id })).toEqual({ cancelled: 1, refused: 0 })
      await svc.idle()

      expect(stateOf(id)).toBe('cancelled')
      expect(renderPage).toHaveBeenCalledTimes(1)
      expect(captureEntries()).toHaveLength(1)
    })

    it('ends a link job cancelled when its source is refused after the cancel', async () => {
      const info = vi.spyOn(logger, 'info')
      const renderPage = vi.fn(render)
      const svc = makeService(renderPage)
      svc.enqueue([{ url: 'https://example.com/source', caseId }])
      await svc.idle()
      const [source] = newCaptures
      writeFileSync(defaultCaptureStore.resolveAbsolute(source.mhtmlPath!), 'altered bytes')
      const link = 'https://example.com/linked'

      const {
        jobIds: [id]
      } = svc.enqueueLink({
        urls: [link],
        caseId,
        linkedFrom: { captureId: source.id, linkHref: link }
      })
      expect(svc.cancel({ jobId: id })).toEqual({ cancelled: 1, refused: 0 })
      await svc.idle()

      const row = backgroundJobRepo.getJob(id)!
      expect(row).toMatchObject({ state: 'cancelled', error: CANCELLED_JOB_ERROR })
      expect(row).not.toHaveProperty('failureKind')
      expect(renderPage).toHaveBeenCalledTimes(1)
      const codes = info.mock.calls.map(([, code]) => code)
      expect(codes).toContain('backgroundRenderer.job_cancelled')
      expect(codes).not.toContain('backgroundRenderer.job_skipped')
    })

    it('ends a job cancelled when the time limit passes while its cancelled render winds down', async () => {
      const warn = vi.spyOn(logger, 'warn')
      // A render that takes longer to end after a cancel than the time limit has left.
      const svc = makeService((_url, { onStep }) => {
        onStep?.('setup')
        return new Promise<RenderedPage>(() => {})
      }, 40)
      const {
        jobIds: [id]
      } = svc.enqueue([{ url: 'https://example.com/a', caseId }])
      expect(stateOf(id)).toBe('running')

      expect(svc.cancel({ jobId: id })).toEqual({ cancelled: 1, refused: 0 })
      await svc.idle()

      const row = backgroundJobRepo.getJob(id)!
      expect(row).toMatchObject({ state: 'cancelled', error: CANCELLED_JOB_ERROR })
      expect(row).not.toHaveProperty('failureKind')
      expect(events.map(({ type, skipReason }) => [type, skipReason])).toEqual([
        ['queued', undefined],
        ['received', undefined],
        ['skipped', CANCELLED_JOB_ERROR]
      ])
      expect(warn.mock.calls.map(([, code]) => code)).not.toContain('backgroundRenderer.job_failed')
    })
  })

  describe('retry', () => {
    // A render that fails for the addresses in `failing`, and leaves `skipped` at a local address.
    function steeredRender(failing: Set<string>, rendered: string[] = []): RenderPage {
      return async (url, opts) => {
        rendered.push(url)
        if (failing.has(url)) throw new Error('net::ERR_CONNECTION_RESET')
        if (url.endsWith('/skip')) return page(url, { finalUrl: 'http://127.0.0.1/admin' })
        return render(url, opts)
      }
    }

    it('retries a failed job in its Batch, as its next attempt under a new Capture id', async () => {
      const failing = new Set(['https://example.com/a'])
      const svc = makeService(steeredRender(failing))
      const {
        batchId,
        jobIds: [id]
      } = svc.enqueue([{ url: 'https://example.com/a', caseId }])
      await svc.idle()
      expect(backgroundJobRepo.getJob(id)).toMatchObject({ state: 'failed', attempts: 1 })
      const firstAttempt = rawCaptureId(id)
      const seen = { events: events.length, jobs: jobs.length }

      failing.clear()
      expect(svc.retry({ jobId: id })).toEqual({ retried: 1 })
      expect(jobs[seen.jobs]).toEqual({
        jobId: id,
        batchId,
        caseId,
        url: 'https://example.com/a',
        state: 'queued',
        attempts: 1,
        queuedAt: expect.any(String)
      })
      await svc.idle()

      const row = backgroundJobRepo.getJob(id)!
      expect(row).toMatchObject({ state: 'stored', attempts: 2, batchId })
      expect(row).not.toHaveProperty('error')
      expect(row).not.toHaveProperty('failureKind')
      expect(row.captureId).toBe(newCaptures[0].id)
      expect(row.captureId).not.toBe(firstAttempt)
      expect(getCapture(row.captureId!)?.timestamp).toBe(row.startedAt)
      expect(events.slice(seen.events).map(({ type, jobId }) => [type, jobId])).toEqual([
        ['queued', id],
        ['received', id],
        ['stored', id]
      ])
    })

    // The operator gate (X47), as at enqueue and resume: a retry that cannot be signed renders
    // nothing.
    it.each(['', '  '])(
      'refuses a retry while the operator name is %j, renders nothing and leaves the row as it ended',
      async (blank) => {
        const failing = new Set(['https://example.com/a'])
        const rendered: string[] = []
        const svc = makeService(steeredRender(failing, rendered))
        const {
          jobIds: [id]
        } = svc.enqueue([{ url: 'https://example.com/a', caseId }])
        await svc.idle()
        const ended = backgroundJobRepo.getJob(id)
        expect(ended).toMatchObject({ state: 'failed', attempts: 1 })
        const seen = { events: events.length, jobs: jobs.length }
        failing.clear()
        updateSettings({ operatorName: blank })

        expect(svc.retry({ jobId: id })).toEqual({ retried: 0, reason: 'Operator name required' })
        await svc.idle()
        expect(rendered).toEqual(['https://example.com/a'])
        expect(backgroundJobRepo.getJob(id)).toEqual(ended)
        expect(events).toHaveLength(seen.events)
        expect(jobs).toHaveLength(seen.jobs)

        updateSettings({ operatorName: 'Op' })
        expect(svc.retry({ jobId: id })).toEqual({ retried: 1 })
        await svc.idle()
        expect(stateOf(id)).toBe('stored')
      }
    )

    it("retries a Batch's failed and cancelled jobs, and never its skipped or stored ones", async () => {
      const failing = new Set(['https://example.com/fail'])
      const rendered: string[] = []
      const svc = makeService(steeredRender(failing, rendered))
      const urls = ['fail', 'skip', 'ok', 'cancel'].map((name) => `https://example.com/${name}`)
      const {
        batchId,
        jobIds: [fail, skip, ok, cancel]
      } = svc.enqueue(urls.map((url) => ({ url, caseId })))
      expect(svc.cancel({ jobId: cancel })).toEqual({ cancelled: 1, refused: 0 })
      await svc.idle()
      expect([fail, skip, ok, cancel].map(stateOf)).toEqual([
        'failed',
        'skipped',
        'stored',
        'cancelled'
      ])
      const storedCapture = backgroundJobRepo.getJob(ok)!.captureId

      expect(svc.retry({ jobId: skip })).toEqual({ retried: 0 })
      expect(svc.retry({ jobId: ok })).toEqual({ retried: 0 })
      failing.clear()
      rendered.length = 0
      expect(svc.retry({ batchId })).toEqual({ retried: 2 })
      await svc.idle()

      expect(rendered).toEqual(['https://example.com/fail', 'https://example.com/cancel'])
      expect(
        svc.listJobs({ batchId }).map(({ jobId, state, attempts }) => [jobId, state, attempts])
      ).toEqual([
        [fail, 'stored', 2],
        [skip, 'skipped', 1],
        [ok, 'stored', 1],
        [cancel, 'stored', 1]
      ])
      expect(backgroundJobRepo.getJob(ok)!.captureId).toBe(storedCapture)
    })

    it('queues a retried job behind the jobs already queued, and ahead of later ones', async () => {
      const tick = () => new Promise((resolve) => setTimeout(resolve, 5))
      const failing = new Set(['https://example.com/retried'])
      const gate: Array<() => void> = []
      const rendered: string[] = []
      const steered = steeredRender(failing, rendered)
      const svc = makeService(async (url, opts) => {
        if (!failing.has(url)) await new Promise<void>((resolve) => gate.push(resolve))
        return steered(url, opts)
      })
      const {
        jobIds: [retried]
      } = svc.enqueue([{ url: 'https://example.com/retried', caseId }])
      await svc.idle()
      failing.clear()

      svc.enqueue([
        { url: 'https://example.com/queued-1', caseId },
        { url: 'https://example.com/queued-2', caseId }
      ])
      await vi.waitFor(() => expect(gate).toHaveLength(1))
      await tick()
      expect(svc.retry({ jobId: retried })).toEqual({ retried: 1 })
      await tick()
      svc.enqueue([{ url: 'https://example.com/later', caseId }])
      for (let i = 0; i < 4; i++) {
        await vi.waitFor(() => expect(gate).toHaveLength(1))
        gate.shift()!()
      }
      await svc.idle()

      expect(rendered).toEqual([
        'https://example.com/retried',
        'https://example.com/queued-1',
        'https://example.com/queued-2',
        'https://example.com/retried',
        'https://example.com/later'
      ])
      expect(stateOf(retried)).toBe('stored')
    })
  })
})
