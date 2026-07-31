# Birdbrain MCP Server — Design Brief

**Status:** Draft / design brief
**Date:** 2026-07-29
**Author:** design session (Matt + Claude)

## Purpose

Expose Birdbrain's captured evidence to external AI agents over the Model Context
Protocol (MCP), so that agentic workflows can query a case's captures, search its
content, pull extracted IOCs and analyst notes, and — the differentiator — run the
existing evidence-package **verification** against a capture and get back a
pass/fail with both integrity and trusted-time axes.

This brief was written to answer a concrete question: can the
`evidence-claim-adjudication` CC Workflow Studio workflow consume Birdbrain
captures as first-class, forensically-provenanced evidence? Today that workflow's
`prompt-corpus` step reads a case archive's manifest off disk and *trusts what the
manifest asserts*. An MCP server lets it instead **verify** the chain and return a
`[CAPTURED]` provenance tier that means "the verifier confirmed the chain," not
"the file said so."

Nothing here is built yet — `.mcp.json` currently wires only `cc-workflow-studio`,
and there is no MCP server module in `src/main/`.

## Why this is a good fit

Birdbrain already has the entire surface an MCP server needs; the server is a thin
adapter, not new domain logic:

- **Typed IPC contract** — `src/shared/ipc.ts` (`IpcInvokeContract`) is the single
  source of truth for every read the app can perform. Each MCP tool maps to one
  contract entry.
- **Per-domain repos** — `src/main/services/db/` (`caseRepo`, `captureRepo`,
  `selectorRepo`, `noteRepo`, `extractedDataRepo`, `waybackRefRepo`) own the SQL,
  so a standalone server can call them directly rather than re-authoring queries.
- **Process-agnostic verification** — `src/shared/verify/` (`evidencePackage`,
  `manifestChain`, `signature`, `timestampToken`, `trustedTime`) has no Electron
  dependency and already backs the standalone verifier CLI (`src/verifier/cli.ts`).
  It runs equally well inside an MCP server.

## Access models

Two ways to host it; they differ in whether the desktop app must be running.

### A. In-process (part of Electron main)

The MCP server boots inside the running app and calls the existing IPC handlers /
repos directly.

- **Pro:** zero duplication; reuses live handlers, settings, storage path.
- **Con:** the app must be open. The adjudication workflow runs headless in a
  terminal, so this couples evidence access to a running GUI.

### B. Standalone read-only server (recommended for adjudication)

A separate Node process opens the SQLite DB **read-only** (`better-sqlite3`,
`readonly: true`), reuses the per-domain repos for reads and `src/shared/verify/`
for verification, and is pointed at the storage path so it can resolve capture
files on disk.

- **Pro:** no GUI needed; naturally read-only (safe for an agent to hold);
  deployable as a small binary alongside the existing verifier build
  (`scripts/build-verifier.mjs`).
- **Con:** must re-open the DB with the app's WAL settings and respect the
  `busy_timeout`; needs the storage path passed in (env or arg).
- **Constraint:** capture *content* lives as files on disk referenced by DB rows —
  the server needs both the DB path and the capture storage root.

**Recommendation:** ship **B**. The adjudication use case is read-only by nature,
should not require the desktop app to be foregrounded, and benefits from the
hard read-only posture. Reuse the verifier build pipeline.

## Tool catalog

Each tool maps to an existing IPC contract entry (`src/shared/ipc.ts`) and/or a
repo/verify call. All tools are **read-only**. Tool names are `snake_case` under a
`birdbrain__` prefix once connected.

| Tool | Backing channel / call | Returns | Notes |
|---|---|---|---|
| `list_cases` | `cases:list` | `Case[]` | Enumerate the corpus. |
| `get_case` | `cases:get` | `Case \| undefined` | Case metadata. |
| `list_captures` | `captures:list` (caseId) | `Capture[]` | Index rows for a case. |
| `get_capture` | `captures:get` + `captures:getContent` | `Capture` + html/txt content | `getContent(captureId, 'html'\|'png'\|'txt')`; use `captures:getMhtmlUrl` for MHTML. |
| `verify_capture` | `captures:verify` (captureId) | `HashVerification` | **The differentiator** — see below. |
| `inspect_archive` | `cases:inspectArchive` | `ArchiveInspectReport \| null` | Archive-level tamper report for an exported `.birdbrain` case. |
| `search` | `search:query` (caseId, query) | `Capture[]` | Hits the FTS5 index instead of walking files. |
| `search_extracted_data` | `extractedData:search` (caseId, query) | `ExtractedDataSearchResult[]` | IOCs and extracted entities. |
| `list_extracted_data` | `extractedData:items` (caseId, category, subcategory) | `ExtractedDataItem[]` | Structured extracted data by category. |
| `list_notes` | `notes:list` / `notes:search` | `Note[]` | Analyst notes as evidence/context. |
| `get_annotations` | `annotations:get` (captureId) | `AnnotationsBundle` | Analyst pins/shapes on a capture. |
| `list_wayback_refs` | `wayback:list` (captureId) | `WaybackRef[]` | Pinned Wayback corroboration snapshots. |

