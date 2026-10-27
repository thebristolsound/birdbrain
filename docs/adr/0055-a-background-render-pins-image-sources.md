# A background render pins image sources before it saves the MHTML

**Status:** Accepted

**Date:** 2026-10-21

The source is the maintainer's ruling during the triage of
[#1843](https://github.com/thebristolsound/birdbrain/issues/1843) on 2026-10-21. D4 of the
[first-slice plan](../plans/2026-10-10-capture-engine-first-slice.md) states what the render does,
and the [validation record](../specs/2026-10-26-capture-engine-first-slice-validation-assessment.md)
what was measured.

## Context

A background Recapture saves the page with the browser's MHTML serializer. The triage of #1843
reproduced, on Electron 44.7.0, that the serializer drops `srcset` from every `<img>`. An image
offered only through `srcset` is missing from the saved page although the browser fetched and
displayed it. An image that also has a `src` is saved with the bytes the page displayed, filed
under the `src` address, which the browser never requested. Images inside `<picture>` and plain
images save correctly.

[ADR-0004](0004-adopt-osint-assurance-baseline.md) treats MHTML as a browser-oriented
representation and requires a Capture to record the limitations that applied. The Transaction
Record ([ADR-0035](0035-one-transaction-record-per-capture.md)) holds the bytes the browser
received only when recording was on before the page loaded, and it does not correct an address
the MHTML states wrongly.

## Considered options

- **State the gap as a limitation.** Keep the MHTML as the serializer wrote it and record which
  images are missing or misfiled. It never changes captured content, but the saved page would
  still name an origin the bytes did not come from.
- **Rely on the Transaction Record.** Build nothing now. It leaves the wrong address in every
  MHTML, including Captures taken without a Transaction Record.
- **Pin the image sources before the save.** Chosen.

## Decision

**After the screenshot and before the save, the render points each affected image at the source
it displayed.** Each `<img>` outside `<picture>` that carries `srcset` and displayed an image has
its `src` set to the source it displayed, and its `srcset` and `sizes` removed. An image that
displayed nothing is left as it is. The screenshot is taken before the change, so it shows the
page as loaded.

**The Capture states that this happened.** Image Source Pinning is recorded in the MHTML part of
the signed `capture` entry's inventory as two counts, always written: the images pinned, and the
pinned images that had not loaded when the save ran. The report states the counts. This
follows Consent Suppression, the existing record of a change the render makes to the page.

**Background renders only.** The browser extension saves through the same serializer, but a
change there would alter the Operator's own tab, and its behaviour has not been tested. It is out
of scope until someone tests it.

## Consequences

- The saved MHTML is no longer exactly what the serializer would have written from the page as
  loaded. The signed counts, not the absence of a change, are what a reader relies on.
- The two counts join the manifest schema number the first-slice verifier takes (#1904), because
  a released verifier cannot be recalled and no release has shipped that number yet.
- A verifier rejects an entry whose not-loaded count exceeds its pinned count, the only shape of
  the two fields that contradicts itself.
- The render tells "displayed an image" by the browser's `currentSrc`. An image whose load failed
  also has one, so it is pinned and counted as not loaded; the validation record lists this and
  the other limits measured on Electron 44.9.1.
