// Typed IPC channel definitions
// Every IPC call between renderer and main process goes through these channels

import type {
  ActiveCaseSelectors,
  AnnotationPin,
  AnnotationShape,
  AnnotationsBundle,
  ArchiveInspectReport,
  CaseWaybackRef,
  WaybackRef,
  BirdbrainSettings,
  BugReportInput,
  BugReportResult,
  Capture,
  CaptureAnalysis,
  CaptureAnnotations,
  CaptureEvent,
  Case,
  CaseAutoCapturePolicy,
  DiagnosticsSnapshot,
  UnreconciledDeletionReport,
  ExportOptions,
  ExportPreflight,
  ExtractedDataCategory,
  ExtractedDataItem,
  ExtractedDataSearchResult,
  ExtractedDataSubcategory,
  HashVerification,
  LogCode,
  LogContextKey,
  LogEntry,
  LogLevel,
  MentionTargetType,
  Note,
  NoteBacklink,
  NoteBacklinkCount,
  NoteReference,
  NoteReferenceEdge,
  OpenRouterModel,
  OperatorIdentity,
  RecentActivityEvent,
  Selector,
  SelectorOrigin,
  SessionRecord,
  Tag,
  TokenUsage,
  UpdateStatus,
  WaybackLookupResult,
  WaybackSnapshot
} from '@shared/types'

