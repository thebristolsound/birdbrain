# Launched browser and Case investigation UI design brief

Date: 2026-10-11
Audience: the designer working in the "Birdbrain UI" design project. Engineering contact: the
maintainer.
Status: draft for the designer. None of the designs it describes is built. It follows the
maintainer's rulings of 2026-10-10, by the numbers the roadmap gives them under "Ruled on
2026-10-10" (Roadmap :88-146); rulings 37 to 56 are the stage-2 spec's decisions D1 to D23 except
D18 (Roadmap :132-133). Its content comes from the sources below, and it adds no product decision:
where the sources leave something open, "Questions for the designer" asks it. It covers only what a
designer needs to draw the surfaces.

Sources, with the short names this brief cites them by:

- **Spec**: [Capture engine, stage 2: launched Chromium browsers](2026-10-10-capture-engine-launched-browser-design.md),
  merged in #1804.
- **Plan**: the [Case investigation engine plan](../plans/2026-10-10-case-investigation-engine.md),
  merged in #1805.
- **Engine spec**: the [Case investigation engine](2026-10-02-case-investigation-engine-design.md).
- **Retrieval plan**: the [Case retrieval first slice](../plans/2026-10-09-case-retrieval-first-slice.md).
- **Roadmap**: the
  [agent briefs for three programmes](../plans/2026-10-10-three-programme-agent-briefs.md).
- **View brief**: the [Case investigation view UI design brief](2026-10-03-case-investigation-view-ui-brief.md),
  whose shape this brief follows.
- **Assessment**: the
  [Case investigation view feasibility assessment](2026-10-04-case-investigation-view-feasibility-assessment.md).
- **Mock**: the accepted investigation view bundle,
  [`docs/design-handoff/2026-10-06-case-investigation-view/`](../design-handoff/2026-10-06-case-investigation-view/README.md),
  cited by the lines of its `README.md`.

A citation such as "Spec :255-258" names lines in that document at `origin/main` `2598173f`. This
brief cites other files by path.

## What the feature is

This brief describes proposed designs. None of it ships yet: the present tense from here on
describes the design, not the current app. It covers two pieces of work that share one designer
pass (rulings 55 and 70).

### The launched browser

Today an Operator who wants a signed-in page captured opens it in their everyday Chrome and clicks
the extension. That Capture has no Transaction Record, because the page loaded before anything could
record it, and the Persona on it is the Operator's declaration, which Birdbrain cannot check (Spec
:39-43).

In the design, Birdbrain starts its own copy of Chrome, Edge, Brave, or Chromium, with a browser
profile of its own, and the Operator browses in it (Spec :45-48). The engine attaches before the
first request, so a Capture taken there can carry a Transaction Record, the record of the page's
HTTP requests and responses (Spec :48-50; `CONTEXT.md:57-58`). The Operator reads pages in that
browser's window and runs the Capture Session from a panel in Birdbrain, which lists the browser's
tabs and takes a Capture of one (Spec :255-258, :263-266). Birdbrain draws nothing inside the page
(Spec :251-253).

Two parts have no design yet: the Capture Session panel (stage-2 decision D19) and a way to tell the
launched browser apart from the Operator's everyday one (D22). The launched Chrome has the same icon
as the everyday Chrome, and a Capture taken in the wrong browser carries the wrong Capture Method
and possibly the wrong Persona (Spec :1145-1148). The extension in the everyday browser keeps
working and writes `extension` Captures until stage 3 (Spec :258-259), so both browsers can be open
at once.

### Two items for the Case investigation work

- **The Withheld from analysis mark in Case search.** The Operator's own Case search still finds an
  Exhibit Withheld from analysis, shows it with a mark, and still opens it (ADR-0044,
  `docs/adr/0044-case-search-indexes-are-rebuildable-caches-outside-the-manifest.md:66-70`). The
  mark has no design yet (Plan :1664).
- **The "not read" count.** The first slice of the investigation engine cannot read some Exhibits:
  PDF and `mbox` Exhibits, and Captures whose text file or field records are missing, incomplete,
  or out of date (Plan :1046-1049, :1058-1069). The investigation view's header shows a "not read"
  count beside "read" and "withheld", and the gap list names the kinds the run did not read, so an
  Exhibit the run could not read never passes for one that holds nothing (Plan :1742-1748).

### Terms

These are `CONTEXT.md` terms:

