import { homedir } from 'node:os'
import {
  ERROR_NAMES,
  LOG_CODES,
  LOG_CONTEXT_KEYS,
  LOG_SOURCES,
  type LogCode,
  type LogContextKey,
  type LoggedError,
  type LogSource
} from '@shared/types'

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
    return (
      (electron as { app?: { getAppPath?: () => string } }).app?.getAppPath?.() ?? process.cwd()
    )
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
// The platforms Birdbrain is actually built for (electron-builder targets in
// package.json). Any other process.platform value is genuinely unexpected.
const PLATFORMS = ['win32', 'darwin', 'linux'] as const
// Every literal detectInstallFormat() in diagnostics.ts can return, plus 'deb'
// — the one electron-builder package-type marker updater.ts recognises, which
// that function passes through from the resources file. A package format
// neither file knows about records as INVALID rather than being passed through.
const INSTALL_FORMATS = ['dev', 'nsis', 'mac', 'appimage', 'deb', 'archive', 'unknown'] as const
// Stable tokens for why a captured screenshot was dropped, standing in for the
// formatted sentence (which carries the measured/max sizes and can never be a
// vocabulary member — see captureServer.ts's screenshot-too-large call site).
const SCREENSHOT_DROP_REASONS = ['too_large'] as const

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
  captureFormat: CAPTURE_FORMATS,
  platform: PLATFORMS,
  installFormat: INSTALL_FORMATS,
  screenshotDropReason: SCREENSHOT_DROP_REASONS
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

type ContextFormat = 'number' | 'boolean' | RegExp | readonly string[]

// Renderer-supplied context vocabularies. Each is the closed set of values the
// corresponding call site can legitimately produce, so a value outside it is a
// bug or an attack, never a legitimate log.

// The first segment of every query key in the renderer. Most come from
// queries.ts's queryKeys factory, but three are declared inline in components —
// deriving this list from the factory alone silently drops the `domain` field
// from those subsystems' query.failed entries, which is the one field naming
// what broke. tests/main/services/queryDomains.test.ts scans the renderer and
// fails if a key appears there but not here.
export const QUERY_DOMAINS = [
  'analysis',
  'annotations',
  'appVersion',
  'captureCounts',
  'captures',
  'cases',
  'db',
  'diagnostics',
  'export',
  'extractedData',
  'identity',
  'notes',
  'openRouterModels',
  'recaptureQueue',
  'search',
  'selectors',
  'session',
  'settings',
  'tags',
  'wayback',
  // queryClient's fallback when a key is empty.
  'unknown'
] as const

// Every ErrorBoundary `source` in the renderer. Adding a boundary means adding
// its name here — one reviewable line, the same gate as LOG_CODES.
const ERROR_BOUNDARIES = ['root', 'content', 'captureViewer'] as const

// IPC channel names are dotted/colon-separated, so they do not fit IDENT
// anyway; this pattern pins the shape without importing @shared/ipc (which
// would drag the whole channel map into the boundary module).
const IPC_CHANNEL_NAMES = /^[a-z][A-Za-z]*:[a-z][A-Za-z:]*$/