export const IPC_CHANNELS = {
  // Cases
  CASES_LIST: 'cases:list',
  CASES_GET: 'cases:get',
  CASES_CREATE: 'cases:create',
  CASES_UPDATE: 'cases:update',
  CASES_DELETE: 'cases:delete',
  CASES_EXPORT_ARCHIVE: 'cases:exportArchive',
  CASES_INSPECT_ARCHIVE: 'cases:inspectArchive',
  CASES_IMPORT_ARCHIVE: 'cases:importArchive',
  CASES_RECENT_ACTIVITY: 'cases:recentActivity',
  CASES_GET_AUTO_CAPTURE_POLICY: 'cases:getAutoCapturePolicy',
  CASES_SET_AUTO_CAPTURE_POLICY: 'cases:setAutoCapturePolicy',

  // Captures
  CAPTURES_LIST: 'captures:list',
  CAPTURES_GET: 'captures:get',
  CAPTURES_DELETE: 'captures:delete',
  CAPTURES_GET_CONTENT: 'captures:getContent',
  CAPTURES_GET_THUMBNAIL: 'captures:getThumbnail',
  CAPTURES_GET_MATCHING_SELECTORS: 'captures:getMatchingSelectors',
  CAPTURES_DOWNLOAD: 'captures:download',
  CAPTURES_DOWNLOAD_PDF: 'captures:downloadPdf',
  CAPTURES_DOWNLOAD_SCREENSHOT: 'captures:downloadScreenshot',
  CAPTURES_OPEN_EXTERNAL: 'captures:openExternal',
  CAPTURES_COUNTS_BY_CASE: 'captures:countsByCase',
  CAPTURES_TOGGLE_FAVORITE: 'captures:toggleFavorite',
  CAPTURES_IS_FAVORITE: 'captures:isFavorite',
  CAPTURES_LIST_FAVORITES: 'captures:listFavorites',
  CAPTURES_VERIFY: 'captures:verify',
  CAPTURES_GET_MHTML_URL: 'captures:getMhtmlUrl',
  CAPTURES_GET_HTML_URL: 'captures:getHtmlUrl',
  CAPTURES_DELETE_MANY: 'captures:deleteMany',
  CAPTURES_DUPLICATE: 'captures:duplicate',
  CAPTURES_SET_FAVORITE_MANY: 'captures:setFavoriteMany',

  // Recapture
  RECAPTURE_ENQUEUE: 'recapture:enqueue',
  RECAPTURE_QUEUE_STATUS: 'recapture:queueStatus',
  RECAPTURE_ENQUEUE_CAPTURES: 'recapture:enqueueCaptures',

  // Tags
  TAGS_LIST: 'tags:list',
  TAGS_CREATE: 'tags:create',
  TAGS_UPDATE: 'tags:update',
  TAGS_DELETE: 'tags:delete',
  TAGS_ADD_TO_CAPTURE: 'tags:addToCapture',
  TAGS_REMOVE_FROM_CAPTURE: 'tags:removeFromCapture',
  TAGS_GET_FOR_CAPTURE: 'tags:getForCapture',
  TAGS_COUNT_FOR_CASE: 'tags:countForCase',
  TAGS_USAGE_COUNTS_FOR_CASE: 'tags:usageCountsForCase',
  TAGS_CAPTURE_MATRIX: 'tags:captureMatrix',
  TAGS_ADD_TO_CAPTURES: 'tags:addToCaptures',
  TAGS_APPLY_TO_NOTE: 'tags:applyToNote',
  TAGS_REMOVE_FROM_NOTE: 'tags:removeFromNote',
  TAGS_GET_FOR_NOTE: 'tags:getForNote',
  TAGS_MERGE: 'tags:merge',

  // Session (renderer-side session control; the extension drives HTTP)
  SESSION_SNAPSHOT: 'session:snapshot',
  SESSION_ACTIVATE_CASE: 'session:activateCase',
  SESSION_START: 'session:start',
  SESSION_STOP: 'session:stop',

  // Search
  SEARCH: 'search:query',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_UPDATE: 'settings:update',
  SETTINGS_RESET: 'settings:reset',
  SETTINGS_TEST_OPENROUTER: 'settings:testOpenRouter',
  SETTINGS_LIST_MODELS: 'settings:listModels',
  SETTINGS_GET_IDENTITY: 'settings:getIdentity',
  SETTINGS_CHOOSE_STORAGE_PATH: 'settings:chooseStoragePath',

  // Export
  EXPORT_PREFLIGHT: 'export:preflight',
  EXPORT_GENERATE: 'export:generate',

  // Selectors
  SELECTORS_LIST: 'selectors:list',
  SELECTORS_GET: 'selectors:get',
  SELECTORS_CREATE: 'selectors:create',
  SELECTORS_UPDATE: 'selectors:update',
  SELECTORS_RESCAN: 'selectors:rescan',
  SELECTORS_DELETE: 'selectors:delete',
  SELECTORS_LIST_ACTIVE: 'selectors:listActive',
  SELECTORS_MATCH_COUNTS: 'selectors:matchCounts',
  SELECTORS_MATCHING_CAPTURES: 'selectors:matchingCaptures',
  SELECTORS_COVERAGE: 'selectors:coverage',
  SELECTORS_CAPTURE_MATRIX: 'selectors:captureMatrix',
  SELECTORS_BULK_CREATE: 'selectors:bulkCreate',
  SELECTORS_EXPORT_MATCHES: 'selectors:exportMatches',

  // Notes
  NOTES_LIST: 'notes:list',
  NOTES_GET: 'notes:get',
  NOTES_CREATE: 'notes:create',
  NOTES_UPDATE: 'notes:update',
  NOTES_DELETE: 'notes:delete',
  NOTES_COUNT: 'notes:count',
  NOTES_SEARCH: 'notes:search',
  NOTES_REFERENCES: 'notes:references',
  NOTES_BACKLINKS: 'notes:backlinks',
  NOTES_BACKLINK_COUNTS: 'notes:backlinkCounts',
  NOTES_REFERENCE_EDGES: 'notes:referenceEdges',

  // Wayback Machine corroboration
  WAYBACK_LOOKUP: 'wayback:lookup',
  WAYBACK_LIST: 'wayback:list',
  WAYBACK_LIST_FOR_CASE: 'wayback:listForCase',
  WAYBACK_PIN: 'wayback:pin',
  WAYBACK_UNPIN: 'wayback:unpin',

  // Extracted Data
  EXTRACTED_DATA_CATEGORIES: 'extractedData:categories',
  EXTRACTED_DATA_SUBCATEGORIES: 'extractedData:subcategories',
  EXTRACTED_DATA_ITEMS: 'extractedData:items',
  EXTRACTED_DATA_COUNT: 'extractedData:count',
  EXTRACTED_DATA_SEARCH: 'extractedData:search',
  EXTRACTED_DATA_REPROCESS: 'extractedData:reprocess',

  // Annotations
  ANNOTATIONS_GET: 'annotations:get',
  ANNOTATIONS_SAVE: 'annotations:save',
  ANNOTATIONS_DELETE: 'annotations:delete',
  ANNOTATIONS_UPSERT_PIN: 'annotations:upsertPin',
  ANNOTATIONS_DELETE_PIN: 'annotations:deletePin',

  // Extension
  EXTENSION_PATH: 'extension:path',
  EXTENSION_OPEN_FOLDER: 'extension:openFolder',

  // Shell
  SHELL_SHOW_ITEM_IN_FOLDER: 'shell:showItemInFolder',
  SHELL_OPEN_PATH: 'shell:openPath',

  // App
  APP_GET_VERSION: 'app:getVersion',

  // Diagnostics
  DIAGNOSTICS_GET: 'diagnostics:get',
  DIAGNOSTICS_LOG: 'diagnostics:log',
  DIAGNOSTICS_RECENT: 'diagnostics:recent',
  DIAGNOSTICS_REVEAL_LOG: 'diagnostics:revealLog',
  DIAGNOSTICS_OPEN_STORAGE_ROOT: 'diagnostics:openStorageRoot',
  DIAGNOSTICS_LAST_SESSION: 'diagnostics:lastSession',
  DIAGNOSTICS_CREATE_REPORT: 'diagnostics:createReport',
  // Deliberately NOT folded into diagnostics:get — the panel polls that every
  // 2s, and this scan reads and signature-verifies every case manifest on the
  // main process. On demand only (#622).
  DIAGNOSTICS_UNRECONCILED_DELETIONS: 'diagnostics:unreconciledDeletions',
  LOG_ENTRY: 'event:logEntry',

  // Updates (update delivery)
  UPDATES_GET_STATUS: 'updates:getStatus',
  UPDATES_CHECK: 'updates:check',
  UPDATES_DOWNLOAD: 'updates:download',
  UPDATES_INSTALL: 'updates:install',

  // Events (main -> renderer)
  EXPORT_PROGRESS: 'event:exportProgress',
  NEW_CAPTURE: 'event:newCapture',
  SESSION_STATE_CHANGED: 'event:sessionStateChanged',
  EXTENSION_CONNECTION: 'event:extensionConnection',
  EXTENSION_ATTACH: 'event:extensionAttach',
  SELECTOR_REMATCHED: 'event:selector:rematched',
  DEEP_LINK_NAVIGATE: 'event:deepLinkNavigate',
  ARCHIVE_PROGRESS: 'event:archiveProgress',
  UPDATE_STATUS: 'event:updateStatus',

  // Capture pipeline observability
  CAPTURE_ACTIVITY: 'event:captureActivity',
  CAPTURES_TEST_PIPELINE: 'captures:testPipeline',
  CAPTURES_TEST_HTTP: 'captures:testHttp',

  // AI Analysis
  AI_ANALYZE: 'ai:analyze',
  AI_SAVE_ANALYSIS: 'ai:saveAnalysis',
  AI_GET_ANALYSIS: 'ai:getAnalysis',

  // Database Admin
  DB_STATS: 'db:stats',
  DB_TABLE_ROWS: 'db:tableRows',
  DB_CREATE_ROW: 'db:createRow',
  DB_UPDATE_ROW: 'db:updateRow',
  DB_DELETE_ROW: 'db:deleteRow',
  DB_VACUUM: 'db:vacuum',
  DB_REBUILD_FTS: 'db:rebuildFts',
  DB_PURGE_ARCHIVED: 'db:purgeArchived',
  DB_FIND_ORPHANS: 'db:findOrphans',
  DB_CLEAN_ORPHANS: 'db:cleanOrphans',
  DB_BACKUP: 'db:backup',
  DB_RESTORE: 'db:restore',
  DB_SNAPSHOTS: 'db:snapshots',
  DB_RESTORE_SNAPSHOT: 'db:restoreSnapshot',
  DB_EXPORT_TABLE: 'db:exportTable'
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]

