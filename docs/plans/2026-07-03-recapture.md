# Recapture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Background capture of URLs (recapture of an existing capture, or pasted URLs) via a hidden Electron BrowserWindow, producing a full MHTML capture + whole-page screenshot through the existing forensic pipeline.

**Architecture:** A new main-process `recapture` service owns a serial in-memory queue. Each job renders the URL in a locked-down hidden `BrowserWindow` (injectable `renderPage` seam), then feeds the result into the existing `captureLifecycle.ingest` — hashing, manifest chain, TSA stamping, TLS corroboration all unchanged. New provenance fields (`method`, `supersedesCaptureId`) flow through DB migration v23 and the manifest entry with the established omit-when-absent grandfathering convention. UI adds a Recapture action, an Add-URLs box, and supersedes link chips; progress rides the existing capture-activity events.

**Tech Stack:** Electron (hidden BrowserWindow + CDP via `webContents.debugger`), better-sqlite3, Hono (untouched), React 19 + TanStack Query, Vitest (Electron runtime), Playwright E2E.

**Spec:** `docs/specs/2026-07-03-recapture-design.md` (committed on master).

## Global Constraints

- Code style: no semicolons, single quotes, no trailing commas, 100 char width, 2-space indent, TS strict.
- No new dependencies. No `any` without an eslint-disable + reason.
- Path aliases: `@main/*`, `@shared/*`, `@renderer/*`.
- DB schema is at `user_version` 22 → this feature adds migration **23**.
- Manifest grandfathering: new optional entry fields are OMITTED from the canonical body when absent (same as `headers`/`tls`), so existing chain hashes never change.
- Recapture queue: in-memory, **concurrency 1**, not persisted across restarts.
- Per-job hard timeout: **45_000 ms**. Existing `MAX_MHTML_SIZE` cap applies via `streamWriteAndHash`.
- Background windows: `show: false`, `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, no preload, unique in-memory partition (no `persist:` prefix), all permission requests denied, window-open denied, destroyed after every job.
- Unit tests: `pnpm test` (vitest via Electron runtime). Run a single file: `pnpm test tests/main/services/<file>.test.ts`.
- Commit format: `<type>(<scope>): <subject>`. Never `git add .` — stage files explicitly. No Co-authored-by lines.
- UI: semantic theme tokens (`bg-canvas`, `text-text-primary`, `border-border`), match surrounding component style.

---

### Task 1: Shared types + DB migration v23

**Files:**
- Modify: `src/shared/types.ts` (Capture, CaptureSource, CaptureEvent)
- Modify: `src/main/services/database.ts` (migration, InsertCaptureParams, insertCapture, rowToCapture)
- Test: `tests/main/services/recaptureSchema.test.ts` (create)

**Interfaces:**
- Consumes: existing `Capture`, `InsertCaptureParams`, migration ladder in `database.ts`.
- Produces: `CaptureMethod` type; `Capture.method: CaptureMethod`; `Capture.supersedesCaptureId?: string`; `InsertCaptureParams.method?: CaptureMethod`; `InsertCaptureParams.supersedesCaptureId?: string`; `CaptureSource` includes `'recapture'`; `CaptureEvent.warning?: string`. Later tasks rely on these exact names.

- [ ] **Step 1: Write the failing test**

Create `tests/main/services/recaptureSchema.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { initDatabase, closeDatabase, createCase, insertCapture, getCapture } from '@main/services/database'

