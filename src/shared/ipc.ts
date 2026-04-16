// Typed IPC channel definitions
// Every IPC call between renderer and main process goes through these channels

export const IPC_CHANNELS = {
  // Cases
  CASES_LIST: 'cases:list',
  CASES_GET: 'cases:get',
  CASES_CREATE: 'cases:create',
  CASES_UPDATE: 'cases:update',
  CASES_DELETE: 'cases:delete',

  // Captures
  CAPTURES_LIST: 'captures:list',
  CAPTURES_GET: 'captures:get',
  CAPTURES_DELETE: 'captures:delete',
  CAPTURES_GET_CONTENT: 'captures:getContent',
  CAPTURES_GET_THUMBNAIL: 'captures:getThumbnail',
  CAPTURES_GET_MATCHING_SELECTORS: 'captures:getMatchingSelectors',
  CAPTURES_DOWNLOAD: 'captures:download',
  CAPTURES_OPEN_EXTERNAL: 'captures:openExternal',
  CAPTURES_COUNTS_BY_CASE: 'captures:countsByCase',
  CAPTURES_TOGGLE_FAVORITE: 'captures:toggleFavorite',
  CAPTURES_IS_FAVORITE: 'captures:isFavorite',
  CAPTURES_LIST_FAVORITES: 'captures:listFavorites',
  CAPTURES_VERIFY: 'captures:verify',
  CAPTURES_GET_MHTML_URL: 'captures:getMhtmlUrl',

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

  // Extension
  EXTENSION_PATH: 'extension:path',
  EXTENSION_OPEN_FOLDER: 'extension:openFolder',

  // Events (main -> renderer)
  EXPORT_PROGRESS: 'event:exportProgress',
  NEW_CAPTURE: 'event:newCapture',
  SESSION_STATE_CHANGED: 'event:sessionStateChanged',
  EXTENSION_CONNECTION: 'event:extensionConnection',

  // Capture pipeline observability
  CAPTURE_ACTIVITY: 'event:captureActivity',
  CAPTURES_TEST_PIPELINE: 'captures:testPipeline',
  CAPTURES_TEST_HTTP: 'captures:testHttp',

  // AI Analysis
  AI_ANALYZE: 'ai:analyze',
  AI_UPSERT_ANALYSIS: 'ai:upsertAnalysis',
  AI_GET_ANALYSIS: 'ai:getAnalysis',
  AI_DELETE_ANALYSIS: 'ai:deleteAnalysis',

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

export interface CreateNoteParams {
  caseId: string
  captureId?: string
  title?: string
  body?: string
  sourceUrl?: string
  screenshotPath?: string
}

export interface UpdateNoteParams {
  id: string
  title?: string
  body?: string
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

export interface UpsertAnalysisParams {
  captureId: string
  caseId: string
  content: string
  model: string
  tokenUsage: { prompt: number; completion: number; total: number }
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
