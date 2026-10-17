// The Case investigation engine's contract (docs/plans/2026-10-10-case-investigation-engine.md,
// E10): what the view reads, and the arguments and results of every `investigation:` channel.
// `sortInvestigationView` sorts each array by a canonical key that uses no run id and no time, so
// two runs on one state serialize identically once ids and times are removed.

import type { ExhibitVerification, WaybackRef } from '@shared/types'

export interface CaseRevision {
  generation: string
  counter: number
  manifestHead: { index: number; entryHash: string } | null // ManifestHeadRef's shape
}

export type TextCheck = 'present' | 'absent' | 'cannot-check'
export type Reading = 'supports' | 'conflicts' | 'unclear'
export type RuleId = 'same-field' | 'shared-identifier' | 'shared-passage' | 'reply-or-citation'

export type Producer =
  { kind: 'rule'; rule: RuleId; version: string } | { kind: 'operator'; noteId: string | null } // a Note claim, or a same-name choice

export interface SpanLocator {
  representation: 'html-part' | 'text' | 'capture-url'
  field: string // 'header.from', 'link.href', 'text.passage', ...
  part: number | null // html-part only
  start: number
  end: number
  extractor: string // 'fields/2', ...
}

export interface ClaimCheck {
  text: TextCheck
  basis: 'hash-verified' | 'unattested' | 'decoded' | null // null when the check could not run
  reason: string | null
}

// E1's `source_class_marks.value`. No mark reads as unclassified.
export const SOURCE_CLASSES = [
  'original',
  'contemporaneous',
  'later-copy',
  'commercial',
  'ai-origin',
  'unclassified'
] as const
export type SourceClass = (typeof SOURCE_CLASSES)[number]

// A member as a decision or mark names them. `memberCode` is null outside a Shared Case;
// `self` marks the member this installation is.
export interface MemberRef {
  memberCode: string | null
  operatorName: string
  self: boolean
}

// Which date a span's Exhibit carries: the capture time, a date the source states, or a trusted
// timestamp. A null `at` is a missing date, which the view shows as missing.
export const SPAN_DATE_KINDS = ['captured', 'stated', 'stamped'] as const
export interface SpanDate {
  kind: (typeof SPAN_DATE_KINDS)[number]
  at: string | null
}

export interface ExhibitRef {
  exhibitId: string
  exhibitNumber: number
  memberCode: string | null
}

export interface SpanView {
  id: string
  exhibitId: string
  exhibitNumber: number
  memberCode: string | null
  contentHash: string
  locator: SpanLocator
  value: string
  side: 'a' | 'b' | null
  reading: Reading
  review: 'unreviewed' | 'support' | 'conflict' | 'dismissed'
  // 'no-longer-counted': the Exhibit's Source Class, or either of two conflicting ones, is AI-origin.
  availability: 'available' | 'withheld' | 'unavailable' | 'no-longer-counted'
  check: ClaimCheck | null // null until CI-11
  holders: { count: number; of: number } | null // "in 3 of 994 Exhibits"
  sourceClass: SourceClass
  dates: SpanDate[]
  addedBy: MemberRef | null // null until a member adds it as support or conflict
  copyOf: ExhibitRef | null // the original, when a member marked this Exhibit as its copy
}

export type RunRequest =
  | { caseId: string; from: 'inquiry'; inquiry: string; startingSubjectIds: string[] }
  | {
      caseId: string
      from: 'note-claim'
      noteId: string
      passage: { start: number; end: number }
      subjectIds: string[]
    }
  | { caseId: string; from: 'find-more'; jointId: string }

export interface RunParameters {
  version: string // the parameter set's own version, recorded in every run
  followDepth: number
  sharedPassageMinWords: number
  passageGroupCeiling: number
  commonHostShare: number
  sharedHostListVersion: string
}

export type RunStatus = 'running' | 'stored' | 'canceled' | 'invalidated' | 'failed'

