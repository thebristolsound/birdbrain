# Evidence-affecting path list — assessment

**Status:** In force. This is the evidence gate's PR-diff backstop list, designated as such by
[`ADR-0005`](../adr/0005-unattended-agents-on-the-evidence-path.md) and linked as the inventory from
`CONTRIBUTING.md` and the pull request template. It stands until a maintained list supersedes it;
the governance-docs ticket (#305) closed without producing one. Individual entries stay
revisable — see "Judgment calls needing confirmation in review". (Origin: wayfinder ticket #303,
autonomy map #298.)
**Amended 2026-08-23 by ADR-0014:** every include-list entry now carries a tier, `blocking` or
`advisory`. Read "Tiers" before using this list for anything; a hit no longer means one thing.
**Definition applied:** CONTEXT.md, Assurance baseline — "An evidence-affecting change includes acquisition, parsing, extraction, storage, hashing, signing, trusted time, manifests, verification, redaction, export, reporting, AI analysis, and software distribution when it can alter an evidentiary result or its interpretation."

## Purpose

This list is the **mechanical PR-diff backstop** for the evidence gate (decision record: #299). The
primary trigger is the `evidence-affecting` label applied at triage; this list catches PRs whose
diff touches an evidence path without the label. It is expressed as globs so a routine or CI step
can match it against `git diff --name-only`. It was drafted as the reviewed source that a
machine-consumed file would be seeded from; #305 closed without relocating or superseding it, so
this document is the list itself until one is produced.

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
of that sequence deletes. `extension/src/popup/PopupApp.tsx`, `extension/src/popup/pageStatus.ts`
and `extension/src/messages.ts` added to Acquisition (#387) — the popup's case routing and its
capture button moved out of the already-listed `extension/src/popup/popup.tsx`, which is now a
mount point, and the same rename-detection caveat applies: without these three the backstop would
stop firing on the code that actually routes a capture.
`src/main/services/exclusionPolicy.ts` added to Acquisition (#400) — the same move as #227, one
step further: the decision about what may enter a case moved out of the already-listed
`src/main/services/captureServer.ts` so that `src/main/services/recapture.ts`, a producer the
capture server never sees, enforces the identical rule rather than a second copy of it. The
rename-detection-off rule catches the move itself and nothing after, and this file is now the
single place that answer is computed, so a later edit touching only it would otherwise match no
entry.
`src/shared/urlCanonicalize.ts` added to Acquisition (#392) — the canonical URL identity the
extension attach routes (tag apply, note create, URL lookup) resolve against. It decides which
Capture a Tag or Note binds to, and whether an attach request acquires new bytes at all (no
canonical match means the supplied payload is ingested), so it shapes what enters a case the same
way `urlPatterns.ts` does; the #227 argument applies unchanged. Shared so the extension and the
server agree on the rules by construction rather than by convention.
`src/main/windowSize.ts` added to the **exclusion** list (#515) — window sizing moved there out
of the already-listed `src/main/index.ts` in #478 and landed on no list at all, so once that
carve-out had settled a PR touching only the new file would have tripped nothing. The call is
exclusion rather than inclusion: window geometry enters no capture, content hash, manifest
entry, canonical JSON field or signature, which #478's Evidence impact section argued and its
round-2 pre-pass verified. `src/main/index.ts` stays included at blocking tier for the
invariants it does still hold.

### Known gap: carve-outs are caught by review, not by a check

Nothing detects a file being split out of an include-list path. The rename-detection-off rule
under "List format" catches the move itself, because that diff still names the old path, and
nothing after it — once the carve-out has merged, edits touching only the new home match no
entry. That is why each amendment above was needed, and every one of them was written because a
person or an agent noticed while reading a diff.

Whether that is the intended control or a gap worth closing with a check is open (#1410). Read
this as an unresolved gap rather than a decision already taken. It is a live one: two further
carve-outs from `src/main/index.ts` are on neither list today (#1409).

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

## Tiers

Added 2026-08-23 by ADR-0014. Every include-list entry carries a tier, and the tier decides what a
hit costs.

**blocking.** A change on this path can alter an evidentiary result or its interpretation. The
backstop finding is blocking, the PR owes the ADR-0004 obligations (an Evidence impact section, a
known-answer test or a written justification, preserved backward verification), it gets human
review, and it never auto-merges.

**advisory.** The path is real evidence surface, but it is shared with a lot of code that is not.
A hit produces a one-line reviewer disposition naming which region the diff touched. It owes no
Evidence impact section and does not by itself make the PR evidence-affecting. A reviewer who finds
the diff *does* reach evidence behaviour relabels the PR blocking and the full obligations apply.

The `evidence-affecting` label applied at triage is unchanged and still the primary trigger. The
tiers govern the mechanical backstop only. A labelled PR owes the full obligations whatever its
diff touches.

### Why the tiers exist

ADR-0005 asked for a mechanical backstop because "looks harmless" is the judgment that fails under
review pressure. That reasoning holds. What did not hold is treating every entry as equally
load-bearing: judgment calls 1, 3 and 10 below predicted, before the pilot ran, that
`ipcHandlers.ts`/`ipc.ts` wholesale, `pnpm-lock.yaml` and the distribution block would fire on
changes that could not touch an evidentiary result, and pre-authorised dropping them if that
proved out.

It proved out. Measured 2026-08-23 over every PR that has carried the label, matching this
document's own include list (extracted by cell per the rules above) against
`git diff --name-only --no-renames` for each merge:

| | Count |
|---|---|
| PRs labelled `evidence-affecting` | 41 |
| of those, merged | 38 |
| merged PRs in the repository overall | 349 |
| labelled merges hitting a narrow-block glob | 26 |
| labelled merges hitting only broad-block globs | 11 |
| labelled merges hitting no include-list glob at all | 1 |

Broad-block means the cross-process contracts block, the software distribution block, or
`src/main/services/db/**`. The eleven include the cross-case recent-activity feed, the UI density
setting, the `tests/` typecheck gating and its reapply, the preload namespace rename, and two
PRs hardening the release supply chain. The one no-hit is #532, a threat-model documentation change labelled by triage
judgment alone, which is the label working as designed.

Four of the twenty-six narrow hits are incidental brushes rather than evidence work, and they are
the more misleading class because they read as substantive:

- **#786** hit `src/renderer/components/export/**` by adding `data-tour="export"` to a `div` in
  `ExportMenu.tsx`. The whole diff is a coach-mark tour.
- **#455** and **#357** hit the same glob changing error handling in `ExportComplete.tsx` and
  `ExportMenu.tsx`. Neither shapes a package.
- **#478** hit `src/main/index.ts` moving window sizing out to `resolveWindowSize`. That file is
  listed for the evidence-viewer invariants, webview navigation blocking and sandbox
  `webPreferences`, and the diff went nowhere near them. The file it moved the sizing into,
  `src/main/windowSize.ts`, is on the exclusion list below (#515).

So 16 of 38 labelled merges, 42%, touched no path where the change could have altered an
evidentiary result.

The tiers do not clear all sixteen. Re-running the same measurement against the tiered list,
**13 of 38 now classify advisory or no-hit and 25 stay blocking.** The gap is `src/main/services/db/**`,
kept blocking deliberately because it holds the evidentiary records, which leaves #677 (the
cross-case recent-activity feed) and #435 firing on a repo read. That is a known residual, not an
oversight: narrowing `db/**` to something that distinguishes a read from a write is a real piece of
work and it is not this one.

### Known exposure of the advisory tier

Recorded rather than resolved, because the tier assignment is a deliberate trade.

`src/main/services/settings.ts` is advisory, and it persists the operator identity that
`src/main/services/certification.ts` embeds verbatim in an export certification. A change there can
therefore reach a shipped package without a blocking finding. The judgment is that the certification
path itself is blocking and is where such a change becomes visible. If an advisory-tier defect ever
does reach `main` through this route, that is the evidence to promote the entry, and it should be
promoted rather than argued with.

`src/main/index.ts` stays blocking despite its only observed fire being incidental. One file's noise
does not buy dropping the evidence-viewer invariants, and the better fix for the specific carve-out
that caused it was to record the carved-out file as an exclusion (#515), which is now done.

## Include list

### Acquisition (extension → capture server)

| Path | Tier | Why |
|---|---|---|
| `extension/src/background.ts` | blocking | Orchestrates MHTML/screenshot/text capture; caches response headers anchored into the signed manifest |
| `extension/src/content.ts` | blocking | In-page capture: screenshot stitching, DOM mutation during capture, selector matching over page text |
| `extension/src/toast.ts` | blocking | Injects DOM before/during capture — its markup can land inside captured bytes |
| `extension/src/utils/api.ts` | blocking | Builds the multipart capture payload that becomes hashed evidence and manifest fields |
| `extension/src/utils/headers.ts` | blocking | Deterministic header normalization anchored into the hash-chained manifest |
| `extension/src/popup/popup.tsx` | blocking | Routes a capture to a case (chain-of-custody routing) |
| `extension/src/popup/PopupApp.tsx` | blocking | The popup itself since #387: picks the case a capture is routed to, and gates the capture button on the ignore rules |
| `extension/src/popup/pageStatus.ts` | blocking | Derives what the popup tells the operator about a page, including whether a capture would be refused |
| `extension/src/messages.ts` | blocking | The popup/background contract carrying the block reason and the rules-loaded flag the capture route gates on |
| `extension/manifest.json` | blocking | Acquisition permissions; ships in the release zip |
| `src/main/services/captureServer.ts` | blocking | Ingest endpoint: upload validation, case routing, ingest-time selector matching |
| `src/shared/urlPatterns.ts` | blocking | The ignored-URL matcher both sides run: it decides what never enters a case at all, and names the rule recorded as the reason for the absence |
| `src/shared/urlCanonicalize.ts` | blocking | Canonical URL identity for the extension attach routes: decides which Capture a Tag or Note binds to, and whether an attach request ingests its payload or binds to an existing Capture |
| `src/main/services/exclusionPolicy.ts` | blocking | Resolves the per-case exclusion list into the answer the acquisition routes check before ingest, so it decides what those routes refuse. Not every route asks: the pipeline self-test (`POST /api/captures/test`) is a documented exception, so read the call sites rather than assuming coverage is total |
| `src/main/services/serverToken.ts` | blocking | Authenticates ingest; weakening admits spoofed captures into the evidence chain |
| `src/main/services/session.ts` | blocking | Active-case state deciding which case a capture is filed under |
| `src/main/services/recapture.ts` | blocking | Recapture queue re-acquiring URLs as new evidence |
| `src/main/services/backgroundRenderer.ts` | blocking | Headless render producing the artifacts that get hashed |
| `src/main/services/consentBlocker.ts` | blocking | Suppresses consent overlays during recapture — alters acquired page content |

### Integrity core (hash, manifest, signing, trusted time, verification)

Assurance boundary for this block, stated so the rationales do not overclaim: the manifest chain
and the RFC 3161 token cover **different things**, and neither substitutes for the other. The
timestamp request's message imprint is the capture's `contentHash` (`buildTimestampRequest` in
`src/main/services/timestamp.ts`), so a granted token dates *the captured bytes* — it says nothing
about whether the manifest chain around them is intact. The chain, conversely, covers manifest
entries but is signed with the installation-local keypair generated and held by this install
(`src/main/services/signingKey.ts`), so it detects edits made *without* that key and is not
independent of the Operator who holds it.

| Path | Tier | Why |
|---|---|---|
| `src/main/services/manifest.ts` | blocking | Hash-chained, signed audit manifest append/verify. The chain detects edits made without the installation-local signing key; it is not an Operator-independent guarantee |
| `src/main/services/signingKey.ts` | blocking | Manifest signing keypair generation/storage/signing — the key the chain's assurance is bounded by |
| `src/main/services/timestamp.ts` | blocking | RFC 3161 `TimeStampReq` construction (message imprint = the capture's `contentHash`) and TSA round-trip. The token dates the content; it does not prove manifest-chain integrity |
| `src/main/services/timestampWorker.ts` | blocking | Async timestamping worker writing manifest entries |
| `src/main/services/trustedTime.ts` | blocking | Per-capture trusted-time status resolution |
| `src/main/services/tsaTrust.ts` | blocking | Embedded TSA trust anchors shipped in evidence packages |
| `src/main/services/tlsCertChain.ts` | blocking | TLS chain corroboration anchored into signed manifest entries |
| `src/main/services/installationId.ts` | blocking | Installation identity in manifest entries and certification |
| `src/shared/verify/**` | blocking | Verification core: canonical JSON, chain, signature, RFC 3161 token, package verifier |
| `src/verifier/**` | blocking | Standalone verifier CLI (fs+crypto-only constraint) |
| `src/main/index.ts` | blocking | Enforces evidence-viewer invariants (webview navigation block, sandbox webPreferences); boots DB/capture server/installation id |

### Capture lifecycle, storage, parsing, extraction

| Path | Tier | Why |
|---|---|---|
| `src/main/services/captureLifecycle.ts` | blocking | Ingest/delete pipeline: hashing, manifest entries, trusted-time reconciliation |
| `src/main/services/captureStore.ts` | blocking | Owner of capture artifact bytes on disk |
| `src/main/services/storage.ts` | blocking | Storage root and case directory layout |
| `src/main/services/mhtmlDecoder.ts` | blocking | MHTML parsing feeding text extraction |
| `src/main/services/dataExtractor.ts` | blocking | IOC extraction pipeline entry |
| `src/main/services/extraction/**` | blocking | Source selection, sanitizer, IOC adapter, validators — determine extracted results |
| `src/main/services/db/**` | blocking | All evidentiary records: schema, repos, dbAdmin row edit/restore/purge |
| `src/main/services/selectorLifecycle.ts` | blocking | Retro-matching writes `selector_matches` rows that ride in case archives |
| `src/main/services/safeRegex.ts` | blocking | Regex evaluation deciding those persisted matches (follows the selector cluster call below) |

### Annotation, redaction, notes-to-evidence binding

| Path | Tier | Why |
|---|---|---|
| `src/main/services/annotations.ts` | blocking | Persists annotation shapes incl. redaction rects burned into exports |
| `src/main/services/burnAnnotations.ts` | blocking | Composites annotations/redactions onto exported pixels |
| `src/main/services/renderAnnotationsSvg.ts` | blocking | Shape rendering for burn-in — a wrong redact rect leaks or destroys content |
| `src/main/services/noteAnchorResolver.ts` | blocking | Binds notes to hash-covered text |
| `src/shared/noteDoc.ts` | blocking | Note document model + text derivation (feeds FTS and exported reports) |
| `src/shared/noteAnchor.ts` | blocking | Anchor model deciding which evidence a note points at |
| `src/renderer/components/captures/annotation/**` | blocking | Annotation editing incl. the redact tool |

### Export, reporting, archive

| Path | Tier | Why |
|---|---|---|
| `src/main/services/export.ts` | blocking | Evidence-package export: hashing, evidence.json, verification, burn-in |
| `src/main/services/pdfExport.ts` | blocking | PDF disclosure rendering |
| `src/main/services/reportHtml.ts` | blocking | Forensic report renderer inside packages |
| `src/main/services/certification.ts` | blocking | Export certification document |
| `src/main/services/verifyRunbook.ts` | blocking | By-hand verification runbook shipped in packages |
| `src/main/services/caseArchive.ts` | blocking | Archive export/import with id remapping |
| `src/main/services/zip.ts` | blocking | Evidence container write |
| `src/main/services/zipRead.ts` | blocking | Evidence container read |
| `src/main/services/csvEscape.ts` | blocking | Escaping behind CSV exports of case data |
| `src/renderer/components/export/ExportDialog.tsx` | blocking | Export options directly shape the package. Narrowed from `src/renderer/components/export/**` on 2026-08-23. See the tier amendment |

### AI analysis

| Path | Tier | Why |
|---|---|---|
| `src/main/services/ai/**` | blocking | Analysis pipeline + chat client (truncation changes model input, hence output) |
| `src/renderer/components/captures/AnalysisTab.tsx` | blocking | Triggers analysis, selects model/prompt, saves results |
| `src/renderer/components/settings/AIConfig.tsx` | blocking | Writes `defaultModel` and `analysisSystemPrompt` — same rationale as AnalysisTab |

### Interpretation surfaces (renderer)

| Path | Tier | Why |
|---|---|---|
| `src/renderer/components/captures/ForensicsTab.tsx` | blocking | Hash chain / chain status / headers display |
| `src/renderer/components/captures/ProvenanceBadge.tsx` | blocking | Integrity + trusted-time status rendering |
| `src/renderer/components/captures/getProvenanceColor.ts` | blocking | Status-to-meaning mapping |
| `src/renderer/components/captures/MhtmlViewer.tsx` | blocking | Evidence rendering invariants (JS disabled, navigation blocked) |
| `src/renderer/components/captures/WaybackTab.tsx` | blocking | Pins Wayback corroboration refs |
| `src/renderer/components/captures/CaptureDownloadMenu.tsx` | blocking | Per-capture evidence export surface |
| `src/renderer/components/overview/VerifyBar.tsx` | blocking | Case-level verification display |
| `src/renderer/components/overview/overviewModel.ts` | blocking | The actual verified/tampered bucketing VerifyBar shows |
| `src/renderer/components/dashboard/cases/ImportCaseDialog.tsx` | blocking | Archive verification display + `overrideTamper` flow |
| `src/renderer/components/dashboard/cases/DataExplorer.tsx` | blocking | Extraction results display + reprocess trigger |
| `src/renderer/components/settings/DatabaseAdmin.tsx` | blocking | Direct DB administration over evidence tables |
| `src/renderer/components/settings/db/**` | blocking | The DB administration views behind it (browse, row edit, utilities) |
| `src/renderer/components/settings/OperatorConfig.tsx` | blocking | Operator identity embedded verbatim in export certification |

### Cross-process contracts and configuration

| Path | Tier | Why |
|---|---|---|
| `src/main/ipcHandlers.ts` | advisory | Shapes inputs/outputs of evidence operations (see judgment call 1) |
| `src/preload/index.ts` | advisory | Single privileged chokepoint for every evidence channel |
| `src/shared/ipc.ts` | advisory | Typed payloads for evidence operations (see judgment call 1) |
| `src/shared/types.ts` | advisory | Domain contracts for captures, provenance, trusted time, exports |
| `src/shared/schemas.ts` | advisory | Zod validation at trust boundaries (upload, manifest entry, settings) |
| `src/shared/constants.ts` | advisory | Manifest filename/schema version, TSA URL, size caps, default analysis prompt |
| `src/main/services/settings.ts` | advisory | Persists TSA URL, operator identity, capture prefs, key encryption |
| `src/main/services/waybackMachine.ts` | blocking | Corroboration lookups pinned as evidence references |

### Software distribution

| Path | Tier | Why |
|---|---|---|
| `package.json` | advisory | electron-builder `build` block, dependency pins/overrides |
| `pnpm-lock.yaml` | advisory | The actual dependency pin compiled into shipped bundles (see judgment call 3) |
| `.github/workflows/release.yml` | advisory | Builds/publishes installers, updater manifests, extension zip |
| `electron.vite.config.ts` | advisory | Compiles the exact app bytes the release workflow publishes |
| `extension/vite.config.ts` | advisory | Compiles the exact extension bytes the release workflow publishes |
| `scripts/build-verifier.mjs` | blocking | Build of the distributed verifier binary |
| `sea-config.json` | blocking | SEA definition of that verifier binary |
| `src/main/services/updater.ts` | advisory | Update delivery |

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
| `src/main/windowSize.ts` | Main-window geometry, and the `BIRDBRAIN_WINDOW_SIZE` override read only in an unpackaged build. It holds none of the invariants `src/main/index.ts` is listed for: no capture, content hash, manifest entry, canonical JSON field or signature depends on the size of the window the evidence is later viewed in. Split out of the included `src/main/index.ts` by #478, and left off both lists until #515 |
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
| `src/renderer/components/export/ExportMenu.tsx` | Launch and confirmation UI. It opens the dialog and reports the result; it shapes no package. Split out of `src/renderer/components/export/**` on 2026-08-23 |
| `src/renderer/components/export/ExportComplete.tsx` | Same rationale as `src/renderer/components/export/ExportMenu.tsx` |
| `src/renderer/components/export/ExportProgress.tsx` | Same rationale as `src/renderer/components/export/ExportMenu.tsx` |
| `src/main/services/db/diagnosticsRepo.ts` | Read-only database facts for the Diagnostics panel. Swept in by `src/main/services/db/**` and named as an accepted false positive by judgment call 8; made explicit on 2026-08-23 |
| `src/renderer/components/settings/db/ConfirmDialog.tsx` | Generic confirmation dialog. Swept in by `src/renderer/components/settings/db/**`, same judgment call 8 rationale |

## Judgment calls needing confirmation in review

1. **`src/main/ipcHandlers.ts` and `src/shared/ipc.ts` wholesale.** Both also carry pure-UI
   channels, so the gate fires on many non-evidence PRs. The backstop cannot distinguish a
   payload-type change to an evidence channel from a new UI list query. Accept the noise, or
   split the files later. **Resolved 2026-08-23:** both are advisory. The
   files are not split; the tier absorbs the noise instead.
2. **`src/renderer/lib/api/**` excluded while `src/preload/index.ts` is included.** Both are
   typed passthroughs. As excluded, a hostile change like hardcoding `overrideTamper: true` in the
   import mutation (`src/renderer/lib/api/cases.ts`) would not trip the backstop. Including it
   gates most renderer PRs. Current call: excluded — the label-at-triage trigger and human review
   are expected to catch that class.
3. **`pnpm-lock.yaml`.** Included by the same logic as `package.json` (the lockfile is the actual
   pin that determines shipped code), but it gates every dependency-bump PR. Current call:
   include; drop it if dep-bump noise proves unacceptable during the pilot.
   **Resolved 2026-08-23:** it did. `pnpm-lock.yaml` is advisory, still listed.
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
   **Resolved 2026-08-23:** the globs stay, and both named files are now explicit exclusions.
   The precedence rule in "List format" makes the specific exclusion win over the directory
   glob, so future files in those directories are still swept in.
9. **`extension/src/toast.ts` / `extension/src/popup/popup.tsx`.** One step removed from captured
   bytes (toast markup can be captured; the popup routes evidence to a case). A stricter list
   could drop `extension/src/popup/popup.tsx`.
10. **Distribution block (`src/main/services/updater.ts`, the build configs,
    `.github/workflows/release.yml`, `pnpm-lock.yaml`).** Included under the definition's
    "software distribution" clause. If release PRs get their own review channel instead, this
    whole section could move out of the backstop.
    **Resolved 2026-08-23:** the section is advisory rather than moved out, except
    `scripts/build-verifier.mjs` and `sea-config.json`, which define the binary a receiving
    party runs and stay blocking.
