// The two layers every GitHub post has: a visible top layer in plain language, and collapsed
// `<details>` blocks below it where the author writes however is most effective. Shared by
// lint-body.mjs (PR bodies) and ../../post-comment/scripts/lint-comment.mjs (comments).

const DETAILS_OPEN = /^\s*<details(\s[^>]*)?>\s*$/i
const DETAILS_CLOSE = /^\s*<\/details>\s*$/i
const SUMMARY_LINE = /^\s*<summary>(.*)<\/summary>\s*$/i

// Proxies for jargon. Each is a thing a reader outside the repository cannot act on; the
// author says it in words on the top layer and puts the token inside a details block.
const JARGON = [
  [/`/, 'inline code'],
  [/\b(?=[0-9a-f]*[a-f])(?=[0-9a-f]*\d)[0-9a-f]{7,40}\b/, 'a commit id'],
  [/\b[\w.-]+\.(ts|tsx|js|jsx|mjs|cjs|json|md|mdx|sh|ya?ml|css|html|sql)\b/i, 'a file name'],
  [/(^|[\s(\[])(?!https?:\/\/)(\.{0,2}\/)?[\w@.-]*\/[\w@./-]*\/[\w@./-]*/, 'a directory path'],
  [/\bADR-\d+/, 'an ADR number'],
  [/\b(pnpm|npx|npm|eslint|vitest|tsc|jq)\b/, 'a tool name'],
  [
    /\b(pre-pass|preflight|typecheck|linter|lint|worktree|merge base|diff coverage|known-answer|sha)\b/i,
    'repository jargon'
  ]
]

/**
 * Splits lines into the visible top layer and the collapsed details blocks, and checks that
 * each block is well formed: a `<summary>` on the first line inside, one line long, followed
 * by a blank line so Markdown renders in it, and a matching `</details>`; no nesting; no `##`
 * heading inside (section parsing reads `##` as a boundary).
 * @param {string[]} lines
 * @returns {{ visible: boolean[], blocks: { start: number, end: number, summary: string, lines: string[] }[], findings: string[] }}
 */
export function parseLayers(lines) {
  const findings = []
  const blocks = []
  const visible = lines.map(() => true)
  let open = -1
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (DETAILS_OPEN.test(line)) {
      if (open >= 0) {
        findings.push(`line ${i + 1}: a <details> block opens inside another; do not nest them`)
        continue
      }
      open = i
      continue
    }
    if (DETAILS_CLOSE.test(line)) {
      if (open < 0) {
        findings.push(`line ${i + 1}: </details> without an open <details>`)
        continue
      }
      const inner = lines.slice(open + 1, i)
      const first = inner.findIndex((l) => l.trim() !== '')
      const m = first >= 0 ? inner[first].match(SUMMARY_LINE) : null
      let summary = ''
      if (!m) {
        findings.push(
          `line ${open + 1}: a <details> block starts with one <summary>...</summary> line naming its contents in plain words`
        )
      } else {
        summary = m[1].trim()
        if (!summary) findings.push(`line ${open + first + 2}: an empty <summary>`)
        if (inner[first + 1] !== undefined && inner[first + 1].trim() !== '') {
          findings.push(`line ${open + first + 2}: a blank line follows </summary> so Markdown renders inside the block`)
        }
      }
      if (inner.some((l) => /^## /.test(l))) {
        findings.push(`line ${open + 1}: a <details> block holds no "## " heading; sections stay on the top layer`)
      }
      for (let k = open; k <= i; k++) visible[k] = false
      blocks.push({ start: open, end: i, summary, lines: inner })
      open = -1
      continue
    }
    if (open < 0 && /<\/?summary>/i.test(line)) {
      findings.push(`line ${i + 1}: <summary> outside a <details> block`)
    }
  }
  if (open >= 0) {
    findings.push(`line ${open + 1}: <details> is never closed`)
    for (let k = open; k < lines.length; k++) visible[k] = false
  }
  return { visible, blocks, findings }
}

/**
 * Names the first jargon token on a top-layer line, or null. `<summary>` text is on the top
 * layer too and is checked by the caller with the same function.
 * @param {string} line
 * @returns {string | null}
 */
export function jargonIn(line) {
  const text = line.replace(/<!--[\s\S]*?-->/g, '').replace(/\[[^\]]*\]\([^)]*\)/g, (m) => m.replace(/\([^)]*\)$/, ''))
  for (const [re, what] of JARGON) {
    const m = text.match(re)
    if (m) return `${what} ("${m[0].trim().slice(0, 40)}")`
  }
  return null
}

/**
 * Lints the visible layer for plain language. `exempt(i, line)` returns true for lines that
 * are protocol, not prose (a kind marker, a required heading, the attribution line).
 * @param {string[]} lines
 * @param {boolean[]} visible
 * @param {(i: number, line: string) => boolean} exempt
 * @returns {string[]}
 */
export function plainLanguageFindings(lines, visible, exempt = () => false) {
  const findings = []
  lines.forEach((line, i) => {
    if (!visible[i] || line.trim() === '' || exempt(i, line)) return
    if (/^\s*```/.test(line)) {
      findings.push(`line ${i + 1}: a fenced block on the top layer; fences go inside a <details> block`)
      return
    }
    const hit = jargonIn(line)
    if (hit) findings.push(`line ${i + 1}: the top layer is plain language, found ${hit}; say it in words or move it into a <details> block`)
  })
  return findings
}

/**
 * The same check on every block's `<summary>` text, which stays visible when collapsed.
 * @param {{ start: number, summary: string }[]} blocks
 * @returns {string[]}
 */
export function summaryFindings(blocks) {
  const findings = []
  for (const b of blocks) {
    const hit = b.summary && jargonIn(b.summary)
    if (hit) findings.push(`line ${b.start + 1}: the <summary> is plain language, found ${hit}`)
  }
  return findings
}
