import { homedir } from 'node:os'
import type { LoggedError } from '@shared/types'

// The redaction boundary. Birdbrain logs are handed to the maintainer in bug
// reports, and captures are real investigation material, so URLs, case names
// and paths must never reach disk. LogSafe is branded: a raw string is a
// COMPILE error at every logger call site, and the validators below are the
// runtime second net.

declare const logSafeBrand: unique symbol
export type LogSafe = string & { readonly [logSafeBrand]: true }

export type LogValue = number | boolean | null | LogSafe

const IDENT = /^[A-Za-z0-9_-]{1,64}$/
const CODE = /^[A-Z][A-Z0-9_]{0,47}$/
const MAX_STACK_FRAMES = 20
// Recorded in place of a value that failed validation. Carries no data of its
// own, so it is itself a legal value under any context key (see matchesFormat).
const INVALID = '[invalid]'

function brand(value: string): LogSafe {
  return value as LogSafe
}

// `process.env.NODE_ENV !== 'production'` cannot express "not production" here:
// NODE_ENV is set nowhere in this repo, so a packaged app launched from the
// desktop reads as development and every validator below would throw there —
// the exact inverse of the guarantee this module's call sites (crash handlers)
// depend on. `app.isPackaged` is the codebase's real signal for the same
// distinction (updater.ts, index.ts via @electron-toolkit's `is.dev`).
//
// Electron is resolved with a defensive require rather than a static import so
// this module still loads in a plain Node process — the unit tests import it
// directly, with no Electron runtime around it. No app object means
// development, i.e. loud, which is the right direction for a test run.
function isPackagedApp(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- see above
    const electron: unknown = require('electron')
    return (electron as { app?: { isPackaged?: boolean } }).app?.isPackaged === true
  } catch {
    return false
  }
}

// Same defensive resolution, for the stack-relativization anchor. cwd is the
// app root only when the app was started from it: launched from Finder, a
// shortcut, or an unrelated directory, cwd is somewhere else entirely, no
// Birdbrain frame matches the anchor, and the generic absolute-path pass then
// replaces each frame's file:line:col with '‹path›' — deleting exactly the
// frames a crash report exists to carry. Callers may still override.
function defaultAppRoot(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- see above
    const electron: unknown = require('electron')
    return (electron as { app?: { getAppPath?: () => string } }).app?.getAppPath?.() ?? process.cwd()
  } catch {
    return process.cwd()
  }
}

// Loud in development so a bad call site is caught in review; inert in a
// packaged build so a logging mistake can never crash a tester's app. The
// offending value is never echoed — that would defeat the point of rejecting
// it.
function reject(kind: string): LogSafe {
  if (!isPackagedApp()) {
    throw new Error(`logSafe.${kind}: value failed validation and was not logged`)
  }
  return brand(INVALID)
}

export function ident(value: string): LogSafe {
  return IDENT.test(value) ? brand(value) : reject('ident')
}

export function code(value: string): LogSafe {
  return CODE.test(value) ? brand(value) : reject('code')
}

// Electron API vocabularies (values confirmed against the electron/electron
// docs, not guessed) for the crash-handler call sites this module exists to
// serve. Both '-gone' events share the same reason set today, per Electron's
// own docs, but are kept as separately named vocabulary slots below in case
// the two ever diverge.
const PROCESS_GONE_REASONS = [
  'clean-exit',
  'abnormal-exit',
  'killed',
  'crashed',
  'oom',
  'launch-failed',
  'integrity-failure',
  'memory-eviction'
] as const
const CHILD_PROCESS_TYPES = [
  'Utility',
  'Zygote',
  'Sandbox helper',
  'GPU',
  'Pepper Plugin',
  'Pepper Plugin Broker',
  'Unknown'
] as const
// Must stay in sync with CaptureFormat in @shared/types (no runtime const
// array exists there to import).
const CAPTURE_FORMATS = ['html', 'mhtml'] as const

