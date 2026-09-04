# Slop audit: a tracked-tree audit for agentic code tells

- Status: draft, revised 2026-09-03 after a design review; awaiting maintainer approval. No
  code exists yet.
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
tells on the tracked working tree, reports them with file and line, and exits 0 unless asked
to gate. It reuses the `typescript` compiler already in `devDependencies` for code checks and
regular expressions only for comments and filenames, because a calibration pass against the
current tree showed the regular-expression forms of several tells produce false positives.
The maintainer's decision is whether to approve this design so an implementation plan can be
written under `docs/plans/`.

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
- **Tracked working tree, not a HEAD snapshot.** The unit of analysis is the set of paths
  `git ls-files -z` lists, read from disk. Uncommitted edits to tracked files are scanned;
  untracked files are not. That is what a developer running `pnpm lint:slop` before a commit
  wants, and it matches `scripts/diff-coverage.mjs`, which scores the dirty tree locally. On a
  clean tree, as in CI, the working tree and `HEAD` are identical. The JSON output records the
  `HEAD` commit and a `dirty` flag so a consumer knows which it saw. A `--changed-since <ref>`
  flag narrows which files get reported, not which files the checks read, so cross-file checks
  such as duplication and undeclared imports keep their full context.
- **Deterministic by default.** A run with no flags does the same work on every machine. Nothing
  is auto-detected from `PATH`; external tools run only when named on the command line.

## Approaches considered

| Option | Shape | Verdict |
| --- | --- | --- |
| A. One file | `scripts/slop-audit.mjs` with every check inline, as `audit-check.mjs` does | Rejected. The catalogue below has about 25 checks. The sibling scripts run 100 to 400 lines; this one would pass 1,500. |
| B. Directory of check modules | `scripts/slop-audit/` with a command-line entry point, a shared library, and one module per check that exports `{ id, section, run(ctx) }` and returns findings | **Recommended.** Each check is testable in isolation, and adapters slot in as modules with the same `run(ctx)` shape. |
| C. ESLint rules plus Vale | Encode code tells as custom ESLint rules and prose tells as a Vale style | Rejected for the first version. ESLint runs per file and cannot see repo-wide facts (duplication across files, one-implementer interfaces, lockfile cross-checks). Vale already owns prose and keeps doing so. Some single-file checks may migrate to ESLint rules later; the check modules are written so that is possible. |
| D. Reviewer prompt only | Add the tells to `birdbrain-reviewer.md` and build nothing | Rejected. The reviewer already lists most of these tells in prose. The problem is that its verdict is a judgment, and the point of the tool is a list the agent cannot argue with. The tool feeds the reviewer; it does not replace it. |

## Design

### Layout

```
scripts/slop-audit/
  cli.mjs                 entry point; flags, context, run, allowlist, report, exit code
  lib/files.mjs           file inventory from git, classification, excludes, --changed-since
  lib/ts.mjs              parse cache over ts.createSourceFile, walk helpers, comment ranges
  lib/report.mjs          text, --json, and --github renderers; envelope shape
  lib/allowlist.mjs       slop-audit-allowlist.json loader, match, stale-entry report
  checks/index.mjs        registry: the ordered list of check modules
  checks/<id>.mjs         one module per check, for example checks/test.exit-zero.mjs
  adapters/<name>.mjs     jscpd, semgrep, registry; each exports { name, version(), run(ctx) }
slop-audit-allowlist.json
tests/slopAudit/**/*.test.ts
```

`package.json` gains one script, `lint:slop`, that runs `node scripts/slop-audit/cli.mjs`.

### Check module interface

Every file under `checks/` exports the same three names and nothing else:

```
export const id = 'test.exit-zero'
export const section = '1.1'
export function run(ctx) { return [ /* Finding */ ] }
```

`run` is pure: it reads `ctx` and returns an array. Each finding carries its own `severity`,
so a check whose tier depends on what it finds (`suppress.directive`: `@ts-ignore` is blocking,
a reasonless `@ts-expect-error` is advisory) emits both from one module without declaring one.
`checks/index.mjs` imports the modules and exports them as an ordered array; the entry point
iterates it. Allowlisting happens after every check has run, in `cli.mjs`, and is tested
centrally, not per check.

### Data flow

