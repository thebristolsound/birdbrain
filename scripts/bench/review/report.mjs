// The effort-sweep report: for every harness, model and tier under results/,
// one table across effort levels (quality, consistency, usage), the paired
// comparison of adjacent levels, and the level the selection rule picks.
//
// Usage: node report.mjs [--results <dir>] [--tier L1] [--json]

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { fixtureReader, loadFixtures } from './grade.mjs'
import { gradeRow, summarize } from './lib/grade.mjs'
import { mean, noiseFloor, paired } from './lib/stats.mjs'
import { CLAUDE_EFFORTS } from './lib/claude.mjs'

const here = dirname(fileURLToPath(import.meta.url))

// Levels in ascending order; Codex adds ultra above max.
export const LEVELS = [...CLAUDE_EFFORTS, 'ultra']
const levelIndex = (e) => (LEVELS.includes(e) ? LEVELS.indexOf(e) : LEVELS.length)

export function loadRuns(resultsDir) {
  const runs = []
  if (!existsSync(resultsDir)) return runs
  for (const id of readdirSync(resultsDir).sort()) {
    const dir = join(resultsDir, id)
    if (!existsSync(join(dir, 'manifest.json')) || !existsSync(join(dir, 'rows.jsonl'))) continue
    const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
    const rows = readFileSync(join(dir, 'rows.jsonl'), 'utf8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l))
    runs.push({ id, manifest, rows })
  }
  return runs
}

const tokens = (row) => {
  const u = row.usage ?? {}
  const input =
    (u.input_tokens ?? 0) +
    (u.cache_creation_input_tokens ?? 0) +
    (u.cache_read_input_tokens ?? 0) +
    (u.cached_input_tokens ?? 0)
  return { input, output: u.output_tokens ?? 0 }
}

export function usageOf(rows) {
  const ok = rows.filter((r) => r.status === 'ok')
  const windows = rows.map((r) => r.rateLimit?.five_hour?.utilization).filter((x) => x != null)
  return {
    inputTokens: mean(ok.map((r) => tokens(r).input)),
    outputTokens: mean(ok.map((r) => tokens(r).output)),
    wallMs: mean(ok.map((r) => r.wallMs)),
    toolCalls: mean(ok.map((r) => r.toolCalls ?? 0)),
    textRecovered: ok.filter((r) => r.outputSource === 'text').length,
    windowFirst: windows.length ? windows[0] : null,
    windowLast: windows.length ? windows[windows.length - 1] : null
  }
}

// The per-(case, rep) scores two levels are compared on.
const scoreOf = (g) => ({
  verdict: g.verdictCorrect ? 1 : 0,
  blockers: g.blockersTotal > 0 ? g.blockersMatched / g.blockersTotal : null
})

export function compareLevels(gradedA, gradedB) {
  const byKey = new Map(
    gradedA.filter((g) => g.status === 'ok').map((g) => [`${g.case}#${g.rep}`, g])
  )
  const dv = []
  const db = []
  for (const b of gradedB) {
    if (b.status !== 'ok') continue
    const a = byKey.get(`${b.case}#${b.rep}`)
    if (!a) continue
    const sa = scoreOf(a)
    const sb = scoreOf(b)
    dv.push(sb.verdict - sa.verdict)
    if (sa.blockers !== null && sb.blockers !== null) db.push(sb.blockers - sa.blockers)
  }
  return { verdict: paired(dv), blockers: paired(db) }
}

// The lowest level whose blocker recall and verdict accuracy are within the
// noise floor of the best level's. Best is by verdict accuracy, then blocker
// recall; a level with no ok rows is never best and never selected.
export function selectLevel(levels, floor) {
  const scored = levels.filter((l) => l.summary.verdictAccuracy !== null)
  if (scored.length === 0) return { best: null, selected: null }
  const key = (l) => [l.summary.verdictAccuracy, l.summary.blockerRecall ?? 0]
  const best = scored.reduce((b, l) => {
    const [bv, bb] = key(b)
    const [lv, lb] = key(l)
    return lv > bv || (lv === bv && lb > bb) ? l : b
  })
  const [bv, bb] = key(best)
  const selected = scored.find((l) => {
    const [lv, lb] = key(l)
    return lv >= bv - floor && lb >= bb - floor
  })
  return { best: best.effort, selected: selected?.effort ?? null }
}

export function buildReport(runs, fixtures, readFileFor, { tier = null } = {}) {
  const groups = new Map()
  for (const run of runs) {
    const m = run.manifest
    if (tier && m.tier !== tier) continue
    const key = `${m.harness}/${m.model}/${m.tier}`
    if (!groups.has(key)) groups.set(key, [])
    const graded = run.rows.map((row) => {
      const kase = fixtures.get(row.case)
      if (!kase) throw new Error(`${run.id}: row names unknown case ${row.case}`)
      return gradeRow(row, kase.truth, { readFile: readFileFor(kase), head: kase.source.head })
    })
    const cases = new Set(run.rows.map((r) => r.case)).size
    const reps = Math.max(0, ...run.rows.map((r) => r.rep))
    groups.get(key).push({
      effort: m.effort,
      manifest: run.id,
      cases,
      reps,
      summary: summarize(graded)[0] ?? { verdictAccuracy: null, blockerRecall: null, statuses: {} },
      usage: usageOf(run.rows),
      graded
    })
  }
  const out = []
  for (const [key, levels] of groups) {
    levels.sort((a, b) => levelIndex(a.effort) - levelIndex(b.effort))
    const cases = Math.max(...levels.map((l) => l.cases))
    const reps = Math.max(...levels.map((l) => l.reps))
    const floor = noiseFloor(cases, reps)
    const adjacent = []
    for (let i = 1; i < levels.length; i += 1) {
      adjacent.push({
        from: levels[i - 1].effort,
        to: levels[i].effort,
        ...compareLevels(levels[i - 1].graded, levels[i].graded)
      })
    }
    out.push({
      config: key,
      cases,
      reps,
      noiseFloor: floor,
      levels: levels.map(({ graded: _g, ...rest }) => rest),
      adjacent,
      ...selectLevel(levels, floor)
    })
  }
  return out
}

const f2 = (x) => (x === null || x === undefined ? '–' : x.toFixed(2))
const f0 = (x) => (x === null || x === undefined ? '–' : Math.round(x).toLocaleString('en-US'))
const ci = (p) =>
  p.n === 0
    ? '–'
    : `${p.mean >= 0 ? '+' : ''}${f2(p.mean)} [${f2(p.lo)}, ${f2(p.hi)}] n=${p.n}${p.different ? '' : ' (no difference)'}`

export function renderMarkdown(report) {
  const lines = []
  for (const g of report) {
    lines.push(`## ${g.config}`, '')
    lines.push(
      `${g.cases} cases × ${g.reps} reps, noise floor ±${f2(g.noiseFloor)}. Best level ${g.best ?? '–'}, selected ${g.selected ?? '–'}.`,
      ''
    )
    lines.push(
      '| effort | rows | ok | verdict | blockers | defects | unmatched | refuted | claims | agree | overlap | in tok | out tok | wall s | tools | window |',
      '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |'
    )
    for (const l of g.levels) {
      const s = l.summary
      const u = l.usage
      const status = Object.entries(s.statuses ?? {})
        .filter(([k]) => k !== 'ok')
        .map(([k, v]) => `${v} ${k}`)
        .join(', ')
      const window = u.windowFirst === null ? '–' : `${f2(u.windowFirst)}→${f2(u.windowLast)}`
      lines.push(
        `| ${l.effort} | ${s.rows ?? 0}${status ? ` (${status})` : ''} | ${s.statuses?.ok ?? 0} | ${f2(s.verdictAccuracy)} | ${f2(s.blockerRecall)} | ${f2(s.defectRecall)} | ${f2(s.unmatchedPerRow)} | ${f2(s.refutedHitsPerRow)} | ${f2(s.claimRate)} | ${f2(s.verdictAgreement)} | ${f2(s.findingOverlap)} | ${f0(u.inputTokens)} | ${f0(u.outputTokens)} | ${f0(u.wallMs === null ? null : u.wallMs / 1000)} | ${f2(u.toolCalls)} | ${window} |`
      )
    }
    if (g.adjacent.length) {
      lines.push('', '| levels | Δ verdict | Δ blocker recall |', '| --- | --- | --- |')
      for (const a of g.adjacent) {
        lines.push(`| ${a.from} → ${a.to} | ${ci(a.verdict)} | ${ci(a.blockers)} |`)
      }
    }
    lines.push('')
  }
  return lines.join('\n')
}

export function main(argv, { log = console.log, repo = join(here, '..', '..', '..') } = {}) {
  let resultsDir = join(here, 'results')
  let fixturesDir = join(here, 'fixtures')
  let tier = null
  let json = false
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--results') resultsDir = argv[++i]
    else if (argv[i] === '--fixtures') fixturesDir = argv[++i]
    else if (argv[i] === '--tier') tier = argv[++i]
    else if (argv[i] === '--json') json = true
    else if (argv[i] === '--repo') repo = argv[++i]
    else throw new Error(`unknown argument ${argv[i]}`)
  }
  const fixtures = loadFixtures(fixturesDir)
  const report = buildReport(loadRuns(resultsDir), fixtures, fixtureReader(fixturesDir, repo), {
    tier
  })
  log(json ? JSON.stringify(report, null, 2) : renderMarkdown(report))
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2))
}
