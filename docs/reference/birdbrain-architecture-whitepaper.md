# Birdbrain: A Local-First Architecture for Verifiable Web Evidence

> **Birdbrain whitepaper series.** Four companion papers cover this project.
> This paper is the formal architecture and assurance analysis: trust
> boundaries, evidence claims and their limits, and deployment posture. Start
> here for security review. The
> [contributor and adoption whitepaper](birdbrain-contributor-adoption-whitepaper.md)
> covers product fit, onboarding, contribution areas, and governance. The
> [technical whitepaper](birdbrain-technical-whitepaper.md) is the code-grounded
> implementation companion: exact mechanisms with file references and gaps
> observed during code review. The
> [privacy-focused adoption guide](birdbrain-privacy-adoption-whitepaper.md)
> addresses activists and independent researchers evaluating Birdbrain for
> small privacy-focused groups. All four describe version `1.0.1-beta.15`.
> Where depth differs, this paper is authoritative on assurance claims and the
> technical whitepaper is authoritative on implementation detail.

## Executive summary

Birdbrain is an open-source desktop application for collecting, organizing, and
verifying web evidence. It addresses a recurring problem in open-source
intelligence (OSINT): web content is mutable, ordinary screenshots omit important
context, and cloud investigation platforms can introduce cost, custody, privacy,
and availability dependencies. Birdbrain instead keeps evidence on the
investigator's workstation and combines a Chromium extension with an Electron
application to capture MHTML, screenshots, extracted text, response metadata,
and provenance into named Cases.

The architecture treats evidence integrity as a first-class system property.
SHA-256 hashes bind captured artifacts to an append-only, hash-chained Manifest.
Each current-schema Manifest entry is signed by a per-installation RSA key, and
eligible Captures are asynchronously submitted to an RFC 3161 timestamp
authority. Integrity and trusted time remain separate claims: hashing and
signatures show whether evidence changed, while a third-party timestamp
establishes that the hashed content existed no later than an asserted time.
Portable evidence packages and a standalone verifier allow these checks to
continue outside the running application.

Birdbrain is intentionally a workstation product, not a multi-tenant service.
SQLite, filesystem artifact storage, a loopback-only Capture Server, and typed
Electron IPC keep deployment simple and data custody legible. This design provides strong local workflows and portable
verification, but it does not provide centralized identity, role-based access
control, remote administration, or protection against an Operator who fully
controls the host.

## Problem statement and business context

Web evidence is unusually fragile. A page may be edited, deleted, personalized,
redirected, or served differently by geography and time. A screenshot preserves
appearance but usually omits response metadata, machine-readable content, and a
replayable representation of the page. A bookmark preserves none of the content.
Even a complete local copy has limited evidentiary value if a reviewer cannot
determine whether its bytes changed after collection.

Investigators therefore need more than capture. They need a workflow that:

- preserves browser-observed content and a human-readable rendering;
- records when, where, how, and by whom a Capture was created;
- makes later modification detectable;
- separates locally asserted time from independently attested time;
- supports search and analysis without altering source evidence;
- transfers a Case without silently breaking its custody history; and
- remains useful without an account, license server, or hosted evidence store.

These requirements are relevant to investigative journalists, independent
researchers, fraud and abuse teams, threat-intelligence practitioners, human
rights investigators, educators, and small organizations that cannot or do not
want to place sensitive source material into a vendor-controlled platform.

Birdbrain's business context follows from these constraints. It is MIT-licensed,
has no required cloud account, and does not send telemetry. The core collection
and evidence-management workflow runs locally. Network egress is limited to
explicit supporting functions: trusted timestamping, Wayback Machine
corroboration, and software updates. This narrow footprint
reduces custody ambiguity and vendor dependence, although it places more
operational responsibility on the workstation owner.

### Source basis and assumptions

This whitepaper describes the implementation in the repository at version
`1.0.1-beta.15`. Source code, tests, build configuration, `CONTEXT.md`, and
accepted architecture decisions are treated as authoritative. Design documents
are used to explain intent but not to claim an unimplemented capability.

The intended audience is engineering leadership, security architecture teams,
technical evaluators, and contributors. Compliance observations identify
technical controls and gaps; they are not a claim of certification, legal
admissibility, or conformance to a specific regulatory framework.

## Solution overview

### What the application does

Birdbrain organizes an investigation around a **Case**. A Case owns Captures,
Selectors, Notes, tags, annotations, extracted indicators, and supporting
corroboration. The typical workflow is:

