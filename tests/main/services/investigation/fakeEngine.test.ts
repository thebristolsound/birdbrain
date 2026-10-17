import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { IpcMainInvokeEvent } from 'electron'

// The fake registers through handle(), so ipcMain is replaced by a map the tests call directly,
// as tests/main/ipcHandlers.test.ts does.
const registered = vi.hoisted(
  () => new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>()
)
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, fn: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => {
      registered.set(channel, fn)
    }
  }
}))

import { IPC_CHANNELS } from '@shared/ipc'
import {
  GAP_KINDS,
  sortInvestigationView,
  type CaseChange,
  type CaseRevision,
  type ClaimCheck,
  type InvestigationView,
  type JointView,
  type OwnIdentifierEntry,
  type RunProgressEvent,
  type RunRequest,
  type SpanDetail,
  type SpanView
} from '@shared/investigation'
import {
  FIXTURE_IDS,
  FIXTURE_NO_JOINTS_INQUIRY,
  FIXTURE_NOTE_CLAIM,
  FIXTURE_POPULATED_INQUIRY
} from '@shared/investigationFixture'
import {
  createFakeInvestigation,
  registerFakeInvestigationHandlers
} from '@main/services/investigation/fakeEngine'

const C = IPC_CHANNELS
const E = FIXTURE_IDS.exhibits
const S = FIXTURE_IDS.subjects
const J = FIXTURE_IDS.joints
const CASE = '20000000-0000-4000-8000-000000000001'
const UNKNOWN = '30000000-0000-4000-8000-000000000099'

type Result<T> = { ok: boolean; data?: T; error?: string }

const send = vi.fn()
let destroyed = false
const event = {
  sender: { send, isDestroyed: () => destroyed }
} as unknown as IpcMainInvokeEvent

let idSeq = 0
const newId = (): string => `10000000-0000-4000-8000-${(idSeq += 1).toString(16).padStart(12, '0')}`
let clock = Date.parse('2026-10-17T12:00:00.000Z')
const now = (): Date => new Date((clock += 1000))

beforeEach(() => {
  registered.clear()
  send.mockClear()
  destroyed = false
  registerFakeInvestigationHandlers(createFakeInvestigation({ phaseDelayMs: 0, newId, now }))
})

async function call<T>(channel: string, ...args: unknown[]): Promise<Result<T>> {
  const fn = registered.get(channel)
  if (!fn) throw new Error(`No handler registered for ${channel}`)
  return (await fn(event, ...args)) as Result<T>
}

async function ok<T>(channel: string, ...args: unknown[]): Promise<T> {
  const result = await call<T>(channel, ...args)
  expect(result.ok, result.error).toBe(true)
  return result.data as T
}

const progressFor = (runId: string): RunProgressEvent[] =>
  send.mock.calls
    .filter(([channel]) => channel === C.INVESTIGATION_PROGRESS)
    .map(([, payload]) => payload as RunProgressEvent)
    .filter((p) => p.runId === runId)

const terminalOf = (runId: string): RunProgressEvent | undefined =>
  progressFor(runId).find((p) => p.status !== 'running')

async function untilEnded(runId: string): Promise<RunProgressEvent> {
  await vi.waitFor(() => expect(terminalOf(runId)).toBeDefined())
  return terminalOf(runId) as RunProgressEvent
}

const populated = (caseId = CASE): RunRequest => ({
  caseId,
  from: 'inquiry',
  inquiry: FIXTURE_POPULATED_INQUIRY,
  startingSubjectIds: [S.calloway, S.sato, S.ferryman]
})

async function storedRun(request: RunRequest = populated()): Promise<string> {
  const runId = await ok<string>(C.INVESTIGATION_START_RUN, request)
  expect((await untilEnded(runId)).status).toBe('stored')
  return runId
}

const getView = (caseId = CASE): Promise<InvestigationView> =>
  ok<InvestigationView>(C.INVESTIGATION_GET_VIEW, caseId)

const jointIn = (view: InvestigationView, id: string): JointView => {
  const joint = view.joints.find((j) => j.id === id)
  if (!joint) throw new Error(`no Joint ${id}`)
  return joint
}

const spansOf = (j: JointView): SpanView[] => [
  ...j.support,
  ...j.conflicts,
  ...j.unreviewed,
  ...j.noLongerCounted,
  ...j.dismissed
]

const allSpans = (view: InvestigationView): SpanView[] => view.joints.flatMap(spansOf)

describe('registration', () => {
  it('registers a handler for every investigation channel', () => {
    const channels = Object.values(IPC_CHANNELS).filter((c) => c.startsWith('investigation:'))
    expect(channels).toHaveLength(18)
    expect(channels.filter((c) => !registered.has(c))).toEqual([])
  })

  it('sends no progress to a window that has closed', async () => {
    destroyed = true
    const runId = await ok<string>(C.INVESTIGATION_START_RUN, populated())
    await vi.waitFor(async () => expect((await getView()).run?.id).toBe(runId))
    expect(send).not.toHaveBeenCalled()
  })
})

