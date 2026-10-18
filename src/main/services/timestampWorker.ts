import { join } from 'path'
import * as captureRepo from '@main/services/db/captureRepo'
import * as caseRepo from '@main/services/db/caseRepo'
import { listCaseMembers } from '@main/services/db/caseMemberRepo'
import { getExhibit, listExhibits } from '@main/services/db/exhibitRepo'
import { appendManifestEntry, initManifest } from '@main/services/manifest'
import {
  buildTrustedTimeIndex,
  pendingReceiptStamp,
  reconcileCaptureTrustedTime,
  reconcileAllMirrors,
  resolveReceiptStamps,
  resolveTrustedTime
} from '@main/services/trustedTime'
import { requestTimestamp } from '@main/services/timestamp'
import { parseTimestampToken, type MergeReceipt } from '@shared/verify'
import { getSettings } from '@main/services/settings'
import { getStorageRoot } from '@main/services/storage'
import { resolveToolVersion } from '@main/services/toolVersion'
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
  // A receipt stamp (#1515, design decision 15): the same RFC 3161 path over
  // a `merge` entry's Entry Hash, written as a `timestamp` with
  // `subject: 'entry'` at schema 4. It bounds the time by which this
  // installation held what the `merge` names, and vouches for no Exhibit.
  stampMerge(caseId: string, mergeIndex: number): Promise<boolean>
  processPending(): Promise<{ stamped: number; failed: number }>
  enqueue(captureId: string): void
  enqueueExhibit(exhibitId: string): void
  enqueueReceiptStamp(caseId: string, mergeIndex: number): void
  rebuildMirror(): void
  start(): void
  stop(): void
}

const RETRY_INTERVAL_MS = 5 * 60 * 1000

// The operator's timestamping opt-out (#1169), read fresh on every decision
// rather than captured at worker construction: the switch takes effect on the
// next capture and the next retry tick, with no restart. Read from settings and
// nowhere else, so there is exactly one answer to "may this process contact a
// TSA" and it is the one Settings and Diagnostics show.
function timestampingEnabled(): boolean {
  return getSettings().tsaEnabled
}