- A **Capture Session** is the state between the Operator starting and stopping work into the
  Active Case (`CONTEXT.md:69-71`). In a launched browser, recording is on while one runs.
- A **Persona** is a signed-in browser identity, the Operator's own or a pseudonym
  (`CONTEXT.md:41-43`).
- The **Egress** is the network path Birdbrain's outbound traffic takes: Direct, through a Proxy,
  or through Tor, with a label the Operator chooses. It hides where the Operator is, not what
  browser is looking (`CONTEXT.md:97-99`).
- A **Capture Method** says how a Capture was produced. `launched` is a Capture the Operator took
  in a launched browser, and is operator-witnessed; `launched-passive` is one a running Capture
  Session took without a click, and is never operator-witnessed (`CONTEXT.md:77-79`; Spec
  :1001-1003). Both are planned.
- **Withheld from analysis** is an Operator flag on an Exhibit that keeps every analysis in its
  Case from reading it. Case search still shows the Exhibit, marked (`CONTEXT.md:271-273`).
- **Selector**, **Persisted Match**, **Active Case**, **Exhibit Number**, **Shared Case**, and
  **Member Code** mean what `CONTEXT.md` defines.

These working phrases are not glossary terms:

- The **launched browser** and the Operator's **everyday browser**.
- A **browser profile** is the directory a launched browser runs on: one per Persona per browser
  product, or a throwaway one when the Capture Session has no Persona (Spec :662-677). It is not a
  Persona: `CONTEXT.md:43` lists "profile" among the words to avoid for one.
- A tab is **recorded from its first request** when the engine recorded its current page from that
  page's first request (Spec :479-482). A Capture of a tab without that flag carries no Transaction
  Record and no Bound TLS Details.
- The **Capture Session panel**, the **start dialog**, and the **tab picker** name surfaces in this
  brief.

`CONTEXT.md` has no entry yet for the boundary of what a launched browser's Capture Session owns
(stage-2 decision D18, still open, Spec :1392-1393). This brief coins no term for it, and the mock
should describe it in plain words.

## Decisions the mock must honor

These are settled. Do not redesign them; design around them.

### Rulings of 2026-10-10

