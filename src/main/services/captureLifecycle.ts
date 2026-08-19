import { app } from 'electron'
import { createReadStream } from 'fs'
import { createHash, randomUUID } from 'crypto'
import { defaultCaptureStore } from '@main/services/captureStore'
import type { CaptureStore } from '@main/services/captureStore'
import * as captureRepo from '@main/services/db/captureRepo'
import * as extractedDataRepo from '@main/services/db/extractedDataRepo'
import { extractData } from '@main/services/dataExtractor'
import { recordSlowOp } from '@main/services/diagnostics'
import { readExtractionHtml } from '@main/services/extraction/extractionSource'
import { getInstallationId } from '@main/services/installationId'
import {
  getManifestHead,
  verifyManifestChain,
  withCaptureEntry,
  withDeletionEntry,
  ManifestRollback
} from '@main/services/manifest'
import type { CaptureChainEntry } from '@main/services/manifest'
import { reconcileCaptureTrustedTime } from '@main/services/trustedTime'
import type { SelectorLifecycle } from '@main/services/selectorLifecycle'
import { getSettings } from '@main/services/settings'
import { fetchCertChain as defaultFetchCertChain } from '@main/services/tlsCertChain'
import type { TlsCertChainResult } from '@main/services/tlsCertChain'
import type { Capture, CaptureMethod, ConsentSuppression, HashVerification } from '@shared/types'
import type { BatchDeleteOutcome, BatchDeleteResult } from '@shared/ipc'
import { logger } from '@main/services/logger'
import { ident } from '@main/services/logSafe'

// Injectable corroboration-only TLS cert-chain re-fetcher (#123). Defaults to the
// real Node tls.connect implementation; tests inject a stub to stay hermetic.
export type FetchCertChain = (url: string) => Promise<TlsCertChainResult | null>

export interface IngestParams {
  caseId: string
  url: string
  title: string
  timestamp: string
  stream: ReadableStream<Uint8Array>
  textContent: string
  headers: Record<string, string>
  browserVersion: string
  userAgent: string
  httpStatus: number
  extensionVersion?: string
  operatorId: string
  operatorName: string
  toolVersion: string
  method?: CaptureMethod
  supersedesCaptureId?: string
  consentSuppression?: ConsentSuppression
  screenshot?: Buffer
}

export interface IngestResult {
  capture: Capture
  contentHash: string
}

export interface CaptureLifecycleDeps {
  selectorLifecycle: SelectorLifecycle
  // Non-blocking hand-off to the trusted-timestamp worker (#120). Optional so
  // tests and code paths that don't care about timestamping can omit it.
  enqueueTimestamp?: (captureId: string) => void
  // Injectable corroboration-only TLS cert-chain re-fetcher (#123). Optional;
  // defaults to the real Node tls.connect implementation. Tests inject a stub.
  fetchTlsCertChain?: FetchCertChain
  // Capture Store owning on-disk artifact layout (#142). Optional; defaults to
  // the store bound to the storage-root singleton. Tests inject their own.
  store?: CaptureStore
}

export interface CaptureLifecycle {
  ingest: (params: IngestParams) => Promise<IngestResult>
  // `reason` is recorded on the manifest deletion entry. Pass it whenever the
  // deletion is not an operator deleting evidence — a chain reader has no other
  // way to tell a self-test cleanup from a real removal (#580).
  delete: (captureId: string, reason?: string) => Promise<boolean>
  // Batch delete over a same-case id set (#394). Prefix-commit over the manifest
  // chain: one ordinary deletion entry per capture, in order, until the first
  // per-capture failure rolls its own entry back and the rest are left
  // untouched. Per-capture failures are outcomes, never throws; a cross-case
  // id fails the whole call before any write. Contract:
  // docs/specs/2026-08-19-batch-ops-interface-brief.md.
  deleteMany: (caseId: string, captureIds: string[]) => Promise<BatchDeleteResult>
  verify: (captureId: string) => Promise<HashVerification>
  reprocessCase: (caseId: string) => Promise<{ processed: number }>
}

function getToolVersion(): string {
  if (typeof app?.getVersion === 'function') return app.getVersion()
  return process.env.npm_package_version ?? '0.0.0'
}

// Thrown by deleteMany before any write when an id's row lives in another case.
export class BatchCrossCaseError extends Error {
  constructor(public readonly captureIds: string[]) {
    super('Capture ids belong to a different case: ' + captureIds.join(', '))
    this.name = 'BatchCrossCaseError'
  }
}