describe('recapture schema (migration v23)', () => {
  let caseId: string

  beforeEach(() => {
    initDatabase(':memory:')
    caseId = createCase({ name: 'Recapture Schema' }).id
  })

  afterEach(() => {
    closeDatabase()
  })

  it('stores and reads method and supersedesCaptureId', () => {
    const original = insertCapture({
      caseId,
      url: 'https://example.com/a',
      title: 'A',
      hash: 'h1',
      timestamp: '2026-07-03T00:00:00.000Z'
    })
    const recap = insertCapture({
      caseId,
      url: 'https://example.com/a',
      title: 'A again',
      hash: 'h2',
      timestamp: '2026-07-03T01:00:00.000Z',
      method: 'background',
      supersedesCaptureId: original.id
    })
    const read = getCapture(recap.id)!
    expect(read.method).toBe('background')
    expect(read.supersedesCaptureId).toBe(original.id)
  })

  it('defaults method to extension and supersedesCaptureId to undefined', () => {
    const cap = insertCapture({
      caseId,
      url: 'https://example.com/b',
      title: 'B',
      hash: 'h3',
      timestamp: '2026-07-03T00:00:00.000Z'
    })
    const read = getCapture(cap.id)!
    expect(read.method).toBe('extension')
    expect(read.supersedesCaptureId).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/main/services/recaptureSchema.test.ts`
Expected: FAIL — TS error: `method` does not exist on `InsertCaptureParams` (and/or `read.method` undefined).

- [ ] **Step 3: Add the shared types**

In `src/shared/types.ts`:

Below `export type CaptureFormat = 'html' | 'mhtml'` add:

```ts
// How the capture was produced (#recapture). 'extension' = operator-witnessed
// via the Chrome extension; 'background' = silent hidden-window recapture.
export type CaptureMethod = 'extension' | 'background'
```

In `interface Capture`, after the `format: CaptureFormat` line add:

```ts
  method: CaptureMethod
  // Set when this capture was created by "Recapture" of an existing capture.
  // The original is never touched — linked sibling, both fully visible.
  supersedesCaptureId?: string
```

Change `CaptureSource`:

```ts
export type CaptureSource = 'auto' | 'manual' | 'selector' | 'recapture'
```

In `interface CaptureEvent`, after `screenshotWarning?: string` add:

```ts
  warning?: string
```

- [ ] **Step 4: Add migration v23 + DB plumbing**

In `src/main/services/database.ts`:

Import the type (extend the existing type-only import from `@shared/types` with `CaptureMethod`).

After the `if (version < 22) { ... }` block, before the closing `}` of `migrate`:

```ts
  if (version < 23) {
    db.transaction(() => {
      // Recapture provenance (#recapture): how the capture was produced, and
      // the linked-sibling pointer for "Recapture this capture" jobs.
      db.exec(`
        ALTER TABLE captures ADD COLUMN method TEXT NOT NULL DEFAULT 'extension';
        ALTER TABLE captures ADD COLUMN supersedes_capture_id TEXT;
      `)
      db.pragma('user_version = 23')
    })()
  }
```

In `InsertCaptureParams` add:

```ts
  method?: CaptureMethod
  supersedesCaptureId?: string
```

In `insertCapture`, extend the INSERT statement column list — change the last line of columns from `operator_id, operator_name` to `operator_id, operator_name, method, supersedes_capture_id`, add two `?` placeholders (26 → 28), and append to the `.run(...)` args after `params.operatorName ?? null`:

```ts
      params.method ?? 'extension',
      params.supersedesCaptureId ?? null
```

In `rowToCapture`, after the `format:` line add:

```ts
    method: ((row.method as string) || 'extension') as CaptureMethod,
    supersedesCaptureId: (row.supersedes_capture_id as string) || undefined,
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test tests/main/services/recaptureSchema.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 6: Full typecheck + test sweep, then commit**

Run: `pnpm lint && pnpm test`
Expected: clean lint; all suites pass (rowToCapture now populates `method` for every existing test's captures — default `'extension'` keeps them green).

```bash
git add src/shared/types.ts src/main/services/database.ts tests/main/services/recaptureSchema.test.ts
git commit -m "feat(db): add capture method + supersedes provenance (migration v23)"
```

---

### Task 2: Manifest entry fields with grandfathering

**Files:**
- Modify: `src/main/services/manifest.ts` (`CaptureEntryContext`, `withCaptureEntry`)
- Test: `tests/main/services/manifest.test.ts` (extend)

**Interfaces:**
- Consumes: `CaptureMethod` from `@shared/types` (Task 1).
- Produces: `CaptureEntryContext.method?: CaptureMethod` and `CaptureEntryContext.supersedesCaptureId?: string`, both spread-omitted from the canonical entry body when `undefined`. Task 3 passes them through.

- [ ] **Step 1: Write the failing tests**

In `tests/main/services/manifest.test.ts`, add to the existing suite (reuse that file's setup helpers for case dir + manifest init — follow the surrounding tests' arrange pattern exactly):

```ts
  it('omits method and supersedesCaptureId from the entry body when absent', async () => {
    // Arrange a case dir as the neighboring withCaptureEntry tests do, then:
    await withCaptureEntry(caseDir, baseCaptureCtx, () => undefined)
    const entries = readManifestEntries(caseDir) // same helper the file already uses
    const last = entries[entries.length - 1]
    expect('method' in last).toBe(false)
    expect('supersedesCaptureId' in last).toBe(false)
  })

  it('anchors method and supersedesCaptureId in the entry body when present', async () => {
    await withCaptureEntry(
      caseDir,
      { ...baseCaptureCtx, captureId: 'cap-2', method: 'background', supersedesCaptureId: 'cap-1' },
      () => undefined
    )
    const entries = readManifestEntries(caseDir)
    const last = entries[entries.length - 1]
    expect(last.method).toBe('background')
    expect(last.supersedesCaptureId).toBe('cap-1')
    expect(verifyManifestChain(caseDir).valid).toBe(true)
  })
```

(`baseCaptureCtx` / `readManifestEntries` stand for whatever arrange helpers the file already uses for `withCaptureEntry` tests — mirror the closest existing test verbatim; if it reads the manifest file with `readFileSync` + JSON parse per line, do the same.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/main/services/manifest.test.ts`
Expected: FAIL — TS error: `method` not in `CaptureEntryContext`.

- [ ] **Step 3: Implement**

In `src/main/services/manifest.ts`, add to `CaptureEntryContext` (after the `tls?` member, keeping the comment convention):

```ts
  // Recapture provenance (#recapture); omitted from the manifest body when
  // absent to preserve legacy canonical bodies.
  method?: CaptureMethod
  supersedesCaptureId?: string
```

(import `CaptureMethod` type from `@shared/types`.)

In `withCaptureEntry`'s entry object, after the `...(ctx.tls !== undefined ? { tls: ctx.tls } : {})` line:

```ts
      ...(ctx.method !== undefined ? { method: ctx.method } : {}),
      ...(ctx.supersedesCaptureId !== undefined
        ? { supersedesCaptureId: ctx.supersedesCaptureId }
        : {}),
```

If the manifest entry type that backs `withManifestEntry` is a closed interface (check the `type: 'capture'` entry type definition in the same file / `@shared/verify`), add the same two optional fields there.

- [ ] **Step 4: Run tests**

Run: `pnpm test tests/main/services/manifest.test.ts`
Expected: PASS, including all pre-existing chain-hash tests (proves grandfathering: absent fields change nothing).

- [ ] **Step 5: Commit**

```bash
git add src/main/services/manifest.ts tests/main/services/manifest.test.ts
git commit -m "feat(manifest): anchor capture method + supersedes link in entry body"
```

---

### Task 3: captureLifecycle plumbing

**Files:**
- Modify: `src/main/services/captureLifecycle.ts` (`IngestParams`, `ingestMhtmlCapture`)
- Test: `tests/main/services/captureLifecycle.test.ts` (extend)

**Interfaces:**
- Consumes: Task 1 types, Task 2 manifest fields.
- Produces: `IngestParams.method?: CaptureMethod`, `IngestParams.supersedesCaptureId?: string`, `IngestParams.extensionVersion?: string` (now optional). `ingestMhtmlCapture` records them on the manifest entry and DB row. Task 4 calls `captureLifecycle.ingest` with them.

- [ ] **Step 1: Write the failing test**

In `tests/main/services/captureLifecycle.test.ts` (uses `buildIngestParams` helper already in the file):

```ts
  it('records background method and supersedes link end-to-end', async () => {
    const original = await lifecycle.ingest(buildIngestParams(caseId, Buffer.from('original')))
    const params = buildIngestParams(caseId, Buffer.from('recaptured'), {
      method: 'background',
      supersedesCaptureId: original.capture.id,
      extensionVersion: undefined
    })
    const result = await lifecycle.ingest(params)
    expect(result.capture.method).toBe('background')
    expect(result.capture.supersedesCaptureId).toBe(original.capture.id)
    expect(result.capture.extensionVersion).toBeUndefined()
    expect(verifyManifestChain(join(getStorageRoot(), caseId)).valid).toBe(true)
  })
```

(`lifecycle` = the `createCaptureLifecycle(...)` instance the file's other tests use.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/main/services/captureLifecycle.test.ts`
Expected: FAIL — `result.capture.method` is `'extension'` (params silently ignored / TS error on unknown keys).

- [ ] **Step 3: Implement**

In `src/main/services/captureLifecycle.ts`:

`IngestParams` — change `extensionVersion: string` to `extensionVersion?: string` and add:

```ts
  method?: CaptureMethod
  supersedesCaptureId?: string
```

(import `CaptureMethod` from `@shared/types`.)

In `ingestMhtmlCapture`, inside the `withCaptureEntry` context object, after the `tls,` line:

```ts
        method: params.method,
        supersedesCaptureId: params.supersedesCaptureId,
```

(`withCaptureEntry` already omits `undefined` — Task 2.)

In the `db.insertCapture({...})` call, after `operatorName: params.operatorName`:

```ts
            method: params.method,
            supersedesCaptureId: params.supersedesCaptureId
```

- [ ] **Step 4: Run tests**

Run: `pnpm test tests/main/services/captureLifecycle.test.ts && pnpm test tests/main/services/captureServer.test.ts`
Expected: PASS. (`extensionVersion` becoming optional cannot break the server path — it always supplies a string.)

- [ ] **Step 5: Commit**

```bash
git add src/main/services/captureLifecycle.ts tests/main/services/captureLifecycle.test.ts
git commit -m "feat(capture): thread method + supersedes provenance through ingest"
```

---

### Task 4: Recapture queue service (core, DI'd renderer)

**Files:**
- Create: `src/main/services/recapture.ts`
- Test: `tests/main/services/recapture.test.ts` (create)

**Interfaces:**
- Consumes: `CaptureLifecycle` (Task 3), `CaptureEvent`/`Capture` from `@shared/types`, `getSettings` from `@main/services/settings`, `getInstallationId` from `@main/services/installationId`.
- Produces (Tasks 5–7 rely on these exact shapes):

```ts
export interface RenderedPage {
  mhtmlStream: AsyncIterable<Uint8Array>
  screenshot: Buffer
  text: string
  title: string
  finalUrl: string
  httpStatus: number
  userAgent: string
  browserVersion: string
  cleanup: () => Promise<void>
}
export type RenderPage = (url: string, opts: { timeoutMs: number }) => Promise<RenderedPage>
export interface RecaptureJob {
  url: string
  caseId: string
  supersedesCaptureId?: string
}
export interface RecaptureQueueStatus {
  pending: number
  activeUrl: string | null
}
export interface EnqueueResult {
  accepted: number
  rejected: Array<{ url: string; reason: string }>
}
export interface RecaptureService {
  enqueue: (jobs: RecaptureJob[]) => EnqueueResult
  status: () => RecaptureQueueStatus
  // resolves when the queue drains — used by tests only
  idle: () => Promise<void>
}
export function createRecaptureService(deps: RecaptureDeps): RecaptureService
export interface RecaptureDeps {
  renderPage: RenderPage
  captureLifecycle: CaptureLifecycle
  emitEvent: (event: CaptureEvent) => void
  emitNewCapture: (capture: Capture) => void
  timeoutMs?: number // default 45_000
}
export function looksLikeLoginWall(input: {
  requestedUrl: string
  finalUrl: string
  title: string
}): boolean
```

- [ ] **Step 1: Write the failing tests**

Create `tests/main/services/recapture.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { initStorage, ensureCaseDir } from '@main/services/storage'
import { initDatabase, closeDatabase, createCase, getCapture } from '@main/services/database'
import { initInstallationId, resetInstallationId } from '@main/services/installationId'
import { initSettings, updateSettings } from '@main/services/settings'
import { createCaptureLifecycle } from '@main/services/captureLifecycle'
import type { SelectorLifecycle } from '@main/services/selectorLifecycle'
import {
  createRecaptureService,
  looksLikeLoginWall,
  type RenderedPage,
  type RenderPage
} from '@main/services/recapture'
import type { CaptureEvent, Capture } from '@shared/types'

vi.mock('@main/services/tlsCertChain', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/services/tlsCertChain')>()
  return { ...actual, fetchCertChain: vi.fn(async () => null) }
})

function fakeRender(overrides: Partial<RenderedPage> = {}): RenderPage {
  return async (url) => ({
    mhtmlStream: (async function* () {
      yield Buffer.from(`mhtml-of-${url}`)
    })(),
    screenshot: Buffer.from('png-bytes'),
    text: 'page text',
    title: 'Page Title',
    finalUrl: url,
    httpStatus: 200,
    userAgent: 'HiddenWindow UA',
    browserVersion: 'Chrome/130',
    cleanup: async () => {},
    ...overrides
  })
}

describe('recapture service', () => {
  let tempDir: string
  let caseId: string
  let events: CaptureEvent[]
  let newCaptures: Capture[]
  const selectorLifecycle = {
    runActiveSelectorsForCapture: vi.fn()
  } as unknown as SelectorLifecycle

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-recapture-'))
    initStorage(join(tempDir, 'captures'))
    initDatabase(':memory:')
    initSettings(join(tempDir, 'settings.json'))
    resetInstallationId()
    initInstallationId(join(tempDir, 'installation.json'))
    updateSettings({ operatorName: 'Op' })
    caseId = createCase({ name: 'Recapture' }).id
    ensureCaseDir(caseId)
    events = []
    newCaptures = []
  })

  afterEach(() => {
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  function makeService(renderPage: RenderPage, timeoutMs = 45_000) {
    const captureLifecycle = createCaptureLifecycle({ selectorLifecycle })
    return createRecaptureService({
      renderPage,
      captureLifecycle,
      emitEvent: (e) => events.push(e),
      emitNewCapture: (c) => newCaptures.push(c),
      timeoutMs
    })
  }

  it('captures a URL end-to-end with background provenance', async () => {
    const svc = makeService(fakeRender())
    const res = svc.enqueue([{ url: 'https://example.com/page', caseId }])
    expect(res.accepted).toBe(1)
    await svc.idle()
    expect(newCaptures).toHaveLength(1)
    const cap = getCapture(newCaptures[0].id)!
    expect(cap.method).toBe('background')
    expect(cap.userAgent).toBe('HiddenWindow UA')
    expect(cap.extensionVersion).toBeUndefined()
    const stored = events.find((e) => e.type === 'stored')
    expect(stored?.source).toBe('recapture')
  })

  it('records the supersedes link', async () => {
    const svc = makeService(fakeRender())
    svc.enqueue([{ url: 'https://example.com/a', caseId }])
    await svc.idle()
    const originalId = newCaptures[0].id
    svc.enqueue([{ url: 'https://example.com/a', caseId, supersedesCaptureId: originalId }])
    await svc.idle()
    expect(getCapture(newCaptures[1].id)!.supersedesCaptureId).toBe(originalId)
  })

  it('runs jobs serially in FIFO order', async () => {
    const order: string[] = []
    const gate: Array<() => void> = []
    const render: RenderPage = async (url) => {
      order.push(`start:${url}`)
      await new Promise<void>((resolve) => gate.push(resolve))
      order.push(`end:${url}`)
      return fakeRender()(url, { timeoutMs: 0 })
    }
    const svc = makeService(render)
    svc.enqueue([
      { url: 'https://example.com/1', caseId },
      { url: 'https://example.com/2', caseId }
    ])
    // Only the first job may start until its render resolves.
    await vi.waitFor(() => expect(order).toContain('start:https://example.com/1'))
    expect(order).not.toContain('start:https://example.com/2')
    gate.shift()!()
    await vi.waitFor(() => expect(order).toContain('start:https://example.com/2'))
    gate.shift()!()
    await svc.idle()
    expect(newCaptures).toHaveLength(2)
  })

  it('rejects invalid URLs at enqueue with per-URL reasons', () => {
    const svc = makeService(fakeRender())
    const res = svc.enqueue([
      { url: 'not-a-url', caseId },
      { url: 'ftp://example.com/x', caseId },
      { url: 'https://example.com/ok', caseId }
    ])
    expect(res.accepted).toBe(1)
    expect(res.rejected).toHaveLength(2)
    expect(res.rejected[0].url).toBe('not-a-url')
  })

  it('emits a failed event (and no capture) when rendering throws', async () => {
    const render: RenderPage = async () => {
      throw new Error('net::ERR_NAME_NOT_RESOLVED')
    }
    const svc = makeService(render)
    svc.enqueue([{ url: 'https://nope.invalid/', caseId }])
    await svc.idle()
    expect(newCaptures).toHaveLength(0)
    const failed = events.find((e) => e.type === 'failed')
    expect(failed?.error).toContain('ERR_NAME_NOT_RESOLVED')
    expect(failed?.source).toBe('recapture')
  })

  it('fails a job that exceeds the timeout', async () => {
    const render: RenderPage = (url, { timeoutMs }) =>
      new Promise((_resolve, reject) => {
        // Contract: renderPage implementations honor timeoutMs themselves; the
        // service ALSO wraps with a race so a hung renderer cannot wedge the queue.
        void url
        void timeoutMs
      }) as Promise<RenderedPage>
    const svc = makeService(render, 50)
    svc.enqueue([{ url: 'https://slow.example.com/', caseId }])
    await svc.idle()
    const failed = events.find((e) => e.type === 'failed')
    expect(failed?.error).toMatch(/timed out/i)
  })

  it('stores login-wall pages but flags the stored event with a warning', async () => {
    const svc = makeService(
      fakeRender({ finalUrl: 'https://example.com/login?next=%2Fpage', title: 'Sign in' })
    )
    svc.enqueue([{ url: 'https://example.com/page', caseId }])
    await svc.idle()
    expect(newCaptures).toHaveLength(1)
    const stored = events.find((e) => e.type === 'stored')
    expect(stored?.warning).toMatch(/login/i)
  })
})

describe('looksLikeLoginWall', () => {
  it('flags login-ish titles', () => {
    expect(
      looksLikeLoginWall({
        requestedUrl: 'https://x.com/user',
        finalUrl: 'https://x.com/user',
        title: 'Log in to X'
      })
    ).toBe(true)
  })

  it('flags redirects to login paths', () => {
    expect(
      looksLikeLoginWall({
        requestedUrl: 'https://a.com/doc',
        finalUrl: 'https://a.com/accounts/signin?next=/doc',
        title: 'Welcome'
      })
    ).toBe(true)
  })

  it('flags off-hostname redirects', () => {
    expect(
      looksLikeLoginWall({
        requestedUrl: 'https://a.com/doc',
        finalUrl: 'https://sso.b.com/auth',
        title: 'Anything'
      })
    ).toBe(true)
  })

  it('passes normal pages', () => {
    expect(
      looksLikeLoginWall({
        requestedUrl: 'https://a.com/doc',
        finalUrl: 'https://a.com/doc',
        title: 'The Document'
      })
    ).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/main/services/recapture.test.ts`
Expected: FAIL — module `@main/services/recapture` not found.

- [ ] **Step 3: Implement `src/main/services/recapture.ts`**

```ts
import { app } from 'electron'
import * as db from '@main/services/database'
import type { CaptureLifecycle } from '@main/services/captureLifecycle'
import { getInstallationId } from '@main/services/installationId'
import { getSettings } from '@main/services/settings'
import type { Capture, CaptureEvent } from '@shared/types'

export interface RenderedPage {
  mhtmlStream: AsyncIterable<Uint8Array>
  screenshot: Buffer
  text: string
  title: string
  finalUrl: string
  httpStatus: number
  userAgent: string
  browserVersion: string
  // Releases renderer-owned resources (tmp file, window). Always called.
  cleanup: () => Promise<void>
}

export type RenderPage = (url: string, opts: { timeoutMs: number }) => Promise<RenderedPage>

export interface RecaptureJob {
  url: string
  caseId: string
  supersedesCaptureId?: string
}

export interface RecaptureQueueStatus {
  pending: number
  activeUrl: string | null
}

export interface EnqueueResult {
  accepted: number
  rejected: Array<{ url: string; reason: string }>
}

export interface RecaptureDeps {
  renderPage: RenderPage
  captureLifecycle: CaptureLifecycle
  emitEvent: (event: CaptureEvent) => void
  emitNewCapture: (capture: Capture) => void
  timeoutMs?: number
}

export interface RecaptureService {
  enqueue: (jobs: RecaptureJob[]) => EnqueueResult
  status: () => RecaptureQueueStatus
  idle: () => Promise<void>
}

const DEFAULT_TIMEOUT_MS = 45_000

const LOGIN_TITLE_RE = /\b(log ?in|sign ?in|sign ?up|authenticate|two-factor|verification)\b/i
const LOGIN_PATH_RE = /(^|\/)(login|signin|sign-in|auth|sso|accounts?\/(login|signin))([/?#]|$)/i

// Heuristic only — a clean-session recapture of a gated page usually lands on a
// login wall. The capture is still stored (what the clean session saw is still
// evidence); this only drives a warning on the completion event.
export function looksLikeLoginWall(input: {
  requestedUrl: string
  finalUrl: string
  title: string
}): boolean {
  if (LOGIN_TITLE_RE.test(input.title)) return true
  try {
    const requested = new URL(input.requestedUrl)
    const final = new URL(input.finalUrl)
    if (requested.hostname !== final.hostname) return true
    if (LOGIN_PATH_RE.test(final.pathname)) return true
  } catch {
    // Unparseable URL — no opinion.
  }
  return false
}

function validateUrl(raw: string): string | null {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'Only http/https URLs supported'
    return null
  } catch {
    return 'Invalid URL'
  }
}

function getToolVersion(): string {
  if (typeof app?.getVersion === 'function') return app.getVersion()
  return process.env.npm_package_version ?? '0.0.0'
}

export function createRecaptureService(deps: RecaptureDeps): RecaptureService {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const queue: RecaptureJob[] = []
  let activeUrl: string | null = null
  let draining: Promise<void> | null = null

  async function runJob(job: RecaptureJob): Promise<void> {
    const timestamp = new Date().toISOString()
    deps.emitEvent({ type: 'received', source: 'recapture', url: job.url, timestamp })

    let rendered: RenderedPage | undefined
    const started = Date.now()
    try {
      // The renderer honors timeoutMs itself; race defensively so a hung
      // implementation can never wedge the serial queue.
      rendered = await Promise.race([
        deps.renderPage(job.url, { timeoutMs }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Recapture timed out after ${timeoutMs}ms`)), timeoutMs)
        )
      ])

      const settings = getSettings()
      const result = await deps.captureLifecycle.ingest({
        caseId: job.caseId,
        url: rendered.finalUrl,
        title: rendered.title || job.url,
        timestamp,
        stream: rendered.mhtmlStream as unknown as ReadableStream<Uint8Array>,
        textContent: rendered.text,
        headers: {},
        browserVersion: rendered.browserVersion,
        userAgent: rendered.userAgent,
        httpStatus: rendered.httpStatus,
        operatorId: getInstallationId(),
        operatorName: settings.operatorName ?? '',
        toolVersion: getToolVersion(),
        screenshot: rendered.screenshot,
        method: 'background',
        supersedesCaptureId: job.supersedesCaptureId
      })

      const warning = looksLikeLoginWall({
        requestedUrl: job.url,
        finalUrl: rendered.finalUrl,
        title: rendered.title
      })
        ? 'Page looks like a login wall — the clean background session is not signed in'
        : undefined

      const capture = db.getCapture(result.capture.id) ?? result.capture
      deps.emitNewCapture(capture)
      deps.emitEvent({
        type: 'stored',
        captureId: capture.id,
        source: 'recapture',
        url: job.url,
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - started,
        warning
      })
    } catch (err) {
      deps.emitEvent({
        type: 'failed',
        source: 'recapture',
        url: job.url,
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - started,
        error: err instanceof Error ? err.message : String(err)
      })
    } finally {
      await rendered?.cleanup().catch(() => {})
    }
  }

  function drain(): void {
    if (draining) return
    draining = (async () => {
      while (queue.length > 0) {
        const job = queue.shift()!
        activeUrl = job.url
        await runJob(job)
        activeUrl = null
      }
    })().finally(() => {
      draining = null
    })
  }

  return {
    enqueue(jobs) {
      const rejected: Array<{ url: string; reason: string }> = []
      let accepted = 0
      for (const job of jobs) {
        const reason = validateUrl(job.url)
        if (reason) {
          rejected.push({ url: job.url, reason })
        } else {
          queue.push(job)
          accepted++
        }
      }
      if (accepted > 0) drain()
      return { accepted, rejected }
    },
    status() {
      return { pending: queue.length + (activeUrl ? 1 : 0), activeUrl }
    },
    async idle() {
      while (draining) await draining
    }
  }
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm test tests/main/services/recapture.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/services/recapture.ts tests/main/services/recapture.test.ts
git commit -m "feat(recapture): serial background-capture queue with injectable renderer"
```

---

### Task 5: Hidden-window renderer

**Files:**
- Create: `src/main/services/backgroundRenderer.ts`

**Interfaces:**
- Consumes: `RenderPage` / `RenderedPage` from Task 4.
- Produces: `export const renderPageInHiddenWindow: RenderPage`. Task 7 wires it into `createRecaptureService`.

No unit test — this file is a thin adapter over Electron APIs and is exercised by the Task 9 E2E. Keep ALL logic that can live in Task 4 out of this file.

- [ ] **Step 1: Implement `src/main/services/backgroundRenderer.ts`**

```ts
import { BrowserWindow, app } from 'electron'
import { createReadStream } from 'fs'
import { unlink } from 'fs/promises'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type { RenderPage, RenderedPage } from '@main/services/recapture'

