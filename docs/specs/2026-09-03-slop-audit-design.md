# Slop audit: a snapshot audit for agentic code tells

- Status: draft, awaiting maintainer approval. No code exists yet.
- Date: 2026-09-03
- Source research: `docs/specs/2026-09-03-agentic-code-slop-patterns-research.md`, committed on
  branch `t3code/research-agentic-code-slop` (commit 1bd0f82b). Section numbers below (1.1,
  1.3, and so on) refer to that note.
- Decisions the maintainer fixed on 2026-09-03 before this design: the tool lives in Birdbrain
  as Node `.mjs` under `scripts/`; one run audits the whole tracked tree, not a diff; checks
  that need external tools are optional adapters; the design is approved before any code is
  written.

## Summary

`scripts/slop-audit/` is a deterministic scanner that names the research note's detectable
tells on a checkout of the repository, reports them with file and line, and exits 0 unless
asked to gate. It reuses the `typescript` compiler already in `devDependencies` for code
checks and regular expressions only for comments and filenames, because a calibration pass
against the current tree showed the regular-expression forms of several tells produce false
positives. The maintainer's decision is whether to approve this design so an implementation
plan can be written under `docs/plans/`.

## Problem

Agent-authored pull requests pass the existing CI jobs and still carry the patterns the
research note documents: tests that exercise mocks, swallowed exceptions, narration comments,
version-suffixed re-implementations, undeclared imports. The only place those patterns get
looked for today is a reading pass by `.claude/agents/birdbrain-reviewer.md`, which is an LLM
judgment and can be argued past. The pre-merge verification gap analysis
(`docs/specs/2026-08-27-pre-merge-verification-gap-analysis-assessment.md`) records that the
mechanical gates cover lint, typecheck, tests, diff coverage, and dependency advisories, and
nothing else. The research note's section 2.3 lists tools other teams run for these tells;
none of them run here.

The tool closes the gap for the subset of tells that a program can detect from the tree
alone. It does not replace the reviewer. It gives the reviewer, and the human, a list that
cannot be talked out of.

## Constraints

- **No new dependencies.** `package.json` already carries `typescript` 5.9.3 as a
  devDependency; the tool uses its parser (`ts.createSourceFile`) and never a type checker, so
  it needs no `tsconfig` plumbing and stays fast. Everything else is Node 20 standard library
  (`.nvmrc`).
- **Sibling script shape.** `scripts/audit-check.mjs` sets the pattern: exported pure functions,
  a `main()` that returns an exit code, and an entry guard comparing `import.meta.url` to
  `process.argv[1]`. Tests live in `tests/` and import the `.mjs` with a `@ts-expect-error`
  comment, as `tests/auditCheck.test.ts` does, because the `tsconfig` projects exclude `scripts/`.
- **Advisory by default.** `scripts/lint-agents-md.mjs` exits 0 and emits `::warning`
  annotations when `GITHUB_ACTIONS` is `true`. The slop audit follows that model. Turning any
  check into a merge gate is a ruleset decision that needs first-run data, and it belongs in
  an ADR, not in the script's defaults.
- **Not on the blocking evidence tier.** Per
  `docs/specs/2026-07-31-evidence-affecting-paths-assessment.md`, the only `scripts/` file on
  the blocking tier is `scripts/build-verifier.mjs`. A new `scripts/slop-audit/` directory is
  dev tooling and gets the advisory review path.
- **Code style.** Prettier settings from `CLAUDE.md`: no semicolons, single quotes, no trailing
  commas, 100 columns, two-space indent. The `scripts/**/*.mjs` block in `eslint.config.js`
  already declares the global variables the tool needs.
- **Snapshot semantics.** The unit of analysis is the tracked tree at `HEAD` (from
  `git ls-files -z`). A `--changed-since <ref>` flag narrows which files get reported, not which
  files the checks read, so cross-file checks such as duplication and undeclared imports keep
  their full context.

## Approaches considered

