# A background render pins image sources before it saves the MHTML

**Status:** Accepted

**Date:** 2026-10-21, amended 2026-10-26

This record states three rulings of the maintainer on
[#1843](https://github.com/thebristolsound/birdbrain/issues/1843) and nothing else: the ruling of
2026-10-21 in the triage of the issue, and two rulings of 2026-10-26 on the review of #2002, as
the orchestrating session relayed them. D4 of the
[first-slice plan](../plans/2026-10-10-capture-engine-first-slice.md) states how the render
carries them out, and the
[validation record](../specs/2026-10-26-capture-engine-first-slice-validation-assessment.md) what
was measured.

## Context

The MHTML serializer drops `srcset` from every `<img>`: an image offered only through `srcset` is
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
  and `sizes` removed.
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
   so it shows what the page displayed, and recording stops after the pin.
   `pinnedImagesNotLoaded` counts a displayed image whose pinned source had not finished loading
   when the wait ended.
2. Before pinning, the render waits, within the time remaining and never from the 40 s end
   reserve, for images offered as sets to settle. Any still loading after that wait are left out.
   The counts cover only images that had settled, and the report, the features page, the
   glossary, this record and the validation record say so.

## Consequences

- The saved MHTML is no longer exactly what the serializer would have written from the page as
  loaded; the signed counts are what a reader relies on.
- The counts join the schema number the first-slice verifier takes (#1904), because a released
  verifier cannot be recalled.
- A verifier rejects a not-loaded count above the pinned count.
