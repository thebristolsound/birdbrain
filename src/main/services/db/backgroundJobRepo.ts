import { getDb, isDatabaseOpen } from '@main/services/db/core'
import type {
  BackgroundJobState,
  BackgroundJobView,
  HeldBatch,
  RecaptureDismissTarget,
  RecaptureListJobsQuery
} from '@shared/ipc'

// The background job queue's rows (docs/specs/2026-11-09-batch-capture-throughput-design.md,
// "Stored job table"). A row is the job's state, not evidence: nothing that verifies a Capture
// reads this table.

export interface NewBackgroundJob {
  id: string
  batchId: string
  caseId: string
  url: string
  supersedesCaptureId?: string
  linkedFrom?: { captureId: string; linkHref: string }
  queuedAt: string
}

export type TerminalJobState = Extract<BackgroundJobState, 'stored' | 'skipped' | 'failed'>

export interface JobEnd {
  state: TerminalJobState
  failureKind?: string
  error?: string
  warning?: string
  finishedAt: string
}

interface JobRow {
  id: string
  batch_id: string
  case_id: string
  url: string
  supersedes_capture_id: string | null
  linked_from_capture_id: string | null
  link_href: string | null
  state: BackgroundJobState
  attempts: number
  queued_at: string
  resumed_at: string | null
  started_at: string | null
  finished_at: string | null
  capture_id: string | null
  failure_kind: string | null
  error: string | null
  warning: string | null
}

// Insertion order breaks a tie in `queued_at`, which one Batch's rows share to the millisecond.
const QUEUE_ORDER = 'ORDER BY queued_at, rowid'

// The claim's order: a resumed job queues from its resume, so a Batch resumed from an earlier
// session runs after the jobs already queued then, and ahead of the ones queued after it.
const CLAIM_ORDER = 'ORDER BY COALESCE(resumed_at, queued_at), queued_at, rowid'

// The rows the Operator can dismiss: each is the only record of why a URL left no Capture.
const DISMISSABLE = "state IN ('failed', 'skipped', 'cancelled')"

function toView(row: JobRow): BackgroundJobView {
  const { linked_from_capture_id: linkedCaptureId, link_href: linkHref } = row
  return {
    jobId: row.id,
    batchId: row.batch_id,
    caseId: row.case_id,
    url: row.url,
    state: row.state,
    attempts: row.attempts,
    queuedAt: row.queued_at,
    ...(row.started_at !== null && { startedAt: row.started_at }),
    ...(row.finished_at !== null && { finishedAt: row.finished_at }),
    // `capture_id` is set when the attempt starts; it names a Capture only once one is stored.
    ...(row.state === 'stored' && row.capture_id !== null && { captureId: row.capture_id }),
    ...(row.failure_kind !== null && { failureKind: row.failure_kind }),
    ...(row.error !== null && { error: row.error }),
    ...(row.warning !== null && { warning: row.warning }),
    ...(row.supersedes_capture_id !== null && { supersedesCaptureId: row.supersedes_capture_id }),
    ...(linkedCaptureId !== null &&
      linkHref !== null && { linkedFrom: { captureId: linkedCaptureId, linkHref } })
  }
}

export function getJob(id: string): BackgroundJobView | undefined {
  const row = getDb().prepare('SELECT * FROM background_jobs WHERE id = ?').get(id) as
    JobRow | undefined
  return row ? toView(row) : undefined
}

// One transaction, so a Batch is stored whole or not at all.
export function insertQueuedJobs(jobs: NewBackgroundJob[]): void {
  const db = getDb()
  const insert = db.prepare(
    `INSERT INTO background_jobs
       (id, batch_id, case_id, url, supersedes_capture_id, linked_from_capture_id, link_href,
        state, queued_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?)`
  )
  db.transaction(() => {
    for (const { id, batchId, caseId, url, supersedesCaptureId, linkedFrom, queuedAt } of jobs) {
      insert.run(
        id,
        batchId,
        caseId,
        url,
        supersedesCaptureId ?? null,
        linkedFrom?.captureId ?? null,
        linkedFrom?.linkHref ?? null,
        queuedAt
      )
    }
  })()
}

