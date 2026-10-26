import { createReadStream, existsSync, readFileSync } from 'fs'
import { createHash, randomUUID } from 'crypto'
import { basename, dirname, join } from 'path'
import {
  defaultCaptureStore,
  parseArtifactFilename,
  StagedRestoreError
} from '@main/services/captureStore'
import type { CaptureArtifactType, CaptureStore } from '@main/services/captureStore'
import * as captureRepo from '@main/services/db/captureRepo'
import { getExhibit, listExhibits } from '@main/services/db/exhibitRepo'
import { listDerivedFilesForExhibit } from '@main/services/db/derivedFileRepo'
import { nextExhibitNumber } from '@main/services/exhibitNumbering'
import * as extractedDataRepo from '@main/services/db/extractedDataRepo'
import { recordSlowOp } from '@main/services/diagnostics'
import type { ExtractionClient, ExtractionOutcome } from '@main/services/extraction/processClient'
import {
  buildExhibitFields,
  writeFieldBuild,
  rebuildCaseFields
} from '@main/services/search/fieldIndex'
import { getInstallationId } from '@main/services/installationId'
import {
  authorChainOf,
  entryReachesMembers,
  getManifestHead,
  readCaptureEntryAt,
  readCaseChains,
  readManifestSnapshot,
  readSharedCaseSnapshot,
  withCaptureEntry,
  withDeletionEntry,
  ManifestRollback
} from '@main/services/manifest'
import type { AuthorChain, CaptureChainEntry, ManifestImportEntry } from '@main/services/manifest'
import { reconcileCaptureTrustedTime, resolveTrustedTime } from '@main/services/trustedTime'
import type { SelectorLifecycle } from '@main/services/selectorLifecycle'
import { getSettings } from '@main/services/settings'
import { currentEgress, type CaptureEgress } from '@main/services/egress'
import { resolveToolVersion } from '@main/services/toolVersion'
import { fetchCertChain as defaultFetchCertChain } from '@main/services/tlsCertChain'
import type { TlsCertChainResult } from '@main/services/tlsCertChain'
import type {
  Capture,
  CaptureEvent,
  CaptureMethod,
  CaptureSource,
  ConsentSuppression,
  HashVerification,
  LinkProvenance,
  TlsRefetchSkip
} from '@shared/types'
import type { BatchDeleteOutcome, BatchDeleteResult, DuplicateCaptureResult } from '@shared/ipc'
import { ManifestEntrySchema } from '@shared/schemas'
import type { CaptureUploadSource, ScreenshotStatus } from '@shared/schemas'
import {
  IMPORT_ID_MAP_FILENAME,
  MANUAL_DEDUPE_WINDOW_MS,
  MAX_SCREENSHOT_SIZE
} from '@shared/constants'
import { canonicalStringify } from '@shared/verify'
import {
  carriedIdMapName,
  composeIdMaps,
  isIdMapDigest,
  parseIdMap,
  renamesOntoSignedId
} from '@main/services/importIdMaps'
import { recordedHttpStatus } from '@shared/httpStatus'
import * as caseRepo from '@main/services/db/caseRepo'
import { blockedSkipReason, matchCaseExclusion } from '@main/services/exclusionPolicy'
import { createSessionService } from '@main/services/session'
import type { SessionService } from '@main/services/session'
import { logger } from '@main/services/logger'
import { ident, tag } from '@main/services/logSafe'

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
  // The status the acquiring path recorded for the stored response. 0 is the
  // wire schema's "no status field arrived" value and is read as unrecorded;
  // see recordedHttpStatus.
  httpStatus: number
  // The URL the stored bytes were served from, passed ONLY by a path that
  // resolved one and saw it differ from the URL it requested (R7, #797). A path
  // that ingests under the URL it asked for passes nothing: repeating the
  // requested URL here would claim a redirect that was never observed.
  finalUrl?: string
  extensionVersion?: string
  operatorId: string
  operatorName: string
  toolVersion: string
  method?: CaptureMethod
  supersedesCaptureId?: string
  consentSuppression?: ConsentSuppression
  screenshot?: Buffer
  // The Egress a background render sent the page through, when it was not Direct
  // (ADR-0032 rule 5). The entry then records its kind, the Operator's label and
  // `userAgent`. Passed only by a path that sent the page itself; an extension
  // capture's page loaded in the Operator's own browser and passes none.
  egress?: CaptureEgress
  // Set by the lifecycle while the Egress is not Direct: the TLS Cert Chain
  // re-fetch opens a raw socket the proxy cannot carry, so it does not run, and
  // the entry says so (rule 3). For every method, extension included.
  tlsSkipped?: TlsRefetchSkip
  // Passed only by a Capture link job, after the recapture queue read the hash from the
  // source's verified entry (ADR-0040). The entry and the row then carry all three.
  linkProvenance?: LinkProvenance
}

export interface IngestResult {
  capture: Capture
  contentHash: string
}

// The route a request-shaped capture arrives by: the three wire sources, plus
// the capture-then-attach route (#392). The extension reports an attach
// capture as a manual one, but the manual dedup window must not refuse it: an
// attach that found no capture is the first sighting on that route, and any
// manual capture of the URL seconds earlier would have been found by the
// lookup that precedes it.
export type AdmissionRoute = CaptureUploadSource | 'attach'

// What an acquiring path hands `admit`: the wire payload minus transport, with
// no policy applied yet. Everything `IngestParams` derives (operator, tool
// version, the resolved case) is the lifecycle's to fill in.
export interface AdmissionRequest {
  route: AdmissionRoute
  // Named by every route but 'auto', which takes the Active Case from the
  // session. Empty and absent both mean "not named".
  caseId?: string
  url: string
  // Empty falls back to the URL, and to the time of admission.
  title: string
  timestamp: string
  stream: ReadableStream<Uint8Array>
  textContent: string
  headers: Record<string, string>
  browserVersion: string
  userAgent: string
  httpStatus: number
  extensionVersion: string
  // Read whole only once the request is admitted. Oversized is dropped and
  // reported, never refused.
  screenshot?: Blob | Buffer
}

export type AdmissionRefusal =
  | { kind: 'operator_name_required' }
  | { kind: 'no_active_session' }
  | { kind: 'no_active_case' }
  | { kind: 'missing_case_id' }
  | { kind: 'case_not_found' }
  | { kind: 'case_archived' }
  | { kind: 'excluded'; pattern: string }
  | { kind: 'duplicate' }
  // The ingest itself threw. Logged and reported on the activity feed here;
  // the caller only maps it.
  | { kind: 'failed'; error: unknown }

export type AdmissionOutcome =
  | {
      ok: true
      capture: Capture
      contentHash: string
      screenshotStatus: ScreenshotStatus
      screenshotWarning?: string
    }
  | { ok: false; refusal: AdmissionRefusal }

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
  // The Active Case and the session capture count, which `admit` reads and
  // moves (#228). Optional: a lifecycle built without one owns a private
  // session that never has an Active Case, so an 'auto' capture is refused
  // rather than filed somewhere. Main supplies the one the server holds.
  sessionService?: SessionService
  // Capture activity for the renderer feed, and the new-capture broadcast.
  // Both optional so a headless lifecycle emits nothing.
  emitCaptureEvent?: (event: CaptureEvent) => void
  emitNewCapture?: (capture: Capture) => void
  // The extraction utility process (#598). Optional for headless/test callers,
  // which fall back to the inline field builder. Main supplies the real client.
  extraction?: ExtractionClient
  // Whether the Egress is Direct right now (ADR-0032). Optional; defaults to the
  // installation's setting. Tests inject it.
  egressIsDirect?: () => boolean
}

