# MHTML Forensic Capture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Birdbrain's flat-HTML capture path with forensically-sound MHTML captures backed by a hash-chained audit manifest that makes each capture independently verifiable and tamper-evident.

**Architecture:** Chrome extension calls `chrome.pageCapture.saveAsMHTML()` (Chromium-native serialization), streams the resulting blob as `multipart/form-data` to the local Hono server. The server streams the MHTML to disk while computing SHA-256 in a single pass, appends a canonical-JSON entry to a per-case hash-chained JSONL manifest (write-ahead, before the DB transaction), and inserts the capture row with `format='mhtml'`. Deletion events write a separate entry type to the same chain. The viewer uses an Electron `<webview>` with JavaScript disabled to render MHTML files offline. Legacy `format='html'` captures remain viewable via the existing sandboxed iframe.

**Tech Stack:** Electron 39, Hono HTTP server, better-sqlite3 (sync), Node `crypto.createHash` + streams, Chrome Manifest V3 `pageCapture` API, React 19, Electron `<webview>` tag.

---

## File Structure

**New files:**
- `src/main/services/installationId.ts` - Generate/persist operator UUID (~30 LoC)
- `src/main/services/canonicalJson.ts` - Deterministic JSON stringification (~25 LoC)
- `src/main/services/manifest.ts` - Hash-chained JSONL audit manifest service (~200 LoC)
- `src/main/services/mhtmlIngest.ts` - Streaming write+hash + capture pipeline (~180 LoC)
- `src/renderer/components/captures/MhtmlViewer.tsx` - Electron `<webview>` wrapper (~80 LoC)
- `src/renderer/components/captures/ProvenanceBadge.tsx` - Verified/Tampered badge (~70 LoC)
- Tests: `installationId.test.ts`, `canonicalJson.test.ts`, `manifest.test.ts`, `mhtmlIngest.test.ts`

**Modified files:**
- `src/shared/types.ts` - Extend `Capture` with forensic fields
- `src/shared/ipc.ts` - Add `CAPTURES_VERIFY` and payload types
- `src/shared/constants.ts` - Add `MAX_MHTML_SIZE`, manifest filename
- `src/main/services/settings.ts` - Add `operatorName` default
- `src/main/services/storage.ts` - `.mhtml` extension support, deletion helper update
- `src/main/services/database.ts` - Migration v11, updated `InsertCaptureParams`, `rowToCapture`
- `src/main/services/captureServer.ts` - Replace JSON capture endpoint with multipart
- `src/main/index.ts` - Init manifest + installation ID, enable `webviewTag`
- `src/main/ipcHandlers.ts` - Add verify handler, write deletion manifest entry
- `src/preload/index.ts` - Expose `verify` and `getIdentity`
- `src/renderer/components/captures/CaptureViewer.tsx` - Route by `format`
- `src/renderer/components/settings/SettingsView.tsx` + new operator settings card
- `extension/manifest.json` - Add `pageCapture` permission
- `extension/src/utils/api.ts` - Replace `sendCapture` with `sendMhtmlCapture` (FormData)
- `extension/src/background.ts` - Replace capture path to use `chrome.pageCapture.saveAsMHTML`
- `extension/src/content.ts` - Remove `EXTRACT_PAGE` handler (freeze-dry)
- `package.json` - Remove `freeze-dry` dependency
- `tests/main/services/captureServer.test.ts` - Switch to multipart assertions
- `tests/main/services/database.test.ts` - Cover new migration + insert fields

---

## Task 1: Add MHTML constants

**Files:**
- Modify: `src/shared/constants.ts`

- [ ] **Step 1: Read the existing constants file**

Run: Read `src/shared/constants.ts` to confirm current content.

- [ ] **Step 2: Add MHTML-related constants**

Append to `src/shared/constants.ts`:

```ts
// Hard cap on MHTML upload size (bytes). 200 MB matches UI guidance in settings.
export const MAX_MHTML_SIZE = 200 * 1024 * 1024

// Audit manifest filename, written alongside captures in each case directory.
export const MANIFEST_FILENAME = 'manifest.jsonl'

// Bump whenever the manifest entry schema changes (e.g. new required fields).
export const MANIFEST_SCHEMA_VERSION = 1
```

- [ ] **Step 3: Commit**

```bash
git add src/shared/constants.ts
git commit -m "feat: add MHTML constants for upload cap and manifest"
```

---

## Task 2: Extend the Capture type with forensic fields

**Files:**
- Modify: `src/shared/types.ts`

- [ ] **Step 1: Add optional forensic fields to `Capture` interface**

Replace the `Capture` interface in `src/shared/types.ts` with:

```ts
export type CaptureFormat = 'html' | 'mhtml'

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
}
```

- [ ] **Step 2: Broaden `HashVerification` status union**

Replace the existing `HashVerification` interface in `src/shared/types.ts`:

```ts
export interface HashVerification {
  captureId: string
  url: string
  title: string
  storedHash: string
  computedHash: string
  status: 'verified' | 'tampered' | 'missing' | 'chain-broken' | 'legacy'
  manifestIndex?: number
  chainValid?: boolean
  reason?: string
}
```

- [ ] **Step 3: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat: extend Capture type with forensic MHTML fields"
```

---

## Task 3: Add `operatorName` to settings

**Files:**
- Modify: `src/shared/types.ts`, `src/main/services/settings.ts`
- Test: `tests/main/services/settings.test.ts`

- [ ] **Step 1: Add `operatorName` to `BirdbrainSettings`**

In `src/shared/types.ts`, add `operatorName: string` to the `BirdbrainSettings` interface (just after `theme`):

```ts
export interface BirdbrainSettings {
  openRouterApiKey: string | null
  defaultModel: string
  captureScreenshots: boolean
  captureHtml: boolean
  dedupeWindowSeconds: number
  ignoredUrlPatterns: string[]
  storagePath: string
  maxStorageMb: number | null
  theme: 'dark' | 'light'
  operatorName: string
  autoCaptureMode: AutoCaptureMode
}
```

- [ ] **Step 2: Write the failing test**

Append inside the existing `describe` block in `tests/main/services/settings.test.ts`:

```ts
it('returns empty operatorName by default', () => {
  const s = getSettings()
  expect(s.operatorName).toBe('')
})

