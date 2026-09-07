#!/usr/bin/env node
// Entry point for the slop audit: names the detectable tells from
// docs/specs/2026-09-03-agentic-code-slop-patterns-research.md on the tracked
// working tree. Advisory by default; --strict exits 1 on a blocking finding.
// Design: docs/specs/2026-09-03-slop-audit-design.md.
//
// Usage: node scripts/slop-audit/cli.mjs [--json] [--strict] [--changed-since <ref>]
//        [--path <glob>]...
//
// Exit codes: 0 ran, 1 --strict and a blocking finding, 2 could not run.

import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { buildInventory, createReader, listChangedFiles, listTrackedFiles } from './lib/files.mjs'
import { buildEnvelope, exitCode, renderJson, renderText } from './lib/report.mjs'

export const USAGE =
  'usage: slop-audit [--json] [--strict] [--changed-since <ref>] [--path <glob>]...'

export const parseArgs = (argv) => {
  const options = { json: false, strict: false, changedSince: null, paths: [] }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--json') {
      options.json = true
    } else if (arg === '--strict') {
      options.strict = true
    } else if (arg === '--changed-since' || arg === '--path') {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) throw new Error(`${arg} needs a value`)
      i++
      if (arg === '--path') options.paths.push(value)
      else options.changedSince = value
    } else {
      throw new Error(`unknown argument "${arg}"\n${USAGE}`)
    }
  }
  return options
}

// The commit the report describes, and whether any tracked file differs from it.
// Untracked files are not scanned, so they do not make the tree dirty here.
export const gitInfo = (root) => {
  const run = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
  return {
    commit: run(['rev-parse', 'HEAD']),
    dirty: run(['status', '--porcelain', '--untracked-files=no']) !== ''
  }
}

// A check that throws stops the run with its id in the message. A half-finished
// report that looks complete is worse than no report.
export const runChecks = ({ checks, ctx }) =>
  checks.flatMap((check) => {
    try {
      return check.run(ctx)
    } catch (error) {
      throw new Error(`check ${check.id} failed: ${error.message}`)
    }
  })

// Everything that touches git, the disk, or the console is injectable so the
// tests drive main() without a repository. The defaults are the real thing.
export const main = (argv, deps = {}) => {
  const {
    root = process.cwd(),
    checks = [],
    listFiles = listTrackedFiles,
    listChanged = listChangedFiles,
    info = gitInfo,
    read = createReader(root),
    stdout = console.log,
    stderr = console.error
  } = deps

  let options
  let envelope
  try {
    options = parseArgs(argv)
    const { commit, dirty } = info(root)
    const packageJson = JSON.parse(read('package.json'))
    const changed = options.changedSince === null ? null : listChanged(root, options.changedSince)
    const { files, reported } = buildInventory({
      paths: listFiles(root),
      changed,
      globs: options.paths
    })
    const ctx = { root, files, reported, read, packageJson }
    const findings = runChecks({ checks, ctx }).filter((finding) => reported.has(finding.file))
    envelope = buildEnvelope({ commit, dirty, findings })
  } catch (error) {
    stderr(`slop-audit: ${error.message}`)
    return 2
  }

  stdout(options.json ? renderJson(envelope) : renderText(envelope))
  return exitCode({ envelope, strict: options.strict })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2))
}
