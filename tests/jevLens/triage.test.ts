import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BODY_CAP,
  LENS_LABELS,
  QUESTIONS,
  labelPlan,
  lensLabelsFor,
  main,
  renderSummary,
  shouldSkip
  // @ts-expect-error - tooling script with no type declarations; the tsconfigs exclude scripts/
} from '../../scripts/jev-lens/triage.mjs'

const answers = (route: string, confidence: number, process: number) => ({
  route: { type: 'choice', choice: route, confidence, probabilities: { 'ready-for-agent': route === 'ready-for-agent' ? 0.8 : 0.1, 'ready-for-human': route === 'ready-for-human' ? 0.8 : 0.1, 'needs-info': 0.1 } },
  process: { type: 'noul', noul: process }
})
const issue = (over: Record<string, unknown> = {}) => ({ number: 12, title: 'T', body: 'B', user: { login: 'matt' }, labels: [{ name: 'bug' }], ...over })

describe('shouldSkip', () => {
  it('names the reason, or null when the issue is worth judging', () => {
    expect(shouldSkip(issue(), 'birdbrain-agent')).toBeNull()
    expect(shouldSkip(issue({ pull_request: {} }), 'bot')).toBe('is a pull request')
    expect(shouldSkip(issue({ user: { login: 'bot' } }), 'bot')).toBe('filed by bot')
    expect(shouldSkip(issue({ labels: [{ name: 'bug' }, { name: 'queued' }] }), 'bot')).toBe('already carries queued')
    expect(shouldSkip(issue({ body: '  ' }), 'bot')).toBe('has no body')
    expect(shouldSkip(issue({ body: null }), 'bot')).toBe('has no body')
  })
})

describe('lensLabelsFor and labelPlan', () => {
  it('maps the route to one label and adds process at the threshold', () => {
    expect(lensLabelsFor(answers('ready-for-agent', 0.9, 0.2))).toEqual(['lens:agent'])
    expect(lensLabelsFor(answers('ready-for-human', 0.9, 0.5))).toEqual(['lens:human', 'lens:process'])
    expect(lensLabelsFor(answers('needs-info', 0.4, 0.49))).toEqual(['lens:needs-info'])
    expect(LENS_LABELS).toHaveLength(4)
  })
  it('replaces lens labels and leaves every other label alone', () => {
    expect(labelPlan(['bug', 'lens:human', 'lens:process'], ['lens:agent', 'lens:process'])).toEqual({ add: ['lens:agent'], remove: ['lens:human'] })
    expect(labelPlan(['lens:agent'], ['lens:agent'])).toEqual({ add: [], remove: [] })
  })
})

describe('renderSummary', () => {
  it('carries the route, probabilities, process score and the label plan', () => {
    const s = renderSummary(issue(), answers('ready-for-agent', 0.91, 0.12), { add: ['lens:agent'], remove: [] })
    expect(s).toContain('## Jev triage lens: #12')
    expect(s).toContain('Route: **ready-for-agent** (confidence 0.91; ready-for-agent 0.80, ready-for-human 0.10, needs-info 0.10)')
    expect(s).toContain('Process: 0.12')
    expect(s).toContain('Labels added: lens:agent; removed: none')
  })
})

describe('main', () => {
  const env = { TYPESAFE_API_KEY: 'k', GITHUB_REPOSITORY: 'o/r', ISSUE_NUMBER: '12', MACHINE_LOGIN: 'bot' }
  it('fetches the issue, asks with a capped body, and edits labels', async () => {
    const calls: string[][] = []
    const asked: unknown[] = []
    const dir = mkdtempSync(join(tmpdir(), 'lens-'))
    const summaryFile = join(dir, 'summary.md')
    const exec = (cmd: string, args: string[]) => {
      calls.push([cmd, ...args])
      return args[0] === 'api' ? JSON.stringify(issue({ body: 'x'.repeat(BODY_CAP + 5), labels: [{ name: 'lens:human' }] })) : ''
    }
    const ask = async (state: unknown, questions: unknown) => {
      asked.push(state, questions)
      return { answers: answers('ready-for-agent', 0.9, 0.7) }
    }
    const code = await main({ env: { ...env, GITHUB_STEP_SUMMARY: summaryFile }, exec, ask, log: () => {} })
    expect(code).toBe(0)
    expect(calls[0]).toEqual(['gh', 'api', 'repos/o/r/issues/12'])
    expect(calls[1]).toEqual(['gh', 'issue', 'edit', '12', '--repo', 'o/r', '--add-label', 'lens:agent', '--add-label', 'lens:process', '--remove-label', 'lens:human'])
    expect((asked[0] as { body: string }).body).toContain('[truncated 5 chars]')
    expect(asked[1]).toBe(QUESTIONS)
    expect(readFileSync(summaryFile, 'utf8')).toContain('Route: **ready-for-agent**')
  })

  it('does not edit when the labels already match', async () => {
    const calls: string[][] = []
    const exec = (cmd: string, args: string[]) => {
      calls.push([cmd, ...args])
      return args[0] === 'api' ? JSON.stringify(issue({ labels: [{ name: 'lens:agent' }] })) : ''
    }
    await main({ env, exec, ask: async () => ({ answers: answers('ready-for-agent', 0.9, 0.1) }), log: () => {} })
    expect(calls).toHaveLength(1)
  })

  it('skips routed issues and runs without a key', async () => {
    const logs: string[] = []
    const exec = (_: string, args: string[]) => (args[0] === 'api' ? JSON.stringify(issue({ labels: [{ name: 'ready-for-human' }] })) : '')
    expect(await main({ env, exec, ask: async () => { throw new Error('must not ask') }, log: (s: string) => logs.push(s) })).toBe(0)
    expect(logs[0]).toBe('#12 already carries ready-for-human; lens skipped')
    expect(await main({ env: { ...env, TYPESAFE_API_KEY: '' }, exec: () => { throw new Error('must not run') }, log: (s: string) => logs.push(s) })).toBe(0)
    expect(logs[1]).toContain('lens skipped')
  })
})