it('persists operatorName updates', () => {
  updateSettings({ operatorName: 'Det. Smith' })
  expect(getSettings().operatorName).toBe('Det. Smith')
})
```

- [ ] **Step 3: Run the test to verify failure**

Run: `pnpm test -- settings`
Expected: FAIL with `operatorName` undefined.

- [ ] **Step 4: Add default to `DEFAULT_SETTINGS`**

In `src/main/services/settings.ts`, update `DEFAULT_SETTINGS`:

```ts
const DEFAULT_SETTINGS: BirdbrainSettings = {
  openRouterApiKey: null,
  defaultModel: 'anthropic/claude-sonnet-4',
  captureScreenshots: true,
  captureHtml: true,
  dedupeWindowSeconds: 60,
  ignoredUrlPatterns: [],
  storagePath: '',
  maxStorageMb: null,
  theme: 'light',
  operatorName: '',
  autoCaptureMode: 'notify'
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test -- settings`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/main/services/settings.ts tests/main/services/settings.test.ts
git commit -m "feat: add operatorName to settings"
```

---

## Task 4: Installation ID service

**Files:**
- Create: `src/main/services/installationId.ts`
- Test: `tests/main/services/installationId.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/main/services/installationId.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  initInstallationId,
  getInstallationId,
  resetInstallationId
} from '@main/services/installationId'

describe('installationId', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-install-'))
    resetInstallationId()
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('generates a new UUID on first init', () => {
    initInstallationId(tempDir)
    const id = getInstallationId()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(existsSync(join(tempDir, 'installation-id'))).toBe(true)
  })

  it('returns the same UUID across restarts', () => {
    initInstallationId(tempDir)
    const first = getInstallationId()
    resetInstallationId()
    initInstallationId(tempDir)
    expect(getInstallationId()).toBe(first)
  })

  it('throws when accessed before init', () => {
    expect(() => getInstallationId()).toThrow(/not initialized/)
  })

  it('preserves existing id written manually', () => {
    const manual = '12345678-1234-1234-1234-123456789012'
    writeFileSync(join(tempDir, 'installation-id'), manual, 'utf-8')
    initInstallationId(tempDir)
    expect(getInstallationId()).toBe(manual)
  })
})
```

- [ ] **Step 2: Run the test to verify failure**

Run: `pnpm test -- installationId`
Expected: FAIL - module does not exist.

- [ ] **Step 3: Implement the installation ID service**

Create `src/main/services/installationId.ts`:

```ts
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'

let cachedId: string | null = null

export function initInstallationId(userDataPath: string): void {
  const idPath = join(userDataPath, 'installation-id')
  if (existsSync(idPath)) {
    const raw = readFileSync(idPath, 'utf-8').trim()
    if (raw) {
      cachedId = raw
      return
    }
  }
  const fresh = randomUUID()
  writeFileSync(idPath, fresh, 'utf-8')
  cachedId = fresh
}

export function getInstallationId(): string {
  if (!cachedId) throw new Error('Installation ID not initialized')
  return cachedId
}

// For testing - allows resetting module state between test cases
export function resetInstallationId(): void {
  cachedId = null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- installationId`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/services/installationId.ts tests/main/services/installationId.test.ts
git commit -m "feat: add persistent installation ID service"
```

---

## Task 5: Database migration v11 for MHTML columns

**Files:**
- Modify: `src/main/services/database.ts`
- Test: `tests/main/services/database.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/main/services/database.test.ts` inside the outermost describe:

```ts
describe("migration v11 (MHTML columns)", () => {
  it("adds format column with default html", () => {
    const caseId = createCase({ name: "Migration Case" }).id
    insertCapture({
      caseId,
      url: "https://example.com",
      title: "Example",
      hash: "deadbeef",
      timestamp: new Date().toISOString()
    })
    const row = getDb()
      .prepare("SELECT format FROM captures WHERE case_id = ?")
      .get(caseId) as { format: string }
    expect(row.format).toBe("html")
  })

  it("sets user_version to 11", () => {
    const version = getDb().pragma("user_version", { simple: true }) as number
    expect(version).toBeGreaterThanOrEqual(11)
  })

  it("has all MHTML columns", () => {
    const cols = getDb()
      .prepare("PRAGMA table_info(captures)")
      .all() as Array<{ name: string }>
    const names = cols.map((c) => c.name)
    const expected = [
      "format", "mhtml_path", "size_bytes", "manifest_index",
      "prev_hash", "entry_hash", "tool_version", "extension_version",
      "browser_version", "user_agent", "http_status", "operator_id", "operator_name"
    ]
    for (const col of expected) {
      expect(names).toContain(col)
    }
  })
})
```

- [ ] **Step 2: Run the test to verify failure**

Run: `pnpm test -- database`
Expected: FAIL - format column missing.

- [ ] **Step 3: Add migration v11 to database.ts**

In `src/main/services/database.ts`, append inside the `migrate()` function after the `version < 10` block:

```ts
  if (version < 11) {
    db.transaction(() => {
      db.exec(`
        ALTER TABLE captures ADD COLUMN format TEXT NOT NULL DEFAULT 'html';
        ALTER TABLE captures ADD COLUMN mhtml_path TEXT;
        ALTER TABLE captures ADD COLUMN size_bytes INTEGER;
        ALTER TABLE captures ADD COLUMN manifest_index INTEGER;
        ALTER TABLE captures ADD COLUMN prev_hash TEXT;
        ALTER TABLE captures ADD COLUMN entry_hash TEXT;
        ALTER TABLE captures ADD COLUMN tool_version TEXT;
        ALTER TABLE captures ADD COLUMN extension_version TEXT;
        ALTER TABLE captures ADD COLUMN browser_version TEXT;
        ALTER TABLE captures ADD COLUMN user_agent TEXT;
        ALTER TABLE captures ADD COLUMN http_status INTEGER;
        ALTER TABLE captures ADD COLUMN operator_id TEXT;
        ALTER TABLE captures ADD COLUMN operator_name TEXT;
        CREATE INDEX IF NOT EXISTS idx_captures_format ON captures(format);
        CREATE INDEX IF NOT EXISTS idx_captures_manifest_index ON captures(case_id, manifest_index);
      `)
      db.pragma("user_version = 11")
    })()
  }
```

Note: Use actual single quotes around `'html'` in the SQL (SQLite requires single-quoted string literals), and backticks around the whole SQL string.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- database`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/database.ts tests/main/services/database.test.ts
git commit -m "feat: add migration v11 for MHTML capture columns"
```

---

## Task 6: Extend `insertCapture` and `rowToCapture` for MHTML fields

**Files:**
- Modify: `src/main/services/database.ts`
- Test: `tests/main/services/database.test.ts`

- [ ] **Step 1: Write the failing test**

Append to the `describe("captures", ...)` block in `tests/main/services/database.test.ts`:

```ts
it("inserts and retrieves MHTML capture with all forensic fields", () => {
  const caseId = createCase({ name: "Forensic Case" }).id
  const cap = insertCapture({
    caseId,
    url: "https://example.com",
    title: "Example",
    hash: "a".repeat(64),
    timestamp: new Date().toISOString(),
    format: "mhtml",
    mhtmlPath: "case-id/cap-id.mhtml",
    sizeBytes: 12345,
    manifestIndex: 0,
    prevHash: "",
    entryHash: "b".repeat(64),
    toolVersion: "0.1.0",
    extensionVersion: "0.1.0",
    browserVersion: "Chrome/120",
    userAgent: "Mozilla/5.0",
    httpStatus: 200,
    operatorId: "11111111-1111-1111-1111-111111111111",
    operatorName: "Det. Smith"
  })

  const retrieved = getCapture(cap.id)!
  expect(retrieved.format).toBe("mhtml")
  expect(retrieved.mhtmlPath).toBe("case-id/cap-id.mhtml")
  expect(retrieved.sizeBytes).toBe(12345)
  expect(retrieved.manifestIndex).toBe(0)
  expect(retrieved.entryHash).toBe("b".repeat(64))
  expect(retrieved.toolVersion).toBe("0.1.0")
  expect(retrieved.operatorName).toBe("Det. Smith")
})

it("defaults legacy captures to format=html", () => {
  const caseId = createCase({ name: "Legacy Case" }).id
  const cap = insertCapture({
    caseId,
    url: "https://example.com",
    title: "Example",
    hash: "c".repeat(64),
    timestamp: new Date().toISOString()
  })
  expect(getCapture(cap.id)!.format).toBe("html")
})
```

- [ ] **Step 2: Run the test to verify failure**

Run: `pnpm test -- database`
Expected: FAIL.

- [ ] **Step 3: Extend `InsertCaptureParams` interface**

In `src/main/services/database.ts`, update:

```ts
export interface InsertCaptureParams {
  caseId: string
  url: string
  title: string
  hash: string
  timestamp: string
  htmlPath?: string
  screenshotPath?: string
  headers?: string
  textContent?: string
  format?: "html" | "mhtml"
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
}
```

- [ ] **Step 4: Update `insertCapture` function body**

Replace the INSERT statement and its `.run()` call inside `insertCapture` (within the transaction) with the expanded column list:

```ts
    d.prepare(
      `INSERT INTO captures (
         id, case_id, url, title, html_path, screenshot_path, hash, timestamp, headers, created_at,
         format, mhtml_path, size_bytes, manifest_index, prev_hash, entry_hash,
         tool_version, extension_version, browser_version, user_agent, http_status,
         operator_id, operator_name
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      params.caseId,
      params.url,
      params.title,
      params.htmlPath ?? null,
      params.screenshotPath ?? null,
      params.hash,
      params.timestamp,
      params.headers ?? null,
      now,
      params.format ?? "html",
      params.mhtmlPath ?? null,
      params.sizeBytes ?? null,
      params.manifestIndex ?? null,
      params.prevHash ?? null,
      params.entryHash ?? null,
      params.toolVersion ?? null,
      params.extensionVersion ?? null,
      params.browserVersion ?? null,
      params.userAgent ?? null,
      params.httpStatus ?? null,
      params.operatorId ?? null,
      params.operatorName ?? null
    )
```

- [ ] **Step 5: Update `rowToCapture`**

Replace the `rowToCapture` function:

```ts
function rowToCapture(row: Record<string, unknown>): Capture {
  return {
    id: row.id as string,
    caseId: row.case_id as string,
    url: row.url as string,
    title: row.title as string,
    htmlPath: (row.html_path as string) || undefined,
    screenshotPath: (row.screenshot_path as string) || undefined,
    hash: row.hash as string,
    timestamp: row.timestamp as string,
    headers: (row.headers as string) || undefined,
    createdAt: row.created_at as string,
    format: ((row.format as string) || "html") as CaptureFormat,
    mhtmlPath: (row.mhtml_path as string) || undefined,
    sizeBytes: (row.size_bytes as number) ?? undefined,
    manifestIndex: (row.manifest_index as number) ?? undefined,
    prevHash: (row.prev_hash as string) || undefined,
    entryHash: (row.entry_hash as string) || undefined,
    toolVersion: (row.tool_version as string) || undefined,
    extensionVersion: (row.extension_version as string) || undefined,
    browserVersion: (row.browser_version as string) || undefined,
    userAgent: (row.user_agent as string) || undefined,
    httpStatus: (row.http_status as number) ?? undefined,
    operatorId: (row.operator_id as string) || undefined,
    operatorName: (row.operator_name as string) || undefined
  }
}
```

Add `CaptureFormat` to the type import at the top of the file:

```ts
import type {
  Case,
  Capture,
  CaptureFormat,
  Tag,
  Selector,
  ActiveCaseSelectors,
  Note,
  SelectorMatchExportRow
} from "@shared/types"
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm test -- database`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/main/services/database.ts tests/main/services/database.test.ts
git commit -m "feat: extend insertCapture and rowToCapture for MHTML fields"
```

---

## Task 7: Canonical JSON helper

**Files:**
- Create: `src/main/services/canonicalJson.ts`
- Test: `tests/main/services/canonicalJson.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/main/services/canonicalJson.test.ts`:

```ts
import { describe, it, expect } from "vitest"
import { canonicalStringify } from "@main/services/canonicalJson"

describe("canonicalStringify", () => {
  it("sorts object keys alphabetically", () => {
    expect(canonicalStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
  })

  it("produces identical output regardless of insertion order", () => {
    const a = canonicalStringify({ b: 1, a: 2, c: 3 })
    const b = canonicalStringify({ c: 3, a: 2, b: 1 })
    expect(a).toBe(b)
  })

  it("handles nested objects deterministically", () => {
    expect(canonicalStringify({ y: { d: 1, c: 2 }, x: 1 })).toBe('{"x":1,"y":{"c":2,"d":1}}')
  })

  it("handles arrays preserving order", () => {
    expect(canonicalStringify({ items: [3, 1, 2] })).toBe('{"items":[3,1,2]}')
  })

  it("emits valid JSON for primitives", () => {
    expect(canonicalStringify("hi")).toBe('"hi"')
    expect(canonicalStringify(42)).toBe("42")
    expect(canonicalStringify(null)).toBe("null")
    expect(canonicalStringify(true)).toBe("true")
  })

  it("contains no whitespace", () => {
    const out = canonicalStringify({ a: 1, b: { c: 2 } })
    expect(out).not.toMatch(/\s/)
  })
})
```

- [ ] **Step 2: Run the test to verify failure**

Run: `pnpm test -- canonicalJson`
Expected: FAIL - module missing.

- [ ] **Step 3: Implement canonicalStringify**

Create `src/main/services/canonicalJson.ts`:

```ts
// Deterministic JSON stringification: keys sorted alphabetically, no whitespace.
// Used to produce stable input for hashing manifest entries.
export function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalStringify).join(",") + "]"
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  const parts = keys.map((k) => JSON.stringify(k) + ":" + canonicalStringify(obj[k]))
  return "{" + parts.join(",") + "}"
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test -- canonicalJson`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/services/canonicalJson.ts tests/main/services/canonicalJson.test.ts
git commit -m "feat: add canonical JSON stringify helper"
```

---

## Task 8: Manifest service - init and getHead

**Files:**
- Create: `src/main/services/manifest.ts`
- Test: `tests/main/services/manifest.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/main/services/manifest.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { initManifest, getManifestHead } from "@main/services/manifest"

describe("manifest init/getHead", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "birdbrain-manifest-"))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it("creates manifest file on first init", () => {
    initManifest(tempDir)
    expect(existsSync(join(tempDir, "manifest.jsonl"))).toBe(true)
  })

  it("returns empty head for new manifest", () => {
    initManifest(tempDir)
    const head = getManifestHead(tempDir)
    expect(head.prevHash).toBe("")
    expect(head.nextIndex).toBe(0)
  })

  it("is idempotent - does not truncate existing manifest", () => {
    initManifest(tempDir)
    const path = join(tempDir, "manifest.jsonl")
    writeFileSync(path, '{"hello":"world"}\n')
    initManifest(tempDir)
    const content = readFileSync(path, "utf-8")
    expect(content).toContain("hello")
  })
})
```

- [ ] **Step 2: Run the test to verify failure**

Run: `pnpm test -- manifest`
Expected: FAIL - module missing.

- [ ] **Step 3: Implement init and getHead**

Create `src/main/services/manifest.ts`:

```ts
import {
  existsSync,
  closeSync,
  openSync,
  statSync,
  readFileSync
} from "fs"
import { join } from "path"
import { MANIFEST_FILENAME } from "@shared/constants"

export interface ManifestHead {
  prevHash: string
  nextIndex: number
}

// Ensures the manifest file exists for a given case directory.
export function initManifest(caseDir: string): void {
  const path = join(caseDir, MANIFEST_FILENAME)
  if (!existsSync(path)) {
    const fd = openSync(path, "a")
    closeSync(fd)
  }
}

// Reads the last line to determine prevHash + next index.
// O(N) on manifest size but only called once per append; manifests are small.
export function getManifestHead(caseDir: string): ManifestHead {
  const path = join(caseDir, MANIFEST_FILENAME)
  if (!existsSync(path) || statSync(path).size === 0) {
    return { prevHash: "", nextIndex: 0 }
  }
  const raw = readFileSync(path, "utf-8")
  const lines = raw.split("\n").filter((l) => l.trim().length > 0)
  if (lines.length === 0) return { prevHash: "", nextIndex: 0 }
  const last = JSON.parse(lines[lines.length - 1]) as {
    index: number
    entryHash: string
  }
  return { prevHash: last.entryHash, nextIndex: last.index + 1 }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test -- manifest`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/services/manifest.ts tests/main/services/manifest.test.ts
git commit -m "feat: add manifest init and getHead"
```

---

## Task 9: Manifest service - append with write-ahead pattern

**Files:**
- Modify: `src/main/services/manifest.ts`
- Test: `tests/main/services/manifest.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/main/services/manifest.test.ts`:

```ts
import { appendManifestEntry, rollbackManifestEntry } from "@main/services/manifest"
import { createHash } from "crypto"
import { canonicalStringify } from "@main/services/canonicalJson"

describe("manifest append", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "birdbrain-append-"))
    initManifest(tempDir)
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  const baseEntry = {
    type: "capture" as const,
    caseId: "case-1",
    url: "https://example.com",
    timestamp: "2026-04-05T12:00:00.000Z",
    contentHash: "a".repeat(64),
    sizeBytes: 1234,
    operatorId: "op-1",
    operatorName: "",
    toolVersion: "0.1.0"
  }

  it("appends a capture entry with correct index and linking", () => {
    const result = appendManifestEntry(tempDir, { ...baseEntry, captureId: "cap-1" })
    expect(result.index).toBe(0)
    expect(result.prevHash).toBe("")
    expect(result.entryHash).toMatch(/^[0-9a-f]{64}$/)

    const raw = readFileSync(join(tempDir, "manifest.jsonl"), "utf-8")
    expect(raw.trim().split("\n")).toHaveLength(1)
  })

  it("links subsequent entries via prevHash = previous entryHash", () => {
    const first = appendManifestEntry(tempDir, { ...baseEntry, captureId: "cap-1" })
    const second = appendManifestEntry(tempDir, {
      ...baseEntry,
      captureId: "cap-2",
      url: "https://example.com/2",
      timestamp: "2026-04-05T12:01:00.000Z",
      contentHash: "b".repeat(64),
      sizeBytes: 2345
    })
    expect(second.index).toBe(1)
    expect(second.prevHash).toBe(first.entryHash)
    expect(second.entryHash).not.toBe(first.entryHash)
  })

  it("rollbackManifestEntry truncates back to anchor byte", () => {
    const anchor = statSync(join(tempDir, "manifest.jsonl")).size
    appendManifestEntry(tempDir, { ...baseEntry, captureId: "cap-1" })
    const afterAppend = statSync(join(tempDir, "manifest.jsonl")).size
    expect(afterAppend).toBeGreaterThan(anchor)

    rollbackManifestEntry(tempDir, anchor)
    expect(statSync(join(tempDir, "manifest.jsonl")).size).toBe(anchor)
  })

  it("entryHash matches SHA-256 of canonical-JSON body", () => {
    const body = {
      ...baseEntry,
      captureId: "cap-1",
      index: 0,
      prevHash: "",
      schemaVersion: 1
    }
    const expected = createHash("sha256").update(canonicalStringify(body)).digest("hex")
    const result = appendManifestEntry(tempDir, { ...baseEntry, captureId: "cap-1" })
    expect(result.entryHash).toBe(expected)
  })
})
```

- [ ] **Step 2: Run the tests to verify failure**

Run: `pnpm test -- manifest`
Expected: FAIL - `appendManifestEntry` / `rollbackManifestEntry` not exported.

- [ ] **Step 3: Add entry type + append/rollback implementations**

Append to `src/main/services/manifest.ts`:

```ts
import { createHash } from "crypto"
import { writeSync, fsyncSync, truncateSync } from "fs"
import { canonicalStringify } from "@main/services/canonicalJson"
import { MANIFEST_SCHEMA_VERSION } from "@shared/constants"

