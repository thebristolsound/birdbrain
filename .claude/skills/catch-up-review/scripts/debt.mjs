#!/usr/bin/env node
// Lists the override merges that still owe a catch-up review, and sums what the reviews
// already done found and cost.
// Usage: debt.mjs [--json]
// Exits 0 whatever it lists: the list is a report and blocks nothing. Exits 2 when GitHub
// cannot be read, so a failed read never prints an empty list.
import { pathToFileURL } from 'node:url'
import { createGh } from '../../../../scripts/repo-health/lib/gh.mjs'

const API = 'repos/{owner}/{repo}'
const PAGE = 100
// GitHub lists at most this many files for one pull request.
const FILE_LIST_LIMIT = 3000
const OVERRIDE_LABEL = 'break-glass'
// Dependency updates this account opens are outside the scope, whatever they change.
const DEPENDENCY_BOT = 'dependabot[bot]'
// One reviewer per model family, and the second fresh Claude reviewer a trial run adds as its
// control. A record names all three, with zeros where a reviewer did not run.
const SLOTS = ['claude', 'codex', 'control']
// A review by one family alone leaves the merge owed, so a record clears a merge only when
// it counts a reviewer in each of these.
const REQUIRED_SLOTS = ['claude', 'codex']

// A merge qualifies when it changed shipped source, a workflow, or a script kept beside the
// workflows. Scripts elsewhere and the dependency files are outside the scope, although some
// run with a token.
export const QUALIFYING_AREAS = ['src/', 'extension/', '.github/workflows/', '.github/scripts/']

export const RECORD_FIRST_LINE = 'Catch-up record'
const BLOCK = /<!-- catch-up-review:record (\{.*?\}) -->/s

// The areas a merge changed, or the one reason it qualifies unread. A rename counts on both
// sides, so moving a file out of an area does not hide the change.
export function areasOf(files) {
  if (files.length >= FILE_LIST_LIMIT) return [`file list cut at ${FILE_LIST_LIMIT}`]
  const paths = files.flatMap(({ filename, previous_filename: before }) =>
    before ? [filename, before] : [filename]
  )
  return QUALIFYING_AREAS.filter((area) => paths.some((path) => path.startsWith(area)))
}

const RUN_DATE = /^\d{4}-\d{2}-\d{2}$/
const isCount = (value) => Number.isInteger(value) && value >= 0
// A review always costs something, so a measured cost is above zero and an unmeasured one is
// null. A zero is a guess.
const isCostOrUnknown = (value) => value === null || (Number.isInteger(value) && value > 0)
const perSlot = (value) => Boolean(value) && SLOTS.every((slot) => isCount(value[slot]))
const within = (inner, outer) => SLOTS.every((slot) => inner[slot] <= outer[slot])
const sumOf = (value) => SLOTS.reduce((total, slot) => total + value[slot], 0)
// The skill files at most this many defects for one merge (ADR-0028).
const FILING_CAP = 2

// The counts for the whole merge agree with the counts for each reviewer: a defect is
// reproduced only through some reviewer's candidate, and only a reproduced defect is filed.
const totalsAgree = ({ confirmed, alone, reproduced, filed }) =>
  reproduced <= sumOf(confirmed) &&
  (reproduced > 0 || sumOf(confirmed) === 0) &&
  sumOf(alone) <= reproduced &&
  filed <= reproduced &&
  filed <= FILING_CAP

// A record's numbers, or null when the block is absent, any field is missing or malformed, or
// the counts contradict each other. Tokens and minutes may be null, which reads as unknown and
// is never summed as zero.
export function numbersOf(body) {
  const match = BLOCK.exec(body)
  if (!match) return null
  let block
  try {
    block = JSON.parse(match[1])
  } catch {
    return null
  }
  const { v, run, reviewers, blocking, confirmed, alone, other, reproduced, filed } = block
  const { private: privately, tokens, minutes } = block
  const valid =
    v === 1 &&
    typeof run === 'string' &&
    RUN_DATE.test(run) &&
    [reviewers, blocking, confirmed, alone, other].every(perSlot) &&
    within(confirmed, blocking) &&
    within(alone, confirmed) &&
    [reproduced, filed, privately].every(isCount) &&
    totalsAgree(block) &&
    [tokens, minutes].every(isCostOrUnknown)
  if (!valid) return null
  return {
    run,
    reviewers,
    blocking,
    confirmed,
    alone,
    other,
    reproduced,
    filed,
    private: privately,
    tokens,
    minutes
  }
}

