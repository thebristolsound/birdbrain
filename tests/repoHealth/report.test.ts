import { describe, expect, it } from 'vitest'
import {
  SCHEMA_VERSION,
  STATUSES,
  buildReport,
  decodeState,
  directionOf,
  encodeState,
  formatBudget,
  formatValue,
  headroomOf,
  previousValueOf,
  renderJson,
  renderMarkdown,
  renderText,
  statusChanges,
  statusOf,
  titleOf
  // @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
} from '../../scripts/repo-health/lib/report.mjs'

type Result = {
  id: string
  family: string
  label: string
  unit: string
  better: string
  budget: number
  needs: string
  value: number | null
  note: string | null
  reason: string | null
}

const result = (over: Partial<Result> = {}): Result => ({
  id: 'suppressions',
  family: 'code',
  label: 'Suppressions',
  unit: 'count',
  better: 'lower',
  budget: 10,
  needs: 'tree',
  value: 10,
  note: null,
  reason: null,
  ...over
})

const COVERAGE = {
  id: 'coverage',
  label: 'Coverage',
  unit: 'percent',
  better: 'higher',
  budget: 95
}

const reportOf = (...results: Result[]) =>
  buildReport({
    commit: 'abc1234',
    dirty: false,
    measuredAt: '2026-11-23T09:13:00.000Z',
    results
  })

const stateOf = (signals: Record<string, { value: number | null; status: string }>) => ({
  schemaVersion: 1,
  measuredAt: '2026-11-16T09:13:00.000Z',
  commit: 'def5678',
  signals
})

const block = (payload: string) => `Body text.\n\n<!-- repo-health-state:v1\n${payload}\n-->\n`

describe('statusOf', () => {
  it('is within at and below a lower-is-better budget, and outside above it', () => {
    expect(statusOf({ value: 9, budget: 10, better: 'lower' })).toBe('within')
    expect(statusOf({ value: 10, budget: 10, better: 'lower' })).toBe('within')
    expect(statusOf({ value: 11, budget: 10, better: 'lower' })).toBe('outside')
  })

  it('is within at and above a higher-is-better budget, and outside below it', () => {
    expect(statusOf({ value: 95.5, budget: 95, better: 'higher' })).toBe('within')
    expect(statusOf({ value: 95, budget: 95, better: 'higher' })).toBe('within')
    expect(statusOf({ value: 94.99, budget: 95, better: 'higher' })).toBe('outside')
  })

  it('is never within for a value that could not be read, in either direction', () => {
    expect(statusOf({ value: null, budget: 10, better: 'lower' })).toBe('not measured')
    expect(statusOf({ value: null, budget: 0, better: 'higher' })).toBe('not measured')
  })
})

describe('formatting', () => {
  it('prints counts as they are and percentages to two places', () => {
    expect(formatValue(14, 'count')).toBe('14')
    expect(formatValue(0, 'count')).toBe('0')
    expect(formatValue(95.9, 'percent')).toBe('95.90%')
  })

  it('never prints a missing value as a number', () => {
    expect(formatValue(null, 'count')).toBe('not measured')
    expect(formatValue(null, 'percent')).toBe('not measured')
  })

  it('writes the budget with the side that is allowed', () => {
    expect(formatBudget({ budget: 14, unit: 'count', better: 'lower' })).toBe('<= 14')
    expect(formatBudget({ budget: 95, unit: 'percent', better: 'higher' })).toBe('>= 95.00%')
  })
})

describe('directionOf', () => {
  it('names the move by whether it helped, for both kinds of signal', () => {
    expect(directionOf(result({ value: 12 }), 10)).toBe('worse by 2')
    expect(directionOf(result({ value: 7 }), 10)).toBe('better by 3')
    expect(directionOf(result({ ...COVERAGE, value: 96.5 }), 95.93)).toBe('better by 0.57%')
    expect(directionOf(result({ ...COVERAGE, value: 95 }), 95.93)).toBe('worse by 0.93%')
  })

  it('is unchanged only when a previous value exists and equals this one', () => {
    expect(directionOf(result({ value: 10 }), 10)).toBe('unchanged')
    expect(directionOf(result({ value: 0 }), 0)).toBe('unchanged')
  })

  it('says there is no previous value, and never calls that unchanged', () => {
    expect(directionOf(result({ value: 10 }), null)).toBe('no previous value')
    expect(directionOf(result({ value: 10 }), undefined)).toBe('no previous value')
    expect(directionOf(result({ value: 0 }), null)).toBe('no previous value')
  })

  it('has no direction for a value that was not read this time', () => {
    expect(directionOf(result({ value: null }), 10)).toBe('not measured')
  })
})

