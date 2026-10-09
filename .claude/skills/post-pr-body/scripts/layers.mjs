// The two layers every GitHub post has: a visible top layer in plain language, and collapsed
// `<details>` blocks below it where the author writes however is most effective. Shared by
// lint-body.mjs (PR bodies) and ../../post-comment/scripts/lint-comment.mjs (comments).

const DETAILS_OPEN = /^\s*<details(\s[^>]*)?>\s*$/i
const DETAILS_CLOSE = /^\s*<\/details>\s*$/i
const SUMMARY_LINE = /^\s*<summary>(.*)<\/summary>\s*$/i

// Proxies for jargon. Each is a thing a reader outside the repository cannot act on; the
// author says it in words on the top layer and puts the token inside a details block.
// The third entry is the plain-words alternative the finding suggests.
const JARGON = [
  [/`/, 'inline code', 'describe the code in words'],
  [
    /\b(?=[0-9a-f]*[a-f])(?=[0-9a-f]*\d)[0-9a-f]{7,40}\b/,
    'a commit id',
    'say "the latest commit" or describe the change'
  ],
  [
    /\b[\w.-]+\.(ts|tsx|js|jsx|mjs|cjs|json|md|mdx|sh|ya?ml|css|html|sql)\b/i,
    'a file name',
    'name what the file does ("the settings screen")'
  ],
  [
    /(^|[\s(\[])(?!https?:\/\/)(\.{0,2}\/)?[\w@.-]*\/[\w@./-]*\/[\w@./-]*/,
    'a directory path',
    'name the area in words ("the capture code")'
  ],
  [/\bADR-\d+/, 'an ADR number', 'name the decision in words ("the one-fix-round rule")'],
  [
    /\b(pnpm|npx|npm|eslint|vitest|tsc|jq)\b/,
    'a tool name',
    'name what it checks ("the tests", "the type check", "the style check")'
  ],
  [
    /\b(pre-pass|preflight|typecheck|linter|lint|worktree|merge base|diff coverage|known-answer|sha)\b/i,
    'repository jargon',
    null
  ]
]

// Plain words for each repository term, keyed by its lower-case form.
const PLAIN_TERMS = {
  'pre-pass': 'review',
  preflight: 'full check run',
  typecheck: 'type check',
  linter: 'style check',
  lint: 'style check',
  worktree: 'working copy',
  'merge base': 'where the branch started',
  'diff coverage': 'test coverage of the changed lines',
  'known-answer': 'reference test',
  sha: 'commit'
}

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
        findings.push(`line ${i + 1}: </details> without an open <details>; add the <details> and <summary> lines above it, or delete it`)
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
        if (!summary) {
          findings.push(`line ${open + first + 2}: an empty <summary>; name the contents in plain words, e.g. <summary>Test output</summary>`)
        }
        if (inner[first + 1] !== undefined && inner[first + 1].trim() !== '') {
          findings.push(`line ${open + first + 2}: a blank line follows </summary> so Markdown renders inside the block`)
        }
      }
      if (inner.some((l) => /^## /.test(l))) {
        findings.push(`line ${open + 1}: a <details> block holds no "## " heading; use bold text inside the block, or move the section to the top layer`)
      }
      for (let k = open; k <= i; k++) visible[k] = false
      blocks.push({ start: open, end: i, summary, lines: inner })
      open = -1
      continue
    }
    if (open < 0 && /<\/?summary>/i.test(line)) {
      findings.push(`line ${i + 1}: <summary> outside a <details> block; make it the first line after <details>`)
    }
  }
  if (open >= 0) {
    findings.push(`line ${open + 1}: <details> is never closed; add </details> after the block's last line`)
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
  for (const [re, what, alt] of JARGON) {
    const m = text.match(re)
    if (!m) continue
    const token = m[0].trim()
    const instead = alt || `write "${PLAIN_TERMS[token.toLowerCase()]}"`
    return `${what} ("${token.slice(0, 40)}"); ${instead}`
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
    if (hit) findings.push(`line ${i + 1}: the top layer is plain language, found ${hit}, or move it into a <details> block`)
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
