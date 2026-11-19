# A large Case: review pass 3

**Date:** 2026-11-19

**Status:** Open. This is the assessment that pass 3 of
[the review passes plan](../plans/2026-11-15-unreviewed-surfaces-review-passes.md) asks for. It
is a review and fixes nothing. Slice 7.2 of
[consolidation phase 7](../plans/2026-11-15-consolidation-phase-7-summary-first.md) waited for
the verdict in the section "Verdict on slice 7.2" below, and #2240 builds the slice as that
section advises.

The pass seeded one Case at each of three sizes (50, 500, and 2,000 Captures), each with 20
Selectors, 30 Tags, and 100 Notes with Mentions, and timed and looked at every screen the plan
names. Every number below was observed on one Linux workstation under `Xvfb`, at commit
`cd59badcaefc52611b0c83a5874c3af2078b469e`. Where something was not measured, this document
says so and gives no estimate.

In short:

- At 50 Captures every screen is comfortable. At 500 the Captures list is strained, with the
  Signals action that opens it filtered, and nothing else is. At 2,000 the Captures list is not
  comfortable: starting the app into it took from 4 to 186 seconds, and each click on a row took
  from 0.5 to 2.4 seconds.
- The Selector chips do tell rows apart when rows differ, so slice 7.2 should not go ahead as
  written. It should go ahead with the changes named in the next section.
- The Link Map does not stay readable. Past 20 Notes it draws Notes only, and from 60 Notes
  its pills overlap.
- The Trusted Time notice of the export preflight fits the dialog at any count, because it
  states counts and lists no Capture. In a 900 by 600 pixel window it sits below the fold of
  the form in that dialog at any count.

## Verdict on slice 7.2

**Go ahead with changes.** The slice has three parts. Two should go ahead as written. The
third, replacing the chips with a bare count, should change.

| Part of the slice | Verdict |
| --- | --- |
| The Favorite and checkbox controls get 24 pixel hit areas | As written |
| While a Selector filters the list, the row names that Selector | As written |
| The chips become one chip reading the count, for example "3 Selectors" | Change: keep one Selector name on the row and count the rest |

### The changes

1. **Keep a name, count the rest.** A row that matches one Selector shows that Selector's
   name. A row that matches more shows one name and "+N" for the others, with every name in the
   title and the accessible description, as the slice already asks. A bare count is not used.
2. **One line, at every list width.** The chip line never wraps. The acceptance line "A row
   shows at most one Selector chip" becomes "the chip line is one line high at every list width
   from 240 to 560 pixels, and every row is the same height".
3. **Say in the slice which name shows.** Under a Selector filter it is the filtered
   Selector's, as the slice says. With no filter the slice must pick a rule. Today the row
   shows the two matching Selectors that were created most recently
   (`getCaptureMatchingSelectors` in `src/main/services/db/selectorRepo.ts` orders by
   `created_at DESC`).

### The evidence

The slice rests on critique finding U14, that every Captures list row carries the same
Selector chips. The critique read that from a demo Case of three Captures that all matched the
same Selectors. On a Case whose rows differ, the premise does not hold.

**The chips tell rows apart.** The table counts, over the drawn list in its default order,
how many different chip lines exist and how many neighboring rows differ in their chip line.
"Count only" is the slice as written. "One name, then +N" is change 1. Both were computed from
the rows on screen. Neither was built.

| Case | Rows | Different chip lines: today, count only, one name then +N | Neighboring rows that differ: today, count only, one name then +N |
| --- | --- | --- | --- |
| 50 Captures | 50 | 34, 8, 29 | 46, 34, 46 of 49 |
| 500 Captures | 500 | 177, 13, 82 | 482, 393, 482 of 499 |
| 2,000 Captures | 2,000 | 371, 13, 114 | 1,933, 1,573, 1,927 of 1,999 |

A bare count leaves 21 percent of neighboring rows at 2,000 Captures with the same chip
line. Today's chips leave 3 percent, and one name with a count of the rest leaves 4 percent.

