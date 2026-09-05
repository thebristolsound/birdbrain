# Slop audit phase 1 implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `tdd` to implement this plan task by task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the skeleton of `scripts/slop-audit/`: a `pnpm lint:slop` entry point that inventories the tracked working tree, runs an (empty) list of checks, and prints a versioned JSON envelope or a text report, with the directory under the diff-coverage gate from its first pull request.

**Architecture:** Three `.mjs` modules under `scripts/slop-audit/`, each exporting pure functions in the shape of `scripts/audit-check.mjs`: `lib/files.mjs` builds the classified inventory, `lib/report.mjs` builds and renders the envelope, `cli.mjs` wires them with injectable git, disk, and console dependencies and returns an exit code. Tests under `tests/slopAudit/` drive every module with in-memory fixtures and never spawn `git`. Two configuration edits bring `scripts/slop-audit/**/*.mjs` under vitest coverage and the diff-coverage gate.

**Tech Stack:** Node 20 standard library only (`node:child_process`, `node:fs`, `node:path`, `node:url`); vitest 3 through the Electron runtime (`pnpm test`); ESLint 9 flat config; Prettier.

**Spec:** `docs/specs/2026-09-03-slop-audit-design.md` (approved 2026-09-04 through phase 10). This plan is phase 1 of its Delivery phases table.

## Global constraints

- No new dependencies. `package.json` is edited only to add the `lint:slop` script.
- Style: no semicolons, single quotes, no trailing commas, 100 columns, two-space indent. Run `pnpm exec prettier --check` on every new file before committing.
- Exported pure functions; `main(argv, deps)` returns an exit code; the entry guard assigns that
  result to `process.exitCode` so redirected output can flush before Node exits.
- Tests import the `.mjs` with the exact comment `// @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/` on the line before the `from` clause, as `tests/auditCheck.test.ts` does.
- Exit codes: 0 ran; 1 `--strict` and at least one `blocking` finding; 2 could not run.
- Input contract: tracked working tree (`git ls-files -z`, read from disk). Never read `HEAD` blobs.
- Classification order: excludes, then extension, then path role. Only `code` kinds ever reach a parser.
- Deterministic by default: nothing detected from `PATH`; no network.
- Commit messages: `type(scope): subject`, header at most 72 characters, body at most 6 lines of at most 72 characters, no `Co-authored-by`, no issue-closing keywords. Validate each message with `bash .claude/skills/post-commit-message/scripts/check.sh <file>` from a checkout that has `node_modules`, then commit with `git commit -F <file>`.
- Branch: `feat/slop-audit-phase-1`, cut from `main`. Ten files change in this phase; ADR-0016 criterion 6 is met.
- Two clarifications of the design, recorded here and in the spec's Data flow and Delivery phases sections: `pnpm-lock.yaml` is excluded from the inventory as a lock file (phase 3 reads it directly for `ctx`), so the `config` kind covers `package.json` only; and the `checks/index.mjs` registry moves from phase 1 to phase 2, because the existing `tests/diffCoverage.test.ts` needs a new case for the coverage carve-out and that is the tenth file.

---

## File structure

| File | Responsibility |
| --- | --- |
| `scripts/slop-audit/lib/files.mjs` | Inventory: list tracked paths, exclude, classify by extension and path, `--path` globs, `--changed-since` reported set, cached file reader |
| `scripts/slop-audit/lib/report.mjs` | Envelope: `schemaVersion`, `commit`, `dirty`, sorted findings, counts; text and JSON output; exit-code rule |
| `scripts/slop-audit/cli.mjs` | Argument parsing, git facts, running checks over a shared `ctx`, filtering to the reported set, rendering, exit code; entry guard |
| `tests/slopAudit/lib/files.test.ts` | Classification precedence, every exclude, globs, inventory, and reported set |
| `tests/slopAudit/lib/report.test.ts` | Envelope fields and ordering, both output formats, exit-code table |
| `tests/slopAudit/cli.test.ts` | Flag parsing, `main()` with injected dependencies across the exit-code table, `--changed-since` narrowing, `ctx` contents |
| `vitest.config.ts` | Add `scripts/slop-audit/**/*.mjs` to `coverage.include` |
| `scripts/diff-coverage.mjs` | Carve `scripts/slop-audit/` out of the `scripts/` exclusion in `isSourceLike` |
| `tests/diffCoverage.test.ts` | One new case for the carve-out |
| `package.json` | Add `lint:slop` |

The `ctx` object every check receives, fixed here because phases 2 to 10 build on it:

```
{
  root: string,                 // absolute repository root
  files: Entry[],               // every classified tracked file
  reported: Set<string>,        // paths findings are printed for
  read: (path: string) => string, // cached UTF-8 read relative to root
  packageJson: object           // parsed package.json
}
Entry = { path: string, kind: 'code' | 'prose' | 'config' | 'other', role: 'source' | 'test' | 'script' | null }
Finding = { id: string, severity: 'blocking' | 'advisory', file: string, line: number, message: string, evidence?: string, section: string }
```

Phase 2 adds `ctx.parse(path)`; phase 3 adds `ctx.lockfile` and the allowlist step.

---

### Task 1: Branch and the coverage gate

**Files:**
- Modify: `vitest.config.ts:25-30`
- Modify: `scripts/diff-coverage.mjs:110-125`
- Test: `tests/diffCoverage.test.ts:155-160`

**Interfaces:**
- Consumes: `isSourceLike(path)` from `scripts/diff-coverage.mjs`, already exported.
- Produces: nothing new; the gate now scores `scripts/slop-audit/**`.

- [ ] **Step 1: Create the branch**

Run from the Birdbrain checkout:

```bash
git fetch origin main
git switch -c feat/slop-audit-phase-1 origin/main
pnpm install --frozen-lockfile
```

Expected: branch created; install completes (it downloads Electron on a fresh worktree).

- [ ] **Step 2: Write the failing test**

In `tests/diffCoverage.test.ts`, inside `describe('isSourceLike', ...)`, after the test titled `does not name the test and tooling trees, which are not what the gate scores`, add:

```ts
  it('names scripts/slop-audit/, the one tooling tree vitest instruments', () => {
    expect(isSourceLike('scripts/slop-audit/cli.mjs')).toBe(true)
    expect(isSourceLike('scripts/slop-audit/lib/files.mjs')).toBe(true)
    expect(isSourceLike('scripts/diff-coverage.mjs')).toBe(false)
  })
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test tests/diffCoverage.test.ts`

Expected: FAIL on `names scripts/slop-audit/` with `expected false to be true`.

