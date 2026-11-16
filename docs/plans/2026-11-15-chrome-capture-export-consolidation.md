# Chrome, capture and export consolidation

**Status:** active

This plan turns the design critique of 2026-11-15 into ordered slices of work. The critique
reviewed the running app at `origin/main` `03668a1` and found that the clutter in the chrome,
the capture controls and the export controls comes from the same fact being stated in several
places at once. The plan gives each fact one place, then removes the copies.

The maintainer ruled on the plan's six open decisions on 2026-11-15; "Decisions taken" records
them. No issue is filed yet and no slice has started. The critique itself is a page in the
design session and is not in this repository, so its findings are restated under "Findings" and
each one maps to a slice or to a stated reason for leaving it.

## Context

What the review ran: a build of `03668a1` driven through `.claude/skills/run-birdbrain/`, at
1440 by 900 and 1100 by 800, dark theme, on the demo Case. The Capture Session screenshots used
the stand-in state that `e2e/topbar-layout.spec.ts` injects, because Chrome did not complete a
launch in the review sandbox. The extension's own pages, the light theme on screen and a Case
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
- **ADR-0032 rules the VPN indicator and its warnings.** Rule 2 says the top bar shows the
  Egress and whether a VPN is seen, and that the warning offers to continue, to set up a proxy,
  or to stop warning on this network. Rule 3 says starting a Capture Session warns too. Two
  critique proposals change the form of those: a status control that drops the word "VPN not
  seen", and a launch dialog that carries the warning inline. Decisions 2 and 3 rule on both,
  and each slice that builds one amends ADR-0032.
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
  `CaptureDownloadMenu.tsx`, `DataExplorer.tsx`, `CaptureControl.tsx`, `TabPicker.tsx` and
  `captureSessionPanelModel.ts` are `blocking`. `src/renderer/components/layout/**`,
  `src/renderer/components/status/**`, `CaptureDetailsPanel.tsx` and
  `src/renderer/styles/**` are renderer chrome or styling. `StartDialog.tsx`,
  `CaptureSessionDock.tsx`, `CaptureSessionPanel.tsx`, `CaptureMenu.tsx`,
  `CaptureSelectionBar.tsx` and `Sidebar.tsx` do not appear in the list by name; each slice that
  touches one confirms its tier before it starts.

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

Severity is the critique's. "Slice" points into "Slices" below.

| ID | Finding | Severity | Slice |
| --- | --- | --- | --- |
| U1 | During a Capture Session one screen names the browser three times, the Case three times and the timer twice, and has two stop controls | critical | 2.1, 2.2, 5.5 |
| U2 | A first launch takes the launch dialog, a trip to Settings for the Operator name, and a second dialog that repeats the VPN warning | critical | 3.1, 3.2 |
| U3 | Export labels do not name their outputs: "Export evidence report" opens "Export case" and writes an Evidence Package | critical | 4.1, 4.2 |
| U4 | Capturing has no primary control; the only filled accent button on a Case is the list's add button | moderate | 5.4 |
| U5 | The Case action bar holds one label and three buttons at rest and overflows while a session runs | moderate | 5.2 to 5.5 |
| U6 | "VPN not seen" is a permanent amber word in the chrome | moderate | 6.1 |
| U7 | Five columns at 1440 pixels during a session; the page shrinks to 37 percent | moderate | 2.3 |
| U8 | Capture details open on hashes and state the Integrity Status three times | moderate | 7.1 |
| U9 | The Export dialog's primary button is below the fold at 900 pixels of height | moderate | 1.2 |
| U10 | Case settings is reachable only through Share; Investigate has no entry point | moderate | 5.3; Investigate not planned |
| U11 | The app-wide Auto-capture switch sits at the top of a Case's Signals | moderate | 7.4 |
| U12 | The Overview is a second place to edit Selectors, Tags and Notes | moderate | 7.3 |
| U13 | The add menu on Captures holds Recapture, which adds nothing | minor | 1.4 |
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
| H3 | The Overview's Link Map header links to "All notes" | minor | 1.7 |

## Decisions taken

The maintainer accepted all six recommendations on 2026-11-15, in the design session that wrote
this plan. Each entry gives the question, then the ruling.

