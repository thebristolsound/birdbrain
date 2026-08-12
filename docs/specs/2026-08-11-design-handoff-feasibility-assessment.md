# Design handoff feasibility assessment

Deliverable A requested by the design bundle's `ENGINEERING_REVIEW.md`
(`design_handoff_birdbrain_prototype`, to live on the `prototype/design-handoff-2026-08`
branch): an Accept / Modify / Reject verdict with t-shirt size and data-model
impact per checklist item, verified against the codebase at the time of review.

Review conducted 2026-08-11 by OpenAI Codex (codex-cli 0.147.0, read-only),
commissioned and verified during the scoping session that produced
[`ADR-0009`](../adr/0009-selection-exports-ship-the-full-manifest.md),
[`ADR-0010`](../adr/0010-evidence-package-vs-working-copy.md), and the
`CONTEXT.md` vocabulary updates (Favorite, Mention, Backlink, Working Copy,
"Signals" as UI-only). Item 1 (per-tab case binding) was withdrawn by design
before this review. Verdicts are constrained by the decisions recorded in
those documents; constraints marked "to design" flow back to the prototype
per the bundle's review contract.

## Overall assessment

Birdbrain can support the proposed program without changing its core architecture. Several supposedly new foundations already exist: TipTap note documents, Wayback lookup and pinning, Favorites, full-chain evidence export, chain-verified Case Archive import, and onboarding persistence. The main schedule risk is concentrated in items 4, 6, 11, 12, and 13: they cross process boundaries, alter evidence-bearing workflows, or require compatibility and validation work under ADR-0004. The implementation guide’s sequencing is broadly sound, but its estimates should not treat selection export, batch deletion, typed references, or Wayback replay as ordinary UI work.

## 2. Hide extension UI during capture

- **Verdict:** Accept
- **Size:** S
- **Data-model impact:** None. This is an extension capture-lifecycle change plus regression tests.
- **Evidence:** Full-page capture already has a `try/finally` restoration boundary and restores modified sticky elements and scroll position at `extension/src/content.ts:306` and `extension/src/content.ts:383`. Manual capture currently displays the Birdbrain toast before starting the parallel screenshot operation at `extension/src/background.ts:507`, so it can appear in the captured pixels.
- **Required changes:** Add a single capture-UI suppression protocol covering toast hosts, selection UI, confirmation UI, and selector highlights. Suppression must bracket every screenshot path and restore state in `finally`, including failure and fallback paths.

## 3. Options page

- **Verdict:** Accept
- **Size:** S
- **Data-model impact:** No schema, migration, IPC, or new server route is required for the read-only design. Add `options_ui` and the options entry point to the MV3 manifest, plus an options bundle.
- **Evidence:** The extension manifest has no options page today at `extension/manifest.json:21`. `/api/status` already returns the token to extension-originated callers and exposes screenshot configuration at `src/shared/schemas.ts:127`. The server constructs that status from current settings at `src/main/services/captureServer.ts:161`.
- **Required changes:** Extension-only UI and packaging. Cutting it would not block another checklist item.

## 4. In-page selection bar: Selector / Tag / Quote

- **Verdict:** Modify
- **Size:** XL
- **Data-model impact:** No new Tag or Note tables are intrinsically required, but the capture server needs authenticated extension routes for tag application, note creation, capture lookup by normalized URL, and orchestration of capture-before-attach. Corresponding wire schemas are needed. Quote mentions also depend on item 6’s TipTap schema and archive-version work.
- **Evidence:** The capture server currently exposes capture ingestion and Selector creation, but no Tag or Note write endpoints: capture begins at `src/main/services/captureServer.ts:252`, while the only selection-oriented write route is `/api/selectors` at `src/main/services/captureServer.ts:428`. Tag and Note writes exist only through Electron IPC at `src/shared/ipc.ts:76` and `src/shared/ipc.ts:122`. Capture ingestion is evidence-affecting under `CONTEXT.md:16`.
- **Constraint to design:** Treat Tag and Quote as asynchronous capture-lifecycle operations, not immediate UI-only attachments. When no Capture exists, the bar must expose capture progress and failure and must not create an orphan Tag or Quote. Duplicate URL resolution must be deterministic within the active Case. The injected UI must also participate in item 2’s screenshot suppression.