- [ ] **Step 4: Carve out the directory in `isSourceLike`**

In `scripts/diff-coverage.mjs`, replace the `isSourceLike` definition and the comment block preceding `SOURCE_LIKE` so they read:

```js
// Which uninstrumented changed files are worth naming. Docs, lockfiles and
// workflow YAML have no business in a coverage report; code does. `extension/**`
// is the case that motivated this: it is excluded from vitest's coverage
// `include`, so an extension-only PR scored zero lines and printed a pass.
// `scripts/` is tooling and stays out, except `scripts/slop-audit/`, which
// vitest.config.ts instruments so the gate scores it like source.
const SOURCE_LIKE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/
// `.d.mts` and `.d.cts` are declarations too, and `SOURCE_LIKE` matches their tails.
const DECLARATION = /\.d\.(ts|mts|cts)$/
// Co-located package tests: vitest.config.ts excludes them from instrumentation, so a
// changed one is absent from coverage-final.json for the same reason tests/ is.
const PACKAGE_TESTS = /^src\/packages\/[^/]+\/tests\//
const INSTRUMENTED_SCRIPTS = 'scripts/slop-audit/'
export const isSourceLike = (path) =>
  SOURCE_LIKE.test(path) &&
  !path.startsWith('tests/') &&
  !path.startsWith('e2e/') &&
  (!path.startsWith('scripts/') || path.startsWith(INSTRUMENTED_SCRIPTS)) &&
  !PACKAGE_TESTS.test(path) &&
  !DECLARATION.test(path)
```

- [ ] **Step 5: Add the directory to vitest coverage**

In `vitest.config.ts`, change the `coverage.include` array to:

```ts
      include: [
        'src/main/**/*.ts',
        'src/shared/**/*.ts',
        'src/renderer/**/*.{ts,tsx}',
        'src/packages/**/*.{ts,mts,cts}',
        'scripts/slop-audit/**/*.mjs'
      ],
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm test tests/diffCoverage.test.ts`

Expected: PASS, all cases in the file.

- [ ] **Step 7: Commit**

Write `/tmp/slop-audit-p1-c1.txt`:

```
chore(coverage): gate scripts/slop-audit/ on diff coverage

vitest instruments scripts/slop-audit/**/*.mjs and diff-coverage.mjs
stops skipping that one tooling directory, so the 90% changed-line
gate applies to the slop audit from its first pull request.
```

Run:

```bash
bash .claude/skills/post-commit-message/scripts/check.sh /tmp/slop-audit-p1-c1.txt
git add vitest.config.ts scripts/diff-coverage.mjs tests/diffCoverage.test.ts
git diff --staged --stat
git commit -F /tmp/slop-audit-p1-c1.txt
```

Expected: check exits 0; three files staged; commit created.

---

### Task 2: file inventory

**Files:**
- Create: `scripts/slop-audit/lib/files.mjs`
- Test: `tests/slopAudit/lib/files.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces, all named exports of `scripts/slop-audit/lib/files.mjs`:
  - `CODE_EXTENSIONS: string[]`
  - `EXCLUDED_PREFIXES: string[]`
  - `isExcluded(path: string): boolean`
  - `kindOf(path: string): 'code' | 'prose' | 'config' | 'other'`
  - `roleOf(path: string): 'source' | 'test' | 'script' | null`
  - `classify(path: string): Entry | null` (null when excluded)
  - `globToRegExp(glob: string): RegExp`
  - `buildInventory({ paths: string[], changed?: string[] | null, globs?: string[] }): { files: Entry[], reported: Set<string> }`
  - `listTrackedFiles(root: string): string[]` (spawns `git ls-files -z`)
  - `listChangedFiles(root: string, ref: string): string[]` (spawns `git diff --name-only <ref>`)
  - `createReader(root: string): (path: string) => string`

- [ ] **Step 1: Write the failing tests**

