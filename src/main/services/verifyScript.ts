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

import { MANIFEST_SCHEMA_VERSION } from '@shared/constants'
import { EXPORT_ENTRY_REQUIRED_SCHEMA_VERSION, MANIFEST_ENTRY_TYPES } from '@shared/schemas'
import { SHARED_CASE_ENTRY_TYPES } from '@shared/verify'
import {
  LINEAGE_DIRECTORY,
  PACKAGE_ROOT_FILES,
  memberChainPath
} from '../../packages/evidence-package-layout/index'
import { renderShellPathHelpers } from '../../packages/evidence-package-layout/shell'
import {
  MEMBER_CHAINS_STEP,
  VERIFY_RECIPES,
  sentenceStart,
  stepRange,
  stepRef,
  verifyStep,
  type VerifyStepNumber
} from '@main/services/verifyProcedure'

// Every member of the package this script names, read from the Package Layout.
// The sh block renderShellPathHelpers() embeds below defines the variables
// ($MANIFEST_FILE, $PAGES_DIR, ...) and helpers (capture_page_path, ...) the
// checks use; `set -u` makes a name that drifts from that block fail loudly.
const ROOT = PACKAGE_ROOT_FILES

// The two lines that open a step: its banner comment and its begin call.
function openStep(number: VerifyStepNumber | string, title = ''): string {
  const banner = `# --- Step ${number} `.padEnd(76, '-')
  const scriptTitle = typeof number === 'number' ? verifyStep(number).scriptTitle : title
  return `${banner}\nbegin ${number} '${scriptTitle}'`
}

// A member chain's file name around its installation id, so the glob below
// matches exactly the names the Package Layout gives member chains.
const [CHAIN_PREFIX, CHAIN_SUFFIX] = memberChainPath('\u0000').split('\u0000')

const jqStrings = (values: Iterable<string>): string => JSON.stringify([...values])

// The jq programs step 4a runs. Each is the sh-quotable form of one rule in
// src/shared/verify/sharedCase.ts, named after the function it mirrors; none
// holds a single quote, so each sits inside one in the script.
//
// The whitespace String.prototype.trim removes, by code point, and the two
// uses sharedCase.ts makes of it: a line that holds more than whitespace, and
// samePem's normalized key. None calls a jq regex builtin, which a jq built
// without Oniguruma lacks.
const JQ_TEXT = String.raw`def js_space: . == 32 or (. >= 9 and . <= 13) or . == 160 or . == 5760
  or (. >= 8192 and . <= 8202) or . == 8232 or . == 8233 or . == 8239 or . == 8287
  or . == 12288 or . == 65279;
def nonblank: explode | any(.[]; js_space | not);
def pem: split("\r\n") | join("\n") | explode as $c
  | [range(0; $c | length) | select($c[.] | js_space | not)] as $k
  | if ($k | length) == 0 then "" else $c[$k[0]:$k[-1] + 1] | implode end;`

// A chain's raw lines and where its current segment starts (rawSegment).
const JQ_RAW_SEGMENT = String.raw`${JQ_TEXT}
def raw: try fromjson catch null;
[inputs | select(nonblank)] as $lines
| ([range(0; $lines | length)
    | select(($lines[.] | raw | if type == "object" then .type else null end) == "import")]
   | last // 0) as $start`

// readOwnerClaim: the line and key of the Owner's member-add, read unverified
// from a chain named for the installation it claims, only to locate it.
const JQ_OWNER_CLAIM = String.raw`${JQ_RAW_SEGMENT}
| first(range($start; $lines | length) as $i | ($lines[$i] | raw) as $r
    | select((($r | type) != "object" and ($r | type) != "array")
        or (($r | type) == "object" and $r.type == "member-add"))
    | {i: $i, r: $r})
| select((.r | type) == "object" and .r.role == "owner" and .r.memberInstallationId == $id
    and (.r.memberPublicKeyPem | type) == "string")
| {i: .i, pem: .r.memberPublicKeyPem}`

// readMemberIdForKey: which installation the Owner's chain names with a key.
const JQ_MEMBER_FOR_KEY = String.raw`${JQ_RAW_SEGMENT}
| first(range($start; $lines | length) as $i | ($lines[$i] | raw) as $r
    | if ($r | type) != "object" and ($r | type) != "array" then {stop: true}
      elif ($r | type) == "object" and $r.type == "member-add"
        and ($r.memberInstallationId | type) == "string"
        and ($r.memberPublicKeyPem | type) == "string"
        and ($r.memberPublicKeyPem | pem) == ($key | pem) then {id: $r.memberInstallationId}
      else empty end)
| .id // empty`

// An entry from a newer schema than this script reads (detectUnsupportedEntry).
const JQ_NEWER_ENTRY = String.raw`.type as $t
| if ((.schemaVersion | type) == "number" and .schemaVersion == (.schemaVersion | floor)
      and .schemaVersion > ${MANIFEST_SCHEMA_VERSION})
    or (($t | type) == "string" and ([${jqStrings(MANIFEST_ENTRY_TYPES)}[] | select(. == $t)] | length) == 0)
  then "type \($t), schema version \(.schemaVersion)" else empty end`

// Whether a chain is part of a Shared Case at all (the package verifier's
// isShared, over the manifest).
const JQ_SHARED_SIGNAL = String.raw`any(inputs; . as $e
  | ([${jqStrings(SHARED_CASE_ENTRY_TYPES)}[] | select(. == $e.type)] | length) > 0
    or ($e.type == "exhibit" and $e.memberCode != null))`

// The entries of a chain from its last import on (currentSegment).
const JQ_SEGMENT = String.raw`(map(select(.type == "import") | .index) | max // 0) as $cut
| .[] | select(.index >= $cut)`

// buildRoster, over the Owner chain's current segment.
const JQ_ROSTER = String.raw`${JQ_TEXT}
def on_roster($id): any(.members[]; .installationId == $id);
. as $all
| reduce $all[] as $e ({members: [], findings: [], exclusions: [], ownerId: null, caseId: null};
    if $e.type == "member-add" then
      ($e.memberInstallationId) as $id
      | if (.members | length) == 0 and $e.role != "owner" then
          .findings += ["entry \($e.index): first member-add has role \u0027\($e.role)\u0027, expected \u0027owner\u0027"]
        elif (.members | length) == 0 and ($e.memberPublicKeyPem | pem) != ($ownerKey | pem) then
          .findings += ["entry \($e.index): the Owner\u0027s member-add carries a key other than the one its chain verified under"]
        elif (.members | length) > 0 and $e.role == "owner" then
          .findings += ["entry \($e.index): a second member-add with role \u0027owner\u0027 (\($id))"]
        elif on_roster($id) then
          .findings += ["entry \($e.index): member-add for an installation already on the roster (\($id))"]
        elif any(.members[]; .memberCode == $e.memberCode) then
          .findings += ["entry \($e.index): member-add reuses Member Code \($e.memberCode)"]
        elif any(.members[]; (.publicKeyPem | pem) == ($e.memberPublicKeyPem | pem)) then
          .findings += ["entry \($e.index): member-add for \($id) carries the key of \(first(.members[] | select((.publicKeyPem | pem) == ($e.memberPublicKeyPem | pem))) | .installationId)"]
        else
          (if (.members | length) == 0 then .ownerId = $id | .caseId = $e.caseId else . end)
          | .members += [{installationId: $id, memberCode: $e.memberCode,
              publicKeyPem: $e.memberPublicKeyPem, role: $e.role, revokedAt: null, acceptedHead: null}]
        end
    elif $e.type == "member-revoke" then
      ($e.memberInstallationId) as $id
      | (first(.members | to_entries[] | select(.value.installationId == $id)) // null) as $m
      | if $m == null then
          .findings += ["entry \($e.index): member-revoke for an installation not on the roster (\($id))"]
        elif $m.value.revokedAt != null then
          .findings += ["entry \($e.index): member-revoke for an installation already revoked (\($id))"]
        elif $m.value.role == "owner" then
          .findings += ["entry \($e.index): member-revoke names the Owner"]
        else
          .members[$m.key].revokedAt = $e.index
          | .members[$m.key].acceptedHead = ([$all[] | select(.type == "merge" and .index < $e.index)
              | .heads[] | select(.installationId == $id) | .index] | max)
        end
    elif $e.type == "exclude" then
      if on_roster($e.authorInstallationId) then
        .exclusions += [{exhibitId: $e.exhibitId, author: $e.authorInstallationId, index: $e.index}]
      else
        .findings += ["entry \($e.index): exclude names an author not on the roster (\($e.authorInstallationId))"]
      end
    else . end)`

