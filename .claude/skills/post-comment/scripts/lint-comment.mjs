#!/usr/bin/env node
// Lints a comment against ../template.md. Usage: lint-comment.mjs <file>
// The file is Markdown, or JSON with a `body` string (a `gh api --input` payload).
// Prints one finding per line and exits 1 on any finding.
import { readFileSync } from 'node:fs'

const GENERIC_CAP = 20
const VERDICT_MAX_ROWS = 5
const FORBIDDEN = [
  [/co-authored-by/i, 'a Co-authored-by trailer'],
  [/Generated (with|by) \[Claude Code\]/, 'the platform attribution footer'],
  [/Summary by CodeRabbit|coderabbitai/i, 'CodeRabbit text']
]

const KINDS = [
  { name: 'cycle claim', first: /^Cycle claim: PR #\d+$/, cap: 3 },
  { name: 'cycle release', first: /^Cycle release: PR #\d+$/, cap: 2 },
  {
    name: 'pre-pass verdict',
    first: /^\*\*Reviewer pre-pass \([0-9a-f]{7,40}\): (approve for human review|request changes)\*\*/,
    cap: 20,
    check(lines, findings) {
      const rows = lines.filter((l) => /^\|\s*\d+\s*\|/.test(l))
      if (rows.length > VERDICT_MAX_ROWS) {
        findings.push(`verdict has ${rows.length} finding rows; the cap is ${VERDICT_MAX_ROWS}, the rest go in the full report`)
      }
      if (!lines.some((l) => /^Full report: \S+/.test(l.trim()))) {
        findings.push('verdict lacks a "Full report: <link>" line; the report never goes on the PR')
      }
    }
  },
  {
    name: 'review reply',
    first: /^(applied [0-9a-f]{7,40}|not applied: \S.*)$/,
    cap: 1,
    check(lines, findings) {
      const first = lines[0].trim()
      if (/^not applied:/.test(first) && (first.match(/[.!?](?=\s|$)/g) || []).length > 1) {
        findings.push('a "not applied" reply is one sentence')
      }
    }
  },
  {
    name: 'give-up or defect',
    first: /^(Give-up|Defect): \S/,
    cap: 20,
    fences: true,
    check(lines, findings) {
      const text = lines.join('\n')
      for (const field of ['**What:**', '**Where:**', '**Reproduce:**']) {
        if (!text.includes(field)) findings.push(`missing the ${field} field`)
      }
      const where = lines.find((l) => l.startsWith('**Where:**')) || ''
      if (where && !/\S+:\d+/.test(where)) findings.push('**Where:** must name a file:line')
    }
  }
]

// A pre-pass verdict starting with a bold `**...**` line whose verdict word is wrong.
const VERDICT_LOOKALIKE = /^\*\*Reviewer pre-pass/
// An applied reply that carries more than the sha.
const APPLIED_LOOKALIKE = /^applied\b/i

export function lintComment(raw) {
  const findings = []
  const text = raw.replace(/\r\n/g, '\n')
  const all = text.split('\n')
  while (all.length && all[all.length - 1].trim() === '') all.pop()
  while (all.length && all[0].trim() === '') all.shift()
  if (!all.length) return ['comment is empty']

  for (const [re, what] of FORBIDDEN) {
    if (re.test(text)) findings.push(`comment contains ${what}`)
  }

  const first = all[0].trim()
  const kind = KINDS.find((k) => k.first.test(first))
  if (!kind && VERDICT_LOOKALIKE.test(first)) {
    findings.push('a pre-pass verdict first line is "**Reviewer pre-pass (<sha>): approve for human review**" or "...: request changes**"')
  }
  if (!kind && APPLIED_LOOKALIKE.test(first)) {
    findings.push('an applied reply is "applied <sha>" and nothing else; anything more goes in a "not applied: <one sentence>" reply or the PR')
  }
  const cap = kind ? kind.cap : GENERIC_CAP
  const nonBlank = all.filter((l) => l.trim() !== '')
  const counted = kind && kind.cap <= 3 ? nonBlank.length : all.length
  if (counted > cap) {
    findings.push(`${kind ? kind.name : 'comment'} has ${counted} lines; the cap is ${cap}`)
  }
  if (!(kind && kind.fences) && all.some((l) => /^\s*```/.test(l))) {
    findings.push('fenced blocks appear only in a give-up or defect comment; test output belongs in the PR Verification block')
  }
  if (kind && kind.check) kind.check(all, findings)
  return findings
}

function bodyFromFile(path) {
  const raw = readFileSync(path, 'utf8')
  if (path.endsWith('.json') || /^\s*\{/.test(raw)) {
    try {
      const j = JSON.parse(raw)
      if (typeof j.body === 'string') return j.body
    } catch {
      // not JSON after all; lint it as Markdown
    }
  }
  return raw
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const file = process.argv[2]
  if (!file) {
    console.error('usage: lint-comment.mjs <file>')
    process.exit(2)
  }
  const findings = lintComment(bodyFromFile(file))
  for (const f of findings) console.log(`- ${f}`)
  process.exit(findings.length ? 1 : 0)
}