Create `tests/slopAudit/lib/files.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  CODE_EXTENSIONS,
  buildInventory,
  classify,
  globToRegExp,
  isExcluded,
  kindOf,
  roleOf
  // @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
} from '../../../scripts/slop-audit/lib/files.mjs'

describe('isExcluded', () => {
  it('drops the excluded directory prefixes', () => {
    expect(isExcluded('website/app/page.tsx')).toBe(true)
    expect(isExcluded('docs/archive/old.md')).toBe(true)
    expect(isExcluded('docs/design-handoff/proto.js')).toBe(true)
    expect(isExcluded('tests/fixtures/sample.ts')).toBe(true)
  })

  it('drops top-level dot-directories and root dotfiles, not nested dot-segments', () => {
    expect(isExcluded('.claude/agents/reviewer.md')).toBe(true)
    expect(isExcluded('.design-sync/NOTES.md')).toBe(true)
    expect(isExcluded('.nvmrc')).toBe(true)
    expect(isExcluded('src/.keep')).toBe(false)
  })

  it('drops lock files and generated files', () => {
    expect(isExcluded('pnpm-lock.yaml')).toBe(true)
    expect(isExcluded('website/pnpm-lock.yaml')).toBe(true)
    expect(isExcluded('src/renderer/routeTree.gen.ts')).toBe(true)
  })

  it('keeps ordinary source', () => {
    expect(isExcluded('src/main/index.ts')).toBe(false)
    expect(isExcluded('docs/specs/thing.md')).toBe(false)
  })
})

describe('kindOf', () => {
  it('calls every listed code extension code', () => {
    for (const ext of CODE_EXTENSIONS) expect(kindOf(`src/a${ext}`)).toBe('code')
  })

  it('separates prose and config from everything else', () => {
    expect(kindOf('docs/specs/thing.md')).toBe('prose')
    expect(kindOf('package.json')).toBe('config')
    expect(kindOf('src/renderer/styles.css')).toBe('other')
    expect(kindOf('src/renderer/index.html')).toBe('other')
    expect(kindOf('src/renderer/assets/logo.png')).toBe('other')
    expect(kindOf('src/renderer/fonts/inter.woff2')).toBe('other')
    expect(kindOf('scripts/setup.sh')).toBe('other')
    expect(kindOf('.github/workflows/ci.yml')).toBe('other')
    expect(kindOf('tsconfig.json')).toBe('other')
  })
})

describe('roleOf', () => {
  it('assigns test by directory or by .test. infix', () => {
    expect(roleOf('tests/main/a.test.ts')).toBe('test')
    expect(roleOf('e2e/flow.spec.ts')).toBe('test')
    expect(roleOf('src/packages/x/tests/x.test.ts')).toBe('test')
    expect(roleOf('src/main/a.test.mts')).toBe('test')
  })

  it('assigns script and source by directory', () => {
    expect(roleOf('scripts/audit-check.mjs')).toBe('script')
    expect(roleOf('scripts/slop-audit/cli.mjs')).toBe('script')
    expect(roleOf('src/main/index.ts')).toBe('source')
    expect(roleOf('extension/src/background.ts')).toBe('source')
  })

  it('leaves root configuration code without a role', () => {
    expect(roleOf('vitest.config.ts')).toBeNull()
    expect(roleOf('eslint.config.js')).toBeNull()
  })
})

describe('classify', () => {
  it('returns null for excluded paths before looking at anything else', () => {
    expect(classify('website/app/page.tsx')).toBeNull()
  })

  it('gives code a role and everything else a null role', () => {
    expect(classify('src/main/index.ts')).toEqual({
      path: 'src/main/index.ts',
      kind: 'code',
      role: 'source'
    })
    expect(classify('src/renderer/styles.css')).toEqual({
      path: 'src/renderer/styles.css',
      kind: 'other',
      role: null
    })
    expect(classify('docs/specs/thing.md')).toEqual({
      path: 'docs/specs/thing.md',
      kind: 'prose',
      role: null
    })
  })
})

describe('globToRegExp', () => {
  it('spans directories with ** and stays in one segment with * and ?', () => {
    expect(globToRegExp('src/**/*.ts').test('src/main/services/a.ts')).toBe(true)
    expect(globToRegExp('src/**/*.ts').test('src/a.ts')).toBe(true)
    expect(globToRegExp('src/*.ts').test('src/main/a.ts')).toBe(false)
    expect(globToRegExp('src/**').test('src/main/a.ts')).toBe(true)
    expect(globToRegExp('src/a?.ts').test('src/ab.ts')).toBe(true)
    expect(globToRegExp('src/a?.ts').test('src/a/b.ts')).toBe(false)
  })

  it('escapes regular-expression metacharacters in the glob', () => {
    expect(globToRegExp('src/a.ts').test('src/aXts')).toBe(false)
    expect(globToRegExp('src/(a).ts').test('src/(a).ts')).toBe(true)
  })
})

describe('buildInventory', () => {
  const paths = [
    'package.json',
    'pnpm-lock.yaml',
    'src/main/index.ts',
    'src/renderer/styles.css',
    'tests/main/a.test.ts',
    'website/app/page.tsx'
  ]

  it('classifies every path that survives the excludes and reports all of them', () => {
    const { files, reported } = buildInventory({ paths })
    expect(files.map((f: { path: string }) => f.path)).toEqual([
      'package.json',
      'src/main/index.ts',
      'src/renderer/styles.css',
      'tests/main/a.test.ts'
    ])
    expect([...reported]).toEqual([
      'package.json',
      'src/main/index.ts',
      'src/renderer/styles.css',
      'tests/main/a.test.ts'
    ])
  })

  it('narrows the reported set, not the file list, when changed paths are given', () => {
    const { files, reported } = buildInventory({ paths, changed: ['src/main/index.ts'] })
    expect(files).toHaveLength(4)
    expect([...reported]).toEqual(['src/main/index.ts'])
  })

  it('narrows the file list when globs are given', () => {
    const { files } = buildInventory({ paths, globs: ['src/**'] })
    expect(files.map((f: { path: string }) => f.path)).toEqual([
      'src/main/index.ts',
      'src/renderer/styles.css'
    ])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test tests/slopAudit/lib/files.test.ts`

Expected: FAIL with `Failed to load url ../../../scripts/slop-audit/lib/files.mjs` (module not found).

- [ ] **Step 3: Write the module**

Create `scripts/slop-audit/lib/files.mjs`:

```js
// Inventory for the slop audit: which tracked files exist, what kind each one is,
// and which of them a run reports on.
//
// Classification runs in three steps and the first step that decides wins:
// excludes drop the path, the extension fixes the kind, and for code the path
// fixes the role. Only `code` reaches a parser, so a stylesheet or an image under
// src/ can never be mistaken for TypeScript.
//
// The unit of analysis is the tracked working tree: what `git ls-files` lists,
// read from disk. Uncommitted edits are scanned, untracked files are not. See
// docs/specs/2026-09-03-slop-audit-design.md, "Tracked working tree".

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const CODE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']

// Directory prefixes dropped before anything else looks at the path.
export const EXCLUDED_PREFIXES = [
  'website/',
  'docs/archive/',
  'docs/design-handoff/',
  'tests/fixtures/'
]

const LOCK_FILES = new Set(['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock'])
const GENERATED = /\.gen\.[cm]?[jt]sx?$/
const TEST_FILE = /\.test\.[cm]?[jt]sx?$/

const basename = (path) => path.slice(path.lastIndexOf('/') + 1)

const extension = (path) => {
  const name = basename(path)
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot)
}

// A leading dot covers top-level dot-directories (.claude/, .design-sync/) and
// root dotfiles (.nvmrc) in one rule. A dot-segment deeper in the tree is kept.
export const isExcluded = (path) =>
  path.startsWith('.') ||
  EXCLUDED_PREFIXES.some((prefix) => path.startsWith(prefix)) ||
  LOCK_FILES.has(basename(path)) ||
  GENERATED.test(path)

export const kindOf = (path) => {
  const ext = extension(path)
  if (CODE_EXTENSIONS.includes(ext)) return 'code'
  if (ext === '.md') return 'prose'
  if (basename(path) === 'package.json') return 'config'
  return 'other'
}

// Roles apply to code only. Code outside every role directory (root configuration
// such as vitest.config.ts) gets null and is seen by no role-scoped check.
export const roleOf = (path) => {
  if (path.startsWith('tests/') || path.startsWith('e2e/') || TEST_FILE.test(path)) return 'test'
  if (path.startsWith('scripts/')) return 'script'
  if (path.startsWith('src/') || path.startsWith('extension/src/')) return 'source'
  return null
}

export const classify = (path) => {
  if (isExcluded(path)) return null
  const kind = kindOf(path)
  return { path, kind, role: kind === 'code' ? roleOf(path) : null }
}

// Minimal glob: `**` spans directories, `*` and `?` stay inside one segment. Node
// 20's path.matchesGlob is experimental and emits a warning; --path needs no more.
export const globToRegExp = (glob) => {
  let out = ''
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i]
    if (ch === '*' && glob[i + 1] === '*') {
      i++
      if (glob[i + 1] === '/') {
        i++
        out += '(?:.*/)?'
      } else {
        out += '.*'
      }
    } else if (ch === '*') {
      out += '[^/]*'
    } else if (ch === '?') {
      out += '[^/]'
    } else {
      out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`^${out}$`)
}

// Pure: takes the listed paths and, when --changed-since was given, the paths git
// says changed. `reported` is the subset findings are printed for; the checks still
// see every file so cross-file checks keep their context.
export const buildInventory = ({ paths, changed = null, globs = [] }) => {
  const matchers = globs.map(globToRegExp)
  const files = paths
    .filter((path) => matchers.length === 0 || matchers.some((re) => re.test(path)))
    .map(classify)
    .filter((entry) => entry !== null)
  const changedSet = changed === null ? null : new Set(changed)
  const reported = new Set(
    files.map((entry) => entry.path).filter((path) => changedSet === null || changedSet.has(path))
  )
  return { files, reported }
}

export const listTrackedFiles = (root) =>
  execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter((path) => path.length > 0)

export const listChangedFiles = (root, ref) =>
  execFileSync('git', ['diff', '--name-only', ref], { cwd: root, encoding: 'utf8' })
    .split('\n')
    .filter((path) => path.length > 0)

// Reads a tracked file once; every check shares the text through ctx.read.
export const createReader = (root) => {
  const cache = new Map()
  return (path) => {
    if (!cache.has(path)) cache.set(path, readFileSync(join(root, path), 'utf8'))
    return cache.get(path)
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test tests/slopAudit/lib/files.test.ts`

