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
| `src/main/services/serverToken.ts` | Authenticates ingest; weakening admits spoofed captures into the evidence chain |
| `src/main/services/session.ts` | Active-case state deciding which case a capture is filed under |
| `src/main/services/recapture.ts` | Recapture queue re-acquiring URLs as new evidence |
| `src/main/services/backgroundRenderer.ts` | Headless render producing the artifacts that get hashed |
| `src/main/services/consentBlocker.ts` | Suppresses consent overlays during recapture — alters acquired page content |

### Integrity core (hash, manifest, signing, trusted time, verification)

| Path | Why |
|---|---|
| `src/main/services/hash.ts` | SHA-256 hashing/verification primitives |
| `src/main/services/manifest.ts` | Hash-chained, signed audit manifest append/verify |
| `src/main/services/signingKey.ts` | Manifest signing keypair generation/storage/signing |
| `src/main/services/timestamp.ts` | RFC 3161 TimeStampReq construction and TSA round-trip |
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
| `src/main/services/zip.ts`, `src/main/services/zipRead.ts` | Evidence container write/read |
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
| `src/renderer/components/settings/DatabaseAdmin.tsx`, `src/renderer/components/settings/db/**` | Direct DB administration over evidence tables |
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
| `electron.vite.config.ts`, `extension/vite.config.ts` | Compile the exact bytes the release workflow publishes |
| `scripts/build-verifier.mjs`, `sea-config.json` | Build + SEA definition of the distributed verifier binary |
| `src/main/services/updater.ts` | Update delivery |

## Notable exclusions

- `src/main/ipcWrap.ts` — content-agnostic IPC envelope.
- `src/main/services/logger.ts`, `logSafe.ts`, `sessionLog.ts`, `bugReport.ts`, `diagnostics.ts` — operational logging/telemetry; bug-report zip deliberately excludes captures and the DB. (`logSafe` redacts *logs*, not evidence — the definition's "redaction" is the annotation burn-in path.)
- `src/main/services/thumbnails.ts` — derived UI previews, never exported or hash-covered.
- `src/main/services/openrouter.ts` (root, not `ai/`) — API-key test + model catalog only; cannot alter analysis output.
- `src/main/services/deepLink.ts`, `extensionPath.ts` — navigation/setup plumbing.
- `src/renderer/lib/queries.ts` — high-churn typed passthrough; evidence parameters originate in included dialogs and are enforced in main (but see judgment call 2).
- `src/renderer/components/captures/AddUrlsBox.tsx`, `useVerifyMutation.ts` — removed by the challenge pass as inconsistent with the exclusion standard applied to `queries.ts`/`CapturePreferences.tsx` (UI-side plumbing whose values are enforced in main).
- Renderer chrome wholesale: `layout/`, `dashboard/` (rest), `tags/`, `search/`, `status/`, `ui/`, `hooks/`, `routes/`, `stores/`, `styles/`, `notes/` UI, `selectors/` UI, `CaptureViewer.tsx`, `CaptureList.tsx`, `CaptureDetailsPanel.tsx`.
- `.github/workflows/ci.yml`, `security.yml`, `docs.yml` — no distributed artifacts.
- `scripts/coverage-*.mjs`, `gen-linux-icons.mjs`, `rebuild-native.mjs` — dev tooling.
- `extension/src/fonts/**`, `popup.css`/`popup.html` — popup cosmetics, never touch the captured page.

## Judgment calls needing confirmation in review

1. **`src/main/ipcHandlers.ts` and `src/shared/ipc.ts` wholesale.** Both also carry pure-UI
   channels, so the gate fires on many non-evidence PRs. The backstop cannot distinguish a
   payload-type change to an evidence channel from a new UI list query. Accept the noise, or
   split the files later.
2. **`src/renderer/lib/queries.ts` excluded while `src/preload/index.ts` is included.** Both are
   typed passthroughs. As excluded, a hostile change like hardcoding `overrideTamper: true` in the
   import mutation would not trip the backstop. Including it gates most renderer PRs. Current
   call: excluded — the label-at-triage trigger and human review are expected to catch that class.
3. **`pnpm-lock.yaml`.** Included by the same logic as `package.json` (the lockfile is the actual
   pin that determines shipped code), but it gates every dependency-bump PR. Current call:
   include; drop it if dep-bump noise proves unacceptable during the pilot.
4. **`session.ts` / `serverToken.ts`.** Included on misattribution/spoofed-ingest rationales;
   arguably workflow state and authn rather than evidence processing.
5. **`csvEscape.ts`.** CSV exports are convenience exports, not signed packages; kept because they
   are still disclosed case data.
6. **Notes cluster (`noteAnchorResolver.ts`, `noteDoc.ts`, `noteAnchor.ts`).** Notes never enter
   evidence packages; inclusion leans entirely on the "interpretation" clause (what evidence a
   note points at, and note text in exported reports/archives).
7. **Selector cluster (`selectorLifecycle.ts`, `safeRegex.ts`).** Originally excluded as
   "matches never enter the evidence package" — the challenge pass found that factually wrong
   (`caseArchive.ts` exports and re-imports `selectors` and `selectorMatches`). Included on that
   basis; if selector matches are ruled non-evidentiary despite riding in archives, drop both.
8. **Accepted glob false positives.** `db/**` sweeps in read-only `diagnosticsRepo.ts`;
   `settings/db/**` sweeps in the generic `ConfirmDialog.tsx`. Accepted: a per-file list would
   silently miss future files added to these directories.
9. **`toast.ts` / `popup.tsx`.** One step removed from captured bytes (toast markup can be
   captured; popup routes evidence to a case). A stricter list could drop `popup.tsx`.
10. **Distribution block (`updater.ts`, build configs, `release.yml`, lockfile).** Included under
    the definition's "software distribution" clause. If release PRs get their own review channel
    instead, this whole section could move out of the backstop.
