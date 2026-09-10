# Scheduled dispatch on a GitHub Actions host

**Status:** Approved 2026-09-06 (hosted runner, token as a repository secret). Implemented by
[ADR-0026](../adr/0026-scheduled-dispatch-runs-on-a-github-actions-host.md) and
`.github/workflows/dispatch.yml`.

**Supersedes the host half of the #310 verdict.** The routine stays as it is; this brief is
about where it runs.

## The problem in one paragraph

The dispatch routine (`.claude/skills/dispatch/SKILL.md`) works. Between 2026-08-30 and
2026-09-05 it merged eleven agent PRs from interactive sessions. It runs only when a human
opens a session and types `/dispatch`, because the only scheduled host tried so far, an
Anthropic cloud routine, sits behind a proxy that re-authenticates every GitHub request as the
session identity (#960, validated 2026-08-25). ADR-0027 forbids writing as the maintainer, so
every scheduled fire stopped at the identity gate. The #310 verdict of 2026-09-01 then withdrew
scheduled operation on the ground that no other unattended host exists.

That ground was not true when it was written. `.github/workflows/doc-curator.yml` has run
Claude Code unattended on a GitHub Actions runner every Monday since 2026-08-16, authenticated
by `CLAUDE_CODE_OAUTH_TOKEN` from the maintainer's subscription, opening PRs under its own
identity. The verdict's other two grounds (the streak instrument was never operated, and the
routine is proven as a tool) still stand and are not reopened here.

## What a scheduled host must provide

| # | Requirement | Why |
|---|---|---|
| R1 | Fires on a clock with nobody present | The whole point |
| R2 | Writes to GitHub as `birdbrain-agent`, never as the maintainer | ADR-0027 rule 2 |
| R3 | No proxy between the process and GitHub | #960 |
| R4 | Can push a branch and run `pnpm preflight`, including Electron tests | Implementer contract |
| R5 | Runs `claude` with the project's subagents and skills | Dispatch spawns `birdbrain-implementer` and `birdbrain-reviewer` |
| R6 | Leaves a report a human will read without opening a transcript | #960 acceptance criteria; ADR-0011 clause 1 |

## Candidates

| Host | R1 | R2 | R3 | R4 | R5 | R6 | Verdict |
|---|---|---|---|---|---|---|---|
| Anthropic cloud routine | yes | no | no | partial | yes | no | Dead. The proxy rewrites identity; proven 2026-08-25 |
| `systemd` timer in WSL2 on the maintainer's machine | while the machine is awake | yes | yes | yes | yes | needs building | Works today with zero rule changes, but the machine is the schedule |
| GitHub Actions, hosted runner | yes | yes, with the token as a secret | yes | yes, `ci.yml` already does it | yes | yes, run summary plus email on failure | **Recommended** |
| GitHub Actions, self-hosted runner on the WSL2 box | while the machine is awake | yes | yes | yes | yes | yes | The cost lever once the workflow exists; swaps in by changing `runs-on` |
| Separate always-on box | yes | yes | yes | yes | yes | needs building | New infrastructure to own; nothing it offers that Actions does not |

**Recommendation.** Build the workflow for a hosted runner. Write it so `runs-on` is the only
line that changes if minutes cost pushes it onto a self-hosted runner later.

## Facts verified for this brief

- Headless `claude -p` runs subagents from `.claude/agents/`, honours `isolation: worktree`
  in their frontmatter, and accepts a slash command such as `/dispatch` as the prompt
  (Claude Code docs, `sub-agents`, `worktrees`, `slash-commands`).
- `--dangerously-skip-permissions` is the documented mode for a container or VM run as a
  non-root user, which a hosted runner is.
- `claude setup-token` is the documented CI credential and is what the curator already uses.
- The `main` ruleset (id 14967088) requires `lint`, `typecheck`, `test`, `build` and `e2e`,
  blocks creation, deletion and non-fast-forward pushes, and its only bypass actors are the
  administrator role and deploy keys. `birdbrain-agent` holds the `write` role, so the ruleset binds
  every push it makes.