// Event payload types (main -> renderer)
export interface ExportProgressEvent {
  caseId: string
  step: string
  percent: number
}

// Result of an export:generate invocation. `canceled` is true when the user
// dismissed the native save dialog (no file written); `filePath` is the saved
// path on success.
export interface ExportResult {
  canceled: boolean
  filePath?: string
}

// Progress updates for cases:exportArchive / cases:importArchive. `caseId` is
// only present for export (the source case); import has no case until it
// completes, so it's omitted there.
export interface ArchiveProgressEvent {
  caseId?: string
  step: string
  percent: number
}

// Result of a cases:exportArchive invocation. `canceled` is true when the user
// dismissed the native save dialog (no file written); `filePath` is the saved
// path on success.
export interface ArchiveExportResult {
  canceled: boolean
  filePath?: string
}

// Session snapshot pushed whenever capture session state changes.
export interface SessionStateEvent {
  sessionActive: boolean
  activeCaseId: string | null
  captureCount: number
}

// Extension reachability, pushed when the companion extension connects or drops.
export interface ExtensionConnectionEvent {
  connected: boolean
}

export type SelectorRematchedStatus = 'done' | 'error'

export interface SelectorRematchedEvent {
  selectorIds: string[]
  caseId: string
  status: SelectorRematchedStatus
}

// What the extension attach routes wrote, pushed after the write commits
// (#852). Those routes go straight to the repos, so a renderer looking at the
// case never learns the row exists — this names what changed so the caches the
// write bypassed can be refetched. `kind` is what was attached, not how: both
// routes may have ingested a capture first, and that arrives separately as
// NEW_CAPTURE.
export type ExtensionAttachKind = 'tag' | 'note'

export interface ExtensionAttachEvent {
  kind: ExtensionAttachKind
  caseId: string
  captureId: string
}

// Deep-link (birdbrain://) navigation targets pushed from main to the renderer
export type DeepLinkTarget = 'dashboard' | 'settings'

// Payload types for IPC calls
export interface CreateCaseParams {
  name: string
  description?: string
  type?: 'crypto' | 'malware' | 'fraud' | 'custom'
}

