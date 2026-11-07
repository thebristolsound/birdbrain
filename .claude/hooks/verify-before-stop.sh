#!/usr/bin/env bash
# Stop and SubagentStop hook: an implementer that committed work does not stop until
# `pnpm preflight` has stamped a verification block for its current HEAD.
#
# The implementer's instructions already say to run preflight before opening a PR
# (.claude/agents/birdbrain-implementer.md); this makes the rule mechanical. Claude Code's best
# practices page (https://code.claude.com/docs/en/best-practices) says "If something has to
# happen every time, make it a hook, a deny rule, or a managed setting." It runs no tests
# itself. It reads the stamp line preflight writes,
# `<!-- preflight vN sha=<sha> status=<pass|fail> -->`, from .preflight/verification.md.
#
# It acts only for the agents named in $bound, read from the payload's agent_type, which
# SubagentStop always carries and Stop carries in a session started with `--agent`. Every
# other session passes through. For a subagent started with worktree isolation, the payload's
# cwd is that worktree (checked on Claude Code 2.1.318), so the stamp read is the agent's own.
#
# A stop goes through when the block at HEAD passes on a clean tree. A block at HEAD that
# records a failure holds the first stop and lets the next one through (stop_hook_active):
# the agent ran the checks on its final commit and the block says what failed, which is the
# give-up path. A missing or stale block, or uncommitted changes, holds every stop, up to
# $max_blocks times per commit. The bound is this hook's own: Claude Code's cap of eight
# consecutive blocks resets whenever the agent calls a tool, so an agent that cannot run
# preflight at all (a wrong Node, a broken install) would otherwise be held indefinitely.
#
# Exit codes: 0 allows the stop, 2 sends the agent back to work with stderr as the reason.
set -u

# Agents this hook binds, space-separated, as in the post-pr-body hook.
bound="birdbrain-implementer"
max_blocks=3

input="$(cat)"
read -r agent active cwd < <(printf '%s' "$input" | node -e '
  let j = {}
  try { j = JSON.parse(require("fs").readFileSync(0, "utf8")) } catch {}
  process.stdout.write(`${j.agent_type || "-"} ${j.stop_hook_active ? 1 : 0} ${j.cwd || process.cwd()}\n`)')

case " $bound " in *" $agent "*) ;; *) exit 0 ;; esac

root="$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null)" || exit 0
head="$(git -C "$root" rev-parse HEAD 2>/dev/null)" || exit 0
# No work committed past main means nothing to verify: the give-up path at intake.
ahead="$(git -C "$root" rev-list --count origin/main..HEAD 2>/dev/null)" || exit 0
[ "$ahead" -gt 0 ] || exit 0

block="$root/.preflight/verification.md"
stamp="$(grep -m1 -oE '<!-- preflight v[0-9]+ sha=[0-9a-f]+ status=[a-z]+ -->' "$block" 2>/dev/null)"
sha="$(printf '%s' "$stamp" | sed -nE 's/.* sha=([0-9a-f]+) .*/\1/p')"
status="$(printf '%s' "$stamp" | sed -nE 's/.* status=([a-z]+) .*/\1/p')"
next="Commit your work, run \`pnpm preflight\`, and fix what it reports before you finish."

if [ -n "$(git -C "$root" status --porcelain 2>/dev/null)" ]; then
  reason="the working tree has uncommitted changes, which no verification block can cover"
  next="Commit or discard them, then run \`pnpm preflight\`."
elif [ -z "$stamp" ]; then
  reason="no verification block at .preflight/verification.md"
elif [ "$sha" != "$head" ]; then
  reason="the verification block is for ${sha:0:12}, not HEAD ${head:0:12}"
elif [ "$status" != pass ]; then
  [ "$active" = 1 ] && exit 0
  reason="the verification block at HEAD records status=$status"
  next="Fix what it reports and run \`pnpm preflight\` again. If you are taking the give-up path instead, say so in your report and stop again: a block at HEAD that records the failure lets the next stop through."
else
  exit 0
fi

counter="$root/.preflight/stop-blocks"
read -r last count 2>/dev/null < "$counter" || true
[ "${last:-}" = "$head" ] || count=0
count=$((${count:-0} + 1))
[ "$count" -gt "$max_blocks" ] && exit 0
mkdir -p "$root/.preflight" && printf '%s %s\n' "$head" "$count" > "$counter"

echo "verify-before-stop: $reason. $next (Stop $count of $max_blocks held for this commit.)" >&2
exit 2
