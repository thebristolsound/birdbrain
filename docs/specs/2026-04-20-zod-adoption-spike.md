# SPIKE: Should Birdbrain adopt Zod?

## Context

Birdbrain is a forensic web-investigation tool. It accepts untrusted input at several boundaries (Chrome extension → Hono HTTP server, OpenRouter API responses, on-disk manifest/settings JSON) and today relies entirely on TypeScript's **compile-time** type system — there is no runtime schema validation anywhere in the codebase. This spike answers: **would adopting Zod be worthwhile, or is it overkill?**

**Recommendation up front: Adopt Zod, but scoped to trust boundaries — not as a codebase-wide rewrite.** A targeted rollout at ~5 files would meaningfully improve forensic integrity and collapse ~60 lines of ad-hoc `typeof` checks, at low cost. A full-codebase migration to Zod-derived types would be overkill.

---

## Current state (factual)

- **No validation library** in `package.json`. Zod, Valibot, Yup, io-ts, ArkType, TypeBox are all absent.
- **Domain types** (`src/shared/types.ts`) are plain interfaces. No guards, no schemas.
- **IPC handlers** (`src/main/ipcHandlers.ts`) trust the `params` type annotation at runtime. The only exception is `CAPTURES_OPEN_EXTERNAL`, which URL-checks the protocol.
- **Hono capture server** (`src/main/services/captureServer.ts:212-250`) — the one boundary that *does* validate today — uses ~30 lines of hand-written `typeof` / whitelist checks per endpoint, repeated across the `/api/captures`, `/api/selectors`, and session endpoints. Representative:
  ```ts
  const url = typeof body['url'] === 'string' ? body['url'] : ''
  const title = typeof body['title'] === 'string' ? body['title'] : url
  const httpStatus = typeof httpStatusRaw === 'string' ? parseInt(httpStatusRaw, 10) || 0 : 0
  ```
- **Settings** (`src/main/services/settings.ts:29-41`) — `JSON.parse` + object spread merge. Corrupted or wrong-typed stored values are silently accepted.
- **Manifest** (`src/main/services/manifest.ts:139-149`) — per-line `JSON.parse` + hash-chain verification, but **no schema check** on the parsed entry fields. The hash chain only protects the bytes, not the semantic shape: a corrupted entry with valid hash would still pass.
- **OpenRouter responses** (`src/main/services/ai/openrouter.ts:76-88`) — blind `as OpenRouterResponse` cast with optional-chaining fallbacks; shape changes silently degrade to empty strings and zero token counts.
- **Chrome extension** (`extension/src/utils/api.ts`) — duplicates request/response types independently from `src/shared/types.ts`; blind `return res.json() as Promise<T>` on every call. No shared source of truth with the main process.
- **Database row coercion** (`src/main/services/database.ts`) — `row.id as string` style casts everywhere. The SQLite schema enforces column types, so this is a code-smell but not a real integrity gap.

## Where Zod would actually add value (ranked)

### 1. Hono capture server — highest ROI
The capture server is the **primary untrusted boundary** (Chrome extension, potentially any process on localhost that can reach port 19845). It already has ad-hoc validation, so Zod is a near-drop-in replacement that **reduces code** rather than adding it.

Hono has a first-party adapter: `@hono/zod-validator`. One schema per endpoint replaces the wall of `typeof` guards and gives uniform 400 responses with structured error details. This is the clearest win — the only boundary where adopting Zod makes the diff *smaller*.

### 2. Manifest entry schema — forensic integrity
The manifest is the audit trail for captures. Today, `verifyManifest` checks hash-chain integrity but **not** that entries have the expected shape. A schema at `manifest.ts:139` closes a real gap: malformed-but-well-hashed entries would be rejected instead of propagating undefined fields downstream. For a forensic tool that exists to produce defensible evidence, this is a non-cosmetic improvement.

### 3. Settings load — robustness across versions
As settings evolve (migrations, user-edited JSON, partial writes from crashes), the current `{ ...DEFAULT_SETTINGS, ...saved }` pattern silently accepts garbage. A Zod schema with `.catch(DEFAULT_SETTINGS)` gives a single, auditable place where unknown shapes are handled and logged.

### 4. OpenRouter response parsing — external API resilience
OpenRouter is a third-party API outside our control. A schema surfaces breakage loudly at the single call site instead of silently returning empty completions, which is the worst failure mode for AI features.

### 5. Shared schemas for extension ↔ main — eliminate drift
Currently `extension/src/utils/api.ts` and `src/shared/types.ts` both define capture/case/selector shapes independently. A single Zod schema in `src/shared/` that both processes import eliminates the manual alignment burden.

