#!/usr/bin/env bash
# Writes a release's checksum file: the SHA-256 of every asset on the release, in
# sha256sum's own output format, so `sha256sum --check` verifies a download (#1625).
#
# The sums are taken from copies downloaded back from the release, so they describe
# the bytes the release serves and name exactly the assets it lists at that moment.
# An asset with the output file's own name is left out, so a re-run replaces an
# earlier checksum file instead of listing it.
#
# Usage: checksums.sh <owner/repo> <tag> <output-file>
# Env in: GH_TOKEN. The two reads, "Get a release by tag name" and "Get a release
#         asset", are REST endpoints GitHub's docs let a token without the
#         repository's permissions call when only public resources are requested.
#         The releases repository is public, so release.yml passes its workflow
#         token. `gh release download` is not used: in gh 2.96.0 it also sends a
#         GraphQL query.
set -euo pipefail

fail() {
  echo "checksums.sh: $*" >&2
  exit 1
}

if [ $# -ne 3 ]; then
  echo 'usage: checksums.sh <owner/repo> <tag> <output-file>' >&2
  exit 2
fi
repo=$1
tag=$2
out=$3
own=$(basename -- "$out")

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir "$work/assets"
release=$(gh api "repos/$repo/releases/tags/$tag") || fail "cannot read release $tag of $repo"
# Sorted by name, so the same assets always give the same file.
jq -r '.assets | sort_by(.name)[] | "\(.id)\t\(.name)"' <<<"$release" >"$work/list" ||
  fail "release $tag of $repo did not list its assets"

names=()
while IFS=$'\t' read -r id name; do
  [ "$name" != "$own" ] || continue
  gh api -H 'Accept: application/octet-stream' "repos/$repo/releases/assets/$id" \
    >"$work/assets/$name" || fail "cannot download $name from release $tag of $repo"
  names+=("$name")
done <"$work/list"
[ ${#names[@]} -gt 0 ] || fail "$tag on $repo has no assets to hash"

sums=$(cd "$work/assets" && sha256sum -- "${names[@]}") || fail "cannot hash the assets of $tag"
mkdir -p "$(dirname -- "$out")"
printf '%s\n' "$sums" >"$out"
echo "checksums.sh: wrote $out, ${#names[@]} assets"
