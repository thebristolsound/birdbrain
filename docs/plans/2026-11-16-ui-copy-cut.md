# UI copy cut

**Status:** active

On 2026-11-16 the maintainer asked for a sweeping cut of the prose in the app: sentences that
add little or nothing go, and what is needed moves to a tip. This plan gives each string a
verdict, screen by screen. The maintainer accepted the first tranche's verdicts on 2026-11-16
(decision 6), so its slices can start. The plan itself changes nothing in the app. Code
references are to `origin/main` at `ae4b50a`.

This is the first tranche: ten screens an Operator meets in ordinary work. "Next tranche" lists
what is left, with counts.

## What was measured

A script read every `.ts` and `.tsx` file under `src/renderer/` and `extension/src/` with the
TypeScript parser and listed each string and each run of JSX text of four words or more. It left
out class names, test ids and style strings. Labels of three words or fewer are not counted, so
a button's name is not in these numbers.

The app holds 905 such strings, about 8,700 words.

| Area | Strings | Words |
| --- | --- | --- |
| Settings | 94 | 1,271 |
| Sharing | 83 | 1,138 |
| Captures | 117 | 926 |
| Notices (`src/renderer/lib/notify.ts`) | 112 | 901 |
| Launch dialog and Capture Session panel | 73 | 715 |
| Data | 73 | 693 |
| The extension's pages | 77 | 662 |
| Onboarding tour | 28 | 408 |
| Signals | 49 | 373 |
| Notes | 30 | 207 |
| Capture routes, the delete dialog among them | 19 | 202 |
| Export | 16 | 185 |
| Everything else | 134 | 1,014 |

The four longest strings are a 129-word confirmation in `DbUtilities.tsx`, an 82-word footer
under the Shared Case ledger and a 74-word notice about network addresses, both in
`memberModel.ts`, and a 71-word paragraph above the Egress choices in `NetworkConfig.tsx`. All
four are in the next tranche.

## The test each string takes

1. A sentence stays on screen only if the Operator would act differently, at that moment,
   without it.
2. No sentence restates its own heading, label or button.
3. A screen states a fact once.
4. A consequence stays in view, in one sentence: something that cannot be undone, something
   sent to a third party, something a site can see. A warning in a tip is not a warning.
5. A statement of what an output proves, or does not prove, stays, once. Its wording is the
   maintainer's, under the writing guide's claim discipline.
6. How a thing works belongs on the docs site. The screen does not carry it.
7. An empty state names the state. It gives no instruction when the control is in view.
8. A tip hangs from a control or a label that is already on screen. No free-standing "i" icon
   holds one. A sentence with no control to hang from is a consequence, which rule 4 keeps in
   view, or how-it-works, which rule 6 sends to the docs.
9. New wording uses the terms in `CONTEXT.md`.

## Verdicts

- **Cut.** The string goes and nothing replaces it.
- **Shorten.** The string stays in view with the wording given.
- **Tooltip.** The wording given moves into a tip on the control it explains.
- **Docs.** The string leaves the app; the docs site carries it if it does not already.
- **Keep.** The string stays as it is, for the reason given.
- **Slice.** A slice of the consolidation plan
  (`docs/plans/2026-11-15-chrome-capture-export-consolidation.md`) already removes or replaces
  it.

## Constraints

- **A tip is not reachable by everyone today.** `InfoTip.tsx` draws a free-standing "i" and
  puts its text in `title` and `aria-label`. A pointer gets it on hover and a screen reader
  reads it. A sighted Operator using the keyboard can focus the "i" and sees nothing. The app
  has 14 uses of `InfoTip` in 8 files and more than a hundred `title` attributes.
  `src/renderer/components/ui/` has a popover and no tooltip, and the `radix-ui` package
  already installed exports one. Every Tooltip verdict below waits for slice C0, which builds
  it. Rule 8 leaves `InfoTip` with no place, so each screen's slice removes its uses and the
  component goes with the last one.
- **Three decision records give strings their content.** ADR-0032 VPN rule 2 and VPN rule 3
  (the second numbered list of its Decision section) say what the VPN warning tells the
  Operator. ADR-0010 says the Working Copy's label has to carry weight. ADR-0009 gives a
  selection its note that the full Manifest ships. A string one of these gives is shortened
  only with the record's wording in view.
- **Some of these files are `blocking`.** In
  `docs/specs/2026-07-31-evidence-affecting-paths-assessment.md`: `ExportDialog.tsx`,
  `CaptureControl.tsx`, `TabPicker.tsx`, `captureSessionPanelModel.ts`, `ImportCaseDialog.tsx`,
  `DataExplorer.tsx`, `ForensicsTab.tsx`, `OperatorConfig.tsx`, `LinksTab.tsx`,
  `WaybackPanel.tsx`, `DatabaseAdmin.tsx` and everything under
  `src/renderer/components/settings/db/`. A pull request that changes a string in one takes
  the `evidence-affecting` label and an Evidence impact section.
