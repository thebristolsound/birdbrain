# Birdbrain

Open source web investigation and capture tool. An Electron desktop app and companion Chrome extension that capture web content into per-case archives with a hash-chained audit trail, then let an investigator search, tag, annotate, and export findings.

## Assurance baseline

Birdbrain has adopted a standards-based OSINT assurance baseline in
[`ADR-0004`](docs/adr/0004-adopt-osint-assurance-baseline.md). The maintained source register,
jurisdiction notes, architectural consequences, and decision gate live in
[`docs/agents/osint-investigation-standards.md`](docs/agents/osint-investigation-standards.md).

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
signing, trusted time, manifests, verification, redaction, export, reporting, and software
distribution when it can alter an evidentiary result or its interpretation.

## Language

### Investigation

**Case**:
A named investigation that owns Exhibits, Selectors, and Notes. The unit of organisation and export. Tags are shared across Cases, not owned by one.
_Avoid_: project, folder, workspace.

**Operator**:
The human investigator. Identified by `installationId` (per-install UUID) and the optional operator name, role, and organisation settings; the id and name are written into Manifest entries.
_Avoid_: user, analyst.

**Persona**:
A signed-in browser identity, the Operator's own or a pseudonym, registered installation-wide and recorded on each Exhibit it was present for. Orthogonal to the Operator, who is always the human and is always recorded beside it.
_Avoid_: alias, sock account, profile, identity, account.

**Case Archive**:
A portable `.birdbrain` file containing one Case's rows and files, chain-verified on import before any data is written.
_Avoid_: backup, dump, case file.

### Acquisition

**Capture**:
The primary artifacts taken from one observation of a single web page (MHTML, Transaction Record, screenshot, PDF, as available), stored on disk under its Case directory and indexed in the database. Its Manifest Entry inventories which artifacts are present and why any is absent. Legacy Captures may be HTML only.
_Avoid_: page, snapshot, record.

**Transaction Record**:
The WARC holding every HTTP request and response of the observed navigation, from its first request to the moment of Capture. Present only when recording was on before the page loaded; never reconstructed afterwards.
_Avoid_: network log, HAR, archive, WARC file (as the general term).

**Capture Server**:
The Hono HTTP server in the main process (port 19845) that the Chrome extension posts captures to. The extension's only way into the ingest path of the Capture Lifecycle; a background Recapture reaches that path without the server. Transport only: a route parses the request, hands it to the Capture Lifecycle, and maps the outcome to a status code. It holds no admission policy.
_Avoid_: ingest server, capture API.

**Active Case**:
The one Case the extension is working in. Chosen by the Operator; required before a Capture Session can start and before the extension may attach a Tag or Note to a page.
_Avoid_: current case, selected case, open case.

**Capture Session**:
The state between the Operator starting and stopping capture into the Active Case. While it runs, the extension matches the Active Case's Selectors against browsed pages; with passive capture withdrawn (ADR-0013), a running session captures nothing by itself.
_Avoid_: session (unqualified), auto-capture, recording.

**Capture Lifecycle**:
Operations that mutate an MHTML Capture beyond its database row: admission of a request from any extension route (operator gate, Active Case resolution, exclusion, the manual dedup window, the screenshot cap, the session count, the activity events), ingestion (parse, hash, store, schedule selector matching), duplication, deletion (manifest entry + DB row + on-disk files, one at a time or as a batch), verification, and case-wide re-extraction. The forensic-bearing path. Legacy HTML Captures (pre-migration v11) appear in deletion and verification but have no manifest entry and no ingest path; new Captures are MHTML-only.
_Avoid_: capture service, capture manager.

**Capture Method**:
How a Capture was produced: by the Chrome extension (`extension`, operator-witnessed), by a silent hidden-window render (`background`), by the Operator capturing the page in front of them in a Persona's browser window (`persona-window`, operator-witnessed), or by copying another Capture in the same Case (`duplicate`, which observed nothing).
_Avoid_: capture type, capture mode.

**Recapture**:
A fresh background Capture of an existing Capture's URL, stored as a linked sibling that supersedes it. The original is never touched; both stay fully visible.
_Avoid_: refresh, re-fetch, update.

