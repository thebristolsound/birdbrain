# Birdbrain

Open source web investigation & capture tool. Electron desktop app with a companion Chrome extension for capturing and analyzing web content.

## Commands

`package.json` lists every script. The ones below carry a rule the script name does not show.

- `pnpm test <path>` - Single test file, with no `--` (`pnpm test -- <path>` does not filter and runs the full suite)
- `pnpm typecheck` - Typechecks all six tsconfig projects, tests included; see "Testing" below
- `pnpm lint:boundaries` - Packages under `src/packages/` are importable only through their root files, and no import cycles
- `pnpm lint:agents-md` - Advisory, never fails. `CLAUDE.md` and `AGENTS.md` are normally the same document: edit `CLAUDE.md`, then copy it over `AGENTS.md` (no symlink: `core.symlinks=false` checkouts turn it into a one-line file)
- `pnpm preflight` - The full verify block: refuses a dirty tree and a non-20.x Node, runs lint, typecheck, unit tests, build, coverage thresholds and diff coverage, and writes `.preflight/verification.md`
- `pnpm build:test-sharp` - Linux only: build sharp against the system libvips for the test runner, then run tests with `BIRDBRAIN_TEST_SYSTEM_SHARP=1`. Works around a SIGSEGV in tests that use sharp under Electron; see "sharp under Electron on Linux" in [Testing](docs/agents/testing.md)
- `pnpm db:migration:new <slug>` - Scaffold the next schema migration: appends a fail-closed `if (version < N)` block to `migrations.ts` and bumps `LATEST_SCHEMA_VERSION` in `core.ts` in one run, refusing when the two already disagree
- `pnpm test:e2e` - Runs `pnpm build` first
- `scripts/setup-worktree.sh` - Installs dependencies in a fresh worktree; run it when `node_modules` is missing

Docs site commands run from `website/content/` through `pnpm dlx` (see "Documentation site"): `pnpm dlx mint dev`, `pnpm dlx mint broken-links`.

**Run everything on Node 20.** `.nvmrc` and `.mise.toml` pin it, and CI reads `.nvmrc` (`node-version-file`). `engines.node` is only a floor (`>=20.19.0`) — Node 24 satisfies it, so engines will not keep you off the broken version. `.mise.toml` exists because mise ignores `.nvmrc` by default, so shells and agent worktrees would otherwise land on whatever Node is newest. Under Node 24 Electron's postinstall silently fails to extract the binary (extract-zip's promise never settles): install exits 0 but leaves `node_modules/electron/dist` broken, which is what `scripts/ensure-electron.mjs` now backstops. If Electron is mysteriously missing, check `node --version` first.

**Test shell behaviour under `bash -c`, never in the agent tool shell.** Hooks (`.claude/hooks/*.sh`) and workflow `run:` steps are bash, but the tool named `Bash` is not always bash: on the maintainer's machine it is zsh, where unquoted parameter expansion does not word-split, so an argument-splitting check passes there and proves nothing about CI.

## Architecture

Electron + React 19 + TanStack Router + React Query + Chrome Extension + SQLite.

Before changing app or extension code, read [Architecture](docs/agents/architecture.md)
for process boundaries, path aliases, data access, routing, state, and feature locations.
Before adding or importing a deep-module package, read [Packages](src/packages/README.md).

## Documentation conventions

All design docs, specs, and implementation plans live under `docs/` per the layout in `docs/README.md`. Canonical paths:

- **Specs / design briefs / spikes** → `docs/specs/YYYY-MM-DD-<slug>-design.md` (or `-spike.md`, `-brief.md`, `-assessment.md`) — **tracked**
- **Implementation plans / checklists** → `docs/plans/YYYY-MM-DD-<slug>.md` — **tracked**
- **Long-lived reference** → `website/content/docs/<topic>.mdx` (no date prefix) — **tracked**, and published to the docs site
- **Architecture decisions** → `docs/adr/NNNN-<slug>.md` — **tracked**
- **Superseded** → `docs/archive/` (preserve original filename) — **tracked**