- **The mock is the design source.** The maintainer's observation is that much of this prose
  arrived with the design bundles. `docs/design-handoff/README.md` names the 2026-08-21
  standalone as the single design source, so a cut that departs from a bundle's copy supersedes
  it. Decision 1 allows that for copy without a new bundle. This plan did not trace each string
  back to a bundle.
- **Tests and docs quote these strings.** Unit tests and end-to-end specs find controls by
  their text, and `tester-guide.mdx` and `features.mdx` quote some. Each slice updates the ones
  it breaks.
- **The consolidation plan edits some of the same strings.** Slices 3.1, 3.3, 4.1, 4.2, 7.3 and
  7.4. Slice 3.3 folds the launch dialog's three tips into a disclosure; after this cut the
  dialog has no tip, so 3.3 has nothing left to do.

## First tranche in numbers

The counts are of the strings in the tables below, not of every string on the screen. "At rest"
is what stays in view; a tip's words are counted apart.

| Screen | Strings | Words today | At rest after | In a tip | Left to a slice |
| --- | --- | --- | --- | --- | --- |
| Launch dialog | 12 | 127 | 38 | 0 | 17 |
| Capture Session panel and its dialogs | 14 | 247 | 47 | 25 | 0 |
| VPN warning | 2 | 48 | 27 | 0 | 0 |
| Export dialog | 12 | 164 | 61 | 0 | 7 |
| Captures | 10 | 184 | 94 | 0 | 0 |
| Overview | 3 | 18 | 2 | 0 | 6 |
| Signals | 12 | 164 | 71 | 5 | 0 |
| Notes | 10 | 100 | 27 | 0 | 0 |
| Dashboard and a new Case | 6 | 50 | 12 | 0 | 0 |
| Onboarding tour | 18 | 364 | 186 | 0 | 0 |
| **Total** | **99** | **1,466** | **565** | **30** | **30** |

Of 1,466 words, 565 stay in view and 30 wait for a consolidation slice. The other
871 leave view, which is 59 percent, and 30 words of new tips replace some of them.

## Launch dialog

`StartDialog.tsx`, `startDialogModel.ts`. One dialog with three info tips and a sentence under
most of its rows. The title already says what the dialog does and for which Case. After the cut
it has no tip.

| Today | Words | Verdict | Becomes, or why |
| --- | --- | --- | --- |
| "Birdbrain opens the browser for a Capture Session and closes it when the …" (`StartDialog.tsx`) | 15 | Cut | Restates the title. |
| "A new browser profile, which Birdbrain deletes when the browser closes." (`StartDialog.tsx`) | 10 | Shorten | "New profile, deleted on close" |
| "Fixed while the browser is open. Changing it ends the Capture Session." (`StartDialog.tsx`) | 12 | Cut | Settings says it where the Egress is changed. |
| "Change it in Settings → Operator before launching.‹…›" (`StartDialog.tsx`) | 7 | Cut | A tip on a free-standing "i". The row could link to the setting instead. |
| "The browser runs on a browser profile of its own. Pages in this …" (`StartDialog.tsx`) | 19 | Shorten | "Sites can tell that software drives this browser." A tip on a free-standing "i" today. The first sentence repeats the Profile row. The second is a consequence with no control to hang from, so decision 4 makes it a line in the dialog. |
| "Every Capture carries an operator name, so Birdbrain asks for it first." (`StartDialog.tsx`) | 12 | Slice | Slice 3.1 replaces the row with a field. |
| "Set your name before launching." (`StartDialog.tsx`) | 5 | Slice | Slice 3.1. "Not set" already says it. |
| "Starts a Capture Session in ‹…›." (`StartDialog.tsx`) | 4 | Cut | The title names the Case, and the recording mark shows the session. |
| "Joins the running Capture Session in ‹…›." (`StartDialog.tsx`) | 6 | Cut | The button reads "Launch and join". |
| "Birdbrain sees this computer’s network path, not your browser’s. A VPN set up …" (`VpnWarningDialog.tsx`) | 19 | Keep | Shown under Egress here and in the VPN warning. ADR-0032 VPN rule 3 gives this sentence; slice 3.2 amends the rule and can shorten it there. |
| "Only one can be open at a time." (`startDialogModel.ts`) | 7 | Cut | Its title, "A launched browser is already open", is the reason. |
| "The browser was not started. Choose an Egress in Settings → Operator." (`startDialogModel.ts`) | 11 | Shorten | "Choose an Egress in Settings → Network." The Egress is on the Network tab, so the pointer is corrected: see "Raised in review". |

