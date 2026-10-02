#!/usr/bin/env node
// Enforcing dependency-advisory gate for the dependency tree in this repo.
//
// `pnpm audit --audit-level high` on its own can only be all-or-nothing: either it
// fails on advisories nobody can act on today, or it is run with `|| true` and stops
// catching regressions. This wraps it so an advisory can be accepted *individually*,
// with a recorded reason and an expiry date, and everything else still fails the
// build. Exceptions live in audit-exceptions.json.
//
// Runs from the lockfiles alone — the Security workflow never installs.
//
// Exit codes: 0 clean, 1 policy violation, 2 could not run the audit.

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// Severities that fail the build unless individually excepted. Advisories below
// this line are reported by `pnpm audit` but are not a merge gate.
export const BLOCKING_SEVERITIES = ['critical', 'high']

// The docs site under website/ is plain content served by Mintlify and has no
// dependency tree of its own since the Fumadocs app was removed.
export const TREES = ['.']

const REQUIRED_FIELDS = ['ghsa', 'package', 'tree', 'path', 'reason', 'expires']
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const DAY_MS = 24 * 60 * 60 * 1000

// An exception is a deferral, not a decision to live with something forever, so
// cap how far out one can be written. Beyond this the entry is a violation, not
// a long lease.
export const MAX_EXCEPTION_DAYS = 180

// Lead time before an expiry, so the date arrives as a warning on some earlier
// PR rather than as a surprise failure on an unrelated one.
export const EXPIRY_WARNING_DAYS = 21

const SEVERITY_RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 }

// Turns YYYY-MM-DD into epoch ms, rejecting anything that is not that exact
// calendar day. The round-trip is what catches 2026-02-30, which Date.parse
// silently rolls forward to 2026-03-02.
export const parseIsoDay = (value) => {
  if (!DATE_PATTERN.test(value)) return null
  const ms = Date.parse(`${value}T00:00:00Z`)
  if (Number.isNaN(ms)) return null
  return new Date(ms).toISOString().slice(0, 10) === value ? ms : null
}

// Flattens one `pnpm audit --json` report into one row per (advisory, package,
// tree). pnpm reports the same advisory once per affected version range, so the
// same GHSA can appear more than once with different paths; those collapse,
// because an exception is a decision about the advisory in that tree, not about
// a range. The package is part of the key even though a GHSA usually names one:
// the exception matcher identifies a finding by ghsa+tree+package, and a
// collector that identified it by less would let an exception for one package
// silently cover another. Severity takes the highest seen for the same reason.
// The key separator is `|`, which is illegal in an npm package name and absent
// from a GHSA id, so no two distinct pairs can collide on one key.
export const collectFindings = (report, tree) => {
  const byId = new Map()
  for (const advisory of Object.values(report?.advisories ?? {})) {
    const ghsa = String(advisory.github_advisory_id ?? advisory.id)
    const paths = (advisory.findings ?? []).flatMap((finding) => finding.paths ?? [])
    const key = `${ghsa}|${advisory.module_name}`
    const existing = byId.get(key)
    if (existing) {
      existing.paths = [...new Set([...existing.paths, ...paths])]
      if ((SEVERITY_RANK[advisory.severity] ?? 0) > (SEVERITY_RANK[existing.severity] ?? 0)) {
        existing.severity = advisory.severity
        existing.title = advisory.title
      }
      continue
    }
    byId.set(key, {
      tree,
      ghsa,
      package: advisory.module_name,
      severity: advisory.severity,
      title: advisory.title,
      paths: [...new Set(paths)]
    })
  }
  return [...byId.values()]
}

// `pnpm audit` reports its own failures as well-formed JSON on stdout with a
// non-zero exit — `{"error":{"code":"ERR_PNPM_AUDIT_ENDPOINT_NOT_EXISTS",...}}`
// when the registry is unreachable, for instance. That parses, and carries no
// advisories, so a gate that only checked parseability would read a registry
// outage as a clean tree and go green exactly when it is least entitled to.
// Exit code cannot be the discriminator either: pnpm exits non-zero for ordinary
// findings too. The report shape is what decides.
export const describeReportProblem = (report) => {
  if (report === null || typeof report !== 'object') return 'report was not a JSON object'
  if (report.error) {
    const { code, message } = report.error
    return `pnpm reported an error: ${code ?? 'unknown'} — ${message ?? 'no message'}`
  }
  if (report.metadata === null || typeof report.metadata !== 'object') {
    return 'report has no "metadata" block, so it is not an audit result'
  }
  return null
}

export const parseExceptions = (raw) => {
  const entries = raw?.exceptions
  if (!Array.isArray(entries)) {
    throw new Error('audit-exceptions.json: expected an "exceptions" array')
  }
  for (const entry of entries) {
    for (const field of REQUIRED_FIELDS) {
      if (typeof entry?.[field] !== 'string' || entry[field].length === 0) {
        throw new Error(
          `audit-exceptions.json: entry is missing "${field}": ${JSON.stringify(entry)}`
        )
      }
    }
    if (parseIsoDay(entry.expires) === null) {
      throw new Error(
        `audit-exceptions.json: "expires" must be a real calendar day as YYYY-MM-DD, ` +
          `got "${entry.expires}"`
      )
    }
    if (!TREES.includes(entry.tree)) {
      throw new Error(`audit-exceptions.json: unknown tree "${entry.tree}"`)
    }
  }
  return entries
}

