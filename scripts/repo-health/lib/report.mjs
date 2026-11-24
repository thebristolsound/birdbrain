// Turns collected signals into the health report: a status per signal, the
// comparison with the previous run, the state block that carries one run's values
// to the next, and the text and Markdown renderings.
//
// Three statuses, and only one of them is good. `within` needs a value on the
// right side of its budget. `outside` is a value past it. `not measured` is a
// signal that could not be read, which is never shown as zero and never counted
// as within budget.

export const SCHEMA_VERSION = 1
export const STATUSES = ['within', 'outside', 'not measured']

const STATE_OPEN = '<!-- repo-health-state:v1'
const STATE_CLOSE = '-->'
// The form Date.prototype.toISOString writes, which is how a run records its time.
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

export const statusOf = ({ value, budget, better }) => {
  if (value === null) return 'not measured'
  const ok = better === 'higher' ? value >= budget : value <= budget
  return ok ? 'within' : 'outside'
}

const round2 = (number) => Math.round(number * 100) / 100

export const formatValue = (value, unit) => {
  if (value === null) return 'not measured'
  return unit === 'percent' ? `${value.toFixed(2)}%` : String(value)
}

export const formatBudget = ({ budget, unit, better }) =>
  `${better === 'higher' ? '>=' : '<='} ${formatValue(budget, unit)}`

// How the value moved since the previous run. `previous` is null when no earlier
// value could be read, and that never reads as "unchanged".
export const directionOf = ({ value, unit, better }, previous) => {
  if (value === null) return 'not measured'
  if (previous === null || previous === undefined) return 'no previous value'
  const delta = round2(value - previous)
  if (delta === 0) return 'unchanged'
  const improved = better === 'higher' ? delta > 0 : delta < 0
  return `${improved ? 'better' : 'worse'} by ${formatValue(Math.abs(delta), unit)}`
}

// Room between a value and its budget, so a cleanup can be locked in by lowering
// the budget in the same pull request or the next.
export const headroomOf = ({ value, budget, unit, status }) => {
  if (status !== 'within') return null
  const room = round2(Math.abs(budget - value))
  return room === 0 ? null : `the budget can tighten by ${formatValue(room, unit)}`
}

export const buildReport = ({ commit, dirty, measuredAt, results }) => {
  const signals = results.map((result) => ({ ...result, status: statusOf(result) }))
  const count = (status) => signals.filter((signal) => signal.status === status).length
  return {
    schemaVersion: SCHEMA_VERSION,
    commit,
    dirty,
    measuredAt,
    counts: {
      within: count('within'),
      outside: count('outside'),
      notMeasured: count('not measured')
    },
    signals
  }
}

export const titleOf = ({ counts, signals }) =>
  `Repository health: ${counts.outside} outside budget, ${counts.notMeasured} not measured ` +
  `(${signals.length} signals)`

// The block holds numbers, a commit, a timestamp and status names only, so
// nothing in it can close the comment early.
export const encodeState = ({ measuredAt, commit, signals }) => {
  const state = {
    schemaVersion: SCHEMA_VERSION,
    measuredAt,
    commit,
    signals: Object.fromEntries(signals.map(({ id, value, status }) => [id, { value, status }]))
  }
  return `${STATE_OPEN}\n${JSON.stringify(state)}\n${STATE_CLOSE}`
}

const stateProblem = (state) => {
  if (state === null || typeof state !== 'object' || Array.isArray(state)) {
    return 'the state block is not an object'
  }
  if (state.schemaVersion !== SCHEMA_VERSION) return 'the state block has another schema version'
  const { signals } = state
  if (signals === null || typeof signals !== 'object' || Array.isArray(signals)) {
    return 'the state block has no signals'
  }
  for (const entry of Object.values(signals)) {
    if (!STATUSES.includes(entry?.status)) return 'the state block has an unknown status'
    const measured = typeof entry.value === 'number' && Number.isFinite(entry.value)
    if (entry.status === 'not measured' ? entry.value !== null : !measured) {
      return 'the state block has a value that does not fit its status'
    }
  }
  if (typeof state.measuredAt !== 'string' || !TIMESTAMP.test(state.measuredAt)) {
    return 'the state block has no run time'
  }
  return null
}

