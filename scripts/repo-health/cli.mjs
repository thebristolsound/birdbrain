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
// Exit codes: 0 the report was produced, whatever it says; 2 could not run.

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

// Everything that touches git, the disk, knip, the clock or the console is
// injectable so the tests drive main() without a repository. The defaults are the
// real thing.
export const main = (argv, deps = {}) => {
  const {
    root = process.cwd(),
    signals = SIGNALS,
    listFiles = listTrackedFiles,
    info = gitInfo,
    read = createReader(root),
    knip = createKnipRunner({ root }),
    now = () => new Date(),
    stdout = console.log,
    stderr = console.error
  } = deps

  let options
  let report
  try {
    options = parseArgs(argv)
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
