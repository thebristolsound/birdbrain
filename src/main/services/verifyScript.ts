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

import { EXPORT_ENTRY_REQUIRED_SCHEMA_VERSION } from '@shared/schemas'
import { PACKAGE_ROOT_FILES } from '../../packages/evidence-package-layout/index'
import { renderShellPathHelpers } from '../../packages/evidence-package-layout/shell'

// Every member of the package this script names, read from the Package Layout.
// The sh block renderShellPathHelpers() embeds below defines the variables
// ($MANIFEST_FILE, $PAGES_DIR, ...) and helpers (capture_page_path, ...) the
// checks use; `set -u` makes a name that drifts from that block fail loudly.
const ROOT = PACKAGE_ROOT_FILES

export const VERIFY_SCRIPT = `#!/bin/sh
# ${ROOT.verifyScript} - one-command verification of this Birdbrain evidence package.
#
# REQUIRED TOOLS. Every tool this script uses is named here and checked for
# before any check runs; a missing one exits 2 naming it:
#   jq, openssl, sha256sum (or shasum, on macOS), cut, dirname, grep, rm, tr,
#   mktemp.
#
# This is the executable form of ${ROOT.verifyRunbook}. It runs the same six steps against
# the package it sits in, prints a line per check, and exits non-zero naming the
# step that failed. ${ROOT.verifyRunbook} explains what each step proves and states the
# trust model; this script does not replace reading it.
#
# USAGE:
#   sh ${ROOT.verifyScript}       The verdict, then a line per check, then the verdict in
#                      full. A package enclosing a signed selection reports the
#                      exhibits left behind as one counted line.
#   sh ${ROOT.verifyScript} -v    The same, with one line per item that count covers.
#
# Exit codes: 0 every check passed, 1 at least one check FAILED, 2 the script
# could not run at all (a missing tool, or this is not an evidence package),
# 3 INCOMPLETE - nothing failed, but a check could not be completed, so this is
# not a pass either. A check that cannot run is never folded into exit 0.
#
# What exit 0 means: every signed entry verifies under the key step 2 resolves
# for it - the enclosed public key, or, for an entry before an import entry,
# the key the first import entry after it carries - and recomputes to its own
# entryHash, and for every capture this package's
# signed chain still calls active and in scope, its page, screenshot and RFC
# 3161 token are enclosed and match that signed entry. A signed token whose
# capture is active and in scope but whose bytes the package does not enclose
# is a FAILURE, not a silence; a deleted or out-of-selection capture's token is
# expected absent, exactly like its page and screenshot. What exit 0 does NOT
# mean: it does not recompute a package-wide hash the way the binary verifier
# does, so a file with no signed entry of its own (${ROOT.report}) is checked only
# against the unsigned index in step 1, and evidence.json, which that index
# does not list, is not hashed by any step. Nor does it mean the
# enclosed TSA root is the authority's real root — step 6a prints that root's
# fingerprint so you can check it against a source outside this package. Until
# you have, the trusted-time result is conditional on a file whoever built this
# package supplied.

set -u

# -v repeats, one line per item, the expected-absent findings that the default
# output states once as a count. A package holding a small selection out of a
# large Case otherwise prints one line per Exhibit it deliberately left behind,
# which reads like a fault report rather than the signed scope it is.
verbose=0
case "\${1:-}" in
-v | --verbose) verbose=1 ;;
'') ;;
*)
  printf '${ROOT.verifyScript}: unknown option "%s". The only option is -v (verbose).\\n' "$1" >&2
  exit 2
  ;;
esac

${renderShellPathHelpers()}

need() {
  command -v "$1" >/dev/null 2>&1 && return 0
  printf '${ROOT.verifyScript}: required tool "%s" was not found on PATH.\\n' "$1" >&2
  printf '${ROOT.verifyScript}: needs jq, openssl, sha256sum (or shasum), cut, dirname, grep, rm, tr, mktemp.\\n' >&2
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

if [ ! -f "$MANIFEST_FILE" ]; then
  printf "${ROOT.verifyScript}: no $MANIFEST_FILE beside this script, so this is not an evidence package.\\n" >&2
  exit 2
fi

tmp=$(mktemp -d) || exit 2

# The verdict is not known until the last check has run, so the checks write to
# a file and the script prints the verdict above that detail at the end. A
# recipient should not have to read several hundred lines to learn whether the
# package passed. Nothing is suppressed: every line still reaches stdout in the
# same order, below the verdict, and the trailing verdict block is unchanged.
#
# The EXIT trap dumps the buffer, so an interrupt or an unexpected abort still
# shows the checks that had run. Between the redirect below and the flush at the
# end this script has no "exit": the tool and package checks that exit 2 all run
# above it, on the real stdout.
detail_file="$tmp/detail.txt"
detail_dumped=0
stdout_saved=0

restore_stdout() {
  [ "$stdout_saved" -eq 1 ] || return 0
  stdout_saved=0
  exec 1>&3 2>&4 3>&- 4>&-
}

dump_detail() {
  [ "$detail_dumped" -eq 0 ] || return 0
  detail_dumped=1
  restore_stdout
  [ -f "$detail_file" ] && cat "$detail_file"
  return 0
}

trap 'dump_detail; rm -rf "$tmp"' EXIT HUP INT TERM

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

# One item of a finding the default output reports as a count. Printed only
# under -v. It always returns 0: there is no "set -e" in this script today, but
# a helper whose exit status silently tracks a verbosity flag is a trap for
# whoever adds one.
detail() {
  [ "$verbose" -eq 1 ] && printf '   %s\\n' "$*"
  return 0
}

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
# trailing newline, under the public key in the file named by $2 - the recipe
# ${ROOT.verifyRunbook} step 2 documents. Prints nothing and returns non-zero on any
# failure, so each caller words its own finding.
verify_line_signature() {
  sig=$(field "$1" '.signature // empty')
  [ -n "$sig" ] || return 1
  field "$1" '.entryHash' | tr -d '\\n' >"$tmp/entryhash.txt"
  printf '%s' "$sig" | openssl base64 -d -A >"$tmp/sig.bin" 2>/dev/null || return 1
  openssl dgst -sha256 -verify "$2" \\
    -signature "$tmp/sig.bin" "$tmp/entryhash.txt" >/dev/null 2>&1
}

# Recomputes one manifest line's entryHash from its body - the recipe ${ROOT.verifyRunbook}
# step 3 documents. Echoes the hex.
recompute_entry_hash() {
  printf '%s' "$1" | jq -cS 'del(.entryHash, .signature)' | tr -d '\\n' | sha256_stdin
}

printf '${ROOT.verifyScript} - Birdbrain evidence package, by-hand verification (see ${ROOT.verifyRunbook})\\n'

exec 3>&1 4>&2
stdout_saved=1
exec >"$detail_file" 2>&1

# --- Step 1 ---------------------------------------------------------------
begin 1 'file integrity against the unsigned index'
if [ ! -f "$EVIDENCE_INDEX_FILE" ]; then
  fail "$EVIDENCE_INDEX_FILE is missing, so the enclosed index cannot be checked"
elif jq -r '.artifacts[] | "\\(.sha256)  \\(.path)"' "$EVIDENCE_INDEX_FILE" |
  sha256_check >"$tmp/step1.out" 2>&1; then
  note "$(grep -c 'OK$' "$tmp/step1.out") enclosed file(s) match $EVIDENCE_INDEX_FILE"
else
  while IFS= read -r bad; do
    [ -n "$bad" ] && printf '   %s\\n' "$bad"
  done <"$tmp/step1.out"
  fail "one or more enclosed files do not match $EVIDENCE_INDEX_FILE"
fi
note "$EVIDENCE_INDEX_FILE is unsigned - steps 3 and 5 are the authoritative bind"

# --- Step 2 ---------------------------------------------------------------
begin 2 'entry signatures'
# Which key each entry verifies under, the rule the Birdbrain verifier applies:
# the key the first import entry after it carries as sourcePublicKeyPem, or the
# enclosed key when no import entry follows it. An import entry carries the key
# of the installation whose chain it continues, and is itself signed by the
# installation that imported it, so it verifies under the next key along. That
# is why a carried key is not taken on trust: the entry carrying it is verified
# here under the next key, and so on to the enclosed key.
: >"$tmp/boundaries.txt"
position=0
while IFS= read -r line; do
  [ -n "$line" ] || continue
  if [ "$(field "$line" '.type')" = 'import' ]; then
    printf '%s' "$line" | jq -j '.sourcePublicKeyPem // empty' >"$tmp/import-key-$position.pem"
    printf '%s\\n' "$position" >>"$tmp/boundaries.txt"
  fi
  position=$((position + 1))
done <"$MANIFEST_FILE"

# The key file the entry at position $1 verifies under.
key_for() {
  while IFS= read -r boundary; do
    if [ "$boundary" -gt "$1" ]; then
      printf '%s' "$tmp/import-key-$boundary.pem"
      return 0
    fi
  done <"$tmp/boundaries.txt"
  printf '%s' "$SIGNING_KEY_FILE"
}

# How a finding names that key.
key_name() {
  case "$1" in
  "$SIGNING_KEY_FILE") printf '%s' "$SIGNING_KEY_FILE" ;;
  *)
    boundary=\${1##*/import-key-}
    printf 'the key import entry %s carries' "\${boundary%.pem}"
    ;;
  esac
}

# One line per run of entries under one key, so the output says which key
# signed which entries. The fingerprint is the SHA-256 of the key's PEM text,
# the value ${ROOT.certification} states for the same run.
key_run_note() {
  if [ "$2" -eq "$3" ]; then
    run_entries="entry $2"
  else
    run_entries="entries $2 to $3"
  fi
  note "$run_entries: $4 signed entr(ies) verified under $(key_name "$1") (SHA-256 $(sha256_of "$1"))"
}

if [ ! -f "$SIGNING_KEY_FILE" ]; then
  fail "$SIGNING_KEY_FILE is missing, so no signature can be checked"
else
  signed_count=0
  unsigned_count=0
  seen_signed=0
  position=0
  run_key=''
  run_from=0
  run_signed=0
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    this=$position
    position=$((position + 1))
    key=$(key_for "$this")
    if [ "$key" != "$run_key" ]; then
      [ -n "$run_key" ] && key_run_note "$run_key" "$run_from" $((this - 1)) "$run_signed"
      run_key=$key
      run_from=$this
      run_signed=0
    fi
    idx=$(field "$line" '.index')
    if [ -z "$(field "$line" '.signature // empty')" ]; then
      unsigned_count=$((unsigned_count + 1))
      if [ "$seen_signed" -eq 1 ]; then
        fail "entry $idx is unsigned but follows a signed entry: rewriting a signed entry as an unsigned one needs no private key, so this is tampering"
      fi
      continue
    fi
    seen_signed=1
    if verify_line_signature "$line" "$key"; then
      signed_count=$((signed_count + 1))
      run_signed=$((run_signed + 1))
    else
      fail "entry $idx: signature does not verify under $(key_name "$key")"
    fi
  done <"$MANIFEST_FILE"
  [ -n "$run_key" ] && key_run_note "$run_key" "$run_from" $((position - 1)) "$run_signed"
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
done <"$MANIFEST_FILE"
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
done <"$MANIFEST_FILE"
if [ "$expect" -eq 0 ]; then
  fail "$MANIFEST_FILE holds no entries"
else
  note "$expect entr(ies) linked from index 0"
  note "index 0 prevHash is not compared: a chain continued from an imported case carries the source head there"
fi

# --- Step 5 ---------------------------------------------------------------
begin 5 'content bind to the signed chain'
selection=''
have_selection=0
# Named scope for the verdict header. Empty until a verified export-entry.json
# declares one: a package without that file states no scope this script can
# repeat, and the header stays silent rather than guessing whole-case.
scope_kind=''
scope_line=''
if [ -f "$EXPORT_ENTRY_FILE" ]; then
  export_entry=$(tr -d '\\n' <"$EXPORT_ENTRY_FILE")
  entry_ok=1
  verify_line_signature "$export_entry" "$SIGNING_KEY_FILE" || entry_ok=0
  [ "$(recompute_entry_hash "$export_entry")" = "$(field "$export_entry" '.entryHash')" ] || entry_ok=0
  [ "$(field "$export_entry" '.prevHash')" = "$head_hash" ] || entry_ok=0
  if [ "$entry_ok" -eq 0 ]; then
    fail "$EXPORT_ENTRY_FILE does not verify against the enclosed key and the chain head, so its declared scope cannot be trusted"
  elif [ "$(field "$export_entry" '.scope // empty')" = 'selection' ]; then
    selection=$(field "$export_entry" '.captureIds[]')
    have_selection=1
    scope_kind=selection
    note "$EXPORT_ENTRY_FILE verifies and declares a selection-scoped package"
  else
    scope_kind=whole
    note "$EXPORT_ENTRY_FILE verifies and declares a whole-case package"
  fi
else
  # #853: absent is not automatically old, and it must not be silent either.
  # evidence.json names the era this package was sealed in, and every package
  # at or above version ${EXPORT_ENTRY_REQUIRED_SCHEMA_VERSION} was sealed with an export entry - so at that
  # version an absent file is a removed one, which is what the binary verifier
  # enclosed beside this script also concludes. The index is unsigned (${ROOT.verifyRunbook}
  # trust model), so a version edited downward still reaches the lenient branch;
  # reporting whose claim the era is, is what this step can do, not settling it.
  # jq compares the number, not its text: 2.0 and 2e0 are version 2 to the
  # binary verifier too.
  #
  # An unreadable era is a FAIL, not a note. The binary verifier rejects an
  # index whose schemaVersion is absent, a string, fractional or non-positive
  # before it ever reaches this question, so noting it here would let the two
  # verifiers in one zip disagree: this script would print PASS over a package
  # the binary FAILs. Leniency needs a stated era to rest on; with none, the
  # export-entry requirement cannot be settled either way.
  era=''
  [ -f "$EVIDENCE_INDEX_FILE" ] && era=$(jq -r '.schemaVersion
    | select(type == "number" and . == floor and . > 0)
    | (if . >= ${EXPORT_ENTRY_REQUIRED_SCHEMA_VERSION} then "sealed " else "pre " end) + (. + 0 | tostring)' \\
    "$EVIDENCE_INDEX_FILE" 2>/dev/null)
  case "$era" in
  'sealed '*)
    fail "$EXPORT_ENTRY_FILE is missing: $EVIDENCE_INDEX_FILE states schema version \${era#sealed }, and every package at or above version ${EXPORT_ENTRY_REQUIRED_SCHEMA_VERSION} was sealed with a signed export entry, so the file was removed rather than never written"
    ;;
  'pre '*)
    note "no $EXPORT_ENTRY_FILE and $EVIDENCE_INDEX_FILE states schema version \${era#pre }. Packages at version \${era#pre } were written both before export entries and after, so this script cannot tell which this package is: an old one, or one whose entry was removed. Its scope is not signed"
    ;;
  *)
    fail "$EXPORT_ENTRY_FILE is missing and $EVIDENCE_INDEX_FILE states no readable schema version - absent, not a number, or not a positive whole number - so the era that would excuse the absence cannot be read, and the Birdbrain verifier enclosed beside this script rejects such an index outright"
    ;;
  esac
fi

deleted=$(jq -r 'select(.type == "deletion") | .captureId' "$MANIFEST_FILE")
jq -c 'select(.type == "capture")' "$MANIFEST_FILE" >"$tmp/captures.jsonl"

bound=0
captures_total=0
captures_outside=0
while IFS= read -r line; do
  [ -n "$line" ] || continue
  captures_total=$((captures_total + 1))
  id=$(field "$line" '.captureId')
  if in_list "$deleted" "$id"; then
    note "capture $id: a later deletion entry accounts for it, so it is expected absent"
    continue
  fi
  if [ "$have_selection" -eq 1 ] && ! in_list "$selection" "$id"; then
    captures_outside=$((captures_outside + 1))
    detail "capture $id: outside the signed export selection, so it is expected absent"
    continue
  fi
  page=$(capture_page_path "$id")
  if [ ! -f "$page" ]; then
    fail "capture $id: $page is missing and nothing signed accounts for its absence"
  elif [ "$(sha256_of "$page")" != "$(field "$line" '.contentHash')" ]; then
    fail "capture $id: $page does not match the contentHash in its signed entry"
  else
    bound=$((bound + 1))
  fi
  shot=$(field "$line" '.screenshotHash // empty')
  if [ -n "$shot" ]; then
    shot_file=$(screenshot_path "$shot")
    if [ ! -f "$shot_file" ]; then
      fail "capture $id: $shot_file is missing but its signed entry carries a screenshotHash"
    elif [ "$(sha256_of "$shot_file")" != "$shot" ]; then
      fail "capture $id: $shot_file does not match its own content address"
    fi
  fi
done <"$tmp/captures.jsonl"
if [ "$captures_outside" -gt 0 ]; then
  note "$captures_outside of $captures_total capture(s) are outside the signed export selection and expected absent - the omission is declared in a signed entry, not inferred (re-run with -v to list them)"
fi
note "$bound capture(s) bound to the signed chain"

# Exhibits of every other kind (ADR-0023). The signed entry carries the path the
# Case store holds the bytes at; the package holds them at the part of that path
# inside the Case directory, keyed by Exhibit id. Same rule as the captures
# above: deleted or out-of-selection means expected absent, anything else
# enclosed and matching its signed contentHash.
jq -c 'select(.type == "exhibit")' "$MANIFEST_FILE" >"$tmp/exhibits.jsonl"
exhibits_bound=0
exhibits_total=0
exhibits_outside=0
while IFS= read -r line; do
  [ -n "$line" ] || continue
  exhibits_total=$((exhibits_total + 1))
  id=$(field "$line" '.exhibitId')
  num=$(field "$line" '.exhibitNumber')
  if in_list "$deleted" "$id"; then
    note "Exhibit $num: a later deletion entry accounts for it, so it is expected absent"
    continue
  fi
  if [ "$have_selection" -eq 1 ] && ! in_list "$selection" "$id"; then
    exhibits_outside=$((exhibits_outside + 1))
    detail "Exhibit $num: outside the signed export selection, so it is expected absent"
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
if [ "$exhibits_outside" -gt 0 ]; then
  note "$exhibits_outside of $exhibits_total exhibit(s) of other kinds are outside the signed export selection and expected absent (re-run with -v to list them)"
fi
note "$exhibits_bound exhibit(s) of other kinds bound to the signed chain"

# Where each active Exhibit's bytes sit, which is also where its Derived Files
# sit. A Capture's are under pages/; every other kind's are in its own kind
# directory, read off the signed path.
: >"$tmp/parent-dirs.txt"
while IFS= read -r line; do
  [ -n "$line" ] || continue
  id=$(field "$line" '.captureId')
  in_list "$deleted" "$id" && continue
  printf '%s %s\\n' "$id" "$PAGES_DIR" >>"$tmp/parent-dirs.txt"
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

# Exhibit Numbers as the chain records them: on an \`exhibit\` entry, on a
# \`capture\` entry that carries one, and for an earlier Capture in the one-time
# \`renumber\` entry. A Capture ingested after its Case was renumbered and
# before capture entries carried numbers has no number in the chain, and is
# then named by its id - never by a number counted here, which would cite
# something nothing signed.
# ONE pass, in manifest order, so the last assignment below is the last one the
# chain made. Two passes - every exhibit entry, then every renumber assignment -
# would order by category instead, and the last write would then be whichever
# kind came second in this file rather than in the manifest.
jq -r '
  if .type == "exhibit" then "\\(.exhibitId) \\(.exhibitNumber)"
  elif .type == "capture" and .exhibitNumber != null then "\\(.captureId) \\(.exhibitNumber)"
  elif .type == "renumber" then (.assignments[] | "\\(.exhibitId) \\(.exhibitNumber)")
  else empty end' "$MANIFEST_FILE" >"$tmp/exhibit-numbers.txt"

# How a finding cites an Exhibit, matching the binary verifier's wording.
#
# The LAST assignment in manifest order wins, which is exactly what the binary
# does when it folds the same entries into a map: a Case renumbered after an
# Exhibit was committed carries both an \`exhibit\` entry and a later
# \`renumber\` assignment for that id, and taking any other one would cite a
# superseded number here and the current one there.
exhibit_label() {
  found=''
  while IFS=' ' read -r numbered_id number; do
    [ "$numbered_id" = "$1" ] || continue
    found="$number"
  done <"$tmp/exhibit-numbers.txt"
  if [ -n "$found" ]; then
    printf 'Exhibit %s' "$found"
  else
    printf 'exhibit %s' "$1"
  fi
}

# Derived Files (X17): bytes the tool computed FROM an Exhibit, enclosed beside
# their parent. A Derived File has no Exhibit Number of its own (X31), so a
# finding names the parent and the derivation that produced it.
jq -c 'select(.type == "derivation")' "$MANIFEST_FILE" >"$tmp/derivations.jsonl"
derived_bound=0
derived_outside=0
while IFS= read -r line; do
  [ -n "$line" ] || continue
  parent=$(field "$line" '.parentExhibitId')
  derivation=$(field "$line" '.derivation')
  if ! pdir=$(parent_dir "$parent"); then
    note "derivation $derivation of $parent: no active exhibit entry answers for its parent, so it is expected absent"
    continue
  fi
  if [ "$have_selection" -eq 1 ] && ! in_list "$selection" "$parent"; then
    derived_outside=$((derived_outside + 1))
    detail "derivation $derivation of $parent: its parent is outside the signed export selection, so it is expected absent"
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
if [ "$derived_outside" -gt 0 ]; then
  note "$derived_outside derived file(s) have a parent outside the signed export selection and are expected absent (re-run with -v to list them)"
fi
note "$derived_bound derived file(s) bound to the signed chain"

case "$scope_kind" in
selection)
  scope_line="Scope: a signed selection. $captures_outside of $captures_total capture(s) in the chain are outside it and expected absent."
  ;;
whole)
  scope_line="Scope: the whole case, $captures_total capture(s) in the chain."
  ;;
esac

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
# A schema-4 stamp with subject "entry" binds a merge entry's Entry Hash, not
# an Exhibit's content, and the binary excludes it from trusted time. This
# filter must agree, or the runbook would present a receipt as a capture's
# timestamp and contradict the binary (#1518 review).
signed_token_filter='select(.type == "timestamp" and (.subject // "content") == "content" and (.tsaToken | type) == "string")'
jq -r "$signed_token_filter"' | "\\(.captureContentHash) \\(.tsaToken)"' \\
  "$MANIFEST_FILE" >"$tmp/signed-tokens.txt"

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
    "$MANIFEST_FILE")
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
    "$MANIFEST_FILE")
  [ -n "$encoded" ] || continue
  printf '%s %s %s\\n' "$id" "$imprint" "$encoded" >>"$tmp/required-tokens.txt"
  required_tokens=$((required_tokens + 1))
done <"$tmp/exhibits.jsonl"

# sha256 of every enclosed token file. A signed entry is matched to a file by
# its bytes, because nothing signed the file's name.
: >"$tmp/file-index.txt"
if [ -d "$TIMESTAMPS_DIR" ]; then
  for candidate in "$TIMESTAMPS_DIR"/*; do
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
  note "obtain that authority's own root and re-run the step 6b command from ${ROOT.verifyRunbook} with it as -CAfile"
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

# The verdict, above the detail the checks just wrote. Same three outcomes and
# the same counts as the block at the end of this script, which is unchanged: a
# reader who scrolls to the bottom still finds the full statement of what a PASS
# does and does not mean.
if [ "$fail_count" -gt 0 ]; then
  verdict_header="${ROOT.verifyScript}: FAIL - $fail_count check(s) failed, in step(s):$failed_steps"
elif [ "$incomplete_count" -gt 0 ]; then
  verdict_header="${ROOT.verifyScript}: INCOMPLETE - $incomplete_count check(s) could not be run, in step(s):$incomplete_steps"
else
  verdict_header="${ROOT.verifyScript}: PASS - every check succeeded."
fi
restore_stdout
printf '%s\\n' "$verdict_header"
if [ -n "$scope_line" ]; then
  printf '%s\\n' "$scope_line"
fi
printf 'Every check follows in order, and the full verdict repeats at the end.\\n'
dump_detail

printf '\\n'
if [ "$fail_count" -gt 0 ]; then
  printf '${ROOT.verifyScript}: FAIL - %s check(s) failed, in step(s):%s\\n' "$fail_count" "$failed_steps"
  printf 'Read the FAIL lines above. ${ROOT.verifyRunbook} explains what each step proves.\\n'
  exit 1
fi

if [ "$incomplete_count" -gt 0 ]; then
  printf '${ROOT.verifyScript}: INCOMPLETE - nothing failed, but %s check(s) could not be run, in step(s):%s\\n' \\
    "$incomplete_count" "$incomplete_steps"
  printf 'This is not a pass. Read the INCOMPLETE lines above and run those checks by hand\\n'
  printf 'with the material they name; ${ROOT.verifyRunbook} gives the command for each step.\\n'
  exit 3
fi

printf '${ROOT.verifyScript}: PASS - every check above succeeded.\\n'
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
