# Birdbrain

Open-source web investigation and capture tool. An Electron desktop app and companion Chrome extension that capture web content into per-case archives with a hash-chained audit trail, then let an investigator search, tag, annotate, and export findings.

## Assurance baseline

Birdbrain has adopted a standards-based OSINT assurance baseline in
[`ADR-0004`](docs/adr/0004-adopt-osint-assurance-baseline.md). The maintained source register,
jurisdiction notes, architectural consequences, and decision gate live in
[`website/content/docs/osint-investigation-standards.mdx`](website/content/docs/osint-investigation-standards.mdx).

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

### Investigation

**Case**:
A named investigation that owns Captures, Tags, Selectors, and Notes. The unit of organisation and export.
_Avoid_: project, folder, workspace.

**Operator**:
The human investigator. Identified by `installationId` (per-install UUID) and an optional `operatorName` setting; both are written into Manifest entries.
_Avoid_: user, analyst.

**Case Archive**:
A portable `.birdbrain` file containing one Case's rows and artifacts, chain-verified on import before any data is written.
_Avoid_: backup, dump, case file.

### Acquisition

**Capture**:
A snapshot of a single web page (HTML or MHTML, optionally with screenshot and extracted text), stored on disk under its Case directory and indexed in the database.
_Avoid_: page, snapshot, record.

**Capture Server**:
The Hono HTTP server in the main process (port 19845) that the Chrome extension posts captures to. The only entry point for the Capture Lifecycle's ingest path.
_Avoid_: ingest server, capture API.

**Capture Lifecycle**:
Operations that mutate an MHTML Capture beyond its database row — ingestion (parse, hash, store, schedule selector matching), deletion (manifest entry + DB row + on-disk files), verification, and case-wide re-extraction. The forensic-bearing path. Legacy HTML Captures (pre-migration v11) appear in deletion and verification but have no manifest entry and no ingest path; new Captures are MHTML-only.
_Avoid_: capture service, capture manager.

**Capture Method**:
Whether a Capture was produced by the Chrome extension (`extension`, operator-witnessed) or by a silent hidden-window render (`background`).
_Avoid_: capture type, capture mode.

**Recapture**:
A fresh background Capture of an existing Capture's URL, stored as a linked sibling that supersedes it. The original is never touched; both stay fully visible.
_Avoid_: refresh, re-fetch, update.

**Consent Suppression**:
The record that maintained consent/cookie-notice filter lists were active while a background Recapture rendered. Absent for operator-witnessed Captures and for renders where the filter engine was unavailable.
_Avoid_: cookie blocking, banner removal.

**Extracted Text**:
The plain text pulled from a Capture at ingest. The authoritative copy is the `.txt` sidecar on
disk (integrity-bound via `textSha256` in the Manifest); `capture_texts` holds the database copy
for query paths, and `captures_fts` is a derived index over it, maintained by triggers — never
written directly. Healing a suspect database copy (`rebuildFts`) re-reads the sidecars.
_Avoid_: text content, FTS content.

### Provenance and integrity

**Manifest**:
The hash-chained, operator-attributed audit log written to each Case directory that records every Capture ingestion and per-Capture deletion. Existence and chain integrity are part of the forensic value of an export.
_Avoid_: audit log, journal, ledger.

**Manifest Entry**:
One signed line of the Manifest, of type `capture`, `deletion`, `timestamp`, `export`, `archive-export`, or `import`.
_Avoid_: manifest record, log line.

**Entry Hash**:
The hash over a canonicalised Manifest Entry together with its predecessor's Entry Hash — the link that makes the Manifest a chain.
_Avoid_: line hash, record hash.

**Content Hash**:
The SHA-256 over a Capture's stored bytes. The identity a Timestamp Token attests to, and what chain verification re-computes.
_Avoid_: file hash, capture hash.

**Trusted Time**:
The axis recording whether a Capture's Content Hash is anchored by an RFC 3161 token: `rfc3161` (stamped), `pending` (eligible, not yet stamped), or `none` (grandfathered legacy Capture). Orthogonal to Integrity Status.
_Avoid_: timestamp status, stamp state.

**Timestamp Token**:
The RFC 3161 token returned by a TSA, binding an asserted time to a submitted imprint.
_Avoid_: stamp, TSA response.

**TSA**:
The external RFC 3161 Time-Stamping Authority whose endpoint the Operator configures (`tsaUrl`, defaulting to DigiCert).
_Avoid_: time server, timestamp service.

**Integrity Status**:
The axis recording whether a Capture's bytes and chain position survived intact: `verified`, `tampered`, `missing`, `chain-broken`, or `legacy`.
_Avoid_: verify status, health.

### Corroboration

Corroboration is gathered after a Capture is stored and binds nothing about the captured
transaction. Never phrase these as properties of the Capture itself.

**TLS Cert Chain**:
The certificate chain re-fetched from the origin after a Capture is stored, recording what the origin served at `refetchedAt` — a different moment from the capture ([`ADR-0002`](docs/adr/0002-tls-capture-corroboration-only.md)).
_Avoid_: capture cert, TLS evidence.

