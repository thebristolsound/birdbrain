import { describe, it, expect } from 'vitest'
import type { ExhibitVerification } from '@shared/types'
import {
  bucketForRow,
  filterRows,
  formatBytes,
  integrityCounts,
  formatStamp,
  isIntegrityException,
  rowsForNode,
  shortHash,
  toArtifactRow,
  type CaptureFacts
} from '@renderer/components/data/dataTableModel'
import { CAPTURE_A, CAPTURE_LEGACY, HASH_A, INVENTORY, STAGED_PDF, THUMB_A } from '../dataFixtures'

const FACTS = new Map<string, CaptureFacts>([
  ['cap-a', { url: 'https://example.com/page', lastVerifiedStatus: 'tampered' }],
  ['cap-legacy', { url: 'https://old.example.org/', lastVerifiedStatus: 'legacy' }]
])

const rows = (key: Parameters<typeof rowsForNode>[1]) =>
  rowsForNode(INVENTORY, key, FACTS).map((row) => toArtifactRow(row, INVENTORY, FACTS))

describe('toArtifactRow', () => {
  it('derives SOURCE per entity: URL host, parent Exhibit, origin', () => {
    expect(toArtifactRow(CAPTURE_A, INVENTORY, FACTS).source).toBe('example.com')
    expect(toArtifactRow(THUMB_A, INVENTORY, FACTS).source).toBe('Example page')
    expect(toArtifactRow(STAGED_PDF, INVENTORY, FACTS).source).toBe('manual-upload')
  })

  it('falls back to the raw URL when it does not parse, and to origin when there is none', () => {
    const facts = new Map<string, CaptureFacts>([['cap-a', { url: 'not a url' }]])
    expect(toArtifactRow(CAPTURE_A, INVENTORY, facts).source).toBe('not a url')
    expect(toArtifactRow(CAPTURE_A, INVENTORY, new Map()).source).toBe('extension')
    expect(
      toArtifactRow({ ...STAGED_PDF, sourceUrl: 'https://drive.example/x' }, INVENTORY, facts)
        .source
    ).toBe('drive.example')
  })

  it('carries anchoring and pooled state separately from kind', () => {
    const staged = toArtifactRow(STAGED_PDF, INVENTORY, FACTS)
    expect(staged).toMatchObject({ staged: true, anchored: false, kind: 'document' })
    const legacy = toArtifactRow(CAPTURE_LEGACY, INVENTORY, FACTS)
    expect(legacy).toMatchObject({ staged: false, anchored: false, exists: false })
    const anchored = toArtifactRow(CAPTURE_A, INVENTORY, FACTS)
    expect(anchored).toMatchObject({ staged: false, anchored: true, exhibitNumber: 1 })
  })

  it('takes CAPTURED from the entity’s own time column', () => {
    expect(toArtifactRow(CAPTURE_A, INVENTORY, FACTS).capturedAt).toBe(CAPTURE_A.committedAt)
    expect(toArtifactRow(THUMB_A, INVENTORY, FACTS).capturedAt).toBe(THUMB_A.createdAt)
    expect(toArtifactRow(STAGED_PDF, INVENTORY, FACTS).capturedAt).toBe(STAGED_PDF.arrivedAt)
  })
})

describe('rowsForNode', () => {
  it('shows pooled rows under Staging and nowhere else (X16)', () => {
    expect(rows('staging').map((r) => r.id)).toEqual(['staged-1'])
    for (const key of ['data-sources', 'kind:document', 'views', 'file-type:PDF'] as const) {
      expect(rows(key).map((r) => r.id)).not.toContain('staged-1')
    }
  })

  it('selects an Exhibit with its Derived Files, and a kind with all of its Exhibits', () => {
    expect(rows('exhibit:cap-a').map((r) => r.id)).toEqual(['cap-a', 'thumb-a'])
    expect(rows('kind:capture').map((r) => r.id)).toEqual(['cap-a', 'cap-legacy', 'thumb-a'])
    expect(rows('derived:thumb-a').map((r) => r.id)).toEqual(['thumb-a'])
  })

  it('files Integrity Exceptions from the persisted Capture state, Derived Files with their parent', () => {
    expect(rows('integrity-exceptions').map((r) => r.id)).toEqual(['cap-a', 'thumb-a'])
  })

  it('filters a keyword node to the matched Exhibits and nothing else (X39)', () => {
    const matches = new Map([['s1', new Set(['cap-legacy'])]])
    const hit = rowsForNode(INVENTORY, 'keyword:s1', FACTS, { keywordMatches: matches })
    expect(hit.map((r) => r.id)).toEqual(['cap-legacy'])
    expect(rowsForNode(INVENTORY, 'keyword:s9', FACTS, { keywordMatches: matches })).toEqual([])
    expect(rowsForNode(INVENTORY, 'keyword:s1', FACTS)).toEqual([])
  })

  it('treats legacy and unverified as not exceptions', () => {
    expect(isIntegrityException('legacy')).toBe(false)
    expect(isIntegrityException(undefined)).toBe(false)
    expect(isIntegrityException('verified')).toBe(false)
    expect(isIntegrityException('chain-broken')).toBe(true)
    expect(isIntegrityException('missing')).toBe(true)
  })
})

