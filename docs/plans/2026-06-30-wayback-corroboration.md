# Wayback Machine Corroboration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an **Archive** tab to the capture viewer that looks up the captured URL in the Internet Archive Wayback Machine, shows a timeline with the snapshot closest to the capture timestamp highlighted, opens snapshots externally, and lets the user pin snapshot references to the capture.

**Architecture:** A main-process service (`waybackMachine.ts`) queries the Wayback **CDX API** (outbound HTTP must run in main — archive.org sends no CORS headers, and this matches `timestamp.ts`/`tlsCertChain.ts`). Pinned references persist in a new `capture_archive_refs` table (migration v21). A new IPC `archive` domain wires service + DB to a React-Query-backed `ArchiveTab`. This is **corroboration only** — it never touches the capture's hash chain (same stance as the TLS cert-chain feature, #123).

**Tech Stack:** Electron main (undici `fetch`, `AbortSignal.timeout`), better-sqlite3, TypeScript strict, React 19 + TanStack Query, Tailwind v4 semantic tokens, Vitest (Electron runtime).

## Global Constraints

- Code style: **no semicolons, single quotes, no trailing commas, 100-char width, 2-space indent**. TypeScript strict. No `any` without an `// eslint-disable` + reason.
- DB columns are **snake_case** in SQL; TS objects are **camelCase**, mapped via a `rowToX` function.
- Schema migrations use the `user_version` pragma. Current latest is **20**; this feature adds **21**. `LATEST_SCHEMA_VERSION` lives in `src/main/services/database.ts`.
- IPC channels follow `domain:action`. Every channel must be added in **four** places kept in sync: `src/shared/ipc.ts` (channel const), `src/main/ipcHandlers.ts` (handler), `src/preload/index.ts` (impl), `src/renderer/env.d.ts` (`BirdbrainAPI` interface).
- Handlers that can fail and return structured errors use `handle()` + `IpcFailure` from `@main/ipcWrap` (renderer unwraps via `unwrapIpc`). Plain reads use `ipcMain.handle`.
- Renderer: prefer semantic theme tokens (`bg-canvas`, `text-text-primary`, `border-border`, `text-accent`, `bg-accent-subtle`, `text-text-faint`, `text-text-muted`) over raw colors.
- Lookup is **always explicit** (user clicks a button). Never auto-run on tab open.
- Verification commands: `pnpm test <path>` (single file), `pnpm typecheck` (if present; otherwise `pnpm build`), `pnpm lint`.

---

### Task 1: Wayback CDX service

Pure main-process service that fetches + parses CDX results and computes the closest snapshot. `fetch` is injected so tests need no network.

**Files:**
- Modify: `src/shared/types.ts` (append `WaybackSnapshot`, `WaybackLookupResult` after the `Capture` block, ~line 89)
- Create: `src/main/services/waybackMachine.ts`
- Test: `tests/main/services/waybackMachine.test.ts`

**Interfaces:**
- Produces: `WaybackSnapshot`, `WaybackLookupResult` (shared types); `lookupSnapshots(url: string, captureTimestamp: string, options?: { fetchImpl?: typeof fetch; timeoutMs?: number; limit?: number }): Promise<WaybackLookupResult>`

- [ ] **Step 1: Add shared types**

In `src/shared/types.ts`, immediately after the `Capture` interface (after line 89), add:

```ts
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
```

- [ ] **Step 2: Write the failing test**

Create `tests/main/services/waybackMachine.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { lookupSnapshots } from '@main/services/waybackMachine'

// Minimal fake fetch returning a Response-like object with a json() method.
function fakeFetch(body: unknown, ok = true, status = 200): typeof fetch {
  return (async () =>
    ({
      ok,
      status,
      statusText: ok ? 'OK' : 'Error',
      json: async () => body
    }) as unknown as Response) as unknown as typeof fetch
}

const CDX_HEADER = ['timestamp', 'original', 'statuscode', 'mimetype', 'digest', 'length']

describe('lookupSnapshots', () => {
  it('parses CDX rows into snapshots with ISO timestamps and snapshot URLs', async () => {
    const body = [
      CDX_HEADER,
      ['20200115120000', 'https://example.com/', '200', 'text/html', 'ABC', '1234']
    ]
    const result = await lookupSnapshots('https://example.com/', '2020-01-15T12:00:00.000Z', {
      fetchImpl: fakeFetch(body)
    })
    expect(result.snapshots).toHaveLength(1)
    expect(result.snapshots[0]).toMatchObject({
      timestamp: '2020-01-15T12:00:00.000Z',
      snapshotUrl: 'https://web.archive.org/web/20200115120000/https://example.com/',
      originalUrl: 'https://example.com/',
      statusCode: 200,
      mimeType: 'text/html',
      digest: 'ABC'
    })
    expect(result.closestIndex).toBe(0)
    expect(result.checkedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('selects the snapshot closest to the capture timestamp', async () => {
    const body = [
      CDX_HEADER,
      ['20180101000000', 'https://example.com/', '200', 'text/html', 'A', '1'],
      ['20200110000000', 'https://example.com/', '200', 'text/html', 'B', '1'],
      ['20220101000000', 'https://example.com/', '200', 'text/html', 'C', '1']
    ]
    const result = await lookupSnapshots('https://example.com/', '2020-01-15T00:00:00.000Z', {
      fetchImpl: fakeFetch(body)
    })
    expect(result.closestIndex).toBe(1) // 2020-01-10 is nearest 2020-01-15
  })

  it('returns empty result with null closestIndex when CDX has no rows', async () => {
    const result = await lookupSnapshots('https://example.com/', '2020-01-15T00:00:00.000Z', {
      fetchImpl: fakeFetch([])
    })
    expect(result.snapshots).toEqual([])
    expect(result.closestIndex).toBeNull()
  })

  it('throws a typed error when archive.org responds non-2xx', async () => {
    await expect(
      lookupSnapshots('https://example.com/', '2020-01-15T00:00:00.000Z', {
        fetchImpl: fakeFetch(null, false, 503)
      })
    ).rejects.toThrow(/503/)
  })

  it('tolerates malformed rows by skipping them', async () => {
    const body = [
      CDX_HEADER,
      ['notadate', 'https://example.com/', '200', 'text/html', 'A', '1'],
      ['20200110000000', 'https://example.com/', '200', 'text/html', 'B', '1']
    ]
    const result = await lookupSnapshots('https://example.com/', '2020-01-10T00:00:00.000Z', {
      fetchImpl: fakeFetch(body)
    })
    expect(result.snapshots).toHaveLength(1)
    expect(result.snapshots[0].digest).toBe('B')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test tests/main/services/waybackMachine.test.ts`
