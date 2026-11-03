# Handoff spec: launched browser Capture Session, Withheld from analysis mark, "not read" count

Date: 2026-11-01. Mock: `Launched Browser.dc.html` (pieces `1a` to `1z` revised, `2a` to `2g`
added). Brief: `docs/specs/2026-11-01-launched-browser-revision-ui-brief.md`. Verdicts and
constraints per row: `ENGINEERING_REVIEW.md`. Stack: Electron, React 19, TanStack Router, the
app's `globals.css` tokens. This spec names tokens, not values, except in the token table, which
restates the app's values for the three triples the bundled stylesheet lacks.

Build order (the brief's): launcher step (#1831), then clicked-Capture step (#1832), then Persona
step (#1833), then the investigation items. Each section below says which step owns it.

## Overview

An Operator opens a Chromium-family browser from Birdbrain, browses in it, and takes Captures
that carry a Transaction Record and Bound TLS Details when the tab was recorded from its first
request. Birdbrain shows the running Capture Session in a panel (a rail on Case screens, a popover
elsewhere, or a popped-out window), names the browser the same way everywhere ("Launched Chrome ·
Harbor Desk"), and tells the Operator what a Capture will lack before the click. Two
investigation-view items ride along: the Withheld from analysis mark on search and data rows, and
the "not read" count with its breakdown and list.

Nothing here promises what Birdbrain cannot check: a page in the launched browser can tell it is
driven by software; the Egress hides where the Operator is, not what browser is looking; the no-VPN
check sees the machine's path, not the browser's; a shortcut may register without Birdbrain
knowing it failed.

## Layout

The shell is the app's, measured in the brief; this feature adds no new chrome metric.

| Region | Measure | Note |
|---|---|---|
| Window | min 900 × 600, opens 1200 × 800 | |
| Top bar | 48 px | Case: logo, breadcrumb, search, REC (while a Capture Session runs), Share pill, extension status, capture health, Export, Settings (24 px), theme (24 px). Settings: logo, Return to Birdbrain, switch, REC, theme. Dashboard and Settings gain a **Capture Session** button while a launched browser is open (`2c`, `2d`). |
| Side rail | 48 px | Case screens only. |
| Case action bar | 40 px, right-aligned | Renders whenever a Case is open (change from today, `2b`). Holds **Launch browser** and, while anything is running, the Capture Session switch. |
| Captures screen | list 240 to 560 · 7 px separator · viewer ≥ 360 · 7 px · details 320 to 680 | Side columns fold to a 40 px strip with no separator. Details folds when the window is narrower than 1,100 (window rule). |
| Capture Session rail | 320 px, right edge, full height under the action bar | Docks only when it fits (see Responsive behavior). |
| Capture Session strip | 40 px, no separator | The rail's folded form (`2a`). |
| Capture Session popover | 300 px, anchored under the top-bar button | Dashboard and Settings (`2c`, `2d`). |
| Pop-out window | 300 px wide, content height (about 190 px) | A second Birdbrain window, ordinary z-order (`1g`). |
| Start dialog | 440 px centered overlay | Header, title, description, 96 px label column, footer (`1b`). |

Spacing inside the panel: 12 px horizontal padding, 10 px section padding, 6 px between rows,
8 px between controls on a line. Chips and controls follow the app's control metric: 28 px tall,
4 px radius, 12 px text; dense panel controls use the 24 px and 22 px heights drawn.

## Design tokens used

Surfaces, text, accent and border tokens come from the bundled stylesheet. The status triples and
member hues are the app's (`src/renderer/styles/globals.css`); the mock defines them locally
because `birdbrain-ui` 1.0.1-beta.11 lacks them. Add no others.

| Token | Value (light / dark) | Usage here |
|---|---|---|
| `color-canvas`, `color-surface`, `color-card`, `color-elevated` | bundle | Window, panel/strip/rail background, cards and rows, search dropdown |
| `color-text-primary` / `-secondary` / `-muted` / `-faint` | bundle | Titles / body / helper lines / eyebrows and placeholders |
| `color-border`, `color-border-strong` | bundle | Dividers and cards / control outlines, chips, the dotted mark outline |
| `color-accent`, `color-accent-hover`, `color-accent-subtle` | bundle | Capture button, links, focus ring, selected tab row, pop-out title bar tint, Capture Session button outline |
| `color-success-surface` / `-line` / `-fg` | rgba(16,185,129,.10) / .20 / `#047857` · `#34d399` | Extension connection dot, capture health dot, checklist ✓ |
| `color-warning-surface` / `-line` / `-fg` | rgba(245,158,11,.10) / .20 / `#92400e` · `#fbbf24` | No-VPN line, extension warning, left-browser notice, Capture abandoned, extension-Capture notice, feasibility labels |
| `color-danger-surface` / `-line` / `-fg` | rgba(239,68,68,.10) / .20 / `#b91c1c` · `#f87171` | REC pill and dots, launch refusals, crashed tab, "too old", Port mode |
| `color-member-1`, `color-member-2` | `#0284c7` · `#38bdf8`, `#b45309` · `#fbbf24` | Member Codes NK and MB in marks and the Share pill (15% fill, 30% line as the app's Member Code chip) |
| `font-display` (Inter) | 14 px/600 dialog titles; 12 px/600 panel heading; 10 px/600 uppercase eyebrows | |
| `font-body` (Inter) | 12 px controls, inputs, card titles; 11 px panel body and helper lines; 10 px dense data | Weights 400, 500, 600 only |
| `font-mono` (JetBrains Mono) | 10 px chips, Exhibit Numbers, URLs, the shortcut key, Member Codes; 11 px versions and hashes | |
| Radius | 2 (highlight spans), 4 (controls, chips, rows, strip buttons), 6 (cards, dialogs, popover, pop-out) | `rounded-full` only on pills (REC, Share, connection), the Badge, dots, and the switch |
| Shadow | `shadow-overlay` dialogs, popover, pop-out; `shadow-card` the window frame in the mock only | |
| Focus | 2 px ring, 2 px offset, `color-accent` | Every control, strip buttons and chips with actions included |

## Components

| Component | Where | Props / variants | Notes |
|---|---|---|---|
| Found-browser row | `1a` | `product`, `version?`, `state: not-launched \| from-last-launch \| too-old`, `selected` | Radio. No version until a launch; "from its last launch" after; "too old" disables the radio and colours the label `danger-fg`. |
| Start dialog | `1b`, `1c`, `1d`, `1e`, `1j` | `mode: start \| join`, `browser`, `persona` (#1833), `withoutClick` (#600), `egress` (read-only), `operator`, `refusal?`, `checklist?` | Footer line differs by mode ("Starts a Capture Session in ‹Case›" / "Joins the running Capture Session in ‹Case›"). Refusals are `danger-fg` left-rule cards inside the dialog; state 4 adds **Show panel**. |
| No-VPN line | `1c` | `seen: boolean` | Shown only while the Egress is Direct. Warning triple. Text is the placeholder until #1696 ships; engineering swaps in that warning's wording. |
| Capture Session panel | `1f`, popover `2c`/`2d`, pop-out `1g` | `form: rail \| strip \| overlay \| popover \| window`, `browser`, `persona?`, `egress`, `elapsed`, `caseName`, `count`, `target`, `tabs[]`, `lastExhibit?` | One component, five forms. Header, capture target, tab list (not in popover or window), footer with the last Exhibit Number. |
| Capture target | panel | `title`, `url`, `browserName`, `persona?`, `window`, `tab`, `scrollToLoad` | Third line reads "Launched Chrome · Harbor Desk · window 1, tab 2". Scroll to load off by default, per Capture. |
| Tab row | panel, `1k` | `title`, `url`, `firstRequest: boolean`, `kind: page \| private \| settings \| crashed`, `capturedAs?`, `matchesNow[]?` | Chip "from first request" (mono, `border-strong`, 4 px) or the muted label "not from first request" with the tooltip. Private and settings rows are dotted and muted with no action; crashed row uses the danger triple and keeps "Reload it in the browser, then capture." |
| Capture Session strip | `2a` | same data as panel | 40 px: expand ‹, REC dot, Capture (28 px accent square), tab count, last Exhibit Number (vertical). |
| Pop-out window | `1g` | panel data | Title bar: 2 px `color-accent` top rule, `accent-subtle` fill, REC dot, "Birdbrain · ‹Case› · Capture Session", **Dock**. OS window title is the same string. |
| Pop-out stub | `1g` | | In the main window where the rail was: REC dot, "Panel popped out", **Show window**, **Dock**. |
| Capture Session top-bar button | `2c`, `2d` | `open` | 24 px, `color-accent` outline; `accent-subtle` fill while the popover is open. |
| Capture Session switch | `1i`, action bar, Settings top bar | `sources: extension \| launched \| both` | `rounded-full` as in the app. Source line names what is running ("Launched Chrome · Harbor Desk, and the extension"). Turning it off opens the stop confirmation. |
| Shortcut line | `1r`, beside Capture in `1f` | `state: unknown \| failed` | `unknown`: key in mono, muted, "Try the shortcut…"; `failed`: key struck, dotted card, "This desktop refused the shortcut." Both name the Capture button. Never a "working" state. |
| Tab picker | `1r` | `tabs[]` | Dialog; opens when the shortcut or the strip's Capture has more than one eligible tab, or none. Numbered rows, first highlighted. |
| Extension warning | `1m` | `name?` | Warning left-rule card; third mono line "the browser calls it: ‹name›" only when `name` is present. Shown only while the Egress is not Direct. |
| Withheld mark | `1u` to `1x` | `holders: your \| byYouAnd(code) \| by(code) \| byRevoked(code)`, `dense: boolean` | ⊘ + words + holders, 1 px dotted `border-strong`, 4 px radius, 10 px text. Dense: "Withheld · …" with the full words as `title` and `aria-label`. New component; the Badge has no dotted variant. Match the investigation run setup row's dotted chip. |
| Not-read breakdown | `1y` | `rows: {count, kind, reason}[]` | Popover under the header count; reasons are causes, not remedies. |
| Not-read sheet | `2g` | `rows: {number, title, kind, reason, target}[]` | Sheet under the gap list. Row target by kind (see States). |

## States and interactions

| Element | State | Behavior |
|---|---|---|
| **Launch browser** (action bar) | Default | Opens the start dialog. |
| | Disabled | While a launched browser is open; `title` "A launched browser is already open" (`1f`). |
| Start dialog **Launch** | Disabled | Operator name not set (`1d`); **Set operator name** opens Settings → Operator. |
| | Launching | Dialog becomes the checklist (`1e`): Browser started, Egress reachable, connection check on the first tab, Show the window; **Cancel** underlined. Window stays hidden until the checks pass. |
| | Refused | States 1 to 4 replace the checklist (`1j`). State 3 names the Egress label and points to Settings → Operator. |
| Panel **Capture** | Default | Takes the capture target; progress bar (4 px, `color-accent`) replaces the target line (`1l`), then the Exhibit Number row "NK-12 · Captured". |
| | Abandoned | Warning card "Capture abandoned · The page changed mid-capture; try again." Also an activity-feed event of its own kind. |
| Panel **Stop…** / switch off | Confirm | "Stop the Capture Session?" with **Keep running** / **Stop and close browser**; line names the browser and the kept count (`1i`). Stopping from the switch stops the extension's Captures too. |
| **Pop out** / **Dock** | Toggle | Rail ↔ window; the main window shows the stub while popped out. |
| Strip ‹ | Expand | Opens the panel as a 320 px overlay over the viewer; Escape or an outside click closes it; no reflow. |
| **Show window** (stub) | Click | Raises the pop-out where the platform allows; engineering checks Wayland in the launcher step. |
| Tab row | Selected target | `color-accent` border, `accent-subtle` fill. |
| | Hover | Border to `border-strong`; flat, no lift. |
| Shortcut | Pressed, one eligible tab | Captures it. More than one or none: tab picker. |
| Browser closed | Session running | Panel body becomes `1n`: "Launched Chrome closed. The Capture Session keeps running until you stop it." **Launch again…** / **Stop Capture Session**. |
| Egress check fails | Ended | `1o` state 11 in the panel; Captures kept. State 12 before the window shows. |
| Old browser found | Before launch | `1p` (Persona named) or `2f` (throwaway, no Persona); **Check again**. |
| Settings → Operator, Egress change | Confirm | `1q` state 14 dialog over the Egress block; **End and change**. |
| Settings → Personas, delete | Blocked | `1q` state 15; **End Capture Session…**. |
| Passive rule (after #600) | Change from panel | Select in the panel; each change logs to the activity feed (`1s`). |
| Withheld mark on a search row | Click row | Opens the hit on the Text or Links tab, highlighted; the mark itself has no action. |
| **Clear my flag** (Exhibit header, `1w`) | Click | No confirmation; writes a clear row. The run-out-of-date banner covers the consequence. |
| **Clear MB's flag…** (`1x`) | Click | Confirmation, because it writes a row in a revoked member's name. |
| "4 not read" (`1y`) | Click | Opens the breakdown popover. |
| **Show them** / "Show the 4 Exhibits" | Click | Opens the sheet (`2g`). A Capture row opens Captures with that Capture selected, Text tab. A `document` or `attachment` row opens the Exhibit's properties on the Data screen until a viewer for that kind exists. |

## Responsive behavior

The rail docks only where the window has room for the Captures screen's minimums plus 320 px.

| Window width | Captures screen | Capture Session panel |
|---|---|---|
| 900 to about 1,020 | Details folded (window rule); minimums 695 | Strip, 40 px |
| About 1,020 to 1,100 | Details folded | Rail, 320 px |
| 1,100 to about 1,300 | Details docks again; minimums 982 | Strip, 40 px, unless the fold change below lands |
| About 1,300 and up | Docked | Rail, 320 px |
| Any width, no Capture selected | Details hidden; minimums 655 | Rail from about 980 |
| Dashboard, Settings, new-Case wizard | No side rail or action bar (wizard has the rail, disabled) | Top-bar button and popover; no rail |

Build change requested (answer 1): make the details panel's fold read the room left beside the
rail instead of the window's width. With it, the 1,100 to about 1,300 band docks the rail and folds
the details panel, and the strip is needed only below about 1,020.

Other screens with a side rail (Overview, Notes, Signals, Data) have no measured minimums in the
brief; dock the rail where the screen's own minimums plus 320 fit, else the strip.

## Content specifications

- Tab titles and URLs truncate with an ellipsis on one line; the URL line is mono 10 px. Capture
  target title likewise. Case names in the pop-out title bar truncate before "Capture Session".
- The capture target's third line is fixed-form: "‹browser name› · ‹Persona› · window ‹n›, tab
  ‹n›"; with no Persona, "Launched Chrome · window 1, tab 2".
- Exhibit Numbers print as the app does: bare while the Case has one member, with the Member Code
  once it has more (`12`, `NK-12`), never with an `E-` prefix.
- Counts in the panel header read "Into ‹Case› · ‹n› Captures so far"; elapsed time mono mm:ss.
- Empty tab list (all windows closed, browser still running): keep the header and the Capture
  Session controls; the tab list region reads "No tabs open" in `text-muted`. Browser closed is
  state 10, not this.
- Loading: the checklist (`1e`) is the loading state for launch; the progress bar (`1l`) for a
  Capture. No spinners elsewhere.
- Errors: every refusal and failure is a left-rule card in the danger or warning triple with a
  title and one plain line, as drawn; no toasts for launch failures, because the dialog is open.
- Long strings: the panel is 320 px; a wider header line wraps (`flex-wrap`) rather than
  truncating, because the browser, Persona and Egress names all carry meaning.

## Edge cases

- Ctrl-click or middle-click tab: its first page shows "not from first request" with no reload
  advice; the tooltip names no cause. A later page in the same tab can carry the chip.
- Page a service worker serves: in the record with no remote endpoint; the inventory counts it.
  Never worded as missing (ruling 3, pending PR #2033).
- Throwaway browser profile: start dialog note "With none, Birdbrain deletes the browser profile
  afterwards."; the left-behind variant names no Persona (`2f`); whether **Launch again…** reuses
  the profile within one Capture Session is engineering's.
- Extension Capture while a launched browser is open: the notice in `1h`, warning triple,
  Birdbrain side only.
- Egress not Direct and an extension appears: the warning (`1m`); Captures continue.
- Port mode (only if built): header badge "Port mode" for the whole Capture Session; `1t`.
- Two tabs on the same page title: the tab picker numbers rows, and rows carry the URL.
- Shared Case with a revoked member's flag: Owner may clear it with confirmation; recorded as the
  Owner's action.
- Not-read list where an Exhibit kind has no viewer: Properties target, as `2g`.

## Animation and motion

Flat, per the token rules: no glow, no lifted hover. Hover is a border or fill change with no
transition longer than the app's control transition. Popover and overlay: fade in over the app's
overlay duration, none on close. Progress bar: width animates with the Capture's reported
progress; indeterminate shows a 60% bar moving, as the app's other progress bars do. The strip's
expand and the rail's fold do not animate width; they switch at the breakpoint.

## Accessibility notes

- Focus order in the panel: Pop out, Stop…, Scroll to load, Capture, then tab rows top to bottom,
  then the tab picker when it opens. In the strip: expand, Capture, then the main content.
- The pop-out window is a real window with the OS title "Birdbrain · ‹Case› · Capture Session",
  so window switchers and screen readers name it without the tint.
- Tooltips (the canvas's "i" markers) are design annotation; in the build, each becomes the
  control's `title` or a described-by line, never the only place a limit is stated. The visible
  line already carries each limit.
- The Withheld mark: dense form has `aria-label` "Withheld from analysis · by you and MB"; the
  glyph is decorative (`aria-hidden`). The dotted outline is decoration and never the only cue.
- The "from first request" chip is text, not colour; "not from first request" is text, not a
  colour change.
- REC pill: `aria-live="polite"` announcement when a Capture Session starts and stops ("Capture
  Session started in Ferry Line, Launched Chrome"), and when an Exhibit Number is assigned.
- Launch refusals and the no-VPN line: `role="status"`; they do not steal focus.
- Keyboard: Escape closes the overlay, popover, tab picker and dialogs; Enter runs the highlighted
  tab-picker row; the shortcut itself is engineering's key, and the Capture button is reachable by
  Tab in every form of the panel.
- Contrast: all status text uses the `-fg` tokens on `-surface` tints, which meet AA in both
  themes per the app's token rules; `border-strong` outlines are not relied on for meaning.
