# Scheduled dispatch runs on a GitHub Actions host

**Status:** Accepted

**Date:** 2026-09-06

Amends [ADR-0012](0012-agent-prs-are-opened-by-a-machine-account.md) rules 3, 4 and 5. Does
not reopen [ADR-0011](0011-restate-the-autonomy-exit-bar.md): the believability streak stays
withdrawn, and this decision puts a proven tool on a timer rather than resuming a pilot.

## Context

The dispatch routine (`.claude/skills/dispatch/SKILL.md`) is adopted as a human-triggered tool
(#310, 2026-09-01). It merged eleven agent PRs between 2026-08-30 and 2026-09-05 from
interactive sessions. It has never run on a schedule that could write: the only scheduled host
tried, an Anthropic cloud routine, sits behind a proxy that re-authenticates every GitHub
request as the session identity, so every fire stopped at the ADR-0012 identity gate (#960,
validated 2026-08-25).

The #310 verdict's first ground was that no other unattended host exists. It did when the
verdict was written. `.github/workflows/doc-curator.yml` has run headless Claude Code on a
hosted runner every Monday since 2026-08-16, authenticated by `CLAUDE_CODE_OAUTH_TOKEN`, with
nothing between the process and GitHub. The design brief
`docs/specs/2026-09-06-scheduled-dispatch-host-design.md` compares that host with a local
`systemd` timer, a self-hosted runner and a separate machine against six requirements, and
records the facts verified for the choice.

## Decision

**One cycle of the dispatch routine runs on a GitHub Actions hosted runner, hourly, from
`.github/workflows/dispatch.yml`.** The skill is the program; the workflow is the host.

1. **Identity.** The machine token is a repository secret, `BIRDBRAIN_AGENT_GH_TOKEN`, next to
   the curator's `CLAUDE_CODE_OAUTH_TOKEN`. The login and expiry date are repository variables.
   A step writes `~/.config/birdbrain-agent/env` with the modes ADR-0012 prescribes and runs the
   skill's own identity check before anything else. A token that is missing, expired, or
   resolves to any login but the machine account fails the job before it reads a slot. ADR-0012
   rule 3's "never an Actions secret (no workflow needs it)" is amended: a workflow needs it.
2. **Pushes are the machine account's.** The checkout carries the machine token as its git
   credential and `GH_TOKEN` for the whole job is that token, so branch pushes, commits and
   API writes share one identity. ADR-0012 rule 4 kept pushes on the maintainer's SSH login
   because that is the only credential a local session has; on this host there is no maintainer
   credential, and ADR-0006's one-writer rule is about branches, not accounts. Commit author
   and committer are the machine account. Locally nothing changes.
3. **The web is never a dispatch host.** ADR-0012 rule 5 is resolved: the token is not
   provisioned into any Anthropic cloud environment, because the proxy would discard it.
4. **A pre-gate decides from the API whether the hour has work.** It counts the two slot
   markers, checks every open agent PR for an owed verdict, activity newer than head, or a
   section 2a merge, and checks the frontier when a slot is free. An idle hour ends before the
   toolchain installs. Any doubt reads as run.
5. **A cleanup step runs whatever happened to the job.** It fails any `agent/pre-pass` pending
   the run posted, releases any cycle claim the run took and did not release, and clears any
   dispatch claim a failed run left without a PR. A fire cannot end holding state a peer waits
   four hours on (#1141, #1057).
6. **A post-check reads GitHub, not the report.** Every PR the machine account opened during
   the run must be at least one commit ahead of `main` and carry `agent-authored`, and no
   dispatch claim from the run may still be live without a PR (#1063).
7. **The report surface is the run.** The end-of-cycle report goes to the step summary, the
   raw result and the cycle's standard error to a run artifact, and a failed job to the
   maintainer's notifications. A `workflow_dispatch` input selects `report` mode, which
   classifies and writes nothing, for comparing a runner's reading against a session's.
8. **`runs-on` is the cost lever.** The workflow is written for `ubuntu-latest` and changes
   one line to move to a self-hosted runner, which trades metered minutes for the hours that
   machine is off.

## Consequences

- The routine runs without a human present. Its throughput is bounded by the three slots and
  by human review of evidence-affecting PRs, which hold slots until a human acts.
- Two more things to rotate: the machine token (expiry recorded as a variable, checked on
  every fire) and the subscription OAuth token the curator already depends on.
- Metered minutes on a private repository. An idle fire is under a minute; an active cycle is
  90 to 120. The brief estimates about 10,000 minutes a month at three cycles a day, which is
  past any free allowance. Moving to a self-hosted runner is consequence 8.
- Serena is absent on the runner. Project MCP servers are disabled for the cycle, and the
  Serena tools in the implementer definition do not resolve; its contract already treats them
  as navigation aids rather than requirements.
- The local sandbox defects (#1061, #1065, #1066) do not occur here. They stay open for
  interactive sessions.
- `.claude/skills/**` cannot be edited by a dispatched implementer (#1066), so changes to the
  routine this host runs remain maintainer or interactive-session work.
- #960 closes when one scheduled fire passes the identity gate and its report reaches the
  maintainer. The schedule line is commented out until the brief's rollout reaches step 4.

## Alternatives rejected

**Provision the token into the cloud environment.** Tested 2026-08-25: the proxy presents the
session identity regardless of credential. Dead by measurement, not by argument.

**A `systemd` timer on the maintainer's machine.** Needs no rule change and works today, but
the machine is the schedule: fires stop when it sleeps, and the report is a log file nobody is
sent. Kept as the fallback if Actions minutes prove unaffordable and a self-hosted runner is
not wanted.

**A GitHub App instead of the machine account.** Ends token rotation and gives short-lived
credentials, but an installation token cannot call `/user`, so the identity check and every
"confirm the author is the machine login" step would change. Worth its own decision once the
host runs.

**Report-only on the web.** The cheapest option in #960. Turns a no-op fire into a useful one
but leaves the routine unable to act, and a host that can act now exists.
