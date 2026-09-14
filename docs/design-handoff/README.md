# Design handoffs

Extracted design-handoff bundles from the claude.ai prototype loop, kept byte-faithful as received. Each bundle folder is dated by the day it was received; the HTML prototypes inside run in a browser (keep `support.js` beside them) and their inline styles are the canonical pixel values.

| Bundle | Received | Engineering response |
| --- | --- | --- |
| [`2026-09-14-birdbrain-dc/`](2026-09-14-birdbrain-dc/) | 2026-09-14 | Answers part of #708. Delta against 2026-08-21 in its README; supersession awaits a ruling |
| [`2026-08-21-birdbrain-standalone/`](2026-08-21-birdbrain-standalone/) | 2026-08-21 | **Current source.** Supersedes the bundle below |
| [`2026-08-10-birdbrain-prototype/`](2026-08-10-birdbrain-prototype/) | 2026-08-10 | Superseded. [Feasibility assessment](../specs/2026-08-10-design-handoff-feasibility-assessment.md) |

The 2026-08-21 standalone is the single design source by maintainer ruling. It ships packed,
so read its README before you grep it. The V2 bundle on the `prototype/design-handoff-2026-08`
branch still holds prose documents the standalone does not carry.

Do not edit bundle contents. Corrections go back through the design side, per the round-trip protocol in each bundle's `ENGINEERING_REVIEW.md`.
