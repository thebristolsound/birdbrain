import type {
  Capture,
  InventoryDerivedFileRow,
  InventoryExhibitRow,
  InventoryRow,
  InventoryStagedRow
} from '@shared/types'

// One Case as the Data screen sees it: an anchored Capture with a thumbnail, a
// legacy Capture with no entry and no file on disk, and a pooled upload.
// Shared by the model tests and the screen test so the two cannot disagree
// about what the fixture holds.

export const HASH_A = 'a1b2c3d4e5f60718293a4b5c6d7e8f9000112233445566778899aabbccddeeff'
export const HASH_LEGACY = 'ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100'
export const HASH_THUMB = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
export const HASH_STAGED = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'

export const CAPTURE_A: InventoryExhibitRow = {
  rowType: 'anchored',
  entity: 'exhibit',
  id: 'cap-a',
  caseId: 'case1',
  kind: 'capture',
  origin: 'extension',
  exhibitNumber: 1,
  name: 'Example page',
  contentHash: HASH_A,
  path: 'case1/cap-a.mhtml',
  sizeBytes: 2048,
  committedAt: '2026-09-01T10:00:00.000Z',
  manifestSeq: 0,
  anchored: true,
  exists: true
}

export const CAPTURE_LEGACY: InventoryExhibitRow = {
  rowType: 'anchored',
  entity: 'exhibit',
  id: 'cap-legacy',
  caseId: 'case1',
  kind: 'capture',
  origin: 'extension',
  exhibitNumber: 2,
  name: 'Old page',
  contentHash: HASH_LEGACY,
  path: 'case1/cap-legacy.html',
  sizeBytes: null,
  committedAt: '2026-01-01T00:00:00.000Z',
  manifestSeq: null,
  anchored: false,
  exists: false
}

export const THUMB_A: InventoryDerivedFileRow = {
  rowType: 'anchored',
  entity: 'derived-file',
  id: 'thumb-a',
  caseId: 'case1',
  parentExhibitId: 'cap-a',
  derivation: 'thumbnail',
  toolVersion: '1.0.0',
  name: 'thumbnail',
  contentHash: HASH_THUMB,
  path: 'case1/cap-a_thumb.jpg',
  sizeBytes: null,
  createdAt: '2026-09-01T10:00:05.000Z',
  manifestSeq: 1,
  anchored: true,
  exists: true
}

export const STAGED_PDF: InventoryStagedRow = {
  rowType: 'staged',
  entity: 'staged-file',
  id: 'staged-1',
  caseId: 'case1',
  kind: 'document',
  origin: 'manual-upload',
  name: 'report.pdf',
  contentHash: HASH_STAGED,
  path: 'case1/staging/staged-1.pdf',
  sizeBytes: 4096,
  arrivedAt: '2026-09-10T12:00:00.000Z',
  sourceUrl: null,
  exists: true
}

export const INVENTORY: InventoryRow[] = [CAPTURE_A, CAPTURE_LEGACY, THUMB_A, STAGED_PDF]

function capture(overrides: Partial<Capture> & Pick<Capture, 'id'>): Capture {
  return {
    caseId: 'case1',
    url: 'https://example.com/page',
    title: 'Example page',
    hash: HASH_A,
    timestamp: '2026-09-01T10:00:00.000Z',
    createdAt: '2026-09-01T10:00:00.000Z',
    format: 'mhtml',
    method: 'extension',
    ...overrides
  }
}

export const CAPTURES: Capture[] = [
  capture({
    id: 'cap-a',
    toolVersion: '1.4.2',
    extensionVersion: '1.4.0',
    browserVersion: 'Chrome 140',
    userAgent: 'Mozilla/5.0 test',
    lastVerifiedStatus: 'tampered'
  }),
  capture({
    id: 'cap-legacy',
    url: 'https://old.example.org/',
    title: 'Old page',
    hash: HASH_LEGACY,
    format: 'html',
    lastVerifiedStatus: 'legacy'
  })
]
