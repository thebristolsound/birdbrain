# Chrome, capture and export consolidation

**Status:** active

This plan turns the design critique of 2026-11-15 into ordered slices of work. The critique
reviewed the running app at `origin/main` `03668a1` and found that the clutter in the chrome,
the capture controls and the export controls comes from the same fact being stated in several
places at once. The plan gives each fact one place, then removes the copies.

The maintainer ruled on the plan's six open decisions on 2026-11-15 and on a seventh on
2026-11-17; "Decisions taken" records them. A review of this plan on 2026-11-16 raised two
questions the code does not settle; "Open questions" states them, and decision 7 answered the
first. No issue is filed yet. The chrome slices merged as #2227 to #2235, #2239 builds the
slices that waited for nothing after them, and
`docs/plans/2026-11-16-consolidation-and-copy-handoff.md` says what is left. The critique itself
is a page in the design session and is not in this repository, so its findings are restated
under "Findings" and each one maps to a slice or to a stated reason for leaving it.

## Context

What the review ran: a build of `03668a1` driven through `.claude/skills/run-birdbrain/`, at
1440 by 900 and 1100 by 800, dark theme, on the demo Case. The Capture Session screenshots used
the stand-in state that `e2e/topbar-layout.spec.ts` injects, because Chrome did not complete a
launch in the review sandbox. The extension's own popup, the light theme on screen and a Case
with hundreds of Captures were not reviewed.

Five things in the repository constrain the work. The critique did not know all of them, so
this section also corrects it.

- **The vocabulary is already ruled.** `CONTEXT.md` names the **Evidence Package**, the
  **Working Copy**, the **Case Archive** and the **Capture Session**, and lists what to avoid:
  "bundle", "ZIP" and "export" for the Evidence Package, "case file" for the Case Archive, and
  an unqualified "session". The critique proposed "Case file" and a tab labelled "Session".
  Both are wrong by `CONTEXT.md`. This plan uses the ruled terms. The app's own labels break the
  same rules today: `ExportMenu.tsx` says "Export case file" and `ExportDialog.tsx` says "Full
  evidence bundle".
- **ADR-0032 rules the VPN indicator and its warnings.** The ADR's Decision section has two
  numbered lists. The rules this plan cites are in the second one, under "Birdbrain pushes the
  Operator toward a VPN, but only warns", and the plan calls them VPN rule 2 and VPN rule 3.
  VPN rule 2 says the top bar shows the Egress and whether a VPN is seen, and that the warning
  offers to continue, to set up a proxy, or to stop warning on this network. VPN rule 3 says
  starting a Capture Session warns too. Two critique proposals change the form of those: a
  status control that drops the word "VPN not seen", and a launch dialog that carries the
  warning inline. Decisions 2 and 3 rule on both, and each slice that builds one amends
  ADR-0032.
- **The app moves to the mock.** `docs/design-handoff/README.md` names the 2026-08-21 standalone
  as the single design source, and the ruling of 2026-09-20 recorded in #1555 says no design gap
  is left to drift. Open `redesign` issues pull the Export dialog and the Overview toward that
  mock: #1555 adds a chain-of-custody preview card and widens the dialog, and #1547 moves the
  Overview's heading, sources, capture strip and tag cards to it. Several slices here pull
  the other way. The 2026-11-08 top bar change
  set the precedent for resolving this: a dated bundle under `docs/design-handoff/` that
  supersedes named rows of the mock.
- **Sharing was put in the chrome on purpose.** The brief
  `docs/specs/2026-10-27-sharing-discoverability-ui-brief.md` asked for sharing to be reachable
  inside an open Case before anyone has joined. The Share pill in `CaseActionBar.tsx` answers
  that.
- **Some of these files are evidence-affecting.** In
  `docs/specs/2026-07-31-evidence-affecting-paths-assessment.md`, `ExportDialog.tsx`,
  `CaptureDownloadMenu.tsx`, `DataExplorer.tsx`, `ForensicsTab.tsx`, `OperatorConfig.tsx`,
  `CaptureControl.tsx`, `TabPicker.tsx` and `captureSessionPanelModel.ts` are `blocking`, and
  so is `src/renderer/components/data/**`. `src/renderer/components/layout/**`, which holds
  `Sidebar.tsx`, `TopBar.tsx` and `CaseActionBar.tsx`, `src/renderer/components/status/**`,
  `CaptureDetailsPanel.tsx` and `src/renderer/styles/**` are renderer chrome or styling.
  `StartDialog.tsx`, `CaptureSessionDock.tsx`, `CaptureSessionPanel.tsx`, `CaptureMenu.tsx` and
  `CaptureSelectionBar.tsx` match no entry of the list, by name or by directory; each slice
  that touches one confirms its tier before it starts.

