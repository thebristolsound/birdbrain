# Teardown skill: close out and reclaim agent worktrees

Date: 2026-09-25. Status: tasks 1 to 7 built on 2026-09-27; the maintainer chose this plan
over the shared-skill alternative. Questions 1 to 3 are still open and gate task 9, the
first `--apply`. Question 4 took the recommendation (`teardown`).

Reading frame: every count below was measured on 2026-09-25 from this session's worktree, with
`origin/main` at `984973b8`. The counts are a point-in-time reading, not maintained figures.

## Problem

Agents open worktrees through four mechanisms and close them through none.

- **t3code** creates a thread worktree under `~/.t3/worktrees/birdbrain/` and runs
  `scripts/setup-worktree.sh` on creation (`runOnWorktreeCreate` in its project settings).
- **The Agent tool** with `isolation: "worktree"`, and `EnterWorktree`, create
  `<repo>/.claude/worktrees/agent-*` and lock each one with the reason
  `claude agent <id> (pid <n> start <s>)`.
- **The pr-sweep skill** resolves conflicts in "a fresh `/tmp` worktree."
- **A Windows-side tool** wrote six worktrees with mangled `\wsl.localhost...` paths into the
  main checkout, and one of them plus a `jean.json` are staged there today.

What removes them today:

- t3code's `storageCleanup` settings say remove on merge, on delete, and when unchanged after
  five days. 85 clean trees with a merged pull request are still registered, so in practice
  the setting does not reclaim.
- The Agent tool removes its tree only when it is unchanged. An implementer always commits, so
  every dispatched tree stays. `ExitWorktree` acts only on a tree the same session created.
- `merge.sh` (the merge-pr skill) deletes the local branch only when no worktree holds it, and
  its skill file states "Worktrees are never removed; t3code owns them."
- Nothing removes a `/tmp` tree, and nothing deletes `.preflight/`, `coverage/`,
  `test-results/`, `out/`, `dist/`, or `extension/dist/` inside a tree that stays.

Two open issues frame the work. #480 (`ready-for-human`) asks for the one-off prune and, in its
fourth acceptance criterion, for "whatever creates `worktree-agent-*` and `wf-*` trees either
cleans up on completion or the cleanup is documented". This plan is that criterion. #1370
established two rules that carry over: squash merges make `git merge-base --is-ancestor` the
wrong merged test (it finds 8 of 178 gone branches here), and a branch with no pull request is
never a mechanical delete.

## Measured state

Worktrees registered: 178. Lanes by pull request state of the checked-out branch, with a tree
counted clean when its only change is the `.serena/project.yml` drift described below:

| Lane                          | Clean | Dirty |
| ----------------------------- | ----- | ----- |
| Open pull request             | 5     | 0     |
| Merged pull request           | 85    | 16    |
| Closed, unmerged pull request | 3     | 2     |
| No pull request               | 46    | 6     |
| Detached HEAD                 | 13    | 2     |

Local branches: 393, against 142 on `origin`. Of the branches no worktree holds:

| Lane                          | Branches |
| ----------------------------- | -------- |
| Merged pull request           | 98       |
| Closed, unmerged pull request | 5        |
| No pull request               | 139      |

Other state:

