// Scores unit-test coverage of only the lines a branch adds or modifies.
//
// Project-wide thresholds (vitest.config.ts) stop the tree backsliding; they
// cannot ask whether new code arrived tested. A PR can add an untested module
// and still clear every global gate, because the tree is large enough to
// absorb it. This scores the diff instead.
//
// Only files vitest already instruments are scored — membership in
// coverage-final.json is the filter, so this inherits the include/exclude
// lists in vitest.config.ts rather than duplicating them. Lines carrying no
// statement (imports, types, blank, comment, closing braces) are not
// executable and are excluded from the denominator.
//
// The diff is taken against the WORKING TREE, not HEAD, because that is what
// `pnpm test:coverage` measured: coverage-final.json describes the files on
// disk, so scoring the committed diff against it reports wrong line numbers
// whenever the tree is dirty (#508). Untracked files count as wholly added.
// On a clean tree (CI) the two are identical.
//
// Usage: node scripts/diff-coverage.mjs [--base <ref>] [--min <pct>] [--json]

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

const parseArgs = (argv) => {
  const args = { base: process.env.COVERAGE_DIFF_BASE || 'origin/main', min: 90, json: false }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--base') args.base = argv[(i += 1)]
    else if (argv[i] === '--min') args.min = Number(argv[(i += 1)])
    else if (argv[i] === '--json') args.json = true
  }
  if (process.env.COVERAGE_DIFF_MIN) args.min = Number(process.env.COVERAGE_DIFF_MIN)
  if (!Number.isFinite(args.min) || args.min < 0 || args.min > 100) {
    throw new Error(`--min must be a percentage between 0 and 100, got "${args.min}"`)
  }
  return args
}

const git = (cwd, ...gitArgs) =>
  execFileSync('git', gitArgs, { cwd, encoding: 'utf8', maxBuffer: 64 << 20 })

// Compare against the merge base, not the base tip: otherwise every line that
// landed on main after this branch forked is scored as if the branch wrote it.
export const resolveMergeBase = (base, cwd = process.cwd()) => {
  try {
    return git(cwd, 'merge-base', base, 'HEAD').trim()
  } catch {
    throw new Error(
      `Cannot resolve a merge base between "${base}" and HEAD. ` +
        `Fetch it first (git fetch origin main), or pass --base <ref>.`
    )
  }
}

// Added/modified lines on the new side of the diff, per file, comparing the
// merge base with the working tree. -U0 keeps hunks tight so context lines are
// not miscounted as changes; deletions carry no new-side line and are skipped
// by construction. Untracked files never appear in `git diff`, so they are
// listed separately and mapped to `null`, meaning every line is new.
export const changedLinesByFile = (mergeBase, cwd = process.cwd()) => {
  const out = git(cwd, 'diff', '--unified=0', '--no-color', '--diff-filter=d', mergeBase)
  const files = new Map()
  let current = null
  for (const line of out.split('\n')) {
    if (line.startsWith('+++ b/')) {
      current = line.slice('+++ b/'.length).trim()
      if (current === '/dev/null') current = null
      else if (!files.has(current)) files.set(current, new Set())
      continue
    }
    if (!current || !line.startsWith('@@')) continue
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line)
    if (!hunk) continue
    const start = Number(hunk[1])
    const count = hunk[2] === undefined ? 1 : Number(hunk[2])
    for (let n = start; n < start + count; n += 1) files.get(current).add(n)
  }
  const untracked = git(cwd, 'ls-files', '--others', '--exclude-standard', '-z')
  for (const path of untracked.split('\0')) {
    if (path && !files.has(path)) files.set(path, null)
  }
  return files
}

// A line is executable if some statement starts on it, and covered if any such
// statement was hit. Statements are keyed by id in `statementMap`, with hit
// counts in `s` under the same ids.
export const lineHitsForFile = (entry) => {
  const hits = new Map()
  for (const [id, loc] of Object.entries(entry.statementMap ?? {})) {
    const line = loc?.start?.line
    if (!line) continue
    const count = entry.s?.[id] ?? 0
    hits.set(line, (hits.get(line) ?? 0) + count)
  }
  return hits
}

// Executable changed lines for one instrumented file: `null` (untracked)
// means every statement-bearing line is new.
export const executableChangedLines = (lines, hits) => {
  const all = lines === null ? [...hits.keys()] : [...lines].filter((n) => hits.has(n))
  return all.sort((a, b) => a - b)
}

