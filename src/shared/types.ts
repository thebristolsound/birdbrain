// Shared domain types. Imported by main, preload and renderer alike, so a
// change here is a change to the contract between all three.

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
export interface WaybackRef {
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

// UI density step (#385). Selects the root density custom properties defined in
// src/renderer/styles/globals.css: 'default' is the :root step, the other two
// are selected by `data-density` on <html>. Padding, row heights and gaps only —
// radius does not scale with density.
export const UI_DENSITIES = ['compact', 'default', 'comfortable'] as const
export type UiDensity = (typeof UI_DENSITIES)[number]

// First-run density. Compact is the design default and the pixel-match
// reference for the 2026-08 design handoff, so a fresh install starts there
// rather than on the ':root' step. Keep in sync with the fallback in
// src/renderer/public/theme-init.js, which cannot import from here (classic
// script, no bundler).
export const DEFAULT_UI_DENSITY: UiDensity = 'compact'

export interface BirdbrainSettings {
  openRouterApiKey: string | null
  defaultModel: string
  captureScreenshots: boolean
  dedupeWindowSeconds: number
  ignoredUrlPatterns: string[]
  storagePath: string
  theme: 'dark' | 'light'
  reduceMotion: boolean
  density: UiDensity
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

// Key-protection state for a secret wrapped by Electron's safeStorage (the OS
// credential store — Keychain / DPAPI / a Linux Secret Service such as
// gnome-keyring). 'not-set' only applies to the revocable OpenRouter key —
// the signing key always exists once the app has finished starting, so it is
// always 'protected' or 'plaintext'. See #414.
export type KeyProtectionState = 'protected' | 'plaintext' | 'not-set'

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
  // At-rest protection state of this installation's secrets — see #414.
  keyProtection: {
    signingKey: KeyProtectionState
    openRouterKey: KeyProtectionState
  }
}

// Manifest/database reconciliation (#622). A capture delete appends its signed
// `deletion` entry BEFORE unlinking files and removing the row. If the process
// dies in that window the chain is left valid and complete while the database
// still holds the capture — a disagreement no chain check can see, because
// nothing about the chain is wrong.
export interface UnreconciledDeletionFinding {
  caseId: string
  caseName: string
  captureId: string
  // Position of the deletion entry in the case's manifest chain.
  manifestIndex: number
  // The deletion entry's own timestamp — when the delete was recorded, which is
  // not when the finding was observed.
  entryTimestamp: string
  operatorName: string
  // #580's optional reason field: distinguishes a self-test cleanup from an
  // operator deletion. Absent on entries that carried none.
  reason?: string
}

// A case the scan could not make the "chain valid" claim over, so it reports
// nothing about that case's deletions rather than implying it found none.
export interface UnscannedCase {
  caseId: string
  caseName: string
  reason: string
}

export interface UnreconciledDeletionReport {
  generatedAt: string
  // False when the database, storage root or signing key was not available, so
  // no scan ran at all. The panel must not render "none found" over that.
  available: boolean
  casesScanned: number
  findings: UnreconciledDeletionFinding[]
  unscanned: UnscannedCase[]
}

// Diagnostic logging. Entries are structural only — see logSafe.ts for the
// boundary that keeps investigation data (URLs, case names, paths) out of
// them. No `message` field: free-form prose (e.g. a case name typed into an
// error string) has no path/URL shape a regex could catch, so the field that
// would carry it is simply not part of the type. `name` and `code` are
// allowlisted (see ERROR_NAMES below); `stack` is capped and relativized to
// the app root.
//
// The four vocabularies live here rather than in logSafe.ts because all three
// processes need them: the renderer types its own payloads against LogCode,
// and `src/shared/**` may not import from `@main/*`. Only the vocabulary is
// shared — the branding, validators and per-key formats stay in logSafe.ts,
// which is main-only by design.
export type LogLevel = 'error' | 'warn' | 'info'

// Pinned set of main-process log sources, plus a plain 'renderer' member —
// not a `renderer:*` prefix convention — so the forwarding bridge can filter
// on a single equality check (`entry.source === 'renderer'`); the renderer's
// own codes ('query.failed' etc.) already carry whatever differentiation is
// needed for that side.
export const LOG_SOURCES = [
  'app',
  'ipc',
  'captureServer',
  'captureLifecycle',
  'backgroundRenderer',
  'openrouter',
  'serverToken',
  'settings',
  'thumbnails',
  'selectorLifecycle',
  'consentBlocker',
  'timestampWorker',
  'db',
  'signingKey',
  'renderer'
] as const
export type LogSource = (typeof LOG_SOURCES)[number]

// Pinned code vocabulary, then codes appended for real console.* call sites in
// src/main (12 files, audited) that don't map onto any pinned code without
// forcing a poor fit. Extending this union is the review gate for a new call
// site.
export const LOG_CODES = [
  // --- pinned ---
  'app.session_start',
  'app.uncaught_exception',
  'app.unhandled_rejection',
  'app.render_process_gone',
  'app.child_process_gone',
  'app.storage_init_failed',
  'capture.failed',
  'capture.screenshot_dropped',
  'capture.server_started',
  'capture.extraction_failed',
  'ipc.handler_threw',
  'query.failed',
  'mutation.failed',
  'react.render_error',
  // --- appended: real call sites with no pinned-code fit ---
  'captureServer.selector_create_failed',
  'captureLifecycle.tls_refetch_failed',
  'captureLifecycle.selector_match_failed',
  'captureLifecycle.reprocess_failed',
  'backgroundRenderer.trim_failed',
  'backgroundRenderer.consent_blocker_disable_failed',
  'backgroundRenderer.consent_blocker_enable_failed',
  'consentBlocker.filter_engine_failed',
  'selectorLifecycle.retroactive_match_failed',
  'serverToken.token_invalid',
  'serverToken.token_read_failed',
  'serverToken.token_persist_failed',
  'settings.schema_invalid',
  'thumbnails.generate_failed',
  'openrouter.rate_limited',
  'openrouter.request_failed',
  'openrouter.retry',
  'openrouter.retries_exhausted',
  'timestampWorker.stamp_failed',
  // Pre-migration snapshots (#413). The creation entry is the only durable
  // record that an upgrade was recoverable; the prune entry is the only place
  // a snapshot directory that has stopped bounding itself shows up.
  'db.snapshot_created',
  'db.snapshot_prune_failed',
  // A restore that failed and the re-open that follows it are logged
  // separately: the second can happen without the first, and only the log
  // keeps the first once the renderer has been told about the second.
  'db.snapshot_restore_failed',
  // A failed restore that also left nothing openable at the database path.
  // Distinct because it is the one case where the app deliberately does not
  // re-open: migrating a truncated file forward would build a fresh, empty
  // schema over the operator's data (#428).
  'db.snapshot_restore_left_no_database',
  'db.reopen_failed',
  // Fallback for notify.error() with no explicit code. Its presence in a log
  // is a signal to give that call site a real code.
  'app.unclassified_error',
  'app.startup_failed',
  'app.bug_report_failed',
  'app.installation_id',
  // The at-rest key-protection gate (#414): recorded either way so the log
  // carries the same signal the Settings/Diagnostics indicator shows live.
  'signingKey.unprotected_key_acknowledged',
  'signingKey.generation_declined',
  // getOpenRouterKeyProtectionState (#414 review) reading settings.json to
  // report protection state, distinct from settings.schema_invalid above:
  // this fires only when the file can't even be parsed as JSON, so the
  // Diagnostics "not-set" it falls back to is otherwise indistinguishable
  // from a key that was genuinely never saved.
  'settings.key_protection_state_unreadable'
] as const
export type LogCode = (typeof LOG_CODES)[number]

// Pinned context key vocabulary. A LogEntry's `context` being
// `Partial<Record<LogContextKey, ...>>` rather than `Record<string, ...>`
// makes a computed or misspelled key a compile error at any call site that
// writes an object literal; logSafe's `context()` is the runtime second net
// for values built dynamically (spread, computed keys) that bypass that check.
export const LOG_CONTEXT_KEYS = [
  'captureId',
  'caseId',
  'noteId',
  'selectorId',
  'bytes',
  'count',
  'ms',
  'port',
  'format',
  'reason',
  'exitCode',
  'processType',
  'errorCode',
  'status',
  // session.start metadata — the only identifying fields a standalone
  // birdbrain.log carries, so they must be permitted keys.
  'installationId',
  'version',
  'platform',
  'installFormat',
  'packaged',
  // Renderer-originated: the query-key domain segment, the ErrorBoundary that
  // caught, and the IPC channel that threw. All three are static identifiers
  // from the source, never user data — but they still pass through the
  // per-key format check on the main side, because the renderer is not
  // trusted.
  'domain',
  'boundary',
  'channel',
  'attempt'
] as const
export type LogContextKey = (typeof LOG_CONTEXT_KEYS)[number]

// Known error class names seen in this codebase (built-ins, DOM/fetch
// AbortError, better-sqlite3's SqliteError, and this app's own IpcFailure /
// ManifestRollback). Not exhaustive — `err.name` is a writable, unvalidated
// string, so anything outside this set records as 'UnknownError' rather than
// being passed through.
export const ERROR_NAMES = [
  'Error',
  'TypeError',
  'RangeError',
  'SyntaxError',
  'URIError',
  'ReferenceError',
  'EvalError',
  'AggregateError',
  'DOMException',
  'AbortError',
  'SqliteError',
  'IpcFailure',
  'ManifestRollback',
  'PreMigrationSnapshotError'
] as const

export interface LoggedError {
  name: string
  code: string | null
  stack: string | null
}

export interface LogEntry {
  id: string
  sessionId: string
  timestamp: string
  level: LogLevel
  source: LogSource
  code: LogCode
  // Partial<Record<...>> so an arbitrary computed key is a COMPILE error.
  context?: Partial<Record<LogContextKey, string | number | boolean | null>>
  error?: LoggedError
}

// One record per app launch. cleanExit flips to true only in before-quit, so a
// record left false is how a crash or power loss becomes visible next launch.
export interface SessionRecord {
  sessionId: string
  startedAt: string
  endedAt: string | null
  version: string
  platform: string
  installFormat: string
  cleanExit: boolean
  // Set once the crash prompt has been shown, so it is offered exactly once.
  acknowledged?: boolean
}

export interface BugReportInput {
  whatYouDid: string
  whatYouExpected: string
  whatHappened: string
  correlationId?: string
}

export interface BugReportResult {
  path: string
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