export type ManifestEntryInput =
  | {
      type: "capture"
      captureId: string
      caseId: string
      url: string
      timestamp: string
      contentHash: string
      sizeBytes: number
      operatorId: string
      operatorName: string
      toolVersion: string
    }
  | {
      type: "deletion"
      captureId: string
      caseId: string
      timestamp: string
      contentHash: string
      operatorId: string
      operatorName: string
      toolVersion: string
      reason?: string
    }

export interface AppendResult {
  index: number
  prevHash: string
  entryHash: string
  anchorBytes: number
}

// Write-ahead append: compute hash, append JSONL line, fsync.
// Caller must call rollbackManifestEntry(anchorBytes) if a later step fails.
export function appendManifestEntry(
  caseDir: string,
  entry: ManifestEntryInput
): AppendResult {
  const path = join(caseDir, MANIFEST_FILENAME)
  const anchorBytes = existsSync(path) ? statSync(path).size : 0
  const { prevHash, nextIndex } = getManifestHead(caseDir)

  const body: Record<string, unknown> = {
    ...entry,
    index: nextIndex,
    prevHash,
    schemaVersion: MANIFEST_SCHEMA_VERSION
  }
  const canonical = canonicalStringify(body)
  const entryHash = createHash("sha256").update(canonical).digest("hex")
  const fullEntry = { ...body, entryHash }
  const line = JSON.stringify(fullEntry) + "\n"

  const fd = openSync(path, "a")
  try {
    writeSync(fd, line)
    fsyncSync(fd)
  } finally {
    closeSync(fd)
  }

  return { index: nextIndex, prevHash, entryHash, anchorBytes }
}

// Truncates the manifest file back to the byte offset captured before append.
// Used to roll back a write-ahead append when a downstream step fails.
export function rollbackManifestEntry(caseDir: string, anchorBytes: number): void {
  const path = join(caseDir, MANIFEST_FILENAME)
  truncateSync(path, anchorBytes)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test -- manifest`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/services/manifest.ts tests/main/services/manifest.test.ts
git commit -m "feat: add write-ahead manifest append with hash chaining"
```

---

## Task 10: Manifest service - chain verification

**Files:**
- Modify: `src/main/services/manifest.ts`
- Test: `tests/main/services/manifest.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/main/services/manifest.test.ts`:

```ts
import { verifyManifestChain } from "@main/services/manifest"
import { appendFileSync } from "fs"

describe("manifest verifyManifestChain", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "birdbrain-verify-"))
    initManifest(tempDir)
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  const base = {
    type: "capture" as const,
    caseId: "case-1",
    timestamp: "2026-04-05T12:00:00.000Z",
    contentHash: "a".repeat(64),
    sizeBytes: 1,
    operatorId: "op",
    operatorName: "",
    toolVersion: "0.1.0"
  }

  it("returns valid=true for empty manifest", () => {
    expect(verifyManifestChain(tempDir).valid).toBe(true)
  })

  it("returns valid=true for a well-formed chain", () => {
    appendManifestEntry(tempDir, { ...base, captureId: "c1", url: "https://a" })
    appendManifestEntry(tempDir, {
      ...base,
      captureId: "c2",
      url: "https://b",
      timestamp: "2026-04-05T12:01:00.000Z",
      contentHash: "b".repeat(64)
    })
    expect(verifyManifestChain(tempDir)).toEqual({ valid: true })
  })

  it("detects tampering by mutating an entry", () => {
    appendManifestEntry(tempDir, { ...base, captureId: "c1", url: "https://a" })
    const path = join(tempDir, "manifest.jsonl")
    const raw = readFileSync(path, "utf-8")
    writeFileSync(path, raw.replace("https://a", "https://evil"))
    const result = verifyManifestChain(tempDir)
    expect(result.valid).toBe(false)
    expect(result.brokenAt).toBe(0)
  })

  it("detects broken link between entries", () => {
    appendManifestEntry(tempDir, { ...base, captureId: "c1", url: "https://a" })
    const badLine = JSON.stringify({
      type: "capture",
      captureId: "c2",
      caseId: "case-1",
      url: "https://b",
      timestamp: "2026-04-05T12:01:00.000Z",
      contentHash: "b".repeat(64),
      sizeBytes: 2,
      operatorId: "op",
      operatorName: "",
      toolVersion: "0.1.0",
      index: 1,
      prevHash: "wrong-hash",
      schemaVersion: 1,
      entryHash: "anything"
    }) + "\n"
    appendFileSync(join(tempDir, "manifest.jsonl"), badLine)
    const result = verifyManifestChain(tempDir)
    expect(result.valid).toBe(false)
    expect(result.brokenAt).toBe(1)
  })
})
```

- [ ] **Step 2: Run the tests to verify failure**

Run: `pnpm test -- manifest`
Expected: FAIL - `verifyManifestChain` not exported.

- [ ] **Step 3: Implement verifyManifestChain**

Append to `src/main/services/manifest.ts`:

```ts
export interface ChainVerifyResult {
  valid: boolean
  brokenAt?: number
  reason?: string
}

// Re-reads the manifest, recomputes each entryHash, and checks linkage.
// Returns the zero-based index of the first broken entry if any.
export function verifyManifestChain(caseDir: string): ChainVerifyResult {
  const path = join(caseDir, MANIFEST_FILENAME)
  if (!existsSync(path) || statSync(path).size === 0) {
    return { valid: true }
  }
  const raw = readFileSync(path, "utf-8")
  const lines = raw.split("\n").filter((l) => l.trim().length > 0)
  let expectedPrev = ""
  let expectedIndex = 0

  for (let i = 0; i < lines.length; i++) {
    let entry: Record<string, unknown>
    try {
      entry = JSON.parse(lines[i])
    } catch {
      return { valid: false, brokenAt: i, reason: "Invalid JSON" }
    }
    const { entryHash, ...body } = entry
    if (body.index !== expectedIndex) {
      return { valid: false, brokenAt: i, reason: "Index mismatch" }
    }
    if (body.prevHash !== expectedPrev) {
      return { valid: false, brokenAt: i, reason: "Chain link broken" }
    }
    const recomputed = createHash("sha256").update(canonicalStringify(body)).digest("hex")
    if (recomputed !== entryHash) {
      return { valid: false, brokenAt: i, reason: "Entry hash mismatch" }
    }
    expectedPrev = entryHash as string
    expectedIndex++
  }
  return { valid: true }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test -- manifest`
Expected: PASS (11 tests total).

- [ ] **Step 5: Commit**

```bash
git add src/main/services/manifest.ts tests/main/services/manifest.test.ts
git commit -m "feat: add manifest chain verification"
```

---

## Task 11: Storage - MHTML file extension support

**Files:**
- Modify: `src/main/services/storage.ts`
- Test: `tests/main/services/storage.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/main/services/storage.test.ts`:

```ts
it("returns correct .mhtml path", () => {
  const path = getCapturePath("case-1", "cap-1", "mhtml")
  expect(path).toContain("cap-1.mhtml")
})

it("deleteCaptureFiles removes .mhtml files too", () => {
  const dir = join(tempDir, "case-1")
  require("fs").mkdirSync(dir, { recursive: true })
  require("fs").writeFileSync(join(dir, "cap-1.mhtml"), "fake mhtml")
  require("fs").writeFileSync(join(dir, "cap-1.html"), "fake html")
  deleteCaptureFiles("case-1", "cap-1")
  expect(existsSync(join(dir, "cap-1.mhtml"))).toBe(false)
  expect(existsSync(join(dir, "cap-1.html"))).toBe(false)
})
```

- [ ] **Step 2: Run the tests to verify failure**

Run: `pnpm test -- storage`
Expected: FAIL.

- [ ] **Step 3: Add "mhtml" to the file-type union**

In `src/main/services/storage.ts`, update `getCapturePath`, `readCaptureFile`, and `deleteCaptureFiles`:

```ts
export function getCapturePath(
  caseId: string,
  captureId: string,
  type: "html" | "png" | "txt" | "mhtml"
): string {
  const ext = type === "png" ? "png" : type === "txt" ? "txt" : type === "mhtml" ? "mhtml" : "html"
  return join(getStorageRoot(), caseId, `${captureId}.${ext}`)
}

export function readCaptureFile(
  caseId: string,
  captureId: string,
  type: "html" | "png" | "txt" | "mhtml"
): Buffer | null {
  const path = getCapturePath(caseId, captureId, type)
  if (!existsSync(path)) return null
  return readFileSync(path)
}

export function deleteCaptureFiles(caseId: string, captureId: string): void {
  for (const ext of ["html", "png", "txt", "mhtml"] as const) {
    const path = getCapturePath(caseId, captureId, ext)
    if (existsSync(path)) {
      unlinkSync(path)
    }
  }
  const thumbPath = join(getStorageRoot(), caseId, `${captureId}_thumb.jpg`)
  if (existsSync(thumbPath)) {
    unlinkSync(thumbPath)
  }
}
```

- [ ] **Step 4: Export `ensureCaseDir`**

Add the `export` keyword to `ensureCaseDir` in `src/main/services/storage.ts`:

```ts
export function ensureCaseDir(caseId: string): string {
  const dir = join(getStorageRoot(), caseId)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test -- storage`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/services/storage.ts tests/main/services/storage.test.ts
git commit -m "feat: support .mhtml files in storage helpers"
```

---

## Task 12: MHTML ingest service - streaming write+hash

**Files:**
- Create: `src/main/services/mhtmlIngest.ts`
- Test: `tests/main/services/mhtmlIngest.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/main/services/mhtmlIngest.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdtempSync, rmSync, readFileSync, existsSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import { createHash } from "crypto"
import { initStorage } from "@main/services/storage"
import { streamWriteAndHash } from "@main/services/mhtmlIngest"
import { Readable } from "stream"

describe("streamWriteAndHash", () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "birdbrain-ingest-"))
    initStorage(tempDir)
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it("writes stream to disk and returns SHA-256 + size", async () => {
    const content = Buffer.from("hello mhtml world")
    const stream = Readable.from([content])
    const result = await streamWriteAndHash(
      "case-x",
      "cap-x",
      stream as unknown as ReadableStream<Uint8Array>
    )
    expect(result.hash).toBe(createHash("sha256").update(content).digest("hex"))
    expect(result.sizeBytes).toBe(content.length)
    expect(result.mhtmlPath).toBe(join("case-x", "cap-x.mhtml"))

    const onDisk = readFileSync(join(tempDir, "case-x", "cap-x.mhtml"))
    expect(onDisk.equals(content)).toBe(true)
  })

  it("aborts and deletes partial file when size cap exceeded", async () => {
    const oneMb = Buffer.alloc(1024 * 1024, 0x41)
    async function* gen() {
      for (let i = 0; i < 210; i++) yield oneMb
    }
    const stream = Readable.from(gen())
    await expect(
      streamWriteAndHash("case-x", "cap-big", stream as unknown as ReadableStream<Uint8Array>)
    ).rejects.toThrow(/size.*exceed/i)
    expect(existsSync(join(tempDir, "case-x", "cap-big.mhtml"))).toBe(false)
  })

  it("hashes large streams in a single pass", async () => {
    const chunk = Buffer.alloc(64 * 1024, 0x7a)
    const expected = createHash("sha256")
    async function* gen() {
      for (let i = 0; i < 10; i++) {
        expected.update(chunk)
        yield chunk
      }
    }
    const stream = Readable.from(gen())
    const result = await streamWriteAndHash(
      "case-x",
      "cap-big-ok",
      stream as unknown as ReadableStream<Uint8Array>
    )
    expect(result.hash).toBe(expected.digest("hex"))
    expect(result.sizeBytes).toBe(64 * 1024 * 10)
  })
})
```

- [ ] **Step 2: Run the tests to verify failure**

Run: `pnpm test -- mhtmlIngest`
Expected: FAIL - module does not exist.

- [ ] **Step 3: Implement streamWriteAndHash**

Create `src/main/services/mhtmlIngest.ts`:

```ts
import { createWriteStream } from "fs"
import { unlink } from "fs/promises"
import { join } from "path"
import { createHash } from "crypto"
import { finished } from "stream/promises"
import { ensureCaseDir } from "@main/services/storage"
import { MAX_MHTML_SIZE } from "@shared/constants"

