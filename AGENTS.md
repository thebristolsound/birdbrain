# Birdbrain

Open source web investigation & capture tool. Electron desktop app with a companion Chrome extension for capturing and analyzing web content.

## Commands

- `pnpm dev` - Start Electron app in dev mode (electron-vite)
- `pnpm build` - Build the Electron app
- `pnpm build:extension` - Build the Chrome extension
- `pnpm dev:extension` - Build Chrome extension in watch mode. `scripts/dev-extension.mjs` runs both Vite targets as watchers in one process, so an edit to `extension/src/content.ts` rebuilds the content script IIFE too
- `pnpm build:verifier` - Build the standalone verifier binary (`scripts/build-verifier.mjs`)
- `pnpm test` - Run tests (vitest, via Electron runtime). Single file: `pnpm test <path>` — no `--` (`pnpm test -- <path>` does not filter and runs the full suite)
- `pnpm test:watch` - Run tests in watch mode
- `pnpm test:coverage` / `pnpm coverage:report` / `pnpm coverage:all` - Coverage run and reports
- `pnpm lint` - ESLint (.ts, .tsx)
- `pnpm lint:boundaries` - dependency-cruiser over `src/`, `extension/src/`, `tests/` and `e2e/`: packages under `src/packages/` are importable only through their root files, and no import cycles
- `pnpm lint:agents-md` - **advisory, never fails**. Reports lines held by `CLAUDE.md` and not `AGENTS.md` or the reverse, as a CI warning annotation. The two are normally the same document: edit `CLAUDE.md`, then copy it over `AGENTS.md` (a symlink is not used: `core.symlinks=false` checkouts turn it into a one-line file). Drift is not an error because `CLAUDE.md` is expected to carry Claude-specific overrides that have no meaning in `AGENTS.md`; the check cannot tell those from an oversight, so it reports and leaves the judgement to you
- `pnpm typecheck` - Typecheck all six tsconfig projects: `src` main/preload/shared, `src` renderer, extension, then `tests/` (node flavour and web flavour) and `e2e/`. Tests are inside the gate — see "Testing" below
- `pnpm format` - Prettier format src/ and extension/
- `pnpm rebuild:electron` - Rebuild native deps (better-sqlite3)
- `pnpm db:migration:new <slug>` - Scaffold the next schema migration: appends a fail-closed `if (version < N)` block to `migrations.ts` and bumps `LATEST_SCHEMA_VERSION` in `core.ts` in one run, refusing when the two already disagree
- `pnpm test:e2e` - Run E2E tests (Playwright + Electron, runs `pnpm build` first)
- `pnpm test:e2e:debug` - Run E2E tests with Playwright inspector
- `pnpm package` / `pnpm package:win` / `pnpm package:mac` / `pnpm package:linux` - Package for distribution

Docs site commands run from `website/` (separate lockfile — see "Documentation site"): `pnpm dev`, `pnpm build`, `pnpm types:check`.

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

Long-lived reference docs moved out of `docs/reference/` into `website/content/docs/` when the docs site was set up — they are the site's content now. Adding one means adding an `.mdx` file with `title`/`description` frontmatter plus an entry in `website/content/docs/meta.json` (pages absent from `meta.json` are silently dropped from the sidebar). See "Documentation site" below for the MDX constraints.

**Writing style.** `docs/agents/writing-guide.md` is the adopted writing standard for all repo prose: Diataxis structure for published pages plus a mechanical rulebook (voice, ordering, formatting). CodeRabbit reads it as review criteria for `docs/**`, `website/content/docs/**`, and root Markdown; its public mirror is `website/content/docs/writing-style.mdx`.

**`docs/plans/` is tracked (since July 2026).** Plans are still author-time working notes: they get checked off and go stale, and staleness is expected.

**Docs may ship in the same PR as the code they describe.** There is no requirement to split specs, plans, ADRs, or reference docs onto their own PR or their own commit. Bundling a doc with the `src/**` change it documents is normal and preferred — a guide for a feature that has not merged yet is worth less on its own, and the split costs more than it returns.

