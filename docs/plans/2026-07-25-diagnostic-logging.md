# Diagnostic Logging & Tester Bug Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give Birdbrain a durable structural-only log, full crash capture, a global notification layer, and a one-click local bug-report bundle a tester can drag into chat.

**Architecture:** A single logger in the main process is the only sink that writes to disk. Renderer failures reach it over IPC; a `notify` layer in the renderer subscribes to the same events and raises toasts. Log and notify are two independent switches on one boundary, so an error is durable and visible by construction. Investigation data is kept out of the log by branded types that make passing a raw string a compile error.

**Tech Stack:** Electron 39, TypeScript strict, React 19, TanStack Query v5, Zustand, Vitest (via Electron runtime), Playwright, sonner (new).

**Spec:** [docs/specs/2026-07-25-diagnostic-logging-design.md](../specs/2026-07-25-diagnostic-logging-design.md)

## Design change — read before any task

**Free-form prose never reaches the durable log.** An earlier revision scrubbed `message`
with regexes; that was abandoned after five successive leak variants and two findings a
regex cannot address (a case name as ordinary prose has no shape to match; branded values
do not constrain context *keys*). See the spec section "No free-form prose reaches disk".

Every task below obeys these rules:

- An entry's `code` comes from the fixed `LOG_CODES` union, `source` from `LOG_SOURCES`,
  and context keys from `LOG_CONTEXT_KEYS`. There is no arbitrary-text field.
- `err.message` is **never** persisted. Only `err.name` validated against `ERROR_NAMES`
  and `err.code` matching the `code()` pattern survive, plus app-relative stack frames.
- Human prose lives only in ephemeral UI: `notify` toasts and `LogTab` labels.

- `tag()` selects a fixed vocabulary by name from a table inside `logSafe.ts`. Call sites
  never pass their own array — `tag(url, [url])` would otherwise brand a captured URL.
- Anything arriving from the renderer over IPC is re-validated in main against the same
  unions. A compile-time union does not survive a process hop.

Every code block below has been written against these rules. If you find one that has not
— a `message` field, a `source: string`, a caller-supplied `tag` array — that block is
stale and the rules above govern; say so in your report rather than widening a type to
make it compile.

## Global Constraints

- Code style: **no semicolons**, single quotes, no trailing commas, 100 char print width, 2-space indent.
- TypeScript strict mode. **No `any`** without an `// eslint-disable` and a stated reason.
- Imports use path aliases: `@main/*`, `@shared/*`, `@renderer/*`. Relative imports across those roots fail `tests/importAliases.test.ts`.
- `src/shared/**` must never import from `@main/*` or `@renderer/*`.
- Renderer components use semantic theme tokens (`bg-surface`, `text-text-primary`, `border-border`, `text-text-muted`), not raw Tailwind colours. Exceptions: overlays and status/severity colours.
- Tests run with `pnpm test` (Vitest under the Electron runtime). Lint with `pnpm lint`.
- **Test file placement is load-bearing.** `vitest.config.ts` defines two projects with strict includes. A test in the wrong directory is silently never run:
  - `tests/**/*.test.ts` outside `tests/renderer/` and `tests/hooks/` → **node** project (`environment: 'node'`). Main-process tests go here.
  - `tests/components/**/*.test.tsx`, `tests/renderer/**/*.test.ts`, `tests/hooks/**/*.test.ts` → **jsdom** project. React component tests must be `tests/components/*.test.tsx` — `tests/renderer/**/*.test.tsx` matches **no** project.
  After adding a test, confirm it actually ran (the count in the Vitest summary must increase). A test that never executes is worse than no test.
- **Coverage gates apply to the new services.** `pnpm test:coverage` enforces `src/main/services/*.ts` at 90% lines/statements/functions and 78% branches. `logSafe.ts`, `logger.ts`, `sessionLog.ts` and `bugReport.ts` all land under that glob, which is checked against the aggregate. Cover error paths and fallbacks, not just happy paths.
- **`@ts-expect-error` directives in tests are not machine-checked.** No tsconfig covers `tests/` (`tsconfig.node.json` includes only `src/main`, `src/preload`, `src/shared`; the root has `"files": []`), and ESLint is not type-aware here. A directive asserting that a boundary type rejects something will rot silently if the type is later widened — and several of this feature's guarantees are pinned that way. Where you rely on one, verify it by hand (delete the directive, confirm the exact compile error, restore it) and say so in your report. Closing the gap properly is out of scope for this plan; it is recorded for the final review.
- Commits: `<type>(<scope>): <subject>`. **Never** add `Co-authored-by`. **Never** `git add .` or `git add -A` — stage files explicitly.
- **Nothing in this feature may perform network I/O.** No upload, endpoint, or telemetry of any kind.
- The log must never contain URLs, page titles, case names, absolute paths, or settings values.
- Only one new dependency is authorised: `sonner`. Do not add others.

---

## File Structure

**New — main process**

| File | Responsibility |
|---|---|
| `src/main/services/logSafe.ts` | Branded `LogSafe` type, `ident`/`code`/`tag` validators, `sanitizeError`. Pure, no I/O. |
| `src/main/services/logger.ts` | The sink: buffered JSONL writes, rotation, correlation ids, renderer emit. |
| `src/main/services/sessionLog.ts` | Session records and the unclean-exit lock. |
| `src/main/services/bugReport.ts` | Assembles the report zip. |

**New — renderer**

| File | Responsibility |
|---|---|
| `src/renderer/lib/notify.ts` | Toast + durable-log boundary with dedup. |
| `src/renderer/components/ErrorBoundary.tsx` | React error containment and recovery UI. |
| `src/renderer/components/diagnostics/LogTab.tsx` | Log viewer inside DiagnosticsPanel. |
| `src/renderer/components/diagnostics/ReportProblemDialog.tsx` | The three-field report form. |
| `src/renderer/components/diagnostics/CrashRecoveryPrompt.tsx` | Post-crash offer on launch. |

`logSafe.ts` is split from `logger.ts` deliberately: it is pure and heavily tested, while `logger.ts` owns file I/O. `sessionLog.ts` is split because lock-file lifecycle is a different responsibility from log-line writing, and it is the one piece that must work when the logger itself never got a chance to run.

---

# Phase 1 — The Durable Record

*Value on its own: a tester can hit "Reveal log file" and send you the file.*

---

### Task 1: `logSafe.ts` — the redaction boundary

**Files:**
- Create: `src/main/services/logSafe.ts`
- Test: `tests/main/services/logSafe.test.ts`

**Interfaces:**
- Consumes: `LoggedError` from `@shared/types` (created in Task 2 — if Task 2 has not landed, create that interface first).
- Produces: `LogSafe`, `LogValue`, `LogContext` types; `ident(v)`, `code(v)`, `tag(v, allowed)`, `sanitizeError(err, homeDir?)`, `sanitizeText(text, homeDir)`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from 'vitest'
import { code, ident, sanitizeError, sanitizeText, tag } from '@main/services/logSafe'

describe('ident', () => {
  it('accepts uuid-shaped ids', () => {
    expect(ident('a1b2-c3d4_EF')).toBe('a1b2-c3d4_EF')
  })

  it('throws outside production on a value with spaces or punctuation', () => {
    expect(() => ident('Operation Blackbird')).toThrow()
    expect(() => ident('https://example.com/x')).toThrow()
  })
})

describe('code', () => {
  it('accepts screaming snake case', () => {
    expect(code('ENOENT')).toBe('ENOENT')
  })

  it('rejects lowercase prose', () => {
    expect(() => code('no such file')).toThrow()
  })
})

describe('tag', () => {
  it('accepts a member of the allowed set', () => {
    expect(tag('mhtml', ['html', 'mhtml'])).toBe('mhtml')
  })

  it('rejects a non-member', () => {
    expect(() => tag('example.com', ['html', 'mhtml'])).toThrow()
  })
})

describe('sanitizeText', () => {
  it('strips windows paths', () => {
    const out = sanitizeText(String.raw`open 'C:\Users\matt\cases\x.mhtml'`, String.raw`C:\Users\matt`)
    expect(out).not.toContain('matt')
    expect(out).toContain('‹path›')
  })

  it('strips posix paths', () => {
    const out = sanitizeText('open /home/matt/cases/x.mhtml failed', '/home/matt')
    expect(out).not.toContain('matt')
    expect(out).toContain('‹path›')
  })

  it('strips urls', () => {
    const out = sanitizeText('fetch https://target.example/page?q=1 failed', '/home/matt')
    expect(out).not.toContain('target.example')
    expect(out).toContain('‹url›')
  })
})

