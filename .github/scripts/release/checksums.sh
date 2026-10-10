#!/usr/bin/env bash
# Writes a release's checksum file: the SHA-256 of every asset on the release, in
# sha256sum's own output format, so `sha256sum --check` verifies a download (#1625).
#
# The sums are taken from copies downloaded back from the release, so they describe
# the bytes the release serves and name exactly the assets it lists at that moment.
# An asset with the output file's own name is left out, so a re-run replaces an
# earlier checksum file instead of listing it.
#
# The release is named by ID, not tag: publish.sh hashes a draft, which has no tag
# yet and which "Get a release by tag name" does not return (ADR-0047).
#
# Usage: checksums.sh <owner/repo> <release-id> <output-file>
# Env in: GH_TOKEN. A draft and its assets are readable only with write access to
#         the repository, so publish.sh's token. `gh release download` is not used:
#         in gh 2.96.0 it also sends a GraphQL query.
set -euo pipefail

fail() {
  echo "checksums.sh: $*" >&2
  exit 1
}

if [ $# -ne 3 ]; then
  echo 'usage: checksums.sh <owner/repo> <release-id> <output-file>' >&2
  exit 2
fi
repo=$1
release_id=$2
out=$3
own=$(basename -- "$out")

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir "$work/assets"
release=$(gh api "repos/$repo/releases/$release_id") ||
  fail "cannot read release $release_id of $repo"
# Sorted by name, so the same assets always give the same file.
jq -r '.assets | sort_by(.name)[] | "\(.id)\t\(.name)"' <<<"$release" >"$work/list" ||
  fail "release $release_id of $repo did not list its assets"

names=()
while IFS=$'\t' read -r id name; do
  [ "$name" != "$own" ] || continue
  gh api -H 'Accept: application/octet-stream' "repos/$repo/releases/assets/$id" \
    >"$work/assets/$name" || fail "cannot download $name from release $release_id of $repo"
  names+=("$name")
done <"$work/list"
[ ${#names[@]} -gt 0 ] || fail "release $release_id of $repo has no assets to hash"

sums=$(cd "$work/assets" && sha256sum -- "${names[@]}") || fail "cannot hash the assets of release $release_id"
mkdir -p "$(dirname -- "$out")"
printf '%s\n' "$sums" >"$out"
echo "checksums.sh: wrote $out, ${#names[@]} assets"