1. The Operator creates or activates a Case in the desktop application.
2. The companion extension captures a web page as MHTML and may also collect a
   full-page screenshot, extracted text, headers, and browser metadata.
3. The extension posts the payload to a token-protected HTTP server bound to
   `127.0.0.1:19845`.
4. The Capture Lifecycle validates, hashes, stores, indexes, and records the
   Capture in the Case Manifest.
5. Post-capture work requests a trusted timestamp, performs TLS corroboration,
   extracts structured indicators, and reconciles enabled Selectors. The
   Operator can separately initiate a Wayback Machine lookup.
6. The Operator searches, tags, annotates, compares, recaptures, or adds Notes
   without modifying the original Capture.
7. Birdbrain verifies evidence before packaging it for review or transfer.

New Capture ingestion is MHTML-oriented. Legacy HTML Captures remain readable,
deletable, and verifiable under their historical rules, but they do not
participate in the current ingest path.

### Who it is for and key use cases

Birdbrain is designed for an individual Operator or a small team exchanging Case
archives rather than sharing a central service.

Representative use cases include:

- preserving a volatile page before it is changed or removed;
- documenting online fraud, threats, disinformation, or policy violations;
- collecting source material while keeping it off third-party storage;
- applying text and regular-expression Selectors across an investigation;
- extracting indicators such as domains, URLs, addresses, or identifiers;
- annotating screenshots while preserving an untouched source Capture;
- recapturing a page to show change over time with explicit provenance;
- generating a reviewable evidence package with integrity results; and
- transferring a Case between installations while retaining its prior chain.

The application is not currently a case-management server, collaborative
e-discovery platform, identity provider, or long-term evidence escrow service.

## Architecture

### Architectural style

Birdbrain uses a local, layered desktop architecture with explicit process and
trust boundaries:

- a Chromium extension performs collection in the browser;
- a loopback Capture Server is the extension-facing integration boundary;
- the Electron main process owns privileged operations and domain lifecycles;
- a preload bridge exposes a constrained, typed API;
- a sandboxed React renderer provides the user interface;
- SQLite stores queryable state and derived indexes; and
- the filesystem stores forensic artifacts and the Case Manifest.

This is not a conventional client-server deployment. The "server" is an
in-process local adapter whose purpose is to bridge a browser extension and a
desktop application without opening the application's privileged internals to
the renderer or network.

### High-level diagram description

A diagram should contain the following blocks and arrows:

1. **Chromium Browser and Birdbrain Extension** on the left. Inside it, show a
   content script, background service worker, and popup. Draw arrows from the
   active web page into the content script for page content and visible context.
2. **Loopback Trust Boundary** in the center-left. Inside it, place the Hono
   Capture Server on `127.0.0.1:19845`. Draw an authenticated HTTP arrow from the
   extension to this block, labeled "MHTML, screenshot, extracted text, headers,
   metadata, bearer token."
3. **Electron Main Process** in the center. Place the Capture Lifecycle, Selector
   Lifecycle, Case archive/export services, verification core adapters,
   timestamp worker, background recapture renderer, and integration clients
   inside it. Draw an arrow from the Capture Server to the Capture Lifecycle.
4. **Local Persistence** below the main process. Split it into SQLite and
   per-Case filesystem storage. Draw arrows from lifecycle and repository
   components to SQLite. Draw separate arrows to MHTML, screenshot, text
   sidecars, timestamp tokens, and `manifest.jsonl`.
5. **Electron Renderer** on the right. Show React, TanStack Router, React Query,
   and Zustand. Between renderer and main, place the preload/context bridge.
   Label the bidirectional arrow "typed IPC commands, queries, and events."
6. **External Optional Services** above the main process. Include an RFC 3161
   timestamp authority, Wayback Machine, origin TLS endpoints, and GitHub
   Releases. Draw outbound-only arrows from their owning main-process services.
   Label each arrow with the data sent: content hash for the timestamp
   authority; URL for Wayback and TLS corroboration; version/update traffic for
   GitHub.
7. **Evidence Consumer** below or to the far right. Draw an export arrow from the
   main process to an evidence ZIP or `.birdbrain` Case archive, then an arrow
   into the standalone verifier and a separate `openssl ts -verify` step.

Visually distinguish three boundaries: untrusted web content, local application
privilege, and external network services.

### Component breakdown

#### Chromium extension

The extension supplies browser context that a standalone desktop application
cannot obtain directly. Its background worker coordinates capture state and
tab-level operations; the content script extracts page data and detects Selector
matches; the popup exposes Case and capture controls.

