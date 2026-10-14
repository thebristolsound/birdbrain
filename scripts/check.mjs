// Diff-scoped checks for work in progress: runs only the checks the working
// tree's changes reach, in parallel, and prints one summary.
//
// preflight is the gate and refuses a dirty tree, so between edits the only
// alternative was remembering which of lint, typecheck, tests, boundaries and
// Vale apply, and how to run each correctly. This reads the working tree
// (staged, unstaged and untracked) against the merge base and maps it:
//
//   changed code files       eslint on those files; Vitest `related` on them;
//   or .prettierrc           pnpm format:check, the whole tree (about ten seconds, and
//                            its globs live only in that script)
//   eslint.config.js         pnpm lint, the whole repository
//   any TS file, tsconfig,   every project in the `typecheck` script, in parallel
//   package.json or lockfile (all six together take about as long as the slowest,
//                            so selecting projects would save little)
//   code under the graph,    pnpm lint:boundaries
//   or the cruise's config
//   Markdown                 vale-prose --base, changed lines only
//   docs/adr/                lint:adr
//   CLAUDE.md or AGENTS.md   lint:agents-md, advisory; drift shows as a warning
//
// Vitest runs the whole suite instead of `related` when its config, its setup
// files, the lockfile or a non-code file under tests/ changed, or when a code
// file was deleted or renamed. `related` follows imports, so it cannot find a
// test that still imports a file that is gone, or one that reads a fixture
// from disk.
//
// Build, the extension build, coverage thresholds and diff coverage are left to
// preflight; the summary says so rather than implying a full verify.
//
// Usage: node scripts/check.mjs [--base <ref>] [--dry-run]

import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  childEnv,
  describeAgentsMd,
  describeVale,
  nodeVersionProblem,
  parseVitestSummary
} from './preflight.mjs'

export const DEFAULT_OUT = join('.preflight', 'check.md')

const CODE_FILE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/
const TS_FILE = /\.(ts|tsx|mts|cts)$/
const PROSE_FILE = /\.(md|mdx)$/
const TSCONFIG = /(^|\/)tsconfig[^/]*\.json$/
const LINT_CONFIG = /^eslint\.config\.[cm]?[jt]s$/
const FORMAT_CONFIG = ['.prettierrc', 'package.json']
const DEPENDENCY_METADATA = ['package.json', 'pnpm-lock.yaml']
// tsconfig.boundaries.json is dependency-cruiser's alias map, and it extends tsconfig.json.
const BOUNDARY_CONFIG = ['.dependency-cruiser.cjs', 'tsconfig.boundaries.json', 'tsconfig.json']
const TEST_ROOTS = ['src/', 'tests/', 'extension/', 'scripts/', 'e2e/']
const GRAPH_ROOTS = ['src/', 'extension/src/', 'tests/', 'e2e/']
const WHOLE_SUITE_INPUTS = [/^vitest\.config\.ts$/, /^tests\/setup\//, /^pnpm-lock\.yaml$/]
const isWholeSuiteInput = (path) =>
  WHOLE_SUITE_INPUTS.some((pattern) => pattern.test(path)) ||
  (path.startsWith('tests/') && !CODE_FILE.test(path))

// Package binaries run from their entry points under Node, not through pnpm: Windows pnpm needs
// a shell, and the shell would parse the changed paths these checks take (see runCheck).
const ESLINT = join('node_modules', 'eslint', 'bin', 'eslint.js')
const TSC = join('node_modules', 'typescript', 'bin', 'tsc')
const ELECTRON = join('node_modules', 'electron', 'cli.js')

export const LEFT_TO_PREFLIGHT = 'build, extension build, coverage thresholds, diff coverage'

const parseArgs = (argv) => {
  const args = { base: process.env.COVERAGE_DIFF_BASE || 'origin/main', dryRun: false }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--base') args.base = argv[(i += 1)]
    else if (argv[i] === '--dry-run') args.dryRun = true
    else throw new Error(`Unknown argument "${argv[i]}". Usage: check [--base <ref>] [--dry-run]`)
  }
  return args
}

