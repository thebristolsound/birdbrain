import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error - tooling script with no type declarations; the tsconfigs exclude scripts/
import { auditToolLog, parseToolLog } from '../../scripts/bench/review/lib/audit.mjs'
// @ts-expect-error - tooling script with no type declarations; the tsconfigs exclude scripts/
import { auditResults } from '../../scripts/bench/review/audit.mjs'
// @ts-expect-error - tooling script with no type declarations; the tsconfigs exclude scripts/
import { shimFixtureDir, SHIM_FIXTURE_FILES } from '../../scripts/bench/review/run.mjs'

describe('tool-log audit', () => {
  it('flags reads of the truth, the fixture tree, the runner env and worktree listing', () => {
    const calls = [
      { name: 'Read', input: { file_path: '/tmp/bench-review/worktrees/m01-1/src/a.ts' } },
      { name: 'Bash', input: { command: 'git diff origin/main' } },
      { name: 'Bash', input: { command: 'git worktree list' } },
      { name: 'Read', input: { file_path: '/repo/scripts/bench/review/fixtures/m01/truth.json' } },
      { name: 'command_execution', input: '/bin/zsh -lc "echo $BENCH_GH_FIXTURE"' }
    ]
    const hits = auditToolLog(calls)
    expect(hits.map((h: { probe: string }) => h.probe)).toEqual([
      'worktree-list',
      'truth-file',
      'fixtures-dir',
      'bench-env'
    ])
    expect(auditToolLog(calls.slice(0, 2))).toEqual([])
  })

  it('lets the row directory the runner named through, and scans results/', () => {
    const results = mkdtempSync(join(tmpdir(), 'bench-audit-'))
    const row = join(results, 'run1', 'rows', 'm01-r1')
    mkdirSync(row, { recursive: true })
    const clean = { name: 'Write', input: { file_path: join(row, 'comment.md'), content: 'x' } }
    const probe = { name: 'Bash', input: { command: 'cat ../fixtures/m01/truth.json' } }
    writeFileSync(join(row, 'tools.jsonl'), [clean].map((c) => JSON.stringify(c)).join('\n'))
    expect(auditResults(results)).toEqual({ rows: 1, hits: [] })
    writeFileSync(join(row, 'tools.jsonl'), [clean, probe].map((c) => JSON.stringify(c)).join('\n'))
    const out = auditResults(results)
    expect(out.rows).toBe(1)
    expect(out.hits).toHaveLength(1)
    expect(out.hits[0]).toMatchObject({ run: 'run1', row: 'm01-r1', probe: 'truth-file' })
    expect(parseToolLog('')).toEqual([])
  })

  it('gives the gh stand-in a fixture copy without the truth file', () => {
    const src = mkdtempSync(join(tmpdir(), 'bench-fixture-'))
    for (const name of [...SHIM_FIXTURE_FILES, 'truth.json', 'pr.md']) {
      writeFileSync(join(src, name), '{}')
    }
    const dir = shimFixtureDir(src, join(src, 'copy'))
    expect(readdirSync(dir).sort()).toEqual([...SHIM_FIXTURE_FILES].sort())
  })
})
