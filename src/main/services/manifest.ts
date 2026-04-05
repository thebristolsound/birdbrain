import {
  existsSync,
  closeSync,
  openSync,
  statSync,
  readFileSync
} from 'fs'
import { join } from 'path'
import { MANIFEST_FILENAME } from '@shared/constants'

export interface ManifestHead {
  prevHash: string
  nextIndex: number
}

// Ensures the manifest file exists for a given case directory.
export function initManifest(caseDir: string): void {
  const path = join(caseDir, MANIFEST_FILENAME)
  if (!existsSync(path)) {
    const fd = openSync(path, 'a')
    closeSync(fd)
  }
}

// Reads the last line to determine prevHash + next index.
// O(N) on manifest size but only called once per append; manifests are small.
export function getManifestHead(caseDir: string): ManifestHead {
  const path = join(caseDir, MANIFEST_FILENAME)
  if (!existsSync(path) || statSync(path).size === 0) {
    return { prevHash: '', nextIndex: 0 }
  }
  const raw = readFileSync(path, 'utf-8')
  const lines = raw.split('\n').filter((l) => l.trim().length > 0)
  if (lines.length === 0) return { prevHash: '', nextIndex: 0 }
  const last = JSON.parse(lines[lines.length - 1]) as {
    index: number
    entryHash: string
  }
  return { prevHash: last.entryHash, nextIndex: last.index + 1 }
}
