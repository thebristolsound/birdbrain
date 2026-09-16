# Archived variants

Superseded copies, kept for reference only. The live document is
`../Birdbrain.dc.html`.

## What was here

| File | Status |
| --- | --- |
| `Birdbrain - Fable.dc.html` | Superseded — all decisions present in `Birdbrain.dc.html` |
| `Birdbrain - Opus.dc.html` | Superseded — all decisions present except one (below) |
| `Birdbrain - Opus copy.dc.html` | Deleted — byte-identical to `Birdbrain - Opus.dc.html` |

## Consolidation notes

`Birdbrain.dc.html` was already a strict superset of both variants. It carries,
uniquely:

- `<sc-if>` guards around every dynamic-icon `<svg>`, so icons don't render
  broken during streaming (~30 sites).
- Pinned Wayback snapshots surfaced in the export appendix
  (`expHasPins` / `expPins`), with the note "Included as archive.org references
  in the report appendix."
- Case scoped to 8 captures rather than 12 ("Chain intact · 8 of 8 verified").
- `mentionStyle` default of `bracket` (Opus/Fable defaulted to `underline`).

Tweakable props are identical across all three files.

## The one decision NOT carried forward

Opus framed the archive.org panel as if Birdbrain performs an automated diff:

> Snapshot corroborates your capture — page structure matches · 2 differences in
> embedded resources

…with per-row `differs` markers on form action, kit build, and tracking px.

Fable replaced this with the honest framing, which is what `Birdbrain.dc.html`
now carries:

> Side-by-side reference — archive.org's copy renders independently.
> Corroboration is your call; Birdbrain doesn't diff the two.

This was a deliberate correction, not an omission: the product does not compare
the two captures, and claiming otherwise in a forensic tool is a defensibility
problem. Opus's copy is preserved above should the capability ever ship.
