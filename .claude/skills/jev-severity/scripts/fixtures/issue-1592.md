A full review pass of the desktop app after the 16 changes merged on 24 and 25 September. Everything from the pass is in this one issue, as the maintainer asked.

The most serious problem is older than these changes, and wider than the issue that already tracks part of it. Every case brought in from a case file points at the wrong place for its saved web pages. That includes the demo case every new user gets. The Page view never finishes loading. Re-checking a capture says its file is missing. The case summary then counts that capture as tampered. An evidence package exported from such a case fails the checker that ships inside it.

Three problems are new in this round:

- The search box's results stay open over the screen until Escape is pressed.
- On the dashboard's extension card, the two button labels now wrap onto two lines that spill out of the buttons.
- The evidence table shows capture times in UTC without saying so, beside local times elsewhere.

Where these changes met each other, they held up. That covers the export dialog, keyboard focus in dialogs, the dark default and the exhibit labels.

The findings are grouped by screen below. Each one gives a severity, whether it touches evidence, where it is and how to reproduce it.

<details>
<summary>Imported cases and the demo case: blocking</summary>

Severity key: **B** blocking-for-beta, **S** should-fix, **P** polish. **Ev** means the finding is evidence-relevant (the path list in `docs/specs/2026-07-31-evidence-affecting-paths-assessment.md`). "Run" means reproduced in the built app; "code" means found by reading the code only.

| # | Sev | Ev | Finding | Where | Repro | Seen |
|---|---|---|---|---|---|---|
| 1 | B | yes | **Import copies each capture's stored page path verbatim, so every imported case points at the source install's case and capture ids.** #1521 records this for the demo case and a pre-schema-6 archive. It is wider than that: a case file this build exports and re-imports does the same. On another install, or once the source case is deleted, the page file cannot be found. On the same install, the imported copy silently reads *the source case's* file, and verification passes against the wrong case's bytes. | `src/main/services/db/captureRepo.ts:492` (the `mhtml_path` column falls through `cap[c.column]`); readers: `src/main/ipcHandlers.ts:878-884`, `src/main/services/captureLifecycle.ts:397-406` | (a) Fresh profile: open the demo case, select any capture, open the Page tab. (b) Create a case and capture a page. Export it as a case file, import it back, then call `captures.list` on the new case: `mhtmlPath` begins with the *source* case id. | run |
| 1a | B | yes | Symptom of 1: the Page tab shows "Loading MHTML..." forever, because the path resolves to null and the viewer has no missing-file branch. #1128 described this display half and was closed by the stale-issue sweep, not fixed. The tour's first card tells new users that "the viewer on the right shows exactly what was saved". | `src/renderer/components/captures/MhtmlViewer.tsx:44-46` | Fresh profile, demo case, capture 3, Page tab. Still loading after 6 s. | run, `14-viewer-page-dark-6s.png` |
| 1b | B | yes | Symptom of 1: Re-verify on any demo capture returns `status: "missing"` (ENOENT on `captures/8726545c-…/<id>.mhtml`) while the file sits on disk under the new case id. The rail badge flips to **Missing**. | `captureLifecycle.ts:397-406` | Demo case, capture 3, Chain of custody, Re-verify. | run, `15-reverify-imported-capture.png` |
| 2 | B | yes | **The case summary's Evidence Integrity bar labels missing and chain-broken captures "Tampered".** After 1b, the demo case reads "0 Verified · 2 Unverified · 1 Tampered" for a file nobody altered. On this tool, a false tamper claim is the worst copy class. The Data screen's own strip says "tampered, missing or chain-broken" correctly. | `src/renderer/components/overview/overviewModel.ts:54`, `src/renderer/components/overview/VerifyBar.tsx:10` | After 1b, open Overview. | run, `41-light-overview.png` |
| 3 | B | yes | **An exported evidence package of an imported case fails its own `verify.sh`, while the export dialog calls it a "Verifiable package".** (a) Demo case, Full evidence bundle: step 2 fails for entries 0-2 ("signature does not verify under signing-public-key.pem"). Those entries are signed by the fixture's key, but the package ships only the exporter's public key. (b) A case exported, re-imported on the same install (ids remapped), then exported again: step 5 fails with "pages/0541e57a….mhtml is missing". The package names the page file by the *new* capture id, but the signed chain names the original. A native case exported directly passes every step. Related, not the same: #1472 (signature lookup for remapped captures) and #1278 (exhibit numbers across a round trip). | `src/main/services/export.ts:1237-1238` (page path by current id); key shipping in the package builder | Stub the save dialog (see the run notes block), export the demo case, unzip it, run `bash verify.sh`. | run |

</details>
<details>
<summary>Top bar: search and the capture status popover</summary>

