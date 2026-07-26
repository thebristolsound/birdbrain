// The cross-process domain types shared by main, preload, and renderer.

import type { NoteAnchor } from '@shared/noteAnchor'

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

// How the capture was produced (#recapture). 'extension' = operator-witnessed
// via the Chrome extension; 'background' = silent hidden-window recapture.
export const CAPTURE_METHODS = ['extension', 'background'] as const
export type CaptureMethod = (typeof CAPTURE_METHODS)[number]

// How consent/cookie-notice overlays were neutralized during a background
// recapture. 'filter-list' = maintained consent filter lists (EasyList Cookie +
// uBO annoyances-cookies) were active in the rendering session. Absent for
// operator-witnessed captures and for recaptures where the filter engine was
// unavailable — the clean session saw the page bare.
export const CONSENT_SUPPRESSIONS = ['filter-list'] as const
export type ConsentSuppression = (typeof CONSENT_SUPPRESSIONS)[number]

// Orthogonal trusted-time axis (#120), independent of integrity status. A
// capture is 'rfc3161' once an RFC 3161 token anchors its content hash,
// 'pending' while an eligible (v2) capture awaits stamping, and 'none' for
// grandfathered legacy captures that were never timestamped.
export type TrustedTime = 'rfc3161' | 'pending' | 'none'

// Corroboration-only TLS cert chain re-fetched from the origin AFTER a capture
// is stored (#123, ADR-0002). NOT bound to the captured transaction — it records
// whatever cert the origin was serving at `refetchedAt` (distinct from the
// capture timestamp). Surfaced as corroboration only.
export interface TlsCertSummary {
  subject: string
  issuer: string
  validFrom: string
  validTo: string
  fingerprint256: string
  serialNumber: string
  subjectAltNames: string[]
}

export interface TlsCertChain {
  url: string
  refetchedAt: string
  chain: TlsCertSummary[]
}

export interface TlsCertChainError {
  url: string
  refetchedAt: string
  error: string
}

export type TlsCertChainResult = TlsCertChain | TlsCertChainError

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
  method: CaptureMethod
  // Set when this capture was created by "Recapture" of an existing capture.
  // The original is never touched — linked sibling, both fully visible.
  supersedesCaptureId?: string
  // Consent-overlay suppression active while the page rendered; mirrors the
  // value anchored in the manifest capture entry. undefined = none.
  consentSuppression?: ConsentSuppression
  mhtmlPath?: string
  // Content-addressed integrity of the screenshot / extracted-text sidecars (#118).
  // Mirrors the hash recorded in the v2+ manifest capture entry; undefined for
  // legacy/no-artifact captures (not sidecar-checked at verify time).
  screenshotHash?: string
  textHash?: string
  // Mirror of the corroboration-only TLS cert chain anchored in the v2+ manifest
  // capture entry (#123). undefined for legacy / cert-less captures.
  tlsCertChain?: TlsCertChainResult
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

// --- Wayback Machine corroboration (#wayback) ---
// Post-capture, corroboration-only lookup of archive.org's independent record
// of a captured URL. NOT bound to the captured transaction (cf. TLS cert chain,
// #123). A WaybackSnapshot is one archive.org capture of the URL.
export interface WaybackSnapshot {
  timestamp: string // ISO 8601, UTC — derived from the CDX 14-digit timestamp
  snapshotUrl: string // https://web.archive.org/web/<cdxTimestamp>/<originalUrl>
  originalUrl: string
  statusCode?: number
  mimeType?: string
  digest?: string
}

export interface WaybackLookupResult {
  snapshots: WaybackSnapshot[]
  closestIndex: number | null // index into snapshots nearest the capture time; null when empty
  checkedAt: string // ISO 8601 — when the lookup ran
}

// A WaybackSnapshot the user has pinned to a capture (persisted corroboration
// reference). Columns reserved for the future download-later phase
// (contentPath/contentHash/manifestIndex) are intentionally omitted here.
export interface ArchiveRef {
  id: string
  captureId: string
  snapshotTimestamp: string // ISO 8601
  snapshotUrl: string
  originalUrl: string
  digest?: string
  statusCode?: number
  mimeType?: string
  checkedAt: string // when the lookup that produced this ran
  pinnedAt: string // when the user pinned it
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

// Release track the app follows for update delivery. 'stable' sees only tagged
// (non-prerelease) GitHub releases; 'beta' additionally sees alpha/beta
// prereleases. Maps to electron-updater's `allowPrerelease` in the updater
// service — see docs/specs/2026-07-07-update-delivery-release-channels-design.md.
export type ReleaseChannel = 'stable' | 'beta'

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
  lastActiveSection: 'overview' | 'captures' | 'selectors' | 'notes' | 'tags' | 'data' | 'settings'
  hasCompletedOnboarding: boolean
  analysisSystemPrompt: string
  detailsPanelCollapsed: boolean
  tooltipsSeen: Record<string, boolean>
  // Update delivery. `releaseChannel` selects the GitHub release track;
  // `autoCheckForUpdates` gates the background check schedule (manual checks are
  // always available). First-run `releaseChannel` is derived from the installed
  // version's prerelease suffix in initSettings().
  releaseChannel: ReleaseChannel
  autoCheckForUpdates: boolean
}

