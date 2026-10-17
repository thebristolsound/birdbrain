/**
 * Scoring and the report for the retrieval evaluation
 * (docs/plans/2026-10-09-case-retrieval-first-slice.md, D10). Pure: no
 * Electron and no database, so the tests import it directly.
 */

import type { EvalQuery } from './queries'

/** What one search path answered for one query. */
export interface PathAnswer {
  /** Result keys in the path's order, without repeats: see `rankedKeys`. */
  ranked: string[]
  /** How many results the path returned in all, targets or not. */
  returned: number
  /** Set when the path threw instead of answering. */
  error?: string
}

export interface ScoredQuery {
  queryId: string
  path: string
  /** 1-based rank of the first expected target among all results, or null when none was returned. */
  firstRank: number | null
  top5: boolean
  top20: boolean
  returned: number
  /** Every expected target came back; for a query whose correct answer is no result, none did. */
  passed: boolean
  error?: string
}

/**
 * Keys for a path's results in its order: a result's target key, or `other:<id>` for a result that
 * is no target, so a target's rank counts every result above it.
 */
export function rankedKeys(
  ids: readonly string[],
  targets: Readonly<Record<string, string>>
): string[] {
  return [...new Set(ids.map((id) => targets[id] ?? `other:${id}`))]
}

export function firstRank(ranked: string[], expected: readonly string[]): number | null {
  const index = ranked.findIndex((key) => expected.includes(key))
  return index === -1 ? null : index + 1
}

export function scoreQuery(query: EvalQuery, path: string, answer: PathAnswer): ScoredQuery {
  const rank = answer.error ? null : firstRank(answer.ranked, query.expected)
  const passed =
    !answer.error &&
    (query.expected.length === 0
      ? answer.returned === 0
      : query.expected.every((key) => answer.ranked.includes(key)))
  return {
    queryId: query.id,
    path,
    firstRank: rank,
    top5: rank !== null && rank <= 5,
    top20: rank !== null && rank <= 20,
    returned: answer.error ? 0 : answer.returned,
    passed,
    ...(answer.error ? { error: answer.error } : {})
  }
}

/** `count` values spread evenly across `values`, first included; all of them when there are fewer. */
export function spread<T>(values: readonly T[], count: number): T[] {
  if (values.length <= count) return [...values]
  return Array.from({ length: count }, (_, i) => values[Math.floor((i * values.length) / count)])
}

/** Nearest-rank percentile; null for no values. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length))
  return sorted[rank - 1]
}

/** Per query, so a query that starts answering does not change another query's figures. */
export interface PathLatency {
  path: string
  queryId: string
  medianMs: number | null
  p95Ms: number | null
  samples: number
}

export interface IndexSize {
  name: string
  bytes: number
}

/** The Case search field records, built for every Capture by the Settings rebuild's pass. */
export interface FieldIndexReport {
  /** The extractor version that built them. */
  extractor: string
  /** Full build of every Capture's records, in milliseconds. */
  fullBuildMs: number
  /** Median time to build one Capture's records again, in milliseconds. */
  incrementalMedianMs: number | null
  outcomes: Array<{ outcome: string; builds: number }>
  records: Array<{ field: string; records: number }>
}

export interface EvalReport {
  generatedAt: string
  toolVersion: string
  captures: number
  targets: number
  fillers: number
  queries: EvalQuery[]
  scored: ScoredQuery[]
  latency: PathLatency[]
  /** Pages of each index table, from SQLite's dbstat, after the full rebuild and before re-indexing. */
  indexSizes: IndexSize[]
  /** Full rebuild of the Extracted Text index, in milliseconds. */
  fullRebuildMs: number
  /** Median time to re-index one Capture's text, in milliseconds. */
  incrementalMedianMs: number | null
  fieldIndex: FieldIndexReport
  /** Committed Captures that no live Note names and no Persisted Match covers. */
  unreviewedCaptures: number
  /** Target keys inside that unreviewed set. */
  unreviewedTargets: string[]
}

function cell(value: string | number | boolean | null): string {
  if (value === null) return '-'
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  return String(value)
}

function ms(value: number | null): string {
  return value === null ? '-' : value.toFixed(2)
}

export function renderReport(report: EvalReport): string {
  const lines: string[] = []
  lines.push('# Retrieval evaluation report', '')
  lines.push(
    `Generated ${report.generatedAt} by Birdbrain ${report.toolVersion} on a synthetic Case of ` +
      `${report.captures} Captures (${report.targets} target pages, ${report.fillers} filler pages).`,
    ''
  )

  lines.push('## Queries', '')
  lines.push('| Query | Path | First rank | Top 5 | Top 20 | Returned | Passed | Error |')
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const scored of report.scored) {
    lines.push(
      `| ${scored.queryId} | ${scored.path} | ${cell(scored.firstRank)} | ${cell(scored.top5)} | ` +
        `${cell(scored.top20)} | ${scored.returned} | ${cell(scored.passed)} | ${scored.error ?? ''} |`
    )
  }
  lines.push('')
  for (const query of report.queries) {
    lines.push(`- \`${query.id}\`: \`${query.text}\`, ${query.tests}.`)
  }
  lines.push('')

  lines.push('## Latency', '')
  lines.push('| Path | Query | Median (ms) | 95th percentile (ms) | Samples |')
  lines.push('| --- | --- | --- | --- | --- |')
  for (const latency of report.latency) {
    lines.push(
      `| ${latency.path} | ${latency.queryId} | ${ms(latency.medianMs)} | ${ms(latency.p95Ms)} | ` +
        `${latency.samples} |`
    )
  }
  lines.push('')

  lines.push('## Index size and build time', '')
  lines.push('| Table | Bytes | Bytes per Capture |')
  lines.push('| --- | --- | --- |')
  for (const size of report.indexSizes) {
    const perCapture = report.captures === 0 ? 0 : Math.round(size.bytes / report.captures)
    lines.push(`| ${size.name} | ${size.bytes} | ${perCapture} |`)
  }
  lines.push('')
  lines.push(`- Full rebuild of the Extracted Text index: ${ms(report.fullRebuildMs)} ms.`)
  lines.push(`- Re-indexing one Capture's text, median: ${ms(report.incrementalMedianMs)} ms.`)
  const { fieldIndex } = report
  lines.push(
    `- Full build of the search field records (\`${fieldIndex.extractor}\`): ` +
      `${ms(fieldIndex.fullBuildMs)} ms.`
  )
  lines.push(
    `- Building one Capture's search field records again, median: ` +
      `${ms(fieldIndex.incrementalMedianMs)} ms.`
  )
  const outcomes = fieldIndex.outcomes.map(({ outcome, builds }) => `${outcome} ${builds}`)
  lines.push(`- Search field builds by outcome: ${outcomes.join(', ') || 'none'}.`)
  lines.push('')
  lines.push('| Field | Records | Records per Capture |')
  lines.push('| --- | --- | --- |')
  for (const { field, records } of fieldIndex.records) {
    const perCapture = report.captures === 0 ? 0 : (records / report.captures).toFixed(2)
    lines.push(`| ${field} | ${records} | ${perCapture} |`)
  }
  lines.push('')

  lines.push('## Unreviewed Captures', '')
  lines.push(
    `${report.unreviewedCaptures} committed Captures have no live Note and no Persisted Match. ` +
      `Targets among them: ${report.unreviewedTargets.length > 0 ? report.unreviewedTargets.join(', ') : 'none'}.`
  )
  lines.push('')
  return lines.join('\n')
}
