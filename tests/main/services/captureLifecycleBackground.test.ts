import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { Readable } from 'stream'
import { initStorage, ensureCaseDir } from '@main/services/storage'
import { initDatabase, closeDatabase } from '@main/services/db/core'
import {
  createCase,
  deleteCase,
  setAutoCapturePolicy,
  updateCase
} from '@main/services/db/caseRepo'
import { getCapture, listCaptures } from '@main/services/db/captureRepo'
import { initManifest, readEntries } from '@main/services/manifest'
import { initSettings, updateSettings } from '@main/services/settings'
import {
  getInstallationId,
  initInstallationId,
  resetInstallationId
} from '@main/services/installationId'
import { OperatorNameRequiredError } from '@main/services/operatorName'
import {
  backgroundRefusalReason,
  createCaptureLifecycle,
  type BackgroundAdmissionRequest,
  type BackgroundJobIdentity
} from '@main/services/captureLifecycle'
import type { SelectorLifecycle } from '@main/services/selectorLifecycle'
import { MANIFEST_FILENAME } from '@shared/constants'
import type { Capture, CaptureEvent } from '@shared/types'

// The Capture Lifecycle's background route (#recapture): what admission answers for a
// Background Job as it is queued, as it starts, and once its render has returned a page, and
// what it tells the activity feed. The queue around it is tested in recapture.test.ts, and the
// two together in backgroundJobKnownAnswers.test.ts.

const PAGE = 'https://example.com/page'
const JOB: BackgroundJobIdentity = { jobId: 'job-1', batchId: 'batch-1', url: PAGE }
const LINK_JOB: BackgroundJobIdentity = {
  ...JOB,
  linkedFrom: { captureId: 'source-1', linkHref: PAGE }
}

