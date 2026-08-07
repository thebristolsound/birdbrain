# Anchored notes and report authoring

Date: 2026-07-24
Status: design (no code changes)
Scope: replace the current plain-text notes feature with anchored notes, and add an authoring layer that composes them into an investigator-written report. Supersedes nothing; depends on the report renderer landed in PR #216.

## Shape: evidence board → brief

Notes become the atomic unit of investigative work: rich text, an anchor into a specific piece of evidence, and a link to the capture that motivated them. Writing anchored notes is the daily surface and it is what replaces today's notes feature.

Building a report is a separate **curation** step: pull notes in, order them into an argument, write connective prose between them, promote referenced captures to numbered exhibits. The exported document is an authored spine with exhibits in an appendix.

Two alternatives were considered and rejected:

- **One document.** A single rich-text document per report, evidence inserted as inline nodes. Most familiar, weakest structurally: no hook for separating authored claims from attested ones, and section reordering is prose-dragging.
- **Typed blocks only.** The report as a tree of typed blocks with no separate note surface. Good structure, but the investigator faces a blank page at report time and evidence curation has nowhere to live.

The deciding argument is epistemic rather than architectural. In this shape, anchoring happens **at the moment of observation** — the investigator writes the note while looking at the evidence. In the alternatives, references are created at writing time, reconstructing from memory, which is exactly when drift enters.

## The constraint that shapes everything

PR #216 took three review rounds and seventeen findings, all of one class: the document asserted something the export had not established. Two of the last five were regressions introduced while fixing that same class.

Those errors were caught because a machine made them, and a machine's claims are checkable — a reviewer could diff the renderer against the packager, and a test could assert the file exists. Prose is not checkable. An investigator who writes "all captures verified" produces a sentence nothing will ever recompute.

This is not a fraud problem. The target is **drift and accident**: claims that were true when written and stopped being true, and references that pointed somewhere real until something moved. That target is narrow enough to design against.

The design rule that follows: **structure the references, not the prose.** The investigator writes freely. The moment they point at evidence, it is typed. Nothing attempts to validate the content of a claim.

### Five failure modes this must prevent

1. **Attribution laundering** — an operator's inference rendered with the same authority as a computed fact.
2. **Citation drift** — "Exhibit 3" in prose after exhibits are reordered or removed.
3. **Stale claims** — a verification statement written before an export that ran no verification.
4. **Quote drift** — a quoted passage copied into prose, severed from the capture's hash.
5. **Curation as unstated argument** — twelve captures exhibited out of four hundred, with the denominator undisclosed.

## Domain model

### Anchored note

A note is rich text plus an optional anchor. Anchors come in four kinds, matching what the investigator can actually point at:

| Kind | Anchors to | Stability |
| --- | --- | --- |
| `capture` | the whole capture | Total. The fallback when a finer anchor fails. |
| `region` | a rectangle on the capture's screenshot | High. The image is immutable and content-addressed. |
| `text` | a passage in the stored page | Resolvable, not guaranteed. See below. |
| `finding` | a selector match or extracted datum | Stable only if anchored by natural key — see below. |

`region` reuses the coordinate space already established by `CaptureAnnotations.shapes` (`imageWidth`/`imageHeight` normalisation), so a note region and an annotation shape mean the same thing geometrically.

A `finding` anchor **must not store `extracted_data.id`**. Re-extraction runs `DELETE FROM extracted_data WHERE capture_id = ?` and re-inserts (`src/main/services/db/extractedDataRepo.ts:169`), so every surrogate id churns and every anchor holding one would break. Anchor instead by the natural key `(capture_id, category, subcategory, value)`, which the existing unique index `idx_extracted_data_unique` already guarantees and which survives re-extraction unchanged. Selector matches are addressable by their composite primary key `(selector_id, capture_id)` and need no surrogate.

### Text anchors and resolution

A text anchor stores `{ quote, prefix, suffix, textOffset }` — a quote with surrounding context and a hint offset. Resolution runs against the capture's extracted text sidecar:

1. Exact match at `textOffset` → resolved.
2. Unique exact match of `quote` elsewhere → resolved, offset repaired.
3. Unique match of `prefix + quote + suffix` → resolved.
4. Otherwise → **unresolved**.

