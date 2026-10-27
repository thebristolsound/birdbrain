# Capture engine first slice: validation record

**Date:** 2026-10-26

**Status:** Open. Step 6 of the
[first-slice plan](../plans/2026-10-10-capture-engine-first-slice.md) starts this record, steps 9
and 10 extend it, and the maintainer records the acceptance decision before the release that
ships the writers (plan, D16). The acceptance decision is this record's approval, so nothing
changes it after that.

ADR-0004 asks every evidence-affecting release for a version-specific validation record with
environments, expected and observed results, deviations, false positives and negatives, known
limitations, and the acceptance decision (ADR-0004, Validation and independent verification).
Each section below has one part per step.

## Scope

**Step 6 (#1928).** A `background` Capture's signed `capture` entry gains `scrollToLoad` (D5) and
`inventory` (D4), and its `captures` row mirrors both (D9). The inventory records MHTML and the
screenshot as present, with the screenshot facts of D6, and the Transaction Record and the PDF as
absent with the reason `not-taken`. A Duplicate re-anchors both fields from its source's signed
entry and mirrors them on its own row (D11).

## Environments

**Step 6.** One Linux workstation: kernel 7.2.8 (Omarchy), Node 20.20.2, Electron 44.9.1 with
Chromium 152.0.7977.167. The unit suite runs under Electron as Node, with sharp built against
the system libvips (`pnpm build:test-sharp`). The end-to-end specs run the built app under
`xvfb-run`; `e2e/recapture.spec.ts` ran inside `unshare -rn`, a network namespace with loopback
only, because a running Birdbrain held the capture server's port, and the other Recapture specs
ran outside it. Windows and macOS were not run.

## Expected and observed results

**Step 6.**

| Check                                                                                                                                                                | Expected                                                                                                                                                                                                                                                                                                   | Observed                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Each D5 ending, driven with a mocked `WebContents` (`tests/main/services/backgroundRenderer.test.ts`, `scrollToLoadLazyContent`)                                     | Budget zero records `ran: false` and no outcome; no scrollable root records `nothing-to-scroll`; a page at the scroll cap records `height-cap`; three steps without a change in height record `stopped-growing`; the phase deadline records `time-budget`                                                  | Each as expected, and each record passes the strict schema                                                                                                                 |
| The stall count (same file)                                                                                                                                          | A page that grows before the third stall step keeps scrolling; a step that moves on to a second pane, at a different height, restarts the count; a page whose height falls, or moves down and up, at every step runs to the deadline                                                                       | As expected                                                                                                                                                                |
| The root each step scrolls, with the step script run against a simulated page (same file, the step script's tests)                                                   | The document first; once it cannot move down, the inner panel with the most overflow that can; once nothing can move down, the root at its end with the most overflow, reported rather than `null`; `null` only when nothing overflows                                                                     | As expected for a document at its end, an app-shell page whose document overflows by its 16px margin, a page with two panes, and a panel that grows after reaching its end |
| Whether the phase lifts a scroll lock, with the unlock, step and reset scripts run against a simulated page (same file, the scroll lock's tests)                     | A page that starts at its end lifts no lock and records `scrollLockLifted` false; a page locked with `overflow: hidden` whose document cannot move from script, at its top or after it scrolled itself to its end, has the lock lifted, records true, and has the lock restored                            | As expected                                                                                                                                                                |
| A step that throws (same file)                                                                                                                                       | The phase rejects, so the render fails, and the page's scroll position and lock are restored                                                                                                                                                                                                               | As expected                                                                                                                                                                |
| A restore that fails (same file)                                                                                                                                     | With a lifted scroll lock, the phase rejects, so the render fails; a step's own error wins over the restore's; with no lock lifted, the failure is logged and the phase recorded                                                                                                                           | As expected                                                                                                                                                                |
| A height the page reports that is not a non-negative integer (same file)                                                                                             | No `endHeight`                                                                                                                                                                                                                                                                                             | As expected for a fraction, a negative number, and text                                                                                                                    |
| The D6 facts (same file, `captureFullPageScreenshot` and `trimTrailingBackground`)                                                                                   | Scaled, truncated, trimmed, and none each recorded, with the stored PNG's dimensions; content ending within the 8px padding of the bottom edge records `trimmed: false`, and one row higher crops; a failed trim keeps the image and records `trimmed: false`; an image that is not a PNG fails the render | As expected                                                                                                                                                                |
| The signed entry of a Recapture, and of its Duplicate (`tests/main/services/recapture.test.ts`)                                                                      | Both pass the strict manifest schema, stamped 6; both rows mirror the entry                                                                                                                                                                                                                                | As expected                                                                                                                                                                |
| An end-to-end Recapture of an invented page that grows from 1601 to 4001 CSS pixels as it is scrolled (`e2e/recapture.spec.ts`)                                      | `stopped-growing`, `endHeight` 4001, `scrollLockLifted` false; screenshot not scaled, not truncated, not trimmed, `contentHeight` 4001, `width` and `height` equal to the stored PNG's; row equal to entry; the Capture verifies                                                                           | As expected, after the first deviation below was fixed                                                                                                                     |
| An end-to-end Recapture of an app-shell page: the document overflows by its 16px margin and an inner panel grows from 2001 to 10001 px as it is scrolled (same file) | `stopped-growing`, `endHeight` 10001, and the panel's last lazy chunk in the stored text                                                                                                                                                                                                                   | As expected, after the second deviation below was fixed                                                                                                                    |
| An end-to-end Recapture of a page with two scrolling panes, a 2001 px pane growing to 3001 and a 4001 px pane growing to 6001 (same file)                            | `stopped-growing`, `endHeight` 6001, and both panes' lazy chunks in the stored text                                                                                                                                                                                                                        | As expected                                                                                                                                                                |

## Deviations

**Step 6.**

- The first end-to-end run recorded `nothing-to-scroll` for the invented page, with `endHeight`
  4001: the phase had scrolled the whole page. The step script tested a root by moving it one
  pixel down, which a root at its end cannot do, so at the bottom of every page the step found no
  root and the loop ended there, before the stall detector (`SCROLL_STALL_THRESHOLD`) could. The
  first fix, at `bdb25c96`, made the test also try one pixel up.
- Review of that fix found that it kept the document chosen once the document reached its end,
  so the phase never moved on to an inner panel. On an app-shell page whose document overflows
  by its margin, the phase ended `stopped-growing` with `endHeight` 495 and loaded none of the
  panel's lazy content; on a page with two panes, it scrolled only the larger. The fix in this
  step chooses a root by the down-only test, as before step 6, and only when no root can move
  down does the step report the root at its end with the most overflow. The stall count also
  restarts when the height changes in either direction, so a step that moves on to a second pane
  does not inherit the first pane's stalls.
- Review of that fix found that the check for a scroll lock still used the down-only test, so a
  document already at its end when the phase started, such as a page loaded at a fragment near
  its bottom, read as locked: the phase set `overflow: visible` on `html` and `body`, and the
  entry signed `scrollLockLifted: true`. The check now uses the step's root choice, so a root at
  its end is not a lock. On one locked page that also leaves the lock in place; the scroll-lock
  runs below show which.

The effect on acquisition, against the build before step 6 (`b4bd9b71`). Each row is one
Electron run of the step script, extracted from the source named, driven through the renderer's
stall logic with a 30 s limit, in a hidden offscreen window under `xvfb-run`. The runs used
the review's reproduction script, adapted; it is not in the repository.

| Page                                                                    | Before step 6                                        | First fix (`bdb25c96`)                           | This step                                          |
| ----------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------- |
| App shell: 16px document overflow, inner panel growing to 10001 px      | `nothing-to-scroll` at 10001, 26 steps, 4 chunks     | `stopped-growing` at 495, 4 steps, no chunk      | `stopped-growing` at 10001, 27 steps, 4 chunks     |
| Two panes of 3000 and 6000 px                                           | `nothing-to-scroll` at 3000, 19 steps, both scrolled | `stopped-growing` at 6000, 14 steps, larger only | `stopped-growing` at 6000, 22 steps, both scrolled |
| Two panes, each loading one chunk at its end                            | `nothing-to-scroll` at 3001, 21 steps, both scrolled | `stopped-growing` at 6001, 15 steps, larger only | `stopped-growing` at 6001, 24 steps, both scrolled |
| An endless document feed adding a 2000 px chunk 1 s after its end shows | `nothing-to-scroll` at 2001, 5 steps, no chunk       | `time-budget` at 22001, 60 steps, 10 chunks      | `time-budget` at 22001, 60 steps, 10 chunks        |

So on the first three pages a background render takes one to three more half-second steps
before it ends the phase. A feed whose next chunk takes longer than the half-second pause, but
arrives before the third stall step, keeps loading: where the build before step 6 stopped at the
first bottom, it now runs to the height cap or the phase's time limit.

Every change in height now restarts the stall count, so at its bottom a page whose height changes
at every step, down as well as up, runs to the height cap or the phase's time limit. The build
before step 6 counted a fall in height as a stall step, so a page that shrank at its bottom three
steps in a row stopped there.

The scroll lock, in Electron runs of the unlock and step scripts set up as the rows above, from
the source at `c7219ba3` (the same renderer file as `b4bd9b71`) and at `7b449b26`. Each page holds
a 5000 px block and a closing paragraph, the window shows 479 px, and each run read the page's
`document.compatMode` before the phase. Every page was loaded at its top and at the paragraph's
fragment. The build before step 6 recorded no outcome, so its column names where its loop ended
in D5's terms; "no height" means the first step found no root.

| Page                                                              | Loaded at | Before step 6                              | This step                             |
| ----------------------------------------------------------------- | --------- | ------------------------------------------ | ------------------------------------- |
| No doctype (`BackCompat`), no styles                              | top       | not lifted, `nothing-to-scroll` at 5058    | not lifted, `stopped-growing` at 5058 |
| No doctype, no styles                                             | fragment  | lifted, `nothing-to-scroll`, no height     | not lifted, `stopped-growing` at 5058 |
| No doctype, `overflow: hidden` on `html` and `body`               | either    | not lifted, `nothing-to-scroll`, no height | the same                              |
| No doctype, `height: 100%; overflow: hidden` on `html` and `body` | either    | lifted, `nothing-to-scroll` at 5042        | lifted, `stopped-growing` at 5042     |
| Doctype (`CSS1Compat`), no styles                                 | top       | not lifted, `nothing-to-scroll` at 5058    | not lifted, `stopped-growing` at 5058 |
| Doctype, no styles                                                | fragment  | lifted, `nothing-to-scroll`, no height     | not lifted, `stopped-growing` at 5058 |
| Doctype, `overflow: hidden` on `html` and `body`                  | top       | not lifted, `nothing-to-scroll` at 5066    | not lifted, `stopped-growing` at 5066 |
| Doctype, `overflow: hidden` on `html` and `body`                  | fragment  | lifted, `nothing-to-scroll`, no height     | not lifted, `stopped-growing` at 5066 |
| Doctype, `height: 100%; overflow: hidden` on `html` and `body`    | top       | not lifted, `nothing-to-scroll` at 487     | not lifted, `stopped-growing` at 487  |
| Doctype, `height: 100%; overflow: hidden` on `html` and `body`    | fragment  | lifted, `nothing-to-scroll` at 5042        | not lifted, `stopped-growing` at 487  |

A script can scroll a standards-mode document styled `overflow: hidden`, so neither build reads
those pages as locked when they load at their top. With `height: 100%` the document overflows
by 8 px, and the 5000 px block scrolls inside `body`, which neither build's step considers: its
inner roots are the descendants of `body`. Loaded at the fragment, that document starts at its
8 px end. The build before step 6 read that as a lock, lifted it, and scrolled to 5042; this step
reads a root at its end, lifts nothing, and ends `stopped-growing` at 487, as both builds do for
the page loaded at its top. So on that page, loaded at the fragment, the phase no longer loosens
the lock and scrolls none of the block, where the build before step 6 scrolled all of it. In
quirks mode the full-height document cannot move from script, so both builds lift its lock
wherever the page loads.

## False positives and negatives

**Step 6.**

- `stopped-growing` means three steps, half a second apart, without a change in height or
  progress. A page whose lazy content arrives after that window reads as stopped while more
  content would come.
- With every root at its end, the step reports the one with the most overflow, so a smaller pane
  that grows after the phase moved on is scrolled again only if its growth lets it move down
  before the stall count ends.
- `nothing-to-scroll` is also recorded when a page removes its scrollable root partway through
  the phase, with the last height the loop read.
- The step script runs in the page's own JavaScript world, so a page can report any position and
  height, and the outcome records what the page reported. A height that is not a non-negative
  integer is left out of the entry rather than signed.

## Known limitations

**Step 6.**

- `endHeight` is the height of the root the step scrolled. On a page that scrolls an inner
  container, that is the container's height, not the document's.
- The step never scrolls `body` itself. A page with a doctype and `height: 100%; overflow: hidden`
  on `html` and `body` scrolls its content there, so the phase lifts no lock and stops at the
  document's 8 px overflow; the scroll-lock runs above give the numbers.
- When the browser reports no CSS content size, the screenshot is taken of the 1280 by 900
  viewport, and `contentWidth` and `contentHeight` record that box, which D6 defines as the box
  the screenshot was asked for.
- The MHTML counts `pinnedImages` and `pinnedImagesNotLoaded` are 0 on every entry this build
  writes, because the render pins no image before the save. #1843 adds the pinning. A page whose
  `srcset` images the MHTML drops still records 0, and once #1843 ships the same zeros mean that
  pinning ran and found nothing; only the entry's `toolVersion` tells the two apart. Step 6 should
  not ship in a release without #1843.
- Until steps 9 and 10, every inventory records the Transaction Record and the PDF as
  `not-taken`. That is true of the build that writes it, and it stays in the chain.

## Acceptance decision

Owed: the maintainer records it here before the release that ships the writers.
