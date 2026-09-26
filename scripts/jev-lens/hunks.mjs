// Lens 2, the hunk demoter. For every blocking-tier file a PR touches, ask Jev whether the
// changed lines can alter an evidentiary result, and record the answers as the `jev/evidence-hunks`
// commit status on the head sha. Observe only: the status is always `success` and never required.
// Plan: docs/plans/2026-09-25-jev-shadow-lenses.md. Record: docs/adr/0031.
import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { loadIncludeList, matchEntry } from './backstop.mjs'
import { cap, createClient, mapPool, noul } from './lib/jev.mjs'

export const STATUS_CONTEXT = 'jev/evidence-hunks'
export const LIMITS = { maxHits: 40, maxChars: 14000, threshold: 0.1, concurrency: 6 }

// The Evidence-Affecting Change definition, CONTEXT.md "Assurance baseline".
export const DEFINITION =
  'An evidence-affecting change is a change to acquisition, parsing, extraction, storage, hashing, signing, trusted time, manifests, verification, redaction, export, reporting, AI analysis, or software distribution that can alter an evidentiary result or the interpretation of one. Birdbrain is a web-evidence capture tool: captures are hashed, chained in a signed manifest, timestamped, and exported as packages a third party verifies.'

export const QUESTION = {
  touches_evidence: noul(
    {
      definition: DEFINITION,
      question:
        'Do the changed lines in `diff` alter behaviour that can change an evidentiary result or its interpretation? Judge the changed lines, not the file they live in.'
    },
    {
      true: 'A changed line alters capture content, hashing, manifest, signing, timestamping, verification, redaction, export or report output.',
      false: 'The changed lines are cosmetic, UI wiring, comments, logging, tests, or a refactor that keeps evidence behaviour identical.'
    }
  )
}

// Per-file chunks of a unified diff: [{ path, text }].
export const splitDiff = (text) =>
  (text || '')
    .split(/^diff --git /m)
    .slice(1)
    .map((chunk) => ({ path: chunk.match(/^a\/(\S+) b\//)?.[1] || '?', text: `diff --git ${chunk}` }))

// Which files the lens asks about: blocking-tier hits, in diff order, up to the cap. Over the
// cap the lens stops rather than samples, and says so.
export function planHits(diffText, entries, limits = LIMITS) {
  const hits = []
  for (const file of splitDiff(diffText)) {
    const entry = matchEntry(entries, file.path)
    if (!entry || entry.tier !== 'blocking') continue
    hits.push({ path: file.path, entry: entry.path, text: cap(file.text, limits.maxChars), truncated: file.text.length > limits.maxChars })
  }
  return { hits: hits.slice(0, limits.maxHits), total: hits.length, over: hits.length > limits.maxHits }
}

export async function judge(hits, ask, limits = LIMITS) {
  return mapPool(hits, limits.concurrency, async (hit) => {
    const r = await ask({ path: hit.path, diff: hit.text }, QUESTION)
    const p = r.answers.touches_evidence.noul
    return { path: hit.path, entry: hit.entry, truncated: hit.truncated, p, incidental: p < limits.threshold }
  })
}

const short = (path) => path.split('/').pop()

// GitHub caps a status description at 140 characters.
export function describeStatus({ results, total, over }, limits = LIMITS) {
  if (!total) return 'no blocking-tier file changed'
  const incidental = results.filter((r) => r.incidental)
  const rest = results.filter((r) => !r.incidental)
  let s = `${total} blocking hit${total === 1 ? '' : 's'}`
  if (over) s += ` (${results.length} judged, cap ${limits.maxHits})`
  s += `; ${incidental.length} read incidental`
  if (incidental.length) s += ` (${incidental.map((r) => r.p.toFixed(2)).join(', ')})`
  for (const r of rest.sort((a, b) => b.p - a.p)) {
    const add = `; ${short(r.path)} ${r.p.toFixed(2)}`
    if (s.length + add.length > 139) {
      s += '; …'
      break
    }
    s += add
  }
  return s.slice(0, 140)
}

export function renderSummary({ results, total, over }, limits = LIMITS) {
  const lines = [`## ${STATUS_CONTEXT}`, '', `Threshold ${limits.threshold}: under it a hit reads incidental. Shadow only; nothing here gates.`, '']
  if (!total) return [...lines, 'No blocking-tier file changed.', ''].join('\n')
  if (over) lines.push(`${total} hits, ${results.length} judged (cap ${limits.maxHits}); the rest were not sent.`, '')
  lines.push('| File | Include-list entry | p(evidence) | Reads |', '| --- | --- | --- | --- |')
  for (const r of results) lines.push(`| \`${r.path}\`${r.truncated ? ' (truncated)' : ''} | \`${r.entry}\` | ${r.p.toFixed(2)} | ${r.incidental ? 'incidental' : 'evidence'} |`)
  return [...lines, ''].join('\n')
}

export async function run({ diffText, entries, ask, limits = LIMITS }) {
  const plan = planHits(diffText, entries, limits)
  const results = plan.hits.length ? await judge(plan.hits, ask, limits) : []
  return { results, total: plan.total, over: plan.over }
}

// Env in: GITHUB_REPOSITORY, PR_NUMBER, HEAD_SHA, GH_TOKEN, TYPESAFE_API_KEY, GITHUB_STEP_SUMMARY.
export async function main(deps = {}) {
  const env = deps.env || process.env
  const exec = deps.exec || ((cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 28 }))
  const log = deps.log || console.log
  if (!env.TYPESAFE_API_KEY) {
    log('TYPESAFE_API_KEY is not set; lens skipped')
    return 0
  }
  const repo = env.GITHUB_REPOSITORY
  const entries = deps.entries || loadIncludeList()
  const ask = deps.ask || createClient({ apiKey: env.TYPESAFE_API_KEY }).ask
  const diffText = exec('gh', ['pr', 'diff', env.PR_NUMBER, '--repo', repo])
  const outcome = await run({ diffText, entries, ask })
  const description = describeStatus(outcome)
  exec('gh', ['api', `repos/${repo}/statuses/${env.HEAD_SHA}`, '-f', 'state=success', '-f', `context=${STATUS_CONTEXT}`, '-f', `description=${description}`])
  const summary = renderSummary(outcome)
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, summary)
  log(description)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => process.exit(code), (e) => { console.error(e.message); process.exit(1) })
}