## Capture Session panel and its dialogs

`CaptureSessionPanel.tsx`, `CaptureControl.tsx`, `TabPicker.tsx`, `StopSessionDialog.tsx`,
`LeftoverBrowserNotice.tsx`, `captureSessionPanelModel.ts`. `CaptureControl.tsx`,
`TabPicker.tsx` and `captureSessionPanelModel.ts` are `blocking`. A change to a string in one of
them is `evidence-affecting`, and the wording of a line that says what a Capture holds is the
maintainer's.

| Today | Words | Verdict | Becomes, or why |
| --- | --- | --- | --- |
| "Pick a tab below, or choose one." (`CaptureControl.tsx`) | 6 | Shorten | "No tab chosen" A state, not an instruction: the tabs and the button are beside it. |
| "Scrolls the page in the browser to load content that appears as you …" (`CaptureControl.tsx`) | 27 | Tooltip | "Scrolls the page first to load more of it. The page can see the scrolling." On the "Scroll to load" checkbox, not on an icon beside it. |
| "Birdbrain found more than one tab the shortcut could take, or none in …" (`TabPicker.tsx`) | 22 | Cut | The heading, "Pick the tab to capture.", is enough. |
| "The Capture Session keeps running until you stop it." (`CaptureSessionPanel.tsx`) | 9 | Shorten | "Still running" Shown once the browser has closed. |
| "Launching again joins this Capture Session." (`CaptureSessionPanel.tsx`) | 6 | Cut | The launch dialog's button says so. |
| "It could change how traffic leaves this browser." (`CaptureSessionPanel.tsx`) | 8 | Shorten | "It can route traffic around the proxy." Follows "An extension was added." A consequence, so it stays in view. |
| "Shown only while the Egress is not Direct. With the Egress on ‹…›, …" (`CaptureSessionPanel.tsx`) | 45 | Docs | A long tip. The line above it carries the warning. |
| "Birdbrain did not record this page from its first request, so a Capture …" (`captureSessionPanelModel.ts`) | 18 | Tooltip | "No Transaction Record: recording began after this page's first request." On the "not from first request" label. An evidence statement. |
| "This does not mean every exchange was recorded: a cached response can leave …" (`captureSessionPanelModel.ts`) | 31 | Docs | The inventory lists the gaps it describes. |
| "A private window keeps its own cookies, so Birdbrain never records or captures it." (`captureSessionPanelModel.ts`) | 13 | Shorten | "Private windows are not recorded or captured." |
| "Birdbrain captures http and https pages only." (`captureSessionPanelModel.ts`) | 7 | Shorten | "http and https pages only" |
| "The extension records into the same Capture Session in ‹…›, so stopping ends …" (`StopSessionDialog.tsx`) | 21 | Shorten | "Also ends the extension's session in ‹Case›. The browser profile is deleted." Consequence of a stop. Stays in the dialog. |
| "‹…›, from an earlier run of Birdbrain. Birdbrain cannot reconnect to it and …" (`LeftoverBrowserNotice.tsx`) | 16 | Shorten | "From an earlier run. Not recorded." |
| "Each is from an earlier run of Birdbrain. Birdbrain cannot reconnect to them …" (`LeftoverBrowserNotice.tsx`) | 18 | Shorten | "From earlier runs. Not recorded." |

## VPN warning

`VpnWarningDialog.tsx`. ADR-0032 gives the warning its content, so these lines can be shortened
only in a pull request that amends VPN rule 3, as slice 3.2 does. The amendment slice 6.1 made
left the warning before a contact unchanged.

| Today | Words | Verdict | Becomes, or why |
| --- | --- | --- | --- |
| "The Egress is Direct, so Birdbrain contacts sites from this computer’s own connection. …" (`VpnWarningDialog.tsx`) | 32 | Shorten | "Sites will see this computer's own connection. A VPN on your router or network does not show here." |
| "Birdbrain could not read this network’s router address, so it cannot stop warning …" (`VpnWarningDialog.tsx`) | 16 | Shorten | "This network cannot be identified, so it cannot be muted." |

## Export dialog

`ExportDialog.tsx`. `blocking`. Each export class is described twice: once under its name, and
again in a box under the list. The plan keeps one description per choice and drops the box.
Every line here says what an export holds or proves, so each new wording is the maintainer's and
the pull request carries an Evidence impact section. Slices 4.1 and 4.2 of the consolidation
plan edit the same labels; this cut lands with them, not beside them.

