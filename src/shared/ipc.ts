// Typed IPC channel definitions
// Every IPC call between renderer and main process goes through these channels

import type {
  ActiveCaseSelectors,
  AnnotationPin,
  AnnotationShape,
  AnnotationsBundle,
  ArchiveInspectReport,
  ArchiveRef,
  BirdbrainSettings,
  Capture,
  CaptureAnalysis,
  CaptureAnnotations,
  CaptureEvent,
  Case,
  DiagnosticsSnapshot,
  ExportOptions,
  ExportPreflight,
  ExtractedDataCategory,
  ExtractedDataItem,
  ExtractedDataSearchResult,
  ExtractedDataSubcategory,
  HashVerification,
  Note,
  OpenRouterModel,
  OperatorIdentity,
  Selector,
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

  // Recapture
  RECAPTURE_ENQUEUE: 'recapture:enqueue',
  RECAPTURE_QUEUE_STATUS: 'recapture:queueStatus',

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
  SELECTORS_DELETE: 'selectors:delete',
  SELECTORS_LIST_ACTIVE: 'selectors:listActive',
  SELECTORS_MATCH_COUNTS: 'selectors:matchCounts',
  SELECTORS_MATCHING_CAPTURES: 'selectors:matchingCaptures',
  SELECTORS_COVERAGE: 'selectors:coverage',
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

  // Archive (Wayback corroboration)
  ARCHIVE_LOOKUP: 'archive:lookup',
  ARCHIVE_LIST: 'archive:list',
  ARCHIVE_PIN: 'archive:pin',
  ARCHIVE_UNPIN: 'archive:unpin',

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
  archived?: boolean
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

export interface CreateSelectorParams {
  caseId: string
  pattern: string
  isRegex?: boolean
  label?: string
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
  sourceUrl?: string
  screenshotPath?: string
}

export interface UpdateNoteParams {
  id: string
  title?: string
  body?: string
  bodyDoc?: string
}

export interface PinArchiveSnapshotParams {
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
  selectors: Array<{ pattern: string; isRegex: boolean; label?: string }>
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

// --- Invoke contract --------------------------------------------------------
//
// One entry per invoke channel: the argument tuple the renderer sends and the
// value the handler resolves to (before the { ok, data } envelope is applied).
// This is the single source of truth — `handle()` constrains a handler's
// signature by its channel, so a handler that drifts from its entry is a
// compile error rather than a runtime surprise.
//
// Channels are added here domain by domain; a channel absent from the map still
// registers, but without the signature check.
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
  'captures:testPipeline': { args: []; result: SelfTestResult }
  'captures:testHttp': { args: []; result: SelfTestResult }

  'recapture:enqueue': { args: [payload: RecaptureEnqueuePayload]; result: EnqueueResult }
  'recapture:queueStatus': { args: []; result: RecaptureQueueStatus }

  'tags:list': { args: []; result: Tag[] }
  'tags:create': { args: [params: CreateTagParams]; result: Tag }
  'tags:update': { args: [params: UpdateTagParams]; result: Tag | undefined }
  'tags:delete': { args: [id: string]; result: boolean }
  'tags:addToCapture': { args: [params: CaptureTagParams]; result: void }
  'tags:removeFromCapture': { args: [params: CaptureTagParams]; result: void }
  'tags:getForCapture': { args: [captureId: string]; result: Tag[] }
  'tags:countForCase': { args: [caseId: string]; result: number }
  'tags:usageCountsForCase': { args: [caseId: string]; result: Record<string, number> }

  'selectors:list': { args: [caseId: string]; result: Selector[] }
  'selectors:get': { args: [id: string]; result: Selector | undefined }
  'selectors:create': { args: [params: CreateSelectorParams]; result: Selector }
  'selectors:update': { args: [params: UpdateSelectorParams]; result: Selector | undefined }
  'selectors:delete': { args: [id: string]; result: boolean }
  'selectors:listActive': { args: []; result: ActiveCaseSelectors[] }
  'selectors:matchCounts': { args: [caseId: string]; result: Record<string, number> }
  'selectors:matchingCaptures': {
    args: [caseId: string, selectorIds: string[]]
    result: string[]
  }
  'selectors:coverage': { args: [caseId: string]; result: { matched: number; total: number } }
  'selectors:bulkCreate': { args: [params: BulkCreateSelectorsParams]; result: Selector[] }
  'selectors:exportMatches': {
    args: [caseId: string]
    result: { exported: boolean; path?: string }
  }

  'notes:list': { args: [caseId: string]; result: Note[] }
  'notes:get': { args: [id: string]; result: Note | undefined }
  'notes:create': { args: [params: CreateNoteParams]; result: Note }
  'notes:update': { args: [params: UpdateNoteParams]; result: Note | undefined }
  'notes:delete': { args: [id: string]; result: boolean }
  'notes:count': { args: [caseId: string]; result: number }
  'notes:search': { args: [caseId: string, query: string]; result: Note[] }

  'search:query': { args: [caseId: string, query: string]; result: Capture[] }

  'settings:get': { args: []; result: BirdbrainSettings }
  'settings:update': { args: [partial: Partial<BirdbrainSettings>]; result: BirdbrainSettings }
  'settings:reset': { args: []; result: BirdbrainSettings }
  'settings:testOpenRouter': { args: [apiKey: string]; result: boolean }
  'settings:listModels': { args: [apiKey: string]; result: OpenRouterModel[] }
  'settings:getIdentity': { args: []; result: OperatorIdentity }
  'settings:chooseStoragePath': { args: []; result: string | null }

  'export:preflight': { args: [caseId: string]; result: ExportPreflight }
  'export:generate': { args: [caseId: string, options: ExportOptions]; result: ExportResult }

  'archive:lookup': { args: [captureId: string]; result: WaybackLookupResult }
  'archive:list': { args: [captureId: string]; result: ArchiveRef[] }
  'archive:pin': { args: [params: PinArchiveSnapshotParams]; result: ArchiveRef }
  'archive:unpin': { args: [refId: string]; result: boolean }

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
  'db:exportTable': { args: [params: DbExportTableParams]; result: { path: string } | null }

  'ai:analyze': {
    args: [params: AnalyzeCaptureParams]
    result: { content: string; tokenUsage: TokenUsage }
  }
  'ai:saveAnalysis': { args: [analysis: CaptureAnalysis]; result: void }
  'ai:getAnalysis': { args: [params: { captureId: string }]; result: CaptureAnalysis | null }

  'shell:showItemInFolder': { args: [path: string]; result: void }
  'shell:openPath': { args: [path: string]; result: void }

  'extension:path': { args: []; result: string }
  'extension:openFolder': { args: []; result: void }

  'app:getVersion': { args: []; result: string }
  'diagnostics:get': { args: []; result: DiagnosticsSnapshot }

  'updates:getStatus': { args: []; result: UpdateStatus }
  'updates:check': { args: []; result: UpdateStatus }
  'updates:download': { args: []; result: void }
  'updates:install': { args: []; result: void }
}

export type ContractedChannel = keyof IpcInvokeContract

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
  'event:captureActivity': CaptureEvent
  'event:selector:rematched': SelectorRematchedEvent
  'event:deepLinkNavigate': DeepLinkTarget
  'event:updateStatus': UpdateStatus
}

export type IpcEventChannel = keyof IpcEventContract
