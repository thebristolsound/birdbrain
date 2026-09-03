# Unattended agents may modify the evidence path, with gates

**Status:** Accepted

**Date:** 2026-07-31

**Amended 2026-08-23 by [ADR-0014](0014-tier-the-evidence-backstop-and-widen-the-dispatch-slot.md):**
the backstop list is tiered (blocking or advisory), the strict-serial slot widens from one cycle to
three, and non-evidence agent PRs may auto-merge on green plus a pre-pass success. The evidence-
affecting PR gate and the never-auto-merge rule for evidence-affecting PRs are unchanged.

**Amended 2026-09-01 by [ADR-0025](0025-the-evidence-label-serves-two-purposes.md):** the label
serves two named purposes, merge routing and claim discipline. An approved agent PR is marked
ready for review, evidence-affecting or not; the human back gate is unchanged.

Birdbrain is adopting an autonomous agent pipeline: unattended agents work `ready-for-agent`
issues end-to-end and open draft PRs, eventually dispatched on a schedule
([#298](https://github.com/thebristolsound/birdbrain/issues/298)). The obvious reflex for an
evidence tool is to fence the evidence path off from that pipeline. This ADR records the
opposite decision, and the gates that make it defensible.

An **Evidence-Affecting Change** is defined in `CONTEXT.md`; the per-change obligations it
carries are set by [ADR-0004](0004-adopt-osint-assurance-baseline.md). Nothing here weakens
either — this ADR decides *who* may produce such a change, not what it owes.

## Decision

Unattended agents MAY work evidence-affecting issues. Trust is placed in layered gates, not in
keeping agents away from the code that matters most.

### Front gate — triage

An agent only picks up issues labelled `ready-for-agent`, and that label is only applied when
the issue clears the four-point bar in `docs/agents/triage-labels.md` (acceptance criteria,
named verification path, starting files, evidence-affecting call made). The
`evidence-affecting` call is a human triage decision, recorded as a label on the issue before
any agent starts.

### Trigger — label plus mechanical backstop

The `evidence-affecting` label is the gate's primary trigger. The agent opening a PR for a
labelled issue copies the label onto the PR, so the PR itself declares its gate status.
Because triage judgment is fallible, a maintained path list is checked against every agent
PR's diff as a mechanical backstop: a touched path on the list on a PR that carries no
`evidence-affecting` label (and whose linked issue carries none) is a blocking review finding.
Until the maintained list is confirmed, the drafted assessment
(`docs/specs/2026-07-31-evidence-affecting-paths-assessment.md`, PR #315) serves as the list.
*Amended by [ADR-0014](0014-tier-the-evidence-backstop-and-widen-the-dispatch-slot.md): that list is
now tiered. A blocking-tier hit is a blocking finding as written here; an advisory-tier hit is a
one-line reviewer disposition owing no Evidence impact section.*

### PR gate — evidence impact and known-answer tests

An evidence-affecting PR must carry:

1. An **Evidence impact** section stating what evidentiary result or interpretation could
   change, and what verification proves and does not prove after the change (per ADR-0004).
2. A known-answer test extended for the affected method, or an explicit justification in that
   section for why none applies.
3. Preserved backward verification: existing evidence packages — and, once published,
   historical Evidence Profile versions — must still verify.

The reviewer agent (`.claude/agents/birdbrain-reviewer.md`, PR #317) verifies all three plus
the backstop before any human sees the PR.

### Back gate — human review

Every agent PR gets human review through the pilot; no agent PR auto-merges. Whether
non-evidence agent PRs may ever auto-merge is deferred until post-pilot review-burden data
exists. *Answered by [ADR-0014](0014-tier-the-evidence-backstop-and-widen-the-dispatch-slot.md)
on 2026-08-23: they may, on all required checks green plus an `agent/pre-pass` success verdict.* **Evidence-affecting PRs never auto-merge, regardless of that future decision.**

### Flow control and the give-up path

- **Strict serial:** at most one open agent PR at a time; the dispatch routine exits without
  dispatching while one is open. *Amended by
  [ADR-0014](0014-tier-the-evidence-backstop-and-widen-the-dispatch-slot.md): the limit is three
  concurrent cycles, and every agent branch is cut from `main` rather than from another cycle's
  branch.* *Amended by [ADR-0006](0006-claim-the-dispatch-slot-at-dispatch-time.md):
  the slot is claimed at dispatch time, before the PR exists.* The record a human merge must
  leave when the final automated verdict is unresolved is set by
  [ADR-0007](0007-merging-over-an-unresolved-verdict-requires-a-recorded-override.md).
  *Amended by [ADR-0012](0012-doc-curation-as-a-two-model-pre-gated-job.md): doc-curator
  PRs (`docs/curate-*`, off the evidence path) do not occupy the slot.*
- **Give-up path:** an agent that finds an issue mis-specified — at intake or mid-work —
  comments its findings on the issue, relabels it `needs-info` or `ready-for-human`, and
  vacates the slot. Giving up is a success mode; pushing through a bad specification is not.

## Consequences

- The highest-value backlog (capture, integrity, verification, export) is agent-workable
  instead of permanently manual; the cost is gate overhead on every evidence-affecting PR.
- Triage becomes load-bearing: the evidence-affecting call and the ready-for-agent bar are now
  the front line of evidentiary integrity, which is why both are written down as checklists
  rather than left to judgment in the moment.
- The path list must be maintained. A stale list silently narrows the backstop; the reviewer
  treats the list itself as evidence-affecting surface.
- Human review remains a hard dependency through the pilot, so pipeline throughput is bounded
  by review capacity — accepted while trust is being established.

## Alternatives rejected

**Fence agents off the evidence path.** Creates a two-tier codebase where the work that most
needs consistent, documented rigor stays manual, and the fence itself needs the same path list
this decision needs anyway — with none of the gates. The boundary would also erode: most
meaningful birdbrain changes touch an evidence surface eventually.

**Unrestricted autonomy.** Agent throughput without gates converts triage mistakes and
plausible-but-wrong changes directly into evidentiary risk. ADR-0004's obligations assume a
deliberate checkpoint per evidence-affecting change; removing the checkpoint would make those
obligations aspirational.

**Gate on reviewer judgment alone, no path list.** "Looks harmless" is exactly the judgment
that fails under review pressure; the mechanical backstop exists because a list is checkable
when attention is not.
