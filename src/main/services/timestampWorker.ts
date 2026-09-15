import { join } from 'path'
import { app } from 'electron'
import * as captureRepo from '@main/services/db/captureRepo'
import * as caseRepo from '@main/services/db/caseRepo'
import { getExhibit, listExhibits } from '@main/services/db/exhibitRepo'
import { appendManifestEntry, initManifest } from '@main/services/manifest'
import {
  buildTrustedTimeIndex,
  reconcileCaptureTrustedTime,
  reconcileAllMirrors,
  resolveTrustedTime
} from '@main/services/trustedTime'
import { requestTimestamp } from '@main/services/timestamp'
import { parseTimestampToken } from '@shared/verify'
import { getSettings } from '@main/services/settings'
import { getStorageRoot } from '@main/services/storage'
import { getInstallationId } from '@main/services/installationId'
import { DEFAULT_TSA_URL } from '@shared/constants'
import { logger } from '@main/services/logger'
import { ident } from '@main/services/logSafe'

// Asynchronous RFC 3161 trusted-timestamping worker (#120). The capture path
// never blocks on the TSA — captures are enqueued (mirror column 'pending') and
// this worker stamps them out-of-band: on capture, on app start, and on a retry
// interval. Offline degradation is simply "no timestamp entry yet"; the capture
// still succeeds. The manifest is authoritative; the DB mirror is a rebuildable
// cache that drives the queue.

export interface TimestampWorkerDeps {
  // Injectable TSA client (defaults to the real network call). Tests pass a fake.
  requestToken?: (contentHash: string, tsaUrl: string) => Promise<Buffer>
}

export interface TimestampWorker {
  stampCapture(captureId: string): Promise<boolean>
  // A committed non-Capture Exhibit (X26): the same RFC 3161 path over its
  // Content Hash, and a `timestamp` entry stamped at schema 3 (#1180).
  stampExhibit(exhibitId: string): Promise<boolean>
  processPending(): Promise<{ stamped: number; failed: number }>
  enqueue(captureId: string): void
  enqueueExhibit(exhibitId: string): void
  rebuildMirror(): void
  start(): void
  stop(): void
}

const RETRY_INTERVAL_MS = 5 * 60 * 1000

function getToolVersion(): string {
  if (typeof app?.getVersion === 'function') return app.getVersion()
  return process.env.npm_package_version ?? '0.0.0'
}