An unresolved anchor is never silently downgraded to a capture-level anchor and never silently dropped. It renders as an explicit statement that the passage could not be located in the stored text, alongside the quote as recorded. This is the same discipline the exhibit renderer now applies to a missing page archive and a drifted screenshot digest: the gap is the finding.

Resolution is deterministic and runs in the main process against stored bytes. It never re-fetches anything.

### Brief

A brief is an ordered list of typed blocks. Block kinds:

- `narrative` — authored rich text. May contain `captureRef` and `quoteRef` inline nodes.
- `noteRef` — an anchored note pulled in whole.
- `exhibitRef` — promotes a capture to a numbered exhibit.
- `heading` — structural.

Every block carries `provenance`, assigned by kind and not editable:

| Block kind | Provenance |
| --- | --- |
| `narrative`, `heading` | `operator-authored` |
| `noteRef` | `operator-authored` |
| `quoteRef` (inline) | `operator-quoted` |
| `exhibitRef` | `tool-asserted` |

This is a property of the model, not a CSS class, so it survives export and is countable. No block may render without one — a missing value is a bug, not a default.

Exhibit numbers are **never stored**. They are assigned at render time from the final ordering of `exhibitRef` blocks, so reordering cannot produce a stale citation. This is the same fix as `packagedPaths` in PR #216 — derive, do not restate.

## Storage

Schema is at `user_version = 25` (`src/main/services/db/migrations.ts`). CLAUDE.md's claim of v1–v12 is stale and should be corrected separately.

### Notes

Additive migration. The existing `notes` table keeps every column:

```sql
ALTER TABLE notes ADD COLUMN body_doc TEXT;      -- ProseMirror JSON; NULL = legacy plain text
ALTER TABLE notes ADD COLUMN anchor_kind TEXT;   -- 'capture' | 'region' | 'text' | 'finding'
ALTER TABLE notes ADD COLUMN anchor_json TEXT;   -- kind-specific payload
```

`notes.body` stays the FTS-indexed plain text and is **derived in the main process** at write time via `generateText(doc, noteExtensions())`, never trusted from the renderer. The `notes_ai` / `notes_ad` / `notes_au` triggers over `(title, body)` are untouched, so `notes_fts` needs no rebuild and legacy plain-text notes remain valid with `body_doc = NULL`.

### Briefs

```sql
CREATE TABLE briefs (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
);

CREATE TABLE brief_blocks (
  id TEXT PRIMARY KEY,
  brief_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  kind TEXT NOT NULL,
  provenance TEXT NOT NULL,
  body_doc TEXT,        -- narrative blocks
  note_id TEXT,         -- noteRef
  capture_id TEXT,      -- exhibitRef
  FOREIGN KEY (brief_id) REFERENCES briefs(id) ON DELETE CASCADE,
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE SET NULL,
  FOREIGN KEY (capture_id) REFERENCES captures(id) ON DELETE SET NULL
);
```

`ON DELETE SET NULL` rather than CASCADE is deliberate: a block whose referent was deleted must survive as a visible gap, not vanish from the argument.

## Rendering and export

The report renderer already models a document as an ordered registry of typed modules that each render or decline (`REPORT_MODULES`, `ReportModuleId`, `DEFAULT_REPORT_MODULES` in `src/main/services/reportHtml.ts`). **An authored report is that registry plus the brief's blocks.** No second document system is needed.

Concretely:

- New module ids: `briefBody` (the authored spine) and `exhibitAppendix` (replacing `exhibits` when a brief is present).
- `briefBody` renders blocks in order, resolving `noteRef` and `quoteRef` at render time.
- `exhibitAppendix` renders the full exhibit plate — all provenance, digests, trusted-time basis — for each promoted capture, exactly as `exhibits` does today.
- Inline `captureRef` renders as "Exhibit N" with the number derived from the appendix ordering.
- `quoteRef` re-resolves its anchor and compares the quoted text against the stored text. Match renders normally; mismatch renders the discrepancy.

Rendering runs in the main process with no DOM, using `@tiptap/static-renderer` (`renderToHTMLString` with custom `nodeMapping`) per the adopted assessment in `docs/specs/2026-07-24-tiptap-dependency-assessment.md`.

### Scope section becomes computed