export function createTimestampWorker(deps: TimestampWorkerDeps = {}): TimestampWorker {
  const requestToken = deps.requestToken ?? requestTimestamp
  let timer: ReturnType<typeof setInterval> | undefined

  // Stamps a single capture: request a token over its content hash, verify the
  // returned imprint actually attests THOSE bytes, append the timestamp manifest
  // entry, and flip the mirror to rfc3161. Returns false (capture stays pending)
  // on any failure so the retry loop can try again later.
  async function stampCapture(captureId: string): Promise<boolean> {
    if (!timestampingEnabled()) return false
    const capture = captureRepo.getCapture(captureId)
    if (!capture || capture.format !== 'mhtml') return false

    const settings = getSettings()
    const tsaUrl = settings.tsaUrl || DEFAULT_TSA_URL
    const caseDir = join(getStorageRoot(), capture.caseId)

    try {
      // A stamp may already anchor these bytes, one the mirror has not caught up
      // with or, for a Capture this installation did not record, one in another
      // member's chain of a Shared Case: no TSA request.
      if (reconcileCaptureTrustedTime(capture).trustedTime === 'rfc3161') return true
      // Another member's Capture is stamped by its author alone (#1811).
      if (typeof getExhibit(captureId)?.authorInstallationId === 'string') return false
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
        toolVersion: resolveToolVersion()
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
    if (!timestampingEnabled()) return false
    const exhibit = getExhibit(exhibitId)
    if (!exhibit || exhibit.manifestSeq === null) return false
    if (exhibit.kind === 'capture') return stampCapture(exhibitId)
    if (exhibit.authorInstallationId !== null) return false

    const settings = getSettings()
    const tsaUrl = settings.tsaUrl || DEFAULT_TSA_URL
    const caseDir = join(getStorageRoot(), exhibit.caseId)

    try {
      const token = await requestToken(exhibit.contentHash, tsaUrl)
      const parsed = parseTimestampToken(token)
      if (parsed.messageImprintHex !== exhibit.contentHash) {
        throw new Error('TSA token imprint does not match exhibit content hash')
      }
      const { contentHash, authorInstallationId } = exhibit
      if (
        resolveTrustedTime(caseDir, contentHash, authorInstallationId).trustedTime === 'rfc3161'
      ) {
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
          toolVersion: resolveToolVersion()
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

  // Anchored non-Capture Exhibits of this installation with no `timestamp`
  // entry over their hash, one manifest pass per Case. Another member's are
  // its author's to stamp (#1811).
  function listPendingExhibits(): string[] {
    const pending: string[] = []
    for (const c of caseRepo.listCases()) {
      const candidates = listExhibits(c.id).filter(
        (exhibit) =>
          exhibit.kind !== 'capture' &&
          exhibit.manifestSeq !== null &&
          exhibit.authorInstallationId === null
      )
      // Most Cases hold Captures only; no manifest read for those.
      if (candidates.length === 0) continue
      const index = buildTrustedTimeIndex(join(getStorageRoot(), c.id), candidates)
      for (const exhibit of candidates) {
        if (index.get(exhibit.contentHash)?.trustedTime === 'rfc3161') continue
        pending.push(exhibit.id)
      }
    }
    return pending
  }

  // Stamps one `merge` entry of the local chain. No mirror column, as for a
  // non-Capture Exhibit: whether the `merge` is stamped is read off the
  // manifest each time. The `merge` is this installation's own entry, so the
  // local chain is the only one read.
  async function stampMerge(caseId: string, mergeIndex: number): Promise<boolean> {
    if (!timestampingEnabled()) return false

    const settings = getSettings()
    const tsaUrl = settings.tsaUrl || DEFAULT_TSA_URL
    const caseDir = join(getStorageRoot(), caseId)
    const receiptOf = (): MergeReceipt | undefined =>
      resolveReceiptStamps(caseDir).merges.find((merge) => merge.mergeIndex === mergeIndex)

    try {
      const merge = receiptOf()
      if (!merge) return false
      if (merge.stamp) return true
      const token = await requestToken(merge.entryHash, tsaUrl)
      const parsed = parseTimestampToken(token)
      if (parsed.messageImprintHex !== merge.entryHash) {
        throw new Error('TSA token imprint does not match the merge entry hash')
      }
      // The session's hand-off and a retry tick can race for one `merge`, as
      // for a Capture: a stamp that landed while this request was in flight
      // means no second entry.
      if (receiptOf()?.stamp) return true
      appendManifestEntry(caseDir, {
        type: 'timestamp',
        caseId,
        captureContentHash: merge.entryHash,
        subject: 'entry',
        timestamp: new Date().toISOString(),
        tsaToken: token.toString('base64'),
        operatorId: getInstallationId(),
        operatorName: settings.operatorName ?? '',
        toolVersion: resolveToolVersion()
      })
      return true
    } catch (err) {
      logger.error(
        'timestampWorker',
        'timestampWorker.receipt_stamp_failed',
        { caseId: ident(caseId) },
        err
      )
      return false
    }
  }

  // The newest unstamped `merge` of each Shared Case, read off its chain. A
  // Case with no roster has no sync session and so no `merge` to stamp.
  function listPendingReceiptStamps(): Array<{ caseId: string; mergeIndex: number }> {
    const pending: Array<{ caseId: string; mergeIndex: number }> = []
    for (const c of caseRepo.listCases()) {
      if (listCaseMembers(c.id).length === 0) continue
      const receipt = pendingReceiptStamp(join(getStorageRoot(), c.id))
      if (receipt) pending.push({ caseId: c.id, mergeIndex: receipt.mergeIndex })
    }
    return pending
  }

  async function processPending(): Promise<{ stamped: number; failed: number }> {
    let stamped = 0
    let failed = 0
    // Nothing failed — there was nothing to attempt. Counting the queue as
    // failures here would light the retry-failure wording for a state the
    // operator chose, and would read the pending queue on every tick for no
    // reason.
    if (!timestampingEnabled()) return { stamped, failed }
    for (const cap of captureRepo.listPendingTimestampCaptures()) {
      if (await stampCapture(cap.id)) stamped++
      else failed++
    }
    for (const exhibitId of listPendingExhibits()) {
      if (await stampExhibit(exhibitId)) stamped++
      else failed++
    }
    for (const { caseId, mergeIndex } of listPendingReceiptStamps()) {
      if (await stampMerge(caseId, mergeIndex)) stamped++
      else failed++
    }
    return { stamped, failed }
  }

  // Marks a freshly-ingested capture as awaiting a timestamp and kicks off a
  // non-blocking attempt. Returns immediately — never on the capture's path.
  function enqueue(captureId: string): void {
    captureRepo.setCaptureTrustedTime(captureId, 'pending')
    // With timestamping declined (#1169) the mirror write above still happens
    // and only the network attempt is skipped. The mirror is a cache of what the
    // manifest says, and the manifest says 'pending' for any v2 capture entry
    // carrying no token — rebuildMirror() would write exactly this on the next
    // start. Writing anything else would make the cache disagree with the
    // manifest, and would hide these captures from the queue that stamps them
    // if the operator turns timestamping back on.
    if (!timestampingEnabled()) return
    setImmediate(() => {
      void stampCapture(captureId)
    })
  }

  // The commit path's hand-off (X26). Nothing to mark pending: the manifest
  // already says so by having no stamp for the hash.
  function enqueueExhibit(exhibitId: string): void {
    if (!timestampingEnabled()) return
    setImmediate(() => {
      void stampExhibit(exhibitId)
    })
  }

  // The sync session's hand-off (#1515): the `merge` it just wrote. Nothing
  // waits on the TSA; a session that gets no stamp is caught by the retry
  // loop within one interval.
  function enqueueReceiptStamp(caseId: string, mergeIndex: number): void {
    if (!timestampingEnabled()) return
    setImmediate(() => {
      void stampMerge(caseId, mergeIndex)
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
    stampMerge,
    processPending,
    enqueue,
    enqueueExhibit,
    enqueueReceiptStamp,
    rebuildMirror,
    start,
    stop
  }
}
