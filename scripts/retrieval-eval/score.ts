/**
 * Scoring and the report for the retrieval evaluation
 * (docs/plans/2026-10-09-case-retrieval-first-slice.md, D10). Pure: no
 * Electron and no database, so the tests import it directly.
 */

import type { EvalQuery } from './queries'

/** What one search path answered for one query. */
export interface PathAnswer {
  /** Target keys in the order the path ranked the Captures they name, without repeats. */
  ranked: string[]
  /** How many results the path returned in all, targets or not. */
  returned: number
  /** Set when the path threw instead of answering. */
  error?: string
}

export interface ScoredQuery {
  queryId: string
  path: string
  /** 1-based rank of the first expected target, or null when none was returned. */
  firstRank: number | null
  top5: boolean
  top20: boolean
  returned: number
  /** For a query whose correct answer is no result: whether the path returned none. */
  passed: boolean
  error?: string
}

export function firstRank(ranked: string[], expected: readonly string[]): number | null {
  const index = ranked.findIndex((key) => expected.includes(key))
  return index === -1 ? null : index + 1
}

export function scoreQuery(query: EvalQuery, path: string, answer: PathAnswer): ScoredQuery {
  const rank = answer.error ? null : firstRank(answer.ranked, query.expected)
  const passed =
    !answer.error && (query.expected.length === 0 ? answer.returned === 0 : rank !== null)
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

/** Nearest-rank percentile; null for no values. */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length))
  return sorted[rank - 1]
}

export interface PathLatency {
  path: string
  medianMs: number | null
  p95Ms: number | null
  samples: number
}

export interface IndexSize {
  name: string
  bytes: number
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
  /** Pages of each index table, from SQLite's dbstat. */
  indexSizes: IndexSize[]
  /** Full rebuild of the Extracted Text index, in milliseconds. */
  fullRebuildMs: number
  /** Median time to re-index one Capture's text, in milliseconds. */
  incrementalMedianMs: number | null
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
  lines.push('| Path | Median (ms) | 95th percentile (ms) | Samples |')
  lines.push('| --- | --- | --- | --- |')
  for (const latency of report.latency) {
    lines.push(
      `| ${latency.path} | ${ms(latency.medianMs)} | ${ms(latency.p95Ms)} | ${latency.samples} |`
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
  lines.push('')

  lines.push('## Unreviewed Captures', '')
  lines.push(
    `${report.unreviewedCaptures} committed Captures have no live Note and no Persisted Match. ` +
      `Targets among them: ${report.unreviewedTargets.length > 0 ? report.unreviewedTargets.join(', ') : 'none'}.`
  )
  lines.push('')
  return lines.join('\n')
}
