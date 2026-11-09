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
| 1 | #2127 | `feat/background-jobs-instrumentation` | | in progress |
| 2 | #2128 | | | not started |
| 3 | #2129 | | | not started |
| 4 | #2130 | | | not started |
| 5 | #2131 | | | not started |
| 6 | #2132 | | | not started |

## Next command

Continue slice 1 in the worktree above.

## Open questions

None yet.
