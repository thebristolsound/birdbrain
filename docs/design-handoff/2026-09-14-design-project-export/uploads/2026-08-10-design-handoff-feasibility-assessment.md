# Feasibility assessment: "birdbrain experimental" design handoff

**Audience:** the design side of the prototype loop, and whoever implements the first slice.
**Reviewed:** the handoff bundle extracted at [`docs/design-handoff/2026-08-10-birdbrain-prototype/`](../design-handoff/2026-08-10-birdbrain-prototype/), whose `github.md` records a sync against `thebristolsound/birdbrain@main` tree `37dbf57` — the same tree this assessment was audited against. Every code claim below was checked against that tree, not taken from the bundle.

This is Deliverable A from the bundle's `ENGINEERING_REVIEW.md`: an Accept / Modify / Reject verdict, size, and data-model notes for each of the 15 checklist items, plus a verdict on the `style_sync_patch/` bundle. Anything marked Modify names the constraint, per the review brief's request — no redesigns here.

## Summary

| # | Item | Verdict | Size |
|---|---|---|---|
| 1 | Per-tab case binding | Modify | M |
| 2 | Hide extension UI during capture | Accept — live defect, file as a bug now | S |
| 3 | Options page | Accept | S |
| 4 | In-page selection bar (Selector / Tag / Quote) | Modify — split; sequence note/tag server routes separately | L |
| 5 | Popup ignore-list pre-filter | Accept | XS |
| 6 | Mentions + references index | Accept with modifications — gates 7 and 8 | XL |
| 7 | Backlink map | Accept, after 6 | M |
| 8 | Notes editor mentions UX | Accept, after 6 | M–L |
| 9 | Selector `origin` | Accept | S |
| 10 | Per-case auto-capture exclusions | Modify — defer until auto-capture is re-enabled | M |
| 11 | Captures screen rework | Modify | L |
| 12 | Wayback panel + compare + export refs | Modify | M–L |
| 13 | Export dialog (presets / scope / custody) | Modify | L |
| 14 | Overview consolidated variant + dashboard feed | Accept | S–M |
| 15 | Density system | Accept, after the style questions settle | S |
| — | `style_sync_patch/` | Reject as shipped — regenerate against the final token system | — |

Three items touch the evidence path (2, 12, 13) and therefore carry the [ADR-0005](../adr/0005-unattended-agents-on-the-evidence-path.md) gates if agent-implemented: human review, no auto-merge.

## Extension items

### 1. Per-tab case binding — Modify (M)

The wire and the capture route are nearly free; two other routes and the service worker are not.

- `sendMhtmlCapture` already takes an optional `caseId` (`extension/src/utils/api.ts:174`), and the server honours it: for `manual`/`selector` captures the per-request `caseId` is required and validated against the case repo (`src/main/services/captureServer.ts:305-317`). A per-tab binding changes only which id the extension sends.
- **Constraint 1:** `POST /api/selectors` rejects any `caseId` that is not the global active case, and `GET /api/selectors/active` is hard-bound to it (`captureServer.ts:419-446`). Per-tab binding breaks selector creation and highlighting on non-active tabs unless both routes change.
- **Constraint 2:** the service worker keeps all state in module-level variables (`extension/src/background.ts:185-191`) with no `chrome.storage.session` persistence; the only persisted value is the server token. A `tabId → caseId` map must persist across worker suspension or bindings silently reset.
- **Open question back to design** (the brief asked): the app keeps one active case in main-process memory (`src/main/services/session.ts:59-97`), and the popup currently mutates it via `POST /api/cases/:id/activate`. What do the app and popup display when tabs disagree with the app's active case? The prototype does not answer this, and it determines whether `session.ts` changes at all.

### 2. Hide extension UI during capture — Accept (S), and it is a live defect today

The prototype frames this as a requirement for new UI. It is also a bug in the shipped capture path, worth filing and fixing independently of any design work.

