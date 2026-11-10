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
| 2 | #2128 | `feat/background-jobs-ids` | #2135 (draft, base slice 1) | reviewed, fixed, preflight pass at `98dbaf1d`, screenshots in body |
| 3 | #2129 | `feat/background-jobs-table` | #2141 (draft, base slice 2) | two review rounds, preflight pass at `0165b0b0`, screenshots in body |
| 4 | #2130 | `feat/background-jobs-controls` | | in progress |
| 5 | #2131 | | | not started |
| 6 | #2132 | | | not started |

## Next command

Build slice 4 on `feat/background-jobs-controls`; open its PR with `--base feat/background-jobs-table`. Slices 1 and 2 PR bodies carry preflight blocks for their old heads (`c3d4a40a`, `98dbaf1d`); after their CI finishes at `d5e4d0a3` and `73ed4e66`, refresh their Verification blocks with `scripts/verification-from-ci.sh <n>`.

## Decisions taken

- **Host in job log lines (slice 1):** Matt chose no host, in this session on 2026-11-09. Job
  lines name the job by capture id and Case id, and the redaction rules in `logSafe.ts` stay as
  they are. Slice 3's stored job table is where a failed URL is seen.
- **Time left on the Transaction Record failure line (slice 1):** Matt chose to put the capture
  id and time left on the `transaction_record_failed` line in slice 1, and to update the one test
  that pins that line's shape.
- **Step callback:** slice 1 adds `onStep` with ten fine render steps; slice 4 groups them into
  the design's seven phases for `onPhase`.

- **Resume order (slice 3):** a resumed held Batch goes to the back of the queue, through a
  `resumed_at` column, following the design's decision that a fresh paste never waits behind
  earlier-session work. Taken under the recommended-option rule; Matt may veto.
- **Restore timing (slice 3):** the design said a restore takes effect at the next start; it
  re-opens the database at once, so the startup pass also runs after a successful restore.

- **Pre-render exclusion check:** moved from slice 4 into slice 3, the first slice where a job can
  wait across a session.
- **Stack upkeep:** fixes to a lower slice are merged up (no rebase, no force push).

## Found, not fixed

- On `origin/main`, the app does not exit after quit while a background job waits on a server
  that never answers; slice 3's build exits normally.

- A Recapture waiting in the queue shows no in-progress state, so a second click queues a duplicate. Pre-existing; the slice 2 `queued` event now carries the data to fix it.

- A render that finishes after its deadline opens the temp page file the timeout path already
  deleted, with no error handler: an uncaught exception in the main process. Pre-existing.
- `PrintTimeout` is not an allowed error name, so PDF timeouts log as a generic error.
- URLs refused at enqueue never become jobs and get no log line.

## Open questions

None.
