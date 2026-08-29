#!/usr/bin/env bash
# Branch-commit message check. Two modes:
#   check.sh <message-file>   lint the file and exit 0/1
#   check.sh                  PreToolUse hook: read the tool call on stdin, act on `git commit`
# Hook exit codes: 0 allows the command, 2 blocks it and feeds stderr back to the agent.
set -u

# Agents this hook binds, space-separated. Widen it one agent at a time (ADR-0022).
bound="birdbrain-implementer"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="${CLAUDE_PROJECT_DIR:-$(git -C "$here" rev-parse --show-toplevel)}"

lint() {
  local file="$1" out
  if [ ! -f "$file" ]; then
    echo "post-commit-message: message file not found: $file" >&2
    return 1
  fi
  if out="$(cd "$root" && pnpm exec commitlint --edit "$file" 2>&1)"; then
    return 0
  fi
  {
    echo "post-commit-message: $file fails the branch-commit shape. Fix the file, then re-run the same command."
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
# the agents named in $bound (the payload's agent_type). Interactive sessions pass through.
case " $bound " in *" $agent "*) ;; *) exit 0 ;; esac

# Only a command that runs `git commit` (not commit-tree, not a mention in a string).
if ! printf '%s' "$cmd" | grep -Eq '(^|[;&|(]|[[:space:]])git[[:space:]]+commit([[:space:]]|$)'; then
  exit 0
fi

if printf '%s' "$cmd" | grep -Eq '(^|[[:space:]])(-m|--message)([[:space:]=]|$)'; then
  echo "post-commit-message: write the message to a file and commit with 'git commit -F <file>'. A -m message cannot be linted before it lands." >&2
  exit 2
fi

files="$(printf '%s' "$cmd" | grep -oE '(^|[[:space:]])(-F|--file)([[:space:]]+|=)("[^"]+"|'"'"'[^'"'"']+'"'"'|[^[:space:]]+)' \
  | sed -E 's/^[[:space:]]*(-F|--file)([[:space:]]+|=)//; s/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/')"

if [ -z "$files" ]; then
  if printf '%s' "$cmd" | grep -Eq '(^|[[:space:]])(--amend|-C|-c|--reuse-message|--reedit-message)([[:space:]=]|$)'; then
    exit 0
  fi
  echo "post-commit-message: no message file. Write the message to a file and commit with 'git commit -F <file>'." >&2
  exit 2
fi

status=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  if [ "$f" = "-" ]; then
    echo "post-commit-message: '-F -' reads a heredoc that cannot be linted first. Write the message to a file and pass its path." >&2
    exit 2
  fi
  case "$f" in /*) path="$f" ;; *) path="$cwd/$f" ;; esac
  lint "$path" || status=2
done <<< "$files"
exit $status