// Which uninstrumented changed files are worth naming. Docs, lockfiles and
// workflow YAML have no business in a coverage report; code does. `extension/**`
// is the case that motivated this: it is excluded from vitest's coverage
// `include`, so an extension-only PR scored zero lines and printed a pass.
const SOURCE_LIKE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/
// `.d.mts` and `.d.cts` are declarations too, and `SOURCE_LIKE` matches their tails.
const DECLARATION = /\.d\.(ts|mts|cts)$/
export const isSourceLike = (path) =>
  SOURCE_LIKE.test(path) &&
  !path.startsWith('tests/') &&
  !path.startsWith('e2e/') &&
  !path.startsWith('scripts/') &&
  !DECLARATION.test(path)

const main = async () => {
  const root = process.cwd()
  const coverageFinalPath = join(root, 'coverage', 'coverage-final.json')
  const args = parseArgs(process.argv.slice(2))

  if (!existsSync(coverageFinalPath)) {
    throw new Error(
      `Missing ${coverageFinalPath}. Run "pnpm test:coverage" before scoring diff coverage.`
    )
  }

  const coverage = JSON.parse(await readFile(coverageFinalPath, 'utf8'))
  const byRelPath = new Map()
  for (const [absPath, entry] of Object.entries(coverage)) {
    byRelPath.set(relative(root, entry.path ?? absPath).split('\\').join('/'), entry)
  }

  const mergeBase = resolveMergeBase(args.base)
  const changed = changedLinesByFile(mergeBase)

  const rows = []
  let covered = 0
  let total = 0

  // Changed source files vitest does not instrument. These are invisible to the
  // score, so they are collected and named rather than skipped in silence: a gate
  // that cannot fail on a file should say which file, or it reads as a pass over
  // work it never looked at (#684).
  const unscored = []

  for (const [path, lines] of [...changed].sort(([a], [b]) => a.localeCompare(b))) {
    const entry = byRelPath.get(path)
    if (!entry) {
      if (isSourceLike(path)) unscored.push(path)
      continue
    }
    const hits = lineHitsForFile(entry)
    const executable = executableChangedLines(lines, hits)
    if (executable.length === 0) continue
    const missed = executable.filter((n) => (hits.get(n) ?? 0) === 0)
    covered += executable.length - missed.length
    total += executable.length
    rows.push({ path, executable: executable.length, missed })
  }

  // `scored` is the honest distinction. A run with nothing to score is not a run
  // that scored 100%, and reporting it as one is what let #673 ship ~1,300 lines
  // of extension code behind a "PASS — 100.00%".
  const scored = total > 0
  const pct = scored ? (100 * covered) / total : null
  const passed = !scored || pct >= args.min

  if (args.json) {
    console.log(
      JSON.stringify(
        { mergeBase, min: args.min, covered, total, scored, pct, passed, unscored, rows },
        null,
        2
      )
    )
  } else {
    console.log(`Diff coverage vs ${args.base} (merge base ${mergeBase.slice(0, 9)})`)
    console.log('')
    if (rows.length === 0) {
      console.log('  No instrumented source lines changed.')
    } else {
      for (const row of rows) {
        const rowPct = (100 * (row.executable - row.missed.length)) / row.executable
        const mark = row.missed.length === 0 ? '✓' : '✗'
        console.log(`  ${mark} ${row.path}`)
        console.log(
          `      ${(row.executable - row.missed.length)}/${row.executable} lines (${rowPct.toFixed(1)}%)` +
            (row.missed.length ? `  uncovered: ${formatRanges(row.missed)}` : '')
        )
      }
      console.log('')
      console.log(`  Total: ${covered}/${total} changed lines covered (${pct.toFixed(2)}%)`)
    }

    if (unscored.length > 0) {
      console.log('')
      console.log(`  NOT SCORED — ${unscored.length} changed source file${unscored.length === 1 ? '' : 's'} vitest does not instrument:`)
      for (const path of unscored) console.log(`      ${path}`)
      console.log('      These lines are not in the number above and cannot fail this gate.')
    }

    console.log('')
    console.log(
      !scored
        ? 'NOT SCORED — no instrumented source lines changed, so this gate checked nothing.'
        : passed
          ? `PASS — diff coverage ${pct.toFixed(2)}% meets the ${args.min}% minimum.`
          : `FAIL — diff coverage ${pct.toFixed(2)}% is below the ${args.min}% minimum.`
    )
  }

  if (!passed) process.exitCode = 1
}

// Collapse consecutive line numbers so the uncovered list stays readable.
const formatRanges = (numbers) => {
  const ranges = []
  let start = numbers[0]
  let prev = numbers[0]
  for (const n of numbers.slice(1)) {
    if (n === prev + 1) {
      prev = n
      continue
    }
    ranges.push(start === prev ? `${start}` : `${start}-${prev}`)
    start = n
    prev = n
  }
  ranges.push(start === prev ? `${start}` : `${start}-${prev}`)
  return ranges.join(', ')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
