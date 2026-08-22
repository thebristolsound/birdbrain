# Birdbrain standalone mock, received 2026-08-21

`Birdbrain-standalone.html` is the **single design source** for the redesign program
(spec #382), by maintainer ruling on 2026-08-21. It supersedes the two earlier bundles:

- `docs/design-handoff/2026-08-10-birdbrain-prototype/` in this repository (V1).
- `design_handoff_birdbrain_prototype/` on the `prototype/design-handoff-2026-08`
  branch (V2, commit `e967542e`).

Read this file for pixel truth and behaviour. Read the older bundles only for the prose
documents the standalone does not carry. The last section lists them.

## How to open it

Open the file in a browser. It is self-contained, so it needs no `support.js` beside it
and no network access. The file embeds its fonts as variable-weight `woff2` blobs.

## How to read it as text

The markup is not in the file literally. It ships packed as a JSON string inside
`<script type="__bundler/template">`, with assets addressed by UUID. To get the markup:

```python
import re, json
src = open('Birdbrain-standalone.html', encoding='utf-8', errors='replace').read()
tpl = json.loads(re.search(r'<script type="__bundler/template"[^>]*>(.*?)</script>', src, re.S).group(1))
open('template.html', 'w', encoding='utf-8').write(tpl)   # 16161 lines
```

The packer rewrites three things, so a grep for the ordinary form finds nothing:

| Ordinary form | In the packed template |
| --- | --- |
| `onClick`, `onChange`, `onContextMenu` | `sc-camel-on-click`, `sc-camel-on-change`, `sc-camel-on-context-menu` |
| `viewBox` | `sc-camel-view-box` |
| `<table>`, `<tr>`, `<td>` | `<sc-raw-table>`, `<sc-raw-tr>`, `<sc-raw-td>` |

Asset `src` and `href` values are 36-character UUIDs that resolve against the manifest in
`<script type="__bundler/manifest">`.

## Variant props: read this before you build anything

The mock is not one fixed design. It carries editable props, and the defaults are the
design. Build the defaults.

| Prop | Options | Default |
| --- | --- | --- |
| `overviewVariant` | `consolidated`, `classic` | **`consolidated`** |
| `density` | `compact`, `default`, `comfortable` | **`compact`** |
| `mentionStyle` | `chip`, `underline`, `bracket` | **`chip`** |

`overviewVariant` is the one that misleads. In the default `consolidated` value the sidebar
filters out the Selectors and Tags entries (template lines 13481-13482), and the Case
Overview renders no selector-coverage card (line 9859). The `classic` value restores both.
It is the arrangement the redesign replaces, kept for comparison.

So a reader who greps `navDefs` finds eight navigation entries including Selectors and
Tags, and concludes the design keeps three overlapping screens. It does not. The rendered
sidebar has six. I made exactly that mistake; #700 records it.

The remaining props are simulation states for screenshots: `extensionConnected`,
`sinceLastVisit`, `firstRun`, `tourOnLaunch`, `motion`, all defaulting to true.

## Screens

Eleven screens carry a `data-screen-label`: Dashboard, Case Overview, Captures, Selectors,
Notes, Signals, Tags, Data, Settings, New Case Wizard, Chrome Extension. The Selectors and
Tags screens are the `classic` branch. Under the default `consolidated` variant the Signals
screen replaces both, and #400 removes them.

## What this file does not carry

The V2 branch bundle holds prose the standalone has no equivalent for. Keep reading these
from the branch until the design side supplies replacements:

- `HANDOFF.md`, the session-by-session change log and ruling record.
- `MOTION.md`, durations, easing and the reduce-motion switches.
- `IMPLEMENTATION_GUIDE.md`, the recommended build order.
- `ENGINEERING_REVIEW.md`, the feasibility checklist and round-trip protocol.
- `style_sync_patch/SCREEN_NOTES.md`, per-screen token notes.
- `github.md`, the screen-to-source-file map.

## Do not edit

Corrections go back to the design side, never into this file. Send the constraint, not a
redesign.