export interface CaptureLifecycle {
  ingest: (params: IngestParams) => Promise<IngestResult>
  // Admission policy for every route the extension has into a case, then the
  // ingest: operator gate, case resolution, exclusion, the manual dedup
  // window, the screenshot cap, the session count and the activity events.
  // Refusals are outcomes, never throws. The transport that calls this maps
  // the outcome to a status code and nothing else.
  admit: (request: AdmissionRequest) => Promise<AdmissionOutcome>
  // `reason` is recorded on the manifest deletion entry. Pass it whenever the
  // deletion is not an operator deleting evidence — a chain reader has no other
  // way to tell such a deletion from a real removal (#580). No caller passes one
  // since the pipeline self-test stopped deleting from a case (#614). Only chains
  // written while it did — between #580 and #614 — carry its `pipeline-test`;
  // older ones hold its capture entry with no deletion at all.
  delete: (captureId: string, reason?: string) => Promise<boolean>
  // Batch delete over a same-case id set (#394). Prefix-commit over the manifest
  // chain: one ordinary deletion entry per capture, in order, until the first
  // per-capture failure rolls its own entry back and the rest are left
  // untouched. Per-capture failures are outcomes, never throws; a cross-case
  // id fails the whole call before any write. Contract:
  // docs/specs/2026-08-19-batch-ops-interface-brief.md.
  deleteMany: (caseId: string, captureIds: string[]) => Promise<BatchDeleteResult>
  // Startup sweep over every Case, archived ones included, for staged deletes a crash interrupted
  // (#1786): restores files whose row is live, purges the rest. Never throws.
  recoverPendingDeletes: () => Promise<void>
  // The post-ingest work a local Capture gets (Selector matching, data extraction, the field
  // build) for another member's Capture that sync has just written (#1811). No timestamp.
  processReceived: (
    capture: Pick<Capture, 'id' | 'caseId' | 'url'>,
    textContent: string | undefined
  ) => void
  // Applies another member's signed deletion: removes the row and its files and writes no entry.
  // False, touching nothing, when the row is missing or is this installation's own Capture.
  removeReceived: (captureId: string) => Promise<boolean>
  // Byte copy of an existing capture into a second row of the same case (#827).
  // The copy observed nothing itself, so it gets its own artifacts, its own
  // signed manifest entry marked `method: 'duplicate'`, and a link back to what
  // it was copied from — never a second row over the source's bytes. Refusals
  // are outcomes, not throws; see DuplicateCaptureRefusal.
  duplicate: (captureId: string) => Promise<DuplicateCaptureResult>
  verify: (captureId: string) => Promise<HashVerification>
  reprocessCase: (caseId: string) => Promise<{ processed: number }>
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

// What a `deletion` entry needs from the case's own chain: the id it names the Capture by, and
// whether the Capture's `capture` entry is in the chain's current segment, from its last `import`
// on. A member reads another member's chain only from there, so a Capture before it, one this
// copy imported, never reached any other member (#1877).
interface DeletionChain {
  idOf: (capture: Capture) => string
  reachesMembers: (capture: Capture) => boolean
}

// `rolled_back.error` crosses the preload bridge, so it carries the error's
// name and errno code only — an fs message would otherwise hand the renderer
// an absolute storage path.
function outcomeError(err: unknown): string {
  if (!(err instanceof Error)) return 'UnknownError'
  const { code } = err as NodeJS.ErrnoException
  return typeof code === 'string' && code.length > 0 ? `${err.name} (${code})` : err.name
}

// The re-fetch runs only for an https page (fetchCertChain), so only those can
// record that it was skipped. An address that does not parse counts: the re-fetch
// would have tried it.
function wouldRefetchTls(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return true
  }
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

  // Transaction provenance (R7, #797). The status is anchored only when one was
  // actually recorded, and the SAME derivation feeds the DB row, so a capture
  // ingested here has the report printing exactly what the entry anchors. Rows
  // written before R7 keep their fabricated 200 and are outside that guarantee
  // — see src/shared/httpStatus.ts. The final URL is anchored
  // exactly as the acquiring path resolved it — an empty string is not a URL,
  // so it is dropped rather than written as a claim about nothing.
  const anchoredHttpStatus = recordedHttpStatus(params.httpStatus)
  const anchoredFinalUrl =
    params.finalUrl !== undefined && params.finalUrl !== '' ? params.finalUrl : undefined

  // Corroboration-only TLS cert re-fetch (#123, ADR-0002). Runs AFTER the capture
  // content is stored, from the main process — it records whatever cert the origin
  // serves now, NOT the cert bound to the captured transaction. Fail-soft by
  // contract (fetchCertChain never throws); we still guard defensively so a re-
  // fetch problem can NEVER fail the capture. Omitted (undefined) for non-https
  // URLs so those entries keep their original canonical body and chain hash.
  let tls: TlsCertChainResult | undefined
  if (!params.tlsSkipped) {
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
  }