const VIEWPORT = { width: 1280, height: 900 }
const SETTLE_MS = 1500

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Renders a URL in a locked-down, invisible BrowserWindow with a fresh
// in-memory session (no persist: prefix = nothing touches disk, nothing is
// shared with the app or previous jobs). A hostile page runs in our process,
// so: sandboxed, isolated, no preload, no node, every permission denied,
// popups denied, window destroyed in finally.
export const renderPageInHiddenWindow: RenderPage = async (url, { timeoutMs }) => {
  const win = new BrowserWindow({
    show: false,
    width: VIEWPORT.width,
    height: VIEWPORT.height,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      partition: `recapture-${randomUUID()}`,
      backgroundThrottling: false
    }
  })

  const tmpPath = join(app.getPath('temp'), `birdbrain-recapture-${randomUUID()}.mhtml`)
  let tmpWritten = false

  const deadline = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error(`Recapture timed out after ${timeoutMs}ms`)), timeoutMs)
  )

  async function render(): Promise<RenderedPage> {
    const wc = win.webContents
    wc.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
    wc.setWindowOpenHandler(() => ({ action: 'deny' }))
    wc.setAudioMuted(true)

    let httpStatus = 0
    wc.on('did-navigate', (_event, _navUrl, httpResponseCode) => {
      httpStatus = httpResponseCode
    })

    await wc.loadURL(url)
    await sleep(SETTLE_MS)

    // Scroll through the page to trigger lazy-loaded content, then back to top
    // so the screenshot starts at the origin.
    await wc.executeJavaScript(
      `(async () => {
        const step = window.innerHeight
        const max = Math.min(document.body?.scrollHeight ?? 0, step * 30)
        for (let y = 0; y < max; y += step) {
          window.scrollTo(0, y)
          await new Promise((r) => setTimeout(r, 150))
        }
        window.scrollTo(0, 0)
      })()`,
      true
    )
    await sleep(SETTLE_MS)

    // Whole-page screenshot via CDP — captureBeyondViewport avoids stitching.
    wc.debugger.attach('1.3')
    let screenshot: Buffer
    try {
      const { data } = (await wc.debugger.sendCommand('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: true
      })) as { data: string }
      screenshot = Buffer.from(data, 'base64')
    } finally {
      wc.debugger.detach()
    }

    await wc.savePage(tmpPath, 'MHTML')
    tmpWritten = true

    const text = (await wc.executeJavaScript(
      'document.body ? document.body.innerText : ""'
    )) as string

    return {
      mhtmlStream: createReadStream(tmpPath) as unknown as AsyncIterable<Uint8Array>,
      screenshot,
      text,
      title: wc.getTitle(),
      finalUrl: wc.getURL(),
      httpStatus,
      userAgent: wc.getUserAgent(),
      browserVersion: `Chrome/${process.versions.chrome}`,
      cleanup: async () => {
        if (!win.isDestroyed()) win.destroy()
        if (tmpWritten) await unlink(tmpPath).catch(() => {})
      }
    }
  }

  try {
    return await Promise.race([render(), deadline])
  } catch (err) {
    if (!win.isDestroyed()) win.destroy()
    if (tmpWritten) await unlink(tmpPath).catch(() => {})
    throw err
  }
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm lint && pnpm build`
Expected: clean. (No unit test; behavior verified in Task 9's E2E.)

- [ ] **Step 3: Commit**

```bash
git add src/main/services/backgroundRenderer.ts
git commit -m "feat(recapture): hidden BrowserWindow renderer with CDP full-page screenshot"
```

---

### Task 6: IPC channels + preload bridge + main wiring

**Files:**
- Modify: `src/shared/ipc.ts` (channels + payload types)
- Modify: `src/main/ipcHandlers.ts` (handlers)
- Modify: `src/main/index.ts` (service construction + event wiring)
- Modify: `src/preload/index.ts` (bridge)
- Modify: `src/renderer/env.d.ts` (window.birdbrain typing)
- Test: `tests/main/ipcHandlers.test.ts` (extend, following the file's existing register-and-invoke pattern)

**Interfaces:**
- Consumes: `createRecaptureService` + `renderPageInHiddenWindow` (Tasks 4–5), `IPC_CHANNELS.CAPTURE_ACTIVITY` / `NEW_CAPTURE` events (existing).
- Produces: channels `recapture:enqueue`, `recapture:queueStatus`; `window.birdbrain.recapture.enqueue(payload): Promise<EnqueueResult>` and `window.birdbrain.recapture.queueStatus(): Promise<RecaptureQueueStatus>`; payload type `RecaptureEnqueuePayload { urls: string[]; caseId: string; supersedesCaptureId?: string }`. Tasks 7–8 call these.

- [ ] **Step 1: Add channels + payload types**

In `src/shared/ipc.ts`, inside `IPC_CHANNELS` after the captures block:

```ts
  RECAPTURE_ENQUEUE: 'recapture:enqueue',
  RECAPTURE_QUEUE_STATUS: 'recapture:queueStatus',
