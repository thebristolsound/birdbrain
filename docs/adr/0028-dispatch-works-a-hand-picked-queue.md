# Dispatch works a hand-picked queue

**Status:** Accepted

**Date:** 2026-09-11

**Amended 2026-10-08 by [ADR-0045](0045-dispatch-runs-two-slots-every-hour.md):** the slot count
in rule 3 is two. The queue, the filing gate and the `process` freeze stand.

Amends [ADR-0014](0014-tier-the-evidence-backstop-and-widen-the-dispatch-slot.md) (the slot
count returns to one) and [ADR-0005](0005-unattended-agents-on-the-evidence-path.md) (the
frontier definition). Withdraws the file-every-defect rule in `CLAUDE.md`. The evidence tiers,
the auto-merge conditions and the claim protocol of
[ADR-0006](0006-claim-the-dispatch-slot-at-dispatch-time.md) are unchanged.

## Context

The scheduled dispatcher was switched off on 2026-09-11 because the maintainer could not keep
up with its output and the spend was not sustainable. The tracker explains why. Between
2026-W34 and 2026-W37 the repository opened 738 issues and closed 224. The machine account
filed 336 of them against 93 merged agent PRs, so each merged PR retired about one issue and
filed about 3.6. Of the 336, 164 are about the pipeline itself: the dispatch scratch directory,
token scopes, Vale on the runner, ADR wording. About 215 trace to a reviewer verdict, a pre-pass
finding, or an "out of scope" note. Only 62 have closed.

Three rules combined to produce that ratio. `CLAUDE.md` required every noticed defect to be
filed regardless of severity or scope. The reviewer pre-pass ran on every push and reported
every finding. The frontier was "the oldest `ready-for-agent` issue", so whatever the agents
filed and triaged next became the agents' next work. A loop whose reproduction number is greater than
one grows without bound whatever the budget, and the maintainer's own merge rate fell from 49
PRs in W34 to 9 in W37 as review and triage absorbed the time.

## Decision

1. **Filing is gated on impact.** An agent files an issue only for a defect that is user-visible
   or evidence-affecting, and files at most two per PR. Every other finding is written in the PR
   body or the review comment and discarded when the PR merges. The inverse rule stands: nothing
   is described as filed until it is.
2. **Process work is frozen.** Issues about the pipeline carry the `process` label. They are
   never queued and never dispatched. The maintainer fixes by hand the few that block delivery.
3. **The frontier is a hand-picked queue.** An issue is eligible only when it carries both
   `ready-for-agent` and `queued`. The maintainer applies `queued`; the routine never widens the
   frontier when the queue is empty. The slot count returns to one.
4. **Untouched agent-filed issues close.** `.github/workflows/stale-agent-issues.yml` closes,
   as not planned, any issue the machine account filed that has had no activity for 14 days and
   carries neither `queued` nor `agent-wip`. Reopening and queueing restores it.

## Consequences

- The backlog stops growing on its own. Growth now needs a human to file or to queue.
- Findings that would have become issues are lost when their PR merges. That is the intended
  trade: the tracker records what the maintainer chose to keep, not everything an agent saw.
- The 87 open `process` issues at the time of this decision stay open until the stale workflow
  or the maintainer closes them. None is dispatched.
- The reviewer contract is unchanged. It still reports every finding; the change is what the
  implementer does with the non-blocking ones.

## Alternatives rejected

- **More budget or more slots.** Neither changes the ratio of issues filed to issues closed.
- **Auto-closing by age alone, without the filing gate.** It would hide the growth rather than
  stop it, and the spend on filing would continue.
- **Dropping the reviewer pre-pass.** The pre-pass is what found the twelve blocking defects
  behind green badges in wave 1. The waste is in filing its nits, not in running it.