**Wayback Snapshot**:
One archive.org record of a captured URL, discovered by a post-capture lookup.
_Avoid_: archive copy, mirror.

**Wayback Ref**:
A Wayback Snapshot the Operator has pinned to a Capture as a persisted corroboration reference.
_Avoid_: archive link, saved snapshot.

### Analysis

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

**Note**:
Rich-text commentary owned by a Case, optionally anchored to a Capture or to specific text within one.
_Avoid_: comment, annotation, memo, analyst notes.

**Favorite**:
An Operator's per-Capture bookmark, used to filter the capture list. Purely organisational; carries no evidentiary meaning.
_Avoid_: pin, star.

**Annotation**:
A geometric shape drawn over a Capture's screenshot — rectangle, arrow, highlight, redaction, or pin.
_Avoid_: markup, drawing, note.

**Pin**:
A numbered Annotation carrying its own body text, so a mark on the image has a written explanation.
_Avoid_: callout, marker.

**Redaction**:
An Annotation that obscures a region. Burned into the reproduced image in `report.html` only — the stored original and the content-addressed copy inside the Evidence Package stay unannotated.
_Avoid_: blackout, mask, censor.

**Mention**:
An inline token in a Note's body referencing a Capture, Selector, Tag, or another Note — written with the `@`/`#` grammar and stored as a typed node in the Note document.
_Avoid_: link, embed, entity token.

**Backlink**:
The reverse edge derived from a Mention: the set of Notes whose bodies mention a given Capture, Selector, Tag, or Note. Computed from the references index, never authored directly.
_Avoid_: incoming link, reverse reference.

**Extracted Datum**:
One category/subcategory/value triple pulled automatically from a Capture's text — an address, hash, CVE, or tracking code. Investigation subject matter, not an integrity construct.
_Avoid_: entity, indicator, artifact.

**Capture Analysis**:
The AI-generated commentary on a single Capture, stored with the model and token usage that produced it.
_Avoid_: summary, AI note.

### Export and verification

**Evidence Package**:
The exported bundle — `manifest.jsonl`, `evidence.json`, `report.html`, `certification.html`, `VERIFY.md`, and the selected artifacts.
_Avoid_: export, bundle, ZIP.

**Working Copy**:
A clearly-labelled non-evidentiary export for the Operator's own use — selected artifacts and notes without Certification. Not an Evidence Package; an Evidence Package always includes its Certification and full Manifest.
_Avoid_: draft export, partial package.

**Certification**:
The operator statement in an Evidence Package naming the tool, hash algorithm, process, TSA identity, and per-Capture Trusted Time counts.
_Avoid_: cover sheet, declaration.

**Verify Runbook**:
The `VERIFY.md` instructions telling a third party how to check the package with standard tools, independent of Birdbrain. The canonical TSA check (`openssl ts -verify`) lives here.
_Avoid_: verification guide, instructions.

**Package Verification**:
The standalone verifier's integrity and internal-consistency check over an Evidence Package, treating the signed Manifest as the sole source of truth. A PASS is not an authenticity claim, and its timestamp checks are structural only — a binary PASS is not a Verify Runbook PASS.
_Avoid_: validation, authentication.

**Package Hash**:
The hash over an Evidence Package's contents, recorded in the `export` Manifest Entry that produced it.
_Avoid_: export hash, bundle hash.

**Evidence Profile**:
The versioned public specification of Birdbrain's evidence protocol — schemas, package layout, canonicalisation, verification statuses, and migration rules. Not yet published; required before general forensic-assurance claims ([`ADR-0004`](docs/adr/0004-adopt-osint-assurance-baseline.md)).
_Avoid_: evidence spec, format version.

### Governance

**Evidence-Affecting Change**:
A change to acquisition, parsing, extraction, storage, hashing, signing, trusted time, manifests, verification, redaction, export, reporting, AI analysis, or software distribution that can alter an evidentiary result or the interpretation of one. Carries the per-change obligations listed under "Assurance baseline" above.
_Avoid_: risky change, core change, forensic change.

## Relationships

- A **Case** owns many **Captures**, **Selectors**, and **Notes**
- A **Capture Lifecycle** operation on an MHTML **Capture** writes a **Manifest** entry attributed to an **Operator**
- The **Capture Server** receives raw captures from the Chrome extension and hands them to the **Capture Lifecycle**
- Each **Manifest Entry** carries an **Entry Hash** over itself and its predecessor's, which is what makes the **Manifest** a chain
- A **Capture**'s **Content Hash** may be attested by one **Timestamp Token** from a **TSA**, moving its **Trusted Time** from `pending` to `rfc3161`
- **Trusted Time** and **Integrity Status** are orthogonal: a byte-perfect **Capture** is integrity-verified whether or not it carries a trusted timestamp
- A **Recapture** produces a new **Capture** that supersedes an existing one; both remain visible and neither is overwritten
- A **TLS Cert Chain** and a **Wayback Ref** attach to a **Capture** as corroboration only, and bind nothing about the captured transaction
- Creating or updating a **Selector** triggers the **Selector Lifecycle** to (re)compute **Persisted Matches** for the **Case**'s existing **Captures**, asynchronously
- A **Foreground Match Preview** is computed in the renderer against the open **Capture**'s text and never touches **Persisted Matches**
- A **Capture**'s **Extracted Text** lives in its `.txt` sidecar (authoritative) and is mirrored to the database for the **Selector Lifecycle** and search
- An **Evidence Package** contains the **Manifest**, a **Certification**, a **Verify Runbook**, and the exported **Captures**; **Package Verification** establishes the chain from the **Manifest** and reconciles the unsigned index against it

