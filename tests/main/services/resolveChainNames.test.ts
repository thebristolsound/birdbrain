import { describe, it, expect } from 'vitest'
import { resolveChainNames } from '@main/services/export'
import type { Capture, Exhibit } from '@shared/types'

// #1657: which id an export writes for a row the chain may know by another.
// Each case below changes its outcome when the one rule it names is removed,
// so a rule cannot be deleted with these tests still passing.

const TIME = '2026-09-30T10:00:00.000Z'
const H = 'a'.repeat(64)
const OTHER_H = 'b'.repeat(64)

function capture(id: string, manifestIndex: number | undefined, hash = H): Capture {
  return {
    id,
    caseId: 'case',
    url: 'https://example.com/page',
    title: id,
    hash,
    timestamp: TIME,
    createdAt: TIME,
    format: 'mhtml',
    method: 'extension',
    manifestIndex
  }
}

function exhibit(id: string, manifestSeq: number | null, path: string): Exhibit {
  return {
    id,
    caseId: 'case',
    kind: 'document',
    origin: 'manual-upload',
    exhibitNumber: 1,
    memberCode: null,
    authorInstallationId: null,
    name: `${id}.pdf`,
    contentHash: H,
    path,
    sizeBytes: 1,
    committedAt: TIME,
    manifestSeq
  }
}

const captureEntry = (index: number, captureId: string, contentHash = H) => ({
  type: 'capture',
  index,
  captureId,
  contentHash
})

const exhibitEntry = (index: number, exhibitId: string, path: string) => ({
  type: 'exhibit',
  index,
  exhibitId,
  contentHash: H,
  path
})

describe('resolveChainNames (#1657)', () => {
  it('names a renamed capture and a renamed attachment by their entries', () => {
    const names = resolveChainNames(
      [capture('new-capture', 0)],
      [exhibit('new-doc', 1, 'new-case/documents/new-doc.pdf')],
      [captureEntry(0, 'old-capture'), exhibitEntry(1, 'old-doc', 'old-case/documents/old-doc.pdf')]
    )
    expect(names).toEqual(
      new Map([
        ['new-capture', { id: 'old-capture', path: null }],
        ['new-doc', { id: 'old-doc', path: 'old-case/documents/old-doc.pdf' }]
      ])
    )
  })

  it('leaves a row with no stored index unnamed', () => {
    expect(resolveChainNames([capture('legacy', undefined)], [], [captureEntry(0, 'x')])).toEqual(
      new Map()
    )
  })

  // Rule: a row whose own id an entry of its kind carries is not renamed.
  // Its stored index points at another id's entry for the same bytes, whose
  // own row is gone, so no other rule stands in.
  it('keeps a row its own id is signed under, wherever its index points', () => {
    const names = resolveChainNames(
      [capture('copy', 0)],
      [],
      [captureEntry(0, 'deleted-original'), captureEntry(1, 'copy')]
    )
    expect(names).toEqual(new Map())
  })

  // Rule: only an entry of the row's own kind answers for it. A `deletion`
  // carries a captureId and the content hash too.
  it('takes no name from an entry of another kind at the index', () => {
    const names = resolveChainNames(
      [capture('new-capture', 3)],
      [],
      [{ type: 'deletion', index: 3, captureId: 'deleted', contentHash: H }]
    )
    expect(names).toEqual(new Map())
  })

  // Rule: only an entry over the row's bytes answers for it.
  it('takes no name from an entry over other bytes', () => {
    const names = resolveChainNames(
      [capture('new-capture', 0)],
      [],
      [captureEntry(0, 'old-capture', OTHER_H)]
    )
    expect(names).toEqual(new Map())
  })

  // Rule: the entries at the index have to name one id. Two chains of a
  // Shared Case can each hold an entry at the same index over the same bytes.
  it('takes no name when entries at the index name two ids', () => {
    const names = resolveChainNames(
      [capture('new-capture', 0)],
      [],
      [captureEntry(0, 'first-chain'), captureEntry(0, 'second-chain')]
    )
    expect(names).toEqual(new Map())
  })

  // Rule: an id another row of the Case holds is not taken.
  it('takes no name another row of the Case holds', () => {
    const names = resolveChainNames(
      [capture('kept', 0), capture('new-capture', 0)],
      [],
      [captureEntry(0, 'kept')]
    )
    expect(names).toEqual(new Map())
  })

  // Rule: an id two renamed rows claim names neither.
  it('names neither of two renamed rows that claim one entry', () => {
    const names = resolveChainNames(
      [capture('new-a', 0), capture('new-b', 0)],
      [],
      [captureEntry(0, 'old-a'), captureEntry(1, 'old-b')]
    )
    expect(names).toEqual(new Map())
  })
})
