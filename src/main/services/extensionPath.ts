import { app } from 'electron'
import { join } from 'path'
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'fs'
import { logger } from '@main/services/logger'

/**
 * Where Chrome's Load unpacked is pointed at the bundled extension.
 *
 * A packaged build does NOT advertise `process.resourcesPath`: the AppImage
 * mounts its squashfs at a fresh `/tmp/.mount_XXXXXX` on every launch and
 * unmounts it on exit, and Chrome stores the absolute path a folder was loaded
 * from — so an extension loaded out of the mount works exactly once (#653).
 * The shipped directory is copied under user data at startup and the copy is
 * what the IPC channels hand out. On every platform rather than on Linux
 * alone, so a single code path is exercised by every install format.
 */

const EXTENSION_DIR = 'extension'
const MANIFEST_FILE = 'manifest.json'
const STAMP_FILE = 'extension-version'
const STAGING_PREFIX = 'extension-staging-'

// The accessor src/main/index.ts uses: the E2E fixture and
// scripts/package-smoke.mjs both relocate user data through the env var, and
// app.getPath('userData') does not follow it.
function userDataPath(): string {
  return process.env.BIRDBRAIN_USER_DATA || app.getPath('userData')
}

function stampPath(): string {
  return join(userDataPath(), STAMP_FILE)
}

function readStamp(): string | null {
  const path = stampPath()
  if (!existsSync(path)) return null
  return readFileSync(path, 'utf-8').trim()
}

/**
 * Stale means: no manifest at the advertised path, no stamp, or a stamp from
 * another app version. The stamp is removed before the directory it describes
 * is replaced and written after, so a sync that died part-way reads as stale
 * on the next launch and is copied again rather than handed to Chrome.
 */
function isCopyStale(): boolean {
  if (!existsSync(join(getExtensionPath(), MANIFEST_FILE))) return true
  return readStamp() !== app.getVersion()
}

function removeQuietly(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true })
  } catch {
    // Best effort. A staging directory left behind costs disk and nothing
    // else, and its removal failing must not replace the error that stopped
    // the sync.
  }
}

export function getExtensionPath(): string {
  if (app.isPackaged) {
    return join(userDataPath(), EXTENSION_DIR)
  }
  // In dev mode, process.cwd() is the project root
  return join(process.cwd(), 'extension', 'dist')
}

export function extensionPathExists(): boolean {
  if (!app.isPackaged) return existsSync(getExtensionPath())
  return !isCopyStale()
}

/**
 * Refreshes the user-data copy from the bundled one when it is missing or
 * stale. A no-op in dev mode and when the copy already matches this version.
 *
 * Staged in a sibling temporary directory and renamed into place, the pattern
 * `restoreSnapshotFile` uses (`db/dbSnapshots.ts`): the rename is a
 * same-filesystem move, so the advertised path holds either the previous copy
 * or the whole new one, never a piece of one. Never throws — it runs inside
 * the `whenReady` chain, where anything thrown ends the launch, and a copy
 * that did not happen costs the Open extension folder buttons
 * (`EXT_NOT_FOUND`) and nothing else.
 */
export function syncPackagedExtension(): void {
  if (!app.isPackaged) return
  if (!isCopyStale()) return

  const source = join(process.resourcesPath, EXTENSION_DIR)
  const target = getExtensionPath()
  let staging: string | null = null

  try {
    if (!existsSync(join(source, MANIFEST_FILE))) {
      throw new Error(`No bundled extension at ${source}`)
    }
    staging = mkdtempSync(join(userDataPath(), STAGING_PREFIX))
    cpSync(source, staging, { recursive: true })
    rmSync(stampPath(), { force: true })
    rmSync(target, { recursive: true, force: true })
    renameSync(staging, target)
    staging = null
    // Last, so the stamp only ever matches a complete copy.
    writeFileSync(stampPath(), app.getVersion(), 'utf-8')
  } catch (err) {
    logger.error('app', 'app.extension_sync_failed', undefined, err)
    if (staging) removeQuietly(staging)
  }
}
