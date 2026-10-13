# Review on request: the `review:requested` label

**Status:** active

Reflects `origin/main` at `b0a1a510`. Implements decision 6 of
[ADR-0046](../adr/0046-scheduled-review-of-maintainer-prs.md), added by the 2026-10-12
amendment. The maintainer applies `review:requested` to one of his PRs, and the scheduled PR
review runs on that PR right away instead of waiting for its hourly fire and its one-hour rule.

## Design

The label is the durable request, and the label event only starts a fire early. This matters
because `pr-review.yml` has `concurrency: group: pr-review` without cancel-in-progress. GitHub
keeps one pending run per group and cancels the others, so a label-triggered run queued behind a
running review can be dropped by the next hourly fire. Because the pre-gate reads the label on
every fire, the next scheduled fire takes a dropped request.

| Rule in ADR-0046 | Scheduled review | Requested review |
|---|---|---|
| Maintainer opened it from this repository | applies | applies |
| No `agent-pr` | applies | applies |
| Open at least an hour | applies | skipped |
| Nobody else reviewed it since the last verdict | applies | skipped |
| `review:skipped` the maintainer applied | stays off it | comes off |
| Process-docs-only diff | `review:skipped` | reviewed |
| Two failures stop retries | applies | skipped |
| Already reviewed at its head | no review | label removed, no review |
| Spend cap, 4 a day and 1 per PR in 6 hours | applies | applies; the label waits |
| Queue position | after requests | first, oldest request first |

The pre-gate honours `review:requested` only when the last `labeled` event for it on the PR was
the maintainer's. Only accounts with triage access can apply labels, but the check costs one
read, which `label_history` in `pregate.sh` already makes.

## Steps

1. **Create the label.** Run `gh label create review:requested --color 1d76db --description "The maintainer asked for a review now; the next PR review fire takes it (ADR-0046)"`.
   Done 2026-10-12, before merge: nothing on `main` reads the label until this change lands.
2. **Add the constant to `.github/scripts/pr-review/lib.sh`.** Add `REVIEW_REQUESTED='review:requested'`
   outside `REVIEW_STATES`, so `set_review_label` never removes it as a competing state.
3. **Update `.github/scripts/pr-review/pregate.sh`.**
   - Read whether the PR carries `review:requested`, and whether the maintainer applied it last
     (`label_history`, last actor equal to `$MAINTAINER`).
   - When it is a request, skip the `MIN_AGE` check, the `others` check, the `process_only`
     check and the two-failure stop, and remove a `review:skipped` the maintainer applied.
   - When it is a request and the PR's verdict names the head, call `unlabel` for
     `review:requested` and continue.
   - Add a `requested` queue ahead of `first`, sorted oldest first like the rest.
   - Update the header comment's rule list.
4. **Update `.github/scripts/pr-review/post.sh`.** After the state label is set, on every path
   (the failure path and the success path), delete `review:requested` if `labels` contains it.
   A failed requested review then follows the normal one-retry rule.
5. **Update `.github/workflows/pr-review.yml`.**
   - Add the trigger `pull_request_target: types: [labeled]`.
   - Replace the job `if:`. The current `|| github.triggering_actor == 'thebristolsound'` admits
     any maintainer-started event. Under the new trigger it would start a job for every label he
     applies, `merge` and `approved` included. The new condition admits three cases.
     A scheduled first attempt.
     A `workflow_dispatch` the maintainer started.
     A `pull_request_target` event whose `label.name` is `review:requested` and whose
     `sender.login` and `triggering_actor` are both `thebristolsound`.
   - Set `MODE` to `review` and `TARGET_PR` to `github.event.pull_request.number` for the label event.
   - Pin `actions/checkout` to `ref: ${{ github.event.repository.default_branch }}`, as
     `merge-on-label.yml` does. The run then executes `main`'s scripts, never the PR's, whatever
     event started it. Under `schedule` this is the ref checkout already uses.
   - Update the header comment.
   The `paid-runs` environment allows only `main` and `v*` tags. A `pull_request_target` run's
   ref is `main`, so the environment admits it. `merge-on-label.yml` already uses that
   environment from the same event.
6. **Update `docs/agents/background-jobs.md`.** Next to the `review:skipped` sentence, add one
   sentence: apply `review:requested` to have a PR reviewed now.

Seven files: the ADR (already amended in this commit), this plan, `lib.sh`, `pregate.sh`,
`post.sh`, `pr-review.yml` and `background-jobs.md`. No dependency, no schema migration.

## Verification

The pr-review scripts have no unit tests, and the workflow does not run on a branch. The paths:

1. `bash -n` on the three changed scripts, and a `bash -c` run of `pregate.sh report` against
   the live API with the machine token, with no PR labelled. The decision must match the last
   scheduled fire's step summary.
2. After merge, label one open PR of the maintainer's that is younger than an hour, and confirm
   these four things.
   One run starts from the label event.
   The pre-gate picks that PR.
   The verdict posts.
   `review:requested` is gone and one state label remains.
3. Apply `merge` or another label to a PR, and confirm `pr-review.yml` shows a skipped run, not a
   started one.
4. Run `gh workflow run pr-review.yml -f mode=report` with a request held by the per-PR cap, and
   confirm the summary names the hold and the label stays.

## Rulings

The maintainer ruled on 2026-10-12:

1. A requested PR whose diff is only process docs (`.claude/`, `docs/`, root Markdown) is
   reviewed. A request is an explicit ask, and the spend cap still bounds it.
2. A request on a PR already reviewed at its head runs no second review. The pre-gate removes the
   label, and the existing verdict comment answers the request.
