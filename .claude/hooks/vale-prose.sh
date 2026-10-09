#!/usr/bin/env bash
# Prose check. Three modes:
#   vale-prose.sh <file>                  check the file's lines changed since HEAD, exit 0/2
#   vale-prose.sh --base <ref> [file...]  check lines changed since the merge base of <ref> and
#                                         HEAD, committed or not; with no files, every Markdown
#                                         file changed since then. Preflight runs this mode.
#   vale-prose.sh                         PostToolUse hook: read the Edit or Write call on stdin
# Exit codes: 0 passes, 2 feeds stderr back to the agent so it fixes the lines it just wrote.
#
# Only error-level rules of the Birdbrain style block, and only on changed lines, so text that
# predates the rule never blocks an unrelated edit. A whole-file `vale <file>` reports those
# older errors too. Everything else Vale reports stays advisory. The check fails open: without
# vale, or without the synced Google package, it says so on stderr and passes.
set -u

base=""
files=()
if [ "${1:-}" = "--base" ]; then
  [ $# -ge 2 ] || { echo "usage: vale-prose.sh --base <ref> [file...]" >&2; exit 1; }
  root="$(git rev-parse --show-toplevel)" || exit 1
  base="$(git -C "$root" merge-base "$2" HEAD)" || {
    echo "vale-prose: cannot resolve a merge base between $2 and HEAD" >&2
    exit 1
  }
  shift 2
  if [ $# -ge 1 ]; then
    files=("$@")
  else
    while IFS= read -r f; do files+=("$root/$f"); done < <(
      {
        git -C "$root" diff --name-only --diff-filter=d "$base" -- '*.md' '*.mdx'
        git -C "$root" ls-files --others --exclude-standard -- '*.md' '*.mdx'
      } | sort -u
    )
  fi
elif [ $# -ge 1 ]; then
  files=("$1")
else
  files=("$(node -e '
    let s = ""
    process.stdin.on("data", (d) => (s += d)).on("end", () => {
      let j = {}
      try { j = JSON.parse(s) } catch {}
      process.stdout.write((j.tool_input && j.tool_input.file_path) || "")
    })')")
fi

hunks="$(mktemp)"
trap 'rm -f "$hunks"' EXIT

# Prints "<file>:<line>:<col> <check> <message>" for each error on a changed line of $1.
check_file() {
  local file="$1" dir top rel report status
  case "$file" in *.md | *.mdx) ;; *) return 0 ;; esac
  case "$file" in /*) ;; *) file="$PWD/$file" ;; esac
  [ -f "$file" ] || return 0

  # The file's own checkout decides the config: a worktree lints against its own .vale.ini.
  dir="$(dirname "$file")"
  top="$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null)" || return 0
  [ -f "$top/.vale.ini" ] || return 0
  rel="${file#"$top"/}"
  git -C "$top" check-ignore -q -- "$rel" && return 0

  report="$(cd "$top" && vale --config "$top/.vale.ini" --output JSON "$rel" 2>&1)"
  status=$?
  if [ "$status" -ge 2 ]; then
    echo "vale-prose: vale could not run (try 'vale sync'), prose check skipped" >&2
    return 0
  fi

  # Added or changed line numbers against the base (HEAD unless --base); a file the base does
  # not have counts whole. The hunk list goes through a file and the report over stdin: either
  # can exceed the size one environment value may hold, and that exec failure would read as a
  # pass.
  if git -C "$top" cat-file -e "${base:-HEAD}:$rel" 2>/dev/null; then
    git -C "$top" diff -U0 "${base:-HEAD}" -- "$rel" | grep '^@@' > "$hunks" || true
  else
    printf 'all' > "$hunks"
  fi

  printf '%s' "$report" | HUNKS="$hunks" node -e '
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
    })'
}

if ! command -v vale >/dev/null 2>&1; then
  for f in "${files[@]}"; do
    case "$f" in *.md | *.mdx)
      echo "vale-prose: vale is not installed (scripts/setup-worktree.sh installs it), prose check skipped" >&2
      exit 0 ;;
    esac
  done
  exit 0
fi

findings=""
for f in "${files[@]}"; do
  out="$(check_file "$f")"
  [ -n "$out" ] && findings="${findings}${out}"$'\n'
done

if [ -n "$base" ]; then
  echo "vale-prose: checked ${#files[@]} Markdown file(s) changed since ${base:0:9}" >&2
fi
[ -z "$findings" ] && exit 0
{
  echo "vale-prose: the lines you wrote break the writing guide (docs/agents/writing-guide.md). Rewrite them, do not reword around the pattern."
  printf '%s' "$findings"
} >&2
exit 2