**The chips are the most readable text on a narrow row.** The default list width of 316
pixels gives the title 122 pixels, and 1,806 of 2,000 titles are cut, at about 18 characters.
At 240 pixels the title has 46 pixels and all 2,000 are cut, at about five characters, and all
2,000 hosts are cut too. The chips fare better: 232 of the 3,208 chips drawn are cut at either
width. In the 2,000 Case, three rows close together all read `Underhill Resident...` at the
default width. The first row's chip read `haulage-desk@sa...`, the second's `Broker handle`,
and the third's `Berth number` and `Tender reference`.

**On the Captures screen, the row is the only place seen to name a Capture's matching
Selectors.** In `src/renderer`, only `CaptureList.tsx` reads
`captureMatchingSelectorsQueryOptions`, and it hands the result to `CaptureItem.tsx` alone. The
details panel on a selected Capture showed its source, capture time, Tags, and Notes, and no
Selector. A count on the row would leave the names in a pointer tooltip and an accessible
description, and nowhere in view.

**The chip line wraps, so rows are not the same height.** The slice says a strut keeps rows
the same height. That holds between a row with no chip and a row with one. With two chips
that do not fit on one line the row grows.

| List width | Rows at 77 pixels | Rows at 100 pixels | Rows at 123 pixels |
| --- | --- | --- | --- |
| 240 pixels | 958 | 624 | 418 |
| 316 pixels, the default | 1,226 | 774 | 0 |
| 560 pixels | 2,000 | 0 | 0 |

These figures are from the 2,000 Case. At the default width, 320 of its 556 rows with two matching
Selectors and 454 of its 486 rows with three or more are the taller kind. One chip, or one
chip and "+N" on a line that cannot wrap, removes the difference. This is the part of the
slice's reasoning that the large Case supports.

**Under a Selector filter the row does not reliably name the filter.** The 2,000 Case filtered
by its "Tender reference" Selector showed 613 rows. 354 of them showed a "Tender reference"
chip. The other 259 showed two newer Selectors and a `+N` chip. That Selector was the first one
created in the seed, which is the worst case for the rule in change 3. The strip above the
list read "1 selector filter" and did not name the Selector. The slice's second part fixes the
row. Naming the Selector in the strip is finding 8.

**The controls are as small as the critique said.** The Favorite button measured 15 by 15
pixels and the checkbox 14 by 14, at each of the three sizes and three widths.

**What this pass did not test.** Nobody was asked to find a Capture with and without the
chips, so the figures above measure difference between rows, not how fast an Operator finds
one. Rows with zero, one, two, and many matching Selectors were looked at in the detailed view
at 240, 316, and 560 pixels. The compact view draws no chips at all. The viewer's Text tab was
not opened, so whether it marks Selector matches in a Capture's text was not checked.

## What was reviewed

**Commit.** `cd59badcaefc52611b0c83a5874c3af2078b469e`, the head of the pull request that
builds the consolidation slices, built once with `pnpm build`. The app reviewed has the
one-row chrome, the one right panel, and the Overview's pointer cards.

**How each screen was reached.** The built app ran under `xvfb-run`, driven through
Playwright by a copy of the `run-birdbrain` driver changed to open a seeded profile and keep
it, with `BIRDBRAIN_CAPTURE_SERVER_PORT=19877`. The window was 1440 by 900 pixels unless a
line says otherwise.

| Screen | How it was reached |
| --- | --- |
| Captures list and viewer | The route `/cases/<id>/captures`. A row was selected with a click |
| List search | The search box at the top of the list |
| Case search | The search box in the top bar |
| Data screen | The route `/cases/<id>/data`, then the tree's Infrastructure node and its Domain Reference and Email Address rows |
| Overview | The route `/cases/<id>/overview` |
| Signals | The route `/cases/<id>/signals`. A Selector row, then **Filter in Captures** |
| Export dialog | The Case name in the top bar, then **Export** in the Case menu |
| Capture log | The status control in the top bar, then **Capture log** |

**How the data was seeded.** A script kept outside the repository filled each profile through
the app's own main-process modules, the route `scripts/dev-seed/seed.ts` takes: each Capture
through `ingestMhtmlCapture`, then Selectors, Tags, Favorites, and Notes through their
repository functions. It did not write SQL and did not use the Capture Server. Each size has a
profile of its own. Facts about the seed that bear on the results:

- Every host is under `.invalid` or `.test`, and every title, name, and value is invented.
- 40 hosts, five of them 68 to 90 characters long. About 8 percent of titles are 220 to 420
  characters, 3 percent are one unbroken token of about 100 characters, and 2 percent are
  empty. Capture times spread over 400 days.
- Three in four Captures have a screenshot, from six generated images. A stored page is 1 to 8
  KB, far smaller than a real one.
- Selector matches per Capture, at 2,000: none on 320, one on 638, two on 556, and three to
  12 on 486. The same four groups at 500 hold 89, 139, 145, and 127 Captures, and at 50 hold
  8, 16, 14, and 12. One Selector matches nothing and one is disabled.
- Between 52 and 61 percent of Captures carry one to six Tags. Each Case has 100 Notes holding
  about 500 Mentions of Captures, Selectors, Tags, and other Notes.
- Extracted Data rows were inserted directly (158, 1,748, and 7,013 rows), because the seed
  does not run the extraction process.
- `tsaEnabled` was `false`, so the app sent no Content Hash to a TSA and every Capture stayed
  at Trusted Time `pending`. The update check was off.
- The first launch of a seeded profile runs the Exhibit backfill, which wrote one `derivation`
  entry per screenshot (1,489 at 2,000 Captures). That launch took 1.2 seconds at 50 Captures
  and 12.7 seconds at 2,000, both onto the Settings screen, and 4.4 seconds at 500 into the
  Captures list. It is left out of every other number.

For the capture log, 63 more Captures were posted to the Capture Server on a throwaway copy of
each profile, because the log holds only the current launch's events. For the Link Map, four
more 50-Capture profiles were seeded with 5, 15, 30, and 60 Notes.

**What was not reached.**

- Any size between 500 and 2,000, so the size at which the Captures list turns from strained
  to not comfortable is not known more closely than that.
- A machine with a working GPU, Windows, and macOS. Under `Xvfb` Chromium's GPU process exits
  and the app draws in software.
- The window while the app starts into the 2,000 list. Three screenshot requests during that
  wait each timed out after 25 seconds.
- An explanation for one slow start. One first launch of the 2,000 profile into the Captures
  list did not reach the app's ready marker within 120 seconds, the limit the driver had at
  that point. Two later first launches of fresh copies took 12.7 and 16.2 seconds. The slow
  one was not reproduced.
- The time for the viewer to draw a real page. The seeded pages are too small to stand for
  one, so the Viewer row of the table times selection only.
- The Notes screen, which the plan does not list. The light theme, which is pass 2.
- The Wayback tab, which would send a request to archive.org. Running an export, as opposed to
  opening its dialog.
- A capture log with failed or skipped entries, a Case with Captures at Trusted Time `none` or
  `rfc3161`, any Integrity Status other than not yet checked, and a Shared Case.
- Keyboard selection, multi-select, and batch delete.

## Time and verdict per section

Each cell gives the median of three runs, with the range in brackets where it matters, then
the verdict. "First open" means the first visit in an app launch, from the Settings screen.
The verdicts use fixed limits:

- **Comfortable.** Every click or key press answers within 100 ms and the screen opens within
  1 second.
- **Strained.** Slower than that, with every action answered within 1 second and the screen
  open within 3 seconds.
- **Not comfortable.** An action takes more than 1 second, or the screen more than 3 seconds.

