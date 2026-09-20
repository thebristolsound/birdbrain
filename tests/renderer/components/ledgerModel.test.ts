import { describe, it, expect } from 'vitest'
import type { ManifestEntry } from '@shared/schemas'
import type { ManifestSnapshotEntry } from '@shared/manifestSnapshot'
import {
  describeSigner,
  entryNames,
  rowsNaming,
  summarizeVerdict,
  targetExhibitId,
  toLedgerRows
} from '@renderer/components/data/ledgerModel'

const chain = { index: 0, prevHash: '', schemaVersion: 3, entryHash: 'e'.repeat(64) }
const who = { operatorId: 'op', operatorName: 'Op', toolVersion: '1.0.0' }

function line(entry: ManifestEntry): ManifestSnapshotEntry {
  return { index: entry.index, parsed: true, entry }
}

const CAPTURE: ManifestEntry = {
  ...chain,
  ...who,
  type: 'capture',
  captureId: 'cap-a',
  caseId: 'case1',
  url: 'https://example.com/page',
  timestamp: '2026-09-01T10:00:00.000Z',
  contentHash: 'a'.repeat(64),
  sizeBytes: 10,
  schemaVersion: 2
}
const TIMESTAMP: ManifestEntry = {
  ...chain,
  ...who,
  type: 'timestamp',
  index: 1,
  caseId: 'case1',
  captureContentHash: 'a'.repeat(64),
  timestamp: '2026-09-01T10:05:00.000Z',
  tsaToken: 'dG9rZW4=',
  schemaVersion: 2
}
const EXHIBIT: ManifestEntry = {
  ...chain,
  ...who,
  type: 'exhibit',
  index: 2,
  exhibitId: 'att-1',
  caseId: 'case1',
  kind: 'attachment',
  origin: 'manual-upload',
  name: 'bundle.zip',
  exhibitNumber: 2,
  path: 'case1/attachments/att-1.zip',
  contentHash: 'b'.repeat(64),
  sizeBytes: 4,
  timestamp: '2026-09-02T10:00:00.000Z'
}
const DERIVATION: ManifestEntry = {
  ...chain,
  ...who,
  type: 'derivation',
  index: 3,
  caseId: 'case1',
  parentExhibitId: 'cap-a',
  parentContentHash: 'a'.repeat(64),
  derivation: 'thumbnail',
  derivationToolVersion: '1.0.0',
  outputHash: 'c'.repeat(64),
  outputPath: 'case1/cap-a_thumb.jpg',
  timestamp: '2026-09-02T11:00:00.000Z'
}
const RENUMBER: ManifestEntry = {
  ...chain,
  ...who,
  type: 'renumber',
  index: 4,
  caseId: 'case1',
  assignments: [{ exhibitId: 'cap-a', exhibitNumber: 1, manifestIndex: 0 }],
  timestamp: '2026-09-02T12:00:00.000Z'
}
const DELETION: ManifestEntry = {
  ...chain,
  ...who,
  type: 'deletion',
  index: 6,
  captureId: 'cap-gone',
  caseId: 'case1',
  timestamp: '2026-09-03T10:00:00.000Z',
  contentHash: 'd'.repeat(64),
  reason: 'pipeline-test',
  schemaVersion: 2
}
const EXPORT: ManifestEntry = {
  ...chain,
  ...who,
  type: 'export',
  index: 7,
  caseId: 'case1',
  timestamp: '2026-09-03T11:00:00.000Z',
  packageHash: '1'.repeat(64),
  verificationResult: {
    overallValid: true,
    captureCount: 2,
    verifiedCount: 2,
    tamperedCount: 0,
    missingCount: 0
  },
  scope: 'selection',
  captureIds: ['cap-a', 'cap-b'],
  exportClass: 'working-copy',
  schemaVersion: 2
}
const ARCHIVE_EXPORT: ManifestEntry = {
  ...chain,
  ...who,
  type: 'archive-export',
  index: 8,
  caseId: 'case1',
  timestamp: '2026-09-03T12:00:00.000Z',
  packageHash: '2'.repeat(64),
  schemaVersion: 2
}
const IMPORT: ManifestEntry = {
  ...chain,
  ...who,
  type: 'import',
  index: 9,
  caseId: 'case1',
  sourceCaseId: 'case-src',
  sourceInstallationId: 'inst-src',
  sourcePublicKeyPem: '-----BEGIN PUBLIC KEY-----',
  packageHash: '3'.repeat(64),
  idMapSha256: '4'.repeat(64),
  verificationResult: {
    overallValid: true,
    chainValid: true,
    artifactCount: 1,
    artifactFailureCount: 0,
    captureCount: 1,
    captureHashFailureCount: 0
  },
  timestamp: '2026-09-03T13:00:00.000Z',
  schemaVersion: 2
}
const UNREADABLE: ManifestSnapshotEntry = {
  index: 5,
  parsed: false,
  reason: 'Entry does not match the manifest schema'
}

