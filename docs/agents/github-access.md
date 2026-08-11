# GitHub access from agent sessions

How agents reach GitHub in Claude Code on the web, and which commands actually work
there. Written because the agent contracts and `.claude/settings.json` are both written
against `gh`, and `gh` alone is not sufficient in that environment.

## The short version

| Surface | Works in Claude Code on the web? |
|---|---|
| `gh api <REST path>` | **Yes** |
| `gh pr view/list`, `gh issue view/list`, `gh pr diff`, `gh label list` | **No — 403** |
| `gh pr create`, `gh pr edit` | **No — 403** |
| GitHub MCP tools (`mcp__github__*`) | **Yes**, and they can write |
| `git` over the session proxy | **Yes** — fetch, push |

## Why the high-level `gh` commands fail

`gh` is not installed in the base image. `.claude/hooks/session-start.sh` installs it
(GitHub's apt repo, falling back to the Ubuntu archive), and `GH_TOKEN` is already
exported by the environment, so it is authenticated on arrival.

Installing it is not enough. `gh`'s porcelain commands — everything under `gh pr`,
`gh issue`, and `gh label` — are backed by GitHub's GraphQL API, and the session proxy
serves only a pinned set of PR-review GraphQL operations. Anything else returns:

```
403 Forbidden: This GraphQL query is not enabled for this session — only the pinned
set of PR-review operations is served. Use REST via `gh api repos/{owner}/{repo}/...`
```

`gh auth status` reports "The token in GH_TOKEN is invalid" for the same reason — its
validation probe is a GraphQL call. The token is fine; test it with `gh api /user`.

This is a property of the environment, not of the `gh` version, so no upgrade fixes it.

## What to use instead

**Reading** — `gh api` with REST paths:

```bash
R=thebristolsound/birdbrain
gh api "repos/$R/pulls/339" --jq '{number,state,draft,mergeable_state}'
gh api "repos/$R/issues/339/labels" --jq '[.[].name]'
gh api "repos/$R/pulls/339/comments" --jq 'length'          # review comments
gh api "repos/$R/issues/339/comments" --jq 'length'          # PR-level comments
gh api "repos/$R/pulls/339/reviews"
gh api "repos/$R/issues?state=open&labels=ready-for-agent" --jq '[.[].number]'
gh api "repos/$R/issues/229/dependencies/blocked_by" --jq 'length'
```

Three gotchas:

- **Every collection endpoint paginates at 30 by default — pass `--paginate`.** This is the
  one most likely to bite, because it produces a wrong answer rather than an error: a
  truncated first page of `.../pulls/<n>/comments` is indistinguishable from a PR with no
  older feedback, and a truncated issue list is indistinguishable from a frontier whose
  oldest eligible issue does not exist. Use `gh api --paginate "…&per_page=100"`.
- **`gh api repos/{owner}/{repo}/pulls` (the list endpoint) returns `[]`.** Fetch a PR
  by number, or list via `repos/{owner}/{repo}/issues` — PRs appear there with a
  `pull_request` key.
- **Check runs and commit statuses are 403** for the `GH_TOKEN` identity
  (`Resource not accessible by integration`). Read CI state through the GitHub MCP
  tools instead, which use a different token.

**Writing** — *on the web*, use the GitHub MCP tools, not `gh`. Opening a PR, applying
labels, and posting comments all go through `mcp__github__create_pull_request`,
`mcp__github__issue_write`, and `mcp__github__add_issue_comment`. This rule is
environment-specific and inverts locally — see "Local machines" below before applying it.

**The diff** — read it from git, which is not proxied the same way:

```bash
git fetch origin <branch> && git diff origin/main...origin/<branch>
```

Use `git show <ref>:<path>` to read a branch's files without checking it out.

## Consequences for the agent contracts

A subagent's tool list (`Read`, `Edit`, `Bash`, `Grep`, `Glob`) does **not** include the
GitHub MCP tools. So a subagent can read GitHub through `gh api` but **cannot open a PR
or apply a label itself**. Where a contract says "open the PR", the workable split in
this environment is:

1. The implementer pushes its branch and writes the PR body to a file.
2. The dispatcher opens the draft PR and applies the labels via MCP.

The implementer must then not claim it opened the PR or applied the labels — it did
neither. State the handoff explicitly, per the implementer contract's evidence-gate rule
that gate artifacts assert only actions their author took.

This also means `gh pr create --label` is unavailable here regardless of whether
attaching labels at creation is desirable. (Separately: `gh pr create --label` does not
attach labels atomically even where it does work — `CreatePullRequestInput` has no
`labelIds` field, so `gh` issues a second `updatePullRequest` mutation afterwards.)

## Local machines

None of this applies outside Claude Code on the web. The session-start hook exits
immediately unless `CLAUDE_CODE_REMOTE=true`, and a local `gh` install talks to GitHub
directly with no proxy in between, so the porcelain commands work normally.

**The inverse also holds: locally there are no GitHub MCP tools.** The `mcp__github__*`
tools are provisioned by the web sandbox, not by any config in this repo or in
`~/.claude.json`, so a local session that follows a "writes go through MCP" instruction
finds the tools missing. Use `gh` for both reads and writes locally — the local token
carries full `repo` scope, so `gh pr create`, `gh issue comment`, and
`gh issue edit --add-label` all work, and there is nothing MCP would add.

A routine that can run in either place must therefore **probe rather than assume**:

```bash
gh issue list --repo thebristolsound/birdbrain --limit 1 >/dev/null 2>&1 \
  && echo "LOCAL — gh for reads and writes" \
  || echo "WEB — gh api REST for reads, GitHub MCP for writes"
```

The dispatch skill (`.claude/skills/dispatch/SKILL.md`) does this at the top of every
cycle. It was added after a 2026-08-10 local run stated the web rule unconditionally and
dead-ended at its first write.
