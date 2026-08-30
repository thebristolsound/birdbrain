#!/usr/bin/env node
// Composes the squash-merge subject and body from a PR body.
// Usage: compose.mjs <body-file> <pr-title> <pr-number> <out-dir>
// Writes <out-dir>/subject.txt and <out-dir>/body.txt; prints both. Exits 1 without a Summary.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const WRAP = 72

export function summaryOf(body) {
  const lines = body.replace(/\r\n/g, '\n').split('\n')
  const start = lines.findIndex((l) => l.trim() === '## Summary')
  if (start < 0) return null
  let end = lines.findIndex((l, i) => i > start && /^## /.test(l))
  if (end < 0) end = lines.length
  return lines
    .slice(start + 1, end)
    .join('\n')
    .replace(/<!--[\s\S]*?-->/g, '')
    .trim()
}

export function wrap(text, width = WRAP) {
  return text
    .split(/\n{2,}/)
    .map((para) => {
      const words = para.replace(/\s+/g, ' ').trim().split(' ')
      const out = []
      let line = ''
      for (const w of words) {
        if (line && line.length + 1 + w.length > width) {
          out.push(line)
          line = w
        } else {
          line = line ? `${line} ${w}` : w
        }
      }
      if (line) out.push(line)
      return out.join('\n')
    })
    .join('\n\n')
}

export function compose(body, title, number) {
  const summary = summaryOf(body)
  if (!summary) return null
  return { subject: `${title.trim()} (#${number})`, body: wrap(summary) }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const [file, title, number, outDir] = process.argv.slice(2)
  if (!file || !title || !number || !outDir) {
    console.error('usage: compose.mjs <body-file> <pr-title> <pr-number> <out-dir>')
    process.exit(2)
  }
  const result = compose(readFileSync(file, 'utf8'), title, number)
  if (!result) {
    console.error('compose: the PR body has no "## Summary" section; fix the body first (post-pr-body)')
    process.exit(1)
  }
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'subject.txt'), result.subject + '\n')
  writeFileSync(join(outDir, 'body.txt'), result.body + '\n')
  if (result.subject.length > WRAP) {
    console.error(`compose: subject is ${result.subject.length} columns; shorten the PR title if you want it under ${WRAP}`)
  }
  process.stdout.write(`${result.subject}\n\n${result.body}\n`)
}
