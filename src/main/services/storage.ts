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

export function getCaseStorageSize(caseId: string): number {
  const dir = join(getStorageRoot(), caseId)
  if (!existsSync(dir)) return 0

  let totalSize = 0
  const files = readdirSync(dir)
  for (const file of files) {
    const stat = statSync(join(dir, file))
    totalSize += stat.size
  }
  return totalSize
}
