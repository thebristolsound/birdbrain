import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  LIMITS,
  STATUS_CONTEXT,
  describeStatus,
  main,
  planHits,
  renderSummary,
  run,
  splitDiff
  // @ts-expect-error - tooling script with no type declarations; the tsconfigs exclude scripts/
} from '../../scripts/jev-lens/hunks.mjs'

type Entry = { path: string; tier: string; why: string }
const entries: Entry[] = [
  { path: 'src/main/services/export.ts', tier: 'blocking', why: '' },
  { path: 'src/main/services/db/**', tier: 'blocking', why: '' },
  { path: 'src/main/services/settings.ts', tier: 'advisory', why: '' }
]
const file = (path: string, body = '+x') => `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n${body}\n`
const diff = file('src/main/services/export.ts') + file('src/renderer/x.tsx') + file('src/main/services/settings.ts') + file('src/main/services/db/repo.ts', '+'.padEnd(50, 'y'))
const askAt = (values: Record<string, number>) => async (state: { path: string }) => ({ answers: { touches_evidence: { noul: values[state.path] ?? 0.5 } } })

describe('splitDiff and planHits', () => {
  it('keeps only blocking-tier files, in diff order, capped and truncated', () => {
    expect(splitDiff(diff).map((f: { path: string }) => f.path)).toEqual(['src/main/services/export.ts', 'src/renderer/x.tsx', 'src/main/services/settings.ts', 'src/main/services/db/repo.ts'])
    expect(splitDiff('').length).toBe(0)
    const plan = planHits(diff, entries)
    expect(plan).toMatchObject({ total: 2, over: false })
    expect(plan.hits.map((h: { path: string; entry: string; truncated: boolean }) => [h.path, h.entry, h.truncated])).toEqual([
      ['src/main/services/export.ts', 'src/main/services/export.ts', false],
      ['src/main/services/db/repo.ts', 'src/main/services/db/**', false]
    ])
    const tight = planHits(diff, entries, { ...LIMITS, maxHits: 1, maxChars: 60 })
    expect(tight).toMatchObject({ total: 2, over: true })
    expect(tight.hits).toHaveLength(1)
    expect(tight.hits[0].truncated).toBe(true)
    expect(tight.hits[0].text).toContain('[truncated')
  })
})

describe('run, describeStatus and renderSummary', () => {
  it('judges each hit and marks those under the threshold incidental', async () => {
    const out = await run({ diffText: diff, entries, ask: askAt({ 'src/main/services/export.ts': 0.04, 'src/main/services/db/repo.ts': 0.63 }) })
    expect(out.results.map((r: { path: string; incidental: boolean }) => [r.path, r.incidental])).toEqual([
      ['src/main/services/export.ts', true],
      ['src/main/services/db/repo.ts', false]
    ])
    expect(describeStatus(out)).toBe('2 blocking hits; 1 read incidental (0.04); repo.ts 0.63')
    const summary = renderSummary(out)
    expect(summary).toContain(`## ${STATUS_CONTEXT}`)
    expect(summary).toContain('| `src/main/services/export.ts` | `src/main/services/export.ts` | 0.04 | incidental |')
    expect(summary).toContain('| 0.63 | evidence |')
  })

  it('says so when nothing blocking changed, and when the cap was hit', async () => {
    const none = await run({ diffText: file('README.md'), entries, ask: askAt({}) })
    expect(describeStatus(none)).toBe('no blocking-tier file changed')
    expect(renderSummary(none)).toContain('No blocking-tier file changed.')
    const over = await run({ diffText: diff, entries, ask: askAt({}), limits: { ...LIMITS, maxHits: 1 } })
    expect(describeStatus(over, { ...LIMITS, maxHits: 1 })).toBe('2 blocking hits (1 judged, cap 1); 0 read incidental; export.ts 0.50')
    expect(renderSummary(over, { ...LIMITS, maxHits: 1 })).toContain('2 hits, 1 judged (cap 1)')
    expect(describeStatus({ results: [{ path: 'a.ts', p: 0.5, incidental: false }], total: 1, over: false })).toBe('1 blocking hit; 0 read incidental; a.ts 0.50')
  })

  it('never exceeds 140 characters, eliding the tail', async () => {
    const many = Array.from({ length: 30 }, (_, i) => file(`src/main/services/db/repo${i}.ts`)).join('')
    const out = await run({ diffText: many, entries, ask: askAt({}) })
    const s = describeStatus(out)
    expect(s.length).toBeLessThanOrEqual(140)
    expect(s.endsWith('; …')).toBe(true)
  })
})

describe('main', () => {
  const env = { TYPESAFE_API_KEY: 'k', GITHUB_REPOSITORY: 'o/r', PR_NUMBER: '7', HEAD_SHA: 'abc' }
  it('reads the diff, posts the status and writes the summary', async () => {
    const calls: string[][] = []
    const dir = mkdtempSync(join(tmpdir(), 'lens-'))
    const summaryFile = join(dir, 'summary.md')
    const logs: string[] = []
    const exec = (cmd: string, args: string[]) => {
      calls.push([cmd, ...args])
      return args[0] === 'pr' ? diff : ''
    }
    const code = await main({ env: { ...env, GITHUB_STEP_SUMMARY: summaryFile }, exec, entries, ask: askAt({ 'src/main/services/export.ts': 0.02 }), log: (s: string) => logs.push(s) })
    expect(code).toBe(0)
    expect(calls[0]).toEqual(['gh', 'pr', 'diff', '7', '--repo', 'o/r'])
    expect(calls[1]).toEqual(['gh', 'api', 'repos/o/r/statuses/abc', '-f', 'state=success', '-f', `context=${STATUS_CONTEXT}`, '-f', 'description=2 blocking hits; 1 read incidental (0.02); repo.ts 0.50'])
    expect(readFileSync(summaryFile, 'utf8')).toContain('| 0.02 | incidental |')
    expect(logs[0]).toContain('2 blocking hits')
  })

  it('skips quietly without a key', async () => {
    const logs: string[] = []
    const code = await main({ env: { ...env, TYPESAFE_API_KEY: '' }, exec: () => { throw new Error('must not run') }, log: (s: string) => logs.push(s) })
    expect(code).toBe(0)
    expect(logs[0]).toContain('lens skipped')
  })
})