// The per-capture delete outcome plus the error that produced it, so `delete`
// can keep surfacing unexpected faults (an unlink that threw) as throws while
// `deleteMany` reports the same fault as a `rolled_back` outcome.
interface DeleteOneResult {
  outcome: BatchDeleteOutcome
  cause?: unknown
}

// `rolled_back.error` crosses the preload bridge, so it carries the error's
// name and errno code only — an fs message would otherwise hand the renderer
// an absolute storage path.
function outcomeError(err: unknown): string {
  if (!(err instanceof Error)) return 'UnknownError'
  const { code } = err as NodeJS.ErrnoException
  return typeof code === 'string' && code.length > 0 ? `${err.name} (${code})` : err.name
}

// End-to-end MHTML ingest:
// 1. Stream-write + hash to disk (through the Capture Store)
// 2. Inside withCaptureEntry's write-ahead seam: write sidecar files (.txt, .png) and insert the
//    DB row. Any failure re-throws, so the seam rolls the manifest back to its anchor and the
//    store cleans up the written artifacts — the manifest never records a capture that didn't land.
export async function ingestMhtmlCapture(
  params: IngestParams,
  fetchTlsCertChain: FetchCertChain = defaultFetchCertChain,
  store: CaptureStore = defaultCaptureStore
): Promise<IngestResult> {
  const captureId = randomUUID()
  const {
    rel: mhtmlPath,
    hash,
    sizeBytes
  } = await store.writeMhtmlStream(params.caseId, captureId, params.stream)

  const caseDir = store.caseDir(params.caseId)

  // Content-address the screenshot and extracted text (#118). Compute the
  // digests BEFORE the manifest entry is appended so the same hex binds the
  // signed manifest body AND the DB mirror. Hash the EXACT bytes written to
  // disk: the raw screenshot buffer and the UTF-8 encoding of textContent.
  // Omitted (left undefined) when the artifact is absent so legacy/no-screenshot
  // entries keep their original canonical body and chain hash.
  const screenshotHash = params.screenshot
    ? createHash('sha256').update(params.screenshot).digest('hex')
    : undefined
  const textHash = params.textContent
    ? createHash('sha256').update(Buffer.from(params.textContent, 'utf-8')).digest('hex')
    : undefined

  // Anchor the captured response headers into the signed manifest body (#119),
  // but only when present. Omitted (not {}) so headerless/legacy entries keep
  // their original canonical body and chain hash.
  const anchoredHeaders =
    params.headers && Object.keys(params.headers).length > 0 ? params.headers : undefined

  // Corroboration-only TLS cert re-fetch (#123, ADR-0002). Runs AFTER the capture
  // content is stored, from the main process — it records whatever cert the origin
  // serves now, NOT the cert bound to the captured transaction. Fail-soft by
  // contract (fetchCertChain never throws); we still guard defensively so a re-
  // fetch problem can NEVER fail the capture. Omitted (undefined) for non-https
  // URLs so those entries keep their original canonical body and chain hash.
  let tls: TlsCertChainResult | undefined
  try {
    tls = (await fetchTlsCertChain(params.url)) ?? undefined
  } catch (err) {
    logger.error(
      'captureLifecycle',
      'captureLifecycle.tls_refetch_failed',
      { captureId: ident(captureId) },
      err
    )
    tls = undefined
  }

  // The write-ahead manifest entry + rollback-on-throw is owned by withCaptureEntry.
  // Every path re-throws so the seam rolls the manifest back to its anchor; the outer
  // catch then delegates ALL artifact cleanup (mhtml + sidecars) to the store, covering
  // both the pre-callback manifest failure (only the mhtml written) and a failure inside
  // the callback (sidecars written too). The store never touches manifest.jsonl.
  try {
    return await withCaptureEntry(
      caseDir,
      {
        captureId,
        caseId: params.caseId,
        url: params.url,
        timestamp: params.timestamp,
        contentHash: hash,
        screenshotHash,
        textHash,
        headers: anchoredHeaders,
        tls,
        sizeBytes,
        method: params.method,
        supersedesCaptureId: params.supersedesCaptureId,
        consentSuppression: params.consentSuppression,
        operatorId: params.operatorId,
        operatorName: params.operatorName,
        toolVersion: params.toolVersion
      },
      async (manifestResult) => {
        // Write plain text content to disk for the viewer's Text tab
        if (params.textContent) {
          store.writeText(params.caseId, captureId, params.textContent)
        }

        // Write screenshot to disk
        let screenshotPath: string | undefined
        if (params.screenshot) {
          screenshotPath = store.writeScreenshot(params.caseId, captureId, params.screenshot).rel
        }

        const capture = captureRepo.insertCapture({
          id: captureId,
          caseId: params.caseId,
          url: params.url,
          title: params.title,
          hash,
          timestamp: params.timestamp,
          headers: JSON.stringify(params.headers),
          textContent: params.textContent,
          format: 'mhtml',
          mhtmlPath,
          screenshotPath,
          screenshotHash,
          textHash,
          tlsCertChain: tls !== undefined ? JSON.stringify(tls) : undefined,
          sizeBytes,
          manifestIndex: manifestResult.index,
          prevHash: manifestResult.prevHash,
          entryHash: manifestResult.entryHash,
          toolVersion: params.toolVersion,
          extensionVersion: params.extensionVersion,
          browserVersion: params.browserVersion,
          userAgent: params.userAgent,
          httpStatus: params.httpStatus,
          operatorId: params.operatorId,
          operatorName: params.operatorName,
          method: params.method,
          supersedesCaptureId: params.supersedesCaptureId,
          consentSuppression: params.consentSuppression
        })
        return { capture, contentHash: hash }
      }
    )
  } catch (err) {
    // Best-effort cleanup: never let an unlink failure mask the ingest error.
    try {
      store.deleteArtifacts(params.caseId, captureId)
    } catch {
      /* ignore */
    }
    throw err
  }
}