```

With the other payload types:

```ts
export interface RecaptureEnqueuePayload {
  urls: string[]
  caseId: string
  supersedesCaptureId?: string
}
```

- [ ] **Step 2: Construct the service in `src/main/index.ts`**

After `createCaptureLifecycle` (around line 219) — note `setMainWindow`/window creation already exists in this file; reuse whatever reference the capture server uses (`mainWindow`):

```ts
import { createRecaptureService } from '@main/services/recapture'
import { renderPageInHiddenWindow } from '@main/services/backgroundRenderer'
```

```ts
    const recaptureService = createRecaptureService({
      renderPage: renderPageInHiddenWindow,
      captureLifecycle,
      emitEvent: (event) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(IPC_CHANNELS.CAPTURE_ACTIVITY, event)
        }
      },
      emitNewCapture: (capture) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(IPC_CHANNELS.NEW_CAPTURE, capture)
        }
      }
    })
```

If `mainWindow` isn't in scope at that point in `index.ts`, follow how `startCaptureServer`/`setMainWindow` get it and mirror that (a `let mainWindow` captured by the closures is fine — the emits are called lazily, after window creation).

Pass it to the handlers: `registerIpcHandlers({ selectorLifecycle, captureLifecycle, recaptureService })`.

- [ ] **Step 3: Register handlers in `src/main/ipcHandlers.ts`**

Extend the deps interface with `recaptureService: RecaptureService` and add (near the captures handlers, using the file's existing `handle` wrapper):

```ts
  handle(IPC_CHANNELS.RECAPTURE_ENQUEUE, (_, payload: RecaptureEnqueuePayload) =>
    recaptureService.enqueue(
      payload.urls.map((url) => ({
        url,
        caseId: payload.caseId,
        supersedesCaptureId: payload.supersedesCaptureId
      }))
    )
  )

  handle(IPC_CHANNELS.RECAPTURE_QUEUE_STATUS, () => recaptureService.status())
