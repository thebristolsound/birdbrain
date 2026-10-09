# Local dispatch host

`scripts/dispatch-local.sh` runs one cycle of the dispatch routine on the maintainer's machine,
through the gates `.github/workflows/dispatch.yml` runs on a hosted runner and with the same step
scripts, in the same order: identity, pre-gate, Claude credential, the cycle, post-check,
cleanup, and scrub. The workflow is the reference (ADR-0026). This page records what the local
host needs, how a t3code scheduled task fires it, and where it differs from the runner.

ADR-0026 chose the hosted runner and kept a timer on the maintainer's machine as the fallback
when metered minutes cost too much. This script is that fallback, with t3code's scheduler as
the timer. The decision to run it on a schedule, and the identity rules it changes (below),
belong in an ADR amendment that this page does not make.

## Prerequisites

- The machine identity file `~/.config/birdbrain-agent/env` (ADR-0027), which
  `scripts/setup-agent-github-account.sh` writes.
- Claude Code logged in under `~/.claude`, the directory t3code's Claude provider uses, or
  `CLAUDE_CODE_OAUTH_TOKEN` in the environment. The cycle runs the binary mise installed; set
  `CLAUDE_BIN` to use another. The `claude` on the maintainer's `PATH` is a launcher that checks
  for updates first and did not return within 30 seconds on 2026-10-08, so the script never
  calls it.
- Node 20 through mise, and a checkout whose dependencies are installed. The script runs
  `scripts/setup-worktree.sh` when they are not.
- Linux: the script uses `flock`, `setsid` and `timeout`.

## Running by hand

```bash
scripts/dispatch-local.sh                   # report mode: classify and report, write nothing
scripts/dispatch-local.sh cycle             # one full cycle
scripts/dispatch-local.sh cycle --issue 1234   # section 3 may dispatch only this issue
```

Exit codes: 0 after a clean fire, an idle pre-gate included; 2 on a usage error; 3 when another
fire holds the lock; 1 otherwise, with the reason as the last `Failed:` line of the summary.
SIGINT and SIGTERM stop the cycle, and cleanup still runs.

Every fire leaves a directory under `~/.local/state/birdbrain-dispatch/runs/<UTC timestamp>/`:

| File | What it is |
|---|---|
| `summary.md` | The step summary, printed in full when the fire ends |
| `dispatch/` | The run artifact: prompt, transcript, result, meta, and `reports/` |
| `status` | `success`, `failure` or `cancelled`, as cleanup was told |
| `pregate.log`, `probe.log`, `run.log`, `cleanup.log`, `postcheck.log` | One log per step |

`latest` points at the newest run. Runs older than 7 days are pruned (`DISPATCH_KEEP_DAYS`).
`ledger.jsonl` beside `runs/` is the spend cap's record of this host's paid cycles.

## The t3code scheduled task

The scheduler delivers a prompt to a thread, and the thread's agent runs the script and reports.
The agent is a trigger and a reporter: the gates, the cycle and the cleanup are the script's.

The prompt, for the thread whose checkout the cycle should run in:

> Run the local dispatch host for Birdbrain. First, if the newest directory under
> `~/.local/state/birdbrain-dispatch/runs/` has a `summary.md` this thread has not shown yet,
> post that summary in full. Then run `bash scripts/dispatch-local.sh cycle` from this checkout
> as one background Bash command with a timeout of 7200000 milliseconds, and do nothing else
> while it runs. When it exits, read `~/.local/state/birdbrain-dispatch/latest/summary.md` and
> post it in full, then one line with the exit code. Do not run the dispatch skill yourself, do
> not retry a failed run, and write nothing to GitHub.

Report mode for the rollout is the same prompt with `report` in place of `cycle`.

Cadence: an interval of 14400000 milliseconds, the four hours the Actions schedule fires at.
Bound to the thread that created it, each run posts into that thread and runs in its checkout,
which is what a supervised rollout wants. A task that launches a fresh thread per run gets a
fresh worktree from `main` with dependencies installed, which mirrors the runner's checkout but
pays `pnpm install` on every fire.

The first fire trusts the repository in the config directory Claude Code reads, keyed by the
main repository root rather than the worktree path, so the permission allowlist in
`.claude/settings.json` applies to the cycle as it does on the runner.

## Rollout

The same steps the design brief set for the runner:

1. Report-mode fires by hand until the classification matches an interactive session's.
2. One supervised cycle by hand, watching the PR author, the labels, CI on the draft, the
   pre-pass status and the release comment.
3. Enable the scheduled task in cycle mode.
4. Decide what happens to the Actions schedule. While both fire, two dispatchers coordinate
   through the claims in the dispatch skill, and the spend cap counts from two partial views
   (below).

## Differences from the Actions host

- **Identity check.** The script checks the machine token itself rather than through
  `identity.sh`, which rewrites the identity file and sets the checkout's git user. The
  checkout here is the maintainer's, and its config is shared with every worktree, so the
  cycle's commit authorship comes from `GIT_AUTHOR_*` and `GIT_COMMITTER_*` in the cycle's
  environment instead.
- **Push identity.** `GH_TOKEN` for the cycle is the machine token, and `gh` is the git
  credential helper, so the implementer pushes as the machine account over HTTPS, as on the
  runner. ADR-0027 rule 4 says local pushes stay the maintainer's; it describes interactive
  sessions, and this host is unattended. The amendment that records the difference is pending.
- **Spend cap.** `pregate.sh` counts the Actions runs GitHub lists plus this host's ledger
  (`DISPATCH_LOCAL_LEDGER`). The Actions pre-gate has no record of local cycles, so while both
  schedules run, the combined count can pass the cap's 4 cycles in 24 hours.
- **Full-report links.** The machine token has no gist scope, and this host uploads no
  artifact, so a pre-pass comment's `Full report:` line names a path under the run directory.
  The path outlives the process, and nothing on GitHub can open it.
- **Report surface.** The run directory and the t3code thread. No email goes out on failure,
  and `health.yml` does not watch this host's runs.
- **Checkout.** Whatever branch the thread's checkout is on. The summary names the head when it
  is not `origin/main`, and names uncommitted changes, but refuses neither.
