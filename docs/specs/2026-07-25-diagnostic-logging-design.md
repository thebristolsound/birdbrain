# Diagnostic Logging & Tester Bug Reports — Design

**Date:** 2026-07-25
**Status:** Approved
**Scope:** Durable structural log, crash capture, global notification layer, local diagnostic bundle
**Supersedes:** `docs/specs/2026-04-12-logging-design.md` (approved, never implemented)

---

## Problem

Birdbrain ships to testers with no durable record of what the app did. Three gaps
compound each other:

1. **No log survives a restart.** 46 `console.*` calls across 26 files write to a
   devtools console that packaged testers never open. `docs/specs/2026-04-12-logging-design.md`
   approved a fix in April; it was never built, and the tester rollout brief records the
   consequence — reports "lean on repro steps and screenshots, not log attachments."
2. **No crash is captured.** There is no `uncaughtException`, `unhandledRejection`,
   `render-process-gone`, `child-process-gone`, or React error boundary anywhere in the
   codebase. A renderer crash is a white screen with zero forensic trace.
3. **No failure is visible.** [`queries.ts`](../../src/renderer/lib/queries.ts) defines 29
   mutations with zero `onError` handlers, and `queryClient` registers no `MutationCache`.
   Every mutation failure in the app today is completely silent — a tester whose note fails
   to save sees nothing at all.

What *does* exist is the environment half of a bug report: `Settings → Diagnostics`
([`DiagnosticsPanel.tsx`](../../src/renderer/components/settings/DiagnosticsPanel.tsx))
serves a live `DiagnosticsSnapshot` — versions, install format, per-process CPU/memory,
event-loop lag and stall log, storage paths and sizes, schema version and row counts,
slow-op ring buffer — behind a Copy report button.

The missing half is the **timeline**: what happened leading up to the failure.

---

## Goals

1. A durable, structural-only log on disk that survives restarts and crashes
2. Capture of every failure class: main crashes, renderer crashes, React errors, capture
   pipeline failures, and IPC/DB/storage/export/update errors
3. A global notification layer so no failure is silent
4. A one-click local bundle a tester can drag into the feedback channel
5. Zero network egress — nothing leaves the machine without the tester moving the file

---

## Non-goals

- Remote error reporting, telemetry, or crash upload of any kind
- Logging investigation content: URLs, page titles, case names, or absolute paths
- Log search, or log level configuration in the Settings UI
- Attaching captures, the database, or screenshots to a bundle

---

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Handoff | Local zip, tester attaches to chat | Matches the existing chat feedback loop; zero egress; no infra |
| Redaction | Structural-only, enforced at the logger boundary | A forensics tool must not spill case data into a file that gets shared |
| Toast renderer | `sonner` (MIT) | Only candidate with a module-scope imperative `toast()`, required by `MutationCache.onError` |
| Architecture | Unified event spine, main-process logger as single sink | Log and notify become one decision at one boundary |
| Delivery | Three phases, each independently shippable | Full coverage is four subsystems; phasing keeps PRs reviewable |

**Toast library survey.** `sonner` 2.0.7, `react-hot-toast` 2.6.0, Radix `Toast` (already
present via `radix-ui` ^1.6.1) and `@base-ui-components/react` are all MIT and all
license-compatible with this MIT project, so license did not decide it. `sonner` wins on
fit: `MutationCache.onError` is a module-scope singleton outside React, and `sonner`'s
`toast()` is callable there directly. Radix `Toast` is a primitive requiring a hand-built
external store to be driven imperatively; Base UI is at `1.0.0-rc.0` and too green to ship
to testers.

---

## Architecture

```
main                                       renderer
──────────────────────────────             ────────────────────────────────
uncaughtException        ─┐
unhandledRejection       ─┤
render-process-gone      ─┼─▶ logger.ts ──JSONL──▶ userData/logs/birdbrain.log
child-process-gone       ─┤   (single sink)
service call sites       ─┘        │
                                   │ IPC 'event:logEntry'
                                   ▼
                             notify.ts ──▶ sonner <Toaster/>
                                   ▲
         MutationCache.onError ────┤
         ErrorBoundary ────────────┤
         explicit notify.* calls ──┘
```