The extension requests broad HTTP and HTTPS host permissions because arbitrary
page collection is its core function. It sends captures only to the loopback
Capture Server. Background message handlers reject messages from other
extensions. URL ignore rules are applied in both the extension and server, so a
client-side omission does not remove the server-side control.

#### Capture Server

The Hono server is the extension-facing API and the only entry point for current
Capture ingestion. It exposes health, Case selection, session control, Capture
upload, active Selector, Selector creation, and pipeline-test routes.

The server:

- binds only to `127.0.0.1`;
- rejects non-loopback Host headers as a DNS-rebinding defense;
- requires a per-installation random bearer token for mutations;
- validates request bodies with Zod-backed schemas;
- caps MHTML at 200 MB and screenshots at 100 MB;
- applies URL blocklists and deduplication policy; and
- emits Capture events for received, stored, skipped, and failed outcomes.

Some read-only endpoints expose Case names and active Selector patterns without
authentication to local processes. This is a known metadata-confidentiality
trade-off, not an internet-facing exposure.

#### Capture Lifecycle

The Capture Lifecycle owns operations that affect the forensic-bearing state of
a Capture. It orchestrates ingestion, artifact storage, Manifest appends,
database persistence, deletion, verification, re-extraction, and asynchronous
follow-up work.

The lifecycle uses a write-ahead Manifest pattern. A signed entry is appended and
flushed before dependent persistence completes; if the later operation fails,
the Manifest is truncated to its prior byte boundary. This makes the invariant
explicit: the surviving Manifest should not claim a Capture or deletion that did
not complete.

Individual Capture deletion receives a signed deletion entry before the row and
artifacts are removed. Whole-Case deletion deliberately does not emit one entry
per Capture because the Case directory and its Manifest are removed as a unit.

#### Selector Lifecycle

A Selector is a literal or regular-expression pattern applied across a Case.
Creating or materially updating one initiates asynchronous reconciliation
against existing Captures. Results are stored as Persisted Matches and serve as
the source for Case-wide counts and export.

The lifecycle centralizes chunking, result caps, safe-regex handling, FTS
fallback, and completion events. A separate renderer-local Foreground Match
Preview gives immediate feedback for the open Capture without changing
Persisted Matches. This separation prevents UI experimentation from corrupting
Case-wide match semantics.

#### Persistence and repositories

`better-sqlite3` provides a transactional embedded database. Initialization
enables foreign keys, WAL journaling, a five-second busy timeout, and sequential
schema migrations using SQLite's `user_version`. Feature-oriented repositories
own Cases, Captures, tags, Selectors, Notes, extracted data, and archive
references.

The filesystem stores large and forensic-bearing artifacts. The Capture store
resolves artifact access through Case and Capture identity rather than accepting
arbitrary renderer-supplied paths. This is both a module boundary and a path
traversal defense.

#### Renderer and preload bridge

The renderer is a React 19 application using TanStack Router for navigation,
React Query for server state, Zustand for UI-only state, Tailwind CSS, and
Radix-derived UI primitives. React Query centralizes query keys, mutation
behavior, and cache invalidation. Zustand holds transient selection, session,
filter, and activity state.

The renderer has no Node integration. A sandboxed preload script exposes named,
typed operations through Electron's `contextBridge`; raw `ipcRenderer`,
filesystem access, and shell execution are not exposed. Shared IPC definitions
use domain-oriented channel names and typed request/response contracts.

#### Verification core and standalone verifier

Pure verification modules under `src/shared/verify` implement canonical JSON,
Manifest-chain validation, RSA signature checks, timestamp-token parsing, and
evidence-package consistency checks. These modules do not depend on Electron,
SQLite, Hono, or network access.

The standalone verifier is bundled as a Node single-executable application. Its
build enforces import hygiene so the verification path remains small and
independent. A verifier pass establishes package integrity and internal
consistency. It does not independently establish the authenticity of the
timestamp authority; the included runbook delegates that canonical check to
`openssl ts -verify`.

### Data model and key entities

The primary entities and their roles are:

| Entity            | Role                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------- |
| Case              | Unit of organization, storage, verification, archive transfer, and export              |
| Capture           | Browser or background-rendered MHTML record plus metadata and sidecars                 |
| Manifest entry    | Signed, hash-linked record of capture, deletion, timestamp, export, or import activity |
| Operator          | Installation UUID plus optional human name, role, and organization                     |
| Selector          | Literal or regex pattern evaluated across a Case                                       |
| Persisted Match   | Stored relationship between a Selector and Capture                                     |
| Tag               | Reusable classification attached to Captures                                           |
| Note              | Case-level or Capture-linked investigative narrative                                   |
| Annotation        | Non-destructive shapes and pin comments associated with a screenshot                   |
| Extracted Data    | Structured indicator projected from Capture content                                    |
| Archive Reference | Pinned Wayback snapshot metadata used as corroboration                                 |