1. `lib/files.mjs` builds the inventory. Classification runs in three steps, and the first
   step that decides wins:
   1. **Excludes** drop the path: `website/`, `docs/archive/`, `docs/design-handoff/`, every
      top-level dot-directory (`.claude/`, `.macroscope/`, `.serena/`, `.design-sync/`, and the
      rest), `tests/fixtures/`, lock files, and generated files.
   2. **Extension** decides the kind. `.ts`, `.tsx`, `.mts`, `.cts`, `.js`, `.jsx`, `.mjs`,
      `.cjs` are `code`. `.md` is `prose`. `package.json` and `pnpm-lock.yaml` are `config`.
      Everything else (`.css`, `.html`, `.png`, `.woff2`, `.sh`, `.yml`, other `.json`) is
      `other`, which only the path-based `files.*` checks ever see. No `other` file reaches the
      parser.
   3. **Path** assigns a role to `code` files: `tests/**`, `e2e/**`, and `*.test.*` are `test`;
      `scripts/**` is `script`; `src/**` and `extension/src/**` are `source`.
   `--path <glob>` (repeatable) overrides the inventory; `--changed-since <ref>` narrows
   reporting to files in `git diff --name-only <ref>`. The lister is injectable so tests never
   spawn `git`.
2. `lib/ts.mjs` parses `code` files on demand with
   `ts.createSourceFile(name, text, ts.ScriptTarget.ES2022, true, scriptKind)` and caches the
   result. Checks receive the same `SourceFile` object.
3. `cli.mjs` calls each registered check's `run(ctx)`. `ctx` carries the classified inventory,
   the parse cache, the repository root, `package.json`, and the lockfile importer block.
4. `lib/allowlist.mjs` drops findings that match an entry and reports entries that matched
   nothing as stale, the same shape `audit-check.mjs` uses for unused exceptions.
5. `lib/report.mjs` renders. Exit code follows the table below.

### Finding shape and severity policy

```
{ id, severity, file, line, message, evidence, section }
```

`id` is `family.name` (for example `test.mocks-subject`). `section` is the research note
section the tell comes from, so a reader can go from a finding to its source. `evidence` is
the offending text, trimmed to one line.

`severity` is `blocking` or `advisory`, the two tiers `birdbrain-reviewer.md` uses for code
findings. The reviewer defines `advisory` as "anything you suspect but did not confirm," and
this tool holds to the same line:

- **`blocking`** is reserved for objective policy violations that a reader can confirm from the
  finding line alone, with no judgment about intent: `process.exit(0)` in a test, a `@ts-ignore`,
  an import with no declaration, a dependency missing from the lockfile, an `eval`, a
  `throw new Error('not implemented')` in shipped code.
- **`advisory`** covers every heuristic, however strong: a test that mocks its subject, a
  swallowed catch, a literal reused between source and test, a complexity count. Each of these
  is a suspicion until a reviewer traces a concrete failure to it.

A heuristic is promoted to `blocking` only after a reviewer has traced a real defect to it,
and the promotion is recorded in this document with the pull request that motivated it.

### Output and exit codes

| Flag | Output |
| --- | --- |
| (none) | Text grouped by check, then a one-line count per severity, in the `audit-check.mjs` style |
| `--json` | One envelope: `{ schemaVersion: 1, commit, dirty, adapters: [{ name, version }], findings, skipped, stale, counts }`. `commit` is the `HEAD` sha; `dirty` is whether any tracked file differed from it. This is what the reviewer and any future CI step consume |
| `--github` | Adds `::warning` (advisory) and `::error` (blocking) annotations with `file=` and `line=`, as `lint-agents-md.mjs` does |

| Exit | Meaning |
| --- | --- |
| 0 | Ran; default mode, regardless of findings |
| 1 | Ran; `--strict` was passed and at least one non-allowlisted `blocking` finding exists |
| 2 | Could not run: not a git checkout, `package.json` unreadable, a requested adapter's binary is missing, or a parser failure the tool cannot recover from |

### Allowlist

`slop-audit-allowlist.json` at the repository root holds `{ id, path, line?, reason }` entries.
`reason` is required and non-empty. There is no expiry field: an entry states that a line is
not slop, which is a classification and not a deferral, unlike the dated exceptions in
`audit-exceptions.json`. Entries that match nothing are reported so the file does not rot.

### Adapters