Expected: FAIL — cannot find module `@main/services/waybackMachine`.

- [ ] **Step 4: Implement the service**

Create `src/main/services/waybackMachine.ts`:

```ts
import type { WaybackSnapshot, WaybackLookupResult } from '@shared/types'

export type { WaybackSnapshot, WaybackLookupResult }

// Wayback Machine corroboration lookup (#wayback).
//
// AFTER a capture is stored, the main process queries the Internet Archive CDX
// API for archive.org's own record of the captured URL. This is CORROBORATION,
// not binding: it reports whatever snapshots archive.org holds, independent of
// the captured transaction. The lookup is always user-initiated (it discloses
// the target URL to a third party) and never alters the capture hash chain.

const CDX_BASE = 'https://web.archive.org/cdx/search/cdx'
const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_LIMIT = 200

// CDX timestamps are 14-digit YYYYMMDDHHMMSS in UTC. Returns epoch ms, or NaN
// if the string is not a well-formed 14-digit timestamp.
function cdxTimestampToEpoch(ts: string): number {
  if (!/^\d{14}$/.test(ts)) return NaN
  const year = Number(ts.slice(0, 4))
  const month = Number(ts.slice(4, 6))
  const day = Number(ts.slice(6, 8))
  const hour = Number(ts.slice(8, 10))
  const minute = Number(ts.slice(10, 12))
  const second = Number(ts.slice(12, 14))
  return Date.UTC(year, month - 1, day, hour, minute, second)
}

function buildCdxUrl(url: string, limit: number): string {
  const params = new URLSearchParams({
    url,
    output: 'json',
    fl: 'timestamp,original,statuscode,mimetype,digest,length',
    filter: 'statuscode:200',
    collapse: 'digest',
    limit: String(limit)
  })
  return `${CDX_BASE}?${params.toString()}`
}

export async function lookupSnapshots(
  url: string,
  captureTimestamp: string,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number; limit?: number } = {}
): Promise<WaybackLookupResult> {
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const limit = options.limit ?? DEFAULT_LIMIT
  const checkedAt = new Date().toISOString()

  const res = await fetchImpl(buildCdxUrl(url, limit), {
    // Bound the wait: undici's default header timeout is multi-minute and would
    // hang the UI on a stalled archive.org. On abort this rejects and the
    // renderer shows the error state.
    signal: AbortSignal.timeout(timeoutMs)
  })
  if (!res.ok) {
    throw new Error(`Wayback CDX responded ${res.status} ${res.statusText}`)
  }

  const rows = (await res.json()) as unknown
  // CDX returns [] for no results, or [header, ...dataRows] otherwise.
  if (!Array.isArray(rows) || rows.length <= 1) {
    return { snapshots: [], closestIndex: null, checkedAt }
  }

  const snapshots: WaybackSnapshot[] = []
  for (const row of rows.slice(1)) {
    if (!Array.isArray(row)) continue
    const [ts, original, statuscode, mimetype, digest] = row as string[]
    const epoch = cdxTimestampToEpoch(ts)
    if (Number.isNaN(epoch) || !original) continue
    const statusNum = Number(statuscode)
    snapshots.push({
      timestamp: new Date(epoch).toISOString(),
      snapshotUrl: `https://web.archive.org/web/${ts}/${original}`,
      originalUrl: original,
      statusCode: Number.isFinite(statusNum) ? statusNum : undefined,
      mimeType: mimetype || undefined,
      digest: digest || undefined
    })
  }

  return { snapshots, closestIndex: closestIndexTo(snapshots, captureTimestamp), checkedAt }
}

