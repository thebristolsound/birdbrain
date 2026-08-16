# Evidence-claim audit: what Birdbrain tells an operator, and whether it is true

Date: 2026-08-16
Tracks: [#412](https://github.com/thebristolsound/birdbrain/issues/412) (`wayfinder:research`, under
map [#284](https://github.com/thebristolsound/birdbrain/issues/284)). Commissioned by the
[#288](https://github.com/thebristolsound/birdbrain/issues/288) grilling decision.

Audited against `main` at `80a8688`. Standard is
[ADR-0004](../adr/0004-adopt-osint-assurance-baseline.md): a claim passes only if it "states exactly
what verification proves and does not prove."

## Scope

**Shipped surfaces only.** Every verdict below describes the four surfaces as they exist on `main`
today. The redesign program changes claims on the export surface — #398 and #399 add a Working Copy
class and extend Certification, #401 labels Wayback material as non-evidence — and this audit does
not anticipate them. Re-run it against the export surface after that work lands rather than
treating these verdicts as covering it.

Fix-vs-reword is decided per claim on the findings and is not part of this document. Each
non-`true` verdict is filed as its own issue, listed in [Filed](#filed).

## Verdict summary

| Surface | Claims | True | Narrower than stated | False |
|---|---|---|---|---|
| Threat model | 7 | 5 | 2 | 0 |
| In-app | 5 | 3 | 2 | 0 |
| Verifier CLI + verify-core | 4 | 3 | 1 | 0 |
| Export / certification | 5 | 3 | 1 | 1 |

## 1. Threat model — `website/content/docs/threat-model.mdx`

| # | Claim | Stated at | Verdict | Basis |
|---|---|---|---|---|
| TM1 | "Birdbrain reports integrity and trusted time as **separate, orthogonal axes**." | `threat-model.mdx:14` | **narrower than stated** | True of `report.html`, `certification.html` and the verifier. Not true of the app: the only component that renders a trusted-time axis is `ProvenanceBadge`, which nothing mounts — `TrustedTimeChip` is rendered solely at `ProvenanceBadge.tsx:135`, and `getProvenanceColor` has just two consumers, `ForensicsTab.tsx:13` and `CaptureDetailsPanel.tsx:172`, both integrity-only. |
| TM2 | Trusted time has three states: `rfc3161`, `pending`, `none`, with `pending` meaning an eligible capture awaiting its token. | `threat-model.mdx:25-28` | true | `trustedTime.ts:88-99`; eligibility is `schemaVersion >= 2` at `trustedTime.ts:68-75`. |
| TM3 | A forged entry fails verification because it no longer carries a signature valid against the installation key, and re-hashing one entry breaks every downstream link. | `threat-model.mdx:32-36` | true | `manifestChain.ts:124-154` — index, `prevHash`, recomputed `entryHash`, then signature. Stronger than stated: `:142` also rejects a v2→v1 schema downgrade. |
| TM4 | "The signing key is wrapped at rest with the OS credential store (DPAPI / Keychain via Electron `safeStorage`)". | `threat-model.mdx:39-40` | **narrower than stated** | Since #414 (PR #427) an install with no credential store writes the key **in the clear** after an explicit operator acknowledgement: `signingKey.ts:63-72` falls back to the bare PEM, `:118` prompts, `:198`/`:216` gate generation on the answer, and `:232` exposes the resulting state to Diagnostics. The threat model describes only the wrapped case, and names only DPAPI/Keychain — not the Linux Secret Service path the code and the #287 research both centre on. |
| TM5 | The RFC 3161 token is the independent anchor that closes the local-key gap. | `threat-model.mdx:45-50` | true | Imprint binds `contentHash` (`trustedTime.ts:50`); the token is issued externally and stored in the chain. |
| TM6 | DigiCert is the default TSA; free authorities are a development fallback only. | `threat-model.mdx:54-76` | true | `constants.ts:42` — `DEFAULT_TSA_URL = 'http://timestamp.digicert.com'`. |
| TM7 | "In-app trusted-time display performs **structural** parsing only — it confirms the token's message imprint matches the capture's content hash and surfaces the TSA identity and stamped time." | `threat-model.mdx:80-82` | **narrower than stated** (same finding as TM1) | The structural-only characterisation is correct wherever it applies, but there is no in-app trusted-time display to characterise. Filed with TM1. |

**Gap, not a false claim.** The threat model makes no distinction between the signing key and the
OpenRouter credential, which #289 decided must be drawn: the signing key is acknowledgement-gated
when it cannot be protected, the OpenRouter key is surface-only in Diagnostics
(`types.ts:310-312`). Covered by the TM4 issue.

## 2. In-app verification language

| # | Claim | Stated at | Verdict | Basis |
|---|---|---|---|---|
| APP1 | "Chain status: **Verified**" on a capture. | `ForensicsTab.tsx:42-51`, label from `getProvenanceColor.ts:19-25` | true | Green requires all of: MHTML bytes recompute to the stored hash (`captureLifecycle.ts:252-268`), the case chain verifies (`:270`), **this** capture's `contentHash` is anchored at its recorded manifest index (`:287-299`, defeating a truncated-but-valid chain), and both sidecars bind to the digests in the **signed manifest entry** rather than the `captures` DB mirror (`:320-324` → `verifySidecars` at `:352-380`). |
| APP2 | That green label describes the capture's **current** state. | `ForensicsTab.tsx:13`, `CaptureDetailsPanel.tsx:172` | **narrower than stated** | Both read `capture.lastVerifiedStatus`, a value persisted by an earlier run (`captureLifecycle.ts:406-410`), and neither renders the `verifiedAt` recorded alongside it. A capture verified once and altered on disk afterwards keeps showing "Verified" until someone presses Re-verify. `report.html` handles the identical problem explicitly, with a distinct "Not verified in this export" state (`reportHtml.ts:256-264`). |
| APP3 | Legacy banner: "captured before forensic chain (v2). Hash present, chain metadata unavailable." | `ForensicsTab.tsx:30-31` | true | `format === 'html'` short-circuits to `status: 'legacy'` at `captureLifecycle.ts:246-248`. |
| APP4 | Per-capture trusted time is visible to the operator. | — | **narrower than stated** — see TM1 | The app asserts nothing about trusted time on any capture surface. `#457` records the same fact from an architecture review. |
| APP5 | Export dialog: "N captures will export without RFC 3161 trusted time (P pending, Q none)". | `ExportDialog.tsx:171-178` | true | Counts come from `getExportPreflight`, which reads the manifest via `buildTrustedTimeIndex` (`export.ts:77-94`). |

## 3. Standalone verifier CLI and `src/shared/verify/`

| # | Claim | Stated at | Verdict | Basis |
|---|---|---|---|---|
| V1 | "A PASS means integrity + internal consistency… It is NOT a standalone authenticity claim. Timestamp checks here are STRUCTURAL." | `cli.ts:62-67`, restated at `:101-106` | true | `evidencePackage.ts:185-236` byte-binds the `.tst` to the signed `tsaToken` and checks the imprint; no CMS signature verification anywhere in `shared/verify`. |
| V2 | The signed `manifest.jsonl` is the sole root of trust; `evidence.json` is reconciled, never trusted. | `cli.ts:9-12`, `evidencePackage.ts:13-21` | true | Chain first (`:101`), active set derived from chain entries (`:119-126`), index parsed but used only to locate files and to detect edits (`:132-133`, `:239-302`). |
| V3 | Every artefact the signed entry attests is bound by the verifier. | implied by V2's "derives the active-capture set from it, binds package files to the chain" (`evidencePackage.ts:15-16`) | **narrower than stated** | The verifier binds `contentHash` and `screenshotHash` but never `textHash`, which the verified entry does carry (`manifestChain.ts:169`). The `.txt` sidecar is deliberately not bundled (`export.ts:336-337`), so nothing is unverifiable-but-present — yet `evidence.json` still publishes `textSha256` per capture (`export.ts:376`) for a file the package does not contain, and `VERIFY.md`'s contents table does not mention extracted text at all (`verifyRunbook.ts:38-46`). The app binds this digest (APP1); the package verifier has nothing to bind. |
| V4 | Trusting the untrusted index to *locate* a `.tst` is sound because the byte-binding is the real check. | `evidencePackage.ts:308-315` | true | Resolution order at `:316-342`; every path ends at the `fileBytes.equals(signedToken)` check at `:206`. |

## 4. Export and certification output

| # | Claim | Stated at | Verdict | Basis |
|---|---|---|---|---|
| E1 | Certification process description: MHTML capture, SHA-256, hash-chained append-only manifest, RFC 3161 where enabled. | `certification.ts:90-95` | true | Matches `manifest.ts` / `timestampWorker.ts` behaviour. |
| E2 | Certification trusted-time prose: "All N captures … carry an RFC 3161 trusted timestamp", and the "Timestamped captures" table. | `certification.ts:135-168` | **false** (reachable case) | The counts behind `allStamped` come from `preflight`, which is manifest-derived (`export.ts:79-94`), but the per-capture rows come from `verification?.trustedTime ?? capture.trustedTimeStatus` (`certification.ts:71`) — and `data.verifications` is empty whenever the operator unchecks **Audit Trail** (`export.ts:146-153`; the toggle is `ExportDialog.tsx:128`, default on). In that export the certification asserts trusted time per capture from the rebuildable `captures.trustedTimeStatus` mirror rather than the signed manifest — the exact class of defect #234 removed from the verify path — and the mirror-sourced rows can disagree with the manifest-sourced counts in the same document. `report.html` does not have this bug: it falls back to the manifest snapshot `data.trustedTimeByCaptureId` (`reportHtml.ts:232`). A mirror-sourced row also prints a generic "RFC 3161 TSA" with no asserted time (`certification.ts:160-161`). |
| E3 | Report scope: "no capture is presented as timestamped unless a token is retained for it". | `reportHtml.ts:528-533` | true | Basis resolves through the manifest snapshot (`reportHtml.ts:228-232`), taken at the instant the package is built (`export.ts:207-214`). |
| E4 | "…can reproduce every integrity claim it makes using standard tools." | `reportHtml.ts:720-723` | **narrower than stated** | `report.html` and `certification.html` — the two documents that carry the claims — are themselves covered inside the package only by the **unsigned** `evidence.json`. The signed `export` entry carrying `packageHash` is appended to the *live* case manifest after the zip is written and is deliberately absent from the bundled manifest copy (`export.ts:226-246`). A recipient holding only the zip therefore cannot cryptographically detect a substituted report or certification. `VERIFY.md` says the index is untrusted (`verifyRunbook.ts:48-51`) but neither document says these two files sit outside the signed chain. |
| E5 | Certifier identity is self-asserted and not authenticated. | `certification.ts:271-277`, `reportHtml.ts:514-519` | true | Stated at every occurrence, including the signature block. |

## #234 confirmation (requested explicitly by the ticket)

Both call sites read sidecar digests from the signed manifest entry, not the `captures.text_hash`
DB mirror. Confirmed on `main`:

- `verifyCapture` → `computeVerification` → `verifySidecars`: the entry comes from
  `chain.captureEntriesByIndex` (`captureLifecycle.ts:320-323`), reached only after the chain
  verifies (`:270`) and the capture's own `contentHash` is confirmed anchored at its index
  (`:287-299`). `verifySidecars` compares against `entry.screenshotHash` / `entry.textHash`
  (`:357`, `:368`).
- `resolveTextAnchor`: verifies the chain (`noteAnchorResolver.ts:119-120`), refuses when the named
  entry is absent (`:126-128`), confirms `entry.contentHash === target.contentHash` before trusting
  anything it says (`:135-137`), and only then compares the sidecar against `entry.textHash`
  (`:147-160`). A chain that does not verify yields `integrity-failed / chain-invalid`, kept
  distinct from `unattested`.

`captureEntriesByIndex` is populated only from entries that passed the full per-entry check
(`manifestChain.ts:163-172`), and is empty when the chain is broken. The green path chains to the
signed manifest.

## Filed

| Issue | Claim | Verdict |
|---|---|---|
| [#489](https://github.com/thebristolsound/birdbrain/issues/489) | TM1 / TM7 / APP4 — orthogonal-axes and in-app trusted-time display | narrower than stated |
| [#490](https://github.com/thebristolsound/birdbrain/issues/490) | TM4 — signing key wrapped at rest | narrower than stated |
| [#491](https://github.com/thebristolsound/birdbrain/issues/491) | APP2 — stale "Verified" presented as current state | narrower than stated |
| [#492](https://github.com/thebristolsound/birdbrain/issues/492) | E2 — certification trusted time sourced from the DB mirror | false |
| [#493](https://github.com/thebristolsound/birdbrain/issues/493) | E4 — report and certification outside the signed chain in-package | narrower than stated |
| [#494](https://github.com/thebristolsound/birdbrain/issues/494) | V3 — `textHash` unbound by the package verifier; `textSha256` published for an absent file | narrower than stated |

#492 is the only one that changes what a document asserts; it is the one to fix before round 1.
The other five are wording or presentation, and #489 is already paired with the parked #457.
