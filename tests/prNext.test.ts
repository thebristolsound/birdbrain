import { describe, expect, it } from 'vitest'
import {
  decideNext,
  latestChecks
  // @ts-expect-error - workflow script with no type declarations; the tsconfigs exclude .github/
} from '../.github/scripts/pr-next/next.mjs'
// @ts-expect-error - workflow script with no type declarations; the tsconfigs exclude .github/
import { decide as gate, fleetCovers } from '../.github/scripts/merge/gate.mjs'

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
  fleet?: string
  fleetEnabled?: boolean
  breakGlass?: boolean
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
    reviews: over.reviews ?? [],
    fleet: over.fleet ?? 'success',
    fleetRequired: fleetCovers({
      enabled: over.fleetEnabled ?? true,
      author: over.author ?? 'owner',
      maintainer: 'owner',
      machine: 'birdbrain-agent',
      sameRepo: !(over.crossRepo ?? false)
    }),
    breakGlass: over.breakGlass ?? false
  }
  return {
    ...gateFacts,
    draft: over.draft ?? false,
    crossRepo: over.crossRepo ?? false,
    mergeLabel: gateFacts.labels.includes('merge'),
    autoMerge: over.autoMerge ?? false,
    mergeState: over.mergeState ?? 'BLOCKED',
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

  it('reads a queued run with no start time as the newest run', () => {
    const { results } = latestChecks([
      run('test', 'FAILURE', '2026-10-30T07:00:00Z'),
      { name: 'test', status: 'QUEUED', conclusion: null, startedAt: null }
    ])
    expect(results.get('test')).toBe('pending')
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

  it('waits on a requested review, and hands one that ended without a verdict over', () => {
    expect(next({ labels: ['review:stale'], fleet: 'success' })).toBe('next: merge')
    expect(next({ labels: ['review:requested', 'review:passed'] })).toBe('next: wait')
    expect(next({ labels: ['review:failed'] })).toBe('next: review')
  })

  it.each(['pending', 'absent', 'override'])(
    'waits on the review fleet while its status is %s, and never calls the PR green',
    (fleet) => {
      expect(decideNext(facts({ fleet }))).toEqual({
        label: 'next: wait',
        reason: 'waiting on the review fleet'
      })
      expect(next({ fleet, labels: ['review:passed'] })).toBe('next: wait')
      expect(
        next({ fleet, author: 'birdbrain-agent', labels: ['agent-pr'], prepass: 'success' })
      ).toBe('next: wait')
      expect(next({ fleet, labels: ['merge'], autoMerge: true, mergeState: 'CLEAN' })).toBe(
        'next: wait'
      )
    }
  )

  it('asks for a fix when the review fleet failed', () => {
    expect(decideNext(facts({ fleet: 'failure', labels: ['review:passed'] }))).toEqual({
      label: 'next: fix',
      reason: 'the review fleet failed; its state comment says why'
    })
  })

  it('hands the PR to the maintainer once the review fleet passes, with no review label', () => {
    expect(decideNext(facts())).toEqual({
      label: 'next: merge',
      reason: 'everything is green; apply the merge label'
    })
  })

  it('reads the fleet as merge-gate does: not where it is off, uncovered or overridden', () => {
    expect(next({ fleet: 'failure', breakGlass: true })).toBe('next: merge')
    expect(next({ fleet: 'absent', fleetEnabled: false })).toBe('next: merge')
    const outside = { author: 'contributor', crossRepo: true, fleet: 'absent' }
    const fresh = [{ state: 'APPROVED', user: 'owner', commit: HEAD }]
    expect(next({ ...outside, reviews: fresh })).toBe('next: merge')
  })

  it('never offers the merge label while merge-gate would refuse the PR', () => {
    for (const fleet of ['pending', 'absent', 'override', 'failure', 'error']) {
      const f = facts({ fleet })
      expect(f.gate.pass).toBe(false)
      expect(decideNext(f).label).not.toBe('next: merge')
    }
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
