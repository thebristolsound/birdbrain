// One-command verify loop for an agent PR, emitting the `## Verification`
// block the PR body carries (ADR-0018). The block is stamped with the HEAD sha
// it was measured at, so a reviewer can tell a fresh block from a stale one
// without re-deriving every number by hand (#978).
//
// Two refusals, checked before any step runs:
//   - a dirty working tree: the stamp must name a real commit, and on a clean
//     tree `coverage:diff`'s working-tree scoring (#508) equals the committed
//     diff CI measures;
//   - a Node major other than 20: Electron's postinstall breaks silently on
//     24, and a non-interactive shell does not activate mise (CLAUDE.md "Run
//     everything on Node 20").
// A block left by an earlier run is removed before either check, so a refusal
// never leaves an older block at the documented path to paste.
//
// Steps, in order. Every step runs even after an earlier failure, so a failing
// run still produces a complete, honest block (success-only emission would
// recreate the incentive to claim success):
//   pnpm lint
//   pnpm lint:boundaries
//   pnpm lint:agents-md      advisory: reports drift between the two files, never fails
//   pnpm typecheck
//   BIRDBRAIN_REQUIRE_OPENSSL=1 pnpm test
//   pnpm build
//   pnpm build:extension      only when the diff against the base touches extension/
//   pnpm test:coverage
//   pnpm coverage:diff        run as `node scripts/diff-coverage.mjs --json --base <merge-base sha>`
//
// COVERAGE_DIFF_MIN is stripped from the child environment: preflight is the
// local equivalent of CI's 90% diff-coverage gate, so the floor is not negotiable.
//
// The block is written to .preflight/verification.md (gitignored) and belongs
// in the PR body only: a committed block moves HEAD and is stale by construction.
//
// Usage: node scripts/preflight.mjs [--base <ref>] [--out <path>]

import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const BLOCK_VERSION = 1
export const REQUIRED_NODE_MAJOR = 20
export const DEFAULT_OUT = join('.preflight', 'verification.md')

const parseArgs = (argv) => {
  const args = { base: process.env.COVERAGE_DIFF_BASE || 'origin/main', out: DEFAULT_OUT }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--base') args.base = argv[(i += 1)]
    else if (argv[i] === '--out') args.out = argv[(i += 1)]
    else
      throw new Error(
        `Unknown argument "${argv[i]}". Usage: preflight [--base <ref>] [--out <path>]`
      )
  }
  return args
}

const git = (cwd, ...gitArgs) => execFileSync('git', gitArgs, { cwd, encoding: 'utf8' })

// Each precondition returns a message or null, so it is testable without
// changing the running Node or the repository the tests live in.
export const nodeVersionProblem = (version) => {
  const major = Number(version.split('.')[0])
  if (major === REQUIRED_NODE_MAJOR) return null
  return (
    `Node v${version} is not the pinned ${REQUIRED_NODE_MAJOR}.x. .nvmrc and .mise.toml pin it, ` +
    'but a non-interactive shell does not activate mise; run `mise exec -- pnpm preflight` ' +
    'or `nvm use` first (CLAUDE.md "Run everything on Node 20").'
  )
}

export const dirtyTreeProblem = (cwd = process.cwd()) => {
  // trimEnd only: the leading column is porcelain's index status (" M" vs "M ").
  const status = git(cwd, 'status', '--porcelain').trimEnd()
  if (!status.trim()) return null
  return (
    'the working tree is dirty; commit or drop these first so the block names a real commit:\n' +
    status
  )
}

export const touchesExtension = (paths) => paths.some((path) => path.startsWith('extension/'))

// The environment every step runs under. COVERAGE_DIFF_MIN is dropped because
// diff-coverage.mjs reads it after its arguments and would lower the floor.
export const childEnv = (parent) => {
  const env = { ...parent, BIRDBRAIN_REQUIRE_OPENSSL: '1' }
  delete env.COVERAGE_DIFF_MIN
  return env
}

// Vitest's closing summary line, e.g. "      Tests  2094 passed | 3 skipped (2097)".
export const parseVitestSummary = (output) => {
  const match = /^\s*Tests\s+(.+?)\s+\((\d+)\)\s*$/m.exec(output)
  if (!match) return null
  return { summary: match[1].replace(/\s*\|\s*/g, ', '), total: Number(match[2]) }
}

// The `--json` document scripts/diff-coverage.mjs prints, reduced to one line.
export const summarizeDiffCoverage = (result) => {
  const unscored =
    result.unscored?.length > 0
      ? `; ${result.unscored.length} changed source file${result.unscored.length === 1 ? '' : 's'} not instrumented`
      : ''
  if (!result.scored) return `not scored, no instrumented source lines changed${unscored}`
  return (
    `${result.pct.toFixed(2)}% of ${result.total} changed lines covered (floor ${result.min}%)` +
    unscored
  )
}

export const formatVerificationBlock = ({ sha, nodeVersion, base, mergeBase, steps }) => {
  const status = steps.some((step) => step.status === 'fail') ? 'fail' : 'pass'
  const lines = [
    `<!-- preflight v${BLOCK_VERSION} sha=${sha} status=${status} -->`,
    '## Verification',
    '',
    `\`pnpm preflight\` at \`${sha}\` on Node v${nodeVersion}; diff scored against ` +
      `\`${base}\` (merge base \`${mergeBase.slice(0, 9)}\`). Result: **${status}**.`,
    ''
  ]
  for (const step of steps) {
    const result = step.status === 'skipped' ? 'skipped' : `${step.status} (exit ${step.exitCode})`
    lines.push(`- \`${step.command}\` - ${result}${step.detail ? ` - ${step.detail}` : ''}`)
  }
  return lines.join('\n') + '\n'
}

