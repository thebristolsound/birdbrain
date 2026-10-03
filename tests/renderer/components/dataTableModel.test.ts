import { describe, it, expect } from 'vitest'
import type {
  ExhibitVerification,
  InventoryDerivedFileRow,
  InventoryExhibitRow,
  InventoryRow
} from '@shared/types'
import {
  bucketForRow,
  capturedTitle,
  filterRows,
  formatBytes,
  integrityCounts,
  formatStamp,
  isIntegrityException,
  rowsForNode,
  shortHash,
  stripBreadcrumb,
  toArtifactRow,
  type CaptureFacts,
  type CaptureFactsById
} from '@renderer/components/data/dataTableModel'
import {
  indicatorCategoryKey,
  indicatorSubcategoryKey
} from '@renderer/components/data/dataTreeModel'
import { CAPTURE_A, CAPTURE_LEGACY, HASH_A, INVENTORY, STAGED_PDF, THUMB_A } from '../dataFixtures'

const FACTS = new Map<string, CaptureFacts>([
  ['cap-a', { url: 'https://example.com/page', lastVerifiedStatus: 'tampered' }],
  ['cap-legacy', { url: 'https://old.example.org/', lastVerifiedStatus: 'legacy' }]
])

const rows = (key: Parameters<typeof rowsForNode>[1]) =>
  rowsForNode(INVENTORY, key, FACTS).map((row) => toArtifactRow(row, INVENTORY, FACTS))

describe('toArtifactRow', () => {
  // SOURCE printed the URL host, the parent's name or the origin before
  // #1552; the mock prints the capture id, which is the Exhibit citation here.
  it('cites the Exhibit a row belongs to in SOURCE, the parent’s for a Derived File', () => {
    const source = (row: InventoryRow) => {
      const { source, sourceDetail } = toArtifactRow(row, INVENTORY, FACTS)
      return [source, sourceDetail]
    }
    expect(source(CAPTURE_A)).toEqual(['Exhibit 1', 'https://example.com/page'])
    expect(source(CAPTURE_LEGACY)).toEqual(['Exhibit 2', 'https://old.example.org/'])
    expect(source(THUMB_A)).toEqual(['Exhibit 1', 'Example page'])
    expect(source(STAGED_PDF)).toEqual(['manual-upload', 'manual-upload'])
  })

  it('falls back to origin behind SOURCE, and a pooled file keeps its stated host', () => {
    expect(toArtifactRow(CAPTURE_A, INVENTORY, new Map()).sourceDetail).toBe('extension')
    const orphan = { ...THUMB_A, parentExhibitId: 'gone' }
    expect(toArtifactRow(orphan, INVENTORY, FACTS).source).toBe('gone')
    const stated = { ...STAGED_PDF, sourceUrl: 'https://drive.example/x' }
    expect(toArtifactRow(stated, INVENTORY, FACTS).source).toBe('drive.example')
    expect(toArtifactRow(stated, INVENTORY, FACTS).sourceDetail).toBe('https://drive.example/x')
    const unparsed = { ...STAGED_PDF, sourceUrl: 'not a url' }
    expect(toArtifactRow(unparsed, INVENTORY, FACTS).source).toBe('not a url')
  })

  it('carries anchoring and pooled state separately from kind', () => {
    const staged = toArtifactRow(STAGED_PDF, INVENTORY, FACTS)
    expect(staged).toMatchObject({ staged: true, anchored: false, kind: 'document' })
    const legacy = toArtifactRow(CAPTURE_LEGACY, INVENTORY, FACTS)
    expect(legacy).toMatchObject({ staged: false, anchored: false, exists: false })
    const anchored = toArtifactRow(CAPTURE_A, INVENTORY, FACTS)
    expect(anchored).toMatchObject({ staged: false, anchored: true, exhibitNumber: 1 })
  })
})

