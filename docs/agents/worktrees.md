# Worktrees

Four mechanisms create worktrees in this repository. Until the `teardown` skill, none of them
reliably removed what it created: on 2026-09-25, 178 trees were registered, 85 of them clean
with a merged PR. The rules for closing and sweeping live in
`.claude/skills/teardown/SKILL.md`; this page records who owns what.

| Path                               | Created by                                  | Removed by                                                        |
| ---------------------------------- | ------------------------------------------- | ----------------------------------------------------------------- |
| `~/.t3/worktrees/birdbrain/*`      | a t3code thread; `scripts/setup-worktree.sh` runs on creation | `teardown.sh` with `--t3code`; t3code's own `storageCleanup` did not reclaim them |
| `<repo>/.claude/worktrees/agent-*` | the Agent tool's worktree isolation, `EnterWorktree` | the Agent tool when unchanged; otherwise `merge.sh` at merge, or a sweep |
| `/tmp/birdbrain-wt/*`              | an agent following the skill's creation rule (pr-sweep conflict and review trees) | the creating agent with `teardown.sh close`; a sweep once its lock pid is dead |
| Local branch                       | implementer, t3code, interactive sessions   | `merge.sh` step 8 via `teardown.sh close --branch`; a sweep       |
| Ignored outputs inside a tree      | preflight, tests, builds                    | `teardown.sh close --artefacts` at task end                       |
| Stash entry                        | sessions                                    | nobody: the stack is shared and the git guardrail blocks pop and drop, so a sweep lists entries and leaves them |

GitHub-side state (statuses, claims, labels) is `.github/scripts/dispatch/cleanup.sh`, not
this skill.

The Agent tool keeps a tree its agent changed, and an implementer always commits, so every
dispatched tree survives the agent. The implementer therefore clears only its outputs at
hand-off, and the tree goes at merge, when a fix round can no longer need it.

Serena left the repository on 2026-09-25, but branches cut before that still track
`.serena/project.yml`, and Serena rewrites it on activation. The sweep counts a diff confined
to that file as clean; without the exception, 45 trees read as dirty on 2026-09-27.
