# Design handoffs

Extracted design-handoff bundles from the claude.ai prototype loop, kept byte-faithful as received. Each bundle folder is dated by the day it was received; the HTML prototypes inside run in a browser (keep `support.js` beside them) and their inline styles are the canonical pixel values.

| Bundle | Received | Engineering response |
| --- | --- | --- |
| [`2026-09-19-shared-case-members/`](2026-09-19-shared-case-members/) | 2026-09-19 | Answers the [Shared Case members UI brief](../specs/2026-09-19-shared-case-members-ui-brief.md); verdicts on its items 19–25 in the [feasibility assessment](../specs/2026-09-19-shared-case-members-feasibility-assessment.md) |
| [`2026-09-14-design-project-export/`](2026-09-14-design-project-export/) | 2026-09-14 | The whole design project, self-rendering. Its live mock answers part of #708; delta in its README; supersession awaits a ruling |
| [`2026-08-21-birdbrain-standalone/`](2026-08-21-birdbrain-standalone/) | 2026-08-21 | **Current source.** Supersedes the bundle below |
| [`2026-08-10-birdbrain-prototype/`](2026-08-10-birdbrain-prototype/) | 2026-08-10 | Superseded. [Feasibility assessment](../specs/2026-08-10-design-handoff-feasibility-assessment.md) |

The 2026-08-21 standalone is the single design source by maintainer ruling. It ships packed,
so read its README before you grep it. The prose documents the standalone does not carry
(`HANDOFF.md`, `MOTION.md`, `IMPLEMENTATION_GUIDE.md`, `ENGINEERING_REVIEW.md`,
`SCREEN_NOTES.md`, `github.md`) now sit in the 2026-09-14 export, which mirrors the V2
bundle from the `prototype/design-handoff-2026-08` branch.

Do not edit bundle contents. Corrections go back through the design side, per the round-trip protocol in each bundle's `ENGINEERING_REVIEW.md`.
