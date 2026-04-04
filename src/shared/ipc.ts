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

  // Tags
  TAGS_LIST: 'tags:list',
  TAGS_CREATE: 'tags:create',
  TAGS_UPDATE: 'tags:update',
  TAGS_DELETE: 'tags:delete',
  TAGS_ADD_TO_CAPTURE: 'tags:addToCapture',
  TAGS_REMOVE_FROM_CAPTURE: 'tags:removeFromCapture',
  TAGS_GET_FOR_CAPTURE: 'tags:getForCapture',
  TAGS_COUNT_FOR_CASE: 'tags:countForCase',

  // Search
  SEARCH: 'search:query',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_UPDATE: 'settings:update',
  SETTINGS_RESET: 'settings:reset',
  SETTINGS_TEST_OPENROUTER: 'settings:testOpenRouter',
  SETTINGS_LIST_MODELS: 'settings:listModels',

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

  // Notes
  NOTES_LIST: 'notes:list',
  NOTES_GET: 'notes:get',
  NOTES_CREATE: 'notes:create',
  NOTES_UPDATE: 'notes:update',
  NOTES_DELETE: 'notes:delete',
  NOTES_COUNT: 'notes:count',
  NOTES_SEARCH: 'notes:search',

  // Events (main -> renderer)
  EXPORT_PROGRESS: 'event:exportProgress',
  NEW_CAPTURE: 'event:newCapture',
  SESSION_STATE_CHANGED: 'event:sessionStateChanged',
  EXTENSION_CONNECTION: 'event:extensionConnection',

  // Capture pipeline observability
  CAPTURE_ACTIVITY: 'event:captureActivity',
  CAPTURES_TEST_PIPELINE: 'captures:testPipeline',
  CAPTURES_TEST_HTTP: 'captures:testHttp'
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
