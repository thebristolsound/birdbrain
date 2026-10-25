// The two experiments. Each edits files only through the workspace and restores them in a
// `finally`, so a thrown error or a failed run leaves the tree as it found it.

import { applyMutant, findMutants, selectMutants } from './mutants.mjs'
import { findTestSites, siteForLine, touchedSites } from './testSites.mjs'

const key = (path, fullName) => `${path}\0${fullName}`

// The tests in a report that sit inside a touched site and ended with `status`.
const touchedResults = (report, tests, status) => {
  const byPath = new Map(tests.map((test) => [test.path, test.touched]))
  return report.files.flatMap((file) => {
    const touched = byPath.get(file.path)
    if (!touched) return []
    return file.tests
      .filter((test) => test.status === status && test.line !== null)
      .filter((test) => siteForLine(touched, test.line) !== null)
      .map((test) => ({ path: file.path, fullName: test.fullName, line: test.line }))
  })
}

// Puts every changed source file back to its merge-base content, keeps the branch's tests, and
// reruns the test files the branch touched. A touched test that passes both ways did not need
// the change.
export const revertProbe = async ({ changes, read, readBase, workspace, run }) => {
  if (changes.sources.length === 0) {
    return { skipped: 'the branch changes no source file the unit tests can import' }
  }
  const tests = changes.unitTests
    .filter(({ status }) => status !== 'D')
    .map(({ path, status, addedLines }) => ({
      path,
      touched: touchedSites({
        sites: findTestSites({ path, text: read(path) }),
        status,
        addedLines
      })
    }))
    .filter(({ touched }) => touched.length > 0)
  if (tests.length === 0) return { skipped: 'the branch adds or edits no unit test' }

  const files = tests.map(({ path }) => path)
  const head = await run({ mode: 'run', files })
  if (!head.report) throw new Error(`the unit tests wrote no report at HEAD:\n${head.output}`)
  const passingAtHead = touchedResults(head.report, tests, 'passed')
  const failingAtHead = touchedResults(head.report, tests, 'failed')

  let base
  try {
    for (const { path, status } of changes.sources) {
      if (status === 'A') workspace.remove(path)
      else workspace.write(path, readBase(path))
    }
    base = await run({ mode: 'run', files })
  } finally {
    workspace.restore()
  }

  // A file that fails to load at the merge base reports no tests, which is the outcome wanted:
  // nothing in it passed without the change.
  const passedAtBase = new Set(
    (base.report?.files ?? []).flatMap((file) =>
      file.tests
        .filter((test) => test.status === 'passed')
        .map((test) => key(file.path, test.fullName))
    )
  )
  return {
    sourcesReverted: changes.sources.length,
    testsChecked: passingAtHead.length,
    failingAtHead: failingAtHead.length,
    findings: passingAtHead.filter((test) => passedAtBase.has(key(test.path, test.fullName)))
  }
}

const notRun = (mutants, outcome) => mutants.map((mutant) => ({ ...mutant, outcome }))

// One mutant at a time on the changed lines of each source file, against the unit tests that
// import that file. A mutant that leaves every test green is a changed line no assertion
// depends on.
export const mutationProbe = async ({
  changes,
  read,
  workspace,
  run,
  maxMutants,
  budgetMs,
  now = Date.now,
  minTimeoutMs = 60_000
}) => {
  const candidates = changes.sources
    .filter(({ status }) => status !== 'D')
    .flatMap(({ path, addedLines }) => findMutants({ path, text: read(path), lines: addedLines }))
  const selected = selectMutants(candidates, maxMutants)
  const byPath = new Map()
  for (const mutant of selected) {
    if (!byPath.has(mutant.path)) byPath.set(mutant.path, [])
    byPath.get(mutant.path).push(mutant)
  }

  const started = now()
  const overBudget = () => now() - started > budgetMs
  const results = []
  const files = []
  for (const [path, mutants] of byPath) {
    if (overBudget()) {
      files.push({ path, outcome: 'budget' })
      results.push(...notRun(mutants, 'not-run'))
      continue
    }
    const baseline = await run({ mode: 'related', files: [path] })
    const tests = (baseline.report?.files ?? []).map((file) => file.path)
    if (!baseline.ok) {
      files.push({ path, outcome: 'red-baseline', tests })
      results.push(...notRun(mutants, 'skipped'))
      continue
    }
    if (tests.length === 0) {
      files.push({ path, outcome: 'no-tests', tests })
      results.push(...notRun(mutants, 'no-tests'))
      continue
    }

    const timeoutMs = Math.max(minTimeoutMs, baseline.durationMs * 3)
    const text = read(path)
    for (const mutant of mutants) {
      if (overBudget()) {
        results.push(...notRun([mutant], 'not-run'))
        continue
      }
      let outcome
      try {
        workspace.write(path, applyMutant(text, mutant))
        const result = await run({ mode: 'run', files: tests, bail: true, timeoutMs })
        outcome = result.timedOut ? 'timeout' : result.ok ? 'survived' : 'killed'
      } finally {
        workspace.restore()
      }
      results.push({ ...mutant, outcome, tests: tests.length })
    }
    files.push({ path, outcome: 'probed', tests })
  }
  return { candidates: candidates.length, selected: selected.length, results, files }
}
