# AI analysis is an opt-in layer over a model-free base

**Status:** Accepted

**Date:** 2026-10-03

Decided by the maintainer on 2026-10-03 in a design session on the Case investigation view. Nothing
is built. The engine design it amends is in pull request #1714.

## Context

The Case investigation engine design (#1714) recommends "a local analysis model for the built-in
experience": a model proposes claims, Joints, and search terms on every run. Its review asked
whether the first slice needs a model at all.

Some Joints need one. A pseudonym who tells the same story to two outlets, paraphrased and broken
up, shares no identifier and no verbatim text across the two Exhibits; only a comparison of what the
two narratives say finds the link. Other Joints need none: a shared address, username, domain, link
target, or mail header is found by fielded search over stored representations, and each side
resolves to an exact span at its Content Hash.

Birdbrain's readers include people documenting things that people with power would rather were not
documented ([ADR-0029](0029-position-birdbrain-for-civil-society-investigations.md)). Some will want no model near a Case. A hosted
model, such as TypeSafe's Jev, which this repository already uses on its own issues and pull
requests ([ADR-0031](0031-shadow-lenses-observe-before-they-gate.md)), sends text off the machine; its documentation also says adversarial text in
its input can steer it, and Case text is written by the people under investigation.

## Decision

**The base layer uses no model.** It finds Subjects and proposes Joints from what fielded and exact
search can establish, with an exact stored span on each side. The investigation view is complete
with AI off. Where a kind of Joint needs the AI layer, such as a paraphrased narrative match, the
view says so, so "no Joints found" never reads as "no connection".

**AI analysis is a separate layer the Operator turns on.** It is enabled first for the installation,
in Settings; then for each Case, provider by provider. A local model and a hosted provider are
separate choices with separate disclosures. A hosted provider's disclosure names the provider, the
text it receives, and the Egress the request uses ([ADR-0032](0032-route-app-egress-but-do-not-disguise-the-browser.md)). Nothing is on by default.

**The AI layer only proposes.** Its Joints, its surfaced support and conflicts, and its Source Class
suggestions arrive unreviewed, go through the same accept, reject, add, and dismiss steps as the
base layer's, and record which layer and provider proposed them. Every span it cites is checked
against stored bytes before display.

**No fallback crosses the boundary.** A failed local model never hands its work to a hosted one,
and a provider off for a Case is never called for that Case.

## Considered options

- **A local model in the built-in experience, as #1714 recommends.** Covers paraphrase from the
  first run, but makes model packaging, platform support, and evaluation a prerequisite of the
  whole view, and puts a model near every Case whether the Operator wants one or not.
- **One AI switch per Case.** Simpler, but a local model and a hosted provider would share one
  consent, and the hosted one sends Case text off the machine.
- **Per Case and per provider, with no installation gate.** Every Case would show AI controls to
  investigators who never want them.

## Consequences

- The first slice of the investigation view needs no model, which closes that question in the
  review of #1714 and makes the retrieval pipeline's model-free first slice the foundation.
- Paraphrase-based Joints, the fast screening stage, and fact-by-fact span pairs ship only with the
  AI layer. An Operator with AI off finds a pseudonym link only through a shared identifier or
  verbatim text.
- Each provider needs its own evaluation on the synthetic Case before it is offered, including
  paraphrased retellings, a decoy story, and a passage written to mislead the model. Jev is offered
  only if it passes.
- Exports can say which Joints a model proposed, because every proposal records its layer and
  provider and every acceptance records the Operator.
- In a Shared Case a proposal stays with the member whose analysis made it, so a member never sees
  proposals from a provider their installation did not enable until another member has accepted
  them.
- #1714 must drop its built-in-model recommendation and cite this record.
