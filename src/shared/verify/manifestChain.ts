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
  // contentHash of each verified capture entry keyed by its manifest index.
  // Lets a caller confirm a specific capture is actually anchored in the chain
  // (a valid chain can be truncated), not merely that the chain verifies. Empty
  // when the chain is broken and for an empty manifest.
  captureHashesByIndex: Map<number, string>
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
  let expectedPrev = ''
  let expectedIndex = 0
  let sawSignedVersion = false
  const verifiedEntries: ManifestEntry[] = []
  const broken = (brokenAt: number, reason: string): ChainVerifyResult => ({
    valid: false,
    brokenAt,
    reason,
    trustedTimes: new Map(),
    captureHashesByIndex: new Map()
  })

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
    // `signature` (v2+) is computed over `entryHash` and, like `entryHash`
    // itself, is EXCLUDED from the canonical body. Destructure both out before
    // recomputing so a present-or-absent signature never affects the hash.
    //
    // LOAD-BEARING: hash recomputation must continue to exclude both
    // `entryHash` and `signature`. That exclusion is what keeps legacy v1
    // hashes stable and ensures the v2 signature does not change the canonical
    // bytes being hashed.
    const { entryHash, signature, ...body } = schemaResult.data
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
      !(signature && verifyEntrySignature(entryHash, signature, opts.publicKeyPem))
    ) {
      return broken(i, 'Invalid signature')
    }
    verifiedEntries.push(schemaResult.data)
    expectedPrev = entryHash
    expectedIndex++
  }
  // Integrity-verified. Resolve the per-capture trusted-time axis from the
  // verified entries (#161) — the single source of truth shared with the app.
  const captureHashesByIndex = new Map<number, string>()
  for (const entry of verifiedEntries) {
    if (entry.type === 'capture') captureHashesByIndex.set(entry.index, entry.contentHash)
  }
  return {
    valid: true,
    trustedTimes: buildTrustedTimeIndexFromEntries(verifiedEntries),
    captureHashesByIndex
  }
}
