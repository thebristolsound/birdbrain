# Design review: launcher build (#1831, PR #2056)

Date: 2026-11-04. Answers `docs/specs/2026-11-04-launcher-build-design-review-brief.md`. Reviewed
against `docs/design-handoff/2026-11-01-launched-browser-revision/` (`Launched Browser.dc.html`,
`HANDOFF.md`) from the 35 screenshots in `screenshots/`. Verdicts: **Match**, **Accept as built**,
or **Change** (with what and why). Pieces the brief excludes (the Capture control, the strip's
Capture button, the tab picker, the shortcut, the "from first request" chip, the Persona picker,
the Selector column, the passive options) are not judged.

Changes that need a drawing are redrawn on the canvas, keeping their letters: `1c`, `1g`, `1j`,
`1p`, `2c`, `2d`. The revised canvas is in the design project and a copy sits beside this file.

Count: 12 Match, 8 Accept as built, 12 Change. None of the Changes blocks the step; four are
one-line copy fixes (the switch's source line, the stop confirmation, state 4's footer, state 11).

## S1. Found browsers in Settings (`1a`)

| Piece | Shots | Verdict | What and why |
| --- | --- | --- | --- |
| Row before a launch | `02` | Accept as built | A plain row with one browser found is right: a radio with one option is a control that does nothing. When two or more are found, draw the radios as `1a` does, since the row then chooses the default for the start dialog. |
| Row after a launch | `15` | Match | Version in mono beside the name, "from its last launch" at the right, as drawn. |
| No browser found | `22` | Match | "Birdbrain found no supported browser in the usual install folders." says what was searched; better than the canvas's silence. |

## S2. Start dialog (`1b` to `1e`, `2b`)

| Piece | Shots | Verdict | What and why |
| --- | --- | --- | --- |
| Case action bar, nothing running (`2b`) | `01` | Match | **Launch browser** alone, right-aligned, bar present with no extension. |
| Dialog body (`1b`) | `03`, `35` | Accept as built | The subtitle reads "Birdbrain opens the browser for a Capture Session and closes it when the Capture Session ends." in place of the drawn first-request line. Right for this step: the record of how a page loaded is #1832's to claim. When #1832 lands, the subtitle takes the drawn line with its limit. "Profile" as a row label for the browser profile is a working phrase, not the Persona term, so it passes; it becomes the Persona row in #1833. The native select with "not launched yet" under it is fine. |
| No-VPN line (`1c`) | `03`, `35` | Accept as built | The #2037 wording replaces the placeholder as the brief required. Drawn as a boxed line with a glyph; built as two lines of `warning-fg` text with no box. The words carry the limit, so colour is not the only cue. Readable in light (`35`). |
| Session warning over the dialog (`1c`) | `04` | Change | The Operator reads the same sentence twice and presses **Continue** right after **Launch**. Fold #2037's three actions into the start dialog: under the no-VPN line, a **Set up a proxy** link and a **Stop warning on this network** checkbox; **Launch** is the Continue. Redrawn in `1c`. If #2037 requires its own modal for every Capture Session start, accept the sequence but suppress the start dialog's no-VPN line, so the fact is stated once. |
| Checklist (`1e`) | `05`, `06` | Match | Proxy first, then browser, then the first-tab check, in the order the build runs them; **Cancel** as a link. "Show the window" is not a drawn step in the build; nothing lost. |
| Palette row | `26` | Match | One row among the action rows; stays offered while a browser is open and leads to state 4. |

## S3. Capture Session panel (`1f`, `1g`, `2a`, `2c`, `2d`)

