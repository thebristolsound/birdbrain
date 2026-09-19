// The by-hand verification runbook (#122 §10), shipped INSIDE every evidence
// package via buildEvidenceZip. It reproduces the full integrity claim using
// only stock tools (sha256sum, openssl, jq) plus a documented canonicalization
// recipe — zero Birdbrain code.
//
// CANONICAL TSA CHECK LIVES HERE: the programmatic verifier (and the standalone
// binary) does timestamp IMPRINT + BYTE-BINDING only. The `openssl ts -verify`
// step below is what proves TSA authenticity, so a binary PASS is NOT a
// timestamp-authenticity claim (binary-PASS != runbook-PASS).

import {
  DIGICERT_TRUSTED_ROOT_G4_SHA256,
  TSA_INTERMEDIATES_FILENAME,
  TSA_ROOT_FILENAME
} from '@main/services/tsaTrust'
import { VERIFY_SCRIPT_FILENAME } from '@main/services/verifyScript'

export const VERIFY_RUNBOOK = `# Verifying this evidence package by hand

This package can be re-verified by a third party **without running Birdbrain**,
using only stock tools: \`sha256sum\`, \`openssl\`, and \`jq\`.

## One command — \`${VERIFY_SCRIPT_FILENAME}\`

\`${VERIFY_SCRIPT_FILENAME}\` is enclosed with this package and is the executable
form of the six steps below. Run it from the unpacked package directory:

\`\`\`sh
sh ${VERIFY_SCRIPT_FILENAME}
\`\`\`

It prints a line per check and exits non-zero naming the step that failed — 2 if
a tool it needs is missing, and 3 (\`INCOMPLETE\`) if a check could not be run at
all, which this package can cause by enclosing no root for a non-default
timestamp authority. A skipped check is never folded into its \`PASS\`. It is
a convenience, not the authority: what makes this package checkable is that every
step below can be run by hand, which is what the rest of this document is for.
Read step 6a before treating its PASS as proof of trusted time.

## Trust model (read first)

The signed \`manifest.jsonl\` is the **root of trust**. Every entry carries an
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
jq -r 'select((.schemaVersion // 1) < 2) | "index \\(.index) \\(.type) — unsigned"' manifest.jsonl
\`\`\`

A chain may go v1 → v2 as the tool was upgraded. It must never go **back**: a
\`schemaVersion\` 1 entry appearing after a signed one is tampering, because
rewriting a signed entry as an unsigned one needs no private key. Birdbrain's
verifier rejects that; a hand check should too.

\`evidence.json\` is an **unsigned convenience index**. Do not trust it on its
own — its own integrity is established by re-deriving everything from the chain.
The signing key (\`signing-public-key.pem\`) is installation-local and is **not**
an independent trust anchor; it defeats casual tampering. The independent anchor
for *timestamped* captures is the RFC 3161 timestamp, verified in step 6.

\`export-entry.json\`, when present, is the **signed export entry for this very
package** — the one entry the bundled \`manifest.jsonl\` cannot contain, because
the manifest copy is sealed just before the entry is appended to the live case
manifest. Verify it exactly like a manifest line before using anything in it:
its \`signature\` with the step 2 recipe, its \`entryHash\` with the step 3
recipe, and its \`prevHash\` must equal the \`entryHash\` of the **last line** of
\`manifest.jsonl\`. Once verified, its \`scope\` / \`captureIds\` fields are the
authoritative statement of what this package encloses: \`scope: "selection"\`
means the operator deliberately exported a subset, and \`captureIds\` lists
exactly the captures whose files are enclosed. The manifest still covers the
whole case — the chain is never sliced. A package with no \`export-entry.json\`
predates this file and encloses every active capture.

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
| \`manifest.jsonl\` | Signed, hash-linked audit chain (root of trust) |
| \`signing-public-key.pem\` | RSA public key for the per-entry signatures |
| \`${VERIFY_SCRIPT_FILENAME}\` | The steps below as a runnable script (see above) |
| \`${TSA_ROOT_FILENAME}\` | Self-signed TSA root — the trust anchor for step 6 (absent when no anchor is bundled for the configured authority) |
| \`${TSA_INTERMEDIATES_FILENAME}\` | Responder + intermediate certs lifted from the tokens (chain-building only, never trusted on their own) |
| \`pages/{captureId}.mhtml\` | Captured content (hashed as \`contentHash\`) |
| \`screenshots/{sha256}.png\` | Captured screenshot (hashed as \`screenshotHash\`) |
| \`attachments/\`, \`images/\`, \`documents/\` | Committed exhibits of other kinds, one file per exhibit named \`{exhibitId}\` plus its stored extension (hashed as the \`exhibit\` entry's \`contentHash\`) |
| \`{exhibit directory}/{exhibitId}_{suffix}\` | Derived files, enclosed beside the exhibit they were computed from — a capture's thumbnail sits in \`pages/\` (hashed as the \`derivation\` entry's \`outputHash\`) |
| \`timestamps/*.tst\` | RFC 3161 tokens (DER), when present |
| \`evidence.json\` | Unsigned index (reconcile, do not trust) |
| \`export-entry.json\` | Signed export entry for this package — scope of the enclosed captures (absent from older packages) |

## Step 1 — File integrity (index self-consistency)

\`sha256sum\` each artifact and compare to \`evidence.json\`. This only proves the
files match the **untrusted** index — the authoritative content bind is step 5.

\`\`\`sh
jq -r '.artifacts[] | "\\(.sha256)  \\(.path)"' evidence.json | sha256sum -c -
\`\`\`

## Step 2 — Entry signature (\`schemaVersion\` 2 and above)

For a **signed** manifest entry, verify its RSA signature. The signature is over
the **bare \`entryHash\` hex string** with **no trailing newline** — a stray
newline makes verification fail spuriously. Entries with no \`signature\` field
are the pre-signing entries described under Trust model; skip them here and rely
on steps 3 and 6.

\`\`\`sh
# Pick an entry (e.g. the first line):
line=$(sed -n '1p' manifest.jsonl)
printf %s "$(echo "$line" | jq -r '.entryHash')" > entryhash.txt   # NO newline
echo "$line" | jq -r '.signature' | base64 -d > sig.bin
openssl dgst -sha256 -verify signing-public-key.pem -signature sig.bin entryhash.txt
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
jq -r '"\\(.index) \\(.prevHash) \\(.entryHash)"' manifest.jsonl
\`\`\`

## Step 5 — Content bind (load-bearing for the evidence itself)

For each \`type: "capture"\` entry, confirm the actual captured bytes match the
hash **inside that signed entry** (NOT the value in \`evidence.json\`). Without
this you could verify a pristine signed chain yet never confirm the MHTML/PNG
bytes are the ones it attests.

**Selection-scoped packages:** if a **verified** \`export-entry.json\` (see
Trust model) carries \`scope: "selection"\`, only the exhibits listed in its
\`captureIds\` are enclosed — run this step for those and expect the others
absent. That field carries exhibit ids of every kind: a capture's exhibit id IS
its capture id, so one list scopes the whole package. Only the signed entry can
account for an absent exhibit; never accept that explanation from
\`evidence.json\` or the report.
Without a verified selection scope, every capture entry with no later
\`deletion\` entry must be present and must match.

\`\`\`sh
# Content:
id=$(echo "$line" | jq -r '.captureId')
want=$(echo "$line" | jq -r '.contentHash')
got=$(sha256sum "pages/$id.mhtml" | cut -d' ' -f1)
[ "$want" = "$got" ] && echo "content OK" || echo "CONTENT MISMATCH"

# Screenshot (if the entry has screenshotHash; the file is named by that hash):
shot=$(echo "$line" | jq -r '.screenshotHash // empty')
[ -n "$shot" ] && sha256sum "screenshots/$shot.png"   # must equal $shot
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
jq -c 'select(.type == "exhibit")' manifest.jsonl | while IFS= read -r ex; do
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
jq -c 'select(.type == "derivation")' manifest.jsonl | while IFS= read -r d; do
  parent=$(printf '%s' "$d" | jq -r '.parentExhibitId')
  ppath=$(jq -rn --arg p "$parent" \\
    'first(inputs | select(.type == "exhibit" and .exhibitId == $p) | .path) // empty' \\
    manifest.jsonl)
  if [ -n "$ppath" ]; then dir=$(dirname "$(printf '%s' "$ppath" | cut -d/ -f2-)"); else dir=pages; fi
  rel="$dir/$(basename "$(printf '%s' "$d" | jq -r '.outputPath')")"
  want=$(printf '%s' "$d" | jq -r '.outputHash')
  got=$(sha256sum "$rel" | cut -d' ' -f1)
  [ "$want" = "$got" ] && echo "derived $rel OK" || echo "DERIVED FILE MISMATCH: $rel"
done
\`\`\`

## Step 6 — Timestamp (canonical TSA verification)

**This is the authenticity step the binary does NOT perform.** Verify each RFC
3161 token's CMS signature up to an independently trusted root.

**6a. Confirm the trust anchor before using it.** \`${TSA_ROOT_FILENAME}\` is a
convenience copy shipped inside the package; anyone who can rewrite the package
can swap it. It becomes an anchor only once you have checked its fingerprint
against a source outside the package — the authority's published value, or the
same root already in your operating system's trust store. For Birdbrain's default
authority the root is DigiCert Trusted Root G4, published fingerprint:

\`\`\`
SHA-256 ${DIGICERT_TRUSTED_ROOT_G4_SHA256}
\`\`\`

\`\`\`sh
openssl x509 -in ${TSA_ROOT_FILENAME} -noout -subject -issuer -fingerprint -sha256
# subject and issuer must be identical (self-signed); fingerprint must match above
\`\`\`

If \`${TSA_ROOT_FILENAME}\` is absent, the case was configured with a non-default
authority and no anchor is bundled: obtain that authority's root yourself and use
it as \`-CAfile\` below. Never use \`${TSA_INTERMEDIATES_FILENAME}\` as
\`-CAfile\` — those certificates came out of the tokens being checked, so
trusting them proves nothing.

**6b. Verify each token.** Take the list from the signed manifest, not from
\`ls timestamps/\`: every token is also carried base64-encoded in its own signed
entry (\`jq -r 'select(.type == "timestamp") | "\\(.captureContentHash) \\(.tsaToken)"' manifest.jsonl\`),
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
openssl ts -verify -digest <contentHash> -in timestamps/<token>.tst -token_in \\
  -CAfile ${TSA_ROOT_FILENAME} -untrusted ${TSA_INTERMEDIATES_FILENAME}
# => "Verification: OK"
\`\`\`

A token whose imprint matches the content hash but whose TSA signature is invalid
(a forged token) PASSES the binary's structural check and is caught **only**
here. That is why this runbook's \`openssl ts -verify\` — not the binary — is the
canonical proof of trusted time.
`