The storage design distinguishes three levels of authority:

1. **Evidence artifacts:** MHTML and integrity-bound sidecars are the preserved
   bytes.
2. **Manifest:** the append-only custody and integrity record binds those bytes
   to provenance and subsequent actions.
3. **Database projections:** relational metadata, extracted text mirrors,
   Persisted Matches, and FTS5 indexes support application workflows.

Extracted Text illustrates this distinction. Its `.txt` sidecar is authoritative
and its hash is recorded in the Manifest. `capture_texts` mirrors it for query
paths, while `captures_fts` is a trigger-maintained derived index. Rebuild
operations heal database projections by rereading sidecars rather than treating
the index as evidence.

### Integration and API surface

Birdbrain has four principal integration surfaces:

- **Extension HTTP API:** a small loopback API for Case discovery, session
  control, capture ingestion, Selector access, and health checks.
- **Typed Electron IPC:** the renderer-facing application API, organized into
  domains such as Cases, Captures, tags, Selectors, Notes, settings, export,
  updates, and events.
- **Portable files:** evidence ZIPs and `.birdbrain` Case archives support review
  and transfer without a live Birdbrain service.
- **Outbound adapters:** RFC 3161, Wayback Machine, origin TLS, and GitHub
  Releases are isolated behind main-process services.

There is no supported remote REST API, webhook framework, or network-listening
administration plane. Extending Birdbrain into a multi-host service would
therefore require a new authentication, authorization, concurrency, and custody
model rather than merely changing the listener address.

## Design decisions and trade-offs

### Why this stack and architecture

#### Electron and TypeScript

Electron allows Birdbrain to combine a cross-platform desktop interface,
Chromium rendering, OS credential integration, filesystem access, a local HTTP
listener, and a separately installed browser extension in one TypeScript
codebase. Shared types and schemas reduce contract drift among main, preload,
renderer, verifier, and extension components.

The cost is a larger distribution and a wider security surface than a native
single-purpose application. Birdbrain mitigates this with sandboxing, context
isolation, navigation controls, a production Content Security Policy, and a
constrained preload API.

#### SQLite plus filesystem artifacts

SQLite provides local transactions, relational constraints, FTS5, simple
backup semantics, and no external service dependency. Filesystem storage avoids
placing very large MHTML and screenshot blobs into the database and permits
independent artifact hashing and packaging.

The trade-off is cross-store consistency. Birdbrain addresses the most important
forensic transitions in lifecycle modules with transactions, write-ahead
Manifest entries, rollback, and repairable projections, but the system remains
more operationally complex than a single database file.

#### MHTML as the primary Capture

MHTML packages the page and its resources into a portable browser archive,
providing a closer representation of the captured page than HTML alone.
Screenshots retain visual evidence, and extracted-text sidecars enable efficient
search.

MHTML is not a perfect record of a network transaction. Dynamic behavior,
browser state, cross-origin restrictions, late-loading content, personalized
responses, and service-worker behavior can affect what is preserved. Birdbrain
therefore records provenance and corroboration rather than claiming packet-level
or transaction-level capture.

#### Local signing plus external trusted time

A per-installation key gives every current Manifest entry an authenticity check
without requiring an account or central signing service. RFC 3161 adds an
external time anchor without sending evidence content, only its hash.

This preserves local operation but cannot prevent a host-controlling Operator
from using the live signing capability to create a new chain. Centralized or
hardware-backed signing could raise that bar, but would add provisioning,
availability, cost, and potentially custody dependencies.

#### Asynchronous enrichment

Timestamping, Selector reconciliation, extraction, and corroboration do not need
to block the initial persistence of a Capture. This improves responsiveness and
allows transient external failures to be retried.

The consequence is explicit eventual consistency. A Capture may temporarily
show `pending` trusted time, incomplete Selector counts, or unavailable
corroboration. Consumers must not interpret these transient states as evidence
integrity failures.

### Alternatives considered

The following alternatives are inferred from the implemented constraints and
repository decisions:

| Alternative                           | Potential benefit                                    | Reason not selected                                                                                                     |
| ------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Hosted multi-tenant service           | Central collaboration, policy, and backup            | Conflicts with local custody, offline use, and no-account operation                                                     |
| Browser-extension-only product        | Smaller installation                                 | Weak privileged storage, export, local database, and independent verification capabilities                              |
| Native desktop implementation         | Smaller runtime and narrower web surface             | Higher cross-platform cost and less shared browser/UI technology                                                        |
| Store every artifact as a SQLite BLOB | Single backup unit and stronger transaction boundary | Poorer handling of large artifacts and less transparent evidence packaging                                              |
| Plain filesystem metadata             | Maximum inspectability                               | Loses relational integrity, FTS, migrations, and efficient Case workflows                                               |
| WARC as the sole capture format       | Established web-archiving conventions                | More capture and replay complexity for an extension-centered, investigator-facing workflow                              |
| Synchronous timestamping              | Immediate trusted-time completion                    | Makes collection availability and latency depend on an external TSA                                                     |
| Chrome debugger certificate binding   | Stronger link to the captured TLS transaction        | Requires a session-long debugger attachment and prominent browser warning; coverage still has cache and navigation gaps |
| Central or hardware-backed signing    | Stronger key governance                              | Adds account, provisioning, hardware, availability, and recovery requirements                                           |

These alternatives may become appropriate for an enterprise edition, but they
would alter Birdbrain's operating and trust model.

## Security and compliance considerations

### Trust boundaries and attack surface

Birdbrain treats captured web content, extension input, archive input, and
external service responses as untrusted. Privileged work occurs in the Electron
main process. The renderer is sandboxed, context-isolated, and denied Node
integration. New windows are denied and approved HTTP(S) links open in the
system browser. Webview attachment and navigation are constrained.

The loopback Capture Server is not assumed to be private merely because it binds
locally. Host-header checks address DNS rebinding, mutation routes require a
random per-install token, schemas constrain request shape, and size limits bound
individual uploads. The server-token file is local to the application data
directory; failure to persist it degrades to an in-memory token rather than a
fixed credential.

### Authentication and authorization

Authentication exists at the extension-to-server boundary as possession of the
installation token. It identifies an authorized local client, not a human
identity. Electron IPC relies on the trusted application renderer and its
constrained preload surface.

Birdbrain does not implement accounts, sessions tied to people, RBAC, approval
workflows, or Case-level access policies. Operator name, role, and organization
are provenance labels, not authenticated identity claims. Organizations that
need separation of duties must add host controls, separate OS accounts,
controlled export procedures, or an external evidence-management layer.

### Data protection and secrets

Captured content remains in a configurable local storage directory. Birdbrain
does not provide application-level encryption for Cases or the SQLite database.
Confidentiality at rest therefore depends on OS permissions and full-disk or
volume encryption.

The Manifest private key uses Electron `safeStorage`, which maps to
operating-system credential protection such as DPAPI or Keychain where
available. On environments without an available credential store, the
implementation can fall back to plaintext local storage. Existing encrypted
signing keys fail closed if they cannot be unwrapped, avoiding silent key
rotation that would invalidate prior signatures.

### Evidence assurance boundaries

Birdbrain's controls support precise, limited claims:

- SHA-256 checks show whether preserved bytes match their recorded digests.
- Manifest linkage makes deletion, insertion, reordering, and rewriting
  detectable when the chain is verified.
- RSA signatures prevent ordinary re-hashing from producing a valid current
  chain without the installation key.
- RFC 3161 tokens can establish that a content hash existed no later than the
  timestamp authority's asserted time.
- Export metadata binds packaged artifacts through a deterministic artifact
  list and package hash.

They do not prove:

- that page content was truthful;
- that a screenshot represents every browser or server state;
- that the Operator did not control or manipulate the workstation during
  collection;
- that the local Operator identity maps to a legally verified person;
- that a TLS re-fetch observed the certificate used for the captured response;
  or
- that a structural timestamp check authenticates the timestamp authority's
  CMS signature.

The canonical timestamp-authenticity step remains the supplied OpenSSL runbook.
A standalone verifier pass should be described as integrity and internal
consistency, not as a complete authenticity determination.

### Network privacy

Core capture traffic remains on the workstation. External calls have different
privacy consequences:

- the timestamp authority receives a content hash, not captured content;
- automatic TLS corroboration discloses the origin to that origin, while a
  user-initiated Wayback lookup discloses the target URL to the Internet
  Archive;
- GitHub receives ordinary release-check and download traffic.

### Secure development and release posture

CI runs linting, TypeScript checks for all process targets, unit tests, builds,
and Electron Playwright tests. Security workflows scan full Git history with
Gitleaks and run a dependency audit. The audit is currently advisory because
known transitive advisories remain, which weakens its value as a release gate.

