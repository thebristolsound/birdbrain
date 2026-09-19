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
// It still says nothing about whether the enclosed root is the authority's
// real root, which is why step 6a prints its fingerprint rather than asserting
// it. Step 6 finds its required tokens the way the binary does: it walks the
// captures that are active (no later deletion entry) and, on a
// selection-scoped package, named in the signed selection, and takes each
// one's signed token by contentHash. A deleted or out-of-scope capture is never
// visited, so its token is expected absent, as its page and screenshot are in
// step 5.
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
# What exit 0 means: every signed entry verifies under the enclosed public key
# and recomputes to its own entryHash, and for every capture this package's
# signed chain still calls active and in scope, its page, screenshot and RFC
# 3161 token are enclosed and match that signed entry. A signed token whose
# capture is active and in scope but whose bytes the package does not enclose
# is a FAILURE, not a silence; a deleted or out-of-selection capture's token is
# expected absent, exactly like its page and screenshot. What exit 0 does NOT
# mean: it does not recompute a package-wide hash the way the binary verifier
# does, so a file with no signed entry of its own (report.html) is checked only
# against the unsigned index in step 1, and evidence.json, which that index
# does not list, is not hashed by any step. Nor does it mean the
# enclosed TSA root is the authority's real root — step 6a prints that root's
# fingerprint so you can check it against a source outside this package. Until
# you have, the trusted-time result is conditional on a file whoever built this
# package supplied.

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

# The part of a storage path that lies inside the Case directory:
# "<caseId>/documents/x.pdf" -> "documents/x.pdf", which is where the package
# holds it. The first segment is dropped rather than matched against a case id
# because an imported Case keeps the source Case's path in its signed entries.
in_case_path() { printf '%s' "\${1#*/}"; }

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

# Exhibits of every other kind (ADR-0023). The signed entry carries the path the
# Case store holds the bytes at; the package holds them at the part of that path
# inside the Case directory, keyed by Exhibit id. Same rule as the captures
# above: deleted or out-of-selection means expected absent, anything else
# enclosed and matching its signed contentHash.
jq -c 'select(.type == "exhibit")' manifest.jsonl >"$tmp/exhibits.jsonl"
exhibits_bound=0
while IFS= read -r line; do
  [ -n "$line" ] || continue
  id=$(field "$line" '.exhibitId')
  num=$(field "$line" '.exhibitNumber')
  if in_list "$deleted" "$id"; then
    note "Exhibit $num: a later deletion entry accounts for it, so it is expected absent"
    continue
  fi
  if [ "$have_selection" -eq 1 ] && ! in_list "$selection" "$id"; then
    note "Exhibit $num: outside the signed export selection, so it is expected absent"
    continue
  fi
  rel=$(in_case_path "$(field "$line" '.path')")
  if [ ! -f "$rel" ]; then
    fail "Exhibit $num: $rel is missing and nothing signed accounts for its absence"
  elif [ "$(sha256_of "$rel")" != "$(field "$line" '.contentHash')" ]; then
    fail "Exhibit $num: $rel does not match the contentHash in its signed entry"
  else
    exhibits_bound=$((exhibits_bound + 1))
  fi
done <"$tmp/exhibits.jsonl"
note "$exhibits_bound exhibit(s) of other kinds bound to the signed chain"

# Where each active Exhibit's bytes sit, which is also where its Derived Files
# sit. A Capture's are under pages/; every other kind's are in its own kind
# directory, read off the signed path.
: >"$tmp/parent-dirs.txt"
while IFS= read -r line; do
  [ -n "$line" ] || continue
  id=$(field "$line" '.captureId')
  in_list "$deleted" "$id" && continue
  printf '%s pages\\n' "$id" >>"$tmp/parent-dirs.txt"
done <"$tmp/captures.jsonl"
while IFS= read -r line; do
  [ -n "$line" ] || continue
  id=$(field "$line" '.exhibitId')
  in_list "$deleted" "$id" && continue
  rel=$(in_case_path "$(field "$line" '.path')")
  dir=$(dirname "$rel")
  [ "$dir" = '.' ] && dir=''
  printf '%s %s\\n' "$id" "$dir" >>"$tmp/parent-dirs.txt"
done <"$tmp/exhibits.jsonl"

