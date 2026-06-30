# Wayback Machine corroboration — design

**Status:** Approved (brainstorm) — pending implementation plan
**Date:** 2026-06-30
**Related:** TLS cert-chain corroboration (#123, ADR-0002) — same post-capture, corroboration-only pattern

## Summary

Add an **Archive** tab to the capture viewer that lets an investigator look up the
captured URL in the Internet Archive's Wayback Machine, see a timeline of available
snapshots with the one **closest to the capture timestamp** highlighted, open any
snapshot in the external browser, and **pin** snapshots that matter so the reference
is preserved against the capture.

This is forensic **corroboration**, not part of the captured transaction — it records
what archive.org independently held for the same URL, analogous to the post-capture
TLS cert-chain re-fetch (#123, ADR-0002). It does **not** alter or re-bind the
original capture's hash chain.

## Goals

- Surface archive.org's independent record of a captured URL over time.
- Highlight the snapshot nearest the capture timestamp ("archive.org independently
  held this URL ~when you captured it").
- Let the user open any snapshot in the external browser.
- Let the user pin snapshot references to the capture so they persist in the case.

## Non-goals (v1)

Designed for, but explicitly deferred:

- Downloading / hashing archived snapshot content into the case directory.
- Manifest / hash-chain integration for archive references.
- Automatic (non-explicit) lookup.
- A per-case "disclose URLs to third parties" OPSEC setting (noted below).

## Decisions (from brainstorm)

| Question | Decision |
| --- | --- |
| Purpose | Forensic corroboration |
| Preservation depth | Reference now, content download designed-for-later |
| Lookup scope | Closest-to-capture **+** full timeline (CDX API) |
| UI placement | New top-level viewer tab (**Archive**) |
| Persistence | Explicit **pin to case**; lookup itself is a live (cached) query |
| OPSEC | Lookup is always explicit, never automatic |

## Architecture

### Data flow

1. User opens the **Archive** tab and clicks **Look up**.
2. Renderer invokes `archive:lookup` (by `captureId`) over IPC.
3. Main reads the capture's `url` + `timestamp`, calls
   `waybackMachine.lookupSnapshots(url, captureTimestamp)`.
4. Main queries the Wayback **CDX API**, parses rows into typed snapshots, computes
   the index of the snapshot closest to the capture timestamp, returns the result.
5. Renderer (React Query) caches and renders the timeline + closest-match callout.
6. User clicks **Pin** on a snapshot → `archive:pin` persists a reference row;
   pinned references load via `archive:list` and render as a saved section.

The lookup runs in the **main process** because archive.org's CDX endpoint does not
serve the CORS headers the renderer would need, and routing outbound HTTP through
main keeps the network boundary consistent with existing services
(`timestamp.ts`, `openrouter.ts`).

### Units

**`src/main/services/waybackMachine.ts`** (new)
- `lookupSnapshots(url, captureTimestamp): Promise<WaybackLookupResult>`
- Builds a bounded CDX request:
  `https://web.archive.org/cdx/search/cdx?url=<url>&output=json&fl=timestamp,original,statuscode,mimetype,digest,length&filter=statuscode:200&collapse=digest&limit=<cap>`
- Parses the JSON-array response (first row is the header) into `WaybackSnapshot[]`.
- Parses CDX `timestamp` (`YYYYMMDDHHMMSS`, UTC) into ISO strings.
- Computes the index of the snapshot with the smallest absolute time delta from the
  capture timestamp (`closestIndex`).
- Bounded timeout + typed error result (no thrown network errors leaking to the
  renderer), mirroring `timestamp.ts`. `fetch` is injectable for tests.

**IPC domain `archive`** (`src/shared/ipc.ts`, `src/main/ipcHandlers.ts`, preload)
- `archive:lookup` — `{ captureId }` → `WaybackLookupResult`
- `archive:pin` — `{ captureId, snapshot }` → `ArchiveRef`
- `archive:unpin` — `{ refId }` → `void`
- `archive:list` — `{ captureId }` → `ArchiveRef[]`

**Database** (`src/main/services/database.ts`, migration **v13**)
- New table `capture_archive_refs`:
  ```sql
  CREATE TABLE capture_archive_refs (
    id TEXT PRIMARY KEY,
    captureId TEXT NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
    snapshotTimestamp TEXT NOT NULL,   -- ISO, derived from CDX YYYYMMDDHHMMSS
    snapshotUrl TEXT NOT NULL,         -- https://web.archive.org/web/<ts>/<original>
    originalUrl TEXT NOT NULL,
    digest TEXT,
    statusCode INTEGER,
    mimeType TEXT,
    checkedAt TEXT NOT NULL,           -- when the lookup that produced this ran
    pinnedAt TEXT NOT NULL
    -- reserved for download-later phase (nullable, additive):
    -- contentPath TEXT, contentHash TEXT, manifestIndex INTEGER
  );
  CREATE INDEX idx_archive_refs_capture ON capture_archive_refs(captureId);
  ```
- CRUD: `createArchiveRef`, `listArchiveRefs(captureId)`, `deleteArchiveRef(refId)`.

**Renderer**
- `src/renderer/components/captures/ArchiveTab.tsx` (new) — added to `CaptureViewer`
  `TABS` / icons / labels and the tab-panel switch.
- React Query in `src/renderer/lib/queries.ts`: a `lookup` query keyed by
  `captureId` (cached, not auto-run until user clicks), a `list` query for pinned
  refs, and `pin` / `unpin` mutations that invalidate the list.

### Shared types (`src/shared/types.ts`)

```ts
export interface WaybackSnapshot {
  timestamp: string      // ISO 8601, UTC
  snapshotUrl: string    // https://web.archive.org/web/<cdxTs>/<original>
  originalUrl: string
  statusCode?: number
  mimeType?: string
  digest?: string
}

export interface WaybackLookupResult {
  snapshots: WaybackSnapshot[]
  closestIndex: number | null  // null when snapshots is empty
  checkedAt: string            // ISO, when the lookup ran
}

export interface ArchiveRef {
  id: string
  captureId: string
  snapshotTimestamp: string
  snapshotUrl: string
  originalUrl: string
  digest?: string
  statusCode?: number
  mimeType?: string
  checkedAt: string
  pinnedAt: string
}
```

## UI states (ArchiveTab)

- **Idle** — a **Look up** button (lookup never runs automatically).
- **Loading** — spinner / "Querying the Wayback Machine…".
- **Result** — closest-match callout at top (date + Open + Pin), then a scrollable
  chronological timeline list. Each row: archive date, HTTP status, MIME, **Open**
  (external browser), **Pin to case**.
- **Empty** — "No archive.org snapshots found for this URL."
- **Error** — message + **Retry** (covers network failure, timeout, archive.org
  down, malformed response).
- **Pinned** — a persistent section listing saved references with **Open** and
  **Unpin**, loaded via `archive:list`.

Use existing semantic theme tokens; closest-match highlight uses accent tokens.

## Edge cases

- **URLs with query strings / fragments** — CDX exact match (default `matchType`).
- **Many snapshots** — capped via `limit` and de-duplicated via `collapse=digest`.
- **archive.org slow or down** — bounded timeout → typed error → Error state.
- **Zero snapshots** — Empty state.
- **Capture before any archive snapshot exists** — `closestIndex` still resolves to
  the nearest available (could be later than capture); the callout states the delta
  rather than implying contemporaneity.

## OPSEC

A CDX lookup discloses the target URL to archive.org, a third party. For an
investigation tool this can be undesirable, so the lookup is **always explicit and
never automatic**. A future per-case "disclose URLs to third parties" setting is
noted as follow-up but **not** built in v1.

## Testing

- **Unit** (`waybackMachine`): CDX JSON fixtures → parsed snapshots; CDX timestamp →
  ISO; closest-index selection (before/after/exact); empty response; malformed
  response; timeout path. `fetch` injected.
- **DB**: CRUD for `capture_archive_refs`; cascade delete with the capture;
  migration v13 applies cleanly on an existing DB.
- **Renderer**: ArchiveTab idle/loading/result/empty/error/pinned states; pin and
  unpin invalidate the list.

## Future work (explicitly deferred)

- Download + SHA-256 + manifest integration for pinned snapshots (the columns are
  reserved in `capture_archive_refs`).
- Per-case third-party-disclosure OPSEC setting.
- Auto-lookup / background corroboration.