describe('headroomOf', () => {
  it('says how far a budget can tighten when the value sits inside it', () => {
    expect(headroomOf({ value: 7, budget: 10, unit: 'count', status: 'within' })).toBe(
      'the budget can tighten by 3'
    )
    expect(headroomOf({ value: 96.5, budget: 95, unit: 'percent', status: 'within' })).toBe(
      'the budget can tighten by 1.50%'
    )
  })

  it('says nothing at the budget, outside it, or without a value', () => {
    expect(headroomOf({ value: 10, budget: 10, unit: 'count', status: 'within' })).toBeNull()
    expect(headroomOf({ value: 12, budget: 10, unit: 'count', status: 'outside' })).toBeNull()
    expect(
      headroomOf({ value: null, budget: 10, unit: 'count', status: 'not measured' })
    ).toBeNull()
  })
})

describe('buildReport', () => {
  const report = reportOf(
    result({ id: 'a', value: 3 }),
    result({ id: 'b', value: 11 }),
    result({ id: 'c', value: null, reason: 'knip is not installed' }),
    result({ id: 'd', value: null, reason: 'the measurement failed; see the run log' })
  )

  it('gives every signal a status and counts each kind', () => {
    expect(report.signals.map((signal: { status: string }) => signal.status)).toEqual([
      'within',
      'outside',
      'not measured',
      'not measured'
    ])
    expect(report.counts).toEqual({ within: 1, outside: 1, notMeasured: 2 })
    expect(report).toMatchObject({
      schemaVersion: SCHEMA_VERSION,
      commit: 'abc1234',
      dirty: false,
      measuredAt: '2026-11-23T09:13:00.000Z'
    })
  })

  it('puts the two counts that need attention in the title', () => {
    expect(titleOf(report)).toBe('Repository health: 1 outside budget, 2 not measured (4 signals)')
    expect(titleOf(reportOf(result()))).toBe(
      'Repository health: 0 outside budget, 0 not measured (1 signals)'
    )
  })
})

