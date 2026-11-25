# Weekly repository health report

**Status:** active. Slice 1 (the tool and the tree signals) merged as pull request #2249.
Slice 2 (the workflow, the publisher and ADR-0058) is pull request #2251, in review; the
after-merge checks under "Verification" are still to run.

## Context

The repository has a twice-daily `Health` workflow (`.github/workflows/health.yml`), but it
watches the scheduled automation only: credentials, failed scheduled runs and stalled agent pull
requests. Nothing periodic measures the codebase. Several signals already drift with nobody
looking: `pnpm knip` is configured and runs nowhere, 74 of 124 plans in `docs/plans/` have no
documented status, all three entries in `audit-exceptions.json` expire on 2026-12-31, and the
only coverage history is one number on the `coverage-badge` branch.

The maintainer chose the scope and shape on 2026-11-20:

- **Scope:** Four signal families: code debt counts, dependency hygiene, docs hygiene, and tests
  and coverage trend. The tests family reads existing outputs only. No scheduled test, coverage,
  build or Electron run is added.
- **Reporting:** A separate weekly workflow with no model spend and no secrets. It rewrites one
  rolling `repo-health` issue labelled `process`, comments only when a signal crosses its budget,
  and never fails the run on a finding.

The outcome is one issue the maintainer can open on a Monday to see each signal, its budget, last
week's value and the direction, with a notification only when something changes state.

## Approach

Build a new tool, `scripts/repo-health/`, with a `pnpm repo-health` command and a weekly
workflow that publishes its report. It is not built as slop-audit checks: slop-audit findings are
per-file (`{file, line, severity}`), its inventory drops every dot-path (so `.github/` is
invisible to it), and a repository-level number with a budget and a trend has no file.

### Layout

| File | Purpose |
| --- | --- |
| `scripts/repo-health/cli.mjs` | Flags, context, collect, render, optional publish, exit code. `main(argv, deps)` with everything injectable, as `scripts/slop-audit/cli.mjs` does. |
| `scripts/repo-health/lib/signals.mjs` | Ordered registry and `collect()`, which turns a throwing `measure()` into `{ value: null, reason }`. |
| `scripts/repo-health/lib/{code,deps,docs,tests}.mjs` | One module per family. Each signal is `{ id, family, label, unit, better, budget, why, needs, measure(ctx) }`. The budget and its reason live in code. |
| `scripts/repo-health/lib/knip.mjs` | Runs `knip` once for the three signals that read it, and counts its findings. |
| `scripts/repo-health/lib/{tree,unmeasured}.mjs` | Shared path helpers, and the error a measurement throws when it knows why it has no value. |
| `scripts/repo-health/lib/report.mjs` | Status, direction, state block encode and decode, status changes, text and Markdown output, issue title. |
| `scripts/repo-health/lib/remote.mjs` (slice 2) | The signals that read GitHub through an injected `gh`. |
| `scripts/repo-health/lib/publish.mjs` (slice 2) | The issue publisher over an injected `gh(args, input)`. |
| `.github/workflows/repo-health.yml` (slice 2) | The weekly schedule. |

The publisher is Node under `scripts/`, not a bash copy of `.github/scripts/health/alert.sh`. It
has to parse a JSON state block and compare statuses, and under `scripts/` it gets ESLint,
Prettier, coverage and the 90% diff-coverage gate. `.github/scripts/pr-next/next.mjs` is the
precedent for Node calling `gh`. The publisher uses `gh api` only, with no `--jq`, because
`gh issue` and `gh label` return 403 in web sessions and `gh api --jq` rejects `-r`.

### Reuse

- **Tree reading:** `listTrackedFiles`, `createReader` and `CODE_EXTENSIONS` from
  `scripts/slop-audit/lib/files.mjs`, and `gitInfo` from `scripts/slop-audit/cli.mjs`.
- **Audit exceptions:** `parseExceptions`, `parseIsoDay` and `EXPIRY_WARNING_DAYS` from
  `scripts/audit-check.mjs`, with `today` passed in.
- **Agent instruction drift:** `compareDocuments` from `scripts/lint-agents-md.mjs`.
- **Reporting pattern:** One rolling issue, rewritten every run, labelled `process`, assigned to
  the repository owner, as `alert.sh` does.
- **Test pattern:** The stub `gh` on `PATH` from `tests/staleAgentIssues.test.ts`.

### Signals

A signal is crossed when its value is past its budget or when it is not measured. Budgets start
at the value measured at the commit each slice is cut from, so the first report is all within
budget and any growth shows. The "Now" column is the 2026-11-20 reading.