export interface StreamWriteResult {
  mhtmlPath: string // relative path (caseId/captureId.mhtml)
  hash: string
  sizeBytes: number
}

// Streams an MHTML upload to disk in a single pass while computing SHA-256.
// Aborts (and removes the partial file) if size exceeds MAX_MHTML_SIZE.
export async function streamWriteAndHash(
  caseId: string,
  captureId: string,
  body: ReadableStream<Uint8Array>
): Promise<StreamWriteResult> {
  const dir = ensureCaseDir(caseId)
  const absPath = join(dir, `${captureId}.mhtml`)
  const relPath = join(caseId, `${captureId}.mhtml`)

  const writeStream = createWriteStream(absPath)
  const hasher = createHash("sha256")
  let size = 0

  try {
    const reader = body.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_MHTML_SIZE) {
        writeStream.destroy()
        await unlink(absPath).catch(() => {})
        throw new Error(`MHTML size ${size} exceeds cap of ${MAX_MHTML_SIZE} bytes`)
      }
      hasher.update(value)
      if (!writeStream.write(value)) {
        await new Promise<void>((resolve) => writeStream.once("drain", () => resolve()))
      }
    }
    writeStream.end()
    await finished(writeStream)
  } catch (err) {
    writeStream.destroy()
    await unlink(absPath).catch(() => {})
    throw err
  }

  return { mhtmlPath: relPath, hash: hasher.digest("hex"), sizeBytes: size }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test -- mhtmlIngest`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/services/mhtmlIngest.ts tests/main/services/mhtmlIngest.test.ts
git commit -m "feat: add streaming write+hash for MHTML uploads"
```

---

## Task 13: MHTML ingest service - full pipeline

**Files:**
- Modify: `src/main/services/mhtmlIngest.ts`
- Test: `tests/main/services/mhtmlIngest.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `tests/main/services/mhtmlIngest.test.ts`:

```ts
import {
  initDatabase,
  closeDatabase,
  createCase,
  getCapture
} from "@main/services/database"
import { initManifest, verifyManifestChain } from "@main/services/manifest"
import { ingestMhtmlCapture } from "@main/services/mhtmlIngest"

describe("ingestMhtmlCapture", () => {
  let tempDir: string
  let caseId: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "birdbrain-ingest-pipeline-"))
    initStorage(join(tempDir, "captures"))
    initDatabase(":memory:")
    caseId = createCase({ name: "Pipeline" }).id
    initManifest(join(tempDir, "captures", caseId))
  })

  afterEach(() => {
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it("ingests an MHTML capture, writes manifest, inserts DB row", async () => {
    const content = Buffer.from("From: <Saved by Chrome>\nContent-Type: multipart/related\n\nhi")
    const stream = Readable.from([content])
    const result = await ingestMhtmlCapture({
      caseId,
      url: "https://example.com",
      title: "Example",
      timestamp: "2026-04-05T12:00:00.000Z",
      stream: stream as unknown as ReadableStream<Uint8Array>,
      textContent: "hi",
      headers: { "content-type": "text/html" },
      browserVersion: "Chrome/120",
      userAgent: "Mozilla/5.0",
      httpStatus: 200,
      extensionVersion: "0.1.0",
      operatorId: "op-1",
      operatorName: "Smith",
      toolVersion: "0.1.0"
    })

    expect(result.capture.format).toBe("mhtml")
    expect(result.capture.hash).toBe(result.contentHash)
    expect(result.capture.manifestIndex).toBe(0)
    expect(result.capture.entryHash).toMatch(/^[0-9a-f]{64}$/)

    const reloaded = getCapture(result.capture.id)
    expect(reloaded?.mhtmlPath).toBe(join(caseId, `${result.capture.id}.mhtml`))
    expect(verifyManifestChain(join(tempDir, "captures", caseId)).valid).toBe(true)
  })

  it("rolls back manifest when DB insert fails", async () => {
    const stream = Readable.from([Buffer.from("x")])
    await expect(
      ingestMhtmlCapture({
        caseId: "does-not-exist",
        url: "https://example.com",
        title: "x",
        timestamp: "2026-04-05T12:00:00.000Z",
        stream: stream as unknown as ReadableStream<Uint8Array>,
        textContent: "x",
        headers: {},
        browserVersion: "",
        userAgent: "",
        httpStatus: 200,
        extensionVersion: "",
        operatorId: "",
        operatorName: "",
        toolVersion: ""
      })
    ).rejects.toThrow()

    const bogusManifest = join(tempDir, "captures", "does-not-exist", "manifest.jsonl")
    if (existsSync(bogusManifest)) {
      expect(readFileSync(bogusManifest, "utf-8")).toBe("")
    }
  })
})
```

- [ ] **Step 2: Run the tests to verify failure**

Run: `pnpm test -- mhtmlIngest`
Expected: FAIL - `ingestMhtmlCapture` not exported.

- [ ] **Step 3: Add ingestMhtmlCapture to mhtmlIngest.ts**

Append to `src/main/services/mhtmlIngest.ts`:

```ts
import { randomUUID } from "crypto"
import * as db from "@main/services/database"
import { getStorageRoot } from "@main/services/storage"
import {
  initManifest,
  appendManifestEntry,
  rollbackManifestEntry
} from "@main/services/manifest"
import type { Capture } from "@shared/types"

export interface IngestParams {
  caseId: string
  url: string
  title: string
  timestamp: string
  stream: ReadableStream<Uint8Array>
  textContent: string
  headers: Record<string, string>
  browserVersion: string
  userAgent: string
  httpStatus: number
  extensionVersion: string
  operatorId: string
  operatorName: string
  toolVersion: string
}

export interface IngestResult {
  capture: Capture
  contentHash: string
}