| Section | What was timed | 50 Captures | 500 Captures | 2,000 Captures |
| --- | --- | --- | --- | --- |
| App start | Launch into the Captures list, to the ready marker | 0.83 s. Comfortable | 1.37 s. Strained | 4.0 to 185.5 s over eight launches, median 95.9 s. Not comfortable |
| Captures list | First open: every row drawn, then every chip and thumbnail | 0.09 s, then 0.11 s. Comfortable | 0.38 s, then 0.57 s. Comfortable | 1.24 s, then 2.1, 6.6, and 138.5 s. Not comfortable |
| Captures list | First open: until the screen stopped changing | 0.75 s | 1.2 s | 3.1 to 139.4 s over six runs, median 51.3 s |
| Captures list | Later opens in the same launch | 0.05 s. Comfortable | 0.35 s. Comfortable | 1.28 s (1.23 to 2.24). Strained |
| Captures list | Scrolling once settled: the frame time that 95 percent of frames stayed within | 18 ms. Comfortable | 21 ms. Comfortable | 28 ms. Comfortable |
| Viewer | Click on a row, to the row marked and the viewer's title shown | 36 ms (22 to 53). Comfortable | 94 ms (86 to 147). Strained | 0.82 s (0.51 to 2.44). Not comfortable |
| List search | Slowest key press while typing "tender" | 32 ms. Comfortable | 240 ms. Strained | 2.4 s (2.3 to 2.4). Not comfortable |
| List search | Clearing the box, to every row drawn again | 28 ms. Comfortable | 195 ms. Strained | 1.04 s (1.00 to 1.17). Not comfortable |
| Case search | Results shown for a common word, with the bar's 300 ms wait | 0.34 s, 0.04 s after the wait. Comfortable | 0.39 s, 0.09 s after the wait. Comfortable | 0.62 s (0.54 to 0.63), 0.32 s after the wait. Strained |
| Data screen | First open: table and tree drawn | 0.04 s. Comfortable | 0.13 s. Comfortable | 0.57 s. Comfortable |
| Data screen | Click on a table row, to the row selected | 8 ms. Comfortable | 41 ms. Comfortable | 165 ms. Strained |
| Data screen | Tree to Indicators, Domain Reference listed | 61 ms. Comfortable | 73 ms. Comfortable | 173 ms. Strained |
| Overview | First open: Link Map drawn, then counts at their final value | 0.04 s, then 0.61 s. Comfortable | 0.05 s, then 0.69 s. Comfortable | 0.09 s, then 0.73 s. Comfortable |
| Signals | First open: Selector and Tag rows drawn | 52 ms. Comfortable | 55 ms. Comfortable | 72 ms. Comfortable |
| Signals | **Filter in Captures**: narrowed list drawn, then the screen stopped changing | 28 ms, then 0.5 s. Comfortable | 39 ms, then 2.1 s. Strained | 84 ms, then 22.5 s (21.5 to 23.2). Not comfortable |
| Export dialog | Dialog open, to the scope count and the Trusted Time notice | 68 ms. Comfortable | 69 ms. Comfortable | 101 ms. Comfortable |
| Capture log | Click on **Capture log**, to the log drawn with 50 entries | 19 ms. Comfortable | 19 ms. Comfortable | 27 ms. Comfortable |

Notes on the table:

- The verdict is on time only. A section can be comfortable in time and still have a finding:
  the Link Map, the Case search results, and the Indicators list each do.
- The Case search bar waits a fixed 300 ms after the last key press before it asks for
  results. Its verdict is on the time after that wait, which the row gives beside the measured
  time, because the wait is the same at every size and is not the Case's doing.
- The Overview's counts animate upward for about 0.6 seconds on first open, which is most of
  its time at every size.
- The eight 2,000 launches, in seconds: 4.0, 22.4, 28.5, 46.5, 145.2, 175.8, 184.3, and
  185.5.
- At 50 and 500, the Captures list went on changing for about 0.6 seconds after its last chip
  and thumbnail. The pass did not attribute that time.
- At 2,000, the six first opens of the Captures list held the main thread in tasks longer than
  50 ms for 2.1, 6.1, 36.6, 57.5, 101.1, and 130.6 seconds in total. The longest single stall
  was 1.1 to 1.9 seconds. In the four runs that took over 40 seconds the screen drew about
  three to five frames a second until it settled.

Other times taken on the Captures screen:

| What was timed | 50 Captures | 500 Captures | 2,000 Captures |
| --- | --- | --- | --- |
| Switch to the compact view | 20 ms | 144 ms | 574 ms (494 to 739) |
| Switch back to the detailed view | 27 ms | 190 ms | 760 ms (753 to 926) |
| Click on a row in the compact view | 45 ms | 111 ms | 391 ms (381 to 797) |
| A Capture arrives while the list is open, to its row drawn | 51 ms | 181 ms | 590 ms (576 to 663) |
| Slowest key press typing in the Case search with the list on screen | 16 ms or less | 16 ms | 24 ms |

