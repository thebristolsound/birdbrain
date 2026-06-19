# Court-Admissibility Initiative — Assessment & Resolution Path

- **Date:** 2026-06-14
- **Type:** Assessment
- **Scope:** Full-arc review of the court-admissibility initiative (issues #112–#125 plus follow-ups #143, #145) — audit of what has shipped, and a sequenced path to close the remaining open work.
- **Status:** Current. Supersedes nothing; complements `docs/reference/threat-model.md` and `docs/specs/2026-06-01-standalone-verifier-design.md`.

---

## 1. Executive summary

The initiative is a coherent, mostly-delivered program structured around two **orthogonal evidentiary axes** and a definition of done framed by **FRE 902(13)/(14)** self-authentication:

- **Integrity axis** — content SHA-256 + hash-chained, per-entry RSA-signed manifest (tamper-evidence).
- **Trusted-time axis** — RFC 3161 timestamp tokens from a public TSA (independent "existed no later than T").

**The spine is shipped and well-tested.** Manifest schema v2 + grandfathering (#115), operator identity (#116), RSA-2048 chain signing (#117), RFC 3161 + the `trustedTime` derivation (#120), and the self-contained evidence package (#121) are all merged, and the verify logic has already been extracted into a process-agnostic core in `src/shared/verify/` (#122 PR1). The trustedTime derivation matches the intended model precisely and the signing path is genuinely `openssl`-verifiable.

**The single most important gap is that the offline-verifiability claim is not yet real.** Today the app derives `trustedTime: 'rfc3161'` from a token that it parses **structurally only** — it never verifies the TSA's signature or certificate chain (verified in code: `resolveTrustedTime` at `manifest.ts:204`, `parseTimestampToken` at `timestampToken.ts:79`). The whole trust story therefore rests on a third party running `openssl ts -verify` out of band — and **nothing in the product or CI exercises that path yet.** The artifact that is supposed to make it real and tested is the standalone verifier (#122 PR2), which is not built.

**Verdict:** the foundation is sound; the initiative is roughly two-thirds done by count and ~50% done by remaining risk. The remaining work is dominated by **one keystone (#122 PR2)** plus two cheap human decisions that currently block progress. Everything else is independent, additive, and largely ready.

---

## 2. What "court-admissible" means here

From `docs/reference/threat-model.md` and `docs/specs/2026-06-01-standalone-verifier-design.md`, the definition of done is:

> A Birdbrain evidence package can be verified, offline and air-gapped, by a third party (opposing counsel, the court) **without running Birdbrain**, establishing two independent claims:
> 1. **Integrity** — the captured bytes and the hash-chained manifest are intact and internally consistent.
> 2. **Trusted time** — the content provably existed no later than time *T*, attested by an independent RFC 3161 TSA.

Mapped to the Federal Rules of Evidence self-authentication lane:

| FRE requirement | Mechanism | Status |
|---|---|---|
| 902(14) integrity by hash comparison | SHA-256 content hash + hash-linked manifest | Shipped (#115/#117) |
| 902(13) record of a reliable electronic process | Operator-attributed, signed, append-only manifest | Shipped (#116/#117) |
| Independent (non-self-asserted) time anchor | RFC 3161 token from DigiCert | Shipped in-app (#120); **independent verification not yet enforced** |
| Verifiable without the original author/tool | Standalone verifier + by-hand runbook | **Not built (#122 PR2)** |
| Certifying document for a qualified person to sign | 902(13)/(14) certification generator | **Not built (#125)** |

**Honest non-claims** (already documented in the threat model, must stay in any legal brief): the manifest signature defends against casual tampering, **not** a determined operator running Birdbrain's own code; operator identity is **self-asserted, not authenticated**; the in-app `rfc3161` status is structural, and authenticity of the time anchor is established only by `openssl ts -verify`.

---

## 3. What has shipped (the spine)

| # | Goal | Delivered by | State |
|---|---|---|---|
| #112 | D6: default TSA = DigiCert (`http://timestamp.digicert.com`), freetsa.org as dev/test fallback | decision + PR #137 (rationale) | Closed |
| #113 | D5: approve `@peculiar/asn1-*` only; canonical path stays `openssl ts -verify` | decision | Closed |
| #115 | Manifest schema v2: per-entry `schemaVersion`, `signature`, `timestamp` type, `screenshotHash`/`textHash`; v1 grandfathering | PR #127 | Closed |
| #116 | Operator identity required for capture/export; `installationId` in report | PR #128 | Closed |
| #117 | RSA-2048 per-entry chain signing, `safeStorage`-wrapped key, openssl-verifiable | PR #135 | Closed |
| #120 | RFC 3161 timestamping + `trustedTime` axis (rfc3161/pending/none) | PR #136 (+ #137 docs) | Closed |
| #121 | Whole-case self-contained signed evidence ZIP | PR #138 | Closed |
| #122 PR1 | Verify-core extracted to `src/shared/verify/` (canonical JSON, signature, token parse, chain) | PR #140 (spec PR #139) | Merged (issue still open) |

**Audited strengths (grounded in code):**

- **Grandfathering is correct and load-bearing.** `verifyManifestChainText` (`manifestChain.ts:58`) recomputes the hash for v1 and v2 alike but enforces a signature only when `schemaVersion >= 2`. Legacy v1 entries present as integrity-verified without signature and are never retro-signed.
- **trustedTime derivation matches the model exactly.** `resolveTrustedTime` (`manifest.ts:204`): a `timestamp` entry whose parsed imprint equals the capture's `contentHash` → `rfc3161`; a v2 `capture` entry with no valid token → `pending`; v1/absent → `none`. The DB column is a rebuildable mirror (`buildTrustedTimeIndex`, `rebuildMirror`). This is the AC#5/AC#6 reconciliation — do **not** "fix" `none` to chase AC#6's literal wording; it would break AC#5.
- **Signing is genuinely openssl-verifiable** and fails closed if the keystore can't be unwrapped (`signingKey.ts:55`) rather than silently rotating and invalidating prior signatures. `entryHash` and `signature` are excluded from the canonical body before hashing/verification.
- **The app already consumes `src/shared/verify/`** (`manifest.ts`, `signingKey.ts`, `timestamp.ts`, `export.ts`), so app-vs-verifier drift is structurally prevented and there are import-hygiene tests pinning it both directions.

---

## 4. Audit findings (ranked)

> Severity reflects impact on the **court-admissibility claim**, not general code quality. F1–F3 personally verified against current code; F4–F7 from the code-map audit with cited anchors.

**F1 — CRITICAL (claim gap): in-app `rfc3161` is structural only; the cryptographic time proof is never executed or tested.**
`resolveTrustedTime`/`parseTimestampToken` check imprint equality and parse ASN.1 structure but never verify the TSA signature, signer cert chain, or `genTime`. A self-made token with a matching imprint and arbitrary `genTime` would resolve to `rfc3161` in-app. This is by design (canonical proof = `openssl ts -verify`), but: (a) **no CI test runs `openssl ts -verify`** against bundled tokens, and (b) **no test asserts `tsa-ca-chain.pem` actually chains the bundled `.tst` tokens.** The product's strongest evidentiary claim is currently unenforced by any executable check. → Closed by building **#122 PR2** + the CI coverage gap (§8 G2).

**F2 — HIGH (latent integrity landmine): canonical JSON is not RFC 8785/JCS-compliant.**
`canonicalStringify` (`canonicalJson.ts:2`) sorts keys by JS default UTF-16 code-unit order (not Unicode codepoint), applies **no NFC normalization**, and formats numbers via `JSON.stringify`. Safe today because all hashed fields are ASCII (frozen by a golden vector). But operator names, notes, or any future free-text in a hashed field could canonicalize differently across platforms/encoders, producing **false verification failures** — and the standalone binary must reproduce these bytes exactly. This must be hardened **before** non-ASCII enters any hashed field and **before** the standalone verifier ships. → §8 G1.

**F3 — MEDIUM: replay nonce requested but not enforced.**
`requestTimestamp` sends an RFC 3161 nonce but never validates the TSA echoed it. Low practical risk (imprint binding still holds), but trivially closeable and worth doing for defensibility. → fold into #120 follow-up or #122 PR2 token validation.

**F4 — HIGH (schema advertises a guarantee the code doesn't deliver): screenshot/text hashes are stubbed but never computed.**
`screenshotHash`/`textHash` exist as optional fields on every v2 capture entry but are never populated anywhere in `src/` (audit-confirmed full-tree). Screenshots are stored and exported but **not hash-anchored**. This is exactly #118 — and #122's tamper-test acceptance (AC#5) already requires "swapped screenshot fails," so **#118 is a prerequisite for #122 PR2's acceptance.**

**F5 — MEDIUM: `evidence.json` is unsigned and unhashed.**
It is a convenience index, not in the `artifacts` list and not chained. The #122 spec already correctly demotes it to an *untrusted* index with `manifest.jsonl` as the sole source of truth — this must be honored by the verifier and stated in the runbook so a naive consumer can't be fed a tampered index.

**F6 — MEDIUM: operator identity is self-asserted, not authenticated.**
`operatorId` is a local random UUID in a plaintext file; `operatorName` is free text. Only *retroactive* edits to already-chained entries are detectable. Acceptable, but the court materials/cert (#125) must phrase it as "this installation, asserting this name" — not cryptographic operator authentication. Already reflected in the threat model.

**F7 — LOW: provenance/version drift and export cost.**
`report.html` hardcodes "Generated by Birdbrain v0.1.0" while the real version comes from `app.getVersion()`; custom (non-DigiCert) TSAs produce a package whose CA chain isn't self-contained (`tsaTrust.ts:43`); per-capture re-verify is O(n²) over large cases. Cosmetic/perf, not soundness.

---

## 5. Remaining open work

| # | Goal | State today | Blockers | Effort |
|---|---|---|---|---|
| **#114** | TLS feasibility spike (binding vs corroboration-only) | Spike **done** (`docs/specs/2026-05-17-chrome-debugger-tls-spike.md`), recommends corroboration-only; **decision not ratified** | HITL ratification only | Decision (hours) |
| **#118** | Screenshot/text integrity, content-addressed | Fields stubbed, never computed (F4) | #115 ✅ (and #117 ✅) | S–M |
| **#119** | HTTP response-headers capture | Request headers in DB; **not in manifest** (not anchored) | #115 ✅ | S |
| **#122 PR2** | Standalone verifier + runbook + per-OS binary + tamper tests | PR1 (core) merged; PR2 not started | Spec re-review of #139 (HITL); needs #118 for AC#5 | **L (keystone)** |
| **#123** | TLS cert-chain capture (corroboration-only) | No scaffolding | #114 decision, #119 | M |
| **#124** | Signed export/access audit log (`type:'export'` entry) | No scaffolding | #117 ✅, #121 ✅ → **ready now** | S–M |
| **#125** | FRE 902(13)/(14) certification generator | No scaffolding; wording lawyer-TBD | #120 ✅, #121 ✅ → **ready now** | M (scaffold) |
| **#143** | Manifest transactional write-ahead append | Pattern exists (append+fsync+rollback); not lifted to one seam; crash-window between fsync and DB insert | soft-dep #142 | M |
| **#145** | Consolidate trusted-time mirror reconciliation | Start-time rebuild exists; no first-class reconcile pass | **Deferred**: cluster must settle + HITL confirm no seam collision with #122 verify-core | M (gated) |

---

## 6. Dependency graph

```
Decision gates (HITL):
  #139 spec re-review ──unblocks──> #122 PR2
  #114 ratify (corroboration-only) ──unblocks──> #123

Build edges (A ──> B  =  A depends on B):
  #117 ──> #115 ✅
  #120 ──> #115 ✅, #112 ✅, #113 ✅
  #121 ──> #117 ✅, #120 ✅
  #122 ──> #117 ✅, #120 ✅, #121 ✅   (+ #118 for AC#5 swapped-screenshot)
  #118 ──> #115 ✅ (+ #117 for "same signed-entry guarantee")
  #119 ──> #115 ✅
  #123 ──> #114 (decision), #119
  #124 ──> #117 ✅, #121 ✅            → READY
  #125 ──> #120 ✅, #121 ✅            → READY
  #143 ──> (soft) #142
  #145 ──> whole cluster + #122       → LAST, gated
```

Implied-but-unstated edges worth recording on the tracker: **#118 → #117**, **#122 AC#5 → #118**, **#124 → #120** (records a "verification result"), **#145 → #120** (consolidates the #120 mirror rule).

---

## 7. Resolution path (waves)

Ordering principle: **unblock the keystone first, then make the offline claim real and tested, then add the independent surfaces, then TLS/infra, then consolidate.**

### Wave 0 — Unblock (HITL decisions; do this first, ~hours)
- **D-A:** Re-review the #139 standalone-verifier spec → unblocks #122 PR2.
- **D-B:** Ratify the #114 spike recommendation (corroboration-only as primary; binding as later opt-in) → unblocks #123 scope.

### Wave 1 — Make offline verifiability real (this *is* the admissibility gate)
1. **#118** screenshot/text hashing (prerequisite for #122 AC#5).
2. **Harden `canonicalStringify` to RFC 8785/JCS** (F2) — file as a new issue (§8 G1); land before #122 PR2 freezes the cross-tool byte contract.
3. **#122 PR2** standalone verifier + by-hand runbook + per-OS binary + full tamper suite. Closes F1 by turning `openssl ts -verify` into a tested, shipped artifact.
4. **CI coverage** for the openssl path + tsa-chain assertion (§8 G2).

### Wave 2 — Complete the chain-of-custody surface (independent, ready now)
- **#124** signed export/access audit log.
- **#119** HTTP response-headers anchored into the manifest.
- **#125** 902(13)/(14) certification generator (scaffold + auto-populated fields; legal wording stays lawyer-TBD).

### Wave 3 — TLS + infra
- **#123** TLS cert-chain (corroboration-only) — after #119.
- **#143** manifest transactional write-ahead append (infra hardening; independent).

### Wave 4 — Consolidation (gated, last)
- **#145** trusted-time reconciliation — only after #122 settles and a human confirms the seam doesn't collide with the verify-core (the issue's own AC#1 HITL gate).

---

## 8. Gaps not yet tracked (recommended new issues)

These surfaced in the audit and have **no GitHub issue**. Recommend filing (see §10 for the decision):

- **G1 — Canonical JSON RFC 8785/JCS hardening** (from F2): NFC normalization + codepoint key ordering + number formatting contract; regenerate the golden vector; document the canonicalization in the verifier runbook. *Blocks the byte-for-byte standalone-verifier contract.*
- **G2 — Executable trusted-time verification coverage** (from F1): a CI test that runs `openssl ts -verify` against a bundled token using `tsa-ca-chain.pem`, and asserts the chain actually validates the `.tst`. *Highest-value test gap; currently the core claim is unenforced.*
- **G3 — `EvidencePackageSchema` (zod)** (from F5 / #122 spec §7): replace the bare `JSON.stringify` of `evidence.json` with a validated schema; could be folded into #122 PR2.
- **G4 (doc hygiene) — missing design docs:** no spec for #120 timestamp scheduling, none for the evidence-package format; `report.html` version drift (F7). Low priority.

---

## 9. Risks & watch-items

- **Over-claiming in UI/brief.** `rfc3161` in the app means "a structurally-valid token claiming this imprint+time exists," not "verified trusted time." Keep UI copy and any legal brief aligned with the threat model until #122 PR2 + G2 make the cryptographic check executable.
- **Deletion semantics are load-bearing.** The verifier's active-set logic assumes hard delete (ADR 0001). Any move to soft-delete changes verifier logic.
- **Custom TSA breaks self-containment** (F7): packages from a non-default TSA aren't independently chain-verifiable from the package alone.

---

## 10. Decisions needed from you (HITL)

1. **Ratify #114** corroboration-only as the primary TLS path (binding deferred to opt-in)? — unblocks #123.
2. **Re-review #139** spec to release #122 PR2? — unblocks the keystone.
3. **File the new gap issues G1–G3** (§8)? G1/G2 are recommended as cluster blockers; G3 can fold into #122.
4. **Confirm wave ordering** (§7), in particular doing **#118 before #122 PR2**.

---

## Appendix — code anchors

- Canonical JSON: `src/shared/verify/canonicalJson.ts:2` (`canonicalStringify`)
- trustedTime derivation: `src/main/services/manifest.ts:204` (`resolveTrustedTime`), `:258` (`buildTrustedTimeIndex`)
- Token parse (structural only): `src/shared/verify/timestampToken.ts:79` (`parseTimestampToken`)
- Timestamp request/worker: `src/main/services/timestamp.ts`, `timestampWorker.ts`
- Signing: `src/main/services/signingKey.ts:49` (`initSigningKey`), `:85` (`signEntryHash`); verify `src/shared/verify/signature.ts:8`
- Chain verify + grandfathering: `src/shared/verify/manifestChain.ts:39`,`:58`
- Evidence package: `src/main/services/export.ts:169` (`buildEvidenceZip`); TSA trust `src/main/services/tsaTrust.ts`
- Verify-core barrel: `src/shared/verify/index.ts`
- Related docs: `docs/reference/threat-model.md`, `docs/specs/2026-06-01-standalone-verifier-design.md`, `docs/specs/2026-05-17-chrome-debugger-tls-spike.md`, `docs/adr/0001-case-delete-skips-manifest.md`