| # | Family | Signal | How it is computed | Now | Budget | Needs |
| --- | --- | --- | --- | ---: | ---: | --- |
| 1 | Code | `eslint-disable` comments | Comment lines matching `eslint-disable` in code files under `src`, `extension/src`, `tests`, `e2e`, `scripts`, `.github/scripts` | 14 | <= 14 | tree |
| 2 | Code | Double casts in product code | `as unknown as` under `src` and `extension/src`, tests excluded | 19 | <= 19 | tree |
| 3 | Code | Unused files | `knip` JSON, `files` | 4 | <= 4 | install |
| 4 | Code | Unused exports and types | `knip` JSON, exports, types, enum and namespace members, duplicates | 281 | <= 281 | install |
| 5 | Dependencies | Deferred dependency decisions | Entries in `audit-exceptions.json` plus `dependency-name` entries under `ignore` in `.github/dependabot.yml`, not under `allow`. A Dependabot file with no `version` or `updates` key is not measured. | 9 | <= 9 | tree |
| 6 | Dependencies | Audit exceptions expiring | Entries expired or within 21 days of expiry | 0 | <= 0 | tree |
| 7 | Dependencies | Unused dependencies | `knip` JSON, `dependencies` plus `devDependencies` | 2 | <= 2 | install |
| 8 | Dependencies | Dependabot pull requests open over 14 days | Open pull requests by `dependabot[bot]`, age from `created_at`. A listing with no page, or a pull request with no author, is not measured. | 0 | <= 0 | `gh` |
| 9 | Docs | Agent instruction drift | Lines only in `CLAUDE.md` plus lines only in `AGENTS.md`. Not measured if either file is missing or empty. | 0 | <= 0 | tree |
| 10 | Docs | Plans without a documented status | `docs/plans/*.md` with no `**Status:**` line, or a first word outside active, done, parked, abandoned | 74 | <= 74 | tree |
| 11 | Docs | Broken relative links | Markdown links in `docs/**/*.md` and root `*.md` that resolve to no tracked path, skipping URLs, anchors, code spans, fenced blocks, `docs/archive/` and `docs/design-handoff/`. Inline links only: a reference-style link is not read. | 2 | <= 2 | tree |
| 12 | Tests | Skipped or focused tests | Line-anchored `it`, `test`, `describe` and `suite` calls with `.skip`, `.only`, `.todo` or `.fixme` anywhere in the chain, plus `xit` and `xdescribe`, in test files. `skipIf` and `runIf` are not counted. | 2 | <= 2 | tree |
| 13 | Tests | Line coverage on main | `coverage.json` on the `coverage-badge` branch through the contents API. Not measured if malformed or older than 14 days. | 95.93% | >= 95.0 | `gh` |
| 14 | Tests | Main CI runs red or re-run, 7 days | Completed `ci.yml` push runs on main that failed, timed out or needed a second attempt. `cancelled` is ignored. Zero runs in the window, or more runs than the one page read, is not measured. | 0 | <= 1 | `gh` |
| 15 | Repository | Stale remote branches | Branches with no open pull request and a tip older than 30 days, from one paged GraphQL query. `main` and `coverage-badge` are allowlisted in code. An empty listing is not measured. | 80 (2026-11-22) | <= 80 | `gh` |

Left out, with the reason:

- **`as any` and `: any`:** Every hit is prose such as `as any other`, and the lint rule
  `@typescript-eslint/no-explicit-any` already gates real ones.
- **`@ts-expect-error`:** None of the 67 is in `src/`. They are untyped-script imports in tests
  and deliberate negative type tests.
- **`TODO` and `FIXME`:** All six are the migration scaffold script's template text: five in
  the script and one in its test.
- **A live `pnpm audit`, ADR duplicate numbers, the React Compiler baseline:** Each is already
  gated by CI or a test.
- **Node pin mentions:** A prose regex with an allowlist reads zero forever after one cleanup.
  The three stale "Node 20" mentions in `.github/dependabot.yml` and `audit-exceptions.json` go
  in the slice 1 pull request's findings list instead.
- **End-to-end flaky counts:** They exist only in a CI job summary, which the API does not
  expose. Signal 14 is the readable proxy.

`knip` needs `pnpm install --frozen-lockfile --ignore-scripts` on the runner because it loads the
Vite, Vitest and Playwright configurations. The three `knip` budgets are calibrated from the first
runner dry run, not from a local install. If `knip` cannot run, its three rows read "not measured"
and the rest still publishes.