## 5. Popup ignore-list pre-filter

- **Verdict:** Accept
- **Size:** S
- **Data-model impact:** None.
- **Evidence:** The extension already receives `ignoredUrlPatterns` through status at `src/shared/schemas.ts:127`, maintains the patterns, and has a shared client-side matcher at `extension/src/background.ts:422`. The code explicitly documents that the popup bypasses this check and relies on the server’s 403 at `extension/src/background.ts:429`. The server remains authoritative at `src/main/services/captureServer.ts:293`.
- **Required changes:** Apply the existing pre-filter before popup manual capture while retaining server enforcement for races and non-extension clients.

## 6. Mentions and backlinks

- **Verdict:** Modify
- **Size:** XL
- **Data-model impact:** Add typed TipTap mention nodes, a normalized note-reference table with indexes and foreign-key or validated target semantics, a database migration, reference-list/backlink IPC, archive collection/import support, and a Case Archive schema-version bump. References should be derived and updated transactionally in the main process whenever `body_doc` changes.
- **Evidence:** Notes already store ProseMirror JSON alongside derived plain text at `src/shared/types.ts:559`. The shared TipTap schema currently contains only configured StarterKit nodes at `src/shared/noteDoc.ts:24`, and main rejects unknown/off-schema nodes at `src/shared/noteDoc.ts:54`. The current rich-text migration is v26 and adds `body_doc` at `src/main/services/db/migrations.ts:531`. Archive version gating already refuses data from newer schemas at `src/main/services/caseArchive.ts:53` and `src/main/services/caseArchive.ts:242`.
- **Constraint to design:** Mentions must be typed nodes carrying stable target type and ID, not reparsed display tokens such as literal `@[capture|…]` text. Visible labels may change without changing identity. Broken or deleted targets must remain representable rather than silently removing historical note content. Reference extraction and validation belong in main, not renderer-only code.

## 7. Backlink map

- **Verdict:** Modify
- **Size:** M
- **Data-model impact:** No additional schema beyond item 6. Add a case-scoped graph/query IPC result or compose it from indexed-reference queries.
- **Evidence:** The Overview currently derives its presentation from ordinary case collections rather than a graph query at `src/renderer/components/overview/CaseOverview.tsx:137`. No reference/backlink channels exist in the current IPC list around Notes at `src/shared/ipc.ts:122`.
- **Constraint to design:** The full reference graph cannot be rendered unbounded. The proposed 20-node ceiling is reasonable, but the truncation rule must be deterministic and visibly disclosed. Filtering a type must not imply that hidden nodes or edges do not exist.

## 8. Notes editor

- **Verdict:** Modify
- **Size:** L
- **Data-model impact:** Shared TipTap extension changes, typed-node serialization, main-process text derivation, static rendering, archive validation, and tests. No editor rewrite is needed.
- **Evidence:** The renderer already uses TipTap through `useEditor` at `src/renderer/components/notes/useNoteEditor.ts:37`. Renderer and main deliberately share the same extension list so unsupported nodes cannot disappear from search or export at `src/shared/noteDoc.ts:1`. Plain text is derived from that schema at `src/shared/noteDoc.ts:45`.
- **Constraint to design:** Implement chips as real inline TipTap nodes with keyboard, clipboard, plain-text, static-renderer, and legacy-note behavior. Snippet masking must be presentation-only; it cannot mutate stored note content or remove target identity. Autocomplete must not make a note depend on a currently mounted list of entities.

## 9. Selector `origin: 'note'`

- **Verdict:** Accept
- **Size:** M
- **Data-model impact:** Add a nullable/defaulted `origin` column through a migration; extend `Selector`, create/bulk-create IPC payloads, repository mappings, Case Archive export/import, and validation. Existing Selectors should map to a defined legacy/manual origin.
- **Evidence:** `Selector` has no origin today at `src/shared/types.ts:524`. Selector creation inserts only case, pattern, regex, label, and timestamp at `src/main/services/db/selectorRepo.ts:21`. Case Archives already carry Selector rows at `src/main/services/caseArchive.ts:60`.

