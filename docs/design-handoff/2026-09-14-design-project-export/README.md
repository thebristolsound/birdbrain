# Birdbrain design project export, received 2026-09-14

This folder is the complete export of the claude.ai/design project that produces the
Birdbrain mocks: 120 files, unzipped byte-faithfully, plus `Birdbrain.html`, a packed
self-contained render of the live mock received in the same minute. This README is the only
file added. Everything else is as received.

Whether the live mock here replaces the 2026-08-21 standalone as the single design source
awaits a maintainer ruling. Until then the 2026-08-21 file keeps that role.

## How to open it

Open `Birdbrain.dc.html` from this folder. It resolves `support.js`, the `_ds/` stylesheets
and fonts, and the image assets by relative path, so the folder must stay intact. Verified on
2026-09-14 with headless Chrome: the runtime executed, the design-system tokens and fonts
applied, the logo rendered, and the tour card appeared over the Dashboard.

`Birdbrain.html` renders alone. It is the packed form of `Birdbrain.dc.html`: same view-model
script and props, asset references replaced by manifest UUIDs, one `data-comment-anchor`
attribute retained, and a 481 KB JPEG embedded in place of the 1.7 MB PNG screenshot.

## What is in it

| Path | What it is |
| --- | --- |
| `Birdbrain.dc.html` | The live mock. Eleven screens, the same variant props and defaults as the 2026-08-21 standalone. |
| `Birdbrain.html` | Packed render of the live mock, received separately. |
| `Birdbrain-standalone.html` | Byte-identical to `../2026-08-21-birdbrain-standalone/Birdbrain-standalone.html`. |
| `_ds/birdbrain-ui-9632b0b0-024d-4a3c-94db-688afdd4768f/` | The code-synced "Birdbrain UI" design system: stylesheets, fonts, and its bundle script. `_ds_bundle.css` is byte-identical to the Tailwind block the 2026-08-21 standalone embeds. |
| `support.js` | The dc runtime, identical to the 2026-08-10 bundle's copy. |
| `src/renderer/assets/`, `pasted-1786076566546-0-msifvf7w-wjzq.png`, `captured-page-slim.jpg` | The images the live mock references. |
| `Birdbrain v2.dc.html`, `Birdbrain v2 (github sync).dc.html`, its `copy` | Two-screen explorations (Dashboard, Captures) with a two-value `density` prop. The `github sync` one carries the app's thumbnail colours and a capture details panel with chain of custody, Wayback Machine, and re-verify. The `copy` is byte-identical to it. Not the design source. |
| `Canvas.dc.html` | A storyboard canvas: the mention grammar as one flow, from a text selection in the capture viewer to a selector, the `@` and `#` popups, peek cards, and backlink footers. |
| `Mention Grammar.dc.html` | A mention-grammar prototype with `theme`, `watchDefault`, and `backfillDefault` props. |
| `Case Reviewer.dc.html` | Identical to the 2026-08-10 bundle's copy. |
| `HANDOFF.md`, `ENGINEERING_REVIEW.md`, `github.md` | Root prose. The first two match the V2 branch copies. `github.md` is newer: a 2026-09-03 entry records the changes made against the corrections register and the ones deliberately not made. |
| `design_handoff_birdbrain_prototype/` | The V2 bundle as on branch `prototype/design-handoff-2026-08`, including the prose the 2026-08-21 README said existed only there: `IMPLEMENTATION_GUIDE.md`, `MOTION.md`, `SESSION_HISTORY.md`, `style_sync_patch/SCREEN_NOTES.md`. Every Markdown file matches the branch copy. |
| `design_handoff_style_sync/` | The same content as `design_handoff_birdbrain_prototype/style_sync_patch/`. |
| `archive/` | Three superseded variants (Fable, Opus, pre-standardization 2026-08-08) and a README recording the consolidation decision. |
| `uploads/` | Files uploaded into the design project: copies of the feasibility assessment, an earlier `HANDOFF.md`, selection screenshots, 22 `draw-*.png` sketches, and pasted screenshots. |
| `screenshots/` | Three design-side check renders. |
| `CLAUDE.md` | The design project's own notes. It is a nested instruction file, so an agent working under this folder may load it. It carries no repository guidance. |
| `.thumbnail` | The project's WebP thumbnail. |

