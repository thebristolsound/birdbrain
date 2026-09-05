// Verify-core barrel (#122). Re-exports ONLY pure data-functions — leaf
// modules take strings/buffers/PEM, never paths, and touch no fs. The
// fs-reading package verifier (PR2's `evidencePackage.ts`) must stay OFF this
// barrel and be imported via its own subpath, so no renderer/browser bundle
// that wants `canonicalStringify` or `ManifestEntrySchema` ever pulls in `fs`.
// Forbidden anywhere under src/shared/verify/: electron, src/main,
// better-sqlite3, keytar, hono, network calls.
export { canonicalStringify } from '@shared/verify/canonicalJson'
export { packageHash } from '@shared/verify/packageHash'
export type { PackagedArtifact } from '@shared/verify/packageHash'
export { verifyEntrySignature } from '@shared/verify/signature'
export {
  parseTimestampToken,
  extractTimestampTokenCertificatesPem,
  SHA256_OID,
  COMMON_NAME_OID
} from '@shared/verify/timestampToken'
export type { ParsedTimestampToken } from '@shared/verify/timestampToken'
export { verifyManifestChainText, describeUnsupportedEntry } from '@shared/verify/manifestChain'
export type {
  ChainVerifyResult,
  CaptureChainEntry,
  UnsupportedEntry
} from '@shared/verify/manifestChain'
export {
  resolveTrustedTimeFromEntries,
  buildTrustedTimeIndexFromEntries
} from '@shared/verify/trustedTime'
export type { TrustedTimeResult } from '@shared/verify/trustedTime'
export { ManifestEntrySchema } from '@shared/schemas'
