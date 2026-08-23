import { app, dialog, shell } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc'
import { DEFAULT_ANALYSIS_SYSTEM_PROMPT, MAX_BATCH_CAPTURE_IDS } from '@shared/constants'
import { safeFilename } from '@shared/safeFilename'
import { MENTION_TARGET_TYPES } from '@shared/noteDoc'
import { validateIgnorePattern } from '@shared/urlPatterns'
import type {
  CreateCaseParams,
  UpdateCaseParams,
  SetAutoCapturePolicyParams,
  CreateTagParams,
  UpdateTagParams,
  CaptureTagParams,
  CreateSelectorParams,
  UpdateSelectorParams,
  CreateNoteParams,
  UpdateNoteParams,
  NoteBacklinksParams,
  PinWaybackSnapshotParams,
  BulkCreateSelectorsParams,
  DbTableRowsParams,
  DbCreateRowParams,
  DbUpdateRowParams,
  DbRowIdentifier,
  DbExportTableParams,
  DbRestoreSnapshotParams,
  OrphanReport,
  AnalyzeCaptureParams,
  SaveAnnotationsParams,
  UpsertAnnotationPinParams,
  ExportResult,
  ArchiveExportResult,
  RecaptureEnqueuePayload,
  SelfTestResult,
  SessionStateEvent,
  CaptureBatchPayload
} from '@shared/ipc'
import * as dbAdmin from '@main/services/db/dbAdmin'
import * as dbSnapshots from '@main/services/db/dbSnapshots'
import { existsSync } from 'fs'
import { join, resolve } from 'path'
import { pathToFileURL } from 'url'
import * as activityRepo from '@main/services/db/activityRepo'
import * as caseRepo from '@main/services/db/caseRepo'
import * as captureRepo from '@main/services/db/captureRepo'
import * as tagRepo from '@main/services/db/tagRepo'
import * as selectorRepo from '@main/services/db/selectorRepo'
import * as noteRepo from '@main/services/db/noteRepo'
import * as noteReferenceRepo from '@main/services/db/noteReferenceRepo'
import * as waybackRefRepo from '@main/services/db/waybackRefRepo'
import * as extractedDataRepo from '@main/services/db/extractedDataRepo'
import * as annotations from '@main/services/annotations'
import { defaultCaptureStore } from '@main/services/captureStore'
import { renderCapturePdf } from '@main/services/pdfExport'
import { getThumbnail } from '@main/services/thumbnails'
import * as settings from '@main/services/settings'
import * as openrouter from '@main/services/openrouter'
import * as analysisService from '@main/services/ai/analysisService'
import { generateReport, getExportPreflight } from '@main/services/export'
import {
  exportCaseArchive,
  inspectCaseArchive,
  importCaseArchive
} from '@main/services/caseArchive'
import { getExtensionPath, extensionPathExists } from '@main/services/extensionPath'
import { lookupSnapshots, isPersistableSnapshot } from '@main/services/waybackMachine'
import { buildCsv } from '@main/services/csvEscape'
import { getInstallationId } from '@main/services/installationId'
import { CAPTURE_SERVER_PORT } from '@main/services/captureServer'
import { getServerToken } from '@main/services/serverToken'
import { getStorageRoot } from '@main/services/storage'
import { resolveTrustedTime } from '@main/services/trustedTime'
import { BatchCrossCaseError } from '@main/services/captureLifecycle'
import type { CaptureLifecycle } from '@main/services/captureLifecycle'
import type { SelectorLifecycle } from '@main/services/selectorLifecycle'
import type { RecaptureService } from '@main/services/recapture'
import type { UpdaterService } from '@main/services/updater'
import type { SessionService } from '@main/services/session'
import { handle, IpcFailure, sendEvent } from '@main/ipcWrap'
import { diagnosticsService } from '@main/services/diagnostics'
import { scanUnreconciledDeletions } from '@main/services/deletionReconciliation'
import { flushSync, getLogDir, getLogPath, logger, readRecentEntries } from '@main/services/logger'
import { takeUncleanSession } from '@main/services/sessionLog'
import { buildBugReport, bugReportFilename } from '@main/services/bugReport'
import { ValidatedError, context, errorName, ident, isLogCode } from '@main/services/logSafe'
import type { LogContext, LogValue } from '@main/services/logSafe'
import type {
  BirdbrainSettings,
  Capture,
  ExportOptions,
  CaptureAnalysis,
  ArchiveInspectReport
} from '@shared/types'

// Self-test fetches must fail fast when the capture server is down. Without an
// explicit timeout they inherit undici's 10s default, which on platforms whose
// loopback drops (rather than refuses) SYNs to unbound ports — e.g. WSL2 — hangs
// long enough to blow past test/UI deadlines.
const SELF_TEST_TIMEOUT_MS = 2000

// Reveal/open is limited to files THIS process authored (export outputs). A
// renderer — even a compromised one — can't hand shell.openPath an arbitrary
// binary, because only paths recorded here on a successful export are openable.
// Bounded with FIFO eviction so the allowlist can't grow for the life of the
// process; only recent exports stay openable.
const MAX_REVEALABLE_PATHS = 64
const revealablePaths = new Set<string>()

// Shape and size check for every batch channel (#394). Rejects before any
// lookup so a malformed or oversized payload can never reach a repo or the
// lifecycle.
function validateBatchPayload(payload: unknown): CaptureBatchPayload {
  const p = payload as Partial<CaptureBatchPayload> | null | undefined
  if (
    !p ||
    typeof p.caseId !== 'string' ||
    !Array.isArray(p.captureIds) ||
    p.captureIds.length > MAX_BATCH_CAPTURE_IDS ||
    !p.captureIds.every((id) => typeof id === 'string')
  ) {
    throw new IpcFailure('Invalid batch payload', 'INVALID_BATCH_PAYLOAD')
  }
  return { caseId: p.caseId, captureIds: p.captureIds }
}

// Same-case snapshot for the metadata batches (#394): ids whose row lives in
// another case fail the whole call before any write, stale ids are dropped so
// `affected` tells the truth. These batches touch no manifest and no lifecycle
// — tags and favorites are not evidence — so there is nothing here to roll
// back beyond the repo's own transaction.
function snapshotSameCase(caseId: string, captureIds: string[]): Capture[] {
  const rows = captureRepo.getCapturesByIds([...new Set(captureIds)])
  const crossCase = rows.filter((c) => c.caseId !== caseId).map((c) => c.id)
  if (crossCase.length > 0) {
    throw new IpcFailure(
      'Capture ids belong to a different case: ' + crossCase.join(', '),
      'BATCH_CROSS_CASE'
    )
  }
  return rows
}