## Findings

Severity uses the critique's three levels. "Slice" names the consolidation slice that already
covers the finding, or says new.

| # | Finding | Severity | Slice |
| --- | --- | --- | --- |
| 1 | At 2,000 Captures, starting the app into the Captures list took 4.0 to 185.5 seconds to the ready marker, median 95.9 seconds over eight launches. The Captures list is the section a new profile restores to (`lastActiveSection` defaults to `captures` in `src/main/services/settings.ts`). At 500 it took 1.4 seconds | critical | new |
| 2 | At 2,000 Captures, the first open of the Captures list kept changing for 3 to 139 seconds, in the slower runs at about three to five frames a second. `CaptureList.tsx` draws every row of the Case, on screen or not, and asks for each Capture's matching Selectors with one query per Capture. `CaptureItem.tsx` asks for each row's thumbnail with one query per row. The pass did not profile which of these costs the time | critical | new |
| 3 | At 2,000 Captures, a click on a row took 0.5 to 2.4 seconds, a key press in the list search up to 2.4 seconds, clearing that search 1.0 second, and a view switch 0.5 to 0.9 seconds. At 500 the same actions took 0.09 to 0.24 seconds | critical | new |
| 4 | Filtering the 2,000 list to 613 rows from Signals still took 22 seconds to stop changing. `CaptureList.tsx` runs its per-Capture Selector queries for every Capture in the Case, not for the rows shown | moderate | new |
| 5 | The chip line wraps. At the default width 774 of 2,000 rows are 100 pixels tall and the rest 77. At 240 pixels the rows have three heights | moderate | 7.2 |
| 6 | On the Captures screen the row is the only place seen to name a Capture's matching Selectors, and it shows at most two, the two created most recently. A row matching 12 shows two and "+10" | moderate | 7.2 |
| 7 | Under a Selector filter, 259 of 613 rows did not show the Selector that filtered the list | moderate | 7.2 |
| 8 | The strip above a filtered list reads "1 selector filter" and does not name the Selector | minor | new |
| 9 | The Favorite button is 15 by 15 pixels and the checkbox 14 by 14 | minor | 7.2 |
| 10 | A Capture's title is cut almost everywhere. Default list width: 1,806 of 2,000 titles cut, at about 18 characters. 240 pixels: all cut, at about five. Compact view at the default width: the title gets 25 to 61 pixels and all 2,000 are cut. For a selected Capture with a 283 character title, the viewer showed about ten characters and the details panel showed no title. On the Captures screen the full title is held only in the row's `title` attribute, a pointer tooltip | moderate | new |
| 11 | The Link Map draws every Note, and with more Notes than its 20 node limit it draws no Capture, Selector, or Tag (seen at 30 Notes). At 60 Notes every pill overlapped a neighbor. At 100 Notes there were 197 overlapping pairs in a canvas 1,202 pixels tall, and a pill covered part of the legend. Labels are cut at about 11 characters at every Note count looked at | moderate | new |
| 12 | The Case search lists every match with no count and no limit. At 2,000 Captures a common word gave 2,235 results in a box 254 pixels tall, which shows four or five. Matching Notes and link matches sit below every Capture result | moderate | new |
| 13 | The Indicators list prints every source page under each value. At 2,000 Captures the 40 Domain Reference values drew 4,587 links, and the first value's 136 links put the second value about 136 lines down | moderate | new |
| 14 | The Data tree's "Captures" node read 3,489 on the Case of 2,000 Captures. The table holds 2,000 rows of kind `capture` and 1,489 of kind `thumbnail`, in a pane 349 pixels tall | minor | new |
| 15 | In a 900 by 600 pixel window the Trusted Time notice in the export dialog opens with 33 of its 40 pixels below the fold of the form. Slice 1.2 keeps the heading and the buttons in view and lets the form scroll | minor | new, follows from 1.2 |
| 16 | Counts are formatted two ways. The Overview tile, the export dialog, and the list footer print `2000`. The Data tree prints `3,489` | minor | new |
| 17 | A capture log entry shows its URL cut at about 40 characters and no title, so four of the five entries on screen read the same. The log keeps 50 entries and shows five | minor | new |
| 18 | The Signals coverage strip covers the 24 most recent Captures. At 2,000 a Selector with 65 matches showed an empty strip | minor | new |
| 19 | The Overview's Selectors card lists all 20 Selectors and is 653 pixels tall | minor | 7.3 |