describe('sanitizeError', () => {
  it('keeps name and code but scrubs the message', () => {
    const err = Object.assign(new Error(String.raw`ENOENT: open 'C:\Users\matt\a.mhtml'`), {
      code: 'ENOENT'
    })
    const out = sanitizeError(err, String.raw`C:\Users\matt`)
    expect(out.name).toBe('Error')
    expect(out.code).toBe('ENOENT')
    expect(out.message).not.toContain('matt')
  })

  it('caps the stack at 20 frames', () => {
    const err = new Error('boom')
    err.stack = ['Error: boom', ...Array.from({ length: 40 }, (_, i) => `    at f${i} (/a/b.js:1:1)`)].join('\n')
    const out = sanitizeError(err, '/home/matt')
    expect((out.stack ?? '').split('\n').length).toBeLessThanOrEqual(21)
  })

  it('handles a thrown non-Error', () => {
    const out = sanitizeError('just a string', '/home/matt')
    expect(out.name).toBe('UnknownError')
    expect(out.code).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- logSafe`
Expected: FAIL — cannot resolve `@main/services/logSafe`.

- [ ] **Step 3: Write the implementation**

```typescript
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
export type LogContext = Record<string, LogValue>

const IDENT = /^[A-Za-z0-9_-]{1,64}$/
const CODE = /^[A-Z][A-Z0-9_]{0,47}$/
const MAX_STACK_FRAMES = 20

function brand(value: string): LogSafe {
  return value as LogSafe
}

// Loud in dev so a bad call site is caught in review; inert in production so a
// logging mistake can never crash a tester's app. The offending value is never
// echoed — that would defeat the point of rejecting it.
//
// NOT process.env.NODE_ENV. Nothing in this repo sets it: electron.vite.config.ts
// declares no `define`, and electron-vite keeps `process.env` a runtime lookup
// rather than substituting at build time. A packaged app launched from the
// desktop therefore has it undefined, `!== 'production'` is TRUE in production,
// and this function throws exactly where it promised not to — from inside a
// crash handler. app.isPackaged is what the rest of the codebase uses
// (updater.ts:69, index.ts:85).
function isDev(): boolean {
  // Resolved lazily and defensively: logSafe must stay unit-testable outside
  // an Electron runtime, where requiring 'electron' fails.
  try {
    return !require('electron').app?.isPackaged
  } catch {
    return true
  }
}

function reject(kind: string): LogSafe {
  if (isDev()) {
    throw new Error(`logSafe.${kind}: value failed validation and was not logged`)
  }
  return brand('[invalid]')
}

export function ident(value: string): LogSafe {
  return IDENT.test(value) ? brand(value) : reject('ident')
}

export function code(value: string): LogSafe {
  return CODE.test(value) ? brand(value) : reject('code')
}

export function tag(value: string, allowed: readonly string[]): LogSafe {
  return allowed.includes(value) ? brand(value) : reject('tag')
}

// Node embeds absolute paths in error messages ("ENOENT: ... open 'C:\Users\...'"),
// so errors are the one place branded types cannot reach. Order matters: URLs are
// replaced first because they contain '//' that the posix path pattern would
// otherwise chew into.
const URL_LIKE = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi
const WIN_PATH = /[A-Za-z]:\\[^\s'"()]+/g
const POSIX_PATH = /(?<![\w-])\/(?:[\w.-]+\/)+[\w.-]*/g

export function sanitizeText(text: string, homeDir: string): string {
  let out = text
  if (homeDir) out = out.split(homeDir).join('‹home›')
  out = out.replace(URL_LIKE, '‹url›')
  out = out.replace(WIN_PATH, '‹path›')
  out = out.replace(POSIX_PATH, '‹path›')
  return out
}

export function sanitizeError(err: unknown, homeDir: string = homedir()): LoggedError {
  // String(err) on a thrown string IS the prose — there is nothing to salvage.
  if (!(err instanceof Error)) return { name: 'UnknownError', code: null, stack: null }

  const raw = (err as { code?: unknown }).code
  const errCode = typeof raw === 'string' && CODE.test(raw) ? raw : null

  return {
    // Error.name is writable, so a caller can set it to anything. Validate it
    // against ERROR_NAMES like every other string that reaches disk.
    name: errorName(err.name) ?? 'UnknownError',
    code: errCode,
    stack: safeStack(err.stack, homeDir)
  }
}

// A stack's first line is `${name}: ${message}` — prose, not a frame. Dropping
// `message` from LoggedError buys nothing while that header survives, so keep
// only lines that look like frames, and only after sanitizeText has run.
function safeStack(stack: string | undefined, homeDir: string): string | null {
  if (!stack) return null
  const frames = stack
    .split('\n')
    .filter((line) => /^\s*at\s/.test(line))
    .slice(0, MAX_STACK_FRAMES)
    .map((line) => sanitizeText(line, homeDir))
  return frames.length > 0 ? frames.join('\n') : null
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- logSafe`
Expected: PASS, all cases.

- [ ] **Step 5: Lint and commit**

```bash
pnpm lint
git add src/main/services/logSafe.ts tests/main/services/logSafe.test.ts
git commit -m "feat(logging): branded log-safe types and error sanitizer"
```

---

### Task 2: Shared contracts — types and IPC channels

Land this before Tasks 3–15; every later task imports from it. It is deliberately one task so the contracts are pinned in a single reviewable commit and parallel work cannot conflict over these four files.

**Files:**
- Modify: `src/shared/types.ts` (append after the `DiagnosticsSnapshot` block, around line 285)
- Modify: `src/shared/ipc.ts` (Diagnostics section around line 121, Events section around line 130)

**Interfaces:**
- Produces: `LogLevel`, `LoggedError`, `LogEntry`, `SessionRecord`, `BugReportInput`, `BugReportResult`; channels `DIAGNOSTICS_LOG`, `DIAGNOSTICS_REVEAL_LOG`, `DIAGNOSTICS_CREATE_REPORT`, `DIAGNOSTICS_LAST_SESSION`, `LOG_ENTRY`.

- [ ] **Step 1: Add the types**

**Task 1 shipped `LOG_CODES`, `LOG_SOURCES`, `LOG_CONTEXT_KEYS` and `ERROR_NAMES` inside `src/main/services/logSafe.ts`, and that is the wrong home.** `src/shared/types.ts` cannot import from `@main/*` — the alias is main-and-preload only, and `tests/importAliases.test.ts` enforces it — and the renderer needs `LogCode` for `RendererLogPayload` (Task 6) and `labelForCode` (Task 10). A main-process module cannot be the source of truth for a type three processes share.

So **move** the four `as const` arrays and their derived types from `logSafe.ts` into `src/shared/types.ts` as part of this task, and have `logSafe.ts` import them. Nothing else moves: the branding, `TAG_VOCABULARIES`, `ident`, `tag`, `sanitizeText`, `sanitizeError` and the validators stay in `logSafe.ts`, which is main-only by design — the boundary logic belongs where it is enforced, and only the vocabulary is shared. Re-run `pnpm test -- logSafe` after the move; the existing 49 tests should pass untouched.

Take the union *contents* from the shipped `logSafe.ts`, not from the block below. Task 1 audited the real `console.*` call sites across the 12 main-process files and appended codes for those with no pinned-code fit, so the shipped list is longer than what follows and the extras are load-bearing for Task 7.

Append to `src/shared/types.ts`:

```typescript
// Diagnostic logging. There is no free-form text field here BY DESIGN: code,
// source and context keys are all drawn from fixed unions, so a call site has
// nowhere to put a URL, case name or path. Regex scrubbing was tried first and
// abandoned — see the spec's "No free-form prose reaches disk".
export type LogLevel = 'error' | 'warn' | 'info'

// Fixed vocabularies. Extend these unions when a new call site needs an entry;
// that edit is the review gate. Sources match the migration table in Task 7.
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

export const LOG_CODES = [
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
  'react.render_error'
] as const
export type LogCode = (typeof LOG_CODES)[number]

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
  // renderer-originated keys (Tasks 10 and 11): the query-key domain segment,
  // the ErrorBoundary that caught, and the IPC channel that threw. All three
  // are static identifiers from the source, never user data — but they still
  // pass through ident() on the main side, because the renderer is not trusted.
  'domain',
  'boundary',
  'channel'
] as const
export type LogContextKey = (typeof LOG_CONTEXT_KEYS)[number]

// message is absent deliberately — err.message is the prose vector that a
// regex cannot police, so it is never persisted.
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
```

- [ ] **Step 2: Add the IPC channels**

In `src/shared/ipc.ts`, replace the Diagnostics section:

```typescript
  // Diagnostics
  DIAGNOSTICS_GET: 'diagnostics:get',
  DIAGNOSTICS_LOG: 'diagnostics:log',
  DIAGNOSTICS_REVEAL_LOG: 'diagnostics:revealLog',
  DIAGNOSTICS_CREATE_REPORT: 'diagnostics:createReport',
  DIAGNOSTICS_LAST_SESSION: 'diagnostics:lastSession',
```

And add to the events block, after `CAPTURE_ACTIVITY`:

```typescript
  LOG_ENTRY: 'event:logEntry',
```

- [ ] **Step 3: Verify the project still typechecks and lints**

Run: `pnpm lint`
Expected: no errors. Types are additive, so nothing should break.

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts src/shared/ipc.ts
git commit -m "feat(logging): shared log entry types and diagnostics ipc channels"
```

---

### Task 3: `sessionLog.ts` — sessions and unclean-exit detection

**Files:**
- Create: `src/main/services/sessionLog.ts`
- Test: `tests/main/services/sessionLog.test.ts`

**Interfaces:**
- Consumes: `SessionRecord` from `@shared/types`.
- Produces: `startSession(logDir, info)` → `SessionRecord`; `markCleanExit(logDir)`; `readSessions(logDir)` → `SessionRecord[]`; `takeUncleanSession(logDir)` → `SessionRecord | null`.

- [ ] **Step 1: Write the failing test**

```typescript
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  takeUncleanSession,
  markCleanExit,
  readSessions,
  startSession
} from '@main/services/sessionLog'

const INFO = { version: '1.0.0', platform: 'win32', installFormat: 'nsis' }

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bb-session-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('sessionLog', () => {
  it('records a session that starts', () => {
    const rec = startSession(dir, INFO)
    expect(rec.cleanExit).toBe(false)
    expect(readSessions(dir)).toHaveLength(1)
  })

  it('reports no unclean session after a clean quit', () => {
    startSession(dir, INFO)
    markCleanExit(dir)
    startSession(dir, INFO)
    expect(takeUncleanSession(dir)).toBeNull()
  })

  it('reports the previous session as unclean when the lock survived', () => {
    const first = startSession(dir, INFO)
    // No markCleanExit — simulates a crash or power loss.
    startSession(dir, INFO)
    expect(takeUncleanSession(dir)?.sessionId).toBe(first.sessionId)
  })

  it('never reports the current session as unclean', () => {
    startSession(dir, INFO)
    expect(takeUncleanSession(dir)).toBeNull()
  })

  it('offers a given crash exactly once', () => {
    startSession(dir, INFO)
    startSession(dir, INFO)
    expect(takeUncleanSession(dir)).not.toBeNull()
    // Without take-once semantics this crash would re-prompt on every launch
    // until the 20-record cap evicted it.
    expect(takeUncleanSession(dir)).toBeNull()
  })

  it('caps stored sessions at 20', () => {
    for (let i = 0; i < 25; i++) {
      startSession(dir, INFO)
      markCleanExit(dir)
    }
    expect(readSessions(dir)).toHaveLength(20)
  })

  it('recovers from a corrupt sessions file', () => {
    startSession(dir, INFO)
    writeFileSync(join(dir, 'sessions.json'), '{ not json')
    expect(() => startSession(dir, INFO)).not.toThrow()
    expect(readSessions(dir)).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- sessionLog`
Expected: FAIL — cannot resolve `@main/services/sessionLog`.

- [ ] **Step 3: Write the implementation**

```typescript
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { SessionRecord } from '@shared/types'

// A launch writes session.lock and clears it in before-quit. A lock that is
// still present at the next launch is the ONLY signal for an OOM kill or power
// loss — no JS handler observes those — so this drives the crash prompt.

const SESSIONS_FILE = 'sessions.json'
const LOCK_FILE = 'session.lock'
const MAX_SESSIONS = 20

export interface SessionInfo {
  version: string
  platform: string
  installFormat: string
}

let currentSessionId = ''

function sessionsPath(logDir: string): string {
  return join(logDir, SESSIONS_FILE)
}

function lockPath(logDir: string): string {
  return join(logDir, LOCK_FILE)
}

export function readSessions(logDir: string): SessionRecord[] {
  try {
    const parsed: unknown = JSON.parse(readFileSync(sessionsPath(logDir), 'utf8'))
    return Array.isArray(parsed) ? (parsed as SessionRecord[]) : []
  } catch {
    // Missing or corrupt: a diagnostics file must never block startup.
    return []
  }
}

function writeSessions(logDir: string, records: SessionRecord[]): void {
  // Best-effort, like readSessions. A read-only logs directory or a `logs`
  // path that is a file makes every write here throw; startSession runs inside
  // whenReady before the window exists, so an escaping throw would stop
  // Birdbrain launching at all. Losing session history is an acceptable
  // degradation; refusing to start is not.
  try {
    writeFileSync(sessionsPath(logDir), JSON.stringify(records.slice(-MAX_SESSIONS), null, 2))
  } catch {
    // Session persistence disabled for this run.
  }
}

// A lock naming a session with no matching record is the residue of an unclean
// exit whose sessions.json was lost or corrupted. Without this, that crash is
// invisible: takeUncleanSession only reads records, and startSession is about
// to overwrite the lock. Synthesize the minimum record the recovery prompt
// needs — the fields we cannot recover are marked unknown rather than guessed.
function reclaimOrphanedLock(logDir: string, records: SessionRecord[]): SessionRecord[] {
  let lockedId = ''
  try {
    lockedId = readFileSync(lockPath(logDir), 'utf8').trim()
  } catch {
    return records
  }
  if (!lockedId || records.some((r) => r.sessionId === lockedId)) return records

  return [
    ...records,
    {
      sessionId: lockedId,
      startedAt: '',
      endedAt: null,
      version: 'unknown',
      platform: 'unknown',
      installFormat: 'unknown',
      cleanExit: false
    }
  ]
}

export function startSession(logDir: string, info: SessionInfo): SessionRecord {
  const record: SessionRecord = {
    sessionId: randomUUID(),
    startedAt: new Date().toISOString(),
    endedAt: null,
    version: info.version,
    platform: info.platform,
    installFormat: info.installFormat,
    cleanExit: false
  }

  // Set before any I/O: the logger stamps every entry with this, and it must
  // be correct even when nothing below can be written to disk.
  currentSessionId = record.sessionId

  try {
    mkdirSync(logDir, { recursive: true })
  } catch {
    return record
  }

  writeSessions(logDir, [...reclaimOrphanedLock(logDir, readSessions(logDir)), record])
  try {
    writeFileSync(lockPath(logDir), record.sessionId)
  } catch {
    // No lock means the next launch cannot detect an OOM kill for this run.
  }
  return record
}

export function markCleanExit(logDir: string): void {
  const records = readSessions(logDir)
  const current = records.find((r) => r.sessionId === currentSessionId)
  if (current) {
    current.cleanExit = true
    current.endedAt = new Date().toISOString()
    writeSessions(logDir, records)
  }
  try {
    rmSync(lockPath(logDir), { force: true })
  } catch {
    // A lock we cannot remove makes the next launch report a false crash —
    // annoying, but not a reason to throw out of before-quit and block exit.
  }
}

// Take-once. Without acknowledging, a single genuine crash leaves cleanExit
// false forever and every subsequent launch re-shows the recovery prompt until
// the 20-record cap finally evicts it.
export function takeUncleanSession(logDir: string): SessionRecord | null {
  const records = readSessions(logDir)
  const unclean = records.filter((r) => !r.cleanExit && !r.acknowledged && r.sessionId !== currentSessionId).pop()
  if (!unclean) return null

  unclean.acknowledged = true
  writeSessions(logDir, records)
  return unclean
}

export function currentSession(): string {
  return currentSessionId
}
```

Note on the lock file: the unclean signal is normally carried by the *record* whose `cleanExit` stayed false, which is why `takeUncleanSession` reads records rather than the lock. But records and lock can disagree — an unclean exit that also lost or corrupted `sessions.json` leaves the lock as the only surviving evidence — so `startSession` consumes the old lock before writing its own and reconstructs a minimal record for it. Reading before overwriting is what makes the lock load-bearing rather than decorative.

Add these cases to the test written in Step 1:

```typescript
  it('reconstructs an unclean record when only the lock survives', () => {
    writeFileSync(join(dir, 'session.lock'), 'ghost-session')
    startSession(dir, info)
    const ghost = readSessions(dir).find((r) => r.sessionId === 'ghost-session')
    expect(ghost).toMatchObject({ cleanExit: false, version: 'unknown' })
    expect(takeUncleanSession(dir)?.sessionId).toBe('ghost-session')
  })

  it('returns a usable session when the log directory cannot be written', () => {
    const record = startSession(join(dir, 'unwritable', 'logs'), info)
    expect(record.sessionId).toBeTruthy()
    expect(currentSession()).toBe(record.sessionId)
  })
```

The second case needs `mkdirSync` to fail. Create a *file* at the parent path first (`writeFileSync(join(dir, 'unwritable'), '')`), which makes `mkdirSync(join(dir,'unwritable','logs'), {recursive:true})` throw ENOTDIR on every platform — unlike chmod, which is a no-op for an administrator on Windows.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- sessionLog`
Expected: PASS.

- [ ] **Step 5: Lint and commit**

```bash
pnpm lint
git add src/main/services/sessionLog.ts tests/main/services/sessionLog.test.ts
git commit -m "feat(logging): session records and unclean-exit detection"
```

---

### Task 4: `logger.ts` — the sink

**Files:**
- Create: `src/main/services/logger.ts`
- Test: `tests/main/services/logger.test.ts`

**Interfaces:**
- Consumes: `LogContext`, `sanitizeError` from `@main/services/logSafe`; `LogEntry`, `LogLevel` from `@shared/types`.
- Produces: `createLogger(deps)` → `Logger`; module singleton `logger` with `error/warn/info` returning a correlation id string, plus `initLogger(userDataPath, sessionId)`, `setMainWindow(win)`, `flushSync()`, `getLogPath()`, `getLogDir()`.

- [ ] **Step 1: Write the failing test**

```typescript
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLogger } from '@main/services/logger'
import { code, ident } from '@main/services/logSafe'
import type { LogEntry } from '@shared/types'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bb-logger-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function lines(logDir: string): LogEntry[] {
  return readFileSync(join(logDir, 'birdbrain.log'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as LogEntry)
}

describe('logger', () => {
  it('writes a json line per entry after flush', () => {
    const log = createLogger({ logDir: dir, sessionId: 's1' })
    log.info('captureServer', 'server started', { port: 19845 })
    log.flushSync()

    const [entry] = lines(dir)
    expect(entry.level).toBe('info')
    expect(entry.source).toBe('captureServer')
    expect(entry.message).toBe('server started')
    expect(entry.context).toEqual({ port: 19845 })
    expect(entry.sessionId).toBe('s1')
  })

  it('returns a correlation id that matches the written entry', () => {
    const log = createLogger({ logDir: dir, sessionId: 's1' })
    const id = log.error('ipc', 'handler threw')
    log.flushSync()
    expect(lines(dir)[0].id).toBe(id)
  })

  it('stores branded context values as plain strings', () => {
    const log = createLogger({ logDir: dir, sessionId: 's1' })
    log.warn('captureServer', 'screenshot dropped', {
      captureId: ident('abc-123'),
      reason: code('TOO_LARGE')
    })
    log.flushSync()
    expect(lines(dir)[0].context).toEqual({ captureId: 'abc-123', reason: 'TOO_LARGE' })
  })

  it('sanitizes an attached error', () => {
    const log = createLogger({ logDir: dir, sessionId: 's1' })
    log.error('storage', 'write failed', undefined, new Error('open /home/tester/case/a.mhtml'))
    log.flushSync()
    const { error } = lines(dir)[0]
    expect(error?.message).not.toContain('tester')
    expect(error?.name).toBe('Error')
  })

  it('scrubs a url interpolated into the message', () => {
    // Guards the real captureServer.ts pattern: `${reason} for ${url}`.
    const log = createLogger({ logDir: dir, sessionId: 's1' })
    log.warn('captureServer', 'screenshot dropped for https://target.example/secret')
    log.flushSync()

    const { message } = lines(dir)[0]
    expect(message).not.toContain('target.example')
    expect(message).toContain('‹url›')
  })

  it('emits each entry to the renderer callback', () => {
    const seen: LogEntry[] = []
    const log = createLogger({ logDir: dir, sessionId: 's1', emit: (e) => seen.push(e) })
    log.info('app', 'ready')
    expect(seen).toHaveLength(1)
    expect(seen[0].message).toBe('ready')
  })

  it('rotates when the file exceeds the limit and keeps one backup', () => {
    const log = createLogger({ logDir: dir, sessionId: 's1', maxBytes: 1024 })
    for (let i = 0; i < 200; i++) log.info('app', `entry ${i} ${'x'.repeat(50)}`)
    log.flushSync()

    expect(statSync(join(dir, 'birdbrain.log.1')).size).toBeGreaterThan(0)
    expect(statSync(join(dir, 'birdbrain.log')).size).toBeLessThan(2048)
  })

  it('flushes buffered entries when the buffer fills without an explicit flush', () => {
    const log = createLogger({ logDir: dir, sessionId: 's1', maxBuffer: 4 })
    for (let i = 0; i < 4; i++) log.info('app', `entry ${i}`)
    expect(lines(dir)).toHaveLength(4)
  })

  it('survives an unwritable log directory', () => {
    const log = createLogger({ logDir: join(dir, 'nested', 'deep'), sessionId: 's1' })
    expect(() => {
      log.error('app', 'still fine')
      log.flushSync()
    }).not.toThrow()
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- logger`
Expected: FAIL — cannot resolve `@main/services/logger`.

- [ ] **Step 3: Write the implementation**

```typescript
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '@shared/ipc'
import type { LogEntry, LogLevel } from '@shared/types'
import { homedir } from 'node:os'
import { sanitizeError, sanitizeText, type LogContext } from '@main/services/logSafe'

// The single durable sink. Writes are buffered and flushed on a timer so
// per-entry sync I/O never lands on the main-process event loop that
// diagnostics.ts is measuring for stalls — but flushSync() is exposed because
// an uncaughtException handler will not survive an async flush.

const LOG_FILE = 'birdbrain.log'
const BACKUP_FILE = 'birdbrain.log.1'
const MAX_BYTES = 2 * 1024 * 1024
const MAX_BUFFER = 32
const FLUSH_MS = 1000

export interface LoggerDeps {
  logDir: string
  sessionId: string
  emit?: (entry: LogEntry) => void
  maxBytes?: number
  maxBuffer?: number
}

export interface Logger {
  error(source: LogSource, code: LogCode, context?: LogContext, err?: unknown): string
  warn(source: LogSource, code: LogCode, context?: LogContext, err?: unknown): string
  info(source: LogSource, code: LogCode, context?: LogContext, err?: unknown): string
  flushSync(): void
  logPath(): string
  dispose(): void
}

export function createLogger(deps: LoggerDeps): Logger {
  const maxBytes = deps.maxBytes ?? MAX_BYTES
  const maxBuffer = deps.maxBuffer ?? MAX_BUFFER
  const path = join(deps.logDir, LOG_FILE)
  let buffer: string[] = []
  let timer: ReturnType<typeof setInterval> | null = null

  function rotateIfNeeded(): void {
    try {
      if (existsSync(path) && statSync(path).size > maxBytes) {
        renameSync(path, join(deps.logDir, BACKUP_FILE))
      }
    } catch {
      /* rotation is best-effort; never block a write */
    }
  }

  function flushSync(): void {
    if (buffer.length === 0) return
    const payload = buffer.join('')
    buffer = []
    try {
      mkdirSync(deps.logDir, { recursive: true })
      rotateIfNeeded()
      appendFileSync(path, payload)
    } catch {
      // A tester with an unwritable userData must still get a working app.
    }
  }

  function write(level: LogLevel, source: LogSource, code: LogCode, context?: LogContext, err?: unknown): string {
    const entry: LogEntry = {
      // 16 hex chars (64 bits), not 8. The bundle cites only this id, so a
      // birthday collision across two 2MB logs would point Report this at the
      // wrong entry.
      id: randomUUID().replace(/-/g, '').slice(0, 16),
      sessionId: deps.sessionId,
      timestamp: new Date().toISOString(),
      level,
      // No sanitization needed: both are union members, not free text.
      source,
      code,
      ...(context ? { context: context as Record<string, string | number | boolean | null> } : {}),
      ...(err === undefined ? {} : { error: sanitizeError(err) })
    }

    buffer.push(`${JSON.stringify(entry)}\n`)

    if (!timer) {
      timer = setInterval(flushSync, FLUSH_MS)
      timer.unref?.()
    }
    if (buffer.length >= maxBuffer) flushSync()

    try {
      deps.emit?.(entry)
    } catch {
      /* a dead renderer must not break logging */
    }

    return entry.id
  }

  return {
    error: (s, m, c, e) => write('error', s, m, c, e),
    warn: (s, m, c, e) => write('warn', s, m, c, e),
    info: (s, m, c, e) => write('info', s, m, c, e),
    flushSync,
    logPath: () => path,
    dispose: () => {
      if (timer) clearInterval(timer)
      timer = null
      flushSync()
    }
  }
}

// --- Module singleton -------------------------------------------------------
// Crash handlers register before app.whenReady(), so every method must be safe
// to call before initLogger() has run.

let instance: Logger | null = null
let mainWindow: BrowserWindow | null = null
let logDir = ''

export function initLogger(userDataPath: string, sessionId: string): void {
  logDir = join(userDataPath, 'logs')
  instance = createLogger({
    logDir,
    sessionId,
    emit: (entry) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.LOG_ENTRY, entry)
      }
    }
  })
}

