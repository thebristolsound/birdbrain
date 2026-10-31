import { describe, expect, it } from 'vitest'
import {
  decideNext,
  latestChecks
  // @ts-expect-error - workflow script with no type declarations; the tsconfigs exclude .github/
} from '../.github/scripts/pr-next/next.mjs'
// @ts-expect-error - workflow script with no type declarations; the tsconfigs exclude .github/
import { decide as gate } from '../.github/scripts/merge/gate.mjs'

const HEAD = 'a'.repeat(40)
const REQUIRED = ['lint', 'test', 'merge-gate']

type Check = { name: string; status: string; conclusion: string; startedAt: string }
const run = (name: string, conclusion: string, startedAt = '2026-10-30T08:00:00Z'): Check => ({
  name,
  status: conclusion ? 'COMPLETED' : 'IN_PROGRESS',
  conclusion,
  startedAt
})
const green = [run('lint', 'SUCCESS'), run('test', 'SUCCESS'), run('merge-gate', 'SUCCESS')]

type Facts = {
  author?: string
  labels?: string[]
  rollup?: Check[]
  prepass?: string
  reviews?: Array<{ state: string; user: string; commit: string }>
  approvalStamp?: string
  issueEvidence?: number[]
  files?: string[]
  draft?: boolean
  crossRepo?: boolean
  mergeState?: string
  autoMerge?: boolean
  ageHours?: number
}

function facts(over: Facts = {}) {
  const gateFacts = {
    headSha: HEAD,
    author: over.author ?? 'owner',
    machine: 'birdbrain-agent',
    files: over.files ?? [],
    labels: over.labels ?? [],
    maintainer: 'owner',
    issueEvidence: over.issueEvidence ?? [],
    prepass: over.prepass ?? 'absent',
    approvalStamp: over.approvalStamp ?? 'absent',
    reviews: over.reviews ?? []
  }
  return {
    ...gateFacts,
    draft: over.draft ?? false,
    crossRepo: over.crossRepo ?? false,
    mergeLabel: gateFacts.labels.includes('merge'),
    autoMerge: over.autoMerge ?? false,
    mergeState: over.mergeState ?? 'BLOCKED',
    ageHours: over.ageHours ?? 24,
    required: REQUIRED,
    checks: latestChecks(over.rollup ?? green),
    gate: gate(gateFacts)
  }
}

const next = (over: Facts = {}) => decideNext(facts(over)).label

describe('latestChecks', () => {
  it('judges a check by its newest run and lists older red runs', () => {
    const { results, staleRed } = latestChecks([
      run('merge-gate', 'FAILURE', '2026-10-30T07:00:00Z'),
      run('merge-gate', 'SUCCESS', '2026-10-30T08:00:00Z')
    ])
    expect(results.get('merge-gate')).toBe('pass')
    expect(staleRed).toEqual(['merge-gate'])
  })

  it('counts a skipped check as passing and an unfinished one as pending', () => {
    const { results } = latestChecks([run('lint', 'SKIPPED'), run('test', '')])
    expect(results.get('lint')).toBe('pass')
    expect(results.get('test')).toBe('pending')
  })

  it('reads commit statuses by context', () => {
    const { results } = latestChecks([
      { __typename: 'StatusContext', context: 'agent/pre-pass', state: 'PENDING' }
    ])
    expect(results.get('agent/pre-pass')).toBe('pending')
  })
})