Three more facts shape the slices:

- `radix-ui` is already a dependency and exports a dropdown menu, so a shared menu component
  adds no dependency. `src/renderer/components/ui/` has a popover and a context menu but no
  menu, which is why `ExportMenu.tsx`, `CaptureDownloadMenu.tsx` and `CaptureMenu.tsx` each
  build their own.
- The onboarding tour rings `data-tour` anchors on the controls this plan moves: `nav-*`,
  `caseswitcher` and `export` in `tourSteps.ts`, and the Share coach mark in
  `ShareCoachMark.tsx`.
- `website/content/docs/tester-guide.mdx` and `website/content/docs/features.mdx` name the
  controls by position. Nine end-to-end specs find them by test id or label:
  `topbar-layout`, `export`, `case-archive`, `vpn-warning`, `onboarding-tour`,
  `shared-case-members`, `round1-session`, `wayback-panel` and `capture-server-api`.

## Findings

The U rows are the sixteen rows of the critique's usability table, in its order and with its
severities. The C rows are the five rows of its consistency table. The A rows are four of its
five accessibility notes; the fifth, that the Export dialog's primary button needs a scroll,
repeats U9. The H rows are three remarks from its walk through the screens. The critique grades
only the usability rows, so the severities on the C, A and H rows are this plan's. "Slice"
points into "Slices" below.

| ID | Finding | Severity | Slice |
| --- | --- | --- | --- |
| U1 | During a Capture Session one screen names the browser three times, the Case three times and the timer twice, and has two stop controls | critical | 2.1, 2.2, 5.5 |
| U2 | A first launch takes the launch dialog, a trip to Settings for the Operator name, and a second dialog that repeats the VPN warning | critical | 3.1, 3.2 |
| U3 | Export labels do not name their outputs: "Export evidence report" opens "Export case" and writes an Evidence Package | critical | 4.1, 4.2 |
| U4 | Capturing has no primary control; the only filled accent button on a Case is the list's add button | moderate | 5.4 |
| U5 | The Case action bar holds one label and three buttons at rest and overflows while a session runs | moderate | 5.2 to 5.5 |
| U6 | "VPN not seen", an advisory signal, is a permanent amber word in the chrome | moderate | 6.1 |
| U7 | Five columns at 1440 pixels during a session; the captured page shrinks to 37 percent zoom | moderate | 2.3 |
| U8 | Capture details open on hashes and state the Integrity Status three times | moderate | 7.1 |
| U9 | The Export dialog's primary button is below the fold at 900 pixels of height | moderate | 1.2 |
| U10 | Case settings is reachable only through Share; Investigate has no entry point | moderate | 5.3; Investigate not planned |
| U11 | The app-wide Auto-capture switch sits at the top of a Case's Signals | moderate | 7.4 |
| U12 | The Overview is a second place to edit Selectors, Tags and Notes | moderate | 7.3 |
| U13 | The add menu on Captures holds Recapture, which is not an add | minor | 1.4 |
| U14 | Every Captures list row carries the same Selector chips | minor | 7.2 |
| U15 | The launch dialog uses a native select for one browser and has four info tips | minor | 1.6, 3.3 |
| U16 | The Data screen has two buttons both labelled Verify | minor | 1.5 |
| C1 | Seven nouns name the outputs of two export controls | moderate | 4.1 |
| C2 | Two icons stand for the same export dialog | minor | 4.1 |
| C3 | The chrome dropped filled status backgrounds; the Export and launch dialogs still use them | minor | 1.2, 3.2 |
| C4 | "Launch browser", "Capture Session", "Recording" and "Launched Google Chrome" describe one activity | moderate | 5.4 |
| C5 | Three menus are built by hand, each with its own keyboard handling | minor | 5.1 |
| A1 | Faint text is 3.5:1 to 4.0:1 on the dark surfaces | moderate | 1.1 |
| A2 | Below the `xl` width the status control shows state by colour and a small icon only | minor | 6.1 |
| A3 | A disabled Launch browser gives its reason in a `title` a keyboard cannot reach | minor | 1.3 |
| A4 | The list row's star and checkbox are about 14 to 16 pixels and sit together | minor | 7.2 |
| H1 | The rail is icon-only, so the action bar repeats the section name | moderate | 5.2 |
| H2 | The Case name looks like a menu and opens the command palette | minor | 5.3 |
| H3 | The Overview's Link Map header links to "All notes", the same label as the Quick Notes card beside it | minor | not planned |