**Duplicate**:
A byte-for-byte copy of a Capture whose integrity verifies at the moment of copying, stored in the same Case as its own Capture with a Manifest Entry linking back to the source. It observed nothing and is never a second sighting of the page.
_Avoid_: copy, clone, second capture.

**Consent Suppression**:
The record that maintained consent/cookie-notice filter lists were active while a background Recapture rendered. Absent for operator-witnessed Captures and for renders where the filter engine was unavailable.
_Avoid_: cookie blocking, banner removal.

**Egress**:
The network path Birdbrain's outbound traffic takes: Direct from the Operator's own connection, through a Proxy, or through Tor. Set once for the installation; while it is not Direct, nothing Birdbrain sends leaves directly, and a Capture that Birdbrain renders records which Egress it used and the Operator's label for it. It hides where the Operator is, not what browser is looking. A VPN on the Operator's machine or network leaves the Egress Direct: Birdbrain still sends directly and the VPN carries the traffic.
_Avoid_: route, VPN mode, anonymous mode.

**Scroll-to-load**:
An optional phase before a Capture's artifacts are taken in which the page is scrolled to trigger lazy-loaded content. Whether it was requested, whether it ran, and how it ended are recorded in the Manifest Entry; a Scroll-to-load that fails never silently yields a static Capture.
_Avoid_: scrolling capture, scrolling mode, pre-scroll.

**Extracted Text**:
The plain text pulled from a Capture at ingest: a Derived File whose authoritative copy is the
`.txt` file on disk beside the Capture, integrity-bound through the Manifest. `capture_texts`
holds the database copy for query paths, and `captures_fts` is a derived index over it,
maintained by triggers. Nothing writes it directly. Healing a suspect database copy
(`rebuildFts`) re-reads the files on disk.
_Avoid_: text content, FTS content, text sidecar.

**Exhibit**:
One unit of acquired evidence in a Case, anchored in the Manifest: a Capture, an uploaded file, a saved image, an imported document. Every Exhibit has a kind (what it is) and an origin (how it arrived), and an Exhibit Number once committed.
_Avoid_: artifact, evidence file, item, attachment (as the general term).

**Derived File**:
A file Birdbrain computes from an Exhibit (its extracted text, thumbnail, EXIF data, document metadata), anchored to that Exhibit through a Derivation. Never evidence on its own.
_Avoid_: sidecar (as the general term), derivative, output.

**Derivation**:
The record of how a Derived File was produced: which Exhibit, which computation, which tool version, when. What lets an investigation graph be rebuilt from the chain.
_Avoid_: transform, processing step, extraction record.

**Exhibit Number**:
The sequential per-Case reference an Exhibit receives when it is committed, never reused, recorded in its Manifest Entry so a citation such as "Exhibit 7" is verifiable.
_Avoid_: exhibit id, reference number, label.

**Staging Pool**:
A Case's write-once holding area for files that have arrived but are not yet evidence. A pooled file is hashed but not anchored; only an explicit commit makes it an Exhibit.
_Avoid_: scratch area, inbox, drafts, uploads folder.

### Provenance and integrity

**Manifest**:
The hash-chained, operator-attributed audit log written to each Case directory. It records every ingestion, duplication, deletion, and timestamping of a Capture, and every export, Case Archive export, and import of the Case. Existence and chain integrity are part of the forensic value of an export.
_Avoid_: audit log, journal, ledger.

**Manifest Entry**:
One signed line of the Manifest, of type `capture`, `deletion`, `timestamp`, `export`, `archive-export`, `import`, `exhibit`, `derivation`, `renumber`, `member-add`, `member-revoke`, `merge`, or `exclude`.
_Avoid_: manifest record, log line.

**Shared Case**:
A Case held by more than one installation: one Manifest per member, plus `merge` entries naming other members' heads. Verification proves each member's chain under that member's key, that every `merge` names chain states that exist, and that every citation resolves to one Exhibit.
_Avoid_: team case, synced case, collaborative case (as the term).

**Owner**:
The installation that created a Shared Case. The only one that writes `member-add`, `member-revoke`, and `exclude`; the roster is read from its Manifest and nowhere else.
_Avoid_: host, creator, administrator.