export interface UpdateCaseParams {
  id: string
  name?: string
  description?: string
  // Whitespace-only clears to NULL in the repo — absent means "leave as is".
  caseNumber?: string
  archived?: boolean
}

// The whole policy, not a delta: the exclusion list is edited as a set and a
// partial write has no meaning for it. Kept off UpdateCaseParams so the write
// never touches the case's updated_at (see caseRepo.setAutoCapturePolicy).
export interface SetAutoCapturePolicyParams extends CaseAutoCapturePolicy {
  caseId: string
}

export interface CreateTagParams {
  name: string
  color?: string
}

export interface UpdateTagParams {
  id: string
  name?: string
  color?: string
}

export interface CaptureTagParams {
  captureId: string
  tagId: string
}

export interface NoteTagParams {
  noteId: string
  tagId: string
}

/**
 * Apply a tag to a note by NAME rather than by id (#391): the selection flow
 * derives a name from the passage and has no way to know whether that tag
 * already exists. Main resolves it create-or-reuse (ruling R15), so the
 * renderer never races two lookups against a UNIQUE constraint.
 */
export interface ApplyTagToNoteParams {
  noteId: string
  name: string
}

/**
 * `captureId` is the capture the tag ALSO landed on (ruling R15), or undefined
 * when the note is anchored to nothing, or when its anchored capture has since
 * been deleted. It is reported rather than assumed so the renderer's
 * confirmation says what actually happened instead of what the caller hoped
 * for.
 */
export interface ApplyTagToNoteResult {
  tag: Tag
  captureId?: string
}

/**
 * Merge tag `sourceId` into tag `targetId` (#828): every capture and note
 * carrying the source ends up carrying the target, and the source is deleted,
 * in one transaction. Tags are app-global — the table has no case_id — so the
 * merge reaches every case that used the source tag, not only the one it was
 * invoked from.
 */
export interface MergeTagsParams {
  sourceId: string
  targetId: string
}

/**
 * `captureLinks`/`noteLinks` are the target's POST-merge totals across all
 * cases, for the same app-global reason. They are not counts for the invoking
 * case, and the renderer must not present them as such next to the Signals
 * screen's per-case numbers.
 */
export interface MergeTagsResult {
  target: Tag
  captureLinks: number
  noteLinks: number
}

export interface CreateSelectorParams {
  caseId: string
  pattern: string
  isRegex?: boolean
  label?: string
  origin?: SelectorOrigin
  /**
   * Whether the selector watches future captures. Omitted means enabled, which
   * is the DDL default every pre-#391 call site relied on; the note selection
   * flow passes it explicitly because its confirm popover offers the choice.
   */
  enabled?: boolean
}

export interface UpdateSelectorParams {
  id: string
  pattern?: string
  isRegex?: boolean
  enabled?: boolean
  label?: string
}

/**
 * `body` and `bodyDoc` are alternatives, not a pair. Pass `bodyDoc` and main
 * derives `body` from it; pass `body` alone and the note is plain text. A
 * renderer-computed `body` is never stored alongside a `bodyDoc`, so the two
 * columns cannot drift apart.
 */
export interface CreateNoteParams {
  caseId: string
  captureId?: string
  title?: string
  body?: string
  bodyDoc?: string
  /** Serialized anchor payload. Validated in main; omit for an unanchored note. */
  anchor?: string
  sourceUrl?: string
  screenshotPath?: string
}

/**
 * `anchor` is three-valued on update: omitted leaves the stored anchor alone,
 * a string replaces it, and `null` clears it. Absent and cleared must be
 * distinguishable, or a title-only edit would silently unanchor the note.
 */
export interface UpdateNoteParams {
  id: string
  title?: string
  body?: string
  bodyDoc?: string
  anchor?: string | null
}

/**
 * Backlink lookups are case-scoped through the referring notes: the target id
 * alone would also surface notes from other cases that mention a global tag.
 */
export interface NoteBacklinksParams {
  caseId: string
  targetType: MentionTargetType
  targetId: string
}

export interface PinWaybackSnapshotParams {
  captureId: string
  snapshot: WaybackSnapshot
  checkedAt: string
}

export interface SaveAnnotationsParams {
  captureId: string
  shapes: AnnotationShape[]
  imageWidth: number
  imageHeight: number
}

export interface UpsertAnnotationPinParams {
  captureId: string
  id?: string
  body: string
}

export interface BulkCreateSelectorsParams {
  caseId: string
  selectors: Array<{ pattern: string; isRegex: boolean; label?: string; origin?: SelectorOrigin }>
}

// --- Database Admin ---

export interface DbStats {
  schemaVersion: number
  dbFileSize: number
  walFileSize: number
  tables: Array<{ name: string; rowCount: number }>
}

export interface DbTableRowsParams {
  table: string
  offset: number
  limit: number
}

