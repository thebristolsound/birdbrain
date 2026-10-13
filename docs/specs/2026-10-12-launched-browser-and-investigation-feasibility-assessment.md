# Launched browser and investigation mock feasibility assessment

Date: 2026-10-12
Reviews:
[`docs/design-handoff/2026-10-12-launched-browser/`](../design-handoff/2026-10-12-launched-browser/),
the canvas mock `Launched Browser.dc.html` (pieces 1a to 1z) and the six surfaces and 22 states
of its `ENGINEERING_REVIEW.md`.
Contract: the [launched browser and Case investigation UI brief](2026-10-11-launched-browser-and-investigation-ui-brief.md)
(#1825), which the mock answers.
Format follows the [Case investigation view assessment](2026-10-04-case-investigation-view-feasibility-assessment.md):
a verdict, a size, and the constraint behind any Modify. No redesigns; the designer revises the
mock.

Sources, with the short names this assessment cites them by. Line numbers are at `origin/main`
`b0a1a510`.

- **Brief**: the UI brief above.
- **Spec**: [Capture engine, stage 2: launched Chromium browsers](2026-10-10-capture-engine-launched-browser-design.md).
- **Spike**: the [launched browser probe spike](2026-10-11-capture-engine-launched-browser-probe-spike.md).
  It merged after the Brief, so its findings on P15 and P19 are newer than the Brief's
  "not checked" notes (Brief :272-274, :279-281).
- **Plan**: the [Case investigation engine plan](../plans/2026-10-10-case-investigation-engine.md).
- **Retrieval plan**: the [Case retrieval first slice](../plans/2026-10-09-case-retrieval-first-slice.md).
- **Roadmap**: the [agent briefs for three programmes](../plans/2026-10-10-three-programme-agent-briefs.md).
- **Accepted mock**: the README of the accepted investigation view bundle,
  [`docs/design-handoff/2026-10-06-case-investigation-view/`](../design-handoff/2026-10-06-case-investigation-view/README.md).

Engineering read the mock's source, its visible text and its tooltips, and checked each claim
against the sources and the code. Engineering did not click through the mock in a browser.

## What the sizes cover

Sizes cover the renderer work for each item, given an engine that serves it. Little of that
engine exists:

- **Launched browser.** Stage-2 step 3 (launcher, connection, browser profiles, and Egress, with
  no Capture) and step 4 (clicked `launched` Captures) are not built (Spec :1278-1279,
  :1291-1293). Settings has no Egress setting: CE-3 (#1695) adds it, and nothing writes the
  Egress manifest fields yet (`src/main/services/manifest.ts:553`). The no-VPN warning (CE-4,
  #1696) has shipped no copy. Passive capture waits on #600.
- **Withheld from analysis.** The `withheld_flags` table (Plan :352-365) does not exist; the
  database is at schema version 37 (`src/main/services/db/migrations.ts:1067`). CI-9, CI-9b, and
  CI-D1 build the table, its repositories, and its service (Plan :188, :1414, :1416). Fielded
  search (CI-5), the unreviewed tab (CI-7), and the mark (CI-14) follow (Roadmap :971-972).
- **Investigation view.** No Investigate route exists in `src/renderer`. CI-V1 builds the header
  and CI-V4 the gap list (Roadmap :1034-1036, :1044-1046).

Each of those steps sizes its own engine work. Sizes: XS under half a day, S one or two days,
M three to five days, L one to two weeks.

## Summary

| Item | Name                                          | Verdict                                                     | Size |
| ---- | --------------------------------------------- | ----------------------------------------------------------- | ---- |
| S1   | Found browsers in Settings                    | Modify: no version before launch without a source           | S    |
| S2   | Start dialog                                  | Modify: three lines of copy and the Egress pointer          | M    |
| S3   | Capture Session panel                         | Modify: rail width at 900 pixels, pop-out, shortcut failure | L    |
| S4   | Telling the browsers apart                    | Accept in Birdbrain; the browser-side cue waits on a probe  | S    |
| S5   | Withheld from analysis mark                   | Accept                                                      | S    |
| S6   | "Not read" count and gap entry                | Modify: reason wording; where "Show them" opens             | S    |
| 1    | No supported browser                          | Accept                                                      | XS   |
| 2    | Debugging connection does not answer          | Accept                                                      | XS   |
| 3    | Proxy refuses before launch                   | Accept                                                      | XS   |
| 4    | A launched browser is already open            | Accept                                                      | XS   |
| 5    | Recording, one tab not from its first request | Modify: the reload advice is not measured                   | XS   |
| 6    | Private-window tab                            | Accept                                                      | XS   |
| 7    | Capture abandoned                             | Accept                                                      | XS   |
| 8    | Crashed tab                                   | Accept                                                      | XS   |
| 9    | Extension warning                             | Modify: do not depend on the extension's name               | XS   |
| 10   | Browser closed, Capture Session running       | Modify: "session" unqualified                               | XS   |
| 11   | Ended by the Egress check                     | Modify: "session" unqualified                               | XS   |
| 12   | Closed before it showed                       | Accept                                                      | XS   |
| 13   | Browser left from an earlier run              | Accept, with detection through the browser profile's lock   | S    |
| 14   | Changing the Egress                           | Accept                                                      | XS   |
| 15   | Deleting a Persona whose browser is open      | Accept                                                      | XS   |
| 16   | Passive capture running (after #600)          | Accept as drawn; built with #600                            | -    |
| 17   | Port mode warning (only if built)             | Accept as drawn                                             | -    |
| 18   | Withheld result in each placement             | Accept; built with S5                                       | -    |
| 19   | Withheld result opened                        | Accept, with no confirmation on **Clear my flag**           | XS   |
| 20   | Withheld by another member                    | Accept                                                      | XS   |
| 21   | Non-zero "not read" count                     | Modify: as S6                                               | XS   |
| 22   | Gap list not-read entry                       | Accept; built with S6                                       | -    |
| -    | Tokens, type, and radii                       | Modify: map onto the existing system                        | XS   |
| -    | Exhibit Numbers                               | Modify: the app's format                                    | XS   |

## Surfaces

### S1. Found browsers in Settings: Modify (S)

The placement is accepted: a **Launched browsers** group in Settings -> Capture, which today
holds only **Capture screenshots** and the ignored URL patterns
(`src/renderer/components/settings/CapturePreferences.tsx:45`, :64-98). **Choose an
executable...**, the P20 note on packaged installs, and the refused "too old" row are accepted. One
constraint:

- **A version before launch.** The mock shows "reported 1.83.112, not yet confirmed" for a
  browser Birdbrain has not launched. Discovery launches nothing, and Birdbrain confirms the
  product and version only at launch, through `Browser.getVersion` (Spec :205-206, :302-304). No
  source says where a version comes from before that, and the Spike's discovery step checked
  only that paths exist. Draw the row with no version until Birdbrain confirms one. Engineering
  shows a "reported" version only on a platform where it finds a source that runs nothing.

### S2. Start dialog: Modify (M)

The fields of the dialog are accepted: the browser picker, the Persona picker defaulting to none
with the throwaway note, the **Without a click** choice with two options marked for #600, the Egress
shown read-only, the operator name check, the start and join footers, and the checklist between
**Launch** and the shown tab (1b to 1e). **Launch browser** in the Case action bar and in the
Cmd/Ctrl+K palette is accepted. The bar renders two controls today and has room for a third
(`src/renderer/components/layout/CaseActionBar.tsx:15-18`). The palette has no action registry,
so the action is a button beside its three footer buttons
(`src/renderer/components/layout/CommandPalette.tsx:176-211`). Four constraints:

- **The subtitle.** "Pages you capture here keep a record of how they loaded" states the
  capability without its limit. A tab whose page began loading before the engine attached yields a
  Capture with no Transaction Record (Spec :479-482). Put the limit in the same line.
- **The no-VPN line.** "No VPN seen. Sites will see this machine's address" asserts what sites
  see, which Birdbrain cannot check: the check misses a VPN on the router, a corporate network,
  and a split tunnel (ADR-0032 :91-94). The visible line must say what the tooltip says,
  that Birdbrain sees the machine's network path and not the browser's (ADR-0032 :102-104). Reuse
  #1696's wording once it ships.
- **Where the Egress is set.** The tooltip says to change the Egress in Settings -> Capture.
  No Egress setting exists yet. CE-3 adds it and, by the Roadmap, starts in the Operator
  section's `OperatorConfig.tsx` (Roadmap :486-488). Point to wherever CE-3 puts it; state 3's
  "check the proxy in Settings" and state 14 follow the same answer.
- **The operator name tooltip.** Its reason, that no browsing goes without a Capture, is wrong.
  Birdbrain checks the name at launch so an Operator does not browse for an hour and then find
  every Capture refused (Spec :229-231). A launched browser captures nothing without a click
  until #600 lands.

### S3. Capture Session panel: Modify (L)

The panel's content is accepted: the header naming the browser, Persona, and Egress; the capture
target naming the tab's title, URL, Persona, window, and tab before the click; **Scroll to load**
per Capture and off by default; progress, then the Exhibit Number; the tab list with its
"from first request" chip and "matches now" Selectors, which write no Persisted Match; the
private-window, settings-page, and crashed rows; the tab picker; and **Stop...** with its
confirmation. Four constraints:

- **The rail at the 900-pixel minimum.** 1f draws a 320-pixel rail beside the Captures screen at
  900 by 600. The Captures screen's minimums already take 695 pixels: the 48-pixel nav rail, a
  240-pixel list, a 7-pixel separator, a 360-pixel viewer, and the 40-pixel details rail that
  forms below 1,100 pixels (`src/renderer/components/layout/Sidebar.tsx:43`;
  `src/renderer/components/layout/listColumnSize.ts:4-13`;
  `src/renderer/components/captures/captureColumns.ts:12-26`;
  `src/renderer/routes/cases/$caseId/captures.tsx:49`). The rail fits beside them from about
  1,020 pixels. Draw what the rail and the screen do below that width.
- **Screens outside a Case.** The tooltip puts the rail on every Case screen. Draw what the
  Operator sees on the dashboard and in Settings while a launched browser is open; states 14 and
  15 happen in Settings.
- **The pop-out window on Linux.** 1g draws the popped-out window on top beside the browser.
  Electron 44.5.1 marks `alwaysOnTop` and `setAlwaysOnTop` "Not supported on Wayland (Linux)"
  (`electron.d.ts` in the `electron` package, lines 3849-3851 and 6014-6016), and on Linux
  Electron selects Wayland by itself (`src/main/windowReveal.ts:12-13`). On a Wayland desktop the
  popped-out window is an ordinary window the browser can cover. Keep "on top" out of the copy
  there. The size counts the work of Birdbrain's first second visible window.
- **The shortcut failure (1r).** `globalShortcut.register` returns `false` for some failures,
  and Birdbrain can show the struck shortcut then. GNOME 50 rejects a bind through its portal
  "with no error surfaced to the app" when the app ID does not resolve (`electron.d.ts` lines
  1723-1725), and Linux packages set no `desktopName` (#648), so on such a desktop Birdbrain
  cannot tell that the shortcut failed. The Spike measured the shortcut only under X11 with no
  desktop (Spike :895-896). Never show the shortcut as working; keep the **Capture** button as
  the stated path.

The Spec names no key, so engineering picks it at build time. Microsoft Edge, one of the four
supported products, already binds Ctrl+Shift+S to its Web capture tool
([Microsoft Q&A](https://learn.microsoft.com/en-us/answers/questions/2406165/unable-to-use-ctrl-shift-s-for-web-capture)).

### S4. Telling the browsers apart: Accept in Birdbrain; the browser-side cue waits on a probe (S)

The Birdbrain-side cues are accepted: "Launched Chrome · Harbor Desk" on every surface that
shows a running Capture Session, the REC pill naming the browser, and the switch's source line
(pieces `1h` and `1i`). The top bar's REC indicator shows the static text `REC` today
(`src/renderer/components/layout/TopBar.tsx:184-193`), and the switch renders only while the
extension is connected (`src/renderer/components/status/SessionControls.tsx:20`); both changes
are in the size. Stopping from the switch closes the browser and stops the extension's Captures,
because one running flag serves both (`src/main/services/session.ts:66`), as 1i says.

- **The browser-side cue.** The Spike measured one value written before first launch,
  `credentials_enable_service` in `Default/Preferences`. Chrome 150 and Chrome for Testing 149
  kept it on Linux (Spike :566-570, :583-589). The proposed browser profile name and theme
  color are two more values, unmeasured on any product, and the Spec's list of what the engine
  writes is decision D15's (Spec :689-695). The cue ships only after a probe shows each supported
  product keeps both values. Draw the name for a throwaway browser profile too, which has no
  Persona label. The Spike also settled P19 on Linux: no automation infobar appears (Spike :893).
- **The wrong-browser notice.** Accepted, on Birdbrain's side: an `event:newCapture` IPC event
  already reaches the renderer (`src/shared/ipc.ts:251`), and no notice fires on it today
  (`src/renderer/hooks/useServerStatus.ts:36-50`). Birdbrain knows the Capture came through the
  extension, not which browser the extension runs in. Word it as having come through the
  extension, and drop "from your everyday browser" from it.

### S5. Withheld from analysis mark: Accept (S)

Accepted as drawn: the glyph, the words **Withheld from analysis**, and the holders in a dotted
outline; "Withheld" in a dense table with the full words as the accessible name; no action on a
search row (1u to 1x). The wording matches the accepted mock's run setup row and checkbox
(Accepted mock :180-181, :305-306).

- **Where a result opens.** The designer's answer, the Text or Links tab with the span or row
  highlighted and the mark on the Exhibit header, follows the Retrieval plan's ruling 2
  (Retrieval plan :323-325). ADR-0044 says a withheld result opens "in the source inspector"
  (`docs/adr/0044-case-search-indexes-are-rebuildable-caches-outside-the-manifest.md:69-70`),
  which exists only once the investigation view is built. "For the maintainer" below raises
  it.
- **The outline.** `--color-border-strong` is `#d4d4d8` in the light theme, 1.48:1 against a
  card. The words and the glyph carry the mark, so the outline must stay decoration and never
  become the only cue.
- **Components.** The only chip primitive is `Badge`, with no dotted variant
  (`src/renderer/components/ui/badge.tsx:9-21`), so the mark is a small new component. Search rows
  show a title and URL today (`src/renderer/components/search/SearchBar.tsx:111-127`); the
  Exhibit Number and Content Hash on them come from the retrieval slice.

### S6. "Not read" count and gap entry: Modify (S)

The third count in the header and its breakdown (1y), and the gap entry (1z), are accepted. The
designer's case for an action on the gap entry holds: the View brief's rule that entries in
"Searches not yet run" carry no action covers searches, whose later action is the lookup consent
prompt (View brief :338-339), and this entry runs no search. Three constraints:

- **"Needs re-processing."** The breakdown names a remedy the Operator has no control for. The
  Retrieval plan rebuilds stale field records on its own when the Case workspace opens, after an
  import, and on reprocess (Retrieval plan :175-178), and today's **Reprocess** re-runs Extracted
  Data only (`src/renderer/components/dashboard/cases/IndicatorsView.tsx:129`). State the reason
  the Plan gives: field records from an older build, missing, `failed`, or `partial` (Plan
  :1046-1048).
- **"Can't be read yet."** "Yet" promises PDF and `mbox` reading, which CI-15 and CI-16 only
  propose, outside the waves (Plan :1071-1072). Say the run cannot read them.
- **Where "Show them" opens.** No surface lists a set of Exhibits by ID: the Captures route takes
  one Capture (`src/renderer/routes/__root.tsx:253-255`), and the unreviewed tab lists by
  criteria (Retrieval plan :220-226). The four Exhibits in state 21 also span three kinds:
  Captures, a `document`, and an `attachment`. Draw where the list opens and what each row opens.

The heading "This run did not open these Exhibits" is accepted; "read" would match the count's own
word.

## States

### 1. No supported browser: Accept (XS)

As drawn in 1j, with its two variants in the tooltip.

### 2. Debugging connection does not answer: Accept (XS)

As drawn.

### 3. Proxy refuses before launch: Accept (XS)

As drawn; "check the proxy in Settings" follows S2's Egress pointer.

### 4. A launched browser is already open: Accept (XS)

The refusal with **Show panel**, and the disabled **Launch browser** with its tooltip in 1f.

### 5. Recording, one tab not from its first request: Modify (XS)

The chips and the second row's tooltip are accepted. "Reload it to record the whole load" is not:

- The Spec never says a reload yields a page recorded from its first request, and the Spike
  lists navigations the Operator starts in the browser as not measured (Spike :773-775). Hold the
  advice until step 3 measures a reload.
- "The whole load" claims more than the flag says. A page recorded from its first request can
  still miss exchanges served from a cache, a service worker, or a speculative load (Brief
  :419-422).
- The advice cannot apply to the "recording failed to start" variant (Spec :1080).

### 6. Private-window tab: Accept (XS)

As drawn.

### 7. Capture abandoned: Accept (XS)

As drawn. The capture activity feed's events are `received`, `stored`, `failed`, and `skipped`
(`src/shared/types.ts:1146-1147`); engineering adds a reason or an event kind for an abandoned
Capture.

### 8. Crashed tab: Accept (XS)

As drawn.

### 9. Extension warning: Modify (XS)

"An extension was added: Tab Saver" names the extension. The engine watches for extension targets
(Spec :859-861), and no source says a target carries the extension's name; Chrome's own component
extensions also appear as `background_page` and `service_worker` targets (Spec :462-466). Draw the
warning without the name, with the name as an optional detail.

### 10. Browser closed, Capture Session running: Modify (XS)

Accepted except the copy: "The session keeps running until you stop it" uses "session"
unqualified, which `CONTEXT.md:71` rules out. Write **Capture Session** instead. The Spec does
not say whether **Launch again...** reuses a throwaway browser profile within the same Capture
Session (Spec :664-665); engineering settles that at step 3.

### 11. Ended by the Egress check: Modify (XS)

As state 10: write "The Capture Session ended" for "The session ended" in 1o.

### 12. Closed before it showed: Accept (XS)

As drawn.

### 13. Browser left from an earlier run: Accept (S)

As drawn, with one note on what makes it work. The Spec gives no detection method (Spec :1091).
On Linux the browser exited within 0.6 seconds when the pipe closed, so the Spike never saw this
state (Spike :882-884). The browser profile's `SingletonLock` (Spike :302-305) is the route
engineering expects. It can name the Persona because the browser profile's path carries the
Persona's ID (Spec :664); a throwaway browser profile has no Persona to name.

### 14. Changing the Egress: Accept (XS)

As drawn, in whichever Settings section CE-3 gives the Egress.

### 15. Deleting a Persona whose browser is open: Accept (XS)

As drawn.

### 16. Passive capture running: Accept as drawn (after #600)

Changing the rule from the panel mid-session follows the Spec, which has the Operator choose the
rule during a running Capture Session (Spec :955-956). The "rule changed" feed entry needs an event
kind of its own. Sized with #600.

### 17. Port mode warning: Accept as drawn (only if built)

### 18. Withheld result in each placement: Accept

Built with S5 and each host surface.

### 19. Withheld result opened: Accept (XS)

**Clear my flag** needs no confirmation, which answers the bundle's first open question. Clearing
writes a `clear` row and setting the flag again writes a `set` row (Plan :534-535), so the action
reverses, and the run-out-of-date banner already says the shown run no longer matches the Case.
**Clear MB's flag...** keeps its confirmation, because it writes a row in a revoked member's name
(Plan :558-560).

### 20. Withheld by another member: Accept (XS)

As drawn, including the Owner clearing a revoked member's flag as a recorded action (Plan
:558-560).

### 21. Non-zero "not read" count: Modify (XS)

As S6.

### 22. Gap list not-read entry: Accept

Built with S6.

## Cross-cutting

### Tokens, type, and radii: Modify (XS)

- **Status colors.** The mock defines `--bb-ok`, `--bb-warn`, and `--bb-alert` again, with the
  light values `#b45309` and `#dc2626` that the 2026-10-04 assessment replaced with
  `--color-warning-fg` and `--color-danger-fg` (`#92400e`, `#b91c1c`). Use the existing tokens, as
  the accepted mock does.
- **Type.** Besides 10, 11, 12, and 14 pixels, the mock sets text at 8.5, 9, 9.5, 10.5, 11.5,
  12.5, 13, and 22 pixels. Snap each to the agreed scale, 10 / 11 / 12 / 14 / 18.
- **Radii.** 3-pixel chips and 8-pixel surfaces come onto 2 / 4 / 6.

### Exhibit Numbers: Modify (XS)

The mock writes `E-62` for an Exhibit Number. The app shows a bare number, or the Member Code
and number in a Shared Case, such as `NK-12` (`src/shared/exhibitCitation.ts:22`). The build
uses the app's format, which 1l's `NK-12` already follows.

## What the mock answered

The designer's answers to the Brief's 13 questions are accepted where no item above modifies
them: a right rail that can pop out (1, modified by S3); one browser name on every Birdbrain
surface, with the browser-side cue for a probe (2, S4); the switch shown while the extension is
connected or a launched browser is open, with a source line, asking first because stopping
closes the browser (3); glyph, words, holders, and a dotted outline (4); the count third, with a
breakdown (5, copy in S6); the struck shortcut (6, modified by S3); Settings -> Capture ->
**Launched browsers** (7, the version modified by S1); the Case action bar and the palette (8); a
neutral chip and "matches now" (9, the reload advice modified by state 5); **Show them** on the
gap entry (10, its target modified by S6); clearing a flag from the opened Exhibit and run setup
only (11); changing the passive rule from the panel (12); and results opening where the
Retrieval plan says (13).

The bundle's second open question is answered by the Spec: the version floor is "the oldest
version on which the stage-2 probe passes" (Spec :303-304) and has no number yet, so 1a stays
illustrative.

## For the maintainer

One conflict between documented rules is not engineering's to settle. ADR-0044 says a withheld
result opens "in the source inspector" (:69-70). The Retrieval plan's ruling 2 opens a hit on the
Text or Links tab and lets the source inspector take this over later (:323-325), and the mock
follows the Retrieval plan. Either ADR-0044's wording gains a qualifier, that the source
inspector takes over once the investigation view is built, or the retrieval slice waits for the
source inspector.

## Sequencing

The Spec gates stage-2 step 3 on the panel's design landing (Spec :1278-1279) and step 4 on this
feasibility pass (Spec :1291-1293). The Modify items on S2, S3, and states 5, 9, 10, and 11 are
copy and layout for the designer's revision; none changes what the engine records. The mark
gates CI-14, and the count and gap entry gate CI-V1 and CI-V4 (Roadmap :85).
