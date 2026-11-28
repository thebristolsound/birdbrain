# Agents fix only must-fix review findings and list the rest in the description

**Status:** Accepted

**Date:** 2026-11-27

Amends [ADR-0028](0028-dispatch-works-a-hand-picked-queue.md), which left open what the
implementer does with non-blocking findings;
[ADR-0022](0022-one-shape-per-posting-surface.md), whose PR body gains a section; and
[ADR-0057](0057-a-two-family-review-fleet-reads-every-pr-and-gates-the-merge.md), whose fleet
reads that section's attributions as a record (decision 6). The fleet's gate, the filing gate
of ADR-0028 and the one-fix-round rule of the dispatch skill are unchanged; the dispatch
pre-gate changes in when it counts feedback as answered (decision 9).

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

1. **One table decides.** `.claude/skills/ship-unit/SKILL.md`, "Sorting a finding", is the one
   place that decides what a finding gets. The implementer definition and the dispatch skill
   point to it; the row shape and its reason names belong to the `post-pr-body` skill.
2. **Must-fix findings get a fix and a new head.** They are a blocking finding the other model
   family confirmed, a required check that fails, a `blocking` or `gate` finding in a
   `request changes` pre-pass, an evidence-gate finding, and a request the maintainer wrote.
3. **Only a must-fix finding starts a push.** A round with none ends with a description edit
   and thread replies, neither of which starts a fleet round. A behaviour bug the agent
   reproduced or traced, in a file the change already edits and inside its scope, or a missing
   test for a branch the change adds, may ride in a push a must-fix finding already forces.
   Wording, style and test-strength findings never do. A must-fix finding the agent disputes,
   or a fleet failure it can answer only in the description, leaves a gate red that no push of
   its own will clear, so dispatch parks the PR for the maintainer. A must-fix finding left
   unfixed when the PR is parked is a `needs its own push` row.
4. **The reviewer's severity stands.** An agent may dispute a finding with the `file:line` at
   head that shows it is wrong, and may not relabel it as something smaller.
5. **The description lists every finding.** A `## Review findings` section follows the Summary:
   one visible line, `<n> taken, <m> not taken.` (or `No review findings yet.`), above a
   collapsed block with one row per finding. A taken row says what fixed it; a row not taken
   gives one reason: out of scope, disputed, test or style only, needs its own push, or filed as
   an issue. A finding that came on a thread gets its reply there from the same disposition;
   one a body edit fixed is answered `Applied in the description.`, the review reply that names
   no commit.
   Each round adds its rows to the ones already there. The section is outside the Summary, so
   the squash commit leaves it out and ADR-0028's discard at merge stands.
6. **Rows link nothing, and the fleet reads who raised them as a record.** This amends
   ADR-0057. The fleet fails on a description sentence its inputs do not settle, and a linked
   comment is an input it must load, which fails when the comment is gone, empty, or links
   another repository (`.github/scripts/review-fleet/inputs.mjs`). So rows name the reviewer in
   words, link no issue, pull request or comment, and name no `#N` but a filed issue. The
   fleet's shared prompt (`.github/scripts/review-fleet/prompts/common.md`) reads a row as a
   record of review history as it stood when the row was written: who raised the finding, its
   severity, what it said and the reason given are not checked, because a taken row describes
   code its fix changed and an earlier row's `file:line` may have moved. Only a `Fixed in`
   commit that the fleet's commit list holds, a filed issue, and the counts are checked.
7. **Only agent writes are checked.** The body check requires the section, and checks its rows,
   on a body with the attribution line. The two merge paths, which pass `--posted`, check only
   what every section needs: its place in the order, well-formed `<details>` blocks and plain
   words in its visible lines, so the record
   never holds up a merge and a PR opened before this decision still merges. A human author may
   leave the section out.
8. **Filing keeps its limits.** A user-visible or evidence-affecting finding that is not taken
   is filed under ADR-0028, within its two per PR, and its row says so. Past those two it stays
   a row with its other reason.
9. **Dispatch wakes on what is newer than the last answer.** Each round dispatch records ends
   the section with `<!-- review findings answered through <time> -->`, the time that round
   started reading the review surface. On a PR whose pre-pass passed and that the maintainer has not just
   woken, `.github/scripts/dispatch/pregate.sh` starts a cycle for trusted activity newer than
   that time, or than the head when there is none. On any PR whose pre-pass passed, woken or not, a
   `review/fleet` failure at the head posted after that time starts one too, since no comment
   announces it. Only the line inside the Review findings section counts. Feedback a round read therefore does not start another; feedback
   posted while a round ran, a review bot's reaction to the round's own thread replies, and a
   fleet finding confirmed after it still do. A time in the future is ignored.

## Consequences

- A round with no must-fix finding costs no fleet round. A push now needs a must-fix finding.
- The maintainer reads the counts and the reasons on the PR page, where the `merge` label is
  applied, with no new step and no new label.
- No check compares the section with the findings the reviews raised; the body check, at write
  time, checks only its shape and that its counts match its rows. A finding that arrives after
  the last body edit is missing until the next one, and the next cycle is started for it.
- The fleet checks a row only for its fixing commit, its filed issue and the counts. A row that
  misstates a finding or names the wrong reviewer passes; the comments it describes are on the
  same PR page.
- Anyone who can edit the description can move the answered-through time up to the present,
  which holds off a cycle for activity already on the PR until something newer arrives. It
  cannot hold off a merge gate, which never reads it.
- The section does not count toward the 40 visible lines the body allows above Verification,
  so adding it never pushes a body over that cap.
- Some real fixes now wait: a test gap or a small bug with no must-fix push to ride in stays a
  `needs its own push` row, visible at merge.
- A round with no commit still runs `pnpm preflight` once, because the implementer's stop hook
  wants a verification block at the head.

## Alternatives rejected

- **The maintainer picks each round's findings.** The maintainer first agreed to this, then
  withdrew it in the same session: it adds a step to every round and stalls unattended runs.
- **Never apply a non-blocking finding.** It throws away cheap, real fixes on lines a push
  already changes.
- **Rows that link their source, with no prompt change.** The council's second round adopted
  this; its third found that the fleet's same-head retry deletes the state comment a fleet
  finding would link, and that a linked bot comment citing another repository, or a review with
  no text, fails the fleet.
- **The pipeline's last comment as the answered point.** It hid feedback posted while a round
  ran, never woke for a fleet finding confirmed afterwards, and did not cover a round answered
  only in the description.
- **The record in a PR comment.** A comment scrolls away from where the maintainer applies the
  `merge` label.
- **Failing the merge gate on an incomplete record.** It would stall the auto-merge path and
  repeat the hostage-to-a-bot design ADR-0007 rejected.