// foreignCaseEntry: the first entry of a chain's current segment naming
// another Case.
const JQ_FOREIGN_CASE = String.raw`(map(select(.type == "import") | .index) | max // 0) as $cut
| first(.[] | select(.index >= $cut and .caseId != $caseId)) | "\(.index) \(.caseId)"`

// The step-4a records: {chain, e} per accepted entry, plus one {chain} marker
// per chain that verified, so a chain with no accepted entry still exists.
const JQ_BY_CHAIN = String.raw`(reduce .[] as $r ({};
  .[$r.chain] += (if $r.e == null then [] else [$r.e] end))) as $by`

// The entries a Case wrote: a forked Owner chain's history is its source's.
const JQ_WALKED = String.raw`.[] | select(.e != null and (.chain != $owner or .e.index >= $cut))`

// checkMergeHeads, over every merge a Case wrote. Prints "ok" per head that
// resolves, and the finding for one that does not.
const JQ_MERGE_HEADS = String.raw`${JQ_BY_CHAIN}
| ${JQ_WALKED} | select(.e.type == "merge") | . as $r | $r.e.heads[] | . as $h
| ($by[$h.installationId]) as $t
| "merge entry \($r.e.index) of \($r.chain)" as $m
| if $h.installationId == $r.chain then "\($m) names its own chain as a head"
  elif $t == null then "\($m) names installation \($h.installationId), whose chain is not present or did not verify"
  elif ($h.index | type) != "number" or $h.index < 0 or $h.index != ($h.index | floor)
    or $h.index >= ($t | length) then
    "\($m) names index \($h.index) of \($h.installationId), which has \($t | length) entries"
  elif $t[$h.index].entryHash != $h.entryHash then
    "\($m) names index \($h.index) of \($h.installationId) with a hash that differs from the entry there"
  else "ok" end`

// verifyCase step 4, resolveCitation included: {findings, citations}.
const JQ_CITATIONS = String.raw`def resolve($at; $n; $code):
  (if $code == null then "\($n)" else "\($code)-\($n)" end) as $cit
  | .c[$cit] as $ex
  | if $ex != null and $ex.chain == $at.chain and $ex.exhibitId != $at.exhibitId then .
    elif $ex != null then
      .findings += [if $ex.exhibitId == $at.exhibitId
        then "citation \($cit) resolves to two entries for exhibit \($at.exhibitId) (index \($ex.index) of \($ex.chain) and index \($at.index) of \($at.chain))"
        else "citation \($cit) resolves to exhibits \($ex.exhibitId) and \($at.exhibitId)" end]
    else .c[$cit] = $at end;
reduce (${JQ_WALKED}) as $r ({c: {}, findings: []};
  ($codes[$r.chain]) as $code | $r.e as $e
  | if $e.type == "exhibit" then
      if $e.memberCode != null and $e.memberCode != $code then
        .findings += [if $code == null
          then "exhibit entry \($e.index) claims Member Code \($e.memberCode) in a Case with no roster"
          else "exhibit entry \($e.index) of \($r.chain) claims Member Code \($e.memberCode), its writer\u0027s is \($code)" end]
      else resolve({chain: $r.chain, index: $e.index, exhibitId: $e.exhibitId}; $e.exhibitNumber; $code) end
    elif $e.type == "capture" and $e.exhibitNumber != null then
      resolve({chain: $r.chain, index: $e.index, exhibitId: $e.captureId}; $e.exhibitNumber; $code)
    elif $e.type == "renumber" then
      reduce $e.assignments[] as $a (.;
        resolve({chain: $r.chain, index: $e.index, exhibitId: $a.exhibitId}; $a.exhibitNumber; $code))
    else . end)
| (.findings[] | "finding \(.)"), (.c | to_entries[] | "cite \(.value.exhibitId) \(.key)")`

// verifyCase step 5: every exclusion names an Exhibit its author's chain holds.
const JQ_EXCLUSIONS = String.raw`. as $records
| $roster[0].exclusions[] as $x
| [$records[] | select(.chain == $x.author)] as $a
| select(($a | length) > 0)
| select(any($a[] | .e // empty;
    (.type == "exhibit" and .exhibitId == $x.exhibitId)
    or (.type == "capture" and .captureId == $x.exhibitId)) | not)
| "exclude at index \($x.index) names Exhibit \($x.exhibitId), which the chain of \($x.author) does not hold"`

// The package verifier's deleted-id rule once remote entries count: a
// deletion removes an Exhibit its own side of the package authored, or one no
// chain authored. $l is this chain, $r every remote chain's accepted entries.
const JQ_DELETED = String.raw`def authored: [.[] | if .type == "capture" then .captureId
  elif .type == "exhibit" then .exhibitId else empty end];
def keep($own; $all): select(. as $id | any($own[]; . == $id) or (any($all[]; . == $id) | not));
($l | authored) as $la | ($r | authored) as $ra
| ($l[] | select(.type == "deletion") | .captureId | keep($la; $la + $ra)),
  ($r[] | select(.type == "deletion") | .captureId | keep($ra; $la + $ra))`

// describeRoster, as the verifier enclosed beside this script words it.
const JQ_DESCRIBE_ROSTER = String.raw`"\(.members | length) member(s): "
  + ([.members[] | "\(.memberCode)=\(.installationId)"
      + (if .revokedAt == null then "" else " (revoked)" end)] | join(", "))`

const JQ_MEMBERSHIP_ENTRY = String.raw`first(inputs
  | select(.type == "member-add" or .type == "member-revoke" or .type == "exclude"))
| "\(.index) \(.type)"`

