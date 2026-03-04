// Stub types — real implementations come in later specs

export interface Case {
  id: string
  name: string
  description?: string
  createdAt: string
  updatedAt: string
  archived: boolean
}

export interface Capture {
  id: string
  caseId: string
  url: string
  title: string
  htmlPath?: string
  screenshotPath?: string
  hash: string
  timestamp: string
  headers?: string
  createdAt: string
}

export interface Tag {
  id: string
  name: string
  color?: string
}

export interface CaptureTag {
  captureId: string
  tagId: string
}

export interface Entity {
  id: string
  captureId: string
  type: EntityType
  value: string
  context?: string
  confidence?: number
  createdAt: string
}

export type EntityType =
  | 'person'
  | 'organization'
  | 'email'
  | 'phone'
  | 'domain'
  | 'ip_address'
  | 'address'
  | 'date'
  | 'username'
  | 'crypto_wallet'
  | 'custom'
