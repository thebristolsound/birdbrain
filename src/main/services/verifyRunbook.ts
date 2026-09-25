// The by-hand verification runbook (#122 §10), shipped INSIDE every evidence
// package via buildEvidenceZip. It reproduces the full integrity claim using
// only stock tools (sha256sum, openssl, jq) plus a documented canonicalization
// recipe — zero Birdbrain code.
//
// CANONICAL TSA CHECK LIVES HERE: the programmatic verifier (and the standalone
// binary) does timestamp IMPRINT + BYTE-BINDING only. The `openssl ts -verify`
// step below is what proves TSA authenticity, so a binary PASS is NOT a
// timestamp-authenticity claim (binary-PASS != runbook-PASS).

import { DIGICERT_TRUSTED_ROOT_G4_SHA256 } from '@main/services/tsaTrust'
import { EXPORT_ENTRY_REQUIRED_SCHEMA_VERSION } from '@shared/schemas'
import {
  CAPTURE_PACKAGE_DIRECTORY,
  PACKAGE_ROOT_FILES,
  TIMESTAMP_PACKAGE_DIRECTORY,
  capturePagePath,
  screenshotPath,
  timestampTokenPath
} from '../../packages/evidence-package-layout/index'

// Every member of the package this runbook names, read from the Package
// Layout so the prose, the commands and the files the exporter writes agree.
const ROOT = PACKAGE_ROOT_FILES