Expected: PASS, 15 tests.

- [ ] **Step 5: Lint and format**

Run:

```bash
pnpm exec eslint scripts/slop-audit/lib/files.mjs tests/slopAudit/lib/files.test.ts
pnpm exec prettier --check scripts/slop-audit/lib/files.mjs tests/slopAudit/lib/files.test.ts
```

Expected: both exit 0. If Prettier reports a difference, run `pnpm exec prettier --write` on the named file and re-run the tests.

- [ ] **Step 6: Commit**

Write `/tmp/slop-audit-p1-c2.txt`:

```
feat(scripts): add the slop-audit file inventory

Lists the tracked working tree, drops the excluded prefixes, lock and
generated files, classifies by extension then path role, and narrows
the reported set for --changed-since. Pure except the two git calls.
```

Run:

```bash
bash .claude/skills/post-commit-message/scripts/check.sh /tmp/slop-audit-p1-c2.txt
git add scripts/slop-audit/lib/files.mjs tests/slopAudit/lib/files.test.ts
git diff --staged --stat
git commit -F /tmp/slop-audit-p1-c2.txt
```

Expected: check exits 0; two files staged; commit created.

---

### Task 3: report envelope and output

**Files:**
- Create: `scripts/slop-audit/lib/report.mjs`
- Test: `tests/slopAudit/lib/report.test.ts`

**Interfaces:**
- Consumes: the `Finding` shape from File structure.
- Produces, all named exports of `scripts/slop-audit/lib/report.mjs`:
  - `SCHEMA_VERSION = 1`
  - `SEVERITIES = ['blocking', 'advisory']`
  - `buildEnvelope({ commit, dirty, adapters?, findings, skipped?, stale? })`: returns `{ schemaVersion, commit, dirty, adapters, findings, skipped, stale, counts: { blocking, advisory } }`; throws on an unknown severity
  - `renderJson(envelope): string`
  - `renderText(envelope): string`
  - `exitCode({ envelope, strict }): 0 | 1`

- [ ] **Step 1: Write the failing tests**

Create `tests/slopAudit/lib/report.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  SCHEMA_VERSION,
  buildEnvelope,
  exitCode,
  renderJson,
  renderText
  // @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
} from '../../../scripts/slop-audit/lib/report.mjs'

type Finding = {
  id: string
  severity: string
  file: string
  line: number
  message: string
  evidence?: string
  section: string
}

const finding = (over: Partial<Finding> = {}): Finding => ({
  id: 'test.exit-zero',
  severity: 'blocking',
  file: 'tests/a.test.ts',
  line: 3,
  message: 'process.exit(0) in a test',
  evidence: 'process.exit(0)',
  section: '1.1',
  ...over
})

describe('buildEnvelope', () => {
  it('stamps the schema version, commit and dirty flag, and counts by severity', () => {
    const envelope = buildEnvelope({
      commit: 'abc123',
      dirty: true,
      findings: [finding(), finding({ severity: 'advisory', id: 'comments.narration' })]
    })
    expect(envelope.schemaVersion).toBe(SCHEMA_VERSION)
    expect(envelope.commit).toBe('abc123')
    expect(envelope.dirty).toBe(true)
    expect(envelope.counts).toEqual({ blocking: 1, advisory: 1 })
    expect(envelope.adapters).toEqual([])
    expect(envelope.skipped).toEqual([])
    expect(envelope.stale).toEqual([])
  })

  it('sorts findings by file, then line, then id, without mutating the input', () => {
    const input = [
      finding({ file: 'src/b.ts', line: 9 }),
      finding({ file: 'src/a.ts', line: 20, id: 'z.check' }),
      finding({ file: 'src/a.ts', line: 20, id: 'a.check' }),
      finding({ file: 'src/a.ts', line: 2 })
    ]
    const before = [...input]
    const { findings } = buildEnvelope({ commit: 'c', dirty: false, findings: input })
    expect(findings.map((f: Finding) => `${f.file}:${f.line}:${f.id}`)).toEqual([
      'src/a.ts:2:test.exit-zero',
      'src/a.ts:20:a.check',
      'src/a.ts:20:z.check',
      'src/b.ts:9:test.exit-zero'
    ])
    expect(input).toEqual(before)
  })

  it('rejects a severity outside the two tiers', () => {
    expect(() =>
      buildEnvelope({ commit: 'c', dirty: false, findings: [finding({ severity: 'gate' })] })
    ).toThrow('test.exit-zero: unknown severity "gate"')
  })
})

describe('renderJson', () => {
  it('round-trips the envelope', () => {
    const envelope = buildEnvelope({ commit: 'c', dirty: false, findings: [finding()] })
    expect(JSON.parse(renderJson(envelope))).toEqual(envelope)
  })
})

describe('renderText', () => {
  it('names the commit, marks a dirty tree, groups by id, and ends with the counts', () => {
    const envelope = buildEnvelope({
      commit: 'abc123',
      dirty: true,
      findings: [finding(), finding({ line: 8, evidence: undefined })],
      skipped: [{ name: 'jscpd', reason: 'not requested' }],
      stale: [{ id: 'test.exit-zero', path: 'tests/gone.test.ts' }]
    })
    const text = renderText(envelope)
    const lines = text.split('\n')
    expect(lines[0]).toBe('slop-audit: abc123 (dirty working tree)')
    expect(lines[1]).toBe('test.exit-zero - 2')
    expect(lines[2]).toBe('  blocking  tests/a.test.ts:3  process.exit(0) in a test')
    expect(lines[3]).toBe('      process.exit(0)')
    expect(lines[4]).toBe('  blocking  tests/a.test.ts:8  process.exit(0) in a test')
    expect(lines[5]).toBe('skipped jscpd: not requested')
    expect(lines[6]).toBe('stale allowlist entry: test.exit-zero tests/gone.test.ts')
    expect(lines[7]).toBe('slop-audit: 1 blocking, 1 advisory'.replace('1 advisory', '0 advisory'))
    expect(lines).toHaveLength(8)
  })

  it('prints only the header and the counts on a clean tree', () => {
    const envelope = buildEnvelope({ commit: 'abc123', dirty: false, findings: [] })
    expect(renderText(envelope)).toBe('slop-audit: abc123\nslop-audit: 0 blocking, 0 advisory')
  })
})

describe('exitCode', () => {
  const blocking = buildEnvelope({ commit: 'c', dirty: false, findings: [finding()] })
  const advisory = buildEnvelope({
    commit: 'c',
    dirty: false,
    findings: [finding({ severity: 'advisory' })]
  })

  it('is 0 without --strict whatever was found', () => {
    expect(exitCode({ envelope: blocking, strict: false })).toBe(0)
  })

  it('is 1 under --strict only when a blocking finding exists', () => {
    expect(exitCode({ envelope: blocking, strict: true })).toBe(1)
    expect(exitCode({ envelope: advisory, strict: true })).toBe(0)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test tests/slopAudit/lib/report.test.ts`