export function setMainWindow(win: BrowserWindow): void {
  mainWindow = win
}

export function getLogDir(): string {
  return logDir
}

export function getLogPath(): string {
  return instance ? instance.logPath() : ''
}

export function flushSync(): void {
  instance?.flushSync()
}

export function disposeLogger(): void {
  instance?.dispose()
  instance = null
}

export const logger = {
  error: (source: LogSource, code: LogCode, context?: LogContext, err?: unknown): string =>
    instance ? instance.error(source, code, context, err) : '',
  warn: (source: LogSource, code: LogCode, context?: LogContext, err?: unknown): string =>
    instance ? instance.warn(source, code, context, err) : '',
  info: (source: LogSource, code: LogCode, context?: LogContext, err?: unknown): string =>
    instance ? instance.info(source, code, context, err) : ''
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- logger`
Expected: PASS.

- [ ] **Step 5: Lint and commit**

```bash
pnpm lint
git add src/main/services/logger.ts tests/main/services/logger.test.ts
git commit -m "feat(logging): buffered jsonl logger with rotation and correlation ids"
```

---

### Task 5: Crash handlers, startup wiring, and clean-exit marking

**Files:**
- Modify: `src/main/index.ts` (register handlers before `app.whenReady()` around line 163; init inside `whenReady` after `initInstallationId`; extend `before-quit` at line 269)
- Modify: `src/main/services/diagnostics.ts` (add `export` to the existing `detectInstallFormat` function — it is currently module-private; do not change its body)

**Interfaces:**
- Consumes: `initLogger`, `logger`, `flushSync`, `disposeLogger`, `setMainWindow` from `@main/services/logger`; `startSession`, `markCleanExit` from `@main/services/sessionLog`.
- Produces: nothing new for later tasks.

- [ ] **Step 1: Register crash handlers before `app.whenReady()`**

Add near the top of `src/main/index.ts`, after the imports and before `app.whenReady()`:

```typescript
// Registered before whenReady so a failure during startup is still captured.
// logger.* is a no-op until initLogger runs, which is safe by construction.
process.on('uncaughtException', (err) => {
  logger.error('app', 'app.uncaught_exception', undefined, err)
  flushSync()
  dialog.showErrorBox(
    'Birdbrain encountered a fatal error',
    'The app must close. A diagnostic log has been saved — you can attach it to a bug report from Settings → Diagnostics after restarting.'
  )
  app.exit(1)
})

process.on('unhandledRejection', (reason) => {
  logger.error('app', 'app.unhandled_rejection', undefined, reason)
  flushSync()
})

app.on('render-process-gone', (_event, contents, details) => {
  logger.error('app', 'app.render_process_gone', {
    reason: tag(details.reason, 'renderGoneReason'),
    exitCode: details.exitCode
  })
  flushSync()

  // Logging alone leaves the tester staring at a dead window until they
  // restart the app by hand. 'clean-exit' and 'killed' are ordinary shutdown
  // paths and must not trigger a recovery prompt.
  if (details.reason === 'clean-exit' || details.reason === 'killed') return

  const win = BrowserWindow.fromWebContents(contents)
  if (!win || win.isDestroyed()) return

  const { response } = dialog.showMessageBoxSync
    ? { response: dialog.showMessageBoxSync(win, {
        type: 'error',
        buttons: ['Reload', 'Ignore'],
        defaultId: 0,
        title: 'Birdbrain stopped responding',
        message: 'The window crashed. Reloading recovers it — your captures are unaffected.'
      }) }
    : { response: 1 }

  if (response === 0) win.reload()
})

app.on('child-process-gone', (_event, details) => {
  // tag(), NOT ident(): Electron's child-process type labels contain spaces
  // ('Pepper Plugin', 'Sandbox helper'), which ident() rejects — and a
  // rejection throws outside production, escalating a child-process failure
  // into a fatal main-process exception from inside the crash handler itself.
  logger.error('app', 'app.child_process_gone', {
    processType: tag(details.type, 'childProcessType'),
    reason: tag(details.reason, 'childGoneReason'),
    exitCode: details.exitCode
  })
  flushSync()
})
```

No vocabulary constants are declared here. `tag()` selects a fixed vocabulary
by name from the table inside `logSafe.ts` (Task 1) — `'renderGoneReason'`,
`'childProcessType'`, `'childGoneReason'`, `'platform'`, `'installFormat'`.
A caller that could pass its own array could pass `tag(url, [url])` and brand
a captured URL as log-safe, so the approved vocabularies live in one reviewable
file and call sites reference them by key. If a vocabulary you need is missing,
add it to `logSafe.ts` rather than declaring a local array.

Imports to add:

```typescript
import { flushSync, initLogger, logger, setMainWindow as setLoggerWindow } from '@main/services/logger'
import { tag } from '@main/services/logSafe'
import { detectInstallFormat } from '@main/services/diagnostics'
import { markCleanExit, startSession } from '@main/services/sessionLog'
```

`dialog` must be added to the existing `electron` import if not already present.

- [ ] **Step 2: Initialise the logger inside `whenReady`**

In `app.whenReady().then(async () => {`, immediately after `initInstallationId(userDataPath)`:

```typescript
    // detectInstallFormat, not process.platform: SessionRecord promises the
    // package format, and on Linux the AppImage/deb/archive distinction is
    // exactly what a crash report needs. Export the existing helper from
    // diagnostics.ts rather than reimplementing it — it already reads the
    // APPIMAGE env var and the electron-builder package-type marker.
    const session = startSession(join(userDataPath, 'logs'), {
      version: app.getVersion(),
      platform: process.platform,
      installFormat: detectInstallFormat(app.isPackaged)
    })
    initLogger(userDataPath, session.sessionId)
    // A Phase 1 tester sends only birdbrain.log via Reveal, so this entry is
    // the ONLY place installation, platform and package format are recorded.
    // Without them a standalone log cannot correlate repeat reports to one
    // installation or distinguish appimage/deb/nsis failures.
    logger.info('app', 'app.session_start', {
      installationId: ident(getInstallationId()),
      version: ident(app.getVersion().replace(/\./g, '-')),
      platform: tag(process.platform, 'platform'),
      installFormat: tag(session.installFormat, 'installFormat'),
      packaged: app.isPackaged
    })
```

Then find where the main `BrowserWindow` is created (around line 35) and, wherever `setMainWindow` is already called for the capture server, add:

```typescript
    setLoggerWindow(win)
```

- [ ] **Step 3: Mark a clean exit**

Extend the existing `before-quit` handler at line 269:

```typescript
  app.on('before-quit', async () => {
    // markCleanExit MUST run first and synchronously. Electron does not await
    // an async before-quit listener, so anything sequenced after `await
    // stopCaptureServer()` may never run — which would leave session.lock in
    // place and make every ordinary quit look like a crash on next launch.
    markCleanExit(join(process.env.BIRDBRAIN_USER_DATA || app.getPath('userData'), 'logs'))
    disposeLogger()

    stopExtensionConnectionCheck()
    updaterService?.dispose()
    await stopCaptureServer()
    closeDatabase()
  })
```

Add `disposeLogger` to the logger import.

- [ ] **Step 4: Verify manually**

Run: `pnpm build`
Expected: build succeeds.

Then run `pnpm dev`, let the app start, quit it cleanly, and confirm `userData/logs/birdbrain.log` contains a `session started` line and that `session.lock` is **absent** after quitting.

Report the actual file contents. If `session.lock` is still present after a clean quit, the `before-quit` wiring is wrong — fix before committing.

- [ ] **Step 5: Commit**

```bash
git add src/main/index.ts
git commit -m "feat(logging): crash handlers and session lifecycle wiring"
```

---

### Task 6: IPC handlers and the preload bridge

**Files:**
- Modify: `src/main/ipcHandlers.ts` (near the existing `DIAGNOSTICS_GET` handler at line 611)
- Modify: `src/preload/index.ts` (extend the `diagnostics` object at line 270; add `onLogEntry` beside `onCaptureActivity` at line 371)
- Modify: `src/renderer/env.d.ts` (extend `diagnostics` at line 171)

**Interfaces:**
- Consumes: `getLogPath`, `logger` from `@main/services/logger`; `takeUncleanSession` from `@main/services/sessionLog`.
- Produces: `window.birdbrain.diagnostics.log(entry)` → `Promise<string>`, `.revealLog()` → `Promise<void>`, `.lastSession()` → `Promise<SessionRecord | null>`, and `window.birdbrain.onLogEntry(cb)` → unsubscribe function. `createReport` is added in Task 13.

- [ ] **Step 1: Add the main-process handlers**

In `src/main/ipcHandlers.ts`, after the existing `DIAGNOSTICS_GET` registration:

```typescript
  // Renderer-side failures join the same durable log as main-process ones.
  // Everything crossing this boundary is untrusted: the renderer holds page
  // titles, case names and URLs, and a compile-time union does not survive an
  // IPC hop. Re-validate every field against the same allowlists here, and
  // drop anything unrecognised rather than coercing it into the log.
  ipcMain.handle(IPC_CHANNELS.DIAGNOSTICS_LOG, (_e, payload: RendererLogPayload) => {
    const level = payload?.level === 'error' || payload?.level === 'warn' ? payload.level : 'info'
    if (!isLogCode(payload?.code)) return ''

    const context: LogContext = {}
    for (const [key, value] of Object.entries(payload.context ?? {})) {
      if (!isLogContextKey(key)) continue
      if (typeof value === 'number' || typeof value === 'boolean') context[key] = value
      else if (typeof value === 'string') context[key] = ident(value)
    }

    // Source is not taken from the payload at all. Every entry that arrives
    // through this channel came from the renderer by definition, and the code
    // already says which subsystem failed.
    return logger[level]('renderer', payload.code, context, errorName(payload.error))
  })

  ipcMain.handle(IPC_CHANNELS.DIAGNOSTICS_REVEAL_LOG, () => {
    const path = getLogPath()
    if (path) shell.showItemInFolder(path)
  })

  ipcMain.handle(IPC_CHANNELS.DIAGNOSTICS_LAST_SESSION, () => takeUncleanSession(getLogDir()))
```

Imports to add:

```typescript
import { getLogDir, getLogPath, logger } from '@main/services/logger'
import { takeUncleanSession } from '@main/services/sessionLog'
import { errorName, ident, isLogCode, isLogContextKey } from '@main/services/logSafe'
import type { LogContext } from '@main/services/logSafe'
import type { RendererLogPayload } from '@shared/ipc'
```

`isLogCode`, `isLogContextKey` and `errorName` are the runtime halves of Task 2's unions and belong beside `ident`/`tag` in `logSafe.ts`. Add them there if Task 1 has not already:

```typescript
export function isLogCode(value: unknown): value is LogCode {
  return typeof value === 'string' && (LOG_CODES as readonly string[]).includes(value)
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
```

- [ ] **Step 2: Extend the preload bridge**

Replace the `diagnostics` object in `src/preload/index.ts`:

```typescript
  diagnostics: {
    get: (): Promise<DiagnosticsSnapshot> => ipcRenderer.invoke(IPC_CHANNELS.DIAGNOSTICS_GET),
    log: (payload: RendererLogPayload): Promise<string> =>
      ipcRenderer.invoke(IPC_CHANNELS.DIAGNOSTICS_LOG, payload),
    revealLog: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.DIAGNOSTICS_REVEAL_LOG),
    lastSession: (): Promise<SessionRecord | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.DIAGNOSTICS_LAST_SESSION)
  },
```

And add beside `onCaptureActivity`:

```typescript
  onLogEntry: (callback: (entry: LogEntry) => void) => {
    const handler = (_: unknown, entry: LogEntry) => callback(entry)
    ipcRenderer.on(IPC_CHANNELS.LOG_ENTRY, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.LOG_ENTRY, handler)
  },
```

Add `LogEntry`, `SessionRecord` to the existing `@shared/types` type import and `RendererLogPayload` to the `@shared/ipc` type import. Define that payload alongside the other IPC types in `src/shared/ipc.ts`:

```typescript
// The renderer's half of the logging contract. Codes and context keys are the
// same unions the main process enforces, so a mistake is a compile error in
// the renderer and a dropped entry in main — never a leak.
export interface RendererLogPayload {
  level: LogLevel
  code: LogCode
  context?: Partial<Record<LogContextKey, string | number | boolean | null>>
  error?: string
}
```

- [ ] **Step 3: Mirror the types in `env.d.ts`**

```typescript
  diagnostics: {
    get(): Promise<DiagnosticsSnapshot>
    log(payload: RendererLogPayload): Promise<string>
    revealLog(): Promise<void>
    lastSession(): Promise<SessionRecord | null>
  }
```

And in the event-listener section of the same interface:

```typescript
  onLogEntry(callback: (entry: LogEntry) => void): () => void
```

Add `LogEntry`, `SessionRecord` to the `@shared/types` import at line 31 and `RendererLogPayload` to the `@shared/ipc` import at line 33.

- [ ] **Step 4: Verify**

Run: `pnpm lint && pnpm test && pnpm build`
Expected: all pass. Report actual output.

- [ ] **Step 5: Commit**

```bash
git add src/main/ipcHandlers.ts src/preload/index.ts src/renderer/env.d.ts
git commit -m "feat(logging): diagnostics log ipc handlers and preload bridge"
```

---

### Task 7: Migrate main-process `console.*` calls

Twelve files carry `console.*` today. Each becomes a `logger.*` call with a source tag. This task is mechanical but must respect the branded-context rule: **any value you are tempted to interpolate into the message is probably unsafe**. Paths, URLs and case names go in the attached error (where `sanitizeError` scrubs them) or are dropped entirely.

**Files:**
- Modify: `src/main/index.ts`, `src/main/ipcHandlers.ts`, `src/main/services/captureServer.ts`, `captureLifecycle.ts`, `backgroundRenderer.ts`, `ai/openrouter.ts`, `serverToken.ts`, `settings.ts`, `thumbnails.ts`, `selectorLifecycle.ts`, `consentBlocker.ts`, `timestampWorker.ts`
- Test: `tests/main/noConsole.test.ts`

**Interfaces:**
- Consumes: `logger` from `@main/services/logger`; `ident`, `code`, `tag` from `@main/services/logSafe`.

- [ ] **Step 1: Write the failing guard test**

```typescript
import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const MAIN_DIR = join(__dirname, '..', '..', 'src', 'main')
const CONSOLE_CALL = /\bconsole\.(log|warn|error|info|debug)\s*\(/

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return tsFiles(full)
    return full.endsWith('.ts') ? [full] : []
  })
}