**Log and notify are two independent switches on one boundary.**

- **Log** — durable, structural-only, on disk, for diagnosis
- **Notify** — ephemeral, human prose, for awareness

Errors do both. Success toasts never touch disk. Info logs never toast. Because both
follow from a single call, neither can be forgotten at a call site.

---

## Section 1: `logger.ts` and the redaction boundary

**File:** `src/main/services/logger.ts`

```typescript
logger.error(source: string, message: string, context?: LogContext): string
logger.warn(source: string, message: string, context?: LogContext): string
logger.info(source: string, message: string, context?: LogContext): string
logger.setMainWindow(win: BrowserWindow): void
```

Each call returns a **correlation id** (short opaque string) so a toast can reference the
exact entry a tester is reporting.

### The redaction boundary

"Structural-only" must be enforced, not documented, or the next contributor logs a URL.
`context` accepts only values that cannot carry investigation data:

```typescript
export type LogValue = number | boolean | null | LogSafe
export type LogContext = Record<string, LogValue>

// LogSafe is a branded type producible ONLY by these constructors:
export function ident(v: string): LogSafe   // opaque id — /^[A-Za-z0-9_-]{1,64}$/
export function code(v: string): LogSafe    // error code — /^[A-Z][A-Z0-9_]{0,47}$/
export function tag(v: string, allowed: readonly string[]): LogSafe  // enum literal
```

Usage:

```typescript
logger.error('captureServer', 'capture failed', {
  captureId: ident(id),
  format: tag(fmt, CAPTURE_FORMATS),
  bytes: 91_233,
  code: code('EPIPE')
})
```

Passing a raw `string` as **context** is a compile error. The runtime validators are a
second net: a value failing its pattern throws in development and is replaced with
`'[invalid]'` in production, so a bad call can never both pass silently and write
unvalidated text.

### No free-form prose reaches disk

An earlier revision of this spec tried to seal `message` by running a regex scrubber over
it. **That approach was abandoned after it failed five times.** The record is worth keeping,
because it is the argument for what replaced it: successive audits found leaks via Windows
intermediate path segments, UNC paths, Windows terminal segments, POSIX paths, and
home-rooted paths with a spaced subdirectory. Each fix was correct and each round found
another shape.

Two further findings showed the approach could not converge at all:

- **A case name as prose has no shape to match.** `Error: failed to parse Operation
  Blackbird` contains no path and no URL. A scrubber cannot distinguish it from ordinary
  text, and `Error.name` is a writable field.
- **Branded values do not constrain keys.** `Record<string, LogValue>` accepts
  `{ [capturedUrl]: true }`, which compiles and serialises verbatim.

Scrubbing is a filter against an open-ended set of bypasses. The guarantee this design
promises requires an allowlist, so:

**The durable log carries no free-form text at all.** An entry's `code` is a member of a
fixed `LOG_CODES` union, its `source` a member of a fixed `LOG_SOURCES` union, and its
context keys are drawn from a fixed `LOG_CONTEXT_KEYS` union with branded values. There is
no field a call site can write arbitrary text into, so no regex has to be correct for the
invariant to hold.

Human prose still exists — it just never reaches disk. `notify` renders a readable sentence
in the toast, and `LogTab` maps codes to labels for display. Both are ephemeral.

For errors, only `err.name` validated against a known set and `err.code` matching the
`code()` pattern are retained. `err.message` is **dropped**. Stack traces are kept but
reduced to app-relative frames, which name Birdbrain's own source files rather than
anything case-derived — `sanitizeText` survives for exactly this one narrow job.

The cost is real and accepted: a log line reads `capture.screenshot_dropped
{captureId, bytes}` rather than a sentence, and a library error's prose is lost. What is
bought is that the promise made to a tester handing over a bundle is true by construction.

### Error sanitization

Node error messages embed paths — `ENOENT: no such file or directory, open
'C:\Users\matt\...\case-x\capture.mhtml'` — so errors cannot pass through unchanged.
`sanitizeError(err)` is the single exception to the branded-type rule and the only
regex-based scrubbing in the system:

- `err.name`, `err.code` — taken verbatim, safe by construction
- `err.message` — path-like and URL-like substrings replaced with `‹path›` / `‹url›`
- `err.stack` — home directory stripped, frames rewritten relative to app root, capped at
  20 frames

It lives in one function with dedicated tests rather than as a scrub pass over everything.

### File, rotation, sessions

- **Path:** `userData/logs/birdbrain.log`, JSON-lines
- **Rotation:** at 2MB, rename to `birdbrain.log.1` (overwriting any previous backup).
  Total footprint ~4MB.
- **Sessions:** each launch writes a `session.start` entry carrying a fresh session UUID,
  `getInstallationId()`, app version, platform and install format. Every subsequent entry
  carries the session id, so bundle entries correlate to a run.
- **Writes:** buffered normally; **synchronous** on crash paths, since `uncaughtException`
  will not survive an async flush.

### Unclean-exit detection

On startup the logger writes `userData/logs/session.lock` containing the session id, version
and start time. The existing `before-quit` handler
([`index.ts:269`](../../src/main/index.ts)) deletes it. If the file is present at the next
launch, the previous session died uncleanly.

This is the only mechanism that catches OOM kills and power loss, which no JS handler can
observe, and it drives the post-crash recovery prompt in Section 4.

---

## Section 2: Crash capture

| Hook | Response |
|---|---|
| `process.on('uncaughtException')` | Sync write, error dialog, quit — main-process state is unsound and continuing is worse than exiting |
| `process.on('unhandledRejection')` | Sync write, stay alive |
| `app.on('render-process-gone')` | Log `details.reason` (`crashed` / `oom` / `killed` / `launch-failed`), offer reload |
| `app.on('child-process-gone')` | Log GPU and utility process death with `type` and `reason` |

Registered in `src/main/index.ts` before `app.whenReady()`, so a failure during startup is
still captured.

### React error boundary

`src/renderer/components/ErrorBoundary.tsx`, mounted at root in `__root.tsx`. Replaces the
white screen with a recovery panel offering **Reload** and **Report a problem**, and logs a
sanitized component stack via the renderer→main log channel.

A second boundary wraps the capture viewer. It renders untrusted captured HTML, making it
the most likely component to throw, and a contained failure there should not take down the
workspace.

---

## Section 3: Notification layer

**File:** `src/renderer/lib/notify.ts`

```typescript
notify.error(message: string, opts?: NotifyOpts): void   // toast + durable log
notify.warn(message: string, opts?: NotifyOpts): void    // toast + durable log
notify.success(message: string): void                    // toast only
notify.info(message: string): void                       // toast only
```

`error` and `warn` forward to the main-process logger over `diagnostics:log`, then raise a
toast carrying a **Report this** action seeded with the returned correlation id.

**Dedup is mandatory, not polish.** A retry loop or a failing capture batch would otherwise
fire dozens of toasts and bury the app. The sonner `id` is set to a hash of
`source + message`, so a storm collapses into a single toast with a repeat count.

`<Toaster />` mounts in `__root.tsx`, themed with the existing semantic tokens (`bg-surface`,
`text-text-primary`, `border-border`) so it tracks light/dark automatically.

### Wiring the 29 mutations

```typescript
export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 30_000, refetchOnWindowFocus: false } },
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => notify.error(failureMessage(mutation), { cause: error })
  }),
  queryCache: new QueryCache({
    onError: (error, query) => reportQueryError(query, error)   // log only, no toast
  })
})
```

`failureMessage` reads `mutation.options.meta.action` — `meta: { action: 'save note' }`
renders "Couldn't save note." Adding `meta` to the 29 mutation hooks is additive, and a
generic fallback means the wiring works on day one and sharpens incrementally rather than
blocking on 29 edits.

**Queries log but do not toast.** With `retry: false` and services that are not ready at
launch, toasting query errors would greet every tester with a wall of toasts on startup.
Mutations are user-initiated, so a silent failure is always worth surfacing.

### Call-site migration

The 46 `console.*` calls are replaced with `logger.*` (main) or `notify.*` (renderer,
where user-facing), tagged by source:

| File | Source tag |
|---|---|
| `src/main/services/captureServer.ts` | `'captureServer'` |
| `src/main/services/captureLifecycle.ts` | `'captureLifecycle'` |
| `src/main/services/backgroundRenderer.ts` | `'renderer'` |
| `src/main/services/ai/openrouter.ts` | `'openrouter'` |
| `src/main/services/serverToken.ts` | `'serverToken'` |
| `src/main/services/settings.ts`, `thumbnails.ts` | `'settings'`, `'thumbnails'` |
| `src/main/services/selectorLifecycle.ts`, `consentBlocker.ts`, `timestampWorker.ts` | matching name |
| `src/main/ipcHandlers.ts` | `'ipc'` |
| `src/main/index.ts` | `'app'` |

---

## Section 4: The bundle and its triggers

**File:** `src/main/services/bugReport.ts`

Builds `birdbrain-report-YYYYMMDD-HHMM.zip` with the existing
[`createStoredZip()`](../../src/main/services/zip.ts):

| Entry | Contents |
|---|---|
| `report.md` | Tester's what-you-did / expected / happened, plus version, OS, install format, session id, installation id |
| `diagnostics.json` | `DiagnosticsSnapshot`, verbatim |
| `birdbrain.log`, `birdbrain.log.1` | The durable record |
| `sessions.json` | Recent sessions with clean/unclean exit flags |

**Excluded by construction: capture files, the database, screenshots, and all settings
values.** Settings hold `openRouterApiKey`, which must never be in reach of the bundler.

**`DiagnosticsSnapshot` must be redacted before it enters the bundle — it is not clean.**
An earlier draft of this spec claimed otherwise; that claim was false, and the audit that
caught it is the reason this section exists. Two fields carry investigation data today:

- `storage.storageRoot` and `storage.dbPath` are absolute paths, so they contain the
  operator's username and possibly a case-derived directory name.
- `slowOps[].detail` is populated by `recordSlowOp('data-extraction', url, …)` in
  [`captureLifecycle.ts`](../../src/main/services/captureLifecycle.ts) — **it is the
  captured page URL**, the single most sensitive value in the app.

The bundler therefore builds a `redactSnapshot()` projection rather than serialising the
live object: path fields are reduced to their basename plus a size, and every `slowOps`
entry has `detail` replaced by `sanitizeText(detail)`. The negative test asserts the
absence of URL schemes and home-directory fragments, not merely the absence of API keys —
checking only for secrets is what let the original claim survive review.

Screenshots are excluded deliberately. The tester is dragging the zip into a chat client
where they can drop a screenshot in the same message; a file picker inside the dialog adds
real scope for near-zero gain.

### Triggers

All three land in the same dialog:

1. **Post-crash prompt.** On launch, if `session.lock` was present, a dismissible prompt
   offers to create a report. This catches the tester who was mid-task and would never have
   filed anything.
2. **Always-available action.** "Report a problem" in `Settings → Diagnostics`, plus a
   CommandPalette entry.
3. **Report this.** On every error and warning toast, pre-seeded with that entry's
   correlation id.

### Report dialog

`src/renderer/components/diagnostics/ReportProblemDialog.tsx` — three fields mirroring the
format already pinned in the tester channel (what you did / what you expected / what
happened), and a **"what's included"** disclosure listing the exact entries. That disclosure
is what makes the zero-egress promise legible to someone handling real case data.

Submit → `dialog.showSaveDialog` → write zip → `shell.showItemInFolder`.

### Log tab

`DiagnosticsPanel` gains a **Log** tab: level filter chips (Error / Warn / Info), rows
showing level icon, source badge, message and timestamp, scrollable, plus a **Reveal log
file** button.

This deviates from the 2026-04-12 spec, which placed the log viewer in the `CaptureHealth`
popover. That spec predates `DiagnosticsPanel`, which now owns app-level state and already
has a Copy report button. `CaptureHealth` stays focused on capture activity.

---

## IPC