describe('S1 and state 1: before any run', () => {
  it('serves no run, no Joints, the hand-added Subjects and the withheld Exhibits', async () => {
    const view = await getView()
    expect(view.run).toBeNull()
    expect(view.joints).toEqual([])
    expect(view.gaps).toEqual([])
    const pikes = view.subjects.filter((s) => s.name === 'Rowan Pike')
    expect(pikes).toHaveLength(2)
    expect(new Set(pikes.map((p) => p.detail)).size).toBe(2)
    expect(view.subjects.every((s) => s.createdByRunId === null)).toBe(true)
    expect(view.withheld.map((w) => w.exhibitId).sort()).toEqual(
      [E.withheldAfter, E.withheldBefore].sort()
    )
  })

  it('accepts each of the three run request forms', async () => {
    await storedRun()
    await storedRun({ caseId: CASE, from: 'find-more', jointId: J.callowaySato })
    const runId = await storedRun({
      caseId: CASE,
      from: 'note-claim',
      noteId: FIXTURE_IDS.note,
      passage: { start: 0, end: 12 },
      subjectIds: [S.calloway, S.ferryman]
    })
    const view = await getView()
    expect(view.run?.id).toBe(runId)
    expect(view.run?.from).toBe('note-claim')
    const claim = jointIn(view, J.noteClaimRun)
    expect(claim.claim).toBe(FIXTURE_NOTE_CLAIM)
    expect(claim.producer).toEqual({ kind: 'operator', noteId: FIXTURE_IDS.note })
    expect(claim.support).toEqual([])
    const unsupported = view.gaps.find((g) => g.kind === 'claim-without-support')
    expect(unsupported?.entries).toContainEqual({ kind: 'joint', jointId: J.noteClaimRun })

    // A second Note-claim run updates the same Operator-started Joint.
    const otherNote = '20000000-0000-4000-8000-0000000000aa'
    await storedRun({
      caseId: CASE,
      from: 'note-claim',
      noteId: otherNote,
      passage: { start: 3, end: 9 },
      subjectIds: [S.sato]
    })
    const again = jointIn(await getView(), J.noteClaimRun)
    expect(again.subjectIds).toEqual([S.sato])
    expect(again.producer).toEqual({ kind: 'operator', noteId: otherNote })
  })
})

describe('S2: the view header', () => {
  it('carries the inquiry, the Subjects, the counts, the depth, the parameters and the basis', async () => {
    const runId = await storedRun()
    const { run } = await getView()
    expect(run?.id).toBe(runId)
    expect(run?.inquiry).toBe(FIXTURE_POPULATED_INQUIRY)
    expect(run?.startingSubjectIds).toEqual([S.calloway, S.sato, S.ferryman].sort())
    expect(run?.counts).toEqual({
      total: 17,
      read: 13,
      withheld: 2,
      notRead: [
        { kind: 'attachment', reason: 'kind-not-read', count: 1 },
        { kind: 'document', reason: 'kind-not-read', count: 1 }
      ]
    })
    expect(run?.parameters.followDepth).toBe(2)
    expect(run?.parameters.version).toBe('params/1')
    expect(run?.basis.counter).toBe(0)
    expect(run?.stored.counter).toBe(1)
    expect(run?.startedAt).toMatch(/^2026-/)
  })
})

describe('S3: the Joint map and list', () => {
  it('holds every status, a single-Subject Joint, a weak Joint and both kinds of path', async () => {
    await storedRun()
    const view = await getView()
    expect(view.subjects.length).toBeGreaterThan(8)
    const joined = new Set(view.joints.flatMap((j) => j.subjectIds))
    expect(view.subjects.some((s) => !joined.has(s.id))).toBe(true)
    expect(new Set(view.joints.map((j) => j.status))).toEqual(
      new Set(['proposed', 'accepted', 'rejected', 'contested'])
    )
    expect(view.joints.some((j) => j.subjectIds.length === 1)).toBe(true)
    expect(view.joints.some((j) => j.weak && j.strength !== null)).toBe(true)
    expect(view.joints.some((j) => j.unreviewed.length > 0)).toBe(true)
    expect(view.paths.some((p) => p.accepted)).toBe(true)
    expect(view.paths.some((p) => !p.accepted)).toBe(true)
    const beside = view.paths.find((p) => p.directJointId !== null)
    expect(['proposed', 'rejected']).toContain(jointIn(view, beside?.directJointId ?? '').status)
  })

  it('drops a path once one of its Joints is rejected', async () => {
    await storedRun()
    await ok(C.INVESTIGATION_DECIDE_JOINT, {
      caseId: CASE,
      jointId: J.sharedPassage,
      decision: 'reject',
      reason: null,
      context: null
    })
    const view = await getView()
    expect(view.paths.some((p) => p.jointIds.includes(J.sharedPassage))).toBe(false)
    const named = (kind: string) => view.gaps.find((g) => g.kind === kind)?.entries ?? []
    expect(named('path-on-unaccepted-joint')).toEqual([])
    expect(named('reached-only-through-another')).toEqual([
      { kind: 'subjects', subjectIds: [S.ferryman] }
    ])
  })

  it('names each unaccepted Joint on a possible path, and each path end reached through another', async () => {
    await storedRun()
    const view = await getView()
    const possible = view.paths.filter((p) => !p.accepted)
    expect(possible.length).toBeGreaterThan(0)
    const unaccepted = possible
      .flatMap((p) => p.jointIds)
      .filter((id) => jointIn(view, id).status !== 'accepted')
    const named = (kind: string) => view.gaps.find((g) => g.kind === kind)?.entries ?? []
    expect(named('path-on-unaccepted-joint')).toEqual(
      unaccepted.sort().map((jointId) => ({ kind: 'joint', jointId }))
    )
    expect(named('reached-only-through-another')).toEqual(
      view.paths
        .map((p) => p.toSubjectId)
        .sort()
        .map((id) => ({ kind: 'subjects', subjectIds: [id] }))
    )
  })
})