**Member Code**:
The one-to-three character prefix (`[A-Z0-9]`) the Owner assigns a member at approval, recorded in its `member-add`. In a Shared Case a citation is `<Member Code>-<Exhibit Number>`; a Case with no `member-add` has no prefix.
_Avoid_: member prefix, initials.

**Entry Hash**:
The hash over a canonicalized Manifest Entry together with its predecessor's Entry Hash - the link that makes the Manifest a chain.
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
`tampered` displays as "Changed since capture" ("Changed" where space is tight): the tool observes that the bytes changed, not who changed them. The stored and exported value stays `tampered`, because existing packages and older verifiers read it. On the Data screen `tampered`, `missing`, `chain-broken` and a repeated Exhibit Number count together as Integrity exceptions.
_Avoid_: verify status, health; "tampered" or "altered" as the displayed name of this state.

### Corroboration

Corroboration is gathered after a Capture is stored and binds nothing about the captured
transaction. Never phrase these as properties of the Capture itself.

**TLS Cert Chain**:
The certificate chain re-fetched from the origin after a Capture is stored, recording what the origin served at `refetchedAt` - a different moment from the capture ([`ADR-0002`](docs/adr/0002-tls-capture-corroboration-only.md)).
_Avoid_: capture cert, TLS evidence.

**Wayback Snapshot**:
One archive.org record of a captured URL, discovered by a post-capture lookup.
_Avoid_: archive copy, mirror.

**Wayback Ref**:
A Wayback Snapshot the Operator has pinned to a Capture as a persisted corroboration reference.
_Avoid_: archive link, saved snapshot.

### Analysis

**Selector**:
A user-defined text or regular-expression pattern that the Operator wants to find across a Case's Captures. Records where it came from (the extension, a Capture, a Note, or by hand) once, at creation.
_Avoid_: pattern, rule, keyword, signal.

**Selector Lifecycle**:
Operations that create, update, or delete a Selector and asynchronously reconcile its **persisted matches** against the Case's existing Captures. Owns chunking, capping, and FTS fallback uniformly across all entry points (IPC, Capture Server). On `update`, clears stale `selector_matches` rows and re-runs matching when the pattern or `isRegex` flag changes. On `rescan`, re-matches an unchanged Selector against every Capture in the Case; it adds matches and never clears. Emits `selectors:rematched` when async work completes so UI consumers can refetch case-wide counts.
_Avoid_: selector service, selector manager.

**Persisted Match**:
A row in `selector_matches` recording that a Selector's pattern hit a specific Capture's stored text. The source of truth for case-wide counts, dashboard badges, and CSV export. Eventually consistent with the Selector definition (async re-match window).
_Avoid_: selector hit, match record.

**Foreground Match Preview**:
A renderer-local, in-memory run of a Selector's pattern against the open Capture's text, used while the investigator is tuning a pattern. Has no IPC round-trip, writes nothing to the database, and is not part of the Selector Lifecycle. Distinct from **Persisted Match**: previewing answers "does this pattern hit _this_ page right now"; persisted matches answer "how many captures in the case hit this pattern."
_Avoid_: live match, instant match.

**Tag**:
An installation-wide classification label, unique by name. It attaches to Exhibits and Notes in any Case; no Case owns a Tag, and merging two Tags reaches every Case that used either.
_Avoid_: label, category, keyword, signal.

**Note**:
Rich-text commentary owned by a Case, optionally anchored to a Capture, to a region of its screenshot, to a passage of its Extracted Text, or to a Finding in it.
_Avoid_: comment, annotation, memo, analyst notes.

**Favorite**:
An Operator's per-Capture bookmark, used to filter the capture list. Purely organisational; carries no evidentiary meaning.
_Avoid_: pin, star.

**Annotation**:
A geometric shape drawn over a Capture's screenshot - rectangle, arrow, highlight, redaction, or pin.
_Avoid_: markup, drawing, note.

**Pin**:
A numbered Annotation carrying its own body text, so a mark on the image has a written explanation.
_Avoid_: callout, marker.

