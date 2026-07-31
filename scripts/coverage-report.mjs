import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const coverageSummaryPath = join(root, 'coverage', 'coverage-summary.json')
const e2eResultsPath = join(root, 'test-results', 'e2e-results.json')
const outputPath = join(root, 'coverage', 'coverage-report.md')

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'))

const formatPct = (value) => `${Number(value).toFixed(2)}%`

const formatCoverageRows = (coverage) => {
  const total = coverage.total
  return [
    '| Metric | Covered | Total | Percent |',
    '| --- | ---: | ---: | ---: |',
    `| Lines | ${total.lines.covered} | ${total.lines.total} | ${formatPct(total.lines.pct)} |`,
    `| Statements | ${total.statements.covered} | ${total.statements.total} | ${formatPct(total.statements.pct)} |`,
    `| Functions | ${total.functions.covered} | ${total.functions.total} | ${formatPct(total.functions.pct)} |`,
    `| Branches | ${total.branches.covered} | ${total.branches.total} | ${formatPct(total.branches.pct)} |`
  ]
}

const createE2eStats = (results) => {
  const stats = {
    total: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    flaky: 0,
    timedOut: 0
  }

  const visitSuite = (suite) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        stats.total += 1

        if (test.status === 'expected') {
          stats.passed += 1
        } else if (test.status === 'skipped') {
          stats.skipped += 1
        } else if (test.status === 'flaky') {
          stats.flaky += 1
        } else if (test.status === 'timedOut') {
          stats.timedOut += 1
        } else {
          stats.failed += 1
        }
      }
    }

    for (const child of suite.suites ?? []) {
      visitSuite(child)
    }
  }

  for (const suite of results.suites ?? []) {
    visitSuite(suite)
  }

  return stats
}

const main = async () => {
  if (!existsSync(coverageSummaryPath)) {
    throw new Error(
      `Missing ${coverageSummaryPath}. Run "pnpm test:coverage" before generating the report.`
    )
  }

  const coverage = await readJson(coverageSummaryPath)
  const generatedAt = new Date().toISOString()

  const lines = [
    '# Test Coverage Report',
    '',
    `Generated: ${generatedAt}`,
    '',
    '## Unit Coverage',
    '',
    ...formatCoverageRows(coverage),
    '',
    'HTML report: `coverage/index.html`'
  ]

  if (existsSync(e2eResultsPath)) {
    const e2eResults = await readJson(e2eResultsPath)
    const stats = createE2eStats(e2eResults)

    lines.push(
      '',
      '## E2E Coverage',
      '',
      '| Total | Passed | Failed | Flaky | Skipped | Timed out |',
      '| ---: | ---: | ---: | ---: | ---: | ---: |',
      `| ${stats.total} | ${stats.passed} | ${stats.failed} | ${stats.flaky} | ${stats.skipped} | ${stats.timedOut} |`,
      '',
      'HTML report: `playwright-report/index.html`',
      'JSON report: `test-results/e2e-results.json`'
    )
  } else {
    lines.push(
      '',
      '## E2E Coverage',
      '',
      `No Playwright JSON report found at \`${e2eResultsPath}\`. Run \`pnpm test:e2e\` to include E2E results.`
    )
  }

  await mkdir(join(root, 'coverage'), { recursive: true })
  await writeFile(outputPath, `${lines.join('\n')}\n`)
  console.log(`Wrote ${outputPath}`)
}

main().catch((error) => {
  console.error(error.message)
  process.exit(1)
})
