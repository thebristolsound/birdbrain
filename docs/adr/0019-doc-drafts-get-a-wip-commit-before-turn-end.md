# Doc drafts get a WIP commit before the turn ends

**Status:** Accepted

**Date:** 2026-08-25

## Context

On 2026-08-25 the agent worktrees were purged. Thirteen files survived only by hand rescue into
`~/birdbrain-purge-2026-08-25/rescued-docs/`: seven PR-body scratch files, two Maltego research
documents (2026-08-12 and 2026-08-18) that remain uncommitted today, a beta gate note, and a
wayfinder next-steps note. The research documents were the second time the same loss pattern
needed a rescue, so the exposure is routine, not a freak event.

The git mechanics make the fix nearly free. Worktrees share the repository's object store and
refs with the main checkout, so a commit on any branch survives worktree removal even when it
was never pushed. Untracked files do not; they live only in the worktree directory and die with
it. The entire difference between "rescued by hand from a purge directory" and "safe" is one
`git commit` on a scratch branch.

The global instructions say to commit only when the user asks. That rule is why the drafts sat
untracked: each session did the polite thing and left ratification to the maintainer, and the
purge did not wait. This ADR is a standing authorization in the same family as ADR-0015 through
0017: it pre-approves a narrow commit the maintainer would always say yes to.

## Decision

A session that creates or edits a file whose destination is a tracked path - `docs/**`,
`CLAUDE.md`, `CONTEXT.md`, `website/content/**`, `.vale/**` - commits it before the turn ends.

- If the checked-out branch belongs to the session's own effort, commit there.
- If the branch belongs to another effort, or the work is a draft awaiting ratification, commit
  on a scratch branch cut from `main`, named `drafts/YYYY-MM-DD-<slug>`, and say so in the
  report. The WIP commit is preservation, not ratification: the maintainer still reviews,
  amends, and lands the real commit.
- Pushing is not required. The object store makes a local commit purge-proof; pushing remains a
  separate, asked-for act.
- Ephemeral scratch files that are not destined for a tracked path (PR-body working files,
  temporary notes) are out of scope. Their content ships inside the PR or the report; the file
  itself is disposable.

## Consequences

- The uncommitted-drafts exposure closes for the file classes that have actually been lost.
  Nothing in this ADR would have saved the PR-body scratch files, deliberately: their loss cost
  nothing, since the bodies live on the PRs.
- `drafts/` branches accumulate and need occasional deletion. A stale drafts branch is clutter;
  a purged untracked doc is gone. The trade is accepted.
- The standing authorization is narrow: tracked-path docs only, WIP commits only, no pushes. The
  global commit-when-asked rule is otherwise untouched.

## Related

- ADR-0015 - the standing-approval pattern this extends.
- The 2026-08-25 purge rescue directory, `~/birdbrain-purge-2026-08-25/rescued-docs/` - the
  measured loss this ADR is sized against.