describe('S4: Joint detail', () => {
  it('holds every list, reason, producer and decision shape the detail shows', async () => {
    await storedRun()
    const view = await getView()
    const mixed = view.joints.find((j) => j.support.length > 0 && j.conflicts.length > 0)
    expect(
      new Set([...(mixed?.support ?? []), ...(mixed?.conflicts ?? [])].map((s) => s.sourceClass))
        .size
    ).toBeGreaterThan(1)
    const [group] = view.passageGroups
    expect(group.count).toBe(group.holders.length)
    expect(group.count).toBeGreaterThan(group.ceiling)
    const lost = view.joints.flatMap((j) => j.noLongerCounted.map((s) => s.availability))
    expect(new Set(lost)).toEqual(new Set(['withheld', 'no-longer-counted', 'unavailable']))
    expect(view.joints.some((j) => j.unreviewed.some((s) => s.sourceClass === 'ai-origin'))).toBe(
      true
    )
    expect(view.joints.some((j) => j.dismissed.length > 0)).toBe(true)
    const contexts = view.joints.flatMap((j) => j.decisions.map((d) => d.context))
    expect(contexts.some((c) => c !== null && Object.values(c).includes(null))).toBe(true)
    expect(view.joints.some((j) => j.producer.kind === 'rule' && j.producer.version !== '')).toBe(
      true
    )
    expect(view.joints.some((j) => j.producer.kind === 'operator' && j.producer.noteId)).toBe(true)
    expect(jointIn(view, J.callowaySato).basis.asOf).toBe(view.run?.startedAt)
    const lostSide = jointIn(view, J.ledgerLostSide)
    expect(lostSide.status).toBe('accepted')
    expect(lostSide.lostSide).toBe('b')
  })

  it('refuses an accept without available reviewed support on each side, changing nothing', async () => {
    await storedRun()
    const before = await getView()
    for (const jointId of [J.sharedPassage, J.ledgerLostSide]) {
      const result = await call(C.INVESTIGATION_DECIDE_JOINT, {
        caseId: CASE,
        jointId,
        decision: 'accept',
        reason: null,
        context: null
      })
      expect(result.ok).toBe(false)
    }
    expect(await getView()).toEqual(before)
  })

  it('records an accept with its context once support is added, and moves spans on review', async () => {
    await storedRun()
    const passage = jointIn(await getView(), J.sharedPassage)
    for (const span of passage.unreviewed.filter((s) => s.locator.field === 'text.passage')) {
      await ok(C.INVESTIGATION_DECIDE_SPAN, {
        caseId: CASE,
        spanId: span.id,
        action: 'add-support',
        reason: null
      })
    }
    const context = { assumptions: 'Copied text.', confidence: null, alternatives: null }
    await ok(C.INVESTIGATION_DECIDE_JOINT, {
      caseId: CASE,
      jointId: J.sharedPassage,
      decision: 'accept',
      reason: null,
      context
    })
    const after = jointIn(await getView(), J.sharedPassage)
    expect(after.status).toBe('accepted')
    expect(after.decisions.at(-1)?.context).toEqual(context)
    const [first, second] = after.support
    await ok(C.INVESTIGATION_DECIDE_SPAN, {
      caseId: CASE,
      spanId: first.id,
      action: 'add-conflict',
      reason: null
    })
    await ok(C.INVESTIGATION_DECIDE_SPAN, {
      caseId: CASE,
      spanId: second.id,
      action: 'dismiss',
      reason: 'Boilerplate.'
    })
    const moved = jointIn(await getView(), J.sharedPassage)
    expect(moved.conflicts.map((s) => s.id)).toContain(first.id)
    expect(moved.dismissed.map((s) => s.id)).toContain(second.id)
    await ok(C.INVESTIGATION_DECIDE_SPAN, {
      caseId: CASE,
      spanId: second.id,
      action: 'undo',
      reason: null
    })
    const undone = jointIn(await getView(), J.sharedPassage).unreviewed.find(
      (s) => s.id === second.id
    )
    expect(undone?.addedBy).toBeNull()
    const refused = await call(C.INVESTIGATION_DECIDE_SPAN, {
      caseId: CASE,
      spanId: second.id,
      action: 'promote',
      reason: null
    })
    expect(refused.ok).toBe(false)
  })

  it('refuses an inherited property name as a span action, and the view still reads', async () => {
    await storedRun()
    const before = await getView()
    const span = jointIn(before, J.sharedPassage).unreviewed[0]
    for (const action of ['constructor', 'toString', '__proto__']) {
      const result = await call(C.INVESTIGATION_DECIDE_SPAN, {
        caseId: CASE,
        spanId: span.id,
        action,
        reason: null
      })
      expect(result.ok, action).toBe(false)
    }
    expect(await getView()).toEqual(before)
  })
})