Production builds remove `'unsafe-inline'` from `script-src`; development retains
it for Vite tooling. This is stronger than the older limitation still described
in `SECURITY.md`, which should be updated to distinguish development and
production behavior.

Release artifacts are not currently Authenticode-signed or macOS-notarized.
Update metadata includes SHA-512 hashes and is delivered through GitHub Releases,
but users may receive operating-system warnings and do not receive a
platform-signing identity assertion. This is a material enterprise deployment
gap.

### Compliance applicability

Birdbrain supplies useful building blocks for evidence handling: provenance,
integrity verification, export inspection, external trusted time, deterministic
records, and a documented threat model. It does not by itself implement a
regulated records-management program. Retention policy, legal hold, access
reviews, dual control, centralized audit retention, key escrow, incident
response, and certified time or signature policy remain organizational
responsibilities.

## Performance, scalability, and reliability

### Workstation performance model

Birdbrain scales vertically with one workstation. SQLite and local files avoid
network round trips during normal Case operations. WAL mode permits readers and
a writer to coexist more effectively than rollback journaling, and indexes cover
common Case, Capture, tag, format, Manifest, Note, analysis, and extracted-data
queries. FTS5 provides local search without a separate indexing service.

Large binary artifacts dominate storage and export cost. Hard request limits
bound a single MHTML payload to 200 MB and a screenshot to 100 MB, but aggregate
Case size is constrained by disk capacity and practical UI/export latency rather
than a configured quota.

### Responsiveness and background work

React Query uses a 30-second stale time, disables automatic retry, and avoids
window-focus refetches, favoring predictable desktop behavior. Capture ingestion
persists evidence before non-critical enrichment. Selector retroactive matching
is chunked and asynchronous; match caps and safe-regex controls bound runaway
work. Timestamp operations run through a worker with retry behavior rather than
blocking collection.

### Consistency and recovery

SQLite foreign keys enforce ownership relationships and cascade dependent rows.
Schema upgrades are transactional and versioned. The Manifest append protocol
uses `fsync` and byte-offset rollback. Export verification reuses the same
Capture Lifecycle path as manual verification, limiting divergent assurance
logic.

Reliability has defined boundaries:

- SQLite and filesystem changes cannot share a true atomic transaction.
- A host crash can still occur between cross-store steps.
- Local disk loss is not mitigated by an integrated backup service.
- A corrupted or unavailable OS credential store can make encrypted keys
  inaccessible.
- Asynchronous work can remain pending while external services are unavailable.

The architecture favors detection and repair of derived state over pretending
all local state is indivisible. Authoritative sidecars, Manifest verification,
rebuild paths, and persisted verification results support that strategy.

### Scalability limits

The current design is appropriate for thousands of local records and
workstation-sized evidence collections, subject to artifact size and hardware.
No repository benchmark establishes a formal capacity envelope, so higher
figures should not be represented as guaranteed.

Horizontal scaling is not an implemented property. `better-sqlite3` is
synchronous and single-process, the Capture Server maintains local active-Case
state, signing keys are installation-specific, and artifacts reside on a local
path. Multi-user or shared-network operation would require coordinated storage,
concurrent lifecycle execution, distributed identity, key governance, and
redefined custody semantics.

## Observability and operations

Birdbrain provides operator-facing health and state rather than a generalized
telemetry platform.

Implemented signals include:

- Capture events with source, URL, timestamp, duration, failure, skip, and
  screenshot-warning information;
- extension connection and session state;
- persisted last-verification time, hash, and status;
- per-Capture trusted-time state;
- export progress and preflight counts;
- updater state and download progress;
- an HTTP reachability test; and
- a pipeline test that creates, stores, reads, verifies, and removes a synthetic
  Capture.

The application and background services also write contextual warnings and
errors to the console. CI produces test, build, and security-scan results, and
Playwright retains a trace on first retry.

There is no structured application log, durable diagnostic event store,
metrics registry, distributed tracing, crash-reporting service, or telemetry
backend. That is consistent with a privacy-focused desktop application but makes
field diagnosis dependent on reproduction and local console output. A future
logging facility should default to local storage, redact URLs and evidence
content, support explicit user export, and avoid silently creating a new data
egress path.

Operationally, the application owns database initialization, migrations,
storage-directory creation, installation identity, signing keys, token
generation, Capture Server startup, background workers, deep-link registration,
and updater lifecycle. These startup dependencies are ordered in the Electron
main process so privileged services are initialized before use.