describe('toLedgerRows', () => {
  it('renders every entry in sequence with a target in the operator’s terms', () => {
    const rows = toLedgerRows([
      line(CAPTURE),
      line(TIMESTAMP),
      line(EXHIBIT),
      line(DERIVATION),
      line(RENUMBER),
      UNREADABLE,
      line(DELETION),
      line(EXPORT),
      line(ARCHIVE_EXPORT),
      line(IMPORT)
    ])
    expect(rows.map((r) => [r.index, r.type, r.target])).toEqual([
      [0, 'capture', 'cap-a · https://example.com/page'],
      [1, 'timestamp', 'hash aaaaaaaaaaaa'],
      [2, 'exhibit', 'Exhibit 2 · bundle.zip'],
      [3, 'derivation', 'thumbnail of cap-a'],
      [4, 'renumber', '1 assignment'],
      [5, 'unreadable', 'Entry does not match the manifest schema'],
      [6, 'deletion', 'cap-gone · pipeline-test'],
      [7, 'export', 'package 111111111111 · 2 selected · working copy'],
      [8, 'archive-export', 'archive 222222222222'],
      [9, 'import', 'from case case-src']
    ])
    // The wording that flips per field: an unstamped timestamp, a case-scoped
    // evidence export.
    expect(toLedgerRows([line({ ...TIMESTAMP, tsaToken: undefined })])[0].target).toBe(
      'hash aaaaaaaaaaaa · no token'
    )
    expect(
      toLedgerRows([
        line({ ...EXPORT, scope: undefined, captureIds: undefined, exportClass: undefined })
      ])[0].target
    ).toBe('package 111111111111')
    expect(rows[0].schemaVersion).toBe(2)
    expect(rows[2].schemaVersion).toBe(3)
    expect(rows[5].parsed).toBe(false)
  })
})

describe('toLedgerRows — schema 4 (#1509)', () => {
  const shared = { ...chain, ...who, caseId: 'case1', schemaVersion: 4 }
  const MEMBER_ADD: ManifestEntry = {
    ...shared,
    type: 'member-add',
    index: 10,
    memberInstallationId: 'inst-b',
    memberPublicKeyPem: '-----BEGIN PUBLIC KEY-----\nB\n-----END PUBLIC KEY-----\n',
    memberCode: 'RM',
    memberOperatorName: 'Robin Member',
    nodeId: 'node-b',
    role: 'member',
    timestamp: '2026-09-19T12:00:00.000Z'
  }
  const MEMBER_REVOKE: ManifestEntry = {
    ...shared,
    type: 'member-revoke',
    index: 11,
    memberInstallationId: 'inst-b',
    timestamp: '2026-09-19T12:01:00.000Z'
  }
  const MERGE: ManifestEntry = {
    ...shared,
    type: 'merge',
    index: 12,
    heads: [{ installationId: 'inst-b', index: 4, entryHash: 'f'.repeat(64), entriesReceived: 2 }],
    timestamp: '2026-09-19T12:02:00.000Z'
  }
  const EXCLUDE: ManifestEntry = {
    ...shared,
    type: 'exclude',
    index: 13,
    exhibitId: 'att-1',
    authorInstallationId: 'inst-b',
    reason: 'duplicate',
    timestamp: '2026-09-19T12:03:00.000Z'
  }

  it('renders the Shared Case entries in the operator’s terms', () => {
    const rows = toLedgerRows([line(MEMBER_ADD), line(MEMBER_REVOKE), line(MERGE), line(EXCLUDE)])
    expect(rows.map((r) => [r.type, r.target])).toEqual([
      ['member-add', 'member RM · Robin Member'],
      ['member-revoke', 'member inst-b'],
      ['merge', '1 head'],
      ['exclude', 'att-1 · duplicate']
    ])
    expect(toLedgerRows([line({ ...EXCLUDE, reason: undefined })])[0].target).toBe('att-1')
    expect(
      toLedgerRows([line({ ...MERGE, heads: [...MERGE.heads, ...MERGE.heads] })])[0].target
    ).toBe('2 heads')
  })

  it('names an Exhibit by id on an exclude, and nothing on the membership entries', () => {
    const att = { id: 'att-1', contentHash: 'b'.repeat(64) }
    expect(entryNames(EXCLUDE, att)).toBe(true)
    expect(entryNames(EXCLUDE, { id: 'other', contentHash: 'b'.repeat(64) })).toBe(false)
    expect(entryNames(MEMBER_ADD, att)).toBe(false)
    expect(entryNames(MERGE, att)).toBe(false)
    expect(targetExhibitId(line(EXCLUDE), [])).toBe('att-1')
    expect(targetExhibitId(line(MEMBER_REVOKE), [])).toBeNull()
  })
})

