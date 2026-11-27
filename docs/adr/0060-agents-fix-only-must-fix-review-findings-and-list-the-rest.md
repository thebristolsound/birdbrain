# Agents fix only must-fix review findings and list the rest in the description

**Status:** Accepted

**Date:** 2026-11-27

Amends [ADR-0028](0028-dispatch-works-a-hand-picked-queue.md), which left open what the
implementer does with non-blocking findings, and
[ADR-0022](0022-one-shape-per-posting-surface.md), whose PR body gains a section. The review
fleet and its gate ([ADR-0057](0057-a-two-family-review-fleet-reads-every-pr-and-gates-the-merge.md)),
the filing gate of ADR-0028 and the one-fix-round rule of the dispatch skill are unchanged.

## Context

ADR-0028 kept the reviewers reporting every finding and changed only what happened to the
non-blocking ones: they go in the PR body or the review comment and are dropped at merge. Three
gaps followed.

- **No rule said which non-blocking findings to fix.** The implementer definition said
  "applying is not the default" and nothing more. The `ship-unit` skill had a table that sent
  every non-blocking finding about behaviour or a test gap into that round's push.
- **Each push costs a review fleet round.** On PR #2276, a small hook and archive-tool fix,
  most non-blocking findings were applied across several pushes, and each push started another
  paid fleet round.
- **The body had no place for the list.** `CLAUDE.md` and `ship-unit` sent leftover findings to
  "the description's findings list", but the `post-pr-body` skill allowed no such section. On
  #2276 the six findings left open appeared only in the agent's chat report.

The maintainer asked, in an interactive session on 2026-11-27, to see which findings agents
take and which they leave, without a step of their own in each round and without holding up the
review fleet or the scheduled dispatch runs. The rules below are what a council of three model
families (Claude Opus 5.5, GPT-6.2 Sol, Gemini 4 Carbon) agreed on, with the maintainer's picks
where they differed.

## Decision

1. **One table decides.** `.claude/skills/ship-unit/SKILL.md`, "Sorting a finding", is the only
   copy of the rule. The implementer definition and the dispatch skill point to it.
2. **Must-fix findings get a fix and a new head.** They are a blocking finding the other model
   family confirmed, a required check that fails, a blocking finding in a `request changes`
   pre-pass, an evidence-gate finding, and a request the maintainer wrote.
3. **A non-blocking finding never starts a push.** A round whose findings are all non-blocking
   ends with a description edit and thread replies, neither of which starts a fleet round. A
   behaviour bug the agent reproduced or traced, in a file the change already edits and inside
   its scope, or a missing test for a branch the change adds, may ride in a push a must-fix
   finding already forces. Wording, style and test-strength findings never do.
4. **The reviewer's severity stands.** An agent may dispute a finding with the `file:line` at
   head that shows it is wrong, and may not relabel it as something smaller.
5. **The description lists every finding.** A `## Review findings` section follows the Summary:
   one visible line, `<n> taken, <m> not taken.` (or `No review findings yet.`), above a
   collapsed block with one row per finding. A row not taken gives one reason: out of scope,
   disputed, test or style only, needs its own push, or filed as #N. The thread replies are
   written from the same dispositions. The section is outside the Summary, so the squash commit
   leaves it out and ADR-0028's discard at merge stands.
6. **Rows carry no links.** The review fleet loads every comment a description links as a
   source it must read (`.github/scripts/review-fleet/inputs.mjs`), so a linked row adds to
   that load and fails the review once its comment is gone. The links go in the thread replies.
7. **The body check asks for the section on agent writes only.** It requires the section on a
   body with the attribution line, and the two merge paths, which pass `--posted`, do not ask
   for it. A PR opened before this decision still merges, and a human author may leave the
   section out. A section that is present is checked on every path.
8. **Filing is unchanged.** A user-visible or evidence-affecting finding is never only a row: it
   is taken when in scope, or filed under ADR-0028.

## Consequences

- A round with only non-blocking findings costs no fleet round. A push now needs a must-fix
  finding.
- The maintainer reads the counts and the reasons on the PR page, where the `merge` label is
  applied, with no new step and no new label.
- No reviewer checks that the section lists every finding; the body check checks only its
  shape and that its counts match its rows. A finding that arrives after the last body edit is
  missing until the next one.
- Some real fixes now wait: a test gap or a small bug with no must-fix push to ride in stays a
  `needs its own push` row, visible at merge.

## Alternatives rejected

- **The maintainer picks each round's findings.** The maintainer first agreed to this, then
  withdrew it in the same session: it adds a step to every round and stalls unattended runs.
- **Never apply a non-blocking finding.** It throws away cheap, real fixes on lines a push
  already changes.
- **A link on every row.** It makes each finding a required fleet source; see decision 6.
- **The record in a PR comment.** A comment scrolls away from where the maintainer applies the
  `merge` label.
- **Failing the merge gate on an incomplete record.** It would stall the auto-merge path and
  repeat the hostage-to-a-bot design ADR-0007 rejected.
- **Changing the dispatch pre-gate so already-answered feedback does not wake it.** Two council
  members proposed it. It is dispatch machinery outside this decision, and can follow if the
  wake-ups show up as cost.
