import { describe, expect, it } from 'vitest'
import {
  CODEX,
  FINDER_LEGS,
  capUsed,
  codexAnswered,
  codexFindings,
  codexTexts,
  decide,
  eligible,
  mergeFinders,
  mergeVerify,
  parseRulings,
  readState,
  redact,
  relayBody,
  relayFor,
  renderState,
  settings
  // @ts-expect-error - workflow script with no type declarations; the tsconfigs exclude .github/
} from '../.github/scripts/review-fleet/fleet.mjs'

const SHA = 'a'.repeat(40)
const OLD = 'b'.repeat(40)
const MACHINE = 'birdbrain-agent'
const MAINTAINER = 'thebristolsound'
const REPO = 'thebristolsound/birdbrain'
const NOW = '2026-11-10T12:00:00Z'
const RELAY_AT = '2026-11-10T11:30:00Z'

const allDone = Object.fromEntries(FINDER_LEGS.map((l: string) => [l, { findings: [] }]))
const blocking = {
  severity: 'BLOCKING',
  file: 'src/a.ts',
  line: 3,
  plain: 'It breaks.',
  detail: 'src/a.ts:3 drops the error.',
  failure_scenario: 'A missing file reads as a pass.'
}
const reviewed = (outputs: Record<string, unknown> = allDone) =>
  mergeFinders({ v: 1, sha: SHA, startedAt: '2026-11-10T11:00:00Z' }, outputs)

const facts = (over: Record<string, unknown> = {}) => ({
  state: reviewed(),
  now: NOW,
  breakGlass: false,
  relay: { id: 1, at: RELAY_AT },
  codexDone: true,
  rulings: {},
  codexFindings: [],
  codexTimeout: 45,
  ...over
})

describe('settings', () => {
  it('runs unless the variable says false, and falls back on a bad number', () => {
    expect(settings({})).toEqual({ enabled: true, dailyCap: 40, codexTimeout: 45 })
    expect(settings({ REVIEW_FLEET_ENABLED: 'FALSE ' }).enabled).toBe(false)
    expect(settings({ REVIEW_FLEET_DAILY_CAP: '200' }).dailyCap).toBe(200)
    expect(settings({ REVIEW_FLEET_DAILY_CAP: 'lots' }).dailyCap).toBe(40)
  })
})

describe('eligible', () => {
  const pr = (over: Record<string, unknown> = {}) => ({
    state: 'open',
    draft: false,
    head: { repo: { full_name: REPO } },
    user: { login: MAINTAINER },
    ...over
  })
  const who = { maintainer: MAINTAINER, machine: MACHINE, repo: REPO }

  it("reads the maintainer's and the machine's same-repository PRs", () => {
    expect(eligible(pr(), who).ok).toBe(true)
    expect(eligible(pr({ user: { login: MACHINE } }), who).ok).toBe(true)
  })

  it('skips drafts, forks, closed PRs and other authors', () => {
    expect(eligible(pr({ draft: true }), who).why).toBe('draft')
    expect(eligible(pr({ head: { repo: { full_name: 'x/birdbrain' } } }), who).why).toBe('fork')
    expect(eligible(pr({ head: { repo: null } }), who).why).toBe('fork')
    expect(eligible(pr({ state: 'closed' }), who).why).toBe('closed')
    expect(eligible(pr({ user: { login: 'dependabot[bot]' } }), who).ok).toBe(false)
  })
})

describe('state comments', () => {
  const state = reviewed({ ...allDone, correctness: { findings: [blocking] } })
  const verdict = { status: 'pending', description: 'x' }
  const body = renderState(state, verdict)

  it('round-trips the state through the comment', () => {
    const comments = [{ id: 7, user: { login: MACHINE }, body, created_at: NOW }]
    expect(readState(comments, MACHINE, SHA)?.state).toEqual(state)
    expect(readState(comments, MACHINE, SHA)?.body).toBe(body)
  })

  it('ignores another head, another author, and a broken payload', () => {
    expect(readState([{ id: 1, user: { login: MACHINE }, body }], MACHINE, OLD)).toBeNull()
    expect(readState([{ id: 1, user: { login: MAINTAINER }, body }], MACHINE, SHA)).toBeNull()
    const broken = '<!-- review-fleet:state {not json} -->'
    expect(readState([{ id: 1, user: { login: MACHINE }, body: broken }], MACHINE, SHA)).toBeNull()
  })

  it('counts heads claimed in the window toward the cap', () => {
    const comments = [
      { user: { login: MACHINE }, body, created_at: '2026-11-10T01:00:00Z' },
      { user: { login: MACHINE }, body, created_at: '2026-11-08T01:00:00Z' },
      { user: { login: MAINTAINER }, body, created_at: '2026-11-10T01:00:00Z' },
      { user: { login: MACHINE }, body: 'unrelated', created_at: '2026-11-10T01:00:00Z' }
    ]
    expect(capUsed(comments, MACHINE, '2026-11-09T12:00:00Z')).toBe(1)
  })

  it('redacts anything shaped like a credential before posting', () => {
    const leak = reviewed({
      ...allDone,
      claims: { findings: [{ ...blocking, detail: 'token ghp_abcdefghijklmnop leaked' }] }
    })
    expect(renderState(leak, verdict)).not.toContain('ghp_abcdefghijklmnop')
    expect(redact('sk-ant-abcdef123456')).toBe('sk-ant-<REDACTED>')
  })
})

