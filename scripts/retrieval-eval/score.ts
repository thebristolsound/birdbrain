/**
 * Scoring and the report for the retrieval evaluation
 * (docs/plans/2026-10-09-case-retrieval-first-slice.md, D10). Pure: no
 * Electron and no database, so the tests import it directly.
 */

import type { ClaimCheck } from '@shared/investigation'
import type { UnreviewedCaptures, UnreviewedGroup } from '@shared/types'
import type { EvalQuery } from './queries'
import type { ExpectedPlacement } from './targets'

/** What one search path answered for one query. */
export interface PathAnswer {
  /** Result keys in the path's order, without repeats: see `rankedKeys`. */
  ranked: string[]
  /** How many results the path returned in all, targets or not. */
  returned: number
  /** Set when the path threw instead of answering. */
  error?: string
  /** Field search only: more hits matched than its limit returns. */
  truncated?: boolean
  /** Field search only: Exhibits left out because their records were built from another hash. */
  unavailable?: number
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
  truncated?: boolean
  unavailable?: number
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
    ...(answer.error ? { error: answer.error } : {}),
    ...(answer.truncated !== undefined ? { truncated: answer.truncated } : {}),
    ...(answer.unavailable !== undefined ? { unavailable: answer.unavailable } : {})
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

/** The exact check's outcomes over every Field search hit (D10). */
export interface CheckTally {
  byQuery: Array<{ queryId: string; present: number; absent: number; cannotCheck: number }>
  present: number
  absent: number
  cannotCheck: number
  /** `absent` plus `cannot-check`. */
  falseLocators: number
  /** Why the check could not run, with how many hits each reason covers. */
  reasons: Array<{ reason: string; count: number }>
}

export function tallyChecks(
  perQuery: ReadonlyArray<{ queryId: string; checks: readonly ClaimCheck[] }>
): CheckTally {
  const reasons = new Map<string, number>()
  const byQuery = perQuery.map(({ queryId, checks }) => {
    const count = (text: ClaimCheck['text']) => checks.filter((check) => check.text === text).length
    for (const check of checks) {
      if (check.text === 'cannot-check') {
        const reason = check.reason ?? 'no reason given'
        reasons.set(reason, (reasons.get(reason) ?? 0) + 1)
      }
    }
    return {
      queryId,
      present: count('present'),
      absent: count('absent'),
      cannotCheck: count('cannot-check')
    }
  })
  const sum = (key: 'present' | 'absent' | 'cannotCheck') =>
    byQuery.reduce((total, row) => total + row[key], 0)
  return {
    byQuery,
    present: sum('present'),
    absent: sum('absent'),
    cannotCheck: sum('cannotCheck'),
    falseLocators: sum('absent') + sum('cannotCheck'),
    reasons: [...reasons].map(([reason, count]) => ({ reason, count }))
  }
}

/** Queries with expected targets that a path did not return in full: D10's misses. */
export function misses(
  scored: readonly ScoredQuery[],
  path: string,
  queries: readonly EvalQuery[]
) {
  return scored
    .filter((row) => row.path === path && !row.passed)
    .filter((row) => (queries.find((query) => query.id === row.queryId)?.expected.length ?? 0) > 0)
    .map((row) => row.queryId)
}

/** What the unreviewed view lists (D8), read through the view's own query. */
export interface UnreviewedMeasure {
  rareLimit: number
  captures: number
  total: number
  ungrouped: number
  notCurrent: number
  partial: number
  groups: Array<{ group: UnreviewedGroup; rows: number; captures: number }>
  /** Captures listed under at least one row. */
  listed: number
  /** Target pages listed under at least one row. */
  listedTargets: string[]
  placements: Array<ExpectedPlacement & { listed: boolean }>
  /** Median time of the view's read, in milliseconds. */
  readMedianMs: number | null
}

export function measureUnreviewed(
  view: UnreviewedCaptures,
  targets: Readonly<Record<string, string>>,
  expected: readonly ExpectedPlacement[],
  readMedianMs: number | null
): UnreviewedMeasure {
  const { captures, total, ungrouped, notCurrent, partial, rareLimit } = view
  const entries = Object.entries(view.groups) as Array<
    [UnreviewedGroup, UnreviewedCaptures['groups'][UnreviewedGroup]]
  >
  const listed = new Set<string>()
  const groups = entries.map(([group, rows]) => {
    const inGroup = new Set(rows.flatMap((row) => row.captures.map((c) => c.exhibitId)))
    for (const id of inGroup) listed.add(id)
    return { group, rows: rows.length, captures: inGroup.size }
  })
  const placements = expected.map((placement) => ({
    ...placement,
    listed: view.groups[placement.group].some(
      (row) =>
        row.key === placement.key &&
        row.captures.some((c) => targets[c.exhibitId] === placement.target)
    )
  }))
  return {
    rareLimit,
    captures,
    total,
    ungrouped,
    notCurrent,
    partial,
    groups,
    listed: listed.size,
    listedTargets: [...new Set([...listed].flatMap((id) => targets[id] ?? []))].sort(),
    placements,
    readMedianMs
  }
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
  /** The evaluation Case, so a measure pass can tell its own earlier passes. */
  caseId: string
  captures: number
  targets: number
  fillers: number
  queries: EvalQuery[]
  scored: ScoredQuery[]
  latency: PathLatency[]
  /** The latency of earlier measure passes over the same built Case, oldest first. */
  earlierLatency: PathLatency[][]
  /** Pages of each index table, from SQLite's dbstat, after the full rebuilds and before re-indexing. */
  indexSizes: IndexSize[]
  /** Full rebuild of the Extracted Text index, in milliseconds. */
  fullRebuildMs: number
  /** Median time to re-index one Capture's text, in milliseconds. */
  incrementalMedianMs: number | null
  fieldIndex: FieldIndexReport
  checks: CheckTally
  unreviewed: UnreviewedMeasure
}

function cell(value: string | number | boolean | null): string {
  if (value === null) return '-'
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  return String(value)
}

function ms(value: number | null): string {
  return value === null ? '-' : value.toFixed(2)
}

const GROUP_TITLES: Record<UnreviewedGroup, string> = {
  from: 'From',
  'reply-to': 'Reply-To',
  'link-host': 'Link host',
  rare: 'Rare identifiers'
}

function latencyKey(row: PathLatency): string {
  return `${row.path}\u0000${row.queryId}`
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
  lines.push(
    '| Query | Path | First rank | Top 5 | Top 20 | Returned | Passed | Cut at limit | Unavailable | Error |'
  )
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const scored of report.scored) {
    lines.push(
      `| ${scored.queryId} | ${scored.path} | ${cell(scored.firstRank)} | ${cell(scored.top5)} | ` +
        `${cell(scored.top20)} | ${scored.returned} | ${cell(scored.passed)} | ` +
        `${cell(scored.truncated ?? null)} | ${cell(scored.unavailable ?? null)} | ${scored.error ?? ''} |`
    )
  }
  lines.push('')
  for (const query of report.queries) {
    lines.push(`- \`${query.id}\`: \`${query.text}\`, ${query.tests}.`)
  }
  lines.push('')