function closestIndexTo(snapshots: WaybackSnapshot[], captureTimestamp: string): number | null {
  if (snapshots.length === 0) return null
  const target = Date.parse(captureTimestamp)
  if (Number.isNaN(target)) return 0
  let best = 0
  let bestDelta = Infinity
  snapshots.forEach((snap, i) => {
    const delta = Math.abs(Date.parse(snap.timestamp) - target)
    if (delta < bestDelta) {
      bestDelta = delta
      best = i
    }
  })
  return best
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test tests/main/services/waybackMachine.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/main/services/waybackMachine.ts tests/main/services/waybackMachine.test.ts
git commit -m "feat(wayback): add CDX snapshot lookup service"
```

---

### Task 2: Archive-refs database layer

New table + CRUD for pinned references. Migration v21.

**Files:**
- Modify: `src/shared/types.ts` (append `ArchiveRef` after the `WaybackLookupResult` added in Task 1)
- Modify: `src/main/services/database.ts` (bump `LATEST_SCHEMA_VERSION` to 21; add `version < 21` migration after the `version < 20` block ~line 308; add CRUD + `rowToArchiveRef` near the Notes section)
- Test: `tests/main/services/archiveRefs.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `ArchiveRef` (shared type); `createArchiveRef(params: { captureId: string; snapshot: WaybackSnapshot; checkedAt: string }): ArchiveRef`, `listArchiveRefs(captureId: string): ArchiveRef[]`, `deleteArchiveRef(id: string): boolean`.

- [ ] **Step 1: Add the ArchiveRef shared type**

In `src/shared/types.ts`, after the `WaybackLookupResult` interface, add:

```ts
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
```

- [ ] **Step 2: Write the failing test**

Create `tests/main/services/archiveRefs.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  initDatabase,
  closeDatabase,
  getDb,
  createCase,
  insertCapture,
  createArchiveRef,
  listArchiveRefs,
  deleteArchiveRef
} from '@main/services/database'
import type { WaybackSnapshot } from '@shared/types'

let dir = ''

const snapshot: WaybackSnapshot = {
  timestamp: '2020-01-15T12:00:00.000Z',
  snapshotUrl: 'https://web.archive.org/web/20200115120000/https://example.com/',
  originalUrl: 'https://example.com/',
  statusCode: 200,
  mimeType: 'text/html',
  digest: 'ABC'
}

function makeCapture(caseId: string) {
  return insertCapture({
    caseId,
    url: 'https://example.com/',
    title: 'Example',
    hash: 'deadbeef',
    timestamp: '2020-01-15T12:00:00.000Z',
    createdAt: '2020-01-15T12:00:01.000Z',
    format: 'mhtml'
  })
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'bb-archive-'))
  initDatabase(join(dir, 'test.db'))
})

afterEach(() => {
  closeDatabase()
  rmSync(dir, { recursive: true, force: true })
})

describe('archive refs CRUD', () => {
  it('creates and lists a pinned ref for a capture', () => {
    const c = createCase({ name: 'Case' })
    const cap = makeCapture(c.id)
    const ref = createArchiveRef({
      captureId: cap.id,
      snapshot,
      checkedAt: '2026-06-30T00:00:00.000Z'
    })
    expect(ref.id).toBeTruthy()
    expect(ref.snapshotUrl).toBe(snapshot.snapshotUrl)
    expect(ref.pinnedAt).toMatch(/^\d{4}-/)

    const refs = listArchiveRefs(cap.id)
    expect(refs).toHaveLength(1)
    expect(refs[0].snapshotTimestamp).toBe('2020-01-15T12:00:00.000Z')
    expect(refs[0].statusCode).toBe(200)
  })

  it('deletes a ref by id', () => {
    const c = createCase({ name: 'Case' })
    const cap = makeCapture(c.id)
    const ref = createArchiveRef({ captureId: cap.id, snapshot, checkedAt: '2026-06-30T00:00:00.000Z' })
    expect(deleteArchiveRef(ref.id)).toBe(true)
    expect(listArchiveRefs(cap.id)).toHaveLength(0)
    expect(deleteArchiveRef(ref.id)).toBe(false)
  })

  it('cascade-deletes refs when the capture is deleted', () => {
    const c = createCase({ name: 'Case' })
    const cap = makeCapture(c.id)
    createArchiveRef({ captureId: cap.id, snapshot, checkedAt: '2026-06-30T00:00:00.000Z' })
    // initDatabase sets `foreign_keys = ON`, so deleting the capture cascades.
    getDb().prepare('DELETE FROM captures WHERE id = ?').run(cap.id)
    expect(listArchiveRefs(cap.id)).toHaveLength(0)
  })
})
```

> Note: confirm `insertCapture`'s exact parameter shape before running — open `src/main/services/database.ts`, find `export function insertCapture`, and match the field names/required props. Adjust `makeCapture` if the signature differs (e.g. extra required fields). The test's intent (create capture → pin ref → list/delete/cascade) stays the same.

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test tests/main/services/archiveRefs.test.ts`
Expected: FAIL — `createArchiveRef` is not exported.

- [ ] **Step 4: Add the migration**

In `src/main/services/database.ts`, change the constant:

```ts
export const LATEST_SCHEMA_VERSION = 21
```

Then, immediately after the `if (version < 20) { ... }` block (ends ~line 308), add:

```ts
  if (version < 21) {
    db.transaction(() => {
      // Pinned Wayback Machine corroboration references (#wayback). Corroboration
      // only — NOT part of the capture hash chain (cf. TLS cert chain, #123).
      // contentPath/contentHash/manifestIndex are reserved for the future
      // download-later phase and added then; references are metadata-only now.
      db.exec(`
        CREATE TABLE IF NOT EXISTS capture_archive_refs (
          id TEXT PRIMARY KEY,
          capture_id TEXT NOT NULL,
          snapshot_timestamp TEXT NOT NULL,
          snapshot_url TEXT NOT NULL,
          original_url TEXT NOT NULL,
          digest TEXT,
          status_code INTEGER,
          mime_type TEXT,
          checked_at TEXT NOT NULL,
          pinned_at TEXT NOT NULL,
          FOREIGN KEY (capture_id) REFERENCES captures(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_archive_refs_capture ON capture_archive_refs(capture_id);
      `)
      db.pragma('user_version = 21')
    })()
  }
```

- [ ] **Step 5: Add CRUD + mapper**

In `src/main/services/database.ts`, add `ArchiveRef` and `WaybackSnapshot` to the `@shared/types` import block at the top, then add a new section (e.g. directly after the Notes section, after `searchNotes`/`rowToNote`):

```ts
// --- Archive refs (Wayback corroboration) ---

export function createArchiveRef(params: {
  captureId: string
  snapshot: WaybackSnapshot
  checkedAt: string
}): ArchiveRef {
  const id = uuid()
  const now = new Date().toISOString()
  const { snapshot } = params
  getDb()
    .prepare(
      `INSERT INTO capture_archive_refs
         (id, capture_id, snapshot_timestamp, snapshot_url, original_url, digest, status_code, mime_type, checked_at, pinned_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      params.captureId,
      snapshot.timestamp,
      snapshot.snapshotUrl,
      snapshot.originalUrl,
      snapshot.digest ?? null,
      snapshot.statusCode ?? null,
      snapshot.mimeType ?? null,
      params.checkedAt,
      now
    )
  return getArchiveRef(id)!
}

export function getArchiveRef(id: string): ArchiveRef | undefined {
  const row = getDb().prepare('SELECT * FROM capture_archive_refs WHERE id = ?').get(id) as
    | Record<string, unknown>
    | undefined
  return row ? rowToArchiveRef(row) : undefined
}

export function listArchiveRefs(captureId: string): ArchiveRef[] {
  const rows = getDb()
    .prepare(
      'SELECT * FROM capture_archive_refs WHERE capture_id = ? ORDER BY snapshot_timestamp DESC'
    )
    .all(captureId) as Array<Record<string, unknown>>
  return rows.map(rowToArchiveRef)
}

export function deleteArchiveRef(id: string): boolean {
  const result = getDb().prepare('DELETE FROM capture_archive_refs WHERE id = ?').run(id)
  return result.changes > 0
}

function rowToArchiveRef(row: Record<string, unknown>): ArchiveRef {
  return {
    id: row.id as string,
    captureId: row.capture_id as string,
    snapshotTimestamp: row.snapshot_timestamp as string,
    snapshotUrl: row.snapshot_url as string,
    originalUrl: row.original_url as string,
    digest: (row.digest as string) || undefined,
    statusCode: (row.status_code as number) ?? undefined,
    mimeType: (row.mime_type as string) || undefined,
    checkedAt: row.checked_at as string,
    pinnedAt: row.pinned_at as string
  }
}
```

Add to the existing top-of-file import from `@shared/types`:

```ts
  ArchiveRef,
  WaybackSnapshot
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm test tests/main/services/archiveRefs.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts src/main/services/database.ts tests/main/services/archiveRefs.test.ts
git commit -m "feat(wayback): add capture_archive_refs table and CRUD (migration v21)"
```

---

### Task 3: IPC contracts + main handlers

Wire the service and DB to the renderer over a new `archive` IPC domain.

**Files:**
- Modify: `src/shared/ipc.ts` (add 4 channels + `PinArchiveSnapshotParams`)
- Modify: `src/main/ipcHandlers.ts` (import service; register 4 handlers)
- Test: `tests/main/ipcHandlers.test.ts` (add an `archive` describe block)

**Interfaces:**
- Consumes: `lookupSnapshots` (Task 1); `createArchiveRef`, `listArchiveRefs`, `deleteArchiveRef`, `getCapture` (Task 2 + existing).
- Produces: channels `ARCHIVE_LOOKUP`, `ARCHIVE_LIST`, `ARCHIVE_PIN`, `ARCHIVE_UNPIN`; `PinArchiveSnapshotParams { captureId: string; snapshot: WaybackSnapshot }`.

- [ ] **Step 1: Add channels + params type**

In `src/shared/ipc.ts`, inside `IPC_CHANNELS` (e.g. after the Notes block), add:

```ts
  // Archive (Wayback corroboration)
  ARCHIVE_LOOKUP: 'archive:lookup',
  ARCHIVE_LIST: 'archive:list',
  ARCHIVE_PIN: 'archive:pin',
  ARCHIVE_UNPIN: 'archive:unpin',
```

Add the `WaybackSnapshot` import to the top-of-file type import, and add the params type near the other `*Params` interfaces:

```ts
import type { AnnotationShape, WaybackSnapshot } from './types'
```

```ts
export interface PinArchiveSnapshotParams {
  captureId: string
  snapshot: WaybackSnapshot
}
```

- [ ] **Step 2: Write the failing test**

In `tests/main/ipcHandlers.test.ts`, add a new describe block (follow the file's existing harness — handlers are captured into the `registered` map; a real temp DB is already initialized by the suite). Mock the wayback service at the top with the other `vi.mock` calls:

```ts
const lookupSnapshots = vi.fn()
vi.mock('@main/services/waybackMachine', () => ({
  lookupSnapshots: (...a: unknown[]) => lookupSnapshots(...a)
}))
```

Then the test block:

```ts
describe('archive handlers', () => {
  it('archive:lookup reads the capture URL and returns CDX results', async () => {
    const c = createCase({ name: 'C' })
    const cap = insertCapture({
      caseId: c.id,
      url: 'https://example.com/',
      title: 'Example',
      hash: 'h',
      timestamp: '2020-01-15T12:00:00.000Z',
      createdAt: '2020-01-15T12:00:01.000Z',
      format: 'mhtml'
    })
    lookupSnapshots.mockResolvedValueOnce({
      snapshots: [
        {
          timestamp: '2020-01-15T12:00:00.000Z',
          snapshotUrl: 'https://web.archive.org/web/20200115120000/https://example.com/',
          originalUrl: 'https://example.com/',
          statusCode: 200
        }
      ],
      closestIndex: 0,
      checkedAt: '2026-06-30T00:00:00.000Z'
    })
    const handler = registered.get('archive:lookup')!
    const result = (await handler({} as never, cap.id)) as { ok: boolean; data: unknown }
    expect(lookupSnapshots).toHaveBeenCalledWith('https://example.com/', '2020-01-15T12:00:00.000Z')
    expect(result.ok).toBe(true)
  })

  it('archive:pin then archive:list round-trips a reference', async () => {
    const c = createCase({ name: 'C' })
    const cap = insertCapture({
      caseId: c.id,
      url: 'https://example.com/',
      title: 'Example',
      hash: 'h',
      timestamp: '2020-01-15T12:00:00.000Z',
      createdAt: '2020-01-15T12:00:01.000Z',
      format: 'mhtml'
    })
    const snapshot = {
      timestamp: '2020-01-15T12:00:00.000Z',
      snapshotUrl: 'https://web.archive.org/web/20200115120000/https://example.com/',
      originalUrl: 'https://example.com/',
      statusCode: 200
    }
    const pin = registered.get('archive:pin')!
    const pinned = (await pin({} as never, { captureId: cap.id, snapshot })) as {
      ok: boolean
      data: { id: string }
    }
    expect(pinned.ok).toBe(true)

    const list = registered.get('archive:list')!
    const refs = (await list({} as never, cap.id)) as Array<{ snapshotUrl: string }>
    expect(refs).toHaveLength(1)
    expect(refs[0].snapshotUrl).toBe(snapshot.snapshotUrl)

    const unpin = registered.get('archive:unpin')!
    const removed = (await unpin({} as never, pinned.data.id)) as { ok: boolean; data: boolean }
    expect(removed.ok).toBe(true)
    expect((await list({} as never, cap.id)) as unknown[]).toHaveLength(0)
  })
})
```

> Confirm `createCase` and `insertCapture` are already imported by `ipcHandlers.test.ts`; if not, add them to its `@main/services/database` import. Match `insertCapture`'s real signature.

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm test tests/main/ipcHandlers.test.ts`
Expected: FAIL — no handler registered for `archive:lookup`.

- [ ] **Step 4: Register the handlers**

In `src/main/ipcHandlers.ts`, add the import:

```ts
import { lookupSnapshots } from '@main/services/waybackMachine'
import type { PinArchiveSnapshotParams } from '@shared/ipc'
```

Inside `registerIpcHandlers`, add (near the Notes/captures handlers). `lookup`/`pin`/`unpin` can fail or need URL/error structure → use `handle()` + `IpcFailure`; `list` is a plain read:

```ts
  // Archive (Wayback corroboration)
  handle(IPC_CHANNELS.ARCHIVE_LOOKUP, async (_, captureId: string) => {
    const capture = db.getCapture(captureId)
    if (!capture) throw new IpcFailure('Capture not found', 'NOT_FOUND')
    try {
      return await lookupSnapshots(capture.url, capture.timestamp)
    } catch (err) {
      throw new IpcFailure(
        err instanceof Error ? err.message : 'Wayback lookup failed',
        'WAYBACK_LOOKUP_FAILED'
      )
    }
  })

  ipcMain.handle(IPC_CHANNELS.ARCHIVE_LIST, (_, captureId: string) =>
    db.listArchiveRefs(captureId)
  )

  handle(IPC_CHANNELS.ARCHIVE_PIN, async (_, params: PinArchiveSnapshotParams) => {
    const capture = db.getCapture(params.captureId)
    if (!capture) throw new IpcFailure('Capture not found', 'NOT_FOUND')
    return db.createArchiveRef({
      captureId: params.captureId,
      snapshot: params.snapshot,
      checkedAt: new Date().toISOString()
    })
  })

  handle(IPC_CHANNELS.ARCHIVE_UNPIN, async (_, refId: string) => db.deleteArchiveRef(refId))
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test tests/main/ipcHandlers.test.ts`
Expected: PASS (including the new archive block).

- [ ] **Step 6: Commit**

```bash
git add src/shared/ipc.ts src/main/ipcHandlers.ts tests/main/ipcHandlers.test.ts
git commit -m "feat(wayback): add archive IPC domain (lookup/list/pin/unpin)"
```

---

### Task 4: Preload bridge + renderer types

Expose the `archive` domain on `window.birdbrain` and keep the `BirdbrainAPI` interface in sync.

**Files:**
- Modify: `src/preload/index.ts` (add `archive` object; import `PinArchiveSnapshotParams`, `ArchiveRef`, `WaybackLookupResult`)
- Modify: `src/renderer/env.d.ts` (add `archive` to `BirdbrainAPI`; import the three types)

**Interfaces:**
- Consumes: channels + `PinArchiveSnapshotParams` (Task 3); `ArchiveRef`, `WaybackLookupResult` (Tasks 1–2).
- Produces: `window.birdbrain.archive.{ lookup, list, pin, unpin }`.

- [ ] **Step 1: Add the preload impl**

In `src/preload/index.ts`, add to the `@shared/ipc` import: `PinArchiveSnapshotParams`; add to the `@shared/types` import: `ArchiveRef`, `WaybackLookupResult`. Then add a new domain object to `birdbrain` (e.g. after `notes`):

```ts
  archive: {
    lookup: (captureId: string): Promise<WaybackLookupResult> =>
      unwrapIpc<WaybackLookupResult>(ipcRenderer.invoke(IPC_CHANNELS.ARCHIVE_LOOKUP, captureId)),
    list: (captureId: string): Promise<ArchiveRef[]> =>
      ipcRenderer.invoke(IPC_CHANNELS.ARCHIVE_LIST, captureId),
    pin: (params: PinArchiveSnapshotParams): Promise<ArchiveRef> =>
      unwrapIpc<ArchiveRef>(ipcRenderer.invoke(IPC_CHANNELS.ARCHIVE_PIN, params)),
    unpin: (refId: string): Promise<boolean> =>
      unwrapIpc<boolean>(ipcRenderer.invoke(IPC_CHANNELS.ARCHIVE_UNPIN, refId))
  },
```

- [ ] **Step 2: Add the renderer interface**

In `src/renderer/env.d.ts`, add to the `@shared/types` import: `ArchiveRef`, `WaybackLookupResult`; add to the `@shared/ipc` import: `PinArchiveSnapshotParams`. Then add to the `BirdbrainAPI` interface (after `notes`):

```ts
  archive: {
    lookup(captureId: string): Promise<WaybackLookupResult>
    list(captureId: string): Promise<ArchiveRef[]>
    pin(params: PinArchiveSnapshotParams): Promise<ArchiveRef>
    unpin(refId: string): Promise<boolean>
  }
```

- [ ] **Step 3: Verify types compile**

Run: `pnpm typecheck` (or `pnpm build` if no typecheck script)
Expected: no type errors. `window.birdbrain.archive.lookup` is now typed.

- [ ] **Step 4: Commit**

```bash
git add src/preload/index.ts src/renderer/env.d.ts
git commit -m "feat(wayback): expose archive domain on preload bridge"
```

---

### Task 5: React Query wiring

Query keys, query options, and mutation hooks for the renderer.

**Files:**
- Modify: `src/renderer/lib/queries.ts` (keys + `archiveLookupQueryOptions`, `archivePinsQueryOptions`, `useArchiveMutations`)

**Interfaces:**
- Consumes: `window.birdbrain.archive.*` (Task 4).
- Produces: `archiveLookupQueryOptions(captureId)`, `archivePinsQueryOptions(captureId)`, `useArchiveMutations(captureId)` returning `{ pin, unpin }`.

- [ ] **Step 1: Add query keys**

In `src/renderer/lib/queries.ts`, add to the `queryKeys` object:

```ts
  archiveLookup: (captureId: string) => ['archive', 'lookup', captureId] as const,
  archivePins: (captureId: string) => ['archive', 'pins', captureId] as const,
```

- [ ] **Step 2: Add query options + mutations**

Append a new section to `src/renderer/lib/queries.ts`:

```ts
// --- Archive (Wayback corroboration) ---

// `enabled: false` — the lookup is user-initiated (it discloses the URL to
// archive.org). The ArchiveTab triggers it with refetch() on button click.
export const archiveLookupQueryOptions = (captureId: string) =>
  queryOptions({
    queryKey: queryKeys.archiveLookup(captureId),
    queryFn: () => window.birdbrain.archive.lookup(captureId),
    enabled: false,
    staleTime: 5 * 60 * 1000
  })

export const archivePinsQueryOptions = (captureId: string) =>
  queryOptions({
    queryKey: queryKeys.archivePins(captureId),
    queryFn: () => window.birdbrain.archive.list(captureId)
  })

export function useArchiveMutations(captureId: string) {
  const queryClient = useQueryClient()

  const pin = useMutation({
    mutationFn: (params: Parameters<typeof window.birdbrain.archive.pin>[0]) =>
      window.birdbrain.archive.pin(params),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.archivePins(captureId) })
  })

  const unpin = useMutation({
    mutationFn: (refId: string) => window.birdbrain.archive.unpin(refId),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.archivePins(captureId) })
  })

  return { pin, unpin }
}
```

> Match the exact `queryFn`/`queryOptions` style already used in this file (some entries reference `window.birdbrain`, others a wrapper — follow whichever the file uses for the notes/captures domains).

- [ ] **Step 3: Verify types compile**

Run: `pnpm typecheck` (or `pnpm build`)
Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/lib/queries.ts
git commit -m "feat(wayback): add archive query options and mutation hooks"
```