### Budget, previous value and direction

- **Budget:** In code on each signal definition, with a `why` naming the commit and date. It
  changes by reviewed pull request. A value below budget renders "budget can tighten by N" and
  sends no notification.
- **Previous value:** A hidden `<!-- repo-health-state:v1 {...} -->` block at the end of the
  issue body, holding numbers and status strings per signal plus `measuredAt` and `commit`. The
  workflow has `contents: read` and commits nothing.
- **Unreadable state:** No open issue, no block, invalid JSON, a wrong schema version, a
  non-numeric value, an unknown status or a `measuredAt` that is not a timestamp each decode to
  `null` with a reason. `null` renders as "no previous value" and never compares as unchanged.
  Nothing from the block reaches a shell.

### Statuses and notification

Statuses are `within`, `outside` and `not measured`. A signal that cannot be read is never
rendered as zero or as healthy (the "Missing input fails" rule in `CLAUDE.md`).

- **Comment:** One comment per run, listing every signal whose status differs from the stored
  one: into `outside`, into `not measured`, or back to `within`.
- **No comment:** A value that moves while its status holds, a reason text that changes, or a
  new signal that arrives `within`.
- **First run:** Creating the issue is the notification.
- **Unreadable block on an open issue:** The body is rewritten and one comment says nothing
  could be compared this week.
- **Lifecycle:** The issue stays open permanently, because closing on a clean week would discard
  the trend. If someone closes it, the next run opens a fresh one with no previous values.
- **Title:** Two counts and no colour grade, for example
  `Repository health: 1 outside budget, 0 not measured (15 signals)`.

### Workflow

`.github/workflows/repo-health.yml` runs on `schedule` at `13 9 * * 1` (Monday 09:13 UTC, clear
of the existing Monday jobs) and on `workflow_dispatch` with a `dry_run` input that defaults to
`true`.

- **Permissions:** `contents: read`, `issues: write`, `pull-requests: read`, `actions: read`.
- **No secrets and no environment:** The job uses `github.token` only, so it stays outside the
  job list in `tests/spendGuardWorkflows.test.ts`. That test's `readsSecret` matches comment
  lines too, so the text `secrets.` appears nowhere in the file.
- **Dry run:** `DRY_RUN` is false only for a scheduled run or a manual run on `main` with
  `dry_run` unticked. The command writes only when `DRY_RUN` is exactly `false`, the same safe
  default as `.github/scripts/stale/run.sh`.
- **Exit codes:** 0 whatever the findings, 2 when the tool cannot run or cannot publish. The
  report always goes to the step summary, with a `::warning` per crossed signal.
- **Pause:** `gh workflow disable repo-health.yml`. No repository variable is added, because a
  job skipped by `if:` ends its run as `skipped`, which the failure-streak rule in
  `.github/scripts/health/check.sh` would count as two red Mondays.
- **Alarm on breakage:** `repo-health.yml` joins `WORKFLOWS` in `check.sh`, so two scheduled
  runs that exit 2 raise the existing `health-alert` issue.
- **Pins:** The checkout, `pnpm/action-setup` and `setup-node` commit pins already in the repository.

### Local use

`pnpm repo-health` prints the table, `--json` prints the envelope, and `--markdown` prints the
issue body. Signals that read GitHub show "not measured: no `gh` token" when neither `GH_TOKEN`
nor `GITHUB_TOKEN` is set. Nothing is written unless `--publish` is passed and `DRY_RUN=false`.

## Delivery

Two pull requests. This is `process` work, so it is done interactively and never dispatched.

### Slice 1: the tool and the tree signals

Nothing under `.github/`. It merges on the normal path and shows real numbers before any
notification exists.

1. Commit this plan as `docs/plans/2026-11-20-repo-health-report.md` with `**Status:** active`.
2. Add `scripts/repo-health/cli.mjs`, `lib/signals.mjs`, `lib/{code,deps,docs,tests}.mjs`,
   `lib/knip.mjs`, `lib/{tree,unmeasured}.mjs` and `lib/report.mjs`, covering signals 1 to 7
   and 9 to 12.
3. Add `"repo-health": "node scripts/repo-health/cli.mjs"` to `package.json`.
4. Add `'scripts/repo-health/**/*.mjs'` to `coverage.include` in `vitest.config.ts` and
   `'scripts/repo-health/'` to `INSTRUMENTED_SCRIPTS` in `scripts/diff-coverage.mjs`.