## 10. Per-case auto-capture exclusions

- **Verdict:** Modify
- **Size:** L
- **Data-model impact:** Add case-owned exclusion persistence, preferably a normalized table rather than global settings JSON; migration; Case Archive import/export; Case update/query IPC; capture-server status changes; and authoritative filtering using the active Case plus global settings.
- **Evidence:** `Case` currently contains only identity, description, type, timestamps, and archive state at `src/shared/types.ts:6`. Ignore patterns are global `BirdbrainSettings` at `src/shared/types.ts:166`, returned globally by status at `src/shared/schemas.ts:127`, and enforced by the server at `src/main/services/captureServer.ts:278`.
- **Constraint to design:** Exclusion evaluation must be case-specific and authoritative on the server. “Stack” and “override” must have exact semantics for both domain patterns and regexes, including invalid or time-budget-exhausting regexes. The extension may pre-filter for feedback but cannot be the enforcement point.

## 11. Captures screen

- **Verdict:** Modify
- **Size:** XL
- **Data-model impact:** Most layout work is renderer-only, and multi-selection state already exists. Batch Tag, Favorite/Pin, export, recapture, and delete require batch IPC contracts. Batch deletion must add a capture-lifecycle operation that validates one Case, appends N existing-format deletion Manifest Entries, and coordinates database and filesystem rollback.
- **Evidence:** IPC currently exposes only singular capture deletion at `src/shared/ipc.ts:54`, singular Tag attachment at `src/shared/ipc.ts:76`, and singular Favorite toggling at `src/shared/ipc.ts:65`. The database supplies a transaction helper at `src/main/services/db/core.ts:27`, but Manifest writes are filesystem appends with explicit rollback at `src/main/services/manifest.ts:297`. The existing capture list already integrates Favorites at `src/renderer/components/captures/CaptureList.tsx:51`.
- **Constraint to design:** Batch actions must operate on a stable, same-Case ID snapshot. “Delete N” cannot be implemented as N independent renderer calls: it must either complete the coordinated batch or report a precisely recoverable failure, while writing exactly N ordinary deletion entries. The action-bar Pin is the existing Favorite state, not a second persistence concept.

## 12. Wayback slide-out, compare, and pinning

- **Verdict:** Modify
- **Size:** XL
- **Data-model impact:** CDX lookup, Wayback types, pin persistence, IPC, and archive collection already exist. Remaining server work is chiefly secure replay/session orchestration and any export/index presentation changes required for side-by-side compare.
- **Evidence:** Main already performs CDX queries at `src/main/services/waybackMachine.ts:5`. Wayback lookup and pin channels exist at `src/shared/ipc.ts:131`. Persisted references already store URL, digest, MIME type, status, lookup time, and pin time at `src/shared/types.ts:133`, with repository support in `src/main/services/db/waybackRefRepo.ts:14`. The UI already has lookup and pin behavior at `src/renderer/components/captures/WaybackTab.tsx:20`.
- **Constraint to design:** Live archive replay cannot share the normal Electron session or gain preload, Node, IPC, filesystem, unrestricted navigation, popup, download, or permission access. Each compare side must use a sandboxed, session-isolated webview and remain prominently labelled “non-evidence.” Pinning records a corroboration reference; it does not convert replayed Wayback content into a Birdbrain Capture.

## 13. Export dialog

- **Verdict:** Modify
- **Size:** XL
- **Data-model impact:** Extend `ExportOptions` with export class, scope, capture IDs, preset/custom contents, purpose or authority, and Certification fields. Add `scope` and conditional `captureIds` to the export Manifest Entry type and Zod schema. Update main export selection, report/index reconciliation, Certification, standalone verification behavior, tests, and the public Evidence Profile/validation record.
- **Evidence:** Current options only support format, four inclusion controls, investigator name, and output path at `src/shared/types.ts:485`. Current export entries lack scope and capture IDs at `src/shared/schemas.ts:361`. The ZIP already always includes the full Manifest and existing Certification at `src/main/services/export.ts:296`. Certification already contains operator, installation, process, trusted-time, and signature scaffolding at `src/main/services/certification.ts:30` and `src/main/services/certification.ts:250`.
- **Constraint to design:** The dialog must expose two semantically distinct classes. Evidence Packages always include the existing extended Certification and the complete Manifest; neither may be deselected. Selection scope changes artifact membership only and records `scope` plus `captureIds` on the export Manifest Entry. Working Copies must be clearly non-evidentiary and must not emit an indistinguishable Evidence Package export entry. The prototype’s “Ledger slice” and universal “cover sheet always included” model must not return.

