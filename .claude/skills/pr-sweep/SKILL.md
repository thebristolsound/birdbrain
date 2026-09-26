---
name: pr-sweep
description: Maintainer-present sweep of every open PR — pre-pass each, dispatch fixes, merge the approved ones including evidence-affecting, until main holds every mergeable PR.
disable-model-invocation: true
---

# pr-sweep

The maintainer is in the session and has asked for the whole open-PR queue to land. Their
presence is the human review that ADR-0005 reserves evidence-affecting merges for, so
`merge.sh` runs under `gh` and merges them. That authority is the maintainer's, which is why
this skill is user-invoked: the dispatch routine and any unattended job keep the
`dispatch` skill's rules.

You are the **coordinator**. Reviewers and implementers do the reading and the code; you hold
the queue, post every GitHub write, and merge. Two identities:

- `agh` (machine account) posts comments, replies, statuses and filed issues. Load it as the
  `dispatch` skill's GitHub access section says; never export the token.
- `gh` (maintainer) edits PR bodies and runs `.claude/skills/merge-pr/scripts/merge.sh <n>`.

## 1. Survey

List every open PR with labels, draft state, `mergeable`, head sha, failing required checks
and any `**Review verdict:` comment. A verdict counts only if its reviewed sha is the current
head. Link every PR to the thread (`link_pull_request`) when the t3-code tools exist.

Classify each PR into exactly one lane:

- **merge**: approve verdict on head, required checks green, `MERGEABLE`.
- **review**: green and conflict-free, no verdict on head.
- **fix**: red CI, `CONFLICTING`, or a request-changes verdict. A dependabot PR goes here
  when red; fixes push to its existing branch.

Done with this step when every open PR sits in a lane.

## 2. Run the lanes

The machine has 4 cores and every agent runs tests: keep **three agents in flight**, and
refill a slot the moment one returns. Order the review lane smallest diff first; hold a
conflicted PR until the clean ones ahead of it have merged, so it is resolved once.

- **review**: post `agent/pre-pass` `pending` on the head sha, then spawn
  `birdbrain-reviewer` with the review prompt in [prompts.md](prompts.md).
- **fix**: spawn `birdbrain-implementer` with the fix prompt in [prompts.md](prompts.md). When
  it returns, post its replies and body, then send the PR back to **review** as a delta round
  against the previous reviewed sha.
- **merge**: section 4.

Pass each agent the PR number, head sha, labels, and any other worktree holding the branch
(`git worktree list`) so it stays out of it. Relay review feedback by pointer: the agent
re-reads the review surface itself.

## 3. Act on a verdict

Run `.claude/skills/post-comment/scripts/check.sh` on the verdict file, post it with `agh`,
then set the status (`success` or `failure`, description ≤140 chars naming what is wrong,
`target_url` the comment).

- **Approve**: apply any `## Summary` corrections the reviewer gave before merging, because
  the Summary becomes the squash commit body on `main`. Then merge.
- **Blockers only in the body, sha unchanged**: fix the body yourself (`gh pr edit
  --body-file`, after `post-pr-body` check), post a short follow-up comment saying so, and
  set `success` on the same sha. No new code round.
- **Code blockers**: post `failure` and move the PR to **fix**.

An agent that surfaces a product question does not block the merge. Put the question to the
maintainer in plain words and keep going.

## 4. Merge

Before each merge: required checks green at head (`gh pr checks <n> --required`), `mergeable`
settled to `MERGEABLE` (it reads `UNKNOWN` for a few seconds after any merge; poll), and a
`success` pre-pass on head. Then `merge.sh <n>`.

After every merge, re-read `mergeable` on the rest. A PR that turned `CONFLICTING`:

- **Small conflict** (one or two hunks, no evidence-path or migration file): resolve it
  yourself in a fresh `/tmp` worktree. Merge `origin/main` (never rebase), run lint,
  typecheck and the touched tests, and commit with the `post-commit-message` check. Push only
  as a fast-forward of the head you started from. Comment the resolution and carry the
  pre-pass `success` forward to the new sha for a merge-only delta.
- **Anything larger**: **fix** lane, then a delta review of the resolution.

When a merge brings a toolchain change (compiler, linter, lockfile) onto `main`, message every
in-flight implementer to merge the latest `main` before its final preflight.

If a PR's `Closes` line would close an issue with an item the PR left for the maintainer,
reopen that issue after the merge with a comment naming the remaining item.

## 5. File what the queue found

A user-visible or evidence-affecting defect that an agent found and correctly left out of its
PR gets filed (CLAUDE.md: at most two per PR). Search open issues first. A finding that
extends an existing issue is a comment on it. File as `agh`, label `needs-triage`, in the
`post-comment` defect shape (its `Where:` line must name a `file:line`), and name the issue
number you got back.

## 6. Done

The sweep is done when both hold:

- `gh pr list --state open` is empty, or every PR left is named in the report with the
  blocker that keeps it off `main`.
- `main`'s CI run at the final merge commit is green (`gh run watch`). Runs cancelled by a
  newer push are not failures.

Report: what merged, blockers caught and fixed before merge, bodies corrected, issues filed,
and each open question for the maintainer restated in full.

## Gotchas

- `gh pr checks <n> --required --watch --interval 60` in a background shell is the CI wait;
  CI does not run at all on a conflicting PR.
- A session restart kills background agents. Check each PR's remote head, then resume each
  agent by id with `SendMessage` rather than respawning it.
- `git branch -D` is blocked by a hook; delete temp branches with `-d` after their commits
  are on the remote.
- Diagnostics that appear from `/tmp` worktrees without `node_modules` are noise.
- The `post-pr-body` Summary cap is five sentences: drop process sentences ("opened directly
  by the agent") first.
