import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { initStorage, ensureCaseDir } from '@main/services/storage'
import { initDatabase, closeDatabase, getDb } from '@main/services/db/core'
import { createCase, deleteCase, setAutoCapturePolicy } from '@main/services/db/caseRepo'
import { insertCapture, listCaptures } from '@main/services/db/captureRepo'
import * as backgroundJobRepo from '@main/services/db/backgroundJobRepo'
import { initInstallationId, resetInstallationId } from '@main/services/installationId'
import { initSettings, updateSettings } from '@main/services/settings'
import { createCaptureLifecycle } from '@main/services/captureLifecycle'
import type { SelectorLifecycle } from '@main/services/selectorLifecycle'
import {
  INTERRUPTED_JOB_ERROR,
  RecaptureTimeout,
  STORED_JOB_RETENTION_MS,
  createRecaptureService,
  type RenderedPage,
  type RenderPage
} from '@main/services/recapture'
import { logger } from '@main/services/logger'
import type { BackgroundJobView } from '@shared/ipc'
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

    it('sends a view of the job on every change of state', async () => {
      const svc = makeService()
      const { jobIds } = svc.enqueue([{ url: 'https://example.com/a', caseId }])
      await svc.idle()
      expect(jobs.map(({ jobId, state }) => [jobId, state])).toEqual([
        [jobIds[0], 'queued'],
        [jobIds[0], 'running'],
        [jobIds[0], 'stored']
      ])
      // The attempt's id names a Capture only once one is stored under it.
      expect(jobs[1].captureId).toBeUndefined()
      expect(jobs[2].captureId).toBe(newCaptures[0].id)
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
  })

  describe('the pass before the queue runs', () => {
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
})
