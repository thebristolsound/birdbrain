// Shared domain types. Imported by main, preload and renderer alike, so a
// change here is a change to the contract between all three.

import type { NoteAnchor } from '@shared/noteAnchor'
import type { MentionTargetType } from '@shared/noteDoc'

export interface Case {
  id: string
  name: string
  description?: string
  type?: 'crypto' | 'malware' | 'fraud' | 'custom'
  /**
   * Operator-assigned case/reference number (#399). Absent when never set —
   * the repo stores NULL, never '', because an empty string would be a claim
   * nobody made. Rendered on the Certification as 'not stated' when absent.
   */
  caseNumber?: string
  /**
   * True only for the seeded demonstration case (#405). Exports of a demo case
   * state it in the export dialog and the Certification so fixture data is
   * never handed over as evidence by accident.
   */
  isDemo: boolean
  createdAt: string
  updatedAt: string
  archived: boolean
}

// How a case's own exclusion list relates to the operator's global ignore list
// (#400). 'stack' applies both; 'override' applies only the case's, bypassing
// the global list for this case — the first mechanism in the app that makes one
// case more permissive than the global policy.
export const AUTO_CAPTURE_EXCLUSION_MODES = ['stack', 'override'] as const
export type AutoCaptureExclusionMode = (typeof AUTO_CAPTURE_EXCLUSION_MODES)[number]

export function isAutoCaptureExclusionMode(value: unknown): value is AutoCaptureExclusionMode {
  return AUTO_CAPTURE_EXCLUSION_MODES.includes(value as AutoCaptureExclusionMode)
}

// A case's auto-capture exclusion policy. Kept off `Case` on purpose: the wire
// shape of a Case is read on every dashboard render, and this is read only by
// the capture server and the one screen that edits it.
export interface CaseAutoCapturePolicy {
  exclusions: string[]
  mode: AutoCaptureExclusionMode
}

export type CaptureFormat = 'html' | 'mhtml'

// How the capture was produced (#recapture). 'extension' = operator-witnessed
// via the Chrome extension; 'background' = silent hidden-window recapture;
// 'duplicate' = a byte copy of another capture in the same case (#827), which
// observed nothing itself and must never be read as a second sighting of the
// page.
export const CAPTURE_METHODS = ['extension', 'background', 'duplicate'] as const
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
  // Set when this capture was created by duplicating an existing capture
  // (#827). Mirrors `duplicateOfCaptureId` on the manifest entry, but unlike
  // the entry — which records the source id as it stood in the installation
  // that wrote it — this column is remapped on archive import, so it is the
  // link that survives a case moving between installations.
  duplicateOfCaptureId?: string
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

