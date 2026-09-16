# Position Birdbrain for civil-society investigations

**Status:** Accepted

**Date:** 2026-09-14

Amends [ADR-0004](0004-adopt-osint-assurance-baseline.md): Birdbrain no longer adopts the England
and Wales Forensic Science Regulator Code as a voluntary validation benchmark, and the maintained
standards register no longer includes guidance specific to policing or criminal-justice
operations. The remainder of ADR-0004's assurance baseline is unchanged.

## Context

Birdbrain is an open source investigation and capture tool for investigators, activists, and
researchers. Police-specific sample identities and criminal-justice guidance positioned the
product toward an institution outside that intended audience, even when the guidance warned that
the cited regulator excluded open source intelligence from its statutory scope.

The regulator's method-validation discipline overlaps with controls Birdbrain already derives
from broader sources in ADR-0004: predetermined requirements, representative known-answer data,
documented limitations, version-specific validation, and independent verification. Removing the
regulator-specific material therefore changes product positioning and the source register without
weakening those controls.

## Decision

Birdbrain's maintained product copy, examples, fixtures, prototypes, and public documentation use
audience-neutral or civil-society examples. They do not position Birdbrain for policing or
criminal-justice operations. Governance records may name this boundary when needed to preserve an
honest decision history; this ADR and ADR-0004's amendment record are that exception.

The Forensic Science Regulator Code and its method-validation guidance are removed from the
maintained standards register. Birdbrain retains the validation requirements already stated in
ADR-0004 and does not replace the removed source with a different institution-specific profile.
A future jurisdiction or customer profile requires its own decision and must not redefine the
project's general audience by implication.

## Evidence impact

1. **Investigation need, baseline, and threat.** Civil-society investigators need capture and
   verification claims that do not imply institutional affiliation. The governing baseline remains
   ADR-0004. The threat is misleading positioning, not a change to captured bytes.
2. **Supported claim.** The change supports only the claim that Birdbrain's general documentation
   and examples are not written for policing or criminal-justice operations. It does not prove an
   operator's identity, purpose, authority, or compliance with any standard.
3. **Evidence and custody effects.** Original, derivative, activity, actor, and custody semantics
   do not change. Existing operator fields remain optional, user-supplied text.
4. **Verification and failure behavior.** Capture, export, and standalone verification behavior do
   not change. Existing known-answer tests continue to pin those paths; this change introduces no
   new verification outcome or failure mode.
5. **Safety effects.** The audience boundary reduces the risk that product examples imply state
   authority. Existing privacy, human-rights, accessibility, and operator-safety duties remain.
6. **Formats and compatibility.** No schema, package, export, or compatibility behavior changes.
   Historical captures and packages remain byte-for-byte verifiable.
7. **Validation.** Existing unit tests verify that neutral operator identity values pass unchanged
   through settings, capture, certification, database, and export paths. Documentation checks and
   the website build validate the maintained prose surfaces.
8. **Remaining obligations.** Operators and deploying organizations remain responsible for lawful
   authority, competence, procedures, disclosure, testimony, and case-specific admissibility.

## Consequences

- Product and test examples use researcher-oriented identities without restricting what an
  operator may enter in the optional identity fields.
- The public standards page drops the England and Wales criminal-justice section and its related
  generic-claim example.
- ADR-0004 remains the historical record. Its regulator-specific benchmark is not current policy;
  this ADR controls where the two records differ.
- Maintainers must distinguish a useful general assurance source from an institution-specific
  audience signal when adding future standards guidance.