const git = (cwd, ...gitArgs) =>
  execFileSync('git', gitArgs, { cwd, encoding: 'utf8', maxBuffer: 64 << 20 })

// `git diff --name-status -z` output plus `git ls-files -z` output, as one list.
// -z keeps paths with spaces or non-ASCII bytes unquoted.
export const parseChanges = (nameStatus, untracked) => {
  const changes = []
  const fields = nameStatus.split('\0')
  for (let i = 0; i + 1 < fields.length; i += 2) {
    if (fields[i]) changes.push({ path: fields[i + 1], deleted: fields[i] === 'D' })
  }
  for (const path of untracked.split('\0').filter(Boolean)) changes.push({ path, deleted: false })
  return changes
}

// The projects `pnpm typecheck` runs, read from the script so this list cannot drift from it.
export const typecheckProjects = (script) => {
  const projects = [...(script ?? '').matchAll(/(?:^|\s)-p\s+(\S+)/g)].map((match) => match[1])
  if (projects.length === 0)
    throw new Error(`no "-p <project>" found in typecheck script "${script}"`)
  return projects
}

const plural = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`

export const planChecks = (changes, { mergeBase, projects }) => {
  const present = changes.filter((change) => !change.deleted).map((change) => change.path)
  const all = changes.map((change) => change.path)
  const code = present.filter((path) => CODE_FILE.test(path))
  const checks = []

  // The repository ignores *.config.js, so linting only the changed config would check nothing.
  const lintConfig = all.find((path) => LINT_CONFIG.test(path))
  if (lintConfig) {
    checks.push({
      name: 'lint',
      scope: `whole repository, ${lintConfig} changed`,
      command: 'pnpm',
      args: ['lint']
    })
  } else if (code.length > 0) {
    checks.push({
      name: 'lint',
      scope: plural(code.length, 'file'),
      command: 'node',
      args: [ESLINT, '--no-warn-ignored', ...code]
    })
  }

  if (code.length > 0 || all.some((path) => FORMAT_CONFIG.includes(path))) {
    checks.push({ name: 'format', scope: 'whole tree', command: 'pnpm', args: ['format:check'] })
  }

  if (
    all.some(
      (path) => TS_FILE.test(path) || TSCONFIG.test(path) || DEPENDENCY_METADATA.includes(path)
    )
  ) {
    for (const project of projects) {
      checks.push({
        name: `typecheck ${project}`,
        command: 'node',
        args: [TSC, '--noEmit', '-p', project]
      })
    }
  }

  const deletedCode = changes.filter((change) => change.deleted && CODE_FILE.test(change.path))
  const suiteInput = all.find(isWholeSuiteInput)
  const testable = code.filter((path) => TEST_ROOTS.some((root) => path.startsWith(root)))
  const vitest = [ELECTRON, './node_modules/vitest/vitest.mjs']
  if (suiteInput || deletedCode.length > 0) {
    checks.push({
      name: 'test',
      scope: suiteInput
        ? `whole suite, ${suiteInput} changed`
        : `whole suite, ${deletedCode[0].path} was deleted or renamed`,
      command: 'node',
      args: [...vitest, 'run'],
      describe: describeVitest
    })
  } else if (testable.length > 0) {
    checks.push({
      name: 'test',
      scope: `related to ${plural(testable.length, 'file')}`,
      command: 'node',
      args: [...vitest, 'related', '--run', '--passWithNoTests', ...testable],
      describe: describeVitest
    })
  }

  if (
    all.some(
      (path) =>
        BOUNDARY_CONFIG.includes(path) ||
        (CODE_FILE.test(path) && GRAPH_ROOTS.some((root) => path.startsWith(root)))
    )
  ) {
    checks.push({ name: 'boundaries', command: 'pnpm', args: ['lint:boundaries'] })
  }

  if (present.some((path) => PROSE_FILE.test(path))) {
    checks.push({
      name: 'prose',
      command: 'bash',
      args: [join('.claude', 'hooks', 'vale-prose.sh'), '--base', mergeBase],
      describe: describeVale
    })
  }

  if (all.some((path) => path.startsWith('docs/adr/'))) {
    checks.push({ name: 'adr numbers', command: 'pnpm', args: ['lint:adr'] })
  }

  if (all.some((path) => path === 'CLAUDE.md' || path === 'AGENTS.md')) {
    checks.push({
      name: 'agents-md',
      scope: 'advisory',
      command: 'pnpm',
      args: ['lint:agents-md'],
      advisory: true,
      describe: describeAgentsMd,
      // It exits 0 on drift as well, so any summary but a match is the warning.
      warns: (output) => !/^lint:agents-md: .* match$/m.test(output)
    })
  }

  return checks
}

// The addon scripts/build-test-sharp.mjs builds, at the path tests/setup/system-sharp.ts loads.
export const systemSharpAddon = (cwd, arch) => {
  const sharpPackage = join(cwd, 'node_modules', 'sharp', 'package.json')
  if (!existsSync(sharpPackage)) return null
  const { version } = JSON.parse(readFileSync(sharpPackage, 'utf8'))
  return join(
    cwd,
    '.cache',
    'test-sharp',
    'sharp',
    'src',
    'build',
    'Release',
    `sharp-linux-${arch}-${version}.node`
  )
}

// Sharp-using tests SIGSEGV under Electron on some Linux systems unless they get the system
// build (docs/agents/testing.md). Someone who built it wants it, so turn it on when it exists
// and the variable is unset; an explicit value, including 0, is left alone.
export const testEnv = (env, { cwd, platform, arch }) => {
  const next = { ...childEnv(env), ELECTRON_RUN_AS_NODE: '1' }
  if (platform !== 'linux' || env.BIRDBRAIN_TEST_SYSTEM_SHARP !== undefined) return next
  const addon = systemSharpAddon(cwd, arch)
  if (addon && existsSync(addon)) next.BIRDBRAIN_TEST_SYSTEM_SHARP = '1'
  return next
}

const describeVitest = (output) => {
  const parsed = parseVitestSummary(output)
  if (parsed) return `${parsed.summary} (${parsed.total})`
  return /No test files found/.test(output) ? 'no test imports the changed files' : undefined
}

const label = (check) => (check.scope ? `${check.name} (${check.scope})` : check.name)

const statusOf = ({ exitCode, advisory, warning }) => {
  if (exitCode !== 0) return advisory ? 'warn' : 'FAIL'
  return warning ? 'warn' : 'pass'
}

export const formatSummary = ({ base, mergeBase, changedCount, results }) => {
  const width = Math.max(...results.map((result) => label(result).length))
  const lines = [
    `check: ${plural(results.length, 'check')} for ${plural(changedCount, 'changed file')} ` +
      `since ${base} (merge base ${mergeBase.slice(0, 9)})`
  ]
  for (const result of results) {
    const status = statusOf(result)
    const timing = `exit ${result.exitCode}  ${(result.ms / 1000).toFixed(1)}s`
    const detail = result.detail ? `  ${result.detail}` : ''
    lines.push(`  ${status}  ${label(result).padEnd(width)}  ${timing}${detail}`)
  }
  lines.push(`check: not run here, left to pnpm preflight: ${LEFT_TO_PREFLIGHT}`)
  return lines.join('\n') + '\n'
}

const runCheck = (check, { cwd, env }) =>
  new Promise((settle) => {
    const started = Date.now()
    // Corepack's Windows pnpm is a .cmd shim, which Node only spawns through a shell. Every pnpm
    // check runs a package script with fixed arguments; changed paths only reach the Node checks.
    const shell = check.command === 'pnpm' && process.platform === 'win32'
    const command = check.command === 'node' ? process.execPath : check.command
    const child = spawn(command, check.args, {
      cwd,
      env: check.env ?? env,
      shell,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let output = ''
    child.stdout.on('data', (chunk) => (output += chunk))
    child.stderr.on('data', (chunk) => (output += chunk))
    const finish = (exitCode) => {
      const ms = Date.now() - started
      const detail = check.describe?.(output)
      const warning = check.warns?.(output) ?? false
      settle({ ...check, exitCode, output, ms, detail, warning })
    }
    child.on('error', (error) => {
      output += `${error.message}\n`
      finish(1)
    })
    child.on('close', (code) => finish(code ?? 1))
  })

const main = async () => {
  const cwd = process.cwd()
  const args = parseArgs(process.argv.slice(2))
  const outPath = resolve(cwd, DEFAULT_OUT)

  // Clear the last summary first: a run that writes none must not leave one that looks current.
  rmSync(outPath, { force: true })

  let mergeBase
  try {
    mergeBase = git(cwd, 'merge-base', args.base, 'HEAD').trim()
  } catch {
    throw new Error(
      `Cannot resolve a merge base between "${args.base}" and HEAD. ` +
        'Fetch it first (git fetch origin main), or pass --base <ref>.'
    )
  }
  const changes = parseChanges(
    git(cwd, 'diff', '--name-status', '--no-renames', '-z', mergeBase),
    git(cwd, 'ls-files', '--others', '--exclude-standard', '-z')
  )
  if (changes.length === 0) {
    console.log(`check: nothing changed since ${args.base} (merge base ${mergeBase.slice(0, 9)})`)
    return
  }

  const { scripts } = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'))
  const checks = planChecks(changes, { mergeBase, projects: typecheckProjects(scripts?.typecheck) })

  if (args.dryRun) {
    console.log(`check: ${plural(changes.length, 'changed file')}; would run:`)
    for (const check of checks)
      console.log(`  ${label(check)}: ${check.command} ${check.args.join(' ')}`)
    console.log(`check: not run here, left to pnpm preflight: ${LEFT_TO_PREFLIGHT}`)
    return
  }

  const versionProblem = nodeVersionProblem(process.versions.node)
  if (versionProblem) {
    console.error(`check: refusing to run, ${versionProblem}`)
    process.exitCode = 2
    return
  }

  const env = childEnv(process.env)
  const vitestEnv = testEnv(process.env, { cwd, platform: process.platform, arch: process.arch })
  if (vitestEnv.BIRDBRAIN_TEST_SYSTEM_SHARP === '1' && !process.env.BIRDBRAIN_TEST_SYSTEM_SHARP) {
    console.log('check: using the system sharp build for tests (BIRDBRAIN_TEST_SYSTEM_SHARP=1)')
  }
  for (const check of checks) if (check.name === 'test') check.env = vitestEnv

  console.log(`check: running ${checks.map(label).join(', ')}`)
  const results = await Promise.all(
    checks.map((check) =>
      runCheck(check, { cwd, env }).then((result) => {
        console.log(`check: finished ${label(result)}, exit ${result.exitCode}`)
        return result
      })
    )
  )

  const failures = results.filter((result) => result.exitCode !== 0)
  const sections = results
    .filter((result) => result.exitCode !== 0 || result.warning)
    .map((result) => `--- ${label(result)} ---\n${result.output.trimEnd()}\n`)
  const summary = formatSummary({
    base: args.base,
    mergeBase,
    changedCount: changes.length,
    results
  })
  for (const section of sections) console.log(`\n${section}`)
  console.log(`\n${summary}`)

  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, [summary, ...sections].join('\n'))
  console.log(`check: summary written to ${DEFAULT_OUT}; it is not a Verification block.`)
  if (failures.some((result) => !result.advisory)) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`check: ${error.message}`)
    process.exitCode = 1
  })
}