// `status` and `reason` are not in E10's literal: the last event of every run carries a status
// other than 'running', which is how the view learns that a run was canceled or invalidated.
export interface RunProgressEvent {
  caseId: string
  runId: string
  phase: 'inventory' | 'search' | 'check' | 'store'
  exhibitsRead: number
  exhibitsWithheld: number
  exhibitsTotal: number
  status: RunStatus
  reason: string | null
}

export interface NotReadCount {
  kind: string // the Exhibit kind, such as 'document' or 'attachment'
  reason: string
  count: number
}

export interface RunSummary {
  id: string
  from: RunRequest['from']
  inquiry: string | null
  noteId: string | null
  jointId: string | null
  startingSubjectIds: string[]
  basis: CaseRevision // the revision the run started from
  stored: CaseRevision // the revision its one write produced
  startedAt: string
  endedAt: string
  parameters: RunParameters
  versions: { rules: { rule: RuleId; version: string }[]; normalizer: string; extractor: string }
  counts: { total: number; read: number; withheld: number; notRead: NotReadCount[] }
}

// A same-name span: one row per candidate Subject, and one choice resolves every row of a group.
export interface WaitingSpanView {
  id: string
  groupKey: string
  subjectId: string
  candidateSubjectIds: string[]
  exhibitId: string
  exhibitNumber: number
  memberCode: string | null
  contentHash: string
  locator: SpanLocator
  value: string
  choice: { action: 'choose'; subjectId: string; jointId: string } | { action: 'none' } | null
}

export interface SubjectView {
  id: string
  name: string
  kind: string
  detail: string | null // the distinguishing detail shown when two Subjects share a name
  boundExhibitId: string | null // a document Subject's one Exhibit
  starting: boolean // a starting Subject of the shown run
  createdByRunId: string | null // null when the Operator added it
  kept: boolean
  waiting: WaitingSpanView[] // same-name spans waiting on a choice
  placed: WaitingSpanView[] // same-name spans already placed, each with its choice
}

export interface AcceptanceContext {
  assumptions: string | null // null shows as "not recorded"
  confidence: string | null
  alternatives: string | null
}

export interface JointDecisionView {
  id: string
  member: MemberRef
  seq: number // the decision's place in its member's history, 1 first
  decision: 'accept' | 'reject' | 'restore'
  reason: string | null
  context: AcceptanceContext | null // accept only
  decidedAt: string
}

export interface StrengthSummary {
  sourceClasses: { sourceClass: SourceClass; count: number }[]
  independentSources: number
  distinctiveMatches: number
  conflicts: number
}

export type JointStatus = 'proposed' | 'accepted' | 'rejected' | 'contested'

export interface JointView {
  id: string
  identityHash: string
  claim: string
  subjectIds: [string] | [string, string] // in side order, a then b
  producer: Producer
  basis: { runId: string | null; asOf: string | null } // "proposed from the Case as of"
  proposalHash: string | null
  createdByRunId: string | null
  status: JointStatus
  decisions: JointDecisionView[]
  support: SpanView[]
  conflicts: SpanView[]
  unreviewed: SpanView[]
  noLongerCounted: SpanView[]
  dismissed: SpanView[]
  strength: StrengthSummary | null // null until CI-12
  weak: boolean
  lostSide: 'a' | 'b' | null // an accepted Joint between two Subjects with no available support on one side
}

export interface PathView {
  fromSubjectId: string
  toSubjectId: string
  jointIds: string[] // in path order
  throughSubjectIds: string[] // in path order
  accepted: boolean // false: a possible path, "not joined by accepted Joints"
  directJointId: string | null // a proposed or rejected Joint between the two ends
}

export interface PassageGroupView {
  id: string
  passageHash: string
  passage: string
  holders: (ExhibitRef & { spanId: string })[]
  count: number
  ceiling: number
}