// Takes the first `queued` row in claim order and marks it `running` in one statement, so two
// callers cannot claim the same row. `held` rows are never claimed.
export function claimNextQueued(attempt: {
  startedAt: string
  captureId: string
}): BackgroundJobView | undefined {
  const row = getDb()
    .prepare(
      `UPDATE background_jobs
          SET state = 'running', attempts = attempts + 1, started_at = ?, capture_id = ?
        WHERE id = (SELECT id FROM background_jobs WHERE state = 'queued' ${CLAIM_ORDER} LIMIT 1)
        RETURNING *`
    )
    .get(attempt.startedAt, attempt.captureId) as JobRow | undefined
  return row ? toView(row) : undefined
}

// Ends a `running` row. A row that is no longer `running` is left as it is: its Case was
// deleted, or a restore brought back an earlier copy of it.
export function finishJob(id: string, end: JobEnd): BackgroundJobView | undefined {
  const row = getDb()
    .prepare(
      `UPDATE background_jobs
          SET state = ?, failure_kind = ?, error = ?, warning = ?, finished_at = ?
        WHERE id = ? AND state = 'running'
        RETURNING *`
    )
    .get(
      end.state,
      end.failureKind ?? null,
      end.error ?? null,
      end.warning ?? null,
      end.finishedAt,
      id
    ) as JobRow | undefined
  return row ? toView(row) : undefined
}

export function listJobs(query: RecaptureListJobsQuery): BackgroundJobView[] {
  const [column, value] =
    'caseId' in query ? ['case_id', query.caseId] : ['batch_id', query.batchId]
  const rows = getDb()
    .prepare(`SELECT * FROM background_jobs WHERE ${column} = ? ${QUEUE_ORDER}`)
    .all(value) as JobRow[]
  return rows.map(toView)
}

// The jobs this session has queued or is running: after the startup pass, every such row is one.
// None when no database is open: a restore can start in that state, after one that left the file
// unreadable, and there is then no row to read.
export function listActiveJobs(): BackgroundJobView[] {
  if (!isDatabaseOpen()) return []
  const rows = getDb()
    .prepare(`SELECT * FROM background_jobs WHERE state IN ('queued', 'running') ${QUEUE_ORDER}`)
    .all() as JobRow[]
  return rows.map(toView)
}

export function resumeBatch(batchId: string, resumedAt: string): BackgroundJobView[] {
  const rows = getDb()
    .prepare(
      `UPDATE background_jobs SET state = 'queued', resumed_at = ?
        WHERE batch_id = ? AND state = 'held'
        RETURNING *`
    )
    .all(resumedAt, batchId) as JobRow[]
  return rows.map(toView)
}

export function dismissJobs(target: RecaptureDismissTarget): number {
  const [column, value] = 'jobId' in target ? ['id', target.jobId] : ['batch_id', target.batchId]
  return getDb()
    .prepare(`DELETE FROM background_jobs WHERE ${column} = ? AND ${DISMISSABLE}`)
    .run(value).changes
}

export function countActiveJobs(): { queued: number; running: number; held: number } {
  const rows = getDb()
    .prepare(
      `SELECT state, COUNT(*) AS n FROM background_jobs
        WHERE state IN ('queued', 'running', 'held') GROUP BY state`
    )
    .all() as Array<{ state: 'queued' | 'running' | 'held'; n: number }>
  const counts = { queued: 0, running: 0, held: 0 }
  for (const { state, n } of rows) counts[state] = n
  return counts
}

