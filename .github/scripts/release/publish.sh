#!/usr/bin/env bash
# Publishes a release that can never change afterwards (ADR-0047). It creates a draft with
# no tag, attaches every file in <dir>, writes the checksum file from the draft's assets as
# GitHub serves them (#1625) and attaches it, then publishes. GitHub creates the tag at
# publication, so the tag reaches the update feed with every file already attached. Under
# immutable releases nothing can be added after that, so the checksum file goes on first.
#
# A re-run resumes: a published release for the tag means an earlier attempt finished,
# and a draft an earlier attempt left behind is deleted first. A draft has no tag, so no
# one but the repository's writers can see it.
#
# Usage: publish.sh <owner/repo> <tag> <target-commitish> <notes-file> <dir>
# Env in: GH_TOKEN, write access to <owner/repo>, for the draft and its files.
#         PUBLISH_TOKEN, for the one call that publishes and so creates the tag. On
#         thebristolsound/birdbrain the tag ruleset admits only the maintainer, so
#         release.yml passes the maintainer's token there.
set -euo pipefail

fail() {
  echo "publish.sh: $*" >&2
  exit 1
}

if [ $# -ne 5 ]; then
  echo 'usage: publish.sh <owner/repo> <tag> <target-commitish> <notes-file> <dir>' >&2
  exit 2
fi
repo=$1
tag=$2
target=$3
notes=$4
dir=$5
[ -n "${PUBLISH_TOKEN:-}" ] || fail 'PUBLISH_TOKEN is not set'
[ -f "$notes" ] || fail "no release notes at $notes"
here=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)

# "Get a release by tag name" returns published releases only.
if gh api "repos/$repo/releases/tags/$tag" >/dev/null 2>&1; then
  echo "publish.sh: $tag is already published on $repo"
  exit 0
fi

releases=$(gh api --paginate "repos/$repo/releases") || fail "cannot list the releases of $repo"
stale=$(jq -r --arg tag "$tag" '.[] | select(.draft and .tag_name == $tag) | .id' \
  <<<"$releases") || fail "the release list of $repo is not JSON"
for id in $stale; do
  gh api -X DELETE "repos/$repo/releases/$id" >/dev/null ||
    fail "cannot delete the draft $id an earlier attempt left on $repo"
done

# prerelease=true is a literal, not derived from the tag name. ADR-0008 Decision 3: "No
# release is promoted to a full release while artifacts are unsigned." Change it only
# when that decision's revisit trigger is met:
#   "A release process that signs every artifact and notarizes macOS builds,
#   with both verified on the release's actual output — acquiring a
#   certificate or notarization capability alone does not qualify. Only after
#   that verification may releases be promoted to full releases and this
#   restriction be lifted."
draft=$(gh api -X POST "repos/$repo/releases" -f tag_name="$tag" \
  -f target_commitish="$target" -f name="$tag" -F draft=true -F prerelease=true \
  -F body=@"$notes") || fail "cannot create a draft for $tag on $repo"
id=$(jq -r '.id // empty' <<<"$draft")
[[ $id =~ ^[0-9]+$ ]] || fail "the new draft for $tag on $repo has no ID: $draft"

upload() {
  gh api -X POST "https://uploads.github.com/repos/$repo/releases/$id/assets?name=$2" \
    -H 'Content-Type: application/octet-stream' --input "$1" >/dev/null ||
    fail "cannot attach $2 to the draft for $tag on $repo"
}

count=0
for file in "$dir"/*; do
  [ -f "$file" ] || continue
  name=$(basename -- "$file")
  [ "$name" != SHA256SUMS.txt ] || continue
  upload "$file" "$name"
  count=$((count + 1))
done
[ "$count" -gt 0 ] || fail "no files to release in $dir"

bash "$here/checksums.sh" "$repo" "$id" "$dir/SHA256SUMS.txt"
upload "$dir/SHA256SUMS.txt" SHA256SUMS.txt

GH_TOKEN=$PUBLISH_TOKEN gh api -X PATCH "repos/$repo/releases/$id" -F draft=false \
  >/dev/null || fail "cannot publish $tag on $repo"
echo "publish.sh: published $tag on $repo with $count files and SHA256SUMS.txt"
