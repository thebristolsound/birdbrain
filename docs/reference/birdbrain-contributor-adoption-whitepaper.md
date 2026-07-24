# Birdbrain: A Contributor and Adoption Whitepaper

## Executive Summary

Birdbrain is an open-source, local-first desktop application for capturing, organizing, verifying, and exporting web evidence. It combines an Electron desktop app with a companion Chromium extension so investigators can preserve web pages as MHTML, screenshots, extracted text, metadata, annotations, and provenance inside named Cases. Each Capture is tied into a per-Case Manifest using SHA-256 hashes, chain links, local signatures, and optional RFC 3161 trusted timestamps.

The project matters because web evidence is fragile. Pages change, disappear, personalize, or render differently across browsers and locations. Many investigative tools either depend on hosted platforms, require enterprise licensing, or obscure the evidence workflow behind proprietary systems. Birdbrain takes the opposite path: evidence stays on the Operator's machine by default, formats are inspectable, exports are portable, and the code is available under the MIT license.

For adopters, Birdbrain is best understood as a capable evidence workstation, not a hosted case-management system. It is appropriate for investigators and small teams that value local custody and verifiable exports. For contributors, the project offers meaningful work across capture fidelity, verification, export, search, UI, release trust, testing, and privacy-preserving diagnostics.

## Problem and Vision

### The Gap in Existing Tooling

Web evidence is difficult to preserve well. A screenshot captures appearance but loses underlying page content, metadata, response context, and machine-readable text. A bookmark preserves only a pointer to mutable content. A downloaded HTML file is incomplete for many modern pages. A full local copy is more useful, but without integrity metadata a reviewer still cannot tell whether the captured bytes changed after collection.

Investigators also face practical constraints:

- Hosted evidence platforms can create privacy, custody, availability, and cost concerns.
- Enterprise tools may be inaccessible to independent researchers, journalists, students, activists, and small teams.
- Browser-native capture tools rarely produce a coherent chain of custody.
- General note-taking and screenshot tools do not model evidence verification.
- Proprietary formats can make long-term access and independent review harder.

Birdbrain exists to keep a serious capture-and-prove workflow available in a local, inspectable, open-source application.

### Long-Term Vision

Birdbrain's long-term vision is to become a trustworthy local evidence workstation for web investigations. The project should make it straightforward to:

- capture browser-observed web content with useful visual and textual context;
- organize Captures into Cases that map to real investigations;
- detect later modification of captured artifacts;
- distinguish local integrity from independently attested time;
- search, annotate, tag, and extract indicators without modifying source evidence;
- export Cases and evidence packages that remain understandable without Birdbrain running;
- let technical reviewers inspect how custody claims are produced; and
- allow contributors to improve the workflow without first decoding an opaque architecture.

The guiding principle is candor over overclaiming. Birdbrain should say exactly what it protects, what it does not protect, and where operational procedure still matters.

### Non-Goals

Birdbrain intentionally does not try to be:

- a multi-tenant SaaS investigation platform;
- a shared team case-management server;
- a replacement for endpoint security, backup policy, legal process, or evidence-handling procedure;
- a guarantee of legal admissibility;
- a packet-capture or complete network-forensics tool;
- a system that prevents a fully privileged local Operator from creating a new internally consistent history;
- a browser automation crawler for unattended bulk collection; or
- a runtime plugin marketplace.

Those boundaries are important. They keep the core product understandable: Birdbrain captures and verifies local web evidence; it does not attempt to own every part of an investigative organization.

## Solution Overview

### Core Capabilities

Birdbrain organizes work around a **Case**. A Case owns Captures, Selectors, Notes, tags, annotations, extracted indicators, archive references, and verification state.

Its core capabilities include:

- **Capture:** The Chromium extension captures pages and sends MHTML, screenshots, extracted text, headers, and metadata to the desktop app over `127.0.0.1`.
- **Local storage:** Captures are stored in per-Case archives on the local filesystem, with SQLite used for queryable application state.
- **Verification:** Captures are hashed and linked through a per-Case Manifest. Current Manifest entries are signed locally, and eligible Captures can receive RFC 3161 trusted timestamps.
- **Search:** SQLite FTS5 supports per-Case full-text search across extracted Capture text.
- **Selectors:** Operators define literal or regex patterns and Birdbrain reconciles them across existing and future Captures.
- **Recon extraction:** Birdbrain extracts indicators such as domains, IP addresses, hashes, CVEs, social handles, email addresses, tracking pixels, `.onion` hosts, and I2P hosts.
- **Annotation:** Operators can mark up screenshots with shapes and pinned comments while preserving source evidence.
- **Export:** Birdbrain can generate self-contained HTML reports and portable evidence packages with included verification material.
- **Case archives:** `.birdbrain` archives support transfer between installations while preserving custody boundaries.
- **Recapture and corroboration:** The app includes workflows for recapturing pages and adding supporting archive or TLS corroboration.

Optional model-integration plumbing is present through OpenRouter settings and Capture-scoped analysis storage. This should be treated as experimental: it is not part of evidence verification, it is not an agent or RAG subsystem, and future work should approach it carefully with privacy, cost, prompt-injection, and evaluation concerns in mind.

### Example Use Cases

An investigative journalist can preserve a volatile webpage before publication, annotate the screenshot for editors, and export a reviewable package with hashes and verification notes.

A threat-intelligence analyst can capture pages connected to an intrusion campaign, use extracted indicators to pivot across a Case, and use Selectors to track recurring infrastructure or language.

A researcher documenting platform abuse can collect a sequence of pages over time, recapture changed pages, and preserve a local evidence bundle without sending source material to a hosted service.

A pentester can document engagement evidence with page-level Captures, tags, notes, timestamps, and a final HTML report.

### Why Birdbrain Instead of Alternatives

Choose Birdbrain over ordinary screenshots when you need more than appearance: MHTML, extracted text, metadata, hashing, Manifest linkage, search, and export verification.

Choose Birdbrain over browser bookmarks when the content itself must be preserved, not merely referenced.

Choose Birdbrain over general note-taking tools when chain-of-custody metadata and artifact integrity matter.

Choose Birdbrain over hosted OSINT platforms when local custody, inspectable formats, no telemetry, and no account dependency are more important than central collaboration features.

Choose a hosted enterprise platform instead if your primary requirements are shared case assignment, centralized identity, role-based access control, legal hold workflows, remote administration, audit dashboards, and organization-wide retention policy.

## Architecture Deep Dive

### High-Level Component Diagram

A diagram of Birdbrain should contain these blocks and flows:

1. **Chromium Browser and Birdbrain Extension**
   The browser extension observes the active tab, captures browser-accessible page content, collects screenshot and metadata where available, and sends capture payloads to the desktop app.

2. **Loopback Capture Server**
   A Hono HTTP server listens on `127.0.0.1:19845`. It is the extension-facing boundary and the only entry point for current MHTML Capture ingestion. Mutating requests require a per-installation bearer token.

3. **Electron Main Process**
   The main process owns privileged operations: Capture Lifecycle, Selector Lifecycle, storage, database access, Manifest writing, signing keys, timestamp workers, export, case archives, recapture, updates, and external adapters.

4. **Local Persistence**
   SQLite stores queryable state, migrations, relationships, FTS indexes, notes, tags, selector matches, extracted indicators, and settings. The filesystem stores forensic-bearing artifacts such as MHTML, screenshots, text sidecars, timestamp tokens, and `manifest.jsonl`.

5. **Preload Bridge and Renderer**
   The renderer is a React app. It communicates with the main process through a constrained, typed `contextBridge` API. Node integration is disabled in the renderer.

6. **Optional External Services**
   Outbound integrations include RFC 3161 timestamp authorities, GitHub Releases for updates, Wayback Machine lookup, TLS endpoints for corroboration, and experimental OpenRouter model integration. These are outbound-only and feature-specific.

7. **Evidence Consumer**
   Exported HTML reports, evidence ZIPs, `.birdbrain` archives, and the standalone verifier allow review outside the running desktop app.

The important trust boundaries are untrusted web content, local application privilege, local persistence, and external network services.

