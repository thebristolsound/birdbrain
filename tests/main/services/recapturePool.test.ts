import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { copyFileSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { initStorage, ensureCaseDir } from '@main/services/storage'
import { initDatabase, closeDatabase, getDb } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { listCaptures } from '@main/services/db/captureRepo'
import * as backgroundJobRepo from '@main/services/db/backgroundJobRepo'
import { initInstallationId, resetInstallationId } from '@main/services/installationId'
import { initSettings, updateSettings } from '@main/services/settings'
import { createCaptureLifecycle } from '@main/services/captureLifecycle'
import type { SelectorLifecycle } from '@main/services/selectorLifecycle'
import {
  MEMORY_GATE_RETRY_MS,
  MIN_FREE_MEMORY_BYTES,
  jobSite
} from '@main/services/backgroundJobPool'
import {
  RecaptureCancelled,
  createRecaptureService,
  type RenderedPage,
  type RenderPage
} from '@main/services/recapture'
import { logger } from '@main/services/logger'

vi.mock('@main/services/tlsCertChain', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/services/tlsCertChain')>()
  return { ...actual, fetchCertChain: vi.fn(async () => null) }
})

// The worker pool (docs/specs/2026-11-09-batch-capture-throughput-design.md, "Bounded parallel
// workers"): up to two jobs at once, one per site, none started beside another under the memory
// floor.

function page(url: string): RenderedPage {
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
    cleanup: async () => {}
  }
}

const PLENTY = MIN_FREE_MEMORY_BYTES * 4