No large count overflowed its place. "2000" is 42 pixels wide in a tile 261 pixels wide. The
Case name is cut with an ellipsis in the top bar at 1440 pixels and is hidden at 900. Long
hosts and long Tag and Selector names were cut with an ellipsis wherever they were seen. No
horizontal overflow was seen in the list, the details panel, the Overview, or the capture log.

## Answers to the four questions

### At what size does each list stop being comfortable, and what breaks first?

- **Captures list.** Comfortable at 50. Strained at 500: selecting a row takes about 0.1
  seconds and a key press in the list search up to 0.24 seconds. Not comfortable at 2,000. The
  first thing to break is the first open. Starting the app into the list is the slowest and
  least predictable step measured, then the first minute of the list, then selection and the
  list search. Scrolling a settled list stayed smooth at every size.
- **Data table.** Comfortable at 50 and 500. At 2,000 it holds 3,489 rows, opens in 0.6
  seconds, and selects a row in 0.17 seconds, which is strained.
- **Indicators list.** Comfortable in time at 50 and 500 and strained at 2,000. What breaks
  first is its length, finding 13.
- **Case search results.** Comfortable in time at 50 and 500, and strained at 2,000, where the
  results took 0.32 seconds after the bar's fixed wait. What breaks first is the length
  of the list, finding 12, already at 500 Captures with 621 results.
- **Signals.** Its own screen is comfortable at every size. Its two lists grow with Selectors
  and Tags, not with Captures, and 20 and 30 of them were no strain. Each list shows about six
  rows at a time. **Filter in Captures** ends in the Captures list and takes that list's time:
  strained at 500 and not comfortable at 2,000.
- **Capture log.** Comfortable at every size. It never holds more than 50 entries.

### Do the list row's Selector chips help tell rows apart when rows differ?

Yes. The evidence and the verdict are in the section "Verdict on slice 7.2" above.

### Does the Link Map stay readable past a few dozen nodes?

No. It never draws more than 20 nodes unless the Case has more than 20 Notes, and then it
draws Notes only.

| Notes in the Case | Nodes drawn | What the map showed |
| --- | --- | --- |
| 5 | 20 of 20 | Five Notes and 15 Captures, Selectors, and Tags. No pill overlapped |
| 15 | 20 of 53 | 15 Notes and five others. No pill overlapped |
| 30 | 30 of 92 | 30 Notes in one column and nothing else. No pill overlapped |
| 60 | 60 of 141 | 60 Notes in one column. Every pill overlapped a neighbor |
| 100 | 100 of 195 to 340 | 100 Notes in one column, 197 overlapping pairs |

At 20 nodes the structure can be followed, though three pills in one map read
`Long note t...` and two read `Wren Hollow...`. Between 30 and 60 Notes the map was not
measured. The card is about 1,250 pixels tall and makes the Overview about 1,800 pixels tall
in an 852 pixel pane.

### Does the export notice still fit when hundreds of Captures lack a trusted timestamp?

Yes at 1440 by 900 pixels. The notice read "2000 Captures will export without RFC 3161
trusted time (2000 pending, 0 none)." At 50 and at 2,000 Captures it took two lines, the form
did not scroll, and the notice was in view when the dialog opened. For the 500 Case the dialog
was timed and its layout was not measured. Because the notice is one sentence of counts, its
size does not grow with the Case. In a 900 by 600 pixel window it opens below the fold of the
form at 50 Captures and at 2,000 alike, which is finding 15.

## Measuring method

