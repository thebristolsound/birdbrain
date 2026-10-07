import { describe, expect, it } from 'vitest'
import {
  closedIssues,
  decide,
  approvalStamp,
  effectiveReview,
  maintainerOf,
  trustedPrepass
  // @ts-expect-error - workflow script with no type declarations; the tsconfigs exclude .github/
} from '../.github/scripts/merge/gate.mjs'

const HEAD = 'a'.repeat(40)
const base = {
  headSha: HEAD,
  author: 'birdbrain-agent',
  machine: 'birdbrain-agent',
  labels: [] as string[],
  maintainer: 'owner',
  issueEvidence: [] as number[],
  prepass: 'absent',
  reviews: [] as Array<{ state: string; user: string; commit: string }>,
  approvalStamp: 'absent'
}

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

  it("skips the pre-pass on an agent PR opened under the maintainer's account", () => {
    expect(decide({ ...base, author: 'owner', labels: ['agent-authored'] }).pass).toBe(true)
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

  it('accepts the approved label only with the sign-off stamp on the head commit', () => {
    const labels = ['evidence-affecting', 'approved']
    expect(decide({ ...base, labels, approvalStamp: 'success' }).pass).toBe(true)
    expect(decide({ ...base, labels }).pass).toBe(false)
    expect(decide({ ...base, labels: ['evidence-affecting'], approvalStamp: 'success' }).pass).toBe(
      false
    )
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
    const verdict = decide({ ...base, labels, approvalStamp: 'success', prepass: 'failure' })
    expect(verdict.pass).toBe(false)
    expect(verdict.reasons).toHaveLength(1)
    expect(decide({ ...base, labels, approvalStamp: 'success', prepass: 'success' }).pass).toBe(
      true
    )
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

  it('reads the sign-off stamp only from the workflow token', () => {
    const stamp = (state: string, login: string) => ({
      context: 'merge/approved',
      state,
      creator: { login }
    })
    expect(approvalStamp([stamp('success', 'github-actions[bot]')])).toBe('success')
    expect(approvalStamp([stamp('success', 'owner')])).toBe('absent')
    expect(approvalStamp([])).toBe('absent')
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
