---
name: ship-unit
description: Take one change in this repository from a branch to a pull request that is ready to merge, while the maintainer is away, and hand the merge decision to them. Use when `full-send` is invoked here, or when asked to ship, land or own a change through its merge.
---

# ship-unit

The maintainer is not watching. You own the change until its pull request is ready to merge,
and a question reaches them only through `AskUserQuestion`. Merging stays a human act
(ADR-0017): the maintainer decides each merge, and step 6 is where you ask. Each step ends on a
state you can read; start the next step when that state holds.

## Steps

1. **Branch.** Work on a branch cut from `origin/main`, in a worktree of its own
   (`docs/agents/worktrees.md`). Done when `pnpm check --dry-run` prints a plan there.
2. **Pin, when a changed file is blocking tier**
   (`docs/specs/2026-07-31-evidence-affecting-paths-assessment.md`). Before the change, commit a
   known-answer test that passes on the unchanged source. Done when that commit exists; from
   then on its expected values stay as committed.
3. **Change and prove.** Run `pnpm check` between edits. Proof is something you observed in this
   session. For behaviour the app shows, that is the running app (`run-birdbrain`); for a
   change to what a Capture writes, it is that skill's `capture-proof.mjs` against a build of
   `origin/main`. Done when every changed behaviour has an observation you can quote.
4. **Open.** Run `pnpm preflight` at head, write the description (`post-pr-body`), push, open
   the pull request non-draft, and label it (`docs/agents/background-jobs.md`, "Label it").
   Done when the description's Verification block names the pushed head.
5. **Review.** Wait for CI, `review/fleet` and Codex with the harness's pull request watcher,
   then sort every finding by the table below. Done when every required check and
   `review/fleet` are green at head, and each finding is fixed, declined on its thread with a
   reason, or listed in the description.
6. **Hand over.** Ask the maintainer with `AskUserQuestion`: the link, the head sha, what you
   proved, and what is still theirs. On an `evidence-affecting` pull request that is their
   approving review or their `approved` label at head (ADR-0041); on every pull request it is
   the merge. Done when they have answered.
7. **Act on the answer, at the head the question named.** A new head voids the answer, so ask
   again. When the answer tells you to apply `approved`, use the override
   `.claude/hooks/guard-maintainer-labels.sh` documents for a label the maintainer asked for.
   When it tells you to merge, run `.claude/skills/merge-pr/scripts/merge.sh <n> --admin` once
   `merge-gate` and every required check are green; the `merge-pr` skill says what the script
   checks first. When they keep either act for themselves, do nothing more. Done when the
   answer is carried out, or the pull request waits on the maintainer alone.
8. **Report.** The link, the merge commit when there is one, the proof, each decision you took
   for the maintainer, and each finding you left in place.

## A new head is expensive

Every push costs a full `pnpm preflight`, a review fleet round, and on an
`evidence-affecting` pull request a new approval. Spend heads on purpose:

- **A pushed branch only gains commits.** Answer a finding with a new commit, and leave
  rebasing and amending to the time before the first push.
- **One push per review round.** Collect every fix the round calls for, commit them, run one
  preflight, push once.
- **Merge `origin/main` in on a signal** (ADR-0021): GitHub reports a conflict, or a required
  check needs the merged tree. Use `git merge --no-commit --no-ff origin/main` and a
  `chore(merge): ...` commit. When the diff against `main` is unchanged, `pnpm preflight --carry`
  writes the block for the new head without a run. Nothing ran on the merged tree locally,
  so the required checks at the new head must be green before step 6, as for any head.
- **The description is edited in place.** A wrong sentence in it needs a `PATCH` of the body,
  never a push.
- **Another open pull request that edits the same files** makes the second to land need
  `main` merged in and a new approval. Name that in the approval question.

## Sorting a finding

| Finding | What it costs |
| --- | --- |
| Blocking, or a required check that fails | A fix and a new head. |
| Non-blocking, about behaviour or a gap in a test | A fix in this round's push. |
| Non-blocking, about wording in a comment or a doc, while `review/fleet` is red | A fix in this round's push. |
| The same, once `review/fleet` is green at head | A bullet in the description's findings list. No push for wording alone. |
| Against the description | An edit of the description. |
| Outside the change | A bullet in the description's findings list; an issue only under the rule in `CLAUDE.md`, "Issue tracker". |

A reviewer's reply to a wording fix is new wording to review. The table is what ends that loop.

## When to ask

Ask with `AskUserQuestion`, and put everything the answer needs in the question:

- The hand-over in step 6.
- A required check that only something outside this pull request can turn green.
- A step outside the change: a new dependency, a schema migration, deleting data, another
  pull request's branch.

Decide everything else yourself, on a repository document, an ADR or an existing pattern
(ADR-0015), and list the decision in the report.