## Example dialogue

> **Dev:** "When the extension posts a capture, who writes the **Manifest** entry?"
> **Domain expert:** "The **Capture Server** receives the request, but the **Manifest** write is part of the **Capture Lifecycle**'s ingest step — the server is only the transport."
>
> **Dev:** "And when the user creates a **Selector**, who runs it against existing **Captures**?"
> **Domain expert:** "The **Selector Lifecycle**. It owns 'create + match retroactively' as one operation. Whether it was triggered from the IPC handler or the **Capture Server**'s `/api/selectors` endpoint shouldn't matter."
>
> **Dev:** "What if the investigator is editing a regex while staring at one Capture and wants instant feedback for that page?"
> **Domain expert:** "That's a **Foreground Match Preview** — the renderer runs the pattern against the open Capture's text in-memory. It's not a Persisted Match and it doesn't go through the Selector Lifecycle. Mixing the two breaks the lifecycle's invariant that case-wide counts reflect what the persisted matcher computed."
>
> **Dev:** "A capture reads `verified` but its badge still says something about time. Is it half-broken?"
> **Domain expert:** "Those are two axes. **Integrity Status** `verified` means the bytes and the chain survived. **Trusted Time** `pending` means it's an eligible capture that hasn't had a **Timestamp Token** issued yet. It's fully integrity-verified either way."
>
> **Dev:** "Then what does the **TLS Cert Chain** prove — that we saw that cert when we captured?"
> **Domain expert:** "Nothing about the captured transaction. We re-fetch it from the origin after storing, so it records whatever was being served at `refetchedAt`. Same for a **Wayback Ref**. If we ever phrase either as 'the certificate for this capture' we've made a claim we can't defend."
>
> **Dev:** "Is running our verifier enough to hand a package to the other side?"
> **Domain expert:** "**Package Verification** is an integrity and internal-consistency result, not an authenticity claim. The **Verify Runbook** is what makes the **Evidence Package** checkable without trusting us — the canonical TSA check is `openssl ts -verify` from `VERIFY.md`. A binary PASS is not a runbook PASS."

## Flagged ambiguities

- "service" was used loosely for everything in `src/main/services/` — resolved: prefer **Capture Lifecycle** / **Selector Lifecycle** when referring to the orchestrating modules; keep "service" only for thin wrappers around external systems (e.g. OpenRouter, the TSA).

- "timestamp" conflates two incompatible claims: `Capture.timestamp` is the observation time asserted by the capturing machine's clock, while a **Timestamp Token** is a third party's attestation. Say "capture time" for the former and "trusted timestamp" or "stamped at" for the latter. Treating them as interchangeable is the most damaging slip available in this domain.

- "verify" means four operations with four different guarantees: verifying a **Capture** (bytes plus chain position), verifying the **Manifest** chain, **Package Verification** of an export, and the runbook's `openssl ts -verify` of a **Timestamp Token**. Never write "verified" unqualified in user-facing text or a commit message — name which one.

- "archive" is overloaded three ways: a **Case Archive** (`.birdbrain` file), a Case's `archived` boolean (hidden from the dashboard), and archive.org. Keep **Case Archive** for the file, say "archived Case" for the flag, and always say "Wayback" for archive.org.

- "hash" spans integrity and subject matter: **Entry Hash**, **Content Hash**, and **Package Hash** are integrity constructs, while the MD5/SHA-1/SHA-256 values under **Extracted Datum** are findings pulled out of page text. Qualify every use.

- "pin" spans three unrelated actions: a **Pin** is a numbered Annotation with body text; a **Wayback Ref** is "pinned" corroboration; and bookmarking a Capture in the list is a **Favorite** — never "pinning". Any capture-list action labelled "pin" is a Favorite.

- "Signals" is the user-facing name of the selectors screen only. The domain and code term is **Selector** everywhere (Selector Lifecycle, Persisted Match, routes, repos); "Signals" never appears in schemas, code identifiers, or domain discussion.

- "source" is used for four unrelated things: `CaptureSource` (`auto`/`manual`/`selector`/`recapture`), a Note's `sourceUrl`, the extraction pipeline's `extractionSource`, and the overview's Sources block. Say "capture trigger" for `CaptureSource` and reserve "source" for the origin a Capture came from.