1. **Does Share keep its own control in the chrome, or move into a menu on the Case name?**
   The 2026-10-27 brief put it in the chrome so sharing is reachable before anyone has joined.
   Ruling: Share moves into the Case menu. The existing coach mark stays, and the menu item
   shows "On this machine only" until the Case is shared. Slice 5.3 builds it.
2. **May the top bar stop printing "VPN not seen" and show the advisory as a coloured dot
   only?** ADR-0032 rule 2 says the top bar shows the Egress and whether a VPN is seen.
   Ruling: yes. The wording stays in the status popover and is added to the capture control's
   menu and the launch dialog, and rule 2 is amended to say so. Slice 6.1 builds it.
3. **May a launch carry the VPN warning inside the launch dialog, with no second dialog?**
   ADR-0032 rule 3 says starting a Capture Session warns. Ruling: yes, for launches only. The
   inline form keeps all three offers from rule 2 (continue, set up a proxy, stop warning on
   this network) and the primary button reads "Launch without VPN". The separate
   `VpnWarningDialog` stays for every other first contact. Slice 3.2 builds it and amends
   rule 3.
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

These are independent of each other and of the bundle. They can start at once.

- [ ] **1.1 Raise faint text to 4.5:1 on dark surfaces (A1).** `--color-text-faint` in the dark
  block of `src/renderer/styles/globals.css`. `#85858e` measures 4.65:1 on `--color-elevated`,
  the lightest dark surface. Check it stays distinct from `--color-text-muted`. The token is
  used in 281 places, so the screenshots cover one screen per section.
- [ ] **1.2 Keep the Export dialog's primary action in view, and drop the filled banners (U9,
  C3).** `ExportDialog.tsx`: the form scrolls and the footer stays fixed. The demonstration
  notice and the Trusted Time preflight notice become text with an icon, readable in both
  themes, which also resolves #1524. `blocking` file: the Evidence impact section says layout
  and colour only, and the existing export specs show the package is unchanged.
- [ ] **1.3 Give a disabled Launch browser a reachable reason (A3).** `CaseActionBar.tsx`: use
  `aria-disabled` with `aria-describedby`, the pattern `ExportMenu.tsx` already uses, so the
  control keeps focus and announces `busyRefusal`'s title.
- [ ] **1.4 Take Recapture out of the add menu (U13).** `CaptureMenu.tsx` keeps "Paste URLs to
  capture". Recapture stays on the Capture's own menu in `CaptureDetailsPanel.tsx` and on
  `CaptureSelectionBar.tsx`. If the add menu is left with one item, the button opens the paste
  dialog directly.
- [ ] **1.5 Name the scope on the Data screen's two Verify buttons (U16).** `DataExplorer.tsx`:
  "Verify all" above the table and "Verify this file" on the pane header. `blocking` file:
  labels only.
- [ ] **1.6 Show a single browser as text in the launch dialog (U15).** `StartDialog.tsx`: the
  select renders only when more than one browser was found.
- [ ] **1.7 Correct the Link Map header link (H3).** `BacklinkMap.tsx`: the card's link reads
  "All notes", the same as the Quick Notes card beside it; it names what it opens instead.

### Phase 2: a Capture Session has one place

Slices 2.1 and 2.2 do not wait for the bundle. They undo part of what #2125 added to the
action bar, so their
pull requests say so.

- [ ] **2.1 The action bar says recording and for how long, and nothing else (U1).**
  `RecordingMark.tsx` drops the source text where the session panel is on screen.
  `SessionControls.tsx` drops the Case name and the source line. `CaseActionBar.tsx` hides the
  disabled Launch browser while a browser is open. `e2e/topbar-layout.spec.ts` expects
  "Launched Google Chrome" in the mark and a `session-source-line`; both expectations move to
  the panel.
- [ ] **2.2 One stop control on screen (U1).** While `CaptureSessionDock` shows the panel, its
  **Stop** is the only stop control and the Capture Session switch does not render. The switch
  stays for a session with no panel, which today is an extension-only session.
- [ ] **2.3 Capture details and the Capture Session share one right panel (U7).** On the
  Captures section, `CaptureSessionDock.tsx` and the details column become two tabs of one
  panel, so the layout stays at four columns. Other sections keep the dock as their only right
  panel. The tab is labelled "Capture Session". Needs the drawing from 0.1. The slice must not
  edit `CaptureControl.tsx`, `TabPicker.tsx` or `captureSessionPanelModel.ts`; if it has to, it
  becomes `evidence-affecting`.
