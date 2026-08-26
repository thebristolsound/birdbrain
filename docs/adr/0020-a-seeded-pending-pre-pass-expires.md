# A seeded pending pre-pass expires

**Status:** Accepted

**Date:** 2026-08-25

## Context

`pre-pass-gate.yml` seeds `agent/pre-pass=pending` on any PR carrying `agent-authored` or
`agent-pr`. Clearing it is the dispatch cycle's job. Two filed defects show what happens when no
cycle is coming:

- #909: PR #891, a one-line `.gitignore` diff the maintainer authored and labelled
  `agent-authored`, sat at `pending` for over 45 minutes with green CI. No dispatch cycle stood
  behind it, so nothing would ever clear the status, and nothing surfaced that fact.
- #966: PRs #958 and #961, fully green on CI with CodeRabbit success, carry seeded `pending`
  statuses that no one will resolve because the routine is paused (#960). A maintainer reading
  either merge box finds a review apparently in flight and waits for a verdict that is not
  coming. Two finished PRs look busy instead of ready.

The seeded `pending` is indistinguishable from "a pre-pass is running right now." That ambiguity
is exactly what the dispatch skill's "never leave a sha without a status" rule exists to remove,
and the seed reintroduces it whenever the seeder and the resolver are different actors.

\#909 also names the root cause: `agent-authored` does two jobs. It is the off-slot authorship
marker from #561 and the key for `ci.yml`'s draft exemption, and only PRs in a dispatch slot
have a reviewer committed to arrive. The label implies a promise its non-slot uses never made.

## Decision

### Seeding follows the commitment

Only `agent-pr` - the slot marker, which means a dispatcher has claimed the PR and owes it a
verdict - seeds `agent/pre-pass=pending`. `agent-authored` alone keeps the CI draft exemption
and gets no seeded status. This settles the options #909 left open; the maintainer ratified it
with this ADR on 2026-08-25.

### Pausing the routine resolves its pending statuses first

Whoever pauses the dispatch routine resolves every outstanding seeded `pending` status before the pause
takes effect: run the pre-pass from an environment holding the machine credential, or set a
terminal status naming the pause. A pause that strands a `pending` is the #966 trap by
construction. This obligation lands in the dispatch skill.

### A stale pending reads as absent

A seeded `pending` older than 1 hour with no claim comment on the PR means "no pre-pass ran,"
not "review in flight." Humans treat the PR as awaiting review from scratch; nothing mechanical
may treat the status as satisfied or in progress. The 1-hour figure is a parameter, ratified
down from a seeded 2 hours because the observed cases misled well inside that window (45
minutes on #891); tune it against how long a real cycle takes.

## Consequences

- The misleading merge box goes away for exactly the PRs that were misleading: human-authored
  ones (#891) stop being seeded at all, and stranded ones (#958, #961) become readable as
  unreviewed after the TTL.
- The pre-pass gate loses no coverage. Slot PRs still get seeded, still get verdicts, and the
  ADR-0014 auto-merge condition still reads the context.
- `pre-pass-gate.yml`'s seeding condition and the dispatch skill's pause obligation are code and
  doc changes, tracked by the implementation issue filed with this ADR.
- The first clause settles #909's open options; #966's two suggested resolutions remain valid
  for the stranded PRs (#958, #961) and are unaffected.

## Alternatives rejected

**A sweep owned by the dispatch routine.** The trap occurs precisely when the routine is paused
or cannot authenticate (#960), so a sweep it owns resolves nothing in the case that matters.

**Split `agent-authored` into two labels.** More precise, but the second label's only job would
be re-keying the draft exemption, and every existing consumer would need the migration. Keying
the seed on `agent-pr`, which already means exactly "a dispatcher owes this PR a verdict," gets
the same separation with zero new labels.

## Related

- #909, #966 - the filed defects this ADR settles; #960 - why no unattended recovery exists.
- #561 - the off-slot authorship marker that gave `agent-authored` its second job.
- ADR-0014 - the auto-merge condition that reads `agent/pre-pass`.