## Where Zod would be overkill

- **Renderer ↔ main IPC handlers.** Both sides compile from the same TS source; the preload bridge is a well-typed internal contract, not an untrusted boundary. Adding Zod to all ~60 IPC channels would be ceremony without security benefit. (Exception: any channel that accepts arbitrary strings used in filesystem paths or shell commands should keep its ad-hoc checks — Zod doesn't help there.)
- **Internal domain types** (`Case`, `Tag`, `Note`, etc.). Converting all of `src/shared/types.ts` to `z.infer`-derived types is a lot of churn for data that already came from our own validated boundaries.
- **Database row coercion.** The SQLite schema is the source of truth; adding a second parallel Zod schema doubles the surface for drift bugs.

## Costs

- **Bundle size:** Zod v3 is ~12 KB min+gzip; in an Electron main process this is irrelevant. The Chrome extension would pick up Zod too (if we share schemas) — ~12 KB is acceptable for an extension of this class, and it tree-shakes well.
- **Runtime cost:** Validation per capture is O(small) — dwarfed by the SHA-256 and disk write.
- **Library alternatives considered:**
  - **Valibot** (~1 KB min+gzip, same ergonomics) — attractive for the extension, but the surrounding ecosystem is smaller and we lose the larger Zod community. Not worth the tradeoff at our scale.
  - **TypeBox** — faster, JSON-schema-compatible, but more verbose. No Birdbrain requirement for JSON Schema export today.
  - **ArkType** — newer, TS-native syntax, smaller community. Premature.
  - **Keep ad-hoc `typeof` guards** — the status quo. Fine for small surfaces, becomes unmaintainable as endpoints grow and gives no error consistency.
- **Migration cost for the targeted rollout:** roughly 5 files touched, no API changes to callers, no test rewrites required (existing `captureServer` tests should pass unchanged if schemas match current behavior). This is a half-day of focused work, not a sprint.

## Recommendation

**Adopt Zod in a scoped way.** Concretely, if we proceed with implementation it should touch exactly these files:

1. `package.json` — add `zod` and `@hono/zod-validator` as dependencies.
2. `src/shared/schemas.ts` (**new**) — define Zod schemas for `CaptureUpload`, `SelectorCreate`, `ManifestEntry`, `BirdbrainSettings`, and `OpenRouterResponse`. Re-export `z.infer`'d types so existing interfaces in `src/shared/types.ts` can be backed by schemas without breaking imports.
3. `src/main/services/captureServer.ts:212-420` — replace the manual `typeof` blocks with `zValidator('form', CaptureUploadSchema)` / `zValidator('json', SelectorCreateSchema)` middleware. Verify 400 response shapes match what the extension expects.
4. `src/main/services/manifest.ts:139` — parse each line through `ManifestEntrySchema.safeParse`; on failure, return `{ valid: false, brokenAt: i, reason: 'Invalid entry shape' }`.
5. `src/main/services/settings.ts:29-41` — replace the spread merge with `BirdbrainSettingsSchema.catch(DEFAULT_SETTINGS).parse(saved)`.
6. `src/main/services/ai/openrouter.ts:76-88` — replace the blind cast with `OpenRouterResponseSchema.safeParse`; on failure, throw a typed error with the `ZodError` issues attached.

**Explicitly out of scope** for this spike's recommendation:
- IPC handler validation (renderer is trusted)
- Full conversion of `src/shared/types.ts` to schema-derived types
- Database row validation
- Extension-side response validation (can come later if schemas are shared)

## Verification plan (for the eventual implementation)

- `pnpm test` — existing unit tests for `captureServer`, `manifest`, `settings` should pass unmodified. Add new cases: malformed capture body returns 400 with structured error; manifest with valid hash but missing field fails verification; settings file with wrong-typed value falls back to defaults.
- `pnpm test:e2e` — end-to-end Chrome extension → server capture flow should still succeed unchanged.
- Manual smoke test: run `pnpm dev`, trigger a capture from the extension, confirm it lands in the DB. Corrupt a line in `manifest.jsonl` and confirm `verifyManifest` surfaces the new `Invalid entry shape` reason.
- Bundle-size check: run `pnpm build` before/after; confirm Electron main bundle grows by <20 KB and the extension bundle grows by <15 KB.

## Bottom line

Zod is **worthwhile but not as a blanket policy**. The ROI is concentrated in ~5 files that sit at real trust boundaries — especially the Hono capture server (where it *removes* code) and the manifest verification (where it closes a forensic-integrity gap). Applying it beyond those boundaries — to internal IPC, domain types, or DB row coercion — would be overkill and adds maintenance surface for no security benefit.