## 14. Consolidated Overview and Dashboard activity feed

- **Verdict:** Accept
- **Size:** M
- **Data-model impact:** No migration is required. Add a bounded, cross-case recent-activity repository query and typed IPC channel; do not fetch every Case aggregate into the renderer merely to sort it.
- **Evidence:** The current Overview is already assembled from dedicated presentation blocks at `src/renderer/components/overview/CaseOverview.tsx:137`. IPC has capture counts across cases but no recent-activity query at `src/shared/ipc.ts:54`.
- **Required changes:** Query/IPC plus renderer work. Use a bounded result, stable ordering, and explicit activity types.

## 15. Density system

- **Verdict:** Accept
- **Size:** S
- **Data-model impact:** No database, migration, IPC, or server changes. If density is persisted, extend renderer preference persistence or `BirdbrainSettings` and its Zod schema; a database migration is still unnecessary.
- **Evidence:** Appearance preferences such as theme and reduced motion already live in `BirdbrainSettings` at `src/shared/types.ts:166`, validated through `BirdbrainSettingsSchema` at `src/shared/schemas.ts:510`.
- **Required changes:** Root CSS variables, preference control, and visual/accessibility regression coverage at all three density levels.

## 16. Onboarding walkthrough

- **Verdict:** Modify
- **Size:** L
- **Data-model impact:** Existing global onboarding persistence can be extended with separate intro/case/extension completion keys; no database migration is necessary if settings remain the store. Demo content requires a bundled `.birdbrain` asset and invocation of the existing inspect/import path, not seed SQL.
- **Evidence:** `hasCompletedOnboarding` already exists in settings at `src/shared/types.ts:180`. The existing wizard writes it through Settings at `src/renderer/components/layout/OnboardingWizard.tsx:42`. Case Archive import rejects newer schemas at `src/main/services/caseArchive.ts:242` and verifies package artifacts and chain before import at `src/main/services/caseArchive.ts:248`. Archive IPC already exposes inspect/import at `src/shared/ipc.ts:43`.
- **Constraint to design:** Automatic tours may fire only when the installation has no prior completion state; upgrades must not be treated as fresh installs. The demo Case must be a normal chain-verified Case Archive and must not bypass inspection, collision remapping, compatibility gates, or import provenance. Replay must not reset fresh-install state or create another demo Case without explicit confirmation.

## Hidden scope

- Manifest schema, canonicalization fixtures, historical-chain compatibility tests, standalone verifier tests, Evidence Profile documentation, and release validation for items 11 and 13.
- Case Archive schema bump, row collection/import, ID remapping, and old/new-version compatibility fixtures for typed mentions, references, Selector origin, and case exclusions.
- TipTap static rendering, plain-text/FTS derivation, clipboard serialization, deletion behavior, accessibility, and malformed-node import tests.
- Secure Electron webview policy: isolated partitions, navigation and popup interception, permission denial, download handling, teardown, CSP, hostile-content tests, and clear non-evidence labelling.
- Cross-process error and progress contracts for selection-bar auto-capture and all batch actions.
- URL canonicalization rules for “capture of this URL already exists,” including redirects, fragments, trailing slashes, and multiple existing Captures.
- Atomicity and crash-recovery analysis where a batch operation spans SQLite, Manifest append/fsync, and Capture files.
- Extension build changes for a new options entry point and capture-UI suppression tests across viewport, full-page, scrolling, fallback, and failed-capture paths.
- Accessibility and reduced-motion behavior for coach marks, autocomplete, the graph, resizable columns, floating actions, and density variants.
