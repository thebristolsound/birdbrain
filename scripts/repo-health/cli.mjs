#!/usr/bin/env node
// Entry point for the repository health report: a handful of repository-level
// numbers (suppressions, unused code, deferred dependency decisions, plans with no
// status, broken links, skipped tests, coverage and red runs on main, branches
// left behind), each with a budget.
//
// Why this exists: the Health workflow watches the scheduled automation, and
// nothing watched the codebase. `pnpm knip` ran nowhere, 74 of 124 plans had no
// documented status, and all three audit exceptions shared one expiry date with
// nobody counting down. Decision: docs/adr/0058. Plan:
// docs/plans/2026-11-20-repo-health-report.md.
//
// The report is advisory. A signal outside its budget is something to look at, not
// a failed build, so a finding never changes the exit status. A signal that could
// not be read says "not measured" and counts with the ones outside their budget.
//
// Usage: node scripts/repo-health/cli.mjs [--json | --markdown] [--publish]
//
// It measures the whole working tree from any folder inside it.
//
// --publish keeps the one open `repo-health` issue up to date. It writes only when
// DRY_RUN is exactly `false`; anything else prints the writes it would make.
//
// Env in: GH_TOKEN or GITHUB_TOKEN and GITHUB_REPOSITORY for the signals that read
//         GitHub and for --publish; GITHUB_REPOSITORY_OWNER (the assignee), RUN_URL,
//         DRY_RUN, GITHUB_STEP_SUMMARY and GITHUB_ACTIONS under the workflow.
//
// Exit codes: 0 the report was produced, whatever it says; 2 could not run, or
// could not publish.

import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { gitInfo } from '../slop-audit/cli.mjs'
import { createReader, listTrackedFiles } from '../slop-audit/lib/files.mjs'
import { createGh, hasToken } from './lib/gh.mjs'
import { createKnipRunner } from './lib/knip.mjs'
import { publish } from './lib/publish.mjs'
import { buildReport, renderJson, renderMarkdown, renderText } from './lib/report.mjs'
import { SIGNALS, collect } from './lib/signals.mjs'

export const USAGE = 'usage: repo-health [--json | --markdown] [--publish]'

export const parseArgs = (argv) => {
  const options = { format: 'text', publish: false }
  for (const arg of argv) {
    if (arg === '--publish') {
      options.publish = true
    } else if (arg === '--json' || arg === '--markdown') {
      if (options.format !== 'text') throw new Error(`choose one output format\n${USAGE}`)
      options.format = arg.slice(2)
    } else {
      throw new Error(`unknown argument "${arg}"\n${USAGE}`)
    }
  }
  return options
}

const describeOutcome = (outcome) => {
  const lines = outcome.writes.map((write) => (outcome.dryRun ? `would ${write}` : `did ${write}`))
  if (outcome.dryRun) lines.push('dry run: nothing was written (DRY_RUN is not "false")')
  if (outcome.duplicates.length > 0) {
    lines.push(
      `more than one open repo-health issue; used #${outcome.issue}, ` +
        `ignored ${outcome.duplicates.map((number) => `#${number}`).join(', ')}`
    )
  }
  return lines
}

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

// Everything that touches git, the disk, knip, GitHub, the clock, the environment
// or the console is injectable so the tests drive main() without a repository.
// The defaults are the real thing.
export const main = (argv, deps = {}) => {
  const {
    cwd = process.cwd(),
    locate = repositoryRoot,
    env = process.env,
    signals = SIGNALS,
    listFiles = listTrackedFiles,
    info = gitInfo,
    gh = hasToken(env) ? createGh({ env }) : null,
    now = () => new Date(),
    appendFile = appendFileSync,
    stdout = console.log,
    stderr = console.error
  } = deps
  const log = (line) => stderr(`repo-health: ${line}`)

  let options
  let report
  try {
    options = parseArgs(argv)
    const root = locate(cwd)
    if (!root) throw new Error('could not find the top of the working tree')
    const read = deps.read ?? createReader(root)
    const knip = deps.knip ?? createKnipRunner({ root, env })
    const { commit, dirty } = info(root)
    const at = now()
    const measuredAt = at.toISOString()
    const ctx = {
      root,
      paths: listFiles(root),
      read,
      knip,
      gh,
      repo: env.GITHUB_REPOSITORY || null,
      now: at.getTime(),
      today: measuredAt.slice(0, 10),
      log
    }
    report = buildReport({ commit, dirty, measuredAt, results: collect({ signals, ctx, log }) })
  } catch (error) {
    log(error.message)
    return 2
  }

  let outcome = null
  if (options.publish) {
    try {
      if (!gh || !env.GITHUB_REPOSITORY) {
        throw new Error('--publish needs GH_TOKEN (or GITHUB_TOKEN) and GITHUB_REPOSITORY')
      }
      outcome = publish({
        gh,
        repo: env.GITHUB_REPOSITORY,
        owner: env.GITHUB_REPOSITORY_OWNER || null,
        report,
        runUrl: env.RUN_URL || null,
        dryRun: env.DRY_RUN !== 'false'
      })
    } catch (error) {
      log(`could not publish: ${error.message}`)
      return 2
    }
  }

  const compared = { state: outcome?.state ?? null, stateReason: outcome?.stateReason ?? null }
  if (options.format === 'text') stdout(renderText(report, compared.state))
  else if (options.format === 'json') stdout(renderJson(report))
  else stdout(renderMarkdown(report, { ...compared, runUrl: env.RUN_URL || null }))

  const outcomeLines = outcome ? describeOutcome(outcome) : []
  for (const line of outcomeLines) log(line)

  if (env.GITHUB_ACTIONS === 'true') {
    for (const signal of report.signals.filter((entry) => entry.status !== 'within')) {
      stdout(`::warning title=Repository health::${signal.label}: ${signal.status}`)
    }
  }
  if (env.GITHUB_STEP_SUMMARY) {
    const summary = renderMarkdown(report, { ...compared, runUrl: env.RUN_URL || null })
    const notes = outcomeLines.map((line) => `- ${line}`).join('\n')
    appendFile(env.GITHUB_STEP_SUMMARY, `${summary}\n${notes}\n`)
  }
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2))
}
