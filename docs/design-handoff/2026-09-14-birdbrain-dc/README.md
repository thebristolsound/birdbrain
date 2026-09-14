# Birdbrain mock, received 2026-09-14

`Birdbrain.dc.html` is the Claude Design export received on 2026-09-14. It carries the same
eleven screens, the same template, and the same variant props and defaults as the 2026-08-21
standalone. The difference is a small set of changes that answer corrections recorded on #708.
The delta is listed below, each change marked with what the app already does.

Whether this file replaces the 2026-08-21 standalone as the single design source awaits a
maintainer ruling. The 2026-08-21 file stays the only one that renders on its own.

## How to open it

The file is not self-contained. It links four things that were not supplied with it:

- `./support.js`, the dc runtime. The copy in `2026-08-10-birdbrain-prototype/` is an older
  generation and is untested against this file.
- `_ds/birdbrain-ui-9632b0b0-024d-4a3c-94db-688afdd4768f/`, three stylesheets
  (`fonts/fonts.css`, `_ds_bundle.css`, `styles.css`) from the code-synced "Birdbrain UI"
  design project. The 2026-08-21 standalone embeds the equivalent CSS in its `<helmet>`,
  which is why it renders alone. Fetching them needs `/design-login` once from an
  interactive Claude Code session; the `DesignSync` tool can then read the project.
- `src/renderer/assets/logo.png` and `src/renderer/assets/extension-icon-48.png`, referenced
  relative to the repository root rather than to this folder.
- `./pasted-1786076566546-0-msifvf7w-wjzq.png`, the screenshot placeholder in the Captures
  viewer.

## How to read it as text

Nothing is packed. Lines 9-3924 hold the `<x-dc>` markup and lines 3925-7179 the view-model
script, in the ordinary `onClick`, `viewBox` and `<table>` forms. The `data-props` attribute
on the script tag declares the variant props; they are byte-identical to the 2026-08-21 file,
so that README's prop table and its `overviewVariant` warning apply unchanged.

To diff against the 2026-08-21 standalone, unpack its template with the snippet in that
folder's README, reverse the packer rewrites in its table, then diff the `<x-dc>` body and
the script separately. The remaining packer forms that table does not list
(`sc-camel-on-mouse-down`, `sc-camel-on-key-down`, `sc-camel-on-focus`, `sc-camel-on-blur`,
`sc-camel-on-double-click`, `sc-camel-on-mouse-enter`, `sc-camel-on-mouse-up`,
`sc-camel-auto-focus`, `sc-camel-preserve-aspect-ratio`, `sc-raw-tbody`) account for most of
the raw diff and carry no change.

## What changed since 2026-08-21

Line numbers are into `Birdbrain.dc.html`. App references are into the tree at `190ede83`.

| Screen | Change | Lines | In the app |
| --- | --- | --- | --- |
| Case Overview | The Quick notes card moves to the left column, over the Link map, outside the since-last-visit conditional. The 2026-08-21 file kept it in the right column inside that conditional, which #708 reported. | 643, 709 | Open. `CaseOverview.tsx:185-197` keeps it in the right column, unconditional. Only the column differs. |
| Case Overview | The Link map gets a designed empty state: icon tile, title, and body. Two copies: `No notes yet` and `No mentions yet`. | 678, 5179, 5344 | Open. `BacklinkMap.tsx:22-31` and `112-119` draw one line of undesigned copy, which #708 asked the design side to specify. |
| Case Overview | Lattice rows grow with the case: `max(8, notes, ceil(entities / 2))`, with even note spacing past three notes. | 5236 | Absorbed. `backlinkMapModel.ts:273` already does this (#762). |
| Signals | The exclusion list heading reads `Never capture in this case`. | 1833 | Absorbed. `AutoCaptureCard.tsx:163`. |
| Signals | The exclusion footer uses a live entry count with a plural, points at Settings -> Capture Preferences, and names every capture route. The seed count is 7. | 4565, 5164 | Absorbed. `signalsModel.ts:164-172` is word-for-word the same. |
| Signals | The detail rail count label reads `Matches N of K captures` or `Applied to N of K captures`. | 5818 | Absorbed. `signalsModel.ts:181-185`. |
| Data | The `network.har` rows, the `verify.missing` ledger event and the `.har` icon mapping leave the seed data. | script | Absorbed. The app never had HAR files; #804 owns the question. |
| Case Overview | The metric count-up settles after `900ms` when the browser throttles animation frames. | 4453 | Mock only. The app has no count-up. |
| Signals | A `data-comment-anchor` attribute leaves the create-selector form. Three remain elsewhere. | 367, 1083, 1116 | Mock only. Design-tool annotation. |

## What #708 asked for and this file does not answer

#708 was closed on 2026-09-14 by the stale-issue workflow, not by a ruling, and its last
intake note said it closes when the list reaches the design side. This file answers items
1, 2, 11 and 12 of its body, the #400 count-label entry, the #402 conditional entry and the
HAR entry from the 2026-08-30 comment. Everything else on it stands: the Mention
suggestion slice (3), the tour completion flag and null anchor (4, 5), the broken-Mention chip
(6), the options page states (7), the `--d-row` successor (8), the capture-row checkbox (9),
the Evidence-integrity card (10), the extension mono font (13) and the Browser button and
demo case (14).

## Do not edit

Corrections go back to the design side, never into this file. Send the constraint, not a
redesign.
