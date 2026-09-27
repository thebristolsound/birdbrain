import { describe, expect, it } from 'vitest'
// @ts-expect-error - tooling script with no type declarations; the tsconfigs exclude scripts/
import { mean, noiseFloor, paired, sd } from '../../scripts/bench/review/lib/stats.mjs'
import {
  buildReport,
  compareLevels,
  renderMarkdown,
  selectLevel,
  usageOf
  // @ts-expect-error - tooling script with no type declarations; the tsconfigs exclude scripts/
} from '../../scripts/bench/review/report.mjs'

describe('stats', () => {
  it('mean, sd and the noise floor', () => {
    expect(mean([])).toBeNull()
    expect(mean([1, 2, 3])).toBe(2)
    expect(sd([1])).toBeNull()
    expect(sd([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3)
    expect(noiseFloor(5, 3)).toBeCloseTo(0.258, 3)
    expect(noiseFloor(0, 3)).toBeNull()
  })

  it('paired differences: an interval covering zero is no difference', () => {
    expect(paired([])).toMatchObject({ n: 0, different: null })
    expect(paired([1, 1, 1])).toMatchObject({ n: 3, mean: 1, lo: 1, hi: 1, different: true })
    expect(paired([0, 0])).toMatchObject({ mean: 0, different: false })
    const wide = paired([1, -1, 1, -1])
    expect(wide.mean).toBe(0)
    expect(wide.different).toBe(false)
    const tight = paired([0.9, 1, 1.1, 1, 0.95, 1.05])
    expect(tight.different).toBe(true)
    expect(tight.lo).toBeGreaterThan(0)
  })
})

const graded = (
  kase: string,
  rep: number,
  verdictCorrect: boolean,
  blockersMatched: number,
  blockersTotal = 1
) => ({
  case: kase,
  rep,
  status: 'ok',
  verdictCorrect,
  blockersMatched,
  blockersTotal
})

describe('compareLevels', () => {
  it('pairs rows by case and rep and skips rows missing on either side', () => {
    const a = [
      graded('c', 1, false, 0),
      graded('d', 1, true, 1),
      { case: 'e', rep: 1, status: 'error' }
    ]
    const b = [
      graded('c', 1, true, 1),
      graded('d', 1, true, 1),
      graded('e', 1, true, 1),
      graded('c', 2, true, 1)
    ]
    const r = compareLevels(a, b)
    expect(r.verdict.n).toBe(2)
    expect(r.verdict.mean).toBe(0.5)
    expect(r.blockers.mean).toBe(0.5)
  })

  it('leaves blocker recall out for cases with no blocker', () => {
    const r = compareLevels([graded('c', 1, true, 0, 0)], [graded('c', 1, false, 0, 0)])
    expect(r.verdict.n).toBe(1)
    expect(r.blockers.n).toBe(0)
  })
})

describe('selectLevel', () => {
  const level = (effort: string, verdictAccuracy: number | null, blockerRecall: number | null) => ({
    effort,
    summary: { verdictAccuracy, blockerRecall }
  })

  it('takes the lowest level within the floor of the best', () => {
    const levels = [
      level('low', 0.6, 0.5),
      level('medium', 0.8, 0.9),
      level('high', 1.0, 1.0),
      level('max', 1.0, 0.9)
    ]
    expect(selectLevel(levels, 0.26)).toEqual({ best: 'high', selected: 'medium' })
    expect(selectLevel(levels, 0.05)).toEqual({ best: 'high', selected: 'high' })
    expect(selectLevel(levels, 0.5)).toEqual({ best: 'high', selected: 'low' })
  })

  it('ignores levels with no ok rows and reports none when nothing scored', () => {
    expect(selectLevel([level('low', null, null), level('high', 0.5, 0.5)], 0.3)).toEqual({
      best: 'high',
      selected: 'high'
    })
    expect(selectLevel([level('low', null, null)], 0.3)).toEqual({ best: null, selected: null })
  })
})

describe('buildReport', () => {
  const head = 'a'.repeat(40)
  const fixtures = new Map([
    [
      'c',
      {
        id: 'c',
        source: { head },
        truth: {
          verdict: 'request changes',
          defects: [{ id: 'd', file: 'x', lineStart: 5, lineEnd: 5, blocking: true }],
          refuted: []
        }
      }
    ]
  ])
  const row = (effort: string, rep: number, line: number, extra: object = {}) => ({
    case: 'c',
    head,
    harness: 'claude',
    model: 'm',
    tier: 'L1',
    effort,
    rep,
    manifest: effort,
    status: 'ok',
    wallMs: 1000,
    toolCalls: 2,
    usage: { input_tokens: 10, cache_read_input_tokens: 90, output_tokens: 5 },
    rateLimit: { five_hour: { utilization: 0.1 } },
    output: {
      verdict: 'request changes',
      findings: [{ file: 'x', line, summary: 's', blocking: true }]
    },
    ...extra
  })
  const runs = [
    {
      id: 'low',
      manifest: { harness: 'claude', model: 'm', tier: 'L1', effort: 'low' },
      rows: [row('low', 1, 40), row('low', 2, 40)]
    },
    {
      id: 'high',
      manifest: { harness: 'claude', model: 'm', tier: 'L1', effort: 'high' },
      rows: [row('high', 1, 5), row('high', 2, 5, { outputSource: 'text' })]
    },
    {
      id: 'other',
      manifest: { harness: 'codex', model: 'g', tier: 'L0', effort: 'low' },
      rows: [row('low', 1, 5, { harness: 'codex', model: 'g', tier: 'L0' })]
    }
  ]
  const readFileFor = () => () => 'line\n'.repeat(50)

  it('groups by harness, model and tier, orders levels, compares neighbours and selects', () => {
    const report = buildReport(runs, fixtures, readFileFor)
    expect(report.map((g: { config: string }) => g.config)).toEqual(['claude/m/L1', 'codex/g/L0'])
    const g = report[0]
    expect(g.levels.map((l: { effort: string }) => l.effort)).toEqual(['low', 'high'])
    expect(g.levels[0].summary.blockerRecall).toBe(0)
    expect(g.levels[1].summary.blockerRecall).toBe(1)
    expect(g.levels[1].usage).toMatchObject({
      inputTokens: 100,
      outputTokens: 5,
      wallMs: 1000,
      toolCalls: 2,
      textRecovered: 1,
      windowFirst: 0.1
    })
    expect(g.adjacent).toHaveLength(1)
    expect(g.adjacent[0]).toMatchObject({ from: 'low', to: 'high' })
    expect(g.adjacent[0].blockers.mean).toBe(1)
    expect(g.best).toBe('high')
    expect(g.selected).toBe('high')
    expect(buildReport(runs, fixtures, readFileFor, { tier: 'L0' })).toHaveLength(1)
    expect(usageOf([])).toMatchObject({ inputTokens: null, windowFirst: null })
  })

  it('renders one markdown section per config', () => {
    const md = renderMarkdown(buildReport(runs, fixtures, readFileFor))
    expect(md).toContain('## claude/m/L1')
    expect(md).toContain('| low → high |')
    expect(md).toContain('Best level high, selected high')
  })
})
