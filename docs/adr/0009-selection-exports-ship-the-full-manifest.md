# Selection-scoped exports ship the full Manifest

A selection-scoped Evidence Package (exporting a subset of a Case's Captures) always contains the **complete Manifest chain**, identical to a case-scoped export. Selection is expressed in the `export` Manifest Entry — `scope: 'case' | 'selection'` plus a `captureIds` list — never by truncating the chain. This rejects the design-handoff prototype's "Ledger slice" (shipping only the entries "covering the selection"); that constraint goes back to design per the handoff's own review contract.

**Why a slice cannot work as designed:** each Manifest Entry's Entry Hash covers its predecessor's, so chain verification is a walk from genesis. Package Verification treats the signed Manifest as the sole source of truth; hand it a slice and it can prove internal consistency of the excerpt but not that the excerpt is the chain — omitted entries (including deletions) become undetectable. Making a slice verifiable would require continuity-proof semantics in the Evidence Profile (a new verification mode, new failure states, and verifier changes) for no gain in evidentiary strength over shipping the whole file, which is small (JSONL, one line per lifecycle event).

**The cost accepted:** a selection export discloses case-wide activity metadata. The Manifest reveals how many Captures the Case holds, their ingestion times, and any deletions — even when the operator selected only a few Captures to share. That is a deliberate trade: the Manifest's completeness *is* its forensic value (a package that hides deletions is worth less, not more, to the receiving side). Report/certification copy should state plainly that the Manifest covers the whole Case while the exported artifacts cover the selection, so the mismatch reads as designed behaviour, not an error. Operators for whom the metadata disclosure is unacceptable have the Working Copy export class, which makes no evidentiary claims.

**Consequences:**

- The export pipeline writes the full `manifest.jsonl` regardless of scope; only artifact selection varies.
- The `export` Manifest Entry schema gains `scope` and (for selections) `captureIds`. Entry-hash canonicalisation must account for the new fields; this is an Evidence-Affecting Change under ADR-0004.
- Package Verification is untouched: one chain, one walk, existing semantics. Backward verification of pre-`scope` packages continues to hold.
- The unsigned index/report must reconcile against the selection (`captureIds`), not the full Manifest, when checking that every exported artifact is accounted for.
