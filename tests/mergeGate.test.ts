import { describe, expect, it } from 'vitest'
import {
  closedIssues,
  decide,
  effectiveReview,
  headArrivedAt,
  lastLabelled,
  maintainerOf,
  trustedPrepass
  // @ts-expect-error - workflow script with no type declarations; the tsconfigs exclude .github/
} from '../.github/scripts/merge/gate.mjs'

const HEAD = 'a'.repeat(40)
const base = {
  headSha: HEAD,
  labels: [] as string[],
  maintainer: 'owner',
  issueEvidence: [] as number[],
  prepass: 'absent',
  reviews: [] as Array<{ state: string; user: string; commit: string }>,
  approved: { by: null, at: null } as { by: string | null; at: string | null },
  headArrivedAt: Date.parse('2026-10-06T10:00:00Z') as number | null
}
const AFTER = '2026-10-06T11:00:00Z'
const BEFORE = '2026-10-06T09:00:00Z'

describe('merge-gate decide', () => {
  it('passes a PR with no agent label and no evidence label', () => {
    expect(decide(base).pass).toBe(true)
  })

  it('blocks an agent PR until a trusted pre-pass succeeds at head', () => {
    for (const label of ['agent-pr', 'agent-authored']) {
      expect(decide({ ...base, labels: [label], prepass: 'pending' }).pass).toBe(false)
      expect(decide({ ...base, labels: [label], prepass: 'success' }).pass).toBe(true)
    }
  })

  it('blocks an evidence-affecting PR with no sign-off', () => {
    const verdict = decide({ ...base, labels: ['evidence-affecting'] })
    expect(verdict.pass).toBe(false)
    expect(verdict.reasons[0]).toContain('no sign-off at head')
  })

  it('treats a closed issue with the evidence label as evidence-affecting', () => {
    expect(decide({ ...base, issueEvidence: [7] }).pass).toBe(false)
  })

  it('accepts an approving review from the maintainer on the head commit', () => {
    const reviews = [{ state: 'APPROVED', user: 'owner', commit: HEAD }]
    expect(decide({ ...base, labels: ['evidence-affecting'], reviews }).pass).toBe(true)
  })

  it('rejects an approval on an older commit or from someone else', () => {
    const stale = [{ state: 'APPROVED', user: 'owner', commit: 'b'.repeat(40) }]
    const other = [{ state: 'APPROVED', user: 'someone', commit: HEAD }]
    expect(decide({ ...base, labels: ['evidence-affecting'], reviews: stale }).pass).toBe(false)
    expect(decide({ ...base, labels: ['evidence-affecting'], reviews: other }).pass).toBe(false)
  })

  it('accepts the approved label only when the maintainer applied it', () => {
    const labels = ['evidence-affecting', 'approved']
    expect(decide({ ...base, labels, approved: { by: 'owner', at: AFTER } }).pass).toBe(true)
    expect(decide({ ...base, labels, approved: { by: 'birdbrain-agent', at: AFTER } }).pass).toBe(
      false
    )
  })

  it('ignores an approved label applied before the head commit arrived', () => {
    const labels = ['evidence-affecting', 'approved']
    expect(decide({ ...base, labels, approved: { by: 'owner', at: BEFORE } }).pass).toBe(false)
    expect(
      decide({ ...base, labels, approved: { by: 'owner', at: AFTER }, headArrivedAt: null }).pass
    ).toBe(false)
  })

  it('lets a later change request withdraw an approval on the same commit', () => {
    const reviews = [
      { state: 'APPROVED', user: 'owner', commit: HEAD },
      { state: 'COMMENTED', user: 'owner', commit: HEAD },
      { state: 'CHANGES_REQUESTED', user: 'owner', commit: HEAD }
    ]
    expect(decide({ ...base, labels: ['evidence-affecting'], reviews }).pass).toBe(false)
  })

  it('needs both a pre-pass and a sign-off on an evidence-affecting agent PR', () => {
    const labels = ['agent-pr', 'evidence-affecting', 'approved']
    const approved = { by: 'owner', at: AFTER }
    const verdict = decide({ ...base, labels, approved, prepass: 'failure' })
    expect(verdict.pass).toBe(false)
    expect(verdict.reasons).toHaveLength(1)
    expect(decide({ ...base, labels, approved, prepass: 'success' }).pass).toBe(true)
  })
})

describe('merge-gate facts', () => {
  it('reads closed issues from a Closes first line only', () => {
    expect(closedIssues('Closes #12, #34\n\n## Summary')).toEqual([12, 34])
    expect(closedIssues('No issue: follow-up to #12')).toEqual([])
    expect(closedIssues(null)).toEqual([])
  })

  it('reads the maintainer from the CODEOWNERS star line', () => {
    expect(maintainerOf('# owners\n* @owner\n')).toBe('owner')
    expect(maintainerOf('docs/ @someone\n')).toBeNull()
  })

  it('takes the newest pre-pass from a trusted account', () => {
    const statuses = [
      { context: 'agent/pre-pass', state: 'success', creator: { login: 'github-actions[bot]' } },
      { context: 'agent/pre-pass', state: 'failure', creator: { login: 'birdbrain-agent' } },
      { context: 'agent/pre-pass', state: 'success', creator: { login: 'owner' } }
    ]
    expect(trustedPrepass(statuses, ['owner', 'birdbrain-agent'])).toBe('failure')
    expect(trustedPrepass([], ['owner'])).toBe('absent')
  })

  it('reports who last applied a label, and when', () => {
    const events = [
      {
        event: 'labeled',
        label: { name: 'approved' },
        actor: { login: 'owner' },
        created_at: BEFORE
      },
      { event: 'unlabeled', label: { name: 'approved' }, actor: { login: 'github-actions[bot]' } },
      {
        event: 'labeled',
        label: { name: 'approved' },
        actor: { login: 'someone' },
        created_at: AFTER
      }
    ]
    expect(lastLabelled(events, 'approved')).toEqual({ by: 'someone', at: AFTER })
    expect(lastLabelled(events, 'merge')).toEqual({ by: null, at: null })
  })

  it('dates the head from its first check suite or a later force push', () => {
    const suites = [{ created_at: AFTER }, { created_at: BEFORE }]
    expect(headArrivedAt(suites, [])).toBe(Date.parse(BEFORE))
    const pushed = [{ event: 'head_ref_force_pushed', created_at: '2026-10-06T12:00:00Z' }]
    expect(headArrivedAt(suites, pushed)).toBe(Date.parse('2026-10-06T12:00:00Z'))
    expect(headArrivedAt([], pushed)).toBeNull()
  })

  it("reads the maintainer's newest decisive review", () => {
    const reviews = [
      { state: 'CHANGES_REQUESTED', user: 'owner', commit: HEAD },
      { state: 'APPROVED', user: 'owner', commit: HEAD },
      { state: 'COMMENTED', user: 'owner', commit: HEAD },
      { state: 'CHANGES_REQUESTED', user: 'someone', commit: HEAD }
    ]
    expect(effectiveReview(reviews, 'owner')?.state).toBe('APPROVED')
    expect(effectiveReview([], 'owner')).toBeNull()
  })
})
