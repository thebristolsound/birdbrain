import { mkdtempSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import * as captureRepo from '@main/services/db/captureRepo'
import * as caseRepo from '@main/services/db/caseRepo'
import * as exhibitRepo from '@main/services/db/exhibitRepo'
import { createCaptureStore, type CaptureStore } from '@main/services/captureStore'
import { logger } from '@main/services/logger'
import { ident } from '@main/services/logSafe'
import { getStorageRoot } from '@main/services/storage'
import type { Case } from '@shared/types'

// The fixed URL the capture-pipeline self-test ingests. It addresses nothing
// and is never fetched, so no page content and no operator-supplied URL enters
// the pipeline.
export const PIPELINE_SELF_TEST_URL = 'birdbrain://pipeline-test'

// Named rather than opaque: a process killed between create and dispose is the
// one path dispose cannot cover. A kill after ingest leaves this case holding
// the sentinel capture, which ingest commits before the request returns; a
// kill before ingest leaves it empty. Either way a temp root is left too.
// The next boot removes the temp root (`sweepPipelineSelfTestResidue`); the
// case stays until an operator deletes it.
export const PIPELINE_SELF_TEST_CASE_NAME = 'Birdbrain pipeline self-test (temporary)'

const SANDBOX_ROOT_PREFIX = 'birdbrain-pipeline-test-'

// The tables a sandbox may hold rows in. The first five are written by
// `createCase` and the ingest of the sentinel capture. The last three are
// derived from a capture without an operator asking (`runCaptureProcessing`
// in captureLifecycle.ts). Any other table with a row for the case holds
// something the self-test did not write.
const SANDBOX_TABLES: ReadonlySet<string> = new Set([
  'captures',
  'capture_texts',
  'exhibits',
  'case_revisions',
  'case_change_log',
  'exhibit_search_builds',
  'exhibit_search_fields',
  'extracted_data'
])

// The case row as `createCase({ name })` leaves it.
function isUntouchedSandboxRow(found: Case): boolean {
  const { exclusions, mode } = caseRepo.getAutoCapturePolicy(found.id)
  return (
    found.name === PIPELINE_SELF_TEST_CASE_NAME &&
    !found.description &&
    !found.caseNumber &&
    found.type === 'custom' &&
    !found.archived &&
    !found.isDemo &&
    !found.sharedAt &&
    exclusions.length === 0 &&
    mode === 'stack'
  )
}

// `gone`: no such case. `held`: the case holds something the self-test did not
// write. `unreadable`: the storage root could not be listed, so the case having
// no folder there is not known.
type SandboxVerdict = 'residue' | 'gone' | 'held' | 'unreadable'

function inspectSandboxCase(caseId: string): SandboxVerdict {
  const found = caseRepo.getCase(caseId)
  if (!found) return 'gone'
  if (!isUntouchedSandboxRow(found)) return 'held'
  const captures = captureRepo.listCaptures(caseId)
  if (captures.some(({ url }) => url !== PIPELINE_SELF_TEST_URL)) return 'held'
  const captureIds = new Set(captures.map(({ id }) => id))
  const foreignExhibit = exhibitRepo
    .listExhibits(caseId)
    .some(({ id, kind }) => kind !== 'capture' || !captureIds.has(id))
  if (foreignExhibit) return 'held'
  if (caseRepo.listCaseDependentTables(caseId).some((table) => !SANDBOX_TABLES.has(table))) {
    return 'held'
  }
  let stored: string[]
  try {
    stored = readdirSync(getStorageRoot())
  } catch {
    return 'unreadable'
  }
  return stored.includes(caseId) ? 'held' : 'residue'
}

/**
 * Whether a case holds nothing but what a self-test sandbox writes (#1196),
 * which is what teardown asks before it deletes the case. All of these hold:
 * the case row is as `createCase` left it under the sandbox name; every capture
 * row has the sentinel URL and every exhibit row belongs to one of those
 * captures; no table outside `SANDBOX_TABLES` has a row that
 * `listCaseDependentTables` finds for the case; and the storage root in use can
 * be listed and has no directory for the case. The sandbox writes its files
 * under its own temp root, never there, so a directory there means something
 * else wrote into the case, whatever URL its row carries or whether the row
 * survives. A case that does not exist is not residue.
 */
export function isPipelineSelfTestResidue(caseId: string): boolean {
  return inspectSandboxCase(caseId) === 'residue'
}

// A sandbox root holds `{caseId}/` (captureStore.ts), which is the only link
// from a root back to its case: nothing in the database records it. A root
// this process cannot list is not known to be one of this database's.
function caseOfSandboxRoot(root: string, caseIds: ReadonlySet<string>): string | undefined {
  try {
    return readdirSync(root).find((name) => caseIds.has(name))
  } catch {
    return undefined
  }
}

/**
 * Removes the temp roots earlier self-tests left behind (#1183): every
 * `birdbrain-pipeline-test-*` directory in the temp directory that holds a
 * directory named for a case in this database. It reads case ids and writes
 * nothing to the database or to the storage root: a leftover case stays until
 * an operator deletes it, whatever it is named and whatever it holds.
 *
 * A temp root holds only what the self-test's own ingest wrote through the
 * sandbox's store, and no reader resolves a capture against it (see `dispose`),
 * so removing one changes what no case verifies as. That includes the root
 * teardown kept beside a case something else wrote to. A root with no directory
 * for a case of this database is left: one from a run killed before its first
 * store write, one whose case is gone, and one that another installation made.
 *
 * Runs once at boot, before the capture server can start a self-test, so it
 * cannot take a live sandbox's root. Never throws.
 */
export function sweepPipelineSelfTestResidue(): void {
  try {
    const caseIds = new Set(caseRepo.listAllCaseIds())
    const dir = tmpdir()
    for (const entry of readdirSync(dir)) {
      if (!entry.startsWith(SANDBOX_ROOT_PREFIX)) continue
      const caseId = caseOfSandboxRoot(join(dir, entry), caseIds)
      if (caseId === undefined) continue
      const context = { caseId: ident(caseId) }
      try {
        rmSync(join(dir, entry), { recursive: true, force: true })
        logger.info('captureServer', 'captureServer.self_test_temp_root_removed', context)
      } catch (err) {
        logger.error('captureServer', 'captureServer.self_test_cleanup_failed', context, err)
      }
    }
  } catch (err) {
    logger.error('captureServer', 'captureServer.self_test_cleanup_failed', undefined, err)
  }
}

/**
 * A disposable stand-in for an investigation, for the capture-pipeline
 * self-test to ingest into (#614).
 *
 * The self-test's job is to prove the real pipeline works, so it has to run the
 * production ingest — but that ingest appends a signed entry to an append-only
 * manifest, and the manifest it used to append to belonged to whichever real
 * case sorted first. The sandbox substitutes the two things ingest resolves
 * against: a storage root, a fresh temp directory that carries the manifest,
 * and a case for the capture row to belong to. Neither is an investigation, so
 * the self-test leaves every real investigation's manifest byte-identical and
 * no capture row in any investigation, and `dispose` — which runs from a
 * `finally`, so on every path the process survives — attempts to take the
 * sandbox itself away afterwards, best-effort, unless the case holds something
 * the self-test did not write.
 *
 * The case row is a real row while it exists — with `foreign_keys = ON` a
 * capture has no other way to be inserted — but it is created by this function,
 * the self-test puts only the sentinel capture in it, and it lives for the
 * length of one request unless the process dies inside it, its removal fails,
 * or a client writes into it meanwhile (see `PIPELINE_SELF_TEST_CASE_NAME` for
 * what a kill leaves, and `dispose` for the write). It is not the hidden,
 * permanent internal case #614 rejected: nothing has to know to skip it. It is
 * an ordinary case that is gone when the request ends unless one of those
 * three happens, and that stays listed when it is kept.
 */
export interface PipelineSelfTestSandbox {
  /** The throwaway case the sentinel capture is ingested into. */
  caseId: string
  /** The temp directory standing in for the storage root. */
  root: string
  /** A capture store bound to `root`, for `ingestMhtmlCapture` to write through. */
  store: CaptureStore
  /**
   * Removes the case row (cascading to the capture) and the temp directory.
   * The directory is attempted whether or not the row went, and when the row
   * is already gone. A case that holds something the self-test did not write,
   * or whose storage root cannot be listed, is kept with its temp directory
   * and logged at warn. Never throws; either failure is logged.
   */
  dispose: () => void
}

export function createPipelineSelfTestSandbox(): PipelineSelfTestSandbox {
  const root = mkdtempSync(join(tmpdir(), SANDBOX_ROOT_PREFIX))
  let caseId: string
  try {
    caseId = caseRepo.createCase({ name: PIPELINE_SELF_TEST_CASE_NAME }).id
  } catch (err) {
    // This throws before the caller has a sandbox to dispose, so its `finally`
    // covers nothing: a database that keeps failing would leak one temp
    // directory per click.
    rmSync(root, { recursive: true, force: true })
    throw err
  }

  return {
    caseId,
    root,
    store: createCaptureStore({ getRoot: () => root }),
    // The root goes whether or not the case row went. A leftover row is no
    // reason to keep the directory, because a capture row stores its artifact
    // path relative to the configured storage root and every reader resolves it
    // against that root (`captureStore.ts`) — never against this one — so a
    // surviving sentinel capture verifies as missing either way, and keeping
    // the directory only leaks it. Neither step throws: this runs from a
    // `finally` and must not replace the self-test's own result. Neither is
    // silent either — `logger.error` reaches the renderer over `LOG_ENTRY`,
    // which raises a toast (`notify.ts`).
    //
    // Two verdicts keep both the case and the root, each under its own warn.
    // A case holding something the self-test did not write (#1196) is kept
    // beside what it took in. A storage root that cannot be listed leaves that
    // question open, so nothing is deleted. The next boot removes a root kept
    // here; the case stays.
    //
    // A case already gone, deleted by the operator mid-run, was not kept: only
    // the root is left to remove, and nothing is reported.
    dispose: () => {
      try {
        const verdict = inspectSandboxCase(caseId)
        if (verdict === 'held' || verdict === 'unreadable') {
          logger.warn(
            'captureServer',
            verdict === 'held'
              ? 'captureServer.self_test_sandbox_kept'
              : 'captureServer.self_test_storage_unavailable',
            { caseId: ident(caseId) }
          )
          return
        }
        if (verdict === 'residue') caseRepo.deleteCase(caseId)
      } catch (err) {
        logger.error('captureServer', 'captureServer.self_test_cleanup_failed', undefined, err)
      }
      try {
        rmSync(root, { recursive: true, force: true })
      } catch (err) {
        logger.error('captureServer', 'captureServer.self_test_cleanup_failed', undefined, err)
      }
    }
  }
}