---

### Task 6: ArchiveTab component + viewer wiring

The UI: idle/loading/result/empty/error/pinned states, wired into the viewer tab strip.

**Files:**
- Create: `src/renderer/components/captures/ArchiveTab.tsx`
- Modify: `src/renderer/components/captures/CaptureViewer.tsx` (add `archive` to `ViewTab`, `TABS`, `TAB_ICONS`, `TAB_LABELS`, and the panel switch)
- Test: `tests/components/ArchiveTab.test.tsx`

**Interfaces:**
- Consumes: `archiveLookupQueryOptions`, `archivePinsQueryOptions`, `useArchiveMutations` (Task 5); `Capture` type.
- Produces: `<ArchiveTab capture={Capture} />` default-style export `export function ArchiveTab(...)`.

- [ ] **Step 1: Write the failing component test**

Create `tests/components/ArchiveTab.test.tsx`. Mirror the setup of an existing capture component test in `tests/components/` (QueryClientProvider wrapper, `window.birdbrain` stub). Example:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ArchiveTab } from '@renderer/components/captures/ArchiveTab'
import type { Capture } from '@shared/types'

const capture = {
  id: 'cap1',
  caseId: 'case1',
  url: 'https://example.com/',
  title: 'Example',
  hash: 'h',
  timestamp: '2020-01-15T12:00:00.000Z',
  createdAt: '2020-01-15T12:00:01.000Z',
  format: 'mhtml'
} as Capture

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ArchiveTab capture={capture} />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  ;(window as unknown as { birdbrain: unknown }).birdbrain = {
    archive: {
      lookup: vi.fn().mockResolvedValue({
        snapshots: [
          {
            timestamp: '2020-01-14T00:00:00.000Z',
            snapshotUrl: 'https://web.archive.org/web/20200114000000/https://example.com/',
            originalUrl: 'https://example.com/',
            statusCode: 200,
            mimeType: 'text/html'
          }
        ],
        closestIndex: 0,
        checkedAt: '2026-06-30T00:00:00.000Z'
      }),
      list: vi.fn().mockResolvedValue([]),
      pin: vi.fn().mockResolvedValue({ id: 'ref1' }),
      unpin: vi.fn().mockResolvedValue(true)
    },
    captures: { openExternal: vi.fn().mockResolvedValue(undefined) }
  }
})

