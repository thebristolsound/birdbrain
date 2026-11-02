# Engineering review: launched browser revision, Withheld from analysis mark, "not read" count

Bundle date: 2026-11-01. Answers `docs/specs/2026-11-01-launched-browser-revision-ui-brief.md`; revises
the 2026-10-12 mock reviewed in `docs/specs/2026-10-12-launched-browser-and-investigation-feasibility-assessment.md`.
Mock: `Launched Browser.dc.html` (canvas, pieces 1a–1z revised, 2a–2g added). Fill **Verdict**
(Accept / Modify / Reject), **Size** (S/M/L), and **Constraint** per row. The Design call column is
written fresh for this revision.

## Surfaces

| # | Surface | Mock | Design call | Verdict | Size | Constraint |
|---|---|---|---|---|---|---|
| 1 | Found browsers in Settings | 1a | "Launched browsers" group in Settings → Capture. A row shows no version until Birdbrain has launched that browser ("not launched yet"); after a launch it shows the version from that launch and says so ("from its last launch"). Chrome, Edge, Brave, Chromium only; "too old" row kept; Choose an executable… with the Snap/Flatpak note. Version numbers illustrative; no floor number | | | |
| 2 | Start dialog | 1b, 1c, 1d, 1e, 2b | Launched from **Launch browser** in the Case action bar, which now renders with no extension and no browser (2b), and from a row in the command palette's action list (not drawn). Title tooltip and subtitle carry the first-request limit; no "draws nothing" claim. No-VPN line says Birdbrain sees the machine's path, not the browser's, and nothing about what sites see; "No VPN seen" kept for #1696's swap. Egress pointer is Settings → Operator. Operator-name tooltip per the brief. Persona picker (#1833) as before | | | |
| 3 | Capture Session panel | 1f, 1g, 1k, 1l, 1r, 2a, 2c, 2d | 320px rail on Case screens where it fits (1f at 1,320 × 600). Where it does not (900 to ~1,020 and 1,100 to ~1,300) the rail folds to a 40px strip with REC dot, Capture, tab count, last Exhibit Number; expanding opens the panel as a 320px overlay (2a); one build change asked: the details fold reads the room beside the rail. Dashboard and Settings: a Capture Session button in the top bar opens the panel as a popover (2c, 2d). Pop-out is an ordinary window with an accent-tinted title bar, REC dot, "Birdbrain" and the Case name, the same as its OS title; main window keeps a strip with Show window and Dock (1g). Shortcut key is a placeholder; default line is "try it", struck form only on known failure; Capture button named both times (1r, 1f). "Not from first request" tooltip names no cause, states the lack (1f, 1k). Chip tooltip carries ruling 3's service-worker wording (pending PR #2033) | | | |
| 4 | Telling the browsers apart | 1h, 1i, 2e | Birdbrain side: "Launched Chrome · Harbor Desk" in the REC pill, the switch's source lines (1i now reads "Launched Chrome · Harbor Desk, and the extension" / "Launched Chrome · Harbor Desk"), the panel header, and the capture target. Wrong-browser notice (Birdbrain side, no feasibility label): "NK-63 came through the extension, not the launched browser. It has no Transaction Record, and its Persona is your declaration." Browser side (**feasibility, P15**): profile name "Birdbrain · ‹Persona›" and theme colour, shipping only after a probe shows each supported product keeps both; throwaway profile reads "Birdbrain · no Persona" (2e). No automation infobar | | | |
| 5 | Withheld from analysis mark | 1u, 1v, 1w, 1x | One component: ⊘ + "Withheld from analysis · ‹holders›" in a dotted `border-strong` outline that is decoration (glyph and words carry it); "Withheld" in dense tables with the full words as tooltip and accessible name; no action on search rows; the mark with **Clear my flag** on the Exhibit header (1w) and in 1x's second row, no checkbox. All pieces show the Shared Case; numbers print with Member Codes | | | |
| 6 | "Not read" count + gap entry | 1y, 1z, 2g | Count third in the header; breakdown headed "This run did not open these Exhibits" with reasons, not remedies ("this run cannot read them"; "its field records come from an older build"; failed-build variant may name Reprocess). **Show them** / "Show the 4 Exhibits" opens a sheet in the investigation view (2g): a Capture row opens Captures on the Text tab; a PDF or mbox row opens the Exhibit's properties on the Data screen until a viewer for that kind exists | | | |

## States

| # | State | Mock | Verdict | Size | Constraint |
|---|---|---|---|---|---|
| 1 | No supported browser / unrecognized / below floor | 1j | | | |
| 2 | Debugging connection does not answer | 1j | | | |
| 3 | Proxy refuses before launch ("Settings → Operator") | 1j | | | |
| 4 | A launched browser is already open | 1j, 1f (disabled button) | | | |
| 5 | Recording, one tab not from first request (no reload advice; tooltip on the label; no cause named) | 1f, 1k | | | |
| 6 | Private-window tab | 1f, 1k | | | |
| 7 | Capture abandoned | 1l | | | |
| 8 | Crashed tab | 1k | | | |
| 9 | Extension warning, no name; name as an optional mono line when the engine has one (Egress not Direct) | 1m | | | |
| 10 | Browser closed, Capture Session running ("The Capture Session keeps running until you stop it") | 1n | | | |
| 11 | Ended by the Egress check ("The Capture Session ended; earlier Captures are kept") | 1o | | | |
| 12 | Closed before it showed (WebRTC) | 1o | | | |
| 13 | Browser left from an earlier run, Persona form and no-Persona form | 1p, 2f | | | |
| 14 | Changing the Egress during a Capture Session, on the Operator tab | 1q | | | |
| 15 | Deleting a Persona whose browser is open | 1q | | | |
| 16 | Passive capture running (_once #600 lands_) | 1s | | | |
| 17 | Port mode takeover warning (_only if built_) | 1t | | | |
| 18 | Withheld result in each placement | 1u, 1v, 1w | | | |
| 19 | Withheld result opened; Clear my flag without confirmation | 1w | | | |
| 20 | Shared Case, withheld by another member; Clear MB's flag… keeps its confirmation | 1x | | | |
| 21 | Non-zero "not read" count, reasons reworded | 1y | | | |
| 22 | Gap list not-read entry, Show them opens 2g | 1z, 2g | | | |

## Cross-cutting

| # | Item | Mock | Design call | Verdict | Size | Constraint |
|---|---|---|---|---|---|---|
| C1 | Tokens, type, radii | all | Status is the app's tinted triples (`success`/`warning`/`danger` `-surface` 10%, `-line` 20%, `-fg`), defined in the canvas with the app's values because the bundled stylesheet lacks them; member hues `member-1`/`member-2`; REC pill, connection dot and pop-out dot on status tokens; product type on 10/11/12/14 at 400/500/600; radii 2/4/6 with `rounded-full` on pills, badges, dots only. Canvas annotation untouched | | | |
| C2 | Exhibit Numbers | 1f, 1g, 1h, 1l, 1s, 1u–1z, 2a, 2g | Every piece is the Shared Case Ferry Line (NK this Operator, MB); each number carries its committing member's code with no `E-` prefix, the same number across pieces (NK-62 everywhere it appears) | | | |
| C3 | Copy and layout sweep | Q12, 1h, 1f | "Capture Session" in full where "session" stood alone; Share pill, capture health and Export in the top bar, not the Case action bar | | | |

## Designer answers

1. **Where the rail does not fit:** the rail gives way. From 900 to about 1,020 and from 1,100 to about 1,300 it folds to a 40-pixel strip with no separator, the fold the Captures screen's side columns already use. The strip holds expand, the REC dot, Capture, the tab count, and the last Exhibit Number; expanding opens the panel as a 320-pixel overlay over the viewer that closes on Escape or a click outside and does not reflow the screen. I ask for the build change the brief offers: the details panel's fold reads the room left beside the rail, so from 1,100 to about 1,300 the details panel folds and the rail docks, and the strip is needed only below about 1,020 (2a).
2. **Dashboard and Settings:** no rail. The top bar carries REC · Launched Chrome and a Capture Session button that opens the panel as a popover under it: header, capture target, Capture, tab count, Pop out, and (on the dashboard) Open ‹Case›. The Case the Capture Session runs into shows the REC pill in the dashboard's list. Settings keeps its switch and REC and gains the same button. States 14 and 15 are dialogs raised from the Operator and Personas tabs; the popover is not involved (2c, 2d).
3. **Show them:** a sheet in the investigation view under the gap list, one row per Exhibit with its number, title, kind, reason, and target. A Capture row opens the Captures screen with that Capture selected on the Text tab. No surface shows a PDF or `mbox` Exhibit today, so a `document` or `attachment` row opens the Exhibit's properties on the Data screen; when a viewer for that kind exists, the row opens it (2g).
4. **Shortcut line:** default, "‹key› · Try the shortcut while the browser has focus. The **Capture** button always works."; struck, only when Birdbrain knows registration failed, "~~‹key›~~ · This desktop refused the shortcut. Use the **Capture** button." Beside Capture in the panel (1f) the key sits faint with the same default tooltip. ‹key› is a placeholder; engineering picks the key.
5. **Extension warning:** "An extension was added." / "It could change how traffic leaves this browser." With a name, a third line in mono, prefixed as the browser's report: "the browser calls it: Quay Clipper". Shown only while the Egress is not Direct; the name line only when the engine has one (1m).
6. **Found-browser row:** before a launch, the product name and "not launched yet", no version. After, the version with "from its last launch" and a tooltip saying it is the version the browser reported when Birdbrain last launched it (1a).
7. **Throwaway profile name:** "Birdbrain · no Persona", with the same theme colour as a Persona profile. Feasibility, as in 1h (2e).
8. **Pop-out cue:** an accent-tinted title bar carrying the REC dot, "Birdbrain", and the Case name, which is also the window's OS title ("Birdbrain · Ferry Line · Capture Session"), so the window reads as Birdbrain in the window list and taskbar; and a strip in the main window where the rail was, "Panel popped out", with **Show window** and **Dock**. Whether Birdbrain can raise the window on a Wayland desktop, or a shortcut reaches it while the browser has focus, is engineering's to check in the launcher step (1g).
9. **"Not from first request" tooltip:** names no cause. "Birdbrain did not record this page from its first request. A Capture of it has no Transaction Record and no Bound TLS Details, and its inventory says so." (1f, 1k). The three causes are not always distinguishable from the panel, and a cause that is wrong is worse than none.

## Open for engineering

- The details panel fold: can it read the room left beside the rail instead of the window's width (answer 1)? If not, the strip stands from 1,100 to about 1,300 as drawn.
- Whether the popped-out window can be raised from the main window's **Show window** on a Wayland desktop, and whether its OS title can be set as drawn (answer 8).
- The `1k` chip tooltip and the gap copy rule follow ruling 3 of 2026-10-31 (PR #2033, not merged on 2026-11-01); if the ruling's wording changes at merge, that string changes with it.
- Whether a reload yields a page recorded from its first request; the Port timetable row carries no reload advice until the launcher step measures it (state 5).
- The strip's Capture control takes the panel's capture target; with no eligible tab it should open the tab picker (1r), the same as the shortcut does. Not drawn separately.
- `2g` gives `document` and `attachment` rows a Properties target because the app shows no such Exhibits today; the kinds themselves are proposed, not built.
