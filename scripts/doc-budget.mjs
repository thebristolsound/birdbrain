// Mechanical backstop for the doc curator's author limits (docs/agents/doc-curator.md).
//
// Compares the working tree of website/content/docs/*.mdx against a base ref and
// fails on anything the curator is not allowed to do: touching any other file,
// adding or removing pages, adding or removing headings, changing more than
// --max-sections sections, growing any section by more than --max-words, or
// adding one of the banned openers the writing guide already forbids.
//
// It cannot judge whether a change inside a section was *required* — that is the
// reviewer's lens 3. It can prove the change stayed inside the fence.
//
// Usage: node scripts/doc-budget.mjs [--base <ref>] [--max-words 40] [--max-sections 3] [--json]

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const DOCS_DIR = 'website/content/docs/'
const BANNED = [
  /\bIn order to\b/,
  /\bIt(?:'s| is) worth noting\b/,
  /\bIt(?:'s| is) important to note\b/,
  /^\s*Additionally,/m,
  /\bAt the end of the day\b/,
  /\bLet's dive in\b/,
  /\bseamless(?:ly)?\b/i,
  /\brobust\b/i,
  /\bcomprehensive\b/i,
  /\bcutting-edge\b/i,
  /\benterprise-grade\b/i,
  /\bAI-powered\b/i
]

const parseArgs = (argv) => {
  const args = { base: 'HEAD', maxWords: 40, maxSections: 3, json: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--base') args.base = argv[++i]
    else if (a === '--max-words') args.maxWords = Number(argv[++i])
    else if (a === '--max-sections') args.maxSections = Number(argv[++i])
    else if (a === '--json') args.json = true
    else throw new Error(`Unknown argument: ${a}`)
  }
  return args
}

const git = (...a) => execFileSync('git', a, { encoding: 'utf8' })

const wordCount = (s) => (s.trim() ? s.trim().split(/\s+/).length : 0)

// Split a page into ordered sections keyed by the exact heading line. Frontmatter
// and any preamble before the first heading get synthetic keys so they are fenced
// too. Duplicate heading text is disambiguated by ordinal.
const sections = (text) => {
  const out = new Map()
  const seen = new Map()
  let key = '(preamble)'
  let buf = []
  const lines = text.split('\n')
  let i = 0
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1)
    if (end > 0) {
      out.set('(frontmatter)', lines.slice(0, end + 1).join('\n'))
      i = end + 1
    }
  }
  for (; i < lines.length; i++) {
    const line = lines[i]
    if (/^#{1,6}\s/.test(line)) {
      out.set(key, buf.join('\n'))
      const n = (seen.get(line) ?? 0) + 1
      seen.set(line, n)
      key = n === 1 ? line : `${line} (#${n})`
      buf = []
    }
    buf.push(line)
  }
  out.set(key, buf.join('\n'))
  return out
}

const main = () => {
  const args = parseArgs(process.argv.slice(2))
  const failures = []
  const changed = []

  const status = git('status', '--porcelain', '--untracked-files=all')
    .split('\n')
    .filter(Boolean)
    .map((l) => ({ code: l.slice(0, 2), path: l.slice(3) }))

  for (const { code, path } of status) {
    if (path.startsWith('.curator/')) continue
    if (!path.startsWith(DOCS_DIR) || !path.endsWith('.mdx')) {
      failures.push({ rule: 'scope', path, detail: `touched a file outside ${DOCS_DIR}*.mdx` })
      continue
    }
    if (code.includes('?') || code.includes('A')) {
      failures.push({ rule: 'no-new-page', path, detail: 'page added' })
      continue
    }
    if (code.includes('D')) {
      failures.push({ rule: 'no-delete-page', path, detail: 'page deleted' })
      continue
    }
    changed.push(path)
  }

  let changedSections = 0
  const report = []
  for (const path of changed) {
    const before = sections(git('show', `${args.base}:${path}`))
    const after = sections(readFileSync(path, 'utf8'))

    for (const k of after.keys()) {
      if (!before.has(k)) failures.push({ rule: 'no-new-heading', path, detail: k })
    }
    for (const k of before.keys()) {
      if (!after.has(k)) failures.push({ rule: 'no-removed-heading', path, detail: k })
    }
    for (const [k, b] of before) {
      const a = after.get(k)
      if (a === undefined || a.trimEnd() === b.trimEnd()) continue
      changedSections++
      const delta = wordCount(a) - wordCount(b)
      const entry = { path, section: k, wordDelta: delta }
      report.push(entry)
      if (k === '(frontmatter)')
        failures.push({ rule: 'scope', path, detail: 'frontmatter changed' })
      if (delta > args.maxWords) {
        failures.push({ rule: 'max-words', path, detail: `${k}: +${delta} > ${args.maxWords}` })
      }
      const addedLines = a.split('\n').filter((l) => !b.includes(l))
      for (const l of addedLines) {
        for (const re of BANNED) {
          if (re.test(l))
            failures.push({ rule: 'banned-phrase', path, detail: `${re}: ${l.trim()}` })
        }
      }
    }
  }
  if (changedSections > args.maxSections) {
    failures.push({
      rule: 'max-sections',
      path: '*',
      detail: `${changedSections} sections changed > ${args.maxSections}`
    })
  }

  const result = { ok: failures.length === 0, changedFiles: changed, sections: report, failures }
  if (args.json) {
    console.log(JSON.stringify(result, null, 2))
  } else {
    for (const r of report)
      console.log(`${r.path} :: ${r.section} :: ${r.wordDelta >= 0 ? '+' : ''}${r.wordDelta} words`)
    for (const f of failures) console.error(`FAIL [${f.rule}] ${f.path}: ${f.detail}`)
    console.log(result.ok ? 'doc-budget: ok' : `doc-budget: ${failures.length} failure(s)`)
  }
  process.exit(result.ok ? 0 : 1)
}

main()