// Known answers for CAPTURED per row kind (#1552). The column used to show the
// commit, creation and arrival times under the one heading; it now shows the
// capture time wherever one exists and names any other clock it shows.
describe('CAPTURED known answers', () => {
  const CAPTURED_AT = '2026-09-01T09:58:12.000Z'
  const facts = new Map<string, CaptureFacts>([
    ['cap-a', { url: 'https://example.com/page', capturedAt: CAPTURED_AT }]
  ])
  const DOC: InventoryExhibitRow = {
    ...CAPTURE_A,
    id: 'doc-1',
    kind: 'document',
    origin: 'manual-upload',
    exhibitNumber: 3,
    name: 'report.pdf',
    committedAt: '2026-09-12T08:00:00.000Z'
  }
  const DOC_TEXT: InventoryDerivedFileRow = {
    ...THUMB_A,
    id: 'doc-text',
    parentExhibitId: 'doc-1',
    derivation: 'text',
    name: 'text',
    createdAt: '2026-09-12T08:00:03.000Z'
  }
  const ORPHAN: InventoryDerivedFileRow = { ...THUMB_A, id: 'orphan', parentExhibitId: 'gone' }
  const inventory: InventoryRow[] = [...INVENTORY, DOC, DOC_TEXT, ORPHAN]
  const cell = (row: InventoryRow, captureFacts: CaptureFactsById = facts) => {
    const artifact = toArtifactRow(row, inventory, captureFacts)
    return [artifact.capturedClock, formatStamp(artifact.capturedAt), capturedTitle(artifact)]
  }

  it('shows a Capture its own capture time, not its commit time', () => {
    expect(cell(CAPTURE_A)).toEqual([
      'captured',
      '2026-09-01 09:58',
      'Captured 2026-09-01T09:58:12.000Z'
    ])
  })

  it('shows a Derived File of a Capture its parent’s capture time, not its creation time', () => {
    expect(cell(THUMB_A)).toEqual([
      'captured',
      '2026-09-01 09:58',
      'Captured 2026-09-01T09:58:12.000Z'
    ])
  })

  it('names the commit time on an Exhibit that has no capture time, and on its Derived Files', () => {
    const committed = [
      'committed',
      '2026-09-12 08:00',
      'Committed 2026-09-12T08:00:00.000Z; no capture time is shown for this file'
    ]
    expect(cell(DOC)).toEqual(committed)
    expect(cell(DOC_TEXT)).toEqual(committed)
    // A Capture whose facts have not loaded is never given its commit time as
    // a capture time.
    expect(cell(CAPTURE_A, new Map())).toEqual([
      'committed',
      '2026-09-01 10:00',
      'Committed 2026-09-01T10:00:00.000Z; no capture time is shown for this file'
    ])
  })

  it('names the arrival time on a pooled file', () => {
    expect(cell(STAGED_PDF)).toEqual([
      'arrived',
      '2026-09-10 12:00',
      'Arrived in the pool 2026-09-10T12:00:00.000Z; not captured and not anchored'
    ])
  })

  it('names the creation time on a Derived File whose parent is not in the inventory', () => {
    expect(cell(ORPHAN)).toEqual([
      'created',
      '2026-09-01 10:00',
      "Created 2026-09-01T10:00:05.000Z; its parent Exhibit is not in this case's inventory"
    ])
  })
})