describe('state block', () => {
  const report = reportOf(
    result({ id: 'a', value: 3 }),
    result({ id: 'b', value: 11 }),
    result({ id: 'c', value: null, reason: 'knip is not installed' })
  )

  it('round-trips the values and statuses through an issue body', () => {
    const { state, reason } = decodeState(`Report text.\n\n${encodeState(report)}\n`)
    expect(reason).toBeNull()
    expect(state).toEqual({
      schemaVersion: 1,
      measuredAt: '2026-11-23T09:13:00.000Z',
      commit: 'abc1234',
      signals: {
        a: { value: 3, status: 'within' },
        b: { value: 11, status: 'outside' },
        c: { value: null, status: 'not measured' }
      }
    })
  })

  it('reads the last block when a body somehow holds two', () => {
    const older = encodeState(reportOf(result({ id: 'a', value: 1 })))
    const { state } = decodeState(`${older}\n\n${encodeState(report)}`)
    expect(previousValueOf(state, 'a')).toBe(3)
  })

  it('has no state, with the reason, when there is no body or no block', () => {
    expect(decodeState(undefined)).toEqual({
      state: null,
      reason: 'no previous report was found'
    })
    expect(decodeState(null)).toEqual({ state: null, reason: 'no previous report was found' })
    expect(decodeState('A body someone rewrote by hand.')).toEqual({
      state: null,
      reason: 'the previous report has no state block'
    })
  })

  it('has no state when the block is cut off or is not JSON', () => {
    expect(decodeState('<!-- repo-health-state:v1\n{"schemaVersion":1')).toEqual({
      state: null,
      reason: 'the state block is not closed'
    })
    expect(decodeState(block('{"schemaVersion":1,'))).toEqual({
      state: null,
      reason: 'the state block is not JSON'
    })
  })

  it('has no state when the block is not the object it expects', () => {
    for (const payload of ['null', '[]', '"text"', '7']) {
      expect(decodeState(block(payload))).toEqual({
        state: null,
        reason: 'the state block is not an object'
      })
    }
    expect(decodeState(block('{"schemaVersion":2,"signals":{}}'))).toEqual({
      state: null,
      reason: 'the state block has another schema version'
    })
    for (const signals of ['null', '[]', '"x"']) {
      expect(decodeState(block(`{"schemaVersion":1,"signals":${signals}}`))).toEqual({
        state: null,
        reason: 'the state block has no signals'
      })
    }
    expect(decodeState(block('{"schemaVersion":1}')).reason).toBe('the state block has no signals')
  })

  it('has no state when one entry carries an unknown status', () => {
    for (const entry of ['{"value":1,"status":"fine"}', '{"value":1}', 'null', '3']) {
      expect(decodeState(block(`{"schemaVersion":1,"signals":{"a":${entry}}}`))).toEqual({
        state: null,
        reason: 'the state block has an unknown status'
      })
    }
  })

  it('has no state when a value does not fit its status', () => {
    const entries = [
      '{"value":"12","status":"within"}',
      '{"value":null,"status":"within"}',
      '{"value":null,"status":"outside"}',
      '{"status":"within"}',
      '{"value":0,"status":"not measured"}',
      '{"value":1e999,"status":"outside"}'
    ]
    for (const entry of entries) {
      expect(decodeState(block(`{"schemaVersion":1,"signals":{"a":${entry}}}`))).toEqual({
        state: null,
        reason: 'the state block has a value that does not fit its status'
      })
    }
  })

  it('accepts an empty signals object as a readable state', () => {
    const payload = '{"schemaVersion":1,"measuredAt":"2026-11-16T09:13:00.000Z","signals":{}}'
    expect(decodeState(block(payload)).state).toEqual({
      schemaVersion: 1,
      measuredAt: '2026-11-16T09:13:00.000Z',
      signals: {}
    })
  })

  it('has no state when the run time is missing or is not a timestamp, since the body prints it', () => {
    for (const measuredAt of ['', ', "measuredAt":7', ', "measuredAt":{"a":1}']) {
      expect(decodeState(block(`{"schemaVersion":1,"signals":{}${measuredAt}}`))).toEqual({
        state: null,
        reason: 'the state block has no run time'
      })
    }
    for (const text of ['x @someone', '2026-11-16', '2026-11-16T09:13:00.000Z @someone']) {
      const payload = JSON.stringify({ schemaVersion: 1, measuredAt: text, signals: {} })
      expect(decodeState(block(payload)).reason).toBe('the state block has no run time')
    }
  })

  it('has no previous value without a state, or for a signal the state does not hold', () => {
    expect(previousValueOf(null, 'a')).toBeNull()
    expect(previousValueOf(stateOf({}), 'a')).toBeNull()
    expect(previousValueOf(stateOf({ a: { value: null, status: 'not measured' } }), 'a')).toBeNull()
    expect(previousValueOf(stateOf({ a: { value: 0, status: 'within' } }), 'a')).toBe(0)
  })

  it('knows exactly three statuses', () => {
    expect(STATUSES).toEqual(['within', 'outside', 'not measured'])
  })
})

