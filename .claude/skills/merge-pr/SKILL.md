---
name: merge-pr
description: Squash-merge one PR into main with the subject and body ADR-0022 expects, read back what landed, and clean up the branch. Run it for every merge, yours with `gh` and the dispatcher's with `agh`.
---

# merge-pr

Every PR lands on `main` the same way: one squash commit whose subject is the PR title with
`(#n)` and whose body is the PR's `## Summary` section. The repository allows only squash
merges and sets the message to `PR_TITLE` + `BLANK`, so a merge that supplies nothing lands
with an empty body. This skill supplies it and then checks the result instead of assuming it.

## Run

```shell
.claude/skills/merge-pr/scripts/merge.sh <n>              # you, as the maintainer
.claude/skills/merge-pr/scripts/merge.sh <n> --cli agh    # the dispatcher (ADR-0027)
.claude/skills/merge-pr/scripts/merge.sh <n> --dry-run    # stop after composing the message
```

`--cli agh` defines `agh` from `BIRDBRAIN_AGENT_GH_TOKEN` and refuses to continue unless it
authenticates as the machine account.

## What it checks before merging

1. The PR is open and its base is `main`.
2. At least one check run exists at the head commit, and every required status check of the
   rules that apply to `main` (read from the API) has a green check run or commit status there.
   A commit CI never ran on is refused, not treated as green; so is a rules read that fails or
   names no required checks. A check the rules do not require is printed as a `WARN` line when
   it is not green, and does not refuse.
3. The body passes `post-pr-body` (the linter tolerates a cloud-proxy footer after the
   attribution line). Under `gh` the check runs with `--any-author`, so a human-written body
   without the attribution line passes; under `agh` the line is required. A body that fails is
   fixed with `pr edit <n> --body-file <file>` first.
4. `evidence-affecting`, on the PR or an issue named on its `Closes` line: refused under
   `agh` (ADR-0005, ADR-0014); under `gh` it proceeds, because the maintainer running it is the
   human review. A label read that fails refuses the merge rather than reading as "no label."

The dispatcher's other conditions (a `success` pre-pass verdict on this sha, slot state, the
blocking-tier path list) stay the dispatcher's to establish; the script does not read them.

## What it does

- Composes the subject and the 72-column body with `scripts/compose.mjs`, which reads only
  `## Summary`. Test output, the Verification block and the attribution line never reach
  `main`.
- Takes the PR out of draft, then `pr merge --squash --match-head-commit <sha>`: a head that
  moved since the checks were read makes the merge refuse.
- Reads back: the merge commit on `main`, the remote branch (deleted by the repository setting,
  or deleted here; a branch in a fork is left to its owner), and the state of every issue on
  the `Closes` line.
- Locally: `git fetch --prune`, then deletes the branch when its tip is the sha that was merged
  (a squash leaves no ancestry, so the plain `-d` would refuse). A branch whose tip moved is
  reported and left alone. A worktree holding the branch goes to the `teardown` skill's
  `close --branch`, which removes it and the branch when the tree is clean, and refuses a
  t3code thread tree or the tree the merge runs from, printing why.

It does not pass `--delete-branch` to `gh`: that flag also switches the local branch, which
fails inside a worktree after the merge has already happened.

`scripts/test-compose.sh` runs `compose.mjs` over the `post-pr-body` fixtures.