describe('main process logging', () => {
  it('routes every diagnostic through the logger, never console', () => {
    const offenders = tsFiles(MAIN_DIR).filter((f) => CONSOLE_CALL.test(readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })
})
```

This guard is the real deliverable — it stops the 47th `console.log` from being added next month.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test -- noConsole`
Expected: FAIL, listing the 12 files.

- [ ] **Step 3: Migrate each file**

Work through the offenders the test names. The source tag is the module name. Worked example — `src/main/index.ts` currently has:

```typescript
      console.warn(
        `Failed to initialize storage at "${capturesDir}", falling back to default:`,
        err
      )
```

`capturesDir` is an absolute path and must not be interpolated. It becomes:

```typescript
      logger.warn('app', 'app.storage_init_failed', undefined, err)
```

The prose that used to be the message now lives in `labelForCode` (Task 10), where it is displayed but never written to disk.

Apply the same shape elsewhere:

| File | Source tag |
|---|---|
| `src/main/index.ts` | `'app'` |
| `src/main/ipcHandlers.ts` | `'ipc'` |
| `src/main/services/captureServer.ts` | `'captureServer'` |
| `src/main/services/captureLifecycle.ts` | `'captureLifecycle'` |
| `src/main/services/backgroundRenderer.ts` | `'backgroundRenderer'` |
| `src/main/services/ai/openrouter.ts` | `'openrouter'` |
| `src/main/services/serverToken.ts` | `'serverToken'` |
| `src/main/services/settings.ts` | `'settings'` |
| `src/main/services/thumbnails.ts` | `'thumbnails'` |
| `src/main/services/selectorLifecycle.ts` | `'selectorLifecycle'` |
| `src/main/services/consentBlocker.ts` | `'consentBlocker'` |
| `src/main/services/timestampWorker.ts` | `'timestampWorker'` |

Rules:
- `console.error(msg, err)` → `logger.error(source, code, context?, err)`; `console.warn` → `logger.warn`; `console.log` → `logger.info`.
- **The message does not come with it.** `logger` takes a `LogCode`, not a string. Choose the closest member of `LOG_CODES`; if nothing fits, add a new one named `<source>.<snake_case_what>` to the union in `src/shared/types.ts` and a display string for it in `labelForCode` (Task 10). Adding codes during this migration is expected — the union is meant to grow to cover real call sites, and every addition is one reviewable line in one file.
- Template literals interpolating a value: move the value into `context` with `ident()`/`tag()` if it is structural, or drop it. **Never** interpolate a path, URL, case name or capture title — and since there is no free-form field left, there is nowhere to put one even by mistake.
- A `console` call whose entire content is prose with no structural payload is usually not worth a code. Delete it rather than inventing a code to preserve a debug print.

Also add these two, so capture failures leave a durable trace:

```typescript
logger.error('captureServer', 'capture.failed', { captureId: ident(id) })
logger.warn('captureServer', 'capture.screenshot_dropped', { reason: tag(screenshotDropReason, 'screenshotDropReason') })
```

The first goes alongside the existing `emitCaptureEvent({ type: 'failed' })` call. The second replaces `console.warn(\`[Birdbrain] ${screenshotDropReason} for ${url}\`)` at `captureServer.ts:360` — note that the existing line interpolates the captured URL, which is exactly the leak this whole task removes. Add a `screenshotDropReason` vocabulary to `logSafe.ts` covering the reasons that call site can produce.

- [ ] **Step 4: Run the guard and the full suite**

Run: `pnpm test -- noConsole`
Expected: PASS.

Run: `pnpm test && pnpm lint`
Expected: PASS. Report actual output.

- [ ] **Step 5: Commit**

```bash
git add src/main tests/main/noConsole.test.ts
git commit -m "refactor(logging): route main-process diagnostics through the logger"
```

---

### Task 8: Log tab in DiagnosticsPanel

**Files:**
- Create: `src/renderer/components/diagnostics/LogTab.tsx`
- Modify: `src/renderer/components/settings/DiagnosticsPanel.tsx`
- Test: `tests/components/LogTab.test.tsx`

**Interfaces:**
- Consumes: `window.birdbrain.onLogEntry`, `window.birdbrain.diagnostics.revealLog`, `LogEntry`.
- Produces: `<LogTab />`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LogTab } from '@renderer/components/diagnostics/LogTab'
import type { LogEntry } from '@shared/types'

function entry(over: Partial<LogEntry> = {}): LogEntry {
  return {
    id: 'a1',
    sessionId: 's1',
    timestamp: '2026-07-25T10:00:00.000Z',
    level: 'error',
    source: 'captureServer',
    code: 'capture.failed',
    ...over
  }
}

let listener: ((e: LogEntry) => void) | null = null

beforeEach(() => {
  listener = null
  vi.stubGlobal('birdbrain', {
    onLogEntry: (cb: (e: LogEntry) => void) => {
      listener = cb
      return () => {
        listener = null
      }
    },
    diagnostics: { revealLog: vi.fn() }
  })
})

describe('LogTab', () => {
  it('shows an empty state before any entry arrives', () => {
    render(<LogTab />)
    expect(screen.getByText('No log entries')).toBeTruthy()
  })

  it('renders entries pushed from main', () => {
    render(<LogTab />)
    listener?.(entry())
    expect(screen.getByText('Capture failed')).toBeTruthy()
    expect(screen.getByText('captureServer')).toBeTruthy()
  })

  it('filters out a level when its chip is toggled off', () => {
    render(<LogTab />)
    listener?.(entry({ id: 'a1', level: 'error', code: 'capture.failed' }))
    listener?.(entry({ id: 'a2', level: 'info', code: 'app.session_start' }))

    fireEvent.click(screen.getByRole('button', { name: /error/i }))
    expect(screen.queryByText('Capture failed')).toBeNull()
    expect(screen.getByText('Session started')).toBeTruthy()
  })

  it('reveals the log file', () => {
    render(<LogTab />)
    fireEvent.click(screen.getByRole('button', { name: /reveal log file/i }))
    expect(window.birdbrain.diagnostics.revealLog).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- LogTab`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
import { useEffect, useState } from 'react'
import { AlertCircle, AlertTriangle, FolderOpen, Info } from 'lucide-react'
import { Button } from '@renderer/components/ui'
import { cn } from '@renderer/lib/utils'
import type { LogEntry, LogLevel } from '@shared/types'

const MAX_ENTRIES = 200
const LEVELS: LogLevel[] = ['error', 'warn', 'info']

const LEVEL_ICON = {
  error: AlertCircle,
  warn: AlertTriangle,
  info: Info
} as const

const LEVEL_COLOR = {
  error: 'text-red-500',
  warn: 'text-amber-500',
  info: 'text-text-muted'
} as const

export function LogTab() {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [active, setActive] = useState<LogLevel[]>(LEVELS)

  useEffect(() => {
    return window.birdbrain.onLogEntry((entry) => {
      setEntries((prev) => [entry, ...prev].slice(0, MAX_ENTRIES))
    })
  }, [])

  function toggle(level: LogLevel): void {
    setActive((prev) => (prev.includes(level) ? prev.filter((l) => l !== level) : [...prev, level]))
  }

  const visible = entries.filter((e) => active.includes(e.level))

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex gap-1.5">
          {LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              onClick={() => toggle(level)}
              className={cn(
                'rounded-full border px-2.5 py-0.5 text-xs capitalize transition-colors',
                active.includes(level)
                  ? 'border-accent bg-accent/10 text-text-primary'
                  : 'border-border text-text-muted'
              )}
            >
              {level}
            </button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5"
          onClick={() => window.birdbrain.diagnostics.revealLog()}
        >
          <FolderOpen className="h-3.5 w-3.5" />
          Reveal log file
        </Button>
      </div>

      <div className="max-h-[300px] space-y-1 overflow-y-auto">
        {visible.length === 0 ? (
          <p className="py-6 text-center text-sm text-text-muted">No log entries</p>
        ) : (
          visible.map((entry) => {
            const Icon = LEVEL_ICON[entry.level]
            return (
              <div key={entry.id} className="flex items-start gap-2 rounded border border-border px-2 py-1.5">
                <Icon className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', LEVEL_COLOR[entry.level])} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-text-primary">{entry.message}</p>
                  <p className="text-xs text-text-muted">
                    <span className="font-mono">{entry.source}</span>
                    {' · '}
                    {new Date(entry.timestamp).toLocaleTimeString()}
                  </p>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
```

Verify the `cn` import path matches the one already used in `DiagnosticsPanel.tsx`; if that file imports `cn` from elsewhere, match it.

- [ ] **Step 4: Mount it in DiagnosticsPanel**

Wrap the existing snapshot sections and the new tab using the `tabs` primitive already in `src/renderer/components/ui`. Keep the existing Refresh and Copy report buttons in the header, unchanged, above the tabs. The snapshot content moves under a "Snapshot" tab; `<LogTab />` goes under a "Log" tab.

- [ ] **Step 5: Run tests and commit**

Run: `pnpm test -- LogTab && pnpm lint`
Expected: PASS. Report actual output.

```bash
git add src/renderer/components/diagnostics/LogTab.tsx src/renderer/components/settings/DiagnosticsPanel.tsx tests/components/LogTab.test.tsx
git commit -m "feat(logging): log tab with level filters and reveal in diagnostics"
```

**Phase 1 is complete. The app now keeps a durable, structural-only log across restarts and captures every crash class.**

---

# Phase 2 — Visibility

*Value on its own: the 29 silent mutation failures stop being silent.*

---

### Task 9: Add sonner and mount the Toaster

**Files:**
- Modify: `package.json`
- Modify: `src/renderer/routes/__root.tsx`

- [ ] **Step 1: Install**

```bash
pnpm add sonner
```

- [ ] **Step 2: Mount the Toaster**

In `__root.tsx`, import and render inside the root layout, beside the existing `CommandPalette`:

```typescript
import { Toaster } from 'sonner'
```

```tsx
      <Toaster
        position="bottom-right"
        closeButton
        toastOptions={{
          classNames: {
            toast: 'bg-surface border border-border text-text-primary',
            description: 'text-text-muted',
            actionButton: 'bg-accent text-white'
          }
        }}
      />
```

Semantic tokens keep it tracking the light/dark theme automatically, so no `useTheme` wiring is needed.

- [ ] **Step 3: Verify**

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml src/renderer/routes/__root.tsx
git commit -m "feat(notify): add sonner and mount the toaster"
```

---

### Task 10: `notify.ts` — the toast and log boundary

**Files:**
- Create: `src/renderer/lib/notify.ts`
- Test: `tests/renderer/lib/notify.test.ts`

**Interfaces:**
- Consumes: `window.birdbrain.diagnostics.log`; `toast` from `sonner`.
- Produces: `notify.error(message, opts?)`, `notify.warn(...)`, `notify.success(message)`, `notify.info(message)`, where `opts` is `{ source?: string; cause?: unknown; correlationId?: string }`.

- [ ] **Step 1: Write the failing test**

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest'

const toastFns = {
  error: vi.fn(),
  warning: vi.fn(),
  success: vi.fn(),
  info: vi.fn()
}
vi.mock('sonner', () => ({ toast: toastFns }))

const log = vi.fn().mockResolvedValue('cid-1')

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('birdbrain', { diagnostics: { log } })
})

describe('notify', () => {
  it('raises a toast and writes a durable log entry for an error', async () => {
    const { notify } = await import('@renderer/lib/notify')
    notify.error('Could not save note', { code: 'mutation.failed' })

    expect(toastFns.error).toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({ level: 'error', code: 'mutation.failed' })
    )
  })

  it('never sends the toast text or the error message to the durable log', async () => {
    const { notify } = await import('@renderer/lib/notify')
    notify.error('Could not save note in Operation Blackbird', {
      code: 'mutation.failed',
      cause: new Error('ENOENT: no such file, open /home/tester/Operation Blackbird/x.mhtml')
    })

    const payload = JSON.stringify(log.mock.calls[0][0])
    expect(payload).not.toContain('Blackbird')
    expect(payload).not.toContain('tester')
    expect(payload).toContain('"error":"Error"')
  })

  it('does not write success toasts to the durable log', async () => {
    const { notify } = await import('@renderer/lib/notify')
    notify.success('Case exported')

    expect(toastFns.success).toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
  })

  it('collapses a storm of identical errors onto one toast id', async () => {
    const { notify } = await import('@renderer/lib/notify')
    notify.error('Capture failed', { code: 'capture.failed' })
    notify.error('Capture failed', { code: 'capture.failed' })
    notify.error('Capture failed', { code: 'capture.failed' })

    const ids = toastFns.error.mock.calls.map((c) => c[1]?.id)
    expect(new Set(ids).size).toBe(1)
  })

  it('re-renders the toast with the correlation id once the log resolves', async () => {
    const { notify } = await import('@renderer/lib/notify')
    notify.error('Capture failed', { code: 'capture.failed' })
    await vi.waitFor(() => expect(toastFns.error).toHaveBeenCalledTimes(2))

    const [first, second] = toastFns.error.mock.calls
    expect(second[1].id).toBe(first[1].id)

    // Report this must cite the entry the tester is actually looking at.
    const dispatched = vi.fn()
    window.addEventListener('birdbrain:report', dispatched)
    second[1].action.onClick()
    expect(dispatched.mock.calls[0][0].detail).toEqual({ correlationId: 'cid-1' })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- notify`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
import { toast } from 'sonner'

// The single boundary where a failure becomes both durable and visible.
// Errors and warnings are logged AND toasted; success and info are toast-only,
// because a durable log of "Case exported" is noise in a bug report.

// message is what the tester reads; code is what survives on disk. They are
// separate parameters precisely because the first may name a case and the
// second may not.
export interface NotifyOpts {
  code?: LogCode
  context?: RendererLogPayload['context']
  cause?: unknown
  correlationId?: string
}

// A retry loop would otherwise fire dozens of toasts and bury the app, so
// identical messages collapse onto one sonner id and repeat in place.
function toastId(message: string): string {
  let hash = 0
  for (let i = 0; i < message.length; i++) {
    hash = (hash * 31 + message.charCodeAt(i)) | 0
  }
  return `n${hash}`
}

// Only the constructor name crosses the boundary. cause.message is the prose
// vector the allowlist exists to exclude, and String(cause) is worse — for a
// thrown string it IS the prose.
function causeName(cause: unknown): string | undefined {
  if (cause === undefined) return undefined
  return cause instanceof Error ? cause.name : 'UnknownError'
}

function durable(
  level: 'error' | 'warn',
  opts: NotifyOpts
): Promise<string | undefined> {
  if (!opts.code) return Promise.resolve(undefined)
  return window.birdbrain.diagnostics
    .log({ level, code: opts.code, context: opts.context, error: causeName(opts.cause) })
    .catch(() => undefined)
  // The logger is best-effort; a failed log must not mask the original error.
}

function reportAction(correlationId?: string) {
  return {
    label: 'Report this',
    onClick: () => window.dispatchEvent(new CustomEvent('birdbrain:report', { detail: { correlationId } }))
  }
}

// The log id is only known once the IPC round-trip resolves, but the toast has
// to appear immediately — a tester must not wait on the main process to see
// that something failed. So show the toast now with whatever id the caller
// supplied, then re-render it under the same sonner id once the real
// correlation id arrives. Without this second call, Report this dispatches
// undefined and the bug report cites no log entry at all.
function toastWithReport(
  kind: 'error' | 'warning',
  message: string,
  opts: NotifyOpts
): void {
  const id = toastId(message)
  const show = (correlationId?: string): void => {
    const config = { id, action: reportAction(correlationId) }
    if (kind === 'error') toast.error(message, config)
    else toast.warning(message, config)
  }

  show(opts.correlationId)
  void durable(kind === 'error' ? 'error' : 'warn', opts).then((logged) => {
    if (logged) show(logged)
  })
}

export const notify = {
  error(message: string, opts: NotifyOpts = {}): void {
    toastWithReport('error', message, opts)
  },

  warn(message: string, opts: NotifyOpts = {}): void {
    toastWithReport('warning', message, opts)
  },

  success(message: string): void {
    toast.success(message, { id: toastId(message) })
  },

  info(message: string): void {
    toast.info(message, { id: toastId(message) })
  }
}
```

The `birdbrain:report` window event is consumed in Task 15; dispatching it now is harmless with no listener attached.

Add the display map in the same file. It is the home for every string the old `message` parameter used to carry — visible in toasts and the log tab, never serialised:

```typescript
const CODE_LABELS: Record<LogCode, string> = {
  'app.session_start': 'Session started',
  'app.uncaught_exception': 'Birdbrain hit an unexpected error',
  'app.unhandled_rejection': 'A background task failed',
  'app.render_process_gone': 'The window stopped responding',
  'app.child_process_gone': 'A helper process stopped',
  'app.storage_init_failed': "Couldn't open the storage folder — using the default location",
  'capture.failed': 'Capture failed',
  'capture.screenshot_dropped': 'Screenshot was skipped',
  'capture.server_started': 'Capture server started',
  'capture.extraction_failed': "Couldn't extract data from the page",
  'ipc.handler_threw': 'An internal request failed',
  'query.failed': "Couldn't load data",
  'mutation.failed': 'Something went wrong. Please try again.',
  'react.render_error': 'This part of the app failed to render'
}

// Record<LogCode, string> makes a new code a compile error until it has a
// label, which is what keeps the two lists from drifting.
export function labelForCode(code: LogCode): string {
  return CODE_LABELS[code]
}
```

The block above covers the pinned codes only. `LOG_CODES` also carries the entries Task 1 added for real `console.*` call sites (`captureLifecycle.tls_refetch_failed`, `backgroundRenderer.trim_failed`, and the rest), so this map **will not compile** until every one has a label — which is the point. Read the union from `src/shared/types.ts` and write a label for each; the original `console.*` string that each code replaced, rewritten for a tester rather than a developer, is the right text. Keep them plain: a tester reads these in a toast.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test -- notify`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/lib/notify.ts tests/renderer/lib/notify.test.ts
git commit -m "feat(notify): toast and durable-log boundary with storm dedup"
```

---

### Task 11: Wire the 29 mutations and query failures

**Files:**
- Modify: `src/renderer/lib/queryClient.ts`
- Modify: `src/renderer/lib/queries.ts` (add `meta` to mutation hooks)
- Test: `tests/renderer/lib/queryClient.test.ts`

**Interfaces:**
- Consumes: `notify` from `@renderer/lib/notify`.
- Produces: `failureMessage(mutation)` exported from `queryClient.ts` for testing.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it, vi } from 'vitest'
vi.mock('@renderer/lib/notify', () => ({ notify: { error: vi.fn(), warn: vi.fn() } }))

import { failureMessage } from '@renderer/lib/queryClient'

describe('failureMessage', () => {
  it('uses the action from mutation meta', () => {
    expect(failureMessage({ options: { meta: { action: 'save note' } } })).toBe("Couldn't save note.")
  })

  it('falls back to a generic message when meta is absent', () => {
    expect(failureMessage({ options: {} })).toBe('Something went wrong. Please try again.')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- queryClient`
Expected: FAIL — `failureMessage` is not exported.

- [ ] **Step 3: Implement**

Replace `src/renderer/lib/queryClient.ts`:

```typescript
import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { notify } from '@renderer/lib/notify'

// Mutations toast; queries only log. With retry:false and services that are
// not ready at launch, toasting query errors would greet every tester with a
// wall of toasts on startup. A mutation is user-initiated, so a silent failure
// there is always worth surfacing.

export function failureMessage(mutation: { options?: { meta?: unknown } }): string {
  const meta = mutation.options?.meta
  const action =
    meta && typeof meta === 'object' && 'action' in meta && typeof meta.action === 'string'
      ? meta.action
      : null
  return action ? `Couldn't ${action}.` : 'Something went wrong. Please try again.'
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      staleTime: 30_000,
      refetchOnWindowFocus: false
    }
  },
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => {
      notify.error(failureMessage(mutation), { code: 'mutation.failed', cause: error })
    }
  }),
  queryCache: new QueryCache({
    onError: (error, query) => {
      // .catch, not bare void: if the main process is gone or the handler is
      // not registered yet, invoke() rejects. An unconsumed rejection here
      // turns one handled query failure into a second, renderer-level
      // unhandledrejection — the logging path manufacturing the very event
      // class it exists to record.
      window.birdbrain.diagnostics
        .log({
          level: 'warn',
          source: 'renderer',
          code: 'query.failed',
          context: { domain: String(query.queryKey[0] ?? 'unknown') },
          error: error instanceof Error ? error.name : 'UnknownError'
        })
        .catch(() => {})
    }
  })
})
```

The query key's first segment is a static domain string from the key factory (`'cases'`, `'captures'`), never user data, so it is safe to pass as context. It still goes through `ident()` on the main side like every other context value — the renderer is not a trusted source.

- [ ] **Step 4: Add `meta.action` to the mutation hooks**

In `src/renderer/lib/queries.ts`, add a `meta` field to each of the 29 `useMutation` calls describing the action in lowercase infinitive form, e.g.:

```typescript
    meta: { action: 'create case' }
    meta: { action: 'save note' }
    meta: { action: 'delete capture' }
