# Agent friction notes and crib notes

**Status:** Draft; decisions taken 2026-10-10, implementation not yet approved

**Research:** [How the CodeRabbit learning feature works](../specs/2026-10-10-coderabbit-learnings-research.md)

## Goal

Every scheduled agent run leaves a short list of friction notes: what slowed it down, which
facts it had to work out again that a document could have told it, and what confused it. A
human-gated curation step turns recurring notes into crib notes, which later runs read before
they start. The point is to stop runs paying the same re-derivation cost every hour, and to
show the maintainer which document or script is costing the most.

## Constraints from existing decisions

- [ADR-0028](../adr/0028-dispatch-works-a-hand-picked-queue.md) records that agents filed 3.6
  issues per merged PR, 164 of 336 about the pipeline itself, and that the loop grew without
  bound. Friction notes are pipeline findings by definition. They must never become issues,
  never become queued work, and the dispatcher must never read them as a work source.
- [ADR-0029](../adr/0029-measure-before-expanding-agent-automation.md) defers pipeline
  machinery until measurement justifies it, and counts maintainer intervention as a cost.
  The plan therefore captures first, measures, and only then adds the read side.
- The dispatch artifact is kept 7 days (the maintainer's ruling on #1369), so the artifact
  cannot be the durable store.
- The repository is public. Notes pass through the same scrub as the dispatch report, and
  later runs trust only notes the machine account or the maintainer wrote.

## Design

Two layers, separated by a human.

1. **Friction notes (raw, write-many).** Each run ends its report with zero to three notes.
   Zero is a normal answer. Each note has these fields:
   - **Kind:** `friction`, `re-derived` or `confusing`.
   - **Anchor:** the document, script, command or workflow step it concerns, cited by stable
     anchor (`docs/README.md` rule), never a line number.
   - **What happened:** one sentence.
   - **Cost:** what the run did to recover, such as "read the whole dispatch skill" or "ran
     preflight twice".
   - **Fix:** the one-line change to the anchor that would have prevented it, or `unknown`.
   - Run identifier, head commit and date, added by the poster.
2. **Crib notes (curated, read-many).** `docs/agents/crib-notes.md` on `main`, capped at 40
   entries. Each entry states a fact or a trap in one or two sentences, links the runs that
   reported it, and carries the date it was last confirmed. An entry leaves the file when the
   document it pointed at is fixed, or when no run has confirmed it for 30 days.

Curation is where the value is. For each recurring anchor the curator picks one of three
outcomes: fix the owning document (preferred, because a re-derived fact means the document
is missing it), add or refresh a crib note, or discard.

### What this takes from CodeRabbit, and what it changes

The [research](../specs/2026-10-10-coderabbit-learnings-research.md) describes a store of
short rules that each carry provenance and pass a path and relevance filter before use. It copies
five properties:

- **Provenance.** Every crib note links the run comments that reported it, as each CodeRabbit
  entry links its source comment.
- **A rewritten rule with its reason.** A crib note is the curated fact plus why it matters,
  not the raw note text.
- **Scope by anchor.** `crib-notes.md` is grouped under one heading per area (dispatch, tests,
  docs, GitHub access), so a run reads the sections that match its work.
- **Usage tracking.** Each run lists the crib notes it relied on. That count plays the role of
  CodeRabbit's usage count and last-used date, and a note nobody uses is a pruning candidate.
- **Precedence.** ADRs, `CLAUDE.md`, the skills and the code outrank a crib note. A crib note
  that contradicts them is wrong and is removed.

It changes three things. The curated layer lives in the repository and changes only through a
reviewed pull request, where CodeRabbit keeps entries in its own database outside `git log`. A
human approves every entry, where the CodeRabbit approval delay applies an entry anyway after
its deadline. Entries expire after 30 days without confirmation, where CodeRabbit has no
expiry and relies on a manual quarterly review.

### Where raw notes live

Decided 2026-10-10: option 1. The options as ranked:

1. **Comments on one locked tracking issue (chosen).** The dispatcher posts one comment
   per cycle carrying the notes of every agent in the cycle. A new `friction notes` kind in
   the `post-comment` linter holds the shape. Locking the issue limits comments to
   collaborators, and readers filter by author. It needs no new token scope, store or branch,
   it is durable, and it adds one issue rather than one per note. The cost is notification
   noise on that issue, which the maintainer can unsubscribe from.
2. **An orphan `agent-notes` branch, one file per run.** It is structured and reviewable as a diff, but
   adds a new push path for the machine token and a ruleset to keep it off `main`.
3. **Files committed inside each agent PR.** Rejected: the two dispatch slots would conflict
   on the file, the reviewer pre-pass would review notes as diff, and notes from abandoned
   PRs would be lost.
4. **The dispatch artifact alone.** Rejected: it expires after 7 days.

### Which runs participate

Start with the scheduled runs: the dispatcher, the implementer and the reviewer it spawns,
and the scheduled PR review. Subagents return notes in their report; only the poster, which
holds the machine token, writes them. Interactive sessions do not post notes (decided
2026-10-10), so the measurement covers one population. They can join later through the same
comment shape.

### Guarding against padding

The dispatch skill already records that a reviewer aimed at prose generates findings rather
than converging. Asking every run for notes invites the same. The instruction caps notes at
three, states that zero is expected, and rejects a note without a concrete cost. The linter
enforces the cap and the fields.

## Phases

Each phase is a separate PR and a separate maintainer approval. The work carries the
`process` label and is done interactively, not dispatched.

1. **Decide.** An ADR records the two layers, the raw store, the participating runs, and that
   notes never become issues. It extends ADR-0028 and cites ADR-0029 as the restart condition
   for the read side.
2. **Capture only, two weeks.** Add the note section to the implementer handoff, the reviewer
   report, the dispatch end-of-cycle report and the scheduled PR review; add the comment kind
   and its linter fixtures; have the dispatcher post. No run reads the notes.
3. **Curation: a trial run, then weekly.** A `curate-friction` skill reads the comments since
   the last curation, groups them by anchor, and proposes outcomes for the maintainer to
   accept. The maintainer runs it interactively. The first run is a trial a few days into
   phase 2, once the issue holds notes from several cycles, to check the whole path: notes
   posted in the right shape, the skill reading them, and its proposals being usable. Fixes
   found by the trial land before the weekly schedule starts. After that, curation is a fixed
   weekly task. Output is document fixes plus `crib-notes.md`.
4. **Read side.** The implementer, reviewer and dispatch skill gain one pointer line to
   `crib-notes.md`. Proceed only if phase 3 found anchors that recur across runs.

## Measures

- Notes per run, and the share of runs that report zero.
- Recurrence: the number of distinct runs reporting each anchor before and after the anchor
  is fixed or a crib note is added. A falling count is the success signal.
- Spend per cycle before and after phase 4, from the existing cap accounting, because the crib
  file adds context to every run.
- Maintainer time spent curating, counted as intervention under ADR-0029.

## Decisions

Taken by the maintainer on 2026-10-10:

- **Raw store:** one locked GitHub issue, one comment per cycle.
- **Interactive sessions:** they do not post notes during the measurement.
- **Curation cadence:** a fixed weekly task, preceded by one trial curation early in phase 2.
