import { createHash } from 'crypto'
import { ManifestEntrySchema } from '@shared/schemas'
import type { TrustedTime } from '@shared/types'
import { canonicalStringify } from './canonicalJson'
import { verifyEntrySignature } from './signature'

export interface ChainVerifyResult {
  valid: boolean
  brokenAt?: number
  reason?: string
  trustedTime: TrustedTime
}

// Verifies a manifest hash chain from its JSONL text: recomputes each
// entryHash, checks linkage, and enforces v2+ signatures against the supplied
// public key. Pure verify-core — the caller reads the file (the app's
// `verifyManifestChain(caseDir)` wrapper, or the standalone package verifier)
// and supplies the PEM; no module-global key, no fs. Returns the zero-based
// index of the first broken entry if any.
export function verifyManifestChainText(
  jsonl: string,
  opts: { publicKeyPem: string }
): ChainVerifyResult {
  const lines = jsonl.split('\n').filter((l) => l.trim().length > 0)
  let expectedPrev = ''
  let expectedIndex = 0

  for (let i = 0; i < lines.length; i++) {
    let parsed: unknown
    try {
      parsed = JSON.parse(lines[i])
    } catch {
      return { valid: false, brokenAt: i, reason: 'Invalid JSON', trustedTime: 'none' }
    }
    const schemaResult = ManifestEntrySchema.safeParse(parsed)
    if (!schemaResult.success) {
      return { valid: false, brokenAt: i, reason: 'Invalid entry shape', trustedTime: 'none' }
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
      return { valid: false, brokenAt: i, reason: 'Index mismatch', trustedTime: 'none' }
    }
    if (body.prevHash !== expectedPrev) {
      return { valid: false, brokenAt: i, reason: 'Chain link broken', trustedTime: 'none' }
    }
    const recomputed = createHash('sha256').update(canonicalStringify(body)).digest('hex')
    if (recomputed !== entryHash) {
      return { valid: false, brokenAt: i, reason: 'Entry hash mismatch', trustedTime: 'none' }
    }
    // Signature enforcement (G2): v2+ entries must carry a cryptographically
    // valid signature over their entryHash. Legacy v1 entries are grandfathered
    // — they predate signing and present as integrity-verified without one.
    if (
      body.schemaVersion >= 2 &&
      !(signature && verifyEntrySignature(entryHash, signature, opts.publicKeyPem))
    ) {
      return { valid: false, brokenAt: i, reason: 'Invalid signature', trustedTime: 'none' }
    }
    expectedPrev = entryHash
    expectedIndex++
  }
  // Integrity-verified. Trusted-time resolution (rfc3161/pending) is #120; all
  // entries in this slice are grandfathered as 'none' — not a failure.
  return { valid: true, trustedTime: 'none' }
}
