// Reports the E2E specs that failed and then passed on a retry.
//
// CI retries a failed spec twice (playwright.config.ts), so a spec that fails then passes turns
// the job green and nothing else says it happened. This reads Playwright's JSON report and
// writes the counts to the job summary, with a warning annotation per flaky spec, so a
// flake is visible on the run that absorbed it. It reports only: it never fails the job, and
// a report it cannot read becomes a warning rather than an exit code.
//
// Usage: node scripts/e2e-flaky-summary.mjs [report.json]
//   Default report: test-results/e2e-results.json. The summary goes to $GITHUB_STEP_SUMMARY
//   when set, otherwise to stdout; annotations always go to stdout.

import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

const DEFAULT_REPORT = 'test-results/e2e-results.json'
const HEADING = '## E2E retries'

// GitHub shows at most 10 warning annotations from one step; the job summary lists the rest.
export const MAX_ANNOTATIONS = 10

// The spec's file as a path from the repository root, which is what an annotation's `file=`
// needs. Playwright reports spec files relative to the config's rootDir.
const specPath = (rootDir, spec, cwd) =>
  rootDir ? relative(cwd, join(rootDir, spec.file)) : spec.file

export const summarize = (report, cwd = process.cwd()) => {
  const stats = { total: 0, passed: 0, failed: 0, flaky: 0, skipped: 0, flakyTests: [] }
  const rootDir = report.config?.rootDir

  // A top-level suite is a spec file, whose title is the file name; nested suites are
  // `describe` blocks, whose titles belong in the spec's name.
  const visit = (suite, titles) => {
    const path = suite.title ? [...titles, suite.title] : titles
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        stats.total += 1
        if (test.status === 'expected') stats.passed += 1
        else if (test.status === 'skipped') stats.skipped += 1
        else if (test.status === 'flaky') {
          stats.flaky += 1
          const results = test.results ?? []
          stats.flakyTests.push({
            file: specPath(rootDir, spec, cwd),
            line: spec.line,
            title: [...path, spec.title].join(' > '),
            attempts: results.length,
            failures: results.filter((r) => r.status !== 'passed' && r.status !== 'skipped').length
          })
        } else stats.failed += 1
      }
    }
    for (const child of suite.suites ?? []) visit(child, path)
  }

  for (const file of report.suites ?? []) {
    visit({ ...file, title: '' }, [])
  }
  return stats
}

// A `|` in a spec title would end the table cell.
const cell = (s) => s.replace(/\|/g, '\\|')

export const formatSummary = (stats) => {
  const lines = [
    HEADING,
    '',
    '| Total | Passed | Failed | Flaky | Skipped |',
    '| ---: | ---: | ---: | ---: | ---: |',
    `| ${stats.total} | ${stats.passed} | ${stats.failed} | ${stats.flaky} | ${stats.skipped} |`,
    ''
  ]
  if (stats.flakyTests.length === 0) {
    lines.push('No spec needed a retry to pass.')
  } else {
    lines.push(
      'These specs failed and then passed on a retry. Each one is a finding to fix, not a pass.',
      '',
      '| Spec | Failed attempts | Attempts |',
      '| --- | ---: | ---: |',
      ...stats.flakyTests.map(
        (t) => `| \`${cell(t.file)}:${t.line}\` ${cell(t.title)} | ${t.failures} | ${t.attempts} |`
      )
    )
  }
  return `${lines.join('\n')}\n`
}

// GitHub workflow commands end at a newline and treat `%`, `\r` and `\n` specially in the
// message, and `,` and `:` as separators in properties.
const escapeData = (s) => s.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
const escapeProperty = (s) => escapeData(s).replace(/:/g, '%3A').replace(/,/g, '%2C')

const warning = (message, properties = '') =>
  `::warning ${properties}title=Flaky E2E spec::${escapeData(message)}`

export const annotations = ({ flakyTests }) => {
  const shown =
    flakyTests.length > MAX_ANNOTATIONS ? flakyTests.slice(0, MAX_ANNOTATIONS - 1) : flakyTests
  const lines = shown.map((t) =>
    warning(
      `${t.title} failed ${t.failures} of ${t.attempts} attempts before passing`,
      `file=${escapeProperty(t.file)},line=${t.line},`
    )
  )
  const rest = flakyTests.length - shown.length
  if (rest > 0) lines.push(warning(`${rest} more flaky specs; the job summary lists every one`))
  return lines
}

const main = () => {
  const reportPath = process.argv[2] ?? DEFAULT_REPORT
  const summaryFile = process.env.GITHUB_STEP_SUMMARY
  const write = (text) =>
    summaryFile ? appendFileSync(summaryFile, text) : process.stdout.write(text)

  // The E2E step may have stopped before Playwright wrote a report (a failed build, a
  // timeout). That failure is already the job's verdict; say so here and add nothing.
  if (!existsSync(reportPath)) {
    write(`${HEADING}\n\nNo Playwright JSON report at \`${reportPath}\`.\n`)
    return
  }
  const stats = summarize(JSON.parse(readFileSync(reportPath, 'utf8')))
  write(formatSummary(stats))
  for (const line of annotations(stats)) console.log(line)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main()
  } catch (error) {
    console.log(`::warning title=E2E retry report::${escapeData(`Not written: ${error.message}`)}`)
  }
}