// Step 4a: the member chains of a Shared Case package, walked the way
// verifySharedCaseReplica in src/shared/verify/sharedCase.ts walks them, one
// Case at a time from this one back through each Case it was forked from. It
// prints nothing for a package with no member chain, no lineage chain and no
// Shared Case entry, so a single-chain package's output is what it was before
// the step existed.
const MEMBER_CHAINS_BLOCK = `# A Shared Case package carries every other member's chain beside the manifest
# and, for a fork, the source Case's member chains under ${LINEAGE_DIRECTORY}/. Its signing key
# is the exporting member's, so the only key this step trusts on its own is the
# one ${stepRange(2, 4)} verified ${ROOT.manifest} under. Every other key is read from a
# member-add entry in the Owner's chain after that chain verified, and the
# Owner's own key, when another member exported the package, only once a merge
# in ${ROOT.manifest} names a head of the Owner's chain at or past that key's line.
#
# Every whole-file read of ${ROOT.manifest} from here on, in this step and in
# ${stepRef(5, 6)}, takes this copy, jq's own output of each line, so none can
# stop short at a line jq cannot read in the middle of a file; a copy jq did
# not finish is INCOMPLETE.
manifest_entries="$tmp/manifest-entries.jsonl"
jq -c . "$MANIFEST_FILE" >"$manifest_entries" 2>/dev/null || unread "$MANIFEST_FILE"
case_entries=$manifest_entries
: >"$tmp/citations.txt"
: >"$tmp/remote.jsonl"
: >"$tmp/remote-records.jsonl"

# Every chain file in directory $1 ('' for the package root), one
# "<installationId>/<path>" line each. An id is one path segment, so the first
# "/" ends it. A name the Package Layout does not give a chain is not read.
chain_files() {
  for chain_path in "$1"${CHAIN_PREFIX}*${CHAIN_SUFFIX}; do
    # The Birdbrain verifier reads every name the layout gives a chain, so a
    # directory or a dangling link there is listed and found unreadable below.
    [ -e "$chain_path" ] || [ -L "$chain_path" ] || continue
    chain_id=\${chain_path#"$1"${CHAIN_PREFIX}}
    chain_id=\${chain_id%${CHAIN_SUFFIX}}
    case "$chain_id" in
    '' | . | .. | */* | *\\\\*) continue ;;
    esac
    printf '%s/%s\\n' "$chain_id" "$chain_path"
  done
}

chain_files '' >"$tmp/member-files.txt"
: >"$tmp/lineage-cases.txt"
# Every name but . and .., as the Birdbrain verifier lists them: * skips a
# leading dot, .[!.]* takes one dot, ..?* two.
for lineage_path in ${LINEAGE_DIRECTORY}/*/ ${LINEAGE_DIRECTORY}/.[!.]*/ ${LINEAGE_DIRECTORY}/..?*/; do
  [ -d "$lineage_path" ] || continue
  lineage_case=\${lineage_path#${LINEAGE_DIRECTORY}/}
  printf '%s\\n' "\${lineage_case%/}" >>"$tmp/lineage-cases.txt"
done

shared=0
[ -s "$tmp/member-files.txt" ] && shared=1
[ -s "$tmp/lineage-cases.txt" ] && shared=1
[ "$(jq -n '${JQ_SHARED_SIGNAL}' "$manifest_entries" 2>/dev/null)" = true ] && shared=1

newer_entry_filter='${JQ_NEWER_ENTRY}'
roster_filter='${JQ_ROSTER}'
foreign_case_filter='${JQ_FOREIGN_CASE}'
merge_heads_filter='${JQ_MERGE_HEADS}'
citations_filter='${JQ_CITATIONS}'
exclusions_filter='${JQ_EXCLUSIONS}'
blank_filter='${JQ_TEXT} nonblank | not'

# Whether line $1 holds only what String.prototype.trim removes, the lines the
# Birdbrain verifier skips. jq decides, not the shell's [:space:], which varies
# with the locale and differs from trim either way.
blank_line() {
  case "$1" in *'{'*) return 1 ;; esac
  [ "$(printf '%s\\n' "$1" | jq -R "$blank_filter")" = true ]
}

# Whether $1 is a file this script can read.
readable_file() {
  [ -f "$1" ] && [ -r "$1" ]
}

# The keyless checks on one entry at position $2 whose predecessor's entryHash
# is $3. Prints the verifier's reason for the first that fails, or nothing.
chain_entry_fault() {
  if [ "$(field "$1" '.index | numbers')" != "$2" ]; then
    printf 'Index mismatch'
  elif [ "$(field "$1" '.prevHash')" != "$3" ]; then
    printf 'Chain link broken'
  elif [ "$(recompute_entry_hash "$1")" != "$(field "$1" '.entryHash')" ]; then
    printf 'Entry hash mismatch'
  fi
}

# The key file the entry at position $1 of the chain check_chain is reading
# verifies under: the key the first import entry after it carries, or $cc_key.
cc_key_for() {
  while IFS= read -r cc_boundary; do
    if [ "$cc_boundary" -gt "$1" ]; then
      printf '%s' "$tmp/cc-key-$cc_boundary.pem"
      return 0
    fi
  done <"$tmp/cc-bounds.txt"
  printf '%s' "$cc_key"
}

# Verifies chain file $1 under the key in file $2 by the rules the Birdbrain
# verifier applies to every chain: index from 0, prevHash from the empty string,
# each entryHash recomputed, and a signature on every entry at schema version 2
# or above, with no unsigned entry after a signed one. $3 names the chain in a
# finding. An entry from a newer schema than this script reads ends the check:
# the entries before it and its own signature under $2 are verified, nothing
# after it is read, and the result is INCOMPLETE, as it is for a file this
# script cannot open. Returns 0 when the chain verifies, 1 after one FAIL, 3
# after one INCOMPLETE; cc_count counts the entries verified. Its loops read a
# last line no newline ends, as ${stepRef(2)} explains, and skip the lines
# blank_line calls blank. On 0, file $4 holds the lines it verified, each as
# jq's own compact output, and every later read of the chain reads that file:
# jq stops at a line such as a lone form feed, which this check skips, and
# would drop every entry after it unread.
check_chain() {
  cc_file=$1
  cc_key=$2
  cc_name=$3
  cc_out=$4
  cc_count=0
  : >"$cc_out"
  # A loop over a file it cannot open runs no iteration, which would read as a
  # chain of no entries that verified.
  if ! readable_file "$cc_file"; then
    incomplete "$cc_name: the file cannot be read, so none of its entries was checked"
    return 3
  fi
  cc_nul=$(nul_line "$cc_file")
  if [ -n "$cc_nul" ]; then
    fail "$cc_name: entry $cc_nul: Invalid JSON"
    return 1
  fi
  cc_stop=''
  cc_stop_line=''
  : >"$tmp/cc-bounds.txt"
  cc_at=0
  while IFS= read -r cc_line || [ -n "$cc_line" ]; do
    blank_line "$cc_line" && continue
    if bom_led "$cc_line" || ! printf '%s' "$cc_line" | jq empty >/dev/null 2>&1; then
      fail "$cc_name: entry $cc_at: Invalid JSON"
      return 1
    fi
    if [ "$(printf '%s' "$cc_line" | jq -r 'type')" != object ]; then
      fail "$cc_name: entry $cc_at: Invalid entry shape"
      return 1
    fi
    if [ -n "$(field "$cc_line" "$newer_entry_filter")" ]; then
      cc_stop=$cc_at
      cc_stop_line=$cc_line
      break
    fi
    if [ "$(field "$cc_line" '.type')" = import ]; then
      printf '%s' "$cc_line" | jq -j '.sourcePublicKeyPem // empty' >"$tmp/cc-key-$cc_at.pem"
      printf '%s\\n' "$cc_at" >>"$tmp/cc-bounds.txt"
    fi
    cc_at=$((cc_at + 1))
  done <"$cc_file"

  cc_prev=''
  cc_signed=0
  cc_at=0
  while IFS= read -r cc_line || [ -n "$cc_line" ]; do
    blank_line "$cc_line" && continue
    [ -n "$cc_stop" ] && [ "$cc_at" -ge "$cc_stop" ] && break
    cc_reason=$(chain_entry_fault "$cc_line" "$cc_at" "$cc_prev")
    if [ -n "$cc_reason" ]; then
      fail "$cc_name: entry $cc_at: $cc_reason"
      return 1
    fi
    if [ "$(field "$cc_line" '(.schemaVersion // 0) >= 2')" = true ]; then
      cc_signed=1
      if [ -z "$cc_stop" ] && ! verify_line_signature "$cc_line" "$(cc_key_for "$cc_at")"; then
        fail "$cc_name: entry $cc_at: Invalid signature"
        return 1
      fi
    elif [ "$cc_signed" -eq 1 ]; then
      fail "$cc_name: entry $cc_at: Schema version downgrade"
      return 1
    fi
    cc_prev=$(field "$cc_line" '.entryHash')
    printf '%s' "$cc_line" | jq -c . >>"$cc_out"
    cc_at=$((cc_at + 1))
  done <"$cc_file"
  if [ -z "$cc_stop" ]; then
    cc_count=$cc_at
    return 0
  fi

  # The unreadable entry, under $2 alone and never a key the chain supplies;
  # then, with its key usable once it verifies, the signatures before it.
  cc_reason=$(chain_entry_fault "$cc_stop_line" "$cc_stop" "$cc_prev")
  [ -n "$cc_reason" ] || verify_line_signature "$cc_stop_line" "$cc_key" ||
    cc_reason='Invalid signature'
  if [ -n "$cc_reason" ]; then
    fail "$cc_name: entry $cc_stop: $cc_reason"
    return 1
  fi
  if [ "$(field "$cc_stop_line" '.type')" = import ] &&
    [ "$(field "$cc_stop_line" '.sourcePublicKeyPem | type')" = string ]; then
    printf '%s' "$cc_stop_line" | jq -j '.sourcePublicKeyPem' >"$tmp/cc-key-$cc_stop.pem"
    printf '%s\\n' "$cc_stop" >>"$tmp/cc-bounds.txt"
  fi
  cc_at=0
  while IFS= read -r cc_line || [ -n "$cc_line" ]; do
    blank_line "$cc_line" && continue
    [ "$cc_at" -ge "$cc_stop" ] && break
    if [ "$(field "$cc_line" '(.schemaVersion // 0) >= 2')" = true ] &&
      ! verify_line_signature "$cc_line" "$(cc_key_for "$cc_at")"; then
      fail "$cc_name: entry $cc_at: Invalid signature"
      return 1
    fi
    cc_at=$((cc_at + 1))
  done <"$cc_file"
  incomplete "$cc_name: entry $cc_stop is from a newer schema than this script reads ($(field "$cc_stop_line" "$newer_entry_filter"); it reads up to schema version ${MANIFEST_SCHEMA_VERSION}), so the chain was checked only up to that entry"
  return 3
}

# One Case: $2 holds its Owner's chain as JSON lines and $3 the key that chain
# verified under; $4 lists its other member chains as chain_files does; $5
# leads every finding; $6 is the index of the import entry before which the
# Owner's chain is a source Case's history, or 0. Writes the step's records of
# accepted entries to records-$1.jsonl, the roster to roster-$1.json and the
# citations to citations-$1.txt, and sets wk_owner_key to the name its records
# give the Owner's chain.
walk_case() {
  wk_level=$1
  wk_prefix=$5
  wk_roster="$tmp/roster-$wk_level.json"
  wk_records="$tmp/records-$wk_level.jsonl"
  wk_owner_key=owner
  : >"$wk_records"
  : >"$tmp/citations-$wk_level.txt"
  jq -cs '${JQ_SEGMENT}' "$2" >"$tmp/segment.jsonl" || unread "\${wk_prefix}the Owner's chain"
  if ! jq -s --argjson ownerKey "$(jq -Rs . "$3")" "$roster_filter" "$tmp/segment.jsonl" \\
    >"$wk_roster" 2>/dev/null; then
    fail "\${wk_prefix}the membership entries of the Owner's chain could not be read as a roster"
    return 1
  fi
  jq -r '.findings[]' "$wk_roster" >"$tmp/findings.txt"
  while IFS= read -r wk_finding; do
    fail "\${wk_prefix}the Owner's chain, $wk_finding"
  done <"$tmp/findings.txt"
  wk_owner_id=$(jq -r '.ownerId // empty' "$wk_roster")
  wk_case_id=$(jq -r '.caseId // empty' "$wk_roster")
  if [ -n "$wk_owner_id" ]; then
    wk_owner_key=$wk_owner_id
    note "\${wk_prefix:-Case $wk_case_id: }$(jq -r '${JQ_DESCRIBE_ROSTER}' "$wk_roster")"
  else
    note "\${wk_prefix}the Owner's chain holds no member-add entry, so this Case has one member"
  fi
  if [ -n "$wk_case_id" ]; then
    wk_foreign=$(jq -rs --arg caseId "$wk_case_id" "$foreign_case_filter" "$2") ||
      unread "\${wk_prefix}the Owner's chain"
    [ -z "$wk_foreign" ] ||
      fail "\${wk_prefix}entry \${wk_foreign%% *} of the Owner's chain names Case \${wk_foreign#* }, the Shared Case is $wk_case_id"
  fi
  jq -cn --arg c "$wk_owner_key" '{chain: $c}' >>"$wk_records"
  jq -c --arg c "$wk_owner_key" '{chain: $c, e: .}' "$2" >>"$wk_records" ||
    unread "\${wk_prefix}the Owner's chain"

  : >"$tmp/seen.txt"
  wk_unreadable=0
  while IFS= read -r wk_member; do
    wk_id=\${wk_member%%/*}
    wk_path=\${wk_member#*/}
    if [ "$wk_id" = "$wk_owner_id" ] || grep -qxF -e "$wk_id" "$tmp/seen.txt"; then
      fail "\${wk_prefix}two chains supplied for installation $wk_id"
      continue
    fi
    printf '%s\\n' "$wk_id" >>"$tmp/seen.txt"
    wk_n=$(jq -r --arg id "$wk_id" \\
      '.members | to_entries[] | select(.value.installationId == $id) | .key' "$wk_roster")
    if [ -z "$wk_n" ]; then
      if [ -z "$wk_owner_id" ]; then
        fail "\${wk_prefix}$wk_path: chain for installation $wk_id in a Case with no member-add entries"
      else
        fail "\${wk_prefix}$wk_path: no member-add names installation $wk_id"
      fi
      continue
    fi
    wk_key="$tmp/member-key-$wk_level-$wk_n.pem"
    jq -j --argjson n "$wk_n" '.members[$n].publicKeyPem' "$wk_roster" >"$wk_key"
    wk_code=$(jq -r --argjson n "$wk_n" '.members[$n].memberCode' "$wk_roster")
    wk_revoked=$(jq -r --argjson n "$wk_n" '.members[$n].revokedAt // empty' "$wk_roster")
    wk_accepted=$(jq -r --argjson n "$wk_n" '.members[$n].acceptedHead // empty' "$wk_roster")
    wk_lines="$tmp/member-lines-$wk_level-$wk_n.jsonl"
    check_chain "$wk_path" "$wk_key" "\${wk_prefix}$wk_path (member $wk_code)" "$wk_lines"
    case $? in
    1) continue ;;
    3)
      wk_unreadable=1
      continue
      ;;
    esac
    note "\${wk_prefix}$wk_path: member $wk_code ($wk_id), $cc_count entr(ies) verified under the key the Owner's member-add for it carries (SHA-256 $(sha256_of "$wk_key"))"
    if [ -n "$wk_case_id" ]; then
      wk_foreign=$(jq -rs --arg caseId "$wk_case_id" "$foreign_case_filter" "$wk_lines") ||
        unread "\${wk_prefix}$wk_path"
      if [ -n "$wk_foreign" ]; then
        fail "\${wk_prefix}entry \${wk_foreign%% *} of $wk_id ($wk_code) names Case \${wk_foreign#* }, the Shared Case is $wk_case_id"
        continue
      fi
    fi
    # A revoked member's entries past the head the Owner merged before revoking
    # it are reported below and accepted as nothing.
    jq -cn --arg c "$wk_id" '{chain: $c}' >>"$wk_records"
    if [ -n "$wk_revoked" ]; then
      jq -c --arg c "$wk_id" --argjson head "\${wk_accepted:--1}" \\
        'select(.index <= $head) | {chain: $c, e: .}' "$wk_lines" >>"$wk_records" ||
        unread "\${wk_prefix}$wk_path"
    else
      jq -c --arg c "$wk_id" '{chain: $c, e: .}' "$wk_lines" >>"$wk_records" ||
        unread "\${wk_prefix}$wk_path"
    fi
    wk_membership=$(jq -rn '${JQ_MEMBERSHIP_ENTRY}' "$wk_lines") || unread "\${wk_prefix}$wk_path"
    [ -z "$wk_membership" ] ||
      fail "\${wk_prefix}$wk_path: entry \${wk_membership%% *}: \${wk_membership#* } entry written outside the Owner's chain"
    if [ -n "$wk_revoked" ]; then
      wk_late=$(jq -rn --argjson head "\${wk_accepted:--1}" \\
        'first(inputs | select(.index > $head)) | .index' "$wk_lines") ||
        unread "\${wk_prefix}$wk_path"
      if [ -n "$wk_late" ]; then
        if [ -n "$wk_accepted" ]; then
          wk_why="the Owner merged up to index $wk_accepted before revoking it"
        else
          wk_why='the Owner merged nothing from it before revoking it'
        fi
        fail "\${wk_prefix}entry $wk_late of $wk_id ($wk_code) is after its revocation: $wk_why"
      fi
    fi
  done <"$4"

  # A chain for every member the Owner could have held one for: a revoked
  # member the Owner never merged is the one it never had.
  jq -r '.members[] | select(.role != "owner" and (.revokedAt == null or .acceptedHead != null))
    | "\\(.installationId) \\(.memberCode)"' "$wk_roster" >"$tmp/expected.txt"
  while IFS= read -r wk_expected; do
    grep -qxF -e "\${wk_expected% *}" "$tmp/seen.txt" ||
      fail "\${wk_prefix}no chain supplied for member \${wk_expected% *} (\${wk_expected##* })"
  done <"$tmp/expected.txt"

  if [ "$wk_unreadable" -eq 1 ]; then
    incomplete "\${wk_prefix}merge heads, citations and exclusions were not checked: a member chain was not read to its end"
    return 0
  fi

  jq -rs --arg owner "$wk_owner_key" --argjson cut "$6" "$merge_heads_filter" "$wk_records" \\
    >"$tmp/heads.txt"
  wk_heads=0
  while IFS= read -r wk_head; do
    if [ "$wk_head" = ok ]; then
      wk_heads=$((wk_heads + 1))
    else
      fail "\${wk_prefix}$wk_head"
    fi
  done <"$tmp/heads.txt"
  [ "$wk_heads" -eq 0 ] ||
    note "\${wk_prefix}$wk_heads merge head(s) each name an entry of the chain they name, at that index and with that entryHash"

  jq -rs --arg owner "$wk_owner_key" --argjson cut "$6" \\
    --argjson codes "$(jq -c '[.members[] | {key: .installationId, value: .memberCode}] | from_entries' "$wk_roster")" \\
    "$citations_filter" "$wk_records" >"$tmp/cites.txt"
  while IFS= read -r wk_cite; do
    case "$wk_cite" in
    'finding '*) fail "\${wk_prefix}\${wk_cite#finding }" ;;
    'cite '*) printf '%s\\n' "\${wk_cite#cite }" >>"$tmp/citations-$wk_level.txt" ;;
    esac
  done <"$tmp/cites.txt"

  jq -rs --slurpfile roster "$wk_roster" "$exclusions_filter" "$wk_records" >"$tmp/excludes.txt"
  while IFS= read -r wk_exclude; do
    fail "\${wk_prefix}$wk_exclude"
  done <"$tmp/excludes.txt"
  return 0
}

# Every Case in this package, from this one back through each Case it was
# forked from, and the accepted entries of every chain but the exporter's into
# remote.jsonl for ${stepRef(5, 6)}, and with their chain's name into
# remote-records.jsonl for the receipt walk of ${stepRef(6)}.
member_chains() {
  mc_owner_key=$SIGNING_KEY_FILE
  mc_owner_name=$MANIFEST_FILE
  mc_local=''
  mc_claims=0
  mc_claim_ids=''
  jq -c . "$manifest_entries" >"$tmp/owner-0.jsonl"
  : >"$tmp/members-0.txt"
  while IFS= read -r mc_member; do
    printf '%s\\n' "$mc_member" >>"$tmp/members-0.txt"
  done <"$tmp/member-files.txt"

  # When ${ROOT.manifest} names no roster of its own, the Owner's chain is another
  # member chain: the one whose own first member-add names it as the Owner.
  if [ "$(jq -s '[${JQ_SEGMENT}] | any(.[]; .type == "member-add")' "$manifest_entries")" = false ]; then
    while IFS= read -r mc_member; do
      if ! readable_file "\${mc_member#*/}"; then
        incomplete "\${mc_member#*/}: the file cannot be read, so whether it holds the Owner's chain was not checked"
        return
      fi
      mc_claim=$(jq -cRn --arg id "\${mc_member%%/*}" '${JQ_OWNER_CLAIM}' "\${mc_member#*/}")
      [ -n "$mc_claim" ] || continue
      mc_claims=$((mc_claims + 1))
      mc_claim_ids="\${mc_claim_ids:+$mc_claim_ids, }\${mc_member%%/*}"
      mc_claim_member=$mc_member
      mc_claim_json=$mc_claim
    done <"$tmp/member-files.txt"
  fi
  if [ "$mc_claims" -gt 1 ]; then
    fail "two chains claim the Owner ($mc_claim_ids)"
    return
  fi
  if [ "$mc_claims" -eq 1 ]; then
    mc_claim_id=\${mc_claim_member%%/*}
    mc_claim_path=\${mc_claim_member#*/}
    mc_claim_at=$(field "$mc_claim_json" '.i')
    printf '%s' "$mc_claim_json" | jq -j '.pem' >"$tmp/owner-key.pem"
    mc_anchor=$(jq -rs --arg id "$mc_claim_id" \\
      '[.[] | select(.type == "merge") | .heads[] | select(.installationId == $id) | .index] | max // empty' \\
      "$manifest_entries")
    if [ -z "$mc_anchor" ]; then
      fail "no merge in $MANIFEST_FILE names the Owner's chain ($mc_claim_id), so its key cannot be anchored"
      return
    fi
    if [ "$mc_anchor" -lt "$mc_claim_at" ]; then
      fail "the merge of the Owner's chain in $MANIFEST_FILE stops at index $mc_anchor, before the Owner's member-add at index $mc_claim_at"
      return
    fi
    mc_local=$(jq -rRn --argjson key "$(jq -Rs . "$SIGNING_KEY_FILE")" '${JQ_MEMBER_FOR_KEY}' \\
      "$mc_claim_path")
    if [ -z "$mc_local" ]; then
      fail "no member-add in the Owner's chain carries the key in $SIGNING_KEY_FILE"
      return
    fi
    check_chain "$mc_claim_path" "$tmp/owner-key.pem" "$mc_claim_path (the Owner)" \\
      "$tmp/owner-0.jsonl" || return
    note "$mc_claim_path: the Owner's chain ($mc_claim_id), $cc_count entr(ies) verified under the key its own member-add carries (SHA-256 $(sha256_of "$tmp/owner-key.pem")), which a merge in $MANIFEST_FILE anchors at index $mc_anchor"
    mc_owner_key="$tmp/owner-key.pem"
    mc_owner_name=$mc_claim_path
    printf '%s/%s\\n' "$mc_local" "$MANIFEST_FILE" >"$tmp/members-0.txt"
    while IFS= read -r mc_member; do
      [ "\${mc_member%%/*}" = "$mc_claim_id" ] || printf '%s\\n' "$mc_member" >>"$tmp/members-0.txt"
    done <"$tmp/member-files.txt"
  else
    note "$MANIFEST_FILE: the exporting member's chain, verified in ${stepRange(2, 4)}"
  fi

  # Lineage chains belong to a Case an import entry in the Owner's chain names.
  while IFS= read -r mc_case; do
    [ "$(jq -n --arg c "$mc_case" 'any(inputs; .type == "import" and .sourceCaseId == $c)' \\
      "$tmp/owner-0.jsonl")" = true ] ||
      fail "lineage chains supplied for Case $mc_case, which no import in the Owner's chain names"
  done <"$tmp/lineage-cases.txt"

  mc_level=0
  mc_prefix=''
  mc_key=$mc_owner_key
  mc_remaining="$tmp/lineage-cases.txt"
  while :; do
    mc_entries="$tmp/owner-$mc_level.jsonl"
    # The Owner's chain is a source Case's history before its last import entry
    # when that history was shared or lineage chains remain for it.
    mc_import=$(jq -cs 'map(select(.type == "import")) | last // empty' "$mc_entries")
    mc_cut=0
    if [ -n "$mc_import" ]; then
      mc_at=$(field "$mc_import" '.index')
      if [ "$mc_at" -gt 0 ] && { [ -s "$mc_remaining" ] ||
        [ "$(jq -s --argjson n "$mc_at" 'any(.[]; .index < $n and .type == "member-add")' \\
          "$mc_entries")" = true ]; }; then
        mc_cut=$mc_at
      fi
    fi
    walk_case "$mc_level" "$mc_entries" "$mc_key" "$tmp/members-$mc_level.txt" "$mc_prefix" "$mc_cut"
    mc_skip=$wk_owner_key
    [ "$mc_level" -eq 0 ] && [ -n "$mc_local" ] && mc_skip=$mc_local
    jq -c --arg skip "$mc_skip" 'select(.e != null and .chain != $skip) | .e' \\
      "$tmp/records-$mc_level.jsonl" >>"$tmp/remote.jsonl" || unread 'the accepted entries'
    jq -c --arg skip "$mc_skip" 'select(.e != null and .chain != $skip)' \\
      "$tmp/records-$mc_level.jsonl" >>"$tmp/remote-records.jsonl" || unread 'the accepted entries'
    if [ "$mc_level" -gt 0 ]; then
      # The import names the Case and the Owner its verified history establishes.
      mc_established=$(jq -r '.caseId // empty' "$tmp/roster-$mc_level.json")
      [ -n "$mc_established" ] || mc_established=$(jq -rs \\
        'map(select(.type == "import")) | last | .caseId // empty' "$mc_entries")
      [ -z "$mc_established" ] || [ "$mc_established" = "$mc_source" ] ||
        fail "\${mc_parent_prefix}import at index $mc_parent_at names source Case $mc_source, its history is Case $mc_established"
      mc_found=$(jq -r '.ownerId // empty' "$tmp/roster-$mc_level.json")
      [ -z "$mc_found" ] || [ "$mc_found" = "$mc_source_owner" ] ||
        fail "\${mc_parent_prefix}import at index $mc_parent_at names source installation $mc_source_owner, the source Case's Owner is $mc_found"
    fi
    [ "$mc_cut" -gt 0 ] || break

    mc_source=$(field "$mc_import" '.sourceCaseId')
    mc_source_owner=$(field "$mc_import" '.sourceInstallationId')
    mc_parent_prefix=$mc_prefix
    mc_parent_at=$mc_cut
    mc_next=$((mc_level + 1))
    mc_key="$tmp/source-key-$mc_next.pem"
    printf '%s' "$mc_import" | jq -j '.sourcePublicKeyPem' >"$mc_key"
    jq -c --argjson n "$mc_cut" 'select(.index < $n)' "$mc_entries" >"$tmp/owner-$mc_next.jsonl"
    : >"$tmp/members-$mc_next.txt"
    : >"$tmp/remaining-$mc_next.txt"
    mc_supplied=0
    while IFS= read -r mc_case; do
      if [ "$mc_supplied" -eq 0 ] && [ "$mc_case" = "$mc_source" ]; then
        mc_supplied=1
        chain_files "${LINEAGE_DIRECTORY}/$mc_case/" >"$tmp/members-$mc_next.txt"
      else
        printf '%s\\n' "$mc_case" >>"$tmp/remaining-$mc_next.txt"
      fi
    done <"$mc_remaining"
    mc_remaining="$tmp/remaining-$mc_next.txt"
    mc_prefix="\${mc_prefix}lineage Case $mc_source: "
    note "\${mc_prefix}the Owner's chain is the $mc_cut entr(ies) of $mc_owner_name before its import entry at index $mc_cut, verified with that file under the key the import entry carries (SHA-256 $(sha256_of "$mc_key"))"
    mc_level=$mc_next
  done

  # The source Cases' citations first, so this Case's own win a repeat.
  while [ "$mc_level" -ge 0 ]; do
    while IFS= read -r mc_cite; do
      printf '%s\\n' "$mc_cite" >>"$tmp/citations.txt"
    done <"$tmp/citations-$mc_level.txt"
    mc_level=$((mc_level - 1))
  done
}

if [ "$shared" -eq 1 ]; then
  ${openStep(MEMBER_CHAINS_STEP.id, MEMBER_CHAINS_STEP.scriptTitle)}
  if [ "$fail_count" -gt "$chain_fails_before" ]; then
    incomplete "the member chains were not checked: $MANIFEST_FILE failed ${stepRange(2, 4)}, so no roster can be read from it"
  else
    member_chains
  fi
fi
if [ -s "$tmp/remote.jsonl" ]; then
  jq -c . "$manifest_entries" "$tmp/remote.jsonl" >"$tmp/case-entries.jsonl"
  case_entries="$tmp/case-entries.jsonl"
fi

# How a finding cites an Exhibit of a Shared Case: by its Member Code and
# number, since two members each hold an "Exhibit 1". Fails for any other.
citation_of() {
  cited=''
  while IFS= read -r cited_line; do
    [ "\${cited_line% *}" = "$1" ] && cited=\${cited_line##* }
  done <"$tmp/citations.txt"
  [ -n "$cited" ] && printf '%s' "$cited"
}`