export interface DbTableRowsResult {
  rows: Record<string, unknown>[]
  total: number
  columns: Array<{ name: string; type: string; pk: boolean }>
}

export interface DbRowIdentifier {
  table: string
  pk: Record<string, string>
}

export interface DbCreateRowParams {
  table: string
  data: Record<string, unknown>
}

export interface DbUpdateRowParams {
  table: string
  pk: Record<string, string>
  data: Record<string, unknown>
}

export interface DbExportTableParams {
  table: string
  format: 'csv' | 'json'
}

/**
 * A pre-migration database snapshot on disk (#413). `fromVersion` is the
 * schema the snapshot holds; `toVersion` is the schema the app was about to
 * migrate it to, so a tester can tell which upgrade a snapshot belongs to.
 *
 * No `path`: `fileName` is the only handle the renderer needs (and the only
 * one `db:restoreSnapshot` accepts), and the absolute path would disclose the
 * profile location to the window. The main process keeps it on `StoredSnapshot`
 * in `db/dbSnapshots.ts`.
 */
export interface DbSnapshot {
  fileName: string
  fromVersion: number
  toVersion: number
  createdAt: string
  sizeBytes: number
}

export interface DbRestoreSnapshotParams {
  fileName: string
}

export interface OrphanReport {
  dbOrphans: Array<{
    table: string
    id: string
    caseId: string
    missingPaths: string[]
  }>
  fileOrphans: string[]
}

export interface AnalyzeCaptureParams {
  captureId: string
  caseId: string
  model: string
}

export interface SaveCaptureParams {
  caseId: string
  url: string
  title: string
  html: string
  screenshot?: string // base64
  timestamp: string
  headers?: Record<string, string>
  textContent?: string
}

// --- Batch capture operations (#394) ---
//
// Contract: docs/specs/2026-08-19-batch-ops-interface-brief.md. Every batch
// payload names the case its ids must belong to; an id whose row lives in a
// different case fails the whole call (BATCH_CROSS_CASE) before anything is
// written, while a stale (not_found) id is tolerated and reported.

export interface CaptureBatchPayload {
  caseId: string
  captureIds: string[]
}

// Batch delete is prefix-commit over the manifest chain: entries for the ids
// before the first failure are committed, the failing entry is rolled back,
// and everything after it is never attempted. Each outcome says which of those
// a given id was; there is no batch-level entry and no atomicity claim.
// `rolled_back.error` is the fault's name and errno code only, never a path.
// A legacy html capture whose unlink threw is also `rolled_back` (stage
// `artifacts`, files + row intact) even though it had no entry to roll back.
export type BatchDeleteOutcome =
  | { captureId: string; status: 'deleted' }
  | { captureId: string; status: 'deleted_unmanifested' }
  | { captureId: string; status: 'rolled_back'; stage: 'artifacts' | 'db'; error: string }
  | { captureId: string; status: 'not_attempted' }
  | { captureId: string; status: 'rejected'; reason: 'not_found' | 'duplicate' }

export interface BatchDeleteResult {
  // Exactly one per requested id, in input order.
  outcomes: BatchDeleteOutcome[]
  // deleted ∪ deleted_unmanifested.
  deletedIds: string[]
  // rolled_back ∪ not_attempted — the retry payload. Rejected ids are excluded.
  failedIds: string[]
  // The rolled_back id, when there is one.
  haltedAt?: string
  manifest: {
    // Chain length before the batch.
    baseIndex: number
    // count(status === 'deleted'): the entries the chain now holds for this batch.
    committedEntries: number
  }
}

export interface BatchCountResult {
  affected: number
}

// Why a duplicate was refused (#827). Refusal is an outcome, not a fault: each
// reason names something the operator can act on, and none of them leaves a
// partial capture behind.
// - not_found: the source row is gone (another window deleted it).
// - operator_name_required: the same gate ingest applies — a signed entry with
//   no operator named is a weaker record than any capture the app can produce.
// - not_verified: the source does not currently verify (`detail` carries the
//   HashVerification status). Duplicating a legacy, missing, tampered or
//   chain-broken capture would mint a fresh, internally consistent entry for
//   bytes that no longer stand up — laundering.
// - copy_mismatch: the copy on disk does not hash to the source's content hash,
//   so the source changed between verification and copy. Nothing is written.
export type DuplicateCaptureRefusal =
  | 'not_found'
  | 'operator_name_required'
  | 'not_verified'
  | 'copy_mismatch'

export type DuplicateCaptureResult =
  | { status: 'duplicated'; capture: Capture }
  | { status: 'rejected'; reason: DuplicateCaptureRefusal; detail?: string }

// --- Recapture (background capture queue) ---

export interface RecaptureQueueStatus {
  pending: number
  activeUrl: string | null
}

export interface EnqueueResult {
  accepted: number
  rejected: Array<{ url: string; reason: string }>
}