| Item                                                    | Measured                       |
| ------------------------------------------------------- | ------------------------------ |
| Stash entries (shared stack, oldest from `master` days) | 16                             |
| Disk under `~/.t3/worktrees/birdbrain/`                 | 42 GB                          |
| Disk under `<repo>/.claude/worktrees/`                  | 33 GB                          |
| `node_modules` trees across both roots                  | 160 (pnpm-hardlinked, so the real cost is smaller; #480) |
| Trees whose only change is `.serena/project.yml`        | 39                             |
| Trees holding a `.preflight/` directory                 | about 35                       |
| Trees under `/tmp/`                                     | 3, all detached                |
| Locked trees with a live Claude agent                   | 1                              |

The `.serena/project.yml` drift: Serena regenerates the comment block that lists available
language servers when it activates, and a newer Serena writes a longer list than the committed
file carries. The diff is comments only. It makes 39 trees read as dirty to `git status`, which
would block any "clean tree" rule that does not name it.

## Who creates what, and who removes it

| Path                                    | Created by                                   | Removed by, today                                   |
| --------------------------------------- | -------------------------------------------- | --------------------------------------------------- |
| `~/.t3/worktrees/birdbrain/*`           | t3code thread; `setup-worktree.sh` runs      | t3code `storageCleanup` in name; nothing in practice |
| `<repo>/.claude/worktrees/agent-*`      | Agent tool isolation, `EnterWorktree`        | Agent tool, only when unchanged                     |
| `/tmp/*`                                | pr-sweep conflict resolution                 | nothing; `git worktree prune` once `/tmp` is wiped  |
| Local branch                            | implementer, t3code, interactive sessions    | `merge.sh` step 8, only when no tree holds it       |
| Stash entry                             | sessions; the guardrail forbids a bare stash | nothing; the guardrail blocks pop, drop, and clear  |
| Git-ignored outputs inside a tree       | preflight, tests, builds                     | nothing                                             |
| GitHub state (statuses, claims, labels) | dispatch                                     | `.github/scripts/dispatch/cleanup.sh`; out of scope |

## Decisions

Each decision names its grounding, in the ADR-0015 form. Every one is open to veto in the
questions at the end.

1. **Merged means "the branch is the head of a merged pull request," never ancestry.** Grounding:
   #1370's measurement, and `merge.sh` step 8, which already deletes a branch only when its tip
   is the sha the pull request merged.
2. **No new ledger.** Ownership is computed from what already exists: the path root names the
   creator, the lock reason carries the Claude agent's process ID, the branch name reaches the pull
   request, and `git status` reads cleanliness. Grounding: ADR-0029 (measure before adding
   automation machinery); t3code and the Agent tool create trees outside any hook the repo
   controls, so a marker could never be complete.
3. **One skill, named `teardown`, with two verbs: `close` for one tree and `sweep` for all of
   them.** Grounding: ADR-0015 class 1 (the maintainer's word for it); the one-skill-one-script
   shape of `post-comment`, `post-pr-body`, and `merge-pr`.
4. **The script holds the force.** `~/.claude/hooks/block-dangerous-git.sh` reads the Bash
   command string, so a script invoked by path is opaque to it, which is how `merge.sh` already
   runs `branch -D`. `teardown.sh` therefore owns every deletion, each gated: `branch -D` only
   when the tip equals the merged head sha; `rm -rf` only on paths `git check-ignore` confirms;
   `git worktree remove` never with `--force` (a dirty tree makes git refuse, which is the
   outcome wanted); a locked tree is unlocked first, and only when its process ID is dead.
5. **Report-only lanes never become apply lanes by flag.** Open pull request, no pull request,
   dirty, live lock, the main checkout, mangled paths, and the stash stack are listed and left.
   Grounding: #1370's rule on branches with no pull request; the guardrail's stash rules; #480's
   third criterion.
6. **A diff confined to `.serena/project.yml` counts as clean.** Grounding: the measured cause
   in the preceding section; nothing authored lives in that diff. The skill names the exception so it is open to audit.
7. **Model-invoked skill.** The implementer and pr-sweep must reach it on their own, so it
   keeps a description (the invocation rule in the writing-for-agents skill mechanics). The
   description carries three branches: closing a tree at task end, sweeping stale trees and
   branches, and creating a scratch tree the sweep can find.
8. **Enforcement phases in.** Prose and the two scripted call sites first; a `PreToolUse` hook in
   the `bound=` pattern only after one sweep has run clean. Grounding: ADR-0029.

## Design

### Files

```
.claude/skills/teardown/
  SKILL.md                     the rule, the lanes, the two verbs, the creation rule
  scripts/teardown.sh          close | sweep, bash, set -u, merge.sh conventions
  scripts/test-teardown.sh     fixture repo in mktemp, stubbed gh, one assertion per lane
docs/agents/worktrees.md       lifecycle table above, made current, plus the rules
```

`.gitignore` ignores `.claude/skills/*` except an allowlist; `!.claude/skills/teardown/` joins
it, or the skill never reaches `main`.

### `teardown.sh close [<path>] [--branch <ref>] [--artefacts] [--t3code]`

Closes one tree (default: the current directory) or every tree holding `<ref>`.

1. Refuse when the path is not in `git worktree list`, is the main checkout, or sits under
   `~/.t3/worktrees/` without `--t3code` (question 1).
2. Delete the git-ignored outputs: `.preflight/`, `.health/`, `coverage/`, `test-results/`,
   `playwright-report/`, `out/`, `dist/`, `extension/dist/`, `.serena/cache/`. Each path must
   pass `git check-ignore` inside that tree first. With `--artefacts`, stop here.
3. Read the tree: clean under decision 6, branch, upstream, pull request state by head ref
   (`gh pr list --state all --head <ref>`), lock reason and whether its process ID is alive.
4. Act by lane:
   - Merged pull request, clean: unlock if dead, `git worktree remove`, `git branch -D` when the
     tip equals the merged head sha, else `git branch -d`.
   - Closed unmerged pull request, clean: remove the tree, keep the branch, say so.
   - Open pull request, clean: remove the tree only under `--branch` from `merge.sh` or when
     the caller is the implementer at hand-off (its commits are pushed, and the branch keeps
     them either way, ADR-0019). Keep the branch.
   - No pull request, dirty, or live lock: refuse and print the reason.
5. Print one line per tree: lane, action taken or refused, path, branch.

### `teardown.sh sweep [--apply] [--older-than <days>] [--t3code]`

Dry run by default. Classifies every registered tree and every local branch no worktree holds into the
lanes in the table below, prints the table, and with `--apply` acts on the apply lanes only.

| Lane                                       | Default    | Action under `--apply`                              |
| ------------------------------------------ | ---------- | --------------------------------------------------- |
| Registered but directory gone              | apply      | `git worktree prune`                                |
| Detached HEAD, clean, under `/tmp/`        | apply      | remove the tree                                     |
| Merged pull request, clean                 | apply      | `close` as in the preceding section                                    |
| Closed unmerged pull request, clean        | apply      | remove the tree, keep the branch                    |
| Branch with no tree, merged, tip == merged sha | apply | `git branch -D`                                     |
| Branch with no tree, merged, tip moved     | report     | listed with both shas                               |
| Open pull request                          | report     | listed                                              |
| No pull request (tree or branch)           | report     | listed; question 2                                  |
| Dirty                                      | report     | listed with the change count                        |
| Locked, process ID alive                          | report     | listed                                              |
| `~/.t3/worktrees/` root                    | report     | apply lanes only with `--t3code`; question 1        |
| Main checkout, mangled `\wsl.localhost` paths | report  | listed for the maintainer                           |
| Stash entries                              | report     | listed with age; never touched                      |

`--older-than` narrows the apply lanes to trees whose last commit or last file change is older
than the given number of days; the sweep that runs from a session-start count uses it.

### The creation rule

An agent that creates a worktree itself (today, only pr-sweep) creates it so the sweep can
find and lane it:

```shell
git worktree add /tmp/birdbrain-wt/<purpose>-<n> <ref>
git worktree lock /tmp/birdbrain-wt/<purpose>-<n> \
  --reason "birdbrain <purpose> pid=$CLAUDE_PID created=$(date -u +%FT%TZ)"
```

The lock keeps `git worktree prune` and an unrelated `close` off it while the session lives;
a dead process ID makes it a normal candidate. t3code and Agent-tool trees keep their own roots and
locks; the sweep reads them, it does not create them.

### Tests

`scripts/test-teardown.sh` builds a bare origin and a working clone in `mktemp -d`, adds one
worktree per lane, and shims `gh` on `PATH` with canned merged, open, closed, and empty pull
request lists. One assertion per lane and one per refusal: dirty, live lock, main checkout,
t3code root without the flag, tip not equal to the merged sha, the `.serena/project.yml`
exception. It runs under `bash -c` (the tool shell is `zsh` on the maintainer's machine, per
`CLAUDE.md`), and under `shellcheck` when installed.

## Wiring

- **`merge-pr/scripts/merge.sh` step 8.** Replace "checked out in `<holder>`; run
  `git branch -d` after that worktree is removed" with a call to
  `teardown.sh close --branch "$head_ref"`. Amend the skill sentence "Worktrees are never
  removed; t3code owns them" per question 1.
- **`birdbrain-implementer.md`, Finishing.** Add `teardown` to `skills:` and one bullet: after
  the final push or hand-off, run `teardown.sh close --artefacts`. The tree itself goes at
  merge, through `merge.sh`, so a fix round can still land in it.
- **`pr-sweep/SKILL.md`, section 4.** The creation rule for the conflict tree, and
  `teardown.sh close` after the fast-forward push.
- **`.claude/hooks/session-start.sh`, local branch.** After the fetch, a bounded, non-fatal
  count: `timeout 15 teardown.sh sweep --count`, logged as one line naming the reclaimable
  totals and the command to run. Measurement only, no action (ADR-0029).
- **`docs/agents/worktrees.md`** plus one pointer line in `CLAUDE.md`, copied to `AGENTS.md`.
- **Phase 2, after one clean sweep:** `scripts/check.sh` in the `bound=` pattern as a
  `PreToolUse` hook on Bash, blocking for bound agents a `git worktree add` outside
  `/tmp/birdbrain-wt/` and any `git worktree remove --force`.

The diff is `.claude/**`, `docs/**`, root Markdown, and `.gitignore`. Everything but
`.gitignore` is the process-doc set the dispatch skill exempts from the pre-pass; the
`.gitignore` line makes it a mixed diff by the letter of that rule, so the pull request says
so and the maintainer merges it.

## Tasks

- [ ] 0. Maintainer answers questions 1 to 3 (question 4: `teardown`, taken).
- [x] 1. `docs/agents/worktrees.md`: the lifecycle table, the creation rule, the two verbs, and
      the pointer line in `CLAUDE.md` and `AGENTS.md`.
- [x] 2. `.claude/skills/teardown/SKILL.md` and the `.gitignore` allowlist line.
- [x] 3. `scripts/teardown.sh`: `close`, `sweep`, `--apply`, `--branch`, `--artefacts`,
      `--older-than`, `--t3code`, `--count`.
- [x] 4. `scripts/test-teardown.sh`, run under `bash -c`, green.
- [x] 5. Wire `merge.sh` step 8 and amend the merge-pr skill sentence.
- [x] 6. Wire the Finishing section of the implementer definition and pr-sweep section 4.
- [x] 7. Session-start count line, bounded and non-fatal.
- [ ] 8. Open the pull request as a process-doc change; the maintainer merges it.
- [ ] 9. Backlog: `sweep` dry run, table posted to #480; `sweep --apply`; before and after
      counts posted to #480 (its fifth criterion); hand the maintainer the three lists it will
      not alter: the main checkout's mangled paths and staged `jean.json`, the stash stack, and
      the no-pull-request branches.
- [ ] 10. Phase 2 hook, only after task 9 ran clean once.

## Built differently from the design

- **Decision 6 is the whole-file rule, not a comments-only rule.** A first cut accepted only
  comment lines; newer Serena also adds default keys (`included_apis: []`), which left 45
  drift-only trees reading as dirty on 2026-09-27.
- **`close --merged <sha>`** lets `merge.sh` pass the head it just merged instead of asking
  GitHub, which can lag a merge. The open-PR close lane was dropped: nothing calls `close`
  before a merge except with `--artefacts`.
- **`close` lifts a lock its own session placed** (`CLAUDE_PID`, verified present in tool
  shells), or the creation rule's own tree could never be closed. `sweep` never does.
- **`close` and `sweep` refuse the tree the caller stands in**, which covers `merge.sh` run
  from the branch's own worktree.
- **A detached tree is removed only when its HEAD is on some ref**, so no commit is orphaned.
- **pr-sweep's `prompts.md`** also creates `/tmp` trees (review and fix agents), so it carries
  the creation rule too.
- **The session-start count** took 5.7 s end to end on 2026-09-27 (188 trees, one `gh pr list`).

## Questions for the maintainer

1. **The t3code thread trees.** 85 clean trees under `~/.t3/worktrees/birdbrain/` have a merged
   pull request, and t3code's own setting says to remove a tree on merge. May the sweep remove
   them, or does it report them only? Recommendation: remove, behind `--t3code`, after one
   dry run you have read, and keep the flag off by default until the first live run shows
   t3code copes with a tree vanishing under an archived thread.
2. **Trees and branches with no pull request.** 46 clean trees and 139 branches. Report only,
   or may the sweep remove a clean tree older than 14 days while keeping its branch?
   Recommendation: the second; the branch keeps every commit (ADR-0019), and the tree is only
   a checkout plus `node_modules`. Branches stay report-only, per #1370.
3. **The stash stack.** 16 entries, some from before the rename to `main`. The sweep lists them
   and never touches them. Do you want the list with ages, or should the plan drop stash
   from scope? Recommendation: list, once, in the #480 report; #1370 names thirteen
   `stash-archive/*` branches on `origin` that may already hold them.
4. **Skill name.** `teardown` with `close` and `sweep`, or `worktree` with `open`, `close`, and
   `sweep`? Recommendation: `teardown`, your word, with the creation rule as one paragraph in
   it rather than a verb.

## Out of scope

- Remote branches on `origin` and the public-cutover prune: #1370 owns that decision.
- The `.serena/project.yml` regeneration itself: the skill tolerates the drift; fixing it is a
  separate one-line finding for the Serena hook.
- GitHub-side cleanup of statuses, claims, and labels: `.github/scripts/dispatch/cleanup.sh`.
- The `inflight` skill listed in this session's skill index ("survey every worktree, branch,
  ticket, stash and peer agent") overlaps with the sweep's report lanes; its file was not
  found under `~/.claude` during this session, so the overlap is unverified and no change to it
  is planned.