| Channel | Direction | Purpose |
|---|---|---|
| `event:logEntry` | main → renderer | Stream entries for the Log tab |
| `diagnostics:log` | renderer → main | Renderer errors into the durable log; returns correlation id |
| `diagnostics:revealLog` | renderer → main | `shell.showItemInFolder(logPath)` |
| `diagnostics:createReport` | renderer → main | Build the zip, return the written path |
| `diagnostics:lastSession` | renderer → main | Unclean-exit info for the post-crash prompt |

`DIAGNOSTICS_GET` is unchanged.

---

## Phasing

Dependency-ordered; each phase is independently shippable.

**Phase 1 — the durable record.** `logger.ts`, branded redaction, `sanitizeError`, rotation,
session tracking, unclean-exit detection, the four crash handlers, main-process `console.*`
migration, Log tab, Reveal log file.
*Value alone:* a tester can hit Reveal and send the file.

**Phase 2 — visibility.** `sonner`, `notify.ts`, `MutationCache` / `QueryCache` wiring,
`ErrorBoundary`, dedup, renderer→main log channel.
*Value alone:* silent failures stop being silent.

**Phase 3 — the bundle.** `bugReport.ts`, `ReportProblemDialog`, the three triggers.

---

## Testing

The two that protect the design:

- **The redaction invariant.** Raw strings rejected at compile time (a `@ts-expect-error`
  test pins this); `ident` / `code` / `tag` validators tested directly against hostile input;
  `sanitizeError` proven to strip home directories, absolute paths and URLs from both
  messages and stacks.
- **A negative bundle test** asserting the zip contains *exactly* the expected entries and
  no capture file, no database, and no `openRouterApiKey` value anywhere in its bytes. Same
  shape as the existing `test(export): assert the report never cites a file the package lacks`.

Also:

- Rotation triggers at threshold and preserves exactly one backup
- Unclean-exit detection in both directions (lock present → crash reported; clean quit → not)
- `notify` dedup collapses a storm into one toast with a count
- Crash handlers write synchronously before exit
- E2E: force a mutation failure, assert both the toast and the log line

---

## New / Modified Files

| File | Change |
|---|---|
| `src/main/services/logger.ts` | **New** — sink, branded context, rotation, sessions |
| `src/main/services/logSafe.ts` | **New** — `ident` / `code` / `tag` / `sanitizeError` |
| `src/main/services/bugReport.ts` | **New** — bundle builder |
| `src/renderer/lib/notify.ts` | **New** — toast + log boundary |
| `src/renderer/components/ErrorBoundary.tsx` | **New** |
| `src/renderer/components/diagnostics/ReportProblemDialog.tsx` | **New** |
| `src/main/index.ts` | Crash handlers, `logger.setMainWindow`, clean-exit marker |
| `src/main/ipcHandlers.ts` | Four new handlers |
| `src/shared/types.ts` | `LogEntry`, `LogLevel`, `SessionRecord`, `BugReportInput` |
| `src/shared/ipc.ts` | Five new channels |
| `src/preload/index.ts`, `src/renderer/env.d.ts` | Bridge methods and types |
| `src/renderer/lib/queryClient.ts` | `MutationCache` + `QueryCache` error handlers |
| `src/renderer/lib/queries.ts` | Additive `meta.action` on 29 mutations |
| `src/renderer/routes/__root.tsx` | `<Toaster />`, `<ErrorBoundary>`, post-crash prompt |
| `src/renderer/components/settings/DiagnosticsPanel.tsx` | Log tab, Reveal, Report a problem |
| `src/renderer/components/layout/CommandPalette.tsx` | Report a problem entry |
| 10 further main-process service files | `console.*` → `logger.*` (12 files carry `console.*` today, incl. `index.ts` and `ipcHandlers.ts` listed above) |
| `package.json` | Add `sonner` |

---

## Risks

- **Sanitizer leakage.** Regex scrubbing of error messages is the weakest link; a novel
  message format could carry a path through. Mitigated by confining it to one tested
  function and by the branded types covering every other field.
- **Log volume.** Info-level logging on a busy capture session could rotate the file before
  a tester reports. Mitigated by 2MB × 2 files and by the session id making truncation
  visible rather than silent.
- **Toast fatigue.** Wiring 29 mutations at once may surface pre-existing failures nobody
  knew about. That is the point, but expect a noisy first beta.