### Data Model and Key Entities

Birdbrain's domain model is intentionally explicit:

- **Case:** The unit of organization, storage, verification, export, and archive transfer.
- **Capture:** A preserved web page record, currently MHTML-oriented, with sidecars and metadata.
- **Capture Lifecycle:** The forensic-bearing path for ingestion, hashing, storage, Manifest writing, deletion, verification, and re-extraction.
- **Manifest:** The hash-chained, operator-attributed audit log in each Case directory.
- **Operator:** The human investigator, represented by a per-installation UUID and optional profile fields.
- **Selector:** A user-defined literal or regex pattern.
- **Selector Lifecycle:** The operation set that creates, updates, deletes, and reconciles Selectors against Captures.
- **Persisted Match:** A database row stating that a Selector matched a Capture's stored text.
- **Foreground Match Preview:** Renderer-local, in-memory feedback for the currently open Capture.
- **Extracted Text:** The plain-text sidecar, integrity-bound through the Manifest and mirrored into SQLite for search.
- **Tag, Note, Annotation:** Non-destructive investigative context layered onto Captures and Cases.
- **Archive Reference:** Supporting corroboration from an external archive such as the Wayback Machine.

The architecture separates three kinds of state:

- **Evidence artifacts:** preserved bytes on disk.
- **Manifest authority:** custody and integrity records binding artifacts to provenance.
- **Database projections:** queryable, rebuildable state that supports the app experience.

This separation is one of the codebase's strongest design choices. It prevents derived indexes and UI conveniences from becoming confused with evidence.

### Request and Data Flow

A typical Capture flows through the system as follows:

1. The Operator activates a Case in the desktop app.
2. The extension captures the current browser page.
3. The extension posts MHTML, screenshot data, extracted text, headers, URL, title, and metadata to the loopback Capture Server.
4. The Capture Server validates the request, checks loopback and token constraints, applies limits and ignore rules, and hands the payload to the Capture Lifecycle.
5. The Capture Lifecycle hashes artifacts, writes sidecars, appends and signs a Manifest entry, persists database rows, and schedules follow-up work.
6. Derived workflows extract indicators, reconcile Selectors, request trusted timestamps where eligible, and update UI-visible status.
7. The renderer observes state through typed IPC and React Query, then presents Captures, verification, search, annotations, and exports.
8. Export workflows package selected evidence and verification material for external review.

Deletion and archive import are also lifecycle operations because they affect forensic-bearing state. Whole-Case deletion is intentionally different: the Case directory and Manifest are removed as a unit rather than appending one deletion entry per Capture.

### Extension Points

Birdbrain does not currently expose a stable runtime plugin API. Its extension points are source-level:

- typed IPC channels in `src/shared/ipc.ts`, `src/preload/index.ts`, and main-process handlers;
- lifecycle modules such as `captureLifecycle.ts` and `selectorLifecycle.ts`;
- repository and migration modules under `src/main/services/db`;
- external-service adapters in `src/main/services`;
- pure verification code under `src/shared/verify`;
- renderer feature modules under `src/renderer/components`, `routes`, `hooks`, and `lib`;
- extension capture and popup code under `extension/src`;
- tests under `tests` and `e2e`.

That is a good trade-off for the current beta. A runtime plugin system would require additional answers around sandboxing, signing, compatibility, data custody, and contamination of evidence workflows.

## Design Philosophy and Key Decisions

### Local-First by Default

Birdbrain's most important product decision is that the primary workflow runs locally. Captures stay on the workstation unless the Operator exports them or explicitly uses an outbound feature.

This reduces custody ambiguity and avoids account dependency. It also means Birdbrain relies on workstation security, disk durability, OS credential storage, and the Operator's backup process.

### Electron and TypeScript

Electron gives Birdbrain a cross-platform desktop shell, Chromium rendering, filesystem access, local networking, native packaging, and a natural bridge to a Chromium extension. TypeScript lets the project share types and schemas across main, preload, renderer, extension, and verifier code.

The trade-off is a larger runtime and a wider desktop security surface than a native single-purpose app. Birdbrain mitigates this through sandboxing, context isolation, disabled Node integration in the renderer, typed IPC, and a constrained preload API.

