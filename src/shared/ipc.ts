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

  // Tags
  TAGS_LIST: 'tags:list',
  TAGS_CREATE: 'tags:create',
  TAGS_UPDATE: 'tags:update',
  TAGS_DELETE: 'tags:delete',
  TAGS_ADD_TO_CAPTURE: 'tags:addToCapture',
  TAGS_REMOVE_FROM_CAPTURE: 'tags:removeFromCapture',
  TAGS_GET_FOR_CAPTURE: 'tags:getForCapture',

  // Search
  SEARCH: 'search:query',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_UPDATE: 'settings:update',
  SETTINGS_RESET: 'settings:reset',
  SETTINGS_TEST_OPENROUTER: 'settings:testOpenRouter',
  SETTINGS_LIST_MODELS: 'settings:listModels',

  // AI
  AI_EXTRACT_ENTITIES: 'ai:extractEntities',
  AI_GET_ENTITIES: 'ai:getEntities',
  AI_BUILD_GRAPH: 'ai:buildGraph',
  AI_ANALYZE_CASE: 'ai:analyzeCase',
  AI_GET_ANALYSIS: 'ai:getAnalysis',

  // Export
  EXPORT_GENERATE: 'export:generate',

  // Selectors
  SELECTORS_LIST: 'selectors:list',
  SELECTORS_GET: 'selectors:get',
  SELECTORS_CREATE: 'selectors:create',
  SELECTORS_UPDATE: 'selectors:update',
  SELECTORS_DELETE: 'selectors:delete',
  SELECTORS_LIST_ACTIVE: 'selectors:listActive',

  // Events (main -> renderer)
  EXTRACTION_COMPLETE: 'event:extractionComplete',
  EXPORT_PROGRESS: 'event:exportProgress',
  NEW_CAPTURE: 'event:newCapture',
  SESSION_STATE_CHANGED: 'event:sessionStateChanged',
  EXTENSION_CONNECTION: 'event:extensionConnection'
} as const

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS]

// Payload types for IPC calls
export interface CreateCaseParams {
  name: string
  description?: string
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
