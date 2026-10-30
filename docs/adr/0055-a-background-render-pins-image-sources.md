# A background render pins image sources before it saves the MHTML

**Status:** Accepted

**Date:** 2026-10-21, amended 2026-10-26, 2026-10-29 and 2026-10-30

This record states seven rulings of the maintainer on
[#1843](https://github.com/thebristolsound/birdbrain/issues/1843) and nothing else: the ruling of
2026-10-21 in the triage of the issue, two rulings of 2026-10-26 on the review of #2002, three
choices in that change that the maintainer accepted as built on 2026-10-29, and the ruling of
2026-10-30 that moves the pin before the screenshot. The maintainer's
[comment of 2026-10-29 on #1843](https://github.com/thebristolsound/birdbrain/issues/1843#issuecomment-6515710604)
states the rulings of 2026-10-26 and the three choices, and the
[comment of 2026-10-30](https://github.com/thebristolsound/birdbrain/issues/1843#issuecomment-6534767262)
the last ruling. D4 of the
[first-slice plan](../plans/2026-10-10-capture-engine-first-slice.md) states how the render
carries them out, and the
[validation record](../specs/2026-10-26-capture-engine-first-slice-validation-assessment.md) what
was measured.

## Context

The MHTML serializer drops `srcset` and `sizes` from every `<img>` and keeps `src`: an image
offered only through `srcset` is
missing from the saved page, and an image with both `src` and `srcset` is filed under an address
the browser never requested.
[ADR-0004](0004-adopt-osint-assurance-baseline.md) treats MHTML as a browser-oriented
representation and requires a Capture to record the limitations that applied. The Transaction
Record ([ADR-0035](0035-one-transaction-record-per-capture.md)) holds the true bytes only when
recording was on before the page loaded, and does not correct an address the MHTML states
wrongly.

## Considered options

- **State the gap as a limitation.** It never changes captured content, but leaves a wrong origin
  in the saved page.
- **Rely on the Transaction Record.** It builds nothing now, and leaves the wrong address in every
  MHTML.
- **Pin the image sources before the save.** Chosen.

## Decision

**Ruling of 2026-10-21.**

- After the screenshot and before the save, each `<img>` outside `<picture>` that carries
  `srcset` and displayed an image has its `src` set to the source it displayed, and its `srcset`
  and `sizes` removed. Amended on 2026-10-30: the pin runs before the screenshot (ruling 6).
- The save waits for each pinned image to finish loading, bounded by the render's existing time
  budget, and never extends the render past its deadline.
- The Capture records Image Source Pinning as two always-written whole-number counts in the MHTML
  part of the signed inventory, following Consent Suppression: the images pinned, and the pinned
  images not loaded when the save ran.
- Background renders only: the extension is untested, and a change there would alter the
  Operator's own tab.

**Rulings of 2026-10-26.**

1. Only an image that displayed is pinned: one that loaded with a non-zero natural size. An image
   that failed to load is left as it is. The pin runs while the network is still recorded, so any
   request it causes is in the Transaction Record. The screenshot is still taken before the pin,
   so it shows what the page displayed, and recording stops after the pin. Amended on
   2026-10-30: the screenshot is taken after the pin (ruling 6); recording still stops after
   the pin.
   `pinnedImagesNotLoaded` counts a displayed image whose pinned source had not finished loading
   when the wait ended.
2. Before the screenshot and the pin, the render waits, within the time remaining and never from
   the 40 s end reserve, for images offered as sets to settle. Any image still loading when that
   wait ends is left out of the pin. The counts cover only images that had settled, and the
   report, the features page, the glossary, this record and the validation record say so.

**Rulings of 2026-10-29.**

3. A pinned image whose pinned source finished without showing an image counts as not loaded.
4. An image the page shows from a `blob:` address is left as it is.
5. The report states both counts in one sentence, shown even when both are 0, in place of a
   separate line left out at 0. This replaces the issue's original wording for that line.

**Ruling of 2026-10-30.**

6. The pin runs before the full-page screenshot, amending the order of 2026-10-21. The rulings
   of 2026-10-29 still hold: only displayed images are pinned, and an image still loading when
   the settle wait ends is left out.

The render carries out ruling 6 as the first option of the
[investigation on #2002](https://github.com/thebristolsound/birdbrain/pull/2002#issuecomment-6525048488)
proposed: the pin sets `src` and leaves `srcset` and `sizes` on the live page, and the serializer
drops both from the saved page. So the saved `<img>` holds only the pinned `src`, as the ruling
of 2026-10-21 asks, while the live page keeps its set and the browser chooses from it again
rather than loading `src`. After the screenshot the render counts the pinned images, and
recording stops after that, just before the save.

## Consequences

- The saved MHTML is no longer exactly what the serializer would have written from the page as
  loaded; the signed counts are what a reader relies on.
- The counts join the schema number the first-slice verifier takes (#1904), because a released
  verifier cannot be recalled.
- A verifier rejects a not-loaded count above the pinned count.
- The screenshot shows the page after the pin has changed its DOM. On the pages measured, an
  image whose set has a 1x candidate or width descriptors kept the copy it displayed, with no
  second request, and on each page holding only such images the screenshot matched the one
  taken before the pin pixel for pixel
  ([validation record](../specs/2026-10-26-capture-engine-first-slice-validation-assessment.md),
  2026-10-30).
- An image offered only at densities other than 1x, such as `srcset="a.png 2x"`, is shown at 1x
  once its `src` is set, because `src` joins its set as the 1x candidate. The screenshot then
  shows it at its natural size, not the size the page displayed, and loads it again: the saved
  page holds the second response, and the Transaction Record both requests (same record).
- The PDF, printed from the live page, now shows a pinned image from a set with width
  descriptors at the size the page displayed it, because the live page keeps `srcset`. With
  `srcset` removed it printed such an image at its natural size: on the measured page, two to
  six times the width displayed.
- The serializer writes a `width` and `height` into a saved `<img>` that has no size attributes
  of its own and was displayed from a width descriptor at a density other than 1x, so the saved
  page shows the image at its displayed size (same record).