**Redaction**:
An Annotation that obscures a region. Burned into the reproduced image in `report.html` only - the stored original and the content-addressed copy inside the Evidence Package stay unannotated.
_Avoid_: blackout, mask, censor.

**Mention**:
An inline token in a Note's body referencing a Capture, Selector, Tag, or another Note - written with the `@`/`#` grammar and stored as a typed node in the Note document.
_Avoid_: link, embed, entity token.

**Backlink**:
The reverse edge derived from a Mention: the set of Notes whose bodies mention a given Capture, Selector, Tag, or Note. Computed from the references index, never authored directly.
_Avoid_: incoming link, reverse reference.

**Extracted Datum**:
One category/subcategory/value triple pulled automatically from a Capture's text - an address, hash, CVE, or tracking code. Investigation subject matter, not an integrity construct.
_Avoid_: entity, indicator, artifact.

**Finding**:
Something the tool found in a Capture's text rather than something the Operator wrote: a Persisted Match or an Extracted Datum. The unit below the Capture that a Note can anchor to.
_Avoid_: hit, result, entity.

### Export and verification

**Evidence Package**:
The exported bundle: `manifest.jsonl`, the signed `export-entry.json`, `signing-public-key.pem`, `evidence.json`, `report.html`, `certification.html`, `VERIFY.md`, `verify.sh`, and the selected Exhibits with their Derived Files.
_Avoid_: export, bundle, ZIP.

**Working Copy**:
A clearly labelled non-evidentiary export for the Operator's own use: the selected Exhibits, their screenshots, and Notes, without Certification. Not an Evidence Package; an Evidence Package always includes its Certification and full Manifest.
_Avoid_: draft export, partial package.

**Certification**:
The operator statement in an Evidence Package naming the tool, hash algorithm, process, TSA identity, and per-Capture Trusted Time counts.
_Avoid_: cover sheet, declaration.

**Verify Runbook**:
The `VERIFY.md` instructions telling a third party how to check the package with standard tools, independent of Birdbrain. The canonical TSA check (`openssl ts -verify`) lives here. `verify.sh`, enclosed beside it, is the same six steps as a runnable script; the runbook stays the explanation and the authority.
_Avoid_: verification guide, instructions.

**Package Verification**:
The standalone verifier's integrity and internal-consistency check over an Evidence Package, treating the signed Manifest as the sole source of truth. A PASS is not an authenticity claim, and its timestamp checks are structural only - a binary PASS is not a Verify Runbook PASS.
_Avoid_: validation, authentication.

**Package Hash**:
The hash over an Evidence Package's contents, recorded in the `export` Manifest Entry that produced it.
_Avoid_: export hash, bundle hash.

**Package Layout**:
Where each member of an Evidence Package sits and what it is named: the page archive, screenshot and Timestamp Token of a Capture, the file of any other Exhibit, each Derived File, and the fixed root documents. Held once and read by the writer, by Package Verification, and by the Verify Runbook, so no two of them can name the same member differently.
_Avoid_: package structure, zip layout, file tree.

**Evidence Profile**:
The versioned public specification of Birdbrain's evidence protocol - schemas, package layout, canonicalization, verification statuses, and migration rules. Not yet published; required before general forensic-assurance claims ([`ADR-0004`](docs/adr/0004-adopt-osint-assurance-baseline.md)).
_Avoid_: evidence spec, format version.

### Governance

**Evidence-Affecting Change**:
A change to acquisition, parsing, extraction, storage, hashing, signing, trusted time, manifests, verification, redaction, export, reporting, or software distribution that can alter an evidentiary result or the interpretation of one. Carries the per-change obligations listed under the preceding "Assurance baseline" section.
_Avoid_: risky change, core change, forensic change.

## Relationships