```

- [ ] **Step 4: Preload bridge + renderer typing**

In `src/preload/index.ts`, add a `recapture` domain next to `captures` (match the existing `unwrapIpc` usage for invoke-with-error-unwrapping):

```ts
  recapture: {
    enqueue: (payload: RecaptureEnqueuePayload): Promise<EnqueueResult> =>
      unwrapIpc<EnqueueResult>(ipcRenderer.invoke(IPC_CHANNELS.RECAPTURE_ENQUEUE, payload)),
    queueStatus: (): Promise<RecaptureQueueStatus> =>
      ipcRenderer.invoke(IPC_CHANNELS.RECAPTURE_QUEUE_STATUS)
  },
```

Move `EnqueueResult` and `RecaptureQueueStatus` to `src/shared/ipc.ts` (preload and renderer cannot import from `@main/services/recapture`; `recapture.ts` should import these two types from `@shared/ipc` instead of defining them).

In `src/renderer/env.d.ts`, add to the `window.birdbrain` interface:

```ts
  recapture: {
    enqueue(payload: RecaptureEnqueuePayload): Promise<EnqueueResult>
    queueStatus(): Promise<RecaptureQueueStatus>
  }
```

- [ ] **Step 5: Extend `tests/main/ipcHandlers.test.ts`**

Follow the file's existing pattern (it registers handlers with stub deps and invokes channels). Add a stub `recaptureService` (`enqueue: vi.fn(() => ({ accepted: 1, rejected: [] }))`, `status: vi.fn(() => ({ pending: 0, activeUrl: null }))`, `idle: vi.fn()`) to every existing `registerIpcHandlers` call site in the test, plus:

```ts
  it('recapture:enqueue fans urls out to jobs', async () => {
    await invoke(IPC_CHANNELS.RECAPTURE_ENQUEUE, {
      urls: ['https://a.com/', 'https://b.com/'],
      caseId: 'case-1',
      supersedesCaptureId: 'cap-9'
    })
    expect(recaptureService.enqueue).toHaveBeenCalledWith([
      { url: 'https://a.com/', caseId: 'case-1', supersedesCaptureId: 'cap-9' },
      { url: 'https://b.com/', caseId: 'case-1', supersedesCaptureId: 'cap-9' }
    ])
  })