| Today | Words | Verdict | Becomes, or why |
| --- | --- | --- | --- |
| "Verifiable package: Manifest, Certification, captures, screenshots and notes" (`ExportDialog.tsx`) | 8 | Shorten | "For handing over. A recipient can check its integrity." Under "Evidence Package (.zip)". Decision 5. |
| "Non-evidentiary: captures, screenshots and notes — no Certification, no Manifest" (`ExportDialog.tsx`) | 9 | Shorten | "For your own use. No Certification, and a recipient cannot check it." ADR-0010 says this label has to carry weight, so it stays. Decision 5. |
| "Evidence package with everything except operator notes" (`ExportDialog.tsx`) | 7 | Slice | Slice 4.2 replaces the preset with a checkbox. |
| "Evidence package: ships the full signed Manifest chain and the Certification, and appends …" (`ExportDialog.tsx`) | 26 | Cut | Second description of the selected class. |
| "Non-evidentiary working copy: no Certification, no signed Manifest, no verification materials. The export …" (`ExportDialog.tsx`) | 34 | Cut | Second description of the selected class. |
| "Demonstration case — its captures are fixture data seeded by Birdbrain, not collected …" (`ExportDialog.tsx`) | 18 | Shorten | "Demonstration Case: fixture data, not evidence. The package says so." |
| "The full Manifest chain is included." (`ExportDialog.tsx`) | 6 | Keep | ADR-0009's note on a selection. |
| "Manifest — full case chain, never a slice" (`ExportDialog.tsx`) | 6 | Shorten | "Manifest (always the full chain)" |
| "Page archives cannot be left out of a certified package." (`ExportDialog.tsx`) | 9 | Shorten | "Always in an Evidence Package" Reason on a locked checkbox. |
| "Included in the report as archive.org references, labelled corroboration only. The snapshots themselves …" (`ExportDialog.tsx`) | 18 | Shorten | "Listed as archive.org references. Snapshots are not packaged." |
| "none). Export will continue." (`ExportDialog.tsx`) | 4 | Shorten | "none)." The enabled button says the export continues. |
| "Closing this window does not stop the export. A notice with the file's …" (`ExportDialog.tsx`) | 19 | Shorten | "The export continues if you close this." |

## Captures

`src/renderer/components/captures/`, and the delete dialog in
`routes/cases/$caseId/captures.tsx`. Most of the prose here is state: what a tab could not read,
what a check found. Those lines stay. The cuts are hints that sit beside the control they
describe. `WaybackPanel.tsx` and `LinksTab.tsx` are `blocking`, so the pull request that
changes their two rows is `evidence-affecting`.

| Today | Words | Verdict | Becomes, or why |
| --- | --- | --- | --- |
| "Applies to this capture. A tag with this name is reused if one already exists." (`CaptureTextPanel.tsx`) | 14 | Cut | A hint under the tag input. Neither fact changes what the Operator types. |
| "Look up this URL to see archive.org's snapshots of it." (`WaybackPanel.tsx`) | 10 | Cut | The button beside it reads "Look up on archive.org". |
| "Looking up this URL discloses it to archive.org." (`waybackPanelModel.ts`) | 8 | Keep | A disclosure to a third party. Stays in view, not in a tip. |
| "Loaded live from archive.org; not captured, hashed or stored in this case. Pinning …" (`waybackPanelModel.ts`) | 17 | Shorten | "Live from archive.org. Not captured or stored; pinning records the reference only." |
| "Each address below is sent to archive.org, which learns that it was asked about." (`WaybackBatchControls.tsx`) | 14 | Shorten | "Each address is sent to archive.org." |
| "The requests leave over this computer's own connection, because the Egress is set to Direct." (`waybackBatchModel.ts`) | 15 | Shorten | "Sent over this computer's own connection (Egress: Direct)." |
| "It was stored as plain HTML, before captures were kept as MHTML archives. …" (`LinksTab.tsx`) | 21 | Shorten | "Links are listed from MHTML archives only." |
| "This removes the capture and its files from this machine, and cannot be undone." (`captures.tsx`) | 14 | Shorten | "Removes the Capture and its files from this machine. This cannot be undone." |
| "The case manifest is append-only, so this capture's URL, capture time and hashes …" (`captures.tsx`) | 36 | Shorten | "Its URL, capture time and hashes stay in the Manifest and ship in every export that includes the audit trail." Follows "Deleting is not redacting.", which stays. |
| "The case manifest is append-only, so each capture's URL, capture time and hashes …" (`captures.tsx`) | 35 | Shorten | "Their URLs, capture times and hashes stay in the Manifest and ship in every export that includes the audit trail." The same line for several Captures. |