describe('bucketForRow', () => {
  const verified: ExhibitVerification = {
    exhibitId: 'cap-a',
    caseId: 'case1',
    kind: 'capture',
    status: 'verified',
    derived: [{ derivedFileId: 'thumb-a', derivation: 'thumbnail', status: 'tampered' }]
  }

  it('reads this session’s verify result before the persisted state', () => {
    // Persisted says tampered; the session verify said verified.
    expect(bucketForRow(CAPTURE_A, { captures: FACTS })).toBe('exception')
    expect(
      bucketForRow(CAPTURE_A, { captures: FACTS, verifications: new Map([['cap-a', verified]]) })
    ).toBe('verified')
  })

  it('gives a Derived File its own outcome from the parent’s session result', () => {
    const context = { captures: FACTS, verifications: new Map([['cap-a', verified]]) }
    expect(bucketForRow(THUMB_A, context)).toBe('exception')
    const clean = {
      ...verified,
      derived: [{ derivedFileId: 'thumb-a', derivation: 'thumbnail', status: 'verified' as const }]
    }
    expect(
      bucketForRow(THUMB_A, { captures: FACTS, verifications: new Map([['cap-a', clean]]) })
    ).toBe('verified')
    const unanchored = {
      ...verified,
      derived: [
        { derivedFileId: 'thumb-a', derivation: 'thumbnail', status: 'unverified' as const }
      ]
    }
    expect(
      bucketForRow(THUMB_A, { captures: FACTS, verifications: new Map([['cap-a', unanchored]]) })
    ).toBe('unverified')
  })

  it('without a session result a Derived File is unverified unless its parent is an exception', () => {
    expect(bucketForRow(THUMB_A, { captures: FACTS })).toBe('exception')
    const cleanParent = new Map(FACTS)
    cleanParent.set('cap-a', { url: 'https://example.com/page', lastVerifiedStatus: 'verified' })
    expect(bucketForRow(THUMB_A, { captures: cleanParent })).toBe('unverified')
  })

  it('files legacy and verifier-too-old as unverified, never as exceptions', () => {
    expect(bucketForRow(CAPTURE_LEGACY, { captures: FACTS })).toBe('unverified')
    const tooOld: ExhibitVerification = {
      exhibitId: 'cap-a',
      caseId: 'case1',
      kind: 'capture',
      status: 'unsupported'
    }
    expect(
      bucketForRow(CAPTURE_A, { captures: FACTS, verifications: new Map([['cap-a', tooOld]]) })
    ).toBe('unverified')
  })

  it('counts the three buckets over anchored rows only', () => {
    expect(integrityCounts(INVENTORY, { captures: FACTS })).toEqual({
      verified: 0,
      exception: 2,
      unverified: 1
    })
  })
})

describe('filterRows', () => {
  const all = rows('data-sources')

  it('matches name, kind, hash prefix and Exhibit Number', () => {
    expect(filterRows(all, 'old').map((r) => r.id)).toEqual(['cap-legacy'])
    expect(filterRows(all, 'thumbnail').map((r) => r.id)).toEqual(['thumb-a'])
    expect(filterRows(all, HASH_A.slice(0, 8).toUpperCase()).map((r) => r.id)).toEqual(['cap-a'])
    expect(filterRows(all, 'Exhibit 2').map((r) => r.id)).toEqual(['cap-legacy'])
    expect(filterRows(all, 'Captures').map((r) => r.id)).toEqual(['cap-a', 'cap-legacy'])
  })

  it('does not search page text', () => {
    // The fixture's Capture text would contain this if text were searched;
    // the model has no text input at all, so nothing can match it.
    expect(filterRows(all, 'lorem ipsum')).toEqual([])
  })

  it('returns everything for a blank query', () => {
    expect(filterRows(all, '   ')).toBe(all)
  })
})

describe('formatting', () => {
  it('formats sizes and says nothing for an unrecorded size', () => {
    expect(formatBytes(null)).toBe('—')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(15 * 1024 * 1024)).toBe('15 MB')
  })

  it('renders a fixed UTC stamp', () => {
    expect(formatStamp('2026-09-01T10:00:00.000Z')).toBe('2026-09-01 10:00')
    expect(formatStamp('not a date')).toBe('not a date')
  })

  it('shortens a hash for the column without changing it', () => {
    expect(shortHash(HASH_A)).toBe(HASH_A.slice(0, 12))
    expect(shortHash('abc')).toBe('abc')
  })
})
