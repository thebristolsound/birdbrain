# Launched browser mock, revision: 2026-11-01

Answers `docs/specs/2026-11-01-launched-browser-revision-ui-brief.md`. Revises the 2026-10-12 mock
(`docs/design-handoff/2026-10-12-launched-browser/`). Suggested repo path:
`docs/design-handoff/2026-11-01-launched-browser-revision/`.

- `Launched Browser.dc.html`: the canvas, revised in place. Revised pieces keep their letters (`1a`
  to `1z`); added pieces are `2a` to `2g`, each directly after the piece it extends. Open it from the
  design project root so the Birdbrain UI stylesheet loads. The labels "once #600 lands" (state 16),
  "only if built" (state 17), and "feasibility" (every browser-side cue) stay.
- `ENGINEERING_REVIEW.md`: one row per surface (1 to 6) and state (1 to 22), plus a Cross-cutting
  table, for the second feasibility pass. Verdict, Size, and Constraint are blank for engineering.

Pieces are drawn in the brief's order: the launcher step's parts first, then the clicked-Capture
step's, then the Persona step's, then the investigation items, then S4's name lines and notice,
and last S4's browser-side cue. On the canvas they keep the 2026-10-12 layout, so a reader can
match the two.

## Revisions

One entry per item the brief changes or adds.

- **S1 (`1a`).** No version on a row until Birdbrain has launched that browser: Brave and
  Microsoft Edge read "not launched yet" with no number. The Google Chrome row shows the version
  from its last launch and says so ("from its last launch"). The header tooltip and the Q7 answer's
  tooltip say the same. The "reported ..., not yet confirmed" form is gone.
