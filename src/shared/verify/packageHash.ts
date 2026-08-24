import { createHash } from 'crypto'
import { canonicalStringify } from '@shared/verify/canonicalJson'

/** One packaged file's entry in the artifact index packageHash commits to. */
export interface PackagedArtifact {
  path: string
  sha256: string
  sizeBytes: number
}

// THE packageHash recipe — the single authoritative statement of it. Every
// producer (evidence export, case-archive export) and checker (archive
// inspect, the standalone package verifier) calls this function; do not
// restate the recipe elsewhere.
//
// packageHash commits to every packaged file's content via the artifact list:
// sort the artifacts by path (for determinism), then
// sha256(canonicalStringify(sortedArtifacts)). It deliberately does NOT hash
// the final zip: the hash feeds a signed manifest entry that ships inside that
// very zip, so hashing the zip would be circular. The package's own index file
// (evidence.json / package.json), which carries this hash, is likewise
// excluded from the artifact list.
//
// It lives under @shared/verify rather than beside the producers because the
// standalone verifier must recompute it to bind the artifact index to the
// signed export entry, and that binary may import only @shared/verify/** and
// @shared/schemas. It is pure: no fs, so it stays on the index.ts barrel.
export function packageHash(artifacts: PackagedArtifact[]): string {
  const sorted = [...artifacts].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return createHash('sha256')
    .update(Buffer.from(canonicalStringify(sorted), 'utf-8'))
    .digest('hex')
}