- `ci.yml` jobs `test` and `e2e` install the packages an Electron test run needs on
  `ubuntu-latest`; the dispatch job copies those steps verbatim.
- The `.git/config.lock` device mount (#1065) and the read-only `.claude/skills/**` mount
  (#1066) come from the local Claude Code sandbox. No sandbox configuration exists in the
  repo or the user settings, and a hosted runner has no such mounts. The plan-mode
  inheritance defect (#1061) cannot occur in `claude -p`. The proxy pagination defect (#959)
  is web-only.
- What could not be verified: the Actions billing tier. Reading it needs a `user` scope the
  local `gh` login lacks. The repository is private, so minutes are metered after the plan's
  free allowance.

## Design

### Workflow shape

One workflow, `.github/workflows/dispatch.yml`, one job.

- **Triggers.** `schedule` hourly at :43 (the cadence #310 chose) and `workflow_dispatch`
  with one input, `mode`, values `report` and `cycle`. The scheduled trigger runs `cycle`.
- **Concurrency.** `group: dispatch`, `cancel-in-progress: false`. Fires serialise; a fire
  that arrives during a cycle waits, and GitHub keeps at most one waiting.
- **Timeout.** 150 minutes. The longest observed push-to-verdict on one round is 31 minutes;
  an implementer run is under an hour. A cycle that is still going at 150 minutes is stuck.
- **Permissions.** `contents: read` only for `GITHUB_TOKEN`. Every write uses the machine
  token, so the workflow token never needs write scope and cannot be the identity a write
  goes out under.

### Steps

1. **Pre-gate, no checkout.** A shell step with `gh api` and the machine token counts the
   two slot markers and looks for any open `agent-pr` PR whose head sha has no `agent/pre-pass`
   verdict, or has a comment newer than its head. If occupancy is three and no PR needs
   attention, the job ends here in under a minute. This keeps an idle hour from costing a
   dependency install.
2. **Identity.** Write `~/.config/birdbrain-agent/env` from three secrets
   (`BIRDBRAIN_AGENT_GH_TOKEN`, `BIRDBRAIN_AGENT_GH_LOGIN`, `BIRDBRAIN_AGENT_GH_TOKEN_EXPIRES`)
   with the modes ADR-0027 prescribes, then run the skill's own check: `agh api user` must
   print the login. The dispatch skill reads that file unchanged, so the identity code path is
   the one that already runs locally.
3. **Checkout with the machine token as the git credential**, `fetch-depth: 0`. Pushes go out
   over HTTPS as `birdbrain-agent`. Commit author and committer are set to the machine account
   in the job, so authorship and PR identity match.
4. **Toolchain.** `pnpm/action-setup`, `setup-node` from `.nvmrc`, the apt packages from the
   `e2e` job, `pnpm install`, `openssl version`. Install the Claude Code command-line tool as the curator does.
5. **Run one cycle.** `claude -p "/dispatch" --dangerously-skip-permissions --output-format json`
   with `CLAUDE_CODE_OAUTH_TOKEN`. In `report` mode the prompt adds one sentence: classify
   and report, take no write action. The JSON result and the cycle's standard output go to
   `.dispatch/` and are uploaded as a run artifact; the end-of-cycle report goes to
   `$GITHUB_STEP_SUMMARY`.
6. **Post-check.** If the report says an issue was dispatched, confirm the named branch
   exists on `origin` with at least one commit ahead of `main` (#1063). A mismatch fails the
   job.
7. **Cleanup, `if: always()`.** The cycle records every sha it set `agent/pre-pass=pending` on
   and every claim comment it posted in `.dispatch/state.json`. If the job is cancelled, times
   out, or fails, this step posts `failure` on each still-pending sha with the run URL as the
   description, and posts the release comment on each unreleased claim. This is the durable
   marker #1141 and #1057 ask for: a fire cannot end with a pending status or a live claim it
   owns.

A failed job emails the maintainer through GitHub's default notifications. That, the step
summary, and the artifact are the report surface (R6).

### Rule changes

- **ADR-0027 amendment.** Rule 3 says the token is never an Actions secret because no
  workflow needs it. A workflow now needs it, so the token becomes a repository secret next
  to `CLAUDE_CODE_OAUTH_TOKEN`, which is the more sensitive credential of the two. Rule 4
  gains a clause: on the Actions host, branch pushes go out as the machine account, because
  there is no maintainer credential there and ADR-0006's one-writer rule is about branches,
  not accounts. Rule 5 is resolved: the web environment is never a dispatch host.
- **New ADR-0026, scheduled dispatch runs on a GitHub Actions host.** Records the host
  decision, the preceding comparison, and that scheduled operation resumes as a timer on a
  proven tool rather than as the ADR-0011 pilot destination. ADR-0011 stays withdrawn.
- **Dispatch skill.** Three additions, no contract changes. The environment probe gains the
  sentence that a hosted runner reads as `LOCAL`, which is correct because nothing sits between
  `gh` and GitHub. Section 3's push instruction says the implementer pushes over whatever git
  credential the checkout carries, machine account on Actions. A note that Serena is absent
  on Actions and the Serena tools in the implementer definition do not resolve there. #1066 means the
  maintainer or an interactive session edits this file, not a dispatched implementer.
- **`docs/agents/github-access.md`.** A section for the Actions host mirroring the local one.

### Cost

Idle fires are cheap because of the pre-gate. Active cycles are not.

| Item | Estimate | Basis |
|---|---|---|
| Idle fire | under 1 minute | Pre-gate only |
| Active cycle | 90 to 120 minutes | Install 4 min, implementer 45 to 60, CI wait, reviewer 15 to 30 |
| Three active cycles a day | about 10,000 minutes a month | Past any free allowance for a private repository |
| Hosted Linux minute after allowance | $0.008 | GitHub list price |
| Claude usage | subscription quota via the OAuth token | Same pool the curator draws on |

If the monthly bill matters, a self-hosted runner on the WSL2 machine makes minutes free and
changes one line. It trades back R1 for the hours the machine is off.

### Rollout

1. **Provision.** Add the three secrets. Merge the workflow with the schedule commented out.
2. **Report-only fires.** Run `workflow_dispatch` in `report` mode until three consecutive
   fires classify the open PRs the same way an interactive session does.
3. **One supervised cycle.** Run `cycle` mode by hand while watching. Confirm the PR author,
   the labels on the `opened` webhook, CI on the draft, the pre-pass status, and the release
   comment.
4. **Enable the schedule.** Restore the cron line. Review the step summaries for a week.
5. **Close #960.** Its acceptance criteria are met when one scheduled fire passes the identity
   gate and its report reaches the maintainer.

Every step is reversible with a one-line workflow edit or a secret deletion.

## Decisions needed from the maintainer

1. **Host and custody.** Build the Actions workflow and store `BIRDBRAIN_AGENT_GH_TOKEN` as a
   repository secret, amending ADR-0027 rule 3? The alternative with no rule change is the
   `systemd` timer, which runs only while the machine is awake.
2. **Runner and spend.** Hosted runner at metered minutes, or self-hosted on the WSL2 machine
   at zero minutes and reduced availability? This can start hosted and move.

## Out of scope

- Replacing the classic PAT with a GitHub App installation token. It would end rotation (the
  current token expires 2026-11-16) but changes the identity check, since an installation
  token cannot call `/user`. Worth its own brief once the host runs.
- Making `agent/pre-pass` a required check (#488), the Codex reviewer gap (#1229), and the
  rest of the process backlog. None of them blocks a host.