// End-to-end MHTML ingest:
// 1. Stream-write + hash to disk
// 2. Append write-ahead manifest entry (sync fs ops)
// 3. Synchronously insert DB row with manifest fields
// 4. On DB failure: rollback manifest + delete file
export async function ingestMhtmlCapture(params: IngestParams): Promise<IngestResult> {
  const captureId = randomUUID()
  const { mhtmlPath, hash, sizeBytes } = await streamWriteAndHash(
    params.caseId,
    captureId,
    params.stream
  )

  const caseDir = join(getStorageRoot(), params.caseId)
  initManifest(caseDir)
  const manifestResult = appendManifestEntry(caseDir, {
    type: "capture",
    captureId,
    caseId: params.caseId,
    url: params.url,
    timestamp: params.timestamp,
    contentHash: hash,
    sizeBytes,
    operatorId: params.operatorId,
    operatorName: params.operatorName,
    toolVersion: params.toolVersion
  })

  try {
    const capture = db.insertCapture({
      id: captureId,
      caseId: params.caseId,
      url: params.url,
      title: params.title,
      hash,
      timestamp: params.timestamp,
      headers: JSON.stringify(params.headers),
      textContent: params.textContent,
      format: "mhtml",
      mhtmlPath,
      sizeBytes,
      manifestIndex: manifestResult.index,
      prevHash: manifestResult.prevHash,
      entryHash: manifestResult.entryHash,
      toolVersion: params.toolVersion,
      extensionVersion: params.extensionVersion,
      browserVersion: params.browserVersion,
      userAgent: params.userAgent,
      httpStatus: params.httpStatus,
      operatorId: params.operatorId,
      operatorName: params.operatorName
    })
    return { capture, contentHash: hash }
  } catch (err) {
    rollbackManifestEntry(caseDir, manifestResult.anchorBytes)
    const { unlink } = await import("fs/promises")
    await unlink(join(getStorageRoot(), mhtmlPath)).catch(() => {})
    throw err
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test -- mhtmlIngest`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/services/mhtmlIngest.ts tests/main/services/mhtmlIngest.test.ts
git commit -m "feat: add ingestMhtmlCapture pipeline with manifest rollback"
```

---

## Task 14: Capture server - multipart MHTML endpoint

**Files:**
- Modify: `src/main/services/captureServer.ts`, `src/shared/ipc.ts`
- Test: `tests/main/services/captureServer.test.ts`

- [ ] **Step 1: Replace `SaveCaptureParams` in the IPC types**

In `src/shared/ipc.ts`, replace `SaveCaptureParams` with:

```ts
export interface SaveMhtmlCaptureParams {
  caseId?: string // required for manual/selector sources
  source: "auto" | "manual" | "selector"
  url: string
  title: string
  timestamp: string
  textContent: string
  headers?: Record<string, string>
  browserVersion?: string
  userAgent?: string
  httpStatus?: number
  extensionVersion?: string
  matchedSelectors?: unknown
  // MHTML bytes are sent as the multipart "mhtml" file field, not JSON.
}
```

Remove the old `SaveCaptureParams` interface.

- [ ] **Step 2: Write the failing test**

In `tests/main/services/captureServer.test.ts`, update imports to include `listCaptures`:

```ts
import {
  initDatabase,
  closeDatabase,
  createCase,
  createSelector,
  updateCase,
  listCaptures,
  listSelectors,
  getSelectorMatchCounts
} from "@main/services/database"
```

Find the existing test group that POSTs JSON to `/api/captures` and replace it with:

```ts
describe("POST /api/captures (multipart MHTML)", () => {
  async function postMhtml(
    fields: Record<string, string>,
    body: Buffer,
    filename = "capture.mhtml"
  ): Promise<Response> {
    const form = new FormData()
    for (const [k, v] of Object.entries(fields)) form.append(k, v)
    form.append("mhtml", new Blob([body], { type: "multipart/related" }), filename)
    return fetch(`${baseUrl}/api/captures`, { method: "POST", body: form })
  }

  it("rejects when mhtml field is missing", async () => {
    const c = createCase({ name: "X" })
    const form = new FormData()
    form.append("caseId", c.id)
    form.append("source", "manual")
    form.append("url", "https://example.com")
    form.append("title", "X")
    form.append("timestamp", new Date().toISOString())
    const res = await fetch(`${baseUrl}/api/captures`, { method: "POST", body: form })
    expect(res.status).toBe(400)
  })

  it("stores a manual MHTML capture", async () => {
    const c = createCase({ name: "Y" })
    const mhtmlBytes = Buffer.from("<html><body>y</body></html>")
    const res = await postMhtml(
      {
        caseId: c.id,
        source: "manual",
        url: "https://example.com/y",
        title: "Y",
        timestamp: new Date().toISOString(),
        textContent: "y",
        extensionVersion: "0.1.0",
        browserVersion: "Chrome/120",
        userAgent: "Mozilla/5.0"
      },
      mhtmlBytes
    )
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.captureId).toBeDefined()
    expect(data.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(data.manifestIndex).toBe(0)

    const rows = listCaptures(c.id)
    expect(rows).toHaveLength(1)
    expect(rows[0].format).toBe("mhtml")
  })
})
```

Also in the test file's `beforeEach`, add installation-id init:

```ts
import { initInstallationId, resetInstallationId } from "@main/services/installationId"
// Inside beforeEach, after initSettings:
resetInstallationId()
initInstallationId(tempDir)
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm test -- captureServer`
Expected: FAIL.

- [ ] **Step 4: Add imports to captureServer.ts**

Add near the top of `src/main/services/captureServer.ts`:

```ts
import { ingestMhtmlCapture } from "@main/services/mhtmlIngest"
import { getInstallationId } from "@main/services/installationId"
```

- [ ] **Step 5: Replace the capture endpoint body**

In `src/main/services/captureServer.ts`, replace the entire `app.post("/api/captures", ...)` handler body with multipart handling. The new body reads `c.req.parseBody()`, extracts fields, resolves `caseId` by source, runs URL blacklist + dedup checks, then calls `ingestMhtmlCapture()` with the file `stream()`. Return JSON with `{ captureId, hash, manifestIndex, status: "ok", source }`.

Full replacement:

```ts
  app.post("/api/captures", async (c) => {
    const startTime = Date.now()
    let source: CaptureSource = "auto"
    let capturedUrl = ""
    try {
      const body = await c.req.parseBody()
      const rawSource = body["source"]
      if (
        typeof rawSource !== "string" ||
        !VALID_CAPTURE_SOURCES.includes(rawSource as CaptureSource)
      ) {
        return c.json({ error: "Invalid source" }, 400)
      }
      source = rawSource as CaptureSource
      const url = typeof body["url"] === "string" ? body["url"] : ""
      const title = typeof body["title"] === "string" ? body["title"] : url
      const timestamp =
        typeof body["timestamp"] === "string" ? body["timestamp"] : new Date().toISOString()
      const textContent = typeof body["textContent"] === "string" ? body["textContent"] : ""
      const extensionVersion =
        typeof body["extensionVersion"] === "string" ? body["extensionVersion"] : ""
      const browserVersion =
        typeof body["browserVersion"] === "string" ? body["browserVersion"] : ""
      const userAgent = typeof body["userAgent"] === "string" ? body["userAgent"] : ""
      const httpStatusRaw = body["httpStatus"]
      const httpStatus = typeof httpStatusRaw === "string" ? parseInt(httpStatusRaw, 10) || 0 : 0
      const caseIdField = typeof body["caseId"] === "string" ? body["caseId"] : ""
      capturedUrl = url

      const mhtmlField = body["mhtml"]
      if (!(mhtmlField instanceof File) && !(mhtmlField instanceof Blob)) {
        return c.json({ error: "Missing required field: mhtml (file)" }, 400)
      }
      if (!url) {
        return c.json({ error: "Missing required field: url" }, 400)
      }

      const captureSettings = getSettings()
      const blocked = isUrlBlacklisted(url, captureSettings.ignoredUrlPatterns)
      if (blocked) {
        emitCaptureEvent({
          type: "skipped",
          source,
          url,
          timestamp: new Date().toISOString(),
          skipReason: "Blacklisted: " + blocked
        })
        return c.json({ error: "URL blocked by ignored pattern", pattern: blocked }, 403)
      }

      let caseId = ""
      if (source === "auto") {
        if (!state.sessionActive) return c.json({ error: "No active session" }, 400)
        if (!state.activeCaseId) return c.json({ error: "No active case" }, 400)
        caseId = state.activeCaseId
      } else {
        if (!caseIdField) return c.json({ error: "Missing required field: caseId" }, 400)
        const caseData = db.getCase(caseIdField)
        if (!caseData) return c.json({ error: "Case not found" }, 404)
        if (caseData.archived) return c.json({ error: "Case is archived" }, 400)
        caseId = caseIdField
      }

      if (source === "manual") {
        const dedupeKey = caseId + ":" + url
        const lastSeen = manualDedup.get(dedupeKey)
        if (lastSeen && Date.now() - lastSeen < MANUAL_DEDUPE_WINDOW_MS) {
          emitCaptureEvent({
            type: "skipped",
            source,
            url,
            timestamp: new Date().toISOString(),
            skipReason: "Duplicate manual capture"
          })
          return c.json({ error: "Duplicate capture", status: "skipped" }, 409)
        }
        manualDedup.set(dedupeKey, Date.now())
      }

      emitCaptureEvent({ type: "received", source, url, timestamp: new Date().toISOString() })

      const operatorId = getInstallationId()
      const operatorName = captureSettings.operatorName ?? ""
      const toolVersion = process.env.npm_package_version ?? "0.0.0"

      const { capture, contentHash } = await ingestMhtmlCapture({
        caseId,
        url,
        title,
        timestamp,
        stream: mhtmlField.stream(),
        textContent,
        headers: {},
        browserVersion,
        userAgent,
        httpStatus,
        extensionVersion,
        operatorId,
        operatorName,
        toolVersion
      })

      if (source === "auto") state.captureCount++
      schedulePostCaptureWork(capture.id, caseId, source, url, textContent)

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC_CHANNELS.NEW_CAPTURE, capture)
      }

      const durationMs = Date.now() - startTime
      emitCaptureEvent({
        type: "stored",
        captureId: capture.id,
        source,
        url,
        timestamp: new Date().toISOString(),
        durationMs
      })

      return c.json({
        captureId: capture.id,
        hash: contentHash,
        manifestIndex: capture.manifestIndex,
        status: "ok",
        source
      })
    } catch (err) {
      console.error("Capture error:", err)
      emitCaptureEvent({
        type: "failed",
        source,
        url: capturedUrl,
        timestamp: new Date().toISOString(),
        error: String(err)
      })
      return c.json({ error: "Failed to process capture" }, 500)
    }
  })
```

- [ ] **Step 6: Update the `/api/captures/test` endpoint**

Replace the pipeline-test endpoint in `captureServer.ts` so it also uses `ingestMhtmlCapture` instead of the old `saveCapture` + `insertCapture` path. Body:

```ts
  app.get("/api/captures/test", async (c) => {
    const startTime = Date.now()
    let testCaptureId: string | null = null
    let testCaseId: string | null = null
    try {
      const cases = db.listCases()
      if (cases.length === 0) {
        return c.json({
          success: false,
          durationMs: 0,
          error: "No cases exist - create a case first"
        })
      }
      testCaseId = cases[0].id
      const testBody = Buffer.from("<html><body>test</body></html>")
      const { Readable } = await import("stream")
      const stream = Readable.from([testBody])

      emitCaptureEvent({
        type: "received",
        source: "manual",
        url: "birdbrain://pipeline-test",
        timestamp: new Date().toISOString()
      })

      const { capture } = await ingestMhtmlCapture({
        caseId: testCaseId,
        url: "birdbrain://pipeline-test",
        title: "Pipeline Test",
        timestamp: new Date().toISOString(),
        stream: stream as unknown as ReadableStream<Uint8Array>,
        textContent: "",
        headers: {},
        browserVersion: "",
        userAgent: "",
        httpStatus: 200,
        extensionVersion: "",
        operatorId: getInstallationId(),
        operatorName: getSettings().operatorName ?? "",
        toolVersion: process.env.npm_package_version ?? "0.0.0"
      })
      testCaptureId = capture.id

      const durationMs = Date.now() - startTime
      emitCaptureEvent({
        type: "stored",
        captureId: capture.id,
        source: "manual",
        url: "birdbrain://pipeline-test",
        timestamp: new Date().toISOString(),
        durationMs
      })
      return c.json({ success: true, durationMs })
    } catch (err) {
      return c.json({ success: false, durationMs: Date.now() - startTime, error: String(err) })
    } finally {
      if (testCaptureId) {
        try {
          db.deleteCapture(testCaptureId)
        } catch {
          /* best effort */
        }
      }
      if (testCaseId && testCaptureId) {
        try {
          deleteCaptureFiles(testCaseId, testCaptureId)
        } catch {
          /* best effort */
        }
      }
    }
  })
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `pnpm test -- captureServer`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/main/services/captureServer.ts src/shared/ipc.ts tests/main/services/captureServer.test.ts
git commit -m "feat: replace capture endpoint with multipart MHTML upload"
```

---

## Task 15: Wire installation ID into startup and enable webview tag

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: Initialize installation ID and enable webviewTag**

Update `src/main/index.ts`:

```ts
import { app, BrowserWindow, shell } from "electron"
import { join } from "path"
import { is } from "@electron-toolkit/utils"
import { initDatabase, closeDatabase } from "@main/services/database"
import { initStorage } from "@main/services/storage"
import {
  startCaptureServer,
  stopCaptureServer,
  setMainWindow,
  startExtensionConnectionCheck,
  stopExtensionConnectionCheck
} from "@main/services/captureServer"
import { registerIpcHandlers } from "@main/ipcHandlers"
import { initSettings } from "@main/services/settings"
import { initInstallationId } from "@main/services/installationId"
```

In `createWindow()`, add `webviewTag: true` to the `webPreferences`:

```ts
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      sandbox: false,
      webviewTag: true
    }
```

And in `app.whenReady().then(async () => { ... })`, add `initInstallationId(userDataPath)` just after `initSettings(userDataPath)`:

```ts
  initDatabase(join(userDataPath, "birdbrain.db"))
  initStorage(join(userDataPath, "captures"))
  initSettings(userDataPath)
  initInstallationId(userDataPath)
```

- [ ] **Step 2: Verify the app still builds**

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: init installation ID and enable webview tag at startup"
```

---

## Task 16: Verify capture IPC handler

**Files:**
- Modify: `src/main/services/mhtmlIngest.ts`, `src/shared/ipc.ts`, `src/main/ipcHandlers.ts`, `src/preload/index.ts`
- Test: `tests/main/services/mhtmlIngest.test.ts`

- [ ] **Step 1: Add the IPC channel**

In `src/shared/ipc.ts`, add to the `IPC_CHANNELS` const under the Captures block:

```ts
  CAPTURES_VERIFY: "captures:verify",
```

- [ ] **Step 2: Add verifyCapture to mhtmlIngest.ts**

Append to `src/main/services/mhtmlIngest.ts`:

```ts
import { createReadStream } from "fs"
import type { HashVerification } from "@shared/types"
import { verifyManifestChain } from "@main/services/manifest"

// Streams the MHTML file from disk, recomputes SHA-256, and checks the manifest chain.
export async function verifyCapture(captureId: string): Promise<HashVerification> {
  const capture = db.getCapture(captureId)
  if (!capture) {
    return {
      captureId,
      url: "",
      title: "",
      storedHash: "",
      computedHash: "",
      status: "missing",
      reason: "Capture not found"
    }
  }
  if (capture.format !== "mhtml" || !capture.mhtmlPath) {
    return {
      captureId,
      url: capture.url,
      title: capture.title,
      storedHash: capture.hash,
      computedHash: "",
      status: "legacy",
      reason: "Legacy HTML capture (pre-MHTML era)"
    }
  }

  const absPath = join(getStorageRoot(), capture.mhtmlPath)
  const hasher = createHash("sha256")
  try {
    await new Promise<void>((resolve, reject) => {
      const rs = createReadStream(absPath)
      rs.on("data", (chunk) => hasher.update(chunk))
      rs.on("end", () => resolve())
      rs.on("error", reject)
    })
  } catch (err) {
    return {
      captureId,
      url: capture.url,
      title: capture.title,
      storedHash: capture.hash,
      computedHash: "",
      status: "missing",
      reason: "MHTML file unreadable: " + String(err)
    }
  }
  const computed = hasher.digest("hex")

  const chain = verifyManifestChain(join(getStorageRoot(), capture.caseId))
  if (!chain.valid) {
    return {
      captureId,
      url: capture.url,
      title: capture.title,
      storedHash: capture.hash,
      computedHash: computed,
      status: "chain-broken",
      manifestIndex: capture.manifestIndex,
      chainValid: false,
      reason: chain.reason
    }
  }
  if (computed !== capture.hash) {
    return {
      captureId,
      url: capture.url,
      title: capture.title,
      storedHash: capture.hash,
      computedHash: computed,
      status: "tampered",
      manifestIndex: capture.manifestIndex,
      chainValid: true
    }
  }
  return {
    captureId,
    url: capture.url,
    title: capture.title,
    storedHash: capture.hash,
    computedHash: computed,
    status: "verified",
    manifestIndex: capture.manifestIndex,
    chainValid: true
  }
}
```

- [ ] **Step 3: Register the IPC handler**

In `src/main/ipcHandlers.ts`, add after the other CAPTURES_* handlers:

```ts
  ipcMain.handle(IPC_CHANNELS.CAPTURES_VERIFY, async (_, captureId: string) => {
    try {
      const mod = await import("@main/services/mhtmlIngest")
      return ipcResult(await mod.verifyCapture(captureId))
    } catch (err) {
      return ipcError(err)
    }
  })
```

- [ ] **Step 4: Expose `verify` via preload**

In `src/preload/index.ts`, add inside the `captures:` object (alongside `download`):

```ts
    verify: (captureId: string): Promise<import("@shared/types").HashVerification> =>
      unwrapIpc<import("@shared/types").HashVerification>(
        ipcRenderer.invoke(IPC_CHANNELS.CAPTURES_VERIFY, captureId)
      ),
```

- [ ] **Step 5: Write the failing tests**

Append to `tests/main/services/mhtmlIngest.test.ts`:

```ts
describe("verifyCapture", () => {
  let tempDir: string
  let caseId: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "birdbrain-verify-"))
    initStorage(join(tempDir, "captures"))
    initDatabase(":memory:")
    caseId = createCase({ name: "V" }).id
    initManifest(join(tempDir, "captures", caseId))
  })

  afterEach(() => {
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it("returns verified for intact capture", async () => {
    const stream = Readable.from([Buffer.from("payload")])
    const { verifyCapture } = await import("@main/services/mhtmlIngest")
    const { capture } = await ingestMhtmlCapture({
      caseId,
      url: "https://a",
      title: "A",
      timestamp: "2026-04-05T12:00:00.000Z",
      stream: stream as unknown as ReadableStream<Uint8Array>,
      textContent: "",
      headers: {},
      browserVersion: "",
      userAgent: "",
      httpStatus: 200,
      extensionVersion: "",
      operatorId: "op",
      operatorName: "",
      toolVersion: "0.1.0"
    })
    const r = await verifyCapture(capture.id)
    expect(r.status).toBe("verified")
    expect(r.storedHash).toBe(r.computedHash)
  })

  it("returns tampered when MHTML bytes change", async () => {
    const stream = Readable.from([Buffer.from("payload")])
    const { verifyCapture } = await import("@main/services/mhtmlIngest")
    const { capture } = await ingestMhtmlCapture({
      caseId,
      url: "https://a",
      title: "A",
      timestamp: "2026-04-05T12:00:00.000Z",
      stream: stream as unknown as ReadableStream<Uint8Array>,
      textContent: "",
      headers: {},
      browserVersion: "",
      userAgent: "",
      httpStatus: 200,
      extensionVersion: "",
      operatorId: "op",
      operatorName: "",
      toolVersion: "0.1.0"
    })
    const absPath = join(tempDir, "captures", capture.mhtmlPath!)
    require("fs").writeFileSync(absPath, "mutated")
    const r = await verifyCapture(capture.id)
    expect(r.status).toBe("tampered")
  })

  it("returns legacy for pre-MHTML captures", async () => {
    const legacy = db.insertCapture({
      caseId,
      url: "https://legacy",
      title: "Legacy",
      hash: "x".repeat(64),
      timestamp: new Date().toISOString()
    })
    const { verifyCapture } = await import("@main/services/mhtmlIngest")
    const r = await verifyCapture(legacy.id)
    expect(r.status).toBe("legacy")
  })
})
```

Also add `import * as db from "@main/services/database"` at the top of the test file if missing.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm test -- mhtmlIngest`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/main/services/mhtmlIngest.ts src/main/ipcHandlers.ts src/preload/index.ts src/shared/ipc.ts tests/main/services/mhtmlIngest.test.ts
git commit -m "feat: add verifyCapture IPC with hash + chain check"
```

---

## Task 17: Deletion manifest entries

**Files:**
- Modify: `src/main/ipcHandlers.ts`
- Test: `tests/main/services/mhtmlIngest.test.ts`

- [ ] **Step 1: Update the CAPTURES_DELETE handler**

In `src/main/ipcHandlers.ts`, replace the `CAPTURES_DELETE` handler body with:

```ts
  ipcMain.handle(IPC_CHANNELS.CAPTURES_DELETE, (_, id: string) => {
    try {
      const capture = db.getCapture(id)
      if (!capture) return ipcResult(false)

      // For MHTML captures, append a deletion entry to the manifest BEFORE the
      // DB delete. On DB failure, roll back the manifest entry.
      if (capture.format === "mhtml") {
        const manifestMod =
          require("@main/services/manifest") as typeof import("@main/services/manifest")
        const storageMod =
          require("@main/services/storage") as typeof import("@main/services/storage")
        const idMod =
          require("@main/services/installationId") as typeof import("@main/services/installationId")
        const settingsMod =
          require("@main/services/settings") as typeof import("@main/services/settings")
        const pathMod = require("path") as typeof import("path")

        const caseDir = pathMod.join(storageMod.getStorageRoot(), capture.caseId)
        manifestMod.initManifest(caseDir)
        const result = manifestMod.appendManifestEntry(caseDir, {
          type: "deletion",
          captureId: id,
          caseId: capture.caseId,
          timestamp: new Date().toISOString(),
          contentHash: capture.hash,
          operatorId: idMod.getInstallationId(),
          operatorName: settingsMod.getSettings().operatorName ?? "",
          toolVersion: process.env.npm_package_version ?? "0.0.0"
        })

        try {
          const deleted = db.deleteCapture(id)
          if (deleted) storage.deleteCaptureFiles(capture.caseId, id)
          return ipcResult(deleted)
        } catch (err) {
          manifestMod.rollbackManifestEntry(caseDir, result.anchorBytes)
          throw err
        }
      }

      // Legacy HTML capture - no manifest entry
      const deleted = db.deleteCapture(id)
      if (deleted) storage.deleteCaptureFiles(capture.caseId, id)
      return ipcResult(deleted)
    } catch (err) {
      return ipcError(err)
    }
  })