| # | Sev | Ev | Finding | Where | Repro | Seen |
|---|---|---|---|---|---|---|
| 4 | S | no | **New in #1577: the search results dropdown never closes on an outside click, on selecting a capture, or on navigating to another screen.** It renders whenever the query is non-empty, and only Escape in the field or the clear button empties the query. It stays painted over the Notes editor's title and toolbar, and collides with the mention popup. | `src/renderer/components/search/SearchBar.tsx:97` | Type `escrow` in the top-bar search, click a capture in the list, then click Notes in the sidebar. The dropdown is still open over the note. | run, `85-search-dropdown-stays-open.png`, `92-mention-popup-inline-create.png` |
| 5 | P | no | Arrow keys do nothing in the results. Tab does reach the result buttons. Escape from the field drops focus to the page body. | `SearchBar.tsx:77` | Type a query, press ArrowDown then Enter. Nothing happens. | run |
| 6 | P | no | The capture pipeline popover ignores Escape. An outside click on the sidebar does close it. | `src/renderer/components/status/CaptureHealth.tsx:109-120` (mousedown only, no key handler) | Click the activity chip in the top bar, then press Escape. | run, `30-health-popover.png` |

</details>
<details>
<summary>Dashboard</summary>

| # | Sev | Ev | Finding | Where | Repro | Seen |
|---|---|---|---|---|---|---|
| 7 | S | no | **Regression from #1580: the extension card's "Setup Guide" and "Open extension folder" buttons wrap their labels onto two lines, which overflow the new fixed 28px button height.** Before #1580, vertical padding let the button grow. It happens at 1440px wide at the compact and comfortable steps (default not measured), and at 900px it is worse (scroll height 38 against 28). A sweep of every screen at 1440 and 900 found no other button with this problem. | `src/renderer/components/dashboard/ExtensionBanner.tsx:81` (Setup Guide, `h-7`); Open extension folder uses the `Button` default size `h-7` from `src/renderer/components/ui/button.tsx:30` | Fresh profile, dashboard, scroll to "Install the Browser Extension". | run, `10-dashboard-dark.png`, `04-tour-step-01.png` |

</details>
<details>
<summary>Case summary (Overview)</summary>

| # | Sev | Ev | Finding | Where | Repro | Seen |
|---|---|---|---|---|---|---|
| 2 | B | yes | "Tampered" label, see the imported-cases block. | | | |
| 8 | P | no | Code only (known pattern): the count-up shows a real "0 Captures" for about 700ms on the first visit of a session. Screen readers get the true value. | `src/renderer/components/overview/MetricRow.tsx:56` | Open Overview for the first time after launch. | code |

</details>
<details>
<summary>Captures list and viewer</summary>

| # | Sev | Ev | Finding | Where | Repro | Seen |
|---|---|---|---|---|---|---|
| 1a, 1b | B | yes | Page tab and Re-verify on imported captures, see the imported-cases block. | | | |
| 9 | S | no | Code only: while the content read is loading, or after it fails, the Screenshot tab says "Screenshot may not have been captured or exceeded the size limit", and the Text tab says "No text content available". #1579 and #1576 both reworked this branch and kept the fallback. The sibling of #951. | `src/renderer/components/captures/CaptureViewer.tsx:81, 305-307, 334` | Open a capture on a slow or failing content read. | code |
| 10 | P | yes (presentation only) | Code only: the pin note textarea has `outline-none` with no replacement, so the #1586 focus ring never shows. The saved-pin box does not take focus when it opens, so Escape works only after tabbing into it. | `src/renderer/components/captures/annotation/PinCommentPopover.tsx:77, 60-65` | Place a pin, then tab into its note. | code |
| 11 | P | no | At 900px the list's title column shows about six characters ("Regulator ...") next to the thumbnail, star and tag chips. | captures list row layout | Resize the window to 900px and open Captures. | run, `80-w900_cases_D_captures.png` |

The Text tab's selection bar (#1579 inside #1576) works: a drag-select over the escrow address offers Selector and Tag at the right place (`94-text-tab-drag-select.png`).

</details>
<details>
<summary>Evidence table (Data)</summary>