Adapters are explicit and additive. `--adapter <name>` (repeatable) requests one; nothing is
detected from `PATH`. A requested adapter whose binary is missing is exit 2, because the caller
asked for work the tool cannot do. Every adapter adds its own finding ids beside the built-in
checks and never replaces a built-in result, so a run with adapters is a superset of a run
without them. The envelope records each enabled adapter's name and `--version` output.

| Adapter | Binary | Adds | Notes |
| --- | --- | --- | --- |
| `jscpd` | `jscpd` | `dup.jscpd-clone`, token-level clone pairs (section 2.3) | Invoked with its JSON reporter; exact flags are fixed against the installed version's `--help` at implementation time. The built-in `dup.block-clone` still runs |
| `semgrep` | `semgrep` | `sec.semgrep`, from `semgrep --json --config <cfg>` over `source` files (section 2.3) | Requires `--semgrep-config <cfg>`; there is no default ruleset, so the tool never guesses at a pack name |
| `registry` | none (uses `fetch`) | `deps.unknown-package` for any `package.json` dependency where `https://registry.npmjs.org/<name>` returns 404 (section 1.5, Socket's report on hallucinated package names) | Needs the network; that is why it is an adapter and not a check |

Mutation testing is not an adapter. It needs a configuration file and minutes of runtime, and
the research note (section 2.3) frames it as a CI job, not a scanner step.

## Check catalogue

Columns: `id`; the tell; the research section; how the tell is sourced (`paper` for a
peer-reviewed or pre-publication study, `vendor` for a vendor report or system card, `note` for a
detection idea the research note proposes itself, `folk` for section 1.11 practitioner
consensus); the detection method; default severity under the severity policy; and what a grep of
the current tree at f70aea08 shows. Calibration counts come from a regular-expression sweep
over `src/`, `extension/src/`, `tests/`, `scripts/`, and `e2e/`; where the count is followed by
a note, the AST method exists to remove those hits.

### Test gaming (section 1.1)

| id | Tell | Source | Method | Severity | Calibration |
| --- | --- | --- | --- | --- | --- |
| `test.exit-zero` | `process.exit(0)` in a `test` or `source` file | vendor (Anthropic reward-hacking post: `sys.exit(0)` before the runner reports) | AST: call expression `process.exit` with literal `0` argument; `script` files excluded | blocking | 3 sweep hits, all in `scripts/*.mjs` where an exit is legitimate; 0 after role scoping |
| `test.special-case-comment` | Comment in `source` naming the tests as the reason for a branch | vendor (same post; Sonnet 4.5 system card "special-casing tests") | Comment ranges matching `special[- ]?case`, `for the tests?`, `make the tests? pass`, `to pass the tests?` | advisory | 0 |
| `test.mocks-subject` | A test file mocks the module it is testing | vendor (Sonnet 4.5 system card: tests that verify mock behaviour) | AST: `vi.mock(spec)` where `spec` resolves, through relative path or the `@main`/`@shared`/`@renderer`/`@extension` aliases in `vitest.config.ts`, to the module whose filename without extension equals the test filename minus `.test` | advisory | 131 `vi.mock` calls in the tree; how many mock the subject is unknown until the AST check runs. This is the check most likely to need allowlist entries after the first run |
| `test.literal-branch` | A `source` branch on a literal that also appears in a test | vendor (reward-hacking post: hard-coded outputs) | AST: `if (x === <literal>) return <literal>` or `case <literal>: return <literal>` in `source`, where the compared literal (string or number, length 3 or more) also appears as a literal in any `test` file | advisory | Unknown until implemented |
| `test.skipped` | `it.skip`, `describe.skip`, `test.skip`, `it.todo`, `test.todo`, `xit`, `xdescribe` | folk (1.11) and vendor (system card "stubbing") | AST: property access on `it`/`test`/`describe` with those names | advisory | 2 (`tests/main/services/captureServer.test.ts`, `tests/main/services/dataExtractor.test.ts`), both real skips |
| `test.weak-assertion` | A test body with no assertion call, or whose only assertions are `toBeDefined()`, `toBeTruthy()`, or `expect(true).toBe(true)` | paper (test smells in LLM-generated tests) | AST: `it`/`test` callback body; count calls rooted at `expect`, `expectTypeOf`, `assert`; classify each matcher | advisory | Unknown until implemented |

### Duplication and re-implementation (sections 1.3, 1.11)

| id | Tell | Source | Method | Severity | Calibration |
| --- | --- | --- | --- | --- | --- |
| `dup.block-clone` | Near-identical blocks across or within files | vendor (GitClear: copy-paste rising, moved code falling) | Normalise lines (trim, collapse whitespace, drop comment-only and blank lines), hash sliding windows of 10 lines in `source` and 20 lines in `test`, report pairs | advisory | Unknown until implemented |
| `dup.jscpd-clone` | Token-level clone pairs | vendor (section 2.3) | `jscpd` adapter | advisory | Not run by default |
| `dup.shadow-helper` | An export whose name is another export plus a version affix (`V2`, `2`, `New`, `Old`, `Enhanced`, `Improved`, `Legacy`, `Simple`) | folk (1.11) and vendor (GitClear) | AST: collect exported identifiers; flag `fooV2`, `fooNew`, `newFoo`, `enhancedFoo` only when `foo` is also exported somewhere in the tree | advisory | 4 sweep hits on bare `V2|Enhanced|Improved|New`; the pair condition is expected to drop most of them |

### Complexity (section 1.4)

| id | Tell | Source | Method | Severity | Calibration |
| --- | --- | --- | --- | --- | --- |
| `complexity.function` | More than 15 decision points in one function | paper (complexity and static-analysis debt in agent code) | AST: count `if`, `for`, `while`, `case`, `catch`, `&&`, `\|\|`, `??`, `?:` per function-like node; report at 15 and again at 25 with the count in the message | advisory | Unknown until implemented |
| `complexity.long-function` | Function body of more than 80 statements | paper (same) | AST: statement count per function-like node | advisory | Unknown until implemented |

### Dependencies (section 1.5)

| id | Tell | Source | Method | Severity | Calibration |
| --- | --- | --- | --- | --- | --- |
| `deps.undeclared-import` | Import of a package not in `package.json` | paper (hallucinated packages in generated code) | AST: import and `require` specifiers in `source`, `test`, `script`; the package name of each bare specifier (scoped pair or first segment) must be in `dependencies` or `devDependencies`, a Node builtin (`node:` prefix or `builtinModules` from `node:module`), or a `vitest.config.ts` alias | blocking | Unknown until implemented; the typecheck job catches most of these for `.ts` but not for `scripts/*.mjs` |
| `deps.unlocked-package` | A `package.json` dependency with no entry in the lockfile | paper (same) and vendor (Socket) | Parse the `importers: '.'` block of `pnpm-lock.yaml` (lockfile version 9) for `dependencies` and `devDependencies` keys; diff against `package.json` | blocking | Unknown until implemented |
| `deps.unknown-package` | Registry lookup returns 404 | vendor (Socket) | `registry` adapter | blocking | Not run by default |

### Insecure defaults (section 1.6)

| id | Tell | Source | Method | Severity | Calibration |
| --- | --- | --- | --- | --- | --- |
| `sec.dynamic-code` | `eval(` or `new Function(` in `source` | paper (CWE-94 in Copilot output) | AST call and `new` expressions | blocking | 0 |
| `sec.dangerous-sink` | `.innerHTML =`, `dangerouslySetInnerHTML`, and `exec`/`execSync` from `child_process` with a template literal or concatenation argument, in `source` | paper (CWE-79, CWE-78 in Copilot output) | AST; a data-flow judgment is needed to confirm, so advisory | advisory | 6 `innerHTML =` hits, all in test setup; 0 after role scoping |
| `sec.weak-random` | `Math.random()` in `src/main/**` or `src/shared/**` | paper (CWE-330 in Copilot output) | AST call expression | advisory | 0 |
| `sec.semgrep` | Whatever the configured ruleset reports | vendor (section 2.3) | `semgrep` adapter | advisory | Not run by default |

Hard-coded secrets are not a check. `.github/workflows/security.yml` already runs Gitleaks
over history, which is a wider net than a tree scan.

### Defensive noise (section 1.7)

| id | Tell | Source | Method | Severity | Calibration |
| --- | --- | --- | --- | --- | --- |
| `defensive.swallowed-catch` | A `catch` whose block is empty, or contains only `console.*` calls, a `return` of `null`/`undefined`/`false`/`[]`/`{}`, or a bare comment | note | AST: `CatchClause` body classification | advisory | 0 empty catches in the sweep; the AST form will also find `catch { return null }` shapes, count unknown |
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
| `files.stray-summary` | Tracked `SUMMARY.md`, `IMPLEMENTATION*.md`, `CHANGES.md`, `NOTES.md`, `PLAN.md`, `TODO.md` outside `docs/`; any `*.md` other than `README.md` under `src/`, `tests/`, `scripts/`, `extension/src/` | folk | Path match over the inventory, including `other` and `prose` kinds | advisory | `.design-sync/NOTES.md` exists and is excluded by the dot-directory rule; 0 otherwise |
| `files.emoji` | Emoji code points in a code file | folk | Unicode property escape `\p{Extended_Pictographic}` over `code` text | advisory | 0 |
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

- **Library tests** in `tests/slopAudit/lib/`: `files.test.ts` (the three-step classification,
  every exclude, `--changed-since`), `ts.test.ts` (parse cache, comment ranges),
  `allowlist.test.ts` (match, required `reason`, stale report), `report.test.ts` (envelope
  fields, annotation format).
- **One test per check** in `tests/slopAudit/checks/<id>.test.ts`. Each builds a `ctx` from
  in-memory strings through the injectable lister, so no test touches the disk or spawns
  `git`. Each has at least one positive case per tell and one negative case per calibration
  false positive named in the catalogue (object-key `debugger`, `Fixed clock`, `process.exit(0)`
  in a script, `innerHTML` in a test). Allowlist behaviour is not tested here; it sits after
  the checks and is covered once in `allowlist.test.ts` and `cli.test.ts`.
- **Entry-point tests** in `tests/slopAudit/cli.test.ts` cover flag parsing, the exit-code
  table, allowlist wiring, the missing-adapter exit, and the `--json` envelope.
- **One smoke test** runs `main()` against the real repository with `--json` and asserts exit 0
  and a document that parses as JSON. This is the test that catches a parser regression on
  real files.
- **Coverage gate.** Today no gate measures `scripts/`: `vitest.config.ts` lists only `src/**`
  under `coverage.include`, and `scripts/diff-coverage.mjs` excludes any path under `scripts/`
  from its source-like filter. Phase 1 adds `scripts/slop-audit/**/*.mjs` to `coverage.include`
  and carves `scripts/slop-audit/` out of the diff-coverage exclusion, so the 90% changed-line
  gate applies to this directory from the first pull request. If the v8 provider turns out not
  to report `.mjs` files imported under vitest's Electron runtime, phase 1 stops and says so;
  the fallback is not silence but a named absence in the PR body.
- The imports use the same `@ts-expect-error` line as `tests/auditCheck.test.ts`.

## Delivery phases

Each phase is one pull request. Every phase lists its files so that the count against
ADR-0016 criterion 6 (at most 10 files) is visible before the work starts. A check phase counts
one module, one test, and the `checks/index.mjs` registration. Phases 1 to 10 meet all six
ADR-0016 criteria and proceed once this design is approved. Phase 11 touches `ci.yml` and the
reviewer agent and gets its own review. If a phase cannot fit in ten files, it splits; it does
not grow.

| Phase | Contents | Files |
| --- | --- | --- |
| 1. Skeleton | `cli.mjs`, `lib/files.mjs`, `lib/report.mjs`, `checks/index.mjs` (empty registry), `lint:slop` in `package.json`, coverage changes in `vitest.config.ts` and `scripts/diff-coverage.mjs`, tests for `files`, `report`, and `cli`. Ends with `pnpm lint:slop --json` printing an empty envelope with `commit` and `dirty` | 10 |
| 2. Parser and first objective checks | `lib/ts.mjs` and its test; `suppress.directive`, `test.exit-zero`; registry | 7 |
| 3. Allowlist, smoke test, dependencies | `lib/allowlist.mjs`, `slop-audit-allowlist.json`, `allowlist.test.ts`, `cli.mjs` (allowlist wiring), the smoke test; `deps.undeclared-import`, `deps.unlocked-package`; registry. Ends with the first-run report over the tree in the PR body | 10 |
| 4. Stubs and insecure code | `stub.placeholder`, `sec.dynamic-code`, `sec.dangerous-sink`, `sec.weak-random`; registry | 9 |
| 5. Test gaming | `test.mocks-subject`, `test.literal-branch`, `test.skipped`, `test.weak-assertion`; registry | 9 |
| 6. Defensive noise | `defensive.swallowed-catch`, `defensive.one-implementer-interface`, `defensive.debug-leftover`, `test.special-case-comment`; registry | 9 |
| 7. Structure | `complexity.function`, `complexity.long-function`, `dup.block-clone`, `dup.shadow-helper`; registry | 9 |
| 8. Comments | `comments.narration`, `comments.restates-code`, `comments.density-outlier`, `comments.jsdoc-echo`; registry | 9 |
| 9. Register and files | `comments.marketing`, `files.stray-summary`, `files.emoji`; registry | 7 |
| 10. Adapters and annotations | `adapters/jscpd.mjs`, `adapters/semgrep.mjs`, `adapters/registry.mjs`, their tests, `cli.mjs` (`--adapter`, `--github`), `lib/report.mjs` (annotations) | 8 |
| 11. Consumers | An advisory job in `ci.yml`; one line in `birdbrain-reviewer.md` pass 2 telling the reviewer to run `pnpm lint:slop --json --changed-since origin/main` and carry `blocking` findings into the verdict. Whether any check becomes a merge gate is a separate ADR written after phases 1 to 9 have produced data | 2 |

## Open questions

1. **`console.log` in `src/`.** `src/main/` has a `logSafe` helper. If `console.log` in `src/`
   is already conventional, `defensive.debug-leftover` covers only `debugger` statements. The
   current plan flags `console.log` in `source` files as advisory and lets the first run
   decide.
2. **Phase 11 scope.** The reviewer-agent wiring and the CI job could be part of this effort or a
   separate one. The plan treats them as phase 11 of this effort.

## Decisions taken without asking

These are recommended-option picks under ADR-0015.

- Script name `lint:slop`, not `audit:slop`, because `audit:*` in this repository means
  `pnpm audit` handling.
- Two severity levels, `blocking` and `advisory`, matching the reviewer's code tiers; the
  reviewer's `gate` tier is for mechanical merge controls and is not a property of a finding.
- No expiry on allowlist entries, for the reason given in the Allowlist section.
- `dup.block-clone` windows of 10 lines in `source` and 20 in `test`, to be tuned on first-run
  data.
- `semgrep` runs only with an explicit `--semgrep-config`, so the tool never invents a ruleset
  name.

## Changes from the 2026-09-03 design review

| Finding | Change |
| --- | --- |
| `git ls-files` enumerates the index while reads hit the working tree, so "snapshot at HEAD" was wrong | Contract renamed to "tracked working tree" and the divergence stated. The alternative, reading `HEAD` blobs with `git show`, was not taken: a developer running the tool before a commit wants their edits scanned, and `diff-coverage.mjs` already scores the dirty tree the same way. The envelope carries `commit` and `dirty` so consumers can tell |
| Path-only classification would feed CSS, HTML, images, and shell files to the parser | Three-step classification: excludes, then extension, then path role. Only listed code extensions reach the parser |
| Heuristics were marked `blocking`, against the reviewer's rule that unconfirmed suspicions are advisory | Severity policy section added. `blocking` now covers seven objective checks; `test.mocks-subject`, `test.literal-branch`, `defensive.swallowed-catch`, and the complexity thresholds are advisory. `sec.dangerous-sink` split into `sec.dynamic-code` (blocking, objective) and the data-flow sinks (advisory) |
| Coverage claim was false: `coverage.include` is `src/**` only and diff coverage excludes `scripts/` | Coverage gate bullet now states the current gap and makes the two configuration edits part of phase 1, with a named fallback |
| One module per family with one `id` and `severity` did not match multi-id families or per-finding severity; per-check allowlist tests crossed a seam | One module per check exporting `{ id, section, run }`; severity lives on the finding; allowlist tested centrally |
| `PATH` auto-detection made the default run nondeterministic, and `jscpd` replaced a built-in result | Adapters are explicit (`--adapter`), additive (`dup.jscpd-clone` beside `dup.block-clone`), and recorded with versions in an envelope that also carries `schemaVersion` |
| Phase 1 exceeded ADR-0016's ten-file cap once tests and coverage configuration were counted | Eleven phases, each with its file count in the Delivery phases table |
