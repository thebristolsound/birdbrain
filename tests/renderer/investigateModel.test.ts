import { describe, expect, it } from 'vitest'
import {
  arrangementFor,
  counted,
  formatBasis,
  holderText,
  holdsOwnFlag,
  notReadReasonWording,
  notReadRows,
  notReadTotal,
  runInquiryText,
  sharedNames,
  subjectLabel,
  subjectMeta,
  TABS_BELOW_WIDTH
} from '@renderer/components/investigate/investigateModel'
import { NOT_READ_REASONS, type MemberRef, type RunSummary } from '@shared/investigation'
import {
  FIXTURE_BEFORE_RUN_VIEW,
  FIXTURE_IDS,
  FIXTURE_POPULATED_VIEW,
  FIXTURE_SELF,
  FIXTURE_TEAMMATE
} from '@shared/investigationFixture'

const RUN = FIXTURE_POPULATED_VIEW.run as RunSummary

describe('arrangementFor', () => {
  it('keeps three panes from 1140 pixels of view and tabs below', () => {
    expect(TABS_BELOW_WIDTH).toBe(1140)
    expect(arrangementFor(1152)).toBe('panes')
    expect(arrangementFor(1140)).toBe('panes')
    expect(arrangementFor(1139)).toBe('tabs')
    // The 900-pixel minimum window less the 48-pixel sidebar.
    expect(arrangementFor(852)).toBe('tabs')
  })
})

describe('formatBasis', () => {
  it('writes the run start in UTC with its zone and year', () => {
    expect(formatBasis('2026-10-03T14:02:00Z')).toBe('Case as of 14:02 UTC, October 3, 2026')
    expect(formatBasis('2026-10-04T01:30:00Z')).toBe('Case as of 01:30 UTC, October 4, 2026')
  })

  it('shows a value it cannot read as itself', () => {
    expect(formatBasis('not a time')).toBe('Case as of not a time')
  })
})

describe('the not-read breakdown', () => {
  it('words every reason the contract names, and shows any other as itself', () => {
    const wording = Object.fromEntries(NOT_READ_REASONS.map((r) => [r, notReadReasonWording(r)]))
    expect(wording).toEqual({
      'kind-not-read': 'the run cannot read this kind',
      'build-older': 'older field build',
      'build-missing': 'no field build',
      'build-failed': 'field build failed',
      'build-partial': 'field build partial',
      'no-text': 'no Extracted Text'
    })
    expect(notReadReasonWording('reason-from-a-newer-build')).toBe('reason-from-a-newer-build')
    expect(notReadReasonWording('toString')).toBe('toString')
  })

  it('names each kind as the Data screen does, singular for one', () => {
    expect(notReadRows(RUN.counts.notRead).map(({ text }) => text)).toEqual([
      '1 Attachment · the run cannot read this kind',
      '1 Document · the run cannot read this kind'
    ])
    expect(
      notReadRows([
        { kind: 'document', reason: 'kind-not-read', count: 2 },
        { kind: 'capture', reason: 'build-older', count: 3 }
      ])
    ).toEqual([
      { key: 'document:kind-not-read', text: '2 Documents · the run cannot read this kind' },
      { key: 'capture:build-older', text: '3 Captures · older field build' }
    ])
    expect(notReadTotal(RUN.counts.notRead)).toBe(2)
    expect(notReadTotal([])).toBe(0)
  })
})

describe('holderText', () => {
  const other = (memberCode: string): MemberRef => ({
    memberCode,
    operatorName: `Operator ${memberCode}`,
    self: false
  })

  it('says whose flags hold an Exhibit', () => {
    expect(holderText([FIXTURE_SELF])).toBe('your flag')
    expect(holderText([FIXTURE_TEAMMATE, FIXTURE_SELF])).toBe('withheld by you and NK')
    expect(holderText([FIXTURE_TEAMMATE])).toBe('withheld by NK')
    expect(holderText([FIXTURE_SELF, other('NK'), other('AB')])).toBe('withheld by you, NK, and AB')
    expect(holderText([other('NK'), other('AB'), other('CD')])).toBe('withheld by NK, AB, and CD')
    expect(holderText([{ memberCode: null, operatorName: 'J. Doe', self: false }])).toBe(
      'withheld by J. Doe'
    )
    expect(holderText([])).toBe('withheld')
  })

  it('offers Clear my flag only on a flag this installation holds', () => {
    expect(holdsOwnFlag([FIXTURE_TEAMMATE, FIXTURE_SELF])).toBe(true)
    expect(holdsOwnFlag([FIXTURE_TEAMMATE])).toBe(false)
  })
})

describe('Subject labels', () => {
  const { subjects } = FIXTURE_BEFORE_RUN_VIEW
  const shared = sharedNames(subjects)
  const pikes = subjects.filter(({ name }) => name === 'Rowan Pike')

  it('tells two Subjects with one name apart by their detail', () => {
    expect([...shared]).toEqual(['Rowan Pike'])
    expect(pikes.map((s) => subjectMeta(s, shared))).toEqual([
      'person · byline, gazette.example.com',
      'person · harbour board minutes'
    ])
    expect(pikes.map((s) => subjectLabel(s, shared))).toEqual([
      'Rowan Pike (byline, gazette.example.com)',
      'Rowan Pike (harbour board minutes)'
    ])
  })

  it('shows a Subject with a unique name by kind alone', () => {
    const hale = subjects.find(({ name }) => name === 'Imogen Hale')!
    expect(subjectMeta(hale, shared)).toBe('person')
    expect(subjectLabel(hale, shared)).toBe('Imogen Hale')
    const detailed = { ...hale, detail: 'harbour office' }
    expect(subjectMeta(detailed, shared)).toBe('person')
  })
})

describe('runInquiryText', () => {
  const { joints } = FIXTURE_POPULATED_VIEW

  it('shows an inquiry run its inquiry', () => {
    expect(runInquiryText(RUN, joints)).toBe(RUN.inquiry)
    expect(runInquiryText({ ...RUN, inquiry: null }, joints)).toBe('')
  })

  it('names the claim a Find more material run looked for', () => {
    const target = joints.find(({ id }) => id === FIXTURE_IDS.joints.callowaySato)!
    const findMore: RunSummary = { ...RUN, from: 'find-more', inquiry: null, jointId: target.id }
    expect(runInquiryText(findMore, joints)).toBe(`Find material for: ${target.claim}`)
    expect(runInquiryText({ ...findMore, jointId: 'gone' }, joints)).toBe(
      'Find material for a claim'
    )
  })

  it('names the claim a Note-claim run recorded', () => {
    const noteRun: RunSummary = {
      ...RUN,
      id: 'note-run',
      from: 'note-claim',
      inquiry: null,
      noteId: FIXTURE_IDS.note
    }
    const recorded = {
      ...joints[0],
      id: 'note-joint',
      claim: 'M. Calloway also writes as The Ferryman.',
      createdByRunId: 'note-run',
      producer: { kind: 'operator' as const, noteId: FIXTURE_IDS.note }
    }
    expect(runInquiryText(noteRun, [...joints, recorded])).toBe(
      'Find material for: M. Calloway also writes as The Ferryman.'
    )
    expect(runInquiryText(noteRun, joints)).toBe('Find material for a claim')
  })
})

describe('counted', () => {
  it('takes the singular for one', () => {
    expect(counted(1, 'Joint', 'Joints')).toBe('1 Joint')
    expect(counted(2, 'Joint', 'Joints')).toBe('2 Joints')
    expect(counted(0, 'Joint', 'Joints')).toBe('0 Joints')
  })
})
