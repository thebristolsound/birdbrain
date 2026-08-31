import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import * as caseRepo from '@main/services/db/caseRepo'
import { createCaptureStore, type CaptureStore } from '@main/services/captureStore'
import { logger } from '@main/services/logger'

// The fixed URL the capture-pipeline self-test ingests. It addresses nothing
// and is never fetched, so no page content and no operator-supplied URL enters
// the pipeline.
export const PIPELINE_SELF_TEST_URL = 'birdbrain://pipeline-test'

// Named rather than opaque: a process killed between create and dispose is the
// one path dispose cannot cover, and what that kill leaves is not an empty case
// — the capture row is committed by ingest before the request returns, so the
// residue is this case holding the sentinel capture, its artifacts under a temp
// root the OS sweeps on its own schedule. A case the operator can recognise by
// name and delete is a better residue than an unexplained row.
const SANDBOX_CASE_NAME = 'Birdbrain pipeline self-test (temporary)'

/**
 * A disposable stand-in for an investigation, for the capture-pipeline
 * self-test to ingest into (#614).
 *
 * The self-test's job is to prove the real pipeline works, so it has to run the
 * production ingest — but that ingest appends a signed entry to an append-only
 * manifest, and the manifest it used to append to belonged to whichever real
 * case sorted first. The sandbox substitutes the two things ingest resolves
 * against: a storage root, a fresh temp directory that carries the manifest,
 * and a case for the capture row to belong to. Both are gone once `dispose` has
 * run — it runs from a `finally`, so on every path the process survives — and
 * the self-test therefore leaves every real investigation's manifest
 * byte-identical and no capture row in any investigation.
 *
 * The case row is a real row while it exists — with `foreign_keys = ON` a
 * capture has no other way to be inserted — but it is created by this function,
 * holds only the sentinel capture, and lives for the length of one request
 * unless the process dies inside it (see `SANDBOX_CASE_NAME` for what that
 * leaves). It is not the hidden, permanent internal case #614 rejected: nothing
 * has to know to skip it, because by the time anything could ask, it is gone.
 */
export interface PipelineSelfTestSandbox {
  /** The throwaway case the sentinel capture is ingested into. */
  caseId: string
  /** The temp directory standing in for the storage root. */
  root: string
  /** A capture store bound to `root`, for `ingestMhtmlCapture` to write through. */
  store: CaptureStore
  /**
   * Removes the case row (cascading to the capture), then the temp directory.
   * Never throws, and keeps the directory if the row survives; either failure
   * is logged.
   */
  dispose: () => void
}

export function createPipelineSelfTestSandbox(): PipelineSelfTestSandbox {
  const root = mkdtempSync(join(tmpdir(), 'birdbrain-pipeline-test-'))
  let caseId: string
  try {
    caseId = caseRepo.createCase({ name: SANDBOX_CASE_NAME }).id
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
    // Ordered, not independent: the root goes only once the case row is gone.
    // Dropping the root first turns a failed `deleteCase` into a capture row
    // pointing at files that no longer exist — a case that verifies as missing
    // evidence — where this way the leftover is a whole readable case the
    // operator can delete like any other. Neither half throws: this runs from a
    // `finally` and must not replace the self-test's own result. Neither is
    // silent either — `logger.error` reaches the renderer over `LOG_ENTRY`,
    // which raises a toast (`notify.ts`).
    dispose: () => {
      try {
        caseRepo.deleteCase(caseId)
      } catch (err) {
        logger.error('captureServer', 'captureServer.self_test_cleanup_failed', undefined, err)
        return
      }
      try {
        rmSync(root, { recursive: true, force: true })
      } catch (err) {
        logger.error('captureServer', 'captureServer.self_test_cleanup_failed', undefined, err)
      }
    }
  }
}
