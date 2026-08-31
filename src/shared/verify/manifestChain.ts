import { createHash } from 'crypto'
import { MANIFEST_SCHEMA_VERSION } from '@shared/constants'
import { ManifestEntrySchema, MANIFEST_ENTRY_TYPES } from '@shared/schemas'
import type { ManifestEntry } from '@shared/schemas'
import { canonicalStringify } from '@shared/verify/canonicalJson'
import { verifyEntrySignature } from '@shared/verify/signature'
import { buildTrustedTimeIndexFromEntries } from '@shared/verify/trustedTime'
import type { TrustedTimeResult } from '@shared/verify/trustedTime'

// The digests a verified `capture` entry carries, keyed by manifest index
// (#234). This is what a hash-verified claim rests on: `screenshotHash` /
// `textHash` are read from HERE, never from the `captures` DB mirror, which
// is a cache maintained for convenience and carries no chain integrity of its
// own (migrations.ts:369 — "the manifest remains the authority").
export interface CaptureChainEntry {
  contentHash: string
  screenshotHash?: string
  textHash?: string
}

// An entry this build cannot read because it comes from a newer schema: its
// `type` is one this build has never heard of, or its `schemaVersion` is above
// the highest this build supports (X25).
export interface UnsupportedEntry {
  // Line position of the entry, 0-based. NOT a `brokenAt`: nothing about the
  // chain is known to be broken here.
  index: number
  // The `type` string as written, when the entry carried one.
  entryType?: string
  // The `schemaVersion` as written, when the entry carried an integer one.
  schemaVersionSeen?: number
  supportedSchemaVersion: number
}

// The message a verifier prints for an unreadable-because-newer entry. Names
// the version seen AND the version supported, so a recipient holding a stale
// verifier can tell what they need without reading the chain themselves.
export function describeUnsupportedEntry(entry: UnsupportedEntry): string {
  const { entryType, schemaVersionSeen, supportedSchemaVersion, index } = entry
  const supported = `this verifier supports up to schema version ${supportedSchemaVersion}`
  const seen =
    schemaVersionSeen === undefined
      ? 'the entry states no schema version'
      : `the entry states schema version ${schemaVersionSeen}`
  const unknownType = entryType !== undefined && !MANIFEST_ENTRY_TYPES.has(entryType)
  return unknownType
    ? `Entry type '${entryType}' from a newer schema; verifier too old ` +
        `(at index ${index}; ${seen}, ${supported})`
    : `Entry from a newer schema; verifier too old (at index ${index}; ${seen}, ${supported})`
}

// Screens ONE raw manifest line for "this came from a newer writer" before the
// strict schema parse gets to call it malformed. `ManifestEntrySchema` is a
// strict discriminated union, so without this an unknown `type` — or a
// `schemaVersion` above the bound — fails the parse and the chain is reported
// as broken, which from a stale verifier in front of a recipient is a false
// accusation of tampering (X25).
//
// SECURITY: this changes only WHICH non-pass outcome is reported, never whether
// one is. A tamperer who writes `type: "anything"` to dodge a tamper verdict
// buys a "verifier too old" verdict instead: `valid` is false either way, no
// entry is reported as verified, and no capture is bound to any bytes.
function detectUnsupportedEntry(raw: unknown, index: number): UnsupportedEntry | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const { type, schemaVersion } = raw as { type?: unknown; schemaVersion?: unknown }
  const entryType = typeof type === 'string' ? type : undefined
  const schemaVersionSeen =
    typeof schemaVersion === 'number' && Number.isInteger(schemaVersion) ? schemaVersion : undefined
  const fromNewerSchema =
    (schemaVersionSeen !== undefined && schemaVersionSeen > MANIFEST_SCHEMA_VERSION) ||
    (entryType !== undefined && !MANIFEST_ENTRY_TYPES.has(entryType))
  return fromNewerSchema
    ? {
        index,
        ...(entryType !== undefined ? { entryType } : {}),
        ...(schemaVersionSeen !== undefined ? { schemaVersionSeen } : {}),
        supportedSchemaVersion: MANIFEST_SCHEMA_VERSION
      }
    : undefined
}

