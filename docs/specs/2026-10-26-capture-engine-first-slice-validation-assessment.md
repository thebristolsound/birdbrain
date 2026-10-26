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

| Check                                                                                                                            | Expected                                                                                                                                                                                                                                      | Observed                                                   |
| -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Each D5 ending, driven with a mocked `WebContents` (`tests/main/services/backgroundRenderer.test.ts`, `scrollToLoadLazyContent`) | Budget zero records `ran: false` and no outcome; no scrollable root records `nothing-to-scroll`; a page at the scroll cap records `height-cap`; three steps without growth record `stopped-growing`; the phase deadline records `time-budget` | Each as expected, and each record passes the strict schema |
| A step that throws (same file)                                                                                                   | The phase rejects, so the render fails, and the page's scroll position and lock are restored                                                                                                                                                  | As expected                                                |
| A height the page reports that is not a non-negative integer (same file)                                                         | No `endHeight`                                                                                                                                                                                                                                | As expected for a fraction, a negative number, and text    |
| The D6 facts (same file, `captureFullPageScreenshot`)                                                                            | Scaled, truncated, trimmed, and none each recorded, with the stored PNG's dimensions; a failed trim keeps the image and records `trimmed: false`; an image that is not a PNG fails the render                                                 | As expected                                                |
| The signed entry of a Recapture, and of its Duplicate (`tests/main/services/recapture.test.ts`)                                  | Both pass the strict manifest schema, stamped 6; both rows mirror the entry                                                                                                                                                                   | As expected                                                |
| An end-to-end Recapture of an invented page that grows from 1601 to 4001 CSS pixels as it is scrolled (`e2e/recapture.spec.ts`)  | `stopped-growing`, `endHeight` 4001, `scrollLockLifted` false; screenshot not scaled, not truncated, not trimmed, `contentHeight` 4001, `width` and `height` equal to the stored PNG's; row equal to entry; the Capture verifies              | As expected, after the deviation below was fixed           |

## Deviations

**Step 6.** The first end-to-end run recorded `nothing-to-scroll` for the invented page, with
`endHeight` 4001: the phase had scrolled the whole page. The step script's scroll probe moved the
root down one pixel to test it, and a root already at its end cannot move down, so at the bottom
of every page the step found no scrollable root and the loop ended there. The stall detector
(`SCROLL_STALL_THRESHOLD`) could therefore end the phase only when a page stopped moving short of
its bottom. Step 6 makes the probe also try one pixel up, so a root at its end still counts as
scrollable. A background render now scrolls up to three more steps at the bottom of a page, half
a second apart, before it ends the phase, and the second end-to-end run recorded
`stopped-growing`.

## False positives and negatives

**Step 6.**

- `stopped-growing` means three steps, half a second apart, without growth or progress. A page
  whose lazy content arrives after that window reads as stopped while more content would come.
- `nothing-to-scroll` is also recorded when a page removes its scrollable root partway through
  the phase, with the last height the loop read.
- The step script runs in the page's own JavaScript world, so a page can report any position and
  height, and the outcome records what the page reported. A height that is not a non-negative
  integer is left out of the entry rather than signed.

## Known limitations

**Step 6.**

- `endHeight` is the height of the root the step scrolled. On a page that scrolls an inner
  container, that is the container's height, not the document's.
- When the browser reports no CSS content size, the screenshot is taken of the 1280 by 900
  viewport, and `contentWidth` and `contentHeight` record that box, which D6 defines as the box
  the screenshot was asked for.
- The MHTML counts `pinnedImages` and `pinnedImagesNotLoaded` are 0 on every entry this build
  writes, because the render pins no image before the save. #1843 adds the pinning. A page whose
  `srcset` images the MHTML drops still records 0.
- Until steps 9 and 10, every inventory records the Transaction Record and the PDF as
  `not-taken`. That is true of the build that writes it, and it stays in the chain.

## Acceptance decision

Owed: the maintainer records it here before the release that ships the writers.