// Reads the previous run's values out of an issue body. Anyone who can edit the
// issue can edit the block, so every field the report reads is checked, the run
// time included because the body prints it, and anything unexpected gives
// { state: null, reason }: no previous values, never "unchanged".
export const decodeState = (body) => {
  if (typeof body !== 'string') return { state: null, reason: 'no previous report was found' }
  const start = body.lastIndexOf(STATE_OPEN)
  if (start === -1) return { state: null, reason: 'the previous report has no state block' }
  const from = start + STATE_OPEN.length
  const end = body.indexOf(STATE_CLOSE, from)
  if (end === -1) return { state: null, reason: 'the state block is not closed' }
  let state
  try {
    state = JSON.parse(body.slice(from, end))
  } catch {
    return { state: null, reason: 'the state block is not JSON' }
  }
  const problem = stateProblem(state)
  return problem ? { state: null, reason: problem } : { state, reason: null }
}

export const previousValueOf = (state, id) => state?.signals?.[id]?.value ?? null

// The signals whose status differs from the stored one. A value that moves while
// its status holds is not a change, so a standing condition is reported once. A
// signal the previous run did not have is a change only when it arrives outside
// its budget or unread. With no previous state nothing can be compared, and the
// caller says so instead of reading the empty list as a quiet week.
export const statusChanges = (report, state) => {
  if (!state) return []
  return report.signals.flatMap(({ id, label, status }) => {
    const from = state.signals[id]?.status ?? null
    if (from === status || (from === null && status === 'within')) return []
    return [{ id, label, from, to: status }]
  })
}

const detailOf = (signal) => [signal.reason, signal.note, headroomOf(signal)].filter(Boolean)

const summaryLine = ({ counts, signals }) =>
  `${signals.length} signals: ${counts.within} within budget, ${counts.outside} outside budget, ` +
  `${counts.notMeasured} not measured`

export const renderText = (report, state = null) => {
  const head = [
    `commit ${report.commit.slice(0, 12)}${report.dirty ? ' (tracked files differ from it)' : ''}, ` +
      `measured ${report.measuredAt}`,
    summaryLine(report)
  ]
  const rows = report.signals.map((signal) => {
    const cells = [
      signal.status.padEnd(12),
      signal.family.padEnd(12),
      formatValue(signal.value, signal.unit).padStart(12),
      `(${formatBudget(signal)})`.padEnd(12),
      signal.label,
      `[${directionOf(signal, previousValueOf(state, signal.id))}]`
    ]
    const detail = detailOf(signal)
    return `  ${cells.join('  ')}${detail.length > 0 ? `: ${detail.join('; ')}` : ''}`
  })
  return [...head, ...rows].map((line) => `repo-health: ${line}`).join('\n')
}

export const renderJson = (report) => JSON.stringify(report, null, 2)

// The issue body. It ends with the state block the next run reads.
export const renderMarkdown = (
  report,
  { state = null, stateReason = null, runUrl = null } = {}
) => {
  const compared = state
    ? `the run of ${state.measuredAt}`
    : `nothing (${stateReason ?? 'no previous report was found'})`
  const rows = report.signals.map((signal) =>
    [
      signal.family,
      signal.label,
      formatValue(signal.value, signal.unit),
      formatBudget(signal),
      formatValue(previousValueOf(state, signal.id), signal.unit).replace('not measured', '-'),
      directionOf(signal, previousValueOf(state, signal.id)),
      signal.status === 'within' ? 'within' : `**${signal.status}**`
    ].join(' | ')
  )
  const notes = report.signals
    .filter((signal) => detailOf(signal).length > 0)
    .map((signal) => `- **${signal.label}:** ${detailOf(signal).join('; ')}`)
  return [
    'One row per signal. A signal is **outside** when its value is past its budget and ' +
      '**not measured** when it could not be read; neither is a pass. Every weekly run ' +
      'rewrites this issue, and it stays open so each run can compare with the last. ' +
      'Budgets live in `scripts/repo-health/lib/` and change by pull request.',
    '',
    `${summaryLine(report)}.`,
    '',
    `Measured: ${report.measuredAt} at \`${report.commit.slice(0, 12)}\`` +
      `${report.dirty ? ' (tracked files differ from it)' : ''}`,
    `Compared with: ${compared}`,
    '',
    '| Family | Signal | Value | Budget | Previous | Direction | Status |',
    '| --- | --- | ---: | ---: | ---: | --- | --- |',
    ...rows.map((row) => `| ${row} |`),
    ...(notes.length > 0 ? ['', 'Notes:', '', ...notes] : []),
    ...(runUrl ? ['', `Run: ${runUrl}`] : []),
    '',
    encodeState(report),
    ''
  ].join('\n')
}
