# Launcher build design review brief

Date: 2026-11-04
Audience: the designer working in the "Birdbrain UI" design project. Engineering contact: the
maintainer.
Status: draft for the designer. It asks for a review of built screens, not for a new mock.

## What this brief asks

The launcher step of the launched browser (#1831) merged as PR #2056 on 2026-11-04. It was built
from your 2026-11-01 revision (`docs/design-handoff/2026-11-01-launched-browser-revision/`:
`Launched Browser.dc.html`, `HANDOFF.md`, `ENGINEERING_REVIEW.md`) with the Modify constraints of
the [revision feasibility assessment](2026-11-02-launched-browser-revision-feasibility-assessment.md).
Issue #1831 stays open until you review the build. The maintainer signs off after your review.

Compare each screenshot below with the piece it names on the canvas and in `HANDOFF.md`, and give
each piece one verdict:

- **Match.** The build is what you drew.
- **Accept as built.** The build differs from the drawing, and the difference is fine.
- **Change.** The build must change. Say what to change and why.

Review only what the launcher step builds: S1, S2 without the Persona picker, S3 without the
Capture control, and states 1 to 4 and 9 to 14. These belong to later steps, so leave them out of
the verdicts: the Capture control, the strip's Capture button, the tab picker, the shortcut, the
"from first request" chip, the Persona picker, the Selector column, and the passive options.

## How the screenshots were made

- **Build.** `main` at `067fe310`, run under a virtual display on Arch Linux. Chromium
  `154.0.8037.97` is the only browser installed on the machine, so no shot shows a Chrome, Edge or
  Brave row.
- **Window.** 1440 by 900 pixels unless the filename gives a width. Dark theme unless the filename
  says `light`.
- **Names.** The Case is Ferry Line, the operator is A. Marsh, and the proxy Egress is labelled
  Harbor relay, as on the canvas. A few shots taken before the name was changed read "Driver Operator"
  instead, the test harness's default name.
- **Tabs.** The tab pages are local test pages, so their URLs read `http://127.0.0.1:18765/...`
  where the canvas has `ferrylog.example`. The browser opens on an `about:blank` tab, and the panel
  lists it as a tab.
- **Staged shots.** A filename with `STAGED` shows the app's real components fed a status or a
  launch answer by hand, because the condition cannot happen on this machine (an extension
  installed under a proxy, a browser that does not answer, no browser installed, a browser left
  from an earlier run). In those shots the top bar and the Case action bar can disagree with the
  panel: the Capture Session switch reads off and the REC pill is missing. Review the panel or
  dialog content only.
- **Not shown.** Tooltips: an "i" marker's text and the hover text on a disabled button do not
  appear in a screenshot. The launched browser's own window. Wayland, Windows, and macOS.

## Screenshots

The files are in `docs/design-handoff/2026-11-04-launcher-build-review/screenshots/`.

### S1. Found browsers in Settings (`1a`)

| File | Shows | Check |
| --- | --- | --- |
| `02-settings-found-browsers-not-launched.png` | Settings → Capture before any launch: one Chromium row that reads "not launched yet" and the **Choose an executable…** button | `HANDOFF.md` draws each row as a radio. With one browser found, the build draws a plain row. |
| `15-settings-popover-and-found-browsers-after-launch.png` | The same list after a launch: the version in mono beside the name and "from its last launch" at the right. The Capture Session popover is also open (see S3). | The version placement. |
| `22-STAGED-state1-no-browser-settings.png` | No browser found: "Birdbrain found no supported browser in the usual install folders." | State 1 in Settings. |

### S2. Start dialog (`1b` to `1e`, `2b`)

| File | Shows | Check |
| --- | --- | --- |
| `01-case-action-bar.png` | The Case action bar with no extension connected and no browser open: **Launch browser** only (`2b`). | |
| `03-start-dialog-direct.png` | The start dialog with a Direct Egress and the no-VPN line under it. The browser is a native drop-down list with its state under it. | The no-VPN line uses the wording of the no-VPN warning change (#2037), as #1831 requires: "VPN not seen. Birdbrain sees this computer's network path, not your browser's. A VPN set up only in your browser is not seen." It replaces the placeholder in `1c`. |
| `04-no-vpn-session-warning.png` | After **Launch** with a Direct Egress and no VPN seen, the session warning from #2037 opens over the start dialog, with **Set up a proxy**, **Stop warning on this network**, and **Continue**. | Whether a second dialog on top of the first reads well. |
| `05-STAGED-start-checklist-proxy.png`, `06-STAGED-start-checklist-first-tab.png` | The checklist while the browser starts under a proxy Egress: reaching the proxy, starting the browser, checking the first tab. The footer becomes a **Cancel** link. | The checklist against `1e`. |
| `35-light-start-dialog-direct.png` | The start dialog in the light theme. | The no-VPN line in `color-warning-fg` on the light dialog. |
| `26-palette-launch-row-while-open.png` | The command palette's **Launch browser** row, which stays offered while a browser is open. | |

### S3. Capture Session panel (`1f`, `1g`, `2a`, `2c`, `2d`)

| File | Shows | Check |
| --- | --- | --- |
| `07-rail-overview-1440.png` | The rail on the Case overview: heading with elapsed time, **Pop out**, **Stop…**, the lines "Launched Chromium · Direct" and "Into Ferry Line" and the tab list with title and URL. | The rail against `1f` without the capture target, which #1832 adds. |
| `08-rail-captures-1440.png` | The Captures screen at 1440 with a Capture selected: list, viewer, details panel, and rail all docked. The viewer is about 370 pixels wide and cuts its title to "C." | Whether 1440 is too narrow to dock both the details panel and the rail. |
| `09-rail-captures-1320.png` | At 1320: the details panel folds to its strip and the rail stays docked. | This is the fold change you asked for in answer 1: the details panel's fold reads the room left beside the rail. |
| `10-rail-captures-1200.png` | At 1200: the rail is still docked. The breadcrumb shortens the Case name to "F." | The breadcrumb at this width. |
| `11-strip-captures-1000.png`, `12-strip-captures-900.png` | At 1000 and 900 the rail folds to the 40-pixel strip: ‹, the REC dot, and the tab count. The Case name is gone from the breadcrumb and from the action bar. | The strip against `2a` without its Capture button. |
| `13-strip-overlay-1000.png` | The strip's ‹ opens the panel as a 320-pixel overlay over the viewer. | |
| `14-dashboard-popover.png` | The dashboard's **Capture Session** button and its popover: header, "4 tabs" and **Open Ferry Line** (`2c`). | |
| `15-settings-popover-and-found-browsers-after-launch.png` | Settings' popover (`2d`). The Settings top bar shows the Capture Session switch, the REC pill, and the **Capture Session** button together. | Whether the Settings top bar needs all three. |
| `16-pop-out-window.png` | The pop-out window at 300 by 224 pixels: accent title bar with the REC dot, "Birdbrain · Ferry Line" and **Dock**; then the heading, **Stop…**, the browser line, and a "4 tabs" line. | `HANDOFF.md` gives the title bar as "Birdbrain · ‹Case› · Capture Session"; the build leaves "Capture Session" to the heading below it. |
| `17-main-window-while-popped-out.png` | The main window while the panel is popped out: the stub (the words "Panel popped out" with **Show window** and **Dock**) at the top of a rail that keeps its full 320-pixel width, empty below the stub. | Whether the stub should keep the rail's width or take the strip's. |
| `18-light-stop-dialog.png` | **Stop…** opens "Stop the Capture Session?" with **Keep running** and **Stop and close browser**. | |
| `34-light-rail-overview.png` | The rail in the light theme. | |

### States

| State | File | Shows | Check |
| --- | --- | --- | --- |
| 1. No supported browser | `21-STAGED-state1-no-browser-dialog.png` | The Browser row reads "None found" and the refusal card reads "No supported browser found / Choose one in Settings → Capture." **Launch** is disabled. | |
| 2. Debugging connection does not answer | `23-STAGED-state2-no-connection.png` | The card title "Chromium didn't respond" over the launcher's message, which ends with "A setting on this computer may be blocking it." | |
| 3. Proxy refuses before launch | `24-state3-proxy-unreachable.png` | A real refusal with Tor chosen and no Tor running. | The Egress line and the card title read "Tor ·" with nothing after the dot. That is an engineering defect (see "Not for this review"); leave it out of the verdict. |
| 3, with the toast | `25-state3-proxy-unreachable-with-toast.png` | The same refusal, plus a toast at the bottom that reads "Couldn't launch the browser" and offers **Report this**. | Whether the toast should appear while the dialog already shows the refusal. |
| 4. A launched browser is already open | `27-state4-already-open.png` | Opened from the palette while a browser is open: the card "A launched browser is already open / Only one can be open at a time." with **Show panel**, the footer "Joins the running Capture Session in Ferry Line." and **Launch and join** disabled. | This card has no red left rule; the other refusal cards have one. |
| 9. Extension warning | `28-STAGED-state9-extension-warning.png` | Under a proxy Egress, the card "An extension was added. It could change how traffic leaves this browser." between the header and the tab list. | Against `1m`. The engine knows an extension by its ID only, so no name line appears. |
| 10. Browser closed, Capture Session running | `19-state10-browser-closed-rail.png`, `20-state10-browser-closed-popover.png` | "Launched Chromium closed. The Capture Session keeps running until you stop it." with **Launch again…** and **Stop Capture Session**. The rail and the dashboard popover both show it. | Against `1n`. |
| 11. Ended by the Egress check | `29-STAGED-state11-ended-by-egress-check-rail.png`, `30-STAGED-state11-ended-by-egress-check-popover.png` | "Browser closed: traffic went around the proxy / The Capture Session ended." with **Dismiss**. The rail and the dashboard popover both show it. | Against `1o`. |
| 13. Browser left from an earlier run | `31-STAGED-state13-leftover-browser.png` | "An old launched browser is still open / Chromium on a throwaway browser profile. Close that browser, then select Check again." with **Check again** and **Dismiss**. This is the variant with no Persona name that the brief asked for. | The notice sits over the Case action bar and covers **Launch browser** until it is dismissed. The toast at the bottom is left over from an earlier staged refusal. |
| 14. Changing the Egress | `32-state14-egress-change-confirm.png` | Settings → Operator while a browser is open: "Change the Egress to Tor? / This ends the Capture Session and closes Launched Chromium." with **Cancel** and **End and change**. | Against `1q`. |
| 14, afterwards | `33-state14-light-after-end-and-change.png` | After **End and change** the browser has closed and no notice is shown. Settings ends the Capture Session before it saves the new Egress, so the "Browser closed: the Egress changed" notice appears only when the Egress changes some other way. | Whether a confirmed change needs any trace in the panel. |

## Questions for the designer

1. **Width bands.** At 1440 the details panel and the rail both dock and the viewer drops to about
   370 pixels (`08`). At 1,320 and 1,200 the rail docks and the details panel folds (`09`, `10`).
   At 1,000 and 900 the rail becomes the strip (`11`, `12`). The shots cover those five widths
   only, not the exact switch points. Do these bands match what you meant in answer 1?
2. **The pop-out stub.** While the panel is popped out, the main window keeps an empty 320-pixel
   rail under the stub (`17`). Keep it, or show the stub at the strip's 40-pixel width?
3. **The leftover notice.** The state 13 notice covers **Launch browser** (`31`). Should it move,
   or is blocking a launch until the Operator deals with the old browser intended?
4. **The refusal toast.** A refused launch shows the card in the dialog and a toast with **Report
   this** at the same time (`25`). Keep both?
5. **The state 4 card.** It has no red left rule (`27`). Is that right for a refusal the Operator
   can resolve with **Show panel**?

## Not for this review

Engineering already holds these; they need no verdict.

- **Empty Egress label.** The Label field in Settings → Operator is optional. When a Tor or proxy
  Egress is saved without one, the start dialog and the state 3 card add " · " followed by
  nothing: the Egress line reads "Tor ·" and the card title "Can't reach Tor ·" in `24` and `25`.
- **The rest of the #1831 checklist.** The hand-run checks in Chrome, Edge and Brave, whether the
  pop-out comes to the front on Wayland, and the reload measurement are engineering's, listed on
  #1831.

## Deliverable

`docs/design-handoff/2026-11-04-launcher-build-review/DESIGN_REVIEW.md`, with one row per piece
or state in the tables above: the piece, its verdict (Match, Accept as built, or Change), and for
a Change, what to change, and why. Answer the five questions in a section of their own. A Change
that needs a drawing goes on the canvas as a revised piece, keeping its letter, as the 2026-11-01
revision did.

## References

- Revision mock and handoff: `docs/design-handoff/2026-11-01-launched-browser-revision/`
- [Revision UI brief](2026-11-01-launched-browser-revision-ui-brief.md)
- [Revision feasibility assessment](2026-11-02-launched-browser-revision-feasibility-assessment.md)
- Issue #1831 (the launcher step) and PR #2056 (its build)
