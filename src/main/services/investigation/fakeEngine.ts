// The fake investigation engine (engine plan E10; issue #1885). It answers every `investigation:`
// channel from the invented fixture, in memory and per Case id, so the view briefs build against
// the real preload and IPC path before the engine exists. It reads and writes no database row and
// no file, so a mark set through it is gone when the app quits. ipcHandlers.ts registers it only
// when the app is not packaged (ruling 63); each real brief removes the handlers for its channels,
// and CI-V5 removes the fake.

import { randomUUID } from 'crypto'
import type { IpcMainInvokeEvent } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc'
import { SOURCE_CLASSES, compareOwnIdentifiers } from '@shared/investigation'
import type {
  AddSubjectParams,
  CaseChange,
  CaseRevision,
  ChooseSubjectParams,
  ClaimCheck,
  DecideJointParams,
  DecideSpanParams,
  InvestigationView,
  KeepSubjectParams,
  MarkOwnIdentifierParams,
  OwnIdentifierEntry,
  RunParameters,
  RunProgressEvent,
  RunRequest,
  RunStatus,
  RunSummary,
  SetCopyMarkParams,
  SetSourceClassParams,
  SetWithheldParams,
  SpanDetail,
  UnmarkOwnIdentifierParams
} from '@shared/investigation'
import {
  FIXTURE_DEFAULT_PARAMETERS,
  FIXTURE_MANIFEST_HEAD,
  FIXTURE_NO_JOINTS_INQUIRY,
  FIXTURE_SELF,
  FIXTURE_VERSIONS,
  applyNoteClaimResult,
  applyPopulatedResult,
  buildInvestigationView,
  buildSpanDetail,
  createFixtureState,
  findFixtureSpan,
  fixtureExhibit,
  fixtureHash,
  fixtureRunCounts,
  runCreatedIds,
  type FixtureRun,
  type FixtureState
} from '@shared/investigationFixture'
import { handle, IpcFailure, sendEvent } from '@main/ipcWrap'
import type { InvestigationEngine } from '@main/services/investigation/engine'

const PHASES: RunProgressEvent['phase'][] = ['inventory', 'search', 'check', 'store']
const INVALIDATED_REASON = 'The Case changed while the run was reading it.'
const DEFAULT_PHASE_DELAY_MS = 400

export interface FakeInvestigationDeps {
  now?: () => Date
  newId?: () => string
  phaseDelayMs?: number
}

type RunOutcome = { status: RunStatus; runId: string; reason: string | null }

interface ActiveRun {
  runId: string
  request: RunRequest
  parameters: RunParameters
  startedAt: string
  basis: CaseRevision
  counts: RunSummary['counts']
  phase: number
  timer: ReturnType<typeof setTimeout> | null
  onProgress: (event: RunProgressEvent) => void
  settle: (outcome: RunOutcome) => void
  done: Promise<RunOutcome>
}

interface RunRecord {
  status: RunStatus
  storedCounter: number | null
  createdIds: Set<string>
}

interface CaseState {
  caseId: string
  generation: string
  counter: number
  data: FixtureState
  stored: RunSummary | null
  runs: Map<string, RunRecord>
  log: { counter: number; change: CaseChange }[]
  running: ActiveRun | null
}

export interface FakeInvestigation extends InvestigationEngine {
  getRevision(caseId: string): CaseRevision
  getView(caseId: string): InvestigationView
  getSpan(caseId: string, spanId: string): SpanDetail
  checkSpan(caseId: string, spanId: string): ClaimCheck
  startRun(
    request: RunRequest,
    onProgress: (event: RunProgressEvent) => void,
    parameters?: Partial<RunParameters>
  ): string
  cancelRun(caseId: string, runId: string): void
  getChanges(caseId: string, runId: string): CaseChange[]
  decideJoint(params: DecideJointParams): CaseRevision
  decideSpan(params: DecideSpanParams): CaseRevision
  chooseSubject(params: ChooseSubjectParams): CaseRevision
  addSubject(params: AddSubjectParams): CaseRevision
  keepSubject(params: KeepSubjectParams): CaseRevision
  setSourceClass(params: SetSourceClassParams): CaseRevision
  setCopyMark(params: SetCopyMarkParams): CaseRevision
  setWithheld(params: SetWithheldParams): CaseRevision
  listOwnIdentifiers(caseId: string): OwnIdentifierEntry[]
  markOwnIdentifier(params: MarkOwnIdentifierParams): CaseRevision
  unmarkOwnIdentifier(params: UnmarkOwnIdentifierParams): CaseRevision
}