### SQLite Plus Filesystem Artifacts

SQLite is a good fit for local investigation state: it provides transactions, relational constraints, FTS5, portability, and no server dependency. The filesystem is better suited for large artifacts such as MHTML, screenshots, text sidecars, timestamp tokens, and Manifests.

The trade-off is cross-store consistency. The codebase addresses this by centralizing forensic transitions in lifecycle modules, using Manifest append and rollback behavior, and treating database projections as repairable when possible.

### Lifecycle-Oriented Boundaries

The codebase avoids putting forensic rules directly into HTTP handlers or UI handlers. Instead, Capture Lifecycle and Selector Lifecycle modules own multi-step invariants that matter across entry points.

This is worth preserving. Contributors should be cautious about bypassing lifecycle modules for convenience. If a change affects evidence-bearing state, it probably belongs behind a lifecycle boundary.

### Integrity and Trusted Time Are Separate

Birdbrain deliberately separates two claims:

- **Integrity:** whether captured bytes and Manifest links remain intact.
- **Trusted time:** whether a third-party timestamp authority attests that specific bytes existed no later than a stated time.

This separation avoids overclaiming. A Capture can be integrity-verified without a trusted timestamp. A trusted timestamp adds an independent time anchor but does not replace local integrity checks.

### Pure Verification Core

Verification logic under `src/shared/verify` is designed to be independent of Electron, SQLite, Hono, and network access. The desktop app and standalone verifier can reuse the same core algorithms.

This makes the verification path easier to audit and less likely to drift between in-app verification and exported-package verification.

### Explicit Trade-Offs

Birdbrain's design is unusually explicit about its limits:

- A determined Operator controlling the local machine can create a fresh internally consistent chain.
- RFC 3161 timestamps constrain backdating but do not make the workstation trustworthy.
- MHTML captures browser-observed content, not every network transaction.
- SQLite and filesystem writes cannot form a single atomic transaction.
- Current releases are beta and unsigned.
- Some loopback read endpoints expose local metadata to local processes.

That candor improves trust. It gives contributors a clear map of what to improve and gives adopters a realistic basis for evaluation.

## Codebase Walkthrough

### Repository Structure

Important top-level paths include:

- `README.md`: Product overview, installation flow, features, current limitations, and contribution entry point.
- `CONTEXT.md`: Domain language and relationships. Contributors should read this early.
- `SECURITY.md`: Supported versions, vulnerability reporting, security architecture, egress list, and known limitations.
- `docs/reference`: Architecture, threat model, tester guide, and capture-pipeline references.
- `docs/adr`: Accepted architectural decisions.
- `docs/specs` and `docs/plans`: Design notes and implementation plans for major features.
- `src/main`: Electron main process, IPC handlers, and privileged services.
- `src/preload`: The typed context bridge exposed to the renderer.
- `src/renderer`: React UI, routes, components, hooks, stores, and styles.
- `src/shared`: Shared schemas, types, IPC contracts, constants, and verification code.
- `src/verifier`: Standalone verifier CLI.
- `extension`: Chromium extension source and build configuration.
- `tests`: Unit and integration tests across main, renderer, extension, shared verification, and verifier code.
- `e2e`: Playwright tests that drive the packaged Electron application.
- `.github/workflows`: CI, release, and security workflows.

### Files to Read First

New contributors should start with:

1. `README.md` for the user-facing product model.
2. `CONTEXT.md` for domain language.
3. `docs/reference/threat-model.md` for integrity and trusted-time boundaries.
4. `docs/reference/capture-pipeline.md` for capture behavior.
5. `src/shared/ipc.ts` and `src/preload/index.ts` for renderer-main contracts.
6. `src/main/services/captureLifecycle.ts` for evidence-bearing Capture operations.
7. `src/main/services/selectorLifecycle.ts` for Selector semantics.
8. `src/shared/verify/*` for portable verification logic.
9. Representative tests under `tests/main/services` and `tests/shared/verify`.

### Key Patterns

The project uses several patterns contributors should preserve:

- **Domain vocabulary over generic service names:** use Case, Capture, Manifest, Selector, Persisted Match, and Operator consistently.
- **Typed boundaries:** renderer-main communication should go through typed IPC and preload methods.
- **Schema validation:** external and cross-boundary inputs should be validated.
- **Source evidence versus derived state:** do not treat FTS rows, UI previews, model output, or cached matches as evidence.
- **Feature-scoped UI:** renderer code is organized around concrete workflows such as captures, cases, export, selectors, notes, settings, and search.
- **Pure verification functions:** verifier-safe code should stay free of Electron, database, and network imports.

## Developer Experience

### Local Setup

Birdbrain is a TypeScript project using Node 20.19 or newer and `pnpm`.

Common commands include:

```bash
pnpm install
pnpm dev
pnpm build
pnpm lint
pnpm test
pnpm test:e2e
pnpm build:extension
pnpm package
```

Native dependencies such as `better-sqlite3`, Electron, and Sharp-related packages are rebuilt through the postinstall flow. Contributors touching native packaging should test on the target operating system where possible.

### Common Workflows

For desktop app development, run `pnpm dev`.

For extension work, use `pnpm build:extension` or `pnpm dev:extension`, then load the unpacked extension in a Chromium browser.

For verifier changes, run the shared verification tests and the verifier-specific tests. Import-hygiene tests are especially important because they protect the standalone verifier from accidental desktop-app coupling.

For packaging changes, run the relevant package script for the platform:

```bash
pnpm package:win
pnpm package:mac
pnpm package:linux
```

### Pull Request Norms

The README asks contributors to open an issue before non-trivial PRs. That is the right norm for a project with forensic and security-sensitive behavior. Small docs fixes, narrow tests, and low-risk UI improvements can usually be proposed directly.

Good PRs should:

- state the user-visible behavior change;
- identify whether evidence-bearing state is affected;
- include focused tests;
- avoid unrelated refactors;
- update docs or domain language when behavior changes; and
- call out security, privacy, or export-compatibility implications.

## Testing, CI/CD, and Quality Gates

### Test Strategy

Birdbrain uses Vitest for unit and integration coverage across the Electron main process, renderer components, hooks, shared modules, extension utilities, and verifier logic. Tests cover areas such as:

- database migrations and repositories;
- Capture Lifecycle and Selector Lifecycle behavior;
- Manifest hashing and signing;
- trusted timestamp parsing and verification fixtures;
- export and archive round trips;
- OpenRouter client behavior;
- renderer hooks and UI components;
- extension header handling;
- standalone verifier behavior; and
- import hygiene for verifier-safe modules.

Playwright E2E tests drive packaged Electron workflows such as app lifecycle, Case creation, MHTML capture, annotations, notes, recapture, export, forensics, tags, and archive import/export.

This test shape is appropriate for the risk profile. Evidence logic has focused tests, while important user workflows have E2E coverage.

### CI/CD Overview

The GitHub workflows include CI, release, and security jobs. Based on the repository configuration and docs, the pipeline covers linting, type checking, unit tests, builds, E2E tests, secret scanning, dependency audit, and release packaging.

Release packaging uses `electron-builder` for:

- Windows NSIS installers;
- macOS DMG and ZIP artifacts;
- Linux AppImage and DEB packages;
- bundled extension resources; and
- GitHub Releases/update metadata.

### Current Quality Gaps

The project is beta, and several maturity gaps are already documented:

- release artifacts are not Authenticode-signed or macOS-notarized;
- dependency audit posture needs continued hardening;
- structured local diagnostics are limited;
- scale benchmarks are not yet formalized;
- managed deployment policy controls are not yet present; and
- compatibility guarantees for long-lived archives should be documented more formally.

These are strong contribution areas because they improve adoption confidence without changing the product's core philosophy.

## Security and Threat Model

### Security Architecture

Birdbrain's security design follows its local-first boundary:

- The Capture Server binds to `127.0.0.1:19845`.
- Mutating Capture Server requests require a per-installation random token.
- Non-loopback Host headers are rejected to reduce DNS-rebinding risk.
- Renderer Node integration is disabled.
- The renderer uses Chromium sandboxing and context isolation.
- The preload bridge exposes named, typed operations rather than raw `ipcRenderer`.
- Renderer IPC does not accept arbitrary filesystem paths or shell commands.
- OpenRouter API keys and Manifest signing keys use Electron `safeStorage` where available.
- The extension sends captures only to the loopback server and rejects messages from other extensions.

### Network Egress

Birdbrain's documented outbound connections are narrow:

- RFC 3161 timestamp authority, sending content hashes rather than captured content;
- OpenRouter, only if the Operator configures an API key and uses the experimental analysis plumbing;
- GitHub Releases for update checks and downloads;
- feature-specific corroboration such as Wayback Machine or TLS endpoint checks where implemented.

There is no telemetry and no required account.

### Threat Model Boundaries

The Manifest, signatures, hashes, and timestamps defend against casual tampering and support later verification. They do not defend against every adversary.

In particular:

- a fully privileged Operator can control the running process;
- local signing keys are only as safe as the workstation and OS credential store;
- RFC 3161 timestamps constrain time claims but do not make captured content legally dispositive;
- MHTML capture does not prove every network response or dynamic browser behavior;
- `safeStorage` may fall back to plaintext on systems without a credential store;
- loopback read endpoints currently expose some metadata to local processes; and
- denial of service against the local Capture Server is out of scope.

This threat model is a strength. It lets reviewers reason about Birdbrain's claims without relying on vague assurances.

## Observability and Operations

Birdbrain currently emphasizes operator-facing state over telemetry. Implemented signals include:

- capture received/stored/skipped/failed events;
- extension connection and session state;
- verification status and last verification time;
- trusted timestamp status;
- export progress and preflight counts;
- update status and download progress;
- HTTP reachability checks; and
- a pipeline test that exercises synthetic Capture storage and verification.

The application also emits console warnings and errors. There is no general-purpose metrics system, distributed tracing, crash-reporting backend, durable diagnostic event store, or telemetry service.

That choice is consistent with a privacy-sensitive desktop tool, but it makes field debugging harder. A future diagnostics system should be local-first, redacted by default, explicit about export, and careful not to create a new evidence egress path.

For adopters, operational planning should cover:

- workstation disk encryption;
- secure backup of Case directories;
- storage location policy;
- extension installation and update process;
- timestamp-authority configuration;
- whether experimental external model integration is allowed;
- export verification procedure; and
- version/update channel policy.

## Contribution Guide

### Good First Issue Areas

Good first contributions should be narrow, testable, and unlikely to disturb forensic invariants. Suitable areas include:

- documentation improvements in `README.md`, `docs/reference`, and tester guides;
- clearer setup and troubleshooting notes;
- small UI empty states and error states;
- focused component tests;
- fixture cleanup and test readability;
- additional extraction examples;
- settings copy and validation feedback;
- accessibility improvements;
- import/export wording and report polish; and
- small DX scripts that reduce contributor friction.

### Medium Contribution Areas

Medium-scope work can improve real user workflows while staying inside existing architecture:

- new extracted indicator categories;
- Selector performance and UX improvements;
- better capture diagnostics for incomplete pages;
- recapture workflow polish;
- archive import/export edge cases;
- richer verification result explanations;
- local diagnostic logs with redaction;
- improved extension install/update guidance;
- report templates and export options;
- benchmark fixtures for realistic Case sizes; and
- compatibility tests for archive schema evolution.

### Advanced Contribution Areas

Experienced contributors can have high impact in areas that affect trust, architecture, or long-term maintainability:

- release signing and macOS notarization;
- stronger managed-deployment controls;
- hardware-backed or organization-managed signing-key options;
- authenticated loopback read routes;
- formal archive compatibility policy;
- verifier hardening and independent verification workflows;
- WARC import/export exploration;
- scalable background work queues and cancellation;
- privacy-preserving diagnostics;
- performance benchmarks for search, selectors, export, and verification;
- stronger dependency security gates; and
- careful experimentation around optional model integrations, including evals, privacy controls, and cost preflight.