| # | Sev | Ev | Finding | Where | Repro | Seen |
|---|---|---|---|---|---|---|
| 12 | S | yes | **New in #1574: the CAPTURED column prints UTC with no zone marker.** The same capture reads "2026-09-25 04:54" there, "9/24/2026, 9:54:40 PM" (local, no zone) in the capture rail, and "Fri, Sep 25, 2026, 4:54 AM UTC" in the Page tab header. That is two calendar dates for one instant. #1520 covers the rail half. | `src/renderer/components/data/dataTableModel.ts:314-318` (`formatStamp`), `src/renderer/components/data/ArtifactTable.tsx:192`; rail: `src/renderer/components/captures/ForensicsTab.tsx:59-60` | On a machine west of UTC, capture a page in the evening and compare the Data row with the capture rail. | run, `27-native-data.png`, `24-native-viewer-screenshot.png` |
| 13 | S | yes | Code only: a failed inventory read shows "No exceptions among the verified rows." under Integrity Exceptions, and "No files under this node." elsewhere. A failed ledger read shows "Loading the ledger…" forever. The file never reads `isError`. This is older than #1574, which kept it. | `src/renderer/components/dashboard/cases/DataExplorer.tsx:117, 122, 523-526, 553-562` | Make the inventory call fail (for example with a locked database), open Data, then Integrity Exceptions. | code |
| 14 | P | yes | With a long title, the detail strip truncates the citation to "Exhibit 1 / …" while the title wraps to two lines. | detail strip header | Capture a page with a 150-character title and select it in Data. | run, `27-native-data.png` |
| 15 | P | no | "1 lines · extracted at capture". | `DataExplorer.tsx:351` | Select a one-line capture. | run |
| 16 | P | no | The rail's "Captures" node reads 6 for a case with 3 captures, because it counts the thumbnails as well. | Data sources tree | Demo case, Data. | run, `45-light-data.png` |

</details>
<details>
<summary>Selectors and tags (Signals)</summary>

| # | Sev | Ev | Finding | Where | Repro | Seen |
|---|---|---|---|---|---|---|
| 17 | P | no | The Auto-capture card shows a raw issue reference to users: "…for when it returns (#600)." | `src/renderer/components/signals/signalsModel.ts:123` | Open Signals. | run, `28-native-signals.png` |
| 18 | S | no | Code only: the selector filter fails open. When the matching-captures read fails, Captures shows every capture under a strip that still names the selector. The tag filter was made to fail closed; this one was not. | `src/renderer/hooks/useSelectorFilters.ts:20-24` | Choose "Show matches in Captures" while that read fails. | code |

The keyboard walk of the delete-selector dialog passed: focus opens on Cancel, Tab stays inside, and Escape returns focus to the row (`96-selector-delete-dialog.png`).

</details>
<details>
<summary>Notes and mentions</summary>

| # | Sev | Ev | Finding | Where | Repro | Seen |
|---|---|---|---|---|---|---|
| 19 | P | no | The note list says "No linked capture" on a note whose Context panel lists "Links out · 1" to capture 3. The label means "not created from a capture", but it reads as "links to nothing". | `src/renderer/components/notes/notesWorkspaceModel.ts:56` | Demo case, Notes, "Next steps". | run, `43-light-notes.png` |
| 20 | P | no | Opening the note delete confirm from the keyboard drops focus to the page body, because the button unmounts. This is the same class as the Signals row in the 2026-09-19 UI pass. | notes editor header | Focus the trash icon and press Enter. | run, `97-note-delete-dialog.png` |
| 21 | S | no | Code only, partly known: mention inline-create can make duplicates. Before the notes or selectors list loads, or after it fails, `@Existing note` offers only "Create", and Enter makes a second note. `#example.com.` also creates a second selector on an existing pattern, because trailing punctuation is stripped on save but not in the exists check. #1576 lists the label and URL cases only. | `src/renderer/components/notes/mention/mentionModel.ts:441-448`, `useMentionCreate.ts:27-35` | Type `#<existing pattern>.` and press Enter. | code |
| 22 | P | no | Code only: the hover peek reads "0 hits" and "0 captures" while those counts are missing. | `mentionModel.ts:294, 467-470` | Hover a mention before the counts load. | code |

</details>
<details>
<summary>Export</summary>

| # | Sev | Ev | Finding | Where | Repro | Seen |
|---|---|---|---|---|---|---|
| 3 | B | yes | Imported cases fail the bundled checker, see the imported-cases block. | | | |
| 23 | S | yes | Partly run: the "Export written" notice is now the only place the file path appears, since #1578 removed the Done view. Its subtitle is one truncating line, capped at 520px, with no hover title, and it closes after 6 s. A short path showed in full (`63-export-progress.png`). The code caps long paths, so the file name is lost on a typical nested path. | `src/renderer/components/ui/toaster.tsx:66`, `src/renderer/components/export/ExportDialog.tsx:205` | Export a case with a long name into a nested folder. | run (short path), code (long path) |

The export dialog's keyboard walk passed after the #1578 and #1586 merge. Focus opens inside, Tab cycles inside across 22 presses, Escape closes it, and focus returns to Export.

</details>
<details>
<summary>Settings</summary>