// The comment's first line once the disclosure that opens a comment posted under the
// maintainer's account is dropped, in either form: the one-line note or the two-line alert.
export function firstLineOf(body) {
  const lines = body.replace(/\r\n/g, '\n').split('\n')
  if (/^> \[!NOTE\]/.test(lines[0])) lines.splice(0, 2)
  else if (/^> <sub>\*\*Written by /.test(lines[0])) lines.splice(0, 1)
  return lines.find((line) => line.trim() !== '') ?? ''
}

// The state of one merge's record: the last comment from the maintainer's account whose
// first line names a catch-up record decides. A record whose numbers do not read is
// malformed, and one that counts no reviewer from a required family is incomplete. Either
// way the merge still owes its review.
export function recordOf(comments, maintainer) {
  const records = comments.filter(
    ({ user, body }) =>
      user?.login === maintainer && firstLineOf(body ?? '').startsWith(RECORD_FIRST_LINE)
  )
  const last = records.at(-1)
  if (!last) return { state: 'none' }
  const url = last.html_url
  const numbers = numbersOf(last.body)
  if (!numbers) return { state: 'malformed', url }
  const missing = REQUIRED_SLOTS.filter((slot) => numbers.reviewers[slot] === 0)
  if (missing.length > 0) return { state: 'incomplete', missing, url }
  return { state: 'recorded', numbers, url }
}

const sumKnown = (values) => {
  const known = values.filter((value) => value !== null)
  return {
    sum: known.reduce((total, value) => total + value, 0),
    unknown: values.length - known.length
  }
}

// One entry per run, oldest first. Records that carry the same run date are one run.
const runsOf = (numbers) => {
  const runs = new Map()
  for (const { run, filed } of numbers) {
    const { merges, filed: sum } = runs.get(run) ?? { merges: 0, filed: 0 }
    runs.set(run, { run, merges: merges + 1, filed: sum + filed })
  }
  return [...runs.values()].sort((a, b) => a.run.localeCompare(b.run))
}

// A reviewer's sole finds are compared only across merges every slot reviewed: on a merge
// with no control reviewer, the control had no chance to raise what another reviewer found.
const matchedOf = (numbers) => {
  const matched = numbers.filter(({ reviewers }) => SLOTS.every((slot) => reviewers[slot] > 0))
  const alone = Object.fromEntries(
    SLOTS.map((slot) => [slot, matched.reduce((total, entry) => total + entry.alone[slot], 0)])
  )
  return { merges: matched.length, alone }
}

export function totalsOf(recorded) {
  const numbers = recorded.map(({ record }) => record.numbers)
  const count = (pick) => numbers.reduce((total, entry) => total + pick(entry), 0)
  const slots = (field) =>
    Object.fromEntries(SLOTS.map((slot) => [slot, count((entry) => entry[field][slot])]))
  return {
    merges: numbers.length,
    runs: runsOf(numbers),
    reviewers: slots('reviewers'),
    blocking: slots('blocking'),
    confirmed: slots('confirmed'),
    matched: matchedOf(numbers),
    other: slots('other'),
    reproduced: count((entry) => entry.reproduced),
    filed: count((entry) => entry.filed),
    private: count((entry) => entry.private),
    tokens: sumKnown(numbers.map((entry) => entry.tokens)),
    minutes: sumKnown(numbers.map((entry) => entry.minutes))
  }
}

// Every page of a list endpoint. A page that is not a list is a failed read.
function pagesOf(gh, endpoint) {
  const join = endpoint.includes('?') ? '&' : '?'
  const items = []
  for (let page = 1; ; page++) {
    const batch = gh([`${endpoint}${join}per_page=${PAGE}&page=${page}`])
    if (!Array.isArray(batch)) throw new Error(`${endpoint} did not answer with a list`)
    items.push(...batch)
    if (batch.length < PAGE) return items
  }
}

