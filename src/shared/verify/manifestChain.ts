import { createHash } from 'crypto'
import { ManifestEntrySchema } from '@shared/schemas'
import type { ManifestEntry } from '@shared/schemas'
import { canonicalStringify } from './canonicalJson'
import { verifyEntrySignature } from './signature'
import { buildTrustedTimeIndexFromEntries } from './trustedTime'
import type { TrustedTimeResult } from './trustedTime'

export interface ChainVerifyResult {
  valid: boolean
  brokenAt?: number
  reason?: string
  // Per-capture trusted-time axis keyed by contentHash, resolved from the
  // verified entries (#161). Empty when the chain is broken — no entry past the
  // break is trustworthy — and for an empty manifest.
  trustedTimes: Map<string, TrustedTimeResult>
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
 * the first failing entry) and `reason`. `trustedTimes` contains per-capture trusted-time data when valid, empty when invalid.
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
    trustedTimes: new Map()
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
  return { valid: true, trustedTimes: buildTrustedTimeIndexFromEntries(verifiedEntries) }
}
