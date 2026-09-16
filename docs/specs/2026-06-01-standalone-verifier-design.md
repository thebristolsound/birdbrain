# Standalone independent verifier + shared verify-core

- **Issue:** [#122](https://github.com/thebristolsound/birdbrain/issues/122) — Court-admissibility (G4). Remediation plan Phase 2 step 7; decisions D11, D12.
- **Status:** Design — revised after first review (2026-06-01); awaiting re-review
- **Date:** 2026-06-01
- **Blocked by:** #117 (signatures), #120 (timestamp tokens), #121 (the evidence package) — all merged.
- **Touches:** a slice of #118 (populating `screenshotHash`) — see [Decision 5](#decision-5-screenshots-are-chain-covered).

## 0. Changes since first draft (review pass)

Incorporated review feedback. The central change is **making the verified
`manifest.jsonl` the verifier's source of truth** and demoting `evidence.json` to
an untrusted index that must reconcile with it. Specifically:

1. The verifier derives the **active capture set** from the verified chain
   (capture entries with no later deletion), not from `evidence.json` — §7.2.
2. Timestamp `.tst` files are **byte-bound** to the signed manifest entry's
   `tsaToken`, not only imprint-checked — §7.3.
3. The verifier **cross-checks the verified chain head** against
   `evidence.json.verificationMaterials.manifestHeadHash`/`manifestHeadIndex` — §7.4.
4. All checks run and **all** failures are collected (no short-circuit); tamper
   tests assert the specific reason is *present*, removing the artifact-sweep
   ordering trap — §7, §11.
5. The screenshot artifact is the **raw** PNG, written regardless of report
   `include.screenshots`/`annotations`; the burned/annotated report image is
   derived display material, not the chain-covered artifact — §8.
6. `src/shared/verify/index.ts` exports only pure functions; the fs-touching
   `evidencePackage.ts` is a separate entry the renderer never imports — §5.
7. Runbook caveat re-aimed: ASCII manifest keys make key-ordering a non-issue; the
   real hand-recompute edges are string escaping and number formatting, plus
   newline-free handling of the `entryHash` hex string — §10.
8. The Node SEA section gains platform-specific re-signing steps and names
   `esbuild` + `postject` as dev dependencies — §9.
9. Added a **trust-model section** (§3.4): the signing key is installation-local
   and *not* an independent anchor; the RFC 3161 timestamp is. A binary PASS is an
   integrity / internal-consistency result, **not** an authenticity claim — that
   rests on the runbook's canonical `openssl ts -verify`, so binary-PASS ≠
   runbook-PASS (Decision 4). Aligned with `docs/reference/threat-model.md`.
10. The binary gains a `--self-check` golden-vector mode so the byte-identical AC
    is literally exercised on the bundled binary (§11), and PR2 adds an
    `EvidencePackageSchema` for the currently-unvalidated `evidence.json` (§7).
11. §7.3 timestamp file lookup no longer assumes `timestamps/{ownId}.tst` —
    `buildEvidenceZip` dedupes token files by content hash, so the path is
    discovered (untrusted) and only the byte-binding to the signed `tsaToken` is
    trusted (§7.3).
12. Runbook gains the **content-bind step** (sha256 of `pages/{id}.mhtml` /
    `screenshots/{id}.png` == the hash inside the *signed* entry) — previously the
    by-hand path proved the chain but never bound the actual bytes to it (§10).
    Also: defined §7.2/§7.3 behaviour when the chain is invalid, made missing-content
    an explicit fail-closed FAIL (§7.3), and stated the hard-delete assumption
    behind §7.5 coverage.

## 1. Purpose

A third party (court, opposing counsel) must be able to re-verify a Birdbrain
evidence package **without running Birdbrain**, and a non-technical reviewer must
be able to do it through a transparent, prebuilt binary. Today all verification
logic lives in the Electron main process and is reachable only from inside the
app.

This work delivers three things and removes one risk:

1. A **process-agnostic verify-core** in `src/shared/verify/` — the single source
   of truth for canonical serialization, hash-chain verification, signature
   verification, and timestamp-token parsing. The app imports it directly; the
   standalone binary bundles it. App-vs-verifier drift becomes impossible by
   construction.
2. A **standalone verifier CLI** (`verifyEvidencePackage`) plus a **prebuilt
   per-OS self-contained binary** (Node SEA) that runs the verify-core against an
   unzipped package and reports PASS/FAIL with a specific reason per check.
3. A **by-hand runbook** (`VERIFY.md`) shipped inside the package that reproduces
   the full integrity claim using only stock tools (`sha256sum`, `openssl`, `jq`)
   and a documented canonicalization recipe — zero Birdbrain code.

## 2. Goals / Non-goals

**Goals**

- Extract a pure, dependency-light verify-core importable by both the app and a
  Node binary. No Electron, SQLite, `keytar`/`safeStorage`, `better-sqlite3`, or
  network code in the core.
- A package verifier that fails closed with a specific reason for each of:
  mutated MHTML, mutated manifest entry, stripped signature, swapped timestamp
  token, swapped screenshot.
- A reproducible Node SEA build script and documented build process.
- A by-hand runbook that fully recomputes `entryHash` (not just file hashes).
- A test asserting in-app and standalone canonical output are byte-identical.

**Non-goals**

- CI release automation (3-OS matrix attaching binaries to GitHub Releases) —
  deferred to a follow-up issue.
- Hand-rolled CMS/PKCS#7 cryptographic verification of the RFC 3161 token
  signature. The canonical CMS check is `openssl ts -verify` in the runbook; the
  binary verifies the **imprint binding** only (see [Decision 4](#decision-4-timestamp-verification-is-imprint-binding-in-the-binary)).
- Implementing `textHash` population (the other half of #118). Only
  `screenshotHash` is in scope.
- Verifying a live case directory. The verifier consumes the #121 export package.

## 3. Background — current state

Verification primitives exist today but are coupled to the main process:

| Primitive | Location | Coupling |
|---|---|---|
| `canonicalStringify(value)` | `src/main/services/canonicalJson.ts` | none — pure |
| `verifyEntrySignature(entryHashHex, sigB64, publicKeyOverridePem?)` | `src/main/services/signingKey.ts` | file already accepts a PEM override; rest of file is `electron.safeStorage` + keygen + fs |
| `parseTimestampToken(der)` + asn1 helpers | `src/main/services/timestamp.ts` | pure `@peculiar/asn1-*`; same file also has network `requestTimestamp` |
| `verifyManifestChain(caseDir)` + `ChainVerifyResult` | `src/main/services/manifest.ts` | reads manifest via `fs`; uses the module-global signing key |
| `ManifestEntrySchema` (discriminated union) | `src/shared/schemas.ts` | already shared (zod) |
| `getTsaTrustBundle(tsaUrl)` | `src/main/services/tsaTrust.ts` | pure (embedded DigiCert root) |

**Dependency-direction hazard:** `signingKey.ts` does `require('electron')` at module
top level (line 13). Anything that transitively imports `signingKey.ts` drags
Electron toward the bundle. The extraction must reverse this: `signingKey.ts`
imports *from* `src/shared/verify/`, never the other way.

### 3.1 The evidence package (#121, produced by `buildEvidenceZip`)

A stored-ZIP containing:

```
evidence.json            # schemaVersion 1: artifacts[] (path, sha256, sizeBytes),
                         #   captures[], operator, verificationMaterials, warnings
manifest.jsonl           # hash-linked, RSA-signed audit chain
report.html              # human-readable report
signing-public-key.pem   # RSA-2048 SPKI public key
tsa-ca-chain.pem         # TSA CA chain + per-token cert chains
pages/{captureId}.mhtml  # forensic captured content (hashed as contentHash)
timestamps/{captureId}.tst   # RFC 3161 tokens (base64-decoded DER), when present
```

`evidence.json.artifacts[]` records a sha256 for every file above, and
`evidence.json.verificationMaterials` records `manifestHeadIndex` +
`manifestHeadHash` (the last chain entry). But `evidence.json` is **not signed** —
only `manifest.jsonl` is (each entry carries an `entryHash` + RSA `signature`, and
`timestamp` entries embed the `tsaToken` inside the signed body). Therefore the
verifier treats the **verified manifest chain as the sole source of truth** and
`evidence.json` as an untrusted convenience index that must *reconcile* with it
(§7). An attacker who edits only `evidence.json` — drops a capture, rewrites an
artifact digest, bumps the head — must be caught by re-deriving everything from
the chain, never by trusting the index.

The package also embeds the **deletion** history: `manifest.jsonl` contains every
`type: 'capture'` entry plus any later `type: 'deletion'` entry, while
`evidence.json.captures` lists only the currently-active captures. The verifier
must reconcile these via active-set semantics (§7.2).

### 3.2 The `entryHash` / canonical-body invariant (load-bearing)

For each manifest entry, `entryHash = sha256(canonicalStringify(body))` where
`body` is the entry with **`entryHash` and `signature` removed**. `signature` is
an RSA-SHA256 (PKCS#1 v1.5) signature over the `entryHash` hex string, base64,
verifiable by stock `openssl dgst -sha256 -verify`. Excluding both from the body
keeps legacy v1 hashes stable and prevents the v2 signature from changing the
hashed bytes. The chain links via `prevHash == prior entryHash`; entries are
also `index`-ordered.

`canonicalStringify` (`src/main/services/canonicalJson.ts`): recursive; object
keys sorted with `Array.prototype.sort()` (UTF-16 code-unit order); `undefined`
properties dropped; arrays preserve order with holes/`undefined` → `null`;
primitives and keys via `JSON.stringify`. This is JCS-shaped but not a JCS
implementation — see the [runbook caveat](#7-by-hand-runbook-verifymd).

### 3.3 Screenshot coverage gap

`ManifestCaptureEntrySchema` already **reserves** `screenshotHash` and `textHash`
as optional fields (`src/shared/schemas.ts:137-138`), but:

- Nothing in the capture-write path populates `screenshotHash`
  (`captureLifecycle.ts` appends a `type: 'capture'` entry with `contentHash`
  only).
- `ManifestEntryInput`'s capture variant (`manifest.ts:53-64`) does not accept
  `screenshotHash`.
- `buildEvidenceZip` adds no standalone screenshot artifact — the only chained
  per-capture hash is `contentHash` (the MHTML). (Screenshots are referenced by
  the general report export, but are not an independently hashed package file.)

So AC#5's "swapped screenshot" tamper test currently has **no target artifact in
the chain**. Decision 5 resolves this.

### 3.4 Trust model — what a PASS does and does not claim

Birdbrain reports **two orthogonal axes** (see `docs/reference/threat-model.md`):
*integrity* (content hash + hash-linked, per-entry RSA signature) and *trusted
time* (RFC 3161 token from an external TSA). The verifier must report against both
without conflating them, and must not over-claim.

**The signing key is installation-local and is *not* an independent trust anchor.**
`signing-public-key.pem` ships *inside* the package; the private key is
`safeStorage`-wrapped on the operator's machine (#117). The per-entry signature
therefore defeats **casual tampering** — copying the case directory and editing a
capture / hash / chain link with ordinary tools breaks verification — but it does
**not** defend against a determined operator running Birdbrain's own code, who
controls the key and can mint a fresh, internally-consistent (re-signed) chain with
a matching public key. This is an inherent limit of any locally-held key; the
threat model states it plainly so no brief over-claims it.

**The RFC 3161 timestamp is the independent anchor** that closes this gap, for
*timestamped* captures only: an external TSA signed the content hash, so the bytes
provably existed by the stamped time and cannot be back-dated or forged regardless
of local-machine control.

Consequences for this verifier — stated so the binary's output is honest:

- **A binary PASS means:** the chain is internally consistent and signature-valid
  against the *bundled* key; every active capture's content / screenshot binds to
  the signed chain; and every present timestamp token's imprint binds its capture
  and its bytes match the signed entry. It is an **integrity + internal-consistency**
  result — not a standalone proof of authenticity against the determined-operator
  threat.
- **Authenticity of timestamped captures rests on the canonical
  `openssl ts -verify`** step in the runbook (§10), which validates the TSA's CMS
  signature against the publicly-trusted DigiCert root — code Birdbrain never
  hand-rolls (Decision 4). Because the binary performs the **structural** imprint /
  byte binding only, **binary-PASS ≠ runbook-PASS**: a *forged* token (correct
  imprint, invalid TSA signature) passes the binary and is caught only by
  `openssl ts -verify`. The binary's report says so explicitly and points to the
  runbook.

## 4. Decisions

### Decision 1 — Binary technology: Node SEA
Node SEA (Single Executable Applications) over `pkg` (archived by Vercel). The
engine is already `node >=20.19.0`; the verify-core has **no native deps** (zod +
`@peculiar/asn1-*` + Node `crypto`/`fs` are all pure JS), so SEA is viable and
removes a third-party packer from the trust story.

### Decision 2 — Input is an unzipped package directory
`verifyEvidencePackage(dir)` takes a path to an unzipped package. (A thin
"unzip-then-verify" convenience for a `.zip` argument is optional polish, not
required by any AC.)

### Decision 3 — By-hand runbook is complete (includes canonicalization)
`sha256sum` + `openssl` alone cannot recompute `entryHash` from an entry body, so
a body-field mutation that leaves `entryHash`+`signature` intact would be
invisible by hand. The runbook therefore documents a precise canonicalization
recipe (`jq -cS` after stripping `entryHash`+`signature`) so a reviewer can fully
recompute `entryHash`. "Zero Birdbrain code" becomes "stock tools + a documented
algorithm."

### Decision 4 — Timestamp verification is imprint-binding in the binary
The binary checks that each token's `messageImprint` equals the capture's
`contentHash` (a foreign/swapped token's imprint won't match → FAIL). Full
cryptographic CMS verification of the TSA signature against the cert chain is the
runbook's `openssl ts -verify` step. This matches the established trustedTime
decisions ("canonical verification is `openssl ts -verify`, never hand-rolled
CMS crypto"). Consequently **binary-PASS is not an authenticity claim** for trusted
time — only the runbook's CMS check is (see §3.4). The binary's report labels the
timestamp result "structural (imprint / bytes) — run `openssl ts -verify` for
canonical TSA verification."

### Decision 5 — Screenshots are chain-covered
Per your choice, screenshots become first-class **chained** artifacts (stronger
than evidence.json-only hashing, because the chain is RSA-signed). This
implements the `screenshotHash` slice of #118:

- Hash the screenshot PNG at capture time and write the (already-reserved)
  `screenshotHash` into the `type: 'capture'` manifest entry — signed and chained.
- Add `screenshots/{captureId}.png` to the package + an `evidence.json` artifact +
  the per-capture record.
- No schema migration / version bump (field already exists, already optional,
  already within v2). Legacy captures lack it → grandfathered; the verifier
  treats an absent `screenshotHash` (no chained hash) as "nothing to verify" (SKIP).
  A *present* `screenshotHash` requires the screenshot file — a missing file is a
  FAIL, not a skip (§7.3).

### Decision 6 — Build depth: script + docs now, CI later
This work ships `scripts/build-verifier.mjs` and a documented per-OS process.
Binaries are buildable and verifiable now. A GitHub Actions release matrix is a
follow-up issue.

### Decision 7 — Two PRs
- **PR1:** extract verify-core + rewire app (pure refactor).
- **PR2:** screenshot coverage + package verifier + CLI/binary + runbook + tamper
  tests.

PR2 is the larger of the two because Decision 5 touches the capture path. The
screenshot-coverage slice (Decision 5) may be split into its own PR if review
prefers; default is two.

## 5. Architecture — `src/shared/verify/`

Pure, Node-only modules. Permitted imports: Node `fs`/`crypto`/`path`, `zod`,
`@peculiar/asn1-*`, and other `src/shared/*`. **Forbidden:** anything under
`src/main`, `electron`, `better-sqlite3`, `keytar`, `hono`, network calls.

| Module | Exports | Source |
|---|---|---|
| `canonicalJson.ts` | `canonicalStringify` | moved from `main/services/canonicalJson.ts` |
| `signature.ts` | `verifyEntrySignature(entryHashHex, sigB64, publicKeyPem)` | moved from `main/services/signingKey.ts` |
| `timestampToken.ts` | `parseTimestampToken`, `extractTimestampTokenCertificatesPem`, `ParsedTimestampToken`, asn1 helpers (`generalNameToString`, `signerCommonName`, `commonNameOf`, `derToPem`, `bufToHex`), OID consts | moved from `main/services/timestamp.ts` |
| `manifestChain.ts` | `verifyManifestChainText(jsonl: string, opts: { publicKeyPem: string }): ChainVerifyResult`, `ChainVerifyResult` | logic moved from `manifest.ts:verifyManifestChain` |
| `evidencePackage.ts` | `verifyEvidencePackage(dir: string): PackageVerifyResult`, result types | **new** — the only module that touches `fs` |
| `index.ts` | barrel: re-exports the **pure** functions above (`canonicalStringify`, `verifyEntrySignature`, `parseTimestampToken`, `verifyManifestChainText`) + `ManifestEntrySchema` from `@shared/schemas`. **Does not** re-export `evidencePackage.ts`. | — |

**Design rule:** leaf functions take *data* (strings, buffers, PEM), not paths,
so they are unit-testable with no fixtures. Only `evidencePackage.ts` performs
`fs` reads.

**Bundle-safety rule:** the barrel (`index.ts`) re-exports only the pure
data-functions; `evidencePackage.ts` (which imports `fs`) is reachable solely via
its own subpath and is imported by the CLI and main process, never the renderer.
This keeps `fs` out of any renderer/browser bundle that might import the core for
`canonicalStringify` or `ManifestEntrySchema`. (The renderer continues to verify
via IPC and should not import verify-core at all; the split is defence-in-depth.)

`signature.ts` requires the caller to pass the PEM explicitly — there is no
module-global key in the core. `verifyEntrySignature` keeps its current
fail-closed behaviour: any `crypto` error → `false`; an empty/missing PEM is a
caller error.

### 5.1 `verifyManifestChainText` (extracted chain logic)

Identical algorithm to today's `verifyManifestChain`, with two changes:
- Operates on the JSONL **string** (caller reads the file).
- Takes `publicKeyPem` explicitly instead of reading the module-global key.

It returns the existing `ChainVerifyResult` shape (`valid`, `brokenAt?`,
`reason?`, `trustedTime`). The `trustedTime` field stays as-is for this slice
(integrity-focused). The reason strings are preserved verbatim ("Invalid JSON",
"Invalid entry shape", "Index mismatch", "Chain link broken", "Entry hash
mismatch", "Invalid signature") so existing tests and any operator docs continue
to match.

## 6. App rewiring (PR1 — pure refactor, no behaviour change)

- Move the four leaf modules into `src/shared/verify/`.
- `main/services/canonicalJson.ts`, `signingKey.ts`, `timestamp.ts` re-export from
  the shared modules (or are deleted and call sites updated via Serena
  references) so no main-process caller breaks. Key management
  (`initSigningKey`, `signEntryHash`, `getPublicKeyPem`, `safeStorage` wrap/unwrap,
  keygen) and network (`requestTimestamp`, `buildTimestampRequest`) **stay in
  `main/`** and import the moved pure functions.
- `main/services/manifest.ts` keeps `verifyManifestChain(caseDir)` as a thin fs
  wrapper: read the manifest file, call `verifyManifestChainText(jsonl, {
  publicKeyPem: getPublicKeyPem() })`. All app call sites (`captureLifecycle`,
  export, IPC) are unchanged.
- `export.ts` imports `parseTimestampToken` / `extractTimestampTokenCertificatesPem`
  from the shared module.

**Guards (PR1):**
- A golden-vector test pinning `canonicalStringify` output for a representative
  entry body (frozen bytes).
- A test that `verifyManifestChain(caseDir)` (app path) and
  `verifyManifestChainText(jsonl, {publicKeyPem})` (core) agree on the same
  fixture chain.

## 7. The package verifier — `verifyEvidencePackage(dir)`

**Trust model:** the signed `manifest.jsonl` is the source of truth. The verifier
first establishes the chain, then derives *what must exist* from the chain, then
binds package files to the chain, and finally reconciles the unsigned
`evidence.json` index against that verified truth. `evidence.json` is never used
to decide *what* to check — only to detect that the index itself was edited.

**Result shape:** `{ pass: boolean, checks: Array<{ name, status:
'pass'|'fail'|'skip', reason? }> }`. The verifier runs **every** check and
collects **all** failures — it does not short-circuit. `pass` is true iff no check
has status `fail` (`skip` is allowed). This removes any ordering dependence
between checks: a single tamper that trips two checks reports both reasons, and
tests assert the specific reason is *present* (§11).

Checks, in execution order:

### 7.1 Chain verification (root of trust)
`verifyManifestChainText(manifestJsonl, { publicKeyPem })` using the bundled
`signing-public-key.pem`. FAIL surfaces the chain reason + `brokenAt` index
("Invalid JSON", "Invalid entry shape", "Index mismatch", "Chain link broken",
"Entry hash mismatch", "Invalid signature"). Catches a mutated manifest body field
(entryHash recompute), a stripped/forged signature, and broken linkage. If the
chain is invalid the remaining checks still run, but only as **advisory
diagnostics** with no PASS weight (the verdict is already FAIL): §7.2/§7.3 operate
on the schema-valid entries parsed up to `brokenAt`, since no entry past the break
can be trusted.

Amended 2026-09 (#691): that bound is what the verifier now applies, for every
chain break reason and not only the parse and shape ones a re-parse stops at
by itself. Two cross-checks are deliberately outside it and read the manifest
**as shipped** — the export-entry linkage (§7.2b) and the head comparison
(§7.4). Neither derives a fact about the case: each compares one package file
against another, and a genuine `export-entry.json` links to the shipped head, so
handing them a truncated head would report a chain break as `index edited` and
strip a signed selection of its scope, turning designed absences into missing-file
FAILs.

### 7.2 Active-capture set (derived from the verified chain)
From the verified entries, compute the **active set**: every `type: 'capture'`
entry whose `captureId` has **no later** `type: 'deletion'` entry. Deleted
captures are expected to be absent from the package and are **not** required to
have files. This set — not `evidence.json.captures` — drives §7.3.

### 7.3 Per-active-capture binding (chain → files)
For each active capture entry (with its signed `contentHash` / optional
`screenshotHash`):
- **Content:** `pages/{id}.mhtml` must exist and `sha256` == `contentHash`.
  Missing → FAIL "capture <id>: content file missing from package". Mismatch →
  FAIL "capture <id>: content hash does not match manifest". This is a **conscious
  fail-closed** choice: export tolerates a missing-content active capture
  (`mhtmlPath: null`, counted in `warnings.missingContentCaptureCount`) and still
  emits a package, but a package whose active capture lacks its evidence bytes must
  not verify as PASS — so the verifier FAILs, not SKIPs, it.
- **Screenshot:** if the entry has `screenshotHash`, `screenshots/{id}.png` must
  exist and `sha256` == `screenshotHash`. Missing → FAIL "capture <id>: screenshot
  file missing". Mismatch → FAIL "capture <id>: screenshot hash does not match
  manifest". No `screenshotHash` → SKIP (grandfathered).
- **Timestamp:** for each verified `type: 'timestamp'` entry whose
  `captureContentHash` == this capture's `contentHash` and that carries a
  `tsaToken`: **locate** the `.tst` file (its name is *not* trusted —
  `buildEvidenceZip` dedupes token files by content hash and names each after the
  *first* capture sharing that hash, so a capture is not guaranteed a
  `timestamps/{ownId}.tst`). Discover the path via the untrusted
  `evidence.json.captures[].timestampTokenPaths`, falling back to scanning
  `timestamps/`; a token entry with no resolvable file → FAIL "capture <id>:
  timestamp token file missing". The located file's **bytes must equal**
  `base64decode(entry.tsaToken)` (binding the file to the *signed* token, not just
  any token), **and** the token's `messageImprint` must equal `contentHash`. Byte
  mismatch → FAIL "capture <id>: timestamp token does not match the signed manifest
  (swapped token)". Imprint mismatch → FAIL "capture <id>: timestamp imprint does
  not bind this capture". No such entry / no `tsaToken` → SKIP (pending or
  grandfathered). The file *location* carries no security weight — the byte-binding
  to the signed `tsaToken` is the real check — so trusting `evidence.json` only to
  *find* the file is sound. (Dedup trigger: two active captures with identical
  content bytes → identical SHA-256 → one shared token file.)

### 7.4 Head cross-check (index integrity)
`evidence.json.verificationMaterials.manifestHeadIndex` / `manifestHeadHash` must
equal the verified chain's last-entry `index` / `entryHash`. Mismatch → FAIL
"evidence.json head does not match the verified manifest (index edited)". Not a
trust anchor, but a precise signal that the unsigned index was altered.

### 7.5 evidence.json reconciliation (secondary)
The unsigned index must agree with the verified truth:
- **Coverage:** the active-set capture ids (§7.2) and `evidence.json.captures[].id`
  must be the same set. A verified-but-missing capture → FAIL "evidence.json omits
  verified capture <id>". An index entry with no verified capture → FAIL
  "evidence.json lists capture <id> absent from the verified manifest". This
  equality **usually** holds because deletion hard-removes the DB row
  (`DELETE FROM captures WHERE id = ?`), so `evidence.json.captures` normally equals
  the active set. It does not always hold: the delete is write-ahead, so a crash
  between appending the signed deletion entry and removing the row leaves a live row
  for a capture the chain records as deleted (#622), and an export taken in that
  window trips this rule. The verifier names the fact the chain establishes and does
  not attribute a cause, because an edited index that re-adds a deleted capture
  reaches the same branch. If deletion ever becomes a soft-delete, this rule must be
  re-derived from the active set, not assumed one-to-one.
- **Artifact sweep:** for each `evidence.json.artifacts[]` entry, `sha256(file)` ==
  the recorded digest. Mismatch → FAIL "artifact <path>: sha256 does not match
  evidence.json". This is index self-consistency; the authoritative content bind is
  §7.3. (A file mutated *together with* its artifact record passes the sweep but
  still fails §7.3 against the signed chain.)

Before any of the above, `evidence.json` is parsed and structurally validated
against a new minimal zod schema covering the fields the verifier consumes
(`verificationMaterials.manifestHead*`, `captures[].id`, `artifacts[]`). There is
no schema for `evidence.json` today — it is emitted by a bare `JSON.stringify` in
`buildEvidenceZip` — so PR2 adds `EvidencePackageSchema` to `src/shared/schemas.ts`
and (ideally) asserts it in the export test. An unparseable/invalid index is itself
a FAIL ("evidence.json missing/invalid: <detail>"), but §7.1–§7.3 still run from
`manifest.jsonl` so a corrupt index never masks chain results.

CLI exit code: `0` on PASS, `1` on FAIL. Output: a readable per-check report
listing every check and all collected reasons. The report labels each timestamp
check **structural** (imprint + byte binding) and prints a one-line pointer that
canonical TSA authenticity is the runbook's `openssl ts -verify` (§3.4, §10). A
PASS banner never asserts "authentic" — it asserts "integrity + internal
consistency verified."

The verifier consumes the public key and TSA chain **from the package** — it does
not reach into any Birdbrain installation or settings.

## 8. Screenshot chain coverage (PR2)

The chain-covered artifact is the **raw, unmodified** screenshot PNG — the exact
bytes Birdbrain persisted at capture time. The report's annotated/"burned"
screenshot (built by `export.ts` via `burnAnnotations` into base64 for
`report.html` when `include.screenshots` / `include.annotations === 'burned'`) is
**derived display material** and is *not* hashed into the chain.

- `captureLifecycle.ts`: when a screenshot is captured, compute `sha256` of the
  **persisted PNG bytes** (the same bytes a later `readCaptureFile(caseId, id,
  'png')` returns) and pass `screenshotHash` on the `type: 'capture'` entry —
  signed and chained. No screenshot → omit (grandfathered). Hashing the persisted
  bytes (not a re-encoded copy) is what lets the verifier reproduce the digest from
  the package file.
- `manifest.ts`: extend `ManifestEntryInput`'s capture variant with
  `screenshotHash?: string`; thread it through `appendManifestEntry` into the
  canonical body (already accepted by `ManifestCaptureEntrySchema`).
- `export.ts` `buildEvidenceZip`: **always** add `screenshots/{captureId}.png` from
  `readCaptureFile(caseId, id, 'png')` (raw bytes) whenever a screenshot exists —
  independent of the report `include.screenshots` / `include.annotations` options,
  which only affect `report.html`. Register it in `artifacts[]` and add
  `screenshotPath` + `screenshotSha256` to the per-capture evidence record.
- Verification: §7.3 binds the package PNG to the **chained, signed**
  `screenshotHash`, not to the unsigned `evidence.json` artifact.

## 9. Standalone CLI + Node SEA binary (PR2)

- `src/verifier/cli.ts`: argv → package dir → `verifyEvidencePackage(dir)` →
  print report, set exit code. No dependency on `src/main`.
- Build (`scripts/build-verifier.mjs`):
  1. `esbuild` bundles `src/verifier/cli.ts` + `zod` + `@peculiar/asn1-*` into a
     single CJS file (resolving the `@shared/*` alias), targeting the project's
     Node version. (`esbuild` ships transitively via Vite but must be added as a
     **direct** dev dependency for the script to import it.)
  2. Generate a SEA blob (`node --experimental-sea-config sea-config.json`).
  3. Copy the `node` executable and inject the blob with `postject`.
  4. **Re-sign per OS** — injection invalidates the host binary's code signature:
     - macOS: `codesign --remove-signature` before injection, `codesign --sign -`
       (ad-hoc) after; otherwise Gatekeeper blocks it.
     - Windows: remove the signature (`signtool remove /s`) before and re-sign
       after; an unsigned/invalid-signature `.exe` trips SmartScreen.
     - Linux: no signing step.
- **Cross-build limitation:** Node SEA produces a binary for the OS it runs on;
  per-OS binaries are built on their respective OS (documented; matches Decision 6
  deferring the CI matrix).
- **New dev dependencies:** `postject` (SEA blob injection, Node's documented
  approach) and a direct `esbuild` entry — both dev-only, confirmed before adding
  per repo policy (see Risks).
- The binary is published separately (releases) and **referenced** by the
  runbook; it is not shipped inside every package (per-OS, large).

## 10. By-hand runbook — `VERIFY.md`

Added into the package by `buildEvidenceZip`. Steps, all stock tools:

1. **File integrity (index self-consistency):** `sha256sum` each artifact; compare
   to `evidence.json`. This only proves the files match the *untrusted* index — the
   authoritative content bind is step 5.
2. **Signature:** for an entry, extract `entryHash` + `signature`. Write the
   `entryHash` hex to a file **with no trailing newline** (`printf %s` /
   `echo -n`) — the signature is over the bare hex string, so a stray newline makes
   verification fail spuriously. Decode the base64 signature to bytes, then
   `openssl dgst -sha256 -verify signing-public-key.pem -signature sig.bin
   entryhash.txt`.
3. **Recompute `entryHash` (canonicalization recipe):** strip `entryHash` and
   `signature`, canonicalize with `jq -cS` (sort keys, compact), `sha256sum`,
   compare. **Caveats** — these, not key ordering, are the real edges: manifest
   keys are fixed ASCII, so `jq`'s codepoint key sort and `canonicalStringify`'s
   UTF-16 code-unit sort agree. What *can* differ is (a) **string escaping** of
   non-ASCII or control characters inside values like `url` / `operatorName` /
   `title`, and (b) **number formatting** of `index` / `sizeBytes`. Both
   `canonicalStringify` (via `JSON.stringify`) and `jq -c` emit minimal integer
   forms and UTF-8 literals for these inputs, so they match in practice; the recipe
   flags them as where to look if a hand recompute ever disagrees. The binary and
   app share one `canonicalStringify`, so only the *hand* recipe carries this.
4. **Chain linkage:** confirm each `prevHash` equals the prior entry's
   `entryHash`, and `index` increments from 0.
5. **Content bind (the load-bearing step for the evidence itself):** for each
   `type: 'capture'` entry, `sha256sum pages/{id}.mhtml` and confirm it equals the
   `contentHash` *inside that signed entry* (not the value in `evidence.json`); if
   the entry has a `screenshotHash`, do the same for `screenshots/{id}.png`. This
   ties the actual captured bytes to the signed chain — without it a reviewer could
   verify a pristine signed chain yet never confirm the MHTML/PNG bytes are the ones
   it attests.
6. **Timestamp:** `openssl ts -verify -in <token.tst> -queryfile <query>` (or
   `-digest <contentHash>`) against `tsa-ca-chain.pem`.

The runbook states the trust model explicitly: the signed `manifest.jsonl` is the
root of trust; `evidence.json` is a convenience index whose own integrity is
established by re-deriving the chain.

## 11. Testing (PR2)

- **Clean PASS (integration):** build the SEA binary, spawn it against a good
  fixture package on a machine with no Birdbrain install, assert exit 0 + PASS.
  (Gating the test on a freshly built binary is documented; unit-level package
  verification runs against `verifyEvidencePackage` directly without the binary.)
- **Tamper FAILs:** from one good fixture, derive mutated copies. Because the
  verifier collects all failures (§7), each test asserts the expected
  manifest-derived reason is **present** in `checks` (not that it is the only or
  first failure), so artifact-sweep co-firing never makes a test brittle:
  1. mutated `pages/{id}.mhtml` → "content hash does not match manifest" present
     (§7.3). (The §7.5 artifact sweep also fires; both are fine.)
  2. mutated manifest body field → "Entry hash mismatch" present, with `brokenAt`
     (§7.1).
  3. stripped signature on a v2 entry → "Invalid signature" present (§7.1).
  4. swapped timestamp token (a valid token from another capture, copied over
     `timestamps/{id}.tst`) → "timestamp token does not match the signed manifest"
     present (§7.3 byte-binding); the imprint check fails too.
  5. swapped screenshot → "screenshot hash does not match manifest" present
     (§7.3). The fixture swaps the file **and** its `evidence.json` artifact record
     so the §7.5 sweep passes and the *chained* `screenshotHash` bind is
     demonstrably the check that catches it.
  6. `evidence.json` edited only (drop an active capture / bump
     `manifestHeadIndex`) → "evidence.json omits verified capture" / "head does not
     match" present (§7.2/§7.4/§7.5), proving the index cannot hide a gap.
  7. deleted-capture fixture (a `deletion` entry + no file) → PASS (no failure),
     proving §7.2 does not require files for deleted captures.
- **Byte-identical (AC):** the AC asks for in-app vs *standalone* output identity.
  Post-extraction these share one module, but the binary is esbuild-bundled, so the
  bundling transform is the real risk. The binary therefore exposes a `--self-check`
  mode that runs `canonicalStringify` over the **frozen golden vector** and prints
  the bytes; the test spawns the built binary's `--self-check` and asserts its
  output is byte-identical to the in-app golden vector. This literally exercises
  "standalone output" rather than arguing it by construction, and is backed by the
  PR1 app-vs-core agreement test.

## 12. Acceptance-criteria mapping

| AC | Satisfied by |
|---|---|
| Process-agnostic `src/shared` verify-core; app imports it | §5, §6 |
| Prebuilt per-OS binary bundles the same core | §9 |
| `sha256sum` + `openssl` runbook shipped in package, works by hand | §10 (+ `jq` recipe per Decision 3) |
| Clean-machine binary verifies good package → PASS | §11 clean-PASS integration test |
| Tamper FAILs with a specific reason (5 cases) | §7.1–§7.3 reasons, §11 tamper tests 1–5; screenshot case enabled by §8 (tests 6–7 cover index-edit + deletion semantics beyond the AC) |
| In-app and standalone canonical output byte-identical | §6 golden vector + §11 binary `--self-check` |

## 13. Risks & open items

- **Dependency direction:** the `electron` top-level `require` in `signingKey.ts`
  means the extraction must be verified to leave no `src/main`/`electron` import
  reachable from `src/shared/verify/**`. Add a lint/test guard or an esbuild
  "no electron in bundle" assertion.
- **Renderer bundle safety:** verify-core uses Node `crypto`/`fs`, which cannot run
  in the renderer. The barrel / `evidencePackage` split (§5) keeps `fs` out of any
  accidental renderer import; the guard test should also assert no
  `src/shared/verify/**` module is imported by `src/renderer/**`.
- **Deletion semantics:** the active-set rule (§7.2) is load-bearing — getting it
  wrong either fails valid packages containing deleted captures or lets the index
  hide a gap. Cover both directions in tests (§11 cases 6–7).
- **#118 overlap:** populating `screenshotHash` (Decision 5) is a behaviour change
  in the capture path. Confirm it belongs in #122 rather than waiting on #118.
- **`jq` hand-recompute caveat:** documented, not eliminated. Key ordering is a
  non-issue (ASCII keys); the residual edges are string escaping / number
  formatting in values (§10). The binary and app share one `canonicalStringify`, so
  they always agree; only the *hand* recipe carries this.
- **`postject` dependency:** SEA blob injection needs `postject` (Node's
  documented approach). New dev dependency — confirm before adding per repo
  policy.
- **SEA + cross-OS:** binaries built per-OS; no cross-compilation. Acceptable
  under Decision 6.
- **PASS must not over-claim:** integrity-PASS is not authenticity against a
  determined operator (§3.4). The risk is a reader treating binary-PASS as a
  standalone authenticity proof. Mitigation: honest report wording + the runbook's
  `openssl ts -verify` as the canonical anchor; align all PASS copy with
  `docs/reference/threat-model.md`.
- **No `evidence.json` schema today:** PR2 must add `EvidencePackageSchema` (§7) —
  the index is currently emitted without validation.

## 14. Out of scope (follow-ups)

- GitHub Actions release matrix attaching binaries to Releases.
- `textHash` population (the rest of #118).
- `.zip`-argument convenience wrapper for the CLI.