describe('mergeFinders', () => {
  it('numbers findings across the passes and marks a pass with no output failed', () => {
    const state = reviewed({
      correctness: { findings: [blocking] },
      claims: { findings: [{ ...blocking, severity: 'whatever' }] },
      contract: null,
      tests: { notFindings: true }
    })
    expect(state.claude.legs).toEqual({
      correctness: 'done',
      claims: 'done',
      contract: 'failed',
      tests: 'failed'
    })
    expect(
      state.claude.findings.map((x: { id: string; severity: string }) => [x.id, x.severity])
    ).toEqual([
      ['F1', 'BLOCKING'],
      ['F2', 'NON-BLOCKING']
    ])
  })
})

describe('Codex', () => {
  const inline = (over: Record<string, unknown> = {}) => ({
    id: 11,
    user: { login: CODEX },
    commit_id: SHA,
    original_commit_id: SHA,
    path: 'src/a.ts',
    line: 4,
    body: '**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange)</sub></sub>  Drop the error**\n\nDetail.',
    ...over
  })

  it('reads its inline findings at head with their severity', () => {
    const found = codexFindings(
      [
        inline(),
        inline({ id: 12, commit_id: OLD, original_commit_id: OLD }),
        inline({ id: 13, in_reply_to_id: 11 }),
        inline({ id: 14, user: { login: MAINTAINER } })
      ],
      SHA
    )
    expect(found).toHaveLength(1)
    expect(found[0]).toMatchObject({ id: 11, severity: 'P1', title: 'Drop the error' })
  })

  it('has answered only with a review or a completed summary for the head after the relay', () => {
    const summary = (sha: string, status: string, at: string) => ({
      user: { login: CODEX },
      updated_at: at,
      body: `<!-- codex-review-state:v1 {"code_review":{"commit_sha":"${sha}","status":"${status}"}} -->`
    })
    const none = { reviews: [], comments: [] }
    expect(codexAnswered(none, SHA, RELAY_AT)).toBe(false)
    expect(
      codexAnswered({ reviews: [], comments: [summary(SHA, 'completed', NOW)] }, SHA, RELAY_AT)
    ).toBe(true)
    expect(
      codexAnswered({ reviews: [], comments: [summary(SHA, 'running', NOW)] }, SHA, RELAY_AT)
    ).toBe(false)
    expect(
      codexAnswered({ reviews: [], comments: [summary(OLD, 'completed', NOW)] }, SHA, RELAY_AT)
    ).toBe(false)
    expect(
      codexAnswered(
        { reviews: [], comments: [summary(SHA, 'completed', '2026-11-10T11:00:00Z')] },
        SHA,
        RELAY_AT
      )
    ).toBe(false)
    const review = { user: { login: CODEX }, commit_id: SHA, submitted_at: NOW }
    expect(codexAnswered({ reviews: [review], comments: [] }, SHA, RELAY_AT)).toBe(true)
  })

  it('parses rulings, the later one winning, and only from Codex after the relay', () => {
    expect(parseRulings(['F1: CONFIRMED because', 'F2 - **REFUTED**', 'F1: REFUTED'])).toEqual({
      F1: 'REFUTED',
      F2: 'REFUTED'
    })
    expect(parseRulings(['F1: maybe'])).toEqual({})
    const texts = codexTexts(
      {
        reviews: [{ user: { login: CODEX }, submitted_at: NOW, body: 'F1: CONFIRMED' }],
        comments: [
          { user: { login: CODEX }, created_at: '2026-11-10T11:00:00Z', body: 'F2: CONFIRMED' },
          { user: { login: MAINTAINER }, created_at: NOW, body: 'F3: CONFIRMED' }
        ],
        reviewComments: []
      },
      RELAY_AT
    )
    expect(parseRulings(texts)).toEqual({ F1: 'CONFIRMED' })
  })

  it('finds the relay for the head from the maintainer only', () => {
    const mark = `<!-- review-fleet:relay ${SHA} -->`
    const comments = [
      { id: 1, user: { login: MACHINE }, body: mark, created_at: NOW },
      { id: 2, user: { login: MAINTAINER }, body: mark, created_at: RELAY_AT },
      { id: 3, user: { login: MAINTAINER }, body: `<!-- review-fleet:relay ${OLD} -->` }
    ]
    expect(relayFor(comments, MAINTAINER, SHA)).toEqual({ id: 2, at: RELAY_AT })
    expect(relayFor(comments, MAINTAINER, 'c'.repeat(40))).toBeNull()
  })

  it('asks for a ruling line per blocking Claude finding, and never mentions @claude', () => {
    const state = reviewed({
      ...allDone,
      correctness: { findings: [blocking, { ...blocking, severity: 'NON-BLOCKING' }] }
    })
    const body = relayBody(state, SHA)
    expect(body.startsWith('@codex review\n')).toBe(true)
    expect(body).toContain(`<!-- review-fleet:relay ${SHA} -->`)
    expect(body).toContain('F1: CONFIRMED | REFUTED')
    expect(body).not.toContain('F2: CONFIRMED')
    expect(body).not.toContain('@claude')
    expect(relayBody(reviewed(), SHA)).not.toContain('CONFIRMED')
  })
})