## Overview

`src/renderer/components/overview/`. Little standing prose. Slice 7.3 of the consolidation plan
removes the Selectors input, and its placeholder goes with it.

| Today | Words | Verdict | Becomes, or why |
| --- | --- | --- | --- |
| "click to focus · double-click to open" (`BacklinkMap.tsx`) | 6 | Cut | A legend for two gestures a pointer finds at once. |
| "Jot a quick note for this case…" (`QuickNotesBlock.tsx`) | 6 | Shorten | "Quick note…" Placeholder. The accessible label keeps the long form. |
| "Add a selector, or /pattern/ for a regex…" (`OverviewSelectorsBlock.tsx`) | 6 | Slice | Slice 7.3. |

## Signals

`src/renderer/components/signals/`. The Auto-capture card heads the screen with two sentences
about a feature that is withdrawn. Under the Selectors list a row of five key hints is always on
screen (`↵ edit pattern` and four more); it is five short labels, so the table below does not
count it. The plan takes it off the screen and lists the keys in `features.mdx`.

| Today | Words | Verdict | Becomes, or why |
| --- | --- | --- | --- |
| "Passive capture is suspended in this extension build. No page is captured without …" (`signalsModel.ts`) | 16 | Shorten | "Passive capture is off in this build." Decision 3. Slice 7.4 moves the switch. |
| "Matching pages are never captured for this case, by any route, including manual capture." (`signalsModel.ts`) | 14 | Shorten | "Matching pages are never captured in this Case, even by hand." A consequence. Stays in view. |
| "Only these patterns are excluded for this case; the global ignore list (‹…›, …" (`signalsModel.ts`) | 17 | Shorten | "Replaces the global ignore list." |
| "Applied on top of the global ignore list (‹…›, Settings → Capture Preferences). ‹…›" (`signalsModel.ts`) | 11 | Shorten | "Added to the global ignore list." |
| "matches the text exactly as typed" (`AddSelectorRow.tsx`) | 6 | Cut | The toggle beside it says exact or regex. |
| "No selectors yet — type a pattern above to add the first." (`SignalsOverview.tsx`) | 10 | Shorten | "No Selectors yet." The input is the row above. |
| "No tags yet — name one above to add the first." (`SignalsOverview.tsx`) | 10 | Shorten | "No Tags yet." |
| "coverage · ‹…› most recent captures →" (`SignalsOverview.tsx`) | 4 | Keep | Shown in both list headers. Show it once, in the first. |
| "CSV export is for selectors. Right-click the tag to export its captures." (`SignalDetailRail.tsx`) | 12 | Cut | An instruction standing in for a control. The loose-file plan gives a Tag its export. |
| "Existing matches are never removed." (`SignalDetailRail.tsx`) | 5 | Tooltip | "Adds matches. Never removes one." On "Rescan all captures". |
| "Every capture and note tagged ‘ ‹…› ’ — in every case, not …" (`DeleteTagDialog.tsx`) | 32 | Shorten | "Removes ‹tag› from every Capture and Note, in every Case. This cannot be undone." Three fragments around the Tag's name. |
| "Every capture and note tagged ‘ ‹…› ’ — in every case, not …" (`MergeTagDialog.tsx`) | 27 | Shorten | "Every Capture and Note tagged ‹tag›, in every Case, takes the Tag you pick. This cannot be undone." |

## Notes

`src/renderer/components/notes/`. The same hint about `@` and `#` shows in four placeholders and
again in a footer under the editor.

| Today | Words | Verdict | Becomes, or why |
| --- | --- | --- | --- |
| "Start writing — type @ to link a capture, # for a selector or tag." (`AddNoteModal.tsx`) | 10 | Shorten | "Start writing. @ links, # tags." One wording for all four editors. |
| "Start writing — type @ to link a capture, # for a selector or tag." (`CreateNoteCard.tsx`) | 10 | Shorten | "Start writing. @ links, # tags." |
| "Start writing — type @ to link a capture, # for a selector or tag." (`NoteCard.tsx`) | 10 | Shorten | "Start writing. @ links, # tags." |
| "Start writing — type @ to link captures and notes, # for selectors and tags." (`NoteWorkspaceDetail.tsx`) | 12 | Shorten | "Start writing. @ links, # tags." |
| "links captures & notes ·" (`NoteWorkspaceDetail.tsx`) | 3 | Cut | The footer under the editor. The placeholder says it. |
| "↑↓ to move · ⏎ to insert" (`MentionSuggestionList.tsx`) | 4 | Cut | A list that behaves as lists do. |
| "Applies to this note, and to its capture when the note has one. …" (`NoteSelectionPopover.tsx`) | 28 | Shorten | "Also tags the note's Capture." The second sentence describes how saving works. |
| "Backfill — always runs, over the ‹…› most recent captures" (`NoteSelectionPopover.tsx`) | 8 | Shorten | "Also checks the ‹n› most recent Captures" |
| "Create a note to start writing." (`NotesOverview.tsx`) | 5 | Cut | The empty state has the button. |
| "Try a broader search, or clear the filters on this list." (`NotesOverview.tsx`) | 10 | Cut | Keep "No notes match" and the clear control. |

