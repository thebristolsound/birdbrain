import { spawnSync } from 'child_process'
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { expect, it } from 'vitest'
// @ts-expect-error - trusted workflow script without declarations
import { renderState } from '../.github/scripts/review-fleet/fleet.mjs'

it.each(['oversized', 'unwritable'])(
  'fails before publishing success when the saved report is %s',
  (mode) => {
    const dir = mkdtempSync(join(tmpdir(), 'fleet-report-'))
    const sha = 'a'.repeat(40)
    const repo = 'thebristolsound/birdbrain'
    try {
      const startedAt = '2026-11-10T11:00:00Z'
      const body = renderState(
        { v: 1, sha, startedAt },
        { status: 'pending', description: 'running' }
      )
      const responses = {
        [`repos/${repo}/pulls/7`]: [{ labels: [], head: { sha } }],
        [`repos/${repo}/issues/7/comments?per_page=100`]: [
          { id: 1, user: { login: 'birdbrain-agent' }, body },
          {
            id: 2,
            user: { login: 'thebristolsound' },
            created_at: '2026-11-10T11:30:00Z',
            body: `<!-- review-fleet:relay ${sha} -->`
          }
        ],
        [`repos/${repo}/pulls/7/reviews?per_page=100`]: [
          {
            user: { login: 'chatgpt-codex-connector[bot]' },
            commit_id: sha,
            submitted_at: '2026-11-10T12:00:00Z'
          }
        ],
        [`repos/${repo}/pulls/7/comments?per_page=100`]: [],
        [`repos/${repo}/issues/7/events?per_page=100`]: [],
        [`repos/${repo}/commits/${sha}/statuses?per_page=100`]: [],
        [`repos/${repo}/commits/${sha}/check-runs?check_name=merge-gate&per_page=100`]: [
          { check_runs: [] }
        ]
      }
      writeFileSync(join(dir, 'data.json'), JSON.stringify(responses))
      const finding = {
        severity: 'NON-BLOCKING',
        file: 'a.ts',
        line: 1,
        plain: 'p'.repeat(400),
        detail: 'd'.repeat(2000),
        failure_scenario: 's'.repeat(600)
      }
      for (const leg of ['correctness', 'claims', 'contract', 'tests']) {
        mkdirSync(join(dir, leg))
        // Each pass says what it read; without that the record would fail before the report.
        writeFileSync(
          join(dir, leg, 'scope.json'),
          JSON.stringify({ base: 'main', from: 'c'.repeat(40) })
        )
        writeFileSync(
          join(dir, leg, 'findings.json'),
          JSON.stringify({
            contract_version: 2,
            source_review_complete: true,
            not_checked: [],
            runtime_limitations:
              mode === 'oversized'
                ? Array.from({ length: 10 }, () => 'unverified '.repeat(54))
                : ['Unverified runtime.'],
            findings:
              mode === 'oversized' && leg === 'correctness'
                ? Array.from({ length: 15 }, () => finding)
                : []
          })
        )
      }
      writeFileSync(
        join(dir, 'gh'),
        `#!/usr/bin/env node
const fs = require('node:fs')
const a = process.argv.slice(2)
if (a.includes('-X')) {
  fs.appendFileSync(process.env.CALLS, JSON.stringify(a) + '\\n')
  if (a.includes('PATCH') && process.env.FAIL_SAVE === '1') throw new Error('stub save failed')
  console.log('{}')
} else {
  const data = JSON.parse(fs.readFileSync(process.env.DATA, 'utf8'))
  if (!(a.at(-1) in data)) throw new Error('unexpected read')
  console.log(JSON.stringify([data[a.at(-1)]]))
}
`
      )
      chmodSync(join(dir, 'gh'), 0o755)
      const result = spawnSync(
        process.execPath,
        [
          join(__dirname, '..', '.github/scripts/review-fleet/fleet.mjs'),
          'record',
          repo,
          '7',
          sha,
          dir,
          'review'
        ],
        {
          encoding: 'utf8',
          env: {
            ...process.env,
            PATH: `${dir}:${process.env.PATH}`,
            DATA: join(dir, 'data.json'),
            CALLS: join(dir, 'calls'),
            FAIL_SAVE: mode === 'unwritable' ? '1' : '0'
          }
        }
      )
      expect(result.status).toBe(1)
      expect(result.stderr).toContain(mode === 'oversized' ? 'over 60000' : 'stub save failed')
      const calls = readFileSync(join(dir, 'calls'), 'utf8')
      expect(calls).toContain('state=failure')
      expect(calls).not.toContain('state=success')
      if (mode === 'oversized') expect(calls).not.toContain('PATCH')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
)
