import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { closeDatabase, getDb, initDatabase } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import {
  cancelWaitingJobs,
  claimNextQueued,
  countActiveJobs,
  dismissJobs,
  finishJob,
  getJob,
  insertQueuedJobs,
  listHeldBatches,
  listJobs,
  recoverJobsAtStartup,
  resumeBatch,
  retryJobs,
  setJobPhase,
  type NewBackgroundJob
} from '@main/services/db/backgroundJobRepo'

// The repository every read and write of `background_jobs` goes through (migration 46).

describe('backgroundJobRepo', () => {
  let caseId: string

  beforeEach(async () => {
    await initDatabase(':memory:')
    caseId = createCase({ name: 'Harbour Lane' }).id
  })

  afterEach(() => {
    closeDatabase()
  })

  function job(id: string, overrides: Partial<NewBackgroundJob> = {}): NewBackgroundJob {
    return {
      id,
      batchId: 'batch-1',
      caseId,
      url: `https://example.com/${id}`,
      queuedAt: '2026-11-09T10:00:00.000Z',
      ...overrides
    }
  }

  const claim = (captureId = 'cap') =>
    claimNextQueued({ startedAt: '2026-11-09T11:00:00.000Z', captureId })

  it('reads a queued job back with every field it was queued with, and nothing unset', () => {
    insertQueuedJobs([
      job('a', { supersedesCaptureId: 'old' }),
      job('b', { linkedFrom: { captureId: 'src', linkHref: 'https://example.com/b' } })
    ])
    expect(listJobs({ batchId: 'batch-1' })).toEqual([
      {
        jobId: 'a',
        batchId: 'batch-1',
        caseId,
        url: 'https://example.com/a',
        state: 'queued',
        attempts: 0,
        queuedAt: '2026-11-09T10:00:00.000Z',
        supersedesCaptureId: 'old'
      },
      {
        jobId: 'b',
        batchId: 'batch-1',
        caseId,
        url: 'https://example.com/b',
        state: 'queued',
        attempts: 0,
        queuedAt: '2026-11-09T10:00:00.000Z',
        linkedFrom: { captureId: 'src', linkHref: 'https://example.com/b' }
      }
    ])
  })

  it('stores a Batch whole or not at all', () => {
    expect(() => insertQueuedJobs([job('a'), job('b', { caseId: 'no-such-case' })])).toThrow(
      /FOREIGN KEY/
    )
    expect(listJobs({ caseId })).toEqual([])
  })

  it('claims the oldest queued job first, in queue order within one instant, and never a held one', () => {
    insertQueuedJobs([job('late', { batchId: 'b2', queuedAt: '2026-11-09T10:05:00.000Z' })])
    insertQueuedJobs([job('first'), job('second'), job('held')])
    getDb().prepare("UPDATE background_jobs SET state = 'held' WHERE id = 'held'").run()

    const claimed = claim('cap-1')
    expect(claimed).toMatchObject({
      jobId: 'first',
      state: 'running',
      attempts: 1,
      startedAt: '2026-11-09T11:00:00.000Z'
    })
    expect(
      getDb().prepare("SELECT capture_id FROM background_jobs WHERE id = 'first'").get()
    ).toEqual({ capture_id: 'cap-1' })
    expect([claim()?.jobId, claim()?.jobId, claim()]).toEqual(['second', 'late', undefined])
    expect(getJob('held')?.state).toBe('held')
  })

  it('ends only a running job, and names its Capture only once stored', () => {
    insertQueuedJobs([job('a'), job('b')])
    const end = { finishedAt: '2026-11-09T11:01:00.000Z' }
    expect(finishJob('b', { ...end, state: 'failed' })).toBeUndefined()
    expect(getJob('b')?.state).toBe('queued')

    claim('cap-a')
    expect(
      finishJob('a', { ...end, state: 'failed', failureKind: 'render', error: 'boom' })
    ).toMatchObject({ state: 'failed', failureKind: 'render', error: 'boom', ...end })
    expect(getJob('a')?.captureId).toBeUndefined()
    expect(finishJob('a', { ...end, state: 'stored' })).toBeUndefined()

    claim('cap-b')
    expect(finishJob('b', { ...end, state: 'stored', warning: 'login wall' })).toMatchObject({
      state: 'stored',
      captureId: 'cap-b',
      warning: 'login wall'
    })
  })

  it('resumes only the held jobs of the Batch it names', () => {
    insertQueuedJobs([job('a'), job('b')])
    insertQueuedJobs([job('c', { batchId: 'batch-2' })])
    claim()
    getDb().prepare("UPDATE background_jobs SET state = 'held' WHERE state = 'queued'").run()

    expect(
      resumeBatch('batch-1', '2026-11-09T12:00:00.000Z').map(({ jobId, state }) => [jobId, state])
    ).toEqual([['b', 'queued']])
    expect([getJob('a')?.state, getJob('c')?.state]).toEqual(['running', 'held'])
    // The view keeps when the job was accepted, not when it was resumed.
    expect(getJob('b')?.queuedAt).toBe('2026-11-09T10:00:00.000Z')
  })

  it('claims a resumed job behind jobs queued before the resume and ahead of later ones', () => {
    insertQueuedJobs([
      job('held-1', { batchId: 'held', queuedAt: '2026-11-08T09:00:00.000Z' }),
      job('held-2', { batchId: 'held', queuedAt: '2026-11-08T09:00:00.000Z' })
    ])
    getDb().prepare("UPDATE background_jobs SET state = 'held'").run()
    insertQueuedJobs([job('before', { batchId: 'fresh', queuedAt: '2026-11-09T10:00:00.000Z' })])
    resumeBatch('held', '2026-11-09T10:01:00.000Z')
    insertQueuedJobs([job('after', { batchId: 'later', queuedAt: '2026-11-09T10:02:00.000Z' })])

    const order = [claim(), claim(), claim(), claim(), claim()].map((view) => view?.jobId)
    expect(order).toEqual(['before', 'held-1', 'held-2', 'after', undefined])
  })

  it('counts queued, running and held jobs, and lists held Batches oldest first with their Case', () => {
    const other = createCase({ name: 'Quay Street' }).id
    insertQueuedJobs([
      job('new', { batchId: 'late', caseId: other, queuedAt: '2026-11-09T12:00:00.000Z' })
    ])
    insertQueuedJobs([job('a'), job('b'), job('c'), job('d')])
    getDb().prepare("UPDATE background_jobs SET state = 'held' WHERE id IN ('b', 'c', 'new')").run()
    claim()

    expect(countActiveJobs()).toEqual({ queued: 1, running: 1, held: 3 })
    expect(listHeldBatches()).toEqual([
      { batchId: 'batch-1', caseId, caseName: 'Harbour Lane', held: 2 },
      { batchId: 'late', caseId: other, caseName: 'Quay Street', held: 1 }
    ])
  })

  it('refuses a state outside the design’s list', () => {
    insertQueuedJobs([job('a')])
    expect(() =>
      getDb().prepare("UPDATE background_jobs SET state = 'paused' WHERE id = 'a'").run()
    ).toThrow(/CHECK/)
  })

  it('dismisses nothing that is not failed, skipped or cancelled', () => {
    insertQueuedJobs([job('a'), job('b')])
    claim()
    expect(dismissJobs({ jobId: 'a' })).toBe(0)
    expect(dismissJobs({ batchId: 'batch-1' })).toBe(0)
    expect(listJobs({ batchId: 'batch-1' })).toHaveLength(2)
  })

  it('recovers at startup in one pass: interrupted, held, and stored rows past the cutoff', () => {
    insertQueuedJobs([job('running'), job('queued'), job('old'), job('recent'), job('failed')])
    for (const [id, state, finishedAt] of [
      ['old', 'stored', '2026-11-01T00:00:00.000Z'],
      ['recent', 'stored', '2026-11-05T00:00:00.000Z'],
      ['failed', 'failed', '2026-10-01T00:00:00.000Z']
    ]) {
      getDb()
        .prepare('UPDATE background_jobs SET state = ?, finished_at = ? WHERE id = ?')
        .run(state, finishedAt, id)
    }
    claim('cap-running')
    setJobPhase('running', 'artifacts')

    const recovery = recoverJobsAtStartup({
      now: '2026-11-09T12:00:00.000Z',
      storedBefore: '2026-11-02T12:00:00.000Z',
      interruptedError: 'closed'
    })

    expect(recovery.interrupted).toEqual([
      {
        job: expect.objectContaining({
          jobId: 'running',
          state: 'failed',
          failureKind: 'interrupted',
          error: 'closed',
          finishedAt: '2026-11-09T12:00:00.000Z'
        }),
        captureId: 'cap-running'
      }
    ])
    expect(phaseColumn('running')).toBeNull()
    expect(recovery.held.map(({ jobId, state }) => [jobId, state])).toEqual([['queued', 'held']])
    expect(recovery.deletedStored).toBe(1)
    expect(listJobs({ caseId }).map(({ jobId, state }) => [jobId, state])).toEqual([
      ['running', 'failed'],
      ['queued', 'held'],
      ['recent', 'stored'],
      ['failed', 'failed']
    ])
  })

  // The raw column, which the view shows only while the row is `running`.
  const phaseColumn = (id: string): unknown =>
    (
      getDb().prepare('SELECT phase FROM background_jobs WHERE id = ?').get(id) as {
        phase: unknown
      }
    ).phase

  it('records a phase only on a running row, and clears it when the row ends', () => {
    insertQueuedJobs([job('a'), job('b')])
    expect(setJobPhase('a', 'loading')).toBeUndefined()
    claim()
    expect(setJobPhase('a', 'scrolling')).toMatchObject({ state: 'running', phase: 'scrolling' })
    expect(getJob('a')?.phase).toBe('scrolling')
    expect(getJob('b')?.phase).toBeUndefined()

    finishJob('a', { state: 'failed', finishedAt: '2026-11-09T11:05:00.000Z' })
    expect(phaseColumn('a')).toBeNull()
    expect(setJobPhase('a', 'pdf')).toBeUndefined()
    expect(phaseColumn('a')).toBeNull()
  })

  it('cancels only the queued and held rows of its target', () => {
    insertQueuedJobs([job('queued'), job('held'), job('running'), job('other', { batchId: 'b2' })])
    getDb().prepare("UPDATE background_jobs SET state = 'held' WHERE id = 'held'").run()
    getDb().prepare("UPDATE background_jobs SET state = 'running' WHERE id = 'running'").run()
    const end = { error: 'Cancelled', finishedAt: '2026-11-09T11:10:00.000Z' }

    expect(cancelWaitingJobs({ jobId: 'running' }, end)).toEqual([])
    const ended = cancelWaitingJobs({ batchId: 'batch-1' }, end)
    expect(ended.map(({ jobId }) => jobId).sort()).toEqual(['held', 'queued'])
    expect(ended[0]).toMatchObject({ state: 'cancelled', ...end })
    expect(listJobs({ caseId }).map(({ jobId, state }) => [jobId, state])).toEqual([
      ['queued', 'cancelled'],
      ['held', 'cancelled'],
      ['running', 'running'],
      ['other', 'queued']
    ])
  })

  it('retries only failed and cancelled rows, clearing the last attempt and keeping its Batch', () => {
    insertQueuedJobs(['failed', 'cancelled', 'skipped', 'stored'].map((id) => job(id)))
    for (const id of ['failed', 'cancelled', 'skipped', 'stored']) {
      claim(`cap-${id}`)
      finishJob(id, {
        state: id as 'failed' | 'cancelled' | 'skipped' | 'stored',
        failureKind: 'render',
        error: 'it broke',
        warning: 'login wall',
        finishedAt: '2026-11-09T11:30:00.000Z'
      })
    }

    expect(retryJobs({ jobId: 'skipped' }, '2026-11-09T12:00:00.000Z')).toEqual([])
    expect(retryJobs({ jobId: 'stored' }, '2026-11-09T12:00:00.000Z')).toEqual([])
    const retried = retryJobs({ batchId: 'batch-1' }, '2026-11-09T12:00:00.000Z')
    expect(retried.map(({ jobId }) => jobId).sort()).toEqual(['cancelled', 'failed'])
    expect(getJob('failed')).toEqual({
      jobId: 'failed',
      batchId: 'batch-1',
      caseId,
      url: 'https://example.com/failed',
      state: 'queued',
      attempts: 1,
      queuedAt: '2026-11-09T10:00:00.000Z'
    })
    const raw = getDb()
      .prepare('SELECT capture_id, resumed_at FROM background_jobs WHERE id = ?')
      .get('cancelled')
    expect(raw).toEqual({ capture_id: null, resumed_at: '2026-11-09T12:00:00.000Z' })
    expect(getJob('skipped')).toMatchObject({ state: 'skipped', error: 'it broke' })
    expect(getJob('stored')).toMatchObject({ state: 'stored', captureId: 'cap-stored' })

    // The next attempt counts, and names its own Capture id.
    expect(claim('cap-second')).toMatchObject({ jobId: 'failed', state: 'running', attempts: 2 })
  })
})
