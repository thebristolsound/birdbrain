# Evidence-affecting path list — assessment

**Status:** proposed draft for review confirmation (wayfinder ticket #303, autonomy map #298)
**Definition applied:** CONTEXT.md, Assurance baseline — "An evidence-affecting change includes acquisition, parsing, extraction, storage, hashing, signing, trusted time, manifests, verification, redaction, export, reporting, AI analysis, and software distribution when it can alter an evidentiary result or its interpretation."

## Purpose

This list is the **mechanical PR-diff backstop** for the evidence gate (decision record: #299). The
primary trigger is the `evidence-affecting` label applied at triage; this list catches PRs whose
diff touches an evidence path without the label. It is expressed as globs so a routine or CI step
can match it against `git diff --name-only`. Its final maintained home is decided by the
governance-docs ticket (#305); this document is the reviewed source it will be seeded from.

Method note: produced by a three-slice parallel survey of the codebase (main services; db/shared/
ai/extraction; extension/renderer/distribution edges), each reading files rather than classifying
by name, followed by an adversarial completeness/overbreadth challenge. The challenge pass added
six paths both surveyors missed, overturned one exclusion on a factual error, and removed two
inconsistent inclusions — those changes are already folded into the list below.

Amendments since the survey: `src/shared/urlPatterns.ts` added to Acquisition (#227) — the
ignored-URL matcher moved there out of the already-listed `src/main/services/captureServer.ts`,
and the rename-detection-off rule only catches the move itself, not later edits to the new home.
`src/renderer/lib/api/**` added to the exclusion list (#229) — the renderer query layer split out
of `src/renderer/lib/queries.ts` into per-domain modules, so the reasoning recorded against that
one file now applies to the directory. The call is unchanged (still excluded), and judgment call 2
below is restated against the new path; `queries.ts` itself is a re-export barrel that the last PR
of that sequence deletes.

## List format

These lists are the seed for a machine-consumed file, so entries follow fixed rules. Anything
seeded from this document should be checked against them.

- **One repository-relative glob per entry.** No table row or bullet combines two paths; a rule
  that needs two paths gets two entries. This is what makes the tables extractable by cell.
- **Paths are repository-relative POSIX paths** with no leading `./` or `/`, so they compare
  directly against `git diff --name-only` output. Matching is case-sensitive, and directory
  separators are always `/`.
- **A `**` segment crosses directory separators.** An entry ending in a `**` segment means that
  directory and everything beneath it, recursively. An entry with no wildcard matches exactly one
  file.
- **Run the diff with rename detection off** (`git diff --name-only --no-renames`), so moving a
  file out of an evidence path still trips the backstop on the old path.
- **Only the include list feeds the matcher.** The exclusion list is a review record of paths
  deliberately left out, not a subtraction pass applied on top. Blanket
  exclusion-over-inclusion would be wrong here: `src/renderer/components/dashboard/**` is
  excluded while `src/renderer/components/dashboard/cases/DataExplorer.tsx` and
  `src/renderer/components/dashboard/cases/ImportCaseDialog.tsx` are included, and a blanket
  override would silently drop them. If a future tool does consume both lists, **the more
  specific pattern wins** — an exact path beats a directory glob, and among globs the one with
  the longer literal prefix before its first wildcard beats the shorter.

## Proposed include list

### Acquisition (extension → capture server)

| Path | Why |
|---|---|
| `extension/src/background.ts` | Orchestrates MHTML/screenshot/text capture; caches response headers anchored into the signed manifest |
| `extension/src/content.ts` | In-page capture: screenshot stitching, DOM mutation during capture, selector matching over page text |
| `extension/src/toast.ts` | Injects DOM before/during capture — its markup can land inside captured bytes |
| `extension/src/utils/api.ts` | Builds the multipart capture payload that becomes hashed evidence and manifest fields |
| `extension/src/utils/headers.ts` | Deterministic header normalization anchored into the hash-chained manifest |
| `extension/src/popup/popup.tsx` | Routes a capture to a case (chain-of-custody routing) |
| `extension/manifest.json` | Acquisition permissions; ships in the release zip |
| `src/main/services/captureServer.ts` | Ingest endpoint: upload validation, case routing, ingest-time selector matching |
| `src/shared/urlPatterns.ts` | The ignored-URL matcher both sides run: it decides what never enters a case at all, and names the rule recorded as the reason for the absence |
| `src/main/services/serverToken.ts` | Authenticates ingest; weakening admits spoofed captures into the evidence chain |
| `src/main/services/session.ts` | Active-case state deciding which case a capture is filed under |
| `src/main/services/recapture.ts` | Recapture queue re-acquiring URLs as new evidence |
| `src/main/services/backgroundRenderer.ts` | Headless render producing the artifacts that get hashed |
| `src/main/services/consentBlocker.ts` | Suppresses consent overlays during recapture — alters acquired page content |

### Integrity core (hash, manifest, signing, trusted time, verification)

Assurance boundary for this block, stated so the rationales do not overclaim: the manifest chain
and the RFC 3161 token cover **different things**, and neither substitutes for the other. The
timestamp request's message imprint is the capture's `contentHash` (`buildTimestampRequest` in
`src/main/services/timestamp.ts`), so a granted token dates *the captured bytes* — it says nothing
about whether the manifest chain around them is intact. The chain, conversely, covers manifest
entries but is signed with the installation-local keypair generated and held by this install
(`src/main/services/signingKey.ts`), so it detects edits made *without* that key and is not
independent of the Operator who holds it.

| Path | Why |
|---|---|
| `src/main/services/hash.ts` | SHA-256 hashing/verification primitives |
| `src/main/services/manifest.ts` | Hash-chained, signed audit manifest append/verify. The chain detects edits made without the installation-local signing key; it is not an Operator-independent guarantee |
| `src/main/services/signingKey.ts` | Manifest signing keypair generation/storage/signing — the key the chain's assurance is bounded by |
| `src/main/services/timestamp.ts` | RFC 3161 `TimeStampReq` construction (message imprint = the capture's `contentHash`) and TSA round-trip. The token dates the content; it does not prove manifest-chain integrity |
| `src/main/services/timestampWorker.ts` | Async timestamping worker writing manifest entries |
| `src/main/services/trustedTime.ts` | Per-capture trusted-time status resolution |
| `src/main/services/tsaTrust.ts` | Embedded TSA trust anchors shipped in evidence packages |
| `src/main/services/tlsCertChain.ts` | TLS chain corroboration anchored into signed manifest entries |
| `src/main/services/installationId.ts` | Installation identity in manifest entries and certification |
| `src/shared/verify/**` | Verification core: canonical JSON, chain, signature, RFC 3161 token, package verifier |
| `src/verifier/**` | Standalone verifier CLI (fs+crypto-only constraint) |
| `src/main/index.ts` | Enforces evidence-viewer invariants (webview navigation block, sandbox webPreferences); boots DB/capture server/installation id |

### Capture lifecycle, storage, parsing, extraction

| Path | Why |
|---|---|
| `src/main/services/captureLifecycle.ts` | Ingest/delete pipeline: hashing, manifest entries, trusted-time reconciliation |
| `src/main/services/captureStore.ts` | Owner of capture artifact bytes on disk |
| `src/main/services/storage.ts` | Storage root and case directory layout |
| `src/main/services/mhtmlDecoder.ts` | MHTML parsing feeding text extraction |
| `src/main/services/dataExtractor.ts` | IOC extraction pipeline entry |
| `src/main/services/extraction/**` | Source selection, sanitizer, IOC adapter, validators — determine extracted results |
| `src/main/services/db/**` | All evidentiary records: schema, repos, dbAdmin row edit/restore/purge |
| `src/main/services/selectorLifecycle.ts` | Retro-matching writes `selector_matches` rows that ride in case archives |
| `src/main/services/safeRegex.ts` | Regex evaluation deciding those persisted matches (follows the selector cluster call below) |

### Annotation, redaction, notes-to-evidence binding

| Path | Why |
|---|---|
| `src/main/services/annotations.ts` | Persists annotation shapes incl. redaction rects burned into exports |
| `src/main/services/burnAnnotations.ts` | Composites annotations/redactions onto exported pixels |
| `src/main/services/renderAnnotationsSvg.ts` | Shape rendering for burn-in — a wrong redact rect leaks or destroys content |
| `src/main/services/noteAnchorResolver.ts` | Binds notes to hash-covered text |
| `src/shared/noteDoc.ts` | Note document model + text derivation (feeds FTS and exported reports) |
| `src/shared/noteAnchor.ts` | Anchor model deciding which evidence a note points at |
| `src/renderer/components/captures/annotation/**` | Annotation editing incl. the redact tool |

### Export, reporting, archive

| Path | Why |
|---|---|
| `src/main/services/export.ts` | Evidence-package export: hashing, evidence.json, verification, burn-in |
| `src/main/services/pdfExport.ts` | PDF disclosure rendering |
| `src/main/services/reportHtml.ts` | Forensic report renderer inside packages |
| `src/main/services/certification.ts` | Export certification document |
| `src/main/services/verifyRunbook.ts` | By-hand verification runbook shipped in packages |
| `src/main/services/caseArchive.ts` | Archive export/import with id remapping |
| `src/main/services/zip.ts` | Evidence container write |
| `src/main/services/zipRead.ts` | Evidence container read |
| `src/main/services/csvEscape.ts` | Escaping behind CSV exports of case data |
| `src/renderer/components/export/**` | Export options directly shape the package |

### AI analysis

| Path | Why |
|---|---|
| `src/main/services/ai/**` | Analysis pipeline + chat client (truncation changes model input, hence output) |
| `src/renderer/components/captures/AnalysisTab.tsx` | Triggers analysis, selects model/prompt, saves results |
| `src/renderer/components/settings/AIConfig.tsx` | Writes `defaultModel` and `analysisSystemPrompt` — same rationale as AnalysisTab |

### Interpretation surfaces (renderer)

| Path | Why |
|---|---|
| `src/renderer/components/captures/ForensicsTab.tsx` | Hash chain / chain status / headers display |
| `src/renderer/components/captures/ProvenanceBadge.tsx` | Integrity + trusted-time status rendering |
| `src/renderer/components/captures/getProvenanceColor.ts` | Status-to-meaning mapping |
| `src/renderer/components/captures/MhtmlViewer.tsx` | Evidence rendering invariants (JS disabled, navigation blocked) |
| `src/renderer/components/captures/WaybackTab.tsx` | Pins Wayback corroboration refs |
| `src/renderer/components/captures/CaptureDownloadMenu.tsx` | Per-capture evidence export surface |
| `src/renderer/components/overview/VerifyBar.tsx` | Case-level verification display |
| `src/renderer/components/overview/overviewModel.ts` | The actual verified/tampered bucketing VerifyBar shows |
| `src/renderer/components/dashboard/cases/ImportCaseDialog.tsx` | Archive verification display + `overrideTamper` flow |
| `src/renderer/components/dashboard/cases/DataExplorer.tsx` | Extraction results display + reprocess trigger |
| `src/renderer/components/settings/DatabaseAdmin.tsx` | Direct DB administration over evidence tables |
| `src/renderer/components/settings/db/**` | The DB administration views behind it (browse, row edit, utilities) |
| `src/renderer/components/settings/OperatorConfig.tsx` | Operator identity embedded verbatim in export certification |

### Cross-process contracts and configuration

| Path | Why |
|---|---|
| `src/main/ipcHandlers.ts` | Shapes inputs/outputs of evidence operations (see judgment call 1) |
| `src/preload/index.ts` | Single privileged chokepoint for every evidence channel |
| `src/shared/ipc.ts` | Typed payloads for evidence operations (see judgment call 1) |
| `src/shared/types.ts` | Domain contracts for captures, provenance, trusted time, exports |
| `src/shared/schemas.ts` | Zod validation at trust boundaries (upload, manifest entry, settings) |
| `src/shared/constants.ts` | Manifest filename/schema version, TSA URL, size caps, default analysis prompt |
| `src/main/services/settings.ts` | Persists TSA URL, operator identity, capture prefs, key encryption |
| `src/main/services/waybackMachine.ts` | Corroboration lookups pinned as evidence references |

### Software distribution

| Path | Why |
|---|---|
| `package.json` | electron-builder `build` block, dependency pins/overrides |
| `pnpm-lock.yaml` | The actual dependency pin compiled into shipped bundles (see judgment call 3) |
| `.github/workflows/release.yml` | Builds/publishes installers, updater manifests, extension zip |
| `electron.vite.config.ts` | Compiles the exact app bytes the release workflow publishes |
| `extension/vite.config.ts` | Compiles the exact extension bytes the release workflow publishes |
| `scripts/build-verifier.mjs` | Build of the distributed verifier binary |
| `sea-config.json` | SEA definition of that verifier binary |
| `src/main/services/updater.ts` | Update delivery |

## Notable exclusions

A review record of paths deliberately left out, in the same one-glob-per-entry form as the include
list — see "List format" for why this list is not applied as a subtraction pass over the includes.
It is *notable* exclusions, not an exhaustive complement of the include list.

| Path | Why |
|---|---|
| `src/main/ipcWrap.ts` | Content-agnostic IPC envelope |
| `src/main/services/logger.ts` | Operational logging |
| `src/main/services/logSafe.ts` | Redacts *logs*, not evidence — the definition's "redaction" is the annotation burn-in path |
| `src/main/services/sessionLog.ts` | Operational logging |
| `src/main/services/bugReport.ts` | Bug-report zip deliberately excludes captures and the DB |
| `src/main/services/diagnostics.ts` | Operational telemetry |
| `src/main/services/thumbnails.ts` | Derived UI previews, never exported or hash-covered |
| `src/main/services/openrouter.ts` | API-key test + model catalog only; cannot alter analysis output. Distinct from the included `src/main/services/ai/openrouter.ts` chat client |
| `src/main/services/deepLink.ts` | Navigation plumbing |
| `src/main/services/extensionPath.ts` | Extension setup plumbing |
| `src/renderer/lib/api/**` | High-churn typed passthrough; evidence parameters originate in included dialogs and are enforced in main (but see judgment call 2) |
| `src/renderer/lib/queries.ts` | Same rationale — the re-export barrel left behind by the split, deleted by the last PR of #229 |
| `src/renderer/components/captures/AddUrlsBox.tsx` | Removed by the challenge pass as inconsistent with the standard applied to `src/renderer/lib/queries.ts` and `src/renderer/components/settings/CapturePreferences.tsx` — UI-side plumbing whose values are enforced in main |
| `src/renderer/components/captures/useVerifyMutation.ts` | Same rationale as `src/renderer/components/captures/AddUrlsBox.tsx` above |
| `src/renderer/components/captures/CaptureViewer.tsx` | Renderer chrome |
| `src/renderer/components/captures/CaptureList.tsx` | Renderer chrome |
| `src/renderer/components/captures/CaptureDetailsPanel.tsx` | Renderer chrome |
| `src/renderer/components/settings/CapturePreferences.tsx` | Capture-preference UI; the values it writes are enforced in main |
| `src/renderer/components/layout/**` | Renderer chrome |
| `src/renderer/components/dashboard/**` | Renderer chrome, *except* the two files listed in the include list — see the precedence rule in "List format" |
| `src/renderer/components/tags/**` | Renderer chrome |
| `src/renderer/components/search/**` | Renderer chrome |
| `src/renderer/components/status/**` | Renderer chrome |
| `src/renderer/components/ui/**` | Shared UI primitives |
| `src/renderer/components/notes/**` | Note-editing UI; the evidence binding lives in the included `src/shared/noteAnchor.ts` / `src/main/services/noteAnchorResolver.ts` |
| `src/renderer/components/selectors/**` | Selector-management UI; matching lives in main |
| `src/renderer/hooks/**` | Renderer chrome |
| `src/renderer/routes/**` | Renderer chrome |
| `src/renderer/stores/**` | UI-only state |
| `src/renderer/styles/**` | Styling |
| `.github/workflows/ci.yml` | No distributed artifacts |
| `.github/workflows/security.yml` | No distributed artifacts |
| `.github/workflows/docs.yml` | No distributed artifacts |
| `scripts/coverage-*.mjs` | Dev tooling |
| `scripts/gen-linux-icons.mjs` | Dev tooling |
| `scripts/rebuild-native.mjs` | Dev tooling |
| `extension/src/fonts/**` | Popup cosmetics, never touch the captured page |
| `extension/src/popup/popup.css` | Popup cosmetics, never touch the captured page |
| `extension/src/popup/popup.html` | Popup shell, never touches the captured page |

## Judgment calls needing confirmation in review

1. **`src/main/ipcHandlers.ts` and `src/shared/ipc.ts` wholesale.** Both also carry pure-UI
   channels, so the gate fires on many non-evidence PRs. The backstop cannot distinguish a
   payload-type change to an evidence channel from a new UI list query. Accept the noise, or
   split the files later.
2. **`src/renderer/lib/api/**` excluded while `src/preload/index.ts` is included.** Both are
   typed passthroughs. As excluded, a hostile change like hardcoding `overrideTamper: true` in the
   import mutation (`src/renderer/lib/api/cases.ts`) would not trip the backstop. Including it
   gates most renderer PRs. Current call: excluded — the label-at-triage trigger and human review
   are expected to catch that class.
3. **`pnpm-lock.yaml`.** Included by the same logic as `package.json` (the lockfile is the actual
   pin that determines shipped code), but it gates every dependency-bump PR. Current call:
   include; drop it if dep-bump noise proves unacceptable during the pilot.
4. **`src/main/services/session.ts` / `src/main/services/serverToken.ts`.** Included on
   misattribution/spoofed-ingest rationales; arguably workflow state and authn rather than
   evidence processing.
5. **`src/main/services/csvEscape.ts`.** CSV exports are convenience exports, not signed packages;
   kept because they are still disclosed case data.
6. **Notes cluster (`src/main/services/noteAnchorResolver.ts`, `src/shared/noteDoc.ts`,
   `src/shared/noteAnchor.ts`).** Notes never enter evidence packages; inclusion leans entirely on
   the "interpretation" clause (what evidence a note points at, and note text in exported
   reports/archives).
7. **Selector cluster (`src/main/services/selectorLifecycle.ts`,
   `src/main/services/safeRegex.ts`).** Originally excluded as "matches never enter the evidence
   package" — the challenge pass found that factually wrong (`src/main/services/caseArchive.ts`
   exports and re-imports `selectors` and `selectorMatches`). Included on that basis; if selector
   matches are ruled non-evidentiary despite riding in archives, drop both.
8. **Accepted glob false positives.** `src/main/services/db/**` sweeps in the read-only
   `src/main/services/db/diagnosticsRepo.ts`; `src/renderer/components/settings/db/**` sweeps in
   the generic `src/renderer/components/settings/db/ConfirmDialog.tsx`. Accepted: a per-file list
   would silently miss future files added to these directories.
9. **`extension/src/toast.ts` / `extension/src/popup/popup.tsx`.** One step removed from captured
   bytes (toast markup can be captured; the popup routes evidence to a case). A stricter list
   could drop `extension/src/popup/popup.tsx`.
10. **Distribution block (`src/main/services/updater.ts`, the build configs,
    `.github/workflows/release.yml`, `pnpm-lock.yaml`).** Included under the definition's
    "software distribution" clause. If release PRs get their own review channel instead, this
    whole section could move out of the backstop.
