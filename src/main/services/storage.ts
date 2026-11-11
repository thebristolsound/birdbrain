import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'

// Owns the storage-root singleton and case-level directory concerns only.
// Everything that knows capture artifact filenames lives in captureStore.ts.

let storageRoot: string

export function initStorage(root: string): void {
  storageRoot = root
  if (!existsSync(root)) {
    mkdirSync(root, { recursive: true })
  }
}

// The marker `confirmStorageRoot` keeps in the storage root, and the record of
// it kept in the user-data folder.
const STORAGE_ROOT_MARKER = '.birdbrain-storage-root.json'
export const STORAGE_ROOT_RECORD = 'storage-root.json'

export interface StorageRootContinuity {
  // The start of the unbroken run of launches that each found, in the root in
  // use, the marker the launch before wrote. Null when this launch could not
  // write the marker or the record.
  since: string | null
  // Whether this launch found that marker. False starts a new run now.
  continued: boolean
}

function readJsonObject(path: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'))
    return typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/**
 * Checks that the storage root in use is the directory the previous launch
 * used, and writes a new marker for the next launch to check.
 *
 * Each launch writes a fresh random value to a marker in the root and to a
 * record at `recordPath`, outside it. A launch that finds the two equal is on
 * the directory the last marker was written to, and `since` is carried
 * forward. A missing, unreadable or different marker starts a new run with
 * `since` set to now. That is every root the last marker was not written to:
 * an empty folder where a drive mounts, a default root boot fell back to, a
 * folder the storage path was changed to, and a copy of the root from before
 * the last marker was written.
 *
 * Two states are not told apart. A copy of the root taken after the last
 * marker was written carries that marker. A launch by a build without this
 * function leaves both files as they were.
 */
export function confirmStorageRoot(recordPath: string): StorageRootContinuity {
  const markerPath = join(getStorageRoot(), STORAGE_ROOT_MARKER)
  const record = readJsonObject(recordPath)
  const marker = readJsonObject(markerPath)
  const recorded =
    typeof record?.nonce === 'string' && record.nonce === marker?.nonce ? record.since : undefined
  const continued = typeof recorded === 'string'
  const since = continued ? recorded : new Date().toISOString()
  const nonce = randomUUID()
  try {
    writeFileSync(recordPath, JSON.stringify({ nonce, since }), 'utf-8')
    writeFileSync(markerPath, JSON.stringify({ nonce }), 'utf-8')
  } catch {
    return { since: null, continued }
  }
  return { since, continued }
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