**Override for agentic tooling:** When a skill or agent specifies a different default path (e.g. Superpowers' `docs/superpowers/specs/` and `docs/superpowers/plans/`), treat the canonical paths above as the user-preference override. Write specs to `docs/specs/` and plans to `docs/plans/`. The legacy `docs/superpowers/` tree is frozen — do not add new files there.

**Prose linting.** `.vale.ini` at the repo root is the project's Vale config; it overrides any global one for files under this repo. Project vocabulary lives in `.vale/styles/config/vocabularies/Birdbrain/accept.txt` so birdbrain terms are not accepted in unrelated projects. Run `vale sync` once per clone to fetch the Google package (gitignored). Only `*.md` is linted — `.mdx` needs `mdx2vast`, which is not installed. A doc you write should pass `vale <file>` with zero errors; residual warnings for this project's own vocabulary are expected.

## Documentation site

Before editing or building `website/`, or changing docs deployment or the Mintlify
mirror, read [Documentation site](docs/agents/website.md). Run site commands from
`website/`; it has its own lockfile and workspace configuration.

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

## Code navigation (Serena)

Serena (MCP, `--context claude-code --project-from-cwd`) is the code-navigation layer. For symbol
work use its tools and trust the results — `get_symbols_overview` for a file's shape, `find_symbol`
(with `include_body`) to read one symbol, `find_referencing_symbols` for callers, `rename_symbol` /
`replace_symbol_body` for cross-file edits. `Grep` is for literal text (strings, config, TODOs);
do not re-read files to confirm a Serena answer. Skip Serena for one-line lookups — it costs more
than a plain read there.

`.serena/memories/` and `.serena/project.yml` are committed (`.gitignore` keeps `cache/` and
`project.local.yml` local) so every worktree shares them. Memories hold navigation facts only —
`mem:core` is the entry point; conventions belong in this file, domain language in `CONTEXT.md`.
The language-server cache is per worktree, so the first symbolic call in a fresh worktree is slow.

## Agent skills

### Issue tracker

Issues live as GitHub Issues in `thebristolsound/birdbrain`, accessed via the `gh` CLI. External PRs are not a triage surface. See `docs/agents/issue-tracker.md`.

Two `gh` traps that produce wrong numbers rather than errors. **`gh api --jq` rejects `-r`**, and **`gh issue comment` has no `-q`** — in both cases the command fails, and a pipeline that ends in `| tail -1` swallows the failure and reports success. Never derive a count through a pipe whose exit status you have not checked. Separately, **the label-filtered issue search (`issues?labels=…`) reads GitHub's search index and lags a direct label read by seconds** — verified twice on 2026-08-14 — so never treat it as authoritative for a decision; read `issues/<n>/labels` for that.

**File a defect only when it is user-visible or evidence-affecting, and file at most two per PR.** Every other finding (process, tooling, CI, docs wording, a comment that overclaims, style) goes in the PR body's findings list or the review comment and is discarded when the PR merges. This replaces the file-every-defect rule of 2026-08 (ADR-0028): between 2026-W34 and W37 that rule produced 336 agent-filed issues against 93 merged agent PRs, half of them about the dispatch machinery itself, and the backlog grew by 514. When you do file, say in the issue why it was kept out of the change that found it, and report it as filed with the number.

The same rule covers the inverse failure: **do not write that something "is filed" until it is.** On 2026-08-15 a gate document merged to `main` asserting a `workflow_dispatch` ticket had been "filed separately" when none existed — the intent to file never executed, and the false claim shipped. File first, then reference the number you actually got back.

### Triage labels

Five canonical triage roles using their default label strings (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

Two further labels gate dispatch (ADR-0028). `queued` is the maintainer's hand-picked dispatch list: the frontier is `ready-for-agent` and `queued` together, never `ready-for-agent` alone. `process` marks work about the agent pipeline itself (dispatch, gates, ADRs, Vale, CI, skills) and is frozen: never queue it, never dispatch it. `.github/workflows/stale-agent-issues.yml` closes machine-filed issues untouched for 14 days unless they carry `queued` or `agent-wip`.

### Domain docs

Single-context layout: `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Background jobs (project-local carve-out)

Scheduled Dispatch and Doc curator are paused. Before proposing a restart or adding
automation machinery, read [ADR-0029](docs/adr/0029-measure-before-expanding-agent-automation.md):
verify basic spending limits and obtain explicit maintainer authorization to restart.

Two Jev shadow lenses run event-driven from `.github/workflows/jev-lens.yml` (ADR-0031): `lens:*`
issue labels and the `jev/evidence-hunks` commit status are advisory, never gate, and are never read by
dispatch. `scripts/jev-lens/score.mjs` measures them.

Unattended/background agent jobs working a `ready-for-agent` issue in this repo are opted out
of the global wait-for-confirmation rules: do not pause for mid-task approval and do not wait
for the user to confirm completion. Instead, commit and verify the work with `pnpm preflight`
(it refuses a dirty tree and a non-20.x Node, runs lint, typecheck, unit tests, build, the
extension build when `extension/` changed, coverage thresholds and diff coverage, and writes a
sha-stamped block to `.preflight/verification.md`), then finish by opening a **draft PR** with
the standard attribution line. Exception: if a dispatcher
spawned you, push the branch and hand off instead. PR opening stays with the dispatcher so
one identity authors every PR entering the slot (ADR-0027).

**Label it, or the gates cannot see it.** `agent-authored` always, `agent-pr` as well only if
the PR takes a dispatch slot, `evidence-affecting` when the gate fired at the **blocking** tier
(the path list is tiered since ADR-0014; an advisory-tier hit is not a label).
`pre-pass-gate.yml` and `ci.yml`'s draft exemption both key on those labels, so an unlabelled
agent PR reports `agent/pre-pass success — "Not an agent PR"` and no reviewer is ever waiting
on it. Wave 1 batch 1 shipped five such PRs, four evidence-affecting, and a hand-run pre-pass
found twelve blocking defects behind the green badges. `gh pr create --label` is not atomic,
so verify with `gh api repos/{owner}/{repo}/issues/<n>/labels` rather than asserting it.

The coverage steps are the ones that catch what the others cannot. CI's job named `test` runs
the suite *and then* `scripts/diff-coverage.mjs`, which fails the PR below 90% of changed lines
covered — a threshold `pnpm test` never evaluates, since it omits `--coverage`. Without them
the loop reports green on a PR CI rejects, and the red arrives after the agent has claimed
success. `coverage:diff` scores the **working tree** against the merge base, which is why
preflight insists on a clean tree: there the score equals the committed diff CI measures
(#508). Interactive sessions are not covered by this carve-out, and it must not be copied to
the global CLAUDE.md or other repos.

**PR bodies are computed at head (ADR-0018).** The `## Verification` block is the
`.preflight/verification.md` that `pnpm preflight` wrote at the head sha under review, pasted
verbatim and never committed; any push makes it stale and it gets regenerated before
requesting review. Any body figure a command can compute (file lists, counts,
coverage rows) comes from running the command at head, never from memory of an earlier run. When
a review round's only blocking findings are body defects on an unchanged sha, fix and re-verify
the body in the same round with no new code pass.

The gates in `docs/adr/0005-unattended-agents-on-the-evidence-path.md` still apply, as amended by
`docs/adr/0014-tier-the-evidence-backstop-and-widen-the-dispatch-slot.md`: WIP of one agent PR
(ADR-0028) with every branch cut from `main` and never from another cycle's branch,
`evidence-affecting` PRs never auto-merge and always get human review, non-evidence agent PRs may
merge on all required checks green plus an `agent/pre-pass` success verdict, and the give-up path
(comment findings on the issue, relabel `needs-info`/`ready-for-human`, vacate the slot) whenever
the issue fails the ready-for-agent bar at intake or mid-work.

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
  (the background-jobs verify block) with exit codes captured and real output shown; name any check you
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
`--body-file`, `--input`); a `settings.json` hook, gated to the agents each `check.sh` names in
`bound=`, blocks the inline forms (agent frontmatter `hooks:` do not fire in SDK-driven sessions
such as t3code). Every PR body and comment has two layers, the way CodeRabbit nests its review:
a plain-language top layer a reader outside the repository can follow (no paths, commit ids,
code spans, tool names or repository terms), and the detail collapsed in `<details>` blocks
under a plain `<summary>`, written however the author finds effective. Caps count the top
layer only; the linters check both layers. Squash merges land
with the PR title and the body's Summary section (`squash_merge_commit_message = BLANK`, ADR-0022),
so branch commit bodies are short and the Summary is the permanent record. Merges go through
`.claude/skills/merge-pr/scripts/merge.sh <n>` (`--cli agh` for the dispatcher), which composes
that message, merges against the reviewed sha, and reads back the result. Attribution trailers
and the platform PR footer are off in `.claude/settings.json`; `includeGitInstructions` is off
there too, so the skills are the only commit and PR instructions an agent receives.

### Interaction defaults

- `AskUserQuestion` calls carry at most two questions; split a bigger ask into consecutive
  calls.
- A research or gap-analysis request ends at the report. Plan approval is a separate, later ask;
  do not start implementing because the report was well received.
- When a decision is deferred to the maintainer, restate the actual question in the message that
  defers it. Never reference an earlier question by position or as "your call" without restating
  it.