## Dashboard and a new Case

`src/renderer/components/dashboard/`. `ImportCaseDialog.tsx` is `blocking` and its lines state
what an import checked. They stay.

| Today | Words | Verdict | Becomes, or why |
| --- | --- | --- | --- |
| "Open extension folder reveals the bundled files in your file manager. Follow the …" (`ExtensionBanner.tsx`) | 21 | Cut | Describes the two buttons beside it. |
| "Start a fresh case with" (`RecentCases.tsx`) | 4 | Cut | The card is titled "New Case". The line continues "guided setup". |
| "Choose how this Case begins." (`CaseStartStep.tsx`) | 5 | Cut | The three options under it say it. |
| "Name it and start capturing" (`CaseStartStep.tsx`) | 5 | Cut | "Blank Case" says it. |
| "A one-time copy from a .birdbrain file" (`CaseStartStep.tsx`) | 5 | Keep | Tells import from join. |
| "Paste an invite from the Case’s Owner. Stays in sync." (`CaseStartStep.tsx`) | 10 | Shorten | "From the Owner's invite. Stays in sync." |

## Onboarding tour

`tourSteps.ts`, `WelcomeCard.tsx`. The tour is prose by design, so the test is one sentence a
step and no epithet ("The evidence locker.", "The watchlist.", "Your case narrative."). Two
steps are wrong today: "Four views of every capture" describes a viewer that has five tabs, and
the Selectors step says auto-capture can log pages, which nothing does while passive capture is
withdrawn. Twelve steps become nine: the Selectors, Link Map and Notes detail steps fold into
the screen step before each.

| Today | Words | Verdict | Becomes, or why |
| --- | --- | --- | --- |
| "A quick tour of how evidence gets captured, organized, and exported. Two minutes …" (`WelcomeCard.tsx`) | 21 | Shorten | "A five-minute tour. Skip it at any time." |
| "Right-click any page in Chrome to log it to your active case. Install …" (`tourSteps.ts`) | 25 | Shorten | "Right-click a page in Chrome to capture it into the Active Case. Install the extension below." Three variants of this step share the new first sentence. |
| "Right-click any page in Chrome to log it to your active case. Install …" (`tourSteps.ts`) | 22 | Shorten | "Right-click a page in Chrome to capture it into the Active Case. Install the extension below." |
| "Right-click any page in Chrome to log it to your active case. Install …" (`tourSteps.ts`) | 21 | Shorten | "Right-click a page in Chrome to capture it into the Active Case. Install the extension below." |
| "The evidence locker. This demo case already holds three captures; every page you …" (`tourSteps.ts`) | 30 | Shorten | "Every page you capture lands in this list. The viewer shows what was saved." |
| "The evidence locker. Every page you log lands in the list on the …" (`tourSteps.ts`) | 27 | Shorten | "Every page you capture lands in this list. The viewer shows what was saved." "Pixel for pixel" is a flourish: the viewer scales the screenshot. |
| "Screenshot, full page, extracted text, and archive.org snapshots — one tab each." (`tourSteps.ts`) | 11 | Shorten | "Screenshot, page, text, links and Wayback: one tab each." The title becomes "Five views of every Capture". |
| "Everything you see is scoped to this case. Click the name to switch …" (`tourSteps.ts`) | 18 | Shorten | "Click the Case name to switch Case." |
| "The watchlist. Define selectors — emails, wallets, IPs — and Birdbrain flags every …" (`tourSteps.ts`) | 17 | Shorten | "A Selector flags every Capture that matches it, past and future." |
| "Emails, wallets, panel IPs — matches are highlighted across every capture, and auto-capture …" (`tourSteps.ts`) | 17 | Cut | Repeats the step before it, and its auto-capture clause is false. |
| "Your case narrative. Write up findings here and link them straight to the …" (`tourSteps.ts`) | 17 | Shorten | "Write up findings and link them to the Captures they came from. Type @ to link, # to tag." |
| "Type @ to mention a capture or selector, # for a tag. Mentions …" (`tourSteps.ts`) | 15 | Cut | Folded into the Notes step. |
| "The case at a glance — stats, recent activity, and a map of …" (`tourSteps.ts`) | 15 | Shorten | "Counts, recent activity, and the Link Map of how Notes, Captures, Selectors and Tags connect." |
| "Notes, captures, selectors, and tags, connected by their mentions. Click any node to …" (`tourSteps.ts`) | 16 | Cut | Folded into the Overview step. |
| "Every artifact is hashed on capture and sealed in a signed manifest — …" (`tourSteps.ts`) | 36 | Shorten | "Each Capture is hashed and recorded in a signed Manifest. A package from this demo Case says it is a demonstration." "Sealed" reads as an assurance, which the writing guide asks to avoid. |
| "Every artifact is hashed on capture and sealed in a signed manifest — …" (`tourSteps.ts`) | 21 | Shorten | "Each Capture is hashed and recorded in a signed Manifest. Export the whole Case or a selection." |
| "Start one per investigation — captures, selectors, notes, and exports stay scoped to …" (`tourSteps.ts`) | 22 | Shorten | "One Case per investigation. A demo Case is here to look through." |
| "Start one per investigation — captures, selectors, notes, and exports stay scoped to it." (`tourSteps.ts`) | 13 | Shorten | "One Case per investigation." |