// `today` is passed in rather than read from the clock so the expiry rule is
// testable and so every tree in one run is judged against the same date.
export const evaluateAudit = ({ findings, exceptions, today }) => {
  const blocking = findings.filter((f) => BLOCKING_SEVERITIES.includes(f.severity))
  const matched = new Set()
  const violations = []
  const accepted = []

  for (const finding of blocking) {
    const index = exceptions.findIndex(
      (e) => e.ghsa === finding.ghsa && e.tree === finding.tree && e.package === finding.package
    )
    if (index === -1) {
      violations.push({ ...finding, why: 'no accepted exception' })
      continue
    }
    matched.add(index)
    const exception = exceptions[index]
    if (exception.expires < today) {
      violations.push({ ...finding, why: `exception expired on ${exception.expires}` })
      continue
    }
    accepted.push({ ...finding, expires: exception.expires })
  }

  // Not a violation: an exception outliving its advisory means the tree got safer.
  // It is still reported so the file does not silently accumulate dead entries.
  const unused = exceptions.filter((_, index) => !matched.has(index))

  // Checked over every entry, not just the matched ones, so an unbounded deferral
  // cannot hide behind an advisory that is currently unreported.
  const todayMs = parseIsoDay(today)
  const horizon = []
  const expiringSoon = []
  for (const entry of exceptions) {
    const days = Math.round((parseIsoDay(entry.expires) - todayMs) / DAY_MS)
    if (days > MAX_EXCEPTION_DAYS) {
      horizon.push({ ...entry, days })
    } else if (days >= 0 && days <= EXPIRY_WARNING_DAYS) {
      expiringSoon.push({ ...entry, days })
    }
  }

  return { blocking, violations, accepted, unused, horizon, expiringSoon }
}

const runAudit = (tree) => {
  const cwd = join(ROOT, tree)
  const result = spawnSync('pnpm', ['audit', '--json'], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    // On Windows pnpm is a .cmd shim, which spawn cannot execute directly. The
    // arguments here are literals, so there is nothing for a shell to interpolate.
    shell: process.platform === 'win32'
  })
  if (result.error) {
    throw new Error(`could not run "pnpm audit" in ${tree}: ${result.error.message}`)
  }

  let report
  try {
    report = JSON.parse(result.stdout)
  } catch {
    const detail = (result.stderr || result.stdout || '').trim().split('\n').slice(0, 5).join('\n')
    throw new Error(
      `"pnpm audit" in ${tree} produced no JSON report (exit ${result.status}):\n${detail}`
    )
  }

  const problem = describeReportProblem(report)
  if (problem) {
    throw new Error(
      `"pnpm audit" in ${tree} did not produce a usable report (exit ${result.status}): ${problem}`
    )
  }
  return report
}

const describe = (finding) =>
  `[${finding.tree}] ${finding.severity} ${finding.package} ${finding.ghsa} — ${finding.title}`

const main = () => {
  const today = new Date().toISOString().slice(0, 10)
  let exceptions
  let findings = []
  try {
    exceptions = parseExceptions(
      JSON.parse(readFileSync(join(ROOT, 'audit-exceptions.json'), 'utf8'))
    )
    for (const tree of TREES) {
      findings = [...findings, ...collectFindings(runAudit(tree), tree)]
    }
  } catch (error) {
    console.error(`audit-check: ${error.message}`)
    return 2
  }

  const { blocking, violations, accepted, unused, horizon, expiringSoon } = evaluateAudit({
    findings,
    exceptions,
    today
  })

  console.log(`audit-check: ${today} — trees: ${TREES.join(', ')}`)
  console.log(`audit-check: ${blocking.length} advisories at ${BLOCKING_SEVERITIES.join('/')}`)

  for (const finding of accepted) {
    console.log(`  accepted until ${finding.expires}: ${describe(finding)}`)
  }
  for (const entry of expiringSoon) {
    console.log(
      `  expiring in ${entry.days} day(s) — re-decide or upgrade before it blocks: ` +
        `[${entry.tree}] ${entry.ghsa} ${entry.package}`
    )
  }
  for (const entry of unused) {
    console.log(`  stale exception (advisory no longer reported): [${entry.tree}] ${entry.ghsa}`)
  }
  for (const violation of violations) {
    console.error(`  BLOCKING (${violation.why}): ${describe(violation)}`)
    for (const path of violation.paths) console.error(`      ${path}`)
  }
  for (const entry of horizon) {
    console.error(
      `  BLOCKING (expires in ${entry.days} days, over the ${MAX_EXCEPTION_DAYS}-day cap): ` +
        `[${entry.tree}] ${entry.ghsa} ${entry.package}`
    )
  }

  if (violations.length > 0 || horizon.length > 0) {
    console.error(
      `audit-check: ${violations.length + horizon.length} blocking finding(s). Upgrade the ` +
        'dependency, or add a narrow time-bounded entry to audit-exceptions.json with a ' +
        'maintainer decision.'
    )
    return 1
  }
  console.log('audit-check: no blocking advisories outside the accepted, unexpired exceptions.')
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main())
}
