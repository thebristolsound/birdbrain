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
import { basename, dirname, join, resolve, sep } from 'path'
import { MANIFEST_FILENAME } from '@shared/constants'
import type { ManifestEntry } from '@shared/schemas'
import { CAPTURE_ENTRY_HASH_FIELDS, type CaptureEntryHashField } from '@shared/verify'
import {
  PENDING_DELETE_DIRECTORY,
  STAGING_SUBDIRECTORY,
  type CaptureArtifactType,
  type CaptureStore
} from '@main/services/captureStore'
import { parseChainPath } from '../../../packages/evidence-package-layout/index'

// Acceptance of another member's Exhibit bytes (docs/specs/2026-09-19-
// collaborative-cases-design.md, "Case directory"): a received file is written
// to a temporary name beside its destination, hashed from disk, and renamed
// into place only when the hash is the one a verified entry anchors. A
// mismatch is unlinked and never becomes visible under the path, so a file
// at an anchored path is a file whose hash matched when it arrived.
//
// The path is the entry's, which a member signed, and a member's signature is
// not permission to write anywhere: a path is accepted only inside the Case's
// own directory, and never at a name the replica itself owns.

export const BLOB_PARTIAL_SUFFIX = '.sync-partial'

// Names in a Case directory that are the replica's own, never a peer's bytes.
export const RESERVED_CASE_FILES: ReadonlySet<string> = new Set([
  MANIFEST_FILENAME,
  'members.json',
  'sync-state.json'
])

// Directories under a Case whose contents never sync: the Staging Pool is
// local-only (decision 17) and the pending-delete directory holds files on
// their way out.
const UNSYNCED_SUBDIRECTORIES: ReadonlySet<string> = new Set([
  STAGING_SUBDIRECTORY,
  PENDING_DELETE_DIRECTORY
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
  const normalized = path.replace(/\\/g, '/')
  const caseDir = resolve(storageRoot, caseId)
  const abs = resolve(storageRoot, normalized)
  if (!abs.startsWith(caseDir + sep)) return null
  const inside = abs.slice(caseDir.length + 1).split(sep)
  if (inside.some((segment) => segment.length === 0 || segment === '.' || segment === '..')) {
    return null
  }
  const name = basename(abs)
  if (inside.length === 1 && (RESERVED_CASE_FILES.has(name) || parseChainPath(name))) return null
  if (UNSYNCED_SUBDIRECTORIES.has(inside[0])) return null
  if (name.endsWith(BLOB_PARTIAL_SUFFIX)) return null
  return abs
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
  textHash: 'txt'
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

// The anchored files not yet on disk, each once. A file present under its
// path arrived through `acceptBlob` or was committed here, so its hash was
// checked when it landed.
export function missingAnchoredFiles(files: AnchoredFile[], storageRoot: string): AnchoredFile[] {
  const seen = new Set<string>()
  return files.filter(({ path }) => {
    if (seen.has(path)) return false
    seen.add(path)
    return !existsSync(join(storageRoot, path))
  })
}
