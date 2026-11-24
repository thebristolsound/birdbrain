#!/usr/bin/env node
// Entry point for the repository health report: a handful of repository-level
// numbers (suppressions, unused code, deferred dependency decisions, plans with no
// status, broken links, skipped tests), each with a budget.
//
// Why this exists: the Health workflow watches the scheduled automation, and
// nothing watched the codebase. `pnpm knip` ran nowhere, 74 of 124 plans had no
// documented status, and all three audit exceptions shared one expiry date with
// nobody counting down. Plan: docs/plans/2026-11-20-repo-health-report.md.
//
// The report is advisory. A signal outside its budget is something to look at, not
// a failed build, so a finding never changes the exit status. A signal that could
// not be read says "not measured" and counts with the ones outside their budget.
//
// Usage: node scripts/repo-health/cli.mjs [--json | --markdown]
//
// It measures the whole working tree from any folder inside it.
//
// Exit codes: 0 the report was produced, whatever it says; 2 could not run.

import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { gitInfo } from '../slop-audit/cli.mjs'
import { createReader, listTrackedFiles } from '../slop-audit/lib/files.mjs'
import { createKnipRunner } from './lib/knip.mjs'
import { buildReport, renderJson, renderMarkdown, renderText } from './lib/report.mjs'
import { SIGNALS, collect } from './lib/signals.mjs'

export const USAGE = 'usage: repo-health [--json | --markdown]'

export const parseArgs = (argv) => {
  const options = { format: 'text' }
  for (const arg of argv) {
    if (arg !== '--json' && arg !== '--markdown') {
      throw new Error(`unknown argument "${arg}"\n${USAGE}`)
    }
    if (options.format !== 'text') throw new Error(`choose one output format\n${USAGE}`)
    options.format = arg.slice(2)
  }
  return options
}

const RENDERERS = { text: renderText, json: renderJson, markdown: renderMarkdown }

// The top of the working tree that holds `cwd`. `git ls-files` lists only the
// folder it runs in, so a report taken from `src/` would see part of the code,
// find nothing to count in the rest, and show that as a small number. The report
// is always measured from here, wherever the command was typed.
export const repositoryRoot = (cwd) =>
  execFileSync('git', ['rev-parse', '--show-toplevel'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  }).trim()

// Everything that touches git, the disk, knip, the clock or the console is
// injectable so the tests drive main() without a repository. The defaults are the
// real thing.
export const main = (argv, deps = {}) => {
  const {
    cwd = process.cwd(),
    locate = repositoryRoot,
    signals = SIGNALS,
    listFiles = listTrackedFiles,
    info = gitInfo,
    now = () => new Date(),
    stdout = console.log,
    stderr = console.error
  } = deps

  let options
  let report
  try {
    options = parseArgs(argv)
    const root = locate(cwd)
    if (!root) throw new Error('could not find the top of the working tree')
    const read = deps.read ?? createReader(root)
    const knip = deps.knip ?? createKnipRunner({ root })
    const { commit, dirty } = info(root)
    const measuredAt = now().toISOString()
    const ctx = { root, paths: listFiles(root), read, knip, today: measuredAt.slice(0, 10) }
    const results = collect({ signals, ctx, log: (line) => stderr(`repo-health: ${line}`) })
    report = buildReport({ commit, dirty, measuredAt, results })
  } catch (error) {
    stderr(`repo-health: ${error.message}`)
    return 2
  }

  stdout(RENDERERS[options.format](report))
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2))
}