```

- [ ] **Step 2: Write the failing test**

Add to `tests/main/services/mhtmlIngest.test.ts`:

```ts
describe("deletion manifest entry", () => {
  let tempDir: string
  let caseId: string
  let caseDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "birdbrain-del-"))
    initStorage(join(tempDir, "captures"))
    initDatabase(":memory:")
    caseId = createCase({ name: "D" }).id
    caseDir = join(tempDir, "captures", caseId)
    initManifest(caseDir)
  })

  afterEach(() => {
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it("appends deletion entry after capture entry and chain verifies", async () => {
    const { verifyManifestChain, appendManifestEntry } = await import("@main/services/manifest")
    const stream = Readable.from([Buffer.from("x")])
    const { capture } = await ingestMhtmlCapture({
      caseId,
      url: "https://a",
      title: "A",
      timestamp: "2026-04-05T12:00:00.000Z",
      stream: stream as unknown as ReadableStream<Uint8Array>,
      textContent: "",
      headers: {},
      browserVersion: "",
      userAgent: "",
      httpStatus: 200,
      extensionVersion: "",
      operatorId: "op",
      operatorName: "",
      toolVersion: "0.1.0"
    })

    appendManifestEntry(caseDir, {
      type: "deletion",
      captureId: capture.id,
      caseId,
      timestamp: "2026-04-05T13:00:00.000Z",
      contentHash: capture.hash,
      operatorId: "op",
      operatorName: "",
      toolVersion: "0.1.0"
    })

    expect(verifyManifestChain(caseDir).valid).toBe(true)
    const raw = readFileSync(join(caseDir, "manifest.jsonl"), "utf-8")
    const lines = raw.trim().split("\n")
    expect(lines).toHaveLength(2)
    expect(JSON.parse(lines[1]).type).toBe("deletion")
  })
})
```

- [ ] **Step 3: Run the tests to verify they pass**

Run: `pnpm test -- mhtmlIngest`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/main/ipcHandlers.ts tests/main/services/mhtmlIngest.test.ts
git commit -m "feat: append deletion entries to audit manifest"
```

---

## Task 18: Extension - add pageCapture permission

**Files:**
- Modify: `extension/manifest.json`

- [ ] **Step 1: Add `pageCapture` to the permissions array**

Edit `extension/manifest.json` and add `"pageCapture"` to the `permissions` array:

```json
  "permissions": [
    "activeTab",
    "tabs",
    "scripting",
    "storage",
    "contextMenus",
    "pageCapture"
  ],
```

- [ ] **Step 2: Commit**

```bash
git add extension/manifest.json
git commit -m "feat: add pageCapture permission to extension manifest"
```

---

## Task 19: Extension API - sendMhtmlCapture (FormData)

**Files:**
- Modify: `extension/src/utils/api.ts`

- [ ] **Step 1: Replace `sendCapture` with `sendMhtmlCapture`**

In `extension/src/utils/api.ts`:

1. Remove the old `sendCapture` function entirely.
2. Update the `CaptureResult` interface to include `manifestIndex`:

```ts
interface CaptureResult {
  captureId: string
  hash: string
  status: string
  source: string
  manifestIndex?: number
}
```

3. Add the new function:

```ts
export async function sendMhtmlCapture(params: {
  source: "auto" | "manual" | "selector"
  caseId?: string
  url: string
  title: string
  timestamp: string
  textContent: string
  mhtml: Blob
  browserVersion: string
  userAgent: string
  extensionVersion: string
  httpStatus?: number
  matchedSelectors?: SelectorMatchInfo[]
}): Promise<CaptureResult> {
  const form = new FormData()
  form.append("source", params.source)
  if (params.caseId) form.append("caseId", params.caseId)
  form.append("url", params.url)
  form.append("title", params.title)
  form.append("timestamp", params.timestamp)
  form.append("textContent", params.textContent)
  form.append("browserVersion", params.browserVersion)
  form.append("userAgent", params.userAgent)
  form.append("extensionVersion", params.extensionVersion)
  if (params.httpStatus !== undefined) form.append("httpStatus", String(params.httpStatus))
  if (params.matchedSelectors) {
    form.append("matchedSelectors", JSON.stringify(params.matchedSelectors))
  }
  form.append("mhtml", params.mhtml, "capture.mhtml")

  const res = await fetch(BASE_URL + "/api/captures", { method: "POST", body: form })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = await res.json()
      detail = body.error || detail
    } catch {
      /* no JSON body */
    }
    throw new ApiError(res.status, res.statusText, detail)
  }
  return res.json() as Promise<CaptureResult>
}
```

- [ ] **Step 2: Verify extension build still compiles**

Run: `pnpm build:extension`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add extension/src/utils/api.ts
git commit -m "feat: add sendMhtmlCapture FormData uploader"
```

---

## Task 20: Extension - MHTML capture in background worker

**Files:**
- Modify: `extension/src/background.ts`

- [ ] **Step 1: Update imports**

Change the top import in `extension/src/background.ts` to:

```ts
import {
  getStatus,
  sendMhtmlCapture,
  getActiveSelectors,
  createSelector
} from "@extension/utils/api"
```

- [ ] **Step 2: Add MHTML helper functions**

Near the top of the file (after imports, before the DEFAULT_IGNORE constant), add:

```ts
function captureMhtml(tabId: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    chrome.pageCapture.saveAsMHTML({ tabId }, (blob) => {
      if (chrome.runtime.lastError || !blob) {
        reject(new Error(chrome.runtime.lastError?.message || "pageCapture failed"))
        return
      }
      resolve(blob)
    })
  })
}

function getExtensionVersion(): string {
  return chrome.runtime.getManifest().version
}

function getUserAgentString(): string {
  return typeof navigator !== "undefined" ? navigator.userAgent : ""
}

function getBrowserVersion(): string {
  const match =
    typeof navigator !== "undefined" ? navigator.userAgent.match(/Chrome\/(\S+)/) : null
  return match ? "Chrome/" + match[1] : ""
}

