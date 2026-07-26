# Birdbrain

Open-source web investigation and capture tool. An Electron desktop app and companion Chrome extension that capture web content into per-case archives with a hash-chained audit trail, then let an investigator search, tag, annotate, and export findings.

## Assurance baseline

Birdbrain has adopted a standards-based OSINT assurance baseline in
[`ADR-0004`](docs/adr/0004-adopt-osint-assurance-baseline.md). The maintained source register,
jurisdiction notes, architectural consequences, and decision gate live in
[`docs/reference/osint-investigation-standards.md`](docs/reference/osint-investigation-standards.md).

There is no universal "OSINT-compliant" product certification. Birdbrain must make narrow,
versioned, independently testable claims across investigation methodology, acquisition,
preservation, analysis, provenance, security, privacy, accessibility, and reporting.

For every evidence-affecting change:

- preserve immutable originals and model derivatives and assertions separately;
- record complete provenance, observation context, omissions, errors, and limitations;
- state exactly what verification proves and does not prove;
- retain backward verification for historical Evidence Profile versions;
- validate the affected method against known-answer data for the supported environment; and
- document remaining operator, organizational, and jurisdiction-specific obligations.

An evidence-affecting change includes acquisition, parsing, extraction, storage, hashing,
signing, trusted time, manifests, verification, redaction, export, reporting, AI analysis, and
software distribution when it can alter an evidentiary result or its interpretation.

## Language

**Case**:
A named investigation that owns Captures, Tags, Selectors, and Notes. The unit of organisation and export.
_Avoid_: project, folder, workspace.

**Capture**:
A snapshot of a single web page (HTML or MHTML, optionally with screenshot and extracted text), stored on disk under its Case directory and indexed in the database.
_Avoid_: page, snapshot, record.

**Capture Lifecycle**:
Operations that mutate an MHTML Capture beyond its database row — ingestion (parse, hash, store, schedule selector matching), deletion (manifest entry + DB row + on-disk files), verification, and case-wide re-extraction. The forensic-bearing path. Legacy HTML Captures (pre-migration v11) appear in deletion and verification but have no manifest entry and no ingest path; new Captures are MHTML-only.
_Avoid_: capture service, capture manager.

**Extracted Text**:
The plain text pulled from a Capture at ingest. The authoritative copy is the `.txt` sidecar on
disk (integrity-bound via `textSha256` in the Manifest); `capture_texts` holds the database copy
for query paths, and `captures_fts` is a derived index over it, maintained by triggers — never
written directly. Healing a suspect database copy (`rebuildFts`) re-reads the sidecars.
_Avoid_: text content, FTS content.

**Selector**:
A user-defined text or regex pattern that the investigator wants to find across a Case's Captures.

**Selector Lifecycle**:
Operations that create, update, or delete a Selector and asynchronously reconcile its **persisted matches** against the Case's existing Captures. Owns chunking, capping, and FTS fallback uniformly across all entry points (IPC, Capture Server). On `update`, clears stale `selector_matches` rows and re-runs matching when the pattern or `isRegex` flag changes. Emits `selectors:rematched` when async work completes so UI consumers can refetch case-wide counts.
_Avoid_: selector service, selector manager.

**Persisted Match**:
A row in `selector_matches` recording that a Selector's pattern hit a specific Capture's stored text. The source of truth for case-wide counts, dashboard badges, and CSV export. Eventually consistent with the Selector definition (async re-match window).
_Avoid_: selector hit, match record.

**Foreground Match Preview**:
A renderer-local, in-memory application of a Selector's pattern to the currently-open Capture's text, used while the investigator is tuning a pattern. Has no IPC round-trip, writes nothing to the database, and is not part of the Selector Lifecycle. Distinct from **Persisted Match**: previewing answers "does this pattern hit _this_ page right now"; persisted matches answer "how many captures in the case hit this pattern."
_Avoid_: live match, instant match.

**Manifest**:
The hash-chained, operator-attributed audit log written to each Case directory that records every Capture ingestion and per-Capture deletion. Existence and chain integrity are part of the forensic value of an export.
_Avoid_: audit log, journal.

**Operator**:
The human investigator. Identified by `installationId` (per-install UUID) and an optional `operatorName` setting; both are written into Manifest entries.
_Avoid_: user, analyst.

**Capture Server**:
The Hono HTTP server in the main process (port 19845) that the Chrome extension posts captures to. The only entry point for the Capture Lifecycle's ingest path.
_Avoid_: ingest server, capture API.

## Relationships

- A **Case** owns many **Captures**, **Selectors**, and **Notes**
- A **Capture Lifecycle** operation on an MHTML **Capture** writes a **Manifest** entry attributed to an **Operator**
- The **Capture Server** receives raw captures from the Chrome extension and hands them to the **Capture Lifecycle**
- Creating or updating a **Selector** triggers the **Selector Lifecycle** to (re)compute **Persisted Matches** for the **Case**'s existing **Captures**, asynchronously
- A **Foreground Match Preview** is computed in the renderer against the open **Capture**'s text and never touches **Persisted Matches**
- A **Capture**'s **Extracted Text** lives in its `.txt` sidecar (authoritative) and is mirrored to the database for the **Selector Lifecycle** and search

## Example dialogue

> **Dev:** "When the extension posts a capture, who writes the **Manifest** entry?"
> **Domain expert:** "The **Capture Server** receives the request, but the **Manifest** write is part of the **Capture Lifecycle**'s ingest step — the server is only the transport."
>
> **Dev:** "And when the user creates a **Selector**, who runs it against existing **Captures**?"
> **Domain expert:** "The **Selector Lifecycle**. It owns 'create + match retroactively' as one operation. Whether it was triggered from the IPC handler or the **Capture Server**'s `/api/selectors` endpoint shouldn't matter."
>
> **Dev:** "What if the investigator is editing a regex while staring at one Capture and wants instant feedback for that page?"
> **Domain expert:** "That's a **Foreground Match Preview** — the renderer runs the pattern against the open Capture's text in-memory. It's not a Persisted Match and it doesn't go through the Selector Lifecycle. Mixing the two breaks the lifecycle's invariant that case-wide counts reflect what the persisted matcher computed."

## Flagged ambiguities

- "service" was used loosely for everything in `src/main/services/` — resolved: prefer **Capture Lifecycle** / **Selector Lifecycle** when referring to the orchestrating modules; keep "service" only for thin wrappers around external systems (e.g. OpenRouter).