- The capture toast is shown *before* screenshotting: `SHOW_CAPTURE_TOAST` is sent at `background.ts:517`, immediately followed by the screenshot sequence (`background.ts:519-528`). The toast is `position: fixed` inside a shadow root (`extension/src/toast.ts:14-29`), which the sticky-element collector in `content.ts:259-274` cannot see (`querySelectorAll` does not pierce shadow roots). Nothing in a capture path hides or removes it. The spinner is baked into every full-page and scrolling screenshot.
- Selector highlights (`mark.birdbrain-selector-highlight`, `content.ts:17-24`) are never removed on a capture path — `removeHighlights` is only called from `CHECK_SELECTORS`/`CLEAR_HIGHLIGHTS` handlers — and `manualCaptureTab` re-highlights after capture (`background.ts:557-560`).
- The MHTML side is worse than the screenshot side: `chrome.pageCapture.saveAsMHTML` (`background.ts:14`) serialises the live DOM, so the toast host, the injected highlight `<style>`, and the `<mark>` wrappers are written into the archived MHTML itself. That puts Birdbrain chrome inside the evidence file, not just the image.
- Scope of the fix: `content.ts` capture paths + `toast.ts` (suppress/defer toast state until frames are taken), plus stripping or pre-hiding injected nodes before `saveAsMHTML`. Any new in-page UI from item 4 must hook the same mechanism.
- Evidence path: yes. ADR-0005 gates apply.

### 3. Options page — Accept (S)

Greenfield, and everything the read-only design needs already exists server-side:

- No `options_ui`/`options_page` in `extension/manifest.json`; the popup's gear currently deep-links `birdbrain://settings` (`extension/src/popup/popup.tsx:10-12`).
- The token row is real: `birdbrainServerToken` in `chrome.storage.local`, provisioned from `GET /api/status` (`api.ts:16,82-90`), sent as `X-Birdbrain-Token`.
- `captureScreenshots` is app-owned (`src/shared/types.ts:169`) and published on `/api/status` (`captureServer.ts:204`); the extension has no write path for it, so the prototype's read-only mirror is the honest framing. Keep it read-only — a toggle would need a new settings-mutation route on the capture server, which does not exist.
- Incidental finding while auditing: `host_permissions` lists `http://localhost:19845/*` while the CSP `connect-src` allows `http://127.0.0.1:19845` — worth unifying whenever the manifest is next touched.

### 4. In-page selection bar — Modify (L): split it

The Selector action is cheap; Tag and Quote are a capture-server scope change the brief suspected, and the suspicion is confirmed.

- Complete route list of the capture server today: `GET /api/status`, `GET /api/cases`, `POST /api/cases/:id/activate`, `POST /api/session/start|stop`, `POST /api/captures`, `POST /api/captures/test`, `GET /api/selectors/active`, `POST /api/selectors` (`captureServer.ts:161-472`). The server has **no** note-write route and **no** tag-apply route; notes and tags exist only over Electron IPC (`src/shared/ipc.ts:77-85,123-129`).
- Tag/Quote therefore need two new authenticated routes plus Zod schemas following the `SelectorCreateSchema` pattern (`captureServer.ts:431-435`). CORS currently allows only GET and POST (`captureServer.ts:144`).
- Recommendation: land a selector-only selection bar first (route exists, per-tab caveat from item 1 noted), and sequence the note/tag endpoints as their own decision — they widen the loopback API surface, which has been kept deliberately small.

### 5. Popup ignore-list pre-filter — Accept (XS)

The asymmetry is real and already documented in-code: the comment at `background.ts:428-434` states that the popup's `MANUAL_CAPTURE` path skips the pre-filter and relies on the server 403 (`captureServer.ts:293-303`). The popup path also skips the hard-coded `DEFAULT_IGNORE` scheme guard (`background.ts:112-120,407`), so a `chrome://` or `file://` tab currently reaches `pageCapture` and runs the full scroll-and-screenshot sequence before failing. The fix is a few lines in the `MANUAL_CAPTURE` listener (`background.ts:735-741`).

One semantic to preserve: the server evaluates patterns fail-open in a vm sandbox with a 200 ms budget while the extension uses platform `RegExp` with no timeout (`captureServer.ts:86-92` vs `background.ts:420-437`) — the two can disagree on a pathological pattern, and that behaviour is pinned by `tests/shared/urlPatterns.test.ts`.

## App items — data model

### 6. Mentions + references index — Accept with modifications (XL). This is the gating item.

The brief is right that this is the load-bearing structure. The current model and its constraints:

- Notes are TipTap 3.29 (ProseMirror) JSON — `noteExtensions()` is `StarterKit` only (`src/shared/noteDoc.ts:24-32`) — with a derived plain-text `body` column that FTS indexes (`src/main/services/db/noteRepo.ts:106-115`).
- **Validation is strict and throws:** `parseNoteDoc` runs `Node.fromJSON(schema, doc).check()` (`noteDoc.ts:59-80`). A mention node type must be added to `noteExtensions()` or every note containing one is rejected on write *and* on archive import. The shared schema is the right place — both processes import it.
- No mention grammar, no `@tiptap/suggestion`, and no references table exist anywhere. Closest analogues to copy: `selector_matches` (`migrations.ts:113-127`) for the index shape, and note anchors (`noteAnchor.ts:11-76`, migration v27) for typed id-carrying references with case-scope assertion (`noteRepo.ts:39-58`) and import-time id remapping (`noteAnchor.ts:234-246`).
- **Hidden cost the prototype does not price:** on archive import, only `anchor_json` is id-remapped — `body_doc` is not (`noteRepo.ts:264-276`). Inline mention tokens embed entity ids inside `body_doc`, so import needs a doc-walking remap step, plus any new table joining `ID_PROBE_TABLES` (`src/main/services/db/core.ts:45-53`) and a `CASE_ARCHIVE_SCHEMA_VERSION` bump (currently 2, `caseArchive.ts:58`). Without this, an imported case's mentions silently re-point at colliding local rows — the exact bug class the anchor remap machinery exists to prevent.
- Existing invariant to respect: a dangling reference must survive as a visible gap, never be scrubbed (`noteAnchorResolver.ts:86-101`).
- Schema mechanics are cheap and well-worn: migration v28 (`LATEST_SCHEMA_VERSION` is 27), a `note_references` table shaped like `selector_matches`, extraction on note write.
- Dependency note: the natural implementation uses `@tiptap/suggestion`, which is not installed. New dependency — needs sign-off before the implementation slice starts.

Recommendation matches the brief's Deliverable B: a references-index spike proving mention extraction → table → query on real case data, before any UI.

### 7. Backlink map — Accept (M), after 6

Feasible as a pure render over the references index; the deterministic 3×8 lattice, filters, and hover states are view-layer with no data-model impact beyond item 6. Answering the brief's direct question: yes, enforce a node ceiling — the prototype's own scale test capped the Signals coverage strip at 24 when 156 captures blew it out, and the map should get the same treatment (cap + "showing N of M" affordance) rather than a layout that degrades.

### 8. Notes editor mentions UX — Accept (M–L), after 6

Answering the brief's editor-framework question: **not a rewrite.** The editor is already TipTap/ProseMirror (`useNoteEditor.ts:44-62`), which supports suggestion popups and inline node views natively. Two real costs:

- No caret-following popup machinery exists anywhere in the renderer — every current popover is statically positioned (`CreateSelectorPopover.tsx:49-53` and siblings). The flip-above-caret / escape-squelch behaviour is net-new, though `@tiptap/suggestion` provides most of the positioning plumbing.
- Read-only note rendering goes through `@tiptap/static-renderer` (`NoteBody.tsx:19-30`), so a mention node also needs a static-render mapping or chips silently disappear in note cards and in exported reports.

### 9. Selector `origin: 'note'` — Accept (S)

Cleanest item on the list. `selectors` has no provenance column of any kind — the column set is unchanged since migration v3 (`migrations.ts:84-101`). Additive `ALTER TABLE` in v28, plus touching the three insert statements and row mapper in `selectorRepo.ts`, the archive import, and `CreateSelectorParams` (`ipc.ts:301-306`). Worth widening the enum beyond `'note'` while at it: the DataExplorer promotion path (`DataExplorer.tsx:156`) is exactly the provenance this column would record and is currently indistinguishable from manual entry.

### 10. Per-case auto-capture exclusions — Modify: defer (M)

The design is implementable, but it configures a feature that is currently switched off.

