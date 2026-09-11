// The executable form of the by-hand runbook (#584), shipped INSIDE every
// evidence package as `verify.sh` beside VERIFY.md via buildEvidenceZip.
//
// VERIFY.md explains what each step proves and states the trust model; this
// script runs those same six steps and exits non-zero naming the step that
// failed. It exists because a runbook nobody executes drifts from the packages
// it describes — #578 and #579 were both step-6 commands that could not work as
// written, found by a human reading the text against a real package. A third
// party now has a one-command path that ships with the evidence.
//
// SAME BOUNDARY AS THE RUNBOOK: `openssl ts -verify` in step 6 is the canonical
// TSA authenticity check, which the programmatic/binary verifier does NOT do.
// A PASS here therefore covers more than a binary PASS — and still says nothing
// about whether the enclosed root is the authority's real root, which is why
// step 6a prints its fingerprint rather than asserting it.
//
// Written as POSIX sh with no bashisms so it runs under dash, bash and the BSD
// sh on macOS. Held in step with VERIFY.md by
// tests/main/services/verifyRunbookExecution.test.ts, which builds a real
// package through the export path and runs both against it.

import { TSA_INTERMEDIATES_FILENAME, TSA_ROOT_FILENAME } from '@main/services/tsaTrust'

/** Name this script is written into the evidence package under. */
export const VERIFY_SCRIPT_FILENAME = 'verify.sh'