export function createTimestampWorker(deps: TimestampWorkerDeps = {}): TimestampWorker {
  const requestToken = deps.requestToken ?? requestTimestamp
  let timer: ReturnType<typeof setInterval> | undefined

  // Stamps a single capture: request a token over its content hash, verify the
  // returned imprint actually attests THOSE bytes, append the timestamp manifest
  // entry, and flip the mirror to rfc3161. Returns false (capture stays pending)
  // on any failure so the retry loop can try again later.
  async function stampCapture(captureId: string): Promise<boolean> {
    const capture = captureRepo.getCapture(captureId)
    if (!capture || capture.format !== 'mhtml') return false

    const settings = getSettings()
    const tsaUrl = settings.tsaUrl || DEFAULT_TSA_URL
    const caseDir = join(getStorageRoot(), capture.caseId)

    try {
      const token = await requestToken(capture.hash, tsaUrl)
      const parsed = parseTimestampToken(token)
      if (parsed.messageImprintHex !== capture.hash) {
        throw new Error('TSA token imprint does not match capture content hash')
      }
      // Guard against a concurrent enqueue + processPending both stamping the
      // same capture: if it was anchored while our request was in flight, don't
      // append a duplicate timestamp entry (or burn a second TSA hit). Reconcile
      // refreshes the mirror from the manifest as it checks.
      if (reconcileCaptureTrustedTime(capture).trustedTime === 'rfc3161') {
        return true
      }
      initManifest(caseDir)
      appendManifestEntry(caseDir, {
        type: 'timestamp',
        caseId: capture.caseId,
        captureContentHash: capture.hash,
        timestamp: new Date().toISOString(),
        tsaToken: token.toString('base64'),
        operatorId: getInstallationId(),
        operatorName: settings.operatorName ?? '',
        toolVersion: getToolVersion()
      })
      captureRepo.setCaptureTrustedTime(captureId, 'rfc3161')
      return true
    } catch (err) {
      logger.error(
        'timestampWorker',
        'timestampWorker.stamp_failed',
        { captureId: ident(captureId) },
        err
      )
      return false
    }
  }

  // Stamps one non-Capture Exhibit. There is no mirror column for these: the
  // pending set is read off the manifest (an anchored Exhibit whose hash has no
  // `timestamp` entry), so a lost column cannot lose the queue. The entry is
  // stamped at schema 3 (#1180): its shape is the schema-2 one, but a schema-2
  // verifier would read it as a Capture's stamp and silently fail to apply it.
  async function stampExhibit(exhibitId: string): Promise<boolean> {
    const exhibit = getExhibit(exhibitId)
    if (!exhibit || exhibit.manifestSeq === null) return false
    if (exhibit.kind === 'capture') return stampCapture(exhibitId)

    const settings = getSettings()
    const tsaUrl = settings.tsaUrl || DEFAULT_TSA_URL
    const caseDir = join(getStorageRoot(), exhibit.caseId)

    try {
      const token = await requestToken(exhibit.contentHash, tsaUrl)
      const parsed = parseTimestampToken(token)
      if (parsed.messageImprintHex !== exhibit.contentHash) {
        throw new Error('TSA token imprint does not match exhibit content hash')
      }
      if (resolveTrustedTime(caseDir, exhibit.contentHash).trustedTime === 'rfc3161') {
        return true
      }
      initManifest(caseDir)
      appendManifestEntry(
        caseDir,
        {
          type: 'timestamp',
          caseId: exhibit.caseId,
          captureContentHash: exhibit.contentHash,
          timestamp: new Date().toISOString(),
          tsaToken: token.toString('base64'),
          operatorId: getInstallationId(),
          operatorName: settings.operatorName ?? '',
          toolVersion: getToolVersion()
        },
        { minReaderSchemaVersion: 3 }
      )
      return true
    } catch (err) {
      logger.error(
        'timestampWorker',
        'timestampWorker.stamp_failed',
        { exhibitId: ident(exhibitId) },
        err
      )
      return false
    }
  }

  // Anchored non-Capture Exhibits with no `timestamp` entry over their hash,
  // one manifest pass per Case.
  function listPendingExhibits(): string[] {
    const pending: string[] = []
    for (const c of caseRepo.listCases()) {
      const index = buildTrustedTimeIndex(join(getStorageRoot(), c.id))
      for (const exhibit of listExhibits(c.id)) {
        if (exhibit.kind === 'capture' || exhibit.manifestSeq === null) continue
        if (index.get(exhibit.contentHash)?.trustedTime === 'rfc3161') continue
        pending.push(exhibit.id)
      }
    }
    return pending
  }

  async function processPending(): Promise<{ stamped: number; failed: number }> {
    let stamped = 0
    let failed = 0
    for (const cap of captureRepo.listPendingTimestampCaptures()) {
      if (await stampCapture(cap.id)) stamped++
      else failed++
    }
    for (const exhibitId of listPendingExhibits()) {
      if (await stampExhibit(exhibitId)) stamped++
      else failed++
    }
    return { stamped, failed }
  }

  // Marks a freshly-ingested capture as awaiting a timestamp and kicks off a
  // non-blocking attempt. Returns immediately — never on the capture's path.
  function enqueue(captureId: string): void {
    captureRepo.setCaptureTrustedTime(captureId, 'pending')
    setImmediate(() => {
      void stampCapture(captureId)
    })
  }

  // The commit path's hand-off (X26). Nothing to mark pending: the manifest
  // already says so by having no stamp for the hash.
  function enqueueExhibit(exhibitId: string): void {
    setImmediate(() => {
      void stampExhibit(exhibitId)
    })
  }

  // Reconstructs the mirror column for every MHTML capture purely from the
  // manifest, so the queue survives a lost/corrupt column (#120 AC). Delegates to
  // the trusted-time module, which owns the read-and-refresh rule.
  function rebuildMirror(): void {
    reconcileAllMirrors()
  }

  function start(): void {
    rebuildMirror()
    void processPending()
    timer = setInterval(() => void processPending(), RETRY_INTERVAL_MS)
    // Don't keep the event loop (or the app's exit) alive for the retry timer.
    if (typeof timer.unref === 'function') timer.unref()
  }

  function stop(): void {
    if (timer) clearInterval(timer)
    timer = undefined
  }

  return {
    stampCapture,
    stampExhibit,
    processPending,
    enqueue,
    enqueueExhibit,
    rebuildMirror,
    start,
    stop
  }
}
