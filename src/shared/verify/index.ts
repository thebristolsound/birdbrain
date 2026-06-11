// Verify-core barrel (#122). Re-exports ONLY pure data-functions — leaf
// modules take strings/buffers/PEM, never paths, and touch no fs. The
// fs-reading package verifier (PR2's `evidencePackage.ts`) must stay OFF this
// barrel and be imported via its own subpath, so no renderer/browser bundle
// that wants `canonicalStringify` or `ManifestEntrySchema` ever pulls in `fs`.
// Forbidden anywhere under src/shared/verify/: electron, src/main,
// better-sqlite3, keytar, hono, network calls.
export { canonicalStringify } from './canonicalJson'
export { verifyEntrySignature } from './signature'
export {
  parseTimestampToken,
  extractTimestampTokenCertificatesPem,
  SHA256_OID,
  COMMON_NAME_OID
} from './timestampToken'
export type { ParsedTimestampToken } from './timestampToken'
export { verifyManifestChainText } from './manifestChain'
export type { ChainVerifyResult } from './manifestChain'
export { ManifestEntrySchema } from '@shared/schemas'