describe('ArchiveTab', () => {
  it('shows the look-up button initially and does not auto-query', () => {
    renderTab()
    expect(screen.getByTestId('archive-lookup-btn')).toBeInTheDocument()
    expect(window.birdbrain.archive.lookup).not.toHaveBeenCalled()
  })

  it('runs the lookup on click and renders snapshots', async () => {
    renderTab()
    fireEvent.click(screen.getByTestId('archive-lookup-btn'))
    await waitFor(() => expect(window.birdbrain.archive.lookup).toHaveBeenCalledWith('cap1'))
    expect(await screen.findByTestId('archive-snapshot-row')).toBeInTheDocument()
  })

  it('renders an empty state when no snapshots are found', async () => {
    ;(window.birdbrain.archive.lookup as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      snapshots: [],
      closestIndex: null,
      checkedAt: '2026-06-30T00:00:00.000Z'
    })
    renderTab()
    fireEvent.click(screen.getByTestId('archive-lookup-btn'))
    expect(await screen.findByTestId('archive-empty')).toBeInTheDocument()
  })
})
```

> Confirm the test setup conventions against an existing file in `tests/components/` (jsdom env, matchers import). Adjust imports to match.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test tests/components/ArchiveTab.test.tsx`
Expected: FAIL — cannot find `ArchiveTab`.

