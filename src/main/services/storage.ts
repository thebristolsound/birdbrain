import { existsSync, mkdirSync, readdirSync, statSync } from 'fs'
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
