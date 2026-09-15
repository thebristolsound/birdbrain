# Birdbrain — session handoff

Live file: `Birdbrain.dc.html`. Design authority: `Case Reviewer.dc.html`.
Bound design system: BirdbrainUI (`_ds/birdbrain-ui-9632b0b0-…`).

## Where things stand

### Done this session

**File consolidation.** `Birdbrain.dc.html` was already a strict superset of the
Fable and Opus variants. Both moved to `archive/` with a README recording the
diff; the byte-identical `Opus copy` was deleted. The one decision not carried
forward is documented there: Opus framed the archive.org panel as performing an
automated diff, which Fable corrected to "Birdbrain doesn't diff the two". The
live file uses Fable's honest framing.

**Notes screen.** Sort + filter toolbar matching the Capture viewer (Newest /
Oldest / Title A–Z; filter by tag and date). Empty states for both
filtered-to-nothing and first-run, with a Clear filters action. Wired the search
field. Footer count is now dynamic.

**Mention rendering.** Fixed a misfire where a completed `#[tag|phishing]` token
at the end of a note body was read as an in-progress mention query, leaving the
autocomplete popup stuck open. Completed tokens are now masked before the
trailing-query scan. Note-list snippets route through `noteSnippet()` so they
honour the `mentionStyle` tweak instead of leaking raw storage syntax.

**Data screen context menus.** Added `folder`, `part`, and `ledger` kinds to the
existing `ctxRootItems` system and wired `onContextMenu` onto tree nodes, MHTML
part rows, and ledger entries.

**Captures screen.** Removed the Source tab entirely (Page is the MHTML file) —
tabs are now Screenshot / Page / Text / Wayback. The capture list column is
hidden when Wayback is active, so the two stacked list columns no longer compete.

**Density.** Three steps (compact / default / comfortable) driven from the root
element, scaling padding, row heights, and gaps: `--d-pad`, `--d-gap`, `--d-card`,
`--d-cardsm`, `--d-metric`, `--d-row`, `--d-rowpad`, `--d-head`, `--d-itemy`,
`--d-itemx`, `--d-tree`, `--d-listgap`. `--d-r` is pinned at 6px — radius is not
a density concern.

**Multiselect.** Checkbox fades in on row hover and stays once anything is
checked. Row click selects and the detail pane follows; ⌘-click toggles;
shift-click extends a range from the anchor, from either the row body or the
checkbox. Select-all checkbox in the batch bar, ⌘A for everything in the current
filter, Escape clears. Selection survives filter changes and navigation. The
sort/filter toolbar transforms in place into the batch bar (Export / Tag /
Delete / Clear). Helpers: `multiIds`, `setMultiIds`, `clearMulti`,
`allSelected`, `toggleSelectAll`, `rowSelect`.

**Export.** Three presets — Full evidence bundle, Working copy, Court exhibit
(everything except analyst notes) — over an eight-item custom list that
auto-detects which preset is active and expands when the selection is custom.
Scope row reflects whether you are exporting the case or the current selection.
Chain-of-custody cover sheet carries all nine agreed fields plus a free-text
purpose input and signature/date rules.

### Still open

1. **Standardization pass** across Overview, Selectors, Tags, Signals,
   Extension, New Case, Settings. Deliver all seven, then review.
2. **Monospace cleanup** — forensic exception applies: mono survives for hashes,
   hex, and raw source; everything else loses it.
3. **Context-menu audit** on the remaining screens. Scope is broad: anything
   that looks like a row, including read-only metadata.
4. **Empty-state audit** across every list and table.
5. **Dashboard** — what fills the space below the case grid on ultrawide is
   still undecided.

## Agreed design system

Compact 12px base. Sharp radii: 2 / 4 / 6px, with pills reserved for status.
Five-step type scale: 10 / 11 / 12 / 14 / 18. Surfaces separate using both
borders and backgrounds. Monospace only for machine output as above.

## Other files

`Birdbrain v2.dc.html` — standardized sample of Dashboard + Captures.
`Birdbrain v2 (github sync).dc.html` — snapshot of the reverted upstream sync
(thebristolsound/birdbrain 1.0.1-beta.17), kept only for parts salvage.
`archive/` — superseded Fable and Opus variants.
