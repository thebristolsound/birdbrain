import { getDb } from '@main/services/db/core'
import type {
  BackgroundJobPhase,
  BackgroundJobState,
  BackgroundJobView,
  HeldBatch,
  RecaptureJobTarget,
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

export type TerminalJobState = Extract<
  BackgroundJobState,
  'stored' | 'skipped' | 'failed' | 'cancelled'
>

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
  phase: BackgroundJobPhase | null
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

// The claim's order: a resumed or retried job queues from the moment the Operator resumed or
// retried it, so it runs after the jobs already queued then, and ahead of the ones queued after.
const CLAIM_ORDER = 'ORDER BY COALESCE(resumed_at, queued_at), queued_at, rowid'

// The rows the Operator can dismiss: each is the only record of why a URL left no Capture.
const DISMISSABLE = "state IN ('failed', 'skipped', 'cancelled')"

// The column and value a target names its rows by.
function targetColumn(target: RecaptureJobTarget): [string, string] {
  return 'jobId' in target ? ['id', target.jobId] : ['batch_id', target.batchId]
}

function toView(row: JobRow): BackgroundJobView {
  const { linked_from_capture_id: linkedCaptureId, link_href: linkHref } = row
  return {
    jobId: row.id,
    batchId: row.batch_id,
    caseId: row.case_id,
    url: row.url,
    state: row.state,
    ...(row.state === 'running' && row.phase !== null && { phase: row.phase }),
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

// Records the phase a `running` row is in. Any other row is left as it is, as by `finishJob`.
export function setJobPhase(id: string, phase: BackgroundJobPhase): BackgroundJobView | undefined {
  const row = getDb()
    .prepare(`UPDATE background_jobs SET phase = ? WHERE id = ? AND state = 'running' RETURNING *`)
    .get(phase, id) as JobRow | undefined
  return row ? toView(row) : undefined
}

// Ends a `running` row. A row that is no longer `running` is left as it is: its Case was
// deleted, or a restore brought back an earlier copy of it.
export function finishJob(id: string, end: JobEnd): BackgroundJobView | undefined {
  const row = getDb()
    .prepare(
      `UPDATE background_jobs
          SET state = ?, phase = NULL, failure_kind = ?, error = ?, warning = ?, finished_at = ?
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
export function listActiveJobs(): BackgroundJobView[] {
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

export function dismissJobs(target: RecaptureJobTarget): number {
  const [column, value] = targetColumn(target)
  return getDb()
    .prepare(`DELETE FROM background_jobs WHERE ${column} = ? AND ${DISMISSABLE}`)
    .run(value).changes
}

// Ends the target's `queued` and `held` rows `cancelled`. A `running` row ends through its render.
export function cancelWaitingJobs(
  target: RecaptureJobTarget,
  end: { error: string; finishedAt: string }
): BackgroundJobView[] {
  const [column, value] = targetColumn(target)
  const rows = getDb()
    .prepare(
      `UPDATE background_jobs SET state = 'cancelled', error = ?, finished_at = ?
        WHERE ${column} = ? AND state IN ('queued', 'held')
        RETURNING *`
    )
    .all(end.error, end.finishedAt, value) as JobRow[]
  return rows.map(toView)
}

// Queues the target's `failed` and `cancelled` rows again, clearing what the last attempt
// recorded. `attempts` and `capture_id` change when the worker claims the row, as for any
// attempt. A `skipped` row is not retried: the rule that refused it would refuse it again.
export function retryJobs(target: RecaptureJobTarget, retriedAt: string): BackgroundJobView[] {
  const [column, value] = targetColumn(target)
  const rows = getDb()
    .prepare(
      `UPDATE background_jobs
          SET state = 'queued', resumed_at = ?, phase = NULL, started_at = NULL,
              finished_at = NULL, capture_id = NULL, failure_kind = NULL, error = NULL,
              warning = NULL
        WHERE ${column} = ? AND state IN ('failed', 'cancelled')
        RETURNING *`
    )
    .all(retriedAt, value) as JobRow[]
  return rows.map(toView)
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

export interface StartupRecovery {
  // The rows that were `running` whose attempt's Capture is in their Case, now `stored`.
  stored: BackgroundJobView[]
  // The other rows that were `running`, now `failed` as `interrupted`, each with the id its
  // attempt named, which the job's log lines carry.
  interrupted: Array<{ job: BackgroundJobView; captureId: string | null }>
  held: BackgroundJobView[]
  deletedStored: number
}

// The pass before the queue runs ("Restart and snapshot restore" in the design), in one
// transaction. A running job whose Capture row is in its Case ended with the process after its
// ingest committed, so it is `stored`; any other running job's render or ingest ended with the
// process. A queued job waits for the Operator, and a stored row past retention goes, because
// its Capture is the lasting record.
// After a restore, `exceptJobId` is the job this process is still running, which ends as it
// would have without the restore.
export function recoverJobsAtStartup(params: {
  now: string
  storedBefore: string
  interruptedError: string
  exceptJobId?: string
}): StartupRecovery {
  const db = getDb()
  return db.transaction(() => {
    const stored = db
      .prepare(
        `UPDATE background_jobs
            SET state = 'stored', phase = NULL, finished_at = ?
          WHERE state = 'running' AND id IS NOT ?
            AND EXISTS (
              SELECT 1 FROM captures c
               WHERE c.id = background_jobs.capture_id AND c.case_id = background_jobs.case_id
            )
          RETURNING *`
      )
      .all(params.now, params.exceptJobId ?? null) as JobRow[]
    const interrupted = db
      .prepare(
        `UPDATE background_jobs
            SET state = 'failed', phase = NULL, failure_kind = 'interrupted', error = ?,
                finished_at = ?
          WHERE state = 'running' AND id IS NOT ?
          RETURNING *`
      )
      .all(params.interruptedError, params.now, params.exceptJobId ?? null) as JobRow[]
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
      stored: stored.map(toView),
      interrupted: interrupted.map((row) => ({ job: toView(row), captureId: row.capture_id })),
      held: held.map(toView),
      deletedStored
    }
  })()
}
