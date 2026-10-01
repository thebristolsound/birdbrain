import type {
  ExhibitVerification,
  HashVerification,
  InventoryExhibitRow,
  InventoryRow
} from '@shared/types'
import { fileTypeOf, kindLabel, type DataNodeKey } from '@renderer/components/data/dataTreeModel'

// The artifact table as a pure function of the inventory and the selected
// node (#1149). Everything the table shows about a row is derived here, so the
// component renders values and never decides them.

export interface ArtifactRow {
  id: string
  entity: InventoryRow['entity']
  name: string
  // SOURCE, as the mock prints its capture id (#1552): the Exhibit a row
  // belongs to, cited by number, which for a Derived File is its parent's. A
  // pooled file belongs to no Exhibit, so it keeps its stated source host or
  // its origin.
  source: string
  // The hover title behind SOURCE: a Capture's URL, a Derived File's parent
  // name, a non-Capture Exhibit's origin, a pooled file's stated URL.
  sourceDetail: string
  // KIND as displayed: the Exhibit kind, `derivation` for a Derived File, and
  // the pooled file's detected kind with its not-anchored state carried
  // separately so the chip is never mistaken for a kind.
  kind: string
  sizeBytes: number | null
  hash: string
  // CAPTURED: the instant `capturedClock` names. Only `captured` is a capture
  // instant; every other clock is stated on the cell, never passed off as one.
  capturedAt: string
  capturedClock: CapturedClock
  // Whether the chain covers this row. False for every pooled row and for an
  // Exhibit or Derived File with no Manifest Entry (X41, X34).
  anchored: boolean
  staged: boolean
  exists: boolean
  exhibitNumber: number | null
  // The number as the app cites it (`NK-12` in a Shared Case, `12` otherwise);
  // resolved in the main process. Null wherever exhibitNumber is.
  citation: string | null
  path: string | null
  raw: InventoryRow
}

// Which clock the CAPTURED cell carries (#1552). `captured` is the Capture's
// own observation time, the value the Evidence Package writes as
// `capturedAt`; a Derived File of a Capture shows its parent's. An Exhibit of
// another kind has no capture instant, so it and its Derived Files show the
// commit time; a pooled file shows its arrival; a Derived File whose parent
// is not in the inventory shows its own creation time.
export type CapturedClock = 'captured' | 'committed' | 'arrived' | 'created'

export interface CaptureFacts {
  url?: string
  lastVerifiedStatus?: HashVerification['status']
  // `Capture.timestamp`: the capture time the capturing machine asserted.
  capturedAt?: string
}

// Per-Capture facts the inventory does not carry but the table wants: the URL
// behind SOURCE, the capture time for CAPTURED, and the persisted verify state
// for Integrity Exceptions. Keyed by capture id, which is the Exhibit id for a
// Capture.
export type CaptureFactsById = ReadonlyMap<string, CaptureFacts>