`scope` is currently a static string literal. With authored content it must state where operator narrative appears and that the tool attests only to the exhibit appendix. Derived from the brief, not hand-written — a static scope statement is precisely the thing that drifted three times in PR #216.

### Denominator disclosure

The brief states how many captures the case holds against how many are exhibited. Curation is an argument; disclosing its extent is cheap and converts the feature's main vulnerability into a credibility point.

### Provenance rendering is an output profile

Provenance always exists in the model. How loudly it renders is a property of the export profile — a court-facing profile surfaces it structurally, a client-facing profile renders it quietly. The data is invariant; the presentation is a choice. This keeps a persuasive document from reading as defensive without weakening what the artifact records.

Note: `ExportDialog.tsx:19` hardcodes `format = 'zip'`, so the `'html'` and `'pdf'` branches of `ExportOptions` are not reachable from the UI today. Any profile selection must be added to that dialog, not assumed present.

## UI

- **Notes surface** (`src/renderer/components/notes/`) — replaces the four current components. Note composer with an anchor picker; anchor creation from the capture viewer (select text → note; drag region → note) and from selector/data views.
- **Brief surface** — a new area under the case workspace. Two panes: available notes and captures on one side, the ordered brief on the other. Blocks reorder by drag; narrative blocks edit inline.
- Both use existing semantic theme tokens. No new design language.

## Testing

Unit tests in `tests/`:

- Anchor resolution: exact hit, offset repair, context match, and unresolvable — asserting the unresolved case renders the gap rather than degrading.
- Round-trip: note JSON → `generateText` → `body` matches what FTS indexes.
- Exhibit numbering: reordering `exhibitRef` blocks renumbers every inline `captureRef`, with no stored number anywhere.
- Quote integrity: a `quoteRef` whose stored text no longer matches the capture renders the discrepancy.
- Provenance: every rendered block carries a provenance value; no block defaults silently.

**One invariant test, covering the class rather than instances:** for every file path and every evidentiary claim the rendered report emits, assert the referent exists in the export. PR #216 needed three review rounds because each instance was fixed individually. This test is the structural fix and should be written before the authoring layer, against the current renderer.

## Phasing

This is too large for one implementation plan. Four, each independently shippable and each leaving the app working:

**Phase 0 — the invariant test.** Written against the current renderer, before anything else: for every file path and evidentiary claim `report.html` emits, assert the referent exists in the export. No new features. This is the structural fix for the class of defect that cost PR #216 three review rounds, and it must exist before an authoring layer starts adding claims.

**Phase 1 — rich-text notes.** Tiptap adoption, `notes.body_doc`, main-process `generateText` deriving `body`, the notes UI replaced. No anchors beyond the existing capture link, no brief. Ships a better notes feature on its own.

**Phase 2 — anchors.** `anchor_kind` / `anchor_json`, the resolution algorithm, anchor creation from the capture viewer and the data/selector views, unresolved-anchor rendering. Notes become anchored; still no brief.

**Phase 3 — the brief.** `briefs` / `brief_blocks`, the curation UI, `briefBody` and `exhibitAppendix` modules, computed scope, denominator disclosure, provenance rendering profiles.

Phases 1 and 2 could merge if the anchor work proves small, but Phase 0 must come first and Phase 3 must come last.

## Dependencies

Tiptap is assessed and recommended but **not installed** — `package.json` contains no `tiptap` entry. Adding `@tiptap/react`, `@tiptap/core`, `@tiptap/pm`, `@tiptap/starter-kit` and `@tiptap/static-renderer` requires explicit approval before any implementation begins.

## Out of scope for v1

- Cross-case briefs. Single case only.
- Brief templates and reusable section libraries.
- Collaborative editing, comments, version history — all paid Tiptap tiers, all avoidable.
- DOCX export.
- Automatic suggestion of which notes belong in a brief.

## Open questions

1. Does a note belong to exactly one case, or can it reference captures across cases? Current schema says one case; anchoring to a `finding` may want otherwise.
2. When a capture is superseded by a recapture, do notes anchored to the original follow, stay, or fork? Recapture already links siblings (`supersedesCaptureId`), so the information exists.
3. Should a brief be exportable standalone, or only as part of an evidence package? The standalone HTML path exists in code but is not user-reachable.
