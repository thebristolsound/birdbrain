# Adopt a standards-based OSINT assurance baseline

**Status:** Accepted

**Date:** 2026-07-25

**Amended 2026-09-14 by
[ADR-0029](0029-position-birdbrain-for-civil-society-investigations.md):** the Forensic Science
Regulator Code is no longer a voluntary Birdbrain benchmark, and the maintained standards
register no longer includes guidance specific to policing or criminal-justice operations.

Birdbrain adopts the standards register in
[`docs/agents/osint-investigation-standards.md`](../agents/osint-investigation-standards.md)
as the engineering baseline for evidence-affecting architecture, implementation, validation,
release, and product-claim decisions.

No universal "OSINT-compliant" software standard exists. A defensible investigation workflow
combines several independent assurance layers: lawful and ethical methodology, validated
acquisition, digital-evidence preservation, reproducible analysis, provenance, cryptography,
secure development, privacy and human-rights safeguards, accessible reporting, and
jurisdiction-specific procedure. Conformance in one layer must not be presented as conformance
in another.

## Decision

### Source hierarchy

Birdbrain uses this order of authority:

1. Applicable law, court rules, regulators, and contractual requirements.
2. Formal consensus standards such as ISO, NIST, IETF, W3C, and ETSI publications.
3. Official forensic and investigative practice guides such as the Berkeley Protocol and SWGDE
   publications.
4. Interoperability profiles such as WACZ, CASE/UCO, PREMIS, PROV, C2PA, and STIX.
5. Birdbrain's published evidence profile, method specification, validation reports, and
   conformance statements.

The standards register classifies sources as project baselines, optional interoperability
profiles, or jurisdiction-specific requirements. A source becoming a project baseline is a
Birdbrain engineering decision; it does not make that source binding law for every operator.
When a law or customer requirement conflicts with the project baseline, the applicable
jurisdiction profile takes precedence and the deviation must be documented.

### Evidence model

Architectural decisions must preserve these distinctions:

- A captured original is immutable and content-addressed.
- Extracted text, OCR, screenshots derived after capture, annotations, redactions, translations,
  summaries, reports, and AI output are derivatives.
- Every derivative records its source objects, operation, tool and version, parameters, actor,
  time, result, and output hash.
- An investigative assertion is not evidence. It cites exact evidence or derivative objects,
  identifies the responsible analyst, and records source quality, assumptions, confidence,
  corroboration, contradictions, and alternatives.
- Verification success establishes only the property actually tested. Hash equality, signature
  continuity, trusted time, signer identity, source attribution, completeness, and truth are
  separate claims.

Corrections create new objects or events. They never rewrite an original or historical custody
event.

### Acquisition and preservation

The capture method must record enough observation context for a skeptical third party to
understand what Birdbrain attempted, what it received, what it rendered, what it omitted, and
which limitations applied. Failed and partial captures are evidence-bearing events and must not
be silently discarded.

MHTML, screenshots, extracted text, and future WARC records are complementary representations.
MHTML preserves a browser-oriented representation but is not a complete HTTP transaction
record. Birdbrain will pursue WARC/WACZ interoperability without rewriting historical captures
or treating one representation as universally authoritative.

### Public evidence protocol

Birdbrain must publish a versioned Evidence Profile before making general forensic-assurance
claims. The profile must define:

- object and event schemas and semantics;
- package layout, stable identifiers, path and media-type rules;
- canonical byte representation, hashing, signatures, keys, and trusted-time policy;
- verification statuses and failure reasons;
- compatibility, migration, and algorithm-transition rules; and
- machine-readable schemas plus cross-implementation test vectors.

The current JCS-shaped canonical JSON implementation must either be specified as a distinct,
constrained Birdbrain profile or replaced in a new manifest version by exact RFC 8785 behavior.
Historical manifests must remain verifiable and must not be rewritten.

### Validation and independent verification

Ordinary unit and end-to-end tests are necessary but are not forensic method validation.
Every evidence-affecting release requires a version-specific validation record against
predetermined requirements and representative known-answer data. Material changes to the app,
extension, browser, operating system, firmware, cryptography, dependencies, packaging, or
configuration trigger impact assessment and revalidation of affected behavior.

Validation reports must include environments, expected results, observed results, deviations,
false positives and negatives, known limitations, and the acceptance decision. Verification
must also be exercised through an implementation path independent of capture and export code.