function hostOf(url: string | undefined): string {
  if (!url) return ''
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

// The acquisition instant of an Exhibit: its capture time when it is a
// Capture whose facts are loaded, and otherwise the commit time, named as such.
function exhibitInstant(
  row: InventoryExhibitRow,
  captures: CaptureFactsById
): { capturedAt: string; capturedClock: CapturedClock } {
  const capturedAt = row.kind === 'capture' ? captures.get(row.id)?.capturedAt : undefined
  return capturedAt
    ? { capturedAt, capturedClock: 'captured' }
    : { capturedAt: row.committedAt, capturedClock: 'committed' }
}

export function toArtifactRow(
  row: InventoryRow,
  rows: InventoryRow[],
  captures: CaptureFactsById
): ArtifactRow {
  const common = {
    id: row.id,
    entity: row.entity,
    name: row.name,
    hash: row.contentHash,
    sizeBytes: row.sizeBytes,
    exists: row.exists,
    path: row.path,
    raw: row
  }
  if (row.entity === 'exhibit') {
    const facts = captures.get(row.id)
    return {
      ...common,
      source: `Exhibit ${row.citation}`,
      sourceDetail: (row.kind === 'capture' && facts?.url) || row.origin,
      kind: row.kind,
      ...exhibitInstant(row, captures),
      anchored: row.anchored,
      staged: false,
      exhibitNumber: row.exhibitNumber,
      citation: row.citation
    }
  }
  if (row.entity === 'derived-file') {
    const parent = rows.find(
      (r): r is InventoryExhibitRow => r.entity === 'exhibit' && r.id === row.parentExhibitId
    )
    return {
      ...common,
      source: parent ? `Exhibit ${parent.citation}` : row.parentExhibitId,
      sourceDetail: parent?.name ?? row.parentExhibitId,
      kind: row.derivation,
      ...(parent
        ? exhibitInstant(parent, captures)
        : { capturedAt: row.createdAt, capturedClock: 'created' as const }),
      anchored: row.anchored,
      staged: false,
      exhibitNumber: null,
      citation: null
    }
  }
  return {
    ...common,
    source: row.sourceUrl ? hostOf(row.sourceUrl) : row.origin,
    sourceDetail: row.sourceUrl ?? row.origin,
    kind: row.kind,
    capturedAt: row.arrivedAt,
    capturedClock: 'arrived',
    anchored: false,
    staged: true,
    exhibitNumber: null,
    citation: null
  }
}

// Whether a Capture's persisted verify state is an exception (X37's middle
// bucket). `legacy` and undefined are unverified, not exceptions: a legacy
// Capture has no entry to verify against and an unverified one has not been
// looked at, and neither is a finding.
export function isIntegrityException(
  status: HashVerification['status'] | 'unsupported' | undefined
): boolean {
  return status === 'tampered' || status === 'missing' || status === 'chain-broken'
}

export type IntegrityBucket = 'verified' | 'exception' | 'unverified'

// What the table knows beyond the inventory: per-Capture facts, the verify
// results this session produced (`exhibits:verify`, keyed by Exhibit id), and
// which Captures each Selector matched (the Keyword Hits node, X39).
export interface RowContext {
  captures: CaptureFactsById
  verifications?: ReadonlyMap<string, ExhibitVerification>
  keywordMatches?: ReadonlyMap<string, ReadonlySet<string>>
}

function bucketOfStatus(status: ExhibitVerification['status'] | undefined): IntegrityBucket {
  if (status === 'verified') return 'verified'
  if (isIntegrityException(status)) return 'exception'
  // `legacy`, `unsupported` (verifier too old — X25, never an exception) and
  // "not looked at" all land here.
  return 'unverified'
}

// The X37 bucket for one anchored row. An Exhibit reads this session's verify
// result first and the Capture's persisted state otherwise; a session result
// carrying an Integrity Exception (X48) is an exception whatever its bytes
// did. A Derived File reads its own outcome from the parent's session result,
// which the main process computed against the `derivation` entry; without one
// it is unverified, and nothing is inferred from the parent in the renderer
// (X36). Pooled rows have no bucket (X16) and are never passed here.
export function bucketForRow(row: InventoryRow, context: RowContext): IntegrityBucket {
  if (row.entity === 'exhibit') {
    const session = context.verifications?.get(row.id)
    if (session?.exceptions?.length) return 'exception'
    if (session !== undefined) return bucketOfStatus(session.status)
    return bucketOfStatus(context.captures.get(row.id)?.lastVerifiedStatus)
  }
  if (row.entity === 'derived-file') {
    const parent = context.verifications?.get(row.parentExhibitId)
    const own = parent?.derived?.find((d) => d.derivedFileId === row.id)
    if (own) {
      if (own.status === 'verified') return 'verified'
      if (own.status === 'tampered' || own.status === 'missing') return 'exception'
      return 'unverified'
    }
    return 'unverified'
  }
  return 'unverified'
}

export function integrityCounts(
  rows: InventoryRow[],
  context: RowContext
): Record<IntegrityBucket, number> {
  const counts = { verified: 0, exception: 0, unverified: 0 }
  for (const row of rows) {
    if (row.rowType !== 'anchored') continue
    counts[bucketForRow(row, context)] += 1
  }
  return counts
}

// The rows a tree node selects. Pooled rows appear ONLY under Staging (X16):
// every other node reads the anchored list, so a consumer that forgets the
// discriminator still cannot show a pooled file beside evidence.
export function rowsForNode(
  rows: InventoryRow[],
  key: DataNodeKey,
  captures: CaptureFactsById,
  extras: Omit<RowContext, 'captures'> = {}
): InventoryRow[] {
  const context: RowContext = { captures, ...extras }
  const anchored = rows.filter((row) => row.rowType === 'anchored')
  if (key === 'staging') return rows.filter((row) => row.rowType === 'staged')
  if (key === 'data-sources' || key === 'views' || key === 'file-types' || key === 'results') {
    return anchored
  }
  if (key.startsWith('kind:')) {
    const kind = key.slice('kind:'.length)
    const ids = new Set(
      anchored.filter((row) => row.entity === 'exhibit' && row.kind === kind).map((r) => r.id)
    )
    return anchored.filter(
      (row) =>
        (row.entity === 'exhibit' && ids.has(row.id)) ||
        (row.entity === 'derived-file' && ids.has(row.parentExhibitId))
    )
  }
  if (key.startsWith('exhibit:')) {
    const id = key.slice('exhibit:'.length)
    return anchored.filter(
      (row) =>
        (row.entity === 'exhibit' && row.id === id) ||
        (row.entity === 'derived-file' && row.parentExhibitId === id)
    )
  }
  if (key.startsWith('derived:')) {
    const id = key.slice('derived:'.length)
    return anchored.filter((row) => row.entity === 'derived-file' && row.id === id)
  }
  if (key.startsWith('file-type:')) {
    const type = key.slice('file-type:'.length)
    return anchored.filter((row) => fileTypeOf(row) === type)
  }
  if (key === 'integrity-exceptions') {
    return anchored.filter((row) => bucketForRow(row, context) === 'exception')
  }
  if (key.startsWith('keyword:')) {
    // Matched Exhibits only, no snippet (X39): `selector_matches` stores no
    // offset, and nothing from pooled content can appear here (X15).
    const matched = context.keywordMatches?.get(key.slice('keyword:'.length))
    if (!matched) return []
    return anchored.filter((row) => row.entity === 'exhibit' && matched.has(row.id))
  }
  // keyword-hits, indicators, manifest-ledger: their content is #1150; until
  // then they select the anchored list so the table is never a stale subset.
  return anchored
}

// The shortest query that is read as a hash fragment. A hex string this short
// matches almost every digest by chance, and "2" must reach Exhibit 2, not
// every row whose hash contains a 2.
export const MIN_HASH_QUERY = 6

// Search filters by name, Exhibit, kind and hash only (R21, Q8) — never page
// text or a row's URL, which is why the shell's placeholder does not say
// "text". "Exhibit 7" and "7" both reach Exhibit 7; a hash matches by prefix
// or substring, case-insensitively, once the query is long enough to mean one.
export function filterRows(rows: ArtifactRow[], query: string): ArtifactRow[] {
  const q = query.trim().toLowerCase()
  if (!q) return rows
  const number = q.replace(/^exhibit\s+/, '')
  const hashLike = q.length >= MIN_HASH_QUERY && /^[0-9a-f]+$/.test(q)
  return rows.filter((row) => {
    if (row.name.toLowerCase().includes(q)) return true
    if (row.kind.toLowerCase().includes(q)) return true
    if (kindLabel(row.kind).toLowerCase().includes(q)) return true
    if (hashLike && row.hash.toLowerCase().includes(q)) return true
    if (row.exhibitNumber !== null && String(row.exhibitNumber) === number) return true
    if (row.citation !== null && row.citation.toLowerCase() === number) return true
    return false
  })
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`
}

// A fixed UTC rendering, `YYYY-MM-DD HH:MM`, so two operators reading the same
// Case see the same string; the full ISO value sits on the hover title.
export function formatStamp(iso: string): string {
  const ts = new Date(iso)
  if (Number.isNaN(ts.getTime())) return iso
  return ts.toISOString().slice(0, 16).replace('T', ' ')
}

// The strip header's breadcrumb, the mock's capture and group (#1552): the
// SOURCE citation, then whether the row is the Exhibit's own bytes, a Derived
// File, or a pooled file.
export function stripBreadcrumb({ source, entity }: ArtifactRow): string {
  const group = entity === 'exhibit' ? 'raw' : entity === 'derived-file' ? 'derived' : 'staging'
  return `${source} / ${group}`
}

// The hover title for CAPTURED: the full ISO value and the clock it is, so a
// non-capture clock is named in words and not only by the cell's qualifier.
export function capturedTitle({ capturedAt, capturedClock }: ArtifactRow): string {
  switch (capturedClock) {
    case 'captured':
      return `Captured ${capturedAt}`
    case 'committed':
      return `Committed ${capturedAt}; no capture time is shown for this file`
    case 'arrived':
      return `Arrived in the pool ${capturedAt}; not captured and not anchored`
    case 'created':
      return `Created ${capturedAt}; its parent Exhibit is not in this case's inventory`
  }
}

// The mock's truncated digest (#1552): 14 hex characters and an ellipsis, so
// a shortened hash reads as shortened. The full value sits on the hover title.
export const SHORT_HASH_LENGTH = 14

export function shortHash(hash: string): string {
  return hash.length > SHORT_HASH_LENGTH ? `${hash.slice(0, SHORT_HASH_LENGTH)}…` : hash
}
