#!/usr/bin/env bash
# Comment check. Two modes:
#   check.sh <comment-file>   lint the file and exit 0/1
#   check.sh                  PreToolUse hook: read the tool call on stdin, act on comment writes
# Hook exit codes: 0 allows the command, 2 blocks it and feeds stderr back to the agent.
set -u

# Agents this hook binds, space-separated. Widen it one agent at a time (ADR-0022).
bound="birdbrain-implementer"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

lint() {
  local file="$1" out
  if [ ! -f "$file" ]; then
    echo "post-comment: comment file not found: $file. The hook runs before the command does, so a file this same command writes (a heredoc ahead of the gh call) does not exist yet: write the file in one call, then run this command in the next." >&2
    return 1
  fi
  if out="$(node "$here/lint-comment.mjs" "$file" 2>&1)"; then
    return 0
  fi
  {
    echo "post-comment: $file does not match a comment shape (see ${here%/scripts}/template.md). Fix the file, then re-run the same command."
    echo "$out"
  } >&2
  return 1
}

if [ $# -ge 1 ]; then
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

is_comment_write=0
if printf '%s' "$cmd" | grep -Eq '(^|[;&|(]|[[:space:]])a?gh[[:space:]]+(issue|pr)[[:space:]]+comment([[:space:]]|$)'; then
  is_comment_write=1
elif printf '%s' "$cmd" | grep -Eq '(^|[;&|(]|[[:space:]])a?gh[[:space:]]+api[[:space:]].*/(comments|replies)([[:space:]]|$)' \
  && printf '%s' "$cmd" | grep -Eq '(-X|--method)[[:space:]=]+POST'; then
  is_comment_write=1
fi
[ "$is_comment_write" -eq 1 ] || exit 0

if printf '%s' "$cmd" | grep -Eq '(^|[[:space:]])(-b|--body)([[:space:]=]|$)'; then
  echo "post-comment: write the comment to a file and pass --body-file <file>. An inline --body cannot be linted before it lands." >&2
  exit 2
fi

files="$(printf '%s' "$cmd" | grep -oE '(^|[[:space:]])(-F|--body-file|--input)([[:space:]]+|=)("[^"]+"|'"'"'[^'"'"']+'"'"'|[^[:space:]]+)' \
  | sed -E 's/^[[:space:]]*(-F|--body-file|--input)([[:space:]]+|=)//; s/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/')"

if [ -z "$files" ]; then
  echo "post-comment: no comment file. Write the comment to a file and pass --body-file <file>." >&2
  exit 2
fi

status=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  if [ "$f" = "-" ]; then
    echo "post-comment: a comment on stdin cannot be linted first. Write it to a file and pass its path." >&2
    exit 2
  fi
  case "$f" in /*) path="$f" ;; *) path="$cwd/$f" ;; esac
  lint "$path" || status=2
done <<< "$files"
exit $status