### Contributor Cautions

Contributors should be especially careful when touching:

- Manifest entry shape or hashing;
- signature logic;
- timestamp-token parsing;
- Capture Lifecycle ordering;
- archive import/export;
- sidecar paths and storage resolution;
- IPC contracts exposed to the renderer;
- extension permissions and message handling;
- database migrations; and
- verifier import boundaries.

Changes in these areas should include tests and documentation because they affect trust, compatibility, or security posture.

## Adoption Guide

### When Birdbrain Fits

Birdbrain is a strong fit when a team needs:

- local evidence custody;
- browser-based web capture;
- inspectable open-source implementation;
- per-Case organization;
- search, annotation, tags, notes, and indicator extraction;
- portable export;
- integrity verification; and
- no required cloud account or telemetry.

It is especially appropriate for individual investigators and small teams that can handle workstation security and backup policy themselves.

### When Birdbrain May Not Fit

Birdbrain may not be the right primary system when a team requires:

- centralized multi-user collaboration;
- role-based access control;
- SSO or enterprise identity;
- legal hold workflows;
- remote administration;
- hosted evidence storage;
- organization-wide retention enforcement;
- signed and notarized binaries today;
- formal compliance certification; or
- guaranteed long-term archive compatibility across many years.

In those environments, Birdbrain may still be useful as a local collection workstation that feeds a broader governance system.

### Integration Pattern

The practical adoption pattern is:

1. Install Birdbrain on investigator workstations.
2. Load the companion Chromium extension.
3. Define where Case data is stored.
4. Establish backup and disk-encryption expectations.
5. Decide whether RFC 3161 timestamping should use the default DigiCert TSA or a jurisdiction/organization-specific TSA.
6. Decide whether update checks and optional integrations are allowed.
7. Document export verification procedures.
8. Train Operators on what the integrity and trusted-time results mean.

### Configuration and Customization

Operators can configure storage location, screenshot collection, deduplication behavior, ignored URL patterns, automatic capture behavior, Operator provenance fields, timestamp authority, appearance, reduced motion, update channel, and experimental model integration settings.

For most teams, the most important settings are storage, ignored URLs, timestamp authority, update channel, and whether external model calls are allowed.

### Debugging Tips

For adopters troubleshooting Birdbrain:

- Check extension connection status in the app.
- Confirm the Capture Server is reachable on loopback.
- Verify the active Case before capturing.
- Review capture events for skipped or failed outcomes.
- Run verification before export.
- Inspect export preflight warnings.
- Treat missing trusted timestamps as a separate issue from integrity failures.
- Use the standalone verifier for exported packages where appropriate.

### Compatibility and Versioning

Birdbrain is beta software. The README states that data formats may change between releases. Teams evaluating adoption should test upgrade paths with representative Cases and retain backups before moving important evidence between versions.

A future compatibility policy should define supported archive schema versions, verifier availability guarantees, migration behavior, and breaking-change communication.

## AI/LLM Subsystem

### What Exists Today

Birdbrain includes an optional, Operator-configured analysis feature built on OpenRouter. It is deliberately small:

- **Client:** `src/main/services/ai/openrouter.ts` talks to `https://openrouter.ai/api/v1` and provides API-key testing, model listing, prompt sending, and context-window truncation.
- **Analysis service:** `src/main/services/ai/analysisService.ts` assembles a single prompt from Case context (name, description, type), Capture metadata (URL, title, timestamp, format), and the extracted-text sidecar, then stores the model's response as a `CaptureAnalysis` row with token usage.
- **Settings:** `openRouterApiKey` (stored via Electron `safeStorage` where available), `defaultModel`, and an editable `analysisSystemPrompt`.
- **UI:** an analysis tab on the Capture viewer surfaces stored analyses per Capture.

There is no RAG pipeline, no agent framework, no tool use, no automatic background analysis, and no model calls without an Operator-supplied key. Nothing model-generated enters the Manifest, hashes, signatures, or any other evidence-bearing state. Analysis output is derived state, stored in SQLite alongside other projections.

### Design Constraints Contributors Must Preserve