## What stays, by kind

These were read and left alone, and are not in the tables:

- **Outcomes and errors.** What a delete removed and what it could not, why a duplicate was
  refused, what a Wayback batch did. They appear only after something happened.
- **What a tab could not read.** The Links tab's lines about frames it skipped and limits it
  hit. Each says what the list leaves out, which rule 5 keeps.
- **What a check found.** The lines in `fieldHitCheckModel.ts`, the import dialog's three
  checks, and the legacy Capture note in `ForensicsTab.tsx`.
- **Refusals in the launch dialog.** The titles and details in `startDialogModel.ts`, apart
  from the two in the table.

## Next tranche

Not yet judged. The counts are from the same measurement.

| Area | Strings | Words | What to expect |
| --- | --- | --- | --- |
| Settings | 94 | 1,271 | The Egress paragraph (71 words), the database utilities and their confirmations, the Personas and timestamp disclosures. Many are consequences that stay, shortened. `OperatorConfig.tsx` is `blocking`, and so is `settings/db/`, which holds `DbUtilities.tsx`. |
| Sharing | 83 | 1,138 | `memberModel.ts` holds the relay, fingerprint, invite and ledger explanations. The network-address notices are consequences; the ledger footer (82 words) is how-it-works. |
| Data | 73 | 693 | Mostly statements of what is and is not anchored. `DataExplorer.tsx` is `blocking`. |
| The extension's pages | 77 | 662 | The popup's reassurance paragraph, the options page's 52-word screenshot note, the page-status lines. |
| Launch dialog and panel, the rest | 48 | 360 | `FoundBrowsers.tsx`, which is under `launchedBrowser/` and shows in Settings, with a 54-word tip, the panel's problem notices and the launch refusals. Most of the last two stay. The two counts are unverified: the area's 73 strings and 715 words, less the launch dialog's and the panel's rows above, leave 47 and 341. |
| Diagnostics and the report dialog | 12 | 171 | What the bundle holds and what it discloses. |
| Investigate | 17 | 142 | Not reachable in a release; judge it with the engine work. |
| The extension install steps | 14 | 128 | A procedure, so prose by design. One pass for length. |
| Notices | 112 | 901 | No cut planned. They are one line each and appear only when something happened. |

## Slices

The first tranche's verdicts are accepted (decision 6), so the slices below can start, each
after whatever its own entry says it waits for. Each slice is one pull request with before and
after screenshots, the tests and docs it breaks, and ten files or fewer. Each adds its line to
the index in `docs/design-handoff/README.md` (decision 1) and moves any text marked Docs into
`features.mdx` (decision 2).

- [ ] **C0. A tip that opens on focus.** `src/renderer/components/ui/tooltip.tsx` on the
  tooltip `radix-ui` already ships. It wraps a control or a label, shows on hover and on
  keyboard focus, and gives its text to a screen reader. No string changes. `InfoTip.tsx` is
  not rebuilt on it: decision 4 retires the free-standing icon, one screen at a time.
- [ ] **C1. Notes.** The four placeholders, the footer and the list hints.
- [ ] **C2. Signals.** With slice 7.4 of the consolidation plan if it has not landed.
- [ ] **C3. Dashboard, new Case and Overview.**
- [ ] **C4. Onboarding tour.** Twelve steps to nine, and the two false statements corrected.
  `e2e/onboarding-tour.spec.ts` and `tests/renderer/tourSteps.test.ts` follow.