- A **Case** owns many **Exhibits**, **Selectors**, and **Notes**; a **Capture** is one kind of **Exhibit**
- A **Tag** is installation-wide and classifies **Exhibits** and **Notes** in any **Case**; no **Case** owns it
- A **Capture Lifecycle** operation on an MHTML **Capture** writes a **Manifest** entry attributed to an **Operator**
- A **Persona** is installation-wide like a **Tag**; an **Exhibit** records at most one, with the label it had at acquisition, and never in place of the **Operator**
- A background **Recapture** may render through a **Persona**'s browser session and records that it did; an extension **Capture** can only declare which **Persona** the operator says was signed in
- The **Capture Server** receives raw captures from the Chrome extension and hands them to the **Capture Lifecycle**
- A **Capture Session** runs against exactly one **Active Case**; the extension attaches a **Tag** or **Note** only to the **Active Case**, capturing the page first when it has no **Capture** yet
- Each **Manifest Entry** carries an **Entry Hash** over itself and its predecessor's, which is what makes the **Manifest** a chain
- A **Capture**'s **Content Hash** may be attested by one **Timestamp Token** from a **TSA**, moving its **Trusted Time** from `pending` to `rfc3161`
- **Trusted Time** and **Integrity Status** are orthogonal: a byte-perfect **Capture** is integrity-verified whether or not it carries a trusted timestamp
- A **Recapture** produces a new **Capture** that supersedes an existing one; both remain visible and neither is overwritten
- A **Duplicate** is a new **Capture** that links to its source and shares its **Content Hash**; unlike a **Recapture** it observed nothing
- A **TLS Cert Chain** and a **Wayback Ref** attach to a **Capture** as corroboration only, and bind nothing about the captured transaction
- Creating or updating a **Selector** triggers the **Selector Lifecycle** to (re)compute **Persisted Matches** for the **Case**'s existing **Captures**, asynchronously
- A **Foreground Match Preview** is computed in the renderer against the open **Capture**'s text and never touches **Persisted Matches**
- A **Capture**'s **Extracted Text** is a **Derived File** on disk (authoritative), mirrored to the database for the **Selector Lifecycle** and search
- A **Derived File** is anchored to its parent **Exhibit** through a **Derivation** and is never evidence on its own
- A file in the **Staging Pool** is hashed but not anchored; committing it makes it an **Exhibit** with an **Exhibit Number** and a **Manifest Entry**, and discarding it writes nothing
- A **Note** may anchor to a **Capture**, to a region of its screenshot, to a passage of its **Extracted Text**, or to a **Finding**
- The **Package Layout** names where every member of an **Evidence Package** sits; the writer, **Package Verification** and the **Verify Runbook** all read it from one place
- An **Evidence Package** contains the **Manifest**, a **Certification**, a **Verify Runbook**, and the exported **Exhibits**; **Package Verification** establishes the chain from the **Manifest** and reconciles the unsigned index against it

## Example dialogue

> **Dev:** "When the extension posts a capture, who writes the **Manifest** entry?"
> **Domain expert:** "The **Capture Server** receives the request, but the **Manifest** write is part of the **Capture Lifecycle**'s ingest step - the server is only the transport."
>
> **Dev:** "And when the user creates a **Selector**, who runs it against existing **Captures**?"
> **Domain expert:** "The **Selector Lifecycle**. It owns 'create + match retroactively' as one operation. Whether it was triggered from the IPC handler or the **Capture Server**'s `/api/selectors` endpoint shouldn't matter."
>
> **Dev:** "What if the investigator is editing a regular expression while staring at one Capture and wants instant feedback for that page?"
> **Domain expert:** "That's a **Foreground Match Preview** - the renderer runs the pattern against the open Capture's text in-memory. It's not a Persisted Match and it doesn't go through the Selector Lifecycle. Mixing the two breaks the Selector Lifecycle invariant that case-wide counts reflect what the persisted matcher computed."
>
> **Dev:** "A capture reads `verified` but its badge still says something about time. Is it half-broken?"
> **Domain expert:** "Those are two axes. **Integrity Status** `verified` means the bytes and the chain survived. **Trusted Time** `pending` means it's an eligible capture that hasn't had a **Timestamp Token** issued yet. It's fully integrity-verified either way."
>
> **Dev:** "Then what does the **TLS Cert Chain** prove - that we saw that cert when we captured?"
> **Domain expert:** "Nothing about the captured transaction. We re-fetch it from the origin after storing, so it records whatever was being served at `refetchedAt`. Same for a **Wayback Ref**. If we ever phrase either as 'the certificate for this capture' we've made a claim we can't defend."
>
> **Dev:** "Is running our verifier enough to hand a package to the other side?"
> **Domain expert:** "**Package Verification** is an integrity and internal-consistency result, not an authenticity claim. The **Verify Runbook** is what makes the **Evidence Package** checkable without trusting us - the canonical TSA check is `openssl ts -verify` from `VERIFY.md`. A binary PASS is not a runbook PASS."
>
> **Dev:** "If I duplicate a capture, do I get a second observation of the page?"
> **Domain expert:** "No. A **Duplicate** copies bytes that already verify and links to its source; it observed nothing. A **Recapture** goes back to the URL and observes again. Only the second is a new sighting."

