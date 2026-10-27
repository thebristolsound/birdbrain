import { createHash } from 'crypto'
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync
} from 'fs'
import { dirname, join } from 'path'
import { IMPORT_ID_MAPS_DIRECTORY, MANIFEST_FILENAME } from '@shared/constants'
import type { ManifestEntry } from '@shared/schemas'
import { CAPTURE_ENTRY_HASH_FIELDS, type CaptureEntryHashField } from '@shared/verify'
import {
  PENDING_DELETE_DIRECTORY,
  STAGING_SUBDIRECTORY,
  type CaptureArtifactType,
  type CaptureStore
} from '@main/services/captureStore'
import { LINEAGE_DIRECTORY, parseChainPath } from '../../../packages/evidence-package-layout/index'

// Acceptance of another member's Exhibit bytes (docs/specs/2026-09-19-
// collaborative-cases-design.md, "Case directory"): a received file is written
// to a temporary name beside its destination, hashed from disk, and renamed
// into place only when the hash is the one the entry it was fetched for
// anchors. A mismatch is unlinked and never becomes visible under the path,
// so a file this module wrote is one whose hash matched that entry when it
// arrived. A path two entries anchor with different hashes is fetched for
// the first of them (missingAnchoredFiles), and the other entry's hash is not
// compared here; verification of the file against that entry reports it.
//
// The path is the entry's, which a member signed, and a member's signature is
// not permission to write anywhere: a path is accepted only inside the Case's
// own directory, and never at a name the replica itself owns.

export const BLOB_PARTIAL_SUFFIX = '.sync-partial'

// Names in a Case directory that are the replica's own, never a peer's bytes.
export const RESERVED_CASE_FILES: ReadonlySet<string> = new Set([
  MANIFEST_FILENAME,
  'members.json',
  'sync-state.json',
  'sync-pauses.json'
])

// Directories under a Case whose contents never sync: the Staging Pool is
// local-only (decision 17), the pending-delete directory holds files on
// their way out, the lineage directory holds the chains of the Cases this
// one was forked from, which the archive import writes, and the id maps an
// archive import received, which only the import writes (#1017).
const UNSYNCED_SUBDIRECTORIES: ReadonlySet<string> = new Set([
  STAGING_SUBDIRECTORY,
  PENDING_DELETE_DIRECTORY,
  LINEAGE_DIRECTORY,
  IMPORT_ID_MAPS_DIRECTORY
])

export interface AnchoredFile {
  // Storage-root-relative, the form every entry and row records.
  path: string
  hash: string
}

export type BlobAcceptance =
  | { outcome: 'accepted'; bytes: number }
  | { outcome: 'hash-mismatch'; expected: string; actual: string }
  | { outcome: 'unsafe-path' }

// The absolute path a storage-root-relative path resolves to, when it lies
// inside the Case's directory and names nothing the replica owns; null
// otherwise. Shared by the dialer, which writes there, and the listener,
// which reads there.
export function safeCasePath(storageRoot: string, caseId: string, path: string): string | null {
  // Judged on the segments as written, before any normalization: a segment
  // that climbs, names the directory itself or is empty is refused, never
  // resolved away. Containment then holds by construction: the first segment
  // is this Case and nothing below it climbs.
  const segments = path.replace(/\\/g, '/').split('/')
  if (segments.length < 2 || segments[0] !== caseId) return null
  const inside = segments.slice(1)
  if (inside.some((segment) => segment === '' || segment === '.' || segment === '..')) return null
  // Compared lower-cased as well, so a case-insensitive filesystem cannot be
  // handed a reserved name or a chain file under another spelling.
  const relative = inside.join('/').toLowerCase()
  const name = inside[inside.length - 1].toLowerCase()
  if (inside.length === 1 && RESERVED_CASE_FILES.has(name)) return null
  // A member chain at the top level, or a lineage chain below it: the chain
  // reader walks both, so neither is ever a peer's bytes.
  if (parseChainPath(relative) !== null) return null
  if (UNSYNCED_SUBDIRECTORIES.has(inside[0].toLowerCase())) return null
  if (name.endsWith(BLOB_PARTIAL_SUFFIX)) return null
  return join(storageRoot, caseId, ...inside)
}