- [ ] **C5. Launch dialog and VPN warning.** Removes the dialog's three `InfoTip`s, so it does
  not wait for C0. Lands with slices 3.1 and 3.2 of the consolidation plan. Slice 3.2 amends
  ADR-0032 and so carries the shortened warning.
- [ ] **C6. Captures and the delete dialog.** `evidence-affecting`: `WaybackPanel.tsx` and
  `LinksTab.tsx` are `blocking`.
- [ ] **C7. Capture Session panel.** After C0. `evidence-affecting`: three of its files are
  `blocking`.
- [ ] **C8. Export dialog.** `evidence-affecting`. Lands with slices 4.1 and 4.2 of the
  consolidation plan, so the dialog's wording changes once. The two descriptions are
  decision 5.

C1 to C4 touch no `blocking` file. C1, C3 and C4 wait for nothing; C2 needs C0, for the tip on
"Rescan all captures". C4 is worth doing first: it corrects two untrue statements in the
tour. C5 removes or corrects one more, the pointer to Settings → Operator for the Egress.

## Decisions taken

The maintainer ruled on this plan's five questions on 2026-11-16, and then on its verdicts.

1. **Does a copy-only cut supersede a design bundle's wording without a new bundle?** Ruling:
   yes. No new bundle for copy alone. Each slice adds a line to the index in
   `docs/design-handoff/README.md` naming the screens whose copy it replaced.
2. **Where does how-it-works text go when it leaves a screen?** Ruling: `features.mdx`, where
   the page does not already say it, and nowhere in the app.
3. **Which word does the app use for passive capture today?** Ruling: "off in this build". The
   Signals card's line becomes "Passive capture is off in this build."
4. **Is one tip per dialog or panel the right limit?** Ruling: no count. A tip hangs only from
   a control or label that is already on screen, and no free-standing "i" icon holds one. This
   is rule 8. What the critique counted as clutter was the icons, not the text behind them, and
   a count would have refused the Capture Session panel its two tips, on the "Scroll to load"
   checkbox and on the "not from first request" label. The launch dialog's "Sites can tell that
   software drives this browser." has no control of its own and is a consequence, so it is a
   line in the dialog.
5. **What do the two export choices say under their names?** Ruling: by purpose. Evidence
   Package: "For handing over. A recipient can check its integrity." Working Copy: "For your
   own use. No Certification, and a recipient cannot check it." The plan's first proposal
   called a Working Copy not evidence, which is not the app's to decide (ADR-0043). The ruled
   wording follows `CONTEXT.md`, which defines a Working Copy as an export for the Operator's
   own use, and avoids the bare word "verified", which the writing guide rules out.

6. **Are the first tranche's verdicts accepted as written?** Ruling: yes, all 99, with the
   wording each row gives. A later tranche's verdicts wait for a ruling of their own.

## Raised in review

A review of the pull request that added this plan, #2236, raised three points about accepted
verdicts. The first is a correction of fact. The other two change what a ruled verdict says,
so they are the maintainer's.

- **Corrected: the Egress is on the Network tab.** The launch dialog's refusal row above read
  "Choose an Egress in Settings → Operator." The Egress setting is on the Network tab
  (`SECTION_TABS` in `SettingsView.tsx`), so the row now reads "Settings → Network". The app's
  own strings point at Operator today in `startDialogModel.ts` and `StartDialog.tsx`; C5
  corrects the one it rewrites and cuts the tip that holds another. A third, "Check the proxy
  in Settings → Operator." in `startDialogModel.ts`, is among the refusals this plan leaves
  alone, so it keeps the wrong tab until a slice corrects it.
- **Open: the scrolling line moves into a tip.** The Capture Session panel's row for "Scroll
  to load" puts "The page can see the scrolling." in a tip. That is something a site can see,
  and rule 4 keeps a consequence in view and says a warning in a tip is not a warning.
  Decision 4 names this tip. Whether the sentence stays beside the checkbox is not ruled.
- **Open: the tour's Selector sentence.** The row reads "A Selector flags every Capture that
  matches it, past and future." Creating a Selector checks only the 500 most recent Captures
  of the Case (`RETRO_MAX_CAPTURES` in `src/shared/constants.ts`, applied in
  `selectorLifecycle.ts`). Older Captures match only when the Operator runs the backfill, and
  new Captures are matched as they arrive. The sentence overstates the first of those. Its
  wording is not ruled.

## Not in this plan

- Notices and error messages.
- Labels of three words or fewer.
- The casing of older strings, which write "capture" and "case" where `CONTEXT.md` has Capture
  and Case. A rewritten string uses the ruled term; the rest wait for a pass of their own.
- The docs site's own prose.