For four rows the code disagrees with the critique's count, labels or premise. The slices follow
the code:

- **U15.** `StartDialog.tsx` renders `InfoTip` in three places, not four: beside the title,
  beside the Egress, and beside "Not set" only while no Operator name is saved.
- **U16.** The critique's labels, "Verify all" and "Verify this file", fit neither button. Open
  question 2 says why.
- **A1.** The critique counted 281 uses of the faint token. `text-text-faint` appears 284 times
  in 100 files under `src/renderer/`, and 16 more uses take the token as a background, border
  or stroke colour.
- **H3.** Both "All notes" links open the Notes section, which is what the label says. "Not
  planned here" gives the reason for leaving it.

Five points the critique makes outside those tables have no row. Share and Export hold
permanent places in the chrome though an Operator uses them a few times per Case; slice 5.3
moves them. "Import Case…" is on the dashboard only, under a different noun from the export it
reverses; slice 4.3 answers that. At 1100 pixels the session line truncates and two collapsed
rails sit side by side; slices 2.1 and 2.3 remove the line and the second rail. Tags and the
inline note sit below the fold in Capture details; slice 7.1 collapses the sections above them.
The three notes on visual hierarchy cover the same ground as U4, U5 and U6.

## Decisions taken

The maintainer accepted all six recommendations on 2026-11-15, in the design session that wrote
this plan. Each entry gives the question, then the ruling. The critique leaves three decisions
to the maintainer, and decisions 1, 2 and 4 answer them. It also asks for a ruling on the export
nouns, which `CONTEXT.md` had already given. Decisions 3, 5 and 6 are questions this plan
raised, where a critique proposal met ADR-0032, the standalone mock and #830.

1. **Does Share keep its own control in the chrome, or move into a menu on the Case name?**
   The 2026-10-27 brief put it in the chrome so sharing is reachable before anyone has joined.
   Ruling: Share moves into the Case menu. The existing coach mark stays, and the menu item
   shows "On this machine only" until the Case is shared. Slice 5.3 builds it.
2. **May the top bar stop printing "VPN not seen" and show the advisory as a coloured dot
   only?** ADR-0032 VPN rule 2 says the top bar shows the Egress and whether a VPN is seen.
   Ruling: yes. The wording stays in the status popover and is added to the capture control's
   menu and the launch dialog, and VPN rule 2 is amended to say so. Slice 6.1 builds it.
   Ruled 2026-11-17: the advisory mark is a hollow amber ring, not a filled dot, so it differs
   from the nominal dot by shape as well as hue.
3. **May a launch carry the VPN warning inside the launch dialog, with no second dialog?**
   ADR-0032 VPN rule 3 says starting a Capture Session warns. Ruling: yes, for launches only.
   The inline form keeps all three offers from VPN rule 2 (continue, set up a proxy, stop
   warning on this network) and the primary button reads "Launch without VPN". The separate
   `VpnWarningDialog` stays for every other first contact. Slice 3.2 builds it and amends
   VPN rule 3.
4. **What is the primary control called?** The critique proposed "Capture". `CONTEXT.md` uses
   Capture for the stored page, and the session panel already has a Capture button that takes
   one. Ruling: the label at rest stays "Launch browser", because it says what happens, and it
   becomes the filled control with a menu for the other ways in. Slice 5.4 builds it.
5. **Do these changes supersede the standalone mock where they disagree, and do #1555 and
   #1547 pause until that is drawn?** Slice 4.2 replaces the two-item export menu that #1555
   rewires, and the Export dialog gets shorter where #1555 adds a preview card. Slice 7.3
   reduces the Overview cards that #1547 reworks. Ruling: yes. The new chrome, export dialog
   and Overview cards are drawn as a bundle (slice 0.1) that names the mock rows it
   supersedes; the bundle is ruled on, then slice 4.4 closes or rewrites the affected rows of
   #1555 and #1547. Until then those rows wait.
6. **Should loose files join the one export dialog now?** The critique proposed a fourth choice,
   "Files", covering a Capture's page archive, PDF and screenshot and the CSV of Persisted
   Matches. #830 already plans per-entity export. Ruling: no. The viewer's Download menu and
   the Signals CSV buttons stay where they are, slice 4.1 fixes their labels, and #830 decides
   the rest.
