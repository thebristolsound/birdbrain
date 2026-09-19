import { app } from 'electron'
import { existsSync, rmSync } from 'fs'
import { join } from 'path'
import * as caseRepo from '@main/services/db/caseRepo'
import * as tagRepo from '@main/services/db/tagRepo'
import { importCaseArchive } from '@main/services/caseArchive'
import { getSettings, updateSettings } from '@main/services/settings'
import { getStorageRoot } from '@main/services/storage'
import { logger } from '@main/services/logger'
import { DEMO_CASE_ARCHIVE_FILENAME, DEMO_CASE_OPERATOR_NAME } from '@shared/constants'

/**
 * The bundled demonstration Case, and the only two things anything does with it
 * (#405): seed it on first launch, and remove it when the tour's ending says to.
 *
 * The demo Case is NOT seeded SQL. It ships as an ordinary `.birdbrain` Case
 * Archive and arrives through `importCaseArchive`, so it is re-verified against
 * the key bundled in its own header, gets id-collision remapping, and lands
 * with a signed `import` custody entry that continues the chain the fixture was
 * exported under. What marks it as a demonstration is a single column,
 * `is_demo`, carried on the archived case row (#399) — which is also what makes
 * the flag survive a re-export and re-import.
 */

/** Why a seeding attempt did nothing, for the log and for the tests. */
export type DemoCaseSkipReason =
  | 'not-a-fresh-install'
  | 'already-seeded'
  | 'demo-case-present'
  | 'fixture-missing'
  | 'import-failed'

export interface DemoCaseSeedResult {
  seeded: boolean
  caseId?: string
  reason?: DemoCaseSkipReason
}

/**
 * Where the fixture lives, which differs between a packaged app and a checkout.
 *
 * electron-builder copies it into the packaged app's resources directory via
 * `build.extraResources`, and a dev run reads it out of the repository's
 * `resources/`. No longer the mirror of `getExtensionPath` it used to be: that
 * one advertises a copy under user data since #653, because Chrome keeps the
 * folder it was pointed at. This archive is read once, during the launch that
 * seeds it, so a path inside the AppImage's mount is all it needs.
 */
export function getDemoCaseArchivePath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, DEMO_CASE_ARCHIVE_FILENAME)
  }
  return join(process.cwd(), 'resources', DEMO_CASE_ARCHIVE_FILENAME)
}

/**
 * Records the seeding attempt, whatever a failing settings write does.
 *
 * `updateSettings` ends in a `writeFileSync` and throws on an unwritable
 * userData directory. Seeding is awaited without a local guard during startup,
 * where anything thrown reaches the `app.whenReady()` catch and exits the app —
 * so an unlatched demo case would take the whole launch with it. Same trade
 * `initSettings` makes for its own first-launch write.
 *
 * What losing this latch costs, plainly: nothing while a demo case is present,
 * because the database check in `seedDemoCaseIfNeeded` answers for it — but
 * that check is a probe of the current state, not a second latch, so on an
 * install whose settings write fails, deleting the demo case brings a fresh one
 * back on the next launch, and again after each later deletion. That bound is
 * the deliberate call on #1301, not an oversight; the full statement of it is
 * on `seedDemoCaseIfNeeded`.
 */
function latchSeeded(): void {
  try {
    updateSettings({ demoCaseSeeded: true })
  } catch (err) {
    logger.warn('demoCase', 'demoCase.latch_failed', undefined, err)
  }
}