const fail = (message: string): never => {
  throw new IpcFailure(message)
}

const isText = (value: unknown): value is string => typeof value === 'string' && value !== ''

export function createFakeInvestigation(deps: FakeInvestigationDeps = {}): FakeInvestigation {
  const now = deps.now ?? (() => new Date())
  const newId = deps.newId ?? randomUUID
  const phaseDelayMs = deps.phaseDelayMs ?? DEFAULT_PHASE_DELAY_MS
  const cases = new Map<string, CaseState>()

  function caseOf(caseId: unknown): CaseState {
    if (!isText(caseId)) return fail('A Case id is required')
    let state = cases.get(caseId)
    if (!state) {
      state = {
        caseId,
        generation: newId().replace(/-/g, ''),
        counter: 0,
        data: createFixtureState(),
        stored: null,
        runs: new Map(),
        log: [],
        running: null
      }
      cases.set(caseId, state)
    }
    return state
  }

  const revision = (cs: CaseState): CaseRevision => ({
    generation: cs.generation,
    counter: cs.counter,
    manifestHead: FIXTURE_MANIFEST_HEAD && { ...FIXTURE_MANIFEST_HEAD }
  })

  // Log rows after the run's stored counter, less decisions on what that run created (ADR-0042).
  function changesSince(cs: CaseState, record: RunRecord): CaseChange[] {
    return cs.log
      .filter(({ counter, change }) => {
        if (record.storedCounter === null || counter <= record.storedCounter) return false
        return !(
          change.kind === 'decision' &&
          change.targetId !== null &&
          record.createdIds.has(change.targetId)
        )
      })
      .map(({ change }) => ({ ...change }))
  }

  // Every write advances the revision, logs one change, and invalidates a run in progress.
  function write(cs: CaseState, change: CaseChange): CaseRevision {
    cs.counter += 1
    cs.log.push({ counter: cs.counter, change })
    if (cs.running) endRun(cs, cs.running, 'invalidated', INVALIDATED_REASON)
    return revision(cs)
  }

  function view(cs: CaseState): InvestigationView {
    const record = cs.stored && cs.runs.get(cs.stored.id)
    const changes = record ? changesSince(cs, record) : []
    return buildInvestigationView(cs.data, {
      revision: revision(cs),
      run: cs.stored,
      outOfDate:
        cs.stored && changes.length > 0
          ? { stored: cs.stored.stored, current: revision(cs), changes }
          : null
    })
  }

  // --- Runs ---------------------------------------------------------------------------------

  function emit(cs: CaseState, run: ActiveRun, status: RunStatus, reason: string | null): void {
    const { read, withheld, total } = run.counts
    run.onProgress({
      caseId: cs.caseId,
      runId: run.runId,
      phase: PHASES[Math.min(run.phase, PHASES.length - 1)],
      exhibitsRead: run.phase === 0 ? 0 : run.phase === 1 ? Math.floor(read / 2) : read,
      exhibitsWithheld: withheld,
      exhibitsTotal: total,
      status,
      reason
    })
  }

  function endRun(cs: CaseState, run: ActiveRun, status: RunStatus, reason: string | null): void {
    if (run.timer) clearTimeout(run.timer)
    cs.running = null
    cs.runs.set(run.runId, { status, storedCounter: null, createdIds: new Set() })
    emit(cs, run, status, reason)
    run.settle({ status, runId: run.runId, reason })
  }

  function startingSubjects(cs: CaseState, request: RunRequest): string[] {
    if (request.from === 'inquiry') return [...request.startingSubjectIds]
    if (request.from === 'note-claim') return [...request.subjectIds]
    return [...(cs.data.joints.find((j) => j.id === request.jointId)?.subjectIds ?? [])]
  }

  function storeRun(cs: CaseState, run: ActiveRun): void {
    const { request } = run
    const fixtureRun: FixtureRun = { id: run.runId, startedAt: run.startedAt }
    if (request.from === 'note-claim') applyNoteClaimResult(cs.data, fixtureRun, request)
    else if (request.from === 'find-more') applyPopulatedResult(cs.data, fixtureRun)
    else if (request.inquiry.trim() !== FIXTURE_NO_JOINTS_INQUIRY) {
      applyPopulatedResult(cs.data, fixtureRun)
    } else cs.data.runStarts[run.runId] = run.startedAt
    // The run's one write: its own output, so it logs nothing the run would count against itself.
    cs.counter += 1
    cs.stored = {
      id: run.runId,
      from: request.from,
      inquiry: request.from === 'inquiry' ? request.inquiry : null,
      noteId: request.from === 'note-claim' ? request.noteId : null,
      jointId: request.from === 'find-more' ? request.jointId : null,
      startingSubjectIds: startingSubjects(cs, request),
      basis: run.basis,
      stored: revision(cs),
      startedAt: run.startedAt,
      endedAt: now().toISOString(),
      parameters: run.parameters,
      versions: structuredClone(FIXTURE_VERSIONS),
      counts: run.counts
    }
    cs.running = null
    cs.runs.set(run.runId, {
      status: 'stored',
      storedCounter: cs.counter,
      createdIds: runCreatedIds(cs.data, run.runId)
    })
    emit(cs, run, 'stored', null)
    run.settle({ status: 'stored', runId: run.runId, reason: null })
  }

  function validateRequest(cs: CaseState, request: RunRequest): void {
    const subjectIds = new Set(cs.data.subjects.map((s) => s.id))
    const knownSubjects = (ids: unknown): boolean =>
      Array.isArray(ids) && ids.every((id) => subjectIds.has(id as string))
    switch (request.from) {
      case 'inquiry':
        if (typeof request.inquiry !== 'string' || !knownSubjects(request.startingSubjectIds)) {
          fail('An inquiry run needs its text and Subjects the Case holds')
        }
        return
      case 'note-claim': {
        const { passage, subjectIds: about } = request
        const passageOk =
          !!passage && Number.isInteger(passage.start) && passage.end > passage.start
        const aboutOk = knownSubjects(about) && about.length >= 1 && about.length <= 2
        if (!isText(request.noteId) || !passageOk || !aboutOk) {
          fail('A Note-claim run needs a Note, a passage and one or two Subjects the Case holds')
        }
        return
      }
      case 'find-more':
        if (!cs.data.joints.some((j) => j.id === request.jointId)) fail('No such Joint')
        return
      default:
        fail('Unknown run request')
    }
  }

  function startRun(
    request: RunRequest,
    onProgress: (event: RunProgressEvent) => void,
    parameters: Partial<RunParameters> = {}
  ): string {
    const cs = caseOf(request?.caseId)
    if (cs.running) fail('A run is already running in this Case')
    validateRequest(cs, request)
    let settle: (outcome: RunOutcome) => void = () => {}
    const done = new Promise<RunOutcome>((resolve) => {
      settle = resolve
    })
    const run: ActiveRun = {
      runId: newId(),
      request: structuredClone(request),
      parameters: { ...FIXTURE_DEFAULT_PARAMETERS, ...parameters },
      startedAt: now().toISOString(),
      basis: revision(cs),
      counts: fixtureRunCounts(cs.data),
      phase: 0,
      timer: null,
      onProgress,
      settle,
      done
    }
    cs.running = run
    cs.runs.set(run.runId, { status: 'running', storedCounter: null, createdIds: new Set() })
    const tick = (): void => {
      run.timer = null
      run.phase += 1
      if (run.phase < PHASES.length) {
        emit(cs, run, 'running', null)
        run.timer = setTimeout(tick, phaseDelayMs)
      } else {
        storeRun(cs, run)
      }
    }
    emit(cs, run, 'running', null)
    run.timer = setTimeout(tick, phaseDelayMs)
    return run.runId
  }

  function cancelRun(caseId: string, runId: string): void {
    const cs = caseOf(caseId)
    if (cs.running?.runId === runId) return endRun(cs, cs.running, 'canceled', null)
    fail(cs.runs.has(runId) ? 'The run is not running' : 'No such run')
  }

  // --- Lookups -----------------------------------------------------------------------------

  function jointOf(cs: CaseState, jointId: string) {
    return cs.data.joints.find((j) => j.id === jointId) ?? fail('No such Joint')
  }

  function exhibitOf(exhibitId: string) {
    return fixtureExhibit(exhibitId) ?? fail('No such Exhibit')
  }

  function waitingGroupOf(cs: CaseState, spanId: string) {
    return (
      cs.data.waiting.find((g) => g.rows.some((r) => r.id === spanId)) ??
      fail('No such same-name span')
    )
  }

  // --- The engine --------------------------------------------------------------------------

  return {
    async run(request, { onProgress, signal, parameters }) {
      const runId = startRun(request, onProgress, parameters)
      const cs = caseOf(request.caseId)
      const active = cs.running as ActiveRun
      const onAbort = (): void => {
        if (cs.running?.runId === runId) endRun(cs, cs.running, 'canceled', null)
      }
      if (signal.aborted) onAbort()
      else signal.addEventListener('abort', onAbort, { once: true })
      const outcome = await active.done
      signal.removeEventListener('abort', onAbort)
      return outcome
    },

    getRevision: (caseId) => revision(caseOf(caseId)),
    getView: (caseId) => view(caseOf(caseId)),

    getSpan(caseId, spanId) {
      return buildSpanDetail(caseOf(caseId).data, spanId) ?? fail('No such span')
    },

    checkSpan(caseId, spanId) {
      const detail = buildSpanDetail(caseOf(caseId).data, spanId) ?? fail('No such span')
      if (detail.check) return { ...detail.check }
      const reason =
        detail.exhibit.integrity === 'missing'
          ? 'The stored file is missing.'
          : 'The stored bytes no longer match their Content Hash.'
      return { text: 'cannot-check', basis: null, reason }
    },

    startRun,
    cancelRun,

    getChanges(caseId, runId) {
      const cs = caseOf(caseId)
      const record = cs.runs.get(runId) ?? fail('No such run')
      if (record.storedCounter === null) fail('The run was not stored')
      return changesSince(cs, record)
    },

    decideJoint({ caseId, jointId, decision, reason, context }) {
      const cs = caseOf(caseId)
      const joint = jointOf(cs, jointId)
      if (!['accept', 'reject', 'restore'].includes(decision)) fail('Unknown decision')
      if (decision === 'accept') {
        // Accept needs an available reviewed supporting span, one on each side of a Joint between
        // two Subjects (view brief, surface 4, "Actions").
        const shown = view(cs).joints.find((j) => j.id === jointId)
        const sides = joint.subjectIds.length === 2 ? (['a', 'b'] as const) : [null]
        if (!sides.every((side) => shown?.support.some((s) => s.side === side))) {
          fail('Accept needs an available reviewed supporting span on each side of the Joint')
        }
      }
      const seq = joint.decisions.filter((d) => d.member.self).length + 1
      joint.decisions.push({
        id: newId(),
        member: { ...FIXTURE_SELF },
        seq,
        decision,
        reason: reason ?? null,
        context: decision === 'accept' ? (context ?? null) : null,
        decidedAt: now().toISOString()
      })
      return write(cs, { kind: 'decision', targetId: jointId })
    },

    decideSpan({ caseId, spanId, action }) {
      const cs = caseOf(caseId)
      const span = findFixtureSpan(cs.data, spanId)?.joint ?? fail('No such Joint span')
      const reviews = {
        'add-support': 'support',
        'add-conflict': 'conflict',
        dismiss: 'dismissed',
        undo: 'unreviewed'
      } as const
      // An own-property check, so an inherited name such as `constructor` is refused.
      if (!Object.hasOwn(reviews, action)) fail('Unknown span action')
      span.review = reviews[action]
      span.addedBy = action === 'undo' ? null : { ...FIXTURE_SELF }
      return write(cs, { kind: 'decision', targetId: spanId })
    },

    chooseSubject(params) {
      const cs = caseOf(params.caseId)
      const group = waitingGroupOf(cs, params.spanId)
      if (params.action === 'undo') {
        if (group.choice === null) fail('The span is not placed')
        if (group.choice?.action === 'choose') {
          const { jointId } = group.choice
          cs.data.joints = cs.data.joints.filter((j) => j.id !== jointId)
        }
        group.choice = null
      } else if (group.choice !== null) {
        fail('The span is already placed; undo the choice first')
      } else if (params.action === 'none') {
        group.choice = { action: 'none' }
      } else if (params.action === 'choose') {
        const { subjectId } = params
        if (!group.rows.some((r) => r.subjectId === subjectId)) {
          fail('The Subject is not a candidate for this span')
        }
        const chosen = cs.data.subjects.find((s) => s.id === subjectId)
        const jointId = newId()
        cs.data.joints.push({
          id: jointId,
          identityHash: fixtureHash(`choice:${group.groupKey}:${subjectId}`),
          claim: `The header names ${chosen?.name}${chosen?.detail ? ` (${chosen.detail})` : ''}`,
          subjectIds: [subjectId],
          producer: { kind: 'operator', noteId: null },
          createdByRunId: null,
          spans: [
            {
              ...structuredClone(group.span),
              id: newId(),
              side: null,
              reading: 'supports',
              review: 'support',
              addedBy: { ...FIXTURE_SELF }
            }
          ],
          decisions: [],
          strength: null,
          weak: false
        })
        group.choice = { action: 'choose', subjectId, jointId }
      } else {
        fail('Unknown same-name action')
      }
      return write(cs, { kind: 'decision', targetId: params.spanId })
    },

    addSubject({ caseId, name, kind }) {
      const cs = caseOf(caseId)
      if (!isText(name) || !isText(kind)) fail('A Subject needs a name and a kind')
      const id = newId()
      cs.data.subjects.push({
        id,
        name,
        kind,
        detail: null,
        boundExhibitId: null,
        createdByRunId: null,
        kept: false
      })
      return write(cs, { kind: 'subject', targetId: id })
    },

    keepSubject({ caseId, subjectId }) {
      const cs = caseOf(caseId)
      const kept = cs.data.subjects.find((s) => s.id === subjectId) ?? fail('No such Subject')
      kept.kept = true
      // E3 logs a change to kept_at as a decision.
      return write(cs, { kind: 'decision', targetId: subjectId })
    },

    setSourceClass({ caseId, exhibitId, value, reason }) {
      const cs = caseOf(caseId)
      exhibitOf(exhibitId)
      if (!SOURCE_CLASSES.includes(value)) fail('Unknown Source Class')
      // One member's choice replaces every head, which is how a choice resolves two members'
      // different values.
      cs.data.sourceClass[exhibitId] = [
        { value, member: { ...FIXTURE_SELF }, reason: reason ?? null, actedAt: now().toISOString() }
      ]
      return write(cs, { kind: 'source-class', targetId: exhibitId })
    },

    setCopyMark({ caseId, copyExhibitId, originalExhibitId, marked }) {
      const cs = caseOf(caseId)
      exhibitOf(copyExhibitId)
      exhibitOf(originalExhibitId)
      if (copyExhibitId === originalExhibitId) fail('An Exhibit cannot be a copy of itself')
      const isPair = (m: { copyExhibitId: string; originalExhibitId: string }): boolean =>
        m.copyExhibitId === copyExhibitId && m.originalExhibitId === originalExhibitId
      cs.data.copyMarks = cs.data.copyMarks.filter((m) => !isPair(m))
      if (marked) {
        cs.data.copyMarks.push({ copyExhibitId, originalExhibitId, member: { ...FIXTURE_SELF } })
      }
      return write(cs, { kind: 'copy-mark', targetId: copyExhibitId })
    },

    setWithheld({ caseId, exhibitId, withheld }) {
      const cs = caseOf(caseId)
      exhibitOf(exhibitId)
      // Each member's flag is their own; the Exhibit stays withheld while anyone holds one.
      const others = (cs.data.withheld[exhibitId] ?? []).filter((m) => !m.self)
      cs.data.withheld[exhibitId] = withheld ? [...others, { ...FIXTURE_SELF }] : others
      return write(cs, { kind: 'withheld', targetId: exhibitId })
    },

    listOwnIdentifiers(caseId) {
      return structuredClone(caseOf(caseId).data.ownIdentifiers).sort(compareOwnIdentifiers)
    },

    markOwnIdentifier({ caseId, kind, platform, value, personaId }) {
      const cs = caseOf(caseId)
      if (!isText(kind) || !isText(value)) fail('An Own Identifier needs a kind and a value')
      const id = newId()
      cs.data.ownIdentifiers.push({
        id,
        kind,
        platform: platform ?? null,
        value,
        personaId: personaId ?? null,
        member: { ...FIXTURE_SELF }
      })
      return write(cs, { kind: 'own-identifier', targetId: id })
    },

    unmarkOwnIdentifier({ caseId, entryId }) {
      const cs = caseOf(caseId)
      const entry =
        cs.data.ownIdentifiers.find((o) => o.id === entryId) ?? fail('No such Own Identifier')
      // A member removes only their own entries.
      if (!entry.member.self) fail('Another member marked this identifier')
      cs.data.ownIdentifiers = cs.data.ownIdentifiers.filter((o) => o.id !== entryId)
      return write(cs, { kind: 'own-identifier', targetId: entryId })
    }
  }
}

