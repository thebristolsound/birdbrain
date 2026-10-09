#!/usr/bin/env bash
# PreToolUse hook on Bash: blocks adding the `merge` or `approved` label through gh or agh.
# Only the maintainer applies those labels (docs/agents/triage-labels.md, ADR-0041); an agent
# applied `merge` by mistake during the 2026-10-08 sweep (#1775).
# Override, only when the maintainer asked for the label in this session: prefix the command
# with BIRDBRAIN_MAINTAINER_LABEL_OK=1.
# Hook exit codes: 0 allows the command, 2 blocks it and feeds stderr back to the agent.
set -u

input="$(cat)"
printf '%s' "$input" | node -e '
const fs = require("fs")
let j = {}
try { j = JSON.parse(fs.readFileSync(0, "utf8")) } catch {}
const cmd = (j.tool_input && j.tool_input.command) || ""
const cwd = j.cwd || process.cwd()
const guarded = new Set(["merge", "approved"])

// Shell-ish tokenizer: quotes, backslashes, and separators (; & | newline) as their own tokens.
function tokenize(s) {
  const out = []
  let cur = null
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === "\x27") {
      const e = s.indexOf("\x27", i + 1)
      const end = e < 0 ? s.length : e
      cur = (cur ?? "") + s.slice(i + 1, end)
      i = end
    } else if (c === "\"") {
      i++
      let v = ""
      while (i < s.length && s[i] !== "\"") {
        if (s[i] === "\\" && i + 1 < s.length) i++
        v += s[i++]
      }
      cur = (cur ?? "") + v
    } else if (c === "\\" && i + 1 < s.length) {
      if (s[i + 1] !== "\n") cur = (cur ?? "") + s[i + 1]
      i++
    } else if (/[;&|\n()]/.test(c)) {
      if (cur !== null) out.push(cur), (cur = null)
      out.push(";")
    } else if (/\s/.test(c)) {
      if (cur !== null) out.push(cur), (cur = null)
    } else {
      cur = (cur ?? "") + c
    }
  }
  if (cur !== null) out.push(cur)
  return out
}

const segments = [[]]
for (const t of tokenize(cmd)) {
  if (t === ";") segments.push([])
  else segments[segments.length - 1].push(t)
}

const override = /(^|[\s;&|(])(export\s+)?BIRDBRAIN_MAINTAINER_LABEL_OK=1(\s|$)/.test(cmd)
const names = (v) => v.split(",").map((x) => x.trim().toLowerCase())
const hits = []

for (let seg of segments) {
  while (seg.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(seg[0]) || ["env", "command", "exec", "sudo"].includes(seg[0]))) seg = seg.slice(1)
  if (!seg.length) continue
  const bin = seg[0].split("/").pop()
  if (bin !== "gh" && bin !== "agh") continue
  const args = seg.slice(1)
  if ((args.includes("pr") || args.includes("issue")) && args.includes("edit")) {
    for (let i = 0; i < args.length; i++) {
      let v = null
      if (args[i] === "--add-label") v = args[i + 1] ?? ""
      else if (args[i].startsWith("--add-label=")) v = args[i].slice("--add-label=".length)
      if (v !== null) for (const n of names(v)) if (guarded.has(n)) hits.push(n)
    }
  } else if (args[0] === "api") {
    const path = args.find((a) => /(^|\/)issues\/[^/]+\/labels\/?(\?|$)/.test(a))
    if (!path) continue
    let method = null
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "-X" || args[i] === "--method") method = (args[i + 1] || "").toUpperCase()
      else if (args[i].startsWith("--method=")) method = args[i].slice(9).toUpperCase()
      else if (/^-X./.test(args[i])) method = args[i].slice(2).toUpperCase()
    }
    if (method && method !== "POST" && method !== "PUT") continue
    for (let i = 0; i < args.length; i++) {
      let v = null
      if (["-f", "-F", "--field", "--raw-field"].includes(args[i])) v = args[i + 1] ?? ""
      else if (/^--(raw-)?field=/.test(args[i])) v = args[i].replace(/^--(raw-)?field=/, "")
      else if (/^-[fF]./.test(args[i])) v = args[i].slice(2)
      if (v !== null) {
        const m = v.match(/^labels(\[\])?=(.*)$/s)
        if (m) for (const n of names(m[2])) if (guarded.has(n)) hits.push(n)
      }
      let file = null
      if (args[i] === "--input") file = args[i + 1]
      else if (args[i].startsWith("--input=")) file = args[i].slice(8)
      if (file) {
        let body = ""
        try { body = file === "-" ? "" : fs.readFileSync(require("path").resolve(cwd, file), "utf8") } catch {}
        // An unreadable or stdin body cannot be checked: block rather than guess.
        if (!body) hits.push("(unchecked --input body)")
        for (const n of guarded) if (new RegExp("\"" + n + "\"", "i").test(body)) hits.push(n)
      }
    }
  }
}

if (hits.length && !override) {
  const list = [...new Set(hits)].join(", ")
  process.stderr.write(
    "guard-maintainer-labels: this command adds a maintainer-only label (" + list + "). " +
    "Only the maintainer applies `merge` and `approved` (docs/agents/triage-labels.md, ADR-0041). " +
    "If the maintainer asked you to apply it in this session, re-run the same command prefixed " +
    "with BIRDBRAIN_MAINTAINER_LABEL_OK=1. Otherwise leave the label for the maintainer.\n"
  )
  process.exit(2)
}
'
