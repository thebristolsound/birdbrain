import type { ManifestEntry } from '@shared/schemas'
import type { ExhibitCitationRule } from '@shared/exhibitCitation'

// The wire shape of `manifest:snapshot` (X36). Kept out of `types.ts` because
// it names `ManifestEntry`, and `schemas.ts` imports `types.ts` — putting it
// there would close an import cycle `lint:boundaries` rejects.

// One stretch of the chain verified under a single key. An imported Case is
// multi-signer: entries before each `import` boundary verify under the key that
// boundary embeds, and entries after the last boundary under the local key. A
// single fingerprint would describe such a chain wrongly, which is why this is
// a list and never one field.
export interface ManifestSignerSegment {
  // Inclusive 0-based entry range this key covers.
  fromIndex: number
  toIndex: number
  // SHA-256 of the key's DER SubjectPublicKeyInfo, lowercase hex. Null when the
  // key could not be parsed — reported rather than omitted, so a segment is
  // never silently attributed to a signer it does not describe.
  fingerprint: string | null
  // 'local' = this installation's signing key; 'embedded' = the key carried by
  // the `import` entry that closes the segment.
  source: 'local' | 'embedded'
}

// The chain verdict as the read path reports it. FOUR outcomes, not two:
// `unsupported` is set INSTEAD of `brokenAt` when the chain holds an entry from
// a newer schema, and a caller rendering a verdict must treat it as its own
// outcome — reporting it as tampering is the false accusation X25 forbids.
export interface ManifestChainVerdict {
  valid: boolean
  brokenAt?: number
  reason?: string
  unsupported?: {
    index: number
    entryType?: string
    schemaVersionSeen?: number
    supportedSchemaVersion: number
  }
}

// One manifest line: the parsed entry when it matches the schema-3 union, or
// its position and why it did not. An unparseable line is reported, never
// dropped — a snapshot that silently omits lines would let a reader count the
// entries and conclude the chain is shorter than the file.
export type ManifestSnapshotEntry =
  | { index: number; parsed: true; entry: ManifestEntry }
  | { index: number; parsed: false; reason: string }

// The renderer never computes chain state (X36): the verdict below is the only
// integrity claim in this payload, and it comes from `verifyManifestChain`.
export interface CaseManifestSnapshot {
  caseId: string
  entries: ManifestSnapshotEntry[]
  chain: ManifestChainVerdict
  signers: ManifestSignerSegment[]
  head: { index: number; entryHash: string } | null
  // How the ledger cites an `exhibit` entry, the rule every other app surface
  // cites by (#1510). A display rule read off the roster, not a chain claim.
  citationRule: ExhibitCitationRule
}
