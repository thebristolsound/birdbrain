# Evidence-claims audit — what Birdbrain tells an operator vs. what the code proves

**Date:** 2026-08-14
**Issue:** [#412](https://github.com/thebristolsound/birdbrain/issues/412) (part of map #284, commissioned by the #288 grilling decision)
**Commit audited:** `9bb735191c55daf39cef512cd80bb2ecffb5695e` (`main`, post-#427)
**Status:** research output. No `src/` change accompanies it, and no fix-vs-reword decision is
recorded here — per the issue, that decision is explicitly out of scope.

## What was audited

Every claim Birdbrain makes to an operator about evidence integrity, across four surfaces:

1. **Threat model** — `website/content/docs/threat-model.mdx`.
2. **In-app verification language** — the Forensics/Verify surfaces under
   `src/renderer/components/captures/` and `src/renderer/components/overview/VerifyBar.tsx`.
3. **The standalone verifier** — `src/verifier/cli.ts` and `src/shared/verify/**`.
4. **Export and certification output** — `export.ts`, `certification.ts`, `manifest.ts`,
   `caseArchive.ts`, `pdfExport.ts`, plus the generated `VERIFY.md` (`verifyRunbook.ts`) and
   `report.html` (`reportHtml.ts`).

Swept in addition: `README.md` and all of `website/content/docs/*.mdx`, since claims leak into
both.

## The standard being applied

ADR-0004 (`docs/adr/0004-adopt-osint-assurance-baseline.md`). Two clauses do the work:

> Verification success establishes only the property actually tested. Hash equality, signature
> continuity, trusted time, signer identity, source attribution, completeness, and truth are
> separate claims. — ADR-0004:51-53

> Birdbrain must not make generic claims such as "court-admissible," "court-ready,"
> "forensic-grade," "tamper-proof," "authentic," or "compliant." — ADR-0004:116-117

So the bar is: *states exactly what verification proves and does not prove.* A claim that is true
only in the good case (TSA reachable, key protectable, MHTML format, package rather than bare
report) and stated unconditionally is recorded as **narrower than stated**. The condition is the
finding.

Every verdict below was reached by reading the implementation, not the doc and not the function
name. One verdict (V-05 / V-21 / V-28) was additionally confirmed by executing the shipped
verification command against a purpose-built forged token — see "F-1" below.

---

## Verdict table

| # | Claim | Where stated | Verdict | Citation (code that decides it) |
|---|---|---|---|---|
| **Surface 1 — Threat model** |
| V-01 | "Have the captured bytes and the manifest chain survived intact? … SHA-256 content hash + hash-linked, per-entry-signed manifest" | `website/content/docs/threat-model.mdx:20` | narrower than stated | `src/shared/verify/manifestChain.ts:146-153`; `src/main/services/captureLifecycle.ts:242-249` |
| V-02 | "copying the case directory elsewhere and editing a capture, a hash, or a chain link with ordinary tools will fail verification" | `threat-model.mdx:32-36` | true | `src/shared/verify/manifestChain.ts:114-158`; `src/main/services/captureLifecycle.ts:268-334` |
| V-03 | "It does **not** defend against a determined operator running Birdbrain's own code as themselves." | `threat-model.mdx:38-43` | true | `src/main/services/signingKey.ts:236-241` |
| V-04 | "The signing key is wrapped at rest with the OS credential store (DPAPI / Keychain via Electron `safeStorage`)" | `threat-model.mdx:39-41` | narrower than stated | `src/main/services/signingKey.ts:63-72`, `196-224` |
| V-05 | "**The RFC 3161 token is the independent anchor that closes this gap.** … a fact the operator cannot back-date or forge, regardless of their control over the local machine." | `threat-model.mdx:45-48` | **false** | `src/shared/verify/trustedTime.ts:40-61`; `src/main/services/export.ts:279-288`, `:320`; `src/main/services/verifyRunbook.ts:125-127` |
| V-06 | "Verification with stock `openssl ts -verify` succeeds offline against a root the verifier already trusts — no special configuration, no 'trust us' step." | `threat-model.mdx:60-63` | narrower than stated | `src/main/services/verifyRunbook.ts:125-127`; `src/main/services/export.ts:319-320` |
| V-07 | "In-app trusted-time display performs **structural** parsing only" | `threat-model.mdx:80-82` | true | `src/shared/verify/timestampToken.ts:76-99` |
| V-08 | Trusted-time axis has exactly three states `rfc3161` / `pending` / `none`, `pending` = eligible-but-unstamped | `threat-model.mdx:25-28` | true | `src/shared/verify/trustedTime.ts:88-99`, `108-139` |
| V-09 | Free TSAs are "a documented **development/test fallback only** — their roots are not in common trust stores" | `threat-model.mdx:74-76` | true | `src/main/services/tsaTrust.ts:43-56` |
| **Surface 2 — In-app verification language** |
| V-10 | Green shield chip reading `Verified #N` on a capture | `src/renderer/components/captures/ProvenanceBadge.tsx:82-95` | narrower than stated | `ProvenanceBadge.tsx:44-56`, `:63`; `src/main/services/captureLifecycle.ts:406-410` |
| V-11 | Case overview "Verified: N" segment of the integrity bar | `src/renderer/components/overview/VerifyBar.tsx:8-13`, `:33-41` | narrower than stated | `src/renderer/components/overview/overviewModel.ts:50-57` |
| V-12 | Case overview counts a capture as **"Tampered"** | `VerifyBar.tsx:10` | narrower than stated | `overviewModel.ts:55` |
| V-13 | Green "Timestamped" chip, tooltip naming the TSA and the stamped time | `ProvenanceBadge.tsx:13-25` | narrower than stated | `src/shared/verify/trustedTime.ts:49-55`; `src/shared/verify/timestampToken.ts:76-99` |
| V-14 | Forensics tab "Chain status: Verified" | `src/renderer/components/captures/ForensicsTab.tsx:42-51` | narrower than stated | `ForensicsTab.tsx:13`; `src/renderer/components/captures/getProvenanceColor.ts:19-25` |
| V-15 | "Legacy HTML capture — captured before forensic chain (v2). Hash present, chain metadata unavailable." | `ForensicsTab.tsx:30-31` | true | `src/main/services/captureLifecycle.ts:242-249` |
| V-16 | #234 green path chains to the **signed manifest**, not `captures.text_hash` — in `resolveTextAnchor` | `src/main/services/noteAnchorResolver.ts:8-16` | true | `noteAnchorResolver.ts:114-160` |
| V-17 | #234 green path chains to the **signed manifest**, not the `captures` mirror — in `verifyCapture` | `src/main/services/captureLifecycle.ts:310-323` | true | `captureLifecycle.ts:320-324`, `352-380` |
| **Surface 3 — Standalone verifier + shipped runbook** |
| V-18 | "A PASS means integrity + internal consistency… It is NOT a standalone authenticity claim." | `src/verifier/cli.ts:62-67` | true | `src/shared/verify/evidencePackage.ts:79-306` |
| V-19 | "every active capture's bytes bind to the chain" | `src/verifier/cli.ts:63-64` | narrower than stated | `src/shared/verify/evidencePackage.ts:157-237`; `src/main/services/export.ts:334-337` |
| V-20 | "the signed `manifest.jsonl` is the sole source of truth" for the package verifier | `src/shared/verify/evidencePackage.ts:15-17` | true | `evidencePackage.ts:114-131`, `:257-277` |
| V-21 | "A token whose imprint matches the content hash but whose TSA signature is invalid (a forged token) PASSES the binary's structural check and is caught **only** here." | `src/main/services/verifyRunbook.ts:130-133` | **false** | `src/main/services/export.ts:279-288`, `:320`; empirically demonstrated (F-1) |
| V-22 | "The signing key (`signing-public-key.pem`) is installation-local and is **not** an independent trust anchor; it defeats casual tampering." | `verifyRunbook.ts:24-26` | true | `src/shared/verify/evidencePackage.ts:86-101` |
| V-23 | "`evidence.json` is an **unsigned convenience index**. Do not trust it on its own" | `verifyRunbook.ts:22-23` | true | `evidencePackage.ts:132-134`, `:239-277`, `:308-342` |
| V-24 | "This package can be re-verified by a third party **without running Birdbrain**, using only stock tools" | `verifyRunbook.ts:13-14` | true | `verifyRunbook.ts:53-127`; `src/main/services/export.ts:296-320` |
| V-25 | `--self-check` "assert[s] the bundled core is byte-identical to the in-app core" | `src/verifier/cli.ts:19-21`, `:57-59` | narrower than stated | `src/verifier/cli.ts:69-84` |
| **Surface 4 — Export, report and certification output** |
| V-26 | "any later alteration of a capture or of the manifest is detectable" | `src/main/services/certification.ts:92-93` | narrower than stated | `src/main/services/signingKey.ts:236-241`; `src/shared/verify/manifestChain.ts:146-153` |
| V-27 | Document titled "Certificate of authenticity" | `src/main/services/certification.ts:199` | narrower than stated | `certification.ts:203-212`, `:271-277`; ADR-0004:116-117 |
| V-28 | "the signing chain terminates in `tsa-ca-chain.pem`, which carries the authority's trust anchor" | `src/main/services/reportHtml.ts:749-751` | **false** | `src/main/services/export.ts:283-284`, `:320`; `reportHtml.ts:759-771` |
| V-29 | "All N capture(s) in this export carry an RFC 3161 trusted timestamp asserting the time at which the capture content digest existed" + per-capture "Authority and asserted time (UTC)" table | `certification.ts:135-139`, `:158-168` | narrower than stated | `src/shared/verify/trustedTime.ts:49-55`; `src/shared/verify/timestampToken.ts:76-79` |
| V-30 | "Where a timestamp token is retained, that the digest existed no later than the time asserted by the named RFC 3161 authority." | `reportHtml.ts:506-512` | narrower than stated | `src/shared/verify/timestampToken.ts:76-99` |
| V-31 | "Nothing in this report needs to be taken on trust. A reviewer holding the evidence package can reproduce every integrity claim it makes using standard tools." | `reportHtml.ts:721-723` | narrower than stated | `src/main/services/export.ts:319-320`; `verifyRunbook.ts:125-127` |
| V-32 | "This report attests to the integrity and timing of stored bytes only — never to [the truth of the page]" and the four-statement Scope block | `reportHtml.ts:434-435`, `:503-534` | true | `reportHtml.ts:251-306`, `:308-333` |
| V-33 | "No verification was run for this export, so no capture is counted as integrity verified; the figure is not a finding of failure." | `reportHtml.ts:431-433`, `:256-264` | true | `src/main/services/export.ts:146-153`, `:437-446` |
| V-34 | "The export's `overallValid` flag refuses to report success on an empty verification set." | `birdbrain-technical-whitepaper.mdx:168` | true | `src/main/services/export.ts:437-446` |
| V-35 | "the act of exporting is itself part of the custody chain" (signed `export` manifest entry) | `birdbrain-technical-whitepaper.mdx:168`; `reportHtml.ts:583` | true | `src/main/services/export.ts:234-250`; `src/main/services/manifest.ts:291-303` |
| V-36 | "Recompute the package hash. Hash the canonical, path-sorted artefact list in `evidence.json`" | `reportHtml.ts:755-757` | true | `src/main/services/manifest.ts:190-204`, `:219-230`; `src/main/services/export.ts:424-432` |
| V-37 | `.birdbrain` archive inspect "fully re-verifies it — artifact hashes, manifest chain … and per-capture content hashes" | `src/main/services/caseArchive.ts:225-228` | narrower than stated | `caseArchive.ts:233-273` |
| **README and docs site** |
| V-38 | "Every capture is hashed, timestamped, and chained into a verifiable audit manifest." | `README.md:9`, `README.md:54`, `website/content/docs/index.mdx:12` | narrower than stated | `src/shared/verify/trustedTime.ts:134-137`; `src/main/services/captureLifecycle.ts:242-249` |
| V-39 | "Reports are readable in any browser and verifiable without Birdbrain installed." / "Export — self-contained HTML report, verifiable without Birdbrain" | `README.md:54`, `README.md:72`, `index.mdx:13-14`, `screenshots.mdx:118` | **false** | `src/main/services/reportHtml.ts:727-734`; `src/main/services/export.ts:219-253` |
| V-40 | "nothing leaves your machine during capture" | `README.md:38` | narrower than stated | `src/main/services/captureLifecycle.ts:122-138` |
| V-41 | "**Trusted time** — proof of *when* the content existed, anchored outside the operator's control." | `birdbrain-technical-whitepaper.mdx:35` | **false** | same as V-05 |
| V-42 | "External timestamps are the main constraint: they make it impossible to backdate fabrications" | `birdbrain-privacy-adoption-whitepaper.mdx:96` | **false** | same as V-05 |
| V-43 | "The private key is wrapped at rest with Electron `safeStorage` (DPAPI on Windows, Keychain on macOS, libsecret on Linux)." | `birdbrain-technical-whitepaper.mdx:160` | narrower than stated | `src/main/services/signingKey.ts:63-72`, `196-224` |
| V-44 | "JavaScript's sort and stringify agree byte-for-byte with `jq -cS`." | `birdbrain-technical-whitepaper.mdx:156`; `src/shared/verify/canonicalJson.ts:11-12` | narrower than stated | `src/shared/schemas.ts:293`; `src/shared/verify/canonicalJson.ts:32-36` |
| V-45 | "The hash is computed on exactly the bytes that landed on disk; there is no window where the file and its recorded hash can diverge." | `birdbrain-technical-whitepaper.mdx:136` | true | `src/main/services/captureStore.ts:118`; `src/main/services/captureLifecycle.ts:92-99` |
| V-46 | "verification confirms a capture's hash is anchored at its claimed manifest index, which defeats chain-truncation attacks." | `birdbrain-technical-whitepaper.mdx:118` | true | `src/main/services/captureLifecycle.ts:281-299` |
| V-47 | "The verifier rejects any v1 entry appearing after a v2+ entry, closing the 'strip the signatures by rewriting entries as v1' attack." | `birdbrain-technical-whitepaper.mdx:152` | true | `src/shared/verify/manifestChain.ts:136-145` |
| V-48 | "the service fails closed rather than regenerating" (unwrappable existing key) | `birdbrain-technical-whitepaper.mdx:160` | true | `src/main/services/signingKey.ts:172-191` |
| V-49 | "A verifier pass establishes package integrity and internal consistency. It does not independently establish the authenticity of the timestamp authority; the included runbook delegates that canonical check to `openssl ts -verify`." | `birdbrain-architecture-whitepaper.mdx:294-297` | narrower than stated | `src/main/services/export.ts:283-284`, `:320` |
| V-50 | Non-claims list, incl. "that a structural timestamp check authenticates the timestamp authority's CMS signature" | `birdbrain-architecture-whitepaper.mdx:493-503` | true | `src/shared/verify/timestampToken.ts:76-79`; `src/shared/verify/evidencePackage.ts:185-235` |
| V-51 | "Operator name, role, and organization are provenance labels, not authenticated identity claims." | `birdbrain-architecture-whitepaper.mdx:461`; `certification.ts:271-277` | true | `src/main/services/certification.ts:97-102`, `:252-277` |
| V-52 | "The Manifest, signatures, hashes, and timestamps defend against casual tampering… They do not defend against every adversary." | `birdbrain-contributor-adoption-whitepaper.mdx:411` | true | `src/main/services/signingKey.ts:236-241` |
| V-53 | "the evidence workflow has not been tested in court" | `README.md:134` | true | n/a — accurate disclaimer |

Totals: 53 claims verdicted — **22 true**, **25 narrower than stated**, **6 false**.

**One adjacent observation that is not a claim overstatement.** V-45 is verdicted true because the
sentence is explicitly scoped to `writeMhtmlStream` and the MHTML file, and that scope holds — the
content is hashed and written before the manifest entry is appended. The *sidecars* do have a
divergence window: `withCaptureEntry` fsyncs the signed entry, already carrying `screenshotHash` and
`textHash` (`src/main/services/captureLifecycle.ts:139-165`; `src/main/services/manifest.ts:352-381`),
and only then does the callback write the `.txt` and `.png` (`captureLifecycle.ts:166-176`). The
rollback seam truncates the manifest when the callback *throws* (`manifest.ts:407-420`), but a
process kill between the fsync and the sidecar write leaves a signed entry attesting hashes for
files that do not exist. Verification reports that as `tampered` / "Screenshot missing"
(`captureLifecycle.ts:357-361`) — the safe direction. No shipped document claims otherwise, so there
is nothing to verdict; it is recorded because a reader of V-45 will reasonably ask.

---

## Findings — the six **false** verdicts

### F-1 — Trusted time is not anchored outside the operator's control (V-05, V-21, V-28, V-41, V-42)

Five claims across three surfaces collapse into one defect, so they are written up together.

The claims:

> **The RFC 3161 token is the independent anchor that closes this gap.** … it establishes that the
> captured bytes existed no later than the stamped time — a fact the operator cannot back-date or
> forge, regardless of their control over the local machine. — `threat-model.mdx:45-48`

> A token whose imprint matches the content hash but whose TSA signature is invalid (a forged
> token) PASSES the binary's structural check and is caught **only** here. — `verifyRunbook.ts:130-133`

> …the signing chain terminates in `tsa-ca-chain.pem`, which carries the authority's trust anchor.
> — `reportHtml.ts:749-751`

**What the code does instead.** Birdbrain never verifies an RFC 3161 token's CMS signature
anywhere, by design: `parseTimestampToken` is documented as structural
(`src/shared/verify/timestampToken.ts:76-79`) and the trusted-time rule accepts any token that
parses and whose imprint matches (`src/shared/verify/trustedTime.ts:40-61`). That is disclosed and
correct on its own. The entire weight of the "independent anchor" claim therefore rests on the
runbook's step 6, which is the one check that would catch a forged token:

```sh
openssl ts -verify -digest <contentHash> -in timestamps/<token>.tst -CAfile tsa-ca-chain.pem
```

But the exporter builds `tsa-ca-chain.pem` by **extracting the certificates carried inside the
tokens themselves** and concatenating them ahead of the bundled trust anchor:

```ts
const chainPem = extractTimestampTokenCertificatesPem(token)   // export.ts:283
if (chainPem) timestampTokenChainPems.push(chainPem)           // export.ts:284
...
add('tsa-ca-chain.pem', [...timestampTokenChainPems, tsaTrust.pem].join('\n'))  // export.ts:320
```

`openssl`'s `-CAfile` is a *trust store*: any self-signed certificate in it is a valid chain
terminus. So a token minted under an attacker's own self-signed root ships its own root into the
CAfile and verifies against it.

**Confirmed empirically** at this commit, against OpenSSL 3.0.13, using the exact command the
shipped runbook prints. A throwaway self-signed CA was created, a TSA responder certificate with
the `timeStamping` EKU was issued under it, and `openssl ts -reply` minted a token over a dummy
capture. Reproducing the shipped file layout:

- `-CAfile` = certificates extracted from the token (what `export.ts:283-284` emits) →
  `Verification: OK`, exit 0.
- `-CAfile` = those certificates **plus** the bundled DigiCert Trusted Root G4 (`tsaTrust.ts:3-35`),
  i.e. exactly what Birdbrain ships → `Verification: OK`, exit 0.
- `-CAfile` = the DigiCert root **alone** (a genuinely independent anchor) →
  `Verification: FAILED`, `self-signed certificate in certificate chain`, exit 1.

The third result is the control: the mechanism works when the anchor is independent, and the
shipped package is what defeats it.

The consequence is that the specific adversary the threat model names — "a determined operator
running Birdbrain's own code as themselves", who already controls the signing key — can also mint
a back-dated token, drop it into the manifest, and have it survive the in-app chip, the standalone
verifier, and the runbook's canonical step. The gap the threat model says RFC 3161 closes is not
closed by anything Birdbrain currently ships.

`reportHtml.ts` already contains the correct analysis of this exact problem:

> Validating a token against certificates it supplied is circular and establishes nothing about
> who issued it. — `reportHtml.ts:766-767`

That warning is rendered **only** when `data.tsaTrustAnchorBundled` is false
(`reportHtml.ts:759-771`) — i.e. it is suppressed in the default DigiCert configuration, which is
the configuration where the file still carries the tokens' own certificates. The warning is
switched off in precisely the case it still applies to.

Downstream, this makes V-29 and V-30 (the certificate's "Authority and asserted time" table and the
report's "Is attested" block) narrower than stated: both print a TSA identity and a stamped time
read straight out of an unverified token (`timestampToken.ts:95-98`), with no statement anywhere in
either document that Birdbrain did not check the signature over them.

### F-2 — The standalone HTML report is not verifiable without Birdbrain (V-39)

> Reports are readable in any browser and verifiable without Birdbrain installed. — `README.md:54`

The claim is repeated as a screenshot caption (`README.md:72`), on the docs index
(`index.mdx:13-14`) and in `screenshots.mdx:118`.

**What the code does instead.** `generateReport` has two branches. Only `options.format === 'zip'`
produces the evidence package containing `manifest.jsonl`, `signing-public-key.pem`,
`tsa-ca-chain.pem`, `VERIFY.md`, `pages/`, `screenshots/` and `timestamps/`
(`src/main/services/export.ts:219-250`). The other branch writes the HTML file alone
(`export.ts:251-253`). The report itself says so, in the branch that fires for a non-package
export:

> This document was exported on its own. The files named below — the stored page archives, the
> manifest, the signing key, the timestamp tokens and `evidence.json` — are not enclosed with it,
> so **none of the steps can be carried out against this file alone**.
> — `reportHtml.ts:729-733`

The generated artefact is more honest than the README that advertises it. The verifiable thing is
the ZIP; the standalone HTML report is a readable document, not a verifiable one.

---

## Findings — the **narrower than stated** verdicts

### V-01 — "per-entry-signed manifest" is not universal

Signature enforcement applies to `schemaVersion >= 2` entries only; v1 entries are explicitly
grandfathered and verify with no signature at all (`src/shared/verify/manifestChain.ts:146-153`).
Separately, legacy `html`-format captures have no manifest entry whatsoever and short-circuit to
`status: 'legacy'` before any chain work runs (`src/main/services/captureLifecycle.ts:242-249`).
The downgrade guard (`manifestChain.ts:136-145`) keeps this from being exploitable within a chain
that has already gone v2, which is why this is a narrowing and not a hole.

### V-04, V-43 — the signing key is not always wrapped at rest

Both docs state the wrapping unconditionally. `wrapPrivateKey` returns the **plaintext PEM** when
`safeStorage` is unavailable (`src/main/services/signingKey.ts:63-72`). As of PR #427 (merged as
this commit) that path is no longer silent: first-run generation blocks on a native modal
acknowledging that "The private key that signs every capture manifest entry will be written to disk
in the clear" (`signingKey.ts:91-108`, `196-217`), the event is logged
(`signingKey.ts:222-224`), and Settings → Diagnostics renders **"Unprotected"** in a danger tone
(`src/renderer/components/settings/DiagnosticsPanel.tsx:69`, `241-258`). So plaintext-at-rest is
now a *supported, disclosed, operator-acknowledged* state — which is exactly why the threat model's
flat assertion no longer matches the product.

**Per #289's decision, this is where the wording will need to distinguish two credentials that the
docs currently treat alike:**

- **Signing key** — evidence-path, acknowledgement-gated. It cannot silently degrade; an operator
  who declines the prompt gets `SigningKeyUnacknowledgedError` and no key is generated
  (`signingKey.ts:147-160`, `196-200`). Its protection state is `protected` / `plaintext`
  (`signingKey.ts:187`, `:221`).
- **OpenRouter credential** — surface-only, no gate. `getOpenRouterKeyProtectionState` merely
  *reports* whether the stored value carries the `enc:` prefix, and adds a third state, `not-set`,
  for "no key was ever saved" (`src/main/services/settings.ts:175-192`). Nothing blocks on it; the
  code comment at `DiagnosticsPanel.tsx:58-61` records that the mis-attestation concern belongs to
  the signing key, "never" the revocable OpenRouter key.

The threat model currently mentions neither by name; it makes one unconditional statement that is
now wrong for the first and irrelevant to the second.

### V-06, V-31, V-49 — "no trust-us step" is not what the package instructs

`threat-model.mdx:60-63` claims verification succeeds "against a root the verifier already trusts —
no special configuration, no 'trust us' step", citing a test fixture. That is true of the fixture.
It is not what a reviewer holding a real package is told to do: `VERIFY.md` step 6 passes
`-CAfile tsa-ca-chain.pem` (`verifyRunbook.ts:125-127`) — a file the exporter assembled
(`export.ts:319-320`). The reviewer is asked to trust the exporter's bundled anchor file rather
than their own OS trust store, which is the "trust us" step the doc says does not exist.
`reportHtml.ts:721-723` ("Nothing in this report needs to be taken on trust") and
`birdbrain-architecture-whitepaper.mdx:294-297` (which correctly disclaims the verifier but then
delegates to the runbook) inherit the same narrowing.

### V-10, V-11, V-14 — a green "Verified" is a cached result, not a live check

`ProvenanceBadge` prefers a fresh mutation result but otherwise hydrates from the persisted
`last_verified_*` columns (`ProvenanceBadge.tsx:44-56`, `:63`), which `verifyCapture` writes on
every run (`src/main/services/captureLifecycle.ts:406-410`). On mount — and after any remount,
navigation or app restart — the emerald "Verified #N" chip therefore reports the outcome of the
*last* verification, whenever that was. The row does carry `lastVerifiedAt`, and `pdfExport.ts:77-83`
prints it ("`verified` at `<time>`"); the badge and the Forensics tab's "Chain status" row
(`ForensicsTab.tsx:42-51`) do not surface it at all. The overview bar has the same basis
(`overviewModel.ts:53-56`), so "Verified: 42" on a case means 42 captures verified at some
unspecified past moment.

### V-12 — "Tampered" is the bucket for "unreadable" too

`overviewModel.ts:55` maps `tampered`, `chain-broken` **and** `missing` into the single `tampered`
count, which `VerifyBar` renders in red as "Tampered" (`VerifyBar.tsx:10`). `missing` is produced
when the MHTML file simply cannot be read (`captureLifecycle.ts:260-267`) — a moved file, a
disconnected drive, a permissions change. `osint-investigation-standards.mdx:222-223` states the
rule this breaks: *"Unverified" is not "tampered."* The per-capture badge keeps the three states
distinct (`ProvenanceBadge.tsx:107-118`, `getProvenanceColor.ts:26-46`); only the case-level roll-up
collapses them.

### V-13, V-29, V-30 — TSA identity and stamped time are printed from an unverified token

The chip's tooltip (`ProvenanceBadge.tsx:14-19`), the certificate's "Authority and asserted time
(UTC)" table (`certification.ts:158-168`) and the report's "Is attested" clause
(`reportHtml.ts:506-512`) all render `tsaName` / `stampedAt`, which come from
`parseTimestampToken` (`timestampToken.ts:95-98`) via `stampFor` (`trustedTime.ts:49-55`). Neither
value is authenticated. The report's Scope block and the architecture whitepaper's non-claims list
say this correctly elsewhere; these three surfaces do not repeat it at the point of display. Given
F-1, the disclosure gap matters more than it would if step 6 worked.

### V-19 — the extracted-text sidecar is not bound inside an evidence package

`cli.ts:63-64` says a PASS means "every active capture's bytes bind to the chain". The package
verifier binds the MHTML content hash and the screenshot hash and byte-binds the timestamp token
(`evidencePackage.ts:157-237`); it never reads `textHash`. It cannot: the `.txt` sidecar is
deliberately not bundled (`export.ts:334-337`). In-app verification *does* bind it
(`captureLifecycle.ts:368-377`), so the claim is true of the app and narrower for the package.

Related residue from #234: `evidence.json` still records `textSha256` from the DB mirror,
`capture.textHash` (`export.ts:376`), rather than from the signed manifest entry. Nothing consumes
it — the verifier's artifact sweep does not cover it — so this is a latent inconsistency rather
than a live defect, but it is the one place the mirror still feeds an exported document.

### V-25 — `--self-check` proves less than the wording implies

The self-check canonicalizes one frozen golden object and compares the bytes
(`cli.ts:69-84`). That proves the bundled `canonicalStringify` is byte-identical to the in-app one.
It does not exercise `verifyManifestChainText`, `verifyEntrySignature`, `parseTimestampToken` or
`verifyEvidencePackage`. "the bundled core matches the in-app core byte-for-byte" reads as a claim
about the verify core; it is a claim about canonical JSON.

### V-26 — "any later alteration … is detectable" is unconditional in the certificate

`certification.ts:92-93` ships inside `certification.html`, the document offered under FRE
902(13)/(14). It states detectability without qualification. The threat model concedes the opposite
for the operator-adversary (`threat-model.mdx:38-43`), and `signEntryHash` uses a local private key
the operator holds (`signingKey.ts:236-241`), so a re-minted chain is internally consistent.
Legacy v1 entries add a second exception (`manifestChain.ts:146-153`). The rest of the certificate is
careful — the self-asserted-identity alert (`certification.ts:271-277`) and the LAWYER-TBD banner
(`certification.ts:203-212`) are both explicit — which makes this one sentence the odd one out.

### V-27 — "Certificate of authenticity"

`certification.ts:199` renders that as the `<h1>`, and `certification.ts:187` as the `<title>`.
ADR-0004:116-117 names "authentic" in the banned register, and
`osint-investigation-standards.mdx:351` repeats it. The document's *body* is scrupulous about not
claiming authenticity; the heading is not, and a heading is what gets quoted.

### V-37 — `.birdbrain` archive verification is internally consistent, not authenticated

The comment says the archive is "fully re-verifie[d]". Every input to that verification comes from
inside the archive: `packageHash` is recomputed from the header's own artifact list and compared to
the header's own value (`caseArchive.ts:263-266`), and the chain is verified against
`header.signingPublicKeyPem` — the key the archive supplies (`caseArchive.ts:271-273`). `package.json`
is not itself signed. So `overallValid` means "this archive is self-consistent", not "this archive
came from the installation it names". The import path handles this correctly by appending a
*locally* signed `import` boundary carrying the source key and the verification result
(`caseArchive.ts:425-428`; `manifest.ts:315-333`), which is what actually preserves custody from the
import forward — and `birdbrain-architecture-whitepaper.mdx:717-721` describes that accurately.

### V-38 — "hashed, timestamped, and chained"

Timestamping is asynchronous and best-effort: an eligible capture sits at `pending` until a worker
lands a token, and stays there indefinitely if the TSA is unreachable
(`src/shared/verify/trustedTime.ts:134-137`). Legacy captures are `none`
(`trustedTime.ts:96-98`). "Chained" also excludes legacy `html` captures, which have no entry
(`captureLifecycle.ts:242-249`). The product surfaces this correctly — the export preflight counts
stamped/pending/none separately (`export.ts:77-95`) and the certificate names the counts
(`certification.ts:140-156`) — so only the top-line marketing sentence is unconditional.

### V-40 — "nothing leaves your machine during capture"

Captured content never leaves. Two outbound connections do happen on the capture path. The TLS
cert-chain re-fetch runs inside `ingestCapture`, before the manifest entry is appended, and contacts
the origin directly (`captureLifecycle.ts:122-138`); it is unconditional for https URLs, not
opt-in. The trusted-timestamp worker then submits the content hash to the TSA. The technical
whitepaper states both accurately ("only content hashes leave the machine" and the TLS re-fetch
description at `birdbrain-technical-whitepaper.mdx:164`); the README sentence does not.

### V-44 — the canonical-JSON determinism invariant no longer holds by construction

`canonicalJson.ts:11-12` rests determinism on "entry keys are fixed ASCII schema names, so JS
code-unit sort, Unicode code-point sort, and the runbook's `jq -cS` codepoint key sort are all
byte-identical". Since #119, a v2 capture entry body embeds `headers`, typed
`z.record(z.string(), z.string())` (`src/shared/schemas.ts:293`), and `canonicalStringify` recurses
into nested objects sorting their keys too (`canonicalJson.ts:31-36`), as does `jq -cS`. Those
nested keys are HTTP header names supplied by the captured origin, not fixed schema names. JS
`.sort()` orders by UTF-16 code unit and `jq` by code point, which diverge only for non-BMP
characters, so a practical divergence needs an origin to emit a header name containing an
astral-plane character — exotic, and the file's own closing sentence anticipates the situation
("Introducing a non-ASCII key … must revisit this function and the runbook together"). The
whitepaper states the agreement flatly, and the stated precondition is no longer guaranteed.

---

## What could not be verdicted, and why

1. **Whether a court or opposing expert would in fact accept any of this.** Out of scope by
   construction: ADR-0004:121-130 assigns admissibility to the operator and the forum. `README.md:134`
   ("the evidence workflow has not been tested in court") is recorded as true because it is a
   disclaimer, not an assurance claim.

2. **The DigiCert trust-anchor story end to end.** `threat-model.mdx:60-63` cites
   `tests/fixtures/timestamp/README.md` for "a real DigiCert token returns `Verification: OK`
   against only the bundled root". I confirmed the bundled PEM is genuinely DigiCert Trusted Root G4
   (`openssl x509 -subject` over `tsaTrust.ts:3-35`) and confirmed the negative control in F-1, but
   I did not obtain a live DigiCert token at this commit. The claim about *genuine* tokens is
   plausible and untested here; the claim it is used to support (V-06) is verdicted on the shipped
   runbook, which is independent of that.

3. **Behaviour of `openssl ts -verify` on OpenSSL versions other than 3.0.13.** F-1's demonstration
   is reproducible and its mechanism (`-CAfile` as a trust store; a self-signed cert in it
   terminating the chain) is long-standing OpenSSL behaviour, but I tested one version on one
   platform. The negative control passing on the same binary is what rules out a local
   configuration artefact.

4. **Claims about the packaged/distributed application** — code signing, notarization, SBOM,
   update-channel integrity. `birdbrain-architecture-whitepaper.mdx:532` and
   `birdbrain-contributor-adoption-whitepaper.mdx:236`, `:546-548` all state these are absent, which
   reads as accurate, but verifying it means reading `electron-builder` config and release workflow
   rather than the evidence path, and the issue scopes this audit to the four surfaces.

5. **Whether the timestamp worker's retry policy leaves captures at `pending` in practice.** V-38 is
   verdicted on the resolution rule (`trustedTime.ts:134-137`), which is sufficient for the claim.
   How often a real deployment actually lands in that state is an empirical question this audit did
   not run.

6. **Screenshot and annotation claims beyond hashing.** `reportHtml.ts:560-566` describes
   content-addressed screenshots and burned annotations. The digest-anchoring is verdicted
   indirectly through V-17/V-19; the "unannotated original remains the stored, digest-anchored copy"
   claim depends on `burnAnnotations` and the annotation pipeline, which sit outside the four
   surfaces the issue names.