function rememberRevealablePath(filePath: string): void {
  const resolved = resolve(filePath)
  // delete-then-add so re-exporting the same destination refreshes its recency.
  // Set.add on an already-present value keeps its original insertion position,
  // which would let a just-rewritten path be evicted by newer unrelated exports.
  revealablePaths.delete(resolved)
  revealablePaths.add(resolved)
  if (revealablePaths.size > MAX_REVEALABLE_PATHS) {
    revealablePaths.delete(revealablePaths.values().next().value as string)
  }
}

export function registerIpcHandlers(deps: {
  selectorLifecycle: SelectorLifecycle
  captureLifecycle: CaptureLifecycle
  recaptureService: RecaptureService
  updaterService: UpdaterService
  sessionService: SessionService
}): void {
  const { selectorLifecycle, captureLifecycle, recaptureService, updaterService, sessionService } =
    deps
  // Cases
  handle(IPC_CHANNELS.CASES_LIST, () => caseRepo.listCases())
  handle(IPC_CHANNELS.CASES_GET, (_, id: string) => caseRepo.getCase(id))
  handle(IPC_CHANNELS.CASES_CREATE, (_, params: CreateCaseParams) => caseRepo.createCase(params))
  handle(IPC_CHANNELS.CASES_UPDATE, (_, params: UpdateCaseParams) => caseRepo.updateCase(params))
  handle(IPC_CHANNELS.CASES_DELETE, (_, id: string) => caseRepo.deleteCase(id))
  handle(IPC_CHANNELS.CASES_RECENT_ACTIVITY, (_, limit?: number) =>
    activityRepo.listRecentActivity(limit)
  )
  handle(IPC_CHANNELS.CASES_GET_AUTO_CAPTURE_POLICY, (_, caseId: string) =>
    caseRepo.getAutoCapturePolicy(caseId)
  )
  handle(IPC_CHANNELS.CASES_SET_AUTO_CAPTURE_POLICY, (_, params: SetAutoCapturePolicyParams) => {
    const { caseId, exclusions, mode } = params
    // Refused at the write seam, naming the pattern. matchIgnoredUrl skips a
    // pattern that throws, so storing an uncompilable one would leave the
    // operator looking at an exclusion chip that excludes nothing — an absence
    // of enforcement they had every reason to believe was in place (#400).
    for (const pattern of exclusions) {
      const result = validateIgnorePattern(pattern)
      if (!result.ok) {
        throw new IpcFailure(`Invalid exclusion pattern "${pattern}": ${result.reason}`)
      }
    }
    const saved = caseRepo.setAutoCapturePolicy(caseId, { exclusions, mode })
    if (!saved) throw new IpcFailure('Case not found')
    return saved
  })

  handle(
    IPC_CHANNELS.CASES_EXPORT_ARCHIVE,
    async (event, caseId: string): Promise<ArchiveExportResult> => {
      const caseData = caseRepo.getCase(caseId)
      if (!caseData) throw new IpcFailure('Case not found', 'NOT_FOUND')
      const { canceled, filePath } = await dialog.showSaveDialog({
        defaultPath: `${safeFilename(caseData.name, 'case')}.birdbrain`,
        filters: [{ name: 'Birdbrain Case Archive', extensions: ['birdbrain'] }]
      })
      if (canceled || !filePath) return { canceled: true }
      await exportCaseArchive(caseId, filePath, (step, percent) =>
        sendEvent(event.sender, IPC_CHANNELS.ARCHIVE_PROGRESS, {
          caseId,
          step,
          percent
        })
      )
      // Permit reveal for this freshly-written archive only (same invariant as export:generate).
      rememberRevealablePath(filePath)
      return { canceled: false, filePath }
    }
  )

  handle(IPC_CHANNELS.CASES_INSPECT_ARCHIVE, async (): Promise<ArchiveInspectReport | null> => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Import Case Archive',
      filters: [{ name: 'Birdbrain Case Archive', extensions: ['birdbrain'] }],
      properties: ['openFile']
    })
    if (canceled || filePaths.length === 0) return null
    return inspectCaseArchive(filePaths[0])
  })

  handle(
    IPC_CHANNELS.CASES_IMPORT_ARCHIVE,
    async (event, archivePath: string, overrideTamper: boolean): Promise<{ newCaseId: string }> => {
      const { newCaseId } = await importCaseArchive(
        archivePath,
        { overrideTamper },
        (step, percent) =>
          sendEvent(event.sender, IPC_CHANNELS.ARCHIVE_PROGRESS, {
            step,
            percent
          })
      )
      return { newCaseId }
    }
  )

  // Session. The extension drives sessions over HTTP; these are the renderer's
  // equivalent, backed by the same service instance.
  const sessionSnapshot = (): SessionStateEvent => {
    const { sessionActive, activeCaseId, captureCount } = sessionService.snapshot()
    return { sessionActive, activeCaseId, captureCount }
  }

  handle(IPC_CHANNELS.SESSION_SNAPSHOT, () => sessionSnapshot())

  handle(IPC_CHANNELS.SESSION_ACTIVATE_CASE, (_, caseId: string) => {
    if (!caseRepo.getCase(caseId)) throw new IpcFailure('Case not found', 'NOT_FOUND')
    sessionService.activateCase(caseId)
    return sessionSnapshot()
  })

  handle(IPC_CHANNELS.SESSION_START, () => {
    if (!sessionService.snapshot().activeCaseId) {
      throw new IpcFailure('No active case selected', 'NO_ACTIVE_CASE')
    }
    sessionService.start()
    return sessionSnapshot()
  })

  handle(IPC_CHANNELS.SESSION_STOP, () => {
    sessionService.stop()
    return sessionSnapshot()
  })

  // Captures
  handle(IPC_CHANNELS.CAPTURES_LIST, (_, caseId: string) => captureRepo.listCaptures(caseId))
  handle(IPC_CHANNELS.CAPTURES_GET, (_, id: string) => captureRepo.getCapture(id))
  handle(IPC_CHANNELS.CAPTURES_DELETE, (_, id: string) => captureLifecycle.delete(id))
  handle(IPC_CHANNELS.CAPTURES_DELETE_MANY, async (_, payload) => {
    const { caseId, captureIds } = validateBatchPayload(payload)
    try {
      return await captureLifecycle.deleteMany(caseId, captureIds)
    } catch (err) {
      if (err instanceof BatchCrossCaseError) throw new IpcFailure(err.message, 'BATCH_CROSS_CASE')
      throw err
    }
  })
  handle(IPC_CHANNELS.CAPTURES_SET_FAVORITE_MANY, (_, payload) => {
    const { caseId, captureIds } = validateBatchPayload(payload)
    if (typeof payload.favorite !== 'boolean') {
      throw new IpcFailure('Invalid batch payload', 'INVALID_BATCH_PAYLOAD')
    }
    const ids = snapshotSameCase(caseId, captureIds).map((c) => c.id)
    return { affected: captureRepo.setFavoriteMany(ids, payload.favorite) }
  })

  handle(IPC_CHANNELS.CAPTURES_COUNTS_BY_CASE, () => captureRepo.getCaptureCountsByCase())

  handle(IPC_CHANNELS.CAPTURES_DOWNLOAD, async (_, captureId: string): Promise<string | null> => {
    const capture = captureRepo.getCapture(captureId)
    if (!capture) return null
    // Modern captures store a raw .mhtml artifact; only legacy pre-v11 rows have .html.
    const ext = capture.format === 'mhtml' ? 'mhtml' : 'html'
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: `${safeFilename(capture.title, 'capture')}.${ext}`,
      filters:
        ext === 'mhtml'
          ? [{ name: 'MHTML Archive', extensions: ['mhtml'] }]
          : [{ name: 'HTML', extensions: ['html'] }]
    })
    if (canceled || !filePath) return null
    const buffer = defaultCaptureStore.readArtifact(capture.caseId, captureId, ext)
    if (!buffer) throw new IpcFailure(`Capture file (.${ext}) not found`)
    const { writeFileSync } = await import('fs')
    writeFileSync(filePath, buffer)
    return filePath
  })

  handle(
    IPC_CHANNELS.CAPTURES_DOWNLOAD_PDF,
    async (_, captureId: string): Promise<string | null> => {
      const capture = captureRepo.getCapture(captureId)
      if (!capture) return null
      const ext = capture.format === 'mhtml' ? 'mhtml' : 'html'
      const artifact = defaultCaptureStore.artifactPaths(capture.caseId, captureId, ext)
      if (!existsSync(artifact.abs)) throw new IpcFailure(`Capture file (.${ext}) not found`)
      const { canceled, filePath } = await dialog.showSaveDialog({
        defaultPath: `${safeFilename(capture.title, 'capture')}.pdf`,
        filters: [{ name: 'PDF Document', extensions: ['pdf'] }]
      })
      if (canceled || !filePath) return null
      // The trusted-time axis on the cover comes from the case manifest, never
      // from the captures.trustedTimeStatus mirror — the mirror is rebuildable
      // and can disagree with the tokens actually retained (#509). resolveTrustedTime
      // rather than reconcileCaptureTrustedTime: an export is a read path and
      // must not write the mirror as a side effect.
      const trustedTime = resolveTrustedTime(join(getStorageRoot(), capture.caseId), capture.hash)
      const pdf = await renderCapturePdf(capture, artifact.abs, trustedTime)
      const { writeFileSync } = await import('fs')
      writeFileSync(filePath, pdf)
      return filePath
    }
  )

  handle(
    IPC_CHANNELS.CAPTURES_DOWNLOAD_SCREENSHOT,
    async (_, captureId: string): Promise<string | null> => {
      const capture = captureRepo.getCapture(captureId)
      if (!capture) return null
      const { canceled, filePath } = await dialog.showSaveDialog({
        defaultPath: `${safeFilename(capture.title, 'capture')}.png`,
        filters: [{ name: 'PNG Image', extensions: ['png'] }]
      })
      if (canceled || !filePath) return null
      const buffer = defaultCaptureStore.readArtifact(capture.caseId, captureId, 'png')
      if (!buffer) throw new IpcFailure('Screenshot (.png) not found')
      const { writeFileSync } = await import('fs')
      writeFileSync(filePath, buffer)
      return filePath
    }
  )

  handle(IPC_CHANNELS.CAPTURES_OPEN_EXTERNAL, async (_, url: string) => {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      throw new IpcFailure('Invalid URL', 'INVALID_URL')
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new IpcFailure('URL protocol not allowed', 'INVALID_URL_PROTOCOL')
    }

    await shell.openExternal(url)
  })

  // Capture pipeline test
  handle(IPC_CHANNELS.CAPTURES_TEST_PIPELINE, async () => {
    try {
      const res = await fetch(`http://127.0.0.1:${CAPTURE_SERVER_PORT}/api/captures/test`, {
        method: 'POST',
        headers: { 'X-Birdbrain-Token': getServerToken() },
        signal: AbortSignal.timeout(SELF_TEST_TIMEOUT_MS)
      })
      // The capture server owns this response shape; res.json() is untyped, so
      // the contract entry is what pins it.
      return (await res.json()) as SelfTestResult
    } catch (err) {
      return { success: false, durationMs: 0, error: String(err) }
    }
  })

  // HTTP test (verifies Hono server is reachable)
  handle(IPC_CHANNELS.CAPTURES_TEST_HTTP, async () => {
    const start = Date.now()
    try {
      const res = await fetch(`http://127.0.0.1:${CAPTURE_SERVER_PORT}/api/status`, {
        signal: AbortSignal.timeout(SELF_TEST_TIMEOUT_MS)
      })
      const ok = res.ok
      return {
        success: ok,
        durationMs: Date.now() - start,
        error: ok ? undefined : `HTTP ${res.status}`
      }
    } catch (err) {
      return { success: false, durationMs: Date.now() - start, error: String(err) }
    }
  })

  // Tags
  handle(IPC_CHANNELS.TAGS_LIST, () => tagRepo.listTags())
  handle(IPC_CHANNELS.TAGS_CREATE, (_, params: CreateTagParams) => tagRepo.createTag(params))
  handle(IPC_CHANNELS.TAGS_UPDATE, (_, params: UpdateTagParams) => tagRepo.updateTag(params))
  handle(IPC_CHANNELS.TAGS_DELETE, (_, id: string) => tagRepo.deleteTag(id))
  handle(IPC_CHANNELS.TAGS_ADD_TO_CAPTURE, (_, params: CaptureTagParams) => {
    tagRepo.addTagToCapture(params)
  })
  handle(IPC_CHANNELS.TAGS_REMOVE_FROM_CAPTURE, (_, params: CaptureTagParams) => {
    tagRepo.removeTagFromCapture(params)
  })
  handle(IPC_CHANNELS.TAGS_GET_FOR_CAPTURE, (_, captureId: string) =>
    tagRepo.getTagsForCapture(captureId)
  )
  handle(IPC_CHANNELS.TAGS_COUNT_FOR_CASE, (_, caseId: string) =>
    tagRepo.getTagCountForCase(caseId)
  )
  handle(IPC_CHANNELS.TAGS_USAGE_COUNTS_FOR_CASE, (_, caseId: string) =>
    tagRepo.getTagUsageCountsForCase(caseId)
  )
  handle(IPC_CHANNELS.TAGS_CAPTURE_MATRIX, (_, caseId: string, limit: number) =>
    tagRepo.getTagCaptureMatrix(caseId, limit)
  )
  handle(IPC_CHANNELS.TAGS_ADD_TO_CAPTURES, (_, payload) => {
    const { caseId, captureIds } = validateBatchPayload(payload)
    if (typeof payload.tagId !== 'string') {
      throw new IpcFailure('Invalid batch payload', 'INVALID_BATCH_PAYLOAD')
    }
    const ids = snapshotSameCase(caseId, captureIds).map((c) => c.id)
    return { affected: tagRepo.addTagToCaptures(ids, payload.tagId) }
  })

  // Selectors
  handle(IPC_CHANNELS.SELECTORS_LIST, (_, caseId: string) => selectorRepo.listSelectors(caseId))
  handle(IPC_CHANNELS.SELECTORS_GET, (_, id: string) => selectorRepo.getSelector(id))
  handle(IPC_CHANNELS.SELECTORS_CREATE, (_, params: CreateSelectorParams) =>
    selectorLifecycle.createSelector(params)
  )
  handle(IPC_CHANNELS.SELECTORS_BULK_CREATE, (_, params: BulkCreateSelectorsParams) =>
    selectorLifecycle.bulkCreateSelectors(params)
  )
  handle(IPC_CHANNELS.SELECTORS_UPDATE, (_, params: UpdateSelectorParams) =>
    selectorLifecycle.updateSelector(params)
  )
  handle(IPC_CHANNELS.SELECTORS_DELETE, (_, id: string) => selectorRepo.deleteSelector(id))
  handle(IPC_CHANNELS.SELECTORS_LIST_ACTIVE, () => {
    const { activeCaseId } = sessionService.snapshot()
    return selectorRepo.listActiveSelectors(activeCaseId ?? undefined)
  })
  handle(IPC_CHANNELS.SELECTORS_MATCH_COUNTS, (_, caseId: string) =>
    selectorRepo.getSelectorMatchCounts(caseId)
  )
  handle(IPC_CHANNELS.SELECTORS_MATCHING_CAPTURES, (_, caseId: string, selectorIds: string[]) =>
    selectorRepo.getCapturesMatchingSelectors(caseId, selectorIds)
  )
  handle(IPC_CHANNELS.SELECTORS_COVERAGE, (_, caseId: string) =>
    selectorRepo.getSelectorCoverage(caseId)
  )
  handle(IPC_CHANNELS.SELECTORS_CAPTURE_MATRIX, (_, caseId: string, limit: number) =>
    selectorRepo.getSelectorCaptureMatrix(caseId, limit)
  )
  handle(IPC_CHANNELS.SELECTORS_EXPORT_MATCHES, async (_, caseId: string, selectorId?: string) => {
    const caseRow = caseRepo.getCase(caseId)
    if (!caseRow) return { exported: false }
    const rows = selectorRepo.getSelectorMatchesForExport(caseId, selectorId)
    const csv = buildCsv(
      [
        'Selector Pattern',
        'Selector Label',
        'Type',
        'Capture URL',
        'Capture Title',
        'Capture Timestamp'
      ],
      rows.map((r) => [
        r.selectorPattern,
        r.selectorLabel ?? '',
        r.isRegex ? 'regex' : 'text',
        r.captureUrl,
        r.captureTitle ?? '',
        r.captureTimestamp
      ])
    )
    const safeName = safeFilename(caseRow.name, 'case')
    // Named after the selector when the export is scoped to one (#400), so the
    // file on disk says what it holds rather than implying the whole case.
    const scoped = selectorId ? selectorRepo.getSelector(selectorId) : undefined
    const suffix = scoped
      ? `_${safeFilename(scoped.label || scoped.pattern, 'selector')}_matches`
      : '_selector_matches'
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: `${safeName}${suffix}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })
    if (canceled || !filePath) return { exported: false }
    const { writeFileSync } = await import('fs')
    writeFileSync(filePath, csv, 'utf-8')
    return { exported: true, path: filePath }
  })

  // Notes
  handle(IPC_CHANNELS.NOTES_LIST, (_, caseId: string) => noteRepo.listNotes(caseId))
  handle(IPC_CHANNELS.NOTES_GET, (_, id: string) => noteRepo.getNote(id))
  // A cross-case anchor (#234) or Mention (#389) is the note-write failure
  // mode that needs a structured IpcFailure rather than a rejected promise,
  // so the renderer can branch on it explicitly instead of treating it as an
  // unexpected error.
  function rethrowNoteCaseMismatch(err: unknown): never {
    if (err instanceof noteRepo.AnchorCaseMismatchError) {
      throw new IpcFailure(err.message, 'ANCHOR_CASE_MISMATCH')
    }
    if (err instanceof noteReferenceRepo.MentionCaseMismatchError) {
      throw new IpcFailure(err.message, 'MENTION_CASE_MISMATCH')
    }
    throw err
  }
  handle(IPC_CHANNELS.NOTES_CREATE, (_, params: CreateNoteParams) => {
    try {
      return noteRepo.createNote(params)
    } catch (err) {
      rethrowNoteCaseMismatch(err)
    }
  })
  handle(IPC_CHANNELS.NOTES_UPDATE, (_, params: UpdateNoteParams) => {
    try {
      return noteRepo.updateNote(params)
    } catch (err) {
      rethrowNoteCaseMismatch(err)
    }
  })
  handle(IPC_CHANNELS.NOTES_DELETE, (_, id: string) => noteRepo.deleteNote(id))
  handle(IPC_CHANNELS.NOTES_COUNT, (_, caseId: string) => noteRepo.getNoteCount(caseId))
  handle(IPC_CHANNELS.NOTES_REFERENCES, (_, noteId: string) =>
    noteReferenceRepo.referencesForNote(noteId)
  )
  // The one new reference channel taking a payload object rather than a bare
  // id, so it gets the shape check the other payload channels get (#394's
  // validateBatchPayload, recapture, wayback): a targetType off the enum would
  // otherwise reach the query and come back as an honest-looking empty list.
  handle(IPC_CHANNELS.NOTES_BACKLINKS, (_, params: NoteBacklinksParams) => {
    const p = params as Partial<NoteBacklinksParams> | null | undefined
    if (
      !p ||
      typeof p.caseId !== 'string' ||
      typeof p.targetId !== 'string' ||
      !(MENTION_TARGET_TYPES as readonly unknown[]).includes(p.targetType)
    ) {
      throw new IpcFailure('Invalid backlinks payload', 'INVALID_BACKLINKS_PAYLOAD')
    }
    return noteReferenceRepo.backlinksForTarget(p as NoteBacklinksParams)
  })
  handle(IPC_CHANNELS.NOTES_BACKLINK_COUNTS, (_, caseId: string) =>
    noteReferenceRepo.backlinkCountsForCase(caseId)
  )
  handle(IPC_CHANNELS.NOTES_REFERENCE_EDGES, (_, caseId: string) => {
    if (typeof caseId !== 'string') {
      throw new IpcFailure('Invalid caseId: expected string')
    }
    return noteReferenceRepo.referenceEdgesForCase(caseId)
  })
  handle(IPC_CHANNELS.NOTES_SEARCH, (_, caseId: string, query: string) => {
    try {
      return noteRepo.searchNotes(caseId, query)
    } catch {
      // FTS5 can throw on malformed queries (e.g. unmatched quotes, reserved keywords).
      // Return empty results so the UI gracefully handles bad input.
      return []
    }
  })

  // Wayback Machine corroboration
  handle(IPC_CHANNELS.WAYBACK_LOOKUP, async (_, captureId: string) => {
    const capture = captureRepo.getCapture(captureId)
    if (!capture) throw new IpcFailure('Capture not found', 'NOT_FOUND')
    try {
      return await lookupSnapshots(capture.url, capture.timestamp)
    } catch (err) {
      throw new IpcFailure(
        err instanceof Error ? err.message : 'Wayback lookup failed',
        'WAYBACK_LOOKUP_FAILED'
      )
    }
  })

  handle(IPC_CHANNELS.WAYBACK_LIST, (_, captureId: string) =>
    waybackRefRepo.listWaybackRefs(captureId)
  )

  handle(IPC_CHANNELS.WAYBACK_PIN, async (_, params: PinWaybackSnapshotParams) => {
    const capture = captureRepo.getCapture(params.captureId)
    if (!capture) throw new IpcFailure('Capture not found', 'NOT_FOUND')
    // The snapshot/checkedAt provenance arrives over IPC from the renderer.
    // Reject malformed or internally-inconsistent input before persisting so a
    // buggy renderer can't pin a forged reference. (No re-lookup: a pin must not
    // disclose the URL to archive.org.)
    if (!isPersistableSnapshot(params.snapshot, params.checkedAt)) {
      throw new IpcFailure('Invalid Wayback snapshot', 'WAYBACK_INVALID_SNAPSHOT')
    }
    return waybackRefRepo.createWaybackRef({
      captureId: params.captureId,
      snapshot: params.snapshot,
      checkedAt: params.checkedAt
    })
  })

  handle(IPC_CHANNELS.WAYBACK_UNPIN, async (_, refId: string) =>
    waybackRefRepo.deleteWaybackRef(refId)
  )

  // Annotations
  handle(IPC_CHANNELS.ANNOTATIONS_GET, (_, captureId: string) =>
    annotations.getAnnotations(captureId)
  )
  handle(IPC_CHANNELS.ANNOTATIONS_SAVE, (_, params: SaveAnnotationsParams) =>
    annotations.saveAnnotations(params)
  )
  handle(IPC_CHANNELS.ANNOTATIONS_DELETE, (_, captureId: string) => {
    annotations.deleteAnnotations(captureId)
  })
  handle(IPC_CHANNELS.ANNOTATIONS_UPSERT_PIN, (_, params: UpsertAnnotationPinParams) =>
    annotations.upsertPin(params)
  )
  handle(IPC_CHANNELS.ANNOTATIONS_DELETE_PIN, (_, pinId: string) => {
    annotations.deletePin(pinId)
  })

  // Extension
  handle(IPC_CHANNELS.EXTENSION_PATH, () => {
    if (!extensionPathExists()) {
      throw new IpcFailure('Extension directory not found', 'EXT_NOT_FOUND')
    }
    return getExtensionPath()
  })

  handle(IPC_CHANNELS.EXTENSION_OPEN_FOLDER, async () => {
    const extPath = getExtensionPath()
    if (!extensionPathExists()) {
      throw new IpcFailure('Extension directory not found', 'EXT_NOT_FOUND')
    }
    const openError = await shell.openPath(extPath)
    if (openError) {
      throw new IpcFailure(openError, 'OPEN_PATH_FAILED')
    }
  })

  // Captures - get content
  handle(
    IPC_CHANNELS.CAPTURES_GET_CONTENT,
    (_, captureId: string, type: 'html' | 'png' | 'txt') => {
      const capture = captureRepo.getCapture(captureId)
      if (!capture) return null
      const buffer = defaultCaptureStore.readArtifact(capture.caseId, captureId, type)
      if (!buffer) return null
      if (type === 'png') return buffer.toString('base64')
      return buffer.toString('utf-8')
    }
  )

  // Captures - get thumbnail
  handle(IPC_CHANNELS.CAPTURES_GET_THUMBNAIL, async (_, captureId: string) => {
    try {
      const capture = captureRepo.getCapture(captureId)
      if (!capture) return null
      const buffer = await getThumbnail(capture.caseId, captureId)
      if (!buffer) return null
      return buffer.toString('base64')
    } catch (err) {
      logger.error('ipc', 'ipc.handler_threw', { captureId: ident(captureId) }, err)
      return null
    }
  })

  // Captures - get matching selectors
  handle(IPC_CHANNELS.CAPTURES_GET_MATCHING_SELECTORS, (_, captureId: string) => {
    return selectorRepo.getCaptureMatchingSelectors(captureId)
  })

  // Captures - favorites
  handle(IPC_CHANNELS.CAPTURES_TOGGLE_FAVORITE, (_, captureId: string) =>
    captureRepo.toggleFavorite(captureId)
  )

  handle(IPC_CHANNELS.CAPTURES_IS_FAVORITE, (_, captureId: string) =>
    captureRepo.isFavorite(captureId)
  )

  handle(IPC_CHANNELS.CAPTURES_LIST_FAVORITES, (_, caseId: string) =>
    captureRepo.listFavorites(caseId)
  )

  handle(IPC_CHANNELS.CAPTURES_GET_MHTML_URL, (_, captureId: string): string | null => {
    const capture = captureRepo.getCapture(captureId)
    if (!capture || !capture.mhtmlPath) return null
    const abs = defaultCaptureStore.resolveAbsolute(capture.mhtmlPath)
    if (!existsSync(abs)) return null
    return pathToFileURL(abs).toString()
  })

  handle(IPC_CHANNELS.CAPTURES_VERIFY, (_, captureId: string) => captureLifecycle.verify(captureId))

  // Recapture
  handle(IPC_CHANNELS.RECAPTURE_ENQUEUE, (_, payload: RecaptureEnqueuePayload) => {
    if (!payload || !Array.isArray(payload.urls) || typeof payload.caseId !== 'string') {
      throw new IpcFailure('Invalid recapture payload', 'INVALID_RECAPTURE_PAYLOAD')
    }
    return recaptureService.enqueue(
      payload.urls.map((url) => ({
        url,
        caseId: payload.caseId,
        supersedesCaptureId: payload.supersedesCaptureId
      }))
    )
  })

  // Batch recapture (#394): fan the snapshot out to the existing queue, one job
  // per capture superseding itself. Stale ids are dropped; the queue's own
  // EnqueueResult reports what it accepted.
  handle(IPC_CHANNELS.RECAPTURE_ENQUEUE_CAPTURES, (_, payload) => {
    const { caseId, captureIds } = validateBatchPayload(payload)
    const jobs = snapshotSameCase(caseId, captureIds).map((capture) => ({
      url: capture.url,
      caseId,
      supersedesCaptureId: capture.id
    }))
    return recaptureService.enqueue(jobs)
  })

  handle(IPC_CHANNELS.RECAPTURE_QUEUE_STATUS, () => recaptureService.status())

  // Search
  handle(IPC_CHANNELS.SEARCH, (_, caseId: string, query: string) => {
    try {
      return captureRepo.searchCaptures(query, caseId)
    } catch {
      // FTS5 can throw on malformed queries (e.g. unmatched quotes, reserved keywords).
      // Return empty results so the UI gracefully handles bad input.
      return []
    }
  })

  // Settings
  handle(IPC_CHANNELS.SETTINGS_GET, () => settings.getSettings())
  handle(IPC_CHANNELS.SETTINGS_UPDATE, (_, partial: Partial<BirdbrainSettings>) => {
    const updated = settings.updateSettings(partial)
    // A channel switch or auto-check toggle must reconfigure the live updater.
    updaterService.applySettingsChange(partial)
    return updated
  })
  handle(IPC_CHANNELS.SETTINGS_RESET, () => {
    const reset = settings.resetSettings()
    // Reset reverts the channel + auto-check policy, so reconfigure the updater.
    updaterService.applySettingsChange(reset)
    return reset
  })
  handle(IPC_CHANNELS.SETTINGS_TEST_OPENROUTER, (_, apiKey: string) =>
    openrouter.testApiKey(apiKey)
  )
  handle(IPC_CHANNELS.SETTINGS_LIST_MODELS, (_, apiKey: string) => openrouter.listModels(apiKey))
  handle(IPC_CHANNELS.SETTINGS_GET_IDENTITY, () => {
    const s = settings.getSettings()
    return {
      installationId: getInstallationId(),
      operatorName: s.operatorName ?? '',
      operatorRole: s.operatorRole ?? '',
      operatorOrganization: s.operatorOrganization ?? ''
    }
  })
  handle(IPC_CHANNELS.SETTINGS_CHOOSE_STORAGE_PATH, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Choose Storage Location'
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // Export
  handle(IPC_CHANNELS.EXPORT_PREFLIGHT, (_, caseId: string) => getExportPreflight(caseId))

  handle(
    IPC_CHANNELS.EXPORT_GENERATE,
    async (event, caseId: string, options: ExportOptions): Promise<ExportResult> => {
      const isZip = options.format === 'zip'
      const { canceled, filePath } = await dialog.showSaveDialog({
        defaultPath: options.outputPath || (isZip ? 'evidence.zip' : 'report.html'),
        filters: isZip
          ? [{ name: 'Evidence Package', extensions: ['zip'] }]
          : [{ name: 'HTML', extensions: ['html'] }]
      })
      if (canceled || !filePath) return { canceled: true }
      await generateReport(
        caseId,
        { ...options, outputPath: filePath },
        captureLifecycle,
        (step, percent) =>
          sendEvent(event.sender, IPC_CHANNELS.EXPORT_PROGRESS, {
            caseId,
            step,
            percent
          })
      )
      // Permit reveal/open for this freshly-written export only.
      rememberRevealablePath(filePath)
      return { canceled: false, filePath }
    }
  )

  // Shell — reveal/open a file the main process just wrote (export completion).
  handle(IPC_CHANNELS.SHELL_SHOW_ITEM_IN_FOLDER, (_, path: string) => {
    if (!path) throw new IpcFailure('Path is required', 'INVALID_PATH')
    if (!revealablePaths.has(resolve(path)))
      throw new IpcFailure('Path not permitted', 'FORBIDDEN_PATH')
    if (!existsSync(path)) throw new IpcFailure('File not found', 'NOT_FOUND')
    shell.showItemInFolder(path)
  })

  handle(IPC_CHANNELS.SHELL_OPEN_PATH, async (_, path: string) => {
    if (!path) throw new IpcFailure('Path is required', 'INVALID_PATH')
    if (!revealablePaths.has(resolve(path)))
      throw new IpcFailure('Path not permitted', 'FORBIDDEN_PATH')
    if (!existsSync(path)) throw new IpcFailure('File not found', 'NOT_FOUND')
    const openError = await shell.openPath(path)
    if (openError) throw new IpcFailure(openError, 'OPEN_PATH_FAILED')
  })

  // App
  handle(IPC_CHANNELS.APP_GET_VERSION, () => app.getVersion())

  // Diagnostics: start the always-on event-loop sampler with handler
  // registration (idempotent) so stall history predates opening the panel.
  diagnosticsService.start()
  handle(IPC_CHANNELS.DIAGNOSTICS_GET, () => diagnosticsService.snapshot())

  // On demand only — see the channel's comment in shared/ipc.ts for why this is
  // not part of the polled snapshot (#622).
  handle(IPC_CHANNELS.DIAGNOSTICS_UNRECONCILED_DELETIONS, () => scanUnreconciledDeletions())

  // Renderer-side failures join the same durable log as main-process ones.
  // Everything crossing this boundary is untrusted: the renderer holds page
  // titles, case names and URLs, and a compile-time union does not survive an
  // IPC hop. Re-validate every field against the same allowlists here, and
  // drop anything unrecognised rather than coercing it into the log.
  //
  // `payload` is typed by the contract, but that type describes what a WELL-
  // BEHAVED renderer sends — a compromised or buggy one can send anything, so
  // every field below is still re-checked at runtime.
  handle(IPC_CHANNELS.DIAGNOSTICS_LOG, (_e, payload) => {
    const level = payload?.level === 'error' || payload?.level === 'warn' ? payload.level : 'info'
    if (!isLogCode(payload?.code)) return ''

    // context(), NOT a hand-rolled ident() loop. ident() is the generic
    // identifier rule; the per-key CONTEXT_FORMATS table inside logSafe is the
    // real gate. A renderer payload of { caseId: 'OperationBlackbird' } passes
    // ident() but fails caseId's uuid format — and the renderer is precisely
    // where case names live, so this is the boundary that most needs the
    // stricter check. In a packaged build the offending value records as
    // [invalid] and the rest of the entry survives.
    let ctx: LogContext = {}
    try {
      ctx = context((payload.context ?? {}) as Record<string, LogValue>)
    } catch {
      // Development-mode rejection: drop the context, keep the entry. A bad
      // renderer payload must not take down the IPC handler.
    }

    // Source is not taken from the payload at all. Every entry that arrives
    // through this channel came from the renderer by definition, and the code
    // already says which subsystem failed.
    //
    // The error is passed pre-structured, NOT as a bare string. logger routes
    // its `err` argument through sanitizeError, which maps every non-Error
    // value to UnknownError — so handing it the validated name would erase the
    // very classification we just validated, and every renderer query,
    // mutation and render failure would land on disk as UnknownError.
    const name = errorName(payload.error)
    return logger[level](
      'renderer',
      payload.code,
      ctx,
      name === undefined ? undefined : new ValidatedError({ name, code: null, stack: null })
    )
  })

  // The Log tab needs what already happened, not just what happens next —
  // see Task 12. Reads the tail of the current log file only; the rotated
  // backup is for the bug-report bundle, not the live viewer.
  //
  // `limit` is typed `number` by the contract and still range-checked: the
  // contract constrains the renderer's compile, not the value on the wire.
  handle(IPC_CHANNELS.DIAGNOSTICS_RECENT, (_e, limit) => {
    const max = typeof limit === 'number' && limit > 0 && limit <= 500 ? Math.floor(limit) : 200
    return readRecentEntries(max)
  })

  handle(IPC_CHANNELS.DIAGNOSTICS_REVEAL_LOG, () => {
    const path = getLogPath()
    if (path) shell.showItemInFolder(path)
  })

  // Storage root is opened on its own channel, like the log above, rather than
  // through shell:openPath. The reveal allowlist models per-export files this
  // process just wrote; the root is a long-lived, operator-configurable
  // directory, and admitting it there would either widen that control or
  // silently rot under FIFO eviction (#363). The renderer supplies no path —
  // the live root is read here, so it follows initStorage() and never goes stale.
  handle(IPC_CHANNELS.DIAGNOSTICS_OPEN_STORAGE_ROOT, async () => {
    let root: string
    try {
      root = getStorageRoot()
    } catch {
      throw new IpcFailure('Storage not initialised', 'STORAGE_NOT_INITIALISED')
    }
    if (!existsSync(root)) throw new IpcFailure('Storage folder not found', 'NOT_FOUND')
    const openError = await shell.openPath(root)
    if (openError) throw new IpcFailure(openError, 'OPEN_PATH_FAILED')
  })

  handle(IPC_CHANNELS.DIAGNOSTICS_LAST_SESSION, () => takeUncleanSession(getLogDir()))

  // Zero network egress: the bundle is written only to a path the operator
  // picks via a native save dialog, then revealed in their file manager.
  // Nothing here ever leaves the machine.
  handle(IPC_CHANNELS.DIAGNOSTICS_CREATE_REPORT, async (_e, input) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Save diagnostic report',
      defaultPath: bugReportFilename(new Date()),
      filters: [{ name: 'Zip archive', extensions: ['zip'] }]
    })
    if (canceled || !filePath) return null

    // Load-bearing: without this, entries describing the very failure being
    // reported may still be sitting in the logger's write buffer.
    flushSync()
    const { writeFileSync } = await import('fs')
    writeFileSync(filePath, buildBugReport(input))
    shell.showItemInFolder(filePath)
    return { path: filePath }
  })

  // Updates (update delivery)
  handle(IPC_CHANNELS.UPDATES_GET_STATUS, () => updaterService.getStatus())
  handle(IPC_CHANNELS.UPDATES_CHECK, () => updaterService.check())
  handle(IPC_CHANNELS.UPDATES_DOWNLOAD, () => updaterService.download())
  handle(IPC_CHANNELS.UPDATES_INSTALL, () => updaterService.install())

  // AI Analysis
  handle(IPC_CHANNELS.AI_ANALYZE, async (_, params: AnalyzeCaptureParams) => {
    const currentSettings = settings.getSettings()
    const apiKey = currentSettings.openRouterApiKey
    if (!apiKey) throw new IpcFailure('No OpenRouter API key configured')
    const systemPrompt = currentSettings.analysisSystemPrompt?.trim()
      ? currentSettings.analysisSystemPrompt
      : DEFAULT_ANALYSIS_SYSTEM_PROMPT
    try {
      return await analysisService.analyzeCapture(
        params.captureId,
        params.caseId,
        params.model,
        apiKey,
        systemPrompt
      )
    } catch (err) {
      throw new IpcFailure(err instanceof Error ? err.message : String(err))
    }
  })

  handle(IPC_CHANNELS.AI_SAVE_ANALYSIS, (_, analysis: CaptureAnalysis) => {
    analysisService.saveAnalysis(analysis)
  })

  handle(IPC_CHANNELS.AI_GET_ANALYSIS, (_, captureId: string) => {
    if (typeof captureId !== 'string' || captureId.length === 0) {
      throw new IpcFailure('Invalid capture ID', 'INVALID_CAPTURE_ID')
    }
    return analysisService.getAnalysis(captureId)
  })

  // Database Admin
  handle(IPC_CHANNELS.DB_STATS, () => {
    const userDataPath = process.env.BIRDBRAIN_USER_DATA || app.getPath('userData')
    const dbPath = join(userDataPath, 'birdbrain.db')
    return dbAdmin.getDbStats(dbPath)
  })

  handle(IPC_CHANNELS.DB_TABLE_ROWS, (_, params: DbTableRowsParams) => dbAdmin.getTableRows(params))

  // Database Admin is a genuine fourth write path for notes.anchor_json
  // (#234) and notes.body_doc (#389), so a cross-case anchor or Mention
  // rejected here needs the same structured IpcFailure translation as
  // notes:create/notes:update rather than a raw rejected promise.
  handle(IPC_CHANNELS.DB_CREATE_ROW, (_, params: DbCreateRowParams) => {
    try {
      return dbAdmin.createRow(params.table, params.data)
    } catch (err) {
      rethrowNoteCaseMismatch(err)
    }
  })

  handle(IPC_CHANNELS.DB_UPDATE_ROW, (_, params: DbUpdateRowParams) => {
    try {
      return dbAdmin.updateRow(params.table, params.pk, params.data)
    } catch (err) {
      rethrowNoteCaseMismatch(err)
    }
  })

  handle(IPC_CHANNELS.DB_DELETE_ROW, (_, params: DbRowIdentifier) =>
    dbAdmin.deleteRow(params.table, params.pk)
  )

  handle(IPC_CHANNELS.DB_VACUUM, () => {
    const userDataPath = process.env.BIRDBRAIN_USER_DATA || app.getPath('userData')
    const dbPath = join(userDataPath, 'birdbrain.db')
    return dbAdmin.vacuumDb(dbPath)
  })

  handle(IPC_CHANNELS.DB_REBUILD_FTS, () => dbAdmin.rebuildFts())

  handle(IPC_CHANNELS.DB_PURGE_ARCHIVED, () => dbAdmin.purgeArchived())

  handle(IPC_CHANNELS.DB_FIND_ORPHANS, () => dbAdmin.findOrphans())

  handle(IPC_CHANNELS.DB_CLEAN_ORPHANS, (_, report: OrphanReport) => dbAdmin.cleanOrphans(report))

  handle(IPC_CHANNELS.DB_BACKUP, async () => {
    const userDataPath = process.env.BIRDBRAIN_USER_DATA || app.getPath('userData')
    const dbPath = join(userDataPath, 'birdbrain.db')
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: 'birdbrain-backup.db',
      filters: [{ name: 'SQLite Database', extensions: ['db'] }]
    })
    if (canceled || !filePath) return null
    dbAdmin.backupDatabase(dbPath, filePath)
    return { path: filePath }
  })

  handle(IPC_CHANNELS.DB_RESTORE, async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      filters: [{ name: 'SQLite Database', extensions: ['db'] }],
      properties: ['openFile']
    })
    if (canceled || filePaths.length === 0) return { restored: false }

    const userDataPath = process.env.BIRDBRAIN_USER_DATA || app.getPath('userData')
    const dbPath = join(userDataPath, 'birdbrain.db')
    const { closeDatabase, initDatabase } = await import('@main/services/db/core')
    const { copyFileSync } = await import('fs')

    closeDatabase()
    copyFileSync(filePaths[0], dbPath)
    await initDatabase(dbPath)

    return { restored: true }
  })

  handle(IPC_CHANNELS.DB_SNAPSHOTS, () => {
    const userDataPath = process.env.BIRDBRAIN_USER_DATA || app.getPath('userData')
    return dbSnapshots.listSnapshots(join(userDataPath, 'birdbrain.db'))
  })

  handle(IPC_CHANNELS.DB_RESTORE_SNAPSHOT, async (_, params: DbRestoreSnapshotParams) => {
    const userDataPath = process.env.BIRDBRAIN_USER_DATA || app.getPath('userData')
    const dbPath = join(userDataPath, 'birdbrain.db')
    const { closeDatabase, initDatabase } = await import('@main/services/db/core')

    // Resolve before closing: an unknown filename is the likely failure, and
    // it costs nothing to hit it while the database is still open.
    if (!dbSnapshots.resolveSnapshot(dbPath, params.fileName)) {
      throw new IpcFailure(`Snapshot "${params.fileName}" was not found`, 'NOT_FOUND')
    }

    closeDatabase()
    let restoreErr: unknown = null
    try {
      dbSnapshots.restoreSnapshotFile(dbPath, params.fileName)
    } catch (err) {
      // Held, not thrown: the re-open below has to happen either way, and if
      // that fails too its error would replace this one — leaving the operator
      // with the consequence and none of the cause.
      restoreErr = err
      logger.error('db', 'db.snapshot_restore_failed', undefined, err)
    }

    // A failed restore normally leaves the previous database in place — the
    // replacement is staged and renamed — but "normally" is not a guarantee to
    // migrate on. `initDatabase` on a truncated or zero-length file does not
    // fail: SQLite opens a zero-length file as a brand new database, and the
    // migrations then build a fresh schema in it. The operator would be told
    // only that the snapshot could not be restored, over an empty database —
    // the #428 outcome arriving by another route. So a restore that failed
    // must prove the file is still a database before anything migrates it.
    if (restoreErr && !dbSnapshots.isIntactDatabase(dbPath)) {
      logger.error('db', 'db.snapshot_restore_left_no_database', undefined, restoreErr)
      // Says "restart" for the same reason the re-open failure below does: this
      // path returns without calling `initDatabase`, so `db` stays unset in
      // core.ts and every later IPC call in this session fails with "Database
      // not initialized". Without it the operator is told the restore failed
      // and then watches the whole app fail, with nothing connecting the two.
      throw new IpcFailure(
        'The snapshot could not be restored, and the database file it was writing over is no ' +
          'longer readable. Birdbrain has not touched it further. See the log for details. ' +
          'Restart Birdbrain.',
        'DB_RESTORE_FAILED'
      )
    }

    try {
      // Re-open either way — a half-done restore must not leave the running app
      // without a database. A snapshot older than the current schema migrates
      // forward here, taking a fresh pre-migration snapshot of itself first.
      await initDatabase(dbPath)
    } catch (err) {
      // A failed re-open leaves `db` unset in core.ts, so every later IPC call
      // in this session fails with "Database not initialized". Say that, rather
      // than reporting it as a problem with the restore.
      logger.error('db', 'db.reopen_failed', undefined, err)
      throw new IpcFailure(
        'The database could not be re-opened after the restore. Restart Birdbrain.',
        'DB_REOPEN_FAILED'
      )
    }

    // Reported as a fixed message rather than the underlying one: the failures
    // here come from copyFileSync/rmSync and carry absolute paths, and
    // `handle()` passes anything that is not an IpcFailure straight through to
    // the renderer. The cause is in the log line above, where it is useful and
    // stays in the main process.
    if (restoreErr) {
      throw new IpcFailure(
        'The snapshot could not be restored. See the log for details.',
        'DB_RESTORE_FAILED'
      )
    }

    return { restored: true }
  })

  handle(IPC_CHANNELS.DB_EXPORT_TABLE, async (_, params: DbExportTableParams) => {
    const content = dbAdmin.exportTableData(params.table, params.format)
    const ext = params.format === 'csv' ? 'csv' : 'json'
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: `${params.table}.${ext}`,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }]
    })
    if (canceled || !filePath) return null
    const { writeFileSync } = await import('fs')
    writeFileSync(filePath, content, 'utf-8')
    return { path: filePath }
  })

  // Extracted Data
  handle(IPC_CHANNELS.EXTRACTED_DATA_CATEGORIES, (_, caseId: string) =>
    extractedDataRepo.getExtractedCategories(caseId)
  )
  handle(IPC_CHANNELS.EXTRACTED_DATA_SUBCATEGORIES, (_, caseId: string, category: string) =>
    extractedDataRepo.getExtractedSubcategories(caseId, category)
  )
  handle(
    IPC_CHANNELS.EXTRACTED_DATA_ITEMS,
    (_, caseId: string, category: string, subcategory: string) =>
      extractedDataRepo.getExtractedItems(caseId, category, subcategory)
  )
  handle(IPC_CHANNELS.EXTRACTED_DATA_COUNT, (_, caseId: string) =>
    extractedDataRepo.getExtractedDataCountForCase(caseId)
  )
  handle(IPC_CHANNELS.EXTRACTED_DATA_SEARCH, (_, caseId: string, query: string) =>
    extractedDataRepo.searchExtractedData(caseId, query)
  )
  handle(IPC_CHANNELS.EXTRACTED_DATA_REPROCESS, (_, caseId: string) =>
    captureLifecycle.reprocessCase(caseId)
  )
}