- [ ] **2.4 Say "into this Case" when the Active Case is the one on screen (U1).**
  `CaptureSessionPanel.tsx` names the Case only when the Operator is looking at a different
  one.

### Phase 3: launch in one dialog

- [ ] **3.1 Ask for the Operator name in the launch dialog (U2).** `StartDialog.tsx` replaces
  "Set operator name" and its navigation to Settings with the field itself, saved through the
  same settings mutation and the same validation as the Operator tab.
- [ ] **3.2 One VPN statement per launch (U2, C3).** Decision 3 allows it. The no-VPN line under
  Egress stays, as text without a filled box. The primary button reads "Launch without VPN".
  "Set up a proxy" and "Do not warn on this network" sit beside it, the second shown only when
  the network can be identified. `StartDialog.tsx` stops raising `VpnWarningDialog`; every
  other caller in `src/renderer/lib/vpnWarning.ts` keeps it. ADR-0032 rule 3 is amended in the
  same pull request. `e2e/vpn-warning.spec.ts` gains the launch path.
- [ ] **3.3 Fold the four info tips into one disclosure (U15).** `StartDialog.tsx`: one "How
  this works" row holds the text the `InfoTip`s carry today.

### Phase 4: export through one dialog

Slice 4.1 is copy and can start at once. Slices 4.2 to 4.4 wait for the ruling on the bundle
from 0.1 (decision 5). Decision 6 keeps loose files out of the dialog.

- [ ] **4.1 Use the ruled nouns, show the file type, use one icon (U3, C1, C2).** Every label
  that names an output uses `CONTEXT.md`'s term: Evidence Package, Working Copy, Case Archive.
  The save confirmation in `exportNotice.ts` matches. `ExportMenu.tsx`,
  `CaptureSelectionBar.tsx` and the Signals CSV buttons use one export icon; the viewer's
  Download menu keeps the download icon because it hands over a stored file as it is.
  `ExportDialog.tsx` and `CaptureDownloadMenu.tsx` are `blocking`: copy only. Updates
  `tester-guide.mdx`, `features.mdx`, `e2e/export.spec.ts` and `e2e/case-archive.spec.ts`.
- [ ] **4.2 One "Export" entry and one dialog (U3).** The menu's two items become one. The
  dialog's title follows its scope, and its choice list is: Evidence Package, with a checkbox
  to leave out Operator notes that replaces the third preset; Working Copy; and Case
  Archive, which calls the existing `exportArchive` mutation. The third preset's label names a
  venue, which the writing guide's claim discipline keeps out of the docs; the checkbox retires
  that label. ADR-0010's distinction and
  ADR-0009's full-Manifest line stay as they are. `blocking`: a unit test over the preset table
  shows each choice produces the same `ExportSelection` as the preset it replaces, and the
  export specs show the package bytes are unchanged for the same selection.
- [ ] **4.3 Put Import beside Export.** "Import Case Archive" joins the Case menu from 5.3 and
  keeps its place on the dashboard, under the same noun.
- [ ] **4.4 Reconcile the open redesign issues.** After the ruling on the bundle, rewrite or
  close the rows of #1555 and #1547 it supersedes, and check #846 and #841 against the new
  dialog.

### Phase 5: one row of chrome

Waits for the ruling on the bundle from 0.1, except slice 5.1. Decisions 1 and 4 fix the
Case menu's contents and the primary control's name.

- [ ] **5.1 A shared menu component (C5).** `src/renderer/components/ui/menu.tsx` on the
  dropdown menu `radix-ui` already ships. `ExportMenu.tsx`, `CaptureDownloadMenu.tsx`,
  `CaptureMenu.tsx` and the Capture actions menu in `CaptureDetailsPanel.tsx` move to it, which
  also answers #938. Can land before the bundle: it changes no layout.
- [ ] **5.2 A labelled rail that holds Settings (H1).** `Sidebar.tsx`: a label under each icon,
  Settings at the foot with the update dot, the `nav-*` tour anchors kept. `TopBar.tsx` loses
  the gear.
