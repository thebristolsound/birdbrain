# Label-to-merge: replace the review rule with a gate check and a merge label

**Status:** approved 2026-10-06; built and merged in #1750 (`deabdcb2`); step 6 applied 2026-10-06; step 7 open
**Date:** 2026-10-06
**Decision:** [ADR-0041](../adr/0041-merges-are-requested-by-label.md) (proposed)

## Current state (read 2026-10-06)

- Ruleset `main` (id 14967088), `pull_request` rule: `required_approving_review_count: 1`,
  `require_code_owner_review: true`, `require_last_push_approval: true`,
  `dismiss_stale_reviews_on_push: true`, `allowed_merge_methods: [squash]`. Bypass:
  `RepositoryRole`, mode `pull_request`.
- Required checks: `lint`, `typecheck`, `test`, `build`, `e2e`, `Secret scan (full history)`,
  `Registry publish guard`.
- Repository: `allow_auto_merge: false`, `squash_merge_commit_title: PR_TITLE`,
  `squash_merge_commit_message: BLANK`, `delete_branch_on_merge: true`.
- `CODEOWNERS`: `* @thebristolsound`.
- `merge.sh` composes the message, checks required checks at head, and merges with `--admin`
  when the `gh` login authored the pull request.
- `pre-pass-gate.yml` seeds `agent/pre-pass`; it cannot write on Dependabot pull requests.
- `ci.yml`, `docs.yml` and `security.yml` run on `push` to `main`.

## Steps

Each step is one commit on this branch unless noted. Steps 1 to 4 change no repository setting.

1. **Message composer.** Already separate: `.claude/skills/merge-pr/scripts/compose.mjs` writes
   `subject.txt` and `body.txt`, and the merge workflow calls it directly. No change.
2. **`merge-gate` workflow.** `.github/workflows/merge-gate.yml`, on `pull_request`
   (`opened`, `reopened`, `synchronize`, `labeled`, `unlabeled`, `ready_for_review`) and
   `pull_request_review` (`submitted`, `dismissed`). One job named `merge-gate` that reads labels,
   the `Closes` issues' labels, the `agent/pre-pass` status and reviews at head, with a read-only
   token, and exits 0 or 1 per ADR-0041 decision 1. The rule lives in a small script with unit
   tests in `tests/mergeGate.test.ts`. A pre-pass verdict is a commit status and triggers no
   PR event, so `merge.sh` re-runs the last gate attempt when `merge-gate` is the red check. A
   re-run keeps its original workflow definition; a dispatch on the head branch would run the
   branch's own, which the Codex review on #1750 flagged.
3. **Withdraw on push.** In the same workflow, a second job on `synchronize` removes `approved`
   and `merge` and runs `gh pr merge --disable-auto`. It needs a write token, so it runs on
   `pull_request_target` and does not check out the pull request.
4. **Merge-on-label workflow.** `.github/workflows/merge-on-label.yml`, on
   `pull_request_target` `labeled` with `merge`. It checks out `main` only, refuses unless the
   label's actor is a code owner and the pull request is not a draft, runs `compose.sh` and the
   body linter, then as the machine account runs
   `gh pr merge <n> --auto --squash --match-head-commit <sha> --subject ... --body-file ...`.
   On refusal it removes `merge` and comments why.
5. **Labels.** Create `approved` and `merge`; document them in `docs/agents/triage-labels.md`.
6. **Settings, by API, in this order** (not in git; the current values above are the rollback):
   1. `allow_auto_merge: true`.
   2. Add `merge-gate` to the required checks.
   3. Set the `pull_request` rule to `required_approving_review_count: 0` and
      `require_code_owner_review: false`, keeping squash-only.
   Applied 2026-10-06 after #1750 merged: `allow_auto_merge: true`; required checks gained
   `merge-gate` (GitHub Actions, integration 15368); the `pull_request` rule now has
   `required_approving_review_count: 0`, `require_code_owner_review: false` and
   `require_last_push_approval: false`, still squash-only. Rollback restores the values under
   "Current state".
7. **Prove it.** On a throwaway docs pull request: label `merge` before checks finish and see it
   merge when they go green, with the composed message and the `push` workflows running on
   `main`. On an `evidence-affecting` test pull request: `merge` alone does not merge; `approved`
   then `merge` does; a push after `approved` withdraws it. On a Dependabot pull request:
   `merge-gate` reports. Each result goes in the pull request body.
8. **Docs.** `CLAUDE.md` ("Merges go through ...") and `AGENTS.md`, `merge-pr/SKILL.md`
   (`merge.sh` becomes the fallback, no automatic `--admin`), and the dispatch skill's auto-merge
   step, which keeps `merge.sh --cli agh` for non-evidence pull requests. ADR-0041 moves to
   Accepted.

## To verify before building

- That `gh pr merge --auto` honours `--match-head-commit`, and what auto-merge does when the head
  moves (the withdraw job is the guard either way).
- That a required check produced by a job conclusion counts the latest run on the head commit
  when the same job reruns on a label event.
- That `pull_request_target` runs from Dependabot pull requests can read the machine account
  secret when the maintainer applies the label (the actor is the maintainer, not Dependabot).

## Out of scope

- The red dependency audit on every open pull request (three advisories in `seroval` and
  `source-map-js`). It is not a required check.
- Making `agent/pre-pass` itself a required check; `merge-gate` reads it instead.
- The `process` freeze generally. The maintainer lifted it for this change only.

## Approval

This plan changes the `main` ruleset and a repository setting, which git cannot roll back, so
it waits for explicit approval before step 6. Steps 1 to 5 are reversible and may be built
first on approval of the plan.
