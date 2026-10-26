#!/usr/bin/env node
// Test reliability probe: asks whether the unit tests would fail if the lines a branch changed
// were wrong. Diff coverage shows that a changed line ran; this shows whether an assertion
// depends on it. Plan: docs/plans/2026-10-25-test-reliability-reviewer.md. How to read the
// output: "Test reliability probe" in docs/agents/testing.md.
//
// Usage: node scripts/test-reliability/cli.mjs [--base <ref>] [--max-mutants <n>]
//        [--budget <seconds>] [--no-revert] [--no-mutate] [--json] [--summary <file>]
//        [--annotations]
//
// Exit codes: 0 ran (findings are advisory), 2 could not run.

import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { collectChanges, isClean } from './lib/changes.mjs'
import { createBudget, mutationProbe, revertProbe } from './lib/probes.mjs'
import { renderAnnotations, renderJson, renderMarkdown } from './lib/report.mjs'
import { createRunner } from './lib/vitest.mjs'
import { checkJournal, createWorkspace } from './lib/workspace.mjs'

export const USAGE =
  'usage: test-reliability [--base <ref>] [--max-mutants <n>] [--budget <seconds>] ' +
  '[--no-revert] [--no-mutate] [--json] [--summary <file>] [--annotations]'

const positiveInteger = (flag, value) => {
  const number = Number(value)
  if (!Number.isInteger(number) || number < 1) {
    throw new Error(`${flag} needs a positive whole number, got "${value}"`)
  }
  return number
}

export const parseArgs = (argv) => {
  const options = {
    base: 'origin/main',
    maxMutants: 40,
    budgetSeconds: 900,
    revert: true,
    mutate: true,
    json: false,
    summary: null,
    annotations: false
  }
  const valued = new Set(['--base', '--max-mutants', '--budget', '--summary'])
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (valued.has(arg)) {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`)
      i++
      if (arg === '--base') options.base = value
      else if (arg === '--max-mutants') options.maxMutants = positiveInteger(arg, value)
      else if (arg === '--budget') options.budgetSeconds = positiveInteger(arg, value)
      else options.summary = value
    } else if (arg === '--no-revert') {
      options.revert = false
    } else if (arg === '--no-mutate') {
      options.mutate = false
    } else if (arg === '--json') {
      options.json = true
    } else if (arg === '--annotations') {
      options.annotations = true
    } else {
      throw new Error(`unknown argument "${arg}"\n${USAGE}`)
    }
  }
  return options
}

// The probe edits files the tests import and restores them afterwards. An interrupt between
// those two steps must still restore, so the handlers stop the running test process and put
// the files back before the process exits.
export const guardSignals = ({
  workspace,
  runner,
  on = process.on.bind(process),
  exit = process.exit
}) => {
  for (const [signal, code] of [
    ['SIGINT', 130],
    ['SIGTERM', 143]
  ]) {
    on(signal, () => {
      runner.stop()
      workspace.restore()
      exit(code)
    })
  }
}

// git, the disk, the test runner and the console are injectable so the tests drive main()
// without a repository. The defaults are the real thing.
export const main = async (argv, deps = {}) => {
  const {
    root = process.cwd(),
    git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20 }),
    read = (path) => readFileSync(join(root, path), 'utf8'),
    workspace = createWorkspace(root),
    runner = createRunner({ root, reportDir: join(root, '.cache/test-reliability/reports') }),
    onSignals = guardSignals,
    append = appendFileSync,
    now = Date.now,
    stdout = console.log,
    stderr = console.error
  } = deps

  let options
  let result
  try {
    options = parseArgs(argv)
    checkJournal(root)
    if (!isClean(git)) {
      throw new Error('the working tree has uncommitted changes; commit or set them aside first')
    }
    const changes = collectChanges({ git, base: options.base })
    const readBase = (path) => git(['show', `${changes.base}:${path}`])
    onSignals({ workspace, runner })
    const budget = createBudget({ budgetMs: options.budgetSeconds * 1000, now })
    const shared = { changes, read, workspace, run: runner.run, budget }
    result = {
      commit: git(['rev-parse', 'HEAD']).trim(),
      base: changes.base,
      e2e: changes.e2e.filter(({ status }) => status !== 'D'),
      revert: options.revert ? await revertProbe({ ...shared, readBase }) : null,
      mutation: options.mutate
        ? await mutationProbe({ ...shared, maxMutants: options.maxMutants })
        : null
    }
  } catch (error) {
    stderr(`test-reliability: ${error.message}`)
    return 2
  }

  const markdown = renderMarkdown(result)
  stdout(options.json ? renderJson(result) : markdown)
  if (options.summary) append(options.summary, markdown)
  if (options.annotations) for (const line of renderAnnotations(result)) stdout(line)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2))
}