export interface ChainVerifyResult {
  valid: boolean
  brokenAt?: number
  reason?: string
  // Set INSTEAD of `brokenAt` when the chain holds an entry from a newer schema
  // (X25). `valid` is false — nothing here was verified — but the chain is not
  // reported as broken or tampered, because this verifier cannot read it well
  // enough to say either way. Callers rendering a verdict must treat this as a
  // fourth outcome, not as a failure.
  unsupported?: UnsupportedEntry
  // Per-capture trusted-time axis keyed by contentHash, resolved from the
  // verified entries (#161). Empty when the chain is broken — no entry past the
  // break is trustworthy — and for an empty manifest.
  trustedTimes: Map<string, TrustedTimeResult>
  // contentHash of each verified capture entry keyed by its manifest index.
  // Lets a caller confirm a specific capture is actually anchored in the chain
  // (a valid chain can be truncated), not merely that the chain verifies. Empty
  // when the chain is broken and for an empty manifest.
  captureHashesByIndex: Map<number, string>
  // Full capture-entry digests keyed by manifest index (#234) — the superset
  // of captureHashesByIndex a caller needs to bind sidecar artifacts (the
  // screenshot, the extracted-text) to the signed manifest instead of the DB
  // mirror. Empty under the same conditions as captureHashesByIndex.
  captureEntriesByIndex: Map<number, CaptureChainEntry>
}

// Verifies a manifest hash chain from its JSONL text: recomputes each
// entryHash, checks linkage, and enforces v2+ signatures against the supplied
// public key. Pure verify-core — the caller reads the file (the app's
// `verifyManifestChain(caseDir)` wrapper, or the standalone package verifier)
// and supplies the PEM; no module-global key, no fs.
/**
 * Verifies a manifest hash chain from JSONL text.
 *
 * Validates each entry's JSON structure, recomputes its hash for integrity, checks index continuity and chain linkage,
 * and enforces cryptographic signatures for v2+ entries.
 *
 * @param opts - Configuration with `publicKeyPem`, the PEM public key for verifying v2+ entry signatures
 * @returns An object with `valid` indicating overall chain validity. If invalid, includes `brokenAt` (0-based index of
 * the first failing entry) and `reason`. An entry from a newer schema sets `unsupported` INSTEAD of `brokenAt` — a
 * non-pass outcome that is not a tamper verdict. `trustedTimes` contains per-capture trusted-time data when valid,
 * empty when invalid.
 */