- [ ] **Step 3: Implement ArchiveTab**

Create `src/renderer/components/captures/ArchiveTab.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query'
import { ExternalLink, Pin, PinOff, RefreshCw } from 'lucide-react'
import type { Capture, WaybackSnapshot } from '@shared/types'
import {
  archiveLookupQueryOptions,
  archivePinsQueryOptions,
  useArchiveMutations
} from '@renderer/lib/queries'

interface Props {
  capture: Capture
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString()
}

export function ArchiveTab({ capture }: Props) {
  const lookup = useQuery(archiveLookupQueryOptions(capture.id))
  const pins = useQuery(archivePinsQueryOptions(capture.id))
  const { pin, unpin } = useArchiveMutations(capture.id)

  const result = lookup.data
  const pinnedUrls = new Set((pins.data ?? []).map((r) => r.snapshotUrl))

  const open = (url: string) => void window.birdbrain.captures.openExternal(url)

  return (
    <div className="h-full overflow-y-auto p-5 text-sm">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-text-faint">
            Wayback Machine
          </h3>
          <p className="mt-1 text-xs text-text-muted">
            archive.org&apos;s independent record of this URL. Corroboration only — looking up
            discloses the URL to archive.org.
          </p>
        </div>
        <button
          type="button"
          data-testid="archive-lookup-btn"
          onClick={() => void lookup.refetch()}
          disabled={lookup.isFetching}
          className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-accent hover:bg-accent-subtle disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${lookup.isFetching ? 'animate-spin' : ''}`} />
          {result ? 'Look up again' : 'Look up'}
        </button>
      </div>

      {(pins.data?.length ?? 0) > 0 && (
        <section className="mb-5">
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-faint">
            Pinned
          </h4>
          <ul className="space-y-1">
            {pins.data!.map((ref) => (
              <li
                key={ref.id}
                className="flex items-center justify-between rounded-md border border-border px-3 py-2"
              >
                <span className="text-text-primary">{formatDate(ref.snapshotTimestamp)}</span>
                <span className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => open(ref.snapshotUrl)}
                    className="text-accent hover:underline"
                    aria-label="Open snapshot"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => unpin.mutate(ref.id)}
                    className="text-text-muted hover:text-text-primary"
                    aria-label="Unpin snapshot"
                  >
                    <PinOff className="h-4 w-4" />
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {lookup.isFetching && (
        <div data-testid="archive-loading" className="text-text-muted">
          Querying the Wayback Machine…
        </div>
      )}

      {lookup.isError && !lookup.isFetching && (
        <div data-testid="archive-error" className="text-red-500">
          Lookup failed: {(lookup.error as Error).message}
        </div>
      )}

      {result && !lookup.isFetching && result.snapshots.length === 0 && (
        <div data-testid="archive-empty" className="text-text-muted">
          No archive.org snapshots found for this URL.
        </div>
      )}

      {result && result.snapshots.length > 0 && (
        <ul className="space-y-1">
          {result.snapshots.map((snap, i) => (
            <SnapshotRow
              key={snap.snapshotUrl}
              snapshot={snap}
              isClosest={i === result.closestIndex}
              isPinned={pinnedUrls.has(snap.snapshotUrl)}
              onOpen={() => open(snap.snapshotUrl)}
              onPin={() => pin.mutate({ captureId: capture.id, snapshot: snap })}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function SnapshotRow({
  snapshot,
  isClosest,
  isPinned,
  onOpen,
  onPin
}: {
  snapshot: WaybackSnapshot
  isClosest: boolean
  isPinned: boolean
  onOpen: () => void
  onPin: () => void
}) {
  return (
    <li
      data-testid="archive-snapshot-row"
      className={`flex items-center justify-between rounded-md border px-3 py-2 ${
        isClosest ? 'border-accent bg-accent-subtle' : 'border-border'
      }`}
    >
      <span className="flex items-center gap-2">
        <span className="text-text-primary">{formatDate(snapshot.timestamp)}</span>
        {isClosest && (
          <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-medium text-white">
            closest to capture
          </span>
        )}
        {snapshot.mimeType && (
          <span className="text-xs text-text-faint">{snapshot.mimeType}</span>
        )}
      </span>
      <span className="flex items-center gap-2">
        <button
          type="button"
          onClick={onOpen}
          className="text-accent hover:underline"
          aria-label="Open snapshot"
        >
          <ExternalLink className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={onPin}
          disabled={isPinned}
          className="text-text-muted hover:text-text-primary disabled:opacity-40"
          aria-label={isPinned ? 'Already pinned' : 'Pin snapshot'}
        >
          <Pin className="h-4 w-4" />
        </button>
      </span>
    </li>
  )
}
```

- [ ] **Step 4: Run the component test to verify it passes**

Run: `pnpm test tests/components/ArchiveTab.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire into CaptureViewer**

In `src/renderer/components/captures/CaptureViewer.tsx`:

1. Import the component and an icon:
```ts
import { ArchiveTab } from './ArchiveTab'
```
Add `Archive` to the existing `lucide-react` import.

2. Extend the tab type and arrays:
```ts
type ViewTab = 'screenshot' | 'page' | 'source' | 'text' | 'forensics' | 'archive'

const TABS: ViewTab[] = ['screenshot', 'page', 'source', 'text', 'forensics', 'archive']
```
Add to `TAB_ICONS`: `archive: Archive`
Add to `TAB_LABELS`: `archive: 'Archive'`

3. Add the panel after the forensics panel (the `{activeTab === 'forensics' && ...}` line, ~243):
```tsx
        {activeTab === 'archive' && <ArchiveTab capture={capture} />}
```

> The `contentType` memo already returns `null` for any tab that isn't screenshot/page/source/text, so `archive` needs no change there — content fetching stays off for this tab.

- [ ] **Step 6: Verify the build + full suite**

Run: `pnpm typecheck` (or `pnpm build`), then `pnpm test tests/components/ArchiveTab.test.tsx tests/main/services/waybackMachine.test.ts tests/main/services/archiveRefs.test.ts tests/main/ipcHandlers.test.ts`
Expected: PASS across all; no type errors.

- [ ] **Step 7: Lint**

Run: `pnpm lint`
Expected: no errors in the new/changed files.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/components/captures/ArchiveTab.tsx src/renderer/components/captures/CaptureViewer.tsx tests/components/ArchiveTab.test.tsx
git commit -m "feat(wayback): add Archive tab to capture viewer"
```

---

### Task 7: Manual verification + docs note

- [ ] **Step 1: Manual smoke test**

Run: `pnpm dev`. Open a case with at least one capture of a well-archived URL (e.g. a capture whose `url` is `https://example.com/`). Open the capture → **Archive** tab → click **Look up**.
Expected: a timeline renders, the snapshot nearest the capture time is highlighted "closest to capture", **Open** launches the archive.org page in the system browser, **Pin** moves it into a persistent Pinned section, **Unpin** removes it. Re-selecting the capture preserves pins.

- [ ] **Step 2: Verify empty + error paths**

Use a capture whose `url` is a string archive.org will not have (e.g. a random localhost URL) → expect the empty state. (Optional) temporarily point `CDX_BASE` at an unreachable host to confirm the error state, then revert.

- [ ] **Step 3: Update CLAUDE.md schema note (optional, tiny)**

`CLAUDE.md` says "currently v1-v12". This plan ships v21. If touching docs, correct the line to reflect v21 and add `captures_archive_refs`... — **only if** the user wants the doc refreshed; otherwise leave it (out of scope per scope-discipline rule). Mention it rather than silently editing.

- [ ] **Step 4: Final commit (if any doc change was approved)**

```bash
git add CLAUDE.md
git commit -m "docs: note schema v21 and capture_archive_refs table"
```

---

## Self-Review

**Spec coverage:**
- Archive tab in viewer → Task 6. ✓
- CDX lookup, closest-to-capture + timeline → Task 1 (`closestIndex`) + Task 6 (highlight). ✓
- Open snapshot externally → Task 6 (reuses `captures.openExternal`, which validates http/https). ✓
- Pin/unpin persistence → Tasks 2–6. ✓
- Reference-only now, columns reserved for download-later → Task 2 (comment + omitted columns). ✓
- Explicit, never-automatic lookup → Task 5 (`enabled: false`) + Task 6 (button, copy). ✓
- Bounded timeout / archive down / empty / malformed → Task 1 (timeout, non-2xx throw, malformed skip, empty) + Task 6 (error/empty states). ✓
- Many snapshots → Task 1 (`limit=200`, `collapse=digest`). ✓
- OPSEC disclosure note → Task 6 copy + Task 1/2 comments. ✓
- Testing (unit service, DB CRUD, component states) → Tasks 1, 2, 6. ✓

**Placeholder scan:** No TBD/TODO; every code step has full code. The only deliberate "confirm against existing file" notes are for matching `insertCapture`'s real signature and existing test-harness conventions — these are verification instructions, not missing content.

**Type consistency:** `WaybackSnapshot`/`WaybackLookupResult`/`ArchiveRef` defined in Task 1–2 and consumed identically downstream. `createArchiveRef({ captureId, snapshot, checkedAt })` shape matches between DB (Task 2), handler (Task 3), and tests. Channel names `archive:lookup|list|pin|unpin` consistent across ipc.ts, handlers, preload, env.d.ts. `PinArchiveSnapshotParams { captureId, snapshot }` consistent across Task 3/4/5/6.
