# Scheduled review of the maintainer's PRs

**Status:** Accepted

**Date:** 2026-10-09

A new scheduled job, under its own spend cap, authorized by the maintainer on 2026-10-09 as
[ADR-0029](0029-measure-before-expanding-agent-automation.md) requires. It does not change
dispatch, its slots or its cap ([ADR-0045](0045-dispatch-runs-two-slots-every-hour.md)), or the
merge flow of [ADR-0041](0041-merges-are-requested-by-label.md).

**Amended 2026-10-12:** the maintainer asked for a review he can request by label. Applying
`review:requested` to a PR starts a fire at once and puts that PR first in the queue, past the
one-hour wait and the other-reviewer rule. The spend cap is unchanged. Decision 6 has the
detail; [the plan](../plans/2026-10-12-review-on-request-label.md) has the implementation.

## Context

The `pr-sweep` skill reviews, fixes and merges the open PRs, and it does so on the strength of
the maintainer's presence. The maintainer asked for a scheduled version that runs on the
GitHub Actions runner. An unattended run cannot carry that presence, so it cannot merge, and it
cannot push to his branches without colliding with his interactive sessions.

His PRs get no review from the pipeline: since #1759 the merge rule requires the reviewer only on
machine-account PRs. The 61 PRs he opened that merged on 2026-10-01 or later, read on
2026-10-09:

| Measure | Value |
|---|---|
| Reviewed by the Codex review bot | 40 |
| Reviewed by nobody but him | 20, about 2.4 a day |
| Of those 20, at most 50 changed lines | 13 |
| Median time to merge, unreviewed PRs | 1.8 hours |
| Median time from opening to Codex's first review | 28 minutes |

## Decision

1. **Review only.** `.github/workflows/pr-review.yml` fires hourly at minute 13. Each fire
   reviews at most one PR with `birdbrain-reviewer`, through the `pr-review` skill, and the
   machine account posts the verdict as one comment in the pre-pass verdict shape. The job never
   pushes, merges, marks a PR ready, or writes `agent/pre-pass` or any status the merge gate
   reads. The Claude session runs with the job's read-only token.
2. **Which PRs.** A PR the maintainer opened from this repository, open for at least an hour,
   outside the dispatch slots (no `agent-pr`), and reviewed by nobody but him and the pipeline
   since the pipeline's last verdict on it. The hour gives the review bots the first look. PRs
   by anyone else are out, under the maintainer's 2026-09-28 money rule on #1310. A diff
   confined to `.claude/`, `docs/` and root Markdown gets no review, as in dispatch.
3. **State labels.** A PR carries at most one:

   | Label | Set by | Meaning |
   |---|---|---|
   | `review:passed` | the job | No blocking finding at the reviewed commit. |
   | `review:changes` | the job | At least one blocking finding. |
   | `review:stale` | the job, without starting Claude | A push landed after the verdict. |
   | `review:failed` | the job | The run ended without a usable verdict. |
   | `review:skipped` | the maintainer, or the job | Opted out, or a process-doc diff. |

   No label means the PR is waiting. The verdict comment's `Reviewed commit:` line is what the
   pre-gate compares with the head to find a stale verdict.
4. **Order.** Requested reviews (decision 6), then first reviews, oldest first, then one retry
   of a failed review, then stale PRs. A stale PR is reviewed again without the maintainer
   asking. A second failure waits until he removes `review:failed` or requests a review.
5. **Spend cap.** 4 reviews in 24 hours and 1 per PR in 6 hours, counted from this workflow's
   runs by the counter dispatch uses (`.github/scripts/dispatch/cap.sh`). Dispatch's cap of 6
   counts only its own runs, so each job's spend is bounded separately.
6. **Review on request.** The maintainer applies `review:requested` to a PR to ask for a review
   now. The label is a request, not a state label, so it sits beside the state label. The
   workflow also runs on `pull_request_target` when the maintainer applies that label, with
   that PR as the target. The pre-gate honours the label only when the maintainer applied it
   last. A requested PR must still be one he opened from this repository, outside the dispatch
   slots. It skips the one-hour wait, the other-reviewer rule, the two-failure stop and the
   process-doc skip, and a maintainer-applied `review:skipped` comes off. The post step removes the label on every
   outcome. A PR already reviewed at its head loses the label without a new review. When the
   spend cap holds a request, the label stays and a later scheduled fire takes it.

## Consequences

- Paid runs can rise by 4 a day, to 10 with dispatch's 6.
- About 2.4 PRs a day qualify at the October rate, so the cap is not the limit on a normal day.
  A PR that merges within its first hour gets no review; a quarter of his PRs merged within 36 minutes.
- The verdict is advisory. The merge still waits on his `merge` label, and on his approval when
  the PR is `evidence-affecting`.
- A run cannot count runs that someone deleted. The ceiling is then the schedule: 24 a day.
- A requested review counts against the same cap, so requests can use all 4 daily reviews
  and starve the scheduled round. Label events add fires, so the ceiling on deleted runs is
  24 a day plus one per label the maintainer applies.

## Alternatives rejected

- **A review step inside dispatch.** Dispatch takes one paid action per cycle (ADR-0045), so
  reviews would compete with agent work, and the cap the maintainer set is separate.
- **Reviewing every PR he opens.** About 7.5 a day, most of which Codex already reviews.
- **Review on the PR-opened event.** The maintainer asked for a scheduled round, and a fixed
  schedule bounds the spend without depending on how many PRs open. The 2026-10-12 label
  trigger does not reopen this: only a label the maintainer applies starts a fire.
- **A review request through an `@claude` comment** (2026-10-12). `.github/workflows/claude.yml`
  already answers one, but it runs a general session at low effort, not `birdbrain-reviewer`,
  and it sets no state label and counts against no cap.
