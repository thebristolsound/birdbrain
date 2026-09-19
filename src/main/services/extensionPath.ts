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
 * Two questions, deliberately not one.
 *
 * Consistent: there is a copy Chrome can load — a manifest at the advertised
 * path, and a stamp beside it that can be read, which is what says the copy
 * was finished. This is what the IPC channels ask, so a copy from an earlier
 * version is still handed out: it is the folder Chrome already has loaded, and
 * #653's AC 2 is that the extension keeps working across restarts. Taking it
 * away over a version mismatch would break the capture path to enforce a
 * freshness the operator never asked for.
 *
 * Stale: the copy is not consistent, or its stamp names another app version.
 * This is what drives the sync attempt, and when a stale copy survives the
 * attempt the mismatch is logged (`app.extension_version_stale`) rather than
 * hidden.
 *
 * `existsSync` returns false rather than throwing on any error, so both are
 * total as long as `readStamp` is.
 */
function isCopyConsistent(): boolean {
  if (!existsSync(join(getExtensionPath(), MANIFEST_FILE))) return false
  return readStamp() !== null
}

function isCopyStale(): boolean {
  if (!isCopyConsistent()) return true
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
    // Housekeeping, not the job, and its own code at its own level: a sweep
    // that failed says nothing about whether the copy below succeeded, and an
    // operator reading the Log tab should not be told the folder is broken
    // because a stray directory could not be listed.
    logger.warn('app', 'app.extension_sweep_failed', undefined, err)
  }
}

// The retired directory holds the folder Chrome has loaded. When the new copy
// never reached the advertised path, put it back; when even that fails, say so
// and leave the bytes where they are. Nothing on the failure path deletes them
// — the next launch's sweep does, after that launch has made its own copy.
function restoreRetiredCopy(retired: string, target: string): void {
  try {
    if (!existsSync(retired) || existsSync(target)) return
    renameSync(retired, target)
  } catch (err) {
    logger.error('app', 'app.extension_sync_failed', undefined, err)
  }
}

// Whatever came of the attempt: a copy that Chrome can load but that this
// build did not write stays advertised on purpose, so this entry is where that
// state is visible. Guarded like every other read here — an unreadable profile
// has already been reported by the sync's own catch.
function reportStaleAdvertisedCopy(): void {
  try {
    if (isCopyConsistent() && isCopyStale()) {
      logger.error('app', 'app.extension_version_stale')
    }
  } catch {
    // Already reported.
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
  return isCopyConsistent()
}

/**
 * Refreshes the user-data copy from the bundled one when it is missing or
 * stale. A no-op in dev mode and when the copy already matches this version.
 *
 * Staged in a sibling temporary directory and renamed into place, the pattern
 * `restoreSnapshotFile` uses (`db/dbSnapshots.ts`): the rename is a
 * same-filesystem move, so the advertised path holds either the previous copy
 * or the whole new one, never a piece of one. The previous copy is moved aside
 * rather than deleted, its stamp is left alone until the new copy is in place,
 * and it is put back if the swap fails — so a failing step leaves the folder
 * Chrome already loaded present, stamped, and still advertised, and the
 * mismatch it now has with this build is logged instead.
 *
 * Never throws, and every filesystem call is inside the guarded region for
 * that reason: it runs in the `whenReady` chain, where anything thrown reaches
 * the startup catch and ends the launch. Only a copy that is missing or
 * unreadable costs the Open extension folder buttons (`EXT_NOT_FOUND`).
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
      // folder it loaded, so a removal here can fail; failing on this rename
      // instead leaves the previous copy and its stamp exactly as they were.
      retired = join(userDataPath(), `${RETIRED_PREFIX}${randomBytes(8).toString('hex')}`)
      renameSync(target, retired)
    }
    renameSync(staging, target)
    staging = null
    // Last, so the stamp only ever names a copy that is fully in place.
    writeFileSync(stampPath(), app.getVersion(), 'utf-8')
    // Here and nowhere else: until this line the retired copy is the only one
    // the operator has, and a failure before it puts that copy back.
    if (retired) removeQuietly(retired)
    retired = null
  } catch (err) {
    logger.error('app', 'app.extension_sync_failed', undefined, err)
    if (staging) removeQuietly(staging)
    if (retired) restoreRetiredCopy(retired, target)
  }

  reportStaleAdvertisedCopy()
}