describe('entryNames', () => {
  const capA = { id: 'cap-a', contentHash: 'a'.repeat(64) }

  it('matches by id, by hash on a timestamp, and by assignment on a renumber', () => {
    expect(entryNames(CAPTURE, capA)).toBe(true)
    expect(entryNames(TIMESTAMP, capA)).toBe(true)
    expect(entryNames(DERIVATION, capA)).toBe(true)
    expect(entryNames(RENUMBER, capA)).toBe(true)
    expect(entryNames(EXHIBIT, capA)).toBe(false)
    expect(entryNames(EXHIBIT, { id: 'att-1', contentHash: 'b'.repeat(64) })).toBe(true)
    // A Derived File is named by its own output hash on the derivation entry.
    expect(entryNames(DERIVATION, { id: 'thumb-a', contentHash: 'c'.repeat(64) })).toBe(true)
  })

  it('rowsNaming keeps only the naming entries, unreadable lines excluded', () => {
    const rows = rowsNaming(
      [line(CAPTURE), line(TIMESTAMP), line(EXHIBIT), line(DERIVATION), line(RENUMBER), UNREADABLE],
      capA
    )
    expect(rows.map((r) => r.index)).toEqual([0, 1, 3, 4])
  })
})

describe('summarizeVerdict', () => {
  it('reports intact through the head, and never claims it without a head', () => {
    expect(summarizeVerdict({ valid: true }, { index: 4, entryHash: 'x' })).toEqual({
      tone: 'intact',
      text: 'Chain intact through seq 4'
    })
    expect(summarizeVerdict({ valid: true }, null)).toEqual({
      tone: 'empty',
      text: 'No entries yet'
    })
  })

  it('reports a broken chain at its index with the reason', () => {
    expect(
      summarizeVerdict({ valid: false, brokenAt: 2, reason: 'Invalid signature' }, null)
    ).toEqual({ tone: 'broken', text: 'Chain broken at seq 2: Invalid signature' })
  })

  it('reports verifier too old as its own outcome, never as broken (X25)', () => {
    const verdict = summarizeVerdict(
      {
        valid: false,
        unsupported: {
          index: 3,
          entryType: 'hologram',
          schemaVersionSeen: 4,
          supportedSchemaVersion: 3
        }
      },
      { index: 3, entryHash: 'x' }
    )
    expect(verdict.tone).toBe('unsupported')
    expect(verdict.text).toContain('verifier too old')
    expect(verdict.text).toContain("'hologram'")
    expect(verdict.text).toContain('seq 3')
    expect(verdict.text).not.toMatch(/broken|tamper/i)
  })
})

describe('describeSigner', () => {
  it('names the range, the fingerprint and whose key it was', () => {
    expect(
      describeSigner({ fromIndex: 0, toIndex: 3, fingerprint: 'f'.repeat(64), source: 'embedded' })
    ).toBe('seq 0–3: ffffffffffff (embedded import key)')
    expect(describeSigner({ fromIndex: 4, toIndex: 5, fingerprint: null, source: 'local' })).toBe(
      'seq 4–5: unreadable key (this installation)'
    )
  })
})