| Ruling | Decision | Source |
| --- | --- | --- |
| 37 (stage-2 decision D1) | Birdbrain drives the launched browser over a debugging pipe that no other process on the machine can use. A fallback over a loopback port is built only if the pipe proves problematic. If it is built, it is a mode the Operator opts in to for one Capture Session, and it shows a warning that another process could take over the browser. Draw that warning as state 17, marked as drawn only if the fallback is built. | Spec :384-405, :1341-1345 |
| 45 (D9) | A Capture Session with no Persona uses a throwaway browser profile, deleted when the Capture Session ends. If the Operator signs in by hand there, no Persona is recorded. | Spec :673-677, :1367-1368 |
| 46 (D10) | One launched browser at a time in the first stage-2 release. | Spec :232-234, :1369-1370 |
| 47 (D11) | The Persona wording on a Capture is "captured in the Persona's launched browser" for `launched` and "taken without a click in the Persona's launched browser" for `launched-passive`. The `background` and `extension` wording does not change. | Spec :1011-1022, :1371-1372 |
| 50 (D14) | While the Egress is not Direct, the Capture Session panel warns when an extension appears in the browser profile, and Birdbrain does not refuse Captures. | Spec :859-861, :1382-1384 |
| 53 (D20) | A launched browser runs only inside a Capture Session. Launching one starts a Capture Session if none is running, or joins the running one and its Active Case. Ending the Capture Session closes the browser. Closing the browser's last window closes the browser only, and the Capture Session keeps running until the Operator stops it in Birdbrain. | Spec :219-228, :281-284, :1398-1406 |
| 54 (D21) | The Operator chooses the Persona when launching the browser, from a picker that defaults to none, and the choice holds for that browser's life: it chooses the browser profile and stamps every Capture taken in it. | Spec :235-241, :1407-1412 |
| 55 (D19 and D22) | An agent writes this brief for the Capture Session panel and for telling the launched browser apart from the everyday one, and the designer designs both in the Birdbrain UI design project. Engineering runs a feasibility pass on the mock before the stage-2 clicked-Capture step. | Spec :193-198, :1394-1397, :1413-1416 |
| 68 (engine plan open question 15) | The investigation header shows a "not read" count beside "read" and "withheld", and the gap list's "Searches not yet run" group has an entry naming the kinds the run did not read. | Plan :1742-1748 |
| 70 (the engine plan's gate "Design the Withheld from analysis mark") | The Withheld from analysis mark and the "not read" count join this brief, beside the Capture Session panel. | Roadmap :141; Plan :1664 |

### Constraints from the sources

| # | Decision | Source |
| --- | --- | --- |
| 1 | Birdbrain puts nothing in the page or the browser: no button, overlay, highlight, or consent filter in a page, and no Birdbrain extension in the browser profile. The Capture control lives in Birdbrain. | Spec :251-253, :905-906, :916-920 |
| 2 | The launched browser is not disguised. Its user agent and client hints are the product's own, the engine passes no switch on Chrome's unsupported-flag list, and nothing hides the automation flag. | Spec :187-189, :334-335, :886 |
| 3 | Launching needs an Active Case and an operator name. Birdbrain checks the operator name before it launches the browser, so an Operator never browses for an hour and then finds every Capture refused. | Spec :210, :229-231 |
| 4 | The Egress is fixed at launch. The start dialog shows the Egress and its label and does not let the Operator change them. A Capture records the Egress kind and label, never the proxy host or port. | Spec :213-214, :817-819 |
| 5 | The Persona on a Capture is the browser profile's; the Operator never picks it at capture time. Each Persona wording states which Persona's browser profile Birdbrain used, never which account the page showed: the Operator can sign in or out by hand, and the stamp does not follow that. | Spec :164-165, :511-512, :1025-1027 |
| 6 | A Capture belongs to one tab and one committed document, and goes to the Capture Session's Active Case at the moment the Operator triggers it. Only the Operator's action in Birdbrain, or a running Capture Session's passive rule, triggers a Capture; a page cannot. | Spec :268-271, :922-924 |
| 7 | The keyboard shortcut never guesses which tab to capture. | Spec :912-915 |
| 8 | A tab in a private window, or one whose address is not `http` or `https`, is never captured. The panel shows a private-window tab with the reason. | Spec :276-277, :506-508, :513-514 |
| 9 | The panel's list of Selectors a page matches writes no Persisted Match. Persisted Matches still come only from ingest. | Spec :255-258, :949-953 |
| 10 | Captures already taken stand when the browser closes or a check ends the Capture Session. No failure at the level of a Capture Session writes a Manifest Entry. | Spec :856-857, :1090, :1094-1095 |
| 11 | The Operator adds Tags and Notes in Birdbrain, on the new Capture. | Spec :265-266 |
| 12 | A withheld Exhibit stays in the Operator's own Case search, carries the Withheld from analysis mark, and still opens, so the Operator can read it and clear the flag. In a Shared Case the mark names each member who holds a flag. A member clears only their own flag, and the Exhibit stays withheld until every member who set one has cleared it. | ADR-0044 :66-70; Plan :1318-1327; Engine spec :161 |
| 13 | Setting or clearing a withholding flag puts a shown investigation run out of date. | Assessment :206-214 |
| 14 | The run reports how many eligible Exhibits it did not read, by kind and reason. | Plan :909-910, :1067-1069 |
| 15 | WCAG 2.2 AA is the product target. | `docs/agents/osint-investigation-standards.md:59` |
| 16 | Birdbrain's window minimum is 900 by 600 and its default is 1200 by 800. | `src/main/windowSize.ts:18`, :21 |

## Surfaces to draw

Draw each surface in the existing design language of the Birdbrain UI project. Use the theme's
semantic tokens, not raw color values (`docs/agents/architecture.md:119`). The surfaces are numbered
so the engineering response can give a verdict per item.

Most of what follows is needed for the first stage-2 release and for the investigation work. Two
labels mark parts to draw after the rest:

- **Once #600 lands.** Passive capture: the Capture Session captures every page that loads, or the
  pages an Active Case Selector matches, without a click (Spec :211-213, :955-985).
- **Only if built.** The port fallback of ruling 37.

### 1. Settings: the browsers Birdbrain found

Spec "Before the first Capture Session" (:200-206).

- **Found browsers.** The supported Chromium browsers Birdbrain found on the machine, each with its
  version (Spec :202-203).
- **Choose an executable.** A way to choose a browser executable Birdbrain did not find (Spec
  :203). Discovery may miss browsers installed through Snap or Flatpak (open question P20, Spec
  :299-300, :1488-1489).
- **Confirmed at launch.** Discovery launches nothing. Birdbrain confirms a browser's product and
  version only when it launches it, and refuses a product it does not recognize, or one below the
  supported version floor, with a message (Spec :205-206, :302-306). See state 1.

Settings today has these sections: Capture, Storage, Appearance, Operator, Personas, Database,
Updates, Diagnostics, and About (`src/renderer/components/settings/SettingsView.tsx:39-47`). Where
the list goes is your call (question 7).

### 2. Starting a Capture Session in a launched browser

Spec "Starting a Capture Session in a launched browser" (:208-241). The Operator launches a browser
from Birdbrain (Spec :210); where that action lives is your call (question 8). The start dialog
shows:

- **Browser.** One of the browsers from surface 1 (Spec :211).
- **Persona.** A picker that defaults to none; the choice holds for the browser's life (ruling 54).
  With none, the browser profile is throwaway and Birdbrain deletes it when the Capture Session
  ends, and a sign-in by hand there records no Persona (ruling 45).
- **What the Capture Session captures without a click.** Nothing, every page that loads, or the
  pages an Active Case Selector matches (Spec :211-213). _Once #600 lands_ for the last two; until
  then a Capture Session in a launched browser captures nothing without a click.
- **Egress.** Its kind and label, shown and not editable (Spec :213-214; constraint 4).
- **The no-VPN warning.** While the Egress is Direct and no VPN is seen, the warning #1696 builds,
  which says Birdbrain can see the machine's network path, not the browser's (Spec :214, :874-876;
  ADR-0032, `docs/adr/0032-route-app-egress-but-do-not-disguise-the-browser.md:102-104`).
- **Operator name.** Birdbrain checks it before launch (constraint 3). Draw what the dialog shows
  when none is set.
- **One launched browser at a time.** While a launched browser is open, the Operator cannot launch
  a second (ruling 46; state 4).
- **Starting or joining.** With no Capture Session running, launching starts one; with one running,
  the browser joins it and its Active Case (ruling 53). Draw both.
- _Only if built:_ **Port mode.** The opt-in for this Capture Session, with its takeover warning
  (ruling 37; state 17).
- **Launch** action. Birdbrain starts the browser, runs its Egress checks on the first tab, and
  only then shows that tab, at `about:blank` (Spec :215, :342-344). Draw the wait between the click
  and the shown tab.

### 3. The Capture Session panel

Ruling 55 (D19); Spec "Browsing" (:255-258), "Taking a Capture" (:261-271), and "The Operator's
capture trigger" (:901-924). Where the panel lives while the Operator works in the launched
browser's window is your call (question 1).

- **Tab list.** Every tab and window of the launched browser, including tabs a link or a page
  opened (Spec :275-277, :503-505). For each tab: its title, its URL, whether the engine recorded
  the current page from its first request, and the Active Case Selectors the page matches now
  (Spec :255-258). The Selector list writes no Persisted Match (constraint 9). If a page matched
  here and its stored Extracted Text does not, the Capture exists with no Persisted Match (Spec
  :949-953).
- **Tabs that cannot be captured.** A tab in a private window is listed, not capturable, with the
  reason (Spec :276-277, :506-508). A tab whose address is not `http` or `https`, such as a browser
  settings page, is never captured (Spec :513-514). A crashed tab cannot be captured until it loads
  again (Spec :515-516).
- **Capture control.** It names the tab it will capture, with that tab's title, URL, and Persona,
  before the Operator clicks (Spec :905-906).
- **Keyboard shortcut and tab picker.** The Operator can also capture with a keyboard shortcut that
  works while the browser has focus (Spec :907-908). With one window, the shortcut takes the tab in
  front; with the browser focused, the focused tab. When more than one tab qualifies, or none, the
  shortcut opens the panel's tab picker (Spec :912-915). The shortcut may fail to register on some
  Linux desktops (question 6).
- **Scroll-to-load.** A per-Capture choice, off by default, because it scrolls the page the
  Operator is reading (Spec :263-265).
- **Progress, then the Exhibit Number.** The panel shows the Capture's progress, then its Exhibit
  Number (Spec :265). In a Shared Case that number carries the Member Code, for example `NK-12`
  (`CONTEXT.md:155-156`).
- **Warnings and messages.** The extension warning of ruling 50 (state 9), and the states below
  that the spec reports in the panel (Spec :282-283, :1082, :1088-1089).
- **Stopping the Capture Session.** The Operator stops it in Birdbrain, which asks for confirmation
  and then closes the browser (Spec :281-282). One Capture Session serves both browsers: the session
  service holds one running flag, which the extension uses too (Spec :223-226). Quitting Birdbrain
  also closes the browser (Spec :283-284).
- _Once #600 lands:_ **Passive capture.** The rule the Capture Session runs: every page that loads,
  or the pages a Selector matches (Spec :955-956). A `launched-passive` Capture has no
  Scroll-to-load and no PDF, and the engine never brings a tab to the front for one (Spec :958-961,
  :971-972). A page the engine skips goes to the capture activity feed with its reason (Spec
  :975-976). A same-document navigation, where a web application changes its view without loading a
  new document, triggers no passive Capture, and the panel shows that it was not captured (Spec
  :981-983). Stopping the Capture Session stops passive capture at once: queued passive Captures are
  dropped, and one already collecting finishes (Spec :977-979).

### 4. Telling the launched browser apart from the everyday one

Ruling 55 (D22); Spec "Risks" (:1145-1148). The launched Chrome has the everyday Chrome's icon. An
Operator who captures in the wrong browser gets an `extension` Capture through the extension,
without a Transaction Record and with a Persona that is only their declaration (Spec :39-43,
:258-259), where they meant to take a `launched` one.

Any cue must meet these constraints:

- **Nothing in the page and no extension.** Nothing drawn into the page, and no Birdbrain extension
  in the browser profile (Spec :251-253, :916-920). A control in the page changes the DOM that
  becomes the MHTML; an extension puts extension code beside the evidence.
- **No unsupported switch.** No switch on Chrome's unsupported-flag list (S4, Spec :187-189).
- **No disguise.** The user agent and client hints stay unchanged (Spec :886), and nothing hides or
  fakes the browser's automation state (Spec :334-335, :411-413).
- **A blank first tab.** The first tab opens at `about:blank` and makes no request (Spec :215,
  :318).
- **No automation infobar.** The engine never passes `--enable-automation`, so Chrome's "controlled
  by automated test software" infobar does not appear (Spec :322-324, :895-897). Whether Chrome
  shows any other banner in this configuration was not observed (open question P19, Spec
  :1486-1487).

Draw cues on Birdbrain's side first: in the panel, in the Capture control, and wherever Birdbrain
shows a running Capture Session. If you propose a cue on the browser's side (its window, its
browser profile, or its theme), mark it for the feasibility pass, because the spec measured none.
The nearest measurement is open question P15: the engine writes one preference into a new browser
profile before the first launch, and whether Chrome keeps a value written that way was not checked
(Spec :689-695, :1477-1478).

