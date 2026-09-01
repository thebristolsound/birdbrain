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
 * and a case for the capture row to belong to. Neither is an investigation, so
 * the self-test leaves every real investigation's manifest byte-identical and
 * no capture row in any investigation, and `dispose` — which runs from a
 * `finally`, so on every path the process survives — takes the sandbox itself
 * away afterwards.
 *
 * The case row is a real row while it exists — with `foreign_keys = ON` a
 * capture has no other way to be inserted — but it is created by this function,
 * holds only the sentinel capture, and lives for the length of one request
 * unless the process dies inside it or its removal fails (see
 * `SANDBOX_CASE_NAME` for what a kill leaves). It is not the hidden, permanent
 * internal case #614 rejected: nothing has to know to skip it, because by the
 * time anything could ask, it is gone.
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
   * Each half is attempted whatever the other did. Never throws; either failure
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
    // Independent halves: the root goes whether or not the case row went. A
    // leftover row is no reason to keep the directory, because a capture row
    // stores its artifact path relative to the configured storage root and
    // every reader resolves it against that root (`captureStore.ts`) — never
    // against this one — so a surviving sentinel capture verifies as missing
    // either way, and keeping the directory only leaks it. Neither half throws:
    // this runs from a `finally` and must not replace the self-test's own
    // result. Neither is silent either — `logger.error` reaches the renderer
    // over `LOG_ENTRY`, which raises a toast (`notify.ts`).
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
