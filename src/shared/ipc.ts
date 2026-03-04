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

  // Events (main -> renderer)
  NEW_CAPTURE: 'event:newCapture',
  SESSION_STATE_CHANGED: 'event:sessionStateChanged'
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