// Fixed vocabularies `tag()` may select from. `allowed` as a caller-supplied
// parameter would let a call site mint its own allowlist —
// `tag(capturedUrl, [capturedUrl])` would brand a URL as log-safe — so the
// vocabulary is a closed, module-level set chosen by name; widening it means
// editing this file, which is the point: the boundary stays reviewable in
// one place instead of depending on every call site behaving.
const TAG_VOCABULARIES = {
  childProcessType: CHILD_PROCESS_TYPES,
  childGoneReason: PROCESS_GONE_REASONS,
  renderGoneReason: PROCESS_GONE_REASONS,
  captureFormat: CAPTURE_FORMATS
} as const

export function tag(value: string, vocabulary: keyof typeof TAG_VOCABULARIES): LogSafe {
  // Own-property check, not a bare lookup. TAG_VOCABULARIES is a plain object
  // literal, so it inherits from Object.prototype: `TAG_VOCABULARIES.toString`
  // resolves to a *function*, `?.` does not short-circuit on it, and
  // `.includes` is not there — a raw TypeError. The compile-time constraint on
  // `vocabulary` is no defence, since the callers that matter here are exactly
  // the ones that bypass it (plain JS, a cast, or a renderer-supplied value
  // re-validated at the IPC bridge). tag() runs inside 'child-process-gone',
  // where a throw would escalate a recoverable child death into a fatal
  // main-process exception raised from within the crash handler.
  if (!Object.hasOwn(TAG_VOCABULARIES, vocabulary)) return reject('tag')
  const allowed: readonly string[] = TAG_VOCABULARIES[vocabulary]
  return allowed.includes(value) ? brand(value) : reject('tag')
}

// --- Allowlist boundary --------------------------------------------------
//
// Regex scrubbing of free-form text failed repeatedly (Windows intermediate
// segments, UNC paths, Windows terminal segments, POSIX paths, home-rooted
// paths with a spaced subdirectory — five rounds of the same defect class
// relocating), and two more leaks can't be fixed by any regex at all: a case
// name as ordinary prose ("Error: failed to parse Operation Blackbird") has
// no path/URL shape to match, and a branded *value* does nothing to stop a
// computed *key* (`{ [capturedUrl]: true }` compiles and serializes
// verbatim against `Record<string, LogValue>`). So the boundary moves from
// "scrub what's on the page" to "nothing free-form is allowed on the page in
// the first place": codes, sources, and context keys are closed sets, and
// `sanitizeError` no longer carries a message field for prose to hide in.

// Pinned by the diagnostic-logging plan so later tasks (the LogEntry wire
// type in shared/types.ts, the actual logger) compile against stable names.
// The plan's own set is deliberately coarse — `capture.failed` covers both
// captureServer's and captureLifecycle's generic-failure catches, with
// `source` and `context` doing the fine-grained differentiation — plus three
// renderer-originated codes ('query.failed', 'mutation.failed',
// 'react.render_error') for entries forwarded with source 'renderer'.
// Appended below the pinned set: real console.* call sites in src/main (12
// files, audited for this task) that don't map onto any pinned code without
// forcing a poor fit — see the task report for the full mapping.
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
  'openrouter.retries_exhausted'
] as const
export type LogCode = (typeof LOG_CODES)[number]

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
  'renderer'
] as const
export type LogSource = (typeof LOG_SOURCES)[number]

// Pinned context key vocabulary. LogContext being
// `Partial<Record<LogContextKey, LogValue>>` rather than
// `Record<string, LogValue>` makes a computed or misspelled key a compile
// error at any call site that writes an object literal; `context()` below is
// the runtime second net for values built dynamically (spread, computed
// keys) that bypass that check. 'attempt' is appended for the openrouter
// retry call sites (backoff/attempt count) — not in the pinned set, no
// existing key was a good fit for it.
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
  'installationId',
  'version',
  'platform',
  'installFormat',
  'packaged',
  // Renderer-originated (plan Tasks 10 and 11): the query-key domain segment,
  // the ErrorBoundary that caught, and the IPC channel that threw. All three
  // are static identifiers from the source, never user data.
  'domain',
  'boundary',
  'channel',
  'attempt'
] as const
export type LogContextKey = (typeof LOG_CONTEXT_KEYS)[number]
export type LogContext = Partial<Record<LogContextKey, LogValue>>