// A pinned reference read across a whole case, carrying the capture time it
// corroborates so a caller can state the interval without loading the captures
// (the export dialog's pinned-snapshots block, #401).
export interface CaseWaybackRef extends WaybackRef {
  captureTimestamp: string
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
  // 'selectors' and 'tags' are retired routes (#400/#700) kept in the union
  // because older settings files still hold them; both resolve to 'signals'
  // on restore. Dropping them would fail the settings parse on upgrade.
  lastActiveSection:
    'overview' | 'captures' | 'selectors' | 'notes' | 'tags' | 'signals' | 'data' | 'settings'
  hasCompletedOnboarding: boolean
  analysisSystemPrompt: string
  detailsPanelCollapsed: boolean
  tooltipsSeen: Record<string, boolean>
  // Coach-mark tour state (#404). Chapter keys are 'intro' | 'ext' | 'case'.
  onboardingChapters: Record<string, boolean>
  // Latched once, at the first launch that finds no settings.json. Only a
  // fresh install auto-fires a tour chapter; upgrades never do.
  isFreshInstall: boolean
  // Latched once the bundled demonstration Case Archive has been offered to
  // this install (#405). Not a guarantee on its own: the settings write can
  // fail, and what holds then is the `is_demo` probe in the database — a probe
  // of the current state, not a second latch, so on such an install deleting
  // the demo case brings a fresh one back next launch, and again after each
  // later deletion (#1301). The full statement is on `seedDemoCaseIfNeeded`.
  demoCaseSeeded: boolean
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
  'idle' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'downloaded' | 'error'

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
  'demoCase',
  'exhibits',
  'staging',
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
  'captureServer.tag_apply_failed',
  'captureServer.note_create_failed',
  // The capture-pipeline self-test failed to tear its sandbox down (#614).
  // Nothing left behind is evidence — the sandbox holds only the sentinel — so
  // the route reports its own result and this is the record that residue exists.
  'captureServer.self_test_cleanup_failed',
  // The capture server's listener failed (#513) — at boot usually EADDRINUSE
  // on 19845, held by another program or by a Birdbrain running against its
  // own data directory, since the single-instance lock stops a plain second
  // copy ever getting this far. The boot failure also reaches the operator as
  // a dialog; this is the record of the errno.
  'captureServer.listen_failed',
  'captureLifecycle.tls_refetch_failed',
  'captureLifecycle.selector_match_failed',
  'captureLifecycle.reprocess_failed',
  // A duplicate's post-commit trusted-time mirror write failed (#827). The
  // duplicate itself succeeded — the mirror self-heals on the next read — so
  // the log line is the only trace the reconcile was skipped.
  'captureLifecycle.duplicate_reconcile_failed',
  // Removing a failed duplicate's copied artifacts threw (#827). The duplicate
  // failed either way; this records that its copies may still be on disk,
  // unreferenced by any row.
  'captureLifecycle.duplicate_cleanup_failed',
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
  // A <webview> was refused at attach because its partition or its src fell
  // outside the policy (#401). Both guests the app mounts are inside it, so this
  // entry means a bug or an attempt, and either is worth having in the log.
  'app.webview_attach_refused',
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
  'settings.key_protection_state_unreadable',
  // The first-launch settings.json seed that latches the fresh-install flag
  // (#404). Failing it costs only the onboarding tour, so init swallows the
  // error — this is the record that it happened.
  'settings.fresh_install_seed_failed',
  // First-launch seeding of the bundled demonstration Case Archive (#405).
  // Every outcome is recorded: an operator whose first launch produced no demo
  // case has no other way to tell a missing fixture from a refused import.
  'demoCase.seeded',
  'demoCase.fixture_missing',
  'demoCase.seed_failed',
  // The latch write itself failing, swallowed so a broken userData directory
  // costs the demo case rather than the launch.
  'demoCase.latch_failed',
  'demoCase.artifact_cleanup_failed',
  // The Exhibit-model backfill (#1147) failing for one Case. Startup continues
  // over the remaining Cases, so this line is the only record that a Case did
  // not get its numbers or its anchored thumbnails.
  'exhibits.backfill_failed',
  // A Staging Pool commit (#1148) whose manifest append or row insert threw:
  // the entry was rolled back and the file returned to the pool, so this line
  // is the only record that the operator's commit did not land.
  'staging.commit_failed',
  // A pooled file that could not be unlinked on discard; the row is kept so
  // the bytes stay declared.
  'staging.discard_failed'
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
  // The Exhibit model's ids (#1148): a non-Capture Exhibit and a pooled file.
  'exhibitId',
  'stagingId',
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
  'PreMigrationSnapshotError',
  // Without this the durable app.startup_failed entry for a bind failure reads
  // 'UnknownError', which is the one field distinguishing it from any other
  // fatal boot error in a log an operator has sent in (#513).
  'CaptureServerBindError'
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

// The two semantically distinct export classes (#399, ADR-0010). An
// 'evidence' export is the verifiable package: full Manifest, Certification,
// signing key, evidence.json. A 'working-copy' is a clearly-labelled
// non-evidentiary export that ships none of those — the standalone verifier
// reports it as not a verifiable object rather than FAIL.
export const EXPORT_CLASSES = ['evidence', 'working-copy'] as const
export type ExportClass = (typeof EXPORT_CLASSES)[number]

export interface ExportOptions {
  format: 'html' | 'pdf' | 'zip'
  exportClass: ExportClass
  include: {
    captures: boolean
    screenshots: boolean
    auditTrail: boolean
    // Operator notes as package content (#399): notes.md in the zip. The
    // Court-exhibit preset is this flag off; extracted text and selector hits
    // deliberately did NOT become package content (maintainer ruling R4).
    notes: boolean
    annotations: 'none' | 'burned'
  }
  // Free-text purpose-or-authority statement rendered on the Certification
  // (e.g. "Disclosure under CPS request 2026/114"). Absent renders 'not stated'.
  purposeOrAuthority?: string
  outputPath: string
  // Selection scope (#398, ADR-0009): when present, only these captures are
  // exported as artifacts; the Manifest chain still ships complete. Absent
  // means whole-case. Every id must exist in the case — the export refuses to
  // silently narrow a selection.
  captureIds?: string[]
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

// Where a Selector came from (#395). Recorded at creation and never edited
// after. Absent means the row predates provenance recording — legacy rows are
// not backfilled, because guessing a value would be a false provenance claim.
export const SELECTOR_ORIGINS = ['extension', 'capture', 'note', 'manual'] as const
export type SelectorOrigin = (typeof SELECTOR_ORIGINS)[number]

// The column is plain TEXT and the Database Admin hatch can hand-edit it, so
// anything reaching a Selector has to be checked rather than asserted.
export function isSelectorOrigin(value: unknown): value is SelectorOrigin {
  return SELECTOR_ORIGINS.includes(value as SelectorOrigin)
}

export interface Selector {
  id: string
  caseId: string
  pattern: string
  isRegex: boolean
  enabled: boolean
  label?: string
  origin?: SelectorOrigin
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

// --- Cross-case recent activity (#403) ---
// One row of the dashboard's recent-activity feed. Derived read-only from the
// captures/notes/cases tables — nothing persists it. Selector hits are absent
// deliberately: `selector_matches` carries no timestamp, so a hit event has no
// honest time to order by (maintainer ruling 2026-08-20, #403).
interface RecentActivityBase {
  caseId: string
  caseName: string
  caseType?: Case['type']
  /** ISO 8601. Capture rows use created_at, note rows updated_at. */
  occurredAt: string
  /** Raw row title; null when the row has none. Display copy lives in the view. */
  title: string | null
}

export interface RecentCaptureActivity extends RecentActivityBase {
  kind: 'capture'
  captureId: string
  url: string
  lastVerifiedStatus?: HashVerification['status']
}

export interface RecentNoteActivity extends RecentActivityBase {
  kind: 'note'
  noteId: string
}

export type RecentActivityEvent = RecentCaptureActivity | RecentNoteActivity

export type { MentionTargetType } from '@shared/noteDoc'

/**
 * One row of a note's outgoing references, in document order. Derived in main
 * from the note's Mentions at write time; resolve status and label are read
 * time — a deleted target surfaces as `resolved: false`, never disappears.
 */
export interface NoteReference {
  noteId: string
  /** Document-order position; duplicates of the same target keep their own row. */
  ord: number
  targetType: MentionTargetType
  targetId: string
  /**
   * The target's CURRENT display name (capture title, selector label or
   * pattern, tag name, note title) — not the label cached in the Mention.
   * Null when the reference is broken (and for an untitled capture).
   */
  label: string | null
  /** False when the target row does not exist: a broken, still-visible reference. */
  resolved: boolean
}

/** A note that mentions a given target, grouped per note for backlink lists. */
export interface NoteBacklink {
  noteId: string
  noteTitle: string
  /** How many times the note mentions the target. */
  mentionCount: number
  /** Leading plain-text excerpt of the note body, for list snippets. */
  snippet: string
  updatedAt: string
}

/** Whole-case aggregate for the backlink map (#402): one row per mentioned target. */
export interface NoteBacklinkCount {
  targetType: MentionTargetType
  targetId: string
  /** Distinct notes mentioning the target. */
  noteCount: number
  /** Total mentions across those notes. */
  mentionCount: number
}

/**
 * One edge of the Overview backlink map (#402): a (note, target) pair. The
 * whole-case counts above aggregate `note_id` away, so they give a target's
 * degree but never an edge's two endpoints — which is what a map needs.
 */
export interface NoteReferenceEdge {
  noteId: string
  targetType: MentionTargetType
  targetId: string
  /** How many times that note mentions that target. */
  mentionCount: number
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

// --- Exhibit model (ADR-0023, ADR-0024) -----------------------------------

// There is deliberately no enumeration of Exhibit kinds or origins here. The DB
// columns are plain TEXT and the Manifest schema keeps `kind` an open string (a
// verifier's vocabulary must not decide whether a chain verifies), so a closed
// list would be a vocabulary nothing validates against — the kinds this build
// populates are decided by the code paths that write rows, and the rest arrive
// with their own tickets (X43, X42).

// The identity and numbering row for one unit of evidence. A Capture's Exhibit
// id IS its capture id, so the two rows are joined by equality and never by a
// separate key.
export interface Exhibit {
  id: string
  caseId: string
  kind: string
  origin: string
  // Sequential per-Case integer, assigned at commit (at ingest for Captures)
  // and recorded in the Manifest Entry so a citation is verifiable (X18).
  exhibitNumber: number
  // The original or display name, recorded — never derived from the storage
  // path (X35).
  name: string
  contentHash: string
  // Storage-root-relative path of the bytes, or null when the row records no
  // stored file (a legacy Capture whose artifact path was never recorded).
  path: string | null
  sizeBytes: number | null
  committedAt: string
  // Manifest index of the entry anchoring this Exhibit, or null when it has
  // none — a pre-v11 `html` Capture (X41). Null is the unanchored case, and the
  // Exhibit Number there is a citation aid, never an anchoring claim.
  manifestSeq: number | null
}

// One file computed from an Exhibit: extracted text, a thumbnail, a PDF
// metadata sidecar, an enrichment transform's output. Cited by its parent and
// derivation; Derived Files never get Exhibit Numbers (X31).
export interface DerivedFile {
  id: string
  exhibitId: string
  derivation: string
  // Version of the tool that produced the bytes, which is not necessarily the
  // Birdbrain build that recorded them (X23).
  toolVersion: string
  contentHash: string
  path: string
  createdAt: string
  // Manifest index of the `derivation` entry anchoring this file, or null when
  // it has none — a legacy thumbnail whose screenshot was missing or failed
  // verification, which X34 leaves unanchored rather than anchoring bytes that
  // could have been swapped.
  manifestSeq: number | null
}

// One file in the Case's Staging Pool: arrived, hashed, and outside the chain
// until the operator commits it (ADR-0024). Populated by `803p`; the table and
// this type exist here so the inventory query has a stable shape.
export interface StagingFile {
  id: string
  caseId: string
  kind: string
  origin: string
  name: string
  contentHash: string
  path: string
  sizeBytes: number
  arrivedAt: string
  // Source claims: what the operator or an external service SAID about where
  // the bytes came from. Unverified by construction — the app attests only the
  // bytes it received and when (X5, X22).
  sourceUrl: string | null
  sourceClaims: string | null
}

interface InventoryRowCommon {
  id: string
  caseId: string
  name: string
  contentHash: string
  path: string | null
  sizeBytes: number | null
  // Whether the bytes are on disk right now, resolved against the storage root
  // at read time.
  exists: boolean
}

export interface InventoryExhibitRow extends InventoryRowCommon {
  rowType: 'anchored'
  entity: 'exhibit'
  kind: string
  origin: string
  exhibitNumber: number
  committedAt: string
  manifestSeq: number | null
  // manifestSeq !== null. Stated as its own field so a consumer never has to
  // re-derive the anchoring claim from a nullable column.
  anchored: boolean
}

export interface InventoryDerivedFileRow extends InventoryRowCommon {
  rowType: 'anchored'
  entity: 'derived-file'
  parentExhibitId: string
  derivation: string
  toolVersion: string
  createdAt: string
  manifestSeq: number | null
  anchored: boolean
}

export interface InventoryStagedRow extends InventoryRowCommon {
  rowType: 'staged'
  entity: 'staged-file'
  kind: string
  origin: string
  arrivedAt: string
  sourceUrl: string | null
}

// One list with a discriminator, never two lists (X16): a consumer that filters
// on `rowType` cannot forget the pooled rows exist, which is the failure mode a
// separate staged list invites.
export type InventoryRow = InventoryExhibitRow | InventoryDerivedFileRow | InventoryStagedRow

export interface CaseInventory {
  caseId: string
  rows: InventoryRow[]
}

// The result of verifying one Exhibit. `kind = 'capture'` delegates to the
// Capture verify path and carries its result unchanged, so the two channels
// cannot drift; the shape admits other kinds so `803p` can add attachments
// without a second channel.
export interface ExhibitVerification {
  exhibitId: string
  caseId: string
  kind: string
  // `unsupported` is two things, told apart by `reason`: a kind this build has
  // no verify path for, and a chain holding an entry from a newer schema (X25),
  // which is never reported as tampering.
  status: HashVerification['status'] | 'unsupported'
  reason?: string
  // Present only for `kind = 'capture'`: the untouched `captures:verify` result.
  capture?: HashVerification
  // One outcome per Derived File of the Exhibit (X37). An anchored file is
  // re-hashed against the `derivation` entry the chain vouches for; an
  // unanchored one (X34) is reported as such and never re-hashed, because a
  // hash the chain does not cover proves nothing.
  derived?: DerivedFileVerification[]
}

export interface DerivedFileVerification {
  derivedFileId: string
  derivation: string
  status: 'verified' | 'tampered' | 'missing' | 'unverified'
  reason?: string
  /**
   * Why no `derivation` entry vouches for the bytes, on an `unverified`
   * outcome. The two causes are different evidentiary states and a caller must
   * not collapse them:
   *
   * - `no-entry`: no line in the manifest names this file for this Exhibit at
   *   all (X34 — the backfill records a thumbnail whose source screenshot could
   *   not be verified). The chain is silent about it.
   * - `chain-unverified`: a line DOES name it, but the chain does not verify,
   *   so nothing vouches for that line. Saying "no entry states what was
   *   produced" here would be false about an entry sitting in the same file.
   */
  unanchoredCause?: 'no-entry' | 'chain-unverified'
}

// --- Staging Pool (ADR-0024, #1148) ----------------------------------------

// One pooled file's commit outcome. Refusals are outcomes, never throws, so a
// batch commit reports each file rather than stopping at the first.
export type StagingCommitOutcome =
  | { stagingId: string; status: 'committed'; exhibitId: string; exhibitNumber: number }
  // `changed`: the bytes on disk no longer hash to the arrival hash (X13).
  // `missing`: the pooled file is gone. `not_found`: no such row in this Case.
  | { stagingId: string; status: 'refused'; reason: 'changed' | 'missing' | 'not_found' }
  // The manifest append or the row insert threw; the entry was rolled back and
  // the file put back in the pool. `error` is the error's name only.
  | { stagingId: string; status: 'failed'; error: string }

export interface StagingCommitResult {
  outcomes: StagingCommitOutcome[]
}

export interface StagingDiscardResult {
  discarded: string[]
}
