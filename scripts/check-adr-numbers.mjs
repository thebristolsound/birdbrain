// Fails when two ADRs in docs/adr/ share a number.
//
// ADR numbers are picked by hand from whatever the author's branch shows as the
// highest, so two branches cut from the same main pick the same next number. Both
// 0029s merged that way, and two 0042s landed seven minutes apart (#1756, #1758),
// which cost a follow-up PR to renumber one and fix its links.
//
// Each branch passes against its own base, so CI also runs this on every push to
// main: that run is the one that sees both files.
//
// Usage: node scripts/check-adr-numbers.mjs [dir]

import { readdirSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const ADR_DIR = 'docs/adr'

// Pairs that merged before this check existed. Renumbering either would break
// every "ADR-0029" reference in the repository and in closed PRs, so the pair stays.
export const ALLOWED_DUPLICATES = new Map([
  [
    '0029',
    [
      '0029-measure-before-expanding-agent-automation.md',
      '0029-position-birdbrain-for-civil-society-investigations.md'
    ]
  ]
])

export const findDuplicates = (names, allowed = ALLOWED_DUPLICATES) => {
  const byNumber = new Map()
  for (const name of names) {
    const match = /^(\d{4})-.+\.md$/.exec(name)
    if (!match) continue
    byNumber.set(match[1], [...(byNumber.get(match[1]) ?? []), name])
  }
  const duplicates = []
  for (const [number, files] of byNumber) {
    if (files.length < 2) continue
    const known = allowed.get(number) ?? []
    if (files.every((file) => known.includes(file))) continue
    duplicates.push({ number, files: files.sort() })
  }
  return duplicates.sort((a, b) => a.number.localeCompare(b.number))
}

const main = () => {
  const dir = process.argv[2] ?? ADR_DIR
  const duplicates = findDuplicates(readdirSync(dir))
  if (duplicates.length === 0) {
    console.log(`check-adr-numbers: every ADR in ${dir} has its own number`)
    return
  }
  for (const { number, files } of duplicates) {
    console.error(`check-adr-numbers: ADR ${number} is used by ${files.join(', ')}`)
  }
  console.error(
    'Renumber the ADR this branch adds to the next free number, then update its title line ' +
      'and every link to it.'
  )
  process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main()
