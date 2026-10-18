import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  FIXTURE_BEFORE_RUN_VIEW,
  FIXTURE_IDS,
  FIXTURE_POPULATED_VIEW,
  applyPopulatedResult,
  buildSpanDetail,
  createFixtureState,
  effectiveSourceClass,
  fixtureHash,
  jointStatus
} from '@shared/investigationFixture'
import type { JointDecisionView, SourceClassHead } from '@shared/investigation'

// This file sits under tests/renderer so the web typecheck project, which has no @main path,
// compiles the fixture's imports: renderer tests can import it as they are.

const RESERVED_HOST = /(^|\.)example\.(com|net|org)$/
const FIXTURE_SOURCE = join(__dirname, '..', '..', 'src', 'shared', 'investigationFixture.ts')

// Every host a text names: URL hosts and the domains of addresses (tests/retrievalEval.test.ts).
function hostsIn(text: string): string[] {
  const urls = [...text.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1].toLowerCase())
  const addresses = [...text.matchAll(/@([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi)].map((m) =>
    m[1].toLowerCase()
  )
  return [...urls, ...addresses]
}

function populatedState() {
  const state = createFixtureState()
  applyPopulatedResult(state, { id: FIXTURE_IDS.populatedRun, startedAt: '2026-10-03T14:02:00Z' })
  return state
}

function everySpanId(): string[] {
  const view = FIXTURE_POPULATED_VIEW
  return [
    ...view.joints.flatMap((j) =>
      [...j.support, ...j.conflicts, ...j.unreviewed, ...j.noLongerCounted, ...j.dismissed].map(
        (s) => s.id
      )
    ),
    ...view.subjects.flatMap((s) => [...s.waiting, ...s.placed].map((w) => w.id)),
    ...view.passageGroups.flatMap((g) => g.holders.map((h) => h.spanId))
  ]
}

describe('the investigation fixture', () => {
  it('names only reserved example hosts, in its source and in everything it serves', () => {
    const state = populatedState()
    const served = [
      readFileSync(FIXTURE_SOURCE, 'utf8'),
      JSON.stringify(FIXTURE_BEFORE_RUN_VIEW),
      JSON.stringify(FIXTURE_POPULATED_VIEW),
      JSON.stringify(state.ownIdentifiers),
      // An excerpt can cut a URL at its edge; the whole text it is cut from is in the source.
      ...everySpanId().map((id) => JSON.stringify({ ...buildSpanDetail(state, id), excerpt: null }))
    ]
    const hosts = served.flatMap(hostsIn)
    expect(hosts.length).toBeGreaterThan(20)
    for (const host of hosts) expect(host).toMatch(RESERVED_HOST)
  })

  it('names people only by the engine spec’s invented names', () => {
    const invented = new Set([
      'M. Calloway',
      'Jun Sato',
      'The Ferryman',
      'Rowan Pike',
      'Imogen Hale'
    ])
    const people = FIXTURE_POPULATED_VIEW.subjects.filter(
      (s) => s.kind === 'person' || s.kind === 'pseudonym'
    )
    expect(people.length).toBeGreaterThan(0)
    for (const person of people) expect(invented).toContain(person.name)
  })

  it('uses UUIDs for every id a log context could carry', () => {
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    const ids = [
      ...Object.values(FIXTURE_IDS.exhibits),
      ...Object.values(FIXTURE_IDS.subjects),
      ...Object.values(FIXTURE_IDS.joints),
      FIXTURE_IDS.note,
      FIXTURE_IDS.persona,
      ...everySpanId()
    ]
    for (const id of ids) expect(id).toMatch(uuid)
  })

  it('cuts every excerpt so its offsets slice back to the span’s value', () => {
    const state = populatedState()
    for (const id of everySpanId()) {
      const detail = buildSpanDetail(state, id)
      if (!detail?.excerpt) continue
      const { text, start, end } = detail.excerpt
      expect(text.slice(start, end)).toBe(detail.value)
    }
    expect(buildSpanDetail(state, FIXTURE_IDS.note)).toBeNull()
  })

  it('serves a before-run view with no run and a populated view with one', () => {
    expect(FIXTURE_BEFORE_RUN_VIEW.run).toBeNull()
    expect(FIXTURE_BEFORE_RUN_VIEW.joints).toEqual([])
    expect(FIXTURE_POPULATED_VIEW.run?.id).toBe(FIXTURE_IDS.populatedRun)
    expect(FIXTURE_POPULATED_VIEW.joints.length).toBeGreaterThan(5)
  })

  it('hashes deterministically to 64 hex characters', () => {
    expect(fixtureHash('a')).toBe(fixtureHash('a'))
    expect(fixtureHash('a')).not.toBe(fixtureHash('b'))
    expect(fixtureHash('')).toMatch(/^[0-9a-f]{64}$/)
  })

  it('derives the effective Source Class and a Joint’s status from members’ heads', () => {
    const head = (value: SourceClassHead['value']): SourceClassHead => ({
      value,
      member: { memberCode: null, operatorName: 'x', self: true },
      reason: null,
      actedAt: ''
    })
    expect(effectiveSourceClass([])).toBe('unclassified')
    expect(effectiveSourceClass([head('original')])).toBe('original')
    expect(effectiveSourceClass([head('original'), head('later-copy')])).toBe('unclassified')
    expect(effectiveSourceClass([head('original'), head('ai-origin')])).toBe('ai-origin')

    const decision = (
      code: string,
      seq: number,
      kind: JointDecisionView['decision']
    ): JointDecisionView => ({
      id: `${code}${seq}`,
      member: { memberCode: code, operatorName: code, self: false },
      seq,
      decision: kind,
      reason: null,
      context: null,
      decidedAt: ''
    })
    expect(jointStatus([])).toBe('proposed')
    expect(jointStatus([decision('NK', 1, 'reject')])).toBe('rejected')
    expect(jointStatus([decision('NK', 2, 'restore'), decision('NK', 1, 'accept')])).toBe(
      'proposed'
    )
    expect(jointStatus([decision('NK', 1, 'accept'), decision('MB', 1, 'reject')])).toBe(
      'contested'
    )
  })
})
