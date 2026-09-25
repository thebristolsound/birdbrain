import type { ManifestEntry } from '@shared/schemas'
import { citeLocalExhibit, type ExhibitCitationRule } from '@shared/exhibitCitation'
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

// A sequence number as the mock prints it everywhere on the screen, the Seq
// column and the verdict chip alike (#1552): four digits, zero-padded.
export function formatSeq(index: number): string {
  return String(index).padStart(4, '0')
}

function short(hash: string): string {
  return hash.length > 12 ? hash.slice(0, 12) : hash
}

function targetOf(entry: ManifestEntry, rule: ExhibitCitationRule): string {
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
      // The number as written, cited the way every other surface cites it: an
      // entry from before the Case was shared records no Member Code and is
      // the chain writer's, so the roster supplies it.
      return `Exhibit ${citeLocalExhibit(entry, rule)} · ${entry.name}`
    case 'derivation':
      return `${entry.derivation} of ${entry.parentExhibitId}`
    case 'renumber':
      return `${entry.assignments.length} assignment${entry.assignments.length === 1 ? '' : 's'}`
    case 'member-add':
      return `${entry.role} ${entry.memberCode} · ${entry.memberOperatorName}`
    case 'member-revoke':
      return `member ${entry.memberInstallationId}`
    case 'merge':
      return `${entry.heads.length} head${entry.heads.length === 1 ? '' : 's'}`
    case 'exclude':
      return `${entry.exhibitId}${entry.reason ? ` · ${entry.reason}` : ''}`
  }
}

export function toLedgerRows(
  entries: ManifestSnapshotEntry[],
  rule: ExhibitCitationRule
): LedgerRow[] {
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
      target: targetOf(entry, rule),
      entryHash: entry.entryHash,
      prevHash: entry.prevHash,
      schemaVersion: entry.schemaVersion,
      parsed: true
    }
  })
}

// Whether a parsed entry names the Exhibit: by id on the entries that carry
// one (an `exclude` included), by Content Hash on a `timestamp` (which binds a
// hash, not an id), and by assignment on a `renumber`.
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
    case 'exclude':
      return entry.exhibitId === exhibit.id
    case 'derivation':
      return entry.parentExhibitId === exhibit.id || entry.outputHash === exhibit.contentHash
    case 'renumber':
      return entry.assignments.some((a) => a.exhibitId === exhibit.id)
    default:
      return false
  }
}

// The Exhibit a ledger entry points the screen at (#1151 Show target): the
// id the entry carries, or for a `timestamp` the anchored row whose hash it
// binds. Null for entries about the Case as a whole (export, import,
// renumber) and for unreadable lines.
export function targetExhibitId(
  line: ManifestSnapshotEntry,
  rows: ReadonlyArray<{ id: string; contentHash: string; entity: string }>
): string | null {
  if (!line.parsed) return null
  const { entry } = line
  switch (entry.type) {
    case 'capture':
    case 'deletion':
      return entry.captureId
    case 'exhibit':
    case 'exclude':
      return entry.exhibitId
    case 'derivation':
      return (
        rows.find((r) => r.entity === 'derived-file' && r.contentHash === entry.outputHash)?.id ??
        entry.parentExhibitId
      )
    case 'timestamp':
      return rows.find((r) => r.contentHash === entry.captureContentHash)?.id ?? null
    default:
      return null
  }
}

export function rowsNaming(
  entries: ManifestSnapshotEntry[],
  exhibit: { id: string; contentHash: string },
  rule: ExhibitCitationRule
): LedgerRow[] {
  const naming = entries.filter((line) => line.parsed && entryNames(line.entry, exhibit))
  return toLedgerRows(naming, rule)
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
      text: `${what} from a newer schema at seq ${formatSeq(index)}; verifier too old (${seen}, this build reads up to ${supportedSchemaVersion})`
    }
  }
  if (!chain.valid) {
    const where = chain.brokenAt !== undefined ? ` at seq ${formatSeq(chain.brokenAt)}` : ''
    return { tone: 'broken', text: `Chain broken${where}: ${chain.reason ?? 'unknown reason'}` }
  }
  if (!head) return { tone: 'empty', text: 'No entries yet' }
  return { tone: 'intact', text: `Chain intact through seq ${formatSeq(head.index)}` }
}

export function describeSigner(segment: ManifestSignerSegment): string {
  const who = segment.source === 'local' ? 'this installation' : 'embedded import key'
  const fp = segment.fingerprint ? short(segment.fingerprint) : 'unreadable key'
  return `seq ${segment.fromIndex}–${segment.toIndex}: ${fp} (${who})`
}