export const VERIFY_RUNBOOK = `# Verifying this evidence package by hand

This package can be re-verified by a third party **without running Birdbrain**,
using only stock tools: \`sha256sum\`, \`openssl\`, and \`jq\`.

## One command — \`${ROOT.verifyScript}\`

\`${ROOT.verifyScript}\` is enclosed with this package and is the executable
form of the six steps below. Run it from the unpacked package directory:

\`\`\`sh
sh ${ROOT.verifyScript}
\`\`\`

It prints its verdict, then a line per check, then the verdict in full, and exits
non-zero naming the step that failed — 2 if
a tool it needs is missing, and 3 (\`INCOMPLETE\`) if a check could not be run at
all, which this package can cause by enclosing no root for a non-default
timestamp authority. A skipped check is never folded into its \`PASS\`. It is
a convenience, not the authority: what makes this package checkable is that every
step below can be run by hand, which is what the rest of this document is for.

A package that encloses a signed selection reports the exhibits it deliberately
leaves out as a single counted line. Run \`sh ${ROOT.verifyScript} -v\` to
list them one by one.
Read step 6a before treating its PASS as proof of trusted time.

## Trust model (read first)

The signed \`${ROOT.manifest}\` is the **root of trust**. Every entry carries an
\`entryHash\`; entries are hash-linked (\`prevHash\` == the prior entry's
\`entryHash\`) and \`index\`-ordered. Entries with \`schemaVersion\` 2 or above
additionally carry an RSA \`signature\` over that hash.

**Not every entry is signed.** Per-entry signing was added after the chain
itself, so a case that predates it can contain \`schemaVersion\` 1 entries with
no \`signature\` field. They are legitimate, and they are not silently accepted:
what covers them is chain linkage (step 3) and any RFC 3161 timestamp appended
later (step 6), not a signature. Step 2 does not apply to them. Identify them
with:

\`\`\`sh
jq -r 'select((.schemaVersion // 1) < 2) | "index \\(.index) \\(.type) — unsigned"' ${ROOT.manifest}
\`\`\`

A chain may go v1 → v2 as the tool was upgraded. It must never go **back**: a
\`schemaVersion\` 1 entry appearing after a signed one is tampering, because
rewriting a signed entry as an unsigned one needs no private key. Birdbrain's
verifier rejects that; a hand check should too.

\`${ROOT.evidenceIndex}\` is an **unsigned convenience index**. Do not trust it on its
own — its own integrity is established by re-deriving everything from the chain.
The signing key (\`${ROOT.signingPublicKey}\`) is installation-local and is **not**
an independent trust anchor; it defeats casual tampering. The independent anchor
for *timestamped* captures is the RFC 3161 timestamp, verified in step 6.

\`${ROOT.exportEntry}\`, when present, is the **signed export entry for this very
package** — the one entry the bundled \`${ROOT.manifest}\` cannot contain, because
the manifest copy is sealed just before the entry is appended to the live case
manifest. Verify it exactly like a manifest line before using anything in it:
its \`signature\` with the step 2 recipe, its \`entryHash\` with the step 3
recipe, and its \`prevHash\` must equal the \`entryHash\` of the **last line** of
\`${ROOT.manifest}\`. Once verified, its \`scope\` / \`captureIds\` fields are the
authoritative statement of what this package encloses: \`scope: "selection"\`
means the operator deliberately exported a subset, and \`captureIds\` lists
exactly the captures whose files are enclosed. The manifest still covers the
whole case — the chain is never sliced.

A package with **no** \`${ROOT.exportEntry}\` is not automatically an old one. The
only thing dating it is \`${ROOT.evidenceIndex}\`'s \`schemaVersion\`, which names the era
the package was sealed in:

\`\`\`sh
jq '.schemaVersion' ${ROOT.evidenceIndex}
\`\`\`

Read it as a number: \`2.0\` and \`2e0\` are both version 2. If it prints
\`null\`, a string, or anything that is not a positive whole number, the index
states no era and Birdbrain's verifier fails it as malformed. So does
\`${ROOT.verifyScript}\`, and so should a hand check: there is no stated era
for the leniency below to rest on, so an absent export entry cannot be excused
as an age. At ${EXPORT_ENTRY_REQUIRED_SCHEMA_VERSION} or above the package was sealed with an export entry, so an
absent one is a **removed file**, not an age: treat the package as tampered
with, and accept no statement of its scope. Birdbrain's verifier and
\`${ROOT.verifyScript}\` both fail such a package; a hand check should too.

Below ${EXPORT_ENTRY_REQUIRED_SCHEMA_VERSION} the version does not settle it. Packages that predate this file
were written at that version, and so were packages sealed with one, so an
absent entry is either an age or a removed file. Verify the package as enclosing
every active capture, with no signed statement of its scope, and do not read
the version as dating it. The unsigned index cannot prove an era in either
direction: a version edited downward from ${EXPORT_ENTRY_REQUIRED_SCHEMA_VERSION} reaches this same lenient
reading and looks exactly like a genuinely old package, so a version below ${EXPORT_ENTRY_REQUIRED_SCHEMA_VERSION}
is a claim, not a date. What settles it is knowing which build sealed this one.

This threshold is fixed at ${EXPORT_ENTRY_REQUIRED_SCHEMA_VERSION}. Later index versions raise
\`schemaVersion\` as the index gains fields, and they stay above it, so a
package sealed at ${EXPORT_ENTRY_REQUIRED_SCHEMA_VERSION} is never re-admitted to the lenient reading by a
newer Birdbrain.

**What the programmatic/binary verifier does vs. this runbook:** the binary
checks timestamp tokens **structurally only** (the token's message imprint binds
the capture's content hash, and the \`.tst\` bytes match the signed manifest
token). It does **not** verify the TSA's CMS signature. That canonical check is
step 6's \`openssl ts -verify\`. A binary PASS therefore means *integrity +
internal consistency*, **not** timestamp authenticity — this runbook's
\`openssl ts -verify\` is what proves the TSA actually signed the imprint.

## Package contents

| File | Role |
|---|---|
| \`${ROOT.manifest}\` | Signed, hash-linked audit chain (root of trust) |
| \`${ROOT.signingPublicKey}\` | RSA public key for the per-entry signatures |
| \`${ROOT.verifyScript}\` | The steps below as a runnable script (see above) |
| \`${ROOT.tsaRoot}\` | Self-signed TSA root — the trust anchor for step 6 (absent when no anchor is bundled for the configured authority) |
| \`${ROOT.tsaIntermediates}\` | Responder + intermediate certs lifted from the tokens (chain-building only, never trusted on their own) |
| \`${capturePagePath('{captureId}')}\` | Captured content (hashed as \`contentHash\`) |
| \`${screenshotPath('{sha256}')}\` | Captured screenshot (hashed as \`screenshotHash\`) |
| \`attachments/\`, \`images/\`, \`documents/\` | Committed exhibits of other kinds, one file per exhibit named \`{exhibitId}\` plus its stored extension (hashed as the \`exhibit\` entry's \`contentHash\`) |
| \`{exhibit directory}/{exhibitId}_{suffix}\` | Derived files, enclosed beside the exhibit they were computed from — a capture's thumbnail sits in \`${CAPTURE_PACKAGE_DIRECTORY}/\` (hashed as the \`derivation\` entry's \`outputHash\`) |
| \`${TIMESTAMP_PACKAGE_DIRECTORY}/*.tst\` | RFC 3161 tokens, when present (see step 6c on their encoding) |
| \`${ROOT.evidenceIndex}\` | Unsigned index (reconcile, do not trust) |
| \`${ROOT.exportEntry}\` | Signed export entry for this package — scope of the enclosed captures (absent only from packages whose \`${ROOT.evidenceIndex}\` states a \`schemaVersion\` below ${EXPORT_ENTRY_REQUIRED_SCHEMA_VERSION}; see Trust model) |

## Step 1 — File integrity (index self-consistency)

\`sha256sum\` each artifact and compare to \`${ROOT.evidenceIndex}\`. This only proves the
files match the **untrusted** index — the authoritative content bind is step 5.

\`\`\`sh
jq -r '.artifacts[] | "\\(.sha256)  \\(.path)"' ${ROOT.evidenceIndex} | sha256sum -c -
\`\`\`

## Step 2 — Entry signature (\`schemaVersion\` 2 and above)

For a **signed** manifest entry, verify its RSA signature. The signature is over
the **bare \`entryHash\` hex string** with **no trailing newline** — a stray
newline makes verification fail spuriously. Entries with no \`signature\` field
are the pre-signing entries described under Trust model; skip them here and rely
on steps 3 and 6.

\`\`\`sh
# Pick an entry (e.g. the first line):
line=$(sed -n '1p' ${ROOT.manifest})
printf %s "$(echo "$line" | jq -r '.entryHash')" > entryhash.txt   # NO newline
echo "$line" | jq -r '.signature' | base64 -d > sig.bin
openssl dgst -sha256 -verify ${ROOT.signingPublicKey} -signature sig.bin entryhash.txt
# => "Verified OK"
\`\`\`

## Step 3 — Recompute \`entryHash\` (canonicalization recipe)

\`sha256sum\` + \`openssl\` alone cannot detect a body-field edit that left
\`entryHash\`/\`signature\` intact. Recompute \`entryHash\` from the entry body:
strip \`entryHash\` and \`signature\`, canonicalize, and hash.

\`\`\`sh
echo "$line" | jq -cS 'del(.entryHash, .signature)' | tr -d '\\n' | sha256sum
# compare the hex to: echo "$line" | jq -r '.entryHash'
\`\`\`

**Caveats** — these, not key ordering, are the real edges. Manifest keys are
fixed ASCII, so \`jq\`'s codepoint key sort matches Birdbrain's. What *can*
differ: (a) string **escaping** of non-ASCII / control characters in values
like \`url\` / \`operatorName\` / \`title\`, and (b) **number formatting** of
\`index\` / \`sizeBytes\`. Both \`jq -c\` and Birdbrain emit minimal integer forms
and UTF-8 literals, so they agree in practice; if a hand recompute ever
disagrees, look here first.

## Step 4 — Chain linkage

Confirm each entry's \`prevHash\` equals the prior entry's \`entryHash\`, and
\`index\` increments from 0.

\`\`\`sh
jq -r '"\\(.index) \\(.prevHash) \\(.entryHash)"' ${ROOT.manifest}
\`\`\`

## Step 5 — Content bind (load-bearing for the evidence itself)

For each \`type: "capture"\` entry, confirm the actual captured bytes match the
hash **inside that signed entry** (NOT the value in \`${ROOT.evidenceIndex}\`). Without
this you could verify a pristine signed chain yet never confirm the MHTML/PNG
bytes are the ones it attests.

**Selection-scoped packages:** if a **verified** \`${ROOT.exportEntry}\` (see
Trust model) carries \`scope: "selection"\`, only the exhibits listed in its
\`captureIds\` are enclosed — run this step for those and expect the others
absent. That field carries exhibit ids of every kind: a capture's exhibit id IS
its capture id, so one list scopes the whole package. Only the signed entry can
account for an absent exhibit; never accept that explanation from
\`${ROOT.evidenceIndex}\` or the report.
Without a verified selection scope, every capture entry with no later
\`deletion\` entry must be present and must match. An **absent**
\`${ROOT.exportEntry}\` is not a verified whole-case scope: run the era check in
Trust model before reading it as one.

\`\`\`sh
# Content:
id=$(echo "$line" | jq -r '.captureId')
want=$(echo "$line" | jq -r '.contentHash')
got=$(sha256sum "${capturePagePath('$id')}" | cut -d' ' -f1)
[ "$want" = "$got" ] && echo "content OK" || echo "CONTENT MISMATCH"

# Screenshot (if the entry has screenshotHash; the file is named by that hash):
shot=$(echo "$line" | jq -r '.screenshotHash // empty')
[ -n "$shot" ] && sha256sum "${screenshotPath('$shot')}"   # must equal $shot
\`\`\`

**Exhibits of other kinds.** A capture is one kind of exhibit; an attachment,
image or document committed to the case is another, and each has its own signed
\`exhibit\` entry carrying an exhibit number, the path the tool stores it at and
its \`contentHash\`. The package encloses those bytes at the part of that path
inside the case directory — drop the leading case-id segment — so
\`{caseId}/documents/{exhibitId}.pdf\` is enclosed as
\`documents/{exhibitId}.pdf\`. Deleted and out-of-selection exhibits are
expected absent on exactly the same terms as captures.

\`\`\`sh
jq -c 'select(.type == "exhibit")' ${ROOT.manifest} | while IFS= read -r ex; do
  rel=$(printf '%s' "$ex" | jq -r '.path' | cut -d/ -f2-)
  num=$(printf '%s' "$ex" | jq -r '.exhibitNumber')
  want=$(printf '%s' "$ex" | jq -r '.contentHash')
  got=$(sha256sum "$rel" | cut -d' ' -f1)
  [ "$want" = "$got" ] && echo "exhibit $num OK" || echo "EXHIBIT $num MISMATCH"
done
\`\`\`

**Derived files.** A derived file is bytes the tool computed FROM an exhibit —
a thumbnail, extracted text, a metadata sidecar — anchored by its own
\`derivation\` entry naming the parent exhibit, the derivation, the output path
and the output hash. It carries no exhibit number of its own: it is cited by its
parent and its derivation. The package encloses it beside its parent, under the
parent's directory.

Bind it by the entry that names THAT parent and THAT path, never by an entry's
position in the file: an index says where an entry sits, not what it is about.

\`\`\`sh
jq -c 'select(.type == "derivation")' ${ROOT.manifest} | while IFS= read -r d; do
  parent=$(printf '%s' "$d" | jq -r '.parentExhibitId')
  ppath=$(jq -rn --arg p "$parent" \\
    'first(inputs | select(.type == "exhibit" and .exhibitId == $p) | .path) // empty' \\
    ${ROOT.manifest})
  if [ -n "$ppath" ]; then dir=$(dirname "$(printf '%s' "$ppath" | cut -d/ -f2-)"); else dir=${CAPTURE_PACKAGE_DIRECTORY}; fi
  rel="$dir/$(basename "$(printf '%s' "$d" | jq -r '.outputPath')")"
  want=$(printf '%s' "$d" | jq -r '.outputHash')
  got=$(sha256sum "$rel" | cut -d' ' -f1)
  [ "$want" = "$got" ] && echo "derived $rel OK" || echo "DERIVED FILE MISMATCH: $rel"
done
\`\`\`

## Step 6 — Timestamp (canonical TSA verification)

**This is the authenticity step the binary does NOT perform.** Verify each RFC
3161 token's CMS signature up to an independently trusted root.

**6a. Confirm the trust anchor before using it.** \`${ROOT.tsaRoot}\` is a
convenience copy shipped inside the package; anyone who can rewrite the package
can swap it. It becomes an anchor only once you have checked its fingerprint
against a source outside the package — the authority's published value, or the
same root already in your operating system's trust store. For Birdbrain's default
authority the root is DigiCert Trusted Root G4, published fingerprint:

\`\`\`
SHA-256 ${DIGICERT_TRUSTED_ROOT_G4_SHA256}
\`\`\`

\`\`\`sh
openssl x509 -in ${ROOT.tsaRoot} -noout -subject -issuer -fingerprint -sha256
# subject and issuer must be identical (self-signed); fingerprint must match above
\`\`\`

If \`${ROOT.tsaRoot}\` is absent, the case was configured with a non-default
authority and no anchor is bundled: obtain that authority's root yourself and use
it as \`-CAfile\` below. Never use \`${ROOT.tsaIntermediates}\` as
\`-CAfile\` — those certificates came out of the tokens being checked, so
trusting them proves nothing.

**6b. Verify each token.** Take the list from the signed manifest, not from
\`ls ${TIMESTAMP_PACKAGE_DIRECTORY}/\`: every token is also carried base64-encoded in its own signed
entry (\`jq -r 'select(.type == "timestamp" and (.subject // "content") == "content") | "\\(.captureContentHash) \\(.tsaToken)"' ${ROOT.manifest}\`),
so a \`.tst\` deleted from the package is visible there and invisible in a
directory listing. Walk the exhibits step 5 still requires present — captures
and committed exhibits of every other kind alike, active, and inside the
selection if one is declared — and look up each one's token by
its \`contentHash\`: a signed token found that way with no enclosed file is a
failure, not an absence of work, even when a deleted capture shares that hash.
A token no such capture leads you to is expected absent, as its page and
screenshot are in step 5. The \`.tst\` files are bare RFC 3161 tokens (DER
\`TimeStampToken\`), not full \`TimeStampResp\` structures, so \`-token_in\` is
required — without it OpenSSL reports an ASN.1 error, not a verdict.

\`\`\`sh
openssl ts -verify -digest <contentHash> -in ${timestampTokenPath('<token>')} -token_in \\
  -CAfile ${ROOT.tsaRoot} -untrusted ${ROOT.tsaIntermediates}
# => "Verification: OK"
\`\`\`

A token whose imprint matches the content hash but whose TSA signature is invalid
(a forged token) PASSES the binary's structural check and is caught **only**
here. That is why this runbook's \`openssl ts -verify\` — not the binary — is the
canonical proof of trusted time.

**6c. A strict-DER parser may refuse to read the token. That is an encoding
deviation by the authority, not tampering.** RFC 3161 tokens are DER, and DER
requires the members of a \`SET OF\` — which is what the CMS \`certificates\`
field carrying the responder's chain is — to appear sorted by their encodings
(X.690 §11.6). Birdbrain's default authority, DigiCert, returns tokens whose
\`certificates\` are not in that order, so a library that enforces the rule
rejects the token outright instead of reporting a verdict — \`rfc3161-client\`,
for one, raises \`Invalid Set Ordering Error\`. The bytes are exactly as the TSA
emitted and signed them.

Such a refusal is **not** evidence that this package was altered, and it is not a
failed verification. The \`certificates\` set sits outside the data the TSA's
signature covers, so its order can neither break nor repair that signature, and
the imprint that binds the token to the content hash is untouched by it. Treat
\`openssl ts -verify\` (step 6b) as the reference check: it accepts the encoding,
and it is what proves trusted time for this package. A strict parser's refusal is
a statement about the issuing authority's encoder.

Which authority issued a token is carried by the responder certificate embedded
in the token, not by its \`TSTInfo\`: DigiCert leaves \`TSTInfo\`'s optional
\`tsa\` field unset, so \`openssl ts -reply -text\` prints \`TSA: unspecified\`
for it and names nobody. Read the embedded certificates instead — the authority
appears in their subject lines:

\`\`\`sh
openssl pkcs7 -inform DER -in ${timestampTokenPath('<token>')} -print_certs -noout
\`\`\`

Birdbrain measures this deviation over its own sample tokens: the DigiCert
samples carry it and the IdenTrust and SINPE samples do not, so an authority of
the latter kind is not expected to produce it. That measurement covers \`SET\`
ordering and length form only, so a token it finds clean is not thereby
guaranteed to satisfy every DER rule.
`