- **Opt-in egress:** capture text leaves the machine only when the Operator explicitly runs analysis with a configured key. Any feature that widens this (batch analysis, auto-analysis on capture) needs explicit consent design and cost preflight.
- **Evidence separation:** model output must never be presented as, or mixed into, source evidence or verification results.
- **Prompt-injection awareness:** analyzed text is untrusted web content. The system prompt is Operator-editable, and responses should be treated as untrusted display content, not instructions.
- **Cost visibility:** token usage is recorded per analysis; new features should keep spend inspectable.

### Where Contributors Can Experiment

- improving the default `analysisSystemPrompt` and offering task-specific prompt presets;
- evaluation fixtures that check analysis quality and truncation behavior against known captures;
- local-model or self-hosted backend adapters as alternatives to OpenRouter;
- redaction options that strip indicators before text is sent externally;
- clearer UI framing that distinguishes model commentary from verified evidence.

### Known Limitations

Single-shot prompting over truncated text will miss content on very large captures; screenshots and MHTML structure are not sent, so purely visual content is invisible to the model; and there is no evaluation harness yet, so prompt changes are currently judged manually.

## Community and Governance

Birdbrain appears to be a solo-maintained open-source project. The README directs users to GitHub issues for bugs and feature requests and asks contributors to open an issue before non-trivial PRs. `SECURITY.md` asks researchers to use GitHub private vulnerability reporting or a fallback email for exploitable vulnerabilities.

The governance model should remain lightweight while the project is beta, but a few norms are worth making explicit:

- evidence-bearing changes need design discussion;
- security-sensitive reports should not go through public issues;
- PRs should include tests proportional to risk;
- docs should be updated when domain behavior changes;
- compatibility concerns should be raised early;
- maintainers should prefer small, reviewable PRs; and
- contributors should use the project's domain language consistently.

As adoption grows, the project would benefit from a clearer maintainer policy, release support policy, issue labels for contributor onboarding, and documented decision-making for architecture changes.

## Roadmap and Future Directions

### Near-Term Priorities

Near-term work should focus on trust, contributor clarity, and beta hardening:

- sign and notarize release artifacts;
- strengthen dependency-audit policy;
- improve setup and troubleshooting docs;
- expand local diagnostics without adding telemetry;
- publish backup and recovery guidance;
- document archive compatibility expectations;
- add realistic performance benchmarks; and
- improve capture failure explanations.

### Longer-Term Architectural Bets

Longer-term work can explore:

- hardware-backed or organization-managed signing keys;
- stronger policy controls for managed deployments;
- authenticated loopback read endpoints;
- richer archive interoperability, possibly including WARC;
- better background-job cancellation and retry visibility;
- cross-Case search, if it can preserve the Case-centered model;
- local-model or organization-hosted experimental analysis adapters; and
- formal evaluation harnesses for any optional model-assisted workflows.

### Where Community Input Is Most Valuable

The most valuable community input will come from real investigative workflows:

- what evidence reviewers need in exported reports;
- which capture failures matter most in practice;
- how Cases should be transferred between Operators;
- what archive compatibility guarantees adopters need;
- which extracted indicators are worth first-class support;
- what managed deployment policies small organizations need; and
- how to expose optional model-assisted analysis without weakening privacy, cost control, or evidentiary clarity.

## Conclusion

Birdbrain is a focused open-source application with a coherent architecture: capture web evidence locally, preserve source artifacts, bind them to a verifiable Manifest, separate integrity from trusted time, and export evidence in forms that can be reviewed outside the app.

For adopters, the right framing is practical and precise. Birdbrain is not a hosted investigation platform or a legal guarantee. It is a local evidence workstation with unusually transparent custody mechanics, useful investigative workflows, and clear limits.

For contributors, the project offers meaningful work at multiple levels. Documentation, tests, UI polish, diagnostics, extraction improvements, release hardening, verifier work, and capture-pipeline improvements can all raise trust in the tool. The best contributions will preserve Birdbrain's central discipline: source evidence remains distinct from derived analysis, lifecycle modules own forensic invariants, and the software should never claim more than it can prove.