export interface RecaptureEnqueuePayload {
  urls: string[]
  caseId: string
  supersedesCaptureId?: string
}

// Result of the capture-pipeline and HTTP self-tests. `error` carries the
// failure reason when `success` is false.
export interface SelfTestResult {
  success: boolean
  durationMs: number
  error?: string
}

// The renderer's half of the logging contract. Codes and context keys are the
// same unions the main process enforces, so a mistake is a compile error in
// the renderer and a dropped entry in main — never a leak. There is no
// free-form text field, and `error` is a bare allowlisted class name: the
// renderer holds page titles, case names and URLs, so nothing that could carry
// them is given a place to sit.
export interface RendererLogPayload {
  level: LogLevel
  code: LogCode
  context?: Partial<Record<LogContextKey, string | number | boolean | null>>
  error?: string
}

// --- Invoke contract --------------------------------------------------------
//
// One entry per invoke channel: the argument tuple the renderer sends and the
// value the handler resolves to (before the { ok, data } envelope is applied).
// This is the single source of truth — `handle()` constrains a handler's
// signature by its channel, so a handler that drifts from its entry is a
// compile error rather than a runtime surprise.
//
// All invoke channels live in this map; `handle()` is keyed by ContractedChannel, so missing entries are
// compile errors.
export interface IpcInvokeContract {
  'cases:list': { args: []; result: Case[] }
  'cases:get': { args: [id: string]; result: Case | undefined }
  'cases:create': { args: [params: CreateCaseParams]; result: Case }
  'cases:update': { args: [params: UpdateCaseParams]; result: Case | undefined }
  'cases:delete': { args: [id: string]; result: boolean }
  'cases:exportArchive': { args: [caseId: string]; result: ArchiveExportResult }
  'cases:inspectArchive': { args: []; result: ArchiveInspectReport | null }
  'cases:importArchive': {
    args: [archivePath: string, overrideTamper: boolean]
    result: { newCaseId: string }
  }
  'cases:recentActivity': { args: [limit?: number]; result: RecentActivityEvent[] }
  'cases:getAutoCapturePolicy': { args: [caseId: string]; result: CaseAutoCapturePolicy }
  'cases:setAutoCapturePolicy': {
    args: [params: SetAutoCapturePolicyParams]
    result: CaseAutoCapturePolicy
  }

  'captures:list': { args: [caseId: string]; result: Capture[] }
  'captures:get': { args: [id: string]; result: Capture | undefined }
  'captures:delete': { args: [id: string]; result: boolean }
  'captures:getContent': {
    args: [captureId: string, type: 'html' | 'png' | 'txt']
    result: string | null
  }
  'captures:getThumbnail': { args: [captureId: string]; result: string | null }
  'captures:getMatchingSelectors': { args: [captureId: string]; result: Selector[] }
  'captures:download': { args: [captureId: string]; result: string | null }
  'captures:downloadPdf': { args: [captureId: string]; result: string | null }
  'captures:downloadScreenshot': { args: [captureId: string]; result: string | null }
  'captures:openExternal': { args: [url: string]; result: void }
  'captures:countsByCase': { args: []; result: Record<string, number> }
  'captures:toggleFavorite': { args: [captureId: string]; result: boolean }
  'captures:isFavorite': { args: [captureId: string]; result: boolean }
  'captures:listFavorites': { args: [caseId: string]; result: string[] }
  'captures:verify': { args: [captureId: string]; result: HashVerification }
  'captures:getMhtmlUrl': { args: [captureId: string]; result: string | null }
  'captures:getHtmlUrl': { args: [captureId: string]; result: string | null }
  'captures:testPipeline': { args: []; result: SelfTestResult }
  'captures:testHttp': { args: []; result: SelfTestResult }
  'captures:deleteMany': { args: [payload: CaptureBatchPayload]; result: BatchDeleteResult }
  'captures:duplicate': { args: [captureId: string]; result: DuplicateCaptureResult }
  'captures:setFavoriteMany': {
    args: [payload: CaptureBatchPayload & { favorite: boolean }]
    result: BatchCountResult
  }

  'recapture:enqueue': { args: [payload: RecaptureEnqueuePayload]; result: EnqueueResult }
  'recapture:queueStatus': { args: []; result: RecaptureQueueStatus }
  'recapture:enqueueCaptures': { args: [payload: CaptureBatchPayload]; result: EnqueueResult }