export type GapKind =
  | 'claim-without-support'
  | 'accepted-with-unreviewed'
  | 'accepted-lost-support' // all available support, or the support on one side
  | 'contested'
  | 'weak'
  | 'reached-only-through-another'
  | 'path-on-unaccepted-joint'
  | 'missing-date'
  | 'missing-original'
  | 'search-not-run'
  | 'same-name-unjoined' // two Subjects share a name and no Exhibit joins them yet

// The declaration order of GapKind, which is the gap list's group order.
export const GAP_KINDS: readonly GapKind[] = [
  'claim-without-support',
  'accepted-with-unreviewed',
  'accepted-lost-support',
  'contested',
  'weak',
  'reached-only-through-another',
  'path-on-unaccepted-joint',
  'missing-date',
  'missing-original',
  'search-not-run',
  'same-name-unjoined'
]

// What a gap entry opens: a Joint in Joint detail, Subjects on the map, an Exhibit in the source
// inspector at a field, or nothing for a search not yet run.
export type GapTarget =
  | { kind: 'joint'; jointId: string }
  | { kind: 'subjects'; subjectIds: string[] }
  | { kind: 'exhibit'; exhibitId: string; spanId: string | null; field: string | null }
  | { kind: 'unread'; exhibitKind: string; reason: string; count: number }

export interface GapGroup {
  kind: GapKind
  entries: GapTarget[]
}

// E3's change-log kinds, plus the two changes that are not log rows.
export type ChangeKind =
  | 'note'
  | 'extracted-datum'
  | 'selector'
  | 'subject'
  | 'joint'
  | 'span'
  | 'decision'
  | 'source-class'
  | 'copy-mark'
  | 'withheld'
  | 'own-identifier'
  | 'exhibit'
  | 'search-build'
  | 'generation'
  | 'manifest-head'

export interface CaseChange {
  kind: ChangeKind
  targetId: string | null
}

export interface OutOfDate {
  stored: CaseRevision
  current: CaseRevision
  changes: CaseChange[] // in the order they happened
}

export interface WithheldExhibitView extends ExhibitRef {
  name: string
  holders: MemberRef[] // whose flags keep it withheld
}

export interface InvestigationView {
  revision: CaseRevision
  run: RunSummary | null // the latest stored run only: no run history (spec open decision 2)
  outOfDate: OutOfDate | null
  subjects: SubjectView[]
  joints: JointView[]
  passageGroups: PassageGroupView[]
  paths: PathView[]
  gaps: GapGroup[]
  withheld: WithheldExhibitView[]
}

export interface SourceClassHead {
  value: SourceClass
  member: MemberRef
  reason: string | null
  actedAt: string
}

// A pinned Wayback Ref's three labelled times: the snapshot's, the lookup's and the pin's.
export type WaybackRefView = Pick<
  WaybackRef,
  'snapshotUrl' | 'originalUrl' | 'snapshotTimestamp' | 'checkedAt' | 'pinnedAt'
>

// The source inspector's read of one span (`investigation:getSpan`).
export interface SpanDetail {
  spanId: string
  locator: SpanLocator
  value: string
  availability: SpanView['availability']
  check: ClaimCheck | null
  holders: { count: number; of: number } | null
  exhibit: ExhibitRef & {
    kind: string
    name: string
    contentHash: string
    integrity: ExhibitVerification['status'] | null
    bodyAcquired: boolean // false: a headers-only Exhibit, "Body not acquired"
  }
  // The stored representation around the span; `text.slice(start, end)` is the span's value.
  // Null when the span is unavailable, so nothing falls back to a preview.
  excerpt: { text: string; start: number; end: number } | null
  sourceClass: { effective: SourceClass; heads: SourceClassHead[] }
  withheld: { withheld: boolean; holders: MemberRef[] }
  copyMarks: { copy: ExhibitRef; original: ExhibitRef; member: MemberRef }[]
  sourceTrail: { url: string | null; waybackRefs: WaybackRefView[] }
  identifier: {
    kind: string
    platform: string | null
    value: string
    ownIdentifierId: string | null // set when the Case marks it as the Operator's own
  } | null
}