async function computeVerification(
  capture: NonNullable<ReturnType<typeof captureRepo.getCapture>>,
  store: CaptureStore
): Promise<HashVerification> {
  // Trusted time is ORTHOGONAL to integrity, so resolve it once up front and
  // attach it to every result regardless of the integrity outcome. Derived from
  // the manifest alone; a legacy/un-stamped capture simply reports none/pending.
  // Reconcile here so the DB mirror self-heals on read, e.g. a stamp landed in
  // the manifest but the worker hasn't refreshed the column yet.
  const tt = reconcileCaptureTrustedTime(capture)
  const trusted = { trustedTime: tt.trustedTime, tsaName: tt.tsaName, stampedAt: tt.stampedAt }

  const base = {
    captureId: capture.id,
    url: capture.url,
    title: capture.title,
    storedHash: capture.hash,
    ...trusted
  }

  if (capture.format !== 'mhtml' || !capture.mhtmlPath) {
    return {
      ...base,
      computedHash: '',
      status: 'legacy',
      reason: 'Legacy HTML capture (pre-MHTML era)'
    }
  }

  const absPath = store.resolveAbsolute(capture.mhtmlPath)
  const hasher = createHash('sha256')
  try {
    await new Promise<void>((resolve, reject) => {
      const rs = createReadStream(absPath)
      rs.on('data', (chunk) => hasher.update(chunk))
      rs.on('end', () => resolve())
      rs.on('error', reject)
    })
  } catch (err) {
    return {
      ...base,
      computedHash: '',
      status: 'missing',
      reason: 'MHTML file unreadable: ' + String(err)
    }
  }
  const computed = hasher.digest('hex')

  const chain = verifyManifestChain(store.caseDir(capture.caseId))
  if (!chain.valid) {
    return {
      ...base,
      computedHash: computed,
      status: 'chain-broken',
      manifestIndex: capture.manifestIndex,
      chainValid: false,
      reason: chain.reason
    }
  }
  // A valid chain can be TRUNCATED: removing trailing entries (including this
  // capture's own record) leaves a shorter, still-internally-valid chain, so
  // chain validity alone can't vouch for a specific capture (#X-2). Confirm this
  // capture's content hash is actually anchored at its recorded index before
  // trusting the stored-hash comparison below. A capture with no manifestIndex
  // predates the chain (legacy) and is grandfathered past this check.
  if (
    typeof capture.manifestIndex === 'number' &&
    chain.captureHashesByIndex.get(capture.manifestIndex) !== capture.hash
  ) {
    return {
      ...base,
      computedHash: computed,
      status: 'chain-broken',
      manifestIndex: capture.manifestIndex,
      chainValid: true,
      reason: 'Capture not anchored in manifest chain'
    }
  }
  if (computed !== capture.hash) {
    return {
      ...base,
      computedHash: computed,
      status: 'tampered',
      manifestIndex: capture.manifestIndex,
      chainValid: true
    }
  }

  // The MHTML bytes + chain are intact. Now bind the sidecar artifacts (#118)
  // to the SIGNED manifest entry, not the `captures` DB mirror (#234): the
  // mirror is a cache re-derived from the same ingest write, so an attacker
  // (or a bug) that edits a sidecar file and its mirror row together would
  // fool a check that trusted the mirror. `entry` is guaranteed present here
  // when manifestIndex is a number — the anchoring check above already
  // confirmed this index resolves in the verified chain. A capture with no
  // manifestIndex predates the chain (legacy) and has no entry to bind to;
  // verifySidecars treats that the same as an entry with no recorded hash —
  // grandfathered, not checked.
  const entry: CaptureChainEntry | undefined =
    typeof capture.manifestIndex === 'number'
      ? chain.captureEntriesByIndex.get(capture.manifestIndex)
      : undefined
  const sidecarFailure = await verifySidecars(capture, store, entry)
  if (sidecarFailure) {
    return {
      ...base,
      computedHash: computed,
      status: 'tampered',
      manifestIndex: capture.manifestIndex,
      chainValid: true,
      reason: sidecarFailure
    }
  }

  return {
    ...base,
    computedHash: computed,
    status: 'verified',
    manifestIndex: capture.manifestIndex,
    chainValid: true
  }
}