  const passes = [...report.earlierLatency, report.latency].map(
    (pass) => new Map(pass.map((row) => [latencyKey(row), row]))
  )
  lines.push('## Latency', '')
  lines.push(
    `| Path | Query | ${passes
      .map((_, i) => `Pass ${i + 1} median (ms) | Pass ${i + 1} 95th percentile (ms)`)
      .join(' | ')} | Samples |`
  )
  lines.push(`| --- | --- | ${passes.map(() => '--- | ---').join(' | ')} | --- |`)
  for (const latency of report.latency) {
    const cells = passes.map((pass) => {
      const row = pass.get(latencyKey(latency))
      return `${ms(row?.medianMs ?? null)} | ${ms(row?.p95Ms ?? null)}`
    })
    lines.push(
      `| ${latency.path} | ${latency.queryId} | ${cells.join(' | ')} | ${latency.samples} |`
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

  const { checks } = report
  lines.push('## Exact check of every Field search hit', '')
  lines.push('| Query | Present | Absent | Cannot check |')
  lines.push('| --- | --- | --- | --- |')
  for (const row of checks.byQuery) {
    lines.push(`| ${row.queryId} | ${row.present} | ${row.absent} | ${row.cannotCheck} |`)
  }
  lines.push('')
  lines.push(
    `- In all: ${checks.present} present, ${checks.absent} absent, ${checks.cannotCheck} cannot ` +
      `be checked. False locators (absent or cannot be checked): ${checks.falseLocators}.`
  )
  for (const { reason, count } of checks.reasons) {
    lines.push(`- Cannot be checked, ${count}: ${reason}`)
  }
  const missed = misses(report.scored, FIELD_SEARCH, report.queries)
  lines.push(
    `- Misses, queries whose expected targets Field search did not return: ${
      missed.length > 0 ? missed.join(', ') : 'none'
    }.`
  )
  lines.push('')

  const { unreviewed } = report
  lines.push('## Unreviewed view', '')
  lines.push(
    `${unreviewed.total} of ${unreviewed.captures} committed Captures have no live Note and no ` +
      `Persisted Match. ${unreviewed.ungrouped} are under no row, ${unreviewed.notCurrent} have ` +
      `no current field records, and ${unreviewed.partial} have a partial build. Rare ` +
      `identifiers are those found in at most ${unreviewed.rareLimit} Captures.`
  )
  lines.push('')
  lines.push('| Group | Rows | Captures listed |')
  lines.push('| --- | --- | --- |')
  for (const group of unreviewed.groups) {
    lines.push(`| ${GROUP_TITLES[group.group]} | ${group.rows} | ${group.captures} |`)
  }
  lines.push('')
  lines.push(
    `- Captures under at least one row: ${unreviewed.listed}. Targets among them: ${
      unreviewed.listedTargets.length > 0 ? unreviewed.listedTargets.join(', ') : 'none'
    }.`
  )
  for (const placement of unreviewed.placements) {
    lines.push(
      `- \`${placement.target}\` under ${GROUP_TITLES[placement.group]} \`${placement.key}\`: ` +
        `${cell(placement.listed)}.`
    )
  }
  lines.push(`- The view's read, median: ${ms(unreviewed.readMedianMs)} ms.`)
  lines.push('')
  return lines.join('\n')
}

/** The path name of the slice's own search. */
export const FIELD_SEARCH = 'Field search'
