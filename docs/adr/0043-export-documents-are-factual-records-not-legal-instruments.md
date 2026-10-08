# Export documents are factual records, not legal instruments

**Status:** Accepted

**Date:** 2026-10-06

Amends [ADR-0010](0010-evidence-package-vs-working-copy.md): the Certification is no longer
the cover sheet extended with signature rules. It is an operator statement with no signature
line. Supersedes the goal of a template for a person to sign in
`docs/agents/osint-investigation-standards.md`, which now describes a factual export statement
instead.

## Context

Until this decision, `certification.html` was titled Certificate of authenticity, said it was
offered under Federal Rule of Evidence 902(13) and 902(14) or the equivalent rule of the forum,
and printed a dashed box asking counsel to supply the legal wording. Both it and `report.html`
ended with a signature and date line. Issue #848 tracked the placeholder as blocked on counsel.

That framing had three problems. A sworn declaration under 28 USC 1746 or a Rule 902(13)
certification is a statement by a qualified person about their own knowledge of a process, so
software cannot supply it and counsel drafts it per case regardless of what the page prints.
Citing a United States rule by number on every export cut against the civil-society audience
in [ADR-0029](0029-position-birdbrain-for-civil-society-investigations.md) and was wrong for
every non-US reader. And a document headed "certificate" that visibly waits for its legal
wording lowered a reader's trust in the whole package.

Hunchly, the closest comparable tool, ships MHTML captures, SHA-256 hashes, a per-file GPG
signature and the public key. Its reports are listings of pages and notes. No exported document
carries a certificate, an affidavit template, or admissibility wording. Its Evidence Guide
explains each mechanism and the ways it can be challenged, and says the investigator may be
called as a fact witness.

## Decision

Both documents in an Evidence Package are factual records of the package. `certification.html`
is headed Export statement. It records the tool and version, the capture and hashing process,
the trusted-time and entry-signature results, the signing key, and the operator's self-asserted
identity, and says in one sentence that it is a factual record and not a legal declaration.
`report.html` keeps its first-person operator statement and drops the sworn-declaration notice
and the signature block. Neither document cites an evidence rule, prints a signature line, or
reserves space for legal wording.

Any certification, declaration or affidavit a forum requires is drafted outside Birdbrain by
the person who will sign it, using these documents and `VERIFY.md` as the facts it cites.

The shared stylesheet is plain: normal-case labels, hairline rules, ordinary heading sizes, and
text sections that flow across pages. The package file name `certification.html` and the
glossary term Certification are unchanged, because renaming them would change the package
layout that historical packages and the verifier depend on.

## Evidence impact

1. **Investigation need, baseline, and threat.** Operators need export documents a reader
   trusts at first sight. The governing baseline remains
   [ADR-0004](0004-adopt-osint-assurance-baseline.md). The threat is misleading framing, not a
   change to captured bytes.
2. **Supported claim.** The change supports only the claim that the export documents describe
   the package accurately. It removes an implied claim that the package satisfies any
   evidence rule.
3. **Evidence and custody effects.** Original, derivative, activity, actor, and custody
   semantics do not change. The operator identity fields remain optional, self-asserted text.
4. **Verification and failure behavior.** Capture, export, and standalone verification
   behavior do not change. The two documents remain covered by the unsigned index only, as
   before. A test asserts the placeholder, the rule citation, the old title, and the signature
   grid are absent from a generated package.
5. **Safety effects.** Removing the rule citation reduces the risk that an operator presents a
   package as satisfying a rule it does not address. Existing privacy and operator-safety duties
   remain.
6. **Formats and compatibility.** No schema, package layout, or manifest behavior changes. The
   pre-scope fixture package keeps its original documents and still verifies.
7. **Validation.** The certification, export, report-invariant and package-verification test
   files pass, and the full preflight is green at the change's head.
8. **Remaining obligations.** Operators and deploying organizations remain responsible for
   any certification, notice procedure, testimony and case-specific admissibility.

## Consequences

- Issue #848 closes without legal wording. The export path has no counsel dependency.
- `docs/agents/osint-investigation-standards.md` describes a factual export statement rather
  than a certification template for a person to sign. ADR-0010 remains the historical record of the
  "cover sheet with signature rules" design; this ADR controls where the two differ.
- A future request for a document a person signs, or one written for a specific rule, is a new
  decision, and should
  start from the question of who signs it and in which forum, not from the export code.
- The Court exhibit preset name in the export dialog is outside this decision and remains
  as ADR-0010 describes it.
