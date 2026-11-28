// Runs knip once and counts its findings for the health report.
//
// knip is configured in knip.jsonc and gated nowhere, so its counts are a number
// to watch, not a failure. It exits 1 whenever it finds anything, which is every
// run today, so exit 1 is a report. It exits 2 when a configuration failed to load
// or a promise was left unhandled, and it does so after printing its report, so a
// report under exit 2 is not trusted.

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Unmeasured } from './unmeasured.mjs'

const BINARY = 'node_modules/.bin/knip'
// knip takes a few seconds here. A run that has not finished in two minutes is
// stuck, and the report must not wait on it.
export const KNIP_TIMEOUT_MS = 120_000

// The workflow's token is in the environment for the signals that read GitHub.
// knip loads the Vite, Vitest and Playwright configurations, which is code that
// has no use for it.
const TOKEN_NAMES = ['GH_TOKEN', 'GITHUB_TOKEN']
const withoutTokens = (env) =>
  Object.fromEntries(Object.entries(env).filter(([name]) => !TOKEN_NAMES.includes(name)))

export const parseKnipReport = (stdout) => {
  let report
  try {
    report = JSON.parse(stdout)
  } catch {
    throw new Unmeasured('knip printed no JSON report')
  }
  if (!Array.isArray(report?.issues)) throw new Unmeasured('knip report has no issues list')
  return report
}

// Sums one or more finding kinds over every file in the report. A kind that is
// missing or not a list means knip changed its report, and a renamed key must not
// read as "nothing unused".
export const countIssues = (report, kinds) => {
  let total = 0
  for (const issue of report.issues) {
    for (const kind of kinds) {
      if (!Array.isArray(issue?.[kind])) {
        throw new Unmeasured(`knip report has no "${kind}" list`)
      }
      total += issue[kind].length
    }
  }
  return total
}

// Returns a function that runs knip on first use and hands every later caller the
// same report, or the same failure.
export const createKnipRunner = ({ root, spawn = spawnSync, exists = existsSync, env }) => {
  let outcome = null
  const run = () => {
    if (!exists(join(root, BINARY))) throw new Unmeasured('knip is not installed')
    const result = spawn(join(root, BINARY), ['--reporter', 'json', '--no-progress'], {
      cwd: root,
      encoding: 'utf8',
      env: withoutTokens(env ?? process.env),
      maxBuffer: 64 * 1024 * 1024,
      timeout: KNIP_TIMEOUT_MS
    })
    if (result.error?.code === 'ETIMEDOUT') throw new Unmeasured('knip did not finish in time')
    if (result.error?.code === 'ENOBUFS') throw new Unmeasured('knip printed more than 64 MiB')
    if (result.error) throw new Unmeasured('knip could not be started')
    if (result.status !== 0 && result.status !== 1) {
      throw new Unmeasured(`knip reported an error (exit status ${result.status})`)
    }
    return parseKnipReport(result.stdout)
  }
  return () => {
    if (outcome === null) {
      try {
        outcome = { report: run() }
      } catch (error) {
        outcome = { error }
      }
    }
    if (outcome.error) throw outcome.error
    return outcome.report
  }
}
