// Stub types — real implementations come in later specs

export interface Case {
  id: string
  name: string
  description?: string
  type?: 'crypto' | 'malware' | 'fraud' | 'custom'
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
  source?: 'rule' | 'ai'
  createdAt: string
}

export interface BirdbrainSettings {
  openRouterApiKey: string | null
  defaultModel: string
  autoExtractEntities: boolean
  enabledEntityTypes: EntityType[]
  minEntityConfidence: number
  captureScreenshots: boolean
  captureHtml: boolean
  dedupeWindowSeconds: number
  ignoredUrlPatterns: string[]
  storagePath: string
  maxStorageMb: number | null
  theme: 'dark' | 'light'
  sidebarWidth: number
  autoCaptureMode: AutoCaptureMode
}

export interface OpenRouterModel {
  id: string
  name: string
  contextLength: number
  pricing: { prompt: string; completion: string }
}

export interface EntityNode {
  type: EntityType
  value: string
  captureIds: string[]
  firstSeen: string
  lastSeen: string
  occurrences: number
}

export interface EntityEdge {
  source: string
  target: string
  captureIds: string[]
  weight: number
}

export interface EntityGraph {
  nodes: EntityNode[]
  edges: EntityEdge[]
}

export interface CaseAnalysisResult {
  clusters: Array<{
    name: string
    entities: string[]
    summary: string
  }>
  timeline: Array<{
    observation: string
    significance: string
  }>
  suggestions: Array<{
    type: string
    description: string
    relatedCaptures: string[]
  }>
  summary: string
}

export interface ExportOptions {
  format: 'html' | 'pdf'
  include: {
    captures: boolean
    entities: boolean
    aiAnalysis: boolean
    screenshots: boolean
    auditTrail: boolean
  }
  investigatorName: string
  outputPath: string
}

export interface HashVerification {
  captureId: string
  url: string
  title: string
  storedHash: string
  computedHash: string
  status: 'verified' | 'tampered' | 'missing'
}

export interface Selector {
  id: string
  caseId: string
  pattern: string
  isRegex: boolean
  enabled: boolean
  label?: string
  createdAt: string
}

export interface SelectorMatch {
  selectorId: string
  caseId: string
  caseName: string
  pattern: string
  matchText: string
  context: string
  index: number
}

export interface ActiveCaseSelectors {
  caseId: string
  caseName: string
  selectors: Selector[]
}

export type AutoCaptureMode = 'auto' | 'notify' | 'per-case'

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
