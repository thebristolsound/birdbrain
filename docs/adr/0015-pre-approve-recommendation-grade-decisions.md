# Pre-approve recommendation-grade decisions in interactive sessions

**Status:** Accepted

**Date:** 2026-08-25

## Context

Interactive sessions stop for maintainer input at decision points the global instructions mark as
the user's: option picks with a recommended choice, clarifying questions, placement, and naming
calls. The maintainer's recorded answer is "approved," "agreed," or "use recommended" in the large
majority of cases.

The reason is structural rather than accidental. The maintainer's pick criterion is whichever
option is most consistently in line with software engineering best practices; the agent's
recommendation is derived from repo conventions and those same practices. When both sides compute
the same function, the round trip transmits no information. It only costs latency, and it costs it
at exactly the moment the agent holds the most context.

No transcript measurement of the approval rate exists. The class list below is seeded from the
maintainer's own report, and the decision log this ADR mandates is the instrument that produces
the numbers for tuning it. That is the move ADR-0011 made: replace an unmeasured gate with a rule
that generates its own evidence.

The global instructions push the other way ("Ask 3-5 clarifying questions when requirements are
ambiguous"; "When presenting options, rank them holistically and recommend one," which invites the
pick-and-wait loop). This ADR is a project-local override of those rules, in the same way the
background-jobs carve-out in CLAUDE.md overrides the wait-for-confirmation rules for unattended
jobs.

## Decision

In interactive sessions in this repository, when a decision falls in a pre-approved class and the
agent's recommended option is groundable, the agent takes the recommendation without asking and
logs it.

### Grounding is the discriminator

A recommendation is groundable when the agent can cite the thing that decides it: a repo doc
(CLAUDE.md, CONTEXT.md, `docs/agents/`), a prior ADR, an existing pattern in the code the change
sits next to, a hard rule in the global instructions, or the toolchain (a lint rule, formatter, or
type error settles it). A recommendation that rests on taste, or that the agent would hedge, is
not groundable and still asks. This is the condition the maintainer actually named: the
recommendation wins because it tracks best practices, so a recommendation that cannot point at the
practice it tracks has no claim to the standing approval.

### Pre-approved classes (seed list)

1. **Naming.** Files, symbols, branch names, commit scopes, issue and PR titles, and label choice
   per `docs/agents/triage-labels.md`.
2. **Placement.** Which directory, module, or doc path a thing goes in, per the documented layout.
3. **Pattern-following implementation choices.** When one candidate approach matches an existing
   repo pattern and the alternatives would introduce a new one, take the existing pattern.
4. **Test shape.** Which Vitest project a test belongs to, and structure and fixtures within the
   existing harness.
5. **API usage within installed dependencies.** Which function or option of an already-installed
   library to use.
6. **Mechanical sequencing.** Order of refactor steps, how to split commits, and orderings that do
   not change the end state.
7. **Toolchain-settled style.** Anything Prettier, ESLint, or Vale already answers.

### The must-ask complement

Unchanged and explicit. The agent still asks for: new dependencies; destructive or hard-to-reverse
actions; anything that spends money or publishes externally; scope expansion beyond the request;
decisions touching the blocking tier of the evidence-path list; product or UX decisions with no
repo precedent; any decision where two documented rules conflict; and any recommendation the agent
cannot ground.

### The decision log is the instrument

Every auto-taken decision appears in the end-of-turn summary as one line under "Decisions taken":
the decision, the pick, and the grounding. A maintainer veto of a logged decision amends this ADR,
either removing the class or adding a constraint to it. Approval moves from before the decision to
after it, as a reviewable log line with a bounded undo cost.

## Consequences

- The round trips this ADR removes are the ones that transmit no information. The ones that do
  transmit information are the complement, and they are untouched.
- A wrong auto-take costs an edit, because every class on the seed list is reversible by
  construction; the irreversible decisions all sit in the complement.
- The class list is expected to change. It was seeded, not measured, and the log exists to measure
  it.
- The unattended-agent machinery (ADR-0005, ADR-0006, ADR-0014) is untouched. Background jobs
  already have their own carve-out; this ADR is that carve-out's interactive-session sibling.
- The operative text lives in the CLAUDE.md section "Interactive sessions: standing approvals";
  this ADR is the rationale and the amendment target. An ADR nothing loads changes no behavior.

## Alternatives rejected

**Blanket "never ask."** Removes the ask exactly where it pays: dependencies, destructive actions,
taste. The complement is the point of the design, not an exception to it.

**Keep asking but batch the questions.** The cost is the round trip itself, not the question
count. Batching reduces interruptions and keeps the latency.

**Encode it globally instead of per-repo.** The classes cite this repo's docs and patterns. In a
repo without documented conventions the grounding test has nothing to bind to, and the rule would
degrade into taste-approval, which is the thing it exists to exclude.

## Related

- ADR-0016 - convention-shaped plans proceed without waiting for approval; its criterion 5 chains
  to this class list.
- ADR-0017 - a green verify block at head replaces completion confirmation.
- ADR-0011 - the believability streak; the seeded-rule-plus-instrument pattern this ADR reuses.