describe('decide', () => {
  const withBlocking = reviewed({ ...allDone, correctness: { findings: [blocking] } })
  const p1 = { id: 11, severity: 'P1', title: 't' }
  const p2 = { id: 12, severity: 'P2', title: 't' }

  it('lets the maintainer override with break-glass', () => {
    expect(decide(facts({ state: null, breakGlass: true })).status).toBe('success')
  })

  it('owes a review to an unclaimed head, and waits on a claimed one', () => {
    expect(decide(facts({ state: null }))).toMatchObject({ status: 'pending', owed: 'review' })
    const claimed = { v: 1, sha: SHA, startedAt: '2026-11-10T11:00:00Z' }
    expect(decide(facts({ state: claimed }))).toMatchObject({ status: 'pending', owed: null })
  })

  it('fails a claim whose passes never reported', () => {
    const claimed = { v: 1, sha: SHA, startedAt: '2026-11-10T08:00:00Z' }
    expect(decide(facts({ state: claimed })).status).toBe('failure')
  })

  it('fails when any Claude pass did not finish', () => {
    const state = reviewed({ ...allDone, tests: null })
    expect(decide(facts({ state }))).toMatchObject({
      status: 'failure',
      description: 'a Claude pass did not finish: tests'
    })
  })

  it('owes the relay, then waits for Codex, then fails when Codex never answers', () => {
    expect(decide(facts({ relay: null }))).toMatchObject({ status: 'pending', owed: 'relay' })
    expect(decide(facts({ codexDone: false })).status).toBe('pending')
    const late = { id: 1, at: '2026-11-10T11:00:00Z' }
    expect(decide(facts({ codexDone: false, relay: late })).status).toBe('failure')
  })

  it('fails a blocking Claude finding Codex did not rule on', () => {
    const v = decide(facts({ state: withBlocking }))
    expect(v.status).toBe('failure')
    expect(v.description).toContain('no ruling on F1')
  })

  it('fails a blocking Claude finding Codex confirmed, and passes one it refuted', () => {
    expect(decide(facts({ state: withBlocking, rulings: { F1: 'CONFIRMED' } })).status).toBe(
      'failure'
    )
    expect(decide(facts({ state: withBlocking, rulings: { F1: 'REFUTED' } })).status).toBe(
      'success'
    )
  })

  it('owes the Claude check of Codex findings before deciding', () => {
    expect(decide(facts({ codexFindings: [p1] }))).toMatchObject({
      status: 'pending',
      owed: 'verify'
    })
  })

  it('fails when the Claude check of Codex did not finish, rather than asking forever', () => {
    const state = mergeVerify(reviewed(), null, [11])
    expect(decide(facts({ state, codexFindings: [p1] })).status).toBe('failure')
  })

  it('blocks only on a blocking Codex finding Claude confirmed', () => {
    const rule = (ruling: string) =>
      mergeVerify(
        reviewed(),
        {
          rulings: [
            { id: 11, ruling, reason: 'r' },
            { id: 12, ruling, reason: 'r' }
          ]
        },
        [11, 12]
      )
    const findings = [p1, p2]
    expect(decide(facts({ state: rule('CONFIRMED'), codexFindings: findings })).status).toBe(
      'failure'
    )
    expect(decide(facts({ state: rule('REFUTED'), codexFindings: findings })).status).toBe(
      'success'
    )
    expect(decide(facts({ state: rule('UNCLEAR'), codexFindings: findings })).status).toBe(
      'success'
    )
    const p2only = mergeVerify(
      reviewed(),
      { rulings: [{ id: 12, ruling: 'CONFIRMED', reason: 'r' }] },
      [12]
    )
    expect(decide(facts({ state: p2only, codexFindings: [p2] })).status).toBe('success')
  })

  it('ignores rulings on ids it did not ask about and unknown ruling words', () => {
    const state = mergeVerify(
      reviewed(),
      {
        rulings: [
          { id: 99, ruling: 'CONFIRMED' },
          { id: 11, ruling: 'MAYBE' }
        ]
      },
      [11]
    )
    expect(state.claudeVerify).toEqual({})
  })

  it('keeps every description within the status limit', () => {
    const many = reviewed({
      ...allDone,
      correctness: { findings: Array.from({ length: 40 }, () => blocking) }
    })
    expect(decide(facts({ state: many })).description.length).toBeLessThanOrEqual(140)
  })
})
