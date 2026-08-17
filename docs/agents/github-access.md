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

Which identity a write goes out under is a separate question from which mechanism works —
see "The pipeline's identity" below. Every write the dispatch routine makes is made as the
machine account, and a session that cannot authenticate as it does not write at all.

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
finds the tools missing. So locally `gh` is the only write mechanism there is — but only
to the extent the **authenticated identity is actually authorized**. A working local `gh`
does not by itself imply a token with `repo` scope: PR creation, issue comments, and label
updates are each separately permissioned, and a read-only or finely-scoped token will list
issues happily and then fail the first write. Check the identity and its scopes rather than
inferring them:

```bash
gh auth status   # reports the active account and the token's scopes
```

That reports the *maintainer's* login, which is the identity for reads and for the
implementer's branch pushes (SSH). It is **not** the identity the dispatch routine writes
with — those go out as the machine account, next section — so `gh auth status` showing
`repo` scope is necessary for the human's own work and says nothing about whether a dispatch
cycle can write. Anything less than the machine identity checking out, and the routine must
stop and report rather than half-complete a cycle — there is no MCP fallback locally.

A routine that can run in either place must therefore **probe rather than assume**. The
probe has **three** outcomes, not two: a non-zero exit means "not the local case", which is
not the same as "web". A local network outage, an expired token, or a mistyped repository
all exit non-zero, and treating those as web sends the routine to MCP tools that do not
exist there:

```bash
err="$(gh issue list --repo thebristolsound/birdbrain --limit 1 2>&1 >/dev/null)"
case $?:$err in
  0:*)                                  echo "LOCAL — gh for reads and writes" ;;
  *:*"not enabled for this session"*)   echo "WEB — gh api REST for reads, GitHub MCP for writes" ;;
  *)                                    echo "INDETERMINATE — stop and report: $err" ;;
esac
```

Only the pinned-GraphQL 403 documented above identifies a web session; everything else is
indeterminate. `CLAUDE_CODE_REMOTE=true` corroborates the web case (it is what the
session-start hook keys off) but is not a substitute for the probe — it says where the
session runs, not whether GitHub is reachable from it.

The dispatch skill (`.claude/skills/dispatch/SKILL.md`) runs this at the top of every
cycle. It was added after a 2026-08-10 local run stated the web rule unconditionally and
dead-ended at its first write.

## The pipeline's identity

**Agent PRs are opened by a machine account, not by the maintainer** (ADR-0012,
`docs/adr/0012-agent-prs-are-opened-by-a-machine-account.md`). GitHub forbids self-review,
so PRs the maintainer's account opens can never be approved or have changes requested by the
maintainer; the pipeline therefore has its own GitHub user, added as a collaborator with
write access, and the dispatch routine makes every write — claim comments, PR creation,
labels, pre-pass comments, `agent/pre-pass` statuses, review replies — as that account.

The credential is a fine-grained PAT, resource owner the machine account, restricted to this
one repository, with contents: read, issues / pull requests / commit statuses: read+write,
checks: read. It deliberately cannot push. It lives only on the maintainer's machine, in
`~/.config/birdbrain-agent/env` (`0700` directory, `0600` file):

```
BIRDBRAIN_AGENT_GH_LOGIN=<machine login>
BIRDBRAIN_AGENT_GH_TOKEN=github_pat_…
BIRDBRAIN_AGENT_GH_TOKEN_EXPIRES=YYYY-MM-DD
```

The dispatch routine sources that file and scopes the token per call, so the maintainer's
own `gh` login is never displaced:

```bash
. ~/.config/birdbrain-agent/env      # plain source — never `set -a` or `export` the token
agh() { GH_TOKEN="$BIRDBRAIN_AGENT_GH_TOKEN" gh "$@"; }
agh api user --jq .login          # must print $BIRDBRAIN_AGENT_GH_LOGIN, else stop
```

`GH_TOKEN` in the environment takes precedence over `gh`'s stored login, which is what makes
the per-call scoping work without `gh auth switch`. The token stays a shell variable: sourcing
without `set -a` means no child process other than the `agh` call sees it — a `set -a` or
`export` would hand it to every subprocess the session spawns. Provisioning and rotation are a human-only
procedure — `scripts/setup-agent-github-account.sh` walks it — and the token is never
committed, never a repo `.env` value, and never an Actions secret (no workflow needs it).

**On the web the machine token is not provisioned.** The GitHub MCP tools write as the
sandbox's identity, and the `GH_TOKEN` the environment exports is not the machine account's,
so a web dispatch cycle fails the identity check and stops before claiming the slot. That is
the intended outcome until the token exists there (ADR-0012 §5); the mechanism notes above
about MCP writes remain accurate for non-dispatch work.