- [ ] **5.3 The Case name opens a Case menu (H2, U10).** `TopBar.tsx`: Switch Case, Share or
  Members, Export, Import Case Archive, Case settings. The command palette keeps its shortcut.
  The `caseswitcher` and `export` tour anchors and `ShareCoachMark.tsx` move to the new
  targets; `tourSteps.ts` and `e2e/onboarding-tour.spec.ts` follow.
- [ ] **5.4 One primary capture control in the top bar, on every screen (U4, C4).** At rest it
  is a filled Launch browser button (decision 4), with a menu for pasting URLs and two status
  rows,
  the extension and the Egress. While a Capture Session runs it becomes the recording mark and
  shows or hides the Capture Session tab. It replaces `CaptureSessionButton.tsx` on the
  dashboard and in Settings.
- [ ] **5.5 Remove the Case action bar (U5, U1).** `CaseActionBar.tsx` and the switch in
  `SessionControls.tsx` go. An extension-only session stops from the capture control's menu.
  `e2e/topbar-layout.spec.ts` is rewritten for one row.
- [ ] **5.6 Docs and record.** `tester-guide.mdx` and `features.mdx` describe the new positions.
  The index in `docs/design-handoff/README.md` gains the bundle's row and notes that it
  supersedes the 2026-11-08 top bar.

### Phase 6: status tiers

- [ ] **6.1 Advisory, problem and nominal look different (U6, A2).** Decision 2 allows it.
  `statusGroupModel.ts` gains an advisory tier: a VPN not seen, or a failed VPN check, colours
  its dot and adds no icon or word. "Egress unknown" and capture failures keep the icon and
  the word at every width, so the icon's presence is the signal. The accessible name and the
  popover are unchanged. ADR-0032 rule 2 is amended in the same pull request.

### Phase 7: summary first, and pointers instead of copies

- [ ] **7.1 Capture details open on a summary (U8).** `CaptureDetailsPanel.tsx`: the header's
  Integrity Status chip is the one statement at rest. Chain of custody, with Re-verify inside
  it, Identity and Capture environment are collapsed sections, and the panel remembers which
  ones the Operator opened. `e2e` specs that read `custody-section-body` open the section
  first.
- [ ] **7.2 A count of Selector matches on each list row, and more room for the row's controls
  (U14, A4).** `CaptureItem.tsx`: the chip line becomes one count that lists the names on
  hover and focus. The star and the checkbox get 24 pixel targets.
- [ ] **7.3 The Overview points to the sections that own the data (U12).** Waits for the
  ruling on the bundle from 0.1.
  The Selectors and Tags cards show counts and recent changes and link to Signals. Quick Notes
  keeps its input, because jotting from the Overview is the card's purpose.
- [ ] **7.4 Move the Auto-capture switch to Settings (U11).** `AutoCaptureCard.tsx` holds an
  app-wide switch and a per-Case exclusion list. The switch moves to `CapturePreferences.tsx`;
  the exclusion list stays in Signals as a collapsed row. Low priority while passive capture
  is suspended (ADR-0013, ADR-0037).

## Order

1. Phase 1 and slices 2.1, 2.2, 2.4, 3.1, 3.3, 4.1, 5.1 and 7.1 can start at once. None waits
   for the bundle, and 2.1 with 2.2 removes most of the repetition the critique found.
2. Slices 3.2 and 6.1 can also start: each carries its ADR-0032 amendment in its own pull
   request.
3. Slice 0.1 runs beside them, since 2.3, 4.2 to 4.4, 5.2 to 5.6 and 7.3 wait for its ruling.
4. After that ruling, phase 5 goes in the order written: rail, Case menu, Launch browser
   control, then the removal of the action bar. Slices 4.2 and 4.3 go before 5.3, which hosts
   their menu items.
5. Slices 7.2 and 7.4 fit wherever there is room.

## Risks

- **Rework against #2125.** The two-row chrome merged on 2026-11-11. Phase 2 edits it and phase
  5 removes half of it. Slices 2.1 and 2.2 are chosen so their changes survive phase 5.
- **Review cost on evidence paths.** Phase 4 touches two `blocking` files in three slices. The
  slices keep copy changes (4.1) apart from behaviour (4.2) so each review is small.
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
- **The extension's own pages, the light theme, and list density on a large Case.** The review
  did not cover them. Each wants its own pass before any change.