  'tags:list': { args: []; result: Tag[] }
  'tags:create': { args: [params: CreateTagParams]; result: Tag }
  'tags:update': { args: [params: UpdateTagParams]; result: Tag | undefined }
  'tags:delete': { args: [id: string]; result: boolean }
  'tags:addToCapture': { args: [params: CaptureTagParams]; result: void }
  'tags:removeFromCapture': { args: [params: CaptureTagParams]; result: void }
  'tags:getForCapture': { args: [captureId: string]; result: Tag[] }
  'tags:countForCase': { args: [caseId: string]; result: number }
  'tags:usageCountsForCase': { args: [caseId: string]; result: Record<string, number> }
  'tags:captureMatrix': { args: [caseId: string, limit: number]; result: Record<string, string[]> }
  'tags:addToCaptures': {
    args: [payload: CaptureBatchPayload & { tagId: string }]
    result: BatchCountResult
  }
  'tags:applyToNote': { args: [params: ApplyTagToNoteParams]; result: ApplyTagToNoteResult }
  'tags:removeFromNote': { args: [params: NoteTagParams]; result: void }
  'tags:getForNote': { args: [noteId: string]; result: Tag[] }
  'tags:merge': { args: [params: MergeTagsParams]; result: MergeTagsResult }

  'selectors:list': { args: [caseId: string]; result: Selector[] }
  'selectors:get': { args: [id: string]; result: Selector | undefined }
  'selectors:create': { args: [params: CreateSelectorParams]; result: Selector }
  'selectors:update': { args: [params: UpdateSelectorParams]; result: Selector | undefined }
  // true once the backfill pass is scheduled — not once it has finished. The
  // pass completing is the `event:selector:rematched` push; false means the id
  // was unknown, so no pass was scheduled and no event will ever arrive.
  'selectors:rescan': { args: [id: string]; result: boolean }
  'selectors:delete': { args: [id: string]; result: boolean }
  'selectors:listActive': { args: []; result: ActiveCaseSelectors[] }
  'selectors:matchCounts': { args: [caseId: string]; result: Record<string, number> }
  'selectors:matchingCaptures': {
    args: [caseId: string, selectorIds: string[]]
    result: string[]
  }
  'selectors:coverage': { args: [caseId: string]; result: { matched: number; total: number } }
  'selectors:captureMatrix': {
    args: [caseId: string, limit: number]
    result: Record<string, string[]>
  }
  'selectors:bulkCreate': { args: [params: BulkCreateSelectorsParams]; result: Selector[] }
  'selectors:exportMatches': {
    args: [caseId: string, selectorId?: string]
    result: { exported: boolean; path?: string }
  }

  'notes:list': { args: [caseId: string]; result: Note[] }
  'notes:get': { args: [id: string]; result: Note | undefined }
  'notes:create': { args: [params: CreateNoteParams]; result: Note }
  'notes:update': { args: [params: UpdateNoteParams]; result: Note | undefined }
  'notes:delete': { args: [id: string]; result: boolean }
  'notes:count': { args: [caseId: string]; result: number }
  'notes:search': { args: [caseId: string, query: string]; result: Note[] }
  'notes:references': { args: [noteId: string]; result: NoteReference[] }
  'notes:backlinks': { args: [params: NoteBacklinksParams]; result: NoteBacklink[] }
  'notes:backlinkCounts': { args: [caseId: string]; result: NoteBacklinkCount[] }
  'notes:referenceEdges': { args: [caseId: string]; result: NoteReferenceEdge[] }

  'session:snapshot': { args: []; result: SessionStateEvent }
  'session:activateCase': { args: [caseId: string]; result: SessionStateEvent }
  'session:start': { args: []; result: SessionStateEvent }
  'session:stop': { args: []; result: SessionStateEvent }

  'search:query': { args: [caseId: string, query: string]; result: Capture[] }

  'settings:get': { args: []; result: BirdbrainSettings }
  'settings:update': { args: [partial: Partial<BirdbrainSettings>]; result: BirdbrainSettings }
  'settings:reset': { args: []; result: BirdbrainSettings }
  'settings:testOpenRouter': { args: [apiKey: string]; result: boolean }
  'settings:listModels': { args: [apiKey: string]; result: OpenRouterModel[] }
  'settings:getIdentity': { args: []; result: OperatorIdentity }
  'settings:chooseStoragePath': { args: []; result: string | null }

  'export:preflight': { args: [caseId: string, captureIds?: string[]]; result: ExportPreflight }
  'export:generate': { args: [caseId: string, options: ExportOptions]; result: ExportResult }

  'wayback:lookup': { args: [captureId: string]; result: WaybackLookupResult }
  'wayback:list': { args: [captureId: string]; result: WaybackRef[] }
  'wayback:listForCase': { args: [caseId: string]; result: CaseWaybackRef[] }
  'wayback:pin': { args: [params: PinWaybackSnapshotParams]; result: WaybackRef }
  'wayback:unpin': { args: [refId: string]; result: boolean }

  'annotations:get': { args: [captureId: string]; result: AnnotationsBundle }
  'annotations:save': { args: [params: SaveAnnotationsParams]; result: CaptureAnnotations }
  'annotations:delete': { args: [captureId: string]; result: void }
  'annotations:upsertPin': { args: [params: UpsertAnnotationPinParams]; result: AnnotationPin }
  'annotations:deletePin': { args: [pinId: string]; result: void }