### 5. The Withheld from analysis mark

Ruling 70; ADR-0044 :66-70; Plan E22 (:1318-1332). The mark appears in four places:

- **Case search results in the search bar.** A Capture result shows its title and URL today
  (`src/renderer/components/search/SearchBar.tsx:111-126`). In the retrieval slice it also names
  the Exhibit Number and Content Hash (Retrieval plan :192).
- **Fielded search results.** The retrieval slice adds groups beside Captures and Notes, labelled by
  field, such as **From header** or **Link target**. Each row names the Exhibit Number and the
  first 12 characters of the Content Hash (Retrieval plan :185-190; Plan :1325-1326).
- **The Data screen's unreviewed tab.** A new tab that lists committed Captures that no live Note
  names and that have no Persisted Match, grouped by header value, link host, and identifier
  (Retrieval plan :218-228; Plan :1325-1327).
- **What a result opens.** Today a Capture result opens the Captures screen with that Capture
  selected (`SearchBar.tsx:114-119`). In the retrieval slice a header result opens the Text tab with
  the span highlighted, and a link result opens the Links tab with the row highlighted (Retrieval
  plan :199-201, :225-226). ADR-0044 words this as the result opening "in the source inspector"
  (:69-70).

A withheld result still opens, so the Operator can read it and clear their flag (constraint 12). In
a Shared Case the mark names each member who holds a flag (Plan :1323-1324; Engine spec :161).
Clearing a flag puts a shown investigation run out of date (constraint 13).