export interface OwnIdentifierEntry {
  id: string
  kind: string // mail | handle | domain | link | message-id | tracking | ...
  platform: string | null
  value: string
  personaId: string | null // local only
  member: MemberRef
}

// Every argument object carries the Case id, as `exhibits:verify` takes one beside the Exhibit.
export interface DecideJointParams {
  caseId: string
  jointId: string
  decision: 'accept' | 'reject' | 'restore'
  reason: string | null
  context: AcceptanceContext | null
}

export interface DecideSpanParams {
  caseId: string
  spanId: string
  action: 'add-support' | 'add-conflict' | 'dismiss' | 'undo'
  reason: string | null
}

// E1's same-name `span_decisions.action` values.
export type ChooseSubjectParams =
  | { caseId: string; spanId: string; action: 'choose'; subjectId: string }
  | { caseId: string; spanId: string; action: 'none' | 'undo' }

export interface AddSubjectParams {
  caseId: string
  name: string
  kind: string
}

export interface KeepSubjectParams {
  caseId: string
  subjectId: string
}

export interface SetSourceClassParams {
  caseId: string
  exhibitId: string
  value: SourceClass
  reason: string | null
}

export interface SetCopyMarkParams {
  caseId: string
  copyExhibitId: string
  originalExhibitId: string
  marked: boolean
}

export interface SetWithheldParams {
  caseId: string
  exhibitId: string
  withheld: boolean
}

export interface MarkOwnIdentifierParams {
  caseId: string
  kind: string
  platform: string | null
  value: string
  personaId: string | null
}

export interface UnmarkOwnIdentifierParams {
  caseId: string
  entryId: string
}

// --- Canonical order ---------------------------------------------------------

const text = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
const nullsFirst = (a: string | null, b: string | null): number =>
  a === b ? 0 : a === null ? -1 : b === null ? 1 : text(a, b)
const chain = (...results: number[]): number => results.find((r) => r !== 0) ?? 0

export function compareMembers(a: MemberRef, b: MemberRef): number {
  return chain(nullsFirst(a.memberCode, b.memberCode), text(a.operatorName, b.operatorName))
}

export function compareExhibitRefs(a: ExhibitRef, b: ExhibitRef): number {
  return chain(nullsFirst(a.memberCode, b.memberCode), a.exhibitNumber - b.exhibitNumber)
}

export function compareLocated(
  a: ExhibitRef & { locator: SpanLocator },
  b: ExhibitRef & { locator: SpanLocator }
): number {
  return chain(
    compareExhibitRefs(a, b),
    text(a.locator.representation, b.locator.representation),
    text(a.locator.field, b.locator.field),
    (a.locator.part ?? -1) - (b.locator.part ?? -1),
    a.locator.start - b.locator.start,
    a.locator.end - b.locator.end
  )
}

export function compareSubjects(a: SubjectView, b: SubjectView): number {
  return chain(text(a.kind, b.kind), text(a.name, b.name), text(a.id, b.id))
}

export function compareWaitingSpans(a: WaitingSpanView, b: WaitingSpanView): number {
  return chain(compareLocated(a, b), text(a.groupKey, b.groupKey))
}

export function compareJoints(a: JointView, b: JointView): number {
  return text(a.identityHash, b.identityHash)
}

export function compareDecisions(a: JointDecisionView, b: JointDecisionView): number {
  return chain(compareMembers(a.member, b.member), a.seq - b.seq)
}

export function compareGapTargets(a: GapTarget, b: GapTarget): number {
  return text(gapTargetKey(a), gapTargetKey(b))
}

