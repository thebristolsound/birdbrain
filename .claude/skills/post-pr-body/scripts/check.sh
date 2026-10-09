#!/usr/bin/env bash
# PR body check. Two modes:
#   check.sh [--any-author] <body-file>   lint the file and exit 0/1
#   check.sh                              PreToolUse hook: read the tool call on stdin, act on PR create/edit
# --any-author accepts a body without the attribution line (a human-written PR); merge.sh uses it.
# Hook exit codes: 0 allows the command, 2 blocks it and feeds stderr back to the agent.
set -u

# Agents this hook binds, space-separated. Widen it one agent at a time (ADR-0022).
bound="birdbrain-implementer"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
lint_flags=""

# A branch cut before a linter change runs its own copy, which can disagree with main's: a
# text that passes here can fail on main, or the reverse. Say so on stderr; never block.
warn_if_stale() {
  local repo f rel
  repo="$(git -C "$here" rev-parse --show-toplevel 2>/dev/null)" || return 0
  for f in "$@"; do
    rel="${f#"$repo"/}"
    git -C "$repo" cat-file -e "origin/main:$rel" 2>/dev/null || continue
    git -C "$repo" diff --quiet origin/main -- "$rel" 2>/dev/null && continue
    echo "post-pr-body: note: $rel differs from origin/main, so main's linter may judge this file differently. If this branch did not change it, rebase onto origin/main." >&2
  done
}

lint() {
  local file="$1" out
  if [ ! -f "$file" ]; then
    echo "post-pr-body: body file not found: $file. The hook runs before the command does, so a file this same command writes (a heredoc ahead of the gh call) does not exist yet: write the file in one call, then run this command in the next." >&2
    return 1
  fi
  warn_if_stale "$here/lint-body.mjs" "$here/layers.mjs"
  # shellcheck disable=SC2086
  if out="$(node "$here/lint-body.mjs" $lint_flags "$file" 2>&1)"; then
    return 0
  fi
  {
    echo "post-pr-body: $file does not match the PR body shape (see ${here%/scripts}/template.md). Fix the file, then re-run the same command."
    echo "$out"
  } >&2
  return 1
}

if [ $# -ge 1 ]; then
  if [ "$1" = "--any-author" ]; then lint_flags="--any-author"; shift; fi
  [ $# -ge 1 ] || { echo "usage: check.sh [--any-author] <body-file>" >&2; exit 2; }
  lint "$1"
  exit $?
fi

input="$(cat)"
read -r agent cwd cmd < <(printf '%s' "$input" | node -e '
  let s = ""
  process.stdin.on("data", (d) => (s += d)).on("end", () => {
    let j = {}
    try { j = JSON.parse(s) } catch {}
    const agent = j.agent_type || "-"
    const cwd = j.cwd || process.cwd()
    const cmd = (j.tool_input && j.tool_input.command) || ""
    process.stdout.write(agent + " " + cwd + " " + Buffer.from(cmd).toString("base64") + "\n")
  })')
cmd="$(printf '%s' "$cmd" | base64 -d)"

# The hook is registered in .claude/settings.json, so it sees every session; it acts only for
# the agents named in $bound (the payload's agent_type), and for every agent of a headless
# dispatch cycle, which sets BIRDBRAIN_DISPATCH=1 (.github/scripts/dispatch/run.sh): its
# top-level session posts claims and verdicts under no agent_type. Interactive sessions pass
# through.
case " $bound " in *" $agent "*) ;; *) [ "${BIRDBRAIN_DISPATCH:-}" = 1 ] || exit 0 ;; esac

has() { printf '%s' "$cmd" | grep -Eq "$1"; }

# Which write is this: pr create, pr edit, or a REST call on a pulls endpoint. A REST call is a
# write when it names a writing method or carries fields (gh api POSTs implicitly with fields).
mode=""
if has '(^|[;&|(]|[[:space:]])a?gh[[:space:]]+pr[[:space:]]+create([[:space:]]|$)'; then
  mode=create
elif has '(^|[;&|(]|[[:space:]])a?gh[[:space:]]+pr[[:space:]]+edit([[:space:]]|$)'; then
  mode=edit
elif has '(^|[;&|(]|[[:space:]])a?gh[[:space:]]+api[[:space:]].*/pulls(/[0-9]+)?([[:space:]]|$)'; then
  if has '(-X|--method)[[:space:]=]+(POST|PATCH|PUT)([[:space:]]|$)' \
    || has '(^|[[:space:]])(-f|-F|--field|--raw-field|--input)([[:space:]=]|$)'; then
    mode=api
  fi
fi
[ -n "$mode" ] || exit 0

if [ "$mode" = "api" ]; then
  # A body given as a field cannot be linted. The payload goes in a JSON file via --input.
  if has '(^|[[:space:]])(-f|-F|--field|--raw-field)([[:space:]]+|=)["'"'"']?body(\[|=)'; then
    echo "post-pr-body: pass the PR body as JSON via --input <file> (a \"body\" field on the command line cannot be linted first)." >&2
    exit 2
  fi
  files="$(printf '%s' "$cmd" | grep -oE '(^|[[:space:]])--input([[:space:]]+|=)("[^"]+"|'"'"'[^'"'"']+'"'"'|[^[:space:]]+)' \
    | sed -E 's/^[[:space:]]*--input([[:space:]]+|=)//; s/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/')"
  # A write with no payload file (a PATCH of labels or state) carries no body.
  [ -n "$files" ] || exit 0
else
  if has '(^|[[:space:]])(-b|--body)([[:space:]=]|$)'; then
    echo "post-pr-body: write the body to a file and pass --body-file <file>. An inline --body cannot be linted before it lands." >&2
    exit 2
  fi
  files="$(printf '%s' "$cmd" | grep -oE '(^|[[:space:]])(-F|--body-file)([[:space:]]+|=)("[^"]+"|'"'"'[^'"'"']+'"'"'|[^[:space:]]+)' \
    | sed -E 's/^[[:space:]]*(-F|--body-file)([[:space:]]+|=)//; s/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/')"
  if [ "$mode" = "create" ] && [ -z "$files" ]; then
    # Without --body-file, gh fills the body from commits (--fill), a template, an editor, or the
    # browser; none of those can be linted first.
    echo "post-pr-body: gh pr create needs --body-file <file>; --fill, --template, --web and an editor body cannot be linted first." >&2
    exit 2
  fi
  # An edit with no body flag (labels, title, reviewers) is not a body write.
  [ -n "$files" ] || exit 0
fi

status=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  if [ "$f" = "-" ]; then
    echo "post-pr-body: a body on stdin cannot be linted first. Write it to a file and pass its path." >&2
    exit 2
  fi
  case "$f" in /*) path="$f" ;; *) path="$cwd/$f" ;; esac
  lint "$path" || status=2
done <<< "$files"
exit $status
