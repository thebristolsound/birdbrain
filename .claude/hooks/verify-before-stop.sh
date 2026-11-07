#!/usr/bin/env bash
# Stop and SubagentStop hook: an implementer that committed work does not stop until
# `pnpm preflight` has stamped a verification block for its current HEAD.
#
# The implementer's instructions already say to run preflight before opening a PR
# (.claude/agents/birdbrain-implementer.md); this makes the rule mechanical, as Anthropic's
# Claude Code guidance puts it: "If something has to happen every time, make it a hook".
# It runs no tests itself. It reads the stamp line preflight writes,
# `<!-- preflight vN sha=<sha> status=<pass|fail> -->`, from .preflight/verification.md.
#
# It acts only for the agents named in $bound, read from the payload's agent_type, which
# SubagentStop always carries and Stop carries in a session started with `--agent`. Every
# other session passes through. It blocks once per stop: when the payload says the agent is
# already continuing because of a stop hook (stop_hook_active), it lets the stop through, so
# an implementer on the give-up path is reminded, never trapped.
#
# Exit codes: 0 allows the stop, 2 sends the agent back to work with stderr as the reason.
set -u

# Agents this hook binds, space-separated.
bound="birdbrain-implementer"

read -r agent active cwd < <(node -e '
  let s = ""
  process.stdin.on("data", (d) => (s += d)).on("end", () => {
    let j = {}
    try { j = JSON.parse(s) } catch {}
    const cwd = j.cwd || process.cwd()
    process.stdout.write(`${j.agent_type || "-"} ${j.stop_hook_active ? 1 : 0} ${cwd}\n`)
  })')

case " $bound " in *" $agent "*) ;; *) exit 0 ;; esac
[ "$active" = 1 ] && exit 0

root="$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null)" || exit 0
head="$(git -C "$root" rev-parse HEAD 2>/dev/null)" || exit 0
# No work committed past main means nothing to verify: the give-up path at intake.
ahead="$(git -C "$root" rev-list --count origin/main..HEAD 2>/dev/null)" || exit 0
[ "$ahead" -gt 0 ] || exit 0

block="$root/.preflight/verification.md"
stamp="$(grep -m1 -oE '<!-- preflight v[0-9]+ sha=[0-9a-f]+ status=[a-z]+ -->' "$block" 2>/dev/null)"
sha="$(printf '%s' "$stamp" | sed -nE 's/.* sha=([0-9a-f]+) .*/\1/p')"
status="$(printf '%s' "$stamp" | sed -nE 's/.* status=([a-z]+) .*/\1/p')"

if [ -z "$stamp" ]; then
  reason="no verification block at .preflight/verification.md"
elif [ "$sha" != "$head" ]; then
  reason="the verification block is for ${sha:0:12}, not HEAD ${head:0:12}"
elif [ "$status" != pass ]; then
  reason="the verification block at HEAD records status=$status"
else
  exit 0
fi

echo "verify-before-stop: $reason. Commit your work, run \`pnpm preflight\`, and fix what it reports before you finish. If you are taking the give-up path instead, say so in your report and stop again." >&2
exit 2