describe('S5: the source inspector', () => {
  it('answers every span id the view names, with an excerpt only for an available span', async () => {
    await storedRun()
    const view = await getView()
    const ids = [
      ...allSpans(view).map((s) => s.id),
      ...view.subjects.flatMap((s) => [...s.waiting, ...s.placed].map((w) => w.id)),
      ...view.passageGroups.flatMap((g) => g.holders.map((h) => h.spanId))
    ]
    expect(ids.length).toBeGreaterThan(30)
    for (const spanId of ids) {
      const detail = await ok<SpanDetail>(C.INVESTIGATION_GET_SPAN, CASE, spanId)
      expect(detail.spanId).toBe(spanId)
      if (detail.availability === 'unavailable') expect(detail.excerpt).toBeNull()
      else {
        const { text, start, end } = detail.excerpt ?? { text: '', start: 0, end: 0 }
        expect(text.slice(start, end)).toBe(detail.value)
      }
    }
  })

  it('carries each item the inspector shows', async () => {
    await storedRun()
    const view = await getView()
    const detailOn = async (exhibitId: string, field?: string): Promise<SpanDetail> => {
      const span = allSpans(view).find(
        (s) => s.exhibitId === exhibitId && (!field || s.locator.field === field)
      )
      return ok<SpanDetail>(C.INVESTIGATION_GET_SPAN, CASE, span?.id)
    }
    expect((await detailOn(E.headersOnly)).exhibit.bodyAcquired).toBe(false)
    const forum = await detailOn(E.forum, 'text.address')
    const forumSpan = allSpans(view).find((s) => s.id === forum.spanId)
    expect(forum.exhibit).toMatchObject({
      exhibitId: E.forum,
      exhibitNumber: 4,
      memberCode: 'MB',
      kind: 'capture',
      contentHash: forumSpan?.contentHash
    })
    expect(forum.exhibit.contentHash).toMatch(/^[0-9a-f]{64}$/)
    expect(forum.check?.basis).toBe('unattested')
    expect(forum.holders).toEqual({ count: 4, of: 13 })
    expect(forum.identifier).toMatchObject({ kind: 'mail', ownIdentifierId: null })
    const article = await detailOn(E.article)
    expect(new Set(article.sourceClass.heads.map((h) => h.value)).size).toBe(2)
    expect(article.sourceClass.effective).toBe('unclassified')
    expect(article.sourceTrail.url).toMatch(/^https:\/\/gazette\.example\.com\//)
    expect(article.sourceTrail.waybackRefs[0]).toMatchObject({
      snapshotTimestamp: expect.any(String),
      checkedAt: expect.any(String),
      pinnedAt: expect.any(String)
    })
    expect((await detailOn(E.copy)).copyMarks).toHaveLength(1)
    const withheld = await detailOn(E.withheldAfter)
    expect(withheld.withheld).toEqual({
      withheld: true,
      holders: [expect.objectContaining({ self: true })]
    })

    await ok(C.INVESTIGATION_MARK_OWN_IDENTIFIER, {
      caseId: CASE,
      kind: 'mail',
      platform: null,
      value: forum.value,
      personaId: null
    })
    const marked = await ok<SpanDetail>(C.INVESTIGATION_GET_SPAN, CASE, forum.spanId)
    expect(marked.identifier?.ownIdentifierId).not.toBeNull()
  })
})

describe('S6: the gap list', () => {
  it('holds a group for every gap kind, in order, each entry naming what it opens', async () => {
    await storedRun()
    const view = await getView()
    expect(view.gaps.map((g) => g.kind)).toEqual([...GAP_KINDS])
    const jointIds = new Set(view.joints.map((j) => j.id))
    const subjectIds = new Set(view.subjects.map((s) => s.id))
    for (const target of view.gaps.flatMap((g) => g.entries)) {
      if (target.kind === 'joint') expect(jointIds.has(target.jointId)).toBe(true)
      if (target.kind === 'subjects') {
        expect(target.subjectIds.every((id) => subjectIds.has(id))).toBe(true)
      }
      if (target.kind === 'exhibit') expect(Object.values(E)).toContain(target.exhibitId)
    }
    const unread = view.gaps.find((g) => g.kind === 'search-not-run')?.entries ?? []
    expect(unread.map((t) => (t.kind === 'unread' ? t.exhibitKind : ''))).toEqual([
      'attachment',
      'document'
    ])
  })
})

describe('S9: Own Identifiers', () => {
  it('lists, marks and unmarks entries, and refuses to unmark another member’s', async () => {
    const list = await ok<OwnIdentifierEntry[]>(C.INVESTIGATION_LIST_OWN_IDENTIFIERS, CASE)
    expect(new Set(list.map((o) => o.kind)).size).toBeGreaterThanOrEqual(2)
    expect(list.some((o) => o.member.memberCode === 'NK')).toBe(true)
    expect(list.some((o) => o.personaId !== null)).toBe(true)
    await ok(C.INVESTIGATION_MARK_OWN_IDENTIFIER, {
      caseId: CASE,
      kind: 'domain',
      platform: null,
      value: 'post.example.com',
      personaId: FIXTURE_IDS.persona
    })
    const added = await ok<OwnIdentifierEntry[]>(C.INVESTIGATION_LIST_OWN_IDENTIFIERS, CASE)
    expect(added).toHaveLength(list.length + 1)
    const mine = added.find((o) => o.value === 'post.example.com')
    await ok(C.INVESTIGATION_UNMARK_OWN_IDENTIFIER, { caseId: CASE, entryId: mine?.id })
    expect(await ok(C.INVESTIGATION_LIST_OWN_IDENTIFIERS, CASE)).toEqual(list)
    const theirs = list.find((o) => !o.member.self)
    const refused = await call(C.INVESTIGATION_UNMARK_OWN_IDENTIFIER, {
      caseId: CASE,
      entryId: theirs?.id
    })
    expect(refused.ok).toBe(false)
    const blank = await call(C.INVESTIGATION_MARK_OWN_IDENTIFIER, {
      caseId: CASE,
      kind: 'mail',
      platform: null,
      value: '',
      personaId: null
    })
    expect(blank.ok).toBe(false)
  })
})

describe('S10 and state 8: same-name Subjects', () => {
  const pikes = (view: InvestigationView) =>
    view.subjects.filter((s) => s.id === S.pikeByline || s.id === S.pikeMinutes)

  it('waits on both Rowan Pikes until a choice, and undoes each choice', async () => {
    await storedRun()
    const view = await getView()
    const [first, second] = pikes(view)
    expect(first.waiting).toHaveLength(1)
    expect(second.waiting).toHaveLength(1)
    expect(view.gaps.find((g) => g.kind === 'same-name-unjoined')?.entries).toEqual([
      { kind: 'subjects', subjectIds: [S.pikeByline, S.pikeMinutes] }
    ])
    const spanId = first.waiting[0].id
    const choose = { caseId: CASE, spanId, action: 'choose', subjectId: S.pikeByline }

    expect((await call(C.INVESTIGATION_CHOOSE_SUBJECT, { ...choose, subjectId: S.hale })).ok).toBe(
      false
    )
    expect((await call(C.INVESTIGATION_CHOOSE_SUBJECT, { ...choose, action: 'undo' })).ok).toBe(
      false
    )
    expect((await call(C.INVESTIGATION_CHOOSE_SUBJECT, { ...choose, action: 'pick' })).ok).toBe(
      false
    )
    await ok(C.INVESTIGATION_CHOOSE_SUBJECT, choose)
    const chosen = await getView()
    expect(pikes(chosen).every((s) => s.waiting.length === 0 && s.placed.length === 1)).toBe(true)
    const placed = pikes(chosen)[0].placed[0]
    expect(placed.choice).toMatchObject({ action: 'choose', subjectId: S.pikeByline })
    const started = jointIn(chosen, placed.choice?.action === 'choose' ? placed.choice.jointId : '')
    expect(started.subjectIds).toEqual([S.pikeByline])
    expect(started.support.map((s) => s.value)).toEqual(['Rowan Pike'])
    expect(started.createdByRunId).toBeNull()
    expect((await call(C.INVESTIGATION_CHOOSE_SUBJECT, { ...choose, action: 'none' })).ok).toBe(
      false
    )

    await ok(C.INVESTIGATION_CHOOSE_SUBJECT, { ...choose, action: 'undo' })
    const undone = await getView()
    expect(undone.joints.some((j) => j.id === started.id)).toBe(false)
    expect(pikes(undone).every((s) => s.waiting.length === 1)).toBe(true)

    await ok(C.INVESTIGATION_CHOOSE_SUBJECT, { caseId: CASE, spanId, action: 'none' })
    const neither = await getView()
    expect(neither.joints).toHaveLength(undone.joints.length)
    expect(pikes(neither).every((s) => s.waiting.length === 0)).toBe(true)
    expect(pikes(neither)[0].placed[0].choice).toEqual({ action: 'none' })
    await ok(C.INVESTIGATION_CHOOSE_SUBJECT, { caseId: CASE, spanId, action: 'undo' })
    expect(pikes(await getView()).every((s) => s.waiting.length === 1)).toBe(true)
  })
})

describe('state 2: a run in progress', () => {
  it('resolves the run id first, then sends every phase in order and one terminal event', async () => {
    const runId = await ok<string>(C.INVESTIGATION_START_RUN, populated())
    expect(terminalOf(runId)).toBeUndefined()
    const terminal = await untilEnded(runId)
    const events = progressFor(runId)
    expect(events.map((e) => [e.phase, e.status])).toEqual([
      ['inventory', 'running'],
      ['search', 'running'],
      ['check', 'running'],
      ['store', 'running'],
      ['store', 'stored']
    ])
    const read = events.map((e) => e.exhibitsRead)
    expect(read).toEqual([...read].sort((a, b) => a - b))
    expect(terminal).toMatchObject({ caseId: CASE, status: 'stored', reason: null })
  })

  it('cancels a run, which reports nothing and leaves the view as it was', async () => {
    await storedRun()
    const before = await getView()
    const runId = await ok<string>(C.INVESTIGATION_START_RUN, populated())
    expect((await call(C.INVESTIGATION_START_RUN, populated())).ok).toBe(false)
    await ok(C.INVESTIGATION_CANCEL_RUN, CASE, runId)
    expect(terminalOf(runId)).toMatchObject({ status: 'canceled', reason: null })
    expect(await getView()).toEqual(before)
    expect((await call(C.INVESTIGATION_CANCEL_RUN, CASE, runId)).ok).toBe(false)
    expect((await call(C.INVESTIGATION_GET_CHANGES, CASE, runId)).ok).toBe(false)
  })
})

describe('state 3: no Joints found', () => {
  it('stores a run with no Joints and a gap entry on a Case with no earlier run', async () => {
    await storedRun({ ...populated(), inquiry: FIXTURE_NO_JOINTS_INQUIRY } as RunRequest)
    const view = await getView()
    expect(view.run?.inquiry).toBe(FIXTURE_NO_JOINTS_INQUIRY)
    expect(view.joints).toEqual([])
    expect(view.gaps.length).toBeGreaterThan(0)
  })
})

describe('state 4: cannot-check', () => {
  it('serves a cannot-check span with its reason, and checkSpan agrees', async () => {
    await storedRun()
    const span = allSpans(await getView()).find((s) => s.check?.text === 'cannot-check')
    expect(span?.check?.reason).toBeTruthy()
    expect(await ok<ClaimCheck>(C.INVESTIGATION_CHECK_SPAN, CASE, span?.id)).toEqual(span?.check)
  })
})

describe('state 5: changed or missing files', () => {
  it('reports each Exhibit’s Integrity Status, with no excerpt and no counted support', async () => {
    await storedRun()
    const lost = jointIn(await getView(), J.ledgerLostSide).noLongerCounted
    const integrity: string[] = []
    for (const span of lost) {
      expect(span.availability).toBe('unavailable')
      const detail = await ok<SpanDetail>(C.INVESTIGATION_GET_SPAN, CASE, span.id)
      expect(detail.excerpt).toBeNull()
      integrity.push(detail.exhibit.integrity ?? '')
      const check = await ok<ClaimCheck>(C.INVESTIGATION_CHECK_SPAN, CASE, span.id)
      expect(check).toMatchObject({ text: 'cannot-check', basis: null })
    }
    expect(integrity.sort()).toEqual(['missing', 'tampered'])
  })
})

describe('state 6: a withheld Exhibit', () => {
  it('moves the Exhibit’s spans to no longer counted while any member withholds it', async () => {
    await storedRun()
    const onForum = (view: InvestigationView) =>
      allSpans(view).filter((s) => s.exhibitId === E.forum)
    const before = await getView()
    expect(onForum(before).some((s) => s.availability === 'available')).toBe(true)
    await ok(C.INVESTIGATION_SET_WITHHELD, { caseId: CASE, exhibitId: E.forum, withheld: true })
    const withheld = await getView()
    expect(withheld.withheld.map((w) => w.exhibitId)).toContain(E.forum)
    for (const joint of withheld.joints) {
      const counted = [...joint.support, ...joint.conflicts, ...joint.unreviewed]
      expect(counted.some((s) => s.exhibitId === E.forum)).toBe(false)
    }
    expect(onForum(withheld).every((s) => s.availability === 'withheld')).toBe(true)
    await ok(C.INVESTIGATION_SET_WITHHELD, { caseId: CASE, exhibitId: E.forum, withheld: false })
    expect((await getView()).joints).toEqual(before.joints)

    // The events page holds a reviewed conflict and an unreviewed span, which move the same way.
    const onEvents = (view: InvestigationView) =>
      view.joints
        .flatMap((j) => [
          ...j.conflicts.map((s) => ['conflicts', s] as const),
          ...j.unreviewed.map((s) => ['unreviewed', s] as const),
          ...j.noLongerCounted.map((s) => ['noLongerCounted', s] as const)
        ])
        .filter(([, s]) => s.exhibitId === E.events)
    expect(new Set(onEvents(before).map(([list]) => list))).toEqual(
      new Set(['conflicts', 'unreviewed'])
    )
    await ok(C.INVESTIGATION_SET_WITHHELD, { caseId: CASE, exhibitId: E.events, withheld: true })
    const events = onEvents(await getView())
    expect(events.length).toBe(onEvents(before).length)
    expect(
      events.every(([list, s]) => list === 'noLongerCounted' && s.availability === 'withheld')
    ).toBe(true)
    expect(new Set(events.map(([, s]) => s.review))).toEqual(new Set(['conflict', 'unreviewed']))
    await ok(C.INVESTIGATION_SET_WITHHELD, { caseId: CASE, exhibitId: E.events, withheld: false })
    expect((await getView()).joints).toEqual(before.joints)

    await ok(C.INVESTIGATION_SET_WITHHELD, {
      caseId: CASE,
      exhibitId: E.withheldBefore,
      withheld: false
    })
    const teammate = (await getView()).withheld.find((w) => w.exhibitId === E.withheldBefore)
    expect(teammate?.holders.map((h) => h.memberCode)).toEqual(['NK'])
  })

  it('moves reviewed support from an AI-origin Exhibit, and back when the class changes', async () => {
    await storedRun()
    const set = (exhibitId: string, value: string) =>
      ok(C.INVESTIGATION_SET_SOURCE_CLASS, { caseId: CASE, exhibitId, value, reason: null })
    await set(E.forum, 'ai-origin')
    const sato = jointIn(await getView(), J.satoFerryman)
    expect(sato.noLongerCounted.some((s) => s.exhibitId === E.forum)).toBe(true)
    await set(E.forum, 'commercial')
    const back = jointIn(await getView(), J.satoFerryman)
    expect(back.support.find((s) => s.exhibitId === E.forum)?.sourceClass).toBe('commercial')
    expect(
      (
        await call(C.INVESTIGATION_SET_SOURCE_CLASS, {
          caseId: CASE,
          exhibitId: E.forum,
          value: 'rumour',
          reason: null
        })
      ).ok
    ).toBe(false)
  })
})

describe('state 7: a rejected Joint', () => {
  it('returns to proposed on restore', async () => {
    await storedRun()
    expect(jointIn(await getView(), J.citation).status).toBe('rejected')
    await ok(C.INVESTIGATION_DECIDE_JOINT, {
      caseId: CASE,
      jointId: J.citation,
      decision: 'restore',
      reason: null,
      context: null
    })
    expect(jointIn(await getView(), J.citation).status).toBe('proposed')
  })
})

describe('state 10: run basis out of date', () => {
  const writes: [string, string, (caseId: string) => unknown, CaseChange['kind'], string][] = [
    [
      'setWithheld',
      C.INVESTIGATION_SET_WITHHELD,
      (caseId) => ({ caseId, exhibitId: E.forum, withheld: true }),
      'withheld',
      E.forum
    ],
    [
      'setSourceClass',
      C.INVESTIGATION_SET_SOURCE_CLASS,
      (caseId) => ({ caseId, exhibitId: E.forum, value: 'original', reason: null }),
      'source-class',
      E.forum
    ],
    [
      'setCopyMark',
      C.INVESTIGATION_SET_COPY_MARK,
      (caseId) => ({ caseId, copyExhibitId: E.copy, originalExhibitId: E.article, marked: false }),
      'copy-mark',
      E.copy
    ],
    [
      'unmarkOwnIdentifier',
      C.INVESTIGATION_UNMARK_OWN_IDENTIFIER,
      (caseId) => ({ caseId, entryId: FIXTURE_IDS.ownIdentifiers.personaMail }),
      'own-identifier',
      FIXTURE_IDS.ownIdentifiers.personaMail
    ]
  ]

  it.each(writes)(
    '%s puts the stored run out of date',
    async (_, channel, params, kind, target) => {
      const runId = await storedRun()
      const { run } = await getView()
      const current = await ok<CaseRevision>(channel, params(CASE))
      const view = await getView()
      expect(view.outOfDate).toEqual({
        stored: run?.stored,
        current,
        changes: [{ kind, targetId: target }]
      })
      expect(await ok(C.INVESTIGATION_GET_CHANGES, CASE, runId)).toEqual([
        { kind, targetId: target }
      ])
    }
  )

  it('markOwnIdentifier and addSubject put it out of date, naming the new row', async () => {
    const runId = await storedRun()
    const { run } = await getView()
    const marked = await ok<CaseRevision>(C.INVESTIGATION_MARK_OWN_IDENTIFIER, {
      caseId: CASE,
      kind: 'mail',
      platform: null,
      value: 'another@post.example.com',
      personaId: null
    })
    const first = await ok<CaseChange[]>(C.INVESTIGATION_GET_CHANGES, CASE, runId)
    expect((await getView()).outOfDate).toEqual({
      stored: run?.stored,
      current: marked,
      changes: first
    })
    const added = await ok<CaseRevision>(C.INVESTIGATION_ADD_SUBJECT, {
      caseId: CASE,
      name: 'Marlow Star',
      kind: 'vessel'
    })
    const changes = await ok<CaseChange[]>(C.INVESTIGATION_GET_CHANGES, CASE, runId)
    expect(changes.map((c) => c.kind)).toEqual(['own-identifier', 'subject'])
    const view = await getView()
    expect(view.outOfDate).toEqual({ stored: run?.stored, current: added, changes })
    expect(view.subjects.find((s) => s.id === changes[1].targetId)?.name).toBe('Marlow Star')
    const blank = await call(C.INVESTIGATION_ADD_SUBJECT, { caseId: CASE, name: '', kind: 'x' })
    expect(blank.ok).toBe(false)
  })

  it('stays current after decisions on what the run created, not on the earlier run’s Joint', async () => {
    const runId = await storedRun()
    await ok(C.INVESTIGATION_DECIDE_JOINT, {
      caseId: CASE,
      jointId: J.callowaySato,
      decision: 'reject',
      reason: 'Shared office.',
      context: null
    })
    const span = jointIn(await getView(), J.sharedPassage).unreviewed[0]
    await ok(C.INVESTIGATION_DECIDE_SPAN, {
      caseId: CASE,
      spanId: span.id,
      action: 'dismiss',
      reason: null
    })
    await ok(C.INVESTIGATION_KEEP_SUBJECT, { caseId: CASE, subjectId: S.account })
    const view = await getView()
    expect(view.outOfDate).toBeNull()
    expect(view.subjects.find((s) => s.id === S.account)?.kept).toBe(true)
    expect(await ok(C.INVESTIGATION_GET_CHANGES, CASE, runId)).toEqual([])

    await ok(C.INVESTIGATION_DECIDE_JOINT, {
      caseId: CASE,
      jointId: J.earlierRun,
      decision: 'reject',
      reason: null,
      context: null
    })
    expect((await getView()).outOfDate?.changes).toEqual([
      { kind: 'decision', targetId: J.earlierRun }
    ])
  })

  it('counts a decision on an earlier stored run’s Joint against a later run', async () => {
    await storedRun()
    const second = await storedRun()
    await ok(C.INVESTIGATION_DECIDE_JOINT, {
      caseId: CASE,
      jointId: J.callowaySato,
      decision: 'reject',
      reason: null,
      context: null
    })
    expect(await ok(C.INVESTIGATION_GET_CHANGES, CASE, second)).toEqual([
      { kind: 'decision', targetId: J.callowaySato }
    ])
  })
})

describe('state 11: unreviewed material on an accepted Joint', () => {
  it('flags the accepted Joint and lists it in the gap list', async () => {
    await storedRun()
    const view = await getView()
    const joint = jointIn(view, J.callowaySato)
    expect(joint.status).toBe('accepted')
    expect(joint.unreviewed.length).toBeGreaterThan(0)
    expect(view.gaps.find((g) => g.kind === 'accepted-with-unreviewed')?.entries).toContainEqual({
      kind: 'joint',
      jointId: J.callowaySato
    })
  })
})

describe('state 12: contested Joints', () => {
  it('serves an accept and a reject from two members, and an accept the viewer has not matched', async () => {
    await storedRun()
    const view = await getView()
    const contested = jointIn(view, J.haleAddress)
    expect(contested.status).toBe('contested')
    expect(contested.decisions.map((d) => [d.member.memberCode, d.decision])).toEqual([
      ['MB', 'reject'],
      ['NK', 'accept']
    ])
    expect(view.gaps.find((g) => g.kind === 'contested')?.entries).toEqual([
      { kind: 'joint', jointId: J.haleAddress }
    ])
    const undecided = jointIn(view, J.ferrymanArticle)
    expect(undecided.status).toBe('accepted')
    expect(undecided.decisions.some((d) => d.member.self)).toBe(false)
  })
})

describe('state 15: run invalidated', () => {
  it('ends a running run as invalidated when the Case changes, keeping the last stored run', async () => {
    const first = await storedRun()
    const runId = await ok<string>(C.INVESTIGATION_START_RUN, populated())
    await ok(C.INVESTIGATION_SET_COPY_MARK, {
      caseId: CASE,
      copyExhibitId: E.copy,
      originalExhibitId: E.article,
      marked: true
    })
    const terminal = terminalOf(runId)
    expect(terminal?.status).toBe('invalidated')
    expect(terminal?.reason).toBeTruthy()
    expect((await getView()).run?.id).toBe(first)
  })

  it('leaves a Case with no stored run showing none after an invalidated run', async () => {
    const runId = await ok<string>(C.INVESTIGATION_START_RUN, populated())
    await ok(C.INVESTIGATION_SET_WITHHELD, { caseId: CASE, exhibitId: E.forum, withheld: true })
    expect(terminalOf(runId)?.status).toBe('invalidated')
    const view = await getView()
    expect(view.run).toBeNull()
    expect(view.joints).toEqual([])
  })
})

describe('writes', () => {
  it('each resolves a revision above the one before, which getRevision then returns', async () => {
    await storedRun()
    const view = await getView()
    const span = jointIn(view, J.sharedPassage).unreviewed[0]
    const waiting = view.subjects.find((s) => s.waiting.length > 0)?.waiting[0]
    const calls: [string, unknown][] = [
      [
        C.INVESTIGATION_DECIDE_JOINT,
        { caseId: CASE, jointId: J.citation, decision: 'restore', reason: null, context: null }
      ],
      [
        C.INVESTIGATION_DECIDE_SPAN,
        { caseId: CASE, spanId: span.id, action: 'add-support', reason: null }
      ],
      [C.INVESTIGATION_CHOOSE_SUBJECT, { caseId: CASE, spanId: waiting?.id, action: 'none' }],
      [C.INVESTIGATION_ADD_SUBJECT, { caseId: CASE, name: 'Marlow Star', kind: 'vessel' }],
      [C.INVESTIGATION_KEEP_SUBJECT, { caseId: CASE, subjectId: S.copy }],
      [
        C.INVESTIGATION_SET_SOURCE_CLASS,
        { caseId: CASE, exhibitId: E.byline, value: 'original', reason: 'Signed.' }
      ],
      [
        C.INVESTIGATION_SET_COPY_MARK,
        { caseId: CASE, copyExhibitId: E.events, originalExhibitId: E.byline, marked: true }
      ],
      [C.INVESTIGATION_SET_WITHHELD, { caseId: CASE, exhibitId: E.byline, withheld: true }],
      [
        C.INVESTIGATION_MARK_OWN_IDENTIFIER,
        {
          caseId: CASE,
          kind: 'handle',
          platform: 'social.example.org',
          value: 'mb',
          personaId: null
        }
      ],
      [
        C.INVESTIGATION_UNMARK_OWN_IDENTIFIER,
        { caseId: CASE, entryId: FIXTURE_IDS.ownIdentifiers.personaMail }
      ]
    ]
    for (const [channel, params] of calls) {
      const before = await ok<CaseRevision>(C.INVESTIGATION_GET_REVISION, CASE)
      const after = await ok<CaseRevision>(channel, params)
      expect(after.counter, channel).toBeGreaterThan(before.counter)
      expect(await ok(C.INVESTIGATION_GET_REVISION, CASE)).toEqual(after)
    }
    const copies = await ok<SpanDetail>(C.INVESTIGATION_GET_SPAN, CASE, span.id)
    expect(copies.exhibit.exhibitId).toBe(span.exhibitId)
  })
})

describe('unknown ids', () => {
  it('fails each channel given an id the fake does not hold, changing nothing', async () => {
    await storedRun()
    const before = await getView()
    const attempts: [string, ...unknown[]][] = [
      [C.INVESTIGATION_GET_SPAN, CASE, UNKNOWN],
      [C.INVESTIGATION_CHECK_SPAN, CASE, UNKNOWN],
      [C.INVESTIGATION_CANCEL_RUN, CASE, UNKNOWN],
      [C.INVESTIGATION_GET_CHANGES, CASE, UNKNOWN],
      [
        C.INVESTIGATION_DECIDE_JOINT,
        { caseId: CASE, jointId: UNKNOWN, decision: 'reject', reason: null, context: null }
      ],
      [
        C.INVESTIGATION_DECIDE_JOINT,
        { caseId: CASE, jointId: J.citation, decision: 'maybe', reason: null, context: null }
      ],
      [
        C.INVESTIGATION_DECIDE_SPAN,
        { caseId: CASE, spanId: UNKNOWN, action: 'dismiss', reason: null }
      ],
      [C.INVESTIGATION_CHOOSE_SUBJECT, { caseId: CASE, spanId: UNKNOWN, action: 'none' }],
      [C.INVESTIGATION_KEEP_SUBJECT, { caseId: CASE, subjectId: UNKNOWN }],
      [
        C.INVESTIGATION_SET_SOURCE_CLASS,
        { caseId: CASE, exhibitId: UNKNOWN, value: 'original', reason: null }
      ],
      [
        C.INVESTIGATION_SET_COPY_MARK,
        { caseId: CASE, copyExhibitId: UNKNOWN, originalExhibitId: E.article, marked: true }
      ],
      [
        C.INVESTIGATION_SET_COPY_MARK,
        { caseId: CASE, copyExhibitId: E.article, originalExhibitId: E.article, marked: true }
      ],
      [C.INVESTIGATION_SET_WITHHELD, { caseId: CASE, exhibitId: UNKNOWN, withheld: true }],
      [C.INVESTIGATION_UNMARK_OWN_IDENTIFIER, { caseId: CASE, entryId: UNKNOWN }],
      [C.INVESTIGATION_START_RUN, { caseId: CASE, from: 'find-more', jointId: UNKNOWN }],
      [C.INVESTIGATION_START_RUN, { ...populated(), startingSubjectIds: [UNKNOWN] }],
      [
        C.INVESTIGATION_START_RUN,
        {
          caseId: CASE,
          from: 'note-claim',
          noteId: FIXTURE_IDS.note,
          passage: { start: 4, end: 2 },
          subjectIds: [S.calloway]
        }
      ],
      [C.INVESTIGATION_START_RUN, { caseId: CASE, from: 'elsewhere' }],
      [C.INVESTIGATION_GET_VIEW, '']
    ]
    for (const [channel, ...args] of attempts) {
      const result = await call(channel, ...args)
      expect(result.ok, `${channel} ${JSON.stringify(args)}`).toBe(false)
    }
    expect(await getView()).toEqual(before)
  })
})

describe('determinism', () => {
  // Fields that name a run or a time, or a generation minted per fake; nothing else may differ.
  const REMOVED = new Set(['generation', 'startedAt', 'endedAt', 'asOf', 'runId', 'createdByRunId'])
  const strip = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(strip)
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value)
          .filter(([key]) => !REMOVED.has(key))
          .map(([key, v]) => [key, strip(v)])
      )
    }
    return value
  }

  it('two fresh fakes given one request store views that serialize identically', async () => {
    const views: InvestigationView[] = []
    for (const seed of [1, 2]) {
      const fake = createFakeInvestigation({ phaseDelayMs: 0 })
      const runs: string[] = []
      const outcome = await fake.run(populated(), {
        onProgress: (p) => runs.push(p.runId),
        signal: new AbortController().signal
      })
      expect(outcome.status, `fake ${seed}`).toBe('stored')
      const view = fake.getView(CASE)
      // The run id is the one thing in `run` the strip leaves; it differs by construction.
      views.push({ ...view, run: view.run && { ...view.run, id: 'removed' } })
    }
    expect(views[0].run?.basis.generation).not.toBe(views[1].run?.basis.generation)
    expect(JSON.stringify(strip(views[0]))).toBe(JSON.stringify(strip(views[1])))
  })

  it('returns arrays already in canonical order', async () => {
    await storedRun()
    const view = await getView()
    expect(sortInvestigationView(view)).toEqual(view)
  })
})