| Option | Shape | Verdict |
| --- | --- | --- |
| A. One file | `scripts/slop-audit.mjs` with every check inline, as `audit-check.mjs` does | Rejected. The catalogue below has about 25 checks. The sibling scripts run 100 to 400 lines; this one would pass 1,500. |
| B. Directory of check modules | `scripts/slop-audit/` with a command-line entry point, a shared library, and one module per check family that exports `{ id, section, severity, run(ctx) }` | **Recommended.** Each check is testable in isolation, and adapters slot in as modules with a `detect()` step. |
| C. ESLint rules plus Vale | Encode code tells as custom ESLint rules and prose tells as a Vale style | Rejected for the first version. ESLint runs per file and cannot see repo-wide facts (duplication across files, one-implementer interfaces, lockfile cross-checks). Vale already owns prose and keeps doing so. Some single-file checks may migrate to ESLint rules later; the check modules are written so that is possible. |
| D. Reviewer prompt only | Add the tells to `birdbrain-reviewer.md` and build nothing | Rejected. The reviewer already lists most of these tells in prose. The problem is that its verdict is a judgment, and the point of the tool is a list the agent cannot argue with. The tool feeds the reviewer; it does not replace it. |

## Design

### Layout

```
scripts/slop-audit/
  cli.mjs             entry point; flags, context, run, report, exit code
  lib/files.mjs       file set from git, classification, excludes, --changed-since filter
  lib/ts.mjs          parse cache over ts.createSourceFile, walk helpers, comment ranges
  lib/report.mjs      text, --json, and --github renderers; finding shape
  lib/allowlist.mjs   slop-audit-allowlist.json loader, match, stale-entry report
  checks/*.mjs        one module per family (test-gaming, duplication, complexity, deps,
                      security, defensive, comments, naming, suppression, stubs, files)
  adapters/*.mjs      jscpd, semgrep, registry; each exports detect() and run(ctx)
slop-audit-allowlist.json
tests/slopAudit/*.test.ts
```

`package.json` gains one script, `lint:slop`, that runs `node scripts/slop-audit/cli.mjs`.

### Data flow

1. `lib/files.mjs` lists tracked files and classifies each as `source`, `test`, `script`,
   `prose`, `config`, or `ignored`. Classification is by path: `tests/**` and `e2e/**` and
   `*.test.*` are `test`; `scripts/**` is `script`; `src/**` and `extension/src/**` are
   `source`; `*.md` is `prose`; `package.json`, `pnpm-lock.yaml`, and `*.config.*` are
   `config`. Default excludes: `website/`, `docs/archive/`, `docs/design-handoff/`, every
   top-level dot-directory (`.claude/`, `.macroscope/`, `.serena/`, `.design-sync/`, and the
   rest), `tests/fixtures/`, lock files, and generated files. `--path <glob>` (repeatable)
   overrides the set; `--changed-since <ref>` narrows reporting to files in
   `git diff --name-only <ref>`.
2. `lib/ts.mjs` parses `source`, `test`, and `script` files on demand with
   `ts.createSourceFile(name, text, ts.ScriptTarget.ES2022, true, scriptKind)` and caches the
   result. Checks receive the same `SourceFile` object.
3. Each check module's `run(ctx)` returns findings. `ctx` carries the classified file list, the
   parse cache, the repository root, `package.json`, and the lockfile importer block.
4. `lib/allowlist.mjs` drops findings that match an entry and reports entries that matched
   nothing as stale, the same shape `audit-check.mjs` uses for unused exceptions.
5. `lib/report.mjs` renders. Exit code follows the table below.

### Finding shape

```
{ id, severity, file, line, message, evidence, section }
```

`id` is `family.name` (for example `test.mocks-subject`). `severity` is `blocking` or
`advisory`, the two tiers the reviewer already uses for code findings. `section` is the
research note section the tell comes from, so a reader can go from a finding to its source.
`evidence` is the offending text, trimmed to one line.

### Output and exit codes

| Flag | Output |
| --- | --- |
| (none) | Text grouped by check, then a one-line count per severity, in the `audit-check.mjs` style |
| `--json` | One JSON document: `{ findings, skipped, stale, counts }`. This is what the reviewer and any future CI step consume |
| `--github` | Adds `::warning` (advisory) and `::error` (blocking) annotations with `file=` and `line=`, as `lint-agents-md.mjs` does |

| Exit | Meaning |
| --- | --- |
| 0 | Ran; default mode, regardless of findings |
| 1 | Ran; `--strict` was passed and at least one non-allowlisted `blocking` finding exists |
| 2 | Could not run: not a git checkout, `package.json` unreadable, parser failure the tool cannot recover from |

Adapters that are not installed appear in `skipped` with the reason, never as an error.

### Allowlist

