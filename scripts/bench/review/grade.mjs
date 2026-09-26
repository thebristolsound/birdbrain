// Grades result rows against the fixtures, or runs the self-check.
//
// Usage: node grade.mjs --results <file.jsonl|dir> [--json]
//        node grade.mjs --self-check
//
// Rows are JSON lines in the runner's result shape (lib/schema.mjs). Truth and
// heads come from fixtures/<case>/; claim checks read the file at the head
// the row names through git.

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { gradeRow, summarize, selfCheck } from './lib/grade.mjs'
import { validateResultRow } from './lib/schema.mjs'
import { showFile } from './lib/git.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = join(here, 'fixtures')

export function loadFixtures(dir = FIXTURES_DIR) {
  if (!existsSync(dir)) throw new Error(`no fixtures at ${dir}; run build-cases.mjs first`)
  const out = new Map()
  for (const id of readdirSync(dir).sort()) {
    const base = join(dir, id)
    if (!existsSync(join(base, 'truth.json'))) continue
    const spec = JSON.parse(readFileSync(join(base, 'case.json'), 'utf8'))
    const truth = JSON.parse(readFileSync(join(base, 'truth.json'), 'utf8'))
    out.set(id, { ...spec, truth })
  }
  return out
}

export function readRows(path) {
  const files = statSync(path).isDirectory()
    ? readdirSync(path)
        .filter((f) => f.endsWith('.jsonl'))
        .map((f) => join(path, f))
    : [path]
  const rows = []
  for (const f of files) {
    for (const line of readFileSync(f, 'utf8').split('\n')) {
      if (!line.trim()) continue
      const row = JSON.parse(line)
      const problems = validateResultRow(row)
      if (problems.length) throw new Error(`${f}: ${problems.join('; ')}`)
      rows.push(row)
    }
  }
  return rows
}

const fmt = (x) =>
  x === null || x === undefined ? '–' : typeof x === 'number' ? x.toFixed(2) : String(x)

export function render(summary) {
  const cols = [
    ['config', 'config'],
    ['rows', 'rows'],
    ['ok', (s) => s.statuses.ok ?? 0],
    ['verdict', 'verdictAccuracy'],
    ['blockers', 'blockerRecall'],
    ['defects', 'defectRecall'],
    ['unmatched', 'unmatchedPerRow'],
    ['refuted', 'refutedHitsPerRow'],
    ['claims', 'claimRate'],
    ['agree', 'verdictAgreement'],
    ['overlap', 'findingOverlap']
  ]
  const lines = [cols.map(([h]) => h).join('\t')]
  for (const s of summary) {
    lines.push(cols.map(([, k]) => fmt(typeof k === 'function' ? k(s) : s[k])).join('\t'))
  }
  return lines.join('\n')
}

export function main(
  argv,
  { repo = process.cwd(), log = console.log, fixturesDir = FIXTURES_DIR } = {}
) {
  let results = null
  let json = false
  let self = false
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--results') results = argv[++i]
    else if (argv[i] === '--json') json = true
    else if (argv[i] === '--self-check') self = true
    else if (argv[i] === '--repo') repo = argv[++i]
    else throw new Error(`unknown argument ${argv[i]}`)
  }
  const fixtures = loadFixtures(fixturesDir)
  // A mutation case's file is the mutated copy the builder wrote, never the
  // head commit's: the model read the mutation, so the claim check must too.
  const readFileFor = (kase) => (sha, path) => {
    const mutated = join(fixturesDir, kase.id, 'files', path)
    return existsSync(mutated) ? readFileSync(mutated, 'utf8') : showFile(repo, sha, path)
  }
  if (self) {
    const result = selfCheck([...fixtures.values()], { readFileFor })
    log(json ? JSON.stringify(result, null, 2) : render([result.oracle, result.null, result.error]))
    for (const p of result.problems) log(`PROBLEM  ${p}`)
    log(result.pass ? 'self-check passed' : 'self-check FAILED')
    return result.pass ? 0 : 1
  }
  if (!results) throw new Error('--results or --self-check required')
  const graded = readRows(results).map((row) => {
    const kase = fixtures.get(row.case)
    if (!kase) throw new Error(`row names unknown case ${row.case}`)
    return gradeRow(row, kase.truth, { readFile: readFileFor(kase), head: kase.source.head })
  })
  const summary = summarize(graded)
  log(json ? JSON.stringify({ summary, graded }, null, 2) : render(summary))
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2))
}