parent_dir() {
  while IFS=' ' read -r parent_id parent_path; do
    [ "$parent_id" = "$1" ] || continue
    printf '%s' "$parent_path"
    return 0
  done <"$tmp/parent-dirs.txt"
  return 1
}

# Exhibit Numbers as the chain records them: on an \`exhibit\` entry, and for a
# Capture in the one-time \`renumber\` entry. A Capture committed after its Case
# was renumbered has no number in the chain, and is then named by its id -
# never by a number counted here, which would cite something nothing signed.
: >"$tmp/exhibit-numbers.txt"
jq -r 'select(.type == "exhibit") | "\\(.exhibitId) \\(.exhibitNumber)"' \\
  manifest.jsonl >>"$tmp/exhibit-numbers.txt"
jq -r 'select(.type == "renumber") | .assignments[] | "\\(.exhibitId) \\(.exhibitNumber)"' \\
  manifest.jsonl >>"$tmp/exhibit-numbers.txt"

# How a finding cites an Exhibit, matching the binary verifier's wording.
exhibit_label() {
  while IFS=' ' read -r numbered_id number; do
    [ "$numbered_id" = "$1" ] || continue
    printf 'Exhibit %s' "$number"
    return 0
  done <"$tmp/exhibit-numbers.txt"
  printf 'exhibit %s' "$1"
}