Expected: FAIL with `Failed to load url ../../../scripts/slop-audit/lib/report.mjs`.

- [ ] **Step 3: Write the module**

Create `scripts/slop-audit/lib/report.mjs`:

```js
// Output for the slop audit: the JSON envelope consumers parse and the text a
// developer reads. Findings are sorted so two runs over the same tree print the
// same bytes. The envelope names the commit it describes and whether the tree had
// uncommitted edits, because the input is the working tree, not HEAD.

export const SCHEMA_VERSION = 1
export const SEVERITIES = ['blocking', 'advisory']

const compareFindings = (a, b) =>
  a.file.localeCompare(b.file) || a.line - b.line || a.id.localeCompare(b.id)

export const buildEnvelope = ({
  commit,
  dirty,
  adapters = [],
  findings,
  skipped = [],
  stale = []
}) => {
  for (const finding of findings) {
    if (!SEVERITIES.includes(finding.severity)) {
      throw new Error(`${finding.id}: unknown severity "${finding.severity}"`)
    }
  }
  const sorted = [...findings].sort(compareFindings)
  const counts = Object.fromEntries(
    SEVERITIES.map((severity) => [severity, sorted.filter((f) => f.severity === severity).length])
  )
  return {
    schemaVersion: SCHEMA_VERSION,
    commit,
    dirty,
    adapters,
    findings: sorted,
    skipped,
    stale,
    counts
  }
}

export const renderJson = (envelope) => JSON.stringify(envelope, null, 2)

export const renderText = (envelope) => {
  const lines = [`slop-audit: ${envelope.commit}${envelope.dirty ? ' (dirty working tree)' : ''}`]
  const byId = new Map()
  for (const finding of envelope.findings) {
    if (!byId.has(finding.id)) byId.set(finding.id, [])
    byId.get(finding.id).push(finding)
  }
  for (const [id, group] of byId) {
    lines.push(`${id} - ${group.length}`)
    for (const finding of group) {
      lines.push(
        `  ${finding.severity.padEnd(8)}  ${finding.file}:${finding.line}  ${finding.message}`
      )
      if (finding.evidence) lines.push(`      ${finding.evidence}`)
    }
  }
  for (const entry of envelope.skipped) lines.push(`skipped ${entry.name}: ${entry.reason}`)
  for (const entry of envelope.stale) lines.push(`stale allowlist entry: ${entry.id} ${entry.path}`)
  lines.push(`slop-audit: ${envelope.counts.blocking} blocking, ${envelope.counts.advisory} advisory`)
  return lines.join('\n')
}

export const exitCode = ({ envelope, strict }) => (strict && envelope.counts.blocking > 0 ? 1 : 0)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test tests/slopAudit/lib/report.test.ts`

Expected: PASS, 8 tests. If the `renderText` grouping test fails on line 2 spacing, the expected string is `'  blocking  tests/a.test.ts:3  process.exit(0) in a test'`: two spaces, `blocking` padded to eight characters (already eight), two spaces, path. Fix the test only if the module output is what the design asks for and the test string was mistyped.

- [ ] **Step 5: Lint and format**

Run:

```bash
pnpm exec eslint scripts/slop-audit/lib/report.mjs tests/slopAudit/lib/report.test.ts
pnpm exec prettier --check scripts/slop-audit/lib/report.mjs tests/slopAudit/lib/report.test.ts
```

Expected: both exit 0.

- [ ] **Step 6: Commit**

Write `/tmp/slop-audit-p1-c3.txt`:

```
feat(scripts): add the slop-audit report envelope

Versioned JSON envelope with commit, dirty flag, sorted findings and
per-severity counts; a text renderer grouped by check id; and the
exit-code rule (1 only under --strict with a blocking finding).
```

Run:

```bash
bash .claude/skills/post-commit-message/scripts/check.sh /tmp/slop-audit-p1-c3.txt
git add scripts/slop-audit/lib/report.mjs tests/slopAudit/lib/report.test.ts
git diff --staged --stat
git commit -F /tmp/slop-audit-p1-c3.txt
```

Expected: check exits 0; two files staged; commit created.

---

### Task 4: Entry point and `lint:slop`

**Files:**
- Create: `scripts/slop-audit/cli.mjs`
- Modify: `package.json:33` (the `"lint:agents-md"` line; add one line after it)
- Test: `tests/slopAudit/cli.test.ts`