// The label-filtered list reads GitHub's search index, which lags a label change by
// seconds. That is close enough for a report read before a release.
export function collect(gh) {
  const maintainer = gh([API]).owner.login
  // A pull request with no merge date at all is a read that lost a field, which is not the
  // same as one closed without merging.
  const merged = pagesOf(gh, `${API}/issues?state=closed&labels=${OVERRIDE_LABEL}`).filter(
    ({ number, pull_request: pull }) => {
      if (!pull) return false
      if (pull.merged_at === undefined) throw new Error(`#${number} has no merge date field`)
      return pull.merged_at !== null
    }
  )
  const merges = merged
    .map(({ number, title, user, pull_request: pull }) => {
      const base = { number, title, mergedAt: pull.merged_at }
      if (user?.login === DEPENDENCY_BOT) return { ...base, areas: [] }
      const areas = areasOf(pagesOf(gh, `${API}/pulls/${number}/files`))
      if (areas.length === 0) return { ...base, areas }
      const comments = pagesOf(gh, `${API}/issues/${number}/comments`)
      return { ...base, areas, record: recordOf(comments, maintainer) }
    })
    .sort((a, b) => a.mergedAt.localeCompare(b.mergedAt))
  const qualifying = merges.filter(({ areas }) => areas.length > 0)
  const recorded = qualifying.filter(({ record }) => record.state === 'recorded')
  return {
    owed: qualifying.filter(({ record }) => record.state !== 'recorded'),
    recorded,
    outOfScope: merges.filter(({ areas }) => areas.length === 0),
    totals: totalsOf(recorded)
  }
}

const withUnknown = ({ sum, unknown }, unit) =>
  `${sum.toLocaleString('en-US')} ${unit}${unknown ? ` (${unknown} unknown)` : ''}`

// Why a merge that carries a record is still owed.
const flagOf = ({ state, missing, url }) => {
  if (state === 'malformed') return `  [record unreadable: ${url}]`
  if (state === 'incomplete') return `  [record counts no ${missing.join(' or ')} reviewer: ${url}]`
  return ''
}

const rowOf = ({ number, mergedAt, title, areas }) =>
  `  #${number}  ${mergedAt.slice(0, 10)}  ${title}  (${areas.join(', ')})`

export function render({ owed, recorded, outOfScope, totals }) {
  const lines = [`Override merges that owe a catch-up review: ${owed.length}`]
  for (const merge of owed) lines.push(`${rowOf(merge)}${flagOf(merge.record)}`)
  lines.push(`Reviewed: ${recorded.length}`)
  for (const merge of recorded) lines.push(`${rowOf(merge)}  [run ${merge.record.numbers.run}]`)
  if (recorded.length > 0) {
    const each = (field) => SLOTS.map((slot) => `${totals[field][slot]} ${slot}`).join(', ')
    const alone = SLOTS.map((slot) => `${totals.matched.alone[slot]} ${slot}`).join(', ')
    const runs = totals.runs.map(
      ({ run, merges, filed }) =>
        `${run} (${merges} ${merges === 1 ? 'merge' : 'merges'}, ${filed} filed)`
    )
    lines.push(
      `  runs: ${runs.join(', ')}`,
      `  reviewers: ${each('reviewers')}`,
      `  blocking candidates: ${each('blocking')}`,
      `  of those reproduced: ${each('confirmed')}`,
      `  reproduced by one reviewer alone (${totals.matched.merges} merges all three read): ${alone}`,
      `  other candidates: ${each('other')}`,
      `  defects reproduced: ${totals.reproduced}, filed: ${totals.filed}, reported privately: ${totals.private}`,
      `  cost: ${withUnknown(totals.tokens, 'tokens')}, ${withUnknown(totals.minutes, 'minutes')}`
    )
  }
  lines.push(`Override merges outside the scope: ${outOfScope.length}`)
  return lines.join('\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  if (args.some((arg) => arg !== '--json')) {
    console.error('usage: debt.mjs [--json]')
    process.exit(2)
  }
  try {
    const report = collect(createGh())
    console.log(args.includes('--json') ? JSON.stringify(report, null, 2) : render(report))
  } catch (error) {
    console.error(`debt: ${error.message}`)
    process.exit(2)
  }
}
