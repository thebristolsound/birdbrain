# Shadow lenses observe before they gate

**Status:** Accepted

**Date:** 2026-09-25

Extends [ADR-0029](0029-measure-before-expanding-agent-automation.md), which defers change
classification "until measurements justify their maintenance cost." This record authorises the
measurement and names what retires it.

## Context

A System One model (TypeSafe's Jev) returns typed judgments over text rather than generated
prose. On 2026-09-25 it was benchmarked against labels humans had already applied in this
repository (`scripts/spikes/jev-bench/README.md`). Two questions scored well enough to watch:
routing an issue to `ready-for-agent` or `ready-for-human` agreed with the human label on 83% of
123 issues, and a per-file question over blocking-tier hunks scored every incidental backstop hit
ADR-0014 names under 0.1 while ranking true evidence hunks above them. A third question, whether
the diff supports an Evidence impact claim, failed and is not adopted.

The repository is private. Each lens sends text to TypeSafe: issue titles and bodies, and the
changed hunks of blocking-tier files. The maintainer authorised that on 2026-09-25.

## Decision

Two lenses run from `.github/workflows/jev-lens.yml`, event-driven, never scheduled.

1. **Triage routing.** On issue open, edit or reopen, one of `lens:agent`, `lens:human`,
   `lens:needs-info`, plus `lens:process` when that probability is at least 0.5. Skipped when the
   issue already carries a human route (`ready-for-agent`, `ready-for-human`, `queued`,
   `wontfix`) or was filed by the machine account.
2. **Hunk demoter.** On PR open or push from a same-repository branch, the commit status
   `jev/evidence-hunks` on the head sha: one probability per blocking-tier file the diff touches,
   with hits under 0.1 named as reading incidental. At most 40 files per PR, at most 14,000
   characters per file; over the cap the lens stops and says so.

Both are shadow: the status is always `success` and never a required check; the `lens:` labels
are never read by dispatch, whose frontier stays `ready-for-agent` and `queued` (ADR-0028); no
lens comments. The path list the hunk lens matches against is parsed from
`docs/specs/2026-07-31-evidence-affecting-paths-assessment.md` at run time, so that document
remains the single source. `scripts/jev-lens/score.mjs` reports agreement; it is run by hand.

## Retire or promote

Reviewed after 60 days, or after 30 PRs and 60 issues, whichever comes first.

- The triage lens may become an advisory comment only if its label agrees with the human route on
  at least 80% of issues that carry both. Under 70% it is retired.
- The hunk lens may become an input the reviewer must dispose of only if no hit it marked
  incidental is later relabelled blocking by a reviewer. One such miss retires the threshold, not
  the lens; a second retires the lens.
- Either lens is retired at once if a run changes a triage label or a required check, or if a
  month's TypeSafe spend exceeds $5. The benchmark rate puts expected spend under $0.25 a month;
  the workflow cannot enforce a cap, which ADR-0029 already records as a gap.

## Consequences

- One new secret, `TYPESAFE_API_KEY`. A fork or a missing secret is a quiet no-op.
- Four new labels. Dispatch, the pre-pass gate and the stale-issue sweep ignore them.
- One new commit status context beside `agent/pre-pass`. The merge box shows two advisory rows.
- The reviewer agent still enforces the backstop by reading; the status is a second opinion it
  may cite, not a substitute for the disposition it owes.