- Auto-capture is disabled by hotfix: the extension deliberately ignores `autoCaptureMode` and the whole auto-capture block is commented out (`background.ts:203-204,439+`); `dedupeWindowSeconds` is likewise inert (`src/shared/constants.ts:26-31`). Only manual capture is live.
- The global list exists and is richer than domain-only: regex literal / glob / substring grammar in `src/shared/urlPatterns.ts:10-33`, enforced server-side (403) and extension-side with the documented asymmetry from item 5.
- Per-case state is genuinely net-new — no per-case ignore column or table exists, and `/api/status` ships one flat global array (`captureServer.ts:203`). The stack/override mode also needs the status payload to become case-aware, which interacts with item 1's per-tab binding.

Recommendation: hold this until auto-capture's re-enablement is scheduled, then land the two together — the exclusion UI shipping first would be dead controls.

## App items — UI reworks

### 11. Captures screen — Modify (L)

Three findings, one of which the prototype should send back as a question rather than assume:

- **Multiselect is half-scaffolded and dead.** `selectedCaptureIds` + toggle/selectAll/clear exist in the store (`appStore.ts:8,32-34,68-81`) but nothing reads them; `CaptureItem` accepts checkbox props that `CaptureList` never passes (`CaptureItem.tsx:40-42` vs `CaptureList.tsx:298-305`). The interaction layer (⌘/shift-click, ⌘A, escape, batch bar) is all net-new but has a head start.
- **No batch IPC exists.** Delete, tag add/remove, pin, download are all single-capture (`ipc.ts:502-535`); `export:generate` takes `[caseId, options]` with no capture list (`ipc.ts:579`); `recapture:enqueue` takes URLs and a singular `supersedesCaptureId`, so it cannot express "recapture these 5 captures". Every batch-bar action needs either new plural channels or renderer-side fan-out with progress semantics — decide which before sizing the slice.
- **The tab claim conflicts with a deliberate upstream refactor.** Current viewer tabs are Screenshot / Page / **Source** / Text (`CaptureViewer.tsx:19-28`); Wayback and Forensics were intentionally demoted from tabs to collapsible details-panel sections (`CaptureDetailsPanel.tsx:388-459`, comments say so explicitly). The prototype's Screenshot / Page / Text / Wayback set is therefore two reversals, and the bundle's own `github.md` sync note says "before syncing Captures again, confirm which side wins." Confirm that with design before anyone implements — this assessment does not pick a winner.
- Resizable/collapsible columns: currently fixed widths with only the details panel collapsible (`routes/cases/$caseId/captures.tsx:98-151`); no resize primitive exists in the codebase or `package.json`. View-layer work, no data impact.

### 12. Wayback — Modify (M–L)

Bigger head start than the checklist assumes, and one real gap that is an evidence-path change:

- CDX querying is fully implemented (`waybackMachine.ts:38-107`: `output=json`, `collapse=digest`, closest-sort, 15 s abort) and pinning is fully persisted in `capture_archive_refs` (`waybackRefRepo.ts:14-62`). The checklist's "needs CDX API querying, snapshot pinning persistence" is already done.
- **The gap:** pinned snapshots surface nowhere in the evidence export — zero references in `export.ts`, `manifest.ts`, `certification.ts`, or `reportHtml.ts`; the export zip contents are enumerated at `export.ts:296-320`. Pins are carried only in the `.birdbrain` case archive (portability, not evidence). Surfacing them as archive.org references in the export is the new work, it changes the evidence package contents, and ADR-0005 gates apply.
- No side-by-side compare exists — today's surface is a flat list in a details-panel section with open-external and pin/unpin (`WaybackTab.tsx`, a filename that predates the demotion). The slide-out + split viewer is net-new view work.
- Keep the prototype's framing that Birdbrain does not diff the two panes. That is the correct claim-discipline position and matches the bundle's own decision log.

### 13. Export dialog — Modify (L)