// lint:agents-md is advisory and always exits 0, so the row would otherwise read
// a bare pass whether or not the two files drifted. Report what it found.
const describeAgentsMd = (output) => {
  const prefix = 'lint:agents-md: '
  const line = output.split('\n').find((candidate) => candidate.startsWith(prefix))
  return line ? line.slice(prefix.length) : 'no lint:agents-md summary found in output'
}

const describeVitest = (output) => {
  const parsed = parseVitestSummary(output)
  return parsed ? `${parsed.summary} (${parsed.total})` : 'no Vitest summary found in output'
}

const describeCoverage = (output, exitCode) => {
  const misses = output.match(/Coverage for .+ does not meet .+/g) ?? []
  const thresholds =
    exitCode === 0
      ? 'thresholds met'
      : misses.length > 0
        ? `${misses.length} threshold${misses.length === 1 ? '' : 's'} not met`
        : 'failed before thresholds were evaluated'
  return `${describeVitest(output)}, ${thresholds}`
}

const describeDiffCoverage = (output) => {
  const start = output.indexOf('{')
  if (start !== -1) {
    try {
      return summarizeDiffCoverage(JSON.parse(output.slice(start)))
    } catch {
      // Fall through to the first line of whatever it printed instead.
    }
  }
  return output.trim().split('\n')[0] || 'no output'
}

// Stream the child's output to the terminal and keep a copy for the summary.
const runStep = (command, args, { cwd, env }) =>
  new Promise((settle) => {
    // Corepack's Windows pnpm is a .cmd shim, which Node only spawns through a
    // shell (audit-check.mjs does the same). The arguments are fixed literals.
    const shell = command === 'pnpm' && process.platform === 'win32'
    const child = spawn(command, args, { cwd, env, shell, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    const tee = (stream, sink) => {
      stream.on('data', (chunk) => {
        output += chunk
        sink.write(chunk)
      })
    }
    tee(child.stdout, process.stdout)
    tee(child.stderr, process.stderr)
    child.on('error', (error) => settle({ exitCode: 1, output: `${output}${error.message}\n` }))
    child.on('close', (code) => settle({ exitCode: code ?? 1, output }))
  })

const main = async () => {
  const cwd = process.cwd()
  const args = parseArgs(process.argv.slice(2))
  const outPath = resolve(cwd, args.out)
  const nodeVersion = process.versions.node

  // Clear any earlier block first: a refusal must not leave a pasteable block
  // for a sha this run never checked.
  rmSync(outPath, { force: true })

  const problems = [dirtyTreeProblem(cwd), nodeVersionProblem(nodeVersion)].filter(Boolean)
  if (problems.length > 0) {
    for (const problem of problems) console.error(`preflight: refusing to run, ${problem}`)
    process.exitCode = 2
    return
  }

  const sha = git(cwd, 'rev-parse', 'HEAD').trim()
  let mergeBase
  try {
    mergeBase = git(cwd, 'merge-base', args.base, 'HEAD').trim()
  } catch {
    throw new Error(
      `Cannot resolve a merge base between "${args.base}" and HEAD. ` +
        'Fetch it first (git fetch origin main), or pass --base <ref>.'
    )
  }
  const changed = git(cwd, 'diff', '--name-only', mergeBase, 'HEAD').split('\n').filter(Boolean)
  const env = childEnv(process.env)
  const steps = []

  const run = async (command, argv, display, describe) => {
    console.log(`\npreflight: ${display}`)
    const { exitCode, output } = await runStep(command, argv, { cwd, env })
    steps.push({
      command: display,
      status: exitCode === 0 ? 'pass' : 'fail',
      exitCode,
      detail: describe ? describe(output, exitCode) : undefined
    })
  }

  await run('pnpm', ['lint'], 'pnpm lint')
  await run('pnpm', ['lint:boundaries'], 'pnpm lint:boundaries')
  await run('pnpm', ['lint:agents-md'], 'pnpm lint:agents-md', describeAgentsMd)
  await run('pnpm', ['typecheck'], 'pnpm typecheck')
  await run('pnpm', ['test'], 'BIRDBRAIN_REQUIRE_OPENSSL=1 pnpm test', describeVitest)
  await run('pnpm', ['build'], 'pnpm build')
  if (touchesExtension(changed)) {
    await run('pnpm', ['build:extension'], 'pnpm build:extension')
  } else {
    steps.push({
      command: 'pnpm build:extension',
      status: 'skipped',
      detail: 'no extension/ changes'
    })
  }
  await run('pnpm', ['test:coverage'], 'pnpm test:coverage', describeCoverage)
  // The resolved sha, not the ref: origin/main can move while the steps run
  // (another worktree's fetch), and the block names this merge base.
  await run(
    process.execPath,
    [join('scripts', 'diff-coverage.mjs'), '--json', '--base', mergeBase],
    'pnpm coverage:diff',
    describeDiffCoverage
  )

  // The stamp is only honest if nothing moved HEAD or dirtied the tree while
  // the steps ran (builds write to gitignored directories only).
  const headNow = git(cwd, 'rev-parse', 'HEAD').trim()
  const dirtyNow = dirtyTreeProblem(cwd)
  if (headNow !== sha || dirtyNow) {
    throw new Error(
      headNow !== sha
        ? `HEAD moved from ${sha} to ${headNow} during preflight; the block would be stale.`
        : `preflight left ${dirtyNow}`
    )
  }

  const block = formatVerificationBlock({ sha, nodeVersion, base: args.base, mergeBase, steps })
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, block)
  console.log(`\n${block}`)
  console.log(
    `preflight: block written to ${args.out}; paste it as the PR body's Verification section.`
  )
  if (steps.some((step) => step.status === 'fail')) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`preflight: ${error.message}`)
    process.exitCode = 1
  })
}