// Per-key value formats: the TAG_VOCABULARIES philosophy applied to shapes
// instead of members. One generic validator cannot carry this boundary —
// `ident('OperationBlackbird')` passes (no space, identifier-shaped, under the
// cap), so a case NAME gets branded log-safe and written to disk. Asking "is
// this the specific thing I expect under THIS key" closes that: a case name
// cannot satisfy a UUID.
//
// Every id this app mints is a UUID — uuid's v4() in the db repos
// (caseRepo/noteRepo/selectorRepo), crypto.randomUUID() for capture ids
// (captureLifecycle) and the installation id. Version and variant nibbles are
// deliberately not pinned, so an id carried in from an archive still validates;
// the 8-4-4-4-12 hex shape is what excludes prose.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// app.getVersion() ('1.0.1-beta.17'), and the all-dashed variant the plan's
// session-start block writes.
const VERSION = /^\d+[.-]\d+[.-]\d+(?:[.-][A-Za-z0-9]+)*$/
// The platforms Birdbrain is actually built for (electron-builder targets in
// package.json). Any other process.platform value is genuinely unexpected.
const PLATFORMS = ['win32', 'darwin', 'linux'] as const
// Every literal detectInstallFormat() in diagnostics.ts can return, plus 'deb'
// — the one electron-builder package-type marker updater.ts recognises, which
// that function passes through from the resources file. A package format
// neither file knows about records as INVALID rather than being passed through.
const INSTALL_FORMATS = ['dev', 'nsis', 'mac', 'appimage', 'deb', 'archive', 'unknown'] as const

type ContextFormat = 'number' | 'boolean' | RegExp | readonly string[]

const CONTEXT_FORMATS: Record<LogContextKey, ContextFormat> = {
  captureId: UUID,
  caseId: UUID,
  noteId: UUID,
  selectorId: UUID,
  installationId: UUID,
  bytes: 'number',
  count: 'number',
  ms: 'number',
  port: 'number',
  exitCode: 'number',
  status: 'number',
  attempt: 'number',
  packaged: 'boolean',
  format: CAPTURE_FORMATS,
  reason: PROCESS_GONE_REASONS,
  processType: CHILD_PROCESS_TYPES,
  platform: PLATFORMS,
  installFormat: INSTALL_FORMATS,
  errorCode: CODE,
  version: VERSION,
  // Static identifiers lifted from renderer source, never user data — IDENT's
  // generic rule is the right one for exactly these three.
  domain: IDENT,
  boundary: IDENT,
  channel: IDENT
}

function matchesFormat(value: unknown, format: ContextFormat): boolean {
  // null reads as "absent/unknown" under any key, and INVALID is this module's
  // own rejection marker; neither can carry investigation data.
  if (value === null || value === INVALID) return true
  if (format === 'number') return typeof value === 'number' && Number.isFinite(value)
  if (format === 'boolean') return typeof value === 'boolean'
  if (typeof value !== 'string') return false
  return format instanceof RegExp ? format.test(value) : format.includes(value)
}

// Dev-loud / packaged-inert, matching reject(). Neither the key nor the value
// is ever named: if the rejected part IS the sensitive payload (as in
// `{ [capturedUrl]: true }`), echoing it back in a thrown message would be the
// same leak again.
function rejectContext(part: 'key' | 'value'): void {
  if (!isPackagedApp()) {
    throw new Error(`logSafe.context: an object contained a disallowed ${part} and was not logged`)
  }
}

// Runtime companion to the LogContext type, for objects built dynamically
// (spread, computed keys) rather than written as literals — the case the
// compile-time check can't see. `ctx` is typed `Record<string, LogValue>`
// rather than `Record<string, unknown>` so that a literal still fails to
// compile: without that, `context({ caseId: capture.caseName })` would type-
// check as a general-purpose cast from raw string to log-safe, which is the
// exact escape hatch the branding exists to prevent. Keys and values are both
// re-checked here, since a cast defeats either.
export function context(ctx: Record<string, LogValue>): LogContext {
  const out: LogContext = {}
  for (const key of Object.keys(ctx)) {
    // Own-property check for the same reason tag() needs one: a bare lookup on
    // an inherited name ('toString') would return a function and be treated as
    // a format.
    if (!Object.hasOwn(CONTEXT_FORMATS, key)) {
      rejectContext('key')
      continue
    }
    const value: unknown = ctx[key]
    if (!matchesFormat(value, CONTEXT_FORMATS[key as LogContextKey])) {
      rejectContext('value')
      continue
    }
    out[key as LogContextKey] = value as LogValue
  }
  return out
}

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
  'ManifestRollback'
] as const

