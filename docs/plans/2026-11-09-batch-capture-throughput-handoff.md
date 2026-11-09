# Batch capture throughput: build handoff

Working notes for building the six slices of the
[batch capture throughput design](../specs/2026-11-09-batch-capture-throughput-design.md). Matt
asked for the slices to be filed and then built, in a Claude Code session on 2026-11-09.

## Layout

- **Issues:** #2127 (slice 1, instrumentation), #2128 (slice 2, job ids), #2129 (slice 3, stored
  table), #2130 (slice 4, progress, cancel, retry), #2131 (slice 5, parallel-safe ingest and
  consent blocker), #2132 (slice 6, the pool). GitHub dependency edges record the order.
- **Branches:** one per slice, each cut from the previous slice's branch, so the pull requests
  stack. Slice 1 starts from `origin/main` and carries the design's two commits.
- **Worktree:** `~/worktrees/birdbrain/scratch/background-jobs-2127`, locked for this session.

## Progress

| Slice | Issue | Branch | PR | State |
| --- | --- | --- | --- | --- |
| 1 | #2127 | `feat/background-jobs-instrumentation` | #2133 (draft) | reviewed, fixed, preflight pass at `c3d4a40a` |
| 2 | #2128 | `feat/background-jobs-ids` | | reviewed; fix round for the feed cap in progress |
| 3 | #2129 | | | not started |
| 4 | #2130 | | | not started |
| 5 | #2131 | | | not started |
| 6 | #2132 | | | not started |

## Next command

Finish slice 2's fix round, open its PR with `--base feat/background-jobs-instrumentation`, then cut `feat/background-jobs-table` for slice 3.

## Decisions taken

- **Host in job log lines (slice 1):** Matt chose no host, in this session on 2026-11-09. Job
  lines name the job by capture id and Case id, and the redaction rules in `logSafe.ts` stay as
  they are. Slice 3's stored job table is where a failed URL is seen.
- **Time left on the Transaction Record failure line (slice 1):** Matt chose to put the capture
  id and time left on the `transaction_record_failed` line in slice 1, and to update the one test
  that pins that line's shape.
- **Step callback:** slice 1 adds `onStep` with ten fine render steps; slice 4 groups them into
  the design's seven phases for `onPhase`.

## Found, not fixed

- A Recapture waiting in the queue shows no in-progress state, so a second click queues a duplicate. Pre-existing; the slice 2 `queued` event now carries the data to fix it.

- A render that finishes after its deadline opens the temp page file the timeout path already
  deleted, with no error handler: an uncaught exception in the main process. Pre-existing.
- `PrintTimeout` is not an allowed error name, so PDF timeouts log as a generic error.
- URLs refused at enqueue never become jobs and get no log line.

## Open questions

None.