// Registers the fake's handler for every `investigation:` channel. Progress goes to the window
// that started the run, as the export handler sends its progress.
export function registerFakeInvestigationHandlers(
  fake: FakeInvestigation = createFakeInvestigation()
): void {
  handle(IPC_CHANNELS.INVESTIGATION_GET_REVISION, (_, caseId) => fake.getRevision(caseId))
  handle(IPC_CHANNELS.INVESTIGATION_GET_VIEW, (_, caseId) => fake.getView(caseId))
  handle(IPC_CHANNELS.INVESTIGATION_GET_SPAN, (_, caseId, spanId) => fake.getSpan(caseId, spanId))
  handle(IPC_CHANNELS.INVESTIGATION_CHECK_SPAN, (_, caseId, spanId) =>
    fake.checkSpan(caseId, spanId)
  )
  handle(IPC_CHANNELS.INVESTIGATION_START_RUN, (event: IpcMainInvokeEvent, request) =>
    fake.startRun(request, (progress) => {
      if (!event.sender.isDestroyed()) {
        sendEvent(event.sender, IPC_CHANNELS.INVESTIGATION_PROGRESS, progress)
      }
    })
  )
  handle(IPC_CHANNELS.INVESTIGATION_CANCEL_RUN, (_, caseId, runId) => fake.cancelRun(caseId, runId))
  handle(IPC_CHANNELS.INVESTIGATION_GET_CHANGES, (_, caseId, runId) =>
    fake.getChanges(caseId, runId)
  )
  handle(IPC_CHANNELS.INVESTIGATION_DECIDE_JOINT, (_, params) => fake.decideJoint(params))
  handle(IPC_CHANNELS.INVESTIGATION_DECIDE_SPAN, (_, params) => fake.decideSpan(params))
  handle(IPC_CHANNELS.INVESTIGATION_CHOOSE_SUBJECT, (_, params) => fake.chooseSubject(params))
  handle(IPC_CHANNELS.INVESTIGATION_ADD_SUBJECT, (_, params) => fake.addSubject(params))
  handle(IPC_CHANNELS.INVESTIGATION_KEEP_SUBJECT, (_, params) => fake.keepSubject(params))
  handle(IPC_CHANNELS.INVESTIGATION_SET_SOURCE_CLASS, (_, params) => fake.setSourceClass(params))
  handle(IPC_CHANNELS.INVESTIGATION_SET_COPY_MARK, (_, params) => fake.setCopyMark(params))
  handle(IPC_CHANNELS.INVESTIGATION_SET_WITHHELD, (_, params) => fake.setWithheld(params))
  handle(IPC_CHANNELS.INVESTIGATION_LIST_OWN_IDENTIFIERS, (_, caseId) =>
    fake.listOwnIdentifiers(caseId)
  )
  handle(IPC_CHANNELS.INVESTIGATION_MARK_OWN_IDENTIFIER, (_, params) =>
    fake.markOwnIdentifier(params)
  )
  handle(IPC_CHANNELS.INVESTIGATION_UNMARK_OWN_IDENTIFIER, (_, params) =>
    fake.unmarkOwnIdentifier(params)
  )
}