**Interfaces:**
- Consumes: `buildInventory`, `createReader`, `listChangedFiles`, `listTrackedFiles` from `./lib/files.mjs`; `buildEnvelope`, `exitCode`, `renderJson`, `renderText` from `./lib/report.mjs`.
- Produces, named exports of `scripts/slop-audit/cli.mjs`:
  - `USAGE: string`
  - `parseArgs(argv: string[]): { json: boolean, strict: boolean, changedSince: string | null, paths: string[] }`; throws on an unknown argument or a flag missing its value
  - `gitInfo(root): { commit: string, dirty: boolean }`
  - `runChecks({ checks, ctx }): Finding[]`; rethrows a check's error prefixed with `check <id> failed:`
  - `main(argv, deps?): 0 | 1 | 2` where `deps` may override `root`, `checks`, `listFiles`, `listChanged`, `info`, `read`, `stdout`, `stderr`
- Phase 2 will add a `checks/index.mjs` registry and pass it as the default `checks`.

- [ ] **Step 1: Write the failing tests**

Create `tests/slopAudit/cli.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  USAGE,
  main,
  parseArgs,
  runChecks
  // @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
} from '../../scripts/slop-audit/cli.mjs'

type Finding = {
  id: string
  severity: string
  file: string
  line: number
  message: string
  section: string
}

type Ctx = {
  root: string
  files: { path: string; kind: string; role: string | null }[]
  reported: Set<string>
  read: (path: string) => string
  packageJson: { name: string }
}

type Check = { id: string; section: string; run: (ctx: Ctx) => Finding[] }

const tree: Record<string, string> = {
  'package.json': JSON.stringify({ name: 'fixture', dependencies: {} }),
  'src/main/a.ts': 'export const a = 1\n',
  'tests/a.test.ts': "it('x', () => {})\n"
}

const harness = (over: Record<string, unknown> = {}) => {
  const out: string[] = []
  const err: string[] = []
  const deps = {
    root: '/fixture',
    checks: [] as Check[],
    listFiles: () => Object.keys(tree),
    listChanged: () => ['src/main/a.ts'],
    info: () => ({ commit: 'abc123', dirty: false }),
    read: (path: string) => {
      if (!(path in tree)) throw new Error(`no such file ${path}`)
      return tree[path]
    },
    stdout: (line: string) => out.push(line),
    stderr: (line: string) => err.push(line),
    ...over
  }
  return { out, err, deps }
}

const flagEverything = (id: string, severity: string): Check => ({
  id,
  section: '0',
  run: (ctx) =>
    ctx.files
      .filter((f) => f.kind === 'code')
      .map((f) => ({ id, severity, file: f.path, line: 1, message: 'flagged', section: '0' }))
})

describe('parseArgs', () => {
  it('defaults to a plain advisory run over the whole tree', () => {
    expect(parseArgs([])).toEqual({ json: false, strict: false, changedSince: null, paths: [] })
  })

  it('reads every flag, with --path repeatable', () => {
    expect(
      parseArgs(['--json', '--strict', '--changed-since', 'origin/main', '--path', 'src/**', '--path', 'e2e/**'])
    ).toEqual({ json: true, strict: true, changedSince: 'origin/main', paths: ['src/**', 'e2e/**'] })
  })

  it('rejects a flag without its value', () => {
    expect(() => parseArgs(['--changed-since'])).toThrow('--changed-since needs a value')
    expect(() => parseArgs(['--path', '--json'])).toThrow('--path needs a value')
  })

  it('rejects an unknown argument and prints usage', () => {
    expect(() => parseArgs(['--adapter', 'jscpd'])).toThrow('unknown argument "--adapter"')
    expect(() => parseArgs(['--adapter'])).toThrow(USAGE)
  })
})

describe('runChecks', () => {
  it('concatenates every check\'s findings in registry order', () => {
    const ctx = { files: [{ path: 'src/a.ts', kind: 'code', role: 'source' }] } as unknown as Ctx
    const findings = runChecks({
      checks: [flagEverything('b.check', 'advisory'), flagEverything('a.check', 'blocking')],
      ctx
    })
    expect(findings.map((f: Finding) => f.id)).toEqual(['b.check', 'a.check'])
  })

  it('names the check that threw', () => {
    const broken: Check = {
      id: 'x.broken',
      section: '0',
      run: () => {
        throw new Error('boom')
      }
    }
    expect(() => runChecks({ checks: [broken], ctx: {} as Ctx })).toThrow(
      'check x.broken failed: boom'
    )
  })
})

describe('main', () => {
  it('exits 0 and prints an empty envelope when no checks are registered', () => {
    const { out, err, deps } = harness()
    expect(main(['--json'], deps)).toBe(0)
    expect(err).toEqual([])
    const envelope = JSON.parse(out.join('\n'))
    expect(envelope).toMatchObject({
      schemaVersion: 1,
      commit: 'abc123',
      dirty: false,
      adapters: [],
      findings: [],
      skipped: [],
      stale: [],
      counts: { blocking: 0, advisory: 0 }
    })
  })

  it('prints the text report by default', () => {
    const { out, deps } = harness()
    expect(main([], deps)).toBe(0)
    expect(out.join('\n')).toBe('slop-audit: abc123\nslop-audit: 0 blocking, 0 advisory')
  })

  it('hands every check the shared ctx', () => {
    let seen: Ctx | null = null
    const spy: Check = {
      id: 'x.spy',
      section: '0',
      run: (ctx) => {
        seen = ctx
        return []
      }
    }
    const { deps } = harness({ checks: [spy] })
    expect(main([], deps)).toBe(0)
    expect(seen).not.toBeNull()
    expect(seen!.root).toBe('/fixture')
    expect(seen!.packageJson.name).toBe('fixture')
    expect(seen!.files.map((f) => f.path)).toEqual(['package.json', 'src/main/a.ts', 'tests/a.test.ts'])
    expect([...seen!.reported]).toEqual(['package.json', 'src/main/a.ts', 'tests/a.test.ts'])
    expect(seen!.read('src/main/a.ts')).toBe('export const a = 1\n')
  })

  it('exits 1 under --strict when a blocking finding exists, 0 otherwise', () => {
    const blocking = flagEverything('x.block', 'blocking')
    expect(main(['--strict'], harness({ checks: [blocking] }).deps)).toBe(1)
    expect(main([], harness({ checks: [blocking] }).deps)).toBe(0)
    const advisory = flagEverything('x.advise', 'advisory')
    expect(main(['--strict'], harness({ checks: [advisory] }).deps)).toBe(0)
  })

  it('reports only changed files under --changed-since, while checks still see all', () => {
    let seenCount = 0
    const counting: Check = {
      ...flagEverything('x.all', 'advisory'),
      run: (ctx) => {
        seenCount = ctx.files.length
        return flagEverything('x.all', 'advisory').run(ctx)
      }
    }
    const { out, deps } = harness({ checks: [counting] })
    expect(main(['--json', '--changed-since', 'origin/main'], deps)).toBe(0)
    const envelope = JSON.parse(out.join('\n'))
    expect(seenCount).toBe(3)
    expect(envelope.findings.map((f: Finding) => f.file)).toEqual(['src/main/a.ts'])
  })

  it('exits 2 on an unknown argument', () => {
    const { err, deps } = harness()
    expect(main(['--adapter', 'jscpd'], deps)).toBe(2)
    expect(err[0]).toContain('slop-audit: unknown argument "--adapter"')
  })

  it('exits 2 when git facts cannot be read', () => {
    const { err, deps } = harness({
      info: () => {
        throw new Error('fatal: not a git repository')
      }
    })
    expect(main([], deps)).toBe(2)
    expect(err).toEqual(['slop-audit: fatal: not a git repository'])
  })

  it('exits 2 when package.json cannot be read', () => {
    const { err, deps } = harness({ read: () => { throw new Error("ENOENT: no such file or directory, open 'package.json'") } })
    expect(main([], deps)).toBe(2)
    expect(err[0]).toContain('slop-audit: ENOENT')
  })

  it('exits 2 when a check throws, naming the check', () => {
    const broken: Check = {
      id: 'x.broken',
      section: '0',
      run: () => {
        throw new Error('boom')
      }
    }
    const { err, deps } = harness({ checks: [broken] })
    expect(main([], deps)).toBe(2)
    expect(err).toEqual(['slop-audit: check x.broken failed: boom'])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test tests/slopAudit/cli.test.ts`

