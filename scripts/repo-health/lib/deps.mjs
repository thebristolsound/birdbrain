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

// A YAML comment: a `#` at the start of a line or after white space, to the end
// of the line.
const YAML_COMMENT = /(^|[ \t])#.*$/gm
// One key per dependency Dependabot is told to hold back. Counting the key, not
// the line it sits on, reads the block form and the flow form
// (`- { dependency-name: x }`, or several on one line) the same. A layout this
// misreads can only count high, never low.
const DEPENDENCY_NAME = /\bdependency-name\s*:/g

export const countDependabotEntries = (text) =>
  countMatches(text.replace(YAML_COMMENT, '$1'), DEPENDENCY_NAME)

const readExceptions = (ctx) => {
  try {
    return parseExceptions(JSON.parse(ctx.read(EXCEPTIONS_FILE)))
  } catch {
    throw new Unmeasured(`${EXCEPTIONS_FILE} could not be read as an exceptions list`)
  }
}

const readDependabot = (ctx) => {
  try {
    return ctx.read(DEPENDABOT_FILE)
  } catch {
    throw new Unmeasured(`${DEPENDABOT_FILE} could not be read`)
  }
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