### Security, privacy, and external processing

Captured content is hostile input. It must not gain privileged Electron, filesystem, IPC, shell,
or live-network capabilities merely because it is being inspected as evidence. Offline,
sandboxed replay is the default.

Local-first storage reduces third-party exposure but does not by itself provide encryption,
authorization, lawful processing, retention control, or safe disclosure. Birdbrain must support
least privilege, retention and legal holds, encrypted storage and backup, disclosure auditing,
and irreversible redaction through separately derived artifacts.

Sending case material to OpenRouter or another external processor is a separate disclosure. It
requires explicit selection and authorization, provider and region disclosure, data
minimization, and recorded lineage. AI output remains derived analysis and cannot become a
report finding without a recorded human review.

### Claims and jurisdiction profiles

<!-- vale Birdbrain.Assurance = NO -->
Birdbrain must not make generic claims such as "court-admissible," "court-ready,"
"forensic-grade," "tamper-proof," "authentic," or "compliant." A conformance claim must name
<!-- vale Birdbrain.Assurance = YES -->
the product and evidence-profile versions, intended use, applicable standard or law, validation
report, supported environment, exceptions, and limitations.

US evidentiary authentication still requires a qualified person's defensible certification and
applicable notice procedure. The England and Wales Forensic Science Regulator Code expressly
excludes Internet Intelligence and OSINT; Birdbrain may adopt its validation discipline as a
voluntary benchmark but must not claim FSR compliance. An RFC 3161 token is not automatically an
eIDAS-qualified timestamp. ISO/IEC 17025 accredits competent laboratories and methods, not a
downloadable software product.

Birdbrain enables a defensible workflow. The operator and deploying organization remain
responsible for legal authority, competence, standard operating procedures, disclosure,
testimony, and case-specific admissibility decisions.

## Architecture decision gate

Every future evidence-affecting ADR must identify:

1. the investigation need, governing baseline, and threat;
2. the exact claim the feature supports and what it does not prove;
3. original, derivative, activity, actor, and custody effects;
4. independent verification and failure behavior;
5. privacy, human-rights, accessibility, and operator-safety effects;
6. format, export, and backward-compatibility effects;
7. known-answer validation for the exact supported versions; and
8. remaining operator, organizational, and jurisdiction-specific obligations.

An **evidence-affecting change** includes any change to acquisition, parsing, extraction,
storage, hashing, signing, trusted time, manifests, verification, redaction, export, reporting,
AI analysis, or software distribution that can alter an evidentiary result or the interpretation
of one.

## Consequences

- Standards conformance and known limitations become product requirements, not marketing copy.
- Evidence-affecting releases carry more documentation and validation cost.
- Capture, analysis, and reporting need explicit domain boundaries and provenance relationships.
- Release artifacts must eventually include signed packages, an SBOM, build provenance, the
  Evidence Profile version, and the applicable validation report.
- Jurisdiction support is implemented as maintained profiles, not universal behavior or claims.
- The standards register is reviewed at least quarterly and before every Evidence Profile
  release. Superseded sources are recorded rather than silently replaced.

Birdbrain's existing local-first storage, SHA-256 hashes, hash-chained Manifest, signatures,
timestamps, and evidence packages are a credible foundation. They do not by themselves satisfy
this decision. The principal remaining assurance work is a public Evidence Profile,
release-specific validation, independent verification, structured analytic reporting,
WARC/WACZ interoperability, privacy controls, and jurisdiction profiles.

## Alternatives rejected

**Treat cryptographic integrity as sufficient.** Hashes and signatures can detect defined
changes, but they do not establish capture completeness, source identity, truth, lawful
collection, sound analysis, or admissibility.

**Adopt one jurisdiction or certification as universal.** Evidentiary rules and privacy duties
are deployment-specific, while several relevant accreditation schemes apply to organizations or
laboratories rather than products.

**Model the architecture after a competitor's feature claims.** Product comparison can reveal
workflow gaps, but it is not an assurance source. Birdbrain's claims must be grounded in
published methods, specifications, validation evidence, and bounded legal analysis.

**Embed every external ontology in the internal schema.** WACZ, PREMIS, PROV, CASE/UCO, C2PA,
and STIX serve different interchange purposes. Birdbrain will use explicit adapters instead of
coupling its transactional domain model to all of them.