```

- [ ] **Step 6: Run tests + lint, commit**

Run: `pnpm lint && pnpm test tests/main/ipcHandlers.test.ts`
Expected: PASS.

```bash
git add src/shared/ipc.ts src/main/ipcHandlers.ts src/main/index.ts src/preload/index.ts src/renderer/env.d.ts src/main/services/recapture.ts tests/main/ipcHandlers.test.ts
git commit -m "feat(recapture): IPC channels, preload bridge, and main-process wiring"
```

---

### Task 7: UI — Recapture action + supersedes link chips

**Files:**
- Modify: `src/renderer/lib/queries.ts` (mutation hook)
- Modify: `src/renderer/components/captures/CaptureViewer.tsx` (action button + chips)
- Test: `tests/components/` — add `tests/components/recaptureAction.test.tsx` only if the directory already tests viewer-level components with a jsdom setup; otherwise cover the mutation hook shape in `tests/lib/queries.test.ts` if that file exists. If neither pattern exists, rely on Task 9's E2E for UI coverage (do NOT invent a new component-test harness for this feature).

**Interfaces:**
- Consumes: `window.birdbrain.recapture.enqueue` (Task 6), `Capture.method` / `Capture.supersedesCaptureId` (Task 1), existing `useAppStore` selection, `queryKeys.captures(caseId)` data (already in cache for the list).
- Produces: `useRecaptureMutations(caseId)` returning `{ enqueue }` where `enqueue.mutate({ urls, supersedesCaptureId? })`. Task 8 reuses it.

- [ ] **Step 1: Add the mutation hook to `src/renderer/lib/queries.ts`**

Next to `useCapturesMutations`:

```ts
export function useRecaptureMutations(caseId: string) {
  const enqueue = useMutation({
    mutationFn: (params: { urls: string[]; supersedesCaptureId?: string }) =>
      window.birdbrain.recapture.enqueue({
        urls: params.urls,
        caseId,
        supersedesCaptureId: params.supersedesCaptureId
      })
  })
  // No cache invalidation here: completion arrives via the NEW_CAPTURE event,
  // which useServerStatus already folds into the captures cache.
  return { enqueue }
}
```

- [ ] **Step 2: Add the Recapture button to `CaptureViewer.tsx`**

In the existing action Button group (next to the verify/download buttons — match their exact `Button` variant/size props):

```tsx
const { enqueue } = useRecaptureMutations(capture.caseId)
```

```tsx
<Button
  variant="ghost"
  size="sm"
  title="Recapture this page in the background"
  data-testid="recapture-btn"
  disabled={enqueue.isPending}
  onClick={() =>
    enqueue.mutate({ urls: [capture.url], supersedesCaptureId: capture.id })
  }