```

This is additive. Any hook missed simply falls back to the generic message, so the task is complete and shippable even if a few are left for later — but do all 29 now.

- [ ] **Step 5: Verify and commit**

Run: `pnpm test && pnpm lint`
Expected: PASS. Report actual output.

```bash
git add src/renderer/lib/queryClient.ts src/renderer/lib/queries.ts tests/renderer/lib/queryClient.test.ts
git commit -m "feat(notify): surface mutation failures and log query failures"
```

---

### Task 12: ErrorBoundary

**Files:**
- Create: `src/renderer/components/ErrorBoundary.tsx`
- Modify: `src/renderer/routes/__root.tsx`
- Modify: `src/renderer/components/captures/CaptureViewer.tsx` (wrap its rendered content; confirm the exact filename with `ls src/renderer/components/captures` first)
- Test: `tests/components/ErrorBoundary.test.tsx`

**Interfaces:**
- Produces: `<ErrorBoundary source="..." children />`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ErrorBoundary } from '@renderer/components/ErrorBoundary'

const log = vi.fn().mockResolvedValue('cid')

function Boom({ message = 'render exploded' }: { message?: string }): JSX.Element {
  throw new Error(message)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('birdbrain', { diagnostics: { log } })
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('ErrorBoundary', () => {
  it('renders children when nothing throws', () => {
    render(
      <ErrorBoundary source="test">
        <p>fine</p>
      </ErrorBoundary>
    )
    expect(screen.getByText('fine')).toBeTruthy()
  })

  it('shows recovery UI and logs when a child throws', () => {
    render(
      <ErrorBoundary source="test">
        <Boom />
      </ErrorBoundary>
    )
    expect(screen.getByText('Something went wrong')).toBeTruthy()
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'error',
        code: 'react.render_error',
        context: { boundary: 'test' }
      })
    )
  })

  it('does not send the thrown message to the log', () => {
    render(
      <ErrorBoundary source="test">
        <Boom message="cannot render Operation Blackbird" />
      </ErrorBoundary>
    )
    expect(JSON.stringify(log.mock.calls[0][0])).not.toContain('Blackbird')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- ErrorBoundary`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@renderer/components/ui'