// Recomputes the screenshot/text sidecar digests against the hashes recorded
// in the SIGNED manifest capture entry (#234) — never `captures.screenshot_hash`
// / `captures.text_hash`, which are an unauthoritative DB mirror (see the
// caller). Returns a human-readable reason on the first mismatch (or
// unreadable sidecar whose hash was recorded), or undefined when everything
// binds. An entry with no recorded hash for an artifact is not checked for
// that artifact — same grandfathering the mirror-based check had.
async function verifySidecars(
  capture: NonNullable<ReturnType<typeof captureRepo.getCapture>>,
  store: CaptureStore,
  entry: CaptureChainEntry | undefined
): Promise<string | undefined> {
  if (entry?.screenshotHash) {
    const buf = store.readArtifact(capture.caseId, capture.id, 'png')
    if (!buf) {
      return 'Screenshot missing: expected ' + entry.screenshotHash.slice(0, 12) + '...'
    }
    const computed = createHash('sha256').update(buf).digest('hex')
    if (computed !== entry.screenshotHash) {
      return 'Screenshot hash mismatch: expected ' + entry.screenshotHash + ', got ' + computed
    }
  }

  if (entry?.textHash) {
    const buf = store.readArtifact(capture.caseId, capture.id, 'txt')
    if (!buf) {
      return 'Extracted text missing: expected ' + entry.textHash.slice(0, 12) + '...'
    }
    const computed = createHash('sha256').update(buf).digest('hex')
    if (computed !== entry.textHash) {
      return 'Extracted text hash mismatch: expected ' + entry.textHash + ', got ' + computed
    }
  }

  return undefined
}

// Streams the MHTML file from disk, recomputes SHA-256, and checks the manifest chain.
export async function verifyCapture(
  captureId: string,
  store: CaptureStore = defaultCaptureStore
): Promise<HashVerification> {
  const capture = captureRepo.getCapture(captureId)
  if (!capture) {
    return {
      captureId,
      url: '',
      title: '',
      storedHash: '',
      computedHash: '',
      status: 'missing',
      reason: 'Capture not found',
      trustedTime: 'none'
    }
  }

  const result = await computeVerification(capture, store)

  // Persist so the UI can rehydrate across remounts/sessions and export can read
  // a stable snapshot without re-hashing when nothing has changed on disk. The
  // trusted-time mirror was already reconciled inside computeVerification.
  captureRepo.setCaptureVerification(captureId, {
    status: result.status,
    computedHash: result.computedHash,
    verifiedAt: new Date().toISOString()
  })

  return result
}

