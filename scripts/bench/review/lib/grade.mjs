// Programmatic grading of result rows against truth files, plus the summary
// the report reads. Everything here is deterministic: no model is called.

import { matchFindings, normalizePath, DEFAULT_CAP } from './match.mjs'
import { configKey } from './schema.mjs'

const squash = (s) => String(s).replace(/\s+/g, ' ').trim()

// readFile(sha, path) -> string | null. Injected so tests need no git.
export function checkClaim(finding, head, readFile) {
  if (!finding.file) return 'unverifiable'
  const content = readFile(head, normalizePath(finding.file))
  if (content === null || content === undefined) return 'missing-file'
  if (finding.line !== undefined && finding.line !== null) {
    const lines = content.split('\n').length
    if (finding.line < 1 || finding.line > lines) return 'line-out-of-range'
  }
  if (finding.quote && !squash(content).includes(squash(finding.quote))) return 'quote-mismatch'
  return 'ok'
}

export function gradeRow(row, truth, options = {}) {
  const base = {
    case: row.case,
    model: row.model,
    harness: row.harness,
    tier: row.tier,
    effort: row.effort,
    rep: row.rep,
    manifest: row.manifest,
    status: row.status
  }
  if (row.status !== 'ok') return base
  const findings = row.output.findings
  const m = matchFindings(findings, truth, options)
  const blockers = truth.defects.filter((d) => d.blocking)
  const matched = new Set(m.matchedDefectIds)
  const claims = {
    ok: 0,
    'missing-file': 0,
    'line-out-of-range': 0,
    'quote-mismatch': 0,
    unverifiable: 0
  }
  const readFile = options.readFile ?? (() => null)
  for (const f of findings.slice(0, options.cap ?? DEFAULT_CAP)) {
    claims[checkClaim(f, row.head ?? options.head, readFile)] += 1
  }
  return {
    ...base,
    verdict: row.output.verdict,
    verdictCorrect: row.output.verdict === truth.verdict,
    findings: findings.length,
    overCap: m.overCap,
    defectsTotal: truth.defects.length,
    defectsMatched: matched.size,
    blockersTotal: blockers.length,
    blockersMatched: blockers.filter((d) => matched.has(d.id)).length,
    unmatched: m.unmatched.length,
    refutedHits: m.refutedHits.length,
    matchedDefectIds: m.matchedDefectIds,
    claims,
    // The set a consistency check compares across reps: file plus line bucket.
    findingKeys: findings
      .slice(0, options.cap ?? DEFAULT_CAP)
      .map((f) => `${normalizePath(f.file)}:${f.line == null ? '-' : Math.floor(f.line / 10)}`)
  }
}

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
const ratio = (num, den) => (den > 0 ? num / den : null)

function jaccard(a, b) {
  const A = new Set(a)
  const B = new Set(b)
  if (A.size === 0 && B.size === 0) return 1
  let inter = 0
  for (const x of A) if (B.has(x)) inter += 1
  return inter / (A.size + B.size - inter)
}

// Agreement across the reps of one case under one config.
export function consistency(reps) {
  if (reps.length < 2) return { verdictAgreement: null, findingOverlap: null }
  const counts = new Map()
  for (const r of reps) counts.set(r.verdict, (counts.get(r.verdict) ?? 0) + 1)
  const majority = Math.max(...counts.values())
  const overlaps = []
  for (let i = 0; i < reps.length; i += 1) {
    for (let j = i + 1; j < reps.length; j += 1) {
      overlaps.push(jaccard(reps[i].findingKeys, reps[j].findingKeys))
    }
  }
  return { verdictAgreement: majority / reps.length, findingOverlap: mean(overlaps) }
}

