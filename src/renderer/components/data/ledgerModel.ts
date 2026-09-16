import type { ManifestEntry } from '@shared/schemas'
import type {
  CaseManifestSnapshot,
  ManifestChainVerdict,
  ManifestSignerSegment,
  ManifestSnapshotEntry
} from '@shared/manifestSnapshot'

// The Manifest Ledger as a pure function of `manifest:snapshot` (#1150, X36).
// Every integrity claim on the screen — the verdict, the signer fingerprints,
// "intact through seq N" — is read off the snapshot and never computed here.

export interface LedgerRow {
  index: number
  // The entry type as written, or `unreadable` for a line this build cannot
  // type: reported at its position, never dropped, so a reader counting rows
  // gets the file's length.
  type: string
  time: string
  // What the entry is about, in the terms the operator uses.
  target: string
  entryHash: string
  prevHash: string
  schemaVersion: number | null
  parsed: boolean
  reason?: string
}

function short(hash: string): string {
  return hash.length > 12 ? hash.slice(0, 12) : hash
}

function targetOf(entry: ManifestEntry): string {
  switch (entry.type) {
    case 'capture':
      return `${entry.captureId} · ${entry.url}`
    case 'deletion':
      return `${entry.captureId}${entry.reason ? ` · ${entry.reason}` : ''}`
    case 'timestamp':
      return `hash ${short(entry.captureContentHash)}${entry.tsaToken ? '' : ' · no token'}`
    case 'export':
      return `package ${short(entry.packageHash)}${entry.scope === 'selection' ? ` · ${entry.captureIds?.length ?? 0} selected` : ''}${entry.exportClass === 'working-copy' ? ' · working copy' : ''}`
    case 'archive-export':
      return `archive ${short(entry.packageHash)}`
    case 'import':
      return `from case ${entry.sourceCaseId}`
    case 'exhibit':
      return `Exhibit ${entry.exhibitNumber} · ${entry.name}`
    case 'derivation':
      return `${entry.derivation} of ${entry.parentExhibitId}`
    case 'renumber':
      return `${entry.assignments.length} assignment${entry.assignments.length === 1 ? '' : 's'}`
  }
}

export function toLedgerRows(entries: ManifestSnapshotEntry[]): LedgerRow[] {
  return entries.map((line) => {
    if (!line.parsed) {
      return {
        index: line.index,
        type: 'unreadable',
        time: '',
        target: line.reason,
        entryHash: '',
        prevHash: '',
        schemaVersion: null,
        parsed: false,
        reason: line.reason
      }
    }
    const { entry } = line
    return {
      index: line.index,
      type: entry.type,
      time: entry.timestamp,
      target: targetOf(entry),
      entryHash: entry.entryHash,
      prevHash: entry.prevHash,
      schemaVersion: entry.schemaVersion,
      parsed: true
    }
  })
}

// Whether a parsed entry names the Exhibit: by id on the entries that carry
// one, by Content Hash on a `timestamp` (which binds a hash, not an id), and
// by assignment on a `renumber`.
export function entryNames(
  entry: ManifestEntry,
  exhibit: { id: string; contentHash: string }
): boolean {
  switch (entry.type) {
    case 'capture':
    case 'deletion':
      return entry.captureId === exhibit.id
    case 'timestamp':
      return entry.captureContentHash === exhibit.contentHash
    case 'exhibit':
      return entry.exhibitId === exhibit.id
    case 'derivation':
      return entry.parentExhibitId === exhibit.id || entry.outputHash === exhibit.contentHash
    case 'renumber':
      return entry.assignments.some((a) => a.exhibitId === exhibit.id)
    default:
      return false
  }
}

export function rowsNaming(
  entries: ManifestSnapshotEntry[],
  exhibit: { id: string; contentHash: string }
): LedgerRow[] {
  const naming = entries.filter((line) => line.parsed && entryNames(line.entry, exhibit))
  return toLedgerRows(naming)
}

export type VerdictTone = 'intact' | 'broken' | 'unsupported' | 'empty'

export interface VerdictSummary {
  tone: VerdictTone
  text: string
}

// FOUR outcomes (X25): intact, broken, verifier too old, and an empty chain.
// "Chain intact through seq N" comes from the verdict and the head; it is
// never shown when the verdict does not say so.
export function summarizeVerdict(
  chain: ManifestChainVerdict,
  head: CaseManifestSnapshot['head']
): VerdictSummary {
  if (chain.unsupported) {
    // Worded from the verdict's own fields. verify-core's own describer sits
    // behind the renderer boundary the import-hygiene test guards.
    const { index, entryType, schemaVersionSeen, supportedSchemaVersion } = chain.unsupported
    const what = entryType ? `Entry type '${entryType}'` : 'Entry'
    const seen =
      schemaVersionSeen === undefined
        ? 'no schema version stated'
        : `schema version ${schemaVersionSeen}`
    return {
      tone: 'unsupported',
      text: `${what} from a newer schema at seq ${index}; verifier too old (${seen}, this build reads up to ${supportedSchemaVersion})`
    }
  }
  if (!chain.valid) {
    const where = chain.brokenAt !== undefined ? ` at seq ${chain.brokenAt}` : ''
    return { tone: 'broken', text: `Chain broken${where}: ${chain.reason ?? 'unknown reason'}` }
  }
  if (!head) return { tone: 'empty', text: 'No entries yet' }
  return { tone: 'intact', text: `Chain intact through seq ${head.index}` }
}

export function describeSigner(segment: ManifestSignerSegment): string {
  const who = segment.source === 'local' ? 'this installation' : 'embedded import key'
  const fp = segment.fingerprint ? short(segment.fingerprint) : 'unreadable key'
  return `seq ${segment.fromIndex}–${segment.toIndex}: ${fp} (${who})`
}