  // The write-ahead manifest entry + rollback-on-throw is owned by withCaptureEntry.
  // Every path re-throws so the seam rolls the manifest back to its anchor; the outer
  // catch then delegates ALL artifact cleanup (mhtml + sidecars) to the store, covering
  // both the pre-callback manifest failure (only the mhtml written) and a failure inside
  // the callback (sidecars written too). The store never touches manifest.jsonl.
  try {
    // Taken with no await before the append below (see nextExhibitNumber).
    const exhibitNumber = nextExhibitNumber(params.caseId, store)
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
        httpStatus: anchoredHttpStatus,
        finalUrl: anchoredFinalUrl,
        tls,
        sizeBytes,
        method: params.method,
        supersedesCaptureId: params.supersedesCaptureId,
        consentSuppression: params.consentSuppression,
        exhibitNumber,
        // Omitted for Direct, so those entries keep the canonical body they had.
        egressKind: params.egress?.kind,
        egressLabel: params.egress?.label,
        userAgent: params.egress ? params.userAgent : undefined,
        tlsSkipped: params.tlsSkipped,
        ...params.linkProvenance,
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
          // The row mirrors what the entry anchors: an unrecorded status is
          // stored as absent, never as the 0 the wire coerced it to.
          httpStatus: anchoredHttpStatus,
          operatorId: params.operatorId,
          operatorName: params.operatorName,
          method: params.method,
          supersedesCaptureId: params.supersedesCaptureId,
          consentSuppression: params.consentSuppression,
          ...params.linkProvenance,
          exhibitNumber
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
  store: CaptureStore,
  record: boolean
): Promise<HashVerification> {
  // Trusted time is ORTHOGONAL to integrity, so resolve it once up front and
  // attach it to every result regardless of the integrity outcome. Derived from
  // the manifest alone; a legacy/un-stamped capture simply reports none/pending.
  // Reconcile here so the DB mirror self-heals on read, e.g. a stamp landed in
  // the manifest but the worker hasn't refreshed the column yet.
  const tt = record
    ? reconcileCaptureTrustedTime(capture)
    : resolveTrustedTime(
        store.caseDir(capture.caseId),
        capture.hash,
        getExhibit(capture.id)?.authorInstallationId
      )
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

  // The chain the capture's author signed: the local one for this
  // installation's own, another member's chain in a Shared Case (#1511).
  const { chain } = authorChainOf(readCaseChains(store.caseDir(capture.caseId)), {
    authorInstallationId: getExhibit(capture.id)?.authorInstallationId ?? null,
    manifestIndex: capture.manifestIndex ?? null,
    contentHash: capture.hash
  })
  // Checked before `valid`, which is also false here: an entry from a newer
  // schema means this build cannot read the chain, not that it is broken (X25).
  if (chain.unsupported) {
    return {
      ...base,
      computedHash: computed,
      status: 'verifier-too-old',
      manifestIndex: capture.manifestIndex,
      chainValid: false,
      reason: chain.reason
    }
  }
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
      status: sidecarFailure.status,
      manifestIndex: capture.manifestIndex,
      chainValid: true,
      reason: sidecarFailure.reason
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

interface SidecarFailure {
  status: 'tampered' | 'missing'
  reason: string
}

// Recomputes the sidecar digests (the screenshot, the text, the Transaction
// Record and the PDF) against the hashes recorded in the SIGNED manifest
// capture entry (#234) — never the `captures` row's hash columns, which are an
// unauthoritative DB mirror (see the caller). Returns undefined when
// everything binds. An entry with no recorded hash for an artifact is not
// checked for that artifact — same grandfathering the mirror-based check had.
//
// An absent file is `missing`, never `tampered`: it shows nothing about whether
// any bytes changed (#1661). It does not end the scan: a mismatch in any file
// is reported ahead of an absent one, so an absent screenshot cannot mask an
// altered text file.
async function verifySidecars(
  capture: NonNullable<ReturnType<typeof captureRepo.getCapture>>,
  store: CaptureStore,
  entry: CaptureChainEntry | undefined
): Promise<SidecarFailure | undefined> {
  // The Transaction Record and the PDF are hashed as they stream from disk, as
  // the MHTML is, so a large file never sits whole in the main process.
  const sidecars: Array<{
    hash: string | undefined
    type: CaptureArtifactType
    label: string
    streamed: boolean
  }> = [
    { hash: entry?.screenshotHash, type: 'png', label: 'Screenshot', streamed: false },
    { hash: entry?.textHash, type: 'txt', label: 'Extracted text', streamed: false },
    {
      hash: entry?.transactionRecordHash,
      type: 'warc.gz',
      label: 'Transaction Record',
      streamed: true
    },
    { hash: entry?.pdfHash, type: 'pdf', label: 'PDF', streamed: true }
  ]
  let absent: SidecarFailure | undefined

  for (const { hash, type, label, streamed } of sidecars) {
    if (!hash) continue
    let computed: string | null
    if (streamed) {
      computed = await store.hashArtifact(capture.caseId, capture.id, type)
    } else {
      const buf = store.readArtifact(capture.caseId, capture.id, type)
      computed = buf ? createHash('sha256').update(buf).digest('hex') : null
    }
    if (computed === null) {
      absent ??= {
        status: 'missing',
        reason: label + ' missing: expected ' + hash.slice(0, 12) + '...'
      }
      continue
    }
    if (computed !== hash) {
      return {
        status: 'tampered',
        reason: label + ' hash mismatch: expected ' + hash + ', got ' + computed
      }
    }
  }

  return absent
}

// Streams the MHTML file from disk, recomputes SHA-256, and checks the manifest chain.
// `record: false` is the read-only path (ADR-0038): the same verdict, with
// nothing written back to the database.
export async function verifyCapture(
  captureId: string,
  store: CaptureStore = defaultCaptureStore,
  { record = true }: { record?: boolean } = {}
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

  const result = await computeVerification(capture, store, record)
  if (!record) return result

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

// Whether the signed entry at a row's manifest index is the entry for THAT
// row (#827). `entry` is the case id and row id the entry names — a `capture`
// entry's `captureId`, an `exhibit` entry's `exhibitId` — so a Capture and any
// other Exhibit kind bind the same way. Direct equality is the native case. A
// case that arrived by archive import is the reason this is not just equality:
// the manifest is immutable, so its entries keep the source installation's
// case id and row ids, while import mints a fresh case id and remaps any row
// id that collided with a local row. Both are resolved through the case's own
// signed custody records — the `import` entries in the same verified manifest
// read, and the id map they anchor by hash.
export function entryDescribesRow(
  entry: { caseId: string; rowId: string },
  row: { id: string; caseId: string },
  custody: Custody,
  caseDir: string
): boolean {
  return describesRow(entry, row, custody.imports, () =>
    readAnchoredIdMap(caseDir, row.caseId, custody)
  )
}

// One verified read of a Case's chain: its `import` entries, and every entry,
// which say which ids are signed identities.
type Custody = Pick<AuthorChain, 'entries' | 'imports'>

// `entryDescribesRow` for a caller binding many rows of one case directory in
// one pass: the anchored id map is read and hashed at most once per row case
// id instead of once per call, which made a pass over a renamed import cost
// the square of its renamed rows.
export function rowDescriber(
  caseDir: string,
  custody: Custody
): (entry: { caseId: string; rowId: string }, row: { id: string; caseId: string }) => boolean {
  const maps = new Map<string, Record<string, unknown> | undefined>()
  return (entry, row) =>
    describesRow(entry, row, custody.imports, () => {
      if (!maps.has(row.caseId)) {
        maps.set(row.caseId, readAnchoredIdMap(caseDir, row.caseId, custody))
      }
      return maps.get(row.caseId)
    })
}

function describesRow(
  entry: { caseId: string; rowId: string },
  row: { id: string; caseId: string },
  imports: ManifestImportEntry[],
  idMap: () => Record<string, unknown> | undefined
): boolean {
  const custodyCaseIds = new Set<string>([row.caseId])
  for (const imported of imports) {
    custodyCaseIds.add(imported.caseId)
    custodyCaseIds.add(imported.sourceCaseId)
  }
  if (!custodyCaseIds.has(entry.caseId)) return false
  if (entry.rowId === row.id) return true
  // Only an id-collision remap can leave the entry naming a different row, and
  // only the maps the import entries of this case's verified chain anchor may
  // say so: its own import's, composed over the earlier imports' (#1017).
  return idMap()?.[entry.rowId] === row.id
}

// The id a `deletion` entry names a Capture by (#1815): the `captureId` its
// own `capture` entry carries when an import renamed the row, since both
// package verifiers count an entry deleted only by that id. The rename is
// accepted only through a `rowDescriber`; any other row keeps its own id.
// `entries` and the describer must come from one verified read of the chain.
export function signedCaptureId(
  row: { id: string; caseId: string; manifestIndex?: number },
  entries: Record<string, unknown>[],
  describes: ReturnType<typeof rowDescriber>
): string {
  const { id, manifestIndex } = row
  if (typeof manifestIndex !== 'number') return id
  const parsed = ManifestEntrySchema.safeParse(entries[manifestIndex])
  if (!parsed.success || parsed.data.type !== 'capture' || parsed.data.index !== manifestIndex) {
    return id
  }
  const { caseId, captureId } = parsed.data
  if (captureId === id) return id
  return describes({ caseId, rowId: captureId }, row) ? captureId : id
}

// The id-collision remap archive import wrote into this case directory, read
// back ONLY when its digest matches the `idMapSha256` the import's signed entry
// anchors — an unanchored file in the case directory must not be able to point
// a row at another capture's entry. Undefined (so the binding fails closed)
// when this case did not arrive by import, when the file is absent or
// unparseable, or when it does not hash to what the chain recorded. A row
// renamed at an earlier import in the chain resolves through that import's
// map, which the archive carried and the import kept (#1017). Those maps are
// anchored only by digests their exporter signed, so the archive's rules apply
// here again, to whatever file is on disk: every earlier map must be present
// and pass `parseIdMap` and `composeIdMaps`, the Case's Shared Case walk, if it
// has one, must pass, none may rename onto an id a `capture` or `exhibit` entry
// on any of the Case's chains signs, and no row of this case may keep an id
// they rename away. Otherwise none counts and only this import's own renames
// resolve, as before.
function readAnchoredIdMap(
  caseDir: string,
  caseId: string,
  { entries, imports }: Custody
): Record<string, unknown> | undefined {
  const at = imports.findIndex((imported) => imported.caseId === caseId)
  if (at === -1) return undefined
  const custody = imports[at]
  let text: string
  let payload: unknown
  try {
    text = readFileSync(join(caseDir, IMPORT_ID_MAP_FILENAME), 'utf-8')
    payload = JSON.parse(text)
  } catch {
    return undefined
  }
  const digest = createHash('sha256')
    .update(Buffer.from(canonicalStringify(payload), 'utf-8'))
    .digest('hex')
  if (digest !== custody.idMapSha256) return undefined
  if (typeof payload !== 'object' || payload === null || !('remapped' in payload)) return undefined
  const { remapped } = payload
  if (typeof remapped !== 'object' || remapped === null) return undefined
  const own = { ...remapped }
  if (at === 0) return own
  const maps: Array<Map<string, string>> = []
  for (const earlier of imports.slice(0, at)) {
    if (!isIdMapDigest(earlier.idMapSha256)) return own
    let carried: string
    try {
      carried = readFileSync(join(caseDir, carriedIdMapName(earlier.idMapSha256)), 'utf-8')
    } catch {
      return own
    }
    const map = parseIdMap(carried, earlier, { canonical: true })
    if (!map) return own
    maps.push(map)
  }
  const ownMap = parseIdMap(text, custody, { canonical: false })
  if (!ownMap) return own
  const composed = composeIdMaps([...maps, ownMap])
  if (!composed || renamesOntoSignedId(maps, entries)) return own
  const renamedAway = Object.entries(composeIdMaps(maps)?.record ?? {})
    .filter(([from, to]) => from !== to)
    .flatMap(([from]) => [from, ownMap.get(from) ?? from])
  if (renamedAway.length > 0 && holdsRow(caseId, renamedAway)) return own
  const shared = sharedEntries(caseDir)
  return shared && !renamesOntoSignedId(maps, shared) ? composed.record : own
}

// The entries of every member and lineage chain the Shared Case walk accepts,
// which sign ids the custody chain may not: a fork's custody chain is the
// Owner's. The archive's check reads them too, and like it this refuses when
// the walk fails, since a chain it drops would leave its signed ids unchecked.
function sharedEntries(caseDir: string): Record<string, unknown>[] | null {
  const { verification } = readSharedCaseSnapshot(caseDir, readManifestSnapshot(caseDir))
  if (verification && !verification.valid) return null
  return [...(verification?.entries.values() ?? [])].flat()
}

// Whether a row of this case, Capture or other Exhibit, has any of these ids.
// The case's ids are read whole: an earlier map can rename more rows than
// SQLite binds parameters in one `IN (...)`.
function holdsRow(caseId: string, ids: string[]): boolean {
  const held = new Set([
    ...captureRepo.collectCapturesForCase(caseId).map((row) => row.id),
    ...listExhibits(caseId).map(({ id }) => id)
  ])
  return ids.some((id) => held.has(id))
}

// The operator gate every ingest and duplicate passes. A signed entry naming
// no operator would be a weaker record than any capture this app can produce.
function trimmedOperatorName(): string {
  return getSettings().operatorName?.trim() ?? ''
}

// The screenshot cap. An oversized artifact is dropped and reported, never
// refused: a silently missing artifact would let the extension report a clean
// capture that lost one.
async function readScreenshot(
  field: Blob | Buffer | undefined
): Promise<{ screenshot?: Buffer; screenshotWarning?: string }> {
  if (field === undefined) return {}
  const bytes = Buffer.isBuffer(field) ? field.byteLength : field.size
  if (bytes > MAX_SCREENSHOT_SIZE) {
    const screenshotWarning = `Screenshot too large: ${(bytes / (1024 * 1024)).toFixed(1)}MB exceeds ${MAX_SCREENSHOT_SIZE / (1024 * 1024)}MB limit`
    logger.warn('captureLifecycle', 'capture.screenshot_dropped', {
      reason: tag('too_large', 'screenshotDropReason'),
      bytes
    })
    return { screenshotWarning }
  }
  return { screenshot: Buffer.isBuffer(field) ? field : Buffer.from(await field.arrayBuffer()) }
}

export function createCaptureLifecycle(deps: CaptureLifecycleDeps): CaptureLifecycle {
  const sessionService = deps.sessionService ?? createSessionService()
  const emitCaptureEvent = deps.emitCaptureEvent ?? (() => {})
  const emitNewCapture = deps.emitNewCapture ?? (() => {})
  // Manual capture dedup: "caseId:url" -> timestamp of the last admitted
  // capture. Instance state, so a fresh lifecycle starts with an empty window.
  const manualDedup = new Map<string, number>()
  const store = deps.store ?? defaultCaptureStore

  // Page decoding, extraction, and field indexing run in the utility process;
  // this side names the stored files and writes the rows. Diagnostics records
  // the process-measured duration for each operation, not main-process blocking time.
  async function runCaptureProcessing(
    captureId: string,
    caseId: string,
    url: string
  ): Promise<void> {
    const { extraction } = deps
    if (!extraction) return
    try {
      const outcome = await extraction.extract({
        mhtmlPath: store.artifactPaths(caseId, captureId, 'mhtml').abs,
        htmlPath: store.artifactPaths(caseId, captureId, 'html').abs,
        fieldUrl: url,
        textPath: store.artifactPaths(caseId, captureId, 'txt').abs
      })
      recordSlowOp('data-extraction', url, outcome.durationMs)
      // The lookup and inserts run in one turn of the main process, so a
      // Capture deleted while its extraction ran gets no rows.
      if (captureRepo.getCapture(captureId)) {
        saveFieldBuild(captureId, url, outcome.fieldBuild)
        if (outcome.ok) extractedDataRepo.insertExtractedData(captureId, caseId, url, outcome.rows)
      }
      if (!outcome.ok) throw outcome.error
    } catch (err) {
      logger.error(
        'captureLifecycle',
        'capture.extraction_failed',
        { captureId: ident(captureId) },
        err
      )
    }
  }

  // Writes the field build the process reported. An outcome with no build is a
  // process failure (exit, timeout, dispose at quit), not a build the extractor
  // ran and failed, so it writes no row: a Capture with no row is one the next
  // Case open builds through ensureCaseFields, where a `failed` row would wait
  // for a reprocess.
  function saveFieldBuild(
    captureId: string,
    url: string,
    fieldBuild: ExtractionOutcome['fieldBuild']
  ): void {
    if (!fieldBuild) return
    recordSlowOp('field-index', url, fieldBuild.durationMs)
    let error: Error | undefined
    if (!fieldBuild.ok) {
      error = new Error(fieldBuild.error.message)
      error.name = fieldBuild.error.name
      if (fieldBuild.error.code) Object.assign(error, { code: fieldBuild.error.code })
    }
    const result = fieldBuild.ok
      ? fieldBuild.result
      : { fields: [], textHash: null, outcome: 'failed' as const, skippedJson: null }
    try {
      writeFieldBuild(captureId, result, error)
    } catch (err) {
      logger.error(
        'captureLifecycle',
        'searchFields.build_failed',
        { captureId: ident(captureId) },
        err
      )
    }
  }

  function runFieldBuild(captureId: string, url: string): void {
    const t0 = performance.now()
    try {
      buildExhibitFields(captureId, store)
    } catch (err) {
      logger.error(
        'captureLifecycle',
        'searchFields.build_failed',
        { captureId: ident(captureId) },
        err
      )
    } finally {
      recordSlowOp('field-index', url, performance.now() - t0)
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

      if (deps.extraction) void runCaptureProcessing(captureId, caseId, url)
      else runFieldBuild(captureId, url)
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
  // already rolled the entry back by then. The two throws left are faults no
  // outcome can state honestly: the manifest rollback itself failed, or a
  // staged file could not be moved back (StagedRestoreError).
  //
  // Files are staged, not unlinked (#1786): an unlink cannot be undone, so a
  // fault on the second file used to leave the first one gone under a
  // `rolled_back` outcome. Staging renames them aside, the row delete commits,
  // and only then are they purged. Every fault before the commit moves them
  // back, which is what `rolled_back` claims.
  async function deleteOne(
    capture: Capture,
    deletionChain: DeletionChain,
    reason?: string
  ): Promise<DeleteOneResult> {
    const captureId = capture.id
    // Decision 10: only the author writes `deletion` for their Exhibit. A deletion here would
    // name a teammate's Capture in this installation's chain, and the next sync brings it back.
    if (isReceived(captureId)) {
      return { outcome: { captureId, status: 'rejected', reason: 'not_author' } }
    }
    if (capture.format === 'mhtml') {
      const caseDir = store.caseDir(capture.caseId)
      const headBefore = getManifestHead(caseDir).nextIndex
      let stage: 'artifacts' | 'db' = 'artifacts'
      try {
        await withDeletionEntry(
          caseDir,
          {
            captureId: deletionChain.idOf(capture),
            caseId: capture.caseId,
            contentHash: capture.hash,
            operatorId: getInstallationId(),
            operatorName: getSettings().operatorName ?? '',
            toolVersion: resolveToolVersion(),
            ...(reason !== undefined ? { reason } : {})
          },
          () => {
            // Files aside first, DB row second: a staging fault leaves row,
            // files and (after the seam's rollback) manifest as they were.
            store.stageArtifacts(capture.caseId, captureId, derivedFileNames(capture))
            stage = 'db'
            deleteRowOrRestore(capture, deletionChain.reachesMembers(capture))
          }
        )
      } catch (err) {
        // `rolled_back` asserts the entry is not in the chain and the files
        // are back. A failed rollback truncate (the #622 artefact) or a failed
        // restore makes that claim false, so surface it as a throw.
        if (err instanceof StagedRestoreError) throw err
        if (getManifestHead(caseDir).nextIndex !== headBefore) throw err
        return {
          outcome: { captureId, status: 'rolled_back', stage, error: outcomeError(err) },
          cause: err
        }
      }
      purgeAfterCommit(capture)
      return { outcome: { captureId, status: 'deleted' } }
    }

    // Legacy html capture: no manifest entry exists for it, so none is written
    // (as before). Same stage, commit, purge order as the MHTML branch.
    return removeUnmanifested(capture, false)
  }

  // Removes a Capture's row and files without writing a manifest entry: a legacy html capture,
  // which has none, or a received one, whose author's chain already holds the deletion (#1811).
  // `chained` is whether other members hold the Capture: a received one only.
  function removeUnmanifested(capture: Capture, chained: boolean): DeleteOneResult {
    const captureId = capture.id
    try {
      store.stageArtifacts(capture.caseId, captureId, derivedFileNames(capture))
    } catch (err) {
      if (err instanceof StagedRestoreError) throw err
      return {
        outcome: { captureId, status: 'rolled_back', stage: 'artifacts', error: outcomeError(err) },
        cause: err
      }
    }
    let deleted: boolean
    try {
      deleted = captureRepo.deleteCapture(captureId, chained)
    } catch (err) {
      store.restoreStaged(capture.caseId, captureId)
      throw err
    }
    if (!deleted) {
      // The row vanishing between snapshot and delete is the same "not there"
      // the snapshot would have reported; its files go back where they were.
      store.restoreStaged(capture.caseId, captureId)
      return { outcome: { captureId, status: 'rejected', reason: 'not_found' } }
    }
    purgeAfterCommit(capture)
    return { outcome: { captureId, status: 'deleted_unmanifested' } }
  }

  // The id each `deletion` entry names its Capture by, and whether the Capture
  // reaches other members, for one delete or one batch under the case slot. A
  // batch appends only `deletion` entries, so the existing entries and imports
  // stay fixed across it, and one verified read, taken for the first MHTML row,
  // serves every row. So does one read of the id maps, taken for the first
  // renamed row: deleting rows can only relax that read, never tighten it, so
  // the batch keeps the stricter answer. Only an archive import writes an
  // `import` entry, and it writes the anchored id map beside it, so without
  // that file every row keeps its own id, every chained Capture is in the
  // current segment, and no chain is read.
  function deletionChainOf(caseDir: string): DeletionChain {
    const chained = (capture: Capture): boolean => capture.manifestIndex !== undefined
    if (!existsSync(join(caseDir, IMPORT_ID_MAP_FILENAME))) {
      return { idOf: ({ id }) => id, reachesMembers: chained }
    }
    let read: { own: AuthorChain; describes: ReturnType<typeof rowDescriber> } | undefined
    const readOnce = (): NonNullable<typeof read> => {
      if (!read) {
        const { own } = readCaseChains(caseDir)
        read = { own, describes: rowDescriber(caseDir, own) }
      }
      return read
    }
    return {
      idOf: (capture) => {
        const { own, describes } = readOnce()
        return own.chain.valid ? signedCaptureId(capture, own.entries, describes) : capture.id
      },
      reachesMembers: ({ manifestIndex }) =>
        manifestIndex !== undefined && entryReachesMembers(manifestIndex, readOnce().own.imports)
    }
  }

  // A Derived File an archive import restored keeps the name its signed entry
  // gives it, which for a renamed Capture is not the row's own id (#1813), so
  // the store's own naming misses it. Read before the row delete cascades its
  // rows away. A file named for another Capture of this Case is left alone.
  function derivedFileNames(capture: Capture): string[] {
    return listDerivedFilesForExhibit(capture.id).flatMap(({ path }) => {
      if (dirname(path) !== capture.caseId) return []
      const name = basename(path)
      const named = parseArtifactFilename(name)?.captureId
      if (named === undefined) return []
      if (named !== capture.id && captureRepo.getCapture(named)?.caseId === capture.caseId) {
        return []
      }
      return [name]
    })
  }

  function isReceived(captureId: string): boolean {
    return typeof getExhibit(captureId)?.authorInstallationId === 'string'
  }

  // The commit step of a staged delete. A failed or refused row delete puts
  // the staged files back before the error reaches the manifest seam.
  function deleteRowOrRestore(capture: Capture, chained: boolean): void {
    let deleted: boolean
    try {
      deleted = captureRepo.deleteCapture(capture.id, chained)
    } catch (err) {
      store.restoreStaged(capture.caseId, capture.id)
      throw err
    }
    if (!deleted) {
      store.restoreStaged(capture.caseId, capture.id)
      throw new ManifestRollback()
    }
  }

  // Past the commit the row is gone and the entry is permanent, so a purge
  // fault must not change the outcome. The leftover directory is logged and
  // swept by recoverPendingDeletes.
  function purgeAfterCommit(capture: Capture): void {
    try {
      store.purgeStaged(capture.caseId, capture.id)
    } catch (err) {
      logger.error(
        'captureLifecycle',
        'captureLifecycle.delete_purge_failed',
        { captureId: ident(capture.id) },
        err
      )
    }
  }

  // Resolves staging directories a crash or a failed restore left in a Case
  // (#1786). A live row means the delete never committed: its files go back.
  // A missing row means it did: the leftovers are purged. Never throws, so a
  // stuck file cannot block deleting other captures; a failure is logged and
  // retried on the next pass.
  function recoverCase(caseId: string): void {
    let staged: string[]
    try {
      staged = store.listStagedDeletes(caseId)
    } catch (err) {
      logger.error('captureLifecycle', 'captureLifecycle.delete_recovery_failed', undefined, err)
      return
    }
    for (const captureId of staged) {
      try {
        if (captureRepo.getCapture(captureId)) store.restoreStaged(caseId, captureId)
        else store.purgeStaged(caseId, captureId)
      } catch (err) {
        logger.error(
          'captureLifecycle',
          'captureLifecycle.delete_recovery_failed',
          { captureId: ident(captureId) },
          err
        )
      }
    }
  }

  // Which case a request lands in, or why it cannot. Case resolution runs
  // BEFORE the exclusion check (#400): exclusions are per-case, and 'override'
  // mode has to be able to bypass the global list, so the mode cannot be known
  // until the case is. Observable consequence, pinned in the tests: an
  // excluded URL with a missing, unknown or archived case answers the case
  // refusal rather than the exclusion one, and emits no 'skipped' event.
  function resolveAdmittedCase(
    request: AdmissionRequest
  ): { caseId: string } | { refusal: AdmissionRefusal } {
    if (request.route === 'auto') {
      const session = sessionService.snapshot()
      if (!session.sessionActive) return { refusal: { kind: 'no_active_session' } }
      if (!session.activeCaseId) return { refusal: { kind: 'no_active_case' } }
      return { caseId: session.activeCaseId }
    }
    if (!request.caseId) return { refusal: { kind: 'missing_case_id' } }
    const caseData = caseRepo.getCase(request.caseId)
    if (!caseData) return { refusal: { kind: 'case_not_found' } }
    if (caseData.archived) return { refusal: { kind: 'case_archived' } }
    return { caseId: request.caseId }
  }

  const lifecycle: CaptureLifecycle = {
    async ingest(params) {
      const egressIsDirect = deps.egressIsDirect ?? (() => currentEgress().kind === 'direct')
      const tlsSkipped =
        params.tlsSkipped ??
        ((params.egress !== undefined || !egressIsDirect()) && wouldRefetchTls(params.url)
          ? 'egress-not-direct'
          : undefined)
      const result = await ingestMhtmlCapture(
        { ...params, tlsSkipped },
        deps.fetchTlsCertChain ?? defaultFetchCertChain,
        store
      )
      // Hand off to the trusted-timestamp worker without blocking the capture.
      deps.enqueueTimestamp?.(result.capture.id)
      runPostCaptureWork(result.capture.id, params.caseId, params.url, params.textContent)
      return result
    },

    async admit(request) {
      const { route, url } = request
      const source: CaptureSource = route === 'attach' ? 'manual' : route
      const now = (): string => new Date().toISOString()
      // Both resolved at entry, as the upload route did before admission moved
      // here: the fallback timestamp is the value the manifest entry signs, so
      // it must not drift with how long the policy checks or the screenshot
      // read take, and `durationMs` on the stored event has always covered
      // that work too.
      const startTime = Date.now()
      const timestamp = request.timestamp || now()
      try {
        const operatorName = trimmedOperatorName()
        if (!operatorName) {
          emitCaptureEvent({
            type: 'failed',
            source,
            url,
            timestamp: now(),
            error: 'Operator name required'
          })
          return { ok: false, refusal: { kind: 'operator_name_required' } }
        }

        const resolved = resolveAdmittedCase(request)
        if ('refusal' in resolved) return { ok: false, refusal: resolved.refusal }
        const { caseId } = resolved

        // The list blocks every capture route into this case, manual included
        // (ruled 2026-08-21). An operator who excludes a URL from a case means
        // it, and a rule that permits the one route that currently works would
        // be worse than no rule.
        const blocked = matchCaseExclusion(url, caseId)
        if (blocked) {
          emitCaptureEvent({
            type: 'skipped',
            source,
            url,
            timestamp: now(),
            skipReason: blockedSkipReason(blocked)
          })
          return { ok: false, refusal: { kind: 'excluded', pattern: blocked } }
        }

        if (route === 'manual') {
          const dedupeKey = caseId + ':' + url
          const lastSeen = manualDedup.get(dedupeKey)
          if (lastSeen && Date.now() - lastSeen < MANUAL_DEDUPE_WINDOW_MS) {
            emitCaptureEvent({
              type: 'skipped',
              source,
              url,
              timestamp: now(),
              skipReason: 'Duplicate manual capture'
            })
            return { ok: false, refusal: { kind: 'duplicate' } }
          }
          manualDedup.set(dedupeKey, Date.now())
        }

        emitCaptureEvent({ type: 'received', source, url, timestamp: now() })

        const { screenshot, screenshotWarning } = await readScreenshot(request.screenshot)

        // No `method` passed: the row defaults to 'extension', which is honest
        // for every route here — the bytes came from the operator's own
        // browser tab (R2), never from a hidden window.
        const { capture, contentHash } = await lifecycle.ingest({
          caseId,
          url,
          title: request.title || url,
          timestamp,
          stream: request.stream,
          textContent: request.textContent,
          headers: request.headers,
          browserVersion: request.browserVersion,
          userAgent: request.userAgent,
          httpStatus: request.httpStatus,
          extensionVersion: request.extensionVersion,
          operatorId: getInstallationId(),
          operatorName,
          toolVersion: resolveToolVersion(),
          screenshot
        })

        if (route === 'auto') sessionService.countCapture()
        emitNewCapture(capture)
        emitCaptureEvent({
          type: 'stored',
          captureId: capture.id,
          source,
          url,
          timestamp: now(),
          durationMs: Date.now() - startTime,
          screenshotWarning
        })
        return {
          ok: true,
          capture,
          contentHash,
          screenshotStatus: screenshotWarning ? 'dropped' : screenshot ? 'saved' : 'none',
          screenshotWarning
        }
      } catch (err) {
        logger.error('captureLifecycle', 'capture.failed', undefined, err)
        emitCaptureEvent({ type: 'failed', source, url, timestamp: now(), error: String(err) })
        return { ok: false, refusal: { kind: 'failed', error: err } }
      }
    },

    async delete(captureId, reason) {
      const probe = captureRepo.getCapture(captureId)
      if (!probe) return false
      return withCaseSlot(probe.caseId, async () => {
        recoverCase(probe.caseId)
        // Re-read under the slot: a batch ahead of us in the queue may have
        // removed it while we waited.
        const capture = captureRepo.getCapture(captureId)
        if (!capture) return false
        const deletionChain = deletionChainOf(store.caseDir(capture.caseId))
        const { outcome, cause } = await deleteOne(capture, deletionChain, reason)
        if (cause !== undefined && !(cause instanceof ManifestRollback)) throw cause
        return outcome.status === 'deleted' || outcome.status === 'deleted_unmanifested'
      })
    },

    processReceived({ id, caseId, url }, textContent) {
      // No timestamp hand-off and no new-capture event: the author stamps their own Capture,
      // and nothing was captured here.
      runPostCaptureWork(id, caseId, url, textContent)
    },

    async removeReceived(captureId) {
      const probe = captureRepo.getCapture(captureId)
      if (!probe || !isReceived(captureId)) return false
      return withCaseSlot(probe.caseId, async () => {
        recoverCase(probe.caseId)
        const capture = captureRepo.getCapture(captureId)
        if (!capture || !isReceived(captureId)) return false
        const { outcome, cause } = removeUnmanifested(capture, true)
        if (cause !== undefined) throw cause
        return outcome.status === 'deleted_unmanifested'
      })
    },

    async deleteMany(caseId, captureIds) {
      return withCaseSlot(caseId, async () => {
        recoverCase(caseId)
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
        const deletionChain = deletionChainOf(caseDir)
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
          const { outcome } = await deleteOne(capture, deletionChain)
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

    async recoverPendingDeletes() {
      let caseIds: string[]
      try {
        caseIds = caseRepo.listAllCaseIds()
      } catch (err) {
        logger.error('captureLifecycle', 'captureLifecycle.delete_recovery_failed', undefined, err)
        return
      }
      for (const id of caseIds) {
        await withCaseSlot(id, async () => recoverCase(id))
      }
    },

    async duplicate(captureId) {
      const probe = captureRepo.getCapture(captureId)
      if (!probe) return { status: 'rejected', reason: 'not_found' }
      // The gate `admit` applies to every ingest. The duplicate is signed by
      // whoever asks for it, not by the source's operator.
      const operatorName = trimmedOperatorName()
      if (!operatorName) return { status: 'rejected', reason: 'operator_name_required' }

      // Under the case slot for the same reason deletes are: this appends to
      // the case's one manifest file and rolls back by truncation.
      return withCaseSlot(probe.caseId, async () => {
        const source = captureRepo.getCapture(captureId)
        if (!source) return { status: 'rejected', reason: 'not_found' }

        // One gate covering legacy, missing, tampered and chain-broken sources.
        // Copying any of those would mint a fresh, internally consistent,
        // signed entry for bytes that no longer stand up — the duplicate would
        // verify while the thing it was taken from does not.
        const verification = await verifyCapture(captureId, store)
        if (verification.status !== 'verified') {
          return { status: 'rejected', reason: 'not_verified', detail: verification.status }
        }

        const caseDir = store.caseDir(source.caseId)
        // Re-anchor from the SIGNED entry, never from the captures row: the row
        // mirrors these fields but Settings → Database can hand-edit it, and
        // re-signing an edited mirror would launder it onto the chain.
        const entryRead =
          source.manifestIndex !== undefined
            ? readCaptureEntryAt(caseDir, source.manifestIndex)
            : undefined
        if (!entryRead) {
          return { status: 'rejected', reason: 'not_verified', detail: 'entry-unreadable' }
        }
        const { entry: sourceEntry } = entryRead
        // The row's manifestIndex is as hand-editable as the fields above, and
        // duplicates share content hashes by design — so an edited index can
        // land on a DIFFERENT capture's same-hash entry, whose url/timestamp/
        // headers/tls would then be re-signed as this source's provenance.
        // Bind the entry to the row it must describe.
        if (
          !entryDescribesRow(
            { caseId: sourceEntry.caseId, rowId: sourceEntry.captureId },
            source,
            entryRead,
            caseDir
          )
        ) {
          return { status: 'rejected', reason: 'not_verified', detail: 'entry-mismatch' }
        }

        const duplicateId = randomUUID()
        // Flipped when withCaptureEntry commits: past that point the entry and
        // row are permanent, and the catch below must not delete files a
        // committed record points at.
        let committed = false
        try {
          const { artifacts } = await store.copyArtifacts(source.caseId, source.id, duplicateId)
          const mhtml = artifacts.mhtml
          // copyArtifacts hashes the destination file, so this compares what
          // landed against what the chain anchors — closing the window between
          // the verify above and the copy.
          if (!mhtml || mhtml.hash !== sourceEntry.contentHash) {
            store.deleteArtifacts(source.caseId, duplicateId)
            return { status: 'rejected', reason: 'copy_mismatch' }
          }
          // Sidecars get the same treatment as the MHTML: each copy is checked
          // against the hash the source's SIGNED entry recorded, and only those
          // recorded hashes are re-anchored. A source entry from before sidecar
          // anchoring (#118) records none — verify skipped its files, so
          // anchoring a freshly computed hash here would give possibly-tampered
          // bytes the first chain anchor they ever had. The files are still
          // copied (the duplicate stays usable); they stay exactly as
          // unanchored as the source's.
          if (sourceEntry.screenshotHash && artifacts.png?.hash !== sourceEntry.screenshotHash) {
            store.deleteArtifacts(source.caseId, duplicateId)
            return { status: 'rejected', reason: 'copy_mismatch' }
          }
          if (sourceEntry.textHash && artifacts.txt?.hash !== sourceEntry.textHash) {
            store.deleteArtifacts(source.caseId, duplicateId)
            return { status: 'rejected', reason: 'copy_mismatch' }
          }
          if (
            sourceEntry.transactionRecordHash &&
            artifacts['warc.gz']?.hash !== sourceEntry.transactionRecordHash
          ) {
            store.deleteArtifacts(source.caseId, duplicateId)
            return { status: 'rejected', reason: 'copy_mismatch' }
          }
          if (sourceEntry.pdfHash && artifacts.pdf?.hash !== sourceEntry.pdfHash) {
            store.deleteArtifacts(source.caseId, duplicateId)
            return { status: 'rejected', reason: 'copy_mismatch' }
          }

          const duplicatedAt = new Date().toISOString()
          // The duplicate's search text comes from ITS OWN copied .txt bytes,
          // never the source's `capture_texts` mirror: the mirror is editable
          // state that can drift from the artifact, and a source with indexed
          // text but no sidecar would make the copy searchable for bytes it
          // does not own. Searchable exactly as far as its own artifacts reach.
          const copiedText = artifacts.txt
            ? store.readArtifact(source.caseId, duplicateId, 'txt')?.toString('utf-8')
            : undefined
          // A copy is a new Exhibit and takes a number of its own, with no
          // await before the append below (see nextExhibitNumber).
          const exhibitNumber = nextExhibitNumber(source.caseId, store)
          const capture = await withCaptureEntry(
            caseDir,
            {
              captureId: duplicateId,
              caseId: source.caseId,
              // `url` and `timestamp` describe the observation the bytes came
              // from, which is the source's — dating them to now would claim
              // the page was seen again. When the copy was made is
              // `duplicatedAt`; who made it is `operatorId`/`operatorName`.
              url: sourceEntry.url,
              timestamp: sourceEntry.timestamp,
              contentHash: mhtml.hash,
              screenshotHash: sourceEntry.screenshotHash,
              textHash: sourceEntry.textHash,
              headers: sourceEntry.headers,
              // Re-anchored from the source's SIGNED entry, never from its row
              // (R7, #797). A source captured before R7 anchored no status and
              // no final URL, so the copy's entry states none either — reading
              // the hand-editable mirror here would give the copy a chain
              // anchor its source never had.
              httpStatus: sourceEntry.httpStatus,
              finalUrl: sourceEntry.finalUrl,
              tls: sourceEntry.tls,
              method: 'duplicate',
              duplicateOfCaptureId: source.id,
              duplicatedAt,
              consentSuppression: sourceEntry.consentSuppression,
              exhibitNumber,
              // The Egress the source was sent through, re-anchored from its signed
              // entry like `tls` above (ADR-0032).
              egressKind: sourceEntry.egressKind,
              egressLabel: sourceEntry.egressLabel,
              userAgent: sourceEntry.userAgent,
              tlsSkipped: sourceEntry.tlsSkipped,
              // The capture engine's facts about the copied files (D11 of
              // docs/plans/2026-10-10-capture-engine-first-slice.md). No
              // `boundTls` or `boundTlsAbsent`: `CONTEXT.md` has Bound TLS
              // Details absent for `duplicate` Captures.
              inventory: sourceEntry.inventory,
              scrollToLoad: sourceEntry.scrollToLoad,
              transactionRecordHash: sourceEntry.transactionRecordHash,
              pdfHash: sourceEntry.pdfHash,
              sizeBytes: mhtml.sizeBytes,
              operatorId: getInstallationId(),
              operatorName,
              toolVersion: resolveToolVersion()
            },
            (manifestResult) =>
              captureRepo.insertCapture({
                id: duplicateId,
                caseId: source.caseId,
                url: sourceEntry.url,
                title: source.title,
                hash: mhtml.hash,
                timestamp: sourceEntry.timestamp,
                headers: sourceEntry.headers ? JSON.stringify(sourceEntry.headers) : undefined,
                textContent: copiedText,
                format: 'mhtml',
                mhtmlPath: mhtml.rel,
                screenshotPath: artifacts.png?.rel,
                // The row mirrors the entry, so it too states only what the
                // chain anchors.
                screenshotHash: sourceEntry.screenshotHash,
                textHash: sourceEntry.textHash,
                tlsCertChain: sourceEntry.tls ? JSON.stringify(sourceEntry.tls) : undefined,
                sizeBytes: mhtml.sizeBytes,
                manifestIndex: manifestResult.index,
                prevHash: manifestResult.prevHash,
                entryHash: manifestResult.entryHash,
                // The tool that made the copy, not the one that made the
                // capture: this is the entry's own provenance.
                toolVersion: resolveToolVersion(),
                extensionVersion: source.extensionVersion,
                browserVersion: source.browserVersion,
                userAgent: source.userAgent,
                // Anchored provenance, so the mirror states what the chain
                // does rather than what the source row happens to hold.
                httpStatus: sourceEntry.httpStatus,
                operatorId: getInstallationId(),
                operatorName,
                method: 'duplicate',
                duplicateOfCaptureId: source.id,
                consentSuppression: sourceEntry.consentSuppression,
                exhibitNumber
              })
          )

          committed = true

          // No separate hand-off to the timestamp worker: the duplicate's
          // content hash is the source's, so a token over that hash already
          // anchors these bytes and a second request would ask the TSA to date
          // the same observation twice. The mirror is resolved from the
          // manifest instead, which gives the copy whatever axis value the
          // shared hash has — 'rfc3161' when a token exists, 'pending' while
          // the source is still eligible and unstamped, which does put the copy
          // in the retry queue. Whichever row is stamped, the entry anchors
          // both.
          try {
            reconcileCaptureTrustedTime(capture)
          } catch (reconcileErr) {
            // Rebuildable mirror only — it self-heals on the next read
            // (computeVerification reconciles), so a failure here must not
            // fail a duplicate whose entry, row and files are committed.
            logger.error(
              'captureLifecycle',
              'captureLifecycle.duplicate_reconcile_failed',
              { captureId: ident(duplicateId) },
              reconcileErr
            )
          }
          // A copy is a new Exhibit with search field records of its own. Ingest builds
          // them in runPostCaptureWork, which a duplicate does not run.
          setImmediate(() => {
            if (deps.extraction) {
              void runCaptureProcessing(duplicateId, source.caseId, sourceEntry.url)
            } else runFieldBuild(duplicateId, sourceEntry.url)
          })
          return { status: 'duplicated', capture: captureRepo.getCapture(duplicateId) ?? capture }
        } catch (err) {
          // Pre-commit only: the manifest seam has already rolled its own entry
          // back, and the copied files are namespaced by the new id, so the
          // source is untouched. Past the commit the entry and row are
          // permanent, and deleting the files would strand a committed capture
          // without its evidence.
          if (!committed) {
            try {
              store.deleteArtifacts(source.caseId, duplicateId)
            } catch (cleanupErr) {
              // The original failure is what the caller must see, so a failed
              // cleanup is logged rather than thrown over it — but it is logged:
              // the copies it left behind are unreferenced bytes in the case
              // directory, and silence is what makes them unattributable later.
              logger.error(
                'captureLifecycle',
                'captureLifecycle.duplicate_cleanup_failed',
                { captureId: ident(duplicateId) },
                cleanupErr
              )
            }
          }
          throw err
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
          await runCaptureProcessing(cap.id, caseId, cap.url)
        } catch (err) {
          logger.error(
            'captureLifecycle',
            'captureLifecycle.reprocess_failed',
            { captureId: ident(cap.id) },
            err
          )
        }
      }
      if (!deps.extraction) {
        try {
          await rebuildCaseFields(caseId, store)
        } catch (err) {
          logger.error(
            'captureLifecycle',
            'searchFields.ensure_failed',
            { caseId: ident(caseId) },
            err
          )
        }
      }
      return { processed: captures.length }
    }
  }
  return lifecycle
}