// Update-delivery state machine surfaced to the renderer. Phase 1 (notify) only
// ever reaches idle → checking → up-to-date | available | error; the
// downloading/downloaded states are reserved for the Phase 2 auto-install path.
export type UpdateState =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'error'

export interface UpdateStatus {
  state: UpdateState
  currentVersion: string
  // Present when state is 'available'/'downloading'/'downloaded'.
  availableVersion?: string
  // GitHub release page for `availableVersion`, for the notify "View release" link.
  releaseNotesUrl?: string
  // Download progress percent (0–100); present only while 'downloading'.
  percent?: number
  // Human-readable error message; present only when state is 'error'.
  error?: string
  // False on platforms/builds where the app can only notify (unsigned mac,
  // archive installs, dev). The UI degrades to a "View release" link instead
  // of download/install.
  supportsAutoInstall: boolean
  // Whether a downloaded update installs itself on next quit. False for deb,
  // where installing needs a system password prompt and therefore only runs
  // via the explicit "Restart to update" action.
  installOnQuit: boolean
}

// Runtime diagnostics (Settings → Diagnostics). Snapshot of app environment,
// main-process responsiveness, storage, and the slow-operation log.
export interface DiagnosticsProcessInfo {
  type: string
  pid: number
  cpuPercent: number
  memoryMB: number
}

// A span where the main-process event loop was blocked (the macOS "pinwheel").
export interface DiagnosticsStall {
  at: string
  ms: number
}

// A recorded expensive operation (e.g. per-capture data extraction).
export interface DiagnosticsSlowOp {
  at: string
  kind: string
  detail: string
  ms: number
}

export interface DiagnosticsSnapshot {
  generatedAt: string
  app: {
    version: string
    electron: string
    chrome: string
    node: string
    platform: string
    arch: string
    packaged: boolean
    // 'nsis' | 'appimage' | 'deb' | 'mac' | 'archive' | 'dev'
    installFormat: string
  }
  uptimeSeconds: number
  processes: DiagnosticsProcessInfo[]
  eventLoop: {
    currentLagMs: number
    maxLagLastMinuteMs: number
    stalls: DiagnosticsStall[]
  }
  storage: {
    storageRoot: string
    dbPath: string
    dbSizeBytes: number
    walSizeBytes: number
  }
  data: {
    schemaVersion: number
    latestSchemaVersion: number
    cases: number
    captures: number
    notes: number
    selectors: number
    extractedData: number
  }
  slowOps: DiagnosticsSlowOp[]
}

// Diagnostic logging. Entries are structural only — see logSafe.ts for the
// boundary that keeps investigation data (URLs, case names, paths) out of
// them. No `message` field: free-form prose (e.g. a case name typed into an
// error string) has no path/URL shape a regex could catch, so the field that
// would carry it is simply not part of the type. `name` and `code` are
// allowlisted (see logSafe.ERROR_NAMES); `stack` is capped and relativized to
// the app root.
export interface LoggedError {
  name: string
  code: string | null
  stack: string | null
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
  /** Plain text, derived from bodyDoc in main. This is what FTS indexes. */
  body: string
  /** Serialized ProseMirror JSON. Absent on notes written before rich text. */
  bodyDoc?: string
  /**
   * What the note points at. Parsed and validated in main on every write, so
   * a stored anchor always fits one of the four kinds. Absent = unanchored.
   */
  anchor?: NoteAnchor
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

export interface ExtractedDataSearchResult {
  value: string
  category: string
  subcategory: string
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

export type CaptureSource = 'auto' | 'manual' | 'selector' | 'recapture'

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
  warning?: string
  // The capture a background recapture supersedes (set only for recapture jobs
  // fired from an existing capture). Lets the UI scope in-progress state to the
  // exact capture being recaptured, not every capture that shares its URL —
  // recapture creates same-URL siblings, so URL alone is ambiguous.
  supersedesCaptureId?: string
}

export interface OperatorIdentity {
  installationId: string
  operatorName: string
  operatorRole: string
  operatorOrganization: string
}

// Verification summary of a .birdbrain case archive, recorded in the signed
// `import` manifest entry and surfaced in the import preflight UI.
export interface ArchiveVerificationResult {
  overallValid: boolean
  chainValid: boolean
  chainReason?: string
  artifactCount: number
  artifactFailureCount: number
  captureCount: number
  captureHashFailureCount: number
}

// Summary counts surfaced in a .birdbrain archive's package.json header, so a
// reviewer can sanity-check archive contents without parsing data.json.
export interface CaseArchiveCounts {
  captures: number
  notes: number
  tags: number
  selectors: number
  annotations: number
  extractedData: number
  archiveRefs: number
}

// Full read-only inspection report for a .birdbrain case archive, surfaced in
// the import preflight UI before any data is written.
export interface ArchiveInspectReport {
  archivePath: string
  schemaVersion: number
  exportedAt: string
  toolVersion: string
  caseName: string
  caseDescription: string | null
  sourceInstallationId: string
  sourceOperatorName: string
  counts: CaseArchiveCounts
  verification: ArchiveVerificationResult
}
