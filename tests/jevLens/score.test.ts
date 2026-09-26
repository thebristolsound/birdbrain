import { describe, expect, it } from 'vitest'
import {
  hunkRows,
  main,
  render,
  triageAgreement
  // @ts-expect-error - tooling script with no type declarations; the tsconfigs exclude scripts/
} from '../../scripts/jev-lens/score.mjs'

const issues = [
  { number: 1, labels: ['lens:agent', 'ready-for-agent'] },
  { number: 2, labels: ['lens:agent', 'ready-for-human'] },
  { number: 3, labels: ['lens:human', 'ready-for-human', 'lens:process', 'process'] },
  { number: 4, labels: ['lens:human'] },
  { number: 5, labels: ['ready-for-agent'] },
  { number: 6, labels: ['lens:process', 'lens:needs-info', 'needs-info'] }
]

describe('triageAgreement', () => {
  it('scores only issues both sides routed, per pair and overall', () => {
    const t = triageAgreement(issues)
    expect(t.routed).toBe(4)
    expect(t.agreement).toBe(0.75)
    expect(t.disagreements).toEqual([2])
    const agent = t.rows.find((r: { lens: string }) => r.lens === 'lens:agent')
    expect(agent).toMatchObject({ lensSaid: 2, humanSaid: 1, both: 1, precision: 0.5, recall: 1 })
    const proc = t.rows.find((r: { lens: string }) => r.lens === 'lens:process')
    expect(proc).toMatchObject({ lensSaid: 2, humanSaid: 1, both: 1 })
    expect(triageAgreement([]).agreement).toBeNull()
  })
})

describe('hunkRows and render', () => {
  it('pairs each status with the label the PR ended with', () => {
    const rows = hunkRows([
      { number: 9, labels: ['evidence-affecting'], status: '3 blocking hits; 2 read incidental (0.02, 0.07); export.ts 0.63' },
      { number: 10, labels: [], status: null }
    ])
    expect(rows).toEqual([{ pr: 9, evidenceLabel: true, incidental: '2', status: '3 blocking hits; 2 read incidental (0.02, 0.07); export.ts 0.63' }])
    const text = render({ triage: triageAgreement(issues), hunks: rows })
    expect(text).toContain('Triage lens: 4 issues routed by both; agreement 75%')
    expect(text).toContain('disagreements: #2')
    expect(text).toContain('#9 evidence-affecting — 3 blocking hits')
    expect(render({ triage: triageAgreement([]), hunks: [] })).toContain('agreement –')
  })
})

describe('main', () => {
  it('collects issues and PR statuses through gh and prints the report', () => {
    const logs: string[] = []
    const exec = (_: string, args: string[]) => {
      if (args[0] === 'api' && args[1] === '--paginate') return JSON.stringify(issues)
      if (args[0] === 'pr') return JSON.stringify([{ number: 9, sha: 'abc', labels: ['agent-authored'] }])
      if (args[0] === 'api') return '1 blocking hit; 1 read incidental (0.03)\n'
      throw new Error(`unexpected ${args.join(' ')}`)
    }
    expect(main({ exec, repo: 'o/r', argv: [], log: (s: string) => logs.push(s) })).toBe(0)
    expect(logs[0]).toContain('agreement 75%')
    expect(logs[0]).toContain('#9 unlabelled — 1 blocking hit')
    main({ exec, repo: 'o/r', argv: ['--json'], log: (s: string) => logs.push(s) })
    expect(JSON.parse(logs[1]).hunks[0].pr).toBe(9)
  })
})
