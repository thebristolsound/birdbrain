# Jev shadow lenses: triage routing and the hunk demoter

Status: proposed, waiting on three maintainer decisions (bottom of this file).

Grounds: the benchmark run recorded in `scripts/spikes/jev-bench/README.md` (2026-09-25). Triage
routing agreed with the human label on 83% of 123 issues and found `process` work at AUC 0.92.
The per-hunk evidence question scored every incidental backstop hit ADR-0014 names at 0.02–0.08
while ranking true evidence hunks above them (AUC 0.85). Claim-vs-diff failed and is not here.

## What a shadow lens is

A lens observes and records. It never gates, never comments, never changes a triage label. Its
verdict lands on a surface a human can see and a script can score against the label a human
later applies. ADR-0029 defers change classification "until measurements justify their
maintenance cost"; the lens exists to produce that measurement, and it is retired or promoted on
the numbers it collects.

## Lens 1: triage routing

- Trigger: `issues` `opened` and `edited`, and `reopened`. Skip the machine account's own issues
  and anything already carrying `ready-for-agent`, `ready-for-human`, `queued` or `wontfix`.
- State: title and body, capped at 7,000 characters. Nothing else.
- Questions: the `route` Choice and the `process` Noul from `bench/ready-bar.mjs`, unchanged.
- Verdict surface: one label from `lens:agent`, `lens:human`, `lens:needs-info`, replacing any
  earlier `lens:` label; `lens:process` added when the Noul is over 0.5. Probabilities and
  confidence go to the job summary. Labels are visible, filterable, removable, and cost no
  reviewer attention beyond a glance. They are never read by dispatch: the frontier stays
  `ready-for-agent` and `queued`.
- Scoring: `scripts/jev-lens/score.mjs` lists issues that carry both a `lens:` label and a human
  triage label and prints agreement, split by confidence. Run by hand, monthly.

## Lens 2: the hunk demoter

- Trigger: `pull_request` `opened` and `synchronize`, same-repository branches only (fork and
  Dependabot runs have no secrets). Only when the diff touches a blocking-tier path.
- Path list: `scripts/jev-lens/backstop.mjs` parses the tables in
  `docs/specs/2026-07-31-evidence-affecting-paths-assessment.md` (Path, Tier, Why) so the
  document stays the single source. This mechanises a check the reviewer agent does by reading
  today (`.claude/agents/birdbrain-reviewer.md`, "the backstop is yours to enforce").
- State per hit: the file path and its hunks, capped at 14,000 characters. The whole diff is
  never sent; the benchmark shows large state is where Jev fails.
- Question: `touches_evidence` from `bench/evidence-pr.mjs`, unchanged.
- Verdict surface: commit status `jev/evidence-hunks` on the head sha, never required. State is
  always `success`; the description carries the count and the low scores, for example
  `4 blocking hits; 3 read incidental (0.02, 0.04, 0.07); export.ts 0.63`. The job summary
  carries the full table. A status is the surface `agent/pre-pass` already uses, it is visible in
  the merge box, and the statuses API keeps one row per sha for scoring.
- Threshold: 0.1 marks "reads incidental." Chosen from the benchmark (all four known incidental
  hits under 0.08; true hunks' median 0.18). Revisit after 30 PRs.
- Caps: at most 40 hunks per PR, at most 14,000 characters each. Over the cap, the status says
  so and the lens stops; it does not sample.
- Scoring: the reviewer's advisory-or-blocking disposition on each hit, recorded in the PR body's
  findings list, against the lens's incidental flag. `score.mjs` prints the PRs where they
  disagree; a human reads those.

## Files

| File | Purpose |
| --- | --- |
| `.github/workflows/jev-lens.yml` | Two jobs, one per lens. `issues: write` for labels, `statuses: write` for the PR job. Skips when `TYPESAFE_API_KEY` is unset so a fork or a missing secret is a no-op, not a red run |
| `scripts/jev-lens/lib/jev.mjs` | The raw-fetch client, moved from the spike; the spike imports it from here |
| `scripts/jev-lens/backstop.mjs` | Include-list parser and path matcher |
| `scripts/jev-lens/triage.mjs` | Lens 1 |
| `scripts/jev-lens/hunks.mjs` | Lens 2 |
| `scripts/jev-lens/score.mjs` | Agreement report for both lenses |
| `tests/jevLens/*.test.ts` | Parser, matcher, label replacement, status description, caps. The client is exercised against a local stub as the spike's dry run does. `scripts/diff-coverage.mjs` needs `scripts/jev-lens/` added to its instrumented list beside `scripts/slop-audit/` |
| `docs/adr/0031-shadow-lenses-observe-before-they-gate.md` | The record ADR-0029 asks for: what is authorised, the caps, the retire-or-promote criteria |
| `CLAUDE.md`, `AGENTS.md` | One line under "Background jobs": the lens labels and status exist, are advisory, and are never read by dispatch |

Ten files plus the ADR. The workflow, ADR and instruction files are outside the ADR-0016
same-turn envelope, so this waits.

## Retire-or-promote criteria, 60 days or 30 PRs and 60 issues, whichever comes first

- Lens 1 promotes to an advisory triage comment only if agreement with the human label holds at
  or above 80% on issues where confidence is at least 0.8. Below 70% it is retired.
- Lens 2 promotes to an input the reviewer must dispose of only if no hit it marked incidental is
  later relabelled blocking by a reviewer. One such miss retires the threshold, not the lens; a
  second retires the lens.
- Either lens retires if a run ever changes a triage label or a required check, or if a month's
  spend exceeds the amount named in the ADR.

## Cost

Benchmark rate: about 3,500 tokens per hunk, 1,500 per issue. At 30 PRs and 60 issues a month
that is under 5M tokens, about $0.25 at the September 2026 price. The ADR names a $5 monthly cap
as the retire trigger; the workflow itself cannot enforce a spend cap, which ADR-0029 already
records as a gap for unattended jobs.

## Decisions needed before any of this is built

1. **Private data leaves the repository.** The repository is private. Lens 1 sends issue titles
   and bodies; Lens 2 sends the changed hunks of blocking-tier files. TypeSafe states it does not
   train on requests; zero data retention is an enterprise term, not the free plan. The benchmark
   already sent 500 PR bodies, 45 diffs and 400 issues. Yes or no to continuing on an event
   trigger.
2. **Authorisation under ADR-0029.** This is new unattended automation, event-driven rather than
   scheduled, with the caps above. It needs the explicit maintainer authorisation that ADR names.
3. **The key.** It was pasted into a chat thread on 2026-09-25. Rotate it, then set the new one
   as the `TYPESAFE_API_KEY` repository secret yourself; or say so and the agent sets the pasted
   one with `gh secret set`.