async function getPlainTextFromTab(tabId: number): Promise<string> {
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => document.body?.innerText ?? ""
    })
    return (results[0]?.result as string) ?? ""
  } catch {
    return ""
  }
}
```

- [ ] **Step 3: Rewrite `captureTab`**

Replace the body of `captureTab`:

```ts
async function captureTab(tabId: number, url: string): Promise<void> {
  try {
    const [mhtmlBlob, tab, textContent] = await Promise.all([
      captureMhtml(tabId),
      chrome.tabs.get(tabId),
      getPlainTextFromTab(tabId)
    ])

    await sendMhtmlCapture({
      source: "auto",
      url,
      title: tab.title || url,
      timestamp: new Date().toISOString(),
      textContent,
      mhtml: mhtmlBlob,
      browserVersion: getBrowserVersion(),
      userAgent: getUserAgentString(),
      extensionVersion: getExtensionVersion(),
      httpStatus: 200
    })

    dedupeMap.set(url, Date.now())
    captureCount++
    chrome.action.setBadgeText({ text: String(captureCount) })
  } catch (err) {
    console.error("Capture failed:", err)
  }
}
```

- [ ] **Step 4: Rewrite `manualCaptureTab`**

Replace the body of `manualCaptureTab`:

```ts
async function manualCaptureTab(tabId: number, url: string, caseId: string): Promise<void> {
  const key = tabId + ":" + caseId
  if (pendingManualCaptures.has(key)) return
  pendingManualCaptures.add(key)
  try {
    chrome.tabs.sendMessage(tabId, { type: "SHOW_CAPTURE_TOAST" }).catch(() => {})

    const [mhtmlBlob, tab, textContent] = await Promise.all([
      captureMhtml(tabId),
      chrome.tabs.get(tabId),
      getPlainTextFromTab(tabId)
    ])

    await sendMhtmlCapture({
      source: "manual",
      caseId,
      url,
      title: tab.title || url,
      timestamp: new Date().toISOString(),
      textContent,
      mhtml: mhtmlBlob,
      browserVersion: getBrowserVersion(),
      userAgent: getUserAgentString(),
      extensionVersion: getExtensionVersion(),
      httpStatus: 200
    })

    chrome.tabs
      .sendMessage(tabId, { type: "UPDATE_CAPTURE_TOAST", status: "success" })
      .catch(() => {})
  } catch (err) {
    console.error("[Birdbrain] Manual capture failed:", err)
    let message = "Capture failed"
    if (err && typeof err === "object" && "status" in err) {
      const apiErr = err as { status: number; detail: string }
      if (apiErr.status === 400) message = "Capture rejected: " + apiErr.detail
      else if (apiErr.status === 403) message = "URL is blacklisted"
      else if (apiErr.status === 404) message = "Case not found"
      else if (apiErr.status === 500) message = "Server error - check Birdbrain app"
    } else if (err instanceof TypeError) {
      message = "Can't reach Birdbrain - is it running?"
    }
    chrome.tabs
      .sendMessage(tabId, { type: "UPDATE_CAPTURE_TOAST", status: "error", message })
      .catch(() => {})
  } finally {
    pendingManualCaptures.delete(key)
  }
}
```

- [ ] **Step 5: Rewrite `handleSelectorCapture`**

Replace the body of `handleSelectorCapture`:

```ts
async function handleSelectorCapture(tabId: number, url: string, caseId: string): Promise<void> {
  if (!shouldSelectorCapture(caseId, url)) return
  try {
    const [mhtmlBlob, tab, textContent] = await Promise.all([
      captureMhtml(tabId),
      chrome.tabs.get(tabId),
      getPlainTextFromTab(tabId)
    ])
    await sendMhtmlCapture({
      source: "selector",
      caseId,
      url,
      title: tab.title || url,
      timestamp: new Date().toISOString(),
      textContent,
      mhtml: mhtmlBlob,
      browserVersion: getBrowserVersion(),
      userAgent: getUserAgentString(),
      extensionVersion: getExtensionVersion(),
      httpStatus: 200,
      matchedSelectors: []
    })
    selectorDedupeMap.set(caseId + ":" + url, Date.now())
  } catch (err) {
    console.error("Selector capture failed:", err)
  }
}
```

- [ ] **Step 6: Verify extension compiles**

Run: `pnpm build:extension`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add extension/src/background.ts
git commit -m "feat: capture pages as MHTML via chrome.pageCapture"
```

---

## Task 21: Extension content - remove EXTRACT_PAGE / freeze-dry

**Files:**
- Modify: `extension/src/content.ts`

- [ ] **Step 1: Remove freeze-dry import and EXTRACT_PAGE handler**

In `extension/src/content.ts`:

1. Delete the `import { freezeDry } from "freeze-dry"` line at the top.
2. Delete the entire `if (message.type === "EXTRACT_PAGE") { ... }` block inside the `chrome.runtime.onMessage.addListener` callback.

- [ ] **Step 2: Verify the content script still compiles**

Run: `pnpm build:extension`
Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add extension/src/content.ts
git commit -m "refactor: remove freeze-dry EXTRACT_PAGE handler from content script"
```

---

## Task 22: Remove freeze-dry dependency

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml`

- [ ] **Step 1: Remove freeze-dry from dependencies**

Run: `pnpm remove freeze-dry`
Expected: freeze-dry is removed from `package.json` and `pnpm-lock.yaml`.

- [ ] **Step 2: Verify nothing else references freeze-dry**

Use Grep tool to search for "freeze-dry" in `src`, `extension`, and `tests`.
Expected: no results (or only in docs).

- [ ] **Step 3: Run unit tests**

Run: `pnpm test`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: remove freeze-dry dependency"
```

---

## Task 23: MHTML viewer component

**Files:**
- Create: `src/renderer/components/captures/MhtmlViewer.tsx`
- Create/Modify: `src/renderer/env.d.ts`
- Modify: `src/shared/ipc.ts`, `src/main/ipcHandlers.ts`, `src/preload/index.ts`

- [ ] **Step 1: Add IPC channel to resolve MHTML file URLs**

In `src/shared/ipc.ts`, add to the Captures block of `IPC_CHANNELS`:

```ts
  CAPTURES_GET_MHTML_URL: "captures:getMhtmlUrl",
```

- [ ] **Step 2: Add the handler**

In `src/main/ipcHandlers.ts` (next to other CAPTURES_* handlers):

```ts
  ipcMain.handle(IPC_CHANNELS.CAPTURES_GET_MHTML_URL, (_, captureId: string) => {
    try {
      const capture = db.getCapture(captureId)
      if (!capture || !capture.mhtmlPath) return ipcResult<string | null>(null)
      const { pathToFileURL } = require("url") as typeof import("url")
      const pathMod = require("path") as typeof import("path")
      const storageMod = require("@main/services/storage") as typeof import("@main/services/storage")
      const abs = pathMod.join(storageMod.getStorageRoot(), capture.mhtmlPath)
      return ipcResult<string | null>(pathToFileURL(abs).toString())
    } catch (err) {
      return ipcError(err)
    }
  })
```

- [ ] **Step 3: Expose via preload**

In `src/preload/index.ts`, add inside the `captures:` object:

```ts
    getMhtmlUrl: (captureId: string): Promise<string | null> =>
      unwrapIpc<string | null>(ipcRenderer.invoke(IPC_CHANNELS.CAPTURES_GET_MHTML_URL, captureId)),
```

- [ ] **Step 4: Add webview element types**

Create or update `src/renderer/env.d.ts` to declare the webview JSX element:

```ts
declare namespace JSX {
  interface IntrinsicElements {
    webview: React.DetailedHTMLProps<
      React.HTMLAttributes<HTMLElement> & {
        src?: string
        nodeintegration?: string
        allowpopups?: string
        webpreferences?: string
        partition?: string
      },
      HTMLElement
    >
  }
}
```

- [ ] **Step 5: Create MhtmlViewer component**

Create `src/renderer/components/captures/MhtmlViewer.tsx`:

```tsx
import { useEffect, useRef, useState } from "react"

interface Props {
  captureId: string
}