The accepted investigation mock already draws withholding in three places: a row in run setup with
holder text such as "your flag" or "withheld by you and MB" and a **Clear my flag** action (Mock
:180-181), a **Withheld from analysis** checkbox in the source inspector (Mock :305-306), and
"withheld" as a reason in Joint detail's "No longer counted" list (Mock :270-271). Match them
(question 4).

None of these search surfaces exists in the app yet. The fielded search and the unreviewed tab come
from the retrieval slice (Retrieval plan :185-190, :218-228), and the flag waits on storage that
does not exist yet (Retrieval plan :230-235).

### 6. The investigation header's "not read" count and the gap list entry

Ruling 68; Plan open question 15 (:1742-1748).

- **Header.** The accepted mock's header reads "N Exhibits read · M withheld" (Mock :200; View
  brief "View header", :186-200, and decision 19, :117). Add the "not read" count beside those two.
  The assessment accepted that header with one added line (Assessment :84-90).
- **What the run did not read.** In the first slice: PDF Exhibits (`document`) and `mbox` files,
  which commit as `attachment` (Plan :1058-1066); and Captures whose field records are not from the
  current build, or that have no `.txt` file, or whose build row is missing, `failed`, `partial`,
  or from an older extractor (Plan :767-769, :1046-1049). The run reports the count by kind and
  reason (Plan :909-910).
