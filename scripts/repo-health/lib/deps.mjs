// Dependency hygiene signals read from the tree: decisions that were deferred,
// deferrals about to run out, and dependencies nothing imports.
//
// A live `pnpm audit` is not here: the Security workflow already fails on an
// advisory that has no exception, on every push to main and every pull request.

import { EXPIRY_WARNING_DAYS, parseExceptions, parseIsoDay } from '../../audit-check.mjs'
import { countIssues } from './knip.mjs'
import { Unmeasured } from './unmeasured.mjs'
import { countMatches } from './tree.mjs'

const BUDGET_SOURCE = 'the value at f2bd1b03 on 2026-11-24, so any growth shows'

const EXCEPTIONS_FILE = 'audit-exceptions.json'
const DEPENDABOT_FILE = '.github/dependabot.yml'
const DAY_MS = 24 * 60 * 60 * 1000

// A line with its YAML comment removed: a `#` at the start of the line or after
// white space, outside a quoted value, to the end of the line.
const stripYamlComment = (line) => {
  let quote = null
  for (let at = 0; at < line.length; at += 1) {
    const char = line[at]
    if (quote === '"' && char === '\\') at += 1
    else if (quote !== null) {
      if (char === quote) quote = null
    } else if ((char === '"' || char === "'") && (at === 0 || /[\s[{,]/.test(line[at - 1]))) {
      quote = char
    } else if (char === '#' && (at === 0 || /[ \t]/.test(line[at - 1]))) {
      return line.slice(0, at)
    }
  }
  return line
}

const IGNORE_KEY = /^(\s*(?:-\s+)?)(["']?)ignore\2\s*:(.*)$/
// One key per dependency Dependabot is told to hold back, quoted or not. Counting
// the key, not the line it sits on, reads the block form and the flow form
// (`- { dependency-name: x }`, or several on one line) the same.
const DEPENDENCY_NAME = /(?:^|[\s{,])(["']?)dependency-name\1\s*:/g
const indentOf = (line) => line.length - line.trimStart().length

// Counts the entries under every `ignore:` key. An `allow:` list also names
// dependencies, but those are ones Dependabot is told to update.
export const countDependabotEntries = (text) => {
  const lines = text.split('\n').map(stripYamlComment)
  let count = 0
  let at = 0
  while (at < lines.length) {
    const key = IGNORE_KEY.exec(lines[at])
    at += 1
    if (!key) continue
    const column = key[1].length
    const section = [key[3]]
    for (; at < lines.length; at += 1) {
      const line = lines[at]
      if (line.trim() === '') continue
      const indent = indentOf(line)
      if (indent < column || (indent === column && !line.trimStart().startsWith('-'))) break
      section.push(line)
    }
    count += countMatches(section.join('\n'), DEPENDENCY_NAME)
  }
  return count
}

// A file with no `version` or `updates` key, such as an empty or comment-only one,
// is not a configuration with no ignores.
const TOP_LEVEL_KEYS = [/^version\s*:/m, /^updates\s*:/m]

const readExceptions = (ctx) => {
  try {
    return parseExceptions(JSON.parse(ctx.read(EXCEPTIONS_FILE)))
  } catch {
    throw new Unmeasured(`${EXCEPTIONS_FILE} could not be read as an exceptions list`)
  }
}

const readDependabot = (ctx) => {
  let text
  try {
    text = ctx.read(DEPENDABOT_FILE)
  } catch {
    throw new Unmeasured(`${DEPENDABOT_FILE} could not be read`)
  }
  const code = text.split('\n').map(stripYamlComment).join('\n')
  if (!TOP_LEVEL_KEYS.every((key) => key.test(code))) {
    throw new Unmeasured(`${DEPENDABOT_FILE} is missing its \`version\` or \`updates\` key`)
  }
  return text
}

// Days from `today` to each exception's expiry; negative once it has passed.
export const daysToExpiry = (exceptions, today) => {
  const todayMs = parseIsoDay(today)
  if (todayMs === null) throw new Unmeasured('the run date is not a calendar day')
  return exceptions.map((entry) => Math.round((parseIsoDay(entry.expires) - todayMs) / DAY_MS))
}

export const DEPENDENCY_SIGNALS = [
  {
    id: 'deferred-dependency-decisions',
    family: 'dependencies',
    label: 'Deferred dependency decisions',
    unit: 'count',
    better: 'lower',
    budget: 9,
    why: BUDGET_SOURCE,
    needs: 'tree',
    measure: (ctx) => {
      const exceptions = readExceptions(ctx).length
      const ignores = countDependabotEntries(readDependabot(ctx))
      return {
        value: exceptions + ignores,
        note: `${exceptions} audit exception(s) and ${ignores} Dependabot ignore(s)`
      }
    }
  },
  {
    id: 'audit-exceptions-expiring',
    family: 'dependencies',
    label: `Audit exceptions expired or within ${EXPIRY_WARNING_DAYS} days of expiry`,
    unit: 'count',
    better: 'lower',
    budget: 0,
    why: 'an exception past its date fails the Security workflow on an unrelated change',
    needs: 'tree',
    measure: (ctx) => {
      const days = daysToExpiry(readExceptions(ctx), ctx.today)
      const value = days.filter((left) => left <= EXPIRY_WARNING_DAYS).length
      const nearest = days.length === 0 ? null : Math.min(...days)
      return {
        value,
        note: nearest === null ? null : `the nearest expiry is ${nearest} day(s) away`
      }
    }
  },
  {
    id: 'unused-dependencies',
    family: 'dependencies',
    label: 'Unused dependencies (knip)',
    unit: 'count',
    better: 'lower',
    budget: 2,
    why: BUDGET_SOURCE,
    needs: 'install',
    measure: (ctx) => ({ value: countIssues(ctx.knip(), ['dependencies', 'devDependencies']) })
  }
]
