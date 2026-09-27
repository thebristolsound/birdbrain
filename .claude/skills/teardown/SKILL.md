---
name: teardown
description: Close out and reclaim git worktrees and local branches. Use when finishing a task in a worktree, when sweeping stale trees and merged branches, or when creating a scratch worktree the sweep must be able to find.
---

# teardown

Every agent-made worktree ends in one of two states: removed, or listed with the reason it
stays. `scripts/teardown.sh` decides which and holds every deletion, so run it rather than
removing trees or force-deleting branches by hand. Who creates which tree, and why none of
them cleaned up before, is in `docs/agents/worktrees.md`.

## Close one tree

```shell
.claude/skills/teardown/scripts/teardown.sh close --artefacts         # task end: outputs only
.claude/skills/teardown/scripts/teardown.sh close [<path>]            # remove the tree if its lane allows
.claude/skills/teardown/scripts/teardown.sh close --branch <ref> --merged <sha>   # merge.sh
```

`--artefacts` deletes the git-ignored outputs (`.preflight/`, `.health/`, `coverage/`,
`test-results/`, `playwright-report/`, `out/`, `dist/`, `extension/dist/`,
`.serena/cache/`) and keeps the tree, so a fix round can still land in it. The tree itself
goes when its PR merges, through `merge.sh`. `--merged <sha>` states the merged head instead
of asking GitHub, which can lag a merge by seconds.

Close refuses the main checkout, the tree your shell stands in, and a tree under
`~/.t3/worktrees/` unless `--t3code` is passed. It exits 1 on any refusal and prints why.

## Sweep everything

```shell
.claude/skills/teardown/scripts/teardown.sh sweep                     # dry run: the table
.claude/skills/teardown/scripts/teardown.sh sweep --apply             # act on apply lanes
```

`--older-than <days>` narrows the apply lanes to trees and branches that have not moved in
that many days. `--count` prints one line of totals; session start runs it.

## Lanes

A tree is **clean** when `git status` is empty, or when its only change is
`.serena/project.yml`: Serena rewrites that file on activation, and older branches still
track it. Merged means the branch is the head of a merged PR, read from `gh pr list`; a squash
merge leaves no ancestry, so `git merge-base` cannot answer it.

| Lane                                         | Action under `--apply`                         |
| -------------------------------------------- | ---------------------------------------------- |
| Registered, directory gone                   | `git worktree prune`                           |
| Clean tree, merged PR                        | remove; `branch -D` when the tip is the merged head, else keep |
| Clean tree, PR closed unmerged               | remove; keep the branch                        |
| Clean detached tree under `/tmp`, HEAD on a ref | remove                                      |
| Branch with no tree, tip is a merged PR head | `branch -D`                                    |

Everything else is a report lane: listed and left, whatever the flags. That covers an open
PR, no PR, a dirty tree, a lock whose process ID is alive or unnamed, the main checkout, mangled
`\wsl.localhost` paths, a merged branch whose tip moved, and every stash entry. A t3code
tree or one younger than `--older-than` shows its apply lane demoted, with the reason.

Removal never passes `--force`, so git refuses a tree that turned dirty between the check and
the act. A lock is lifted only when the process ID in its reason is dead.

## Creating a scratch tree

A worktree you create yourself goes under `/tmp/birdbrain-wt/` and is locked with your
session's process ID, so the sweep can find it and leaves it alone while you run:

```shell
git worktree add /tmp/birdbrain-wt/<purpose>-<n> <ref>
git worktree lock /tmp/birdbrain-wt/<purpose>-<n> \
  --reason "birdbrain <purpose> pid=${CLAUDE_PID:-$PPID} created=$(date -u +%FT%TZ)"
```

When the work is pushed, `teardown.sh close <path>` removes it. t3code and Agent-tool trees
keep their own roots and locks.

## Tests

`scripts/test-teardown.sh` builds a throwaway repo with one tree or branch per lane and a
`gh` shim. Run it under `bash -c`, not the agent tool shell.