- **S2 (`1b` to `1e`, `2b`).** Title tooltip: the first-request claim now carries the limit (a
  page that began loading before recording started, or the first page of a Ctrl-click or
  middle-click tab, keeps no Transaction Record), and "draws nothing in the page" is replaced by
  "pages in this browser can tell it is driven by software". Subtitle: the limit is in the same
  line as the capability. No-VPN line (`1c`): "No VPN seen. Birdbrain sees this machine's network
  path, not the browser's."; the tooltip's "sites see" sentence is cut. Egress tooltip points to
  Settings → Operator. Operator-name tooltip (`1d`) is the brief's wording. Added `2b`: the Case
  action bar with no extension connected and no launched browser open, holding only **Launch
  browser**. The palette row is not drawn (one more row in the palette's action list).
- **S3 (`1f`, `1g`, `1k`, `1l`, `1r`, `2a`, `2c`, `2d`).** `1f` is now drawn at 1,320 × 600, the
  narrowest width at which the rail fits beside the docked Captures screen, with the list,
  viewer, and details panel drawn; its capture target reads "Launched Chrome · Harbor Desk ·
  window 1, tab 2"; Export, the Share pill, and capture health are in the top bar; the Port
  timetable row loses "Reload it to record the whole load." and its tooltip hangs on the "not
  from first request" label. `2a` answers question 1: where the rail does not fit it folds to a
  40-pixel strip, and asks for one build change. `2c` and `2d` answer question 2: the dashboard
  and Settings top bars carry a Capture Session button that opens the panel as a popover. `1g`:
  "on top" is gone from the heading, tooltip, and copy; the window is called an ordinary window;
  the cue for question 8 is an accent-tinted title bar with the REC dot, "Birdbrain", and the Case
  name, the same text as the OS window title, plus a strip in the main window with **Show window**
  and **Dock**. `1k`: the chip tooltip's service-worker half is ruling 3's wording (pending PR
  #2033); the "not from first request" tooltip names no cause (question 9). `1r` and `1f`: the key
  is a placeholder `‹key›`; the default line presents the shortcut as something to try and names
  the Capture button; the struck form appears only when registration is known to have failed.
- **S4 (`1h`, `1i`, `2e`).** `1i`'s source lines read "Launched Chrome · Harbor Desk, and the
  extension" and "Launched Chrome · Harbor Desk". `1h`'s wrong-browser notice reads "NK-63 came
  through the extension, not the launched browser." with "It has no Transaction Record, and its
  Persona is your declaration." as its line; its "feasibility" label is dropped. The browser-side
  cue keeps its label and now says the probe measured one pre-launch preference, the profile name
  and theme colour are unmeasured, and the cue ships only after a probe shows each supported
  product keeps both. `2e` answers question 7: a throwaway profile is named "Birdbrain · no
  Persona". No automation infobar is drawn.
- **S5 (`1u` to `1x`).** The Exhibit header in `1w` and the second row in `1x` draw the mark with
  **Clear my flag**, not a checkbox. The mark is one component (glyph, words, holders, dotted
  `border-strong` outline as decoration), matching the run setup row's dotted chip.
- **S6 (`1y`, `1z`, `2g`).** Breakdown reasons: "PDFs · this run cannot read them", "mbox file ·
  this run cannot read it", "Capture · its field records come from an older build" (the
  failed-build variant, which may name Reprocess, is in the tooltip). `2g` answers question 3:
  **Show them** opens a sheet in the investigation view; a Capture row opens the Captures screen
  on the Text tab; a PDF or mbox row opens the Exhibit's properties on the Data screen until a
  viewer for that kind exists.
- **States.** 3: "check the proxy in Settings → Operator." 5: see S3. 9 (`1m`): "An extension was
  added." with the name as an optional mono third line, "the browser calls it: Quay Clipper",
  shown only when the engine has one (question 5). 10 (`1n`) and 11 (`1o`): "Capture Session" in
  full. 13: `2f` adds the no-Persona variant. 14 (`1q`): drawn on the Operator tab, in the Egress
  block. 16 and 17: token snap and copy sweep only. 19: **Clear my flag** has no confirmation; 20:
  **Clear MB's flag...** keeps its confirmation.
- **Tokens, type, radii.** `--bb-ok`, `--bb-warn`, `--bb-alert`, `--m1`, `--m2` are gone. The
  canvas defines the app's status triples (`--color-success/warning/danger-surface/-line/-fg`)
  and `--color-member-1/2` with the app's values, since the bundled stylesheet lacks them. The REC
  pill, connection dot, and pop-out dot use the status tokens. Product text is 10, 11, 12, or 14
  pixels (9.5, 10.5, 11.5, 12.5 snapped); the five 700-weight product strings are 600. Chips are
  4-pixel radius; dialogs, cards, and the popover 6. `rounded-full` only on pills, badges, and dots.
  The canvas annotation (title, "i" markers) is unchanged.
- **Exhibit Numbers.** Every piece shows the Shared Case Ferry Line, members NK (this Operator) and
  MB, so each number carries the code of the member who committed it, with no `E-` prefix: NK-7
  (`1u`, `1w`), NK-12 (`1l`), MB-31 (`1v`), MB-40 (`1u`, `1v`), NK-44 (`1v`), NK-58, MB-59, MB-41
  (`2g`), NK-62 (`1f`, `1g`, `1u`, `2a`, `2g`), NK-63 (`1h`), NK-64 (`1s`).
- **Copy and layout sweep.** "Capture Session" replaces "session" in the Q12 answer and in `1h`
  ("Every surface that shows a running Capture Session"). `1f` moves Export to the top bar and adds
  the Share pill and capture health there.

## Invented names

Case **Ferry Line**; Persona **Harbor Desk**; site `ferrylog.example` with the title **Ferry Log**
and the tabs **Harbor notices**, **Tuesday sailings**, **Port timetable**, **Route map**; members
NK and MB; operator **A. Marsh**; Selector `@harbordesk`; address `desk@ferrylog.example`. New in
this revision, replacing two names that broke the rule: the Egress label **Proxy · Harbor relay**
(was a real city) and the extension **Quay Clipper** (was possibly a real one). No real person,
account, site, place, extension, or cookie appears.

## Pending

The chip tooltip's service-worker half (`1k`) and the copy rule behind it are ruling 3 of
2026-10-31 in the stage-2 plan (PR #2033), not merged when this bundle was made. If that PR
changes, that one string changes with it.