- **Gap list entry.** An entry in the "Searches not yet run" group (View brief :334; Mock
  :251-252) that names the unread kinds (Plan :1067-1069). Entries in that group carry no action in
  the first slice (View brief :338-339); whether this entry opens the unread Exhibits is question
  10.

The count exists so that a PDF holding a starting Subject's address never reads as "no connection"
(Plan :1067-1069).

## States to draw

States 1 to 15 belong to the first stage-2 release. State 16 waits for #600, and state 17 is drawn
only if the port fallback is built. States 18 to 20 are the withheld mark, and 21 and 22 the
investigation view. Each Capture Session state cites its row in the spec's failure table (Spec
:1070-1095) where it has one.

1. **No supported browser found.** Birdbrain found none, or the chosen executable is a product it
   does not recognize or is below the version floor. Birdbrain does not start a Capture Session and
   tells the Operator (Spec :302-304, :1074).
2. **The debugging connection does not answer.** The engine kills the browser and names the cause,
   for example an enterprise policy that turns off remote debugging (Spec :344-348, :1075).
3. **The proxy does not accept a connection before launch.** While the Egress is not Direct,
   Birdbrain does not launch and names the proxy (Spec :824-827, :1076).
4. **A launched browser is already open.** The Operator tries to launch a second one (ruling 46;
   Spec :232-234).
5. **Recording.** The panel with two tabs: one recorded from its first request, and one not, for
   example a tab whose page began loading before the engine attached, or one where recording failed
   to start (Spec :479-482, :1080). A Capture of the second tab carries no Transaction Record and no
   Bound TLS Details, and its inventory says recording did not cover the page (Spec :573-575,
   :1081).
6. **A tab in a private window.** Listed, not capturable, with the reason: a private window has its
   own cookie store, so a Persona stamp on its Capture would be false (Spec :506-508, :1088).
7. **A Capture abandoned.** A new document committed in the tab while the Capture was being taken.
   The engine abandons the Capture instead of mixing two documents, and says so in the panel and the
   capture activity feed (Spec :567-569, :1082).
8. **A crashed tab.** The engine discards its recording, and the tab cannot be captured until it
   loads again (Spec :515-516, :1089).
9. **The extension warning.** While the Egress is not Direct, an extension appears in the browser
   profile. The panel warns, and Captures continue (ruling 50; Spec :859-861). An extension can
   replace the proxy setting, which is why the panel warns (Spec :843-846).
10. **The browser closed, the Capture Session still running.** The Operator closed the browser's
    last window, or the browser exited. The panel says the browser has closed, the Capture Session
    keeps running until the Operator stops it, and Captures already taken stand (ruling 53; Spec
    :282-283, :1090).
11. **The browser closed and the Capture Session ended by the Egress check.** While the Egress is
    not Direct, a response came from an endpoint other than the proxy. The engine closes the
    browser, ends the Capture Session, and tells the Operator. Captures already taken stand (Spec
    :853-858, :1078).
