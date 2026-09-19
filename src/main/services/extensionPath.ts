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
// runs inside the extension IPC handlers (`ipcHandlers.ts`), which answer
// `EXT_NOT_FOUND` rather than reject, and the startup sync must not end the
// launch. A stamp that is missing, a directory, or unreadable all mean the same
// thing here: the copy cannot be shown to be a finished one.
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
 * Consistent: a manifest at the advertised path and a stamp beside it that can
 * be read, the stamp being written last and so standing for a finished copy.
 * This is the question the IPC handlers ask, which is the ruling on #653's
 * AC 2: a copy carrying an earlier version's stamp is still handed out
 * (`advertises a consistent copy left by an earlier version`).
 *
 * Stale: the copy is not consistent, or its stamp is not this version's. This
 * is what drives the sync attempt. A consistent copy whose stamp differs from
 * this version is advertised and logged as `app.extension_version_stale`
 * (test: `advertises the new copy under the previous stamp when only the stamp
 * write fails`). An inconsistent copy (manifest missing or stamp unreadable) is
 * not advertised, and the failure that left it is logged as
 * `app.extension_sync_failed` (tests: `returns and logs when the stamp is a
 * directory`, `returns and logs when the stamp cannot be read`).
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

// Directories an earlier sync left behind: a staging copy from a launch killed
// mid-copy, or a copy retired by a launch that then failed to finish. Each is a
// full copy of the extension and no other path clears those, so they would
// accumulate under user data. Called only where a copy matching this version is
// at the advertised path — never before an attempt, or two failing launches in
// a row would take the retired bytes with them.
function sweepLeftovers(): void {
  try {
    for (const name of readdirSync(userDataPath())) {
      if (name.startsWith(STAGING_PREFIX) || name.startsWith(RETIRED_PREFIX)) {
        removeQuietly(join(userDataPath(), name))
      }
    }
  } catch (err) {
    // Housekeeping, not the job: by here the copy is in place, so this failure
    // gets its own code at its own level rather than the copy's
    // (`warns and still copies when the sweep cannot read the user data
    // directory`).
    logger.warn('app', 'app.extension_sweep_failed', undefined, err)
  }
}

// The retired directory holds the folder Chrome has loaded. When the new copy
// never reached the advertised path, put it back; when even that fails, say so
// and leave the bytes where they are. It declines when the advertised path is
// not empty — a stamp write that failed after the swap leaves the new copy
// there, and overwriting it with the old one would undo a copy that worked.
// Nothing on the failure path deletes retired bytes, and no later launch does
// until one of them has a copy matching this version, whether it made that copy
// or inherited it.
function restoreRetiredCopy(retired: string, target: string): void {
  try {
    if (!existsSync(retired) || existsSync(target)) return
    renameSync(retired, target)
  } catch (err) {
    logger.error('app', 'app.extension_sync_failed', undefined, err)
  }
}

// Whatever came of the attempt: a copy Chrome can load whose stamp is not this
// version's stays advertised on purpose, so this entry is where that state is
// visible. Guarded like every other read here — an unreadable profile has
// already been reported by the sync's own catch.
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
 * stale. Does nothing in dev mode; when the copy already matches this version
 * it only clears leftovers.
 *
 * Staged in a sibling temporary directory and renamed into place, the pattern
 * `restoreSnapshotFile` uses (`db/dbSnapshots.ts`): the rename is a
 * same-filesystem move. The previous copy is moved aside rather than deleted
 * and its stamp is left alone until the new copy is in place. It never throws,
 * which is why every filesystem call is inside a guard: it runs in the
 * `whenReady` chain, where anything thrown reaches the startup catch and ends
 * the launch.
 *
 * The invariants, each with the test that pins it:
 *
 * - the advertised path never holds a partial copy — `leaves nothing at the
 *   advertised path when the copy fails part-way`;
 * - no failure deletes bytes Chrome may have loaded; they are at the advertised
 *   path or in a retired directory under user data — `leaves the previous copy
 *   advertised when it cannot be moved aside`, `puts the previous copy back
 *   when the new one cannot be swapped in`, `keeps the retired bytes when the
 *   restore fails too`, `advertises the new copy under the previous stamp when
 *   only the stamp write fails`;
 * - in a packaged build, `extensionPathExists()` is true exactly when a
 *   consistent copy (manifest present, stamp readable) is at the advertised
 *   path — `advertises a consistent copy left by an earlier version`, `returns
 *   false when the copy has a matching stamp but no manifest`, `returns and
 *   logs when the stamp is a directory`; `ipcHandlers.ts` gates
 *   `extension:openFolder` on it, so Open extension folder reports
 *   `EXT_NOT_FOUND` when it is false.
 *
 * Every failure that stops the sync is logged under one of
 * `app.extension_sync_failed`, `app.extension_sweep_failed` or
 * `app.extension_version_stale` (tests: `fails loudly when the bundled
 * extension is missing`, `warns and still copies when the sweep cannot read the
 * user data directory`, `returns and logs once when the staleness probe itself
 * throws`). Housekeeping removals of a retired or staging directory go through
 * `removeQuietly`, which swallows a failed `rmSync` without logging, so a
 * successful sync clears retired and staging leftovers on a best-effort basis
 * and a directory that cannot be removed is left for a later launch (tests:
 * `sweeps staging and retired directories left by a killed sync`, `keeps a
 * retired copy across repeated failures and clears it after a success`).
 */
export function syncPackagedExtension(): void {
  if (!app.isPackaged) return

  const source = join(process.resourcesPath, EXTENSION_DIR)
  const target = getExtensionPath()
  let staging: string | null = null
  let retired: string | null = null

  try {
    if (!isCopyStale()) {
      // Nothing to copy, and the advertised copy is this build's own, so
      // anything left beside it is spare.
      sweepLeftovers()
      return
    }
    if (!existsSync(join(source, MANIFEST_FILE))) {
      throw new Error(`No bundled extension at ${source}`)
    }
    staging = mkdtempSync(join(userDataPath(), STAGING_PREFIX))
    cpSync(source, staging, { recursive: true })
    if (existsSync(target)) {
      // Moved aside, not removed. On Windows Chrome holds handles into the
      // folder it loaded, so a removal here can fail; a rename that fails
      // leaves the previous copy and its stamp untouched (`leaves the previous
      // copy advertised when it cannot be moved aside`).
      retired = join(userDataPath(), `${RETIRED_PREFIX}${randomBytes(8).toString('hex')}`)
      renameSync(target, retired)
    }
    renameSync(staging, target)
    staging = null
    // After the swap, so the stamp only ever names a copy that is fully in
    // place.
    writeFileSync(stampPath(), app.getVersion(), 'utf-8')
    // Past this line and nowhere earlier. Between the swap and the write both
    // copies exist — the new one advertised, the previous one retired — and
    // until the stamp names this version a launch that stops here is a failure
    // state the next sync has to be able to finish. Leftovers from an earlier
    // one go here or on the nothing-to-do branch above, never on a failure
    // path.
    retired = null
    sweepLeftovers()
  } catch (err) {
    logger.error('app', 'app.extension_sync_failed', undefined, err)
    if (staging) removeQuietly(staging)
    if (retired) restoreRetiredCopy(retired, target)
  }

  reportStaleAdvertisedCopy()
}
