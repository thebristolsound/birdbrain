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
  verifyManifestChain,
  withCaptureEntry,
  withDeletionEntry,
  ManifestRollback
} from '@main/services/manifest'
import { reconcileCaptureTrustedTime } from '@main/services/trustedTime'
import type { SelectorLifecycle } from '@main/services/selectorLifecycle'
import { getSettings } from '@main/services/settings'
import { fetchCertChain as defaultFetchCertChain } from '@main/services/tlsCertChain'
import type { TlsCertChainResult } from '@main/services/tlsCertChain'
import type { Capture, CaptureMethod, ConsentSuppression, HashVerification } from '@shared/types'

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
  delete: (captureId: string) => Promise<boolean>
  verify: (captureId: string) => Promise<HashVerification>
  reprocessCase: (caseId: string) => Promise<{ processed: number }>
}

function getToolVersion(): string {
  if (typeof app?.getVersion === 'function') return app.getVersion()
  return process.env.npm_package_version ?? '0.0.0'
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
  const { rel: mhtmlPath, hash, sizeBytes } = await store.writeMhtmlStream(
    params.caseId,
    captureId,
    params.stream
  )

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
    console.error('captureLifecycle: TLS cert re-fetch failed for capture', captureId, err)
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

  // The MHTML bytes + chain are intact. Now bind the sidecar artifacts (#118):
  // when a screenshot/text hash was recorded at ingest, re-read the on-disk
  // sidecar and recompute. A mismatch is tampering of an evidence artifact even
  // though the primary MHTML survived, so it FAILS with an artifact-specific
  // reason. Absent recorded hashes (legacy/no-screenshot) are simply skipped —
  // grandfathering is preserved.
  const sidecarFailure = await verifySidecars(capture, store)
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

// Recomputes the screenshot/text sidecar digests against the hashes recorded at
// ingest. Returns a human-readable reason on the first mismatch (or unreadable
// sidecar whose hash was recorded), or undefined when everything binds. Captures
// with no recorded hash for an artifact are not checked.
async function verifySidecars(
  capture: NonNullable<ReturnType<typeof captureRepo.getCapture>>,
  store: CaptureStore
): Promise<string | undefined> {
  if (capture.screenshotHash) {
    const buf = store.readArtifact(capture.caseId, capture.id, 'png')
    if (!buf) {
      return 'Screenshot missing: expected ' + capture.screenshotHash.slice(0, 12) + '...'
    }
    const computed = createHash('sha256').update(buf).digest('hex')
    if (computed !== capture.screenshotHash) {
      return 'Screenshot hash mismatch: expected ' + capture.screenshotHash + ', got ' + computed
    }
  }

  if (capture.textHash) {
    const buf = store.readArtifact(capture.caseId, capture.id, 'txt')
    if (!buf) {
      return 'Extracted text missing: expected ' + capture.textHash.slice(0, 12) + '...'
    }
    const computed = createHash('sha256').update(buf).digest('hex')
    if (computed !== capture.textHash) {
      return 'Extracted text hash mismatch: expected ' + capture.textHash + ', got ' + computed
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
      console.error('captureLifecycle: data extraction failed for capture', captureId, err)
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
        console.error('captureLifecycle: selector matching failed for capture', captureId, err)
      }

      runDataExtraction(captureId, caseId, url)
    })
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

    async delete(captureId) {
      const capture = captureRepo.getCapture(captureId)
      if (!capture) return false

      if (capture.format === 'mhtml') {
        const caseDir = store.caseDir(capture.caseId)
        try {
          await withDeletionEntry(
            caseDir,
            {
              captureId,
              caseId: capture.caseId,
              contentHash: capture.hash,
              operatorId: getInstallationId(),
              operatorName: getSettings().operatorName ?? '',
              toolVersion: getToolVersion()
            },
            () => {
              // Files first, DB row second. If the filesystem unlink throws,
              // the manifest rolls back with both DB and files intact (full retry).
              // If the DB delete fails after files are gone, the manifest still
              // rolls back and the user sees a broken capture row they can retry —
              // strictly better than the inverse, where a filesystem failure
              // after the DB delete would leave permanently orphaned files.
              store.deleteArtifacts(capture.caseId, captureId)
              const deleted = captureRepo.deleteCapture(captureId)
              if (!deleted) throw new ManifestRollback()
            }
          )
          return true
        } catch (err) {
          if (err instanceof ManifestRollback) return false
          throw err
        }
      }

      const deleted = captureRepo.deleteCapture(captureId)
      if (deleted) store.deleteArtifacts(capture.caseId, captureId)
      return deleted
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
          console.error('captureLifecycle: reprocess failed for capture', cap.id, err)
        }
      }
      return { processed: captures.length }
    }
  }
}
