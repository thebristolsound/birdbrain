import { existsSync, mkdtempSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import * as captureRepo from '@main/services/db/captureRepo'
import * as caseRepo from '@main/services/db/caseRepo'
import { createCaptureStore, type CaptureStore } from '@main/services/captureStore'
import { logger } from '@main/services/logger'
import { ident } from '@main/services/logSafe'
import { getStorageRoot } from '@main/services/storage'

// The fixed URL the capture-pipeline self-test ingests. It addresses nothing
// and is never fetched, so no page content and no operator-supplied URL enters
// the pipeline.
export const PIPELINE_SELF_TEST_URL = 'birdbrain://pipeline-test'

// Named rather than opaque: a process killed between create and dispose is the
// one path dispose cannot cover, and what that kill leaves is not an empty case
// — the capture row is committed by ingest before the request returns, so the
// residue is this case holding the sentinel capture, its artifacts under a temp
// root. `sweepPipelineSelfTestResidue` takes both at the next boot.
export const PIPELINE_SELF_TEST_CASE_NAME = 'Birdbrain pipeline self-test (temporary)'

const SANDBOX_ROOT_PREFIX = 'birdbrain-pipeline-test-'

/**
 * Whether a case is nothing but what a self-test sandbox writes, and so safe to
 * delete with everything it cascades to (#1183, #1196): it carries the sandbox
 * name, every capture row it holds has the sentinel URL, and it has no
 * directory under the configured storage root. The sandbox writes its files
 * under its own temp root, never there, so a directory there means something
 * else wrote into the case, whatever URL its row carries or whether the row
 * survives. A case that does not exist is not residue.
 */
export function isPipelineSelfTestResidue(caseId: string): boolean {
  if (caseRepo.getCase(caseId)?.name !== PIPELINE_SELF_TEST_CASE_NAME) return false
  if (captureRepo.listCaptures(caseId).some(({ url }) => url !== PIPELINE_SELF_TEST_URL)) {
    return false
  }
  return !existsSync(join(getStorageRoot(), caseId))
}

// A sandbox root holds `{caseId}/` (captureStore.ts), which is the only link
// from a leftover case back to its root: nothing in the database records it.
function removeSandboxRoots(caseId: string): void {
  const dir = tmpdir()
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith(SANDBOX_ROOT_PREFIX) && existsSync(join(dir, entry, caseId))) {
      rmSync(join(dir, entry), { recursive: true, force: true })
    }
  }
}

/**
 * Deletes what a self-test killed mid-run left behind: each case that
 * `isPipelineSelfTestResidue` accepts, and the temp root holding its files.
 * Runs once at boot, before the capture server can start another self-test,
 * so it cannot take a live sandbox. A case carrying the sandbox name that fails
 * the check is kept and logged. Archived cases are not read: archiving is
 * something an operator did to the case.
 */
export function sweepPipelineSelfTestResidue(): void {
  for (const { id, name } of caseRepo.listCases()) {
    if (name !== PIPELINE_SELF_TEST_CASE_NAME) continue
    const context = { caseId: ident(id) }
    try {
      if (!isPipelineSelfTestResidue(id)) {
        logger.info('captureServer', 'captureServer.self_test_residue_kept', context)
        continue
      }
      caseRepo.deleteCase(id)
      removeSandboxRoots(id)
      logger.info('captureServer', 'captureServer.self_test_residue_removed', context)
    } catch (err) {
      logger.error('captureServer', 'captureServer.self_test_cleanup_failed', context, err)
    }
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
 * sandbox itself away afterwards, best-effort in two independent halves.
 *
 * The case row is a real row while it exists — with `foreign_keys = ON` a
 * capture has no other way to be inserted — but it is created by this function,
 * the self-test puts only the sentinel capture in it, and it lives for the
 * length of one request unless the process dies inside it, its removal fails,
 * or a client writes into it meanwhile (see `PIPELINE_SELF_TEST_CASE_NAME` for
 * what a kill leaves, and `dispose` for the write). It is not the hidden,
 * permanent internal case #614 rejected: nothing has to know to skip it,
 * because by the time anything could ask, it is gone.
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
   * Each half is attempted whatever the other did. A case that
   * `isPipelineSelfTestResidue` rejects is kept with its temp directory, and
   * logged at warn. Never throws; either failure is logged.
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
    // Independent halves: the root goes whether or not the case row went. A
    // leftover row is no reason to keep the directory, because a capture row
    // stores its artifact path relative to the configured storage root and
    // every reader resolves it against that root (`captureStore.ts`) — never
    // against this one — so a surviving sentinel capture verifies as missing
    // either way, and keeping the directory only leaks it. Neither half throws:
    // this runs from a `finally` and must not replace the self-test's own
    // result. Neither is silent either — `logger.error` reaches the renderer
    // over `LOG_ENTRY`, which raises a toast (`notify.ts`).
    //
    // The one exception to independence is a case holding something the
    // self-test did not write (#1196): the case is kept, and the root with it,
    // so the operator finds the sandbox whole beside the capture it took in.
    dispose: () => {
      try {
        if (!isPipelineSelfTestResidue(caseId)) {
          logger.warn('captureServer', 'captureServer.self_test_sandbox_kept', {
            caseId: ident(caseId)
          })
          return
        }
        caseRepo.deleteCase(caseId)
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