7. **Are the design bundle's answers to its ten questions accepted?** The bundle from slice 0.1
   answers the ten questions of `docs/plans/2026-11-15-consolidation-phase-0-design-bundle.md`
   on its rules sheet, board R. Ruling, given in a Claude Code session on 2026-11-17: yes, all
   ten as drawn. Slices 2.3, 4.2 to 4.4, 5.2 to 5.6 and 7.3 no longer wait for it. Slice 5.6
   (#2235) adds the bundle under `docs/design-handoff/` with its row in the index, in wording
   the maintainer approved on 2026-11-17. Its feasibility assessment is not written.
   1. With no Case open, Launch browser opens the launch dialog on a Case picker, preset to
      the last Case opened.
   2. An extension-only Capture Session starts from "Start Capture Session in Chrome" in the
      Launch browser menu, which raises the VPN warning first. It stops from the recording
      mark's menu. This answers open question 1.
   3. The labelled rail is 72 pixels wide, with the label under the icon. `SIDE_RAIL_PX` moves
      from 48 to 72.
   4. The Capture Session tab shows when a session starts, and selecting a Capture switches to
      Details. The tab keeps a red dot while recording.
   5. The 480 pixel viewer minimum stays, as the point where the one right panel folds to a
      strip.
   6. The tour and the Share coach mark ring the Case name and name the item in their text.
      They do not open the menu.
   7. #1555: one entry supersedes the export menu row, the preview card is not drawn, and the
      dialog keeps its width. #1547: frame I supersedes the Selectors and Tags cards, and the
      heading, sources and capture strip rows are kept.
   8. A Shared Case's sync state shows beside the Case name: nothing while in sync, "Syncing",
      or an icon and "Sync paused" on a problem.
   9. The menu on the Case name and the dashboard card's menu are one component on the shared
      menu, with items by place. The card keeps Rename and Delete. The Case name adds Switch,
      Export, Import and Case settings. Share or Members is in both, with one label.
   10. The two facts the switch's label keeps go on the recording mark: "into ‹Case›" when the
       Active Case is another Case, and "+ extension" when two sources record.

## Open questions

A review of this plan on 2026-11-16 raised two questions that the code does not settle.
Decision 7 answered question 1 on 2026-11-17. Question 2 waits for the maintainer, and the slice
it holds up says so.

1. **How does a Capture Session start when only the extension is connected?** The Capture
   Session switch in `SessionControls.tsx` is the only control that starts one. Its handler,
   `handleToggleSession`, raises the VPN warning, activates the Case and starts the session.
   The launch dialog starts a session only by launching a browser. The extension's popup stops
   a session and cannot start one, and `startSession()` in `extension/src/utils/api.ts` has no
   caller. Slice 5.5 removes the switch, and the menu in slice 5.4 holds no item that starts a
   session. Whatever takes the switch's place keeps the warning that ADR-0032 VPN rule 3
   requires before a start. Decision 7, answer 2, gives the answer, so slices 5.4 and 5.5 no
   longer wait.
2. **What do the Data screen's two Verify buttons say?** The critique proposed "Verify all" and
   "Verify this file", and neither fits. The button in the header above the table, `node-verify`,
   verifies the Exhibits under the selected node and not the whole Case, and "Verify all" is
   already the label of the `IntegrityStrip` button that verifies every anchored row. The
   button on the selected row's pane, `row-verify`, verifies an Exhibit, and for a derived file
   that is the parent Exhibit and not the file. `DataExplorer.tsx` is `blocking` and each label
   tells the Operator what a verification covered, so the words are the maintainer's. Slice 1.5
   waits for the answer.

## Slices

Every slice is one pull request. Each one that changes what a user sees carries before and
after screenshots, updates the end-to-end specs and the two docs pages that name the control,
and stays at ten files or fewer where it can. A slice that touches a `blocking` file takes the
`evidence-affecting` label and an Evidence impact section. Filing the slices as issues is a
separate ask; `queued` stays the maintainer's.

### Phase 0: draw

- [ ] **0.1 Design bundle for the one-row chrome, the one export dialog and the Overview
  cards.** A new page in the design project and a dated bundle under `docs/design-handoff/`,
  with options for the Case menu, the Launch browser control at rest and while a Capture
  Session runs, the labelled rail, the right panel's two tabs, the export dialog's choice
  list, and the Overview's Selectors and Tags cards. It names the rows of the standalone mock
  it supersedes. The round-trip protocol applies: bundle, feasibility assessment, ruling.
- [x] **0.2 Record the six decisions.** Done on 2026-11-15, under "Decisions taken". Decisions
  2 and 3 also amend ADR-0032 in the slices that implement them.

### Phase 1: fixes that need no drawing

These are independent of each other and of the bundle. They can start at once, except slice
1.5, which waits for open question 2.

- [x] **1.1 Raise faint text to 4.5:1 on dark surfaces (A1).** Shipped in #2239, with `#85858e`.
  `--color-text-faint` in the dark block of `src/renderer/styles/globals.css`. `#85858e` measures
  4.65:1 on `--color-elevated`, the lightest dark surface. Check it stays distinct from
  `--color-text-muted`. The token colours text in 284 places across 100 files, so the screenshots
  cover one screen per section. It is also the background, border or stroke colour in 16 places,
  switch tracks and status dots among them, so the slice checks one of each.
- [x] **1.2 Keep the Export dialog's primary action in view, and drop the filled banners (U9, C3).**
  Shipped in #2239. `ExportDialog.tsx`: the form scrolls and the footer stays fixed. The
  demonstration notice and the Trusted Time preflight notice become text with an icon, readable in
  both themes, which also resolves #1524. `blocking` file: the Evidence impact section says layout
  and colour only. `e2e/export.spec.ts` reads the names of the package's entries and nothing else,
  so it does not show the package is unchanged. The slice shows that the dialog submits the same
  options: the preset tests in `tests/components/ExportDialog.test.tsx` pass unedited, and the slice
  changes nothing under `src/main/`.
- [ ] **1.3 Give a disabled Launch browser a reachable reason (A3).** Not built: slice 5.4 (#2233)
  replaced this button with the capture control, and the stacked chrome slices left this one out.
  `CaseActionBar.tsx`: the button takes `aria-disabled` in place of `disabled`, so it keeps focus,
  and `aria-describedby` points at text that carries `busyRefusal`'s title. `ExportMenu.tsx` is the
  model for the first half only, because it gives its own reason in a `title`. `OperatorConfig.tsx`
  shows `aria-describedby` wired to a message.
- [x] **1.4 Take Recapture out of the add menu (U13).** Shipped in #2239: one item was left, so the
  button opens the paste dialog. `CaptureMenu.tsx` keeps "Paste URLs to capture". Recapture stays on
  the Capture's own menu in `CaptureDetailsPanel.tsx` and on `CaptureSelectionBar.tsx`. If the add
  menu is left with one item, the button opens the paste dialog directly.
- [ ] **1.5 Name the scope on the Data screen's two Verify buttons (U16).** `DataExplorer.tsx`:
  `node-verify`, in the header above the table, and `row-verify`, on the selected row's pane,
  each get a label that says what the button verifies. Waits for open question 2. `blocking`
  file: labels only, and the Evidence impact section shows that each label matches the
  Exhibits its button passes to `verifyIds`.
- [x] **1.6 Show a single browser as text in the launch dialog (U15).** Shipped in #2239.
  `StartDialog.tsx`: the select renders only when more than one browser was found.

### Phase 2: a Capture Session has one place

Slices 2.1 and 2.2 do not wait for the bundle. They undo part of what #2125 added to the
action bar, so their
pull requests say so.

- [x] **2.1 The action bar says recording and for how long, and nothing else (U1).** Shipped in
  #2228. `RecordingMark.tsx` drops the source text where the session panel is on screen.
  `SessionControls.tsx` drops the Case name and the source line. `CaseActionBar.tsx` hides the
  disabled Launch browser while a browser is open. `e2e/topbar-layout.spec.ts` expects "Launched
  Google Chrome" in the mark and a `session-source-line`; both expectations move to the panel.
- [x] **2.2 One stop control on screen (U1).** Shipped in #2229. While `CaptureSessionDock` shows
  the panel, its **Stop** is the only stop control and the Capture Session switch does not render.
  The switch stays where no panel shows, which today is an extension-only session. There it is also
  the only control that starts a Capture Session (open question 1, which decision 7 answers).
- [x] **2.3 Capture details and the Capture Session share one right panel (U7).** Shipped in #2239.
  On the Captures section, `CaptureSessionDock.tsx` and the details column become two tabs of one
  panel, so the layout stays at four columns. Other sections keep the dock as their only right
  panel. The tab is labelled "Capture Session". Decision 7 ruled on the drawing from 0.1, so the
  slice no longer waits. The slice must not edit `CaptureControl.tsx`, `TabPicker.tsx` or
  `captureSessionPanelModel.ts`; if it has to, it becomes `evidence-affecting`.
- [x] **2.4 Say "into this Case" when the Active Case is the one on screen (U1).** Shipped in
  #2239. `CaptureSessionPanel.tsx` names the Case only when the Operator is looking at a different
  one.

### Phase 3: launch in one dialog

- [x] **3.1 Ask for the Operator name in the launch dialog (U2).** Shipped in #2239.
  `StartDialog.tsx` replaces "Set operator name" and its navigation to Settings with the field
  itself, saved through the same settings mutation and the same validation as the Operator tab. The
  assessment lists the Operator tab, `OperatorConfig.tsx`, as `blocking` because the export
  certification embeds the Operator identity verbatim, and this slice adds a second place that
  writes the name. Treat the slice as `evidence-affecting` whatever tier `StartDialog.tsx` is given:
  it takes the label and an Evidence impact section, and a test shows that the dialog saves the same
  value and refuses the same empty name as the Operator tab.
- [x] **3.2 One VPN statement per launch (U2, C3).** Shipped in #2239. The dialog asks main when it
  opens and again when Launch is pressed; the amended VPN rule 3 says so. Decision 3 allows it. The
  no-VPN line under Egress stays, as text without a filled box. The primary button reads "Launch
  without VPN". "Set up a proxy" and "Do not warn on this network" sit beside it, the second shown
  only when the network can be identified. `StartDialog.tsx` stops raising `VpnWarningDialog`; every
  other caller in `src/renderer/lib/vpnWarning.ts` keeps it. ADR-0032 VPN rule 3 is amended in the
  same pull request. `e2e/vpn-warning.spec.ts` gains the launch path.
- [x] **3.3 Fold the info tips into one disclosure (U15).** Nothing left to build: the copy cut in
  #2239 removed the dialog's tips, as decision 4 of `docs/plans/2026-11-16-ui-copy-cut.md` rules.
  `StartDialog.tsx`: one "How this works" row holds the text the three `InfoTip`s carry today. The
  Operator tip shows only while no Operator name is saved, the state slice 3.1 changes.

### Phase 4: export through one dialog

Slice 4.1 is copy and can start at once. Slices 4.2 to 4.4 waited for the ruling on the bundle
from 0.1 (decision 5), which decision 7 gave. Decision 6 keeps loose files out of the dialog.

- [x] **4.1 Use the ruled nouns, show the file type, use one icon (U3, C1, C2).** Shipped in #2239.
  Every label that names an output uses `CONTEXT.md`'s term: Evidence Package, Working Copy, Case
  Archive. The save confirmation in `exportNotice.ts` matches. `ExportMenu.tsx`,
  `CaptureSelectionBar.tsx` and the Signals CSV buttons use one export icon; the viewer's Download
  menu keeps the download icon because it hands over a stored file as it is. `ExportDialog.tsx` and
  `CaptureDownloadMenu.tsx` are `blocking`: copy only. Updates `tester-guide.mdx`, `features.mdx`,
  `e2e/export.spec.ts` and `e2e/case-archive.spec.ts`.
- [x] **4.2 One "Export" entry and one dialog (U3).** Shipped in #2239. The menu's two items become
  one. The dialog's title follows its scope, and its choice list is: Evidence Package, with a
  checkbox to leave out Operator notes that replaces the third preset; Working Copy; and Case
  Archive, which calls the existing `exportArchive` mutation. The third preset's label names a
  venue, which the writing guide's claim discipline keeps out of the docs; the checkbox retires that
  label. ADR-0010's distinction and ADR-0009's full-Manifest line stay as they are. `blocking`: a
  unit test over the preset table shows each choice produces the same `ExportSelection` as the
  preset it replaces. `e2e/export.spec.ts` compares the names of the package's entries, not their
  bytes, so it does not show the package is unchanged for the same selection. The slice shows that
  with a known-answer comparison of the package, and adds one if none covers the selection.
- [x] **4.3 Put Import beside Export.** Shipped: the Case menu item in #2232, and the dashboard's
  label in #2239. "Import Case Archive" joins the Case menu from 5.3 and keeps its place on the
  dashboard, under the same noun. The menu item opens the import flow the dashboard already uses.
  `ImportCaseDialog.tsx` is `blocking`; if the slice has to edit it, the slice becomes
  `evidence-affecting`.
- [x] **4.4 Reconcile the open redesign issues.** Done on 2026-11-19, as a comment on each
  issue: a verdict on every row of #1555 and of #1547, and #846 and #841 checked against the new
  dialog. Rewriting or closing those issues is left to the maintainer. As first written: after
  the ruling on the bundle, rewrite or close the rows of #1555 and #1547 it supersedes, and
  check #846 and #841 against the new dialog.

### Phase 5: one row of chrome

Decision 7 ruled on the bundle from 0.1 and answered open question 1, so no slice of this
phase waits. Decisions 1 and 4 fix the Case menu's contents and the primary control's name.

- [x] **5.1 A shared menu component (C5).** Slice 5.1a shipped in #2227: the component, with
  `ExportMenu.tsx`, `CaptureMenu.tsx` and the Capture actions menu in `CaptureDetailsPanel.tsx` on
  it. Slice 5.1b, `CaptureDownloadMenu.tsx`, shipped in #2239. The slice as first written:
  `src/renderer/components/ui/menu.tsx` on the dropdown menu `radix-ui` already ships.
  `ExportMenu.tsx`, `CaptureDownloadMenu.tsx`, `CaptureMenu.tsx` and the Capture actions menu in
  `CaptureDetailsPanel.tsx` move to it, which also answers #938. Can land before the bundle: it
  changes no layout.
- [x] **5.2 A labelled rail that holds Settings (H1).** Shipped in #2231. `Sidebar.tsx`: a label
  under each icon, Settings at the foot with the update dot, the `nav-*` tour anchors kept.
  `TopBar.tsx` loses the gear.
- [x] **5.3 The Case name opens a Case menu (H2, U10).** Shipped in #2232. `TopBar.tsx`: Switch
  Case, Share or Members, Export, Import Case Archive, Case settings. The command palette keeps its
  shortcut. The `caseswitcher` and `export` tour anchors and `ShareCoachMark.tsx` move to the new
  targets; `tourSteps.ts` and `e2e/onboarding-tour.spec.ts` follow.
- [x] **5.4 One primary capture control in the top bar, on every screen (U4, C4).** Shipped in
  #2233. At rest it is a filled Launch browser button (decision 4), with a menu for pasting URLs and
  two status rows, the extension and the Egress. While a Capture Session runs it becomes the
  recording mark and shows or hides the Capture Session tab. It replaces `CaptureSessionButton.tsx`
  on the dashboard and in Settings. The menu as listed starts no Capture Session; decision 7, answer
  2, adds the item that does, "Start Capture Session in Chrome".
- [x] **5.5 Remove the Case action bar (U5, U1).** Shipped in #2234. `CaseActionBar.tsx` and the
  switch in `SessionControls.tsx` go. The switch is the only control that starts an extension-only
  Capture Session, so the slice lands after 5.4, whose menu takes over that start (decision 7,
  answer 2). An extension-only session stops from the capture control's menu.
  `e2e/topbar-layout.spec.ts` is rewritten for one row.
- [x] **5.6 Docs and record.** Shipped in #2235. `tester-guide.mdx` and `features.mdx` describe the
  new positions. The index in `docs/design-handoff/README.md` gains the bundle's row and notes that
  it supersedes the 2026-11-08 top bar.

### Phase 6: status tiers

- [x] **6.1 Advisory, problem and nominal look different (U6, A2).** Shipped in #2230. Decision 2
  allows it. `statusGroupModel.ts` gains an advisory tier: a VPN not seen, or a failed VPN check,
  shows as a hollow amber ring in place of its dot (decision 2, as ruled again on 2026-11-17) and
  adds no icon or word. "Egress unknown" and capture failures keep the icon and the word at every
  width, so the icon's presence is the signal. The accessible name and the popover are unchanged.
  ADR-0032 VPN rule 2 is amended in the same pull request.

### Phase 7: summary first, and pointers instead of copies

- [x] **7.1 Capture details open on a summary (U8).** Shipped in #2239, for the outer section only,
  as the phase 7 plan narrows it. `CaptureDetailsPanel.tsx`: the header's Integrity Status chip is
  the one statement at rest. Chain of custody, with Re-verify inside it, Identity and Capture
  environment are collapsed sections, and the panel remembers which ones the Operator opened. Chain
  of custody is one section today, open by default, and its body is `ForensicsTab.tsx`, which holds
  the Identity and Capture environment headings and is `blocking`. Collapsing those two on their own
  means editing that file, which makes the slice `evidence-affecting`; collapsing only the outer
  section does not. `e2e/forensics-tab.spec.ts` reads those headings and the chain status with the
  section open, so it opens the section first. No spec or unit test reads `custody-section-body` or
  checks a remembered state, so the slice adds that test.
- [ ] **7.2 A count of Selector matches on each list row, and more room for the row's controls
  (U14, A4).** `CaptureItem.tsx`: the chip line becomes one count that lists the names on
  hover and focus. The star and the checkbox get 24 pixel targets.
- [x] **7.3 The Overview points to the sections that own the data (U12).** Shipped in #2239: the
  cards list what exists with its count and link to Signals. Recent changes are not shown. No longer
  waits: decision 7 ruled on the bundle from 0.1. The Selectors and Tags cards show counts and
  recent changes and link to Signals. Quick Notes keeps its input, because jotting from the Overview
  is the card's purpose.
- [x] **7.4 Move the Auto-capture switch to Settings (U11).** Shipped in #2239.
  `AutoCaptureCard.tsx` holds an app-wide switch and a per-Case exclusion list. The switch moves to
  `CapturePreferences.tsx`; the exclusion list stays in Signals as a collapsed row. Low priority
  while passive capture is suspended (ADR-0013, ADR-0037).

## Order

1. Phase 1 and slices 2.1, 2.2, 2.4, 3.1, 3.3, 4.1, 5.1 and 7.1 can start at once, except
   slice 1.5, which waits for open question 2. None waits for the bundle, and 2.1 with 2.2
   removes most of the repetition the critique found.
2. Slices 3.2 and 6.1 can also start: each carries its ADR-0032 amendment in its own pull
   request.
3. Slice 0.1 ran beside them, since 2.3, 4.2 to 4.4, 5.2 to 5.6 and 7.3 waited for its
   ruling. Decision 7 gave that ruling on 2026-11-17.
4. After that ruling, phase 5 goes in the order written: rail, Case menu, Launch browser
   control, then the removal of the action bar. The last two also waited for open question 1,
   which decision 7 answered. Slices 4.2 and 4.3 go before 5.3, which hosts their menu items.
5. Slice 7.4 fits wherever there is room. Slice 7.2 follows review pass 3 of
   `docs/plans/2026-11-15-unreviewed-surfaces-review-passes.md`, whose assessment says whether
   the slice goes ahead as written.

## Risks

- **Rework against #2125.** The two-row chrome merged on 2026-11-11. Phase 2 edits it and phase
  5 removes half of it. Slices 2.1 and 2.2 are chosen so their changes survive phase 5.
- **Review cost on evidence paths.** Four slices edit `blocking` files: 1.2, 4.1 and 4.2 edit
  `ExportDialog.tsx`, 4.1 also edits `CaptureDownloadMenu.tsx`, and 1.5 edits
  `DataExplorer.tsx`. Slice 3.1 edits none of them and is reviewed the same way, because it
  writes the Operator name. Slices 2.3, 4.3 and 7.1 join them if they have to edit the
  `blocking` files their entries name. Phase 4 keeps copy changes (4.1) apart from behaviour
  (4.2) so each review is small.
- **The tour and the tester guide break quietly.** A moved control leaves a tour step ringing
  nothing and a guide step pointing at an empty corner. Each slice in phase 5 names the anchors
  and the guide sections it moves.
- **Sharing gets harder to find.** Decision 1 moves Share into the Case menu, so the coach mark
  is the only prompt inside a Case. Slice 5.3 keeps it and the dashboard's Case card entry.
- **A warning becomes easier to click through.** Slice 3.2 turns a second dialog into a button
  label. The amendment to ADR-0032 has to say why that still counts as a warning.

## Not planned here

- **An entry point for Investigate.** The route exists and nothing links to it. Whether it
  should be found yet belongs to the investigation engine work (#1892), not to this plan.
- **Loose-file export in the dialog.** See decision 6 and #830.
- **A change to the Link Map's "All notes" link (H3).** The link opens the Notes section, as
  its label says, and the Quick Notes card's link beside it does the same: both call
  `goToNotes` in `CaseOverview.tsx`. The critique noted the repeated label and recommended no
  change.
- **The extension's own pages, the light theme, and list density on a large Case.** The review
  did not cover them. Each wants its own pass before any change.
