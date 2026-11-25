# A weekly report shows repository health and never fails a build

**Status:** Accepted

**Date:** 2026-11-22

New automation under [ADR-0029](0029-measure-before-expanding-agent-automation.md): the
maintainer authorized it on 2026-11-20 and chose its scope and its reporting shape that day.
It calls no model and reads no stored credential, so it has no spend to cap. Follows the
one-issue rule of [ADR-0028](0028-dispatch-works-a-hand-picked-queue.md) and
[ADR-0050](0050-agents-leave-friction-notes-for-human-curation.md).

## Context

The Health workflow (`.github/workflows/health.yml`) watches the scheduled automation: its
credentials, its failed runs and its stalled pull requests. Nothing periodic watched the
codebase. On 2026-11-20 a survey found numbers that had drifted with nobody reading them:

- `pnpm knip` was configured and ran nowhere. Pull request #2215 added it and recorded 113
  unused type exports on its first run, on 2026-11-16; four days later the count was 133.
- 74 of 124 plans in `docs/plans/` had no documented status.
- All three entries in `audit-exceptions.json` expire on 2026-12-31. `scripts/audit-check.mjs`
  warns 21 days ahead, on whichever pull request happens to run it.
- The only coverage history was one number on the `coverage-badge` branch. The badge read
  95.93% while the global threshold in `vitest.config.ts` was 38.
- 80 of 98 remote branches had no open pull request and no commit in 30 days. The `teardown`
  skill sweeps local branches only.

None of these is a defect. Each is a number that says whether upkeep is keeping pace, and each
was only ever read when someone went looking.

ADR-0029 asks that new automation cost less to keep than it returns, so the design had to stay
small: no service, no stored state outside GitHub, no new credential, and nothing that pages
the maintainer about drift the way a dead credential should.

## Decision

1. **One command measures the signals.** `pnpm repo-health` (`scripts/repo-health/`) computes
   fifteen repository-level numbers in five families: code, dependencies, docs, tests and
   repository. Each signal has a budget, written in code beside the measurement with the reason
   for it. A budget changes by pull request.
2. **A signal has three statuses, and only one is good.** `within` is a value on the allowed
   side of its budget. `outside` is a value past it. `not measured` is a signal that could not
   be read. A signal that is not measured is never shown as zero and never counted as within
   budget, and its reason is a fixed phrase: the raw error stays in the run log.
3. **The report reads what already exists.** The test signals read the coverage badge and the
   CI run history through the API. The report starts no test, coverage or build run.
4. **A weekly workflow publishes it.** `.github/workflows/repo-health.yml` runs on Monday at
   09:13 UTC and by hand. It uses the workflow's own token and nothing else, so it stays
   outside the spend guard that `tests/spendGuardWorkflows.test.ts` pins. A manual run is a dry
   run unless the maintainer unticks the input on `main`.
5. **One rolling issue holds the report.** The run rewrites one open issue labelled
   `repo-health` and `process`, assigned to the repository owner, and only one the workflow's
   own token opened: a label alone does not make an issue the report. It never opens an issue
   per finding. The issue stays open, because the next run reads the previous values from a state
   block in its body.
6. **A comment means a status changed.** The run comments when a signal moves into `outside`,
   into `not measured`, or back to `within`. A value that moves while its status holds gets no
   comment, so a standing condition is one notification. When the state block cannot be read,
   the run says so in one comment and compares with nothing.
7. **A finding never fails the run.** The run exits non-zero only when the tool cannot run or
   cannot publish. `repo-health.yml` is in the list `.github/scripts/health/check.sh` watches,
   so two such scheduled runs raise the existing `health-alert` issue.
8. **A signal becomes a gate only by its own decision.** Promoting one to a failing check needs
   an ADR that traces a real defect to it, the rule the slop audit design already follows
   (`docs/specs/2026-09-03-slop-audit-design.md`).
9. **Pausing is disabling the workflow.** `gh workflow disable repo-health.yml`. The workflow
   has no variable switch: a job skipped by a condition ends its run as skipped, and the
   failure-streak rule in `check.sh` counts every scheduled run that did not succeed.

### Review after eight scheduled runs

The report is kept only while it earns its upkeep, measured the way ADR-0029 measures: a saving
that needs more of the maintainer's attention is not a saving.

- **Keep it** if at least one status change led to a change the maintainer chose to make, and
  the tool needed at most two maintenance pull requests.
- **Retire it** if no status change was acted on, or if pull requests maintaining the tool
  outnumber the changes it prompted. Retiring it means deleting the workflow and closing the
  issue; the command can stay.
- **Retire one signal** if its budget is raised twice running with no cleanup between, or if it
  reads `not measured` three runs in a row because of its own code.

## Consequences

- The maintainer gets one issue to read on a Monday, and a notification only when a signal
  changes status.
- Runner time is about two minutes a week on a public repository. Most of it is the dependency
  install that `knip` needs.
- Budgets are a second place a cleanup has to be recorded. A pull request that removes debt
  should lower the budget in the same change, and the report says how far each one can tighten.
- Closing the issue resets the comparison: the next run opens a new one with no previous
  values.
- Anyone who can edit the issue can edit its state block. The tool accepts numbers and status
  names from it and nothing else, and an unexpected block reads as no previous values.
- The three `knip` budgets were set from a full local install. A runner installs without build
  scripts, so the first dry run may show different counts, and those budgets are corrected from
  that run.
- The stale-branch signal starts at 80 with no sweep to bring it down. It measures growth until
  the maintainer decides what to do with the backlog.

## Alternatives rejected

- **Add the signals to the Health alarm.** One surface, but drift in a debt count would turn
  the twice-daily run red and page the maintainer the way a dead credential does. An alarm that
  fires on slow drift is one people learn to ignore.
- **Write only the run summary.** No issue to keep, but a signal that crossed its budget would
  be silent unless someone opened the run.
- **Build the signals as slop-audit checks.** `scripts/slop-audit/` reports findings against a
  file and a line, and its inventory leaves out every dot-path. A repository-level number with a
  budget and a trend has no file, and two of the signals read `.github/`.
- **Commit the previous values to the repository.** The workflow would need write access to the
  code, and nothing would force the file to be kept current.
- **A single grade or colour.** A mapping from fifteen numbers to one colour is a heuristic on
  top of heuristics. The issue title carries two counts instead: how many signals are outside
  their budget and how many were not measured.
- **Count `as any`, `@ts-expect-error` and `TODO`.** Every `any` hit was prose and the lint rule
  already blocks real ones; none of the `@ts-expect-error` uses is in `src/`; all six `TODO`
  hits are the migration scaffold script's template text, five in the script and one in its
  test.