## Flagged ambiguities

- "service" was used loosely for everything in `src/main/services/` - resolved: prefer **Capture Lifecycle** / **Selector Lifecycle** when referring to the orchestrating modules; keep "service" only for thin wrappers around external systems (for example the TSA or the Wayback Machine).

- "timestamp" conflates two incompatible claims: `Capture.timestamp` is the observation time asserted by the capturing machine's clock, while a **Timestamp Token** is a third party's attestation. Say "capture time" for the former and "trusted timestamp" or "stamped at" for the latter. Treating them as interchangeable is the most damaging slip available in this domain.

- "verify" means four operations that establish four different things: verifying a **Capture** (bytes plus chain position), verifying the **Manifest** chain, **Package Verification** of an export, and the runbook's `openssl ts -verify` of a **Timestamp Token**. Never write "verified" unqualified in user-facing text or a commit message - name which one.

- "archive" is overloaded three ways: a **Case Archive** (`.birdbrain` file), a Case's `archived` boolean (hidden from the dashboard), and archive.org. Keep **Case Archive** for the file, say "archived Case" for the flag, and always say "Wayback" for archive.org.

- "hash" spans integrity and subject matter: **Entry Hash**, **Content Hash**, and **Package Hash** are integrity constructs, while the MD5/SHA-1/SHA-256 values under **Extracted Datum** are findings pulled out of page text. Qualify every use.

- "pin" spans three unrelated actions: a **Pin** is a numbered Annotation with body text; a **Wayback Ref** is "pinned" corroboration; and bookmarking a Capture in the list is a **Favorite**, never a pin. Any capture-list action labelled "pin" is a Favorite.

- "Signals" is the user-facing name of the screen that shows Selectors and Tags together. The domain terms are **Selector** and **Tag** everywhere else (lifecycles, Persisted Match, routes, repos, schemas); "signal" is not a domain term, appears in code only in that screen's component names and its coverage strip, and never in schemas, channel names, or domain discussion.

- "source" is used for four unrelated things: `CaptureSource` (`auto`/`manual`/`selector`/`recapture`), a Note's `sourceUrl`, the extraction pipeline's `extractionSource`, and the overview's Sources block. Say "capture trigger" for `CaptureSource` and reserve "source" for the origin a Capture came from.

- "auto-capture" names four unrelated things: the top-bar switch that starts and stops a **Capture Session** (#813), the Signals card and the `autoCaptureMode` setting that edit a Case's URL exclusion policy (#744), the Capture Server capturing a page before the extension attaches a **Tag** or **Note** to it, and the withdrawn passive capture whose return ADR-0013 scopes to a declared window (#600). Say "Capture Session" for the switch, "exclusion policy" for the card, and "capture-then-attach" for the server path; "passive capture" and its vocabulary stay reserved to ADR-0013 until the restoration lands.

- "route" is the Capture Server's HTTP route (a handler that parses a request and hands it to the Capture Lifecycle). The path outbound traffic takes is the **Egress**; never call it a route.

- "session" is four things: a **Capture Session**; one app launch, which the crash-recovery prompt tracks through a lock file; the last Case and screen the app restores on launch ("session restore"); and the browser profile a webview or a background **Recapture** renders in, which for a **Persona** is its persona session. Unqualified "session" means Capture Session; qualify the other three.

- "staging" and "derivation" are domain terms (**Staging Pool**, **Derivation**) that code comments also use casually: the scratch directory an archive import unpacks into, the scratch file a database snapshot writes through, and any computed value. In prose, reserve both words for the domain terms and say "scratch" or "computed" for the rest.
