#!/usr/bin/env bash
# Put each pass's downloaded output at <dir>/<pass>/, where `fleet.mjs record` reads it.
#
# Usage: collect.sh <download directory>
#
# actions/download-artifact gives each of several artifacts a directory named for it,
# <dir>/leg-<pass>/, and extracts a lone artifact straight into <dir> with no directory. The
# layout therefore does not always say which pass an output is from, so leg.sh writes the name
# into the output as the file `pass`, and this script goes by that file. It never takes a name
# from the run. A lone output that names no pass, or an artifact whose file names another pass,
# is an error: nothing is moved and the record step stops. An artifact directory with no such
# file is placed by its artifact name, which is how a pass uploaded before this file existed.
# A pass with no artifact gets no directory, and record reads it as failed.
set -euo pipefail

passes='correctness claims contract tests verify-codex'

fail() {
  echo "::error::review-fleet: $*" >&2
  exit 1
}

dir="${1:?usage: collect.sh <download directory>}"
[ -d "$dir" ] || fail "$dir is not a directory"

# The pass that the `pass` file of a directory names, or nothing when it names none of them.
named() {
  local name pass
  if [ ! -f "$1/pass" ] || [ -L "$1/pass" ]; then return 0; fi
  name="$(head -c 64 "$1/pass")"
  for pass in $passes; do
    if [ "$name" = "$pass" ]; then printf '%s' "$pass"; fi
  done
}

plain_file() { [ -f "$1" ] && [ ! -L "$1" ]; }

shopt -s nullglob dotglob
entries=("$dir"/*)
lone=()
for entry in "${entries[@]}"; do
  if plain_file "$entry"; then lone+=("$entry"); fi
done

if [ "${#lone[@]}" -gt 0 ]; then
  # One artifact, extracted with no directory: every entry is a file of that one output.
  for entry in "${entries[@]}"; do
    plain_file "$entry" || fail "unexpected $(basename "$entry") beside a lone output"
  done
  pass="$(named "$dir")"
  [ -n "$pass" ] || fail 'an output in the download names no pass'
  mkdir "$dir/$pass"
  mv -- "${lone[@]}" "$dir/$pass/"
  exit 0
fi

# Several artifacts: each entry is a directory leg-<pass>, and its own file, when it has one,
# names the same pass. Every entry is checked before any is moved.
for entry in "${entries[@]}"; do
  name="$(basename "$entry")"
  pass="${name#leg-}"
  known=''
  for candidate in $passes; do
    if [ "$candidate" = "$pass" ]; then known=1; fi
  done
  if [ ! -d "$entry" ] || [ -L "$entry" ] || [ "$name" = "$pass" ] || [ -z "$known" ]; then
    fail "unexpected $name"
  fi
  if [ -e "$entry/pass" ] || [ -L "$entry/pass" ]; then
    [ "$(named "$entry")" = "$pass" ] || fail "the artifact $name does not name the pass $pass"
  fi
done
for entry in "${entries[@]}"; do
  name="$(basename "$entry")"
  mv -- "$entry" "$dir/${name#leg-}"
done