describe('Capture Lifecycle: the background route', () => {
  let tempDir: string
  let caseId: string
  let events: CaptureEvent[]
  let newCaptures: Capture[]
  // Both sinks in the order they were called.
  let order: string[]

  function buildLifecycle() {
    return createCaptureLifecycle({
      selectorLifecycle: { runActiveSelectorsForCapture: vi.fn() } as unknown as SelectorLifecycle,
      emitCaptureEvent: (event) => {
        order.push(event.type)
        events.push(event)
      },
      emitNewCapture: (capture) => {
        order.push('new-capture')
        newCaptures.push(capture)
      },
      fetchTlsCertChain: async () => null,
      egressIsDirect: () => true
    })
  }

  function caseDir(): string {
    return join(tempDir, 'captures', caseId)
  }

  function request(
    overrides: Partial<BackgroundAdmissionRequest> = {},
    page: Partial<BackgroundAdmissionRequest['page']> = {}
  ): BackgroundAdmissionRequest {
    return {
      route: 'background',
      job: JOB,
      startedAt: Date.now() - 1500,
      page: {
        caseId,
        url: PAGE,
        title: 'Page Title',
        timestamp: '2026-11-16T10:00:00.000Z',
        stream: Readable.from([
          Buffer.from('MIME-Version: 1.0\r\n\r\nrendered page')
        ]) as unknown as ReadableStream<Uint8Array>,
        textContent: 'page text',
        headers: {},
        browserVersion: 'Chrome/130',
        userAgent: 'HiddenWindow UA',
        httpStatus: 200,
        toolVersion: '1.0.1-beta.25',
        ...page
      },
      ...overrides
    }
  }

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-background-admit-'))
    initStorage(join(tempDir, 'captures'))
    initSettings(tempDir)
    updateSettings({ operatorName: 'Test Operator', ignoredUrlPatterns: [] })
    resetInstallationId()
    initInstallationId(tempDir)
    await initDatabase(':memory:')
    caseId = createCase({ name: 'Background' }).id
    ensureCaseDir(caseId)
    initManifest(caseDir())
    events = []
    newCaptures = []
    order = []
  })

  afterEach(() => {
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe('screenBackground', () => {
    it('admits an address the Case does not exclude and tells the feed nothing', () => {
      const lifecycle = buildLifecycle()
      expect(lifecycle.screenBackground(caseId, PAGE)).toBeNull()
      expect(lifecycle.screenBackground(caseId, PAGE, JOB)).toBeNull()
      expect(events).toEqual([])
    })

    it('does not apply the operator gate, which the queue and the ingest hold', () => {
      updateSettings({ operatorName: '' })
      expect(buildLifecycle().screenBackground(caseId, PAGE, JOB)).toBeNull()
      expect(events).toEqual([])
    })

    it('refuses an excluded address before a job exists, with a skipped event that names no job', () => {
      setAutoCapturePolicy(caseId, { exclusions: ['example.com'], mode: 'stack' })
      expect(buildLifecycle().screenBackground(caseId, PAGE)).toEqual({
        kind: 'excluded',
        pattern: 'example.com'
      })
      expect(events).toEqual([
        {
          type: 'skipped',
          source: 'recapture',
          url: PAGE,
          timestamp: expect.any(String),
          skipReason: 'Blacklisted: example.com'
        }
      ])
    })

    it("names the job and its Batch on a job's skipped event, and no link source", () => {
      setAutoCapturePolicy(caseId, { exclusions: ['example.com'], mode: 'stack' })
      buildLifecycle().screenBackground(caseId, PAGE, JOB)
      expect(events).toEqual([
        {
          type: 'skipped',
          source: 'recapture',
          url: PAGE,
          timestamp: expect.any(String),
          skipReason: 'Blacklisted: example.com',
          jobId: 'job-1',
          batchId: 'batch-1'
        }
      ])
      expect(events[0]).not.toHaveProperty('linkedFrom')
    })

    it("names the excluded address, not the job's, and a Capture link job's source", () => {
      setAutoCapturePolicy(caseId, { exclusions: ['blocked.example'], mode: 'stack' })
      const landed = 'https://blocked.example/landing'
      expect(buildLifecycle().screenBackground(caseId, landed, LINK_JOB)).toEqual({
        kind: 'excluded',
        pattern: 'blocked.example'
      })
      expect(events).toMatchObject([
        { type: 'skipped', url: landed, jobId: 'job-1', linkedFrom: LINK_JOB.linkedFrom }
      ])
    })

    it('refuses an archived Case, silently while queueing and with a skipped event for a job', () => {
      updateCase({ id: caseId, archived: true })
      const lifecycle = buildLifecycle()
      expect(lifecycle.screenBackground(caseId, PAGE)).toEqual({ kind: 'case_archived' })
      expect(events).toEqual([])
      const landed = 'https://example.com/landed'
      expect(lifecycle.screenBackground(caseId, landed, JOB)).toEqual({ kind: 'case_archived' })
      // The job's own address, so the event replaces the job's entry in the feed.
      expect(events).toEqual([
        {
          type: 'skipped',
          source: 'recapture',
          url: PAGE,
          timestamp: expect.any(String),
          skipReason: 'Case is archived',
          jobId: 'job-1',
          batchId: 'batch-1'
        }
      ])
    })

    it('answers the Case refusal before the exclusion, as every route does', () => {
      setAutoCapturePolicy(caseId, { exclusions: ['example.com'], mode: 'stack' })
      updateCase({ id: caseId, archived: true })
      expect(buildLifecycle().screenBackground(caseId, PAGE, JOB)).toEqual({
        kind: 'case_archived'
      })
      expect(events.map(({ skipReason }) => skipReason)).toEqual(['Case is archived'])
    })

    it('refuses a Case that does not exist only while a job is being queued', () => {
      const lifecycle = buildLifecycle()
      deleteCase(caseId)
      expect(lifecycle.screenBackground(caseId, PAGE)).toEqual({ kind: 'case_not_found' })
      expect(lifecycle.screenBackground('', PAGE)).toEqual({ kind: 'missing_case_id' })
      // A named job is not refused: its ingest fails it.
      expect(lifecycle.screenBackground(caseId, PAGE, JOB)).toBeNull()
      expect(events).toEqual([])
    })
  })

  describe('admit', () => {
    it('stores a rendered page as a background Capture signed by the operator', async () => {
      const outcome = await buildLifecycle().admit(request())
      expect(outcome).toMatchObject({ ok: true, screenshotStatus: 'saved' })
      if (!outcome.ok) return
      expect(getCapture(outcome.capture.id)).toMatchObject({
        method: 'background',
        url: PAGE,
        operatorName: 'Test Operator'
      })
      const [entry] = readEntries(readFileSync(join(caseDir(), MANIFEST_FILENAME), 'utf8'))
      expect(entry).toMatchObject({
        type: 'capture',
        captureId: outcome.capture.id,
        method: 'background',
        operatorId: getInstallationId(),
        operatorName: 'Test Operator',
        toolVersion: '1.0.1-beta.25'
      })
    })

    it("broadcasts the Capture, then reports it stored under the job's address", async () => {
      const landed = 'https://example.com/landed'
      const outcome = await buildLifecycle().admit(
        request({ job: LINK_JOB, warning: 'Looks like a login wall' }, { url: landed })
      )
      expect(outcome.ok).toBe(true)
      if (!outcome.ok) return
      expect(order).toEqual(['new-capture', 'stored'])
      expect(newCaptures.map(({ id, url }) => ({ id, url }))).toEqual([
        { id: outcome.capture.id, url: landed }
      ])
      expect(events).toEqual([
        {
          type: 'stored',
          captureId: outcome.capture.id,
          source: 'recapture',
          url: PAGE,
          timestamp: expect.any(String),
          durationMs: expect.any(Number),
          warning: 'Looks like a login wall',
          jobId: 'job-1',
          batchId: 'batch-1',
          linkedFrom: LINK_JOB.linkedFrom
        }
      ])
      // Counted from the job's start, which the request sets a second and a half back.
      expect(events[0].durationMs).toBeGreaterThanOrEqual(1500)
    })

    it('refuses a page that landed on an excluded address and stores nothing', async () => {
      setAutoCapturePolicy(caseId, { exclusions: ['blocked.example'], mode: 'stack' })
      const landed = 'https://blocked.example/landing'
      const outcome = await buildLifecycle().admit(request({}, { url: landed }))
      expect(outcome).toEqual({
        ok: false,
        refusal: { kind: 'excluded', pattern: 'blocked.example' }
      })
      expect(events).toMatchObject([
        { type: 'skipped', url: landed, skipReason: 'Blacklisted: blocked.example', jobId: 'job-1' }
      ])
      expect(listCaptures(caseId)).toEqual([])
      expect(newCaptures).toEqual([])
    })

    it('refuses a page for an archived Case and stores nothing', async () => {
      updateCase({ id: caseId, archived: true })
      const outcome = await buildLifecycle().admit(request())
      expect(outcome).toEqual({ ok: false, refusal: { kind: 'case_archived' } })
      expect(events).toMatchObject([{ type: 'skipped', url: PAGE, skipReason: 'Case is archived' }])
      expect(listCaptures(caseId)).toEqual([])
      expect(newCaptures).toEqual([])
    })

    it('answers the exclusion before the operator gate', async () => {
      setAutoCapturePolicy(caseId, { exclusions: ['example.com'], mode: 'stack' })
      updateSettings({ operatorName: '' })
      const outcome = await buildLifecycle().admit(request())
      expect(outcome).toMatchObject({ ok: false, refusal: { kind: 'excluded' } })
    })

    it('hands back the operator gate as a failure and reports nothing itself', async () => {
      updateSettings({ operatorName: '  ' })
      const outcome = await buildLifecycle().admit(request())
      expect(outcome.ok).toBe(false)
      if (outcome.ok || outcome.refusal.kind !== 'failed') throw new Error('expected a failure')
      expect(outcome.refusal.error).toBeInstanceOf(OperatorNameRequiredError)
      expect(events).toEqual([])
      expect(newCaptures).toEqual([])
      expect(listCaptures(caseId)).toEqual([])
    })

    it('leaves a page for a Case that is gone to fail at the ingest, reporting nothing', async () => {
      const lifecycle = buildLifecycle()
      deleteCase(caseId)
      const outcome = await lifecycle.admit(request())
      if (outcome.ok || outcome.refusal.kind !== 'failed') throw new Error('expected a failure')
      expect(outcome.refusal.error).toMatchObject({ message: 'FOREIGN KEY constraint failed' })
      expect(order).toEqual([])
    })

    it('hands back an ingest that throws as a failure and reports nothing itself', async () => {
      const lifecycle = buildLifecycle()
      const error = new Error('disk full')
      lifecycle.ingest = () => Promise.reject(error)
      await expect(lifecycle.admit(request())).resolves.toEqual({
        ok: false,
        refusal: { kind: 'failed', error }
      })
      expect(events).toEqual([])
      expect(newCaptures).toEqual([])
    })
  })

  it('words each background refusal as the feed, the job row and an enqueue rejection say it', () => {
    expect(backgroundRefusalReason({ kind: 'excluded', pattern: 'example.com' })).toBe(
      'Blacklisted: example.com'
    )
    expect(backgroundRefusalReason({ kind: 'case_archived' })).toBe('Case is archived')
    expect(backgroundRefusalReason({ kind: 'case_not_found' })).toBe('Case not found')
    expect(backgroundRefusalReason({ kind: 'missing_case_id' })).toBe('Case not found')
  })
})