Explicitly **out of scope** (mutating or GUI/OS-coupled): everything under `cases:create/update/delete`,
`captures:delete`, `tags:*` writes, `selectors:*` writes, `notes:create/update/delete`,
`db:*` admin, `export:*`, `recapture:*`, `shell:*`, `updates:*`, `settings:update`,
`ai:analyze`. A read-only evidence server must not expose these.

## The verification payload — why `[CAPTURED]` outranks other provenance

`verify_capture` returns `HashVerification` (`src/shared/types.ts`), which carries
**two orthogonal axes** the workflow's `prompt-conflicts` node already asks about:

- **Integrity axis** — `status`: `verified` | `tampered` | `missing` |
  `chain-broken` | `legacy`, plus `storedHash` / `computedHash`, `chainValid`, and
  `manifestIndex`. This answers "did the bytes and the hash-chain survive intact?"
- **Trusted-time axis** — `trustedTime` (`rfc3161` | `pending` | `none`), and when
  `rfc3161`, `tsaName` + `stampedAt`. This answers "is there an independent RFC-3161
  timestamp proving *when* it existed?" — orthogonal to integrity.

For the adjudication workflow this means a `[CAPTURED]` evidence item can report
not just a SHA-256 but **"integrity: verified, chain valid at index N, trusted-time:
rfc3161 stamped by <TSA> at <time>"** — a strictly stronger claim than `[ARCHIVED]`
(snapshot exists) or `[PROVIDED]` (user file). A `tampered` or `chain-broken`
result is itself a finding the workflow should surface, not swallow.

> See the court-admissibility trusted-time model (rfc3161/pending/none axis) for
> how these two axes were designed to be reported independently.

## Workflow integration

Two integration paths into `evidence-claim-adjudication`, non-exclusive:

1. **`mcp` node in the corpus-aggregation stage** — a placeholder node wired to
   `birdbrain__list_captures` / `birdbrain__verify_capture` that pulls a case's
   captures + verification status straight into the Evidence Index. Deterministic
   and visible on the canvas. (Added as a placeholder in a companion edit.)
2. **Runtime tool discovery, no graph change** — workflow sub-agents can reach any
   session-connected MCP via ToolSearch. Once the Birdbrain MCP is connected,
   `prompt-corpus`'s "read the manifest" step and `agent-adjudicate` can discover
   and call its tools with no canvas edit. The manifest-read step simply becomes a
   `verify_capture` call.

## Security posture

- **Read-only or nothing.** Model B opens the DB `readonly`. No mutating tool ships.
- **No secrets over the wire.** `settings:get` returns `openRouterApiKey` and must
  **not** be exposed. There is no settings tool in the catalog.
- **Local transport.** Follow the existing `.mcp.json` pattern (loopback HTTP, e.g.
  `http://127.0.0.1:<port>/mcp`) bound to `127.0.0.1` only, matching the capture
  server's local-only stance (port 19845).
- **Path confinement.** The server resolves capture files only under the configured
  storage root; reject path traversal outside it.

## Open questions

1. **DB vs live handlers** — confirm the per-domain repos can be called from a
   standalone process cleanly, given the lint rule confining raw `getDb` imports to
   `src/main/services/db/`. A standalone server living under `src/mcp/` would need a
   sanctioned read-only accessor (mirroring how the verifier CLI reads).
2. **Content size** — `get_capture` HTML/MHTML can exceed sane MCP payload limits
   (`MAX_MHTML_SIZE`). Return a summary + on-disk path by default; gate full content
   behind an explicit flag or offer a text-only (`txt`) variant.
3. **Which storage root** — single active DB, or should the server accept a
   `.birdbrain` archive path and verify a *sealed export* (via `inspect_archive`)
   rather than the live DB? The latter is the stronger evidentiary story.
4. **Trusted-time on legacy captures** — `legacy` / `pending` states need a defined
   representation so the workflow does not read absence as failure.

## Non-goals

- Writing to Birdbrain from an agent.
- Exposing the capture pipeline, recapture queue, export, or DB admin.
- Any network egress beyond the local MCP transport.