## Extensibility and customization

Birdbrain exposes customization primarily through configuration and module
boundaries rather than a runtime plugin system.

Operators can configure:

- storage location;
- screenshot collection;
- deduplication interval;
- ignored URL patterns;
- automatic capture behavior;
- Operator provenance fields;
- timestamp-authority URL;
- appearance and reduced motion; and
- stable or beta update channels.

Investigation behavior is extensible through Selectors, tags, Notes,
annotations, background recapture, and structured extraction. Case archives
provide a file-level interchange surface, while evidence ZIPs provide a
verification-oriented delivery surface.

For contributors, the strongest extension points are:

- new typed IPC domains and preload methods;
- new main-process adapters for external services;
- repository-owned data access and migrations;
- pure shared verification functions;
- feature-scoped renderer components and query hooks; and
- extraction validators and adapters.

These are source-level extension points. Birdbrain does not discover or execute
third-party plugins, scripts, hooks, or custom extractors at runtime. Adding such
a system would introduce code-signing, sandboxing, compatibility, and
evidence-contamination questions that should be resolved before an API is
published.

## Implementation highlights

### Lifecycle-oriented domain boundaries

The most important abstraction is not a generic service layer. Capture Lifecycle
and Selector Lifecycle modules own multi-step invariants that must remain
consistent across IPC and HTTP entry points. This avoids placing forensic and
matching rules in transport handlers.

The distinction between Persisted Matches and Foreground Match Preview is a
particularly effective boundary. It gives the UI immediate feedback without
allowing provisional renderer state to masquerade as Case-wide results.

### Shared, pure verification core

Canonical serialization, Manifest verification, signature checking, timestamp
parsing, and package checking are implemented as shared data functions. The
desktop application and standalone verifier therefore use the same algorithms.
A golden-vector self-check detects bundling changes to canonical JSON behavior,
and import-hygiene tests protect the standalone verifier from accidental
Electron or database coupling.

### Deterministic and downgrade-aware Manifest verification

Manifest entry hashes are computed over canonical JSON excluding `entryHash` and
`signature`. The signature covers the hexadecimal entry hash using RSA-SHA256
with PKCS#1 v1.5. Verification checks schema shape, index continuity, previous
hash linkage, recomputed hashes, and required signatures.

A downgrade guard permits historical unsigned v1 entries followed by signed v2
entries but rejects v1 entries after the chain has entered v2. This closes a
non-obvious rewriting path in which a forged entry might otherwise declare
itself legacy and avoid signature enforcement.

### Portable custody across imports

Case archive import does more than copy rows. It inspects the archive before
writing, verifies artifacts, remaps identifiers, records the mapping digest, and
appends a locally signed import boundary that contains the source public key and
verification result. Verification can switch keys across these boundaries,
allowing a chain to preserve prior installation history and continue under the
receiving installation.

This is a meaningful technical strength for distributed, file-based workflows.
It avoids pretending that all history was signed by the current workstation.

### Sidecars as recoverable authority

By treating extracted-text sidecars as authoritative and database search content
as rebuildable, Birdbrain supports both forensic integrity and efficient local
querying. The pattern prevents a damaged FTS index from redefining the evidence.

### Verification-first export

Export can verify Captures through the same lifecycle used by the application,
report trusted-time coverage, content-address packaged screenshots, include
public keys and verification instructions, and compute a deterministic hash over
the sorted artifact inventory. The final ZIP is not hashed by that package hash
because the signed export record and bundled Manifest would create a circular
dependency. The design states this explicitly rather than hiding it.

### Testing strategy

Vitest covers database migrations, repositories, lifecycles, capture ingestion,
archives, cryptographic helpers, timestamp parsing,
renderer hooks, and components. Playwright drives the packaged Electron
application through Case, Capture, annotation, recapture, MHTML, export, and
navigation workflows. CI also verifies a real RFC 3161 fixture with OpenSSL,
preventing the canonical timestamp path from becoming a silently skipped test.

## Deployment and infrastructure

### Desktop distribution

Birdbrain is packaged with `electron-builder` for:

- Windows as an NSIS installer;
- macOS as DMG and ZIP artifacts; and
- Linux as AppImage and DEB packages.

The built Chromium extension is included as an application resource and is also
published as a separate ZIP. Native dependencies such as `better-sqlite3` are
rebuilt for Electron, and Sharp-related native resources are unpacked from the
application archive where required.

### Runtime deployment model