# Derived Files (X17): bytes the tool computed FROM an Exhibit, enclosed beside
# their parent. A Derived File has no Exhibit Number of its own (X31), so a
# finding names the parent and the derivation that produced it.
jq -c 'select(.type == "derivation")' manifest.jsonl >"$tmp/derivations.jsonl"
derived_bound=0
while IFS= read -r line; do
  [ -n "$line" ] || continue
  parent=$(field "$line" '.parentExhibitId')
  derivation=$(field "$line" '.derivation')
  if ! pdir=$(parent_dir "$parent"); then
    note "derivation $derivation of $parent: no active exhibit entry answers for its parent, so it is expected absent"
    continue
  fi
  if [ "$have_selection" -eq 1 ] && ! in_list "$selection" "$parent"; then
    note "derivation $derivation of $parent: its parent is outside the signed export selection, so it is expected absent"
    continue
  fi
  base=$(in_case_path "$(field "$line" '.outputPath')")
  base=\${base##*/}
  if [ -n "$pdir" ]; then
    rel="$pdir/$base"
  else
    rel="$base"
  fi
  label="$(exhibit_label "$parent"), derivation $derivation"
  if [ ! -f "$rel" ]; then
    fail "$label: $rel is missing and nothing signed accounts for its absence"
  elif [ "$(sha256_of "$rel")" != "$(field "$line" '.outputHash')" ]; then
    fail "$label: $rel does not match the outputHash in its signed entry"
  else
    derived_bound=$((derived_bound + 1))
  fi
done <"$tmp/derivations.jsonl"
note "$derived_bound derived file(s) bound to the signed chain"

# --- Step 6 ---------------------------------------------------------------
begin 6 'timestamp, the canonical TSA verification'
# The work set comes from the SIGNED manifest, never from listing timestamps/.
# Read off the directory instead and a package stripped of its .tst files says
# "nothing to check" and passes, while the signed chain still asserts a trusted
# time for the capture. Which digest each token is entitled to attest comes from
# that same signed entry - never from a file name, and never from evidence.json.
#
# The REQUIRED tokens are found the way step 5 and the binary find pages: walk
# the captures that are active and in scope, and take each one's signed token by
# its contentHash. A deleted or out-of-selection capture is never visited, so
# its token is expected absent without any exclusion list to get wrong.
signed_token_filter='select(.type == "timestamp" and (.tsaToken | type) == "string")'
jq -r "$signed_token_filter"' | "\\(.captureContentHash) \\(.tsaToken)"' \\
  manifest.jsonl >"$tmp/signed-tokens.txt"

signed_tokens=0
while IFS= read -r signed_line; do
  [ -n "$signed_line" ] && signed_tokens=$((signed_tokens + 1))
done <"$tmp/signed-tokens.txt"

: >"$tmp/required-tokens.txt"
required_tokens=0
while IFS= read -r line; do
  [ -n "$line" ] || continue
  id=$(field "$line" '.captureId')
  in_list "$deleted" "$id" && continue
  if [ "$have_selection" -eq 1 ] && ! in_list "$selection" "$id"; then
    continue
  fi
  imprint=$(field "$line" '.contentHash')
  encoded=$(jq -rn --arg h "$imprint" \\
    "first(inputs | $signed_token_filter | select(.captureContentHash == \\$h) | .tsaToken) // empty" \\
    manifest.jsonl)
  [ -n "$encoded" ] || continue
  printf '%s %s %s\\n' "$id" "$imprint" "$encoded" >>"$tmp/required-tokens.txt"
  required_tokens=$((required_tokens + 1))
done <"$tmp/captures.jsonl"

# The same walk over committed Exhibits of every other kind: committing one runs
# the same RFC 3161 path ingesting a Capture does (X26), so its token is
# required on exactly the same terms.
while IFS= read -r line; do
  [ -n "$line" ] || continue
  id=$(field "$line" '.exhibitId')
  in_list "$deleted" "$id" && continue
  if [ "$have_selection" -eq 1 ] && ! in_list "$selection" "$id"; then
    continue
  fi
  imprint=$(field "$line" '.contentHash')
  encoded=$(jq -rn --arg h "$imprint" \\
    "first(inputs | $signed_token_filter | select(.captureContentHash == \\$h) | .tsaToken) // empty" \\
    manifest.jsonl)
  [ -n "$encoded" ] || continue
  printf '%s %s %s\\n' "$id" "$imprint" "$encoded" >>"$tmp/required-tokens.txt"
  required_tokens=$((required_tokens + 1))
done <"$tmp/exhibits.jsonl"

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

if [ "$required_tokens" -eq 0 ]; then
  if [ "$signed_tokens" -gt 0 ]; then
    note "$signed_tokens signed token(s) belong only to deleted or out-of-scope captures, so they are expected absent and need no anchor"
  else
    note 'the signed manifest carries no RFC 3161 token, so it makes no trusted-time claim'
  fi
elif [ ! -f "$TSA_ROOT" ]; then
  note "$TSA_ROOT is absent: this case was configured with a non-default timestamp authority"
  note "obtain that authority's own root and re-run the step 6b command from VERIFY.md with it as -CAfile"
  incomplete "$required_tokens signed token(s) were not verified: no anchor is enclosed for this script to name"
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

# The bytes of every signed token, required or not, so the reverse pass below
# does not report a deleted capture's enclosed token as unaccounted for.
: >"$tmp/signed-shas.txt"
while IFS=' ' read -r imprint encoded; do
  [ -n "$encoded" ] || continue
  printf '%s' "$encoded" | openssl base64 -d -A >"$tmp/signed-token.der" 2>/dev/null || continue
  sha256_of "$tmp/signed-token.der" >>"$tmp/signed-shas.txt"
done <"$tmp/signed-tokens.txt"

# Every required token: it must be enclosed, and it must verify to the anchor.
while IFS=' ' read -r id imprint encoded; do
  [ -n "$encoded" ] || continue
  if ! printf '%s' "$encoded" | openssl base64 -d -A >"$tmp/signed-token.der" 2>/dev/null; then
    fail "capture $id: its signed timestamp entry carries a tsaToken that is not base64"
    continue
  fi
  token_sha=$(sha256_of "$tmp/signed-token.der")
  token=$(grep "^$token_sha " "$tmp/file-index.txt" | cut -d' ' -f2)
  if [ -z "$token" ]; then
    fail "capture $id: the signed manifest carries a timestamp token for imprint $imprint but no enclosed file holds those bytes"
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
done <"$tmp/required-tokens.txt"

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
elif [ "$signed_tokens" -gt 0 ]; then
  printf 'That is an integrity and internal-consistency result only. The signed chain carries\\n'
  printf 'RFC 3161 tokens, but only for captures this package does not enclose, so it makes no\\n'
  printf 'trusted-time claim about its contents for you to check.\\n'
else
  printf 'That is an integrity and internal-consistency result only. The signed chain carries no\\n'
  printf 'RFC 3161 token, so this package makes no trusted-time claim for you to check.\\n'
fi
exit 0
`