12. **The browser closed before it showed.** While the Egress is not Direct, the WebRTC check on
    the first tab found a candidate, which means the browser is not keeping WebRTC on the proxy. The
    engine closes the browser before showing it and says so (Spec :848-852, :1079).
13. **A browser left running from an earlier run.** At Birdbrain's next start, a launched browser
    from before is still running. Birdbrain cannot reconnect to it and asks the Operator to close it
    (Spec :284-286, :1091).
14. **Changing the Egress during a Capture Session.** Changing the Egress setting while a Capture
    Session runs in a launched browser ends that Capture Session first, after the Operator confirms
    (Spec :819-822).
15. **Deleting a Persona whose browser is open.** Birdbrain asks the Operator to end the Capture
    Session first (Spec :680-681).
16. _Once #600 lands:_ **Passive capture running.** The panel shows the rule in force, Captures
    taken without a click, a skipped page with its reason, and a same-document navigation (the
    spec's "route change inside an application") shown as not captured (Spec :975-976, :981-983).
17. _Only if built:_ **The port fallback's takeover warning.** The Capture Session runs in port
    mode, and the warning says another process on the machine could take over the browser (ruling
    37; Spec :401-405).
18. **A withheld result in each placement.** In the search bar's Capture results, in a fielded
    search group, in the unreviewed tab, and on the opened Exhibit (surface 5).
19. **A withheld result opened.** The Operator opens it, reads it, and sees how to clear their flag
    (ADR-0044 :69-70).
20. **A Shared Case result withheld by another member.** The mark names that member, for example
    "withheld by MB", and the Operator cannot clear MB's flag (Engine spec :161; Plan :1323-1324).
21. **A run with a non-zero "not read" count.** For example: 55 read, 3 withheld, and 4 not read,
    which are 2 PDFs, 1 `mbox` file, and 1 Capture whose field records come from an older build
    (Plan :909-910, :1046-1049, :1058-1066).
22. **The gap list's not-read entry.** In "Searches not yet run", the entry naming the kinds from
    state 21 (Plan :1742-1748).

## Copy constraints

The repo's claim-discipline rules apply to every string in the mock (`docs/agents/writing-guide.md`,
"Claim discipline"): state what a mechanism shows and what it does not, use no unqualified
assurance word, and keep each limit next to the capability it limits.

- For a Persona stamp, use these strings verbatim (ruling 47; Spec :1021-1022):
  - `launched`: "captured in the Persona's launched browser"
  - `launched-passive`: "taken without a click in the Persona's launched browser"

  Neither says which account the page showed (constraint 5).
- Never describe a `launched-passive` Capture as operator-witnessed, on any surface (Spec
  :1001-1003).
- "Recorded from its first request" says the engine saw the page's requests from the first one. It
  does not say the page is genuine, or that the record holds every exchange: a response from the
  cache, a service worker, the back-forward cache, or a speculative load leaves gaps that the
  inventory lists (Spec :484-492).
- The Egress hides where the Operator is, not what browser is looking (`CONTEXT.md:98`). Do not
  call the launched browser anonymous or undetectable: with the pipe, every page in it reads
  `navigator.webdriver` as `true` (Spec :394-396).
- The no-VPN warning says Birdbrain can see the machine's network path, not the browser's (ADR-0032
  :102-104). Do not word it as a check of the browser's own traffic.
- Write **Withheld from analysis**, never _excluded_, _hidden_, or _suppressed_, for that flag
  (`CONTEXT.md:271-273`, :398). "Excluded" already names the URL exclusion policy and a Shared Case
  exclusion from export.
- Around a Capture Session, avoid _session_ unqualified, _auto-capture_, and _recording mode_
  (`CONTEXT.md:71`, :396, :402). Write "Capture Session", and for passive capture name the rule:
  "every page that loads" or "pages a Selector matches".
- Do not call a Persona a _profile_, an _identity_, or an _account_ (`CONTEXT.md:43`); a browser
  profile is the directory the launched browser runs on. Do not call the Egress a _route_ or _VPN
  mode_ (`CONTEXT.md:99`).
- The "not read" count says the run did not read those Exhibits. Never word it, or its gap list
  entry, as if the Exhibits hold nothing or were checked and found empty.
- Use invented names, sites, and accounts in every example: for example a Persona labelled "Harbor
  Desk", a site at `ferrylog.example`, and members NK and MB. No real person, account, site, or
  cookie appears in the mock.