No container, Kubernetes cluster, serverless function, or external database is
required. Installation creates application data, settings, the SQLite database,
the storage root, an installation identity, a server token, and a signing key
pair on the workstation.

The runtime starts:

1. settings and identity facilities;
2. database and storage;
3. signing and server credentials;
4. domain lifecycles and background workers;
5. the loopback Capture Server; and
6. the renderer window and updater integration.

This deployment model supports disconnected evidence management. Features that
depend on timestamping, archive lookup, TLS reachability, or updates degrade
when offline, while existing evidence remains locally accessible.

### Delivery pipeline

GitHub Actions runs separate lint, typecheck, unit-test, build, E2E, secret-scan,
and dependency-audit jobs. Version tags create a GitHub Release, package each
operating-system target, publish update metadata and blockmaps, and upload the
extension archive. Stable and beta update channels map to release metadata and
prerelease selection.

The current delivery posture is suitable for beta distribution but incomplete
for tightly managed enterprise endpoints because binaries are unsigned and the
dependency audit is non-blocking.

### On-premises and managed deployment considerations

Birdbrain is already on-premises in the literal sense that it runs and stores
data on the user's machine. Managed organizational deployment would additionally
need:

- signed and notarized installers;
- silent installation and policy configuration;
- controlled extension deployment;
- storage and backup policy;
- approved TSA configuration;
- endpoint encryption and OS-account controls;
- log collection that does not leak evidence; and
- version support and vulnerability-remediation commitments.

These are packaging and governance capabilities, not reasons to convert the core
application into a hosted service.

## Roadmap and future directions

The following directions are inferred from current gaps and extension points.
They are recommendations, not committed features.

### Near-term assurance and operations

1. **Sign and notarize releases.** Add Authenticode, Apple Developer ID
   notarization, and documented Linux package signing.
2. **Make dependency policy enforceable.** Resolve known advisories and convert
   the high-severity audit from advisory to a release gate.
3. **Align security documentation with production CSP.** Remove the stale claim
   that production scripts require `'unsafe-inline'`.
4. **Add privacy-preserving local diagnostics.** Use structured events, evidence
   redaction, rotation, and explicit support-bundle export.
5. **Publish recovery procedures.** Document database backup, storage migration,
   signing-key loss, and credential-store failure.

### Evidence and governance

1. **Formalize archive compatibility.** Publish supported schema versions,
   migration guarantees, and long-term verifier availability.
2. **Support stronger key custody.** Evaluate hardware-backed keys, organization
   signing services, key rotation records, and independent public-key
   registration without making them mandatory for local use.
3. **Add policy controls.** Provide managed defaults for storage, TSA, network
   egress, and update channels.
4. **Improve metadata confidentiality.** Authenticate loopback read routes and
   evaluate application-level Case encryption.
5. **Benchmark realistic Case sizes.** Establish supported envelopes for Capture
   count, Case size, Selector volume, search latency, and export duration.

### Capture and corroboration

1. **Evaluate opt-in transaction-bound TLS capture.** Preserve the current
   corroboration-only default unless the debugger-warning and coverage trade-off
   is explicitly accepted.
2. **Expand capture diagnostics.** Record clearer reasons for incomplete
   resources, dynamic content, and browser restrictions.
3. **Broaden archival interoperability.** Evaluate WARC import or export without
   replacing the Case and Manifest model.
4. **Strengthen background-work controls.** Add bounded queues, cancellation,
   visible retry state, and operator-directed retry.

## Conclusion

Birdbrain's architecture is coherent because its technical choices follow a
clear product boundary: preserve and investigate web evidence locally, make
modification detectable, attach independently verifiable time where possible,
and let evidence travel without requiring a hosted account.

Its strongest properties are not any single algorithm or framework. They are the
composition of browser-aware capture, lifecycle-owned forensic invariants,
artifact and Manifest authority, repairable database projections, portable
verification, and unusually explicit limits on assurance claims. The separation
of integrity from trusted time, and of source evidence from derived analysis,
gives reviewers a defensible vocabulary for interpreting results.

The same boundary defines the trade-offs. Birdbrain is not a centralized,
multi-user evidence platform. It relies on workstation security, local key
custody, Operator procedure, and external governance for regulated deployments.
Release signing, structured diagnostics, stronger
policy management, and documented scale benchmarks remain important maturity
steps.

For individual investigators and small teams that prioritize local custody,
transparent formats, and open verification, the current design provides a
substantive foundation. For enterprise adoption, it should be evaluated as a
capable evidence workstation that can integrate into broader identity, endpoint,
retention, and legal-process controls, not as a replacement for those controls.