  'extractedData:categories': { args: [caseId: string]; result: ExtractedDataCategory[] }
  'extractedData:subcategories': {
    args: [caseId: string, category: string]
    result: ExtractedDataSubcategory[]
  }
  'extractedData:items': {
    args: [caseId: string, category: string, subcategory: string]
    result: ExtractedDataItem[]
  }
  'extractedData:count': { args: [caseId: string]; result: number }
  'extractedData:search': {
    args: [caseId: string, query: string]
    result: ExtractedDataSearchResult[]
  }
  'extractedData:reprocess': { args: [caseId: string]; result: { processed: number } }

  'db:stats': { args: []; result: DbStats }
  'db:tableRows': { args: [params: DbTableRowsParams]; result: DbTableRowsResult }
  'db:createRow': { args: [params: DbCreateRowParams]; result: Record<string, unknown> }
  'db:updateRow': { args: [params: DbUpdateRowParams]; result: boolean }
  'db:deleteRow': { args: [params: DbRowIdentifier]; result: boolean }
  'db:vacuum': { args: []; result: { freedBytes: number } }
  'db:rebuildFts': { args: []; result: { rowsIndexed: number; textsHealed: number } }
  'db:purgeArchived': { args: []; result: { casesDeleted: number; capturesDeleted: number } }
  'db:findOrphans': { args: []; result: OrphanReport }
  'db:cleanOrphans': {
    args: [report: OrphanReport]
    result: { dbRecordsRemoved: number; filesRemoved: number }
  }
  'db:backup': { args: []; result: { path: string } | null }
  'db:restore': { args: []; result: { restored: boolean } }
  'db:snapshots': { args: []; result: DbSnapshot[] }
  'db:restoreSnapshot': {
    args: [params: DbRestoreSnapshotParams]
    result: { restored: boolean }
  }
  'db:exportTable': { args: [params: DbExportTableParams]; result: { path: string } | null }

  'ai:analyze': {
    args: [params: AnalyzeCaptureParams]
    result: { content: string; tokenUsage: TokenUsage }
  }
  'ai:saveAnalysis': { args: [analysis: CaptureAnalysis]; result: void }
  'ai:getAnalysis': { args: [captureId: string]; result: CaptureAnalysis | null }

  'shell:showItemInFolder': { args: [path: string]; result: void }
  'shell:openPath': { args: [path: string]; result: void }

  'extension:path': { args: []; result: string }
  'extension:openFolder': { args: []; result: void }

  'app:getVersion': { args: []; result: string }
  'diagnostics:get': { args: []; result: DiagnosticsSnapshot }
  'diagnostics:log': { args: [payload: RendererLogPayload]; result: string }
  'diagnostics:recent': { args: [limit: number]; result: LogEntry[] }
  'diagnostics:revealLog': { args: []; result: void }
  'diagnostics:openStorageRoot': { args: []; result: void }
  'diagnostics:lastSession': { args: []; result: SessionRecord | null }
  'diagnostics:createReport': {
    args: [input: BugReportInput]
    result: BugReportResult | null
  }
  'diagnostics:unreconciledDeletions': { args: []; result: UnreconciledDeletionReport }

  'updates:getStatus': { args: []; result: UpdateStatus }
  'updates:check': { args: []; result: UpdateStatus }
  'updates:download': { args: []; result: void }
  'updates:install': { args: []; result: void }
}

export type ContractedChannel = keyof IpcInvokeContract

// Every declared channel is either an invoke channel with a contract entry or a
// main→renderer event. A new IPC_CHANNELS entry that is neither makes this type
// non-empty, and the assignment below fails to compile.
type UndeclaredChannel = Exclude<IpcChannel, ContractedChannel | IpcEventChannel>
type AssertNever<T extends never> = T
export type ChannelsAreExhaustive = AssertNever<UndeclaredChannel>

// --- Event contract ---------------------------------------------------------
//
// Main → renderer pushes, kept separate from the invoke map: these carry a
// single payload and have no reply. The preload subscribe helpers derive their
// callback types from here.
export interface IpcEventContract {
  'event:exportProgress': ExportProgressEvent
  'event:archiveProgress': ArchiveProgressEvent
  'event:newCapture': Capture
  'event:sessionStateChanged': SessionStateEvent
  'event:extensionConnection': ExtensionConnectionEvent
  'event:extensionAttach': ExtensionAttachEvent
  'event:captureActivity': CaptureEvent
  'event:selector:rematched': SelectorRematchedEvent
  'event:deepLinkNavigate': DeepLinkTarget
  'event:updateStatus': UpdateStatus
  'event:logEntry': LogEntry
}

export type IpcEventChannel = keyof IpcEventContract
