# Review fleet repair

- Completed: merged current main tooling; retained the action pin and all repair commits.
- Completed: bound overrides to a dedicated head stamp, surfaced withdrawal errors, preserved
  conflicting confirmations and Unicode state, and stopped waiting on stale review labels.
- In flight: separate completed source review from visible runtime limitations, without
  converting old incomplete records.
- Next command: `mise exec -- pnpm test tests/reviewFleet.test.ts` after policy regressions.
- Open questions: none. The maintainer authorized completed source review with runtime
  limitations reported separately and existing required CI gates retained.

## Source review contract implemented

- Completed: versioned source-completion output, strict aggregation validation, visible runtime
  limitations, source-contract fetching, and failure on unreadable saved reports.
- Existing mixed unchecked records stay failed; no state was deleted or converted.
- In flight: final committed-head verification, then a fast-forward push to the existing PR.
- Next command: `flock /home/matt/worktrees/birdbrain/.preflight.lock mise exec -- pnpm preflight`
  with the documented test-only system sharp environment.
- Open questions: none. Live fleet success still requires the implementation on trusted main
  and a separately authorized fresh review with complete source inputs.

## Remaining review items

- Completed: corrected the retry actor and requested-review reasons; added actual plan-path
  coverage for persisting a verification start before the paid handoff and for API-derived
  fleet status and switch readings.
- In flight: final locked verification and coordinator handoff. No paid review was started.
- Next command: `flock /home/matt/worktrees/birdbrain/.preflight.lock mise exec -- pnpm preflight`.
- Open questions: none. The shell label-guard suite remains separately runnable; its current
  command cases were executed during this repair.
