# Birdbrain MCP server: read-only first slice

**Status:** plan, awaiting approval
**Date:** 2026-10-02
**Map:** #547 (Birdbrain MCP and local API surface), seeded by #358. Earlier brief: unmerged
branch `docs/mcp-server-design-brief` (2026-07-29).

## Decisions taken 2026-10-02

| Question | Ruling | Effect on the map |
|---|---|---|
| Surface scope (#358 q1) | Read-only. Expose everything the app shows an investigator for a Case. | No Manifest entry is written, so the Operator question (#548) stays open and blocks nothing here. |
| Host model (#358 q2) | Separate process, stdio transport, no network listener. | The hash chain keeps one writer: this process never writes. |
| Dependency | Official MCP TypeScript SDK approved. | See "Package" below. |
| Test corpus | Recapture the 54 sources in the Brett Stevens evidence package into a new Case. | Hunchly import (#1168) stays out of scope. |

Contract source of truth (#551) is not decided here. Tool input schemas are Zod because the SDK takes
Zod; that applies only to the new MCP surface, matching #358's leaning.

## Package

`@modelcontextprotocol/server` 2.2.0, not `@modelcontextprotocol/sdk` 1.31.0. The v2 README states
that v2 is the stable line, implements the 2026-07-28 spec, and replaces the monolithic `sdk`
package. Its dependencies are `zod ^4.2.0` (the repository already pins `^4.6.5`) and
`@modelcontextprotocol/core`. The v1 package pulls in HTTP server and auth libraries (`express`, `hono`, `cors`, `jose`)
that a stdio server never loads. Stdio ships in the same package as its `./stdio` export.

## Constraints found while planning

1. **`better-sqlite3` is built for Electron's ABI** (`pnpm rebuild:electron`), so a plain `node`
   process cannot load it. The server runs as `ELECTRON_RUN_AS_NODE=1 electron out/main/mcp.js`,
   the way `pnpm test` runs vitest. It cannot become a standalone binary like the verifier.
2. **In that mode `require('electron')` returns a path string**, so nothing the server imports may
   use `app`, `dialog` or `shell`. A dependency-cruiser rule enforces it.
3. **Verification is not a pure read.** `verifyCapture` persists the verification status
   (`captureLifecycle.ts:610`), and the trusted-time mirror is reconciled inside
   `computeVerification`. `exhibits:verify` calls `verifyCapture`. The server needs a compute-only
   path that shares code with the app's verdict, so the two cannot drift.
4. **`db/core.ts` has no read-only opener.** `initDatabase` snapshots and migrates, which are
   writes. The server needs `openDatabaseReadOnly(path)` that refuses a schema version other than
   `LATEST_SCHEMA_VERSION`, because it cannot migrate.
5. **Steps 2 and 3 touch blocking-tier evidence paths** (`src/main/services/db/**`,
   `captureLifecycle.ts`, `exhibits.ts`, possibly `trustedTime.ts`). The PR is
   `evidence-affecting` and needs human review.

## Read-only guarantee

Three layers, each tested:

1. SQLite opens with `readonly: true, fileMustExist: true`, so any write throws `SQLITE_READONLY`.
2. The schema version must equal `LATEST_SCHEMA_VERSION`, or the server exits with a message
   naming both versions.
3. A test calls every tool against a fixture, then compares hashes of the database file and every
   file in the Case directory before and after.

Filesystem writes outside SQLite (thumbnail generation, derived files) are not covered by layer 1.
Step 1 lists every read path that writes, and layer 3 catches any that the list misses.

## Tool catalogue

Grouped by the app screen an investigator would use. Every result that names a Capture or Exhibit
carries its id, Exhibit Number, URL, capture time and content hash, so an agent can cite it.

| Group | Tools | Backed by |
|---|---|---|
| Cases | `list_cases`, `get_case` (with counts and selector coverage), `recent_activity` | `cases:list`, `cases:get`, `captures:countsByCase`, `notes:count`, `selectors:coverage`, `cases:recentActivity` |
| Captures | `list_captures` (filter by tag, favourite, selector), `get_capture` (tags, matching selectors, favourite, annotations, pinned Wayback refs, persona) | `captures:list`, `captures:get`, `tags:getForCapture`, `captures:getMatchingSelectors`, `captures:listFavorites`, `annotations:get`, `wayback:list` |
| Content | `get_capture_text`, `get_capture_html` (both paged by offset and length), `get_capture_screenshot` (MCP image content, size-capped) | `captures:getContent` |
| Search | `search_captures` (FTS), `search_notes`, `search_extracted_data` | `search:query`, `notes:search`, `extractedData:search` |
| Custody | `list_exhibits` (anchored and pooled), `get_manifest`, `verify_capture`, `verify_exhibit` | `exhibits:inventory`, `manifest:snapshot`, compute-only verification |
| Notes | `list_notes`, `get_note` (text and anchors), `note_references`, `note_backlinks`, `note_graph` | `notes:*` reads |
| Tags and selectors | `list_tags` (usage counts), `list_selectors` (match counts), `selector_matches` | `tags:usageCountsForCase`, `selectors:list`, `selectors:matchCounts`, `selectors:matchingCaptures` |
| Extracted data | `list_extracted_categories`, `list_extracted_items` | `extractedData:categories`, `subcategories`, `items` |
| Corroboration | `list_wayback_refs` (pinned only) | `wayback:listForCase` |

Step 1 also checks whether non-Capture Exhibits (uploaded files) have readable content a person can
open in the app. If they do, a `get_exhibit_content` tool joins the Custody group.

**Excluded:** every write; `wayback:lookup` (network); `settings:*` (holds the OpenRouter key);
`db:*` (raw table reads bypass the domain layer); `persona:storageState` (cookies); `export:*`;
`diagnostics:*`; anything that opens a dialog or the shell.

## Steps

Each step ends in a commit. Steps 2 to 6 land on this branch as one draft PR.

1. **Check the assumptions.** Read-only open of a WAL database with the app running and with it
   closed. Import graph of every service the tools need, checked for `electron`. List of read
   paths that write. Results go into this plan.
2. **Core seams (blocking tier).** `openDatabaseReadOnly` in `db/core.ts`. Compute-only
   verification split out of `captureLifecycle.ts` and `exhibits.ts`. The app keeps its current
   behaviour: it calls the same compute function, then persists. Existing verification tests must
   pass unchanged.
3. **Server skeleton.** `src/mcp/` entry, stdio transport, configuration (`BIRDBRAIN_USER_DATA` or
   `--user-data`, with the storage root read from `settings.json` without writing it), an extra
   `electron-vite` main entry building `out/main/mcp.js`, a `pnpm mcp` script, and the
   dependency-cruiser rule.
4. **Tools,** one commit per group in the catalogue.
5. **Tests.** Per-tool tests on a fixture database. The no-mutation test from "Read-only
   guarantee". A stdio smoke test that spawns the server and runs `initialize`, `tools/list` and
   one call over raw JSON-RPC, so no client package is needed.
6. **Docs.** `website/content/docs/mcp.mdx` (connecting Claude Code, the tool list, the read-only
   guarantee) with a `docs.json` navigation entry. A sentence in the whitepaper next to its
   no-listener claim, recording the local stdio server. An ADR (0036) recording the scope and host
   rulings in this plan.
7. **Verify.** `pnpm preflight`, then a draft PR labelled `evidence-affecting`.

## Acceptance: reproduce the fact-check

Nothing from the case enters this repository. All case material and output stay in
`~/dev/osint-factcheck/`.

1. I write the 54 URLs from `06-SOURCE-INDEX.csv` to a file there.
2. You create a Case in Birdbrain and recapture those URLs. archive.ph and Google Groups may block
   the background renderer; those need manual capture with the extension.
3. I connect Claude Code to the server from that directory and fact-check every claim in the
   package documents (02 to 05 and 07). Each verdict cites a Birdbrain Capture and its verification
   result. Live-web checks use the agent's own web tools, as in the original run.
4. Output: `BIRDBRAIN-REPRODUCTION.md`, comparing each verdict with `07-FACTCHECK-AND-CORRECTIONS.md`
   and `FACTCHECK-REPORT.md`. Every claim the server could not answer is a gap that sets the next
   slice. Gaps are described generically in the PR, without case content.

## Not in this slice

Writes of any kind, launching from the packaged app (the first slice runs from the dev build), HTTP
transport, MCP resources and prompts, Hunchly import.
