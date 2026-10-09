# Dispatch runs two slots every hour

**Status:** Accepted

**Date:** 2026-10-08

Amends [ADR-0028](0028-dispatch-works-a-hand-picked-queue.md) rule 3 (the slot count is two, not
one) and [ADR-0026](0026-scheduled-dispatch-runs-on-a-github-actions-host.md) (the schedule is
hourly again). Raises the daily total of the spend cap the maintainer set on #1310 on 2026-09-28
from 4 to 6. ADR-0028's hand-picked queue, its filing gate and the `process` freeze are
unchanged, as are the per-target cap and the claim protocol of
[ADR-0006](0006-claim-the-dispatch-slot-at-dispatch-time.md).

## Context

The repository became public. GitHub's billing documentation states that "GitHub Actions usage is
free for self-hosted runners and for public repositories that use standard GitHub-hosted runners."
ADR-0026 records the maintainer's move from hourly fires to one every four hours on 2026-09-16
"because each fire is billed minutes while the repository is private." That reason no longer
holds. The Claude subscription spend each cycle uses is unchanged, and the spend cap in
`.github/scripts/dispatch/pregate.sh` is what bounds it.

The 36 scheduled fires of 2026-10-03 through 2026-10-08 ended as follows, read from each run's
pre-gate line:

| Pre-gate outcome | Fires |
|---|---|
| Ran a paid cycle | 13 |
| A slot was free and the queue was empty | 11 |
| The spend cap held the fire (5 on the daily total, 4 on the per-target limit) | 9 |
| The slot was held and no open agent PR needed the routine | 3 |

All five code PRs dispatched in that window carried `evidence-affecting`, so none could merge
without the maintainer, and each held the one slot until it merged: #1717 for 2 hours,
#1747 for 12, #1752 for 6.5, #1760 for 26, #1767 for 2.75. While a PR waited on him, the
routine could not start the next queued issue.

## Decision

1. **Two slots.** Occupancy is still open `agent-pr` PRs plus live `agent-wip` claims, and the
   routine dispatches while it is below two.
2. **Hourly fires.** `dispatch.yml` fires at minute 43 of every hour. A fire with nothing to do
   ends at the pre-gate in under a minute.
3. **A daily total of 6.** The pre-gate starts no cycle once 6 have started in 24 hours. The
   per-target limit of 1 cycle per PR or issue in 6 hours is unchanged.
4. **The frontier leaves out held issues.** A queued issue keeps `ready-for-agent` and `queued`
   while its PR is open. The pre-gate and section 3 of the skill skip an issue with a live claim
   or an open agent PR on its `agent/<n>-<slug>` branch, so the second slot does not
   re-dispatch the first slot's issue.
5. **One paid action per cycle.** A cycle that ran the implementer or a pre-pass in section 2
   reports and stops instead of going on to dispatch in section 3. This keeps a run inside the
   150-minute job timeout and keeps the pre-gate's `Dispatch target` annotation true.
6. **Settling counts PRs directly.** The claim settle step counts open agent PRs from
   `pulls?state=open` and each PR's labels, not from the label-filtered issue query, which reads
   GitHub's search index and lags. With one slot the lag cost at most a wasted cycle; with two
   it can admit a third.

## Consequences

- Two evidence-affecting PRs can wait on the maintainer at once. The
  [2026-08-14 two-slot assessment](../specs/2026-08-14-two-slot-dispatch-assessment.md) names the
  costs: concurrent PRs collide in shared files at rebase time, and review stays the constraint,
  so the second slot adds queue in front of the maintainer as well as throughput.
- Paid cycles can rise from 4 to 6 a day. The spend cap, not the schedule, now bounds them on a
  normal day.
- The ceiling when someone deletes finished runs, which the cap cannot count, rises from 6 cycles
  a day to 24. The maintainer accepted the 6-a-day ceiling on 2026-09-28 under the four-hour
  schedule.
- A free slot or new review feedback is picked up within an hour instead of four.
- The 4-hour claim expiry is unchanged. A missed claim release still clears on its own, through
  the pre-gate's stale-claim path.

## Alternatives rejected

- **Three slots.** ADR-0014 set three. ADR-0028 returned to one after the maintainer's merge rate
  fell from 49 PRs in 2026-W34 to 9 in W37 under the review load.
- **Scoped slots, one evidence-affecting and one not.** The 2026-08-14 assessment recommended
  them. Every queued issue on 2026-10-08 carries `evidence-affecting`, so the second slot would
  stay empty.
- **Two slots on the four-hour schedule.** Each fire takes one paid action, so filling and
  working a second slot would take most of a day.