export function summarize(graded) {
  const groups = new Map()
  for (const g of graded) {
    const key = configKey(g)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(g)
  }
  const out = []
  for (const [config, rows] of groups) {
    const statuses = {}
    for (const r of rows) statuses[r.status] = (statuses[r.status] ?? 0) + 1
    const ok = rows.filter((r) => r.status === 'ok')
    const byCase = new Map()
    for (const r of ok) {
      if (!byCase.has(r.case)) byCase.set(r.case, [])
      byCase.get(r.case).push(r)
    }
    const cons = [...byCase.values()].map(consistency)
    const claimsOk = ok.reduce((a, r) => a + r.claims.ok, 0)
    const claimsChecked = ok.reduce(
      (a, r) =>
        a +
        r.claims.ok +
        r.claims['missing-file'] +
        r.claims['line-out-of-range'] +
        r.claims['quote-mismatch'],
      0
    )
    out.push({
      config,
      rows: rows.length,
      statuses,
      cases: byCase.size,
      verdictAccuracy: ratio(ok.filter((r) => r.verdictCorrect).length, ok.length),
      blockerRecall: mean(
        ok.filter((r) => r.blockersTotal > 0).map((r) => r.blockersMatched / r.blockersTotal)
      ),
      defectRecall: mean(
        ok.filter((r) => r.defectsTotal > 0).map((r) => r.defectsMatched / r.defectsTotal)
      ),
      unmatchedPerRow: mean(ok.map((r) => r.unmatched)),
      refutedHitsPerRow: mean(ok.map((r) => r.refutedHits)),
      claimRate: ratio(claimsOk, claimsChecked),
      verdictAgreement: mean(cons.map((c) => c.verdictAgreement).filter((x) => x !== null)),
      findingOverlap: mean(cons.map((c) => c.findingOverlap).filter((x) => x !== null))
    })
  }
  return out
}

// The truth file pushed through the grader as if a model had produced it.
export function oracleRow(kase, truth) {
  return {
    case: kase.id,
    model: 'oracle',
    harness: 'claude',
    tier: 'L0',
    effort: 'none',
    rep: 1,
    manifest: 'self-check',
    head: kase.source.head,
    status: 'ok',
    output: {
      verdict: truth.verdict,
      findings: truth.defects.map((d) => ({
        file: d.file,
        line: d.lineStart,
        summary: d.description,
        blocking: d.blocking
      }))
    }
  }
}

export function nullRow(kase) {
  return {
    ...oracleRow(kase, { verdict: 'approve for human review', defects: [] }),
    model: 'null'
  }
}

export function errorRow(kase) {
  const { output: _output, ...rest } = oracleRow(kase, {
    verdict: 'approve for human review',
    defects: []
  })
  return { ...rest, model: 'error', status: 'error' }
}

// Runs the three checks the evaluation health checklist asks for before any
// paid run: the oracle scores full marks, the null scores nothing, and an
// error row is counted and excluded rather than scored as a zero.
// options.readFileFor(kase) -> readFile(sha, path): the file the model would
// read for that case, which for a mutation case is the mutated copy.
export function selfCheck(cases, options = {}) {
  const problems = []
  const grade = (row, kase) =>
    gradeRow(row, kase.truth, {
      ...options,
      head: kase.source.head,
      readFile: options.readFileFor ? options.readFileFor(kase) : options.readFile
    })
  const oracle = summarize(cases.map((k) => grade(oracleRow(k, k.truth), k)))[0]
  const nul = summarize(cases.map((k) => grade(nullRow(k), k)))[0]
  const err = summarize(cases.map((k) => grade(errorRow(k), k)))[0]
  if (!oracle || oracle.verdictAccuracy !== 1) problems.push('oracle: verdict accuracy is not 1')
  if (oracle && oracle.defectRecall !== null && oracle.defectRecall !== 1)
    problems.push('oracle: defect recall is not 1')
  if (oracle && oracle.unmatchedPerRow !== 0) problems.push('oracle: unmatched findings')
  if (oracle && (options.readFile || options.readFileFor) && oracle.claimRate !== 1)
    problems.push('oracle: claim rate is not 1')
  if (nul && nul.defectRecall !== null && nul.defectRecall !== 0)
    problems.push('null: defect recall is not 0')
  if (nul && nul.unmatchedPerRow !== 0) problems.push('null: unmatched findings')
  if (!err || err.statuses.error !== cases.length)
    problems.push('error: rows not counted as errors')
  if (err && err.verdictAccuracy !== null) problems.push('error: rows were scored')
  return { pass: problems.length === 0, problems, oracle, null: nul, error: err }
}
