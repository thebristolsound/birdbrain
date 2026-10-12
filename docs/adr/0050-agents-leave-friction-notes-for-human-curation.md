# Agents leave friction notes for human curation

**Status:** Accepted

**Date:** 2026-10-11

Extends [ADR-0028](0028-dispatch-works-a-hand-picked-queue.md): friction notes are a new kind
of pipeline finding, and they are kept out of the tracker the way that decision keeps every
other one out. The maintainer authorized the capture side on 2026-10-11, as
[ADR-0029](0029-measure-before-expanding-agent-automation.md) requires. The read side waits on
the measurement that decision asks for. Plan:
[Agent friction notes and crib notes](../plans/2026-10-10-agent-friction-notes.md).

## Context

Every scheduled run starts from the same documents, and some of what it needs is missing from
them, buried in a long skill, or stated in two places that disagree. Each run then pays to work
the fact out again, and nothing records that it did. The run's report goes into the dispatch
artifact, which is kept 7 days (the maintainer's ruling on #1369), and ADR-0028 discards every
pipeline finding when its PR merges. So the maintainer cannot see which document costs the
runs the most, and no later run can benefit from what an earlier one worked out.

CodeRabbit solves a similar problem for code review with a store of short rules. Each rule
carries the comment it came from, CodeRabbit filters the rules by path and relevance before
using one, and it keeps them outside the repository with no expiry
([research](../specs/2026-10-10-coderabbit-learnings-research.md)). The useful parts are the
provenance and the short rewritten rule. The parts to avoid are entries that nobody reviews
and that never expire.

## Decision

1. **Runs write friction notes.** At the end of its work, each agent in a scheduled run
   returns zero to three notes. Zero is the expected answer. A note has a kind (`friction`,
   `re-derived` or `confusing`), an anchor (the document section, script, command, or workflow
   step it concerns, never a line number), one plain sentence on what happened, the cost (what
   the run did to recover), and the one-line fix to the anchor, or `unknown`. A note without a
   concrete cost is not written.
2. **The participating runs** are the scheduled dispatch cycle (the dispatcher and the
   implementer and reviewer it spawns) and the scheduled PR review. Interactive sessions do not
   post notes during the measurement, so the counts cover one population.
3. **One locked issue holds the raw notes.** The maintainer opens and locks one tracking issue.
   The session leaves its notes in `.dispatch/friction.md`, and a workflow step posts them as
   one comment on that issue, as the machine account, in the `friction notes` comment shape of
   the `post-comment` skill. The step adds the run link, the commit the run started from and
   the date. A run with no notes posts nothing. Posting can fail without failing the run.
4. **Notes are never work.** No note becomes an issue or queued work, and the dispatcher never
   reads the tracking issue as a source of work. Changes that come out of the notes are made
   interactively by the maintainer, under the `process` freeze of ADR-0028.
5. **A human curates.** A `curate-friction` skill, run interactively by the maintainer, reads
   the notes posted since the last curation, groups them by anchor, and proposes one outcome
   per recurring anchor: fix the document the anchor names (preferred), write an entry in
   `docs/agents/crib-notes.md`, or discard. The first curation is a trial a few days into
   capture, and fixes it finds land before curation becomes a weekly task. The crib file holds
   at most 40 entries; each links the comments that reported it and carries the date it was
   last confirmed, and an entry no run has confirmed for 30 days is removed. ADRs, `CLAUDE.md`,
   the skills and the code outrank it.
6. **The read side waits.** No run reads the notes or the crib file until curation has found
   anchors that recur across runs. Adding the pointer to the crib file is then a separate
   change with its own approval.

## Consequences

- Each run spends some output tokens on its notes, and no extra paid run is added. The post is
  a shell step.
- The tracking issue notifies whoever watches it on every post. The maintainer can unsubscribe.
- The repository is public. The step passes the notes through the credential redaction the
  dispatch artifact gets, and the comment linter keeps paths and commit ids out of the visible
  part of the comment.
- Curation is maintainer time, which ADR-0029 counts as a cost. The plan's measures track it.
- A run can pad its notes the way a reviewer aimed at prose pads its findings. The cap of three
  per agent, zero as the expected answer, and the required cost limit that.

## Alternatives rejected

- **An orphan branch holding one file per run.** It is structured and reviewable as a diff,
  but it adds a push path for the machine token and a ruleset to keep the branch off `main`.
- **Notes committed inside each agent PR.** The two dispatch slots would conflict on the file,
  the reviewer would review the notes as part of the diff, and an abandoned PR would lose them.
- **The dispatch artifact alone.** It expires after 7 days.
- **An issue per note.** This is the filing loop ADR-0028 stopped.