## Questions for the designer

The designer's calls, not settled by the sources:

1. Where does the Capture Session panel live while the Operator works in the launched browser's
   window? Birdbrain's window can be as small as 900 by 600 pixels (constraint 16), and the
   Operator's attention is on the other window.
2. What tells the two browsers apart at a glance: in Birdbrain, and on the browser's side if
   anything can, within the constraints of surface 4?
3. How does the Capture Session switch show a Capture Session that a launched browser started? The
   switch sits in the Case action bar under the top bar
   (`src/renderer/components/layout/CaseActionBar.tsx:17`), and in the top bar on the Settings
   screen while a Capture Session runs (`src/renderer/components/layout/TopBar.tsx:76-82`). It shows
   only while the extension is connected (`src/renderer/components/status/SessionControls.tsx:20`),
   and a launched browser needs no extension. The top bar also shows a REC indicator while any
   Capture Session runs (`TopBar.tsx:149`).
4. How does the withheld mark read without relying on color alone, and how does it match the
   withheld drawings already in the accepted investigation mock (surface 5)?
5. How does the "not read" count read beside "N Exhibits read · M withheld" so it never suggests
   the unread Exhibits hold nothing?
6. What does the panel show if the capture shortcut cannot be registered on the Operator's desktop?
   Electron's documentation warns that GNOME 50 rejects such a binding with no error surfaced to the
   app, and the spec leaves Linux desktops open (open question P17, Spec :907-911, :1482-1483).
7. Where in Settings does the list of found browsers live, and how does a browser's version read
   before Birdbrain has confirmed it by launching it (surface 1)?
8. Where does the Operator launch a browser from? The spec says only "from Birdbrain" (Spec :210).
9. How do the tab list's "recorded from its first request" flag and its matching Selectors read, so
   that neither looks like a verdict on the page and the Selector list never looks like a saved
   match (constraint 9)?
10. Does the not-read gap list entry open the list of unread Exhibits? The sources say the entry
    names the unread kinds (Plan :1742-1748) and say nothing about opening it.
11. From which of the four placements in surface 5, if any, can the Operator clear their own flag
    without opening the Exhibit?
12. _Once #600 lands:_ can the Operator change what a running Capture Session captures without a
    click, from the panel? The spec puts the choice in the start dialog (Spec :211-213) and also
    says the Operator chooses it during a running Capture Session (Spec :955-956).

## Not in scope

Do not draw these:

- The Persona screen and the browser cookie import, which CE-A and a later ticket under #541 cover
  (Roadmap :762-775; Spec :783-788, :1509-1511).
- The in-app display of a Capture's capture facts: its Egress, inventory, Scroll-to-load outcome,
  and Bound TLS Details (#1816; Spec :1509).
- The unreviewed view and fielded search themselves, apart from the mark on them (Retrieval plan
  :183-228).
- The Companion and the extension changes of stage 3 (CE-S3; Spec :1505).
- Any investigation view surface the accepted 2026-10-06 mock already settles, apart from the
  header count and the gap list entry.
- Firefox, which stage 4 brings, and a per-Persona Egress (Spec :1505-1507).
- Downloads started in a launched browser, and browser permissions beyond the geolocation the
  engine denies (Spec :878-880, :1508).
- A glossary term for what a launched browser's Capture Session owns (D18, still open).

## Deliverable

A mock in the "Birdbrain UI" design project covering the six surfaces and 22 states above: the
unlabelled parts first, then the parts that wait for #600, then the port fallback, drawn only if it
is built. Deliver it as the investigation view brief asked (View brief "Deliverable", :561-569): a
dated bundle under `docs/design-handoff/` with an `ENGINEERING_REVIEW.md`, following
[the Shared Case members bundle's review file](../design-handoff/2026-09-19-shared-case-members/ENGINEERING_REVIEW.md).

Engineering answers with a feasibility pass: a verdict, a size, and the constraint behind each
numbered surface and state. The pass on the Capture Session panel and the browser cues comes before
the stage-2 clicked-Capture step (ruling 55; Spec :1291-1293), and the panel's design lands before
the step that builds the panel (Spec :196-198, :1278-1279). The mock also gates the withheld mark
in Case search (CI-14) and the investigation view's header count and gap list entry (CI-V1 and
CI-V4) (Roadmap :85, :971-972, :1034-1035, :1044).
