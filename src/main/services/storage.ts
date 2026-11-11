import { randomBytes } from 'crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'

// Owns the storage-root singleton and case-level directory concerns only.
// Everything that knows capture artifact filenames lives in captureStore.ts.

let storageRoot: string

// The mark this launch wrote to the storage root, or null when it wrote none.
let launchMark: string | null = null

export function initStorage(root: string): void {
  storageRoot = root
  launchMark = null
  if (!existsSync(root)) {
    mkdirSync(root, { recursive: true })
  }
}

// One file at the top of the storage root, holding a random value that
// `renewStorageRootMark` replaces at every launch. A directory that holds a
// given value is the one that launch ran on, or a copy of it made later.
const STORAGE_ROOT_MARKER = '.birdbrain-storage-root.json'
const MARK = /^[0-9a-f]{16}$/

// The mark the storage root in use holds, or null when it holds none that can
// be read: no file, an unreadable file, or contents that are not a mark.
export function readStorageRootMark(): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(join(getStorageRoot(), STORAGE_ROOT_MARKER), 'utf-8'))
  } catch {
    return null
  }
  const mark =
    typeof parsed === 'object' && parsed !== null && 'mark' in parsed ? parsed.mark : null
  return typeof mark === 'string' && MARK.test(mark) ? mark : null
}

// Writes a new mark to the storage root in use. A failed write leaves this
// launch with no mark, whatever the root still holds.
export function renewStorageRootMark(): void {
  const mark = randomBytes(8).toString('hex')
  try {
    writeFileSync(join(getStorageRoot(), STORAGE_ROOT_MARKER), JSON.stringify({ mark }), 'utf-8')
    launchMark = mark
  } catch {
    launchMark = null
  }
}

// The mark this launch wrote, as long as the root in use still holds it. Null
// when this launch wrote none, and when the root has changed under the path
// since, as when a drive is unmounted mid-session.
export function storageRootMarkOfThisLaunch(): string | null {
  return launchMark !== null && readStorageRootMark() === launchMark ? launchMark : null
}

export function getStorageRoot(): string {
  if (!storageRoot) throw new Error('Storage not initialized')
  return storageRoot
}

export function ensureCaseDir(caseId: string): string {
  const dir = join(getStorageRoot(), caseId)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

// Every byte the Case directory holds, subdirectories included. The recursion
// is what makes the per-kind Exhibit directories and the Staging Pool count
// (ADR-0023 X4, ADR-0024): a flat scan reported a Case with pooled or
// non-Capture bytes as smaller than it is, and a storage figure that omits
// files the operator can see is worse than none.
export function getCaseStorageSize(caseId: string): number {
  return directorySize(join(getStorageRoot(), caseId))
}

function directorySize(dir: string): number {
  if (!existsSync(dir)) return 0

  let totalSize = 0
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    totalSize += entry.isDirectory() ? directorySize(path) : statSync(path).size
  }
  return totalSize
}