interface Props {
  source: string
  children: ReactNode
}

interface State {
  failed: boolean
}

// Without this a render error is a white screen with no trace. The component
// stack is sent to main, where sanitizeError strips paths before it reaches disk.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Neither error.message nor the component stack is sent. The message is
    // prose written by whatever threw; the component stack reads like a safe
    // list of component names but is built from displayName, which several
    // components set from data (a case title, a capture name). The code plus
    // the boundary identifies the failure well enough to find it.
    void window.birdbrain.diagnostics
      .log({
        level: 'error',
        code: 'react.render_error',
        context: { boundary: this.props.source },
        error: error.name
      })
      .catch(() => {
        /* best effort */
      })
    // The full detail still reaches a developer running with devtools open,
    // where it never touches disk.
    if (import.meta.env.DEV) console.error(error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children

    return (
      <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
        <AlertTriangle className="h-6 w-6 text-amber-500" />
        <p className="text-sm font-medium text-text-primary">Something went wrong</p>
        <p className="max-w-sm text-sm text-text-muted">
          This part of Birdbrain failed to render. Your captures are unaffected.
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => this.setState({ failed: false })}>
            Try again
          </Button>
          <Button size="sm" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      </div>
    )
  }
}
```

- [ ] **Step 4: Mount it**

In `__root.tsx`, wrap the main content area with `<ErrorBoundary source="root">`. Then wrap the capture viewer's rendered output with `<ErrorBoundary source="captureViewer">` — it renders untrusted captured HTML, so it is the most likely component to throw, and a failure there must not take down the workspace.

- [ ] **Step 5: Verify and commit**

Run: `pnpm test -- ErrorBoundary && pnpm lint && pnpm build`
Expected: PASS. Report actual output.

```bash
git add src/renderer/components/ErrorBoundary.tsx src/renderer/routes/__root.tsx src/renderer/components/captures tests/components/ErrorBoundary.test.tsx
git commit -m "feat(notify): react error boundaries at root and capture viewer"
```

---

### Task 12b: Surface main-process failures in the renderer

Without this, "global notification layer" is false for the entire main process. `logger.error` already emits `event:logEntry`, but Task 8's `LogTab` is the only consumer and it is unmounted unless the user is sitting in Settings → Diagnostics. Capture-server, storage, export and update failures would stay invisible.

**Files:**
- Modify: `src/renderer/routes/__root.tsx`
- Test: `tests/renderer/lib/mainLogBridge.test.ts`
- Create: `src/renderer/lib/mainLogBridge.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest'