describe('the engine interface', () => {
  it('runs with evaluation parameters, and cancels on an aborted signal', async () => {
    const fake = createFakeInvestigation({ phaseDelayMs: 0 })
    const stored = await fake.run(populated(), {
      onProgress: () => {},
      signal: new AbortController().signal,
      parameters: { followDepth: 3 }
    })
    expect(stored).toMatchObject({ status: 'stored', reason: null })
    expect(fake.getView(CASE).run?.parameters.followDepth).toBe(3)

    const controller = new AbortController()
    const pending = fake.run(populated(), { onProgress: () => {}, signal: controller.signal })
    controller.abort()
    expect(await pending).toMatchObject({ status: 'canceled' })

    const aborted = new AbortController()
    aborted.abort()
    expect(
      await fake.run(populated(), { onProgress: () => {}, signal: aborted.signal })
    ).toMatchObject({ status: 'canceled' })
    await expect(
      fake.run(
        { caseId: CASE, from: 'find-more', jointId: UNKNOWN },
        {
          onProgress: () => {},
          signal: new AbortController().signal
        }
      )
    ).rejects.toThrow('No such Joint')
  })
})

describe('module boundaries', () => {
  it('the fake and its fixture import nothing from the database, the file system or the logger', () => {
    const root = join(__dirname, '..', '..', '..', '..')
    for (const file of [
      'src/main/services/investigation/fakeEngine.ts',
      'src/shared/investigationFixture.ts'
    ]) {
      const imports = readFileSync(join(root, file), 'utf8')
        .split('\n')
        .filter((line) => /^\s*(import|} from)\b|\bfrom ['"]/.test(line))
      expect(imports.length, file).toBeGreaterThan(0)
      for (const line of imports) {
        expect(line, file).not.toMatch(/services\/db\/|['"](node:)?fs['"]|logger/)
      }
    }
  })
})