describe('stripBreadcrumb', () => {
  it('reads the SOURCE citation and the row’s group, as the mock’s capture and group', () => {
    const crumb = (row: InventoryRow) => stripBreadcrumb(toArtifactRow(row, INVENTORY, FACTS))
    expect(crumb(CAPTURE_A)).toBe('Exhibit 1 / raw')
    expect(crumb(THUMB_A)).toBe('Exhibit 1 / derived')
    expect(crumb(STAGED_PDF)).toBe('manual-upload / staging')
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

  // The Indicators view replaces the table there, so these nodes name no rows
  // and their node menu offers no Verify. Whole-case Verify stays on the
  // Integrity Exceptions strip.
  it('names no rows under Indicators, so no Verify is offered there', () => {
    for (const key of [
      'indicators',
      indicatorCategoryKey('emails'),
      indicatorSubcategoryKey('emails', 'personal')
    ] as const) {
      expect(rows(key)).toEqual([])
    }
  })

  it('files Integrity Exceptions from the persisted Capture state and infers nothing for Derived Files', () => {
    expect(rows('integrity-exceptions').map((r) => r.id)).toEqual(['cap-a'])
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

  it('without a session result a Derived File is unverified whatever its parent says (X36)', () => {
    expect(bucketForRow(THUMB_A, { captures: FACTS })).toBe('unverified')
    const cleanParent = new Map(FACTS)
    cleanParent.set('cap-a', { url: 'https://example.com/page', lastVerifiedStatus: 'verified' })
    expect(bucketForRow(THUMB_A, { captures: cleanParent })).toBe('unverified')
  })

  it('files a verified Exhibit whose number was issued twice as an exception (X48)', () => {
    const repeated: ExhibitVerification = {
      ...verified,
      exceptions: [
        {
          category: 'repeated-exhibit-number',
          exhibitNumber: 3,
          exhibitIds: ['gone', 'cap-a'],
          reason: 'Integrity Exception: Exhibit Number 3 is assigned to 2 exhibits'
        }
      ]
    }
    const context = { captures: FACTS, verifications: new Map([['cap-a', repeated]]) }
    expect(bucketForRow(CAPTURE_A, context)).toBe('exception')
    expect(rowsForNode(INVENTORY, 'integrity-exceptions', FACTS, context)).toContain(CAPTURE_A)
    expect(
      bucketForRow(CAPTURE_A, {
        captures: FACTS,
        verifications: new Map([['cap-a', { ...repeated, exceptions: [] }]])
      })
    ).toBe('verified')
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
      exception: 1,
      unverified: 2
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
    expect(filterRows(all, '2').map((r) => r.id)).toEqual(['cap-legacy'])
    expect(filterRows(all, 'Captures').map((r) => r.id)).toEqual(['cap-a', 'cap-legacy'])
  })

  it('matches the prefixed citation of a Shared Case row (#1510)', () => {
    const shared = all.map((row) => (row.id === 'cap-a' ? { ...row, citation: 'NK-1' } : row))
    expect(filterRows(shared, 'nk-1').map((r) => r.id)).toEqual(['cap-a'])
    expect(filterRows(shared, 'Exhibit NK-1').map((r) => r.id)).toEqual(['cap-a'])
    expect(toArtifactRow({ ...CAPTURE_A, citation: 'NK-1' }, INVENTORY, FACTS).citation).toBe(
      'NK-1'
    )
    expect(toArtifactRow(THUMB_A, INVENTORY, FACTS).citation).toBeNull()
  })

  it('cites a Shared Case row by its prefixed citation in SOURCE, the parent’s for a Derived File', () => {
    const prefixed = { ...CAPTURE_A, citation: 'NK-1' }
    const inventory = INVENTORY.map((row) => (row.id === 'cap-a' ? prefixed : row))
    expect(toArtifactRow(prefixed, inventory, FACTS).source).toBe('Exhibit NK-1')
    expect(toArtifactRow(THUMB_A, inventory, FACTS).source).toBe('Exhibit NK-1')
  })

  it('reads a short hex query as a number, not a hash fragment', () => {
    // Every fixture hash contains a "2"; only Exhibit 2 may answer to it.
    expect(filterRows(all, '2').map((r) => r.id)).toEqual(['cap-legacy'])
    expect(filterRows(all, HASH_A.slice(3, 8))).toEqual([])
    expect(filterRows(all, HASH_A.slice(3, 9)).map((r) => r.id)).toEqual(['cap-a'])
  })

  it('does not search the URL behind SOURCE, only the four fields (R21)', () => {
    // SOURCE's hover title carries cap-a's URL, so a search over the row's
    // URL would return it; the field is not searchable.
    expect(all.find((r) => r.id === 'cap-a')?.sourceDetail).toBe('https://example.com/page')
    expect(filterRows(all, 'example.com')).toEqual([])
    expect(filterRows(all, 'manual-upload')).toEqual([])
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

  // Twelve characters and no ellipsis before #1552, the superseded form.
  it('shortens a hash to 14 characters and an ellipsis, and leaves a short one whole', () => {
    expect(shortHash(HASH_A)).toBe('a1b2c3d4e5f607…')
    expect(shortHash(HASH_A.slice(0, 14))).toBe(HASH_A.slice(0, 14))
    expect(shortHash('abc')).toBe('abc')
    expect(shortHash('')).toBe('')
  })
})
