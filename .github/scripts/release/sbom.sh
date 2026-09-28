#!/usr/bin/env bash
# Writes a release's software bill of materials: GitHub's dependency-graph export of
# a repository, an SPDX 2.3 JSON document, saved byte for byte as GitHub serves it
# (#1625). The document describes the repository's main branch at export time; its
# repository package carries versionInfo "main", not the tag.
#
# Uses the asynchronous export, generate-report then fetch-report. GitHub's REST
# docs close the synchronous GET /repos/{owner}/{repo}/dependency-graph/sbom after
# 2026-11-13. On 2026-09-28 both returned the same packages, SPDX ids and
# relationships for this repository; array order, creation time and document
# namespace differed.
#
# Usage: sbom.sh <owner/repo> <output-file>
# Env in: GH_TOKEN. GitHub's REST docs ("REST API endpoints for software bill of
#         materials (SBOM)") require "Contents" repository permission (read) for
#         both calls, so release.yml passes its contents: read workflow token.
#         SBOM_POLL_ATTEMPTS (default 60) and SBOM_POLL_SECONDS (default 5) bound
#         the wait for GitHub to finish generating the report.
set -euo pipefail

fail() {
  echo "sbom.sh: $*" >&2
  exit 1
}

if [ $# -ne 2 ]; then
  echo 'usage: sbom.sh <owner/repo> <output-file>' >&2
  exit 2
fi
repo=$1
out=$2
attempts=${SBOM_POLL_ATTEMPTS:-60}
delay=${SBOM_POLL_SECONDS:-5}
[[ $attempts =~ ^[1-9][0-9]*$ ]] ||
  fail "SBOM_POLL_ATTEMPTS must be a positive integer, got '$attempts'"
[[ $delay =~ ^[0-9]+$ ]] || fail "SBOM_POLL_SECONDS must be a whole number, got '$delay'"

report=$(gh api "repos/$repo/dependency-graph/sbom/generate-report") ||
  fail "GitHub did not start an SBOM report for $repo"
url=$(jq -r '.sbom_url // empty' <<<"$report") ||
  fail "generate-report did not answer JSON: $report"
[[ $url == https://* ]] || fail "generate-report named no report URL: $report"

body=$(mktemp)
trap 'rm -f "$body"' EXIT
for ((i = 1; ; i++)); do
  # While the report is generating, fetch-report answers 202 with an empty JSON
  # object (observed 2026-09-28; the docs say no content). Once it is ready it
  # answers a 302 to the document, which gh follows.
  gh api "$url" >"$body" || fail "cannot fetch the SBOM report at $url"
  jq -e 'type == "object" and length > 0' "$body" >/dev/null 2>&1 && break
  [ "$i" -lt "$attempts" ] ||
    fail "the SBOM report was not ready after $attempts attempts;" \
      "last answer: $(head -c 200 "$body")"
  sleep "$delay"
done

jq -e '.spdxVersion == "SPDX-2.3" and (.packages | length > 0)' "$body" >/dev/null ||
  fail 'the export is not an SPDX-2.3 document that lists packages'
mkdir -p "$(dirname -- "$out")"
cp "$body" "$out"
echo "sbom.sh: wrote $out, $(jq '.packages | length' "$out") packages"
