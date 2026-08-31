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
// one path dispose cannot cover, and an empty case the operator can read and
// delete is a better residue than an unexplained row.
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
 * and a case for the capture row to belong to. Both are gone once `dispose`
 * has run, so the self-test leaves every real investigation's manifest
 * byte-identical and no capture row anywhere.
 *
 * The case row is a real row while it exists — with `foreign_keys = ON` a
 * capture has no other way to be inserted — but it is created by this function,
 * holds only the sentinel capture, and lives for the length of one request. It
 * is not the hidden, permanent internal case #614 rejected: nothing has to know
 * to skip it, because by the time anything could ask, it is gone.
 */
export interface PipelineSelfTestSandbox {
  /** The throwaway case the sentinel capture is ingested into. */
  caseId: string
  /** The temp directory standing in for the storage root. */
  root: string
  /** A capture store bound to `root`, for `ingestMhtmlCapture` to write through. */
  store: CaptureStore
  /** Removes the case row (cascading to the capture) and the temp directory. */
  dispose: () => void
}

export function createPipelineSelfTestSandbox(): PipelineSelfTestSandbox {
  const root = mkdtempSync(join(tmpdir(), 'birdbrain-pipeline-test-'))
  const { id: caseId } = caseRepo.createCase({ name: SANDBOX_CASE_NAME })

  return {
    caseId,
    root,
    store: createCaptureStore({ getRoot: () => root }),
    // Each half is attempted whatever the other did, and neither throws: this
    // runs from a `finally` and must not replace the self-test's own result.
    // Nothing it can fail to remove is evidence — the manifest is inside `root`
    // and the case holds only the sentinel — so the failure is logged rather
    // than surfaced.
    dispose: () => {
      try {
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