Adding a long-lived reference page, and the Vale setup for prose linting, are described in `docs/README.md`. A doc you write should pass `vale <file>` with zero errors.

**Writing style.** `docs/agents/writing-guide.md` is the adopted writing standard for all repo prose: Diataxis structure for published pages plus a mechanical rulebook (voice, ordering, formatting). CodeRabbit reads it as review criteria for `docs/**`, `website/content/docs/**`, and root Markdown.

**`docs/plans/` is tracked (since July 2026).** Plans are still author-time working notes: they get checked off and go stale, and staleness is expected.

**Docs may ship in the same PR as the code they describe.** There is no requirement to split specs, plans, ADRs, or reference docs onto their own PR or their own commit. Bundling a doc with the `src/**` change it documents is normal and preferred — a guide for a feature that has not merged yet is worth less on its own, and the split costs more than it returns.

**Override for agentic tooling:** When a skill or agent specifies a different default path (e.g. Superpowers' `docs/superpowers/specs/` and `docs/superpowers/plans/`), treat the canonical paths above as the user-preference override. Write specs to `docs/specs/` and plans to `docs/plans/`. The legacy `docs/superpowers/` tree is frozen — do not add new files there.

## Documentation site

Before editing `website/` or changing docs deployment, read
[Documentation site](docs/agents/website.md). Mintlify serves `website/content/` at
<https://docs.birdbrain.cc>; there is no build step in this repository.

## Testing

Before adding tests, changing test configuration, or diagnosing test failures, read
[Testing](docs/agents/testing.md) for Electron versus jsdom execution and the six
TypeScript projects. Use `pnpm test <path>` for a single file, without `--`.

## Code style

- No semicolons
- Single quotes
- No trailing commas
- 100 char print width
- 2-space indent
- TypeScript strict mode
- React JSX transform (no React import needed)
- ESLint 9 flat config with TypeScript ESLint + Prettier
- Prefer semantic theme tokens over raw color values in components (exceptions: overlays, status/severity colors)

## Agent skills

### Issue tracker

Issues live as GitHub Issues in `thebristolsound/birdbrain`, accessed via the `gh` CLI. External PRs are not a triage surface. See `docs/agents/issue-tracker.md`.

Two `gh` traps that produce wrong numbers rather than errors. **`gh api --jq` rejects `-r`**, and **`gh issue comment` has no `-q`** — in both cases the command fails, and a pipeline that ends in `| tail -1` swallows the failure and reports success. Never derive a count through a pipe whose exit status you have not checked. Separately, **the label-filtered issue search (`issues?labels=…`) reads GitHub's search index and lags a direct label read by seconds**, so never treat it as authoritative for a decision; read `issues/<n>/labels` for that.

**File a defect only when it is user-visible or evidence-affecting, and file at most two per PR** (ADR-0028). Every other finding (process, tooling, CI, docs wording, a comment that overclaims, style) goes in the PR body's findings list or the review comment and is discarded when the PR merges. When you do file, say in the issue why it was kept out of the change that found it, and report it as filed with the number.

**Do not write that something "is filed" until it is.** File first, then reference the number you actually got back.

### Triage labels

Five canonical triage roles using their default label strings (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

Two further labels gate dispatch (ADR-0028). `queued` is the maintainer's hand-picked dispatch list: the frontier is `ready-for-agent` and `queued` together, never `ready-for-agent` alone. `process` marks work about the agent pipeline itself (dispatch, gates, ADRs, Vale, CI, skills) and is frozen: never queue it, never dispatch it. `.github/workflows/stale-agent-issues.yml` closes machine-filed issues untouched for 14 days unless they carry `queued` or `agent-wip`.

### Domain docs

Single-context layout: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Background jobs (project-local carve-out)

Scheduled Dispatch runs every four hours under the pre-gate's spend cap; Doc curator is
paused. Before restarting Doc curator or adding automation machinery, read
[ADR-0029](docs/adr/0029-measure-before-expanding-agent-automation.md): verify basic spending
limits and obtain explicit maintainer authorization.

Unattended jobs working a `ready-for-agent` issue, and any session that opens or labels an agent
PR, follow [Background jobs](docs/agents/background-jobs.md): the wait-for-confirmation opt-out,
the `agent-authored` / `agent-pr` / `evidence-affecting` labels, diff coverage, PR bodies computed
at head (ADR-0018), and the ADR-0005 gates. Interactive sessions are not covered by that opt-out.

### Interactive sessions: standing approvals (project-local carve-out)

Three global wait-for-input rules are overridden in this repo. The rationale and amendment target
for each is its ADR; a maintainer veto of any auto-taken decision amends that ADR. Do not copy
this section to the global CLAUDE.md or other repos.

- **Recommended-option picks** (ADR-0015): when the decision is in the ADR-0015 class list
  (naming, placement, pattern-following approach, test shape, installed-API usage, mechanical
  sequencing, toolchain-settled style) and the recommendation is groundable in a repo doc, an
  ADR, an existing pattern, or the toolchain, take it without asking and log it under "Decisions
  taken" in the end-of-turn summary. Still ask for: new dependencies, destructive or
  irreversible actions, spend or external publishing, scope expansion, blocking-tier evidence
  paths, conflicts between documented rules, product or UX decisions with no repo precedent,
  and taste-only calls.
- **Plan approval** (ADR-0016): post the plan, then execute in the same turn when it adds no
  dependencies, touches no blocking-tier file, has no schema migration or data deletion, is
  reversible with git alone, stays inside the ADR-0015 classes, and changes at most 10 files.
  Otherwise wait as before and name the tripped criterion.
- **Completion confirmation** (ADR-0017): report complete on a green full verify block at head
  (`pnpm preflight`) with exit codes captured and real output shown; name any check you
  could not run and wait on that specific check, not on general confirmation. Merging stays
  human.
- **Doc-draft preservation** (ADR-0019): any session that creates or edits a file destined for a
  tracked path (`docs/**`, `CLAUDE.md`, `CONTEXT.md`, `website/content/**`, `.vale/**`) commits
  it before the turn ends: on the session's own branch, or on a `drafts/YYYY-MM-DD-<slug>`
  branch cut from `main` when the checked-out branch belongs to another effort. WIP commits are
  preservation, not ratification; pushing still waits to be asked. Worktrees share the object
  store, so a commit that was never pushed survives a purge and an untracked file does not.

### Posting surfaces

Commit messages, PR bodies and issue or PR comments each have one shape, held with its linter
in a skill: `.claude/skills/post-commit-message/`, `post-pr-body/`, `post-comment/`. Write the
text to a file, run the skill's `scripts/check.sh <file>`, then pass the file (`git commit -F`,
`--body-file`, `--input`). The maintainer merges by applying the `merge` label, which enables
auto-merge with the composed message once the `merge-gate` check passes; an `evidence-affecting`
PR also needs the maintainer's approving review or `approved` label at head (ADR-0041). Scripted
merges, the dispatcher's included, go through `.claude/skills/merge-pr/scripts/merge.sh <n>`
(ADR-0022).

### Worktrees

Close a worktree you finished, or sweep stale ones, with the `teardown` skill; never
`git worktree remove --force` or `git branch -D` by hand. Who creates and removes each kind
of tree: [Worktrees](docs/agents/worktrees.md).

### Interaction defaults

- `AskUserQuestion` calls carry at most two questions; split a bigger ask into consecutive
  calls.
- A research or gap-analysis request ends at the report. Plan approval is a separate, later ask;
  do not start implementing because the report was well received.
- When a decision is deferred to the maintainer, restate the actual question in the message that
  defers it. Never reference an earlier question by position or as "your call" without restating
  it.