export const VERIFY_SCRIPT = `#!/bin/sh
# verify.sh - one-command verification of this Birdbrain evidence package.
#
# REQUIRED TOOLS. Every tool this script uses is named here and checked for
# before any check runs; a missing one exits 2 naming it:
#   jq, openssl, sha256sum (or shasum, on macOS), cut, dirname, grep, rm, tr,
#   mktemp.
#
# This is the executable form of VERIFY.md. It runs the same six steps against
# the package it sits in, prints a line per check, and exits non-zero naming the
# step that failed. VERIFY.md explains what each step proves and states the
# trust model; this script does not replace reading it.
#
# Exit codes: 0 every check passed, 1 at least one check FAILED, 2 the script
# could not run at all (a missing tool, or this is not an evidence package),
# 3 INCOMPLETE - nothing failed, but a check could not be completed, so this is
# not a pass either. A check that cannot run is never folded into exit 0.
#
# What exit 0 means: the enclosed files match the signed, hash-linked manifest,
# every signed entry verifies under the enclosed public key, and every RFC 3161
# token the SIGNED manifest carries is enclosed and verifies to the enclosed TSA
# root. A token the manifest signs for but the package does not enclose is a
# FAILURE, not a silence. What exit 0 does NOT mean: that the enclosed root is
# the authority's real root. Step 6a prints that root's fingerprint so you can
# check it against a source outside this package. Until you have, the
# trusted-time result is conditional on a file whoever built this package
# supplied.

set -u

# The TSA material this package ships, named once so these checks and the
# commands in VERIFY.md cannot drift apart.
TSA_ROOT=${TSA_ROOT_FILENAME}
TSA_INTERMEDIATES=${TSA_INTERMEDIATES_FILENAME}

need() {
  command -v "$1" >/dev/null 2>&1 && return 0
  printf 'verify.sh: required tool "%s" was not found on PATH.\\n' "$1" >&2
  printf 'verify.sh: needs jq, openssl, sha256sum (or shasum), cut, dirname, grep, rm, tr, mktemp.\\n' >&2
  exit 2
}

need jq
need openssl
need cut
need dirname
need grep
# Used by the EXIT trap below, which is installed too late to report its own
# absence - so it is checked here with the rest.
need rm
need tr
need mktemp

if command -v sha256sum >/dev/null 2>&1; then
  sha256_of() { sha256sum "$1" | cut -d' ' -f1; }
  sha256_stdin() { sha256sum | cut -d' ' -f1; }
  sha256_check() { sha256sum -c -; }
elif command -v shasum >/dev/null 2>&1; then
  sha256_of() { shasum -a 256 "$1" | cut -d' ' -f1; }
  sha256_stdin() { shasum -a 256 | cut -d' ' -f1; }
  sha256_check() { shasum -a 256 -c -; }
else
  need sha256sum
fi

# The package is wherever this script is, not wherever it was invoked from.
cd "$(dirname "$0")" || exit 2

if [ ! -f manifest.jsonl ]; then
  printf 'verify.sh: no manifest.jsonl beside this script, so this is not an evidence package.\\n' >&2
  exit 2
fi

tmp=$(mktemp -d) || exit 2
trap 'rm -rf "$tmp"' EXIT HUP INT TERM

fail_count=0
incomplete_count=0
step=0
failed_steps=''
incomplete_steps=''

begin() {
  step="$1"
  shift
  printf '\\n== Step %s - %s\\n' "$step" "$*"
}

note() { printf '   %s\\n' "$*"; }

fail() {
  printf '   FAIL [step %s] %s\\n' "$step" "$*"
  fail_count=$((fail_count + 1))
  case " $failed_steps " in
  *" $step "*) ;;
  *) failed_steps="$failed_steps $step" ;;
  esac
}

# A check that could not be run at all - neither a pass nor a failure. It gets
# its own verdict and its own exit code because a skip reported inside PASS is
# indistinguishable, to a reader and to a wrapper script, from a check that ran.
incomplete() {
  printf '   INCOMPLETE [step %s] %s\\n' "$step" "$*"
  incomplete_count=$((incomplete_count + 1))
  case " $incomplete_steps " in
  *" $step "*) ;;
  *) incomplete_steps="$incomplete_steps $step" ;;
  esac
}

# One jq field read from a manifest line held in a shell variable.
field() { printf '%s' "$1" | jq -r "$2"; }

in_list() { printf '%s\\n' "$1" | grep -qxF -e "$2"; }

# Verifies one manifest line's RSA signature over its bare entryHash hex with no
# trailing newline - the recipe VERIFY.md step 2 documents. Prints nothing and
# returns non-zero on any failure, so each caller words its own finding.
verify_line_signature() {
  sig=$(field "$1" '.signature // empty')
  [ -n "$sig" ] || return 1
  field "$1" '.entryHash' | tr -d '\\n' >"$tmp/entryhash.txt"
  printf '%s' "$sig" | openssl base64 -d -A >"$tmp/sig.bin" 2>/dev/null || return 1
  openssl dgst -sha256 -verify signing-public-key.pem \\
    -signature "$tmp/sig.bin" "$tmp/entryhash.txt" >/dev/null 2>&1
}

# Recomputes one manifest line's entryHash from its body - the recipe VERIFY.md
# step 3 documents. Echoes the hex.
recompute_entry_hash() {
  printf '%s' "$1" | jq -cS 'del(.entryHash, .signature)' | tr -d '\\n' | sha256_stdin
}

printf 'verify.sh - Birdbrain evidence package, by-hand verification (see VERIFY.md)\\n'

# --- Step 1 ---------------------------------------------------------------
begin 1 'file integrity against the unsigned index'
if [ ! -f evidence.json ]; then
  fail 'evidence.json is missing, so the enclosed index cannot be checked'
elif jq -r '.artifacts[] | "\\(.sha256)  \\(.path)"' evidence.json |
  sha256_check >"$tmp/step1.out" 2>&1; then
  note "$(grep -c 'OK$' "$tmp/step1.out") enclosed file(s) match evidence.json"
else
  while IFS= read -r bad; do
    [ -n "$bad" ] && printf '   %s\\n' "$bad"
  done <"$tmp/step1.out"
  fail 'one or more enclosed files do not match evidence.json'
fi
note 'evidence.json is unsigned - steps 3 and 5 are the authoritative bind'

# --- Step 2 ---------------------------------------------------------------
begin 2 'entry signatures'
if [ ! -f signing-public-key.pem ]; then
  fail 'signing-public-key.pem is missing, so no signature can be checked'
else
  signed_count=0
  unsigned_count=0
  seen_signed=0
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    idx=$(field "$line" '.index')
    if [ -z "$(field "$line" '.signature // empty')" ]; then
      unsigned_count=$((unsigned_count + 1))
      if [ "$seen_signed" -eq 1 ]; then
        fail "entry $idx is unsigned but follows a signed entry: rewriting a signed entry as an unsigned one needs no private key, so this is tampering"
      fi
      continue
    fi
    seen_signed=1
    if verify_line_signature "$line"; then
      signed_count=$((signed_count + 1))
    else
      fail "entry $idx: signature does not verify under signing-public-key.pem"
    fi
  done <manifest.jsonl
  note "$signed_count signed entr(ies) verified"
  if [ "$unsigned_count" -gt 0 ]; then
    note "$unsigned_count pre-signing entr(ies) carry no signature - covered by steps 3, 4 and 6"
  fi
fi

# --- Step 3 ---------------------------------------------------------------
begin 3 'recomputed entry hashes'
counted=0
while IFS= read -r line; do
  [ -n "$line" ] || continue
  counted=$((counted + 1))
  idx=$(field "$line" '.index')
  [ "$(recompute_entry_hash "$line")" = "$(field "$line" '.entryHash')" ] ||
    fail "entry $idx: its body does not hash to its own entryHash"
done <manifest.jsonl
note "$counted entr(ies) recomputed from their bodies"

# --- Step 4 ---------------------------------------------------------------
begin 4 'chain linkage'
expect=0
head_hash=''
while IFS= read -r line; do
  [ -n "$line" ] || continue
  idx=$(field "$line" '.index')
  [ "$idx" = "$expect" ] ||
    fail "entry at position $expect declares index $idx, so the chain is not contiguous"
  if [ "$expect" -gt 0 ] && [ "$(field "$line" '.prevHash')" != "$head_hash" ]; then
    fail "entry $idx: prevHash does not equal the preceding entry's entryHash"
  fi
  head_hash=$(field "$line" '.entryHash')
  expect=$((expect + 1))
done <manifest.jsonl
if [ "$expect" -eq 0 ]; then
  fail 'manifest.jsonl holds no entries'
else
  note "$expect entr(ies) linked from index 0"
  note "index 0 prevHash is not compared: a chain continued from an imported case carries the source head there"
fi

# --- Step 5 ---------------------------------------------------------------
begin 5 'content bind to the signed chain'
selection=''
have_selection=0
if [ -f export-entry.json ]; then
  export_entry=$(tr -d '\\n' <export-entry.json)
  entry_ok=1
  verify_line_signature "$export_entry" || entry_ok=0
  [ "$(recompute_entry_hash "$export_entry")" = "$(field "$export_entry" '.entryHash')" ] || entry_ok=0
  [ "$(field "$export_entry" '.prevHash')" = "$head_hash" ] || entry_ok=0
  if [ "$entry_ok" -eq 0 ]; then
    fail 'export-entry.json does not verify against the enclosed key and the chain head, so its declared scope cannot be trusted'
  elif [ "$(field "$export_entry" '.scope // empty')" = 'selection' ]; then
    selection=$(field "$export_entry" '.captureIds[]')
    have_selection=1
    note 'export-entry.json verifies and declares a selection-scoped package'
  else
    note 'export-entry.json verifies and declares a whole-case package'
  fi
fi

deleted=$(jq -r 'select(.type == "deletion") | .captureId' manifest.jsonl)
jq -c 'select(.type == "capture")' manifest.jsonl >"$tmp/captures.jsonl"

bound=0
while IFS= read -r line; do
  [ -n "$line" ] || continue
  id=$(field "$line" '.captureId')
  if in_list "$deleted" "$id"; then
    note "capture $id: a later deletion entry accounts for it, so it is expected absent"
    continue
  fi
  if [ "$have_selection" -eq 1 ] && ! in_list "$selection" "$id"; then
    note "capture $id: outside the signed export selection, so it is expected absent"
    continue
  fi
  if [ ! -f "pages/$id.mhtml" ]; then
    fail "capture $id: pages/$id.mhtml is missing and nothing signed accounts for its absence"
  elif [ "$(sha256_of "pages/$id.mhtml")" != "$(field "$line" '.contentHash')" ]; then
    fail "capture $id: pages/$id.mhtml does not match the contentHash in its signed entry"
  else
    bound=$((bound + 1))
  fi
  shot=$(field "$line" '.screenshotHash // empty')
  if [ -n "$shot" ]; then
    if [ ! -f "screenshots/$shot.png" ]; then
      fail "capture $id: screenshots/$shot.png is missing but its signed entry carries a screenshotHash"
    elif [ "$(sha256_of "screenshots/$shot.png")" != "$shot" ]; then
      fail "capture $id: screenshots/$shot.png does not match its own content address"
    fi
  fi
done <"$tmp/captures.jsonl"
note "$bound capture(s) bound to the signed chain"

# --- Step 6 ---------------------------------------------------------------
begin 6 'timestamp, the canonical TSA verification'
# The work set comes from the SIGNED manifest, never from listing timestamps/.
# Read off the directory instead and a package stripped of its .tst files says
# "nothing to check" and passes, while the signed chain still asserts a trusted
# time for the capture. Which digest each token is entitled to attest comes from
# that same signed entry - never from a file name, and never from evidence.json.
jq -r 'select(.type == "timestamp" and .tsaToken != null) | "\\(.captureContentHash) \\(.tsaToken)"' \\
  manifest.jsonl >"$tmp/signed-tokens.txt"
signed_tokens=$(grep -c . "$tmp/signed-tokens.txt")

# sha256 of every enclosed token file. A signed entry is matched to a file by
# its bytes, because nothing signed the file's name.
: >"$tmp/file-index.txt"
if [ -d timestamps ]; then
  for candidate in timestamps/*; do
    [ -f "$candidate" ] || continue
    printf '%s %s\\n' "$(sha256_of "$candidate")" "$candidate" >>"$tmp/file-index.txt"
  done
fi

anchor_named=0
verified_count=0

if [ "$signed_tokens" -eq 0 ]; then
  note 'the signed manifest carries no RFC 3161 token, so it makes no trusted-time claim'
elif [ ! -f "$TSA_ROOT" ]; then
  note "$TSA_ROOT is absent: this case was configured with a non-default timestamp authority"
  note "obtain that authority's own root and re-run the step 6b command from VERIFY.md with it as -CAfile"
  incomplete "$signed_tokens signed token(s) were not verified: no anchor is enclosed for this script to name"
elif openssl x509 -in "$TSA_ROOT" -noout -subject -issuer -fingerprint -sha256 \\
  >"$tmp/anchor.txt" 2>&1; then
  anchor_subject=$(grep '^subject=' "$tmp/anchor.txt" | cut -d= -f2-)
  anchor_issuer=$(grep '^issuer=' "$tmp/anchor.txt" | cut -d= -f2-)
  if [ "$anchor_subject" = "$anchor_issuer" ]; then
    anchor_named=1
    note "anchor subject: $anchor_subject"
    note "anchor $(grep -i 'Fingerprint=' "$tmp/anchor.txt")"
    note 'CHECK THAT FINGERPRINT against the published value or your own trust store before trusting it'
  else
    fail "$TSA_ROOT is not self-signed, so it is not a root and cannot be the anchor"
  fi
else
  fail "$TSA_ROOT could not be read as a certificate"
fi

untrusted=''
[ -f "$TSA_INTERMEDIATES" ] && untrusted="$TSA_INTERMEDIATES"

# Every signed token: it must be enclosed, and it must verify to the anchor.
: >"$tmp/signed-shas.txt"
while IFS=' ' read -r imprint encoded; do
  [ -n "$encoded" ] || continue
  if ! printf '%s' "$encoded" | openssl base64 -d -A >"$tmp/signed-token.der" 2>/dev/null; then
    fail "the signed timestamp entry for imprint $imprint carries a tsaToken that is not base64"
    continue
  fi
  token_sha=$(sha256_of "$tmp/signed-token.der")
  printf '%s\\n' "$token_sha" >>"$tmp/signed-shas.txt"
  token=$(grep "^$token_sha " "$tmp/file-index.txt" | cut -d' ' -f2)
  if [ -z "$token" ]; then
    fail "the signed manifest carries a timestamp token for imprint $imprint but no enclosed file holds those bytes"
    continue
  fi
  [ "$anchor_named" -eq 1 ] || continue
  result=0
  if [ -n "$untrusted" ]; then
    openssl ts -verify -digest "$imprint" -in "$token" -token_in \\
      -CAfile "$TSA_ROOT" -untrusted "$untrusted" >"$tmp/ts.out" 2>&1 || result=$?
  else
    openssl ts -verify -digest "$imprint" -in "$token" -token_in \\
      -CAfile "$TSA_ROOT" >"$tmp/ts.out" 2>&1 || result=$?
  fi
  if [ "$result" -eq 0 ]; then
    verified_count=$((verified_count + 1))
    note "$token: TSA signature verifies to $TSA_ROOT over imprint $imprint"
  else
    fail "$token: TSA signature does not verify to $TSA_ROOT over the signed imprint $imprint"
    while IFS= read -r detail; do
      printf '   openssl: %s\\n' "$detail"
    done <"$tmp/ts.out"
  fi
done <"$tmp/signed-tokens.txt"

# The other direction: a .tst no signed entry accounts for is reported, never
# verified against a digest of its own choosing.
while IFS=' ' read -r file_sha file_path; do
  [ -n "$file_path" ] || continue
  grep -qxF -e "$file_sha" "$tmp/signed-shas.txt" ||
    fail "$file_path: these bytes are not the token of any signed timestamp entry, so nothing states what they attest"
done <"$tmp/file-index.txt"

printf '\\n'
if [ "$fail_count" -gt 0 ]; then
  printf 'verify.sh: FAIL - %s check(s) failed, in step(s):%s\\n' "$fail_count" "$failed_steps"
  printf 'Read the FAIL lines above. VERIFY.md explains what each step proves.\\n'
  exit 1
fi

if [ "$incomplete_count" -gt 0 ]; then
  printf 'verify.sh: INCOMPLETE - nothing failed, but %s check(s) could not be run, in step(s):%s\\n' \\
    "$incomplete_count" "$incomplete_steps"
  printf 'This is not a pass. Read the INCOMPLETE lines above and run those checks by hand\\n'
  printf 'with the material they name; VERIFY.md gives the command for each step.\\n'
  exit 3
fi

printf 'verify.sh: PASS - every check above succeeded.\\n'
if [ "$verified_count" -gt 0 ]; then
  printf 'That is an integrity and internal-consistency result. It becomes a trusted-time claim\\n'
  printf 'only once the step 6a fingerprint is checked against a source outside this package.\\n'
else
  printf 'That is an integrity and internal-consistency result only. The signed chain carries no\\n'
  printf 'RFC 3161 token, so this package makes no trusted-time claim for you to check.\\n'
fi
exit 0
`