| Piece | Shots | Verdict | What and why |
| --- | --- | --- | --- |
| Rail content (`1f`) | `07`, `34` | Accept as built | Header, "Launched Chromium · Direct", "Into Ferry Line", tab list with title and URL, as drawn minus the capture target (#1832). Two notes for #1832, not this step: `about:blank` is listed as an ordinary tab and will need the "never captured" muted row the canvas gives `chrome://` pages; "Into Ferry Line" gains "· n Captures so far" once Captures come from this browser. |
| Switch source line (`1i`) | `07`, `08` | Change | The label after the switch reads "Ferry Line", the Case, where `1i` names the source: "Launched Chromium · ‹Persona›". The Case is already in the breadcrumb beside it, so the line repeats what the Operator can see and omits what they cannot. If "Ferry Line" is the switch's existing Active Case label for the extension, keep it and append the source: "Ferry Line · Launched Chromium". |
| Rail at 1440 (`1f`) | `08` | Change | Both panels dock, within the minimums, but the viewer is squeezed to about 370 and its title truncates to "C.". The list (about 290) and details (about 390) hold their saved widths while the viewer takes the loss. Rule: while the rail is docked, the viewer keeps at least 480; the list and details give way toward their minimums first, and the details panel folds before the viewer drops below 480. And a title should hide before it shortens to one letter: truncate with an ellipsis down to about eight characters, then hide. See answer 1. |
| Rail at 1320 and 1200 (`2a`) | `09`, `10` | Match | The fold reads the room beside the rail, as asked: details folds, rail docks. |
| Breadcrumb at 1200 | `10` | Change | "F." for Ferry Line. A one-letter Case name identifies nothing. Shorten with an ellipsis ("Ferry L…"), or let the search field give up width first; it has room at 1200. Below about 1,000 the name can go, as `11` and `12` do, with the full name as the breadcrumb's `title`. |
| Strip (`2a`) | `11`, `12` | Match | 40 pixels: ‹, REC dot, tab count, no separator. The Capture button is #1832's. |
| Strip overlay (`2a`) | `13` | Match | 320 over the viewer, strip still visible at the edge. |
| Dashboard popover (`2c`) | `14` | Match | Header, source line, "4 tabs", **Open Ferry Line**. |
| Settings top bar (`2d`) | `15` | Change | Switch, REC pill and **Capture Session** button say one thing three times. Make the REC pill the trigger: "● REC · Launched Chromium ▾" opens the popover on the dashboard and in Settings, and the separate button goes. The switch stays, since it is the existing control and the only one that turns the Capture Session off without a confirmation step. Redrawn in `2c` and `2d`. |
| Pop-out window (`1g`) | `16` | Accept as built | Title bar "● Birdbrain · Ferry Line · Dock" with "Capture Session" left to the heading reads cleaner at 300 wide. Keep the OS window title as the handoff gives it, "Birdbrain · Ferry Line · Capture Session": window switchers show the title alone. |
| Main window while popped out (`1g`) | `17` | Change | The stub sits at the top of an empty 320-pixel rail. Take the strip's 40 pixels: REC dot, a window glyph for **Show window**, a dock glyph for **Dock**, each with a tooltip, and the content gets the width back. See answer 2; redrawn in `1g`. |
| Stop confirmation (`1i`) | `18` | Change | "Launched Chromium will close." drops the clause the line is for: "and your 6 Captures are kept." The reassurance is the point of asking. Use the count when known, otherwise "and the Captures taken are kept." |

## States

| State | Shots | Verdict | What and why |
| --- | --- | --- | --- |
| 1. No supported browser | `21` | Change | Card and **Launch** disabled as drawn. "Choose one in Settings → Capture." is text the Operator has to act on by hand from inside a modal; give the card a **Open Settings** button, as state 4's card has **Show panel**. Redrawn in `1j`. |
| 2. Debugging connection does not answer | `23` | Accept as built | The build's line names the mechanism and the wait ("did not open its debugging connection within 20 seconds, so Birdbrain closed it") and keeps the drawn ending. More useful than the drawn line. |
| 3. Proxy refuses before launch | `24` | Accept as built | The line carries the proxy address and the error in parentheses, then the drawn "Check the proxy in Settings → Operator." Put the address and error code in mono so the plain words stand out from the detail. **Launch** stays enabled for a retry, which is right. The empty label is engineering's, as the brief says. |
| 3, with the toast | `25` | Change | The dialog already shows the refusal; the toast repeats it at the bottom of a dimmed screen. Drop the toast while the start dialog is open and put **Report this** in the card as a link. Keep the toast for a refusal that arrives with no dialog open. See answer 4. |
| 4. A launched browser is already open | `27` | Change | The card, **Show panel** and the missing red rule are right (answer 5). The footer is not: "Joins the running Capture Session in Ferry Line." beside a disabled **Launch and join** promises an action the dialog refuses. In this state the footer reads "A launched browser is open; use its panel." and the primary button is hidden, leaving **Cancel** and the card's **Show panel**. Redrawn in `1j`. |
| 9. Extension warning | `28` | Match | Between the header and the tab list, warning rule, two lines, no name. The engine knows an extension by ID only, so the optional name line never appears; the drawing's "when the engine has one" covers it. |
| 10. Browser closed, Capture Session running | `19`, `20` | Match | Rail and popover both carry it, with **Launch again…** and **Stop Capture Session**. The REC pill dropping "· Launched Chromium" while the browser is closed is accurate. |
| 11. Ended by the Egress check | `29`, `30` | Change | "The Capture Session ended." drops "earlier Captures are kept." The Operator has just watched a browser close itself; the kept Captures are what they want to know. One-line copy fix in both the rail and the popover. |
| 13. Browser left from an earlier run | `31` | Change | The notice floats over the Case action bar and covers **Launch browser**. Blocking a launch until the old browser is dealt with is intended; covering the control is not. Move it into the start dialog as the other refusals are: the Operator presses **Launch browser**, the dialog opens with the state 13 card (**Check again**, and **Launch** disabled until the check passes). Nothing floats, nothing is covered, and the dismissed toast at the bottom goes with it. Redrawn in `1p` (Persona form) and `2f` (no Persona). See answer 3. |
| 14. Changing the Egress | `32` | Match | Over the Egress block on the Operator tab, drawn wording. |
| 14, afterwards | `33` | Accept as built | The Operator confirmed a dialog that said what would happen; a second notice would repeat it. The activity feed should carry the event ("Capture Session ended: Egress changed to Tor") so the record has it. |

## Answers to the five questions

1. **Width bands.** The bands match answer 1 of the revision: rail docked from about 1,020 with the
   details panel folded, both docked where both fit, strip below about 1,020. What `08` shows is
   not a band problem but a column-distribution one: at 1440 both fit by the minimums, yet the list
   and details keep their saved widths and the viewer takes the whole loss, down to about 370 and a
   title cut to "C.". Add one rule: while the rail is docked, the viewer keeps at least 480 pixels;
   the list and the details panel shrink toward their minimums first, and the details panel folds
   when that is not enough. With it, 1440 folds the details panel (1440 − 48 − 320 − 240 − 7 − 480 =
   345, under the 7 + 320 the docked panel needs) and docks it again from about 1,450. The exact
   switch points can then be read off the rule rather than measured.
2. **The pop-out stub.** The strip's 40 pixels. An empty 320-pixel rail costs the screen a column
   for two buttons. The strip carries the REC dot, a window glyph (**Show window**) and a dock glyph
   (**Dock**), each with a tooltip, and the main content takes the width back. Redrawn in `1g`.
3. **The leftover notice.** Blocking the launch is intended; covering the button is not. Move the
   notice into the start dialog as a refusal card: pressing **Launch browser** opens the dialog
   with the state 13 card, **Check again** in it, and **Launch** disabled until the check passes. The
   Operator sees the block at the moment they try to launch, in the place every other refusal
   appears, and nothing in the Case screen is covered meanwhile. Redrawn in `1p` and `2f`.
4. **The refusal toast.** Not both. While the start dialog is open the card is the message; the
   toast repeats it below a dimmed screen and its **Report this** sits outside the thing it reports
   on. Drop the toast in that case and put **Report this** in the card as a link. Keep the toast
   for a launch that fails with no dialog open (a relaunch from the panel's **Launch again…**, for
   example), where there is no card to carry it.
5. **The state 4 card.** No red rule is right. It is not a failure but a notice with a resolution
   the Operator can take at once, **Show panel**; the canvas drew it without the rule for that
   reason. What does need to change is the footer beside it (state 4 row above).

## Critique

A structured read of the build as a whole, beyond the per-piece verdicts.

**Overall impression.** The build is faithful to the drawing where it matters: the panel's five
forms, the fold, the refusal cards and the copy rules all landed. The biggest opportunity is
economy at the edges: three top-bar controls for one Capture Session in Settings, two dialogs in a
row saying the same thing about the VPN, a toast under a card, and an empty rail under a stub. Each
is a duplicate the drawing did not intend, and each goes with a small change.

### Usability

| Finding | Severity | Recommendation |
| --- | --- | --- |
| The no-VPN fact is stated in the dialog and again in a modal the Operator must dismiss before the browser opens (`04`) | Moderate | Fold the modal's actions into the dialog; one statement, one click (`1c`) |
| The state 13 notice covers the only control that resolves it (`31`) | Moderate | Make it a refusal card in the start dialog (`1p`, `2f`) |
| State 4 shows a footer and a primary button for an action it refuses (`27`) | Moderate | Footer names the block; primary hidden; **Show panel** is the action (`1j`) |
| Refusal cards in a modal point to Settings by words only (`21`) | Minor | **Open Settings** in the card, as state 4 has **Show panel** |
| The stop confirmation no longer says the Captures are kept (`18`) | Minor | Restore the clause; it is the reason to confirm |
| A toast repeats a refusal the open dialog already shows (`25`) | Minor | Suppress the toast while the dialog is open |

### Visual hierarchy

- **What draws the eye first** on a Case screen with a Capture Session running: the REC pill, then
  the rail header. Correct: the Operator should know recording is on before anything else.
- **Reading flow** in the rail: heading and controls, source line, Case line, eyebrow, tabs. Matches
  the drawing. In the popover the same order holds, which keeps the two forms learnable as one.
- **Emphasis**: the only accent fills are **Launch**, **Stop and close browser**, **End and change**
  and the **Capture Session** button; the rest is border and text. That is the intended restraint.
  The **Capture Session** button is the one accent element that does not act on the Capture Session
  itself, which is a second reason to fold it into the REC pill.
- In the Settings top bar (`15`) three adjacent controls share one subject with no grouping, so
  the eye has to read all three to find the one it wants.

### Consistency

| Element | Issue | Recommendation |
| --- | --- | --- |
| Refusal cards | State 1 to 3 cards carry a danger left rule, state 4 none, state 13 a warning rule on a floating notice | Keep: danger for a refusal, none for a notice with an action, warning for a condition the Operator can clear. State 13 inside the dialog takes the warning rule, as `1p` draws it |
| Switch source line | Case screens show the Case name; the drawing shows the source | One rule for the line (see `1i` row) |
| Settings "Launched browsers" row | Plain row with one browser; radios with several | State the rule in the component: radios when more than one row |
| Kept-Captures clause | Present in the drawn stop and state 11 lines, absent in both built ones | Restore in both |
| Error detail in cards | State 3's address and error code are in body type | Mono for the technical span, body for the sentence |

### Accessibility

- **Colour contrast**: status text uses the `-fg` tokens on tinted surfaces in both themes; the
  light no-VPN line (`35`) and the light rail (`34`) read cleanly. The disabled **Launch browser**
  in the action bar (`07`) is faint on `surface`, within the app's disabled convention.
- **Target sizes**: the strip's ‹ and the stub's buttons meet the 28-pixel control metric; the
  popover's **Pop out** link is text only, which the drawing also did; a 28-pixel hit area around
  it costs nothing.
- **Text readability**: panel body at 11 pixels and tab URLs in 10-pixel mono match the token
  rules. The state 3 card's long parenthetical is the one dense paragraph; mono for the detail
  will help it scan.
- **Focus and keyboard**: not visible in screenshots. Two things to confirm in the build: Escape
  closes the strip overlay and the popover, and the pop-out window's OS title is set, since
  screen readers and window switchers name it by that alone.

### What works well

- The fold reads the room beside the rail (`09`, `10`); the request in answer 1 landed as asked.
- Every refusal is a card in the dialog with a plain title and one line, and **Launch** stays
  enabled where a retry can succeed (`23`, `24`).
- The popover is the rail's content without the tab list, so the Operator learns one panel (`14`,
  `20`, `30`).
- The strip is the screen's own fold pattern at 40 pixels with no separator (`11`, `12`).
- Copy discipline held: nothing claims the browser is undetectable, the VPN line says what Birdbrain
  sees, and state 13 says plainly that Birdbrain cannot reconnect.

### Priority recommendations

1. **Collapse the duplicates**: REC pill as the popover trigger (`2c`, `2d`), no toast under an open
   dialog, no empty rail under the stub (`1g`). Same information, fewer things to read.
2. **Put state 13 and the no-VPN actions where the Operator already is**: in the start dialog, as
   refusal cards and inline actions (`1c`, `1p`, `2f`). Nothing floats, nothing is read twice.
3. **Restore the two kept-Captures clauses and fix the state 4 footer** (`18`, `29`, `30`, `27`).
   Three lines of copy; they are the lines that tell the Operator what their evidence is doing.

## Not reviewed

Tooltip text, the launched browser's own window, Wayland, Windows and macOS, as the brief says.
The empty Egress label (`24`, `25`) is engineering's.