export const VERIFY_SCRIPT = `#!/bin/sh
# ${ROOT.verifyScript} - one-command verification of this Birdbrain evidence package.
#
# REQUIRED TOOLS. Every tool this script uses is named here and checked for
# before any check runs; a missing one exits 2 naming it:
#   jq, openssl, sha256sum (or shasum, on macOS), cut, dirname, grep, rm, tr,
#   mktemp.
#
# This is the executable form of ${ROOT.verifyRunbook}. It runs the same six steps against
# the package it sits in, and ${stepRef(MEMBER_CHAINS_STEP.id)} as well for a Shared Case package, prints a
# line per check, and exits non-zero naming the step that failed. ${ROOT.verifyRunbook} explains what each step proves and states the
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
# What exit 0 means: every signed entry verifies under the key ${stepRef(2)} resolves
# for it - the enclosed public key, or, for an entry before an import entry,
# the key the first import entry after it carries - and recomputes to its own
# entryHash, and for every capture this package's
# signed chain still calls active and in scope, its page and RFC 3161 token are
# enclosed and match that signed entry, and so are its screenshot, Transaction
# Record and PDF wherever that entry carries their hashes. In a Shared Case package
# it also means that every other member's chain the package carries verifies,
# to its last line and by that same rule, under the key the member-add for that
# member in its Case Owner's chain carries; that every merge entry names an
# entry of the chain it names with that entry's entryHash; and that each
# member's exhibits that are active and in scope match the chain their author
# signed. A line that begins with a byte-order mark, or that holds a NUL byte,
# fails as Invalid JSON, as it does in the Birdbrain verifier, in ${ROOT.manifest}
# and in every member chain. Every read of a member chain after its check takes
# the lines that check verified, every whole-file read of ${ROOT.manifest} after
# ${stepRef(4)} takes a copy jq wrote, and a copy of either that jq does not finish is
# INCOMPLETE. A member chain holding an entry from a newer schema than this
# script reads, or a chain file ${stepRef(MEMBER_CHAINS_STEP.id)} cannot open, is INCOMPLETE. A signed token whose
# capture is active and in scope but whose bytes the package does not enclose
# is a FAILURE, not a silence; a deleted or out-of-selection capture's token is
# expected absent, exactly like its page and screenshot. What exit 0 does NOT
# mean: it does not recompute a package-wide hash the way the binary verifier
# does, so a file with no signed entry of its own (${ROOT.report}) is checked only
# against the unsigned index in ${stepRef(1)}, and evidence.json, which that index
# does not list, is not hashed by any step. Nor does it mean the
# enclosed TSA root is the authority's real root — ${stepRef('6a')} prints that root's
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

# Whether line $1 begins with a byte-order mark. jq skips one at the start of
# its input, so a per-line read accepts the line, but the JSON.parse the
# Birdbrain verifier reads each line with rejects it, and jq stops at one in
# the middle of a file, dropping every line after it from a whole-file read.
bom=$(printf '\\357\\273\\277')
bom_led() {
  case "$1" in "$bom"*) return 0 ;; esac
  return 1
}

# The position, counted as the Birdbrain verifier counts lines, of the first
# line of file $1 that holds a NUL byte, or nothing. read drops NUL bytes, so
# no loop here sees one; JSON.parse rejects the line, and jq stops at it in a
# whole-file read. jq's raw-line mode keeps the byte, so it finds the line.
nul_filter='${JQ_TEXT} first([inputs | select(nonblank)] | to_entries[]
  | select(.value | explode | any(.[]; . == 0)) | .key)'
nul_line() {
  jq -Rrn "$nul_filter" "$1"
}

# A whole-file read that jq did not finish: the entries after the point it
# stopped were never read, so this is never a pass.
unread() {
  incomplete "$1 could not be read in full, so the entries after the point jq stopped were not checked"
}

in_list() { printf '%s\\n' "$1" | grep -qxF -e "$2"; }

# Verifies one manifest line's RSA signature over its bare entryHash hex with no
# trailing newline, under the public key in the file named by $2 - the recipe
# ${ROOT.verifyRunbook} ${stepRef(2)} documents. Prints nothing and returns non-zero on any
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
# ${stepRef(3)} documents. Echoes the hex.
recompute_entry_hash() {
  printf '%s' "$1" | ${VERIFY_RECIPES.canonicalEntryBody} | sha256_stdin
}

printf '${ROOT.verifyScript} - Birdbrain evidence package, by-hand verification (see ${ROOT.verifyRunbook})\\n'

exec 3>&1 4>&2
stdout_saved=1
exec >"$detail_file" 2>&1

${openStep(1)}
if [ ! -f "$EVIDENCE_INDEX_FILE" ]; then
  fail "$EVIDENCE_INDEX_FILE is missing, so the enclosed index cannot be checked"
elif jq -r '${VERIFY_RECIPES.indexCheckFilter}' "$EVIDENCE_INDEX_FILE" |
  sha256_check >"$tmp/step1.out" 2>&1; then
  note "$(grep -c 'OK$' "$tmp/step1.out") enclosed file(s) match $EVIDENCE_INDEX_FILE"
else
  while IFS= read -r bad; do
    [ -n "$bad" ] && printf '   %s\\n' "$bad"
  done <"$tmp/step1.out"
  fail "one or more enclosed files do not match $EVIDENCE_INDEX_FILE"
fi
note "$EVIDENCE_INDEX_FILE is unsigned - ${stepRef(3, 5)} are the authoritative bind"

# ${sentenceStart(stepRef(MEMBER_CHAINS_STEP.id))} reads no roster off a manifest that failed a step from here to ${stepRef(4)}.
chain_fails_before=$fail_count

${openStep(2)}
# Which key each entry verifies under, the rule the Birdbrain verifier applies:
# the key the first import entry after it carries as sourcePublicKeyPem, or the
# enclosed key when no import entry follows it. An import entry carries the key
# of the installation whose chain it continues, and is itself signed by the
# installation that imported it, so it verifies under the next key along. That
# is why a carried key is not taken on trust: the entry carrying it is verified
# here under the next key, and so on to the enclosed key.
#
# Every loop over a chain file reads its last line even with no newline after
# it, the "|| [ -n ... ]" in its condition: jq, which later steps read the
# chain with, reads that line, so a loop that skipped it would leave a line
# those steps act on that no check here verified. The other direction is a
# line a loop accepts that jq stops at in the middle of a file. Two are known:
# one that begins with a byte-order mark, which jq skips only at the start of
# its input, and one that holds a NUL byte, which read drops. ${sentenceStart(stepRef(4))} fails
# both, as the Birdbrain verifier does, and ${stepRef(MEMBER_CHAINS_STEP.id)} fails both in a member
# chain. Any other such line is still caught: every whole-file read of
# ${ROOT.manifest} after ${stepRef(4)} takes a copy jq wrote, and a copy jq did not finish
# is INCOMPLETE, as is a member chain's.
: >"$tmp/boundaries.txt"
position=0
while IFS= read -r line || [ -n "$line" ]; do
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
  while IFS= read -r line || [ -n "$line" ]; do
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
    note "$unsigned_count pre-signing entr(ies) carry no signature - covered by ${stepRef(3, 4, 6)}"
  fi
fi

${openStep(3)}
counted=0
while IFS= read -r line || [ -n "$line" ]; do
  [ -n "$line" ] || continue
  counted=$((counted + 1))
  idx=$(field "$line" '.index')
  [ "$(recompute_entry_hash "$line")" = "$(field "$line" '.entryHash')" ] ||
    fail "entry $idx: its body does not hash to its own entryHash"
done <"$MANIFEST_FILE"
note "$counted entr(ies) recomputed from their bodies"

${openStep(4)}
expect=0
head_hash=''
manifest_nul=$(nul_line "$MANIFEST_FILE")
[ -z "$manifest_nul" ] ||
  fail "entry at position $manifest_nul: Invalid JSON, it holds a NUL byte"
while IFS= read -r line || [ -n "$line" ]; do
  [ -n "$line" ] || continue
  bom_led "$line" &&
    fail "entry at position $expect: Invalid JSON, it begins with a byte-order mark"
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

${MEMBER_CHAINS_BLOCK}

${openStep(5)}
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

deleted=$(jq -r 'select(.type == "deletion") | .captureId' "$manifest_entries")
# In a Shared Case only an Exhibit's author deletes it, so another chain's
# deletion entry does not remove an Exhibit this one authored.
[ "$case_entries" = "$manifest_entries" ] || deleted=$(jq -rn --slurpfile l "$manifest_entries" \\
  --slurpfile r "$tmp/remote.jsonl" '${JQ_DELETED}')
jq -c 'select(.type == "capture")' "$case_entries" >"$tmp/captures.jsonl"

# The screenshot's rule for the Transaction Record and the PDF, as the Birdbrain
# verifier applies it: capture $1's entry $2 anchors a file by the sha256 in its
# field $3, at the path helper $4 gives that digest. Returns 0 when the file is
# there and hashes to it, 1 after a FAIL, and 2 when the entry carries no such
# hash, which that verifier reports as a SKIP.
bind_content_address() {
  bca_hash=$(field "$2" ".$3 // empty")
  [ -n "$bca_hash" ] || return 2
  bca_file=$($4 "$bca_hash")
  if [ ! -f "$bca_file" ]; then
    fail "capture $1: $bca_file is missing but its signed entry carries a $3"
    return 1
  fi
  if [ "$(sha256_of "$bca_file")" != "$bca_hash" ]; then
    fail "capture $1: $bca_file does not match its own content address"
    return 1
  fi
  return 0
}

bound=0
records_bound=0
pdfs_bound=0
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
  bind_content_address "$id" "$line" transactionRecordHash transaction_record_path &&
    records_bound=$((records_bound + 1))
  bind_content_address "$id" "$line" pdfHash pdf_path &&
    pdfs_bound=$((pdfs_bound + 1))
done <"$tmp/captures.jsonl"
if [ "$captures_outside" -gt 0 ]; then
  note "$captures_outside of $captures_total capture(s) are outside the signed export selection and expected absent - the omission is declared in a signed entry, not inferred (re-run with -v to list them)"
fi
note "$bound capture(s) bound to the signed chain"
note "$records_bound Transaction Record(s) and $pdfs_bound PDF(s) bound to the signed chain"

# Exhibits of every other kind (ADR-0023). The signed entry carries the path the
# Case store holds the bytes at; the package holds them at the part of that path
# inside the Case directory, keyed by Exhibit id. Same rule as the captures
# above: deleted or out-of-selection means expected absent, anything else
# enclosed and matching its signed contentHash.
jq -c 'select(.type == "exhibit")' "$case_entries" >"$tmp/exhibits.jsonl"
exhibits_bound=0
exhibits_total=0
exhibits_outside=0
while IFS= read -r line; do
  [ -n "$line" ] || continue
  exhibits_total=$((exhibits_total + 1))
  id=$(field "$line" '.exhibitId')
  num=$(citation_of "$id") || num=$(field "$line" '.exhibitNumber')
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
  else empty end' "$case_entries" >"$tmp/exhibit-numbers.txt"

# How a finding cites an Exhibit, matching the binary verifier's wording.
#
# The LAST assignment in manifest order wins, which is exactly what the binary
# does when it folds the same entries into a map: a Case renumbered after an
# Exhibit was committed carries both an \`exhibit\` entry and a later
# \`renumber\` assignment for that id, and taking any other one would cite a
# superseded number here and the current one there.
exhibit_label() {
  if found=$(citation_of "$1"); then
    printf 'Exhibit %s' "$found"
    return 0
  fi
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
jq -c 'select(.type == "derivation")' "$case_entries" >"$tmp/derivations.jsonl"
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

${openStep(6)}
# The work set comes from the SIGNED manifest, never from listing timestamps/.
# Read off the directory instead and a package stripped of its .tst files says
# "nothing to check" and passes, while the signed chain still asserts a trusted
# time for the capture. Which digest each token is entitled to attest comes from
# that same signed entry - never from a file name, and never from evidence.json.
#
# The REQUIRED tokens are found the way ${stepRef(5)} and the binary find pages: walk
# the captures that are active and in scope, and take each one's signed token by
# its contentHash. A deleted or out-of-selection capture is never visited, so
# its token is expected absent without any exclusion list to get wrong.
# A schema-4 stamp with subject "entry" binds a merge entry's Entry Hash, not
# an Exhibit's content, and the binary excludes it from trusted time. This
# filter must agree, or the runbook would present a receipt as a capture's
# timestamp and contradict the binary (#1518 review).
signed_token_filter='${VERIFY_RECIPES.signedTokenFilter}'
jq -r "$signed_token_filter"' | "\\(.captureContentHash) \\(.tsaToken)"' \\
  "$case_entries" >"$tmp/signed-tokens.txt"

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
    "$case_entries")
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
    "$case_entries")
  [ -n "$encoded" ] || continue
  printf '%s %s %s\\n' "$id" "$imprint" "$encoded" >>"$tmp/required-tokens.txt"
  required_tokens=$((required_tokens + 1))
done <"$tmp/exhibits.jsonl"

# Receipt stamps (#1515): a schema-4 stamp with subject "entry" binds a merge
# entry's Entry Hash, bounding when its chain's writer held what the merge
# names, and vouches for no Exhibit's bytes. Its token has no enclosed file;
# the signed line is the only copy, so it is decoded from there. A receipt
# binds a merge of the chain it sits in, so each chain is read on its own, as
# the Birdbrain verifier reads them: the exporter's chain unnamed, and every
# chain ${stepRef('4a')} accepted under its installation id. The merge is found
# by the hash the stamp names, which ${stepRef(3)} or ${stepRef('4a')} recomputed
# from the entry's own body. A stamp that names a merge and carries no token
# is a claim with nothing behind it, and fails as the Birdbrain verifier fails it.
jq -c '{chain: "", e: .}' "$manifest_entries" >"$tmp/receipt-chains.jsonl"
cat "$tmp/remote-records.jsonl" >>"$tmp/receipt-chains.jsonl"
receipt_token_filter='${VERIFY_RECIPES.receiptTokenFilter}'
jq -r '.chain as $c | .e | '"$receipt_token_filter"' | "\\(.index) \\(.captureContentHash) \\(.tsaToken) \\($c)"' \\
  "$tmp/receipt-chains.jsonl" >"$tmp/receipt-tokens.txt"
jq -r '.chain as $c | .e
  | select(.type == "timestamp" and .subject == "entry" and (.tsaToken | type) != "string")
  | "\\(.index) \\(.captureContentHash) - \\($c)"' \\
  "$tmp/receipt-chains.jsonl" >>"$tmp/receipt-tokens.txt"

: >"$tmp/required-receipts.txt"
receipt_tokens=0
while IFS=' ' read -r stamp_idx imprint encoded chain; do
  [ -n "$encoded" ] || continue
  merge_idx=$(jq -rn --arg h "$imprint" --arg c "$chain" \\
    'first(inputs | select(.chain == $c and .e.type == "merge" and .e.entryHash == $h) | .e.index) // empty' \\
    "$tmp/receipt-chains.jsonl")
  if [ -z "$merge_idx" ]; then
    note "receipt timestamp entry $stamp_idx\${chain:+ of $chain} names no merge entry in its chain (hash $imprint), so nothing states what it attests"
    continue
  fi
  if [ "$encoded" = - ]; then
    fail "merge entry $merge_idx\${chain:+ of $chain}: its receipt timestamp entry $stamp_idx carries no token"
    continue
  fi
  printf '%s %s %s %s %s\\n' "$stamp_idx" "$merge_idx" "$imprint" "$encoded" "$chain" >>"$tmp/required-receipts.txt"
  receipt_tokens=$((receipt_tokens + 1))
done <"$tmp/receipt-tokens.txt"

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
receipts_verified=0

if [ "$required_tokens" -eq 0 ] && [ "$signed_tokens" -gt 0 ]; then
  note "$signed_tokens signed token(s) belong only to deleted or out-of-scope captures, so they are expected absent and need no anchor"
fi
if [ "$required_tokens" -eq 0 ] && [ "$receipt_tokens" -eq 0 ]; then
  if [ "$signed_tokens" -eq 0 ]; then
    note 'the signed manifest carries no RFC 3161 token, so it makes no trusted-time claim'
  fi
elif [ ! -f "$TSA_ROOT" ]; then
  note "$TSA_ROOT is absent: this case was configured with a non-default timestamp authority"
  note "obtain that authority's own root and re-run the ${stepRef('6b')} command from ${ROOT.verifyRunbook} with it as -CAfile"
  incomplete "$((required_tokens + receipt_tokens)) signed token(s) were not verified: no anchor is enclosed for this script to name"
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

# Every receipt token: decoded from its signed line and verified to the anchor
# over the merge entry's Entry Hash, the digest the signed stamp names. The
# openssl check fails on a token whose imprint is another digest, as it does
# for a capture's.
while IFS=' ' read -r stamp_idx merge_idx imprint encoded chain; do
  [ -n "$encoded" ] || continue
  merge_name="merge entry $merge_idx\${chain:+ of $chain}"
  if ! printf '%s' "$encoded" | openssl base64 -d -A >"$tmp/receipt-token.der" 2>/dev/null; then
    fail "$merge_name: its receipt timestamp entry $stamp_idx carries a tsaToken that is not base64"
    continue
  fi
  [ "$anchor_named" -eq 1 ] || continue
  result=0
  if [ -n "$untrusted" ]; then
    openssl ts -verify -digest "$imprint" -in "$tmp/receipt-token.der" -token_in \\
      -CAfile "$TSA_ROOT" -untrusted "$untrusted" >"$tmp/ts.out" 2>&1 || result=$?
  else
    openssl ts -verify -digest "$imprint" -in "$tmp/receipt-token.der" -token_in \\
      -CAfile "$TSA_ROOT" >"$tmp/ts.out" 2>&1 || result=$?
  fi
  if [ "$result" -eq 0 ]; then
    receipts_verified=$((receipts_verified + 1))
    note "$merge_name: receipt timestamp entry $stamp_idx verifies to $TSA_ROOT over the Entry Hash $imprint - a receipt of what its chain's writer held, not a trusted time for any Exhibit"
  else
    fail "$merge_name: receipt timestamp entry $stamp_idx does not verify to $TSA_ROOT over the Entry Hash $imprint"
    while IFS= read -r detail; do
      printf '   openssl: %s\\n' "$detail"
    done <"$tmp/ts.out"
  fi
done <"$tmp/required-receipts.txt"

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
  printf 'only once the ${stepRef('6a')} fingerprint is checked against a source outside this package.\\n'
elif [ "$signed_tokens" -gt 0 ]; then
  printf 'That is an integrity and internal-consistency result only. The signed chain carries\\n'
  printf 'RFC 3161 tokens, but only for captures this package does not enclose, so it makes no\\n'
  printf 'trusted-time claim about its contents for you to check.\\n'
elif [ "$receipt_tokens" -gt 0 ]; then
  printf 'That is an integrity and internal-consistency result only. The signed chain carries no\\n'
  printf 'RFC 3161 token over any Exhibit'"'"'s content, so this package makes no trusted-time claim\\n'
  printf 'about its contents for you to check. %s of its %s receipt token(s) over merge entries\\n' "$receipts_verified" "$receipt_tokens"
  printf 'verified: a receipt bounds when its writer held what the merge names, not when anything\\n'
  printf 'was captured, and it becomes a claim only once the ${stepRef('6a')} fingerprint is checked.\\n'
else
  printf 'That is an integrity and internal-consistency result only. The signed chain carries no\\n'
  printf 'RFC 3161 token, so this package makes no trusted-time claim for you to check.\\n'
fi
exit 0
`
