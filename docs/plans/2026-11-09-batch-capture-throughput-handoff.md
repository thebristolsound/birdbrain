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
| 1 | #2127 | `feat/background-jobs-instrumentation` | #2133 (draft) | preflight pass at `d5e4d0a3`, CI green |
| 2 | #2128 | `feat/background-jobs-ids` | #2135 (draft, base slice 1) | preflight pass at `73ed4e66`, CI green |
| 3 | #2129 | `feat/background-jobs-table` | #2141 (draft, base slice 2) | preflight pass at `0165b0b0`, CI green |
| 4 | #2130 | `feat/background-jobs-controls` | #2146 (draft, base slice 3) | reviewed, fixed, preflight pass at `bb16c930` |
| 5 | #2131 | `feat/background-jobs-parallel-safe` | #2147 (draft, base slice 4) | preflight pass at `2dcf52b7`; CI rerun after an apt timeout |
| 6 | #2132 | `feat/background-jobs-pool` | | built at `8336882f`, reviewed; fix round for the restore race in progress |

## Next command

Finish slice 6's fix round and preflight in `~/worktrees/birdbrain/scratch/background-jobs-2131`, then open its PR with `--base feat/background-jobs-parallel-safe`.

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

- **Consent blocker (slice 5):** the pinned library works in several sessions once Birdbrain owns
  its two global channels, so no lease; slice 6 can run two renders.
- **Preflight load:** run every preflight as `flock ~/worktrees/birdbrain/.preflight.lock pnpm
  preflight`; other sessions share the machine and two test files time out under load.

- **Pool default (slice 6):** on for 8+ logical CPUs. Comparison on 2026-11-09: 10 fixture pages
  54.9 s at 1 worker, 31.2 s at 2; 20 public pages 218.4 s at 1, 110.7 s at 2; no Transaction
  Record failures at either.

## Found, not fixed

- PDFs are absent as `failed` on pages that hit the height cap (long-text fixture, the Wikipedia
  Bristol article), at both concurrencies; #2121 notes the same reason conflation.

- On `origin/main`, the app does not exit after quit while a background job waits on a server
  that never answers; slice 3's build exits normally.

- A Recapture waiting in the queue shows no in-progress state, so a second click queues a duplicate. Pre-existing; the slice 2 `queued` event now carries the data to fix it.

- A render that finishes after its deadline opens the temp page file the timeout path already
  deleted, with no error handler: an uncaught exception in the main process. Pre-existing.
- `PrintTimeout` is not an allowed error name, so PDF timeouts log as a generic error.
- URLs refused at enqueue never become jobs and get no log line.

## Open questions

None.