## How to read the live mock as text

Nothing is packed. Lines 9-3924 of `Birdbrain.dc.html` hold the `<x-dc>` markup and lines
3925-7179 the view-model script, in the ordinary `onClick`, `viewBox` and `<table>` forms.
The `data-props` attribute on the script tag is byte-identical to the 2026-08-21 file, so
that README's prop table and its `overviewVariant` warning apply unchanged.

To diff against the 2026-08-21 standalone, unpack its template with the snippet in that
folder's README, reverse the packer rewrites, then diff the `<x-dc>` body and the script
separately. The packer forms that README does not list (`sc-camel-on-mouse-down`,
`sc-camel-on-key-down`, `sc-camel-on-focus`, `sc-camel-on-blur`, `sc-camel-on-double-click`,
`sc-camel-on-mouse-enter`, `sc-camel-on-mouse-up`, `sc-camel-auto-focus`,
`sc-camel-preserve-aspect-ratio`, `sc-raw-tbody`) account for most of the raw diff and carry
no change.

## What changed since 2026-08-21

The design side's own record is the 2026-09-03 entry in `github.md`. Line numbers are into
`Birdbrain.dc.html`. App references are into the tree at `190ede83`.

| Screen | Change | Lines | In the app |
| --- | --- | --- | --- |
| Case Overview | The Quick notes card moves to the left column, over the Link map, outside the since-last-visit conditional. `github.md` records the placement as the user's own arrangement. | 643, 709 | Open. `CaseOverview.tsx:185-197` keeps it in the right column, unconditional. Only the column differs. |
| Case Overview | The Link map gets a designed empty state: icon tile, title, and body. Two copies: `No notes yet` and `No mentions yet`. | 678, 5179, 5344 | Open. `BacklinkMap.tsx:22-31` and `112-119` draw one line of undesigned copy, which #708 asked the design side to specify. |
| Case Overview | Lattice rows grow with the case: `max(8, notes, ceil(entities / 2))`, with even note spacing past three notes. | 5236 | Absorbed. `backlinkMapModel.ts:273` already does this (#762). |
| Signals | The exclusion list heading reads `Never capture in this case`. | 1833 | Absorbed. `AutoCaptureCard.tsx:163`. |
| Signals | The exclusion footer uses a live entry count with a plural, points at Settings -> Capture Preferences, and names every capture route. The seed count is 7. | 4565, 5164 | Absorbed. `signalsModel.ts:164-172` is word-for-word the same. |
| Signals | The detail rail count label reads `Matches N of K captures` or `Applied to N of K captures`. | 5818 | Absorbed. `signalsModel.ts:181-185`. |
| Data | The `network.har` rows, the `verify.missing` ledger event and the `.har` icon mapping leave the seed data. | script | Absorbed. The app never had HAR files; #804 owns the question. |
| Case Overview | The metric count-up settles after `900ms` when the browser throttles animation frames. | 4453 | Mock only. The app has no count-up. |
| Signals | A `data-comment-anchor` attribute leaves the create-selector form. Three remain elsewhere. | 367, 1083, 1116 | Mock only. Design-tool annotation. |

`github.md` also records one correction deliberately not applied: the capture-row
multi-select checkbox stays out of the mock as a standing design decision, while the app keeps
it for test coverage. That is a live design-versus-engineering conflict, not an oversight.

## What #708 asked for and this file does not answer

#708 was closed on 2026-09-14 by the stale-issue workflow, not by a ruling. This export
answers items 1, 2, 11 and 12 of its body, the #400 count-label entry, the #402 conditional
entry and the HAR entry from the 2026-08-30 comment. Everything else on it stands: the
Mention suggestion slice (3), the tour completion flag and null anchor (4, 5), the
broken-Mention chip (6), the options page states (7), the `--d-row` successor (8), the
capture-row checkbox (9), the Evidence-integrity card (10), the extension mono font (13) and
the Browser button and demo case (14). `github.md` says the rest of the corrections brief
(`docs/specs/2026-08-23-standalone-mock-corrections-brief.md`) waits for a directed design
pass.

## Do not edit

Corrections go back to the design side, never into these files. Send the constraint, not a
redesign.