const toastFns = { error: vi.fn(), warning: vi.fn(), success: vi.fn(), info: vi.fn() }
vi.mock('sonner', () => ({ toast: toastFns }))

let listener: ((e: unknown) => void) | null = null

beforeEach(() => {
  vi.clearAllMocks()
  listener = null
  vi.stubGlobal('birdbrain', {
    onLogEntry: (cb: (e: unknown) => void) => {
      listener = cb
      return () => {}
    },
    diagnostics: { log: vi.fn() }
  })
})

function entry(level: string) {
  return { id: 'a1', sessionId: 's1', timestamp: '', level, source: 'captureServer', code: 'capture.failed' }
}

describe('mainLogBridge', () => {
  it('toasts main-process errors', async () => {
    const { subscribeToMainLog } = await import('@renderer/lib/mainLogBridge')
    subscribeToMainLog()
    listener?.(entry('error'))
    expect(toastFns.error).toHaveBeenCalled()
  })

  it('does not re-log a main entry back to main', async () => {
    const { subscribeToMainLog } = await import('@renderer/lib/mainLogBridge')
    subscribeToMainLog()
    listener?.(entry('error'))
    // The entry is already on disk — logging it again would loop.
    expect(window.birdbrain.diagnostics.log).not.toHaveBeenCalled()
  })

  it('ignores info entries', async () => {
    const { subscribeToMainLog } = await import('@renderer/lib/mainLogBridge')
    subscribeToMainLog()
    listener?.(entry('info'))
    expect(toastFns.info).not.toHaveBeenCalled()
  })

  it('ignores renderer-originated entries so they do not toast twice', async () => {
    const { subscribeToMainLog } = await import('@renderer/lib/mainLogBridge')
    subscribeToMainLog()
    // notify.error already toasted this one before sending it to main; main
    // wrote it and echoed it straight back out.
    listener?.({ ...entry('error'), source: 'renderer:mutation' })
    expect(toastFns.error).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- mainLogBridge`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
import { toast } from 'sonner'
import type { LogEntry } from '@shared/types'

// Main already wrote these to disk, so this path toasts ONLY — routing them
// back through notify.error would write a duplicate entry and, because that
// write emits again, risk a feedback loop.
//
// The 'renderer:' prefix filter is load-bearing. A renderer notify.error()
// travels to main over diagnostics:log, gets written, and is emitted straight
// back out over event:logEntry. Without this guard every renderer failure
// raises two toasts with different ids, so dedup cannot collapse them.
export function subscribeToMainLog(): () => void {
  return window.birdbrain.onLogEntry((entry: LogEntry) => {
    if (entry.source === 'renderer') return
    if (entry.level !== 'error' && entry.level !== 'warn') return

    // entry.id IS the correlation id, so main-process failures get the same
    // per-error Report this trigger as renderer ones. Without this, capture
    // server / storage / export failures could not use it at all.
    const opts = {
      id: entry.id,
      action: {
        label: 'Report this',
        onClick: () =>
          window.dispatchEvent(
            new CustomEvent('birdbrain:report', { detail: { correlationId: entry.id } })
          )
      }
    }

    // Codes are not prose — labelForCode maps them to a readable sentence for
    // display only. The durable entry keeps the code.
    const text = labelForCode(entry.code)
    if (entry.level === 'error') toast.error(text, opts)
    else toast.warning(text, opts)
  })
}
```

- [ ] **Step 4: Mount in `__root.tsx`**

```typescript
  useEffect(() => subscribeToMainLog(), [])
```

- [ ] **Step 5: Verify and commit**

Run: `pnpm test -- mainLogBridge && pnpm lint`
Expected: PASS. Report actual output.

```bash
git add src/renderer/lib/mainLogBridge.ts src/renderer/routes/__root.tsx tests/renderer/lib/mainLogBridge.test.ts
git commit -m "feat(notify): surface main-process failures as toasts"
```

---

**Phase 2 is complete. Failures are now both durable and visible.**

---

# Phase 3 — The Bundle

*Value on its own: a tester goes from "something broke" to a zip in your chat in one click.*

---

### Task 13: `bugReport.ts` — the bundle builder

**Files:**
- Create: `src/main/services/bugReport.ts`
- Test: `tests/main/services/bugReport.test.ts`

**Interfaces:**
- Consumes: `createStoredZip` from `@main/services/zip`; `diagnosticsService` from `@main/services/diagnostics`; `readSessions` from `@main/services/sessionLog`; `getLogDir` from `@main/services/logger`; `getInstallationId`; `BugReportInput` from `@shared/types`.
- Produces: `buildBugReport(input, deps)` → `Buffer`; `BUG_REPORT_ENTRIES` (the exact allowed entry names).

- [ ] **Step 1: Write the failing test**

The negative assertion is the point of this task — it is what guarantees the zero-egress and no-secrets promise holds.

```typescript
import { describe, expect, it } from 'vitest'
import { buildBugReport, BUG_REPORT_ENTRIES } from '@main/services/bugReport'
import type { DiagnosticsSnapshot, SessionRecord } from '@shared/types'

const SNAPSHOT = {
  generatedAt: '2026-07-25T10:00:00.000Z',
  app: {
    version: '1.0.1',
    electron: '39.8.10',
    chrome: '140',
    node: '22',
    platform: 'win32',
    arch: 'x64',
    packaged: true,
    installFormat: 'nsis'
  },
  uptimeSeconds: 120,
  processes: [],
  eventLoop: { currentLagMs: 0, maxLagLastMinuteMs: 0, stalls: [] },
  storage: {
    storageRoot: 'C:\\Users\\tester\\Birdbrain\\captures',
    dbPath: 'C:\\Users\\tester\\Birdbrain\\birdbrain.db',
    dbSizeBytes: 1,
    walSizeBytes: 0
  },
  data: {
    schemaVersion: 12,
    latestSchemaVersion: 12,
    cases: 1,
    captures: 2,
    notes: 0,
    selectors: 0,
    extractedData: 0
  },
  // captureLifecycle passes the captured page URL as slowOp detail — the most
  // sensitive value in the app. This fixture exists to prove it gets scrubbed.
  slowOps: [
    { at: '2026-07-25T09:30:00.000Z', kind: 'data-extraction', detail: 'https://target.example/case-file?id=9', ms: 812 }
  ]
} satisfies DiagnosticsSnapshot

const SESSIONS: SessionRecord[] = [
  {
    sessionId: 's1',
    startedAt: '2026-07-25T09:00:00.000Z',
    endedAt: null,
    version: '1.0.1',
    platform: 'win32',
    installFormat: 'nsis',
    cleanExit: false
  }
]

const deps = {
  snapshot: () => SNAPSHOT,
  sessions: () => SESSIONS,
  installationId: () => 'install-abc',
  readLog: (name: string) => (name === 'birdbrain.log' ? '{"level":"info"}\n' : null)
}

const INPUT = {
  whatYouDid: 'Captured a page',
  whatYouExpected: 'It saves',
  whatHappened: 'Nothing happened'
}

function entryNames(zip: Buffer): string[] {
  // Central-directory scan: entry names follow each 0x02014b50 signature.
  const names: string[] = []
  for (let i = 0; i < zip.length - 46; i++) {
    if (zip.readUInt32LE(i) === 0x02014b50) {
      const nameLen = zip.readUInt16LE(i + 28)
      names.push(zip.subarray(i + 46, i + 46 + nameLen).toString('utf8'))
    }
  }
  return names
}

describe('buildBugReport', () => {
  it('contains exactly the allowed entries', () => {
    const names = entryNames(buildBugReport(INPUT, deps))
    expect(names.sort()).toEqual([...BUG_REPORT_ENTRIES].filter((n) => n !== 'birdbrain.log.1').sort())
  })

  it('includes the tester description and diagnostics', () => {
    const zip = buildBugReport(INPUT, deps).toString('utf8')
    expect(zip).toContain('Captured a page')
    expect(zip).toContain('install-abc')
  })

  it('never includes a database, a capture, or a settings file', () => {
    const names = entryNames(buildBugReport(INPUT, deps))
    expect(names.some((n) => /\.(db|sqlite|mhtml|html|png)$/i.test(n))).toBe(false)
    expect(names.some((n) => /settings/i.test(n))).toBe(false)
  })

  it('never carries an api key through the diagnostics snapshot', () => {
    const zip = buildBugReport(INPUT, deps).toString('utf8')
    expect(zip.toLowerCase()).not.toContain('openrouterapikey')
    expect(zip).not.toContain('sk-or-')
  })

  // These four exist because an earlier draft asserted only the API-key case
  // and would have shipped every captured URL to the maintainer.
  it('never carries a captured url from slowOps into the bundle', () => {
    const zip = buildBugReport(INPUT, deps).toString('utf8')
    expect(zip).not.toContain('target.example')
    expect(zip).not.toContain('case-file')
  })

  it('never carries any url scheme into the bundle', () => {
    const zip = buildBugReport(INPUT, deps).toString('utf8')
    expect(zip).not.toMatch(/https?:\/\//)
  })

  it('never carries an absolute storage path or the operator username', () => {
    const zip = buildBugReport(INPUT, deps).toString('utf8')
    expect(zip).not.toContain('tester')
    expect(zip).not.toContain('C:\\Users')
  })

  it('keeps the structural fields that make the snapshot useful', () => {
    const zip = buildBugReport(INPUT, deps).toString('utf8')
    expect(zip).toContain('data-extraction')
    expect(zip).toContain('812')
    expect(zip).toContain('birdbrain.db')
  })

  it('omits the backup log when it does not exist', () => {
    const names = entryNames(buildBugReport(INPUT, deps))
    expect(names).not.toContain('birdbrain.log.1')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- bugReport`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { sanitizeText } from '@main/services/logSafe'
import { createStoredZip } from '@main/services/zip'
import { diagnosticsService } from '@main/services/diagnostics'
import { getLogDir } from '@main/services/logger'
import { readSessions } from '@main/services/sessionLog'
import { getInstallationId } from '@main/services/installationId'
import type { BugReportInput, DiagnosticsSnapshot, SessionRecord } from '@shared/types'

// Everything in the bundle is enumerated here. Nothing is globbed off disk, so
// a capture, the database, or a settings file cannot be swept in by accident —
// which is what makes the "what's included" disclosure in the dialog truthful.
export const BUG_REPORT_ENTRIES = [
  'report.md',
  'diagnostics.json',
  'sessions.json',
  'birdbrain.log',
  'birdbrain.log.1'
] as const

export interface BugReportDeps {
  snapshot: () => DiagnosticsSnapshot
  sessions: () => SessionRecord[]
  installationId: () => string
  readLog: (name: string) => string | null
}

function defaultDeps(): BugReportDeps {
  const dir = getLogDir()
  return {
    snapshot: () => diagnosticsService.snapshot(),
    sessions: () => readSessions(dir),
    installationId: () => getInstallationId(),
    readLog: (name) => {
      try {
        return readFileSync(join(dir, name), 'utf8')
      } catch {
        return null
      }
    }
  }
}

function reportMarkdown(input: BugReportInput, snap: DiagnosticsSnapshot, installId: string): string {
  return [
    '# Birdbrain bug report',
    '',
    `- **Version:** ${snap.app.version}`,
    `- **Platform:** ${snap.app.platform} ${snap.app.arch} (${snap.app.installFormat})`,
    `- **Electron:** ${snap.app.electron} · **Chrome:** ${snap.app.chrome}`,
    `- **Installation:** ${installId}`,
    `- **Generated:** ${snap.generatedAt}`,
    input.correlationId ? `- **Log entry:** ${input.correlationId}` : '',
    '',
    '## What I did',
    '',
    input.whatYouDid || '_not provided_',
    '',
    '## What I expected',
    '',
    input.whatYouExpected || '_not provided_',
    '',
    '## What happened',
    '',
    input.whatHappened || '_not provided_',
    ''
  ]
    .filter((line) => line !== '')
    .join('\n')
}

// node:path.basename is host-relative: on Linux CI it treats backslashes as
// ordinary characters, so basename('C:\\Users\\tester\\bb.db') returns the
// WHOLE string and the bundle ships the operator's username. A redaction
// helper must not depend on which OS is running it — split on both separators.
function fileName(p: string): string {
  const parts = p.split(/[\\/]/)
  return parts[parts.length - 1] || p
}

// DiagnosticsSnapshot is NOT safe to ship as-is. storageRoot and dbPath are
// absolute paths carrying the operator's username, and slowOps[].detail is
// populated by recordSlowOp('data-extraction', url, ...) in captureLifecycle —
// it is the captured page URL. Project, don't serialize.
export function redactSnapshot(snap: DiagnosticsSnapshot): DiagnosticsSnapshot {
  return {
    ...snap,
    storage: {
      ...snap.storage,
      storageRoot: snap.storage.storageRoot ? '‹path›' : '',
      dbPath: snap.storage.dbPath ? fileName(snap.storage.dbPath) : ''
    },
    slowOps: snap.slowOps.map((op) => ({ ...op, detail: sanitizeText(op.detail, homedir()) }))
  }
}

export function buildBugReport(input: BugReportInput, deps: BugReportDeps = defaultDeps()): Buffer {
  const snap = redactSnapshot(deps.snapshot())
  const entries: Array<{ name: string; data: string }> = [
    { name: 'report.md', data: reportMarkdown(input, snap, deps.installationId()) },
    { name: 'diagnostics.json', data: JSON.stringify(snap, null, 2) },
    { name: 'sessions.json', data: JSON.stringify(deps.sessions(), null, 2) }
  ]

  for (const name of ['birdbrain.log', 'birdbrain.log.1']) {
    const data = deps.readLog(name)
    if (data !== null) entries.push({ name, data })
  }

  return createStoredZip(entries)
}

export function bugReportFilename(now: Date): string {
  const stamp = now.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-')
  return `birdbrain-report-${stamp}.zip`
}
```

Note: `reportMarkdown` filters empty strings, which also collapses intentional blank lines. If the rendered markdown reads badly, use a sentinel for real blanks rather than dropping the filter — the `correlationId` line is the only conditional one.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm test -- bugReport`
Expected: PASS, including the four negative assertions.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/bugReport.ts tests/main/services/bugReport.test.ts
git commit -m "feat(diagnostics): bug report bundle builder with enumerated entries"
```

---

### Task 14: Wire the bundle through IPC

**Files:**
- Modify: `src/main/ipcHandlers.ts`
- Modify: `src/preload/index.ts`, `src/renderer/env.d.ts`

- [ ] **Step 1: Add the handler**

```typescript
  ipcMain.handle(IPC_CHANNELS.DIAGNOSTICS_CREATE_REPORT, async (_e, input: BugReportInput) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      title: 'Save diagnostic report',
      defaultPath: bugReportFilename(new Date()),
      filters: [{ name: 'Zip archive', extensions: ['zip'] }]
    })
    if (canceled || !filePath) return null

    flushSync()
    writeFileSync(filePath, buildBugReport(input))
    shell.showItemInFolder(filePath)
    return { path: filePath }
  })
```

`flushSync()` before building matters: without it, the entries describing the failure the tester is reporting may still be sitting in the write buffer. Import it from `@main/services/logger`.

Match the surrounding handlers' error-wrapping convention — check how neighbouring handlers in the file return `{ ok, data }` versus raw values, and follow it so `unwrapIpc` behaves consistently.

- [ ] **Step 2: Extend preload and `env.d.ts`**

```typescript
    createReport: (input: BugReportInput): Promise<BugReportResult | null> =>
      ipcRenderer.invoke(IPC_CHANNELS.DIAGNOSTICS_CREATE_REPORT, input),
```

Mirror the same signature in `env.d.ts` and add `BugReportInput`, `BugReportResult` to both type imports.

- [ ] **Step 3: Verify and commit**

Run: `pnpm lint && pnpm test && pnpm build`
Expected: PASS. Report actual output.

```bash
git add src/main/ipcHandlers.ts src/preload/index.ts src/renderer/env.d.ts
git commit -m "feat(diagnostics): create-report ipc handler and bridge"
```

---

### Task 15: Report dialog, crash prompt, and the three triggers

**Files:**
- Create: `src/renderer/components/diagnostics/ReportProblemDialog.tsx`
- Create: `src/renderer/components/diagnostics/CrashRecoveryPrompt.tsx`
- Modify: `src/renderer/routes/__root.tsx`, `src/renderer/components/settings/DiagnosticsPanel.tsx`, `src/renderer/components/layout/CommandPalette.tsx`
- Test: `tests/components/ReportProblemDialog.test.tsx`

**Interfaces:**
- Consumes: `window.birdbrain.diagnostics.createReport`, `.lastSession()`; the `birdbrain:report` window event dispatched by `notify` in Task 10.
- Produces: `<ReportProblemDialog open onOpenChange correlationId? />`, `<CrashRecoveryPrompt />`.

- [ ] **Step 1: Write the failing test**

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReportProblemDialog } from '@renderer/components/diagnostics/ReportProblemDialog'

const createReport = vi.fn().mockResolvedValue({ path: 'C:/x/report.zip' })

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('birdbrain', { diagnostics: { createReport } })
})

describe('ReportProblemDialog', () => {
  it('lists exactly what the bundle will contain', () => {
    render(<ReportProblemDialog open onOpenChange={() => {}} />)
    expect(screen.getByText(/diagnostics.json/)).toBeTruthy()
    expect(screen.getByText(/birdbrain.log/)).toBeTruthy()
    expect(screen.getByText(/never leaves your computer/i)).toBeTruthy()
  })

  it('sends the three fields when submitted', async () => {
    render(<ReportProblemDialog open onOpenChange={() => {}} />)
    fireEvent.change(screen.getByLabelText(/what did you do/i), { target: { value: 'captured' } })
    fireEvent.change(screen.getByLabelText(/what did you expect/i), { target: { value: 'saved' } })
    fireEvent.change(screen.getByLabelText(/what happened/i), { target: { value: 'nothing' } })
    fireEvent.click(screen.getByRole('button', { name: /create report/i }))

    await waitFor(() =>
      expect(createReport).toHaveBeenCalledWith(
        expect.objectContaining({ whatYouDid: 'captured', whatHappened: 'nothing' })
      )
    )
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm test -- ReportProblemDialog`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the dialog**

Build it on the existing `dialog`, `label`, `textarea` and `button` primitives in `src/renderer/components/ui`. Three labelled textareas (What did you do / What did you expect / What happened), a disclosure block listing the entries from `BUG_REPORT_ENTRIES` in prose, and the line "This file is saved to your computer and never leaves it — attach it to the chat yourself." Submit calls `window.birdbrain.diagnostics.createReport({ whatYouDid, whatYouExpected, whatHappened, correlationId })`, then closes on a non-null result.

The disclosure is not decoration: it is what makes the zero-egress promise legible to someone handling real case material.

- [ ] **Step 4: Implement the crash prompt**

`CrashRecoveryPrompt` calls `window.birdbrain.diagnostics.lastSession()` once on mount. If it resolves non-null, render a dismissible banner: "Birdbrain closed unexpectedly last time." with **Create a report** and **Dismiss**. Create opens `ReportProblemDialog`.

- [ ] **Step 5: Wire the three triggers**

1. **Post-crash** — render `<CrashRecoveryPrompt />` in `__root.tsx`.
2. **Always-available** — a "Report a problem" button in `DiagnosticsPanel`'s header, and a CommandPalette entry with the same label.
3. **Report this** — in `__root.tsx`, listen for the `birdbrain:report` window event that `notify` dispatches and open the dialog with the event's `correlationId`:

```typescript
  useEffect(() => {
    function onReport(e: Event): void {
      const detail = (e as CustomEvent<{ correlationId?: string }>).detail
      setReportCorrelationId(detail?.correlationId)
      setReportOpen(true)
    }
    window.addEventListener('birdbrain:report', onReport)
    return () => window.removeEventListener('birdbrain:report', onReport)
  }, [])
```

- [ ] **Step 6: Verify end to end**

Run: `pnpm test && pnpm lint && pnpm build`
Expected: PASS. Report actual output.

Then run `pnpm dev` and confirm by hand:
- Settings → Diagnostics → Report a problem produces a zip at the chosen path
- Unzipping it shows exactly `report.md`, `diagnostics.json`, `sessions.json`, `birdbrain.log`
- `report.md` contains the text you typed

Report what the zip actually contained. If any unexpected file appears, stop and fix `bugReport.ts` before committing.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/diagnostics src/renderer/routes/__root.tsx src/renderer/components/settings/DiagnosticsPanel.tsx src/renderer/components/layout/CommandPalette.tsx tests/components/ReportProblemDialog.test.tsx
git commit -m "feat(diagnostics): report dialog, crash prompt, and report triggers"
```

---

### Task 16: Update the tester guide

The rollout brief currently tells testers the app has no log. That is now false, and a tester who does not know the feature exists will not use it.

**Files:**
- Modify: `docs/reference/tester-guide.md`

- [ ] **Step 1: Add a "Reporting a problem" section**

Cover: Settings → Diagnostics → Report a problem; that the zip is saved locally and must be attached to chat manually; that it contains logs and app diagnostics but **no captures, no database, and no API keys**; and that the app will offer to create one automatically after a crash.

- [ ] **Step 2: Commit**

```bash
git add docs/reference/tester-guide.md
git commit -m "docs(tester-guide): how to file a diagnostic report"
```

---

## Self-Review

**Spec coverage:** Every spec section maps to a task. Section 1 (logger, redaction boundary, rotation, sessions, unclean exit) → Tasks 1, 3, 4. Section 2 (crash handlers, ErrorBoundary) → Tasks 5, 12. Section 3 (notify, dedup, MutationCache/QueryCache asymmetry, call-site migration) → Tasks 9, 10, 11, 7. Section 4 (bundle, exclusions, triggers, dialog, Log tab) → Tasks 8, 13, 14, 15. IPC table → Tasks 2, 6, 14. Testing section → covered in the task that owns each unit, with the redaction invariant in Task 1 and the negative bundle test in Task 13. Task 16 was added because the spec's premise invalidates a claim in the tester guide, which no spec section covered.

**Type consistency checked:** `LogEntry`, `LogLevel`, `LoggedError`, `SessionRecord`, `BugReportInput`, `BugReportResult` are defined once in Task 2 and used unchanged thereafter. `logger.error(source, message, context?, err?)` has the same signature in Tasks 4, 5, 6, 7. `notify.error(message, opts)` matches between Tasks 10 and 11. `getLogDir`/`getLogPath` are exported in Task 4 and consumed in Tasks 6 and 13. The `birdbrain:report` event dispatched in Task 10 is consumed in Task 15.

**Known deviation from the spec:** the spec's IPC table names the channel `diagnostics:createReport` with constant `DIAGNOSTICS_CREATE_REPORT`; the spec prose elsewhere writes `diagnostics:revealLog` as `LOG_FILE_REVEAL`-style naming inherited from the April doc. This plan uses `DIAGNOSTICS_*` constants throughout for consistency with the existing `DIAGNOSTICS_GET`.

**Two things the implementer must verify rather than assume:**
- The exact capture-viewer component filename in Task 12 (`ls src/renderer/components/captures`).
- Whether neighbouring IPC handlers return raw values or `{ ok, data }` envelopes (Task 14), since `unwrapIpc` treats them differently.