describe('the background job pool', () => {
  let tempDir: string
  let caseId: string
  const selectorLifecycle = {
    runActiveSelectorsForCapture: vi.fn()
  } as unknown as SelectorLifecycle

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-job-pool-'))
    initStorage(join(tempDir, 'captures'))
    await initDatabase(':memory:')
    initSettings(tempDir)
    resetInstallationId()
    initInstallationId(tempDir)
    updateSettings({ operatorName: 'Op' })
    caseId = createCase({ name: 'Pool' }).id
    ensureCaseDir(caseId)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  // A render held until the test releases it by address; `rendering` is what renders now, and
  // `peak` the most renders one site had at once.
  function heldRenders() {
    const release = new Map<string, () => void>()
    const rendering: string[] = []
    const started: string[] = []
    const peak = new Map<string, number>()
    const renderPage: RenderPage = async (url) => {
      started.push(url)
      rendering.push(url)
      const site = jobSite(url)
      const now = rendering.filter((u) => jobSite(u) === site)
      peak.set(site, Math.max(peak.get(site) ?? 0, now.length))
      await new Promise<void>((resolve) => release.set(url, resolve))
      rendering.splice(rendering.indexOf(url), 1)
      return page(url)
    }
    const finish = (url: string) => {
      const go = release.get(url)
      if (!go) throw new Error(`${url} is not rendering`)
      release.delete(url)
      go()
    }
    return { renderPage, rendering, started, peak, finish }
  }

  function makeService(
    renderPage: RenderPage,
    { concurrency = 2, freeMemory = () => PLENTY } = {}
  ) {
    return createRecaptureService({
      renderPage,
      captureLifecycle: createCaptureLifecycle({ selectorLifecycle }),
      emitEvent: () => {},
      emitNewCapture: () => {},
      timeoutMs: 45_000,
      concurrency,
      freeMemory
    })
  }

  const stateOf = (id: string) => backgroundJobRepo.getJob(id)?.state

  it('renders two jobs for different sites at once, and reports both in the status', async () => {
    const { renderPage, rendering, finish } = heldRenders()
    const svc = makeService(renderPage)
    const urls = ['https://example.com/a', 'https://example.org/b', 'https://example.net/c']
    const { jobIds } = svc.enqueue(urls.map((url) => ({ url, caseId })))

    await vi.waitFor(() => expect(rendering).toEqual([urls[0], urls[1]]))
    expect(svc.status()).toEqual({
      pending: 3,
      queued: 1,
      running: 2,
      held: 0,
      heldBatches: [],
      concurrency: 2,
      activeUrl: urls[0]
    })
    expect(jobIds.map(stateOf)).toEqual(['running', 'running', 'queued'])

    finish(urls[0])
    await vi.waitFor(() => expect(rendering).toEqual([urls[1], urls[2]]))
    expect(svc.status()).toMatchObject({ running: 2, queued: 0, activeUrl: urls[1] })
    finish(urls[1])
    finish(urls[2])
    await svc.idle()
    expect(jobIds.map(stateOf)).toEqual(['stored', 'stored', 'stored'])
    expect(svc.status()).toMatchObject({ pending: 0, running: 0, activeUrl: null })
  })

  it('runs one job at a time when its concurrency is 1', async () => {
    const { renderPage, rendering, finish } = heldRenders()
    const svc = makeService(renderPage, { concurrency: 1 })
    svc.enqueue([
      { url: 'https://example.com/a', caseId },
      { url: 'https://example.org/b', caseId }
    ])
    await vi.waitFor(() => expect(rendering).toEqual(['https://example.com/a']))
    expect(svc.status()).toMatchObject({ running: 1, queued: 1, concurrency: 1 })
    finish('https://example.com/a')
    await vi.waitFor(() => expect(rendering).toEqual(['https://example.org/b']))
    finish('https://example.org/b')
    await svc.idle()
  })

  it('never renders two jobs for one site at once, www and the bare domain included', async () => {
    const { renderPage, rendering, started, peak, finish } = heldRenders()
    const svc = makeService(renderPage)
    svc.enqueue([
      { url: 'https://www.example.com/1', caseId },
      { url: 'https://example.com/2', caseId },
      { url: 'https://shop.example.com/3', caseId },
      { url: 'https://example.org/4', caseId }
    ])

    // The second slot passes over the two example.com jobs to the next site.
    await vi.waitFor(() =>
      expect(rendering).toEqual(['https://www.example.com/1', 'https://example.org/4'])
    )
    finish('https://example.org/4')
    // Nothing else is runnable: both remaining jobs share the running job's site.
    await vi.waitFor(() => expect(stateOf(svc.listJobs({ caseId })[3].jobId)).toBe('stored'))
    expect(rendering).toEqual(['https://www.example.com/1'])

    finish('https://www.example.com/1')
    await vi.waitFor(() => expect(rendering).toEqual(['https://example.com/2']))
    finish('https://example.com/2')
    await vi.waitFor(() => expect(rendering).toEqual(['https://shop.example.com/3']))
    finish('https://shop.example.com/3')
    await svc.idle()

    expect(started).toEqual([
      'https://www.example.com/1',
      'https://example.org/4',
      'https://example.com/2',
      'https://shop.example.com/3'
    ])
    expect(Object.fromEntries(peak)).toEqual({ 'example.com': 1, 'example.org': 1 })
  })

  it('treats each IP address as its own site', async () => {
    const { renderPage, rendering, finish } = heldRenders()
    const svc = makeService(renderPage)
    svc.enqueue([
      { url: 'http://203.0.113.5/a', caseId },
      { url: 'http://203.0.113.5:8080/b', caseId },
      { url: 'http://203.0.113.6/c', caseId }
    ])
    await vi.waitFor(() =>
      expect(rendering).toEqual(['http://203.0.113.5/a', 'http://203.0.113.6/c'])
    )
    finish('http://203.0.113.6/c')
    finish('http://203.0.113.5/a')
    await vi.waitFor(() => expect(rendering).toEqual(['http://203.0.113.5:8080/b']))
    finish('http://203.0.113.5:8080/b')
    await svc.idle()
  })

  it('holds a job beside a running one while free memory is under the floor, until the running one ends', async () => {
    const info = vi.spyOn(logger, 'info')
    const { renderPage, rendering, finish } = heldRenders()
    const freeMemory = vi.fn(() => MIN_FREE_MEMORY_BYTES - 1)
    const svc = makeService(renderPage, { freeMemory })
    const {
      jobIds: [, second]
    } = svc.enqueue([
      { url: 'https://example.com/a', caseId },
      { url: 'https://example.org/b', caseId }
    ])

    // The first job starts with nothing running; the floor holds only a second one.
    await vi.waitFor(() => expect(rendering).toEqual(['https://example.com/a']))
    expect(stateOf(second)).toBe('queued')
    const held = info.mock.calls.filter(([, code]) => code === 'backgroundRenderer.job_memory_held')
    expect(held).toEqual([
      [
        'backgroundRenderer',
        'backgroundRenderer.job_memory_held',
        { bytes: MIN_FREE_MEMORY_BYTES - 1, count: 1 }
      ]
    ])

    finish('https://example.com/a')
    await vi.waitFor(() => expect(rendering).toEqual(['https://example.org/b']))
    finish('https://example.org/b')
    await svc.idle()
    expect(stateOf(second)).toBe('stored')
  })

  it('looks at free memory again after the retry interval, not in a loop, and starts the held job once it is back', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const { renderPage, rendering, finish } = heldRenders()
    let free = MIN_FREE_MEMORY_BYTES - 1
    const freeMemory = vi.fn(() => free)
    const svc = makeService(renderPage, { freeMemory })
    svc.enqueue([
      { url: 'https://example.com/a', caseId },
      { url: 'https://example.org/b', caseId }
    ])
    // The render starts as the job is claimed, inside `enqueue`.
    expect(rendering).toEqual(['https://example.com/a'])
    expect(freeMemory).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(MEMORY_GATE_RETRY_MS - 1)
    expect(freeMemory).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1)
    expect(freeMemory).toHaveBeenCalledTimes(2)
    expect(rendering).toEqual(['https://example.com/a'])

    free = MIN_FREE_MEMORY_BYTES
    vi.advanceTimersByTime(MEMORY_GATE_RETRY_MS)
    expect(freeMemory).toHaveBeenCalledTimes(3)
    expect(rendering).toEqual(['https://example.com/a', 'https://example.org/b'])
    vi.useRealTimers()
    finish('https://example.com/a')
    finish('https://example.org/b')
    await svc.idle()
  })

  it('cancels both running jobs of a Batch, and retries both', async () => {
    let attempt = 0
    const rendering: string[] = []
    const renderPage: RenderPage = (url, { onStep, signal }) => {
      attempt++
      if (attempt > 2) return Promise.resolve(page(url))
      rendering.push(url)
      return new Promise((_, reject) => {
        onStep?.('load')
        signal?.addEventListener('abort', () => reject(new RecaptureCancelled()))
      })
    }
    const svc = makeService(renderPage)
    const {
      batchId,
      jobIds: [a, b]
    } = svc.enqueue([
      { url: 'https://example.com/a', caseId },
      { url: 'https://example.org/b', caseId }
    ])
    await vi.waitFor(() => expect(rendering).toHaveLength(2))

    expect(svc.cancel({ batchId })).toEqual({ cancelled: 2, refused: 0 })
    // Both are already ending, so a second cancel refuses each.
    expect(svc.cancel({ batchId })).toEqual({ cancelled: 0, refused: 2 })
    await svc.idle()
    expect([a, b].map(stateOf)).toEqual(['cancelled', 'cancelled'])

    expect(svc.retry({ batchId })).toEqual({ retried: 2 })
    await svc.idle()
    expect(svc.listJobs({ batchId }).map(({ state, attempts }) => [state, attempts])).toEqual([
      ['stored', 2],
      ['stored', 2]
    ])
  })

  it('cancels one running job by its id and leaves the other running', async () => {
    const rendering: string[] = []
    const renderPage: RenderPage = (url, { signal }) => {
      rendering.push(url)
      return new Promise((resolve, reject) => {
        signal?.addEventListener('abort', () => reject(new RecaptureCancelled()))
        if (url.endsWith('/b')) setTimeout(() => resolve(page(url)), 50)
      })
    }
    const svc = makeService(renderPage)
    const {
      jobIds: [a, b]
    } = svc.enqueue([
      { url: 'https://example.com/a', caseId },
      { url: 'https://example.org/b', caseId }
    ])
    await vi.waitFor(() => expect(rendering).toHaveLength(2))
    expect(svc.cancel({ jobId: a })).toEqual({ cancelled: 1, refused: 0 })
    await svc.idle()
    expect([a, b].map(stateOf)).toEqual(['cancelled', 'stored'])
  })

  describe('a restore while two jobs run', () => {
    let dbPath: string
    let backup: string

    beforeEach(async () => {
      closeDatabase()
      dbPath = join(tempDir, 'birdbrain.db')
      backup = join(tempDir, 'backup.db')
      await initDatabase(dbPath)
      caseId = createCase({ name: 'Restored' }).id
      ensureCaseDir(caseId)
    })

    // Runs a job, restores a copy in which `alter` has changed its row, and lets it end.
    async function restoreWith(alter: (jobId: string) => void) {
      const { renderPage, rendering, finish } = heldRenders()
      const svc = makeService(renderPage)
      const {
        batchId,
        jobIds: [id]
      } = svc.enqueue([{ url: 'https://example.com/a', caseId }])
      expect(rendering).toEqual(['https://example.com/a'])
      const { captureId } = getDb()
        .prepare('SELECT capture_id AS captureId FROM background_jobs WHERE id = ?')
        .get(id) as { captureId: string }
      const live = backgroundJobRepo.getJob(id)!
      alter(id)
      getDb().exec(`VACUUM INTO '${backup}'`)

      const before = svc.beginRestore()
      closeDatabase()
      copyFileSync(backup, dbPath)
      await initDatabase(dbPath)
      svc.finishRestore(before)
      expect(backgroundJobRepo.getJob(id)).toEqual(live)
      expect(svc.status()).toMatchObject({ running: 1, held: 0, heldBatches: [] })
      expect(svc.resume(batchId)).toEqual({ resumed: 0 })

      finish('https://example.com/a')
      await svc.idle()
      return { id, captureId }
    }

    it('ends stored, under its Capture id, a running job whose restored row is queued', async () => {
      const { id, captureId } = await restoreWith((jobId) => {
        getDb()
          .prepare(
            `UPDATE background_jobs SET state = 'queued', attempts = 0, started_at = NULL,
               capture_id = NULL WHERE id = ?`
          )
          .run(jobId)
      })
      expect(backgroundJobRepo.getJob(id)).toMatchObject({ state: 'stored', captureId })
      expect(listCaptures(caseId).map(({ id: capture }) => capture)).toEqual([captureId])
    })

    it('ends stored, under its Capture id, a running job the restored copy has no row for', async () => {
      const { id, captureId } = await restoreWith((jobId) => {
        getDb().prepare('DELETE FROM background_jobs WHERE id = ?').run(jobId)
      })
      expect(backgroundJobRepo.getJob(id)).toMatchObject({
        state: 'stored',
        attempts: 1,
        captureId
      })
      expect(listCaptures(caseId).map(({ id: capture }) => capture)).toEqual([captureId])
    })

    it('leaves both running jobs to end as they would have, and interrupts a running row of no job', async () => {
      const { renderPage, rendering, finish } = heldRenders()
      const svc = makeService(renderPage)
      const urls = ['https://example.com/a', 'https://example.org/b']
      const { jobIds } = svc.enqueue(urls.map((url) => ({ url, caseId })))
      await vi.waitFor(() => expect(rendering).toEqual(urls))
      // A row left `running` by a process that is gone.
      const orphan = randomUUID()
      backgroundJobRepo.insertQueuedJobs([
        { id: orphan, batchId: 'earlier', caseId, url: 'https://example.net/x', queuedAt: 'then' }
      ])
      getDb().prepare("UPDATE background_jobs SET state = 'running' WHERE id = ?").run(orphan)
      getDb().exec(`VACUUM INTO '${backup}'`)

      const before = svc.beginRestore()
      closeDatabase()
      copyFileSync(backup, dbPath)
      await initDatabase(dbPath)
      svc.finishRestore(before)
      expect([...jobIds, orphan].map(stateOf)).toEqual(['running', 'running', 'failed'])

      finish(urls[0])
      finish(urls[1])
      await svc.idle()
      expect(jobIds.map(stateOf)).toEqual(['stored', 'stored'])
    })
  })
})