**Machine.** One workstation: Intel Core Ultra 5 125H, 18 logical processors, 15 GB of memory,
Linux 7.2.15, Node 24.22.3, Electron 45.2.3. Other jobs ran on it during the pass. The load
average read between 0.3 and 2.1.

**Display.** `xvfb-run -a -s '-screen 0 1920x1200x24'`, the app window at 1440 by 900 pixels.
Chromium's GPU process exits under `Xvfb`, so every frame is drawn in software. Treat every
time as a property of this setup, to be compared across the three sizes and not quoted as what
an Operator's machine does.

**Profiles.** Each size has a seeded profile that is never launched and a working copy that
is. The working copy was launched once before any timing, so the Exhibit backfill had run.

**Cold starts.** Every "first open" number comes from an app process started with
`lastActiveSection` set to `settings` in `settings.json`. Session restore then opens Settings,
and no Case query has run. The driver waits 2 seconds and sets the route. "Later opens" go
back to Settings, wait 1.5 seconds, and set the route again in the same process.

**What a time is.** A script in the page reads `performance.now()`, performs the action, and
then checks a condition on every animation frame. The time is the first frame on which the
condition held.

| Number | Condition |
| --- | --- |
| Every row drawn | The count of `capture-item` elements equals the Case's Capture count |
| Every chip, every thumbnail | The count of chip lines holding a chip, and of thumbnail images, equals the count seen once the screen had settled: 42 and 41, 411 and 384, 1,680 and 1,489 |
| Row marked and title shown | The clicked row carries its selected border and `capture-viewer-title` holds that row's title |
| Data table and tree drawn | At least one `data-artifact-row` and one `data-tree-node-` element exist |
| Overview counts | `overview-metric-captures` reads the Capture count |
| Signals rows | At least 20 `signal-row-` elements exist. All 50 were present when the screen settled |
| Export preflight | `export-scope-row` holds a number and `export-trusted-time-notice` exists |
| Capture log | `capture-log` exists |
| Case search results | `global-search-results` exists and does not read `Searching...` |

**Stopped changing.** A `MutationObserver` on the document body records the time of the last
DOM change. Once every condition holds and one second passes with no change, that last time is
the number.

**Stalls.** A `PerformanceObserver` on `longtask` entries gives the time the main thread
spent in tasks over 50 ms. The gap between animation frames gives the longest single stall.

**Launch.** For the App start row, `settings.json` holds `lastActiveSection: captures`. The time
runs from the call that starts Electron to the `app-ready` element, read by Playwright from
outside the page.

**Clicks and keys.** A row click is a `click()` call in the page, so the clock starts with
the event. The export dialog, the tree, and the Indicators rows needed a real pointer click, so
their clock starts a few milliseconds before the click lands. List search keys were typed
through Playwright 150 ms apart, and the number is the `duration` the Event Timing API reports
for each `keydown`, which runs to the next paint and has an 8 ms grain. Clearing the list
search, and entering the query for the Case search result times, set the input's value and
dispatched one `input` event.

**Scrolling.** Wheel events of 300 pixels every 30 ms for 3 seconds over the list, with frame
intervals recorded in the page.

**Arriving Captures.** A multipart POST to `/api/captures` on port 19877, from the driver's
process, the route the extension uses. The clock starts just before the POST and stops when
the list holds one more row. The POST itself took 10 to 17 ms.

**Chip figures.** Read from the drawn rows: the text of each chip, whether its
`scrollWidth` exceeds its `clientWidth`, and each row's height. The list width was set
through the `listColumnWidth` key in `localStorage`, which the list reads when it mounts.

**Repeats.** Each number was taken three times, in three app launches, with these exceptions.
The 2,000 launch was taken eight times and the 2,000 first open six times. An arriving Capture
was timed three times in one launch. Three things are readings of one drawn screen and not
timings: the Link Map, the chip figures, and the layout of the export dialog.

## Screenshots

The screenshots were taken with the seeded data and are not committed. They are attached where
this assessment is reviewed. Their file names start `p3-`, then the size or `linkmap`, then
the screen, for example `p3-2000-captures-list-316px.png`.
