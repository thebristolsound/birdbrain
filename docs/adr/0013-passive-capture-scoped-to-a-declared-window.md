# Passive capture scoped to a declared window

**Amended 2026-10-02 by
[ADR-0037](0037-passive-capture-returns-in-the-launched-browser.md):** the Capture Scope is a
browser Birdbrain launched, not a window in the Operator's everyday browser, and the boundary is
one the engine enforces rather than an attested declaration. `launched` and `launched-passive`
replace `extension-manual` and `extension-passive` below; `background` stays. The reasons for a
scope and the freeze-fix prerequisite stand.

**Status:** Accepted

**Date:** 2026-08-19

**Supersedes nothing. Records a decision taken 2026-08-05** in a `/grilling` +
`/domain-modeling` session, published as an amendment comment on
[#284](https://github.com/thebristolsound/birdbrain/issues/284) and left unwritten until
[#571](https://github.com/thebristolsound/birdbrain/issues/571) surfaced the gap. The
amendment claimed this content as "ADR-0006"; that number was taken on 2026-08-10 by
[Claim the dispatch slot at dispatch time](0006-claim-the-dispatch-slot-at-dispatch-time.md),
so the decision lands here instead.

## Context

Passive capture — capturing every page an operator browses, without a per-page click — is the
behaviour that distinguishes an investigation capture tool from a screenshot utility. Birdbrain
shipped it, then removed it: [PR #211](https://github.com/thebristolsound/birdbrain/pull/211)
(2026-07-23) commented out both auto-capture paths in `extension/src/background.ts` behind
`HOTFIX:` markers, as a "temporary" measure to be reverted "once the underlying issue is
resolved."

The underlying issue was a concern that the ignore list was not being honoured. It mostly was:
`shouldCapture` consulted both the default and user lists. The defect is the **default**.
`DEFAULT_IGNORE` covers only `chrome://`, `about:`, `data:`, `file:` and localhost — **no https
origin is excluded**. An operator who opened their bank, their webmail or a client's ticketing
system while a session ran captured it into the case. That is a default to invert, not a bug to
patch.

Every mechanism for bounding what gets captured was considered against one criterion: does the
failure mode lose evidence silently, or does it over-collect visibly? Both are bad; only the
first is invisible to the operator at the time.

## Decision

**Capture Scope is a designated browser window.** Passive capture returns under an opt-in scope
rather than the opt-out blacklist it had.

Rejected alternatives:

- **A tab.** Too small. Following a link that opens a new tab drops the operator out of scope
  with nothing captured and no signal — the same silent-loss failure as the blacklist, inverted.
- **A domain allowlist.** Cannot be authored before the investigation finds the domains. An
  OSINT trail's value is in where it leads, which is exactly what an allowlist cannot anticipate.

Three consequences are part of the same decision.

**The extension enforces; the Manifest records.** Only the extension has `windowId`. The capture
server knows nothing about browser windows, so the recorded scope is an **attested Operator
declaration, not a verified boundary** — and must be labelled that way everywhere it is
reported, including `VERIFY.md`. Birdbrain must not claim to have proven a boundary it can only
repeat.

**The main-process freeze fix is a prerequisite, not a follow-up.** Extraction runs
synchronously in `captureLifecycle.ts`. Manual capture pays that cost once per click; passive
capture pays it once per page browsed. Passive capture cannot ship on top of it.

**Capture Method splits three ways** — `extension-manual`, `extension-passive`, `background`.
`CONTEXT.md:60` currently glosses `extension` as "operator-witnessed"; that becomes false the
moment a capture happens without a click, and a domain term that is false about a third of its
instances is worse than no term.

## Consequences

- Round 1 ships **manual capture only**. The controls that offered the old behaviour were
  removed in [#570](https://github.com/thebristolsound/birdbrain/issues/570) rather than left
  inert, and the `HOTFIX:` blocks stay commented until the restoration lands.
- The evidence surface grows a claim it must not overstate: a package whose captures were taken
  passively is asserting where the operator declared they were looking, not where they were.
- `CONTEXT.md` and the Capture Method values change together with the restoration, not before —
  a three-way enum with only two reachable values is its own kind of false statement.
- The ignore-list default inversion stands on its own merits and can land before any of this:
  it makes manual capture safer too.
