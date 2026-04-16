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

export type CaptureFormat = 'html' | 'mhtml'

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
  // Forensic MHTML fields (populated for format='mhtml', undefined for legacy 'html')
  format: CaptureFormat
  mhtmlPath?: string
  sizeBytes?: number
  manifestIndex?: number
  prevHash?: string
  entryHash?: string
  toolVersion?: string
  extensionVersion?: string
  browserVersion?: string
  userAgent?: string
  httpStatus?: number
  operatorId?: string
  operatorName?: string
  // Persisted verification state — populated after a manual or export-time verify runs
  lastVerifiedAt?: string
  lastVerifiedHash?: string
  lastVerifiedStatus?: HashVerification['status']
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

export interface BirdbrainSettings {
  openRouterApiKey: string | null
  defaultModel: string
  captureScreenshots: boolean
  dedupeWindowSeconds: number
  ignoredUrlPatterns: string[]
  storagePath: string
  theme: 'dark' | 'light'
  operatorName: string
  autoCaptureMode: AutoCaptureMode
  lastActiveCaseId: string | null
  lastActiveSection: 'captures' | 'selectors' | 'notes' | 'tags' | 'settings'
  hasCompletedOnboarding: boolean
  analysisSystemPrompt: string
}

export interface OpenRouterModel {
  id: string
  name: string
  contextLength: number
  pricing: { prompt: string; completion: string }
}

export interface ExportOptions {
  format: 'html' | 'pdf'
  include: {
    captures: boolean
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
  status: 'verified' | 'tampered' | 'missing' | 'chain-broken' | 'legacy'
  manifestIndex?: number
  chainValid?: boolean
  reason?: string
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

export interface SelectorMatchExportRow {
  selectorPattern: string
  selectorLabel: string | null
  isRegex: boolean
  captureUrl: string
  captureTitle: string | null
  captureTimestamp: string
}

export interface Note {
  id: string
  caseId: string
  captureId?: string
  title: string
  body: string
  sourceUrl?: string
  screenshotPath?: string
  createdAt: string
  updatedAt: string
}

export type AutoCaptureMode = 'auto' | 'notify' | 'per-case'

export interface CaptureAnalysis {
  id: string
  captureId: string
  caseId: string
  content: string
  model: string
  tokenUsage: {
    prompt: number
    completion: number
    total: number
  }
  createdAt: string
  updatedAt: string
}

export type CaptureSource = 'auto' | 'manual' | 'selector'

export interface CaptureEvent {
  type: 'received' | 'stored' | 'failed' | 'skipped'
  captureId?: string
  source: CaptureSource
  url: string
  timestamp: string
  error?: string
  skipReason?: string
  durationMs?: number
  screenshotWarning?: string
}

export interface ExtractedDataCategory {
  category: string
  count: number
}

export interface ExtractedDataSubcategory {
  subcategory: string
  count: number
}

export interface ExtractedDataItem {
  value: string
  pageCount: number
  sourceUrls: string[]
}
