import type {
  JointView,
  MemberRef,
  NotReadCount,
  NotReadReason,
  RunSummary,
  SubjectView
} from '@shared/investigation'
import { kindLabel, kindSingular } from '@renderer/components/data/dataTreeModel'

// The view's own width, not the window's, decides the arrangement: 500 + 340 pixels of side panes
// and a detail pane of at least 300 (view feasibility assessment, S7).
export const TABS_BELOW_WIDTH = 1140

export type Arrangement = 'panes' | 'tabs'

export function arrangementFor(viewWidth: number): Arrangement {
  return viewWidth >= TABS_BELOW_WIDTH ? 'panes' : 'tabs'
}

export function counted(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`
}

// Pinned to UTC, with the zone written out, so the basis reads the same on every machine.
const BASIS_TIME = new Intl.DateTimeFormat('en-US', {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
  timeZone: 'UTC'
})
const BASIS_DATE = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC'
})

export function formatBasis(iso: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return `Case as of ${iso}`
  return `Case as of ${BASIS_TIME.format(at)} UTC, ${BASIS_DATE.format(at)}`
}

// The engine plan's reasons (E11, E12). A reason this build does not know shows as itself, so the
// breakdown never drops one.
const NOT_READ_WORDING: Record<NotReadReason, string> = {
  'kind-not-read': 'the run cannot read this kind',
  'build-older': 'older field build',
  'build-missing': 'no field build',
  'build-failed': 'field build failed',
  'build-partial': 'field build partial',
  'no-text': 'no Extracted Text'
}

export function notReadReasonWording(reason: string): string {
  return Object.hasOwn(NOT_READ_WORDING, reason)
    ? NOT_READ_WORDING[reason as NotReadReason]
    : reason
}

export interface NotReadRow {
  key: string
  text: string
}

// The count carries an Exhibit kind, not a file type, so each row names the kind as the Data
// screen does.
export function notReadRows(notRead: NotReadCount[]): NotReadRow[] {
  return notRead.map(({ kind, reason, count }) => ({
    key: `${kind}:${reason}`,
    text: `${count} ${count === 1 ? kindSingular(kind) : kindLabel(kind)} · ${notReadReasonWording(reason)}`
  }))
}

export function notReadTotal(notRead: NotReadCount[]): number {
  return notRead.reduce((sum, { count }) => sum + count, 0)
}

function joinWithAnd(items: string[]): string {
  if (items.length <= 2) return items.join(' and ')
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
}

export function holderText(holders: MemberRef[]): string {
  const mine = holders.some(({ self }) => self)
  const others = holders.filter(({ self }) => !self).map((m) => m.memberCode ?? m.operatorName)
  if (others.length === 0) return mine ? 'your flag' : 'withheld'
  return `withheld by ${joinWithAnd(mine ? ['you', ...others] : others)}`
}

export function holdsOwnFlag(holders: MemberRef[]): boolean {
  return holders.some(({ self }) => self)
}

// A Subject shows its distinguishing detail when another Subject in the view has its name, so two
// Rowan Pikes stay apart (view brief, decision 5).
export function sharedNames(subjects: SubjectView[]): Set<string> {
  const seen = new Set<string>()
  const shared = new Set<string>()
  for (const { name } of subjects) {
    if (seen.has(name)) shared.add(name)
    seen.add(name)
  }
  return shared
}

export function subjectMeta(subject: SubjectView, shared: Set<string>): string {
  const { kind, detail, name } = subject
  return detail && shared.has(name) ? `${kind} · ${detail}` : kind
}

export function subjectLabel(subject: SubjectView, shared: Set<string>): string {
  const { detail, name } = subject
  return detail && shared.has(name) ? `${name} (${detail})` : name
}

// An inquiry run shows its inquiry; a run for a claim names the Joint it found material for.
export function runInquiryText(run: RunSummary, joints: JointView[]): string {
  if (run.from === 'inquiry') return run.inquiry ?? ''
  const joint =
    run.from === 'find-more'
      ? joints.find(({ id }) => id === run.jointId)
      : joints.find(
          ({ createdByRunId, producer }) =>
            createdByRunId === run.id &&
            producer.kind === 'operator' &&
            producer.noteId === run.noteId
        )
  return joint ? `Find material for: ${joint.claim}` : 'Find material for a claim'
}