>
  Recapture
</Button>
```

(Adopt whatever icon convention neighboring buttons use — e.g. a lucide `RefreshCcw` if others use lucide icons.)

- [ ] **Step 3: Add supersedes link chips**

In `CaptureViewer.tsx`, near the title/URL header block:

```tsx
const captures = useQuery(capturesQueryOptions(capture.caseId)).data ?? []
const original = capture.supersedesCaptureId
  ? captures.find((c) => c.id === capture.supersedesCaptureId)
  : undefined
const recaptureOf = captures.find((c) => c.supersedesCaptureId === capture.id)
```

```tsx
{original && (
  <button
    data-testid="supersedes-link-original"
    className="text-xs text-accent underline underline-offset-2"
    onClick={() => useAppStore.getState().setSelectedCaptureId(original.id)}
  >
    ← Recapture of {new Date(original.timestamp).toLocaleString()}
  </button>
)}
{recaptureOf && (
  <button
    data-testid="supersedes-link-recapture"
    className="text-xs text-accent underline underline-offset-2"
    onClick={() => useAppStore.getState().setSelectedCaptureId(recaptureOf.id)}
  >
    Recaptured {new Date(recaptureOf.timestamp).toLocaleString()} →
  </button>
)}
```

(Use the file's actual captures query — if the viewer already has the list from a parent or an existing `useQuery`, reuse that instead of adding a second one. Match the exact query-options export name in `queries.ts`.)

Also surface `capture.method === 'background'` next to the existing provenance UI: `ProvenanceBadge` lives in `src/renderer/components/captures/ProvenanceBadge.tsx` — add a small `Background` chip there if the component renders per-capture provenance chips; otherwise place a `<span data-testid="method-badge">Background capture</span>` beside the title. Inspect the component first and follow its pattern.

- [ ] **Step 4: Lint + typecheck + manual smoke**

Run: `pnpm lint && pnpm build`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/lib/queries.ts src/renderer/components/captures/CaptureViewer.tsx src/renderer/components/captures/ProvenanceBadge.tsx
git commit -m "feat(recapture): viewer Recapture action and supersedes link chips"
```

---

### Task 8: UI — Add URLs box + pending badge

**Files:**
- Create: `src/renderer/components/captures/AddUrlsBox.tsx`
- Modify: `src/renderer/routes/cases/$caseId/captures.tsx` (mount the box)
- Modify: `src/renderer/components/status/CaptureHealth.tsx` (pending badge + warning rendering)

**Interfaces:**
- Consumes: `useRecaptureMutations` (Task 7), `window.birdbrain.recapture.queueStatus` (Task 6), `CaptureEvent.warning` (Task 1), appStore `captureEvents`.
- Produces: UI only.

- [ ] **Step 1: Create `AddUrlsBox.tsx`**

```tsx
import { useState } from 'react'
import { Button } from '@renderer/components/ui'
import { useRecaptureMutations } from '@renderer/lib/queries'

// Paste one or many URLs (newline/whitespace separated); they are captured
// silently in the background by the recapture queue.
export function AddUrlsBox({ caseId }: { caseId: string }) {
  const [value, setValue] = useState('')
  const [feedback, setFeedback] = useState<string | null>(null)
  const { enqueue } = useRecaptureMutations(caseId)

  const submit = async () => {
    const urls = [...new Set(value.split(/\s+/).map((s) => s.trim()).filter(Boolean))]
    if (urls.length === 0) return
    const result = await enqueue.mutateAsync({ urls })
    const parts = [`${result.accepted} queued`]
    if (result.rejected.length > 0) {
      parts.push(`${result.rejected.length} rejected (${result.rejected[0].reason})`)
    }
    setFeedback(parts.join(', '))
    if (result.accepted > 0) setValue('')
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-2">
        <textarea
          data-testid="add-urls-input"
          className="min-h-9 flex-1 resize-y rounded border border-border bg-canvas px-2 py-1.5
            text-sm text-text-primary placeholder:text-text-secondary"
          placeholder="Paste URLs to capture in the background…"
          rows={1}
          value={value}
          onChange={(e) => {
            setValue(e.target.value)
            setFeedback(null)
          }}
        />
        <Button
          variant="secondary"
          size="sm"
          data-testid="add-urls-submit"
          disabled={enqueue.isPending || value.trim() === ''}
          onClick={submit}
        >
          Capture
        </Button>
      </div>
      {feedback && (
        <span data-testid="add-urls-feedback" className="text-xs text-text-secondary">
          {feedback}
        </span>
      )}
    </div>
  )
}
```

