# A background render pins image sources before it saves the MHTML

**Status:** Accepted

**Date:** 2026-10-21, amended 2026-10-26, 2026-10-29 and twice on 2026-10-30

This record states nine rulings of the maintainer on
[#1843](https://github.com/thebristolsound/birdbrain/issues/1843) and nothing else: the ruling of
2026-10-21 in the triage of the issue, two rulings of 2026-10-26 on the review of #2002, three
choices in that change that the maintainer accepted as built on 2026-10-29, and three rulings of
2026-10-30: one moves the pin before the screenshot, one leaves `srcset` and `sizes` on the live
page, and one keeps the density of an image displayed at a density other than 1x. The
maintainer's
[comment of 2026-10-29 on #1843](https://github.com/thebristolsound/birdbrain/issues/1843#issuecomment-6515710604)
states the rulings of 2026-10-26 and the three choices, the
[first comment of 2026-10-30](https://github.com/thebristolsound/birdbrain/issues/1843#issuecomment-6534767262)
ruling 6, and the
[second](https://github.com/thebristolsound/birdbrain/issues/1843#issuecomment-6535493015)
rulings 7 and 8. D4 of the
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
  and `sizes` removed. Amended on 2026-10-30: the pin runs before the screenshot (ruling 6), and
  `srcset` and `sizes` stay on the live page (ruling 7).
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

7. The pin leaves an image's `srcset` and `sizes` on the live page and sets only its `src`. The
   serializer drops both from the saved copy, so the saved page is unchanged. This amends the
   2026-10-21 wording that the pin removes them.
8. An image the page displayed from a candidate whose density is not 1x keeps its density. The
   pin narrows that image's `srcset` to the one candidate it displayed, with its density label,
   so the image keeps its size in the screenshot and the PDF and is not fetched again.

The render carries out ruling 6 as the first option of the
[investigation on #2002](https://github.com/thebristolsound/birdbrain/pull/2002#issuecomment-6525048488)
proposed, and ruling 7 with it: the saved `<img>` holds only the pinned `src`, as the ruling of
2026-10-21 asks, while the live page keeps its set and the browser chooses from it again rather
than loading `src`. After the screenshot the render counts the pinned images, and recording
stops after that, just before the save.

The render carries out ruling 8 with one difference from its wording. Chromium adds `src` to any
set without a width descriptor as a 1x candidate and shows that one, so a set narrowed to
`<url> 2x` still showed a 2x-only image at 1x and at its natural size
([validation record](../specs/2026-10-26-capture-engine-first-slice-validation-assessment.md),
2026-10-30). The pin therefore writes the density as a width: a candidate displayed at density
`d` becomes `<url> 1000w` with `sizes` set to `1000 / d` pixels, which gives the browser the
same density and keeps `src` out of the set. An image displayed from a width candidate, whose
density the page's `sizes` sets, keeps that candidate alone with the page's `sizes`. When the
pin cannot tell which candidate displayed, because no candidate has the image's `currentSrc` or
those that do differ in descriptor, it sets only `src`. D4 of the plan states the parsing.

## Consequences

- The saved MHTML is no longer exactly what the serializer would have written from the page as
  loaded; the signed counts are what a reader relies on.
- The counts join the schema number the first-slice verifier takes (#1904), because a released
  verifier cannot be recalled.
- A verifier rejects a not-loaded count above the pinned count.
- The screenshot shows the page after the pin has changed its DOM. On the pages measured, an
  image whose set has a 1x candidate or width descriptors kept the copy it displayed, with no
  second request, and on each page holding only such images the screenshot matched the one
  taken before the pin pixel for pixel, measured before ruling 8 narrowed width sets
  ([validation record](../specs/2026-10-26-capture-engine-first-slice-validation-assessment.md),
  2026-10-30).
- An image offered only at densities other than 1x, such as `srcset="a.png 2x"` or
  `srcset="b.png 1.5x"`, keeps the size the page displayed it at: in the end-to-end test each was
  served once, its saved part held that response, and the screenshot showed it at its displayed
  size, as did the PDF of that run (same record). With only `src` set, it showed at its natural
  size and was loaded again.
- The PDF, printed from the live page, shows an image pinned from a width candidate or a density
  other than 1x at the size the page displayed it, because the live page keeps the narrowed set.
  With `srcset` removed it printed such an image at its natural size: on the measured page, two
  to six times the width displayed.
- The serializer writes a `width` and `height` into a saved `<img>` that has no size attributes
  of its own and was displayed from a width descriptor at a density other than 1x, so the saved
  page shows the image at its displayed size (same record). Since ruling 8 this covers an image
  displayed at a density other than 1x, whose narrowed set is a width candidate.
- An image whose displayed candidate the pin cannot tell apart keeps its whole set. In the one
  such case measured, a `src` that is also its set's 2x candidate, the browser loaded the image
  again (same record).