export function listHeldBatches(): HeldBatch[] {
  return getDb()
    .prepare(
      `SELECT j.batch_id AS batchId, j.case_id AS caseId, c.name AS caseName, COUNT(*) AS held
         FROM background_jobs j JOIN cases c ON c.id = j.case_id
        WHERE j.state = 'held'
        GROUP BY j.batch_id, j.case_id
        ORDER BY MIN(j.queued_at), MIN(j.rowid)`
    )
    .all() as HeldBatch[]
}

// A job this process is running when a restore re-opens the database: its row as the claim read
// it, and the id its attempt stores the Capture under.
export interface RunningAttempt {
  job: BackgroundJobView
  captureId: string
}

export interface StartupRecovery {
  // After a restore, the rows of the jobs this process is still running, written back as running.
  running: BackgroundJobView[]
  // The other rows that were `running`, now `failed` as `interrupted`, each with the id its
  // attempt named, which the job's log lines carry.
  interrupted: Array<{ job: BackgroundJobView; captureId: string | null }>
  held: BackgroundJobView[]
  deletedStored: number
}

// The pass before the queue runs ("Restart and snapshot restore" in the design), in one
// transaction: a running job's render or ingest ended with the process, a queued job waits for
// the Operator, and a stored row past retention goes, because its Capture is the lasting record.
// After a restore, `running` are the jobs this process is still running. The restored copy can
// hold each one's row in any state or not at all, so each is written back first as the process
// knows it, `running` under its attempt's Capture id, and `finishJob` then records its end as it
// would have without the restore. A job whose Case the restored copy lacks gets no row; its ingest
// fails as it does when the Case is deleted.
export function recoverJobsAtStartup(params: {
  now: string
  storedBefore: string
  interruptedError: string
  running?: RunningAttempt[]
}): StartupRecovery {
  const db = getDb()
  const attempts = params.running ?? []
  const except = JSON.stringify(attempts.map(({ job }) => job.jobId))
  const restoreRunning = db.prepare(
    `INSERT INTO background_jobs
       (id, batch_id, case_id, url, supersedes_capture_id, linked_from_capture_id, link_href,
        state, attempts, queued_at, started_at, capture_id)
     SELECT ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, ?
      WHERE EXISTS (SELECT 1 FROM cases WHERE id = ?)
     ON CONFLICT (id) DO UPDATE
        SET state = 'running', attempts = excluded.attempts, started_at = excluded.started_at,
            capture_id = excluded.capture_id, finished_at = NULL, failure_kind = NULL,
            error = NULL, warning = NULL
     RETURNING *`
  )
  return db.transaction(() => {
    const running: JobRow[] = []
    for (const { job, captureId } of attempts) {
      const row = restoreRunning.get(
        job.jobId,
        job.batchId,
        job.caseId,
        job.url,
        job.supersedesCaptureId ?? null,
        job.linkedFrom?.captureId ?? null,
        job.linkedFrom?.linkHref ?? null,
        job.attempts,
        job.queuedAt,
        job.startedAt ?? null,
        captureId,
        job.caseId
      ) as JobRow | undefined
      if (row) running.push(row)
    }
    const interrupted = db
      .prepare(
        `UPDATE background_jobs
            SET state = 'failed', failure_kind = 'interrupted', error = ?, finished_at = ?
          WHERE state = 'running' AND id NOT IN (SELECT value FROM json_each(?))
          RETURNING *`
      )
      .all(params.interruptedError, params.now, except) as JobRow[]
    const held = db
      .prepare(`UPDATE background_jobs SET state = 'held' WHERE state = 'queued' RETURNING *`)
      .all() as JobRow[]
    const deletedStored = db
      .prepare(
        `DELETE FROM background_jobs
          WHERE state = 'stored' AND COALESCE(finished_at, queued_at) < ?`
      )
      .run(params.storedBefore).changes
    return {
      running: running.map(toView),
      interrupted: interrupted.map((row) => ({ job: toView(row), captureId: row.capture_id })),
      held: held.map(toView),
      deletedStored
    }
  })()
}
