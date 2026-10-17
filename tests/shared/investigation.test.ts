import { describe, it, expect, expectTypeOf } from 'vitest'
import type { ManifestHeadRef } from '@main/services/manifest'
import {
  GAP_KINDS,
  compareGapTargets,
  compareMembers,
  compareNotRead,
  compareOwnIdentifiers,
  compareSourceClassHeads,
  sortInvestigationView,
  type CaseRevision,
  type GapTarget,
  type InvestigationView,
  type JointView,
  type MemberRef,
  type OwnIdentifierEntry,
  type SourceClassHead,
  type SpanView
} from '@shared/investigation'
import { FIXTURE_BEFORE_RUN_VIEW, FIXTURE_POPULATED_VIEW } from '@shared/investigationFixture'

// Two permutations, so a comparator that leans on input order fails one of them.
const reverse = <T>(items: T[]): T[] => [...items].reverse()
const rotate = <T>(items: T[]): T[] => (items.length < 2 ? items : [...items.slice(1), items[0]])

function scramble(view: InvestigationView, order: <T>(items: T[]) => T[]): InvestigationView {
  const spans = (list: SpanView[]): SpanView[] =>
    order(list.map((s) => ({ ...s, dates: order(s.dates) })))
  const joint = (j: JointView): JointView => ({
    ...j,
    decisions: order(j.decisions),
    support: spans(j.support),
    conflicts: spans(j.conflicts),
    unreviewed: spans(j.unreviewed),
    noLongerCounted: spans(j.noLongerCounted),
    dismissed: spans(j.dismissed),
    strength: j.strength && { ...j.strength, sourceClasses: order(j.strength.sourceClasses) }
  })
  return {
    ...view,
    run: view.run && {
      ...view.run,
      startingSubjectIds: order(view.run.startingSubjectIds),
      versions: { ...view.run.versions, rules: order(view.run.versions.rules) },
      counts: { ...view.run.counts, notRead: order(view.run.counts.notRead) }
    },
    subjects: order(
      view.subjects.map((s) => ({ ...s, waiting: order(s.waiting), placed: order(s.placed) }))
    ),
    joints: order(view.joints.map(joint)),
    passageGroups: order(view.passageGroups.map((g) => ({ ...g, holders: order(g.holders) }))),
    paths: order(view.paths),
    gaps: order(view.gaps.map((g) => ({ ...g, entries: order(g.entries) }))),
    withheld: order(view.withheld.map((w) => ({ ...w, holders: order(w.holders) })))
  }
}

describe('the canonical order', () => {
  it('puts every array of the populated view back in the fixture’s order', () => {
    for (const order of [reverse, rotate]) {
      const scrambled = scramble(FIXTURE_POPULATED_VIEW, order)
      expect(scrambled).not.toEqual(FIXTURE_POPULATED_VIEW)
      expect(sortInvestigationView(scrambled)).toEqual(FIXTURE_POPULATED_VIEW)
    }
  })

  it('leaves both plain views as they are, and orders gap groups by GapKind', () => {
    expect(sortInvestigationView(FIXTURE_POPULATED_VIEW)).toEqual(FIXTURE_POPULATED_VIEW)
    expect(sortInvestigationView(FIXTURE_BEFORE_RUN_VIEW)).toEqual(FIXTURE_BEFORE_RUN_VIEW)
    expect(FIXTURE_POPULATED_VIEW.gaps.map((g) => g.kind)).toEqual([...GAP_KINDS])
  })

  it('keeps arrays whose order carries meaning', () => {
    const view = FIXTURE_POPULATED_VIEW
    const path = view.paths[0]
    const reversed = { ...path, jointIds: reverse(path.jointIds) }
    const sortedView = sortInvestigationView({ ...view, paths: [reversed, ...view.paths.slice(1)] })
    expect(sortedView.paths.some((p) => p.jointIds.join() === reversed.jointIds.join())).toBe(true)
  })

  it('orders members, gap targets, unread counts, Source Class heads and Own Identifiers', () => {
    const member = (memberCode: string | null, operatorName: string): MemberRef => ({
      memberCode,
      operatorName,
      self: false
    })
    expect([member('NK', 'b'), member(null, 'z'), member('NK', 'a')].sort(compareMembers)).toEqual([
      member(null, 'z'),
      member('NK', 'a'),
      member('NK', 'b')
    ])

    const targets: GapTarget[] = [
      { kind: 'unread', exhibitKind: 'document', reason: 'kind-not-read', count: 1 },
      { kind: 'subjects', subjectIds: ['s2', 's1'] },
      { kind: 'exhibit', exhibitId: 'e1', spanId: null, field: null },
      { kind: 'joint', jointId: 'j1' }
    ]
    expect([...targets].sort(compareGapTargets).map((t) => t.kind)).toEqual([
      'exhibit',
      'joint',
      'subjects',
      'unread'
    ])

    expect(
      [
        { kind: 'document', reason: 'b', count: 1 },
        { kind: 'document', reason: 'a', count: 2 }
      ].sort(compareNotRead)
    ).toEqual([
      { kind: 'document', reason: 'a', count: 2 },
      { kind: 'document', reason: 'b', count: 1 }
    ])

    const head = (value: SourceClassHead['value'], code: string): SourceClassHead => ({
      value,
      member: member(code, code),
      reason: null,
      actedAt: ''
    })
    expect(
      [head('original', 'NK'), head('later-copy', 'MB')].sort(compareSourceClassHeads)
    ).toEqual([head('later-copy', 'MB'), head('original', 'NK')])

    const entry = (platform: string | null, value: string): OwnIdentifierEntry => ({
      id: value,
      kind: 'handle',
      platform,
      value,
      personaId: null,
      member: member('MB', 'MB')
    })
    expect(
      [entry('social.example.org', 'b'), entry(null, 'c'), entry('social.example.org', 'a')]
        .sort(compareOwnIdentifiers)
        .map((e) => e.value)
    ).toEqual(['c', 'a', 'b'])
  })
})

describe('the Case revision', () => {
  it('restates the Manifest head reference the main process reads', () => {
    expectTypeOf<ManifestHeadRef>().toMatchTypeOf<NonNullable<CaseRevision['manifestHead']>>()
    expectTypeOf<NonNullable<CaseRevision['manifestHead']>>().toMatchTypeOf<ManifestHeadRef>()
  })
})
