# Launched browser revision feasibility assessment

Date: 2026-11-02
Reviews:
[`docs/design-handoff/2026-11-01-launched-browser-revision/`](../design-handoff/2026-11-01-launched-browser-revision/),
the revised canvas `Launched Browser.dc.html` (pieces `1a` to `1z` revised, `2a` to `2g` added), its
`HANDOFF.md`, and the six surfaces, 22 states, and three cross-cutting rows of its
`ENGINEERING_REVIEW.md`.
Contract: the [launched browser revision UI brief](2026-11-01-launched-browser-revision-ui-brief.md),
which the bundle answers.
Format follows the [first pass](2026-10-12-launched-browser-and-investigation-feasibility-assessment.md):
a verdict, a size, and the constraint behind any Modify. No redesigns; the designer revises the
mock.

Sources, with the short names this assessment cites them by. Line numbers are at `origin/main`
`c8dd316a`, except the bundle's, which are at its own commit on this branch.

- **Brief**: the revision brief above.
- **Canvas**, **Handoff**, **Review**: the bundle's `Launched Browser.dc.html`, `HANDOFF.md`, and
  `ENGINEERING_REVIEW.md`.
- **Spec**: [Capture engine, stage 2: launched Chromium browsers](2026-10-10-capture-engine-launched-browser-design.md).
- **Plan**: the [Case investigation engine plan](../plans/2026-10-10-case-investigation-engine.md).
- **Stage-2 plan**: `docs/plans/2026-10-31-capture-engine-stage-2.md`, merged to `main` in PR
  #2033 as `4af53029` on 2026-11-02; its line numbers are at that commit.
- **Electron**: the type definitions of Electron 45.1.0 (`electron.d.ts`), the version
  `package.json` pins.

Engineering read the canvas's source, its visible text and its tooltips, and checked each claim
against the sources and the code. Engineering did not click through the canvas in a browser, ran
nothing, and measured nothing on a Wayland desktop.

## What the sizes cover

Sizes cover the renderer work for each item, given an engine that serves it. Since the first pass:

- **Launched browser.** Still unbuilt: no launcher, discovery, or `Browser.getVersion` code exists.
  The Egress setting has shipped on the Operator tab (`OperatorConfig.tsx:188-226`). The no-VPN
  warning (#1696) has not.
- **Investigation view.** The route and its components exist
  (`routes/cases/$caseId/investigate.tsx`, `components/investigate/`); neither the side rail nor
  the palette links to it. Only the fake engine answers it, and only in builds run from source
  (`ipcHandlers.ts:1340`); a packaged build registers no `investigation:` handler (Plan :1860-1861).
  Its panes are empty (`PaneArrangement.tsx:6-7`), so the gap list (CI-V4) is not built. The header
  count and breakdown have shipped (`ViewHeader.tsx`, #1914).
- **Withheld from analysis.** The `withheld_flags` table (migration 40), its repository
  (`exhibitMarkRepo.ts`), and archive import and export exist. Nothing outside the repository
  calls it: Captures, field search hits, and the Data inventory carry no withheld state.
- **Retrieval slice.** Shipped: field records, field search, the unreviewed view, and opening a
  hit on the Text or Links tab (`SearchBar.tsx:104-110`).

## Summary

| Item | Name                                          | Verdict                                                          | Size |
| ---- | --------------------------------------------- | ---------------------------------------------------------------- | ---- |
| S1   | Found browsers in Settings                    | Accept                                                           | S    |
| S2   | Start dialog                                  | Modify: when the switch shows                                    | M    |
| S3   | Capture Session panel                         | Modify: the strip's Capture, shortcut copy, pop-out title bar    | L    |
| S4   | Telling the browsers apart                    | Accept in Birdbrain, one line of copy; the cue waits on a probe  | S    |
| S5   | Withheld from analysis mark                   | Accept                                                           | S    |
| S6   | "Not read" count and gap entry                | Modify: heading, kind names, run number, and the list's data      | S    |
| 1    | No supported browser                          | Accept                                                           | XS   |
| 2    | Debugging connection does not answer          | Accept                                                           | XS   |
| 3    | Proxy refuses before launch                   | Accept                                                           | XS   |
| 4    | A launched browser is already open            | Accept                                                           | XS   |
| 5    | Recording, one tab not from its first request | Modify: the chip tooltip's lead-in                               | XS   |
| 6    | Private-window tab                            | Accept                                                           | XS   |
| 7    | Capture abandoned                             | Accept                                                           | XS   |
| 8    | Crashed tab                                   | Accept                                                           | XS   |
| 9    | Extension warning                             | Accept                                                           | XS   |
| 10   | Browser closed, Capture Session running       | Accept                                                           | XS   |
| 11   | Ended by the Egress check                     | Accept                                                           | XS   |
| 12   | Closed before it showed                       | Accept                                                           | XS   |
| 13   | Browser left from an earlier run              | Modify: the no-Persona form's line and when it shows             | S    |
| 14   | Changing the Egress                           | Accept                                                           | XS   |
| 15   | Deleting a Persona whose browser is open      | Accept                                                           | XS   |
| 16   | Passive capture running (after #600)          | Accept as drawn; built with #600                                 | -    |
| 17   | Port mode warning (only if built)             | Modify: one unsourced clause                                     | -    |
| 18   | Withheld result in each placement             | Modify: one tooltip; built with S5                               | -    |
| 19   | Withheld result opened                        | Accept                                                           | XS   |
| 20   | Withheld by another member                    | Modify: the revoked row's accessible name                        | XS   |
| 21   | Non-zero "not read" count                     | Modify: as S6                                                    | XS   |
| 22   | Gap list not-read entry                       | Modify: one "yet"; built with S6                                 | -    |
| C1   | Tokens, type, and radii                       | Modify: control heights, raw white, accent outline               | XS   |
| C2   | Exhibit Numbers                               | Accept                                                           | XS   |
| C3   | Copy and layout sweep                         | Modify: engineering notes in product tooltips                    | XS   |

Every change the Brief asked for is drawn. The Modify items below are copy and small layout
fixes, plus one data gap (S6) that is engineering's, not the designer's.

## Surfaces

### S1. Found browsers in Settings: Accept (S)

Brave and Microsoft Edge read "not launched yet" with no version (Canvas :66-67); Google Chrome
reads "from its last launch" (:65); the header and Q7 tooltips match (:62, :46). Nothing persists a
browser's version today: `BirdbrainSettings` has no browser fields and no launcher exists. Storing
the last launch's version is the launcher step's (#1831) and new storage, a migration if it goes in
a table.

### S2. Start dialog: Modify (M)

The five lines the Brief changed are drawn (Canvas :77, :86, :98, :108), and `2b` draws the Case
action bar with no extension and no browser (:206). One constraint:

- **When the switch shows.** Handoff :36 holds the Capture Session switch "while anything is
  running", and `2b`'s tooltip says "once either is running" (Canvas :207). Today the switch renders
  whenever the extension is connected, running or not, and it is the only control that starts an
  extension Capture Session (`SessionControls.tsx:20`, :24-37). The Brief's S4 keeps it "shown
  while the extension is connected or a launched browser is open". Word both places that way.

Control heights in `2b` are under C1.

### S3. Capture Session panel: Modify (L)

The rail where it does not fit (`2a`), the dashboard and Settings forms (`2c`, `2d`), the pop-out
cue (`1g`), the placeholder key, and the "not from first request" tooltips are drawn as the Brief
asked. "On top" and "always-on-top" appear nowhere in the bundle. Five constraints:

- **The strip's Capture names no tab.** `2a`'s strip holds a Capture control with no target visible
  while the panel is folded (Canvas :190). The Spec's Capture control "names the tab it will
  capture, with title, URL, and Persona, before the Operator clicks" (Spec :918-919). The bundle
  also disagrees with itself: Review :73 says the strip takes the panel's capture target and opens
  the picker only when no tab is eligible, and Handoff :87 says the picker opens on "more than one
  eligible tab, or none". Under either, a click with one eligible tab captures a tab the Operator
  never saw named. Draw the strip's Capture so it names its target before the click, for example
  in its tooltip and accessible name, or so it always opens the picker.
- **"The Capture button always works."** `1r`'s default shortcut line (Canvas :373) and Review :60
  say so, while the same canvas shows Capture refusing private-window, settings-page, and crashed
  tabs (:305-307) and abandoned mid-Capture (:316). Cut the assurance; "Use the **Capture** button"
  carries the instruction.
- **The key beside Capture in `1f`.** The faint `‹key›` (Canvas :163) carries its "try it" limit
  only in a tooltip. Keep the limit in visible text there, as `1r` does, or leave the key out of
  `1f`.
- **The pop-out's title bar.** Every Birdbrain window hides the OS title bar and paints the native
  window controls into the content: at the right on Windows and Linux, at the left on macOS
  (`windowChrome.ts:34-58`). `1g`'s 26-pixel bar puts **Dock** where the Windows and Linux controls
  paint (Canvas :214, Handoff :82). Leave room for them. The tooltip's claim that the window "reads
  as Birdbrain in the desktop's window list and taskbar" (Canvas :223) does not hold on Linux until
  the packages set a desktop name (#648); cut it or limit it to the window title.
- **The dashboard and Settings forms.** `2c`'s top bar leaves out the connection status and capture
  health, which the app shows on every screen but Settings (`TopBar.tsx:182-183`); `2d`'s leaves out
  the theme toggle (`TopBar.tsx:98-106`). `2d`'s popover offers "Open Ferry Line" on Settings
  (Canvas :258), while Review :58 offers it on the dashboard only; pick one. Say what the dashboard
  and Settings show while the panel is popped out, and how the rail's overlay and the Captures
  details overlay stack when both are open below about 1,015 pixels.

The fold change that answer 1 asks for is accepted; the "Open for engineering" section below
covers it, and the "Build notes" section covers the second window.

### S4. Telling the browsers apart: Accept in Birdbrain; the browser-side cue waits on a probe (S)

The name lines follow `1h`: `1i` reads "Launched Chrome · Harbor Desk, and the extension" and
"Launched Chrome · Harbor Desk" (Canvas :231-232), and `1f`'s capture target matches (:162). The
notice carries no "feasibility" label, the cue's text is updated, and `2e` reads "Birdbrain · no
Persona" with its "feasibility" label. No infobar is drawn. One line of copy:

- **The wrong-browser notice.** "NK-63 came through the extension, not the launched browser"
  (Canvas :272) follows the Brief's wording, and the Brief got it wrong: state 9 shows that
  extensions can be added to the launched browser's profile, so a Capture that came through the
  extension may have come from the launched browser. The line says the Capture came through the
  extension and stops: "NK-63 came through the extension. It has no Transaction Record, and its
  Persona is your declaration."

The notice fires for a Capture whose method is `extension` (`types.ts:77`) arriving while a
launched browser is open; background recaptures emit the same new-Capture event
(`recapture.ts:419`) and must not raise it. The cue and `2e` ship only after a probe shows Chrome,
Edge, Brave, and Chromium each keep the profile name and the theme color.

### S5. Withheld from analysis mark: Accept (S)

All seven marks share one style: 4-pixel radius, dotted `border-strong`, 10 pixels,
`text-secondary`. `1w` and `1x` draw the mark on the Exhibit header, not a checkbox (Canvas :439,
:449). `1w` still opens on the Text tab, and nothing new is drawn for the ADR-0044 conflict, as the
Brief asked.

The build makes one component; its dotted border matches the add-Subject button in the run setup
row (`RunSetup.tsx:100`), which is the dotted chip the Brief and Handoff :89 meant. `holderText`
(`investigateModel.ts:85-90`) needs a variant for the mark's "by you and MB" form, and a revoked
holder needs a field `MemberRef` lacks (`investigation.ts:52-56`). The mark has no data to show
until the withheld flags are wired past their repository.

### S6. "Not read" count and gap entry: Modify (S, given an engine that serves the Exhibit IDs)

The reasons carry no remedy and no "yet" wording, and nothing implies a not-read Exhibit holds
nothing (Canvas :465, :473). Five constraints for the designer:

- **The heading.** The Brief told the designer to keep "This run did not open these Exhibits" as
  drawn. The Brief was wrong: the shipped header reads "did not read" (`ViewHeader.tsx:58`), a build
  departure the Plan records (Plan :1865). Use "This run did not read these Exhibits" in the
  breakdown and the sheet.
- **Kind names.** Name each kind as the Data screen does, "Documents" and "Attachments"
  (`dataTreeModel.ts:106-111`), not "PDFs" or "`mbox` file" (Canvas :465, :473, :483-485); the
  engine reports a kind, not a file type, and the Plan records the same departure. An `mbox`
  upload lands as `attachment` (`staging.ts:49-69`).
- **The run number.** Drop "Run 2" (Canvas :464, :482): `RunSummary` has no run number
  (`investigation.ts:147-161`), and the Plan records that the build omits it (Plan :1862-1863).
- **The failed-build line.** The `1y` tooltip says "A failed build is the one case that stays until
  a Reprocess" (Canvas :465). A `partial` build stays too: the automatic rebuild picks only
  Captures with no build row, an older extractor, or no source (`searchFieldRepo.ts:55-66`). Say
  failed or partial.
- **NK-62.** NK-62 is captured "just now" in `1f` (Canvas :144), yet `2g` lists it as not read for
  field records from an older build (:486). A fresh Capture gets its field records from the
  current build at ingest. Give `2g`'s Capture row another number.

Review :74 says the `document` and `attachment` kinds are "proposed, not built" and Canvas :482
says no surface shows a PDF Exhibit. Both are wrong: the app writes both kinds at commit
(`staging.ts:49-69`), and the Data screen lists them with a Properties tab
(`PropertiesTab.tsx:27-40`). What is missing is a viewer for their contents. The Properties
target is sound.

Engineering's part: the not-read counts and gap entries carry counts per kind and reason, with no
Exhibit IDs (`investigation.ts:141-145`, `GapTarget` `unread` at :290). The sheet needs the run to
return the not-read Exhibits' IDs, a contract change. A Capture row reuses the open-a-hit pattern
(`selectCapture`, `setActiveViewerTab('text')`, navigate, as `SearchBar.tsx:104-110` does). A
Properties row needs a search parameter on the Data route, which has none (`__root.tsx:288-293`;
selection is local state at `DataExplorer.tsx:131-134`).

## States

States 1 to 4, 6 to 12, 14, and 15 are accepted as drawn; each Brief change is in place (state 3
reads "Settings -> Operator" at Canvas :295; states 10 and 11 say Capture Session in full at :331
and :337; state 9 has no name, with the optional line at :323-324; state 14 sits on the Operator
tab at :356). State 7 keeps the first pass's note: engineering adds a reason or an event kind for
an abandoned Capture.

### 5. Recording, one tab not from its first request: Modify (XS)

The reload advice is gone and both tooltips name no cause (Canvas :169, :304). The chip tooltip now
reads "This does not mean every exchange was recorded: a cached response can leave a gap, which
the inventory lists; a service-worker response has no endpoint, and the inventory counts those"
(:303). The lead-in files the service-worker clause under unrecorded exchanges, and ruling 3 says
those exchanges are recorded and counted, not missing (Stage-2 plan :72-74). Only the cached half
belongs under that lead-in. The Brief supplied the second half without the lead-in, so part of this
is the Brief's. Ruling 3 merged with PR #2033 on 2026-11-02, so the string follows its wording.

### 13. Browser left from an earlier run: Modify (S)

`2f`'s line "Close it to launch a new one" (Canvas :349) says a leftover throwaway browser blocks a
launch. No source says so: a new throwaway profile is a fresh `session-<uuid>` folder (Spec :673),
so no profile lock collides. The Spec (:1104) and #1831 raise this message at the next Birdbrain
start, while Handoff :113 places it "Before launch" instead. Say what the Operator should do without
claiming a launch is refused, and place it at startup. The Persona form's added line, "Chrome on
Harbor Desk's browser profile" (:344), is accepted though the Brief asked for no change there.

### 16. Passive capture running: Accept as drawn (after #600)

Token snap only.

### 17. Port mode warning: Modify (only if built)

The tooltip gains "port mode changes which signal, not whether" (Canvas :404). The Spec says only
that port mode keeps `navigator.webdriver` false (Spec :409-410); no source says another signal
takes its place. Cut the clause.

### 18. Withheld result in each placement: Modify (built with S5)

The `1u` tooltip says "MB-40 is an imported mail of MB's" (Canvas :415). A From-header hit comes
only from a Capture (`CAPTURE_EXHIBITS_SQL` in `searchFieldRepo.ts`), and an imported mail file is
an `attachment`, which `2g` says the run cannot read. Describe MB-40 as a Capture.

### 19. Withheld result opened: Accept (XS)

**Clear my flag** has no confirmation (Canvas :439).

### 20. Withheld by another member: Modify (XS)

`1x`'s revoked row reads "Withheld · by MB (revoked)" (Canvas :450): the short form outside a dense
table, with no `title` or accessible name, against Handoff :89's own rule. Use the full words, or
give the short form the full words as its tooltip and accessible name.

### 21. Non-zero "not read" count: Modify (XS)

As S6. The header shipped; this adds the "Show the 4 Exhibits" link and the kind names.

### 22. Gap list not-read entry: Modify (built with S6)

"Text inside images · not searched yet" (Canvas :474) promises image text reading, which no plan or
spec covers; drop "yet" here too, as the Brief did for "can't be read yet" in `1y`. The contract has
one gap entry per kind and reason (`investigationFixture.ts:1303-1310`); the renderer groups them
into `1z`'s single entry.

## Cross-cutting

### C1. Tokens, type, and radii: Modify (XS)

The status triples and member hues match `globals.css` exactly, all 29 custom properties the
canvas uses are defined there, and product text sits on 10 / 11 / 12 / 14 at 600 or lighter.
Three constraints:

- **Control heights.** **Launch browser** in `2b` (Canvas :206) and the top-bar Capture Session
  button (:239, :247) are 24 pixels, and **Show window** and **Dock** (:225) are 22; Handoff :46
  writes those heights into the spec. The control metric is 28 pixels (Brief, "Theme tokens";
  `button.tsx:22-33`). The 24-pixel top-bar icon buttons are the one existing exception and cover
  icon buttons only.
- **Raw white.** Sixteen `#fff` values color text on accent buttons and the switch knobs. The app
  has `accent-foreground` (`globals.css:110`), which the bundled stylesheet lacks; name it. The
  `rgba` and `oklch` values that draw the browser's own chrome in `1h` and `2e` are not Birdbrain UI
  and stay.
- **The accent outline.** Handoff :84 gives an unselected button an accent outline. The accent
  covers primary buttons, links, the focus ring, and selected states only.

The canvas spells "colour" four times (Canvas :41, :268, :270, :278); the writing guide uses
American spelling.

### C2. Exhibit Numbers: Accept (XS)

No `E-` prefix remains, each number carries its member's code, and NK-63 fits each member's own
sequence (`exhibitCitation.ts:3-4`). The canvas says once, in its header tooltip, that every piece
shows the Shared Case. NK-62's conflict is under S6.

### C3. Copy and layout sweep: Modify (XS)

The sweep is done: no "session" on its own in the canvas, Export, the Share pill, and capture
health sit in the top bar, and Lisbon and Tab Saver are gone. One constraint: Handoff :194-196
says each tooltip becomes its control's title in the build, yet some read as notes to engineering:
"The Persona step (#1833) builds this picker" (Canvas :82), "The wording is swapped for ... (#1696)"
(:98), "The number is illustrative" (:65), and "Engineering expects to detect it..." (:349). Move
those to the canvas annotation, or mark them as not shipped. Handoff :111 also has "Session
running" on its own.

## Designer answers

1. **Where the rail does not fit:** accepted, with the fold change (see "Open for engineering").
   The 1,300 figure is illustrative until the threshold is set at build.
2. **Dashboard and Settings:** accepted, with S3's constraints on the top bars and the popover.
3. **Show them:** accepted as a sheet, with S6's constraints and its data gap.
4. **Shortcut line:** Modify: cut "The **Capture** button always works" (S3).
5. **Extension warning:** accepted.
6. **Found-browser row:** accepted.
7. **Throwaway profile name:** accepted, behind the S4 probe.
8. **Pop-out cue:** Modify: leave room for the window controls and cut the taskbar claim (S3).
9. **"Not from first request" tooltip:** accepted. Naming no cause is the form the Brief offered.

## Open for engineering

- **The details panel fold.** Yes, at size S. The Captures screen folds the panel when
  `window.innerWidth` is under 1,100 (`captures.tsx:49`, :136, :160). Measuring the route's own
  width with a `ResizeObserver` follows `components/investigate/useViewWidth.ts:6-21`. The
  threshold is a build decision: today's fold leaves 118 pixels above the docked minimums, and
  keeping that margin moves the point where the rail and the docked panel both fit from the
  handoff's 1,300 to about 1,420; folding at the bare minimums keeps 1,300. The rule must not flip
  the rail between rail and strip when a Capture is selected or cleared (the handoff's rows put
  that flip between about 975 and 1,015), and it has to cover the Wayback tab's 436-pixel panel
  (`waybackPanelModel.ts:14`), which with the rail needs 1,164 pixels.
- **Raising the pop-out and its OS title.** The title can be set as drawn: set `document.title` in
  the pop-out, since `index.html` carries a `<title>` that overrides the window's `title` option
  (Electron :4482-4484). **Show window** can call `show()`, which Electron documents without a
  Wayland caveat (:6928); `focus()` "may show a notification or flash the app icon" on Wayland
  (:5967-5971), and `moveTop()` is not supported there (:6374). Whether the window comes to the
  front on a Wayland desktop is measured in the launcher step (#1831). The taskbar grouping waits
  on #648.
- **Ruling 3.** PR #2033 merged on 2026-11-02 as `4af53029`; the chip tooltip follows the
  ruling's wording (state 5).
- **A reload.** Unchanged: the launcher step measures whether a reload yields a page recorded from
  its first request, and the row carries no advice until then.
- **The strip's Capture with no eligible tab.** Superseded by S3's first constraint.
- **The `document` and `attachment` kinds.** Both are built (S6). `mbox` is not a kind.

## Handoff corrections

`HANDOFF.md` says these things about the app that the code contradicts. They change no verdict;
fix them with the S3 and C1 items.

- :34 lists the Settings top bar's switch and REC with no condition. Both show only while a
  Capture Session runs, and the switch only with the extension connected (`TopBar.tsx:91-96`).
- :35 says the side rail appears on Case screens only. It also renders on the new-Case wizard
  (`__root.tsx:111`), as the handoff's own :134 says.
- :63 says member codes use the chip's 15% fill and 30% line; the canvas draws colored mono text
  with no chip (Canvas :135, :448-450).
- :185 says an indeterminate progress bar moves a 60% bar "as the app's other progress bars do"
  there. The app's one indeterminate bar pulses a one-third bar (`SyncCard.tsx:127-134`).

## Build notes

Constraints on engineering, not the designer, found while checking the bundle.

- **Launcher step (#1831).**
  - The pop-out is the app's first second window, size M. The session, extension, Capture
    activity, update, and sharing events go only to the main window (`index.ts:614-696`) and must
    fan out; the theme watcher is a single slot (`index.ts:99`); the root layout runs session
    restore, the navigating server-status hook, the command palette, and the tour, so the pop-out
    needs its own entry or a bare root. No IPC handler checks its sender, so a pop-out on the same
    preload gets the whole API. Closing the main window must close the pop-out
    (`window-all-closed`, `index.ts:862`).
  - The server-status hook navigates to the Active Case on every session event when the window is
    elsewhere, and Stop emits an event that still names the Case (`useServerStatus.ts:16-30`). Stop
    from the dashboard or Settings popover would pull the Operator into the Case.
  - Opening a Case activates it (`CaseWorkspace.tsx:44-51`), and the session service does not
    refuse while a Capture Session runs (`session.ts:102-105`). Opening another Case from the
    dashboard mid-session would move the running Capture Session, and a launched browser's
    Captures with it. The launcher step settles whether a launch pins its Case.
  - The renderer stores only whether a Capture Session runs (`useServerStatus.ts:16-17`); "Open
    ‹Case›" and the REC pill in the dashboard's Case list need the Active Case ID the event already
    carries (`ipc.ts:416-420`).
  - The rail's overlay and the popover need a popover primitive. `components/ui` has none; Radix
    is already a dependency and `context-menu.tsx` wraps it, so a `ui/popover.tsx` adds no
    dependency. Escape goes through the open-dialog registry (`dialog.tsx:67-90`).
- **Investigation items.** The sheet needs the run's not-read Exhibit IDs (S6), and the Data route
  needs a search parameter. The mark needs the withheld flags wired into Captures, field search
  hits, and the Data inventory.

## For the maintainer

- **Still open from the first pass.** ADR-0044 says a withheld result opens in the source inspector
  (:69-70); the shipped retrieval slice opens it on the Text or Links tab, and `1w` follows the
  slice.
- **Who applies the Modify items.** Every Modify above is copy, a control height, or a small layout
  fix, except the strip's Capture target, which changes what a control does. The first pass sent
  its Modify items back to the designer for this revision. Either the designer makes a third
  bundle, or the build applies these constraints as written and the designer reviews the build.

## Sequencing

The Spec gates stage-2 step 3 on the panel's design landing and step 4 on a feasibility pass on the
mock (Spec :1409-1410, :1291-1292, :1305). This pass changes no engine behaviour the launcher step
builds, so with the strip's Capture settled, #1831 can take S1, S2, S3, and states 1 to 4 and 9 to
14 from the canvas. The S6 sheet waits on the contract change and the gap list (CI-V4); the mark
waits on the withheld flags reaching Captures and search hits.