describe('decideNext', () => {
  it('gives a draft no label', () => {
    expect(next({ draft: true })).toBeNull()
  })

  it('asks the author to fix a failed required check before anything else', () => {
    const rollup = [run('lint', 'FAILURE'), run('test', ''), run('merge-gate', 'SUCCESS')]
    expect(decideNext(facts({ rollup, labels: ['merge'] }))).toEqual({
      label: 'next: fix',
      reason: 'lint failed'
    })
  })

  it('ignores a failed check the ruleset does not require', () => {
    expect(
      next({ rollup: [...green, run('Dependency audit', 'FAILURE')], labels: ['review:passed'] })
    ).toBe('next: merge')
  })

  it('asks for a fix on a merge conflict', () => {
    expect(next({ mergeState: 'DIRTY', labels: ['review:passed'] })).toBe('next: fix')
  })

  it('asks for a fix when a review asked for changes', () => {
    expect(next({ labels: ['review:changes'] })).toBe('next: fix')
    const reviews = [{ state: 'CHANGES_REQUESTED', user: 'owner', commit: HEAD }]
    expect(next({ author: 'contributor', crossRepo: true, reviews })).toBe('next: fix')
  })

  it('waits while required checks run', () => {
    const rollup = [run('lint', 'SUCCESS'), run('test', ''), run('merge-gate', 'FAILURE')]
    expect(decideNext(facts({ rollup }))).toEqual({
      label: 'next: wait',
      reason: 'waiting on test'
    })
  })

  it('asks the maintainer to start the checks on an outside PR', () => {
    expect(next({ author: 'contributor', crossRepo: true, rollup: [] })).toBe('next: review')
  })

  it("waits on the reviewer pre-pass for the machine account's PR, and fixes on its failure", () => {
    const agent = { author: 'birdbrain-agent', labels: ['agent-pr'] }
    expect(next({ ...agent, prepass: 'pending' })).toBe('next: wait')
    expect(next({ ...agent, prepass: 'failure' })).toBe('next: fix')
    expect(next({ ...agent, prepass: 'success' })).toBe('next: merge')
  })

  it("waits for the scheduled review on the maintainer's new PR, then hands it over", () => {
    expect(next({ ageHours: 2 })).toBe('next: wait')
    expect(next({ labels: ['review:stale'] })).toBe('next: wait')
    expect(next({ labels: ['review:requested', 'review:passed'] })).toBe('next: wait')
    expect(next({ ageHours: 7 })).toBe('next: review')
    expect(next({ labels: ['review:failed'] })).toBe('next: review')
  })

  it('asks for sign-off on an evidence-affecting PR, and stops asking once it is given', () => {
    const labels = ['evidence-affecting', 'review:passed']
    expect(decideNext(facts({ labels }))).toEqual({
      label: 'next: approve',
      reason: 'evidence-affecting; needs your sign-off at aaaaaaa'
    })
    expect(next({ labels, reviews: [{ state: 'APPROVED', user: 'owner', commit: HEAD }] })).toBe(
      'next: merge'
    )
    expect(next({ issueEvidence: [12], labels: ['review:passed'] })).toBe('next: approve')
  })

  it('asks for a review of an outside PR nobody has approved at head', () => {
    const outside = { author: 'contributor', crossRepo: true }
    expect(next(outside)).toBe('next: review')
    const stale = [{ state: 'APPROVED', user: 'owner', commit: 'b'.repeat(40) }]
    expect(next({ ...outside, reviews: stale })).toBe('next: review')
    const fresh = [{ state: 'APPROVED', user: 'owner', commit: HEAD }]
    expect(next({ ...outside, reviews: fresh })).toBe('next: merge')
  })

  it('counts the approved label with its stamp as sign-off, as merge-gate does', () => {
    const outside = { author: 'app/dependabot', labels: ['approved'] }
    expect(next({ ...outside, approvalStamp: 'success' })).toBe('next: merge')
    expect(next({ ...outside, approvalStamp: 'absent' })).toBe('next: review')
    const merge = { labels: ['approved', 'merge'], approvalStamp: 'success', mergeState: 'CLEAN' }
    expect(next({ ...outside, ...merge, autoMerge: true })).toBe('next: merging')
    expect(next({ ...outside, ...merge, autoMerge: false })).toBe('next: unstick')
  })

  it('asks for sign-off when someone other than the maintainer changes a workflow', () => {
    const files = ['.github/workflows/ci.yml']
    expect(decideNext(facts({ author: 'app/dependabot', files }))).toEqual({
      label: 'next: approve',
      reason: 'changes release-credential paths; needs your sign-off at aaaaaaa'
    })
    const signed = { labels: ['approved'], approvalStamp: 'success' }
    expect(next({ author: 'app/dependabot', files, ...signed })).toBe('next: merge')
    expect(next({ files, labels: ['review:passed'] })).toBe('next: merge')
  })

  it('separates a merge that is happening from one that is stuck', () => {
    const labels = ['review:skipped', 'merge']
    expect(next({ labels, autoMerge: true, mergeState: 'CLEAN' })).toBe('next: merging')
    expect(next({ labels, autoMerge: false, mergeState: 'CLEAN' })).toBe('next: unstick')
    expect(next({ labels, autoMerge: true, mergeState: 'BLOCKED' })).toBe('next: unstick')
    const rollup = [...green, run('merge-gate', 'FAILURE', '2026-10-30T07:00:00Z')]
    expect(next({ labels, autoMerge: true, mergeState: 'CLEAN', rollup })).toBe('next: unstick')
  })
})
