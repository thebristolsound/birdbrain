#!/usr/bin/env bash
# Prose check. Two modes:
#   vale-prose.sh <file>   check the file's changed lines and exit 0/2
#   vale-prose.sh          PostToolUse hook: read the Edit or Write call on stdin, check its file
# Exit codes: 0 passes, 2 feeds stderr back to the agent so it fixes the lines it just wrote.
#
# Only error-level rules of the Birdbrain style block, and only on lines that differ from HEAD,
# so text that predates the rule never blocks an unrelated edit. Everything else Vale reports
# stays advisory. The check fails open: without vale, or without the synced Google package,
# it says so on stderr and passes.
set -u

if [ $# -ge 1 ]; then
  file="$1"
else
  file="$(node -e '
    let s = ""
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      let j = {}
      try { j = JSON.parse(s) } catch {}
      process.stdout.write((j.tool_input && j.tool_input.file_path) || "")
    })')"
fi

case "$file" in *.md | *.mdx) ;; *) exit 0 ;; esac
case "$file" in /*) ;; *) file="$PWD/$file" ;; esac
[ -f "$file" ] || exit 0

# The file's own checkout decides the config: a worktree lints against its own .vale.ini.
dir="$(dirname "$file")"
top="$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null)" || exit 0
[ -f "$top/.vale.ini" ] || exit 0
rel="${file#"$top"/}"
git -C "$top" check-ignore -q -- "$rel" && exit 0

if ! command -v vale >/dev/null 2>&1; then
  echo "vale-prose: vale is not installed (scripts/setup-worktree.sh installs it), prose check skipped" >&2
  exit 0
fi

report="$(cd "$top" && vale --config "$top/.vale.ini" --output JSON "$rel" 2>&1)"
status=$?
if [ "$status" -ge 2 ]; then
  echo "vale-prose: vale could not run (try 'vale sync'), prose check skipped" >&2
  exit 0
fi

# Added or changed line numbers against HEAD; an untracked file has no diff and counts whole.
# The hunk list goes through a file and the report over stdin: either can exceed the size one
# environment value may hold, and that exec failure would read as a pass.
hunks="$(mktemp)"
trap 'rm -f "$hunks"' EXIT
if git -C "$top" ls-files --error-unmatch -- "$rel" >/dev/null 2>&1; then
  git -C "$top" diff -U0 HEAD -- "$rel" | grep '^@@' > "$hunks" || true
else
  printf 'all' > "$hunks"
fi

findings="$(printf '%s' "$report" | HUNKS="$hunks" node -e '
  const fs = require("fs")
  let raw = ""
  process.stdin.on("data", (d) => (raw += d)).on("end", () => {
  const changed = new Set()
  const hunks = fs.readFileSync(process.env.HUNKS, "utf8")
  const all = hunks === "all"
  for (const h of hunks.split("\n")) {
    const m = /^@@ -\S+ \+(\d+)(?:,(\d+))? @@/.exec(h)
    if (!m) continue
    const start = Number(m[1])
    const count = m[2] === undefined ? 1 : Number(m[2])
    for (let i = 0; i < count; i++) changed.add(start + i)
  }
  let data = {}
  try { data = JSON.parse(raw) } catch {}
  for (const [file, alerts] of Object.entries(data)) {
    for (const a of alerts) {
      if (a.Severity !== "error" || !a.Check.startsWith("Birdbrain.")) continue
      if (!all && !changed.has(a.Line)) continue
      console.log(file + ":" + a.Line + ":" + a.Span[0] + " " + a.Check + " " + a.Message)
    }
  }
  })')"

[ -z "$findings" ] && exit 0
{
  echo "vale-prose: the lines you wrote break the writing guide (docs/agents/writing-guide.md). Rewrite them, do not reword around the pattern."
  echo "$findings"
} >&2
exit 2