5. Add tests under `tests/repoHealth/`: `code`, `deps`, `docs`, `tests`, `knip`, `report` and
   `cli`.
   They use known-answer in-memory trees, pass `today` in, and test `main()` in-process so
   coverage sees it. Required cases: a throwing signal renders "not measured" while the rest
   still run, a null value never renders as `0`, every state-decode failure returns `null`, and
   the expiry boundary at 22, 21 and -1 days.
6. Open the pull request as a draft, with the three stale "Node 20" mentions in its findings
   list.

### Slice 2: the workflow, the publisher and the record

It starts after slice 1 merges, because the session has one branch. It changes
`.github/workflows/`, so ADR-0048 makes it wait for the maintainer's sign-off at head.

1. Add `lib/remote.mjs` (signals 8, 13, 14, 15) and `lib/publish.mjs`.
2. Add `.github/workflows/repo-health.yml` and add `repo-health.yml` to `WORKFLOWS` in
   `.github/scripts/health/check.sh`.
3. Add `docs/adr/0058-a-weekly-report-shows-repository-health-and-never-fails-a-build.md`
   (re-check the next free number first). It records the ADR-0029 authorization with the plan
   approval date, the zero-spend shape, the one-rolling-issue rule (ADR-0028, ADR-0050), that a
   signal becomes a gate only by its own ADR after a traced defect, and the retire criteria.
4. Retire criteria, reviewed after eight scheduled runs: keep the report if at least one crossing
   led to a change the maintainer chose to make and the tool needed at most two maintenance pull
   requests. Retire it if no crossing was acted on or maintenance outnumbers the changes it
   prompted. Retire one signal if its budget is raised twice running with no cleanup.
5. Add one sentence to "Background jobs" in `CLAUDE.md`, copy it over `AGENTS.md`, and add a
   section "The repo-health report" to `docs/agents/github-access.md` under "The health
   workflow": what a crossing means, how to change a budget, how to pause, and that closing the
   issue resets the trend.
6. Add tests: `remote` (boundaries, a throwing `gh`), `publish` with a recording fake `gh`
   (create, rewrite unchanged, comment on a crossing, a recovery, an unreadable block, two open
   issues, dry run writes nothing, a failed list read throws), `publishCli` with the stub `gh`
   on `PATH`, and `workflow` (triggers, permissions, no `secrets.`, no `environment:`, 40-hex
   pins, the `DRY_RUN` expression, `check.sh` lists the workflow).
7. Set the plan's status to `done` with both pull request links.

## Verification

Slice 1, before the pull request:

1. `pnpm test tests/repoHealth` and `pnpm test tests/diffCoverage.test.ts`, with no `--`.
2. `env -u GH_TOKEN -u GITHUB_TOKEN pnpm repo-health` shows eleven numeric rows.
3. `pnpm repo-health --json` parses and matches the signal table.
4. `pnpm knip` shows the new files add no unused export.
5. `pnpm check`, then `pnpm preflight` on a clean tree under Node 24.

Slice 2, before merge:

1. `pnpm test tests/repoHealth tests/spendGuardWorkflows.test.ts`, with the secret-job list
   unchanged.
2. `pnpm lint:adr`, `pnpm lint:agents-md`, and `.claude/hooks/vale-prose.sh --base origin/main`.
3. Under `bash -c`, run `node scripts/repo-health/cli.mjs --publish` with `DRY_RUN` unset
   against the real repository. It prints the writes it would make and makes none.
4. `pnpm check`, then `pnpm preflight`.

After slice 2 merges (a workflow can be dispatched only once its file is on `main`):

1. Dispatch `repo-health.yml` with the default dry run. Read the step summary, the `knip` rows
   and the install time, and calibrate the `knip` budgets.
2. Dispatch with `dry_run=false`. One issue appears, labelled `repo-health` and `process`.
3. Dispatch again with `dry_run=false`. The body is rewritten and the comment count is unchanged.
4. After the first scheduled Monday, the "last week" column is filled.

## Risks

- **Workflow push:** Slice 2 may need the maintainer's account, because a push that changes
  `.github/workflows/` needs the `workflow` scope. If this session's push is refused, the plan
  stops there and says so.
- **`knip` on the runner:** Its counts with build scripts skipped may differ from a local install.
  The first dry run settles that before any budget is trusted.
- **Signal 2 and signal 4:** These are the noisiest. They are the first to cut if the report
  asks for more attention than it returns.
