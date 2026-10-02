#!/usr/bin/env node
// Lints a comment against ../template.md. Usage: lint-comment.mjs <file>
// The file is Markdown, or JSON with a `body` string (a `gh api --input` payload).
// Prints one finding per line and exits 1 on any finding.
import { readFileSync } from 'node:fs'
import { parseLayers, plainLanguageFindings, summaryFindings } from '../../post-pr-body/scripts/layers.mjs'

const GENERIC_CAP = 20
const VERDICT_MAX_FINDINGS = 5
const COMMIT_ID = /\b[0-9a-f]{7,40}\b/
const BOT_TRIGGER = /^@(coderabbitai|codex) (review|full review|security review)$/
// The trailing note an agent adds when posting as the maintainer (global agent instructions).
const DISCLOSURE = [/^> \[!NOTE\]$/, /^> [A-Z][\w.-]*( [A-Z][\w.-]*)? responding on behalf of Matt\.$/]
const FORBIDDEN = [
  [/co-authored-by/i, 'a Co-authored-by trailer'],
  [/Generated (with|by) \[Claude Code\]/, 'the platform attribution footer'],
  [/Summary by CodeRabbit|coderabbitai/i, 'CodeRabbit text']
]

// `cap` counts top-layer lines only; a <details> block is not on the top layer. `machineFirst`
// marks a first line a script reads back (cleanup.sh, the override hygiene check), which is
// exempt from the plain-language check. `details` is 'required', 'optional' or 'none'.
const KINDS = [
  // A review-bot trigger is the command alone: the bot reads it back, so it is
  // exempt from the plain-language check and from the CodeRabbit-text rule.
  { name: 'bot trigger', first: BOT_TRIGGER, cap: 1, machineFirst: true, details: 'none' },
  { name: 'cycle claim', first: /^Cycle claim: PR #\d+$/, cap: 3, machineFirst: true, details: 'optional' },
  { name: 'cycle release', first: /^Cycle release: PR #\d+$/, cap: 2, machineFirst: true, details: 'none' },
  {
    name: 'pre-pass verdict',
    first: /^\*\*Review verdict: (approve for human review|request changes)\*\*$/,
    cap: 10,
    details: 'required',
    check(lines, top, blocks, findings) {
      const items = lines.filter((l, i) => top[i] && /^\d+\. \S/.test(l))
      if (items.length > VERDICT_MAX_FINDINGS) {
        findings.push(`verdict lists ${items.length} findings on the top layer; the cap is ${VERDICT_MAX_FINDINGS}, the rest go in the full report`)
      }
      if (lines.some((l, i) => top[i] && /^\|/.test(l))) {
        findings.push('the findings table goes inside the full report; the top layer is a numbered list of plain sentences')
      }
      const report = blocks.find((b) => /^Full report\b/i.test(b.summary))
      if (!report) {
        findings.push('verdict lacks a <details> block whose <summary> starts with "Full report"')
      } else if (!report.lines.some((l) => COMMIT_ID.test(l) || /^Full report: \S+/.test(l.trim()))) {
        findings.push('the full report names the reviewed commit id (or carries a "Full report: <link>" line when it is too large to nest)')
      }
    }
  },
  {
    name: 'review reply',
    first: /^(Applied\.|Not applied: \S.*)$/,
    cap: 1,
    details: 'optional',
    check(lines, top, blocks, findings) {
      const first = lines[0].trim()
      if (/^Not applied:/.test(first) && (first.match(/[.!?](?=\s|$)/g) || []).length > 1) {
        findings.push('a "Not applied" reply is one sentence')
      }
      if (first === 'Applied.' && !blocks.some((b) => b.lines.some((l) => COMMIT_ID.test(l)))) {
        findings.push('an "Applied." reply names the commit inside a <details> block')
      }
    }
  },
  {
    name: 'give-up or defect',
    first: /^(Give-up|Defect): \S/,
    cap: 10,
    details: 'required',
    check(lines, top, blocks, findings) {
      const text = lines.join('\n')
      for (const field of ['**What:**', '**Where:**', '**Reproduce:**']) {
        if (!text.includes(field)) findings.push(`missing the ${field} field`)
      }
      const whatIdx = lines.findIndex((l) => l.startsWith('**What:**'))
      if (whatIdx >= 0 && !top[whatIdx]) findings.push('**What:** is on the top layer, in plain words')
      const inner = blocks.flatMap((b) => b.lines)
      const where = inner.find((l) => l.startsWith('**Where:**'))
      if (lines.some((l, i) => top[i] && l.startsWith('**Where:**'))) {
        findings.push('**Where:** goes inside the <details> block; it names a file:line')
      } else if (where && !/\S+:\d+/.test(where)) {
        findings.push('**Where:** must name a file:line')
      }
      if (lines.some((l, i) => top[i] && l.startsWith('**Reproduce:**'))) {
        findings.push('**Reproduce:** goes inside the <details> block')
      }
    }
  }
]

// A verdict whose first line uses the old marker or the wrong verdict word.
const VERDICT_LOOKALIKE = /^\*\*(Reviewer pre-pass|Review verdict)/
// An applied reply that carries more than the word.
const APPLIED_LOOKALIKE = /^applied\b/i

export function lintComment(raw) {
  const findings = []
  const text = raw.replace(/\r\n/g, '\n')
  const all = text.split('\n')
  while (all.length && all[all.length - 1].trim() === '') all.pop()
  while (all.length && all[0].trim() === '') all.shift()
  stripDisclosure(all)
  if (!all.length) return ['comment is empty']

  const first = all[0].trim()
  const kind = KINDS.find((k) => k.first.test(first))
  for (const [re, what] of FORBIDDEN) {
    if (kind && kind.name === 'bot trigger' && what === 'CodeRabbit text') continue
    if (re.test(text)) findings.push(`comment contains ${what}`)
  }

  const layers = parseLayers(all)
  findings.push(...layers.findings)
  const top = layers.visible
  const blocks = layers.blocks

  if (!kind && VERDICT_LOOKALIKE.test(first)) {
    findings.push('a verdict first line is "**Review verdict: approve for human review**" or "**Review verdict: request changes**"; the commit id goes in the full report')
  }
  if (!kind && APPLIED_LOOKALIKE.test(first)) {
    findings.push('an applied reply is "Applied." and nothing else on the top layer; the commit goes in a <details> block, a reason in a "Not applied: <one sentence>" reply')
  }
  const cap = kind ? kind.cap : GENERIC_CAP
  const topLines = all.filter((l, i) => top[i])
  const counted = kind && kind.cap <= 3 ? topLines.filter((l) => l.trim() !== '').length : topLines.length
  if (counted > cap) {
    findings.push(`${kind ? kind.name : 'comment'} has ${counted} lines on the top layer; the cap is ${cap}, the rest goes in a <details> block`)
  }
  if (kind && kind.details === 'none' && blocks.length) {
    findings.push(`a ${kind.name} has no <details> block`)
  }
  if (kind && kind.details === 'required' && !blocks.length) {
    findings.push(`a ${kind.name} carries its detail in a <details> block below the top layer`)
  }
  if (kind && kind.check) kind.check(all, top, blocks, findings)

  const exempt = (i) => i === 0 && Boolean(kind && kind.machineFirst)
  findings.push(...plainLanguageFindings(all, top, exempt))
  findings.push(...summaryFindings(blocks))
  return findings
}

// Drops the disclosure note so it counts toward no kind's shape or line cap.
function stripDisclosure(all) {
  const n = all.length
  if (n < 2 || !DISCLOSURE[0].test(all[n - 2]) || !DISCLOSURE[1].test(all[n - 1])) return
  all.splice(n - 2)
  while (all.length && all[all.length - 1].trim() === '') all.pop()
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