- Today's dialog is a flat 4-item checklist (captures / screenshots / audit trail / burn annotations) with an investigator-name field and a hard-locked zip format (`ExportDialog.tsx:21,124-169`). No presets, no scope row.
- **Selection scope is the structural change:** `ExportOptions` has no `captureIds` (`types.ts:485-495`), `export:generate` takes `[caseId, options]`, and `generateReport` loads the full case unconditionally (`export.ts:113`, with `verifyCaptures` at `:66` and preflight at `:76` on the same assumption). Threading a subset through is mechanical but wide, and it depends on item 11's multiselect existing.
- One decision the prototype does not cover: every export appends a signed `type: 'export'` manifest entry with the package hash (`export.ts:229-247`). A partial export must record its scope in that entry, or the audit trail cannot distinguish "exported the case" from "exported five captures". Name that field in the design.
- The chain-of-custody sheet largely exists as `certification.html` (`certification.ts:30-51,182-293`): tool/version/hash-algorithm/TSA, process description, trusted-time table, operator identity + installation id + export timestamp, self-asserted-identity disclaimer, signature/date block. Map the prototype's nine fields against that before inventing a second cover sheet. Known caveat carried from the admissibility work: the operative legal wording is still `LAWYER_TBD_MARKER` (`certification.ts:53`).
- Evidence path: yes. ADR-0005 gates apply.

### 14. Overview consolidated variant + dashboard activity feed — Accept (S–M)

- "Since your last visit" already exists: localStorage marker per case (`useLastVisit.ts:14-30`), deltas and freshness in `overviewModel.ts:80-116`, banner in `CaseOverview.tsx:109-122`. The consolidated re-layout is view-layer; the backlink-map slot inside it depends on items 6–7 and should not block the rest.
- The dashboard feed needs one new repo function (captures joined to cases, `ORDER BY timestamp DESC LIMIT n` — nothing existing serves it; `getCaptureCountsByCase` at `captureRepo.ts:218-229` is counts-only) and one new IPC channel. Cheap, net-new.

### 15. Density system — Accept (S), sequenced after the token decision

No `--d-*` properties or density concept exists; spacing is per-component Tailwind literals throughout. The mechanism (three steps of custom properties on the root, radius pinned) is straightforward, but it only makes sense on top of a settled control/spacing standard — which is exactly what the style-sync question below leaves open. Land it with, not before, the regenerated style pass.

## The style-sync patch — Reject as shipped; regenerate

`style_sync_patch/` is stale against the prototype's own final system, and `ENGINEERING_REVIEW.md`'s instruction to "review it as a normal PR — it is mechanical" should not be followed.

- The patch (its README self-dates the measurement pass to 2026-08-07) prescribes a 4/6/8/12/16 radius scale, 32 px default controls, and `--radius-2xl` 12→16 px.
- The bundle's later sessions standardized the opposite: radii **2/4/6 only**, one **28 px / 4 px-radius** button metric, pills reserved for status, 2 px bars — applied across every screen in the "standardization pass" and "sweep pass" recorded in `SESSION_HISTORY.md`, and stated as the current token system in the bundle's top-level `README.md`. The two documents contradict each other; the session history and top-level README are the later state.
- Applying the patch as shipped would land a superseded scale and then require a second sweep to undo it.

For whoever regenerates it, the current-code facts the new patch must diff against: `--radius-2xl` is a hard-coded 12 px equal to `--radius-xl` (`globals.css:76-83`); all Button sizes share `rounded-md`, with `sm` at 32 px/14 px text (`ui/button.tsx:8,18-25`); inputs are `bg-elevated` + `border-border-strong` (`ui/input.tsx:8`) — the "recessed input" inversion the patch describes is a real difference; `SectionLabel` and `CardPanel` do not exist (`ui/index.ts`), and the section-label idiom is hand-rolled in ~18 places across 11 files with inconsistent size/color, so the primitive is a genuine consolidation whichever token set wins.

## Suggested sequencing (response to Deliverable B)

The brief proposed style patch + extension pass + references spike as the first slice. Amended by the findings above:

1. **File and fix item 2 now, as a bug** — Birdbrain UI baked into screenshots *and* MHTML is a live evidence-integrity defect independent of the design work. Small, self-contained, evidence-path-gated.
2. **Item 6 references-index spike** — the stated gate for items 7, 8, and the Overview map, and the thing design iteration is blocked on. Includes the `body_doc` import-remap question, which is the spike's hardest part.
3. **Hold the style patch** until regenerated against the 2/4/6 system; item 15 rides with it.
4. Items 5 and 9 are safe fillers at any point (XS/S, no coupling).
5. Send two questions back to design rather than implementing an assumption: item 1's disagreement semantics (app active case vs per-tab bindings), and item 11's Captures tab set (the prototype reverses a deliberate upstream refactor, and the bundle's own sync notes flag the conflict).