Expected: FAIL with `Failed to load url ../../scripts/slop-audit/cli.mjs`.

- [ ] **Step 3: Write the entry point**

Create `scripts/slop-audit/cli.mjs`:

```js
#!/usr/bin/env node
// Entry point for the slop audit: names the detectable tells from
// docs/specs/2026-09-03-agentic-code-slop-patterns-research.md on the tracked
// working tree. Advisory by default; --strict exits 1 on a blocking finding.
// Design: docs/specs/2026-09-03-slop-audit-design.md.
//
// Usage: node scripts/slop-audit/cli.mjs [--json] [--strict] [--changed-since <ref>]
//        [--path <glob>]...
//
// Exit codes: 0 ran, 1 --strict and a blocking finding, 2 could not run.

import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { buildInventory, createReader, listChangedFiles, listTrackedFiles } from './lib/files.mjs'
import { buildEnvelope, exitCode, renderJson, renderText } from './lib/report.mjs'

export const USAGE =
  'usage: slop-audit [--json] [--strict] [--changed-since <ref>] [--path <glob>]...'

export const parseArgs = (argv) => {
  const options = { json: false, strict: false, changedSince: null, paths: [] }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--json') {
      options.json = true
    } else if (arg === '--strict') {
      options.strict = true
    } else if (arg === '--changed-since' || arg === '--path') {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`)
      i++
      if (arg === '--path') options.paths.push(value)
      else options.changedSince = value
    } else {
      throw new Error(`unknown argument "${arg}"\n${USAGE}`)
    }
  }
  return options
}

// The commit the report describes, and whether any tracked file differs from it.
// Untracked files are not scanned, so they do not make the tree dirty here.
export const gitInfo = (root) => {
  const run = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  return {
    commit: run(['rev-parse', 'HEAD']),
    dirty: run(['status', '--porcelain', '--untracked-files=no']) !== ''
  }
}

// A check that throws stops the run with its id in the message. A half-finished
// report that looks complete is worse than no report.
export const runChecks = ({ checks, ctx }) =>
  checks.flatMap((check) => {
    try {
      return check.run(ctx)
    } catch (error) {
      throw new Error(`check ${check.id} failed: ${error.message}`)
    }
  })

// Everything that touches git, the disk, or the console is injectable so the
// tests drive main() without a repository. The defaults are the real thing.
export const main = (argv, deps = {}) => {
  const {
    root = process.cwd(),
    checks = [],
    listFiles = listTrackedFiles,
    listChanged = listChangedFiles,
    info = gitInfo,
    read = createReader(root),
    stdout = console.log,
    stderr = console.error
  } = deps

  let options
  let envelope
  try {
    options = parseArgs(argv)
    const { commit, dirty } = info(root)
    const packageJson = JSON.parse(read('package.json'))
    const changed = options.changedSince === null ? null : listChanged(root, options.changedSince)
    const { files, reported } = buildInventory({
      paths: listFiles(root),
      changed,
      globs: options.paths
    })
    const ctx = { root, files, reported, read, packageJson }
    const findings = runChecks({ checks, ctx }).filter((finding) => reported.has(finding.file))
    envelope = buildEnvelope({ commit, dirty, findings })
  } catch (error) {
    stderr(`slop-audit: ${error.message}`)
    return 2
  }

  stdout(options.json ? renderJson(envelope) : renderText(envelope))
  return exitCode({ envelope, strict: options.strict })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2))
}
```

- [ ] **Step 4: Add the package script**

In `package.json`, directly after the line `"lint:agents-md": "node scripts/lint-agents-md.mjs",` add:

```json
    "lint:slop": "node scripts/slop-audit/cli.mjs",
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test tests/slopAudit/cli.test.ts`

Expected: PASS, 15 tests.

- [ ] **Step 6: Run the real thing**

Run from the repository root:

```bash
pnpm lint:slop
pnpm lint:slop --json | node -e 'const e = JSON.parse(require("fs").readFileSync(0, "utf8")); console.log(e.schemaVersion, e.commit.length, e.dirty, e.counts)'
pnpm lint:slop --changed-since origin/main --path 'src/**'
pnpm lint:slop --adapter jscpd; echo "exit $?"
```

Expected, in order: two text lines (`slop-audit: <sha>` with ` (dirty working tree)` because `package.json` is edited, then `slop-audit: 0 blocking, 0 advisory`); `1 40 true { blocking: 0, advisory: 0 }`; the same two text lines; `slop-audit: unknown argument "--adapter"` on standard error followed by the usage line and `exit 2`.

- [ ] **Step 7: Lint and format**

Run:

```bash
pnpm exec eslint scripts/slop-audit tests/slopAudit
pnpm exec prettier --check scripts/slop-audit tests/slopAudit
```

Expected: both exit 0.

- [ ] **Step 8: Commit**

Write `/tmp/slop-audit-p1-c4.txt`:

```
feat(scripts): add the slop-audit entry point and lint:slop