(Verify the `Button` variant names against `@renderer/components/ui` and the textarea styling against a nearby form control — copy real tokens from an existing input in the codebase.)

- [ ] **Step 2: Mount it in the captures route**

In `src/renderer/routes/cases/$caseId/captures.tsx`, render `<AddUrlsBox caseId={caseId} />` above/beside the `CaptureList` — inspect the route's current layout (it renders CaptureList + CaptureViewer in a split view) and place the box at the top of the list pane.

- [ ] **Step 3: Pending badge + warnings in `CaptureHealth.tsx`**

- Badge: poll `window.birdbrain.recapture.queueStatus()` with a `useQuery({ queryKey: ['recaptureQueue'], queryFn: () => window.birdbrain.recapture.queueStatus(), refetchInterval: 2000 })` and render, next to the component's existing counters:

```tsx
{queue && queue.pending > 0 && (
  <span data-testid="recapture-pending-badge" className="text-xs text-text-secondary">
    {queue.pending} background capture{queue.pending === 1 ? '' : 's'} pending
  </span>
)}
```

- Warning: where the event list renders each `event` row, if `event.warning` is set append a warning line in the same style the component uses for `screenshotWarning` (it already renders degraded states — mirror that markup).

- [ ] **Step 4: Lint, build, run the app once**

Run: `pnpm lint && pnpm build`, then `pnpm dev` and manually: create a case → Captures tab → paste `https://example.com` → Capture → watch the activity feed → capture appears with Background badge and screenshot.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/captures/AddUrlsBox.tsx src/renderer/routes/cases/\$caseId/captures.tsx src/renderer/components/status/CaptureHealth.tsx
git commit -m "feat(recapture): Add URLs box and pending-queue badge"
```

---

### Task 9: E2E test

**Files:**
- Create: `e2e/recapture.spec.ts`

**Interfaces:**
- Consumes: the full stack; `e2e/fixtures/electronApp` test fixture (same as `mhtml-capture.spec.ts`); testids from Tasks 7–8.

- [ ] **Step 1: Write the E2E spec**

```ts
import { test, expect } from './fixtures/electronApp'
import { createServer, type Server } from 'http'

// End-to-end background recapture: serve a fixture page from a local HTTP
// server, queue it via the Add URLs box, and assert the capture lands with
// background provenance, a screenshot, and a verifiable manifest chain.
test.describe('Recapture (background capture)', () => {
  let server: Server
  let baseUrl: string

  test.beforeAll(async () => {
    server = createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(
        '<html><head><title>Recapture Fixture</title></head>' +
          '<body><h1>Recapture fixture page</h1><p>stable content</p></body></html>'
      )
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const addr = server.address()
    baseUrl = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : ''
  })

  test.afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  test('captures a URL in the background with full provenance', async ({ page }) => {
    // Create a case (same flow as mhtml-capture.spec.ts)
    await page.evaluate(() => {
      window.location.hash = '/cases/new'
    })
    await page.waitForSelector('[data-testid="case-name-input"]', { timeout: 10000 })
    await page.fill('[data-testid="case-name-input"]', 'Recapture E2E')
    await page.click('[data-testid="case-create-btn"]')
    await page.waitForURL(/#\/cases\/.+\/overview/, { timeout: 10000 })
    const caseId = page.url().match(/cases\/([^/]+)/)![1]

    // Navigate to the Captures tab and queue the fixture URL
    await page.evaluate((id) => {
      window.location.hash = `/cases/${id}/captures`
    }, caseId)
    await page.waitForSelector('[data-testid="add-urls-input"]', { timeout: 10000 })
    await page.fill('[data-testid="add-urls-input"]', `${baseUrl}/page`)
    await page.click('[data-testid="add-urls-submit"]')

    // The capture appears in the list when the background job completes
    await expect(page.getByText('Recapture Fixture')).toBeVisible({ timeout: 60000 })

    // Provenance: background method + supersedes-free + verified chain
    const capture = await page.evaluate(async (id) => {
      const list = await window.birdbrain.captures.list(id)
      return list[0]
    }, caseId)
    expect(capture.method).toBe('background')
    expect(capture.supersedesCaptureId).toBeUndefined()
    expect(capture.screenshotPath).toBeTruthy()
    expect(capture.hash).toMatch(/^[0-9a-f]{64}$/)

    const verification = await page.evaluate(
      (captureId) => window.birdbrain.captures.verify(captureId),
      capture.id
    )
    expect(verification.status).toBe('verified')

    // Recapture the capture itself → linked sibling
    await page.click(`[data-testid="capture-item-${capture.id}"]`)
    await page.click('[data-testid="recapture-btn"]')
    await expect(page.locator('[data-testid="supersedes-link-recapture"]')).toBeVisible({
      timeout: 60000
    })
    const captures = await page.evaluate((id) => window.birdbrain.captures.list(id), caseId)
    expect(captures).toHaveLength(2)
    const sibling = captures.find((c) => c.supersedesCaptureId === capture.id)
    expect(sibling).toBeTruthy()
    expect(sibling!.method).toBe('background')
  })
})
```

(Adjust the capture-item click selector to whatever testid `CaptureItem` actually renders — check `src/renderer/components/captures/CaptureItem.tsx` and use its existing convention; several e2e specs already click list items.)

- [ ] **Step 2: Run it**

Run: `pnpm test:e2e -- recapture.spec.ts` (runs `pnpm build` first via `pretest:e2e`)
Expected: PASS. If the screenshot CDP step flakes headlessly, debug with `pnpm test:e2e:debug -- recapture.spec.ts` — do not weaken assertions.

- [ ] **Step 3: Full suite + commit**

Run: `pnpm test && pnpm test:e2e`
Expected: all green.

```bash
git add e2e/recapture.spec.ts
git commit -m "test(e2e): background recapture end-to-end coverage"
```

---

## Self-review notes (already applied)

- **Spec coverage:** provenance model → T1–T3; engine + security posture → T5; queue/timeout/login-wall/events → T4; IPC/UI entry points/badge/chips → T6–T8; E2E → T9. Spec's "malformed pasted URLs rejected at enqueue with per-URL feedback" → T4 validateUrl + T8 feedback line. Spec's oversized-MHTML case is covered by existing `streamWriteAndHash` tests — no new task needed.
- **Types:** `EnqueueResult`/`RecaptureQueueStatus` must live in `@shared/ipc` (T6 step 4 note) since preload/renderer import them — T4 defines them initially in `recapture.ts` and T6 moves them; if executing tasks out of order, define them in `@shared/ipc` from the start.
- **CaptureEvent.warning** is added in T1 (types) and consumed in T4/T8.
- Migration number v23 verified against current `user_version = 22` in `database.ts`.