// Windows (drive-rooted 'D:\...', drive-relative 'D:...', or UNC
// '\\server\share\...') and POSIX paths share one shape, described once here
// — POSIX_PATH below is the mirror with '/' in place of '\'. A case file is
// exactly as likely to be named "Operation Blackbird.mhtml" as a case folder
// is to be named "Operation Blackbird", so both intermediate AND final
// segments need to tolerate an embedded space. Intermediate segments are
// unambiguous — each is anchored by a mandatory trailing separator — but the
// final segment is ambiguous with trailing prose ("...capture.mhtml failed")
// unless something else bounds it. A recognizable file extension is that
// bound: the final segment is matched lazily up to the first '.' plus a short
// alphanumeric run sitting at a whitespace/quote/paren/end-of-string
// boundary, so "Operation Blackbird.mhtml failed" stops cleanly before
// "failed" instead of swallowing it. When no such extension exists — an
// extensionless final segment containing a space, with no surrounding quotes
// — there is no reliable end-of-path signal short of consuming trailing
// prose, so the pattern falls back to stopping at the first
// whitespace/separator, same as the original design; that is an accepted,
// tested trade-off, not an oversight. Every segment/final class excludes the
// separator itself, so each repetition consumes a disjoint run — no
// ambiguous overlapping splits for the engine to try — keeping both patterns
// linear regardless of the added lazy quantifier (verified empirically, see
// the task report).
//
// These patterns are now used only as a defense-in-depth pass over relativized
// stack frames (see sanitizeError) — `.message` is no longer sanitized at all
// because it isn't logged.
const URL_LIKE = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi
// Node quotes paths in most of its own error messages ("ENOENT: ... open
// 'C:\Users\...'", "scandir '/mnt/evidence/Operation Blackbird'"), and a
// quote is an end-of-path signal a regex CAN rely on, unlike whitespace
// (which trailing prose also uses). This is what makes an extensionless
// final segment with a space — otherwise genuinely unresolvable, since
// nothing marks where the path ends — resolvable when it's quoted: matched
// first, before the unquoted patterns, so the whole quoted run is replaced
// as one unit and the unquoted rules never get a chance to stop early at the
// embedded space. `\1` requires the same quote character to close, so a
// stray apostrophe inside a double-quoted string doesn't end the match early.
const QUOTED_PATH = /(['"])((?:[A-Za-z]:\\?|\\\\|\/)[^'"]*)\1/g
// Windows requires zero or more intermediate segments (a bare 'C:\x.mhtml' or
// UNC share root is already unambiguous). POSIX requires at least one, kept
// from the original design, to avoid treating a bare '/2' (e.g. inside "1/2
// chance") as a path. The drive-letter alternative needs a lookbehind
// excluding a preceding word character: making the backslash after the colon
// optional (for drive-relative paths like 'D:Evidence\...') would otherwise
// match ANY single letter immediately before a colon — including the 's' in
// a relativized stack frame's own 'bar.ts:10:5' suffix, corrupting exactly
// the file:line:col info relativizing was meant to preserve. A real drive
// letter is never preceded by another letter/digit/underscore in practice.
const WIN_PATH =
  /(?:(?<![A-Za-z0-9_])[A-Za-z]:\\?|\\\\)(?:[^\\'"()]+\\)*(?:[^\\'"()]*?\.[A-Za-z0-9]{1,10}(?=[\s'"()]|$)|[^\\\s'"()]+)/g
const POSIX_PATH =
  /(?<![\w-])\/(?:[^/'"()]+\/)+(?:[^/'"()]*?\.[A-Za-z0-9]{1,10}(?=[\s'"()]|$)|[^/\s'"()]+)/g

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function sanitizeText(text: string, homeDir: string): string {
  let out = text.replace(QUOTED_PATH, '$1‹path›$1')
  if (homeDir) {
    const homeRooted = new RegExp(`${escapeRegExp(homeDir)}[^\\s'"()]*`, 'g')
    out = out.replace(homeRooted, '‹path›')
  }
  out = out.replace(URL_LIKE, '‹url›')
  out = out.replace(WIN_PATH, '‹path›')
  out = out.replace(POSIX_PATH, '‹path›')
  return out
}

// Node's Error#stack embeds "`${name}: ${message}`" as its own first line(s)
// — the exact free-form prose vector this module exists to keep out of logs,
// smuggled back in through a different field. `name` is already returned
// separately, so the header is discarded entirely (not sanitized) rather
// than risk any of it surviving. This filters every line rather than slicing
// from the first frame match, so it's not just the header that's excluded —
// any non-frame line anywhere in the stack (e.g. a "Caused by:" line, or an
// AggregateError's nested detail) is dropped too.
//
// The "    at " prefix alone is not a frame test. V8 preserves newlines from
// Error.message, so `new Error('failed\n    at Operation Blackbird (case 7)')`
// puts a line satisfying that prefix into the stack — free-form prose with no
// path or URL shape for sanitizeText to catch either. What a real frame always
// has is a trailing location, in one of V8's four shapes:
//
//     at fn (/file.js:10:5)      at /file.js:10:5
//     at fn (<anonymous>)        at async fn (/file.js:10:5)
//
// so both tests must pass: the prefix AND a location. '(case 7)' is not a
// location and is dropped. A message crafted to end in a real 'file:line:col'
// is indistinguishable from a frame by construction — but it has a path shape
// by then, which is what the sanitizeText pass in sanitizeError is for.
const FRAME_PREFIX = /^\s*at\s/
const FRAME_LOCATION = /(?::\d+:\d+\)?|\(?(?:<anonymous>|native)\)?)$/

function stackFrames(stack: string): string[] {
  return stack.split('\n').filter((line) => FRAME_PREFIX.test(line) && FRAME_LOCATION.test(line))
}

// Strips the app's own install/checkout root from each frame so what remains
// names Birdbrain's own (open-source) source files relative to that root,
// instead of an absolute path that embeds the operator's username. Frames
// outside appRoot (Node/Electron internals, which use special non-path
// specifiers like 'node:internal/...') are left alone here; sanitizeText
// below is the safety net for anything that isn't.
//
// Constraint on callers: stripping the anchor leaves a remainder that no path
// pattern can match, so for the relativized portion sanitizeText is bypassed,
// not defence-in-depth. That holds only while appRoot is deep enough that
// everything under it is app source — app.getAppPath() is. Passing something
// short (homedir(), a drive root) would relativize the operator's whole tree
// into unmatchable fragments and silently disable the second pass.
function relativizeStack(stack: string, appRoot: string): string {
  if (!appRoot) return stack
  return stack
    .split('\n')
    .map((line) => {
      const idx = line.indexOf(appRoot)
      if (idx === -1) return line
      const before = line.slice(0, idx)
      const after = line.slice(idx + appRoot.length).replace(/^[\\/]+/, '')
      return before + after
    })
    .join('\n')
}

// appRoot defaults to cwd for standalone/test use; real (Electron) call sites
// should pass `app.getAppPath()` so packaged installs relativize correctly.
export function sanitizeError(
  err: unknown,
  appRoot: string = defaultAppRoot(),
  homeDir: string = homedir()
): LoggedError {
  if (!(err instanceof Error)) {
    return { name: 'UnknownError', code: null, stack: null }
  }

  const name = (ERROR_NAMES as readonly string[]).includes(err.name) ? err.name : 'UnknownError'

  const raw = (err as { code?: unknown }).code
  const errCode = typeof raw === 'string' && CODE.test(raw) ? raw : null

  let stack: string | null = null
  if (err.stack) {
    const frames = stackFrames(err.stack)
    if (frames.length > 0) {
      const relativized = relativizeStack(frames.join('\n'), appRoot)
      stack = sanitizeText(relativized, homeDir)
        .split('\n')
        .slice(0, MAX_STACK_FRAMES)
        .join('\n')
    }
  }

  return { name, code: errCode, stack }
}