Flags, git facts, a shared ctx for checks, filtering to the reported
set, text or JSON output, and the exit-code table. No checks are
registered yet; phase 2 adds the registry and the first two.
```

Run:

```bash
bash .claude/skills/post-commit-message/scripts/check.sh /tmp/slop-audit-p1-c4.txt
git add scripts/slop-audit/cli.mjs tests/slopAudit/cli.test.ts package.json
git diff --staged --stat
git commit -F /tmp/slop-audit-p1-c4.txt
```

Expected: check exits 0; three files staged; commit created.

---

### Task 5: Full verification and the draft pull request

**Files:**
- None new; this task verifies and publishes.

**Interfaces:**
- Consumes: everything from Tasks 1 to 4.
- Produces: a draft pull request on `feat/slop-audit-phase-1`.

- [ ] **Step 1: Run the CI set locally**

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm coverage:diff --base origin/main
```

Expected: lint and typecheck exit 0; the full test run passes with the four new or edited test files included; `coverage:diff` prints `PASS` with diff coverage of 90.00% or higher. If `coverage-final.json` has no entry for any `scripts/slop-audit/*.mjs` file, the v8 provider did not instrument `.mjs` under the Electron runtime. Stop, do not open the PR, and report that with the `coverage-final.json` key list. The design names this as the one place phase 1 halts.

- [ ] **Step 2: Confirm the file count**

Run: `git diff --stat origin/main...HEAD`

Expected: exactly these ten paths:

```
package.json
scripts/diff-coverage.mjs
scripts/slop-audit/cli.mjs
scripts/slop-audit/lib/files.mjs
scripts/slop-audit/lib/report.mjs
tests/diffCoverage.test.ts
tests/slopAudit/cli.test.ts
tests/slopAudit/lib/files.test.ts
tests/slopAudit/lib/report.test.ts
vitest.config.ts
```

- [ ] **Step 3: Run preflight**

Run: `pnpm preflight`

Expected: it writes `.preflight/verification.md` at the head sha. Its contents go into the PR body verbatim in Step 5.

- [ ] **Step 4: Push the branch**

Run: `git push -u origin feat/slop-audit-phase-1`

- [ ] **Step 5: Write the PR body**

Write `/tmp/slop-audit-p1-pr.md` following `.github/pull_request_template.md` exactly. Replace the `<sha>` placeholders with the head sha from `git rev-parse HEAD`, and paste `.preflight/verification.md` verbatim under `## Verification` (Step 3 wrote it):

```markdown
No issue: phase 1 of docs/specs/2026-09-03-slop-audit-design.md, approved 2026-09-04.

## Summary

Adds the skeleton of `scripts/slop-audit/`: `pnpm lint:slop` inventories the tracked working tree, runs a (still empty) list of checks, and prints a text report or a versioned JSON envelope carrying the head commit and a dirty flag. `scripts/slop-audit/**/*.mjs` is now under vitest coverage and the diff-coverage gate. No checks ship in this phase; phase 2 adds the registry and the first two. Dispatcher opens for review.

## Changes

- `scripts/slop-audit/lib/files.mjs`, `tests/slopAudit/lib/files.test.ts`: inventory, three-step classification, `--path` globs, `--changed-since` reported set
- `scripts/slop-audit/lib/report.mjs`, `tests/slopAudit/lib/report.test.ts`: envelope, text and JSON renderers, exit-code rule
- `scripts/slop-audit/cli.mjs`, `tests/slopAudit/cli.test.ts`, `package.json`: entry point with injectable dependencies, `lint:slop`
- `vitest.config.ts`, `scripts/diff-coverage.mjs`, `tests/diffCoverage.test.ts`: coverage include and diff-coverage carve-out for `scripts/slop-audit/`

## Evidence-affecting

No

## Verification

<paste .preflight/verification.md here, marker line included>

Pull request description generated by Claude Code
```

Run: `bash .claude/skills/post-pr-body/scripts/check.sh /tmp/slop-audit-p1-pr.md`

Expected: exit 0. Fix the file and re-run if it reports a shape problem.

- [ ] **Step 6: Open the draft pull request**

Run:

```bash
gh pr create --draft --base main --head feat/slop-audit-phase-1 \
  --title "feat(scripts): slop audit phase 1, inventory and report skeleton" \
  --body-file /tmp/slop-audit-p1-pr.md
```

Expected: a draft PR URL. Do not mark it ready, do not merge. Report the URL and the `pnpm lint:slop --json` output from Task 4 Step 6.

---

## Self-review

**Spec coverage for phase 1.** Layout: `cli.mjs`, `lib/files.mjs`, `lib/report.mjs` (Tasks 2 to 4); `checks/index.mjs` moved to phase 2 (Global Constraints; the spec's Delivery phases table). Data flow step 1 (three-step classification, excludes, `--path`, `--changed-since`, injectable lister): Task 2. Step 3 (`ctx` contents): Task 4, `main()`. Step 5 (render, exit table): Tasks 3 and 4. Finding shape and severity validation: Task 3. Output and exit codes, `--json` envelope fields: Task 3 and Task 4 tests. Tracked working tree constraint: Task 2 `listTrackedFiles`, Task 4 `gitInfo`. Deterministic by default: no `PATH` probing anywhere; `--adapter` is rejected as unknown until phase 10 (Task 4 tests). Coverage gate: Task 1 and Task 5 Step 1. `lint:slop`: Task 4. Not in phase 1 by design: `lib/ts.mjs`, allowlist, `--github`, adapters, every check.

**Placeholder scan.** No TBD, TODO, similar-to, or add-validation steps. The only bracketed placeholder is `<paste .preflight/verification.md here>` in the PR body, which the template itself requires to be generated at the head sha and cannot be pre-written.

**Type consistency.** `Entry = { path, kind, role }` is produced by `classify` (Task 2) and consumed by `flagEverything` and the `ctx` spy in Task 4 tests with the same three keys. `buildEnvelope` accepts `{ commit, dirty, adapters, findings, skipped, stale }` (Task 3) and `main` calls it with `{ commit, dirty, findings }` (Task 4), relying on the defaults tested in Task 3. `exitCode({ envelope, strict })` is the same signature in both tasks. `main(argv, deps)` dependency names (`root`, `checks`, `listFiles`, `listChanged`, `info`, `read`, `stdout`, `stderr`) match between the module and the `harness` in the test.