export interface AcceptBlobParams {
  storageRoot: string
  caseId: string
  path: string
  expectedHash: string
  bytes: Uint8Array
}

export function acceptBlob(params: AcceptBlobParams): BlobAcceptance {
  const { storageRoot, caseId, path, expectedHash, bytes } = params
  const abs = safeCasePath(storageRoot, caseId, path)
  if (abs === null) return { outcome: 'unsafe-path' }
  const partial = `${abs}${BLOB_PARTIAL_SUFFIX}`
  mkdirSync(dirname(abs), { recursive: true })
  // A partial left by a session that died mid-write is replaced, never
  // appended to.
  rmSync(partial, { force: true })
  const fd = openSync(partial, 'w')
  try {
    writeSync(fd, bytes)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }
  // Hashed from disk, so what is compared is what landed, not what was sent.
  const actual = createHash('sha256').update(readFileSync(partial)).digest('hex')
  if (actual !== expectedHash) {
    rmSync(partial, { force: true })
    return { outcome: 'hash-mismatch', expected: expectedHash, actual }
  }
  renameSync(partial, abs)
  return { outcome: 'accepted', bytes: bytes.length }
}

// The file each capture hash field anchors, by the Capture Store's names.
const CAPTURE_ARTIFACT_BY_FIELD: Record<CaptureEntryHashField, CaptureArtifactType> = {
  contentHash: 'mhtml',
  screenshotHash: 'png',
  textHash: 'txt',
  transactionRecordHash: 'warc.gz',
  pdfHash: 'pdf'
}

// Every file the accepted entries of one chain anchor (ruling 4 of
// 2026-10-13: the Capture hash fields, `exhibit.contentHash` and
// `derivation.outputHash`), minus the Exhibits their author later deleted.
// Entries before the chain's last `import` are a source Case's history, whose
// paths name that Case; they are not fetched.
export function anchoredFiles(
  entries: ManifestEntry[],
  caseId: string,
  store: CaptureStore
): AnchoredFile[] {
  const lastImport = entries.reduce((at, e) => (e.type === 'import' ? e.index : at), 0)
  const current = entries.filter((e) => e.index >= lastImport)
  const deleted = new Set(current.flatMap((e) => (e.type === 'deletion' ? [e.captureId] : [])))
  const files: AnchoredFile[] = []
  for (const entry of current) {
    if (entry.type === 'capture' && !deleted.has(entry.captureId)) {
      for (const field of CAPTURE_ENTRY_HASH_FIELDS) {
        const hash = entry[field]
        if (hash === undefined) continue
        const { rel } = store.artifactPaths(
          caseId,
          entry.captureId,
          CAPTURE_ARTIFACT_BY_FIELD[field]
        )
        files.push({ path: rel, hash })
      }
    } else if (entry.type === 'exhibit' && !deleted.has(entry.exhibitId)) {
      files.push({ path: entry.path, hash: entry.contentHash })
    } else if (entry.type === 'derivation' && !deleted.has(entry.parentExhibitId)) {
      files.push({ path: entry.outputPath, hash: entry.outputHash })
    }
  }
  return files
}

// The anchored files not yet on disk, one per path: when several entries
// anchor one path, the first in the order given is the one fetched and
// checked against, and the hash of any other is not compared. A file present
// under its path is not asked for, whichever entry anchored it.
export function missingAnchoredFiles(files: AnchoredFile[], storageRoot: string): AnchoredFile[] {
  const seen = new Set<string>()
  return files.filter(({ path }) => {
    if (seen.has(path)) return false
    seen.add(path)
    return !existsSync(join(storageRoot, path))
  })
}