export function verifyManifestChainText(
  jsonl: string,
  opts: { publicKeyPem: string }
): ChainVerifyResult {
  const lines = jsonl.split('\n').filter((l) => l.trim().length > 0)
  const broken = (brokenAt: number, reason: string): ChainVerifyResult => ({
    valid: false,
    brokenAt,
    reason,
    trustedTimes: new Map(),
    captureHashesByIndex: new Map(),
    captureEntriesByIndex: new Map()
  })
  const tooOld = (unsupported: UnsupportedEntry): ChainVerifyResult => ({
    valid: false,
    reason: describeUnsupportedEntry(unsupported),
    unsupported,
    trustedTimes: new Map(),
    captureHashesByIndex: new Map(),
    captureEntriesByIndex: new Map()
  })

  // Pass 1: parse + schema-validate every line, collecting the parsed
  // entries. Also record each `import` entry's index and embedded
  // sourcePublicKeyPem — these are the segment boundaries multi-signer
  // chains switch verification keys at.
  const parsedEntries: ManifestEntry[] = []
  const boundaries: Array<{ index: number; pem: string }> = []
  for (let i = 0; i < lines.length; i++) {
    let parsed: unknown
    try {
      parsed = JSON.parse(lines[i])
    } catch {
      return broken(i, 'Invalid JSON')
    }
    // Screened BEFORE the strict parse: an entry from a newer schema must be
    // reported as such, never as a malformed shape (X25).
    const unsupported = detectUnsupportedEntry(parsed, i)
    if (unsupported) {
      return tooOld(unsupported)
    }
    const schemaResult = ManifestEntrySchema.safeParse(parsed)
    if (!schemaResult.success) {
      return broken(i, 'Invalid entry shape')
    }
    parsedEntries.push(schemaResult.data)
    if (schemaResult.data.type === 'import') {
      boundaries.push({ index: i, pem: schemaResult.data.sourcePublicKeyPem })
    }
  }

  // KEY RULE: an `import` entry's embedded key covers everything strictly
  // BEFORE it; the import entry itself is signed by the IMPORTING
  // installation, so it resolves like any other entry (next boundary or
  // local key). Entry i therefore verifies against the sourcePublicKeyPem of
  // the nearest import entry at index j > i, or opts.publicKeyPem if there is
  // none — which composes naturally across multi-hop imports (A→B→C).
  //
  // SECURITY NOTE: embedded pems come from not-yet-verified entries, but any
  // rewrite of a source segment + its import boundary breaks either the hash
  // linkage into the locally-signed tail or the tail's signatures — the local
  // key remains the trust anchor.
  const keyFor = (i: number): string => {
    const next = boundaries.find((b) => b.index > i)
    return next ? next.pem : opts.publicKeyPem
  }

  // Pass 2: existing per-entry loop (index, prevHash, recomputed hash,
  // signature) unchanged except the verifying key comes from keyFor(i).
  let expectedPrev = ''
  let expectedIndex = 0
  let sawSignedVersion = false
  const verifiedEntries: ManifestEntry[] = []
  for (let i = 0; i < parsedEntries.length; i++) {
    // `signature` (v2+) is computed over `entryHash` and, like `entryHash`
    // itself, is EXCLUDED from the canonical body. Destructure both out before
    // recomputing so a present-or-absent signature never affects the hash.
    //
    // LOAD-BEARING: hash recomputation must continue to exclude both
    // `entryHash` and `signature`. That exclusion is what keeps legacy v1
    // hashes stable and ensures the v2 signature does not change the canonical
    // bytes being hashed.
    const { entryHash, signature, ...body } = parsedEntries[i]
    if (body.index !== expectedIndex) {
      return broken(i, 'Index mismatch')
    }
    if (body.prevHash !== expectedPrev) {
      return broken(i, 'Chain link broken')
    }
    const recomputed = createHash('sha256').update(canonicalStringify(body)).digest('hex')
    if (recomputed !== entryHash) {
      return broken(i, 'Entry hash mismatch')
    }
    // Downgrade guard (#X-1): once the chain contains a signed (v2+) entry, no
    // later entry may drop back to an unsigned schema version. Without this an
    // attacker who can write the manifest could rewrite a v2 entry as v1 —
    // recomputing valid hash links needs no private key, and v1 entries are
    // signature-exempt — and the forged chain would re-verify as valid. A
    // legitimately-mixed chain only ever goes v1→v2 (never retro-signs legacy),
    // so v1-after-v2 is unambiguously tampering. All-v1 legacy chains, having no
    // signed entry, are unaffected.
    if (sawSignedVersion && body.schemaVersion < 2) {
      return broken(i, 'Schema version downgrade')
    }
    if (body.schemaVersion >= 2) sawSignedVersion = true
    // Signature enforcement (G2): v2+ entries must carry a cryptographically
    // valid signature over their entryHash. Legacy v1 entries are grandfathered
    // — they predate signing and present as integrity-verified without one.
    if (
      body.schemaVersion >= 2 &&
      !(signature && verifyEntrySignature(entryHash, signature, keyFor(i)))
    ) {
      return broken(i, 'Invalid signature')
    }
    verifiedEntries.push(parsedEntries[i])
    expectedPrev = entryHash
    expectedIndex++
  }
  // Integrity-verified. Resolve the per-capture trusted-time axis from the
  // verified entries (#161) — the single source of truth shared with the app.
  const captureHashesByIndex = new Map<number, string>()
  const captureEntriesByIndex = new Map<number, CaptureChainEntry>()
  for (const entry of verifiedEntries) {
    if (entry.type === 'capture') {
      captureHashesByIndex.set(entry.index, entry.contentHash)
      captureEntriesByIndex.set(entry.index, {
        contentHash: entry.contentHash,
        screenshotHash: entry.screenshotHash,
        textHash: entry.textHash
      })
    }
  }
  return {
    valid: true,
    trustedTimes: buildTrustedTimeIndexFromEntries(verifiedEntries),
    captureHashesByIndex,
    captureEntriesByIndex
  }
}