const CONTEXT_FORMATS: Record<LogContextKey, ContextFormat> = {
  captureId: UUID,
  caseId: UUID,
  noteId: UUID,
  selectorId: UUID,
  exhibitId: UUID,
  stagingId: UUID,
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
  // Closed vocabularies, NOT IDENT. These three arrive from the renderer, which
  // is where case names live, and IDENT (/^[A-Za-z0-9_-]{1,64}$/) accepts any
  // spaceless string — 'OperationBlackbird' passes it, which is the exact leak
  // the caseId/UUID pairing above exists to prevent. "These call sites only
  // ever pass static literals" is a property of today's callers, not of the
  // boundary, and this module's whole premise is that the renderer is not
  // trusted. An unlisted value records as [invalid] and the entry survives.
  domain: QUERY_DOMAINS,
  boundary: ERROR_BOUNDARIES,
  channel: IPC_CHANNEL_NAMES
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
// location and is dropped.
//
// A ':line:col' suffix alone is still not enough, because prose can end that
// way too: `new Error('failed\n    at Operation Blackbird:10:5')` satisfies
// both the prefix and a bare numeric-suffix test, and — having no slash, drive
// letter or scheme — carries no path shape for sanitizeText to catch either.
// So the location must also name something that could actually be a file: a
// path separator, or a module scheme like 'node:'. A real frame always has
// one; a case name does not. The cost is dropping an exotic frame whose file
// has no directory at all, which loses one line of diagnostics — the right
// direction to fail in a module whose job is keeping case names off disk.
// The whole line is matched, not a prefix and a suffix independently. Testing
// the two ends separately leaves the middle unconstrained, and the middle is
// where prose lives: `    at Operation Blackbird bob@example.com <anonymous>`
// passes a `^\s*at\s` prefix test AND a `<anonymous>$` suffix test, has no
// path or URL shape for sanitizeText to catch, and lands verbatim on disk.
// That is reachable without anything exotic — `new Error(\`failed: ${e.stack}\`)`
// is a common wrapper idiom, and it embeds arbitrary earlier text into a
// position where the message and the frames are indistinguishable by line.
//
// So a kept line must look like a real V8 frame end to end: `at <fn> (<loc>)`
// or a bare `at <loc>`. A function name is a single identifier-ish token
// (optionally prefixed `new ` or `async `) with no interior spaces, and a
// location is a real path, a module scheme like 'node:'/'file:', or the two
// literal placeholders. Prose fails on the interior spaces it cannot avoid.
const FRAME_FN = String.raw`(?:new\s|async\s)?[\w$.<>[\]]+`
const FRAME_LOC = String.raw`(?:[/\\][^\s()]*:\d+:\d+|[A-Za-z]:[\\/][^\s()]*:\d+:\d+|[a-z][a-z0-9+.-]*:[^\s()]*:\d+:\d+|<anonymous>|native)`
const FRAME = new RegExp(String.raw`^\s*at\s(?:${FRAME_FN}\s\(${FRAME_LOC}\)|${FRAME_LOC})\s*$`)

function stackFrames(stack: string): string[] {
  return stack.split('\n').filter((line) => FRAME.test(line))
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
// `name`, `code` and `stack` are ordinary writable properties, and an Error
// subclass or a library error may define any of them as a getter that throws
// (lazy stack capture is a real pattern). sanitizeError runs inside the crash
// handlers, so a throw here would replace the failure being recorded with a
// second, worse one — the diagnostic path destroying the diagnostic.
function readProp(err: Error, key: 'name' | 'code' | 'stack'): unknown {
  try {
    return (err as unknown as Record<string, unknown>)[key]
  } catch {
    return undefined
  }
}

export function sanitizeError(
  err: unknown,
  appRoot: string = defaultAppRoot(),
  homeDir: string = homedir()
): LoggedError {
  if (!(err instanceof Error)) {
    return { name: 'UnknownError', code: null, stack: null }
  }

  const rawName = readProp(err, 'name')
  const name =
    typeof rawName === 'string' && (ERROR_NAMES as readonly string[]).includes(rawName)
      ? rawName
      : 'UnknownError'

  const raw = readProp(err, 'code')
  const errCode = typeof raw === 'string' && CODE.test(raw) ? raw : null

  const rawStack = readProp(err, 'stack')
  let stack: string | null = null
  // typeof, not truthiness: `stack` is declared `string | undefined`, but a
  // subclass or library error can assign anything to it, and a non-string
  // truthy value would throw on .split inside stackFrames.
  if (typeof rawStack === 'string' && rawStack.length > 0) {
    const frames = stackFrames(rawStack)
    if (frames.length > 0) {
      const relativized = relativizeStack(frames.join('\n'), appRoot)
      stack = sanitizeText(relativized, homeDir).split('\n').slice(0, MAX_STACK_FRAMES).join('\n')
    }
  }

  return { name, code: errCode, stack }
}

// --- Runtime halves of the shared unions ------------------------------------
//
// The vocabularies in @shared/types are compile-time unions. A value arriving
// over IPC has been through `unknown`, where no type survives, so the boundary
// needs these runtime checks too.

// Marks a LoggedError as having come from this module's own validation, so
// logger can pass it through instead of flattening it to UnknownError.
//
// A shape test would NOT be safe here. `logger`'s err parameter is `unknown`,
// and a dependency that rejects with a plain object — `{ name: 'Error', code:
// null, stack: '    at f (/cases/OperationBlackbird/x.js:1:1)' }` — matches
// "has name, code and stack" exactly. Duck typing would let that object skip
// sanitizeError and write the case name straight to disk. Presence of fields
// says nothing about where they came from; only a brand this module controls
// does. A branded type would not help either: the brand is erased at compile
// time, and this value arrives through an `unknown` parameter. The runtime
// needs a real marker, and a class a caller cannot construct without importing
// it from this module is the cheapest one.
export class ValidatedError {
  constructor(readonly error: LoggedError) {}
}

export function isValidatedError(value: unknown): value is ValidatedError {
  return value instanceof ValidatedError
}

export function isLogCode(value: unknown): value is LogCode {
  return typeof value === 'string' && (LOG_CODES as readonly string[]).includes(value)
}

export function isLogSource(value: unknown): value is LogSource {
  return typeof value === 'string' && (LOG_SOURCES as readonly string[]).includes(value)
}

export function isLogContextKey(value: unknown): value is LogContextKey {
  return typeof value === 'string' && (LOG_CONTEXT_KEYS as readonly string[]).includes(value)
}

// The renderer sends a bare name, never a message or stack. An unrecognised
// name is recorded as UnknownError so a novel error type cannot smuggle prose
// through the one string field that survives this hop.
export function errorName(value: unknown): string | undefined {
  if (value === undefined) return undefined
  return typeof value === 'string' && (ERROR_NAMES as readonly string[]).includes(value)
    ? value
    : 'UnknownError'
}
