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

// Orthogonal trusted-time axis (#120), independent of integrity status. A
// capture is 'rfc3161' once an RFC 3161 token anchors its content hash,
// 'pending' while an eligible (v2) capture awaits stamping, and 'none' for
// grandfathered legacy captures that were never timestamped.
export type TrustedTime = 'rfc3161' | 'pending' | 'none'

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
  // Mirror of the manifest-authoritative trusted-time axis; rebuildable from the
  // manifest and used as the retry-worker queue (#120).
  trustedTimeStatus?: TrustedTime
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
  reduceMotion: boolean
  operatorName: string
  operatorRole: string
  operatorOrganization: string
  // RFC 3161 trusted-timestamp authority endpoint (#120). Defaults to DigiCert.
  tsaUrl: string
  autoCaptureMode: AutoCaptureMode
  lastActiveCaseId: string | null
  lastActiveSection: 'captures' | 'selectors' | 'notes' | 'tags' | 'data' | 'settings'
  hasCompletedOnboarding: boolean
  analysisSystemPrompt: string
  detailsPanelCollapsed: boolean
  tooltipsSeen: Record<string, boolean>
}

export interface OpenRouterModel {
  id: string
  name: string
  contextLength: number
  pricing: { prompt: string; completion: string }
}

export interface ExportOptions {
  format: 'html' | 'pdf' | 'zip'
  include: {
    captures: boolean
    screenshots: boolean
    auditTrail: boolean
    annotations: 'none' | 'burned'
  }
  investigatorName: string
  outputPath: string
}

export interface ExportPreflight {
  captureCount: number
  stampedCaptureCount: number
  unstampedCaptureCount: number
  pendingCaptureCount: number
  noneCaptureCount: number
}

export interface HashVerification {
  captureId: string
  url: string
  title: string
  storedHash: string
  computedHash: string
  // Integrity axis: did the bytes + chain survive intact?
  status: 'verified' | 'tampered' | 'missing' | 'chain-broken' | 'legacy'
  manifestIndex?: number
  chainValid?: boolean
  reason?: string
  // Trusted-time axis (#120), ORTHOGONAL to status: a byte-perfect capture is
  // integrity-verified regardless of whether it carries a trusted timestamp.
  trustedTime: TrustedTime
  // TSA identity and asserted time; present only when trustedTime is 'rfc3161'.
  tsaName?: string
  stampedAt?: string
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

export type AnnotationShape =
  | {
      kind: 'rect'
      id: string
      x: number
      y: number
      w: number
      h: number
      stroke: string
      strokeWidth: number
      fill?: string
    }
  | {
      kind: 'arrow'
      id: string
      x1: number
      y1: number
      x2: number
      y2: number
      stroke: string
      strokeWidth: number
    }
  | { kind: 'highlight'; id: string; x: number; y: number; w: number; h: number; color: string }
  | { kind: 'redact'; id: string; x: number; y: number; w: number; h: number; mode: 'solid' }
  | { kind: 'pin'; id: string; x: number; y: number; number: number; pinId: string }

export interface CaptureAnnotations {
  captureId: string
  schemaVersion: number
  shapes: AnnotationShape[]
  imageWidth: number
  imageHeight: number
  updatedAt: string
  updatedBy: string | null
}

export interface AnnotationPin {
  id: string
  captureId: string
  number: number
  body: string
  createdAt: string
  updatedAt: string
}

export interface AnnotationsBundle {
  annotations: CaptureAnnotations | null
  pins: AnnotationPin[]
}

export type AutoCaptureMode = 'auto' | 'notify' | 'per-case'

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

export interface TokenUsage {
  prompt: number
  completion: number
  total: number
}

export interface CaptureAnalysis {
  id: string
  captureId: string
  caseId: string
  content: string
  model: string
  tokenUsage: TokenUsage
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

export interface OperatorIdentity {
  installationId: string
  operatorName: string
  operatorRole: string
  operatorOrganization: string
}
