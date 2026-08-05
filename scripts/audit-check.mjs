#!/usr/bin/env node
// Enforcing dependency-advisory gate for both dependency trees in this repo.
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

// Both trees are audited: website/ is an isolated sub-project with its own lockfile
// (see CLAUDE.md), so a root audit says nothing about it.
export const TREES = ['.', 'website']

const REQUIRED_FIELDS = ['ghsa', 'package', 'tree', 'reason', 'expires']
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

// Flattens one `pnpm audit --json` report into one row per (advisory, tree). pnpm
// reports the same advisory once per affected version range, so the same GHSA can
// appear more than once with different paths; they collapse here because an
// exception is a decision about the advisory in that tree, not about a range.
export const collectFindings = (report, tree) => {
  const byId = new Map()
  for (const advisory of Object.values(report?.advisories ?? {})) {
    const ghsa = advisory.github_advisory_id ?? advisory.id
    const paths = (advisory.findings ?? []).flatMap((finding) => finding.paths ?? [])
    const existing = byId.get(ghsa)
    if (existing) {
      existing.paths = [...new Set([...existing.paths, ...paths])]
      continue
    }
    byId.set(ghsa, {
      tree,
      ghsa: String(ghsa),
      package: advisory.module_name,
      severity: advisory.severity,
      title: advisory.title,
      paths: [...new Set(paths)]
    })
  }
  return [...byId.values()]
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
    if (!DATE_PATTERN.test(entry.expires)) {
      throw new Error(`audit-exceptions.json: "expires" must be YYYY-MM-DD, got "${entry.expires}"`)
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

  return { blocking, violations, accepted, unused }
}

const runAudit = (tree) => {
  const cwd = join(ROOT, tree)
  const result = spawnSync('pnpm', ['audit', '--json'], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024
  })
  if (result.error) {
    throw new Error(`could not run "pnpm audit" in ${tree}: ${result.error.message}`)
  }
  // pnpm exits non-zero whenever it finds anything, so the exit code cannot
  // distinguish findings from failure — the parsed body is what decides.
  try {
    return JSON.parse(result.stdout)
  } catch {
    const detail = (result.stderr || result.stdout || '').trim().split('\n').slice(0, 5).join('\n')
    throw new Error(`"pnpm audit" in ${tree} produced no JSON report:\n${detail}`)
  }
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

  const { blocking, violations, accepted, unused } = evaluateAudit({ findings, exceptions, today })

  console.log(`audit-check: ${today} — trees: ${TREES.join(', ')}`)
  console.log(`audit-check: ${blocking.length} advisories at ${BLOCKING_SEVERITIES.join('/')}`)

  for (const finding of accepted) {
    console.log(`  accepted until ${finding.expires}: ${describe(finding)}`)
  }
  for (const entry of unused) {
    console.log(`  stale exception (advisory no longer reported): [${entry.tree}] ${entry.ghsa}`)
  }
  for (const violation of violations) {
    console.error(`  BLOCKING (${violation.why}): ${describe(violation)}`)
    for (const path of violation.paths) console.error(`      ${path}`)
  }

  if (violations.length > 0) {
    console.error(
      `audit-check: ${violations.length} blocking advisory finding(s). Upgrade the dependency, ` +
        'or add a narrow time-bounded entry to audit-exceptions.json with a maintainer decision.'
    )
    return 1
  }
  console.log('audit-check: no blocking advisories outside the accepted, unexpired exceptions.')
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main())
}