// Renders MHTML via an Electron <webview> with JavaScript disabled.
// The webview tag is enabled via BrowserWindow.webPreferences.webviewTag.
export function MhtmlViewer({ captureId }: Props) {
  const [fileUrl, setFileUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLElement | null>(null)

  useEffect(() => {
    setError(null)
    setFileUrl(null)
    window.birdbrain.captures
      .getMhtmlUrl(captureId)
      .then((url) => {
        if (!url) setError("MHTML file not found on disk")
        else setFileUrl(url)
      })
      .catch((e) => setError(String(e)))
  }, [captureId])

  if (error) {
    return <div className="p-4 text-sm text-red-400">{error}</div>
  }
  if (!fileUrl) {
    return <div className="p-4 text-text-muted">Loading MHTML...</div>
  }

  return (
    <webview
      ref={ref as unknown as React.RefObject<HTMLElement>}
      src={fileUrl}
      nodeintegration="false"
      allowpopups="false"
      webpreferences="javascript=no,contextIsolation=yes"
      style={{ width: "100%", height: "100%", minHeight: "500px", background: "white" }}
    />
  )
}
```

- [ ] **Step 6: Verify renderer builds**

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/captures/MhtmlViewer.tsx src/shared/ipc.ts src/main/ipcHandlers.ts src/preload/index.ts src/renderer/env.d.ts
git commit -m "feat: add MHTML viewer component with Electron webview"
```

---

## Task 24: Route viewer by format and add ProvenanceBadge

**Files:**
- Create: `src/renderer/components/captures/ProvenanceBadge.tsx`
- Modify: `src/renderer/components/captures/CaptureViewer.tsx`

- [ ] **Step 1: Create the ProvenanceBadge component**

Create `src/renderer/components/captures/ProvenanceBadge.tsx`:

```tsx
import { useEffect, useState } from "react"
import { ShieldCheck, ShieldAlert, ShieldOff, Shield } from "lucide-react"
import type { HashVerification } from "@shared/types"

interface Props {
  captureId: string
}

export function ProvenanceBadge({ captureId }: Props) {
  const [result, setResult] = useState<HashVerification | null>(null)
  const [loading, setLoading] = useState(false)

  async function verify() {
    setLoading(true)
    try {
      const r = await window.birdbrain.captures.verify(captureId)
      setResult(r)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    setResult(null)
  }, [captureId])

  if (!result) {
    return (
      <button
        onClick={verify}
        disabled={loading}
        className="flex items-center gap-1 rounded-lg bg-surface px-2 py-1 text-[11px] text-text-muted hover:bg-elevated disabled:opacity-50"
      >
        <Shield className="h-3 w-3" />
        {loading ? "Verifying..." : "Verify"}
      </button>
    )
  }

  if (result.status === "verified") {
    return (
      <span className="flex items-center gap-1 rounded-lg bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-400">
        <ShieldCheck className="h-3 w-3" />
        Verified {result.manifestIndex !== undefined ? "#" + result.manifestIndex : ""}
      </span>
    )
  }
  if (result.status === "legacy") {
    return (
      <span className="flex items-center gap-1 rounded-lg bg-amber-500/10 px-2 py-1 text-[11px] text-amber-400">
        <Shield className="h-3 w-3" />
        Legacy HTML
      </span>
    )
  }
  if (result.status === "tampered" || result.status === "chain-broken") {
    return (
      <span
        title={result.reason}
        className="flex items-center gap-1 rounded-lg bg-red-500/10 px-2 py-1 text-[11px] text-red-400"
      >
        <ShieldAlert className="h-3 w-3" />
        {result.status === "tampered" ? "Tampered" : "Chain broken"}
      </span>
    )
  }
  return (
    <span className="flex items-center gap-1 rounded-lg bg-gray-500/10 px-2 py-1 text-[11px] text-gray-400">
      <ShieldOff className="h-3 w-3" />
      {result.status}
    </span>
  )
}
```

- [ ] **Step 2: Update CaptureViewer imports**

In `src/renderer/components/captures/CaptureViewer.tsx`, add imports:

```tsx
import { MhtmlViewer } from "@renderer/components/captures/MhtmlViewer"
import { ProvenanceBadge } from "@renderer/components/captures/ProvenanceBadge"
```

- [ ] **Step 3: Replace hard-coded Verified badge with ProvenanceBadge**

Find the span currently rendering the emerald "Verified" badge (around line 221-224):

```tsx
<span className="flex items-center gap-1 rounded-lg bg-emerald-500/10 px-2 py-1 text-[11px] text-emerald-400">
  <ShieldCheck className="h-3 w-3" />
  Verified
</span>
```

Replace it with:

```tsx
<ProvenanceBadge captureId={capture.id} />
```

Remove the unused `ShieldCheck` import (it's no longer referenced in this file).

- [ ] **Step 4: Branch the "page" tab by capture format**

Replace the existing `activeTab === "page"` rendering block with a format-aware branch:

```tsx
        {activeTab === "page" && capture.format === "mhtml" ? (
          <div className="h-full w-full rounded-xl border border-border bg-white overflow-hidden">
            <MhtmlViewer captureId={capture.id} />
          </div>
        ) : activeTab === "page" ? (
          content ? (
            <iframe
              sandbox="allow-same-origin"
              srcDoc={content}
              className="h-full w-full rounded-xl border border-border bg-white"
              style={{ minHeight: "500px" }}
              title="Archived page"
            />
          ) : (
            <div className="text-text-muted">No HTML available</div>
          )
        ) : null}
```

- [ ] **Step 5: Update the content-loading useEffect so it skips HTML fetch for MHTML page tab**

Replace the existing content-loading `useEffect`:

```tsx
  useEffect(() => {
    if (!selectedCaptureId) return
    setContent(null)
    // For MHTML captures, the 'page' tab uses MhtmlViewer (file URL); only
    // source/text/screenshot tabs need raw content fetching.
    if (capture?.format === "mhtml" && activeTab === "page") return
    const type =
      activeTab === "screenshot"
        ? "png"
        : activeTab === "page" || activeTab === "source"
          ? "html"
          : activeTab === "text"
            ? "txt"
            : null
    if (type) {
      window.birdbrain.captures
        .getContent(selectedCaptureId, type)
        .then(setContent)
        .catch((err) => console.error("Failed to load capture content:", err))
    }
  }, [selectedCaptureId, activeTab, capture?.format])
```

- [ ] **Step 6: Verify renderer builds**

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/captures/CaptureViewer.tsx src/renderer/components/captures/ProvenanceBadge.tsx
git commit -m "feat: route capture viewer by format and add provenance badge"
```

---

## Task 25: Settings UI - operator name and installation ID

**Files:**
- Modify: `src/shared/ipc.ts`, `src/main/ipcHandlers.ts`, `src/preload/index.ts`
- Create: `src/renderer/components/settings/OperatorConfig.tsx`
- Modify: `src/renderer/components/settings/SettingsView.tsx`

- [ ] **Step 1: Add IPC channel for identity lookup**

In `src/shared/ipc.ts`, add:

```ts
  SETTINGS_GET_IDENTITY: "settings:getIdentity",
```

- [ ] **Step 2: Add the handler**

In `src/main/ipcHandlers.ts`, add next to the other SETTINGS_* handlers:

```ts
  ipcMain.handle(IPC_CHANNELS.SETTINGS_GET_IDENTITY, () => {
    const idMod =
      require("@main/services/installationId") as typeof import("@main/services/installationId")
    return {
      installationId: idMod.getInstallationId(),
      operatorName: settings.getSettings().operatorName ?? ""
    }
  })
```

- [ ] **Step 3: Expose via preload**

In `src/preload/index.ts`, add inside `settings:`:

```ts
    getIdentity: (): Promise<{ installationId: string; operatorName: string }> =>
      ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_GET_IDENTITY),
```

- [ ] **Step 4: Create OperatorConfig component**

Create `src/renderer/components/settings/OperatorConfig.tsx`:

```tsx
import { useEffect, useState } from "react"

export function OperatorConfig() {
  const [installationId, setInstallationId] = useState("")
  const [operatorName, setOperatorName] = useState("")
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    window.birdbrain.settings.getIdentity().then((id) => {
      setInstallationId(id.installationId)
      setOperatorName(id.operatorName)
    })
  }, [])

  async function save() {
    setSaving(true)
    try {
      await window.birdbrain.settings.update({ operatorName })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-1 block text-xs font-medium text-text-secondary">
          Operator Name
        </label>
        <input
          type="text"
          value={operatorName}
          onChange={(e) => setOperatorName(e.target.value)}
          onBlur={save}
          placeholder="e.g. Det. Smith"
          className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary"
        />
        <p className="mt-1 text-[11px] text-text-muted">
          Recorded in every capture's audit manifest. Leave blank for device-only attribution.
        </p>
        {saving && <p className="text-[11px] text-text-faint">Saving...</p>}
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-text-secondary">
          Installation ID
        </label>
        <input
          type="text"
          readOnly
          value={installationId}
          className="w-full rounded-lg border border-border bg-elevated px-3 py-2 font-mono text-[11px] text-text-muted"
        />
        <p className="mt-1 text-[11px] text-text-muted">
          Stable device identifier - stamped on every capture. Cannot be changed.
        </p>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Mount OperatorConfig in SettingsView**

In `src/renderer/components/settings/SettingsView.tsx`, add the import:

```tsx
import { OperatorConfig } from "@renderer/components/settings/OperatorConfig"
```

Then insert a new section alongside the other settings sections (pattern-match the existing layout, e.g. after `<AppearanceConfig />`):

```tsx
<section>
  <h3 className="mb-3 text-sm font-semibold text-text-primary">Operator Identity</h3>
  <OperatorConfig />
</section>
```

- [ ] **Step 6: Verify renderer builds**

Run: `pnpm build`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/settings/OperatorConfig.tsx src/renderer/components/settings/SettingsView.tsx src/shared/ipc.ts src/main/ipcHandlers.ts src/preload/index.ts
git commit -m "feat: add operator identity settings UI"
```

---

## Task 26: E2E test - MHTML capture and verification

**Files:**
- Create: `e2e/mhtml-capture.spec.ts`

- [ ] **Step 1: Add the E2E test**

Create `e2e/mhtml-capture.spec.ts`:

```ts
import { test, expect, _electron as electron } from "@playwright/test"
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

// Smoke test that the MHTML capture + manifest path works end-to-end via the
// Hono server (bypasses the extension - the extension is tested separately).
test("MHTML capture is written, hashed, manifested, and verifies", async () => {
  const userData = mkdtempSync(join(tmpdir(), "birdbrain-e2e-mhtml-"))

  const app = await electron.launch({
    args: [join(__dirname, "..", "out", "main", "index.js")],
    env: { ...process.env, BIRDBRAIN_USER_DATA: userData }
  })

  try {
    const window = await app.firstWindow()
    await window.waitForLoadState("domcontentloaded")

    const caseId = await window.evaluate(async () => {
      const w = window as unknown as { birdbrain: typeof window.birdbrain }
      const c = await w.birdbrain.cases.create({ name: "E2E MHTML" })
      return c.id
    })
    expect(caseId).toBeTruthy()

    const mhtmlBody = Buffer.from("<html>ok</html>")
    const uploadResult = await window.evaluate(
      async ({ caseId, bytes }) => {
        const form = new FormData()
        form.append("source", "manual")
        form.append("caseId", caseId)
        form.append("url", "https://example.com")
        form.append("title", "Example")
        form.append("timestamp", new Date().toISOString())
        form.append("textContent", "ok")
        form.append("extensionVersion", "0.1.0")
        form.append("browserVersion", "Chrome/120")
        form.append("userAgent", "Mozilla/5.0")
        form.append(
          "mhtml",
          new Blob([new Uint8Array(bytes)], { type: "multipart/related" }),
          "capture.mhtml"
        )
        const r = await fetch("http://127.0.0.1:19845/api/captures", {
          method: "POST",
          body: form
        })
        return r.json()
      },
      { caseId, bytes: Array.from(mhtmlBody) }
    )
    expect(uploadResult.status).toBe("ok")
    expect(uploadResult.manifestIndex).toBe(0)

    const verify = await window.evaluate(async (captureId: string) => {
      const w = window as unknown as { birdbrain: typeof window.birdbrain }
      return w.birdbrain.captures.verify(captureId)
    }, uploadResult.captureId)
    expect(verify.status).toBe("verified")

    const manifestPath = join(userData, "captures", caseId, "manifest.jsonl")
    expect(existsSync(manifestPath)).toBe(true)
    const lines = readFileSync(manifestPath, "utf-8").trim().split("\n")
    expect(lines).toHaveLength(1)
    const entry = JSON.parse(lines[0])
    expect(entry.type).toBe("capture")
    expect(entry.index).toBe(0)
    expect(entry.prevHash).toBe("")

    const mhtmlPath = join(userData, "captures", caseId, uploadResult.captureId + ".mhtml")
    writeFileSync(mhtmlPath, "mutated-content")
    const reverify = await window.evaluate(async (captureId: string) => {
      const w = window as unknown as { birdbrain: typeof window.birdbrain }
      return w.birdbrain.captures.verify(captureId)
    }, uploadResult.captureId)
    expect(reverify.status).toBe("tampered")
  } finally {
    await app.close()
    rmSync(userData, { recursive: true, force: true })
  }
})
```

- [ ] **Step 2: Run the E2E test**

Run: `pnpm test:e2e -- mhtml-capture`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/mhtml-capture.spec.ts
git commit -m "test: E2E MHTML capture, verification, and tamper detection"
```

---

## Task 27: Final cleanup and validation

**Files:**
- Verify: lint, types, full test suite, smoke test

- [ ] **Step 1: Run full unit test suite**

Run: `pnpm test`
Expected: all tests pass.

- [ ] **Step 2: Run linting**

Run: `pnpm lint`
Expected: no errors (warnings acceptable).

- [ ] **Step 3: Run full build**

Run: `pnpm build && pnpm build:extension`
Expected: both builds succeed.

- [ ] **Step 4: Run full E2E suite**

Run: `pnpm test:e2e`
Expected: all E2E tests pass (including the new `mhtml-capture` spec).

- [ ] **Step 5: Manual smoke test**

Run: `pnpm dev`

Actions in the app:
- Check DevTools for any errors related to webview or IPC.
- Create a case, start a session.
- Load the extension: run `pnpm build:extension`, then load `extension/dist` as unpacked in Chrome.
- Navigate to a public page (e.g. https://example.com). Observe an auto-capture toast.
- In Birdbrain, open the new capture. The "Page" tab should render the archived site in the webview.
- Click "Verify" on the ProvenanceBadge. It should show "Verified #0".
- Delete the capture. Confirm the manifest now has two lines (capture + deletion).

- [ ] **Step 6: Final commit if any fix-ups were needed**

If any small fixes surfaced during the smoke test:

```bash
git add -A
git commit -m "fix: smoke-test follow-ups for MHTML capture"
```

Otherwise skip.

---

## Self-Review Checklist

**Spec coverage:**
- MHTML capture via `chrome.pageCapture.saveAsMHTML` - Task 20
- Multipart/form-data upload endpoint - Task 14
- Streaming write + hash in single pass with 200MB cap - Task 12
- Hash-chained JSONL manifest with canonical JSON - Tasks 7-10
- Write-ahead manifest pattern with rollback - Tasks 9, 13
- Migration v11 with forensic columns - Tasks 5, 6
- Operator identity (installationId + operatorName) - Tasks 3, 4, 25
- Deletion audit entries - Task 17
- Verify IPC (recompute hash + chain check) - Task 16
- Electron webview MHTML viewer with scripts disabled - Tasks 15, 23
- ProvenanceBadge (Verified/Tampered/Chain-broken/Legacy) - Task 24
- Remove freeze-dry - Tasks 21, 22
- Legacy HTML captures remain viewable - Task 24 (format branching)
- E2E test - Task 26

**Type consistency:**
- `InsertCaptureParams` forensic fields (Task 6) match `IngestParams` (Task 13) and `rowToCapture` (Task 6).
- `Capture.format` values (`html` | `mhtml`) match the DB constraint default (`html`) and the migration column default.
- `HashVerification.status` union (`verified` | `tampered` | `missing` | `chain-broken` | `legacy`) is consistent between Task 2 (type), Task 16 (implementation), and Task 24 (UI).
- `ManifestEntryInput` discriminated union (`capture` | `deletion`) is consistent between Task 9 (type) and Task 17 (deletion path).
- `appendManifestEntry` return shape (`AppendResult` with `anchorBytes`) is consistent between Task 9 (definition) and Tasks 13, 17 (callers).

**Placeholder scan:** No "TBD", "similar to", or unspecified error-handling paths. Every code step contains actual code.