`slop-audit-allowlist.json` at the repository root holds `{ id, path, line?, reason }` entries.
`reason` is required and non-empty. There is no expiry field: an entry states that a line is
not slop, which is a classification and not a deferral, unlike the dated exceptions in
`audit-exceptions.json`. Entries that match nothing are reported so the file does not rot.

### Adapters

An adapter runs only when its binary resolves on `PATH` (checked with a spawn of
`<tool> --version`). `--no-adapters` disables them all. The `registry` adapter needs the
network and runs only under `--online`.

| Adapter | Binary | What it replaces or adds | Notes |
| --- | --- | --- | --- |
| `jscpd` | `jscpd` | Replaces the built-in `dup.block-clone` with token-level clone detection (section 2.3) | Invoked with its JSON reporter; exact flags are fixed against the installed version's `--help` at implementation time |
| `semgrep` | `semgrep` | Adds `sec.semgrep` findings from `semgrep --json --config <cfg>` over `source` files (section 2.3) | No default ruleset. The adapter runs only when `--semgrep-config <cfg>` is passed, so the tool never guesses at a pack name |
| `registry` | none (uses `fetch`) | Adds `deps.unknown-package` for any `package.json` dependency where `https://registry.npmjs.org/<name>` returns 404 (section 1.5, Socket's report on hallucinated package names) | Opt-in via `--online` |

Mutation testing is not an adapter. It needs a configuration file and minutes of
runtime, and the research note (section 2.3) frames it as a CI job, not a scanner step.

## Check catalogue

Columns: `id`; the tell; the research section; how the tell is sourced (`paper` for a
peer-reviewed or pre-publication study, `vendor` for a vendor report or system card, `note` for a
detection idea the research note proposes itself, `folk` for section 1.11 practitioner
consensus); the detection method; default severity; and what a grep of the current tree at
f70aea08 shows. Calibration counts come from a regular-expression sweep over `src/`,
`extension/src/`, `tests/`, `scripts/`, and `e2e/`; where the count is followed by a note, the
AST method exists to remove those hits.

### Test gaming (section 1.1)

| id | Tell | Source | Method | Severity | Calibration |
| --- | --- | --- | --- | --- | --- |
| `test.exit-zero` | `process.exit(0)` in a `test` or `source` file | vendor (Anthropic reward-hacking post: `sys.exit(0)` before the runner reports) | AST: call expression `process.exit` with literal `0` argument; `script` files excluded | blocking | 3 sweep hits, all in `scripts/*.mjs` where an exit is legitimate; 0 after class scoping |
| `test.special-case-comment` | Comment in `source` naming the tests as the reason for a branch | vendor (same post; Sonnet 4.5 system card "special-casing tests") | Comment ranges matching `special[- ]?case`, `for the tests?`, `make the tests? pass`, `to pass the tests?` | advisory | 0 |
| `test.mocks-subject` | A test file mocks the module it is testing | vendor (Sonnet 4.5 system card: tests that verify mock behaviour) | AST: `vi.mock(spec)` where `spec` resolves, through relative path or the `@main`/`@shared`/`@renderer`/`@extension` aliases in `vitest.config.ts`, to the module whose filename without extension equals the test filename minus `.test` | blocking | 131 `vi.mock` calls in the tree; how many mock the subject is unknown until the AST check runs. This is the check most likely to need allowlist entries after the first run |
| `test.literal-branch` | A `source` branch on a literal that also appears in a test | vendor (reward-hacking post: hard-coded outputs) | AST: `if (x === <literal>) return <literal>` or `case <literal>: return <literal>` in `source`, where the compared literal (string or number, length 3 or more) also appears as a literal in any `test` file | blocking | Unknown until implemented |
| `test.skipped` | `it.skip`, `describe.skip`, `test.skip`, `it.todo`, `test.todo`, `xit`, `xdescribe` | folk (1.11) and vendor (system card "stubbing") | AST: property access on `it`/`test`/`describe` with those names | advisory | 2 (`tests/main/services/captureServer.test.ts`, `tests/main/services/dataExtractor.test.ts`), both real skips |
| `test.weak-assertion` | A test body with no assertion call, or whose only assertions are `toBeDefined()`, `toBeTruthy()`, or `expect(true).toBe(true)` | paper (test smells in LLM-generated tests) | AST: `it`/`test` callback body; count calls rooted at `expect`, `expectTypeOf`, `assert`; classify each matcher | advisory | Unknown until implemented |

### Duplication and re-implementation (sections 1.3, 1.11)

| id | Tell | Source | Method | Severity | Calibration |
| --- | --- | --- | --- | --- | --- |
| `dup.block-clone` | Near-identical blocks across or within files | vendor (GitClear: copy-paste rising, moved code falling) | Normalise lines (trim, collapse whitespace, drop comment-only and blank lines), hash sliding windows of 10 lines in `source` and 20 lines in `test`, report pairs; replaced by the `jscpd` adapter when present | advisory | Unknown until implemented |
| `dup.shadow-helper` | An export whose name is another export plus a version affix (`V2`, `2`, `New`, `Old`, `Enhanced`, `Improved`, `Legacy`, `Simple`) | folk (1.11) and vendor (GitClear) | AST: collect exported identifiers; flag `fooV2`, `fooNew`, `newFoo`, `enhancedFoo` only when `foo` is also exported somewhere in the tree | advisory | 4 sweep hits on bare `V2|Enhanced|Improved|New`; the pair condition is expected to drop most of them |

### Complexity (section 1.4)

| id | Tell | Source | Method | Severity | Calibration |
| --- | --- | --- | --- | --- | --- |
| `complexity.function` | More than 15 decision points in one function | paper (complexity and static-analysis debt in agent code) | AST: count `if`, `for`, `while`, `case`, `catch`, `&&`, `\|\|`, `??`, `?:` per function-like node; report at 15, mark `blocking` at 25 | advisory / blocking | Unknown until implemented |
| `complexity.long-function` | Function body of more than 80 statements | paper (same) | AST: statement count per function-like node | advisory | Unknown until implemented |

### Dependencies (section 1.5)

| id | Tell | Source | Method | Severity | Calibration |
| --- | --- | --- | --- | --- | --- |
| `deps.undeclared-import` | Import of a package not in `package.json` | paper (hallucinated packages in generated code) | AST: import and `require` specifiers in `source`, `test`, `script`; the package name of each bare specifier (scoped pair or first segment) must be in `dependencies` or `devDependencies`, a Node builtin (`node:` prefix or `builtinModules` from `node:module`), or a `vitest.config.ts` alias | blocking | Unknown until implemented; the typecheck job catches most of these for `.ts` but not for `scripts/*.mjs` |
| `deps.unlocked-package` | A `package.json` dependency with no entry in the lockfile | paper (same) and vendor (Socket) | Parse the `importers: '.'` block of `pnpm-lock.yaml` (lockfile version 9) for `dependencies` and `devDependencies` keys; diff against `package.json` | blocking | Unknown until implemented |
| `deps.unknown-package` | Registry lookup returns 404 | vendor (Socket) | `registry` adapter, `--online` only | blocking | Not run by default |

### Insecure defaults (section 1.6)

| id | Tell | Source | Method | Severity | Calibration |
| --- | --- | --- | --- | --- | --- |
| `sec.dangerous-sink` | `eval(`, `new Function(`, `.innerHTML =`, `dangerouslySetInnerHTML`, and `exec`/`execSync` from `child_process` with a template literal or concatenation argument | paper (CWE-94, CWE-79, CWE-78 in Copilot output) | AST, `source` files only | blocking | 6 `innerHTML =` hits, all in test setup; 0 after class scoping |
| `sec.weak-random` | `Math.random()` in `src/main/**` or `src/shared/**` | paper (CWE-330 in Copilot output) | AST call expression | advisory | 0 |
| `sec.semgrep` | Whatever the configured ruleset reports | vendor (section 2.3) | `semgrep` adapter | advisory | Not run by default |

Hard-coded secrets are not a check. `.github/workflows/security.yml` already runs Gitleaks
over history, which is a wider net than a tree scan.

### Defensive noise (section 1.7)

| id | Tell | Source | Method | Severity | Calibration |
| --- | --- | --- | --- | --- | --- |
| `defensive.swallowed-catch` | A `catch` whose block is empty, or contains only `console.*` calls, a `return` of `null`/`undefined`/`false`/`[]`/`{}`, or a bare comment | note | AST: `CatchClause` body classification | blocking | 0 empty catches in the sweep; the AST form will also find `catch { return null }` shapes, count unknown |
| `defensive.one-implementer-interface` | An exported interface implemented by exactly one class and referenced nowhere else | note | AST: collect `implements` clauses and type references across `source`; flag interfaces with one implementer and zero other references | advisory | Unknown until implemented |
| `defensive.debug-leftover` | `debugger` statements; `console.log` in `source` | paper (hard-coded debugging left in generated code) | AST: `DebuggerStatement` node (not the identifier, which removes object-key hits); `console.log` call in `source` only | advisory | 3 sweep hits for `debugger`, all object keys, 0 as statements; `console.log` in `src/` is subject to open question 1 |

Redundant type guards (a null check on a value the type system says is never null) need a
type checker and are deferred; see Not built.

### Comment slop (sections 1.8, 1.10, 1.11)

| id | Tell | Source | Method | Severity | Calibration |
| --- | --- | --- | --- | --- | --- |
| `comments.narration` | A comment that narrates the edit rather than the code | note | Comment text matching `^(Added\|Updated\|Fixed\|Changed\|Removed\|Refactored\|Moved\|Renamed)\s+(this\|the\|a\|an\|to\|for\|so\|handling\|support\|logic\|check\|code\|function\|method\|import\|test)\b` or `^Now we` | advisory | 5 sweep hits on the bare verb pattern, all false positives (`Fixed clock`, `Fixed vocabularies`, `Updated after commit`); 0 with the object-word guard |
| `comments.restates-code` | A comment whose identifier tokens repeat the next code line | paper (Ye and others: redundant comments dominate LLM comment defects) | Split the comment and the next non-blank code line into identifier tokens on case and underscore boundaries; flag when shared tokens divided by total distinct tokens is 0.6 or higher, with at least 3 shared tokens | advisory | Unknown until implemented |
| `comments.density-outlier` | A file whose comment-line ratio is far higher than the repository median | vendor (Sonar: comment density varies by model) | Ratio per file with 40 or more lines; flag when the ratio exceeds `max(0.35, 2 x median)` | advisory | Unknown until implemented |
| `comments.jsdoc-echo` | A `@param` description that restates the parameter name | paper (Ye and others) | Comment ranges: `@param name` followed by `the name`, `name value`, `the name to use` after token normalisation | advisory | Unknown until implemented |
| `comments.marketing` | Marketing register inside code comments | folk (1.10, 1.11) | Comment text matching `comprehensive`, `robust`, `seamless(ly)`, `leverag(e\|es\|ing)`, `cutting-edge`, `powerful`, `elegant`, `enhanced`, `best-in-class`, `state-of-the-art`, word-bounded, case-insensitive | advisory | Unknown until implemented. Prose files are Vale's job and are not scanned |

### Files, suppression, stubs (section 1.11)

| id | Tell | Source | Method | Severity | Calibration |
| --- | --- | --- | --- | --- | --- |
| `files.stray-summary` | Tracked `SUMMARY.md`, `IMPLEMENTATION*.md`, `CHANGES.md`, `NOTES.md`, `PLAN.md`, `TODO.md` outside `docs/`; any `*.md` other than `README.md` under `src/`, `tests/`, `scripts/`, `extension/src/` | folk | Path match over the file list | advisory | `.design-sync/NOTES.md` exists and is excluded by the dot-directory rule; 0 otherwise |
| `files.emoji` | Emoji code points in a code file | folk | Unicode property escape `\p{Extended_Pictographic}` over `source`, `test`, `script` text | advisory | 0 |
| `suppress.directive` | `@ts-ignore` or `@ts-nocheck` (blocking); `@ts-expect-error` or `eslint-disable*` with no reason text after the directive (advisory) | folk | Comment ranges | blocking / advisory | 0 `@ts-ignore`; 5 `@ts-expect-error`, all with reasons; 11 `eslint-disable`, reason presence unchecked |
| `stub.placeholder` | `throw new Error('not implemented')` or `NotImplemented` in `source` (blocking); `TODO: implement`, `// placeholder`, `// stub`, `// simplified version` comments (advisory) | vendor (Sonnet 4.5 system card: "stubbing in placeholder solutions"; METR `gives_up`) | AST for the throw; comment ranges for the rest | blocking / advisory | 0 |

## Not built, and why

| Tell | Section | Reason |
| --- | --- | --- |
| Fabricated verification claims in PR bodies | 1.2 | Needs the PR body and the CI log, not the tree. ADR-0018 already recomputes PR bodies at head, and the reviewer's verification pass owns the judgment |
| Scope drift against the issue | 1.9 | Needs the issue text. Reviewer pass 3 owns it |
| Test file edits in fix PRs; PR body longer than the diff; commit count against diff size | 2.2 | Diff semantics. `--changed-since` gives the file set, but the signals themselves are ratios over a diff, which is a different tool |
| Formatting drift outside the `format` globs | 1.9 | The gap analysis already tracks the missing `prettier --check` job; adding a fourth reporter of the same fact adds noise |
| Hard-coded secrets | 1.6 | Gitleaks in `security.yml` |
| Known-vulnerable dependency versions | 1.5 | `scripts/audit-check.mjs` |
| Redundant null and type guards | 1.7 | Needs `ts.createProgram` with the six `tsconfig` projects. Deferred to a later version if the first run shows demand |
| Mutation score | 2.3 | A CI job with its own configuration, not a scanner step |
| Hallucinated APIs on real packages | 1.5 | The typecheck job already fails on unknown members of typed packages |

## Testing

- **Unit tests per check** in `tests/slopAudit/<family>.test.ts`. Each test builds a `ctx` from
  in-memory strings: the file lister is injectable, and `lib/ts.mjs` parses from text, so no
  test touches the disk or spawns `git`. Each check gets at least one positive case per tell,
  one negative case per calibration false positive named in the catalogue (object-key `debugger`,
  `Fixed clock`, `process.exit(0)` in a script, `innerHTML` in a test), and one allowlist
  suppression case.
- **Entry-point tests** in `tests/slopAudit/cli.test.ts` cover flag parsing, the exit-code table,
  `--json` shape, and the stale-allowlist report, using the same injected lister.
- **One smoke test** runs `main()` against the real repository with `--json` and asserts exit 0
  and a document that parses as JSON. This is the test that catches a parser regression on
  real files.
- **Diff coverage**: `scripts/diff-coverage.mjs` enforces 90% on changed lines in `ci.yml`;
  the check modules are pure functions and should clear that without special handling.
- The imports use the same `@ts-expect-error` line as `tests/auditCheck.test.ts`.

## Delivery phases

Each phase is one pull request, sized to stay under about ten files.

1. **Skeleton and highest-signal checks.** `cli.mjs`, the four `lib/` modules, the allowlist
   file, `lint:slop` in `package.json`, and four checks: `test.exit-zero`, `test.mocks-subject`,
   `defensive.swallowed-catch`, `suppress.directive`. Ends with a first-run report over the tree
   posted in the PR body.
2. **Remaining AST checks.** `test.literal-branch`, `test.weak-assertion`, `test.skipped`,
   `complexity.*`, `defensive.one-implementer-interface`, `defensive.debug-leftover`,
   `stub.placeholder`, `sec.dangerous-sink`, `sec.weak-random`.
3. **Text and repository-wide checks.** `comments.*`, `dup.*`, `files.*`, `deps.undeclared-import`,
   `deps.unlocked-package`. Seeds the allowlist from the first two phases' accepted findings.
4. **Adapters and consumers.** `jscpd`, `semgrep`, `registry` adapters; `--github` output; an
   advisory job in `ci.yml`; and one line in `birdbrain-reviewer.md` pass 2 telling the
   reviewer to run `pnpm lint:slop --json --changed-since origin/main` and carry `blocking`
   findings into the verdict. Whether any check becomes a merge gate is a separate ADR written
   after phases 1 to 3 have produced data.

Phases 1 to 3 need no approval beyond this design. Phase 4 touches `ci.yml` and the reviewer
agent and gets its own review.

## Open questions

1. **`console.log` in `src/`.** `src/main/` has a `logSafe` helper. If `console.log` in `src/`
   is already conventional, `defensive.debug-leftover` covers only `debugger` statements. The
   current plan flags `console.log` in `source` files as advisory and lets the first run
   decide.
2. **Phase 4 scope.** The reviewer-agent wiring and the CI job could be part of this effort or a
   separate one. The plan treats them as phase 4 of this effort.

## Decisions taken without asking

These are recommended-option picks under ADR-0015.

- Script name `lint:slop`, not `audit:slop`, because `audit:*` in this repository means
  `pnpm audit` handling.
- Two severity levels, `blocking` and `advisory`, matching the reviewer's code tiers; the reviewer's
  `gate` tier is for mechanical merge controls and is not a property of a finding.
- No expiry on allowlist entries, for the reason given in the Allowlist section.
- `dup.block-clone` windows of 10 lines in `source` and 20 in `test`, to be tuned on first-run
  data.
- `semgrep` runs only with an explicit `--semgrep-config`, so the tool never invents a ruleset
  name.
