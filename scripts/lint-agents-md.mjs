// Reports whether CLAUDE.md and AGENTS.md have drifted apart, without failing
// the build.
//
// The two files are one document served to two readers, so a section added to
// one and not the other is normally an oversight rather than a decision. It is
// not always one: CLAUDE.md is expected to grow Claude-specific overrides that
// have no meaning in AGENTS.md. A gate that cannot tell those apart can only be
// advisory, so this prints the drift and exits 0. CI surfaces it as a warning
// annotation on the run; nothing blocks on it.
//
// Usage: node scripts/lint-agents-md.mjs

import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export const LEFT = 'CLAUDE.md'
export const RIGHT = 'AGENTS.md'

// Counts the lines each file holds and the other does not. Order-insensitive on
// purpose: a section moved between files is drift, a section reordered is not.
export const compareDocuments = (left, right) => {
  const leftLines = left.split('\n')
  const rightLines = right.split('\n')
  const missing = (from, other) => {
    const counts = new Map()
    for (const line of other) counts.set(line, (counts.get(line) ?? 0) + 1)
    return from.filter((line) => {
      const remaining = counts.get(line) ?? 0
      if (remaining === 0) return true
      counts.set(line, remaining - 1)
      return false
    })
  }
  return {
    identical: left === right,
    onlyInLeft: missing(leftLines, rightLines).filter((line) => line.trim()),
    onlyInRight: missing(rightLines, leftLines).filter((line) => line.trim())
  }
}

export const summarize = ({ identical, onlyInLeft, onlyInRight }) => {
  if (identical) return `${LEFT} and ${RIGHT} match`
  const parts = []
  if (onlyInLeft.length > 0) parts.push(`${onlyInLeft.length} only in ${LEFT}`)
  if (onlyInRight.length > 0) parts.push(`${onlyInRight.length} only in ${RIGHT}`)
  // Whitespace-only difference: the files are not equal but no content moved.
  if (parts.length === 0) parts.push('whitespace only')
  return `${LEFT} and ${RIGHT} differ - ${parts.join(', ')}`
}

const diffText = () => {
  try {
    execFileSync('git', ['diff', '--no-index', '--exit-code', LEFT, RIGHT], { encoding: 'utf8' })
    return ''
  } catch (error) {
    // git exits 1 with the diff on stdout when the files differ; any other
    // failure (git absent, file unreadable) leaves stdout empty and the summary
    // above is still reported.
    return error.stdout ?? ''
  }
}

const main = () => {
  const result = compareDocuments(readFileSync(LEFT, 'utf8'), readFileSync(RIGHT, 'utf8'))
  const summary = summarize(result)

  if (result.identical) {
    console.log(`lint:agents-md: ${summary}`)
    return
  }

  const diff = diffText()
  if (diff) console.log(diff)
  console.log(`lint:agents-md: ${summary}`)
  console.log('lint:agents-md: advisory only, this does not fail the build')
  if (process.env.GITHUB_ACTIONS === 'true') {
    console.log(`::warning file=${RIGHT},title=Agent instructions drift::${summary}`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