function gapTargetKey(target: GapTarget): string {
  switch (target.kind) {
    case 'joint':
      return `joint:${target.jointId}`
    case 'subjects':
      return `subjects:${target.subjectIds.join(',')}`
    case 'exhibit':
      return `exhibit:${target.exhibitId}:${target.field ?? ''}:${target.spanId ?? ''}`
    case 'unread':
      return `unread:${target.exhibitKind}:${target.reason}`
  }
}

export function compareNotRead(a: NotReadCount, b: NotReadCount): number {
  return chain(text(a.kind, b.kind), text(a.reason, b.reason))
}

export function compareOwnIdentifiers(a: OwnIdentifierEntry, b: OwnIdentifierEntry): number {
  return chain(
    text(a.kind, b.kind),
    nullsFirst(a.platform, b.platform),
    text(a.value, b.value),
    compareMembers(a.member, b.member)
  )
}

export function compareSourceClassHeads(a: SourceClassHead, b: SourceClassHead): number {
  return chain(compareMembers(a.member, b.member), text(a.value, b.value))
}

const sorted = <T>(items: readonly T[], compare: (a: T, b: T) => number): T[] =>
  [...items].sort(compare)

function sortSpans(spans: SpanView[]): SpanView[] {
  return sorted(spans, compareLocated).map((span) => ({
    ...span,
    dates: sorted(
      span.dates,
      (a, b) => SPAN_DATE_KINDS.indexOf(a.kind) - SPAN_DATE_KINDS.indexOf(b.kind)
    )
  }))
}

function sortJoint(joint: JointView): JointView {
  return {
    ...joint,
    decisions: sorted(joint.decisions, compareDecisions),
    support: sortSpans(joint.support),
    conflicts: sortSpans(joint.conflicts),
    unreviewed: sortSpans(joint.unreviewed),
    noLongerCounted: sortSpans(joint.noLongerCounted),
    dismissed: sortSpans(joint.dismissed),
    strength: joint.strength && {
      ...joint.strength,
      sourceClasses: sorted(joint.strength.sourceClasses, (a, b) =>
        text(a.sourceClass, b.sourceClass)
      )
    }
  }
}

/**
 * Sorts every array of a view by its canonical key. Arrays whose order carries meaning (a
 * Joint's two Subjects, a path's Joints and Subjects, the changes since a run) keep their order.
 */
export function sortInvestigationView(view: InvestigationView): InvestigationView {
  const identity = new Map(view.joints.map((j) => [j.id, j.identityHash]))
  const pathKey = (path: PathView): string =>
    path.jointIds.map((id) => identity.get(id) ?? id).join(',')
  const run = view.run && {
    ...view.run,
    startingSubjectIds: [...view.run.startingSubjectIds].sort(text),
    versions: {
      ...view.run.versions,
      rules: sorted(view.run.versions.rules, (a, b) => text(a.rule, b.rule))
    },
    counts: { ...view.run.counts, notRead: sorted(view.run.counts.notRead, compareNotRead) }
  }
  return {
    ...view,
    run,
    subjects: sorted(view.subjects, compareSubjects).map((s) => ({
      ...s,
      waiting: sorted(s.waiting, compareWaitingSpans),
      placed: sorted(s.placed, compareWaitingSpans)
    })),
    joints: sorted(view.joints, compareJoints).map(sortJoint),
    passageGroups: sorted(view.passageGroups, (a, b) => text(a.passageHash, b.passageHash)).map(
      (g) => ({ ...g, holders: sorted(g.holders, compareExhibitRefs) })
    ),
    paths: sorted(view.paths, (a, b) => text(pathKey(a), pathKey(b))),
    gaps: sorted(view.gaps, (a, b) => GAP_KINDS.indexOf(a.kind) - GAP_KINDS.indexOf(b.kind)).map(
      (g) => ({ ...g, entries: sorted(g.entries, compareGapTargets) })
    ),
    withheld: sorted(view.withheld, compareExhibitRefs).map((w) => ({
      ...w,
      holders: sorted(w.holders, compareMembers)
    }))
  }
}