| # | Sev | Ev | Finding | Where | Repro | Seen |
|---|---|---|---|---|---|---|
| 24 | P | no | At the comfortable density, each settings nav label overflows its 165px rail item by 4px. | settings nav rail | Choose Appearance, then Comfortable, and look at the rail. | run |
| 25 | P | no | Observed, not diagnosed: Diagnostics logged 9 main-process freezes of 2-3.4 s, about every 35 s, over 5 minutes. This may be the virtual display the review ran under. It is worth one check on real hardware. | Settings, Diagnostics, Responsiveness | Leave the app idle for 5 minutes, then open Diagnostics. | run, `98-settings-dark-diagnostics.png` |

</details>
<details>
<summary>Known problems confirmed still present</summary>

These are not new reports. I confirmed each one at runtime or in code at 6849b833.

- #1521, the demo case's exhibits read as missing. It is wider than filed (finding 1).
- #1520, local time with no zone in the capture rail (finding 12 adds the Data column).
- #1590, "Search could not run on this text" for `nightjar-exchange.invalid` (`83-topbar-search-domain.png`).
- #1543, the wizard still opens the new case.
- The #1577 gap: the sidebar still renders on the New Investigation wizard (`20-new-case-wizard-dark.png`).
- The #1581 gap: the Appearance helper says the captures screen does not respond to density, but its rows visibly re-space at Comfortable (`52-light-captures-comfortable.png`, `55-light-settings-appearance-comfortable.png`).
- The #1586 gap: Escape during the tour closes it and leaves focus on the page body.
- The #1573 gap: the delete-selector dialog reads its count from `signal.count`, which is 0 while counts load or fail (code).
- The #1572 gap: under the OS reduced-motion setting alone, controls with their own transitions still fade during a theme switch (code).
- The 2026-09-19 pass, line 54: at 900px the search box covers the case name (`80-w900_cases_D_signals.png`).
- The 2026-09-19 pass, line 136: two adjacent "All time" range controls in Wayback (`14-viewer-wayback-dark.png`).
- The 2026-09-19 pass, line 308: the Export menu has no arrow-key movement.

</details>
<details>
<summary>Where these changes met each other: checks that passed</summary>

- #1578 export dialog with #1586 focus: the trap, Escape and focus return all passed at runtime. By code, the `mounted` ref stops a late completion from closing a reopened dialog.
- #1577 search with #1572 dark default: tokens only, and the result, empty and failure rows render in both themes (`81`-`83`).
- #1579 Text tab inside #1576's selection panel: the selection bar is positioned correctly and offers Selector and Tag.
- #1571 citations in #1574's table and #1579's rows: by code, every renderer site uses the resolved citation, and none prints a bare number. The member prefix shows nowhere yet, because no case can be shared. The machine-readable export files carry only the bare number (a #1571 gap).
- Theme parity: across the screens shot in each theme (dark: dashboard, overview, captures and all viewer tabs, Data, Signals, Notes, Settings, import dialog; light: dashboard, overview, viewer, Notes, Signals, Data, Settings, export dialog), no hard-coded single-theme surface turned up. By code, the only raw colours added are status colours.
- Density: every site #1581 claims reads the density tokens, by code and in `51`-`54` at Default and Comfortable.
- Files that several of these changes touched: by code, each later merge kept the earlier change's additions.

</details>
<details>
<summary>How this was run, and what was not checked</summary>

Build: a detached worktree of `origin/main` at 6849b833 in `/tmp/bb-ui-review`, on Node 20.20.2 via `mise exec`, with `pnpm install --frozen-lockfile` and `pnpm build`, both exiting 0. The app ran under `xvfb-run` with `--remote-debugging-port`, driven over CDP by Playwright. It started from a fresh profile, so the demo case was seeded by the real first-launch path, plus a hand-made case with long and HTML-bearing titles. The export and case-file round trip used two throwaway specs, `e2e/zz-review-export.spec.ts` and `e2e/zz-review-roundtrip.spec.ts`. They are uncommitted and stub `dialog.showSaveDialog` and `dialog.showOpenDialog`. `verify.sh` ran from each unzipped package.

Screenshots: `/tmp/bb-ui-review-notes/shots/` on the maintainer's machine, about 70 PNGs named by screen, theme and density. They are session-only and not committed. The notes are `/tmp/bb-ui-review-notes/static-review.md` (the code-read pass) and `known-gaps.md` (every PR's held and deferred items, which I did not re-report).

Not checked:
- The Chrome extension, which none of the 16 changes touched.
- Screen readers.
- Windows and macOS.
- Reduced motion at runtime (code only).
- The annotation pin flows beyond the code read. Their known gaps are listed on #1579 and #1591.
- Wayback with an archived URL. Only the honest "No snapshots found" path was seen, and archive.org's own index agreed it was empty.
- A pixel comparison against the design export. The row-by-row reconciliation plan already covers mock fidelity, so this pass spot-checked the redesigned screens only.

</details>

