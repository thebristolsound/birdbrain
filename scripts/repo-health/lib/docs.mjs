// Docs hygiene signals: the two agent instruction files, the status line every
// plan is meant to carry, and relative links that point at nothing.
//
// A check for stale version mentions in prose ("the repo pins Node 20") is not
// here: a prose pattern with an allowlist reads zero forever after one cleanup.

import { posix } from 'node:path'
import { compareDocuments, LEFT, RIGHT } from '../../lint-agents-md.mjs'
import { Unmeasured } from './unmeasured.mjs'

const BUDGET_SOURCE = 'the value at f2bd1b03 on 2026-11-24, so any growth shows'

const PLAN = /^docs\/plans\/[^/]+\.md$/
// docs/README.md, "Conventions": the four values a plan's status line may open with.
export const PLAN_STATUSES = ['active', 'done', 'parked', 'abandoned']
const STATUS_LINE = /^\*\*Status:\*\*[ \t]*(.*)$/m

// Superseded documents and imported design bundles keep the links they had.
const LINK_EXCLUDED = ['docs/archive/', 'docs/design-handoff/']
const FENCE = /^\s*(`{3,}|~{3,})/
const INLINE_CODE = /`[^`\n]*`/g
// [text](target) and ![alt](target). The target is bare or wrapped in <...>,
// which is how Markdown writes one with a space in it, and may carry a title.
const LINK = /\[(?:[^\]\\]|\\.)*\]\(\s*(?:<([^>\n]+)>|([^)\s]+))(?:\s+"[^"]*")?\s*\)/g
const SCHEME = /^[a-z][a-z0-9+.-]*:/i

// The first word of a plan's status line, lower-cased, or null without the line.
export const planStatus = (text) => {
  const match = STATUS_LINE.exec(text)
  if (!match) return null
  return (/^[a-z]+/i.exec(match[1].trim())?.[0] ?? '').toLowerCase()
}

// Link targets in prose: fenced blocks and inline code are examples, not links.
// A fence closes only on a run of its own character at least as long as the one
// that opened it, with nothing after it, so a shorter fence shown inside stays
// inside.
export const linkTargets = (text) => {
  const targets = []
  let fence = null
  for (const line of text.split('\n')) {
    const run = FENCE.exec(line)
    if (fence === null) {
      if (run) {
        fence = run[1]
        continue
      }
    } else {
      const closes =
        run !== null &&
        run[1][0] === fence[0] &&
        run[1].length >= fence.length &&
        line.slice(run[0].length).trim() === ''
      if (closes) fence = null
      continue
    }
    for (const match of line.replace(INLINE_CODE, '').matchAll(LINK)) {
      targets.push(match[1] ?? match[2])
    }
  }
  return targets
}

// The tracked path a relative link points at, or null for a link this check does
// not judge: another site, a mail address, or an anchor on the same page.
export const resolveLink = (from, target) => {
  if (SCHEME.test(target) || target.startsWith('#') || target.startsWith('//')) return null
  const bare = target.split('#')[0].split('?')[0]
  if (bare === '') return null
  let decoded
  try {
    decoded = decodeURIComponent(bare)
  } catch {
    decoded = bare
  }
  const joined = decoded.startsWith('/')
    ? decoded.slice(1)
    : posix.join(posix.dirname(from), decoded)
  return posix.normalize(joined).replace(/\/$/, '')
}

const isLinkSource = (path) =>
  path.endsWith('.md') &&
  (!path.includes('/') || path.startsWith('docs/')) &&
  !LINK_EXCLUDED.some((prefix) => path.startsWith(prefix))

export const brokenLinks = (ctx) => {
  const sources = ctx.paths.filter(isLinkSource)
  if (sources.length === 0) throw new Unmeasured('no Markdown files were found to scan')
  // Every tracked file, and every folder that holds one: a link may point at either.
  const known = new Set(['.'])
  for (const path of ctx.paths) {
    known.add(path)
    for (let slash = path.indexOf('/'); slash !== -1; slash = path.indexOf('/', slash + 1)) {
      known.add(path.slice(0, slash))
    }
  }
  const broken = []
  for (const from of sources) {
    for (const target of linkTargets(ctx.read(from))) {
      const path = resolveLink(from, target)
      if (path !== null && !known.has(path)) broken.push({ from, target })
    }
  }
  return broken
}

export const DOCS_SIGNALS = [
  {
    id: 'agent-instruction-drift',
    family: 'docs',
    label: `Lines that differ between \`${LEFT}\` and \`${RIGHT}\``,
    unit: 'count',
    better: 'lower',
    budget: 0,
    why: 'the two files are one document served to two readers',
    needs: 'tree',
    measure: (ctx) => {
      let left, right
      try {
        left = ctx.read(LEFT)
        right = ctx.read(RIGHT)
      } catch {
        throw new Unmeasured(`${LEFT} or ${RIGHT} could not be read`)
      }
      // An empty file holds no instructions, and two of them would read as matching.
      for (const [name, text] of [
        [LEFT, left],
        [RIGHT, right]
      ]) {
        if (text.trim() === '') throw new Unmeasured(`${name} is empty`)
      }
      const { onlyInLeft, onlyInRight } = compareDocuments(left, right)
      return { value: onlyInLeft.length + onlyInRight.length }
    }
  },
  {
    id: 'plans-without-status',
    family: 'docs',
    label: 'Plans without a documented status',
    unit: 'count',
    better: 'lower',
    budget: 74,
    why: BUDGET_SOURCE,
    needs: 'tree',
    measure: (ctx) => {
      const plans = ctx.paths.filter((path) => PLAN.test(path))
      if (plans.length === 0) throw new Unmeasured('no plans were found under docs/plans/')
      const value = plans.filter(
        (path) => !PLAN_STATUSES.includes(planStatus(ctx.read(path)))
      ).length
      return { value, note: `of ${plans.length} plan(s)` }
    }
  },
  {
    id: 'broken-relative-links',
    family: 'docs',
    label: 'Broken relative links in `docs/` and root Markdown',
    unit: 'count',
    better: 'lower',
    budget: 2,
    why: BUDGET_SOURCE,
    needs: 'tree',
    measure: (ctx) => {
      const broken = brokenLinks(ctx)
      const first = broken[0]
      return {
        value: broken.length,
        note: first ? `for example \`${first.target}\` in \`${first.from}\`` : null
      }
    }
  }
]