/**
 * Imports the bundled demo Case, once, on a fresh install.
 *
 * Three guards. `isFreshInstall` keeps an upgrade from acquiring a demo case it
 * never asked for, and `demoCaseSeeded` records that the attempt happened
 * whatever its outcome, so a build with a broken fixture does not retry it every
 * launch. Both live in settings.json, whose write `latchSeeded` swallows, so
 * neither is certain to persist; the third guard is a row with `is_demo`
 * already in the database (#1301), and it is what stops a second copy arriving
 * behind the operator's back while the first one is still there.
 *
 * What the third guard does NOT hold, stated plainly because two rounds of
 * review found it stated too strongly: it is a probe of the current state, not
 * a latch. On an install whose settings write fails, deleting the demo case
 * brings a fresh one back on the next launch — and again after each later
 * deletion, without bound. Nothing here counts deletions or remembers them.
 * Making that impossible would need a latch surviving a failed settings write;
 * keeping the probe and stating the bound is the deliberate choice on #1301.
 * What #405 asks for is narrower and does hold: no demo case ever arrives
 * without confirmation except on a first launch, since every other route in is
 * the operator's own Import Case dialog.
 *
 * Never throws: a demonstration case failing to arrive must not stop the app
 * from starting.
 */
export async function seedDemoCaseIfNeeded(): Promise<DemoCaseSeedResult> {
  const settings = getSettings()
  if (!settings.isFreshInstall) return { seeded: false, reason: 'not-a-fresh-install' }
  if (settings.demoCaseSeeded) return { seeded: false, reason: 'already-seeded' }
  // Checked before the fixture is even looked for: this is the guard that holds
  // when the settings latch never persisted, and importing a duplicate is worse
  // than skipping a seed.
  if (caseRepo.hasDemoCase()) {
    latchSeeded()
    return { seeded: false, reason: 'demo-case-present' }
  }

  const archivePath = getDemoCaseArchivePath()
  if (!existsSync(archivePath)) {
    logger.warn('demoCase', 'demoCase.fixture_missing')
    latchSeeded()
    return { seeded: false, reason: 'fixture-missing' }
  }

  try {
    const { newCaseId } = await importCaseArchive(archivePath, {
      operatorName: DEMO_CASE_OPERATOR_NAME
    })
    latchSeeded()
    logger.info('demoCase', 'demoCase.seeded')
    return { seeded: true, caseId: newCaseId }
  } catch (err) {
    logger.warn('demoCase', 'demoCase.seed_failed', undefined, err)
    latchSeeded()
    return { seeded: false, reason: 'import-failed' }
  }
}

/**
 * Deletes a demonstration Case, artifacts included.
 *
 * `cases:delete` deliberately removes only the row and leaves the case
 * directory on disk — the right default for real evidence, and unchanged here.
 * A demonstration case is disposable, so the tour's ending leaves nothing
 * behind, which is why this is its own path rather than a flag on the ordinary
 * delete (#405, W19). "Nothing" covers the case row, the artifacts on disk and
 * the demo's own tags; what it never covers is anything the operator has since
 * attached their own evidence to.
 *
 * Refuses any case whose `is_demo` is not set, so nothing an operator collected
 * can be routed through it — the tour offers this ending only on the seeded
 * case, and this is the check that holds if anything else ever calls it.
 */
export function deleteDemoCase(caseId: string): boolean {
  const target = caseRepo.getCase(caseId)
  if (!target?.isDemo) return false

  // Read before the delete, because the cascade is what removes the links this
  // query walks.
  const tagIds = tagRepo.collectTagsForCase(caseId).map((row) => row.id as string)

  const deleted = caseRepo.deleteCase(caseId)
  if (!deleted) return false

  // Tags are global, so the cascade takes the demo's tag links and leaves the
  // tag itself sitting in every picker. Only ones nothing else carries go.
  tagRepo.deleteUnusedTags(tagIds)

  // Rebuilt from the storage root and the id of a row that was just read back
  // from the database, so it cannot be steered outside the root by a crafted
  // argument. Best-effort: the row is already gone, and a directory that
  // outlives it is an orphan the storage cleanup handles, not a failed delete.
  try {
    rmSync(join(getStorageRoot(), target.id), { recursive: true, force: true })
  } catch (err) {
    logger.warn('demoCase', 'demoCase.artifact_cleanup_failed', undefined, err)
  }
  return true
}