export function createCaptureLifecycle(deps: CaptureLifecycleDeps): CaptureLifecycle {
  const store = deps.store ?? defaultCaptureStore

  function runDataExtraction(captureId: string, caseId: string, url: string): void {
    // Timed for Settings → Diagnostics: this runs synchronously on the main
    // process, so its duration is exactly how long the app was unresponsive.
    const t0 = performance.now()
    try {
      const html = readExtractionHtml(caseId, captureId, store)
      if (html) {
        const extracted = extractData(html)
        extractedDataRepo.insertExtractedData(captureId, caseId, url, extracted)
      }
    } catch (err) {
      logger.error(
        'captureLifecycle',
        'capture.extraction_failed',
        { captureId: ident(captureId) },
        err
      )
    } finally {
      recordSlowOp('data-extraction', url, performance.now() - t0)
    }
  }

  function runPostCaptureWork(
    captureId: string,
    caseId: string,
    url: string,
    textContent: string | undefined
  ): void {
    setImmediate(() => {
      try {
        if (textContent) {
          deps.selectorLifecycle.runActiveSelectorsForCapture(captureId, caseId, textContent)
        }
      } catch (err) {
        logger.error(
          'captureLifecycle',
          'captureLifecycle.selector_match_failed',
          { captureId: ident(captureId) },
          err
        )
      }

      runDataExtraction(captureId, caseId, url)
    })
  }

  // Per-case serialisation for delete/deleteMany (#394): the manifest is one
  // append-only file per case and a rollback is a truncation, so two deletes
  // interleaving on the same chain could truncate each other's entries.
  // Callers queue in memory; there is no busy error.
  const caseSlots = new Map<string, Promise<void>>()

  async function withCaseSlot<T>(caseId: string, fn: () => Promise<T>): Promise<T> {
    const prev = caseSlots.get(caseId) ?? Promise.resolve()
    let release: () => void = () => {}
    const mine = new Promise<void>((resolve) => {
      release = resolve
    })
    const tail = prev.then(() => mine)
    caseSlots.set(caseId, tail)
    await prev
    try {
      return await fn()
    } finally {
      release()
      if (caseSlots.get(caseId) === tail) caseSlots.delete(caseId)
    }
  }

  // The single-capture delete body, shared by `delete` and `deleteMany`.
  // A per-capture fault is reported as a `rolled_back` outcome whose `stage`
  // names the call that threw; for an MHTML capture the manifest seam has
  // already rolled the entry back by then. The one throw left is a manifest
  // fault (the rollback itself failed), which no outcome can state honestly.
  async function deleteOne(capture: Capture, reason?: string): Promise<DeleteOneResult> {
    const captureId = capture.id
    if (capture.format === 'mhtml') {
      const caseDir = store.caseDir(capture.caseId)
      const headBefore = getManifestHead(caseDir).nextIndex
      let stage: 'artifacts' | 'db' = 'artifacts'
      try {
        await withDeletionEntry(
          caseDir,
          {
            captureId,
            caseId: capture.caseId,
            contentHash: capture.hash,
            operatorId: getInstallationId(),
            operatorName: getSettings().operatorName ?? '',
            toolVersion: getToolVersion(),
            ...(reason !== undefined ? { reason } : {})
          },
          () => {
            // Files first, DB row second. If the filesystem unlink throws,
            // the manifest rolls back with both DB and files intact (full retry).
            // If the DB delete fails after files are gone, the manifest still
            // rolls back and the user sees a broken capture row they can retry —
            // strictly better than the inverse, where a filesystem failure
            // after the DB delete would leave permanently orphaned files.
            store.deleteArtifacts(capture.caseId, captureId)
            stage = 'db'
            const deleted = captureRepo.deleteCapture(captureId)
            if (!deleted) throw new ManifestRollback()
          }
        )
        return { outcome: { captureId, status: 'deleted' } }
      } catch (err) {
        // `rolled_back` asserts the entry is not in the chain. If the rollback
        // truncate itself failed the entry is still there (the #622 artefact),
        // so that claim would be false: surface the manifest fault as a throw
        // rather than a tidy outcome.
        if (getManifestHead(caseDir).nextIndex !== headBefore) throw err
        return {
          outcome: { captureId, status: 'rolled_back', stage, error: outcomeError(err) },
          cause: err
        }
      }
    }

    // Legacy html capture: no manifest entry exists for it, so none is written
    // (as before). Files first, row second, for the same reason as the MHTML
    // branch: with no entry to roll back, an unlink failure after the row is
    // gone would orphan the files for good. The row vanishing between snapshot
    // and delete is the same "not there" the snapshot would have reported.
    try {
      store.deleteArtifacts(capture.caseId, captureId)
    } catch (err) {
      return {
        outcome: { captureId, status: 'rolled_back', stage: 'artifacts', error: outcomeError(err) },
        cause: err
      }
    }
    const deleted = captureRepo.deleteCapture(captureId)
    if (!deleted) return { outcome: { captureId, status: 'rejected', reason: 'not_found' } }
    return { outcome: { captureId, status: 'deleted_unmanifested' } }
  }

  return {
    async ingest(params) {
      const result = await ingestMhtmlCapture(
        params,
        deps.fetchTlsCertChain ?? defaultFetchCertChain,
        store
      )
      // Hand off to the trusted-timestamp worker without blocking the capture.
      deps.enqueueTimestamp?.(result.capture.id)
      runPostCaptureWork(result.capture.id, params.caseId, params.url, params.textContent)
      return result
    },

    async delete(captureId, reason) {
      const probe = captureRepo.getCapture(captureId)
      if (!probe) return false
      return withCaseSlot(probe.caseId, async () => {
        // Re-read under the slot: a batch ahead of us in the queue may have
        // removed it while we waited.
        const capture = captureRepo.getCapture(captureId)
        if (!capture) return false
        const { outcome, cause } = await deleteOne(capture, reason)
        if (cause !== undefined && !(cause instanceof ManifestRollback)) throw cause
        return outcome.status === 'deleted' || outcome.status === 'deleted_unmanifested'
      })
    },

    async deleteMany(caseId, captureIds) {
      return withCaseSlot(caseId, async () => {
        // Snapshot validation happens under the slot, not before it: a batch
        // queued behind another must see the rows the earlier batch removed as
        // not_found, not as live rows it then fails to delete.
        const uniqueIds = [...new Set(captureIds)]
        const byId = new Map(captureRepo.getCapturesByIds(uniqueIds).map((c) => [c.id, c]))
        const crossCase = uniqueIds.filter((id) => {
          const row = byId.get(id)
          return row !== undefined && row.caseId !== caseId
        })
        if (crossCase.length > 0) throw new BatchCrossCaseError(crossCase)

        const caseDir = store.caseDir(caseId)
        const baseIndex = getManifestHead(caseDir).nextIndex
        const outcomes: BatchDeleteOutcome[] = []
        const seen = new Set<string>()
        let haltedAt: string | undefined

        for (const id of captureIds) {
          if (seen.has(id)) {
            outcomes.push({ captureId: id, status: 'rejected', reason: 'duplicate' })
            continue
          }
          seen.add(id)
          const capture = byId.get(id)
          if (!capture) {
            outcomes.push({ captureId: id, status: 'rejected', reason: 'not_found' })
            continue
          }
          if (haltedAt !== undefined) {
            outcomes.push({ captureId: id, status: 'not_attempted' })
            continue
          }
          const { outcome } = await deleteOne(capture)
          outcomes.push(outcome)
          if (outcome.status === 'rolled_back') haltedAt = id
        }

        const deletedIds = outcomes
          .filter((o) => o.status === 'deleted' || o.status === 'deleted_unmanifested')
          .map((o) => o.captureId)
        const failedIds = outcomes
          .filter((o) => o.status === 'rolled_back' || o.status === 'not_attempted')
          .map((o) => o.captureId)
        const committedEntries = outcomes.filter((o) => o.status === 'deleted').length
        return {
          outcomes,
          deletedIds,
          failedIds,
          ...(haltedAt !== undefined ? { haltedAt } : {}),
          manifest: { baseIndex, committedEntries }
        }
      })
    },

    verify(captureId) {
      return verifyCapture(captureId, store)
    },

    async reprocessCase(caseId) {
      const captures = captureRepo.listCaptures(caseId)
      for (const cap of captures) {
        await new Promise<void>((resolve) => setImmediate(resolve))
        // Swallow per-capture errors so one bad capture doesn't poison the batch.
        try {
          // Always clear first so legacy rows don't linger when a capture has no
          // readable source file anymore.
          extractedDataRepo.deleteExtractedDataForCapture(cap.id)
          runDataExtraction(cap.id, caseId, cap.url)
        } catch (err) {
          logger.error(
            'captureLifecycle',
            'captureLifecycle.reprocess_failed',
            { captureId: ident(cap.id) },
            err
          )
        }
      }
      return { processed: captures.length }
    }
  }
}
