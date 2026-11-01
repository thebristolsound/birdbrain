# Launched browser revision UI brief

Date: 2026-11-01
Audience: the designer working in the "Birdbrain UI" design project. Engineering contact: the
maintainer.
Status: draft for the designer. A revision brief for the 2026-10-12 mock. None of the designs it
describes is built, and nothing it describes is a product decision of its own: each change below
restates a verdict engineering gave, with the reason.

## What this brief asks

The 2026-10-12 mock (pieces `1a` to `1z`) answered the [launched browser and Case investigation UI
brief](2026-10-11-launched-browser-and-investigation-ui-brief.md). Engineering reviewed it in the
[feasibility assessment](2026-10-12-launched-browser-and-investigation-feasibility-assessment.md): a
verdict per surface and state, and the constraint behind each Modify. Engineering read the mock's
source, its visible text, and its tooltips, and did not click through it in a browser. The
assessment's rule is that engineering does no redesign; the designer revises the mock. This brief is
that revision request. You need nothing outside it: this brief restates in plain words every
verdict, ruling, and measurement that bears on a drawing.

Engineering builds the launched browser in steps. The launcher step (#1831) finds and opens the
browser and shows the panel with its tab list, stop control, browser-closed state, and launch
failure messages, but no Capture control. The clicked-Capture step (#1832) adds the Capture
control, the tab picker, and the shortcut. The Persona step (#1833) adds the Persona picker to the
start dialog.

Each surface (S1 to S6) and state (1 to 22) below keeps the assessment's number, so you can match
it to the row in `ENGINEERING_REVIEW.md`. For each one the brief says what to keep as drawn, what
to change and why, and what to add. Accepted pieces stay as drawn; do not redraw them beyond the
token changes under the "Cross-cutting" section.

Five things the 2026-10-12 mock could not take into account:

- The Egress setting has shipped. It lives in Settings, on the Operator tab, between the Trusted
  Timestamp Authority field and the Installation ID field. The one pointer to "Settings → Capture"
  for the Egress, in `1b`'s Egress tooltip, becomes "Settings → Operator"; state 3's "check the
  proxy in Settings" gains the tab name, and state 14's confirmation (`1q`) is drawn on the
  Operator tab (S2, states 3 and 14). The mock's other "Settings → Capture" pointers (the `1a`
  heading, `1j` state 1's "Choose one in Settings → Capture" line, and the Q7 answer at the top of
  the canvas) are about found browsers and keep that pointer; S1 changes the Q7 answer's tooltip
  for another reason.
- The no-VPN warning (#1696) has not shipped, so no app wording exists yet to reuse.
- The command palette's three footer buttons became action rows under the Case list on
  2026-10-29, after the assessment. **Launch browser** joins those rows (S2).
- A probe measured the launched browser on Linux and merged after the brief. Its findings that
  touch the panel are under "What the probe measured" below.
- The maintainer's rulings of 2026-10-31 are recorded in the stage-2 plan
  (`docs/plans/2026-10-31-capture-engine-stage-2.md`, on the `docs/capture-engine-stage-2` branch
  in PR #2033, not merged on 2026-11-01). They concern the signed record, its verifier, and the
  export report. One of them, ruling 3, changes a copy rule (see "Copy rules") and one string in
  `1k`: the chip tooltip's "cached or service-worker responses can leave gaps, and the inventory
  lists them" becomes "a cached response can leave a gap, which the inventory lists; a
  service-worker response has no endpoint, and the inventory counts those". That rule and that
  string are pending the merge of PR #2033.

## Fixed: not up for revision

The four groups below are settled. Design around them.

### Theme tokens

The app's theme is the source of truth, and the mock uses its token names, not raw colors.

- Surfaces and text: `canvas`, `surface`, `card`, `elevated`; `text-primary`, `text-secondary`,
  `text-muted`, `text-faint`; `border` and `border-strong`; one accent, `accent`, with
  `accent-hover` and `accent-subtle`. The accent is the only brand hue: primary buttons, links,
  focus ring, selected states.
- Status is a tinted triple, never a solid fill: `success`, `warning`, and `danger`, each with a
  10% `-surface`, a 20% `-line`, and a `-fg` foreground. The `-surface` and `-line` tints are 10%
  and 20% of one base per status, the same in both themes: success rgb(16,185,129), warning
  rgb(245,158,11), danger rgb(239,68,68). Light foregrounds: success `#047857`, warning `#92400e`,
  danger `#b91c1c`. Dark foregrounds: `#34d399`, `#fbbf24`, `#f87171`. Only the `-fg` values
  change in dark.
- Type scale: 10, 11, 12, 14, 18, 24, 36 pixels; these surfaces use nothing above 18. 12 is the
  working size for controls, inputs, badges, and card titles; 10 and 11 are for dense data; 14 is
  for dialog titles, labels, and tabs; 18 heads a page; 24 is a metric and 36 the one display
  size, neither needed here. Weights 400, 500, and 600, and nothing bolder. Display and body are
  Inter; mono is JetBrains Mono.
- Radius scale: 2, 4, 6 pixels. Controls take 4; cards, dialogs, toasts, and tab lists take 6.
  `rounded-full` is legal only for status pills, the Badge, and dots.
- One control metric: 28 pixels tall, 4-pixel radius, 12-pixel text; icon buttons 28 pixels
  square. Flat: no glow, no lifted hover; a hover is a border or fill change.
- Keyboard focus: a 2-pixel ring with a 2-pixel offset on every control.

The stylesheet bundled with the 2026-10-12 and 2026-10-28 handoffs (`birdbrain-ui` 1.0.1-beta.11)
carries the surface, text, accent, and border tokens, but not the status triples or the 2 / 4 / 6
radius scale. Define the status triples with the values above, as the 2026-10-06 bundle's live
prototype (`Birdbrain.dc.html`, the authority per its README) does for the three `-fg` tokens;
take the 2 / 4 / 6 radii from `src/renderer/styles/globals.css`, since neither 2026-10-06 file
defines radius tokens. Add no tokens of your own.

### The shell

Measured in the app today:

- Birdbrain's window is at least 900 by 600 pixels and opens at 1200 by 800.
- The top bar is 48 pixels tall and stands in for the hidden OS title bar. On a Case it holds, left
  to right: the logo, the Case breadcrumb (which opens the command palette as the Case switcher),
  the Case search at the center, then the REC indicator while a Capture Session runs, the Share
  pill, the extension connection status, capture health, Export, the Settings gear, and the theme
  toggle. On the Settings screen it holds the logo, a "Return to Birdbrain" button, the Capture
  Session controls plus REC while a Capture Session runs, and the theme toggle.
- The side rail is 48 pixels wide and appears on Case screens only: Home, then Overview,
  Captures, Notes, Signals, and Data. The dashboard, Settings, and the new-Case wizard have no
  rail.
- The Case action bar is a 40-pixel strip under the top bar, right-aligned, holding the Capture
  Session switch. Today it renders only while the extension is connected.
- The Captures screen is three resizable columns: a list (240 to 560 pixels), a viewer (at least
  360), and a details panel (320 to 680 pixels docked), with a 7-pixel separator between each pair
  of docked columns. Each side column folds to a 40-pixel strip, which is fixed chrome with no
  separator; the details panel folds on its own below 1,100 pixels, so below that width only the
  list-viewer separator remains. With the side rail, the screen's minimums take 695 pixels.
- Settings is a 192-pixel left nav with nine tabs: Capture, Storage, Appearance, Operator, Personas,
  Database, Updates, Diagnostics, About. The Capture tab holds **Capture screenshots** and the
  ignored URL patterns. The Operator tab holds the Egress block: a heading that reads **Egress**, a
  radio group of Direct, Proxy, and Tor, a proxy address field, and an optional label.
- The command palette opens on Ctrl+K or Cmd+K as a centered overlay listing Cases, then action
  rows from a hand-written `actions` array in `CommandPalette.tsx`: **Create new case**, a sharing
  row on a Case, **Join a shared Case...**, **Replay walkthrough**, and **Report a problem**. The
  arrow keys reach them and Enter runs the highlighted one. The palette has no action registry, so
  **Launch browser** goes in as one more row in that array. You need not draw it.
- Dialogs are a fixed overlay with a centered panel that closes on Escape: header, title,
  description, footer. Toasts sit bottom-center, at most 520 pixels wide, and leave after six
  seconds.
- The app has one visible window today. The popped-out panel (`1g`) is its first second window.

### Terms

These are glossary terms (`CONTEXT.md`), each restated here in a line. Use them as written and
avoid the listed words.

- A **Capture Session** is the state between the Operator starting and stopping work into the
  Active Case. In a launched browser, recording is on while one runs. Avoid _session_ on its own,
  _auto-capture_, and _recording mode_ for it.
- A **Persona** is a signed-in browser identity, the Operator's own or a pseudonym. Avoid
  _alias_, _sock account_, _profile_, _identity_, and _account_ for a Persona.
- The **Egress** is the network path Birdbrain's outbound traffic takes: Direct, through a Proxy,
  or through Tor, with a label the Operator chooses. It hides where the Operator is, not what
  browser is looking. Avoid _route_, _VPN mode_, and _anonymous mode_.
- A **Capture Method** says how a Capture was produced. `launched` is a Capture the Operator took
  in a launched browser and is operator-witnessed. `launched-passive` is one a running Capture
  Session took without a click and is never operator-witnessed. Both are planned.
- **Withheld from analysis** is an Operator flag on an Exhibit that keeps every analysis in its
  Case from reading it; the Operator's own Case search still shows the Exhibit, marked. Avoid
  _excluded_, _hidden_, and _suppressed_ for this flag.
- An **Exhibit** is one unit of acquired evidence in a Case, anchored in the Manifest: a Capture,
  an uploaded file, a saved image, an imported document. An **Exhibit Number** is the sequential
  per-Case reference an Exhibit receives when it is committed. The app prints it bare while the
  Case has one member and with the Member Code once it has more (`12`, `NK-12`), and an export
  always prints the code (`formatExhibitCitation` in `src/shared/exhibitCitation.ts`).
- A **Shared Case** is a Case held by more than one installation. A **Member Code** is the
  one-to-three character prefix the Owner assigns a member; in a Shared Case a citation is the
  Member Code, a hyphen, and the Exhibit Number.
- A **Selector** is a text or regular-expression pattern the Operator wants to find across a
  Case's Captures. A **Persisted Match** is the stored record that a Selector's pattern matched a
  specific Capture's text. The **Active Case** is the one Case the extension is working in.
- A **Transaction Record** is the Capture's record of the HTTP requests and responses of the
  page's load, from its first request to the moment of Capture. Its **inventory** accounts for
  every exchange the record lacks or holds in part, and why. **Bound TLS Details** are the TLS
  details the browser reported on the response that produced the Capture's bytes, recordable
  only because the engine was attached before the request was sent.

Working phrases, not glossary terms: the **launched browser** and the Operator's **everyday
browser**; a **browser profile**, the directory a launched browser runs on (one per Persona per
browser product, or a throwaway one when the Capture Session has no Persona); a tab **recorded
from its first request**, meaning the engine recorded its current page from that page's first
request, so a Capture of a tab without that flag carries no Transaction Record and no Bound TLS
Details; the **Capture Session panel**, the **start dialog**, and the **tab picker**; the
**retrieval slice**, the first piece of Case search engineering plans
(`docs/plans/2026-10-09-case-retrieval-first-slice.md`): search over link targets, image alt text,
and mail headers beside the Extracted Text search, an unreviewed view on the Data screen, and
opening a hit on the Text or Links tab; its **field records**, the per-Capture link and header
records it builds and searches; and **Extracted Data**, the parsed content the Data screen's
extracted-data view shows, which today's **Reprocess** re-runs.

### Copy rules

The claim-discipline rules apply to every string in the mock: state what a mechanism shows and
what it does not, use no unqualified assurance word, and keep each limit next to the capability
it limits. Plain words, second person, present tense.

- Persona stamps, verbatim: `launched` reads "captured in the Persona's launched browser";
  `launched-passive` reads "taken without a click in the Persona's launched browser"; neither
  says which account the page showed.
- Never describe a `launched-passive` Capture as operator-witnessed, on any surface.
- "Recorded from its first request" says the engine saw the page's requests from the first one. It
  does not say the page is genuine, or that the record holds every exchange: a response from the
  HTTP cache or the back-forward cache leaves a gap the inventory lists. A response a service
  worker served is in the record, with no remote endpoint, and the inventory counts such
  exchanges: say it is counted, never that it is missing. The same ruling drops "loaded
  speculatively" as a gap: pre-rendering is off while Birdbrain drives the browser, and a page the
  browser fetches ahead of time records as an ordinary exchange. Do not name a speculative load as
  a gap. Both halves are the maintainer's ruling 3 of 2026-10-31 in the stage-2 plan (PR #2033,
  not yet merged), so this rule is pending that merge; the service-worker measurement is the
  probe's P9.
- The Egress hides where the Operator is, not what browser is looking. Do not call the launched
  browser anonymous or undetectable: every page in it reads `navigator.webdriver` as `true`.
- The no-VPN warning says Birdbrain sees the machine's network path, not the browser's. Do not
  word it as a check of the browser's own traffic, and do not say what sites see.
- Write **Withheld from analysis**, never _excluded_, _hidden_, or _suppressed_, for that flag.
- Write Capture Session in full. For passive capture name the rule in these words: "every page
  that loads" or "pages a Selector matches."
- The "not read" count says the run did not read those Exhibits. Never word it, or its gap list
  entry, as if the Exhibits hold nothing or were checked and found empty.
- Write "on top" nowhere in the pop-out's copy (S3).
- Invented names only, and keep the ones the 2026-10-12 mock used: the Case **Ferry Line**, the
  Persona **Harbor Desk**, the site `ferrylog.example`, members NK and MB, the operator
  **A. Marsh**, and the tab titles **Harbor notices** and **Tuesday sailings**. No real person,
  account, site, or cookie appears in the mock.

## What the probe measured

A probe ran the launched browser on Linux (Ubuntu 24.04 under WSL2, no desktop session, Chrome
150 and Chrome for Testing 149). It is a measurement, not a decision. Four of its findings
contradict the stage-2 design, and they bear on the panel like this. Whether the design changes
to match them is the maintainer's open question (stage-2 plan, question 4); none of the four is a
ruling.

- **Tabs a page opens are recorded.** A plain `target=_blank` link or `window.open` with
  `noopener` opens a tab whose first request the probe recorded when it sent the setup commands
  and the resume together; the design still says to wait for each setup command to answer, and
  folding the probe's finding into it is the maintainer's open question (plan question 4). Such a
  tab carries the "from first request" chip. Nothing new to draw.
- **Tabs the Operator opens with Ctrl-click or middle-click are not.** Their document request
  reaches no recording session, so their "from first request" flag is false and a Capture of them
  carries no Transaction Record. The second row of `1k` (no chip) is the row for it, but its
  tooltip ("Recording failed to start on this page") and `1f`'s ("This page began loading before
  recording started") each name a cause, and a Ctrl-click or middle-click tab fits neither:
  recording started, and the document request still reached no session. Either name all three
  causes in the tooltip (the page began loading before recording started; the tab was opened with
  Ctrl-click or middle-click; recording failed to start) or name none and say only what the
  Capture will lack: no Transaction Record and no Bound TLS Details. The probe did not measure
  navigations the Operator starts from the browser itself, a reload included; see state 5.
- **A service worker attaches twice.** The probe says the engine has to drop the second attach or
  record each of the worker's exchanges twice; that ruling is still the maintainer's (plan
  question 4), and it is for the clicked-Capture step, not a drawing. Nothing to draw: the tab
  list shows tabs and windows only, never workers.
- **A shared worker belongs to no tab.** Its requests arrive on a session attached at the browser
  level. Nothing to draw, for the same reason.

Three more measurements the brief relies on: under X11 with no window manager the capture
shortcut registered and fired while the launched browser had focus, and the probe measured no
Wayland or desktop session (S3); no automation infobar appeared in the launched browser on Linux
(S4); and the browser exited within 0.6 seconds when its pipe closed, so the probe never saw a
browser left running from an earlier run (state 13).

## Surfaces

### S1. Found browsers in Settings (`1a`)

Keep: the **Launched browsers** group in Settings, on the Capture tab (which today holds
**Capture screenshots** and the ignored URL patterns); **Choose an executable...** with the note
that discovery can miss a `snap` or `flatpak` install; the refused "too old" row. The four
supported products are Google Chrome, Microsoft Edge, Brave, and Chromium, as `1a` lists them;
nothing else appears in the list. The example versions stay illustrative: the version floor is, in
the design's words, the oldest version on which the stage-2 probe passes. That probe is the
measurement work described under "What the probe measured" and has so far run on Chrome 150 and
Chrome for Testing 149 on Linux, so the floor has no number yet; the launcher step's PR states the
number (#1831).

Change: every row in the "reported ..., not yet confirmed" form (Brave and Microsoft Edge in
`1a`), and the Q7 answer at the top of the canvas, whose tooltip describes that form. Discovery
launches nothing, and Birdbrain confirms a browser's product and version only when it launches it.
No source says where a version comes from before that, and the probe's discovery step checked only
that executable paths exist. Draw the row with no version until Birdbrain has confirmed one. The
launcher step (#1831) shows the version `Browser.getVersion` reported at the browser's last launch
and says which, so draw that form too: reword the Google Chrome row's "confirmed" so it says the
version came from that browser's last launch. Engineering shows a "reported" version only on a
platform where it finds a source that runs nothing; you need not draw that form.

### S2. Start dialog (`1b` to `1e`)

Keep: the browser picker; the Persona picker defaulting to none, with the throwaway note (the
Persona step, #1833, builds it); the **Without a click** choice with its two options marked "after
#600"; the Egress shown and not editable; the operator name check (`1d`); the start and join
footers (`1b`, `1c`); the checklist between **Launch** and the shown tab (`1e`); **Launch browser**
in the Case action bar. Keep the palette action too, as one more row under the palette's Case list
beside **Create new case** and the others. The assessment placed it as a button beside three
footer buttons; action rows replaced those buttons on 2026-10-29, after the assessment.

Change four lines:

- **The subtitle.** "Pages you capture here keep a record of how they loaded" states the
  capability without its limit. A tab whose page began loading before the engine attached, or
  that the Operator opened with Ctrl-click or middle-click, yields a Capture with no Transaction
  Record. Put the limit in the same line as the capability.
- **The no-VPN line.** "No VPN seen. Sites will see this machine's address" asserts what sites
  see, and Birdbrain cannot check that: the check misses a VPN on the router, a corporate network,
  and a split tunnel. The visible line says what the tooltip's first sentence says: Birdbrain sees
  this machine's network path, not the browser's. Cut the tooltip's second sentence, "Sites see
  this machine's address unless something outside Birdbrain changes it", for the same reason. Keep
  "No VPN seen": the indicator the warning ticket builds shows "VPN seen" or "no VPN seen" and
  never the bare words "no VPN" (#1696). Engineering swaps in the warning's wording once it ships.
- **Where the Egress is set.** The tooltip's "change it in Settings → Capture before launching"
  sends the Operator to the Capture tab. The Egress block is on the Operator tab, so the pointer
  reads "Settings → Operator" instead.
- **The operator name tooltip.** "Set your name first, or Captures will be refused" is right; its
  tooltip's reason, the second sentence saying that no browsing goes without a Capture, is wrong.
  Birdbrain checks the name at launch so an Operator does not browse for an hour and then find
  every Capture refused, and until passive capture lands (#600) a launched browser captures nothing
  without a click. The tooltip becomes: "Every Capture carries an operator name. Birdbrain checks
  it before launch so you do not browse for an hour and then find every Capture refused."

### S3. Capture Session panel (`1f`, `1g`, `1k`, `1l`, `1r`)

Keep the panel's content: the header naming the browser, Persona, and Egress; the capture target
naming the tab's title, URL, Persona, window, and tab before the click; **Scroll to load** per
Capture, off by default; progress, then the Exhibit Number; the tab list with its neutral "from
first request" chip and its "matches now" Selectors, which write no Persisted Match; the
private-window, settings-page, and crashed rows; the tab picker; **Stop...** with its confirmation,
which closes the browser and keeps the Captures taken; **Pop out**; and, in `1f`, the disabled
**Launch browser** with its tooltip (state 4).

Change and add four things:

- **The rail below about 1,020 pixels.** `1f` draws a 320-pixel rail beside the Captures screen with
  Birdbrain at 900 by 600. The Captures screen's minimums already take 695 pixels (the 48-pixel
  side rail, a 240-pixel list, a 7-pixel separator, a 360-pixel viewer, and the 40-pixel details
  strip that forms below 1,100 pixels), so a 320-pixel rail fits beside them only from about
  1,020 pixels. Draw what the rail and the screen do below that width, down to 900. The screen's
  own side columns already fold to a 40-pixel strip; that is one pattern available to you.
- **Screens outside a Case.** The Q1 answer at the top of the canvas (its tooltip reads "320px
  wide, on every Case screen while a launched browser is open") puts the rail on every Case
  screen. The dashboard and Settings have no side rail and no Case action bar; the Settings top bar
  carries the Capture Session controls and REC. Draw what the Operator sees on the dashboard and in
  Settings while a launched browser is open. States 14 and 15 happen in Settings, so the panel's
  state there matters.
- **The pop-out on Linux.** The heading of `1g` reads "Popped out, on top beside the browser" today.
  Electron does not support always-on-top on Wayland, and on Linux Electron selects Wayland by
  itself, so on a Wayland desktop the popped-out window is an ordinary window the browser can cover.
  Keep "on top" out of the heading, the tooltip, and every string in `1g`, and out of that Q1
  answer's tooltip ("stays on top beside the browser"). The window's content stays: the capture
  target, the tab count, and the last Exhibit Number; Tags and Notes open in the main window.
- **The shortcut (`1f`, `1r`).** The picker and its "Which tab?" heading stay. Two changes to the
  shortcut. First, the mock writes the key as the glyphs ⌃⇧S (Control, Shift, S), beside the
  **Capture** button in `1f` and on the shortcut line in `1r`; the design names no key,
  engineering picks one at build time, and Microsoft Edge, one of the four supported products,
  already binds Ctrl+Shift+S to its Web capture tool. Show a placeholder key in both places, not
  ⌃⇧S. Second, Birdbrain cannot always tell that the shortcut failed: registration returns a
  failure for some causes, but GNOME 50 rejects a bind with no error reaching the app when the app
  ID does not resolve, and Birdbrain's Linux packages set no desktop name (#648). The probe
  measured the shortcut only under X11 with no desktop. So never show the shortcut as working. The
  default line presents the shortcut as something to try and names the **Capture** button as the
  way to capture; the struck-through form appears only when Birdbrain knows registration failed,
  and it names the button too.

### S4. Telling the browsers apart (`1h`, `1i`)

Keep, on Birdbrain's side: the one browser name on every surface that shows a running Capture
Session: "REC · Launched Chrome" in the REC pill, and "Launched Chrome · Harbor Desk" in the
switch's source line, the panel header, and the capture target, as `1h` lists them; the switch
shown while the extension is connected or a launched browser is open; and the stop confirmation
that says the browser will close and the Captures are kept. Today the REC indicator shows the
static text "REC" and the switch renders only while the extension is connected; both change in the
build. Stopping from the switch closes the browser and stops the extension's Captures too, because
one running flag serves both, as `1i` says.

Change: the wrong-browser notice. "E-63 came from your everyday browser, not the launched one"
claims what Birdbrain does not know. Birdbrain knows the Capture came through the extension, not
which browser the extension runs in. Write the line yourself under that constraint: it says the
Capture came through the extension, not the launched browser, and the substance of its tooltip
(the Capture has no Transaction Record, and its Persona is the Operator's declaration) is the
content. Print the Exhibit Number as the app does (see "Exhibit Numbers").

Add: the browser-side cue keeps its "feasibility" label. The probe measured one preference written
before first launch, and Chrome kept it; the profile name and theme color are two more values,
unmeasured on any product, so the cue ships only after a probe shows each supported product keeps
both. Draw the profile name for a throwaway browser profile too, which has no Persona label to
show. Draw no automation infobar: none appeared on Linux.

### S5. Withheld from analysis mark (`1u` to `1x`)

Keep as drawn: the glyph, the words **Withheld from analysis**, and the holders in a dotted
outline; "Withheld" in a dense table with the full words as the tooltip and the accessible name;
no action on a search row, which stays navigation only; the opened result on the Text or Links tab
with the span or row highlighted, and the mark with **Clear my flag** on the Exhibit header
there. The wording matches the accepted investigation mock's run setup row and checkbox.

Two conditions, no redraw:

- The outline is decoration. `border-strong` is `#d4d4d8` in the light theme, 1.48:1 against a
  card, so the glyph and the words carry the mark and the outline is never the only cue.
- The mark is a small new component in the build; the app's only chip primitive has no dotted
  variant. Draw it once and reuse it in each placement.

The mock draws where a withheld result opens as the retrieval slice opens it, and one documented
rule disagrees with that plan; the maintainer owns that conflict. The withheld-mark decision
record (ADR-0044) says a withheld result opens in the source inspector; the retrieval slice opens
it on the Text or Links tab and lets the source inspector take over later, and `1w` follows the
retrieval slice. If the maintainer rules that the retrieval slice waits for the source inspector,
`1w`'s target changes; draw nothing new for that until the ruling lands, and engineering will say
so when it is settled.

### S6. "Not read" count and gap entry (`1y`, `1z`)

Keep: the count third in the header, "55 Exhibits read · 3 withheld · 4 not read"; the breakdown
headed "This run did not open these Exhibits"; and **Show them** on the gap entry. Your case for
an action there holds: the rule that entries in "Searches not yet run" carry no action covers
searches, whose later action is a consent prompt, and this entry runs no search.

Change two reasons in the breakdown:

- "1 Capture · needs re-processing" names a remedy the Operator has no control for. The retrieval
  slice rebuilds stale field records on its own when the Case workspace opens, after an import,
  and on reprocess, and today's **Reprocess** re-runs Extracted Data only. State the reason
  instead: the Capture's field records come from an older build, or are missing, failed, or
  partial.
- "can't be read yet" promises PDF and `mbox` reading, which is only proposed and in no planned
  work. Say the run cannot read them, and drop "yet" from the line.

Add: where **Show them** (and "Show the 4 Exhibits" in the breakdown) opens, and what each row
opens. No surface lists a set of Exhibits by ID today: the Captures screen takes one Capture, and
the unreviewed tab lists by criteria. The four Exhibits in state 21 span three kinds: Captures, a
`document` (the PDFs), and an `attachment` (the `mbox` file). Draw the list and the target of
each row.

## States

Keep these as drawn. Each row names the piece and any condition engineering attached.

| State | Piece | Keep as drawn, with this note |
| --- | --- | --- |
| 1. No supported browser | `1j` | With its two variants in the tooltip (none found; chosen executable unrecognized or below the floor). |
| 2. Debugging connection does not answer | `1j` | No change. |
| 3. Proxy refuses before launch | `1j` | The line gains the tab name: "The browser wasn't opened; check the proxy in Settings → Operator." (S2). |
| 4. A launched browser is already open | `1j`, `1f` | The refusal with **Show panel**, and the disabled **Launch browser** with its tooltip. |
| 6. Private-window tab | `1f`, `1k` | No change. |
| 7. Capture abandoned | `1l` | No change. Engineering adds a reason or an event kind for it; the feed's kinds today are received, stored, failed, and skipped. |
| 8. Crashed tab | `1k` | No change. |
| 12. Closed before it showed | `1o` | No change. |
| 13. Browser left from an earlier run | `1p` | No change to the Persona form. Add a variant with no Persona name: engineering expects to detect the leftover browser through its browser profile's lock file, whose path carries the Persona's ID, and a throwaway browser profile has none. |
| 14. Changing the Egress | `1q` | As drawn, on the Operator tab of Settings. |
| 15. Deleting a Persona whose browser is open | `1q` | No change. |
| 16. Passive capture running (after passive capture lands, #600) | `1s` | As drawn. Changing the rule from the panel mid-session follows the design; each change goes to the activity feed under an event kind of its own. |
| 17. Port mode warning (only if built) | `1t` | As drawn. |
| 18. Withheld result in each placement | `1u`, `1v`, `1w` | As drawn, with S5's conditions. |
| 19. Withheld result opened | `1w` | **Clear my flag** needs no confirmation, which answers your first open question: clearing writes a clear row, setting again writes a set row, so the action reverses, and the run-out-of-date banner already says the shown run no longer matches the Case. |
| 20. Withheld by another member | `1x` | As drawn, including the Owner clearing a revoked member's flag as a recorded action. **Clear MB's flag...** (in `1x`) keeps its confirmation, because it writes a row in a revoked member's name. |
| 22. Gap list not-read entry | `1z` | As drawn, with S6's target for **Show them**. |

Change these five.

### 5. Recording, one tab not from its first request (`1f`, `1k`)

Keep the chips. Remove "Reload it to record the whole load." from `1f`'s Port timetable row
(`1k`'s row has no such line), for three reasons. The design never says a reload yields a page
recorded from its first request, and the probe lists navigations the Operator starts in the
browser as not measured; engineering measures a reload in the launcher step and may restore advice
then. "The whole load" claims more than the flag says: a page recorded from its first request can
still miss exchanges served from the HTTP cache or the back-forward cache, and a service-worker
response carries no endpoint. And the advice cannot apply to the variant where recording failed to
start. The row says what the Capture will lack and stops there: the tooltip stays, attached to the
"not from first request" label and reworded as "What the probe measured" says, and the visible row
gains nothing. The crashed row's "Reload it in the browser, then capture" (state 8) is a different
case and stays.

### 9. Extension warning (`1m`)

"An extension was added: Tab Saver" names the extension. The engine watches for extension
targets, no source says such a target carries the extension's name, and Chrome's own component
extensions appear as the same target kinds. Draw the warning without a name, with the name as an
optional detail shown only when the engine has one: the first line reads "An extension was added."
and, where the engine has a name, it follows as a detail in a form you choose (question 5). The
second line ("It could change how traffic leaves this browser") stays, and Captures continue: the
warning refuses nothing.

### 10. Browser closed, Capture Session running (`1n`)

Everything stays except one word. "The session keeps running until you stop it" uses "session" on
its own, which the glossary rules out. Write "The Capture Session keeps running until you stop it"
in its place. **Launch again...** and **Stop Capture Session** stay. Whether **Launch again...**
reuses the throwaway browser profile within the same Capture Session is engineering's to settle in
the launcher step; draw nothing that depends on the answer.

### 11. Ended by the Egress check (`1o`)

As state 10: the line "The session ended; earlier Captures are kept" becomes "The Capture Session
ended; earlier Captures are kept" with no other change.

### 21. Non-zero "not read" count (`1y`)

As S6: the two reason strings in the breakdown, and the target of "Show the 4 Exhibits" in the
breakdown. The header string stays.

## Cross-cutting

### Tokens, type, and radii

- **Status colors.** The mock defines `--bb-ok`, `--bb-warn`, and `--bb-alert` again (`#047857`,
  `#b45309`, `#dc2626` light; `#34d399`, `#fbbf24`, `#f87171` dark). The 2026-10-04 assessment
  replaced the warning and danger values with the app's `warning-fg` (`#92400e`) and `danger-fg`
  (`#b91c1c`), and the 2026-10-06 live prototype (`Birdbrain.dc.html`) uses the app's tokens; its
  reference canvas, `Case Investigation.dc.html`, still carries the old `--bb-*` values. Use
  `success-fg`, `warning-fg`, and `danger-fg`, with their `-surface` and `-line` partners for
  fills and lines.
- **Type.** Besides 10, 11, 12, and 14 pixels, the mock sets text at 8.5, 9, 9.5, 10.5, 11.5,
  12.5, 13, and 22 pixels. Snap each to 10 / 11 / 12 / 14 / 18. The 9-pixel size has 48 uses and
  the 10.5-pixel size 33; expect most of them to land on 10 and 11.
- **Radii.** The mock's 3-pixel chips (18 uses) and 8-pixel surfaces (9 uses) come onto 2 / 4 /
  6. `rounded-full` stays on pills, badges, and dots only.

### Exhibit Numbers

The mock writes `E-07`, `E-31`, `E-40`, `E-44`, `E-62`, `E-63`, and `E-64`. In the app the number
prints bare while the Case has one member and with the Member Code once it has more, with no `E-`
prefix: `62` or `NK-62`. `1l`'s `NK-12` already follows the app. Only `1x`'s heading names a
Shared Case; say per piece whether the Case shown is shared. In a shared Case each number takes
the code of the member who committed that Exhibit: `1l` writes `NK-12` for a Capture this Operator
took, so a Capture taken here reads `NK-62`; give the rest NK or MB and keep each number the same
across pieces. An unshared Case prints `62`.

## Questions for the designer

Your calls. Engineering settled none of them.

1. Below about 1,020 pixels, does the rail give way or the Captures screen? The screen's own side
   columns fold to a 40-pixel strip; the rail could fold the same way, the pop-out could be the
   only form at that width, or something else.
2. What does the Operator see on the dashboard and in Settings while a launched browser is open,
   given that neither screen has a side rail or a Case action bar?
3. Where does **Show them** open, and what does each of its rows open: a Capture, a PDF, an
   `mbox` file?
4. How does the shortcut line read in its two forms: the default, where Birdbrain cannot tell
   whether the shortcut registered, and the struck form, where it knows it failed? Both name the
   **Capture** button as the way.
5. How does the extension warning read with no extension name, and how does the optional name
   attach when the engine has one?
6. How does a found-browser row read before Birdbrain has launched that browser, and after, when
   it shows the version `Browser.getVersion` reported at the last launch (the launcher step,
   #1831)?
7. On the browser's side (feasibility), what does a throwaway browser profile's name read, with
   no Persona label to show?
8. With "on top" gone from the copy, what tells the Operator the popped-out window is Birdbrain's
   when the browser covers it? Draw the cue and any control you want for bringing it to the
   front; whether Birdbrain can raise that window on a Wayland desktop, or a shortcut reaches it
   while the browser has focus, is engineering's to check in the launcher step.

## Not in scope

Do not draw these:

- Anything the assessment accepted, beyond the token snap: redraw no accepted piece.
- The Persona screen and the browser cookie import (the import dialog and its keychain prompt
  included), which a separate decision covers (ADR-0052).
- The in-app display of a Capture's capture facts: its Egress, inventory reasons, counts of
  withheld request bodies or service-worker exchanges, Scroll-to-load outcome, and Bound TLS
  Details (#1816). The 2026-10-31 rulings that reshape those fields change nothing you draw there;
  the one mock string they touch is `1k`'s chip tooltip (see "Copy rules").
- The unreviewed view and fielded search themselves, apart from the mark on them.
- The Companion and the extension changes of stage 3.
- Any investigation view surface the accepted 2026-10-06 mock already settles, apart from the
  header count and the gap list entry.
- Firefox, a per-Persona Egress, downloads started in a launched browser, and browser permissions
  beyond the geolocation the engine denies.
- Worker rows in the tab list, and any row for a target that is not a tab or window.
- A glossary term for what a launched browser's Capture Session owns (still open).
- A number for the version floor, a key for the shortcut, and a "Chrome for Testing" row in
  Settings: the floor has no number, engineering picks the key, and the maintainer ruled on
  2026-10-31 that Chrome for Testing is its own browser family beside Chrome, Edge, Brave, and
  Chromium (stage-2 plan, ruling 8); how a found or chosen Chrome for Testing build is labelled in
  Settings is engineering's, and this brief asks for no row.

## Deliverable

A revised bundle, returned as the 2026-10-12 one was, under a dated folder. Suggested repo path:
`docs/design-handoff/<YYYY-MM-DD>-launched-browser-revision/`, where `<YYYY-MM-DD>` is the day you
send it. It holds:

- `Launched Browser.dc.html`: the canvas, revised in place. Pieces revised keep their letters
  (`1a` to `1z`). Added pieces take `2a`, `2b`, and so on in canvas order, each with a heading
  naming the surface or state it answers, as the existing pieces do, and each sits directly after
  the piece it extends: after `1f`, the rail below 1,020 pixels; after `1g`, the dashboard and
  Settings forms; after `1h`, the throwaway profile name; after `1p`, the no-Persona variant of
  state 13; and after `1z`, the **Show them** list. Open it from the design project root so the
  Birdbrain UI stylesheet loads. Keep the labels "once #600 lands" on state 16, "only if built" on
  state 17, and "feasibility" on every browser-side cue.
- `README.md`: the title and date, the line "Answers
  `docs/specs/2026-11-01-launched-browser-revision-ui-brief.md`", the suggested repo path, a
  "Revisions" list with one entry per item changed or added here (S1 to S6, the states, Tokens,
  Exhibit Numbers) saying what changed, and the invented names.
- `ENGINEERING_REVIEW.md`: one row per surface (1 to 6) and state (1 to 22), in the 2026-10-12
  file's two tables and their columns, plus a third table, Cross-cutting, with the Surfaces
  table's columns and two rows (Tokens and Exhibit Numbers). Verdict, Size, and Constraint are
  left blank for engineering. A "Designer answers" section numbered to the eight questions above,
  and an "Open for engineering" list.

Draw in this order. First the parts the launcher step builds (#1831): S1, S2 apart from its
Persona picker (the Persona step, #1833, builds that), and S3 (the rail and its form below 1,020
pixels, the screens outside a Case, the pop-out, and the stop control), and states 1 to 4, 9, 10,
11, and 13. Next the parts the clicked-Capture step builds (#1832): the capture target, the tab
picker and shortcut line, the "from first request" chip, and states 5 to 8. After those, the
investigation items: S6, states 21 and 22, and the token and Exhibit Number changes across S5 and
states 18 to 20. Then S4's wrong-browser notice (`1h`). Last, S4's browser-side cue. States 16 and
17 change only under the token snap.

Engineering answers with a second feasibility pass in the same shape as the first: a verdict, a
size, and the constraint behind each row.

## References

- The mock under revision:
  [`docs/design-handoff/2026-10-12-launched-browser/`](../design-handoff/2026-10-12-launched-browser/),
  its [`README.md`](../design-handoff/2026-10-12-launched-browser/README.md) and
  [`ENGINEERING_REVIEW.md`](../design-handoff/2026-10-12-launched-browser/ENGINEERING_REVIEW.md).
- The verdicts this brief restates: the
  [feasibility assessment](2026-10-12-launched-browser-and-investigation-feasibility-assessment.md).
- The brief the mock answered: [launched browser and Case investigation UI
  brief](2026-10-11-launched-browser-and-investigation-ui-brief.md), whose terms, rulings, and
  constraints still hold.
- The design: [Capture engine, stage 2: launched Chromium
  browsers](2026-10-10-capture-engine-launched-browser-design.md).
- The measurements: the [launched browser probe
  spike](2026-10-11-capture-engine-launched-browser-probe-spike.md).
- The 2026-10-31 rulings and open question 4: the stage-2 plan,
  `docs/plans/2026-10-31-capture-engine-stage-2.md`, on the `docs/capture-engine-stage-2` branch in
  PR #2033 and not merged on 2026-11-01. This brief uses its rulings 3 and 8 and its question 4.
- The retrieval slice: [Case retrieval, first
  slice](../plans/2026-10-09-case-retrieval-first-slice.md).
- The accepted investigation mock, for the header string and the withheld drawings:
  [`docs/design-handoff/2026-10-06-case-investigation-view/`](../design-handoff/2026-10-06-case-investigation-view/README.md).
- Decisions the copy rests on: app traffic routing and the no-VPN warning (ADR-0032), passive
  capture in the launched browser (ADR-0037), the withheld mark in Case search (ADR-0044), and no
  request body in a launched browser's record (ADR-0051), under [`docs/adr/`](../adr/).
- Vocabulary: [`CONTEXT.md`](../../CONTEXT.md). Writing rules:
  [`docs/agents/writing-guide.md`](../agents/writing-guide.md). Tokens:
  `src/renderer/styles/globals.css` and the brand book under `design-system/content/`.
- Issues named above: the launcher step (#1831), the clicked-Capture step (#1832), the Persona
  step (#1833), passive capture (#600), the no-VPN warning (#1696), the Linux desktop name gap
  (#648), and the in-app capture facts (#1816).
