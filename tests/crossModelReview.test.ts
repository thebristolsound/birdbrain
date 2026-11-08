import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import {
  labelState,
  leaks,
  renderComment,
  reviewed,
  selectReviews,
  statusDescription,
  underCap,
  verdict
  // @ts-expect-error - tooling script with no type declarations; the tsconfigs exclude scripts/
} from '../scripts/cross-model-review/lib.mjs'

const MAINTAINER = 'thebristolsound'
const BOT = 'birdbrain-agent'
const ev = (event: string, login: string, at: string, name = 'cross-model-review') => ({
  event,
  label: { name },
  actor: { login },
  created_at: at
})

describe('labelState', () => {
  it('is on from the maintainer’s newest add, with its time', () => {
    const events = [ev('labeled', MAINTAINER, '2026-11-01T00:00:00Z')]
    expect(labelState(events)).toEqual({ on: true, at: '2026-11-01T00:00:00Z' })
  })

  it('is off after the maintainer removes it', () => {
    const events = [
      ev('labeled', MAINTAINER, '2026-11-01T00:00:00Z'),
      ev('unlabeled', MAINTAINER, '2026-11-02T00:00:00Z')
    ]
    expect(labelState(events).on).toBe(false)
  })

  it('ignores an add by anyone else', () => {
    expect(labelState([ev('labeled', 'someone', '2026-11-01T00:00:00Z')]).on).toBe(false)
  })

  it('ignores other labels', () => {
    expect(labelState([ev('labeled', MAINTAINER, '2026-11-01T00:00:00Z', 'queued')]).on).toBe(false)
  })
})

describe('reviewed', () => {
  const status = (login: string, at: string, context = 'cross-model-review') => ({
    context,
    creator: { login },
    created_at: at
  })
  const added = '2026-11-01T00:00:00Z'

  it('counts the posting account’s status newer than the label add', () => {
    expect(reviewed([status(BOT, '2026-11-01T01:00:00Z')], BOT, added)).toBe(true)
  })

  it('asks again when the label was re-added after the last status', () => {
    expect(reviewed([status(BOT, '2026-10-31T00:00:00Z')], BOT, added)).toBe(false)
  })

  it('ignores another account’s status and other contexts', () => {
    expect(
      reviewed(
        [
          status('someone', '2026-11-02T00:00:00Z'),
          status(BOT, '2026-11-02T00:00:00Z', 'agent/pre-pass')
        ],
        BOT,
        added
      )
    ).toBe(false)
  })
})

describe('selectReviews', () => {
  const on = { on: true, at: 'x' }
  const off = { on: false, at: null }

  it('reads labelled, unread heads in number order and names forks', () => {
    const out = selectReviews([
      { number: 9, label: on, reviewed: false, isCrossRepository: false },
      { number: 3, label: on, reviewed: false, isCrossRepository: false },
      { number: 4, label: on, reviewed: true, isCrossRepository: false },
      { number: 5, label: off, reviewed: false, isCrossRepository: false },
      { number: 6, label: on, reviewed: false, isCrossRepository: true }
    ])
    expect(out).toEqual({ review: [3, 9], skipped: ['#6: head is in a fork'] })
  })
})

describe('underCap', () => {
  const now = Date.parse('2026-11-08T12:00:00Z')
  const hoursAgo = (h: number) => now - h * 3600 * 1000

  it('allows a run below the cap and refuses one at it', () => {
    expect(underCap([hoursAgo(1), hoursAgo(2)], now, 3)).toBe(true)
    expect(underCap([hoursAgo(1), hoursAgo(2), hoursAgo(3)], now, 3)).toBe(false)
  })

  it('forgets runs older than a day', () => {
    expect(underCap([hoursAgo(25), hoursAgo(30), hoursAgo(1)], now, 2)).toBe(true)
  })
})

describe('verdict', () => {
  it('requests changes on any blocking finding', () => {
    const v = verdict([{ severity: 'BLOCKING' }, { severity: 'NON-BLOCKING' }])
    expect(v).toEqual({ blocking: 1, other: 1, word: 'request changes' })
  })

  it('reports no blocking findings otherwise', () => {
    expect(verdict([{ severity: 'NON-BLOCKING' }]).word).toBe('no blocking findings')
    expect(verdict([]).word).toBe('no blocking findings')
  })

  it('fits the status description in GitHub’s 140 characters', () => {
    const d = statusDescription(verdict([{ severity: 'BLOCKING' }]), 'm'.repeat(200))
    expect(d.length).toBe(140)
    expect(statusDescription(verdict([]), 'gpt-6.1-sol')).toBe(
      'gpt-6.1-sol: no blocking findings (0 blocking, 0 other). Advisory.'
    )
  })
})

describe('leaks', () => {
  it('names each kind of credential it finds', () => {
    const text = `a ghp_${'a'.repeat(36)} b sk-${'b'.repeat(30)} -----BEGIN RSA PRIVATE KEY-----`
    expect(leaks(text)).toEqual(['GitHub token', 'OpenAI key', 'private key'])
  })

  it('passes ordinary review text', () => {
    expect(leaks('`src/main/x.ts:12` returns true on an empty list (sha a1b2c3)')).toEqual([])
  })
})

describe('renderComment', () => {
  const result = {
    findings: [
      {
        severity: 'NON-BLOCKING',
        file: 'a.ts',
        line: 3,
        plain: 'A note overclaims.',
        detail: 'x | y',
        failure_scenario: ''
      },
      ...Array.from({ length: 5 }, (_, i) => ({
        severity: 'BLOCKING',
        file: `b${i}.ts`,
        line: i + 1,
        plain: `Blocking problem ${i}.`,
        detail: `b${i}.ts:${i + 1}\nreturns true`,
        failure_scenario: 'An empty manifest verifies.'
      }))
    ],
    not_checked: ['Could not run tests.']
  }
  const body = renderComment({ head: 'a'.repeat(40), model: 'gpt-6.1-sol', effort: 'high', result })

  it('leads with the verdict and names at most five findings, blocking first', () => {
    const lines = body.split('\n')
    expect(lines[0]).toBe('**Cross-model review: request changes**')
    expect(body).toContain('1. Blocking: Blocking problem 0.')
    expect(body).not.toContain('6. ')
    expect(body).toContain('1 more are in the full report.')
  })

  it('keeps every finding in the table with pipes and newlines escaped', () => {
    expect(body).toContain('| 6 | NON-BLOCKING | `a.ts:3` | x \\| y | - |')
    expect(body).toContain('| `b0.ts:1` | b0.ts:1 returns true |')
  })

  it('passes the comment linter', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xmr-'))
    try {
      const file = join(dir, 'comment.json')
      writeFileSync(file, JSON.stringify({ body }))
      const check = resolve(
        __dirname,
        '..',
        '.claude',
        'skills',
        'post-comment',
        'scripts',
        'check.sh'
      )
      const run = spawnSync(check, [file], { encoding: 'utf8' })
      expect(run.stderr).toBe('')
      expect(run.status).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