describe('statusChanges', () => {
  const now = reportOf(
    result({ id: 'steady', label: 'Steady', value: 10 }),
    result({ id: 'crossed', label: 'Crossed', value: 12 }),
    result({ id: 'recovered', label: 'Recovered', value: 9 }),
    result({ id: 'lost', label: 'Lost', value: null, reason: 'knip is not installed' }),
    result({ id: 'still-out', label: 'Still out', value: 30 }),
    result({ id: 'still-lost', label: 'Still lost', value: null, reason: 'no gh token' })
  )
  const before = stateOf({
    steady: { value: 8, status: 'within' },
    crossed: { value: 10, status: 'within' },
    recovered: { value: 14, status: 'outside' },
    lost: { value: 4, status: 'within' },
    'still-out': { value: 20, status: 'outside' },
    'still-lost': { value: null, status: 'not measured' }
  })

  it('lists a crossing, a recovery and a signal that stopped being read', () => {
    expect(statusChanges(now, before)).toEqual([
      { id: 'crossed', label: 'Crossed', from: 'within', to: 'outside' },
      { id: 'recovered', label: 'Recovered', from: 'outside', to: 'within' },
      { id: 'lost', label: 'Lost', from: 'within', to: 'not measured' }
    ])
  })

  it('does not list a value that moved while its status held', () => {
    const ids = statusChanges(now, before).map((change: { id: string }) => change.id)
    expect(ids).not.toContain('steady')
    expect(ids).not.toContain('still-out')
    expect(ids).not.toContain('still-lost')
  })

  it('lists a signal the last run did not have only when it arrives needing attention', () => {
    const fresh = reportOf(
      result({ id: 'new-ok', label: 'New and fine', value: 1 }),
      result({ id: 'new-out', label: 'New and out', value: 99 }),
      result({ id: 'new-lost', label: 'New and unread', value: null, reason: 'no gh token' })
    )
    expect(statusChanges(fresh, stateOf({}))).toEqual([
      { id: 'new-out', label: 'New and out', from: null, to: 'outside' },
      { id: 'new-lost', label: 'New and unread', from: null, to: 'not measured' }
    ])
  })

  it('compares nothing without a previous state', () => {
    expect(statusChanges(now, null)).toEqual([])
  })
})

