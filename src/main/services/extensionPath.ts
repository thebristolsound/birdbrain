import { app } from 'electron'
import { join } from 'path'
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'fs'
import { randomBytes } from 'crypto'
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
const RETIRED_PREFIX = 'extension-retired-'

// The accessor src/main/index.ts uses: the E2E fixture and
// scripts/package-smoke.mjs both relocate user data through the env var, and
// app.getPath('userData') does not follow it.
function userDataPath(): string {
  return process.env.BIRDBRAIN_USER_DATA || app.getPath('userData')
}

function stampPath(): string {
  return join(userDataPath(), STAMP_FILE)
}

// Total by construction, and it has to stay that way: `extensionPathExists()`
// runs inside the `extension:path` IPC handler, which must answer
// `EXT_NOT_FOUND` rather than reject, and the startup sync must not end the
// launch. A stamp that is missing, a directory, or unreadable all mean the same
// thing — the copy cannot be shown to match this version.
function readStamp(): string | null {
  try {
    return readFileSync(stampPath(), 'utf-8').trim()
  } catch {
    return null
  }
}

/**
 * Stale means: no manifest at the advertised path, no readable stamp, or a
 * stamp naming another app version. The stamp is written only once the copy it
 * describes is in place, so a sync that died part-way reads as stale on the
 * next launch and is copied again rather than handed to Chrome.
 *
 * `existsSync` returns false rather than throwing on any error, so this is
 * total as long as `readStamp` is.
 */
function isCopyStale(): boolean {
  if (!existsSync(join(getExtensionPath(), MANIFEST_FILE))) return true
  return readStamp() !== app.getVersion()
}

function removeQuietly(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true })
  } catch {
    // Best effort. A leftover directory costs disk and nothing else, and its
    // removal failing must not replace the error that stopped the sync.
  }
}

// Staging and retired directories from a sync that was killed between creating
// one and clearing it: each is a full copy of the extension, and nothing else
// ever removes them, so a crash loop would accumulate them under user data.
function sweepLeftovers(): void {
  try {
    for (const name of readdirSync(userDataPath())) {
      if (name.startsWith(STAGING_PREFIX) || name.startsWith(RETIRED_PREFIX)) {
        removeQuietly(join(userDataPath(), name))
      }
    }
  } catch (err) {
    // Housekeeping, not the job: an unreadable user data directory is reported
    // and the sync still gets its own attempt at the copy.
    logger.error('app', 'app.extension_sync_failed', undefined, err)
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
 * or the whole new one, never a piece of one. The previous copy is moved aside
 * rather than deleted, and its stamp is left alone until the new copy is in
 * place, so a step that fails leaves the folder Chrome already loaded both
 * present and advertised.
 *
 * Never throws, and every filesystem call is inside the guarded region for
 * that reason: it runs in the `whenReady` chain, where anything thrown reaches
 * the startup catch and ends the launch. A copy that did not happen costs the
 * Open extension folder buttons (`EXT_NOT_FOUND`) and nothing else.
 */
export function syncPackagedExtension(): void {
  if (!app.isPackaged) return

  const source = join(process.resourcesPath, EXTENSION_DIR)
  const target = getExtensionPath()
  let staging: string | null = null
  let retired: string | null = null

  try {
    sweepLeftovers()
    if (!isCopyStale()) return
    if (!existsSync(join(source, MANIFEST_FILE))) {
      throw new Error(`No bundled extension at ${source}`)
    }
    staging = mkdtempSync(join(userDataPath(), STAGING_PREFIX))
    cpSync(source, staging, { recursive: true })
    if (existsSync(target)) {
      // Moved aside, not removed. On Windows Chrome holds handles into the
      // folder it loaded, so a removal here can fail — and failing after the
      // stamp was cleared would leave a loadable copy that the app reports as
      // EXT_NOT_FOUND. Failing on this rename instead leaves the previous copy
      // and its stamp exactly as they were.
      retired = join(userDataPath(), `${RETIRED_PREFIX}${randomBytes(8).toString('hex')}`)
      renameSync(target, retired)
    }
    renameSync(staging, target)
    staging = null
    // Last, so the stamp only ever names a copy that is fully in place.
    writeFileSync(stampPath(), app.getVersion(), 'utf-8')
  } catch (err) {
    logger.error('app', 'app.extension_sync_failed', undefined, err)
    if (staging) removeQuietly(staging)
  } finally {
    // The previous copy, once it is no longer the advertised one. Also on the
    // failure path: whatever went wrong, it is not reachable through
    // `getExtensionPath()` any more, and the next launch recopies.
    if (retired) removeQuietly(retired)
  }
}
