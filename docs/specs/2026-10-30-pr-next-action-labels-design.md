# PR next-action labels

**Date:** 2026-10-30

**Status:** Slice 1 built on `chore/simplify-pr-action-labels`; slices 2 and 3 are proposals. The
maintainer approved the direction on 2026-10-30.

**Audience:** the maintainer, who reads the pull request list, and whoever changes the PR review
job, `pr-size.yml`, or the label set.

## Problem

A pull request row in the list carries labels from five unrelated axes: size (six labels), the
last scheduled review (six), the maintainer's merge controls (`merge`, `approved`), authorship
(`agent-authored`, `agent-pr`), and risk (`evidence-affecting`). None of them names who acts next.
On 2026-10-26, #1970 carried `approved`, `merge`, and `review:skipped` and read as finished while a
failed merge request kept it blocked. #1966 showed `review:failed` while merge-gate's log named the
real blocker, a missing sign-off at head.

## Slice 1: one `next:` label per pull request

`.github/workflows/pr-next.yml` runs `.github/scripts/pr-next/next.mjs`, which puts one `next:`
label on each open pull request and posts a `next-action` commit status whose description gives
the reason. Drafts get no label: the list already marks them. The first matching rule wins.

| Order | Condition | Label |
|---|---|---|
| 1 | A check the ruleset requires, other than merge-gate, failed; `main` conflicts; the reviewer pre-pass failed; or a review asked for changes | `next: fix` |
| 2 | An outside pull request's required checks never started | `next: review` |
| 3 | Required checks, the reviewer pre-pass, or a due scheduled review are still running | `next: wait` |
| 4 | merge-gate wants the maintainer's sign-off at head | `next: approve` |
| 5 | Nobody has reviewed it: an outside pull request with no sign-off at head, a failed scheduled review, or a maintainer pull request the scheduled review has not reached in 6 hours | `next: review` |
| 6 | Everything is green and `merge` is absent | `next: merge` |
| 7 | `merge` is on, but auto-merge is off, an older red merge-gate run remains, or GitHub reports the pull request blocked | `next: unstick` |
| 8 | `merge` is on and auto-merge is armed | `next: merging` |

The maintainer's queue is one search:
`is:pr is:open label:"next: review","next: approve","next: merge","next: unstick"`.

The script reuses merge-gate's `decide` from `.github/scripts/merge/gate.mjs`, so the sign-off
rule has one definition. It reads the required checks from the ruleset
(`rules/branches/main`), not a copied list, and judges a check by its newest run.

### Why the workflow token

The workflow writes every label and status with `github.token`. GitHub starts no workflow from an
event that token causes, so label churn cannot start merge-gate, the pre-pass gate, or the review
job, and cannot count against a spend cap. Observed on 2026-10-26 across #1958, #1964, #1966, and
#1970: none of 7 label writes by `github-actions[bot]` started a merge-gate run, while all 16 label
writes by `birdbrain-agent` or the maintainer started one within 1 to 4 seconds. A `next:` label
written with the machine account would loop through merge-gate.

### Triggers

`workflow_run` on CI, Merge gate, Merge on label, Pre-pass gate, and PR review relabels the pull
requests the finished run names, or every open pull request when it names none. A schedule at
minutes 7 and 37 catches what no workflow reports, such as a reviewer commit status or a pull
request crossing the 6-hour mark. A `closed` event clears the label. GitHub runs a `workflow_run`
workflow only once its file is on the default branch, so the first run happens after merge;
`next.mjs --dry-run <owner/repo>` prints the decisions without writing.

## Slice 2: retire the review state labels (proposal)

The PR review job keeps its state in `review:passed`, `review:changes`, `review:stale`, and
`review:failed`. Its pre-gate reads a missing state label as a first review
(`.github/scripts/pr-review/pregate.sh`) and counts past `review:failed` events from the label
timeline for its one retry. The state moves into the verdict comment, which already records
`Reviewed commit:`, before any of the four labels is deleted. Otherwise every maintainer pull
request looks unreviewed and the job spends its cap re-reviewing them. Amends ADR-0046.
`review:requested` and `review:skipped` stay. The maintainer applies `review:requested` to ask for
a review, and `review:skipped` takes a pull request out of the job's queue; the maintainer applies
it, or the pre-gate does on a process-doc diff.

## Slice 3: prune the label set (proposal)

The REST call that adds a label to an issue creates the label when it does not exist, grey
(`ededed`) with no description; `gh issue edit --add-label` and `gh issue create --label` fail
instead, and the latter creates no issue. Both were observed in a throwaway repository on
2026-10-29. So a label deleted while code still adds it through REST comes back, and one still
added through `gh` breaks its writer. Each deletion follows the code change that stops writing it:

- `review:passed`, `review:changes`, `review:stale`, `review:failed`: after slice 2.
- `size:XS` to `size:XXL`: after `pr-size.yml` writes a single `large` label for 500 or more lines.
- `javascript`, `github_actions`: after `.github/dependabot.yml` sets `labels: [dependencies]`.
- `blocker`: merged into `severity:blocking`, with `.github/scripts/stale/run.sh` updated.
- `help wanted`, `needs-decision`, `wayfinder:prototype`: no code writes them and no document says
  to apply them.
- `pr:needs-verification`, `via-agent`, `invalid`, `question`: no code writes them, but
  `docs/agents/triage-labels.md` tells reviewers, sessions and triagers to apply them. Each stays
  until that row is replaced.
- `lens:*` and `wayfinder:*`: the maintainer has not ruled. `scripts/jev-lens/triage.mjs` adds the
  `lens:` labels through `gh`, so deleting them first breaks the triage lens.

`health-alert` stays: `.github/scripts/health/alert.sh` opens its issue with
`gh issue create --label health-alert`, which opens nothing if the label is gone.