describe('renderText', () => {
  const report = reportOf(
    result({ id: 'a', label: 'Alpha', value: 7, note: 'of 20 file(s)' }),
    result({ id: 'b', label: 'Beta', value: 12 }),
    result({ id: 'c', label: 'Gamma', value: null, reason: 'knip is not installed' })
  )
  const text = renderText(report)
  const lineFor = (label: string, body = text) =>
    body.split('\n').find((line: string) => line.includes(label)) ?? ''

  it('prefixes every line with the tool name', () => {
    for (const line of text.split('\n')) expect(line.startsWith('repo-health: ')).toBe(true)
  })

  it('leads with the commit and the three counts', () => {
    expect(text.split('\n')[0]).toBe(
      'repo-health: commit abc1234, measured 2026-11-23T09:13:00.000Z'
    )
    expect(text.split('\n')[1]).toBe(
      'repo-health: 3 signals: 1 within budget, 1 outside budget, 1 not measured'
    )
  })

  it('says when tracked files differ from the commit it names', () => {
    const dirty = buildReport({ commit: 'abc1234', dirty: true, measuredAt: 'now', results: [] })
    expect(renderText(dirty).split('\n')[0]).toContain('abc1234 (tracked files differ from it)')
  })

  it('shows the value, the budget, the note and the room to tighten', () => {
    expect(lineFor('Alpha')).toMatch(/within\s+code\s+7\s+\(<= 10\)\s+Alpha/)
    expect(lineFor('Alpha')).toContain(': of 20 file(s); the budget can tighten by 3')
    expect(lineFor('Beta')).toMatch(/outside\s+code\s+12\s+\(<= 10\)\s+Beta/)
  })

  it('shows an unread signal as not measured with its reason, and never as a number', () => {
    expect(lineFor('Gamma')).toMatch(/^repo-health: {3}not measured\s+code\s+not measured\s+\(/)
    expect(lineFor('Gamma')).toContain(': knip is not installed')
    expect(lineFor('Gamma')).not.toMatch(/\s0\s/)
  })

  it('has no previous value for any row when no state is passed', () => {
    expect(lineFor('Alpha')).toContain('[no previous value]')
    expect(lineFor('Beta')).toContain('[no previous value]')
  })

  it('compares with the previous run when a state is passed', () => {
    const compared = renderText(
      report,
      stateOf({ a: { value: 9, status: 'within' }, b: { value: 12, status: 'outside' } })
    )
    expect(lineFor('Alpha', compared)).toContain('[better by 2]')
    expect(lineFor('Beta', compared)).toContain('[unchanged]')
    expect(lineFor('Gamma', compared)).toContain('[not measured]')
  })
})

describe('renderJson', () => {
  it('prints the report as it is', () => {
    const report = reportOf(result({ value: null, reason: 'knip is not installed' }))
    expect(JSON.parse(renderJson(report))).toEqual(report)
    expect(JSON.parse(renderJson(report)).signals[0].value).toBeNull()
  })
})

describe('renderMarkdown', () => {
  const report = reportOf(
    result({ id: 'a', label: 'Alpha', value: 7 }),
    result({ id: 'b', label: 'Beta', value: 12, note: 'for example `x.md`' }),
    result({ id: 'c', label: 'Gamma', value: null, reason: 'knip is not installed' }),
    result({ ...COVERAGE, family: 'tests', value: 96.5 })
  )
  const state = stateOf({
    a: { value: 7, status: 'within' },
    b: { value: 10, status: 'within' },
    c: { value: 4, status: 'within' }
  })
  const rowFor = (body: string, label: string) =>
    body.split('\n').find((line) => line.startsWith('|') && line.includes(label)) ?? ''

  it('has one table row per signal under a seven-column header', () => {
    const body = renderMarkdown(report, { state })
    expect(body).toContain('| Family | Signal | Value | Budget | Previous | Direction | Status |')
    expect(rowFor(body, 'Alpha')).toBe('| code | Alpha | 7 | <= 10 | 7 | unchanged | within |')
    expect(rowFor(body, 'Beta')).toBe(
      '| code | Beta | 12 | <= 10 | 10 | worse by 2 | **outside** |'
    )
    // The header, its separator, and one row for each of the four signals.
    expect(body.split('\n').filter((line: string) => line.startsWith('| ')).length).toBe(6)
  })

  it('shows an unread signal as not measured in bold, never as zero or within', () => {
    const row = rowFor(renderMarkdown(report, { state }), 'Gamma')
    expect(row).toBe(
      '| code | Gamma | not measured | <= 10 | 4 | not measured | **not measured** |'
    )
  })

  it('shows a dash, not a number, where there is no previous value', () => {
    const body = renderMarkdown(report, { state })
    expect(rowFor(body, 'Coverage')).toBe(
      '| tests | Coverage | 96.50% | >= 95.00% | - | no previous value | within |'
    )
  })

  it('says what it compared with, or why it compared with nothing', () => {
    expect(renderMarkdown(report, { state })).toContain(
      'Compared with: the run of 2026-11-16T09:13:00.000Z'
    )
    expect(renderMarkdown(report, { stateReason: 'the state block is not JSON' })).toContain(
      'Compared with: nothing (the state block is not JSON)'
    )
    expect(renderMarkdown(report)).toContain(
      'Compared with: nothing (no previous report was found)'
    )
    expect(rowFor(renderMarkdown(report), 'Alpha')).toContain('| - | no previous value |')
  })

  it('lists reasons, notes and room to tighten under the table', () => {
    const body = renderMarkdown(report, { state })
    expect(body).toContain('- **Alpha:** the budget can tighten by 3')
    expect(body).toContain('- **Beta:** for example `x.md`')
    expect(body).toContain('- **Gamma:** knip is not installed')
    expect(body).toContain('- **Coverage:** the budget can tighten by 1.50%')
  })

  it('has no notes section when no signal has anything to add', () => {
    expect(renderMarkdown(reportOf(result()))).not.toContain('Notes:')
  })

  it('names the commit, flags a dirty tree and links the run when it has one', () => {
    expect(renderMarkdown(report)).toContain('Measured: 2026-11-23T09:13:00.000Z at `abc1234`')
    expect(renderMarkdown(report)).not.toContain('Run: ')
    expect(renderMarkdown(report, { runUrl: 'https://example.com/run/1' })).toContain(
      'Run: https://example.com/run/1'
    )
    const dirty = buildReport({ commit: 'abc1234', dirty: true, measuredAt: 'now', results: [] })
    expect(renderMarkdown(dirty)).toContain('`abc1234` (tracked files differ from it)')
  })

  it('ends with a state block the next run can read back', () => {
    const { state: next, reason } = decodeState(renderMarkdown(report, { state }))
    expect(reason).toBeNull()
    expect(next.signals).toEqual({
      a: { value: 7, status: 'within' },
      b: { value: 12, status: 'outside' },
      c: { value: null, status: 'not measured' },
      coverage: { value: 96.5, status: 'within' }
    })
    expect(statusChanges(report, state).map((change: { id: string }) => change.id)).toEqual([
      'b',
      'c'
    ])
  })
})
