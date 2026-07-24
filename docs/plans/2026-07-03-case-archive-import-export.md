# Case Archive Import/Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/specs/2026-07-03-case-archive-import-export-design.md` (on branch `docs/case-archive-design`)

**Goal:** A `.birdbrain` zip archive format that exports a full-fidelity case from one Birdbrain instance and imports it into another, with hash/chain verification and chain-of-custody preservation.

**Architecture:** New main-process service `caseArchive.ts` (export/inspect/import) + minimal stored-zip reader `zipRead.ts`. Two new signed manifest entry types (`archive-export`, `import`) added to the zod schema; shared verify-core extended for multi-signer chains (source-signed segments + locally-signed entries after import). Three new IPC channels under the `cases:` domain; UI on Case Overview (export) and Dashboard (import).

**Tech Stack:** Electron main process (Node fs/crypto), better-sqlite3, zod, React 19 + React Query (renderer), Vitest, Playwright.

## Global Constraints

- Code style: no semicolons, single quotes, no trailing commas, 100-char width, 2-space indent, TS strict.
- No new dependencies.
- Never `git add .` / `git add -A` — stage files explicitly.
- Archive format version constant: `CASE_ARCHIVE_SCHEMA_VERSION = 1`.
- Archive file extension: `.birdbrain`.
- Manifest schema version stays `2` (new entry *types*, not a version bump — existing entries' canonical bodies are untouched).
- All new manifest entries are signed (schemaVersion 2 path in `appendManifestEntry` — automatic).
- Export/import require `settings.operatorName` to be set (same gate + message pattern as `generateReport`).
- Run `pnpm lint` and the relevant `pnpm test` before every commit.
- Tests run via `pnpm test -- <path>` (vitest through Electron runtime).

## Branch setup (before Task 1)

```bash
git checkout master
git pull
git checkout -b feat/case-archive-import-export
# bring in the spec for reference (docs branch docs/case-archive-design holds it);
# do NOT merge the docs branch — just read the spec from it if needed:
git show docs/case-archive-design:docs/specs/2026-07-03-case-archive-import-export-design.md
```

## File structure

| File | Responsibility |
|---|---|
| `src/shared/schemas.ts` (modify) | zod schemas for `archive-export` + `import` manifest entries; `ArchiveVerificationResultSchema` |
| `src/shared/types.ts` (modify) | `ArchiveVerificationResult`, `ArchiveInspectReport`, `CaseArchiveCounts` |
| `src/shared/verify/manifestChain.ts` (modify) | multi-signer segment key resolution |
| `src/main/services/manifest.ts` (modify) | `ManifestEntryInput` union gains the two new entry types |
| `src/main/services/zipRead.ts` (create) | stored-zip reader (central-directory based) |
| `src/main/services/caseArchive.ts` (create) | `exportCaseArchive`, `inspectCaseArchive`, `importCaseArchive` |
| `src/shared/ipc.ts` (modify) | `CASES_EXPORT_ARCHIVE`, `CASES_INSPECT_ARCHIVE`, `CASES_IMPORT_ARCHIVE`, `ARCHIVE_PROGRESS` |
| `src/main/ipcHandlers.ts` (modify) | handlers + save/open dialogs + progress events |
| `src/preload/index.ts` (modify) | `cases.exportArchive` / `cases.inspectArchive` / `cases.importArchive` bridge methods |
| `src/renderer/lib/queries.ts` (modify) | archive mutations + cases invalidation |
| `src/renderer/components/cases/ImportCaseDialog.tsx` (create) | verification-report modal + confirm/override |
| `src/renderer/components/dashboard/Dashboard.tsx` (modify) | "Import case…" entry point |
| `src/renderer/components/cases/CaseOverview.tsx` (modify) | "Export case archive…" action |
| `tests/main/services/zipRead.test.ts` (create) | reader unit tests |
| `tests/main/services/caseArchive.test.ts` (create) | round-trip / tamper / re-import tests |
| `tests/shared/manifestChainImport.test.ts` (create) | multi-signer chain tests |
| `e2e/case-archive.spec.ts` (create) | export→import E2E |

---

### Task 1: Manifest entry types (`archive-export`, `import`) — schema + input union

**Files:**
- Modify: `src/shared/schemas.ts` (after `ManifestExportEntrySchema`, ~line 292)
- Modify: `src/shared/types.ts` (end of file)
- Modify: `src/main/services/manifest.ts` (`ManifestEntryInput`, ~line 118)
- Test: `tests/main/services/manifest.test.ts` (extend)

**Interfaces:**
- Consumes: existing `appendManifestEntry`, `verifyManifestChain`, `MANIFEST_SCHEMA_VERSION`.
- Produces:
  - `ArchiveVerificationResult` (shared type): `{ overallValid: boolean; chainValid: boolean; chainReason?: string; artifactCount: number; artifactFailureCount: number; captureCount: number; captureHashFailureCount: number }`
  - `ManifestEntryInput` accepts `{ type: 'archive-export', caseId, timestamp, operatorId, operatorName, toolVersion, packageHash }` and `{ type: 'import', caseId, sourceCaseId, sourceInstallationId, sourcePublicKeyPem, packageHash, idMapSha256, verificationResult: ArchiveVerificationResult, timestamp, operatorId, operatorName, toolVersion }`.

- [ ] **Step 1: Write the failing test** — append + verify both new entry types through the real chain:

```ts
// add to tests/main/services/manifest.test.ts (follow the file's existing setup:
// mkdtempSync case dir, initSigningKey(tempDir) etc.)
it('appends and verifies archive-export and import entries', () => {
  initManifest(caseDir)
  appendManifestEntry(caseDir, {
    type: 'archive-export',
    caseId: 'case-1',
    timestamp: new Date().toISOString(),
    operatorId: 'inst-1',
    operatorName: 'Op',
    toolVersion: '1.0.0',
    packageHash: 'a'.repeat(64)
  })
  appendManifestEntry(caseDir, {
    type: 'import',
    caseId: 'case-2',
    sourceCaseId: 'case-1',
    sourceInstallationId: 'inst-0',
    sourcePublicKeyPem: getPublicKeyPem(),
    packageHash: 'b'.repeat(64),
    idMapSha256: 'c'.repeat(64),
    verificationResult: {
      overallValid: true,
      chainValid: true,
      artifactCount: 3,
      artifactFailureCount: 0,
      captureCount: 1,
      captureHashFailureCount: 0
    },
    timestamp: new Date().toISOString(),
    operatorId: 'inst-1',
    operatorName: 'Op',
    toolVersion: '1.0.0'
  })
  expect(verifyManifestChain(caseDir).valid).toBe(true)
})
```

- [ ] **Step 2: Run it, expect FAIL** — `pnpm test -- tests/main/services/manifest.test.ts`. Two failure modes are acceptable: TS error on `ManifestEntryInput`, or `valid: false` with `reason: 'Invalid entry shape'` (schema rejects unknown `type`).

- [ ] **Step 3: Add zod schemas** in `src/shared/schemas.ts` after `ManifestExportEntrySchema`:

```ts
export const ArchiveVerificationResultSchema = z
  .object({
    overallValid: z.boolean(),
    chainValid: z.boolean(),
    chainReason: z.string().optional(),
    artifactCount: z.number().int().nonnegative(),
    artifactFailureCount: z.number().int().nonnegative(),
    captureCount: z.number().int().nonnegative(),
    captureHashFailureCount: z.number().int().nonnegative()
  })
  .strict()

// Signed audit record of a case-archive export (.birdbrain). packageHash uses
// the same recipe as the evidence export: sha256(canonicalStringify(sorted
// artifacts)), never hashing the final zip (circular — this entry's manifest
// copy ships inside it).
const ManifestArchiveExportEntrySchema = z
  .object({
    type: z.literal('archive-export'),
    caseId: z.string(),
    timestamp: z.string(),
    operatorId: z.string(),
    operatorName: z.string(),
    toolVersion: z.string(),
    packageHash: z.string(),
    index: z.number().int().nonnegative(),
    prevHash: z.string(),
    schemaVersion: z.number().int().min(2).max(MANIFEST_SCHEMA_VERSION),
    signature: z.string().optional(),
    entryHash: z.string()
  })
  .strict()

// Signed genesis-of-custody record appended when a case archive is imported.
// Continues the source chain (prevHash = source head). sourcePublicKeyPem is
// the key that signed every entry BEFORE this one (back to the previous import
// boundary) — verify-core switches keys at these entries.
const ManifestImportEntrySchema = z
  .object({
    type: z.literal('import'),
    caseId: z.string(),
    sourceCaseId: z.string(),
    sourceInstallationId: z.string(),
    sourcePublicKeyPem: z.string(),
    packageHash: z.string(),
    idMapSha256: z.string(),
    verificationResult: ArchiveVerificationResultSchema,
    timestamp: z.string(),
    operatorId: z.string(),
    operatorName: z.string(),
    toolVersion: z.string(),
    index: z.number().int().nonnegative(),
    prevHash: z.string(),
    schemaVersion: z.number().int().min(2).max(MANIFEST_SCHEMA_VERSION),
    signature: z.string().optional(),
    entryHash: z.string()
  })
  .strict()
```

Add both to the `ManifestEntrySchema` discriminated union. Copy the `index/prevHash/schemaVersion/signature/entryHash` tail field-for-field from `ManifestExportEntrySchema` (they must stay identical).

- [ ] **Step 4: Add the shared type** in `src/shared/types.ts`:

```ts
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
```

- [ ] **Step 5: Extend `ManifestEntryInput`** in `src/main/services/manifest.ts` with two new union arms mirroring the schemas (all fields except `index/prevHash/schemaVersion/signature/entryHash`, which `appendManifestEntry` adds). Import `ArchiveVerificationResult` from `@shared/types`.

- [ ] **Step 6: Run test, expect PASS** — `pnpm test -- tests/main/services/manifest.test.ts`

- [ ] **Step 7: Lint + commit**

```bash
pnpm lint
git add src/shared/schemas.ts src/shared/types.ts src/main/services/manifest.ts tests/main/services/manifest.test.ts
git commit -m "feat(manifest): add archive-export and import entry types"
```

---

### Task 2: Multi-signer chain verification

**Files:**
- Modify: `src/shared/verify/manifestChain.ts`
- Test: `tests/shared/manifestChainImport.test.ts` (create)

**Interfaces:**
- Consumes: `ManifestEntrySchema` (now including `import` entries), `verifyEntrySignature(entryHashHex, signatureB64, publicKeyPem)` from `./signature`.
- Produces: `verifyManifestChainText(jsonl, { publicKeyPem })` — signature unchanged; behavior extended: entry *i* verifies against the `sourcePublicKeyPem` of the nearest `import` entry at index *j > i*, else against `opts.publicKeyPem`. Hash/linkage checks unchanged.

**Key rule (copy into a comment):** an `import` entry's embedded key covers everything strictly *before* it; the import entry itself is signed by the *importing* installation, so it resolves like any other entry (next boundary or local key). Multi-hop A→B→C composes naturally.

- [ ] **Step 1: Write failing tests.** Build synthetic chains with two throwaway RSA keypairs (use `generateKeyPairSync` like `signingKey.ts` does). Helper to append a signed entry given a private key:

```ts
import { describe, it, expect } from 'vitest'
import { createHash, createSign, generateKeyPairSync } from 'crypto'
import { verifyManifestChainText, canonicalStringify } from '@shared/verify'

function keypair() {
  return generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  })
}

function makeEntry(
  body: Record<string, unknown>,
  index: number,
  prevHash: string,
  privateKeyPem: string
): { line: string; entryHash: string } {
  const full = { ...body, index, prevHash, schemaVersion: 2 }
  const canonical = canonicalStringify(full)
  const entryHash = createHash('sha256').update(canonical).digest('hex')
  const signature = createSign('sha256').update(entryHash).sign(privateKeyPem, 'base64')
  return { line: JSON.stringify({ ...full, entryHash, signature }), entryHash }
}

const captureBody = (n: number) => ({
  type: 'capture',
  captureId: `cap-${n}`,
  caseId: 'case-src',
  url: 'https://example.com',
  timestamp: '2026-07-03T00:00:00.000Z',
  contentHash: 'f'.repeat(64),
  sizeBytes: 10,
  operatorId: 'inst-a',
  operatorName: 'Alice',
  toolVersion: '1.0.0'
})

const importBody = (sourcePem: string) => ({
  type: 'import',
  caseId: 'case-dst',
  sourceCaseId: 'case-src',
  sourceInstallationId: 'inst-a',
  sourcePublicKeyPem: sourcePem,
  packageHash: 'a'.repeat(64),
  idMapSha256: 'b'.repeat(64),
  verificationResult: {
    overallValid: true,
    chainValid: true,
    artifactCount: 1,
    artifactFailureCount: 0,
    captureCount: 1,
    captureHashFailureCount: 0
  },
  timestamp: '2026-07-03T01:00:00.000Z',
  operatorId: 'inst-b',
  operatorName: 'Bob',
  toolVersion: '1.0.0'
})

describe('multi-signer manifest chains', () => {
  it('verifies a single-hop imported chain', () => {
    const a = keypair()
    const b = keypair()
    const e0 = makeEntry(captureBody(0), 0, '', a.privateKey)
    const e1 = makeEntry(importBody(a.publicKey), 1, e0.entryHash, b.privateKey)
    const jsonl = [e0.line, e1.line].join('\n')
    expect(verifyManifestChainText(jsonl, { publicKeyPem: b.publicKey }).valid).toBe(true)
  })

  it('rejects a source segment not signed by the embedded source key', () => {
    const a = keypair()
    const b = keypair()
    const mallory = keypair()
    const e0 = makeEntry(captureBody(0), 0, '', mallory.privateKey) // wrong signer
    const e1 = makeEntry(importBody(a.publicKey), 1, e0.entryHash, b.privateKey)
    const result = verifyManifestChainText([e0.line, e1.line].join('\n'), {
      publicKeyPem: b.publicKey
    })
    expect(result.valid).toBe(false)
    expect(result.brokenAt).toBe(0)
  })

  it('verifies a two-hop A→B→C chain and entries appended after import', () => {
    const a = keypair()
    const b = keypair()
    const c = keypair()
    const e0 = makeEntry(captureBody(0), 0, '', a.privateKey)
    const e1 = makeEntry(importBody(a.publicKey), 1, e0.entryHash, b.privateKey)
    const e2 = makeEntry({ ...captureBody(1), caseId: 'case-dst' }, 2, e1.entryHash, b.privateKey)
    const e3 = makeEntry(
      { ...importBody(b.publicKey), sourceCaseId: 'case-dst', caseId: 'case-dst2' },
      3,
      e2.entryHash,
      c.privateKey
    )
    const e4 = makeEntry({ ...captureBody(2), caseId: 'case-dst2' }, 4, e3.entryHash, c.privateKey)
    const jsonl = [e0, e1, e2, e3, e4].map((e) => e.line).join('\n')
    expect(verifyManifestChainText(jsonl, { publicKeyPem: c.publicKey }).valid).toBe(true)
    // and with the WRONG local key the tail segment fails
    expect(verifyManifestChainText(jsonl, { publicKeyPem: b.publicKey }).valid).toBe(false)
  })
})
```

- [ ] **Step 2: Run, expect FAIL** — `pnpm test -- tests/shared/manifestChainImport.test.ts` (single-hop test fails: source entries verified with local key today).

- [ ] **Step 3: Implement.** Restructure `verifyManifestChainText` into two passes:

```ts
// Pass 1: parse + schema-validate every line (early return broken(i, ...) on
// JSON/shape errors, exactly as today). Collect the parsed entries.
// Then resolve the verifying key per index: entry i uses the sourcePublicKeyPem
// of the NEAREST import entry at index j > i; entries after the last import
// boundary (including each import entry itself) use opts.publicKeyPem.
// SECURITY NOTE: embedded pems come from not-yet-verified entries, but any
// rewrite of a source segment + its import boundary breaks either the hash
// linkage into the locally-signed tail or the tail's signatures — the local
// key remains the trust anchor.
// Pass 2: existing per-entry loop (index, prevHash, recomputed hash, signature)
// unchanged except the key comes from keyFor(i).
```

Concretely: build `const boundaries: Array<{ index: number; pem: string }>` from parsed entries where `data.type === 'import'`; `keyFor(i)` = pem of the first boundary with `boundary.index > i`, else `opts.publicKeyPem`. Keep the LOAD-BEARING comment about excluding `entryHash`/`signature` from the canonical body intact.

- [ ] **Step 4: Run, expect PASS** — `pnpm test -- tests/shared/manifestChainImport.test.ts`, then the full existing verify suites: `pnpm test -- tests/shared tests/verifier tests/main/services/manifest.test.ts` (no regressions — single-signer chains resolve to `opts.publicKeyPem` everywhere).

- [ ] **Step 5: Lint + commit**

```bash
pnpm lint
git add src/shared/verify/manifestChain.ts tests/shared/manifestChainImport.test.ts
git commit -m "feat(verify): segment-aware multi-signer manifest chain verification"
```

---

### Task 3: Stored-zip reader

**Files:**
- Create: `src/main/services/zipRead.ts`
- Test: `tests/main/services/zipRead.test.ts`

**Interfaces:**
- Consumes: nothing app-specific.
- Produces: `readStoredZip(zipData: Buffer): Map<string, Buffer>` — throws `Error('Not a valid Birdbrain archive')` on missing EOCD, compressed (method ≠ 0) entries, or truncated data.

- [ ] **Step 1: Failing tests:**

```ts
import { describe, it, expect } from 'vitest'
import { createStoredZip } from '../../../src/main/services/zip'
import { readStoredZip } from '../../../src/main/services/zipRead'

describe('readStoredZip', () => {
  it('round-trips createStoredZip output', () => {
    const zip = createStoredZip([
      { name: 'a.txt', data: 'hello' },
      { name: 'dir/b.bin', data: Buffer.from([0, 1, 2, 255]) },
      { name: 'empty.txt', data: '' }
    ])
    const entries = readStoredZip(zip)
    expect([...entries.keys()]).toEqual(['a.txt', 'dir/b.bin', 'empty.txt'])
    expect(entries.get('a.txt')!.toString('utf-8')).toBe('hello')
    expect(entries.get('dir/b.bin')).toEqual(Buffer.from([0, 1, 2, 255]))
    expect(entries.get('empty.txt')!.length).toBe(0)
  })

  it('rejects garbage and truncated buffers', () => {
    expect(() => readStoredZip(Buffer.from('not a zip'))).toThrow(/not a valid/i)
    const zip = createStoredZip([{ name: 'a.txt', data: 'hello' }])
    expect(() => readStoredZip(zip.subarray(0, zip.length - 4))).toThrow(/not a valid/i)
  })
})
```

- [ ] **Step 2: Run, expect FAIL** (module not found) — `pnpm test -- tests/main/services/zipRead.test.ts`

- [ ] **Step 3: Implement.** Central-directory based (the authority), stored entries only:

```ts
// Minimal reader for zips produced by createStoredZip (method 0 / stored only).
// Locates the end-of-central-directory record, walks the central directory,
// and slices each entry's data out via its local header. Anything else —
// compression, zip64, multi-disk — is out of contract and throws.
const EOCD_SIG = 0x06054b50
const CENTRAL_SIG = 0x02014b50
const LOCAL_SIG = 0x04034b50

function invalid(): never {
  throw new Error('Not a valid Birdbrain archive')
}

export function readStoredZip(zipData: Buffer): Map<string, Buffer> {
  // EOCD is the last 22 bytes when there is no comment; scan backwards to
  // tolerate a trailing comment anyway.
  let eocd = -1
  for (let i = zipData.length - 22; i >= 0; i--) {
    if (zipData.readUInt32LE(i) === EOCD_SIG) {
      eocd = i
      break
    }
  }
  if (eocd < 0) invalid()
  const entryCount = zipData.readUInt16LE(eocd + 10)
  const centralOffset = zipData.readUInt32LE(eocd + 16)

  const entries = new Map<string, Buffer>()
  let offset = centralOffset
  for (let n = 0; n < entryCount; n++) {
    if (offset + 46 > zipData.length || zipData.readUInt32LE(offset) !== CENTRAL_SIG) invalid()
    const method = zipData.readUInt16LE(offset + 10)
    const size = zipData.readUInt32LE(offset + 24)
    const nameLength = zipData.readUInt16LE(offset + 28)
    const extraLength = zipData.readUInt16LE(offset + 30)
    const commentLength = zipData.readUInt16LE(offset + 32)
    const localOffset = zipData.readUInt32LE(offset + 42)
    if (method !== 0) invalid()
    const name = zipData.subarray(offset + 46, offset + 46 + nameLength).toString('utf-8')

    if (localOffset + 30 > zipData.length || zipData.readUInt32LE(localOffset) !== LOCAL_SIG)
      invalid()
    const localNameLength = zipData.readUInt16LE(localOffset + 26)
    const localExtraLength = zipData.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + localNameLength + localExtraLength
    if (dataStart + size > zipData.length) invalid()
    entries.set(name, zipData.subarray(dataStart, dataStart + size))

    offset += 46 + nameLength + extraLength + commentLength
  }
  return entries
}
```

- [ ] **Step 4: Run, expect PASS** — `pnpm test -- tests/main/services/zipRead.test.ts`

- [ ] **Step 5: Lint + commit**

```bash
pnpm lint
git add src/main/services/zipRead.ts tests/main/services/zipRead.test.ts
git commit -m "feat(services): add stored-zip reader for case archives"
```

---

### Task 4: `caseArchive.ts` — export

**Files:**
- Create: `src/main/services/caseArchive.ts`
- Test: `tests/main/services/caseArchive.test.ts` (create; grows in Tasks 5–6)

**Interfaces:**
- Consumes: `getDb()` (raw prepared statements), `db.getCase`, `getStorageRoot`, `readCaptureFile`, `createStoredZip`, `readStoredZip` (tests), `appendManifestEntry`/`initManifest`, `getInstallationId`, `getSettings`, `getPublicKeyPem`, `canonicalStringify`, `resolveToolVersion` (from `@main/services/certification`), `MANIFEST_FILENAME`, `CaseArchiveCounts` type.
- Produces:
  - `export const CASE_ARCHIVE_SCHEMA_VERSION = 1`
  - `export async function exportCaseArchive(caseId: string, outputPath: string, onProgress?: (step: string, percent: number) => void): Promise<void>`
  - Internal (also consumed by Tasks 5–6): `collectCaseData(caseId): CaseArchiveData` and the `CaseArchiveData` interface below.

**`data.json` contract** — raw snake_case DB rows, grouped:

```ts
interface CaseArchiveData {
  case: Record<string, unknown>
  captures: Record<string, unknown>[]
  tags: Record<string, unknown>[] // only tags referenced by this case's captures
  captureTags: Record<string, unknown>[]
  selectors: Record<string, unknown>[]
  selectorMatches: Record<string, unknown>[]
  notes: Record<string, unknown>[]
  captureFavorites: Record<string, unknown>[]
  annotations: Record<string, unknown>[]
  annotationPins: Record<string, unknown>[]
  captureAnalyses: Record<string, unknown>[]
  extractedData: Record<string, unknown>[]
  captureArchiveRefs: Record<string, unknown>[]
}
```

Collection queries (all via `getDb().prepare(...).all(...)`):

```sql
SELECT * FROM cases WHERE id = ?
SELECT * FROM captures WHERE case_id = ? ORDER BY timestamp
SELECT DISTINCT t.* FROM tags t JOIN capture_tags ct ON ct.tag_id = t.id
  JOIN captures c ON c.id = ct.capture_id WHERE c.case_id = ?
SELECT ct.* FROM capture_tags ct JOIN captures c ON c.id = ct.capture_id WHERE c.case_id = ?
SELECT * FROM selectors WHERE case_id = ?
SELECT sm.* FROM selector_matches sm JOIN captures c ON c.id = sm.capture_id WHERE c.case_id = ?
SELECT * FROM notes WHERE case_id = ?
SELECT cf.* FROM capture_favorites cf JOIN captures c ON c.id = cf.capture_id WHERE c.case_id = ?
SELECT a.* FROM annotations a JOIN captures c ON c.id = a.capture_id WHERE c.case_id = ?
SELECT p.* FROM annotation_pins p JOIN captures c ON c.id = p.capture_id WHERE c.case_id = ?
SELECT ca.* FROM capture_analyses ca WHERE ca.case_id = ?
SELECT * FROM extracted_data WHERE case_id = ?
SELECT ar.* FROM capture_archive_refs ar JOIN captures c ON c.id = ar.capture_id WHERE c.case_id = ?
```

(Check each table's actual columns in `database.ts` migrations when writing — e.g. `capture_analyses` has `case_id` directly; `selector_matches` joins via `capture_id`.)

**`package.json` (zip entry) contract:**

```ts
interface CaseArchiveHeader {
  schemaVersion: 1
  generatedBy: 'Birdbrain'
  exportedAt: string
  toolVersion: string
  source: {
    installationId: string
    operatorName: string
    operatorRole: string
    operatorOrganization: string
  }
  signingPublicKeyPem: string
  case: { id: string; name: string; description: string | null }
  counts: CaseArchiveCounts // { captures, notes, tags, selectors, annotations, extractedData, archiveRefs }
  artifacts: Array<{ path: string; sha256: string; sizeBytes: number }>
  packageHash: string // sha256(canonicalStringify(artifacts sorted by path)) — evidence.json recipe
}
```

Add `CaseArchiveCounts` to `src/shared/types.ts`.

**Export algorithm:**

1. Gate: `getSettings().operatorName?.trim()` else throw (copy the message pattern from `generateReport`).
2. `collectCaseData(caseId)`; throw if case missing.
3. Build zip entries with the same `add(name, value)` hashing accumulator pattern as `buildEvidenceZip` (`src/main/services/export.ts:222-231`): `data.json`, `manifest.jsonl` (verbatim bytes via `readFileSync`, empty buffer if absent), and `files/<captureId>.<ext>` for every existing `mhtml|html|png|txt` of each capture (via `readCaptureFile`).
4. Compute `packageHash`, then build `package.json` (NOT run through `add` — same exclusion rationale as `evidence.json`) and `unshift` it as the first entry.
5. `writeFileSync(outputPath, createStoredZip(entries))`.
6. Append the `archive-export` manifest entry to the live case manifest; on append failure `unlink` the orphaned archive and rethrow (mirror `generateReport`'s try/catch at `export.ts:195-209`).
7. `onProgress` at sensible steps (collect 10%, files 20–80%, write 90%, done 100%).

- [ ] **Step 1: Failing test.** Test setup mirrors `tests/main/services/export.test.ts` (temp dirs, `initDatabase`, `initStorage`, `initSettings` + `updateSettings({ operatorName: 'Op' })`, `initInstallationId`, `initSigningKey`). Seed: one case, two captures via `insertCapture` (one with mhtml+png+txt files written into the case dir and a real `withCaptureEntry` manifest append; one legacy html-only), one note, one tag attached, one selector, a favorite, annotations + a pin.

```ts
it('exports a .birdbrain archive with header, data, manifest, and files', async () => {
  const out = join(tempDir, 'case.birdbrain')
  await exportCaseArchive(caseId, out)
  const entries = readStoredZip(readFileSync(out))
  const header = JSON.parse(entries.get('package.json')!.toString('utf-8'))
  expect(header.schemaVersion).toBe(1)
  expect(header.signingPublicKeyPem).toContain('BEGIN PUBLIC KEY')
  expect(header.counts.captures).toBe(2)
  const data = JSON.parse(entries.get('data.json')!.toString('utf-8'))
  expect(data.captures).toHaveLength(2)
  expect(data.notes).toHaveLength(1)
  expect(data.tags).toHaveLength(1)
  expect(entries.get('manifest.jsonl')).toBeDefined()
  expect(entries.get(`files/${mhtmlCaptureId}.mhtml`)).toBeDefined()
  // every artifact hash in the header is correct
  for (const a of header.artifacts) {
    const buf = entries.get(a.path)!
    expect(createHash('sha256').update(buf).digest('hex')).toBe(a.sha256)
  }
  // live manifest gained a signed archive-export entry and still verifies
  const chain = verifyManifestChain(join(getStorageRoot(), caseId))
  expect(chain.valid).toBe(true)
  const lines = readFileSync(join(getStorageRoot(), caseId, 'manifest.jsonl'), 'utf-8')
    .trim()
    .split('\n')
  expect(JSON.parse(lines.at(-1)!).type).toBe('archive-export')
})

it('refuses to export without an operator name', async () => {
  updateSettings({ operatorName: '' })
  await expect(exportCaseArchive(caseId, join(tempDir, 'x.birdbrain'))).rejects.toThrow(
    /operator name/i
  )
})
```

- [ ] **Step 2: Run, expect FAIL** — `pnpm test -- tests/main/services/caseArchive.test.ts`
- [ ] **Step 3: Implement `collectCaseData` + `exportCaseArchive`** per the contracts above.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Lint + commit**

```bash
pnpm lint
git add src/main/services/caseArchive.ts src/shared/types.ts tests/main/services/caseArchive.test.ts
git commit -m "feat(services): case archive export (.birdbrain)"
```

---

### Task 5: `caseArchive.ts` — inspect (read-only verification)

**Files:**
- Modify: `src/main/services/caseArchive.ts`
- Modify: `src/shared/types.ts`
- Test: `tests/main/services/caseArchive.test.ts` (extend)

**Interfaces:**
- Consumes: `readStoredZip`, `verifyManifestChainText` (with the archive's `signingPublicKeyPem`), `canonicalStringify`, `ManifestEntrySchema`-shaped parsing (reuse the plain line-parse pattern from `export.ts:423-434`).
- Produces (add to `src/shared/types.ts`):

```ts
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
```

and `export function inspectCaseArchive(archivePath: string): ArchiveInspectReport`.

**Verification steps (compose `ArchiveVerificationResult`):**

1. Parse `package.json`; `schemaVersion > CASE_ARCHIVE_SCHEMA_VERSION` → throw `Error('This archive was created by a newer version of Birdbrain. Update Birdbrain to import it.')`.
2. Artifact check: every `artifacts[]` entry exists in the zip and its sha256 matches; every zip entry other than `package.json` appears in `artifacts[]`; recomputed `packageHash` matches the header. Failures → `artifactFailureCount`.
3. Chain check: `verifyManifestChainText(manifestJsonl, { publicKeyPem: header.signingPublicKeyPem })` → `chainValid`/`chainReason`.
4. Capture content check: for each `data.json` capture row with a `hash`, sha256 the corresponding `files/<id>.mhtml` (or `.html` for legacy) and compare. Missing file when the manifest has a capture entry for that hash, or hash mismatch → `captureHashFailureCount`. (A capture whose content file is genuinely absent AND has no bytes to check counts as a failure only on mismatch, not absence — absence is reported by count difference in the UI copy; keep the rule simple: file present + hash mismatch → failure; file absent → failure. Missing-at-source content was never exported into `files/`, so exclude captures with no corresponding artifact entry.)
5. `overallValid = artifactFailureCount === 0 && chainValid && captureHashFailureCount === 0`.

- [ ] **Step 1: Failing tests** (extend the Task 4 describe block — export once in `beforeEach`, then inspect):

```ts
it('inspects a clean archive as valid', async () => {
  const report = inspectCaseArchive(archivePath)
  expect(report.verification.overallValid).toBe(true)
  expect(report.verification.chainValid).toBe(true)
  expect(report.caseName).toBe('Test Case')
  expect(report.counts.captures).toBe(2)
})

it('detects a tampered capture file', async () => {
  tamperZipEntry(archivePath, `files/${mhtmlCaptureId}.mhtml`) // helper: flip one byte in the entry's data region and rewrite the file
  const report = inspectCaseArchive(archivePath)
  expect(report.verification.overallValid).toBe(false)
  expect(report.verification.artifactFailureCount).toBeGreaterThan(0)
})

it('detects a tampered manifest', async () => {
  tamperZipEntry(archivePath, 'manifest.jsonl')
  const report = inspectCaseArchive(archivePath)
  expect(report.verification.overallValid).toBe(false)
})

it('refuses newer schema versions', async () => {
  rewritePackageJson(archivePath, (h) => ({ ...h, schemaVersion: 99 }))
  expect(() => inspectCaseArchive(archivePath)).toThrow(/newer version/i)
})
```

Write the two helpers in the test file: read the archive with `readStoredZip`, mutate, re-write with `createStoredZip` (for `tamperZipEntry`, flip a byte in the retrieved buffer but do NOT update `package.json`'s recorded hash — that's the tamper; for `rewritePackageJson`, replace that entry only).

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement `inspectCaseArchive`.**
- [ ] **Step 4: Run, expect PASS** — `pnpm test -- tests/main/services/caseArchive.test.ts`
- [ ] **Step 5: Lint + commit**

```bash
pnpm lint
git add src/main/services/caseArchive.ts src/shared/types.ts tests/main/services/caseArchive.test.ts
git commit -m "feat(services): case archive inspection with full verification"
```

---

### Task 6: `caseArchive.ts` — import

**Files:**
- Modify: `src/main/services/caseArchive.ts`
- Test: `tests/main/services/caseArchive.test.ts` (extend)

**Interfaces:**
- Consumes: everything above plus `appendManifestEntry`, `rollbackManifestEntry`, `getManifestHead`, `randomUUID` from `crypto`, `mkdirSync`/`renameSync`/`rmSync`.
- Produces: `export async function importCaseArchive(archivePath: string, opts?: { overrideTamper?: boolean }, onProgress?: (step: string, percent: number) => void): Promise<{ newCaseId: string; report: ArchiveInspectReport }>`

**Algorithm (order is load-bearing):**

1. Operator gate (same as export).
2. `const report = inspectCaseArchive(archivePath)`; if `!report.verification.overallValid && !opts?.overrideTamper` → throw `Error('Archive failed verification. Import blocked — re-run with override to import anyway; the tamper result will be permanently recorded in the case manifest.')`.
3. Parse `data.json`. Allocate `newCaseId = randomUUID()`. Build `idMap: Record<string, string>` for every row-ID namespace that collides: for each old id in captures/notes/selectors/capture_analyses/extracted_data/capture_archive_refs/annotation_pins, `SELECT 1 FROM <table> WHERE id = ?` — if taken, `idMap[oldId] = randomUUID()`. `mapId(id) = idMap[id] ?? id`. (annotations PK is `capture_id`, favorites PK is `capture_id` — they follow the capture's mapping automatically.)
4. **Stage files:** `stagingDir = join(getStorageRoot(), '.import-staging-' + randomUUID())`; write every `files/<oldCaptureId>.<ext>` zip entry to `stagingDir/<mapId(oldCaptureId)>.<ext>`; write `manifest.jsonl` verbatim; write `import-id-map.json` = `JSON.stringify({ sourceCaseId, caseId: newCaseId, remapped: idMap }, null, 2)`.
5. **Append the `import` entry to the STAGED manifest** via `appendManifestEntry(stagingDir, {...})` — it naturally continues the source chain (`getManifestHead` reads the staged file). `idMapSha256 = sha256(canonicalStringify({ sourceCaseId, caseId: newCaseId, remapped: idMap }))`. `verificationResult` = the compact `ArchiveVerificationResult` from the report.
6. **Move into place:** `renameSync(stagingDir, join(getStorageRoot(), newCaseId))`.
7. **DB transaction** (single `getDb().transaction(...)`), all raw prepared statements with explicit column lists (tolerate missing keys in old archives via `row.col ?? null`):
   - `cases`: insert with `id = newCaseId`, all other columns from the archived row (preserve `created_at`/`updated_at`).
   - `tags`: for each, `SELECT id FROM tags WHERE lower(name) = lower(?)` → hit: record `tagIdMap[oldId] = existingId`; miss: insert (keep old id if free else new uuid), record mapping.
   - `captures`: raw INSERT (same column list as `insertCapture`, `database.ts:663-697`) with `id = mapId(old)`, `case_id = newCaseId`, preserved `created_at`; then the manual `captures_fts` insert (`database.ts:700-711`) using the staged `.txt` content when present (title/url from the row).
   - `capture_tags`, `selector_matches`, `capture_favorites`, `annotations`, `annotation_pins`, `capture_analyses` (`case_id = newCaseId`), `extracted_data` (`case_id = newCaseId`; `notes_fts`/`extracted_data_fts` maintained by triggers), `capture_archive_refs`, `notes` (`case_id = newCaseId`), `selectors` (`case_id = newCaseId`) — all with FKs run through `mapId`/`tagIdMap`.
8. On ANY throw after step 6: `rmSync(join(getStorageRoot(), newCaseId), { recursive: true, force: true })` then rethrow (the DB transaction self-rolls-back). On throw before step 6: `rmSync(stagingDir, ...)`.
9. Return `{ newCaseId, report }`.

- [ ] **Step 1: Failing tests:**

```ts
it('round-trips a case: every table, files, and a verifying chain', async () => {
  const { newCaseId } = await importCaseArchive(archivePath)
  expect(newCaseId).not.toBe(caseId)
  // table equality (ignoring case_id / remaps — none expected on first import)
  const imported = listCaptures(newCaseId)
  expect(imported).toHaveLength(2)
  expect(imported.map((c) => c.hash).sort()).toEqual(originalHashes.sort())
  expect(imported.map((c) => c.id).sort()).toEqual(originalCaptureIds.sort()) // ids kept when free
  expect(listNotes(newCaseId)).toHaveLength(1)
  expect(getTagsForCapture(originalTaggedCaptureId)).toHaveLength(1)
  expect(listSelectors(newCaseId)).toHaveLength(1)
  // files landed under the new case dir
  expect(existsSync(join(getStorageRoot(), newCaseId, `${mhtmlCaptureId}.mhtml`))).toBe(true)
  // chain: source entries + import entry all verify (single instance: same key)
  const chain = verifyManifestChain(join(getStorageRoot(), newCaseId))
  expect(chain.valid).toBe(true)
  const lines = readFileSync(join(getStorageRoot(), newCaseId, 'manifest.jsonl'), 'utf-8')
    .trim()
    .split('\n')
  const last = JSON.parse(lines.at(-1)!)
  expect(last.type).toBe('import')
  expect(last.caseId).toBe(newCaseId)
  // FTS works for imported content
  expect(searchCaptures('distinctive-text-from-txt-sidecar').length).toBeGreaterThan(0)
})

it('re-import remaps colliding capture ids consistently and records the map', async () => {
  const first = await importCaseArchive(archivePath)
  const second = await importCaseArchive(archivePath)
  const captures2 = listCaptures(second.newCaseId)
  expect(captures2).toHaveLength(2)
  // ids differ from the originals now
  expect(captures2.map((c) => c.id).sort()).not.toEqual(originalCaptureIds.sort())
  // FKs intact: tag still attached, note/annotations still reachable
  const remappedTagged = captures2.find((c) => c.url === taggedCaptureUrl)!
  expect(getTagsForCapture(remappedTagged.id)).toHaveLength(1)
  // id map file written + committed hash
  const mapPath = join(getStorageRoot(), second.newCaseId, 'import-id-map.json')
  expect(existsSync(mapPath)).toBe(true)
  // and files are named by the NEW ids
  expect(existsSync(join(getStorageRoot(), second.newCaseId, `${remappedTagged.id}.mhtml`))).toBe(
    true
  )
})

it('merges tags by name instead of duplicating', async () => {
  createTag({ name: 'Evidence', color: '#ff0000' }) // pre-existing local tag, same name as archived
  const { newCaseId } = await importCaseArchive(archivePath)
  const all = listTags().filter((t) => t.name.toLowerCase() === 'evidence')
  expect(all).toHaveLength(1)
})

it('blocks tampered archives unless overridden, and records the override', async () => {
  tamperZipEntry(archivePath, `files/${mhtmlCaptureId}.mhtml`)
  await expect(importCaseArchive(archivePath)).rejects.toThrow(/failed verification/i)
  const { newCaseId } = await importCaseArchive(archivePath, { overrideTamper: true })
  const lines = readFileSync(join(getStorageRoot(), newCaseId, 'manifest.jsonl'), 'utf-8')
    .trim()
    .split('\n')
  const last = JSON.parse(lines.at(-1)!)
  expect(last.verificationResult.overallValid).toBe(false)
})

it('cleans up staging on failure', async () => {
  // force a mid-import failure: pre-insert a case row with a colliding note id? No —
  // simplest deterministic failure: make data.json's case row invalid (null name)
  rewriteDataJson(archivePath, (d) => ({ ...d, case: { ...d.case, name: null } }))
  await expect(importCaseArchive(archivePath, { overrideTamper: true })).rejects.toThrow()
  const leftovers = readdirSync(getStorageRoot()).filter((n) => n.startsWith('.import-staging-'))
  expect(leftovers).toHaveLength(0)
})
```

(`rewriteDataJson` helper mirrors `rewritePackageJson`, but must also update `data.json`'s hash inside `package.json` and re-derive `packageHash` so verification stays green — the point of that test is import failure, not tamper detection.)

- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement `importCaseArchive`** per the algorithm. Column lists for each table come from the migrations in `database.ts` — copy them exactly (e.g. captures: `database.ts:663-669`; notes: migration v10 at `database.ts:233-247`; annotations: v17 at `database.ts:382-404`; extracted_data: v16 at `database.ts:358-374`; archive refs: v21 at `database.ts:498-513`).
- [ ] **Step 4: Run, expect PASS** — `pnpm test -- tests/main/services/caseArchive.test.ts`, then the full suite `pnpm test`.
- [ ] **Step 5: Lint + commit**

```bash
pnpm lint
git add src/main/services/caseArchive.ts tests/main/services/caseArchive.test.ts
git commit -m "feat(services): case archive import with verification, id remap, and custody chain"
```

---

### Task 7: IPC channels, handlers, preload bridge

**Files:**
- Modify: `src/shared/ipc.ts` — add to `IPC_CHANNELS`:

```ts
CASES_EXPORT_ARCHIVE: 'cases:exportArchive',
CASES_INSPECT_ARCHIVE: 'cases:inspectArchive',
CASES_IMPORT_ARCHIVE: 'cases:importArchive',
// in the Events section:
ARCHIVE_PROGRESS: 'event:archiveProgress',
```

- Modify: `src/main/ipcHandlers.ts` (Cases section)
- Modify: `src/preload/index.ts` (cases group) and the renderer `window.birdbrain` type declaration (wherever `Birdbrain` interface lives — find via `grep -rn "generateReport" src/preload src/renderer/types* src/renderer/env.d.ts`)
- Test: `tests/main/ipcHandlers.test.ts` (extend, following its existing handler-invocation pattern)

**Interfaces:**
- Produces (preload):

```ts
cases: {
  // ...existing methods
  exportArchive: (caseId: string): Promise<{ canceled: boolean; filePath?: string }> =>
    unwrapIpc(ipcRenderer.invoke(IPC_CHANNELS.CASES_EXPORT_ARCHIVE, caseId)),
  inspectArchive: (): Promise<ArchiveInspectReport | null> =>
    unwrapIpc(ipcRenderer.invoke(IPC_CHANNELS.CASES_INSPECT_ARCHIVE)),
  importArchive: (
    archivePath: string,
    overrideTamper: boolean
  ): Promise<{ newCaseId: string }> =>
    unwrapIpc(ipcRenderer.invoke(IPC_CHANNELS.CASES_IMPORT_ARCHIVE, archivePath, overrideTamper))
}
```

**Handlers** (mirror the `EXPORT_GENERATE` shape at `ipcHandlers.ts:402-426` — dialog in main, progress via `event.sender.send`):

```ts
handle(IPC_CHANNELS.CASES_EXPORT_ARCHIVE, async (event, caseId: string) => {
  const caseData = db.getCase(caseId)
  if (!caseData) throw new IpcFailure('Case not found', 'NOT_FOUND')
  const { canceled, filePath } = await dialog.showSaveDialog({
    defaultPath: `${caseData.name.replace(/[^\w\- ]+/g, '_')}.birdbrain`,
    filters: [{ name: 'Birdbrain Case Archive', extensions: ['birdbrain'] }]
  })
  if (canceled || !filePath) return { canceled: true }
  await exportCaseArchive(caseId, filePath, (step, percent) =>
    event.sender.send(IPC_CHANNELS.ARCHIVE_PROGRESS, { caseId, step, percent })
  )
  return { canceled: false, filePath }
})

handle(IPC_CHANNELS.CASES_INSPECT_ARCHIVE, async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Import Case Archive',
    filters: [{ name: 'Birdbrain Case Archive', extensions: ['birdbrain'] }],
    properties: ['openFile']
  })
  if (canceled || filePaths.length === 0) return null
  return inspectCaseArchive(filePaths[0]) // report includes archivePath
})

handle(
  IPC_CHANNELS.CASES_IMPORT_ARCHIVE,
  async (event, archivePath: string, overrideTamper: boolean) => {
    const { newCaseId } = await importCaseArchive(archivePath, { overrideTamper }, (step, percent) =>
      event.sender.send(IPC_CHANNELS.ARCHIVE_PROGRESS, { step, percent })
    )
    return { newCaseId }
  }
)
```

- [ ] **Step 1: Write failing handler tests** in `tests/main/ipcHandlers.test.ts` — follow that file's existing conventions exactly (how it registers handlers, mocks `dialog`, and invokes channels). Cover: export happy path writes a file; inspect returns null on cancel; import returns `newCaseId`.
- [ ] **Step 2: Run, expect FAIL** — `pnpm test -- tests/main/ipcHandlers.test.ts`
- [ ] **Step 3: Implement** channels + handlers + preload methods + `window.birdbrain` type additions.
- [ ] **Step 4: Run, expect PASS**; also `pnpm build` to catch preload/renderer type drift.
- [ ] **Step 5: Lint + commit**

```bash
pnpm lint
git add src/shared/ipc.ts src/main/ipcHandlers.ts src/preload/index.ts tests/main/ipcHandlers.test.ts
# plus the renderer d.ts file if modified
git commit -m "feat(ipc): case archive export/inspect/import channels"
```

---

### Task 8: Renderer UI — export action + import dialog

**Files:**
- Modify: `src/renderer/lib/queries.ts` — add to the cases mutation hook:

```ts
const exportArchive = useMutation({
  mutationFn: (caseId: string) => window.birdbrain.cases.exportArchive(caseId)
})
const importArchive = useMutation({
  mutationFn: (params: { archivePath: string; overrideTamper: boolean }) =>
    window.birdbrain.cases.importArchive(params.archivePath, params.overrideTamper),
  onSuccess: () => queryClient.invalidateQueries({ queryKey: caseKeys.all })
})
```

(Adapt names to the file's actual key-factory/mutation conventions — read `useCasesMutations` first and clone its shape.)

- Modify: `src/renderer/components/cases/CaseOverview.tsx` — add an "Export case archive" action next to the existing report-export affordance. On success (`!result.canceled`), toast/inline confirmation with a "Show in folder" action calling `window.birdbrain.shell.showItemInFolder(result.filePath)`. Disable + spinner while pending. Reuse the component's existing button styles and semantic tokens (`bg-surface`, `text-text-primary`, `border-border` etc. — match neighbors).
- Create: `src/renderer/components/cases/ImportCaseDialog.tsx`:

```tsx
// Controlled modal. Parent (Dashboard) calls window.birdbrain.cases.inspectArchive()
// on button click; a non-null report opens this dialog.
interface ImportCaseDialogProps {
  report: ArchiveInspectReport
  onClose: () => void
}
// Renders:
// - case name/description, source operator + installation id, exportedAt, counts grid
// - verification panel:
//   overallValid → green "Archive verified" banner
//   !overallValid → red banner listing: chainValid/chainReason, artifactFailureCount,
//     captureHashFailureCount, and a required checkbox
//     "Import anyway — the failed verification will be permanently recorded"
// - [Cancel] [Import case] (Import disabled while failing until checkbox ticked)
// On confirm: importArchive.mutate({ archivePath: report.archivePath, overrideTamper });
// on success navigate({ to: '/cases/$caseId', params: { caseId: newCaseId } }) and close.
```

Follow `CreateCaseDialog.tsx` for modal scaffolding, focus handling, and styling; status colors may use raw red/green per the theme convention's severity exception.

- Modify: `src/renderer/components/dashboard/Dashboard.tsx` — "Import case…" secondary button (placement near the existing new-case affordance). Click → `inspectArchive()`; null → no-op (user cancelled); report → open `ImportCaseDialog`. Surface thrown errors (e.g. newer-schema refusal) via the app's existing error display pattern in that component.
- Test: `tests/components/ImportCaseDialog.test.tsx` — follow the conventions of the existing `tests/components/` suites (render, mock `window.birdbrain`): shows counts; green banner when valid; import button disabled for a failing report until the override checkbox is ticked; confirm calls `importArchive` with `overrideTamper: true`.

- [ ] **Step 1: Write the failing component test.**
- [ ] **Step 2: Run, expect FAIL** — `pnpm test -- tests/components/ImportCaseDialog.test.tsx`
- [ ] **Step 3: Implement dialog + Dashboard + CaseOverview + mutations.**
- [ ] **Step 4: Run, expect PASS**, plus `pnpm build`.
- [ ] **Step 5: Manual smoke:** `pnpm dev`, export a real case, re-import it, confirm navigation to the new case and a verified badge on a capture.
- [ ] **Step 6: Lint + commit**

```bash
pnpm lint
git add src/renderer/lib/queries.ts src/renderer/components/cases/ImportCaseDialog.tsx src/renderer/components/cases/CaseOverview.tsx src/renderer/components/dashboard/Dashboard.tsx tests/components/ImportCaseDialog.test.tsx
git commit -m "feat(ui): case archive export action and import dialog"
```

---

### Task 9: E2E round-trip

**Files:**
- Create: `e2e/case-archive.spec.ts`

**Approach:** Follow the existing `e2e/` suites' launch/seed helpers exactly (read `e2e/` first — it has established patterns for launching Electron with a temp profile and seeding cases/captures). Electron `dialog` cannot be driven by Playwright — stub it the way existing e2e tests handle dialogs if a helper exists; otherwise seed via IPC from the main-process test hook or set the save path through `ipcRenderer` evaluation. If the codebase has no dialog-stubbing precedent, scope the E2E to the import dialog UI with a pre-built fixture archive (generated by a unit-level export in global setup) and drive `cases:importArchive` through `page.evaluate(() => window.birdbrain.cases.importArchive(fixturePath, false))`, then assert the UI.

Test body:

1. Seed a case with one capture (existing helper).
2. Produce `fixture.birdbrain` (global-setup export or checked-in fixture built by `exportCaseArchive`).
3. Import via `window.birdbrain.cases.importArchive`.
4. Assert: Dashboard lists the new case; opening it shows the capture; the capture list renders; notes/tags visible if seeded.

- [ ] **Step 1: Write the spec (failing/red first if practical — E2E red = missing UI hooks).**
- [ ] **Step 2: `pnpm test:e2e -- case-archive` (or the project's file-filter syntax from `playwright.config.ts`), expect PASS.**
- [ ] **Step 3: Full suites: `pnpm test && pnpm test:e2e && pnpm lint`.**
- [ ] **Step 4: Commit**

```bash
git add e2e/case-archive.spec.ts
git commit -m "test(e2e): case archive export/import round-trip"
```

---

### Task 10: Finish

- [ ] Run everything: `pnpm lint && pnpm test && pnpm build && pnpm test:e2e`
- [ ] Use superpowers:finishing-a-development-branch — open a PR for `feat/case-archive-import-export` (and a separate one for `docs/case-archive-design` if not already opened). Do not bundle the spec into the feature PR.

## Self-review notes (already applied)

- Spec coverage: format (T4), inspect+tamper (T5), import+remap+tags+custody (T6), verify-core (T2), schemas (T1), zip reader (T3), IPC (T7), UI (T8), E2E (T9). Operator gate covered in T4/T6 tests. Newer-schema refusal in T5. Staging cleanup in T6.
- Line-number references (`export.ts:222-231`, `database.ts:663-697`, etc.) are anchors, not gospel — re-locate by symbol if drifted.
- `capture_analyses` columns: verify against migration v15 (`database.ts:339-351`) before writing the INSERT — the plan assumes `case_id` exists on that table.
