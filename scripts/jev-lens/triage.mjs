// Lens 1, triage routing. On an issue open or edit, ask Jev which triage label fits and whether
// the issue is process work, and record the answer as `lens:` labels. Dispatch never reads them:
// the frontier stays `ready-for-agent` and `queued` (ADR-0028). Observe only.
// Plan: docs/plans/2026-09-25-jev-shadow-lenses.md. Record: docs/adr/0031.
import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { cap, choice, createClient, noul } from './lib/jev.mjs'

export const LENS_LABELS = ['lens:agent', 'lens:human', 'lens:needs-info', 'lens:process']
// An issue a human has already routed is not re-judged; the lens is for the unrouted.
export const ROUTED_LABELS = ['ready-for-agent', 'ready-for-human', 'queued', 'wontfix']
export const PROCESS_THRESHOLD = 0.5
export const BODY_CAP = 7000

export const QUESTIONS = {
  route: choice('Which triage label fits this issue?', {
    'ready-for-agent':
      'Fully specified: acceptance criteria a reader could verify, a named way to prove the change works, the files or modules where work starts, and an explicit evidence-affecting call. An unattended coding agent could complete it.',
    'ready-for-human': 'Needs judgement, design, product decisions, credentials, external accounts, or discovery an unattended agent cannot do.',
    'needs-info': 'Cannot be worked until the reporter supplies missing facts.'
  }),
  process: noul('Is this issue about the agent pipeline itself (dispatch, review gates, ADRs, CI workflows, Vale, skills, agent instructions) rather than about the product a user runs?')
}

const ROUTE_TO_LABEL = { 'ready-for-agent': 'lens:agent', 'ready-for-human': 'lens:human', 'needs-info': 'lens:needs-info' }

export function shouldSkip(issue, machineLogin) {
  if (issue.pull_request) return 'is a pull request'
  if (machineLogin && issue.user?.login === machineLogin) return `filed by ${machineLogin}`
  const routed = (issue.labels || []).map((l) => l.name).find((n) => ROUTED_LABELS.includes(n))
  if (routed) return `already carries ${routed}`
  if (!issue.body?.trim()) return 'has no body'
  return null
}

export function lensLabelsFor(answers, threshold = PROCESS_THRESHOLD) {
  const labels = [ROUTE_TO_LABEL[answers.route.choice]]
  if (answers.process.noul >= threshold) labels.push('lens:process')
  return labels
}

// Replace every lens label with the new set; leave every other label alone.
export function labelPlan(current, next) {
  const have = new Set(current.filter((l) => LENS_LABELS.includes(l)))
  const want = new Set(next)
  return { add: [...want].filter((l) => !have.has(l)), remove: [...have].filter((l) => !want.has(l)) }
}

export function renderSummary(issue, answers, plan) {
  const probs = Object.entries(answers.route.probabilities).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(', ')
  return [
    `## Jev triage lens: #${issue.number}`, '',
    `Route: **${answers.route.choice}** (confidence ${answers.route.confidence.toFixed(2)}; ${probs})`,
    `Process: ${answers.process.noul.toFixed(2)}`,
    `Labels added: ${plan.add.join(', ') || 'none'}; removed: ${plan.remove.join(', ') || 'none'}`, '',
    'Shadow only: dispatch reads `ready-for-agent` and `queued`, never `lens:` labels.', ''
  ].join('\n')
}

// Env in: GITHUB_REPOSITORY, ISSUE_NUMBER, MACHINE_LOGIN, GH_TOKEN, TYPESAFE_API_KEY, GITHUB_STEP_SUMMARY.
export async function main(deps = {}) {
  const env = deps.env || process.env
  const exec = deps.exec || ((cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 26 }))
  const log = deps.log || console.log
  if (!env.TYPESAFE_API_KEY) {
    log('TYPESAFE_API_KEY is not set; lens skipped')
    return 0
  }
  const repo = env.GITHUB_REPOSITORY
  const issue = JSON.parse(exec('gh', ['api', `repos/${repo}/issues/${env.ISSUE_NUMBER}`]))
  const skip = shouldSkip(issue, env.MACHINE_LOGIN)
  if (skip) {
    log(`#${issue.number} ${skip}; lens skipped`)
    return 0
  }
  const ask = deps.ask || createClient({ apiKey: env.TYPESAFE_API_KEY }).ask
  const { answers } = await ask({ title: issue.title, body: cap(issue.body, BODY_CAP) }, QUESTIONS)
  const plan = labelPlan(issue.labels.map((l) => l.name), lensLabelsFor(answers))
  const args = ['issue', 'edit', String(issue.number), '--repo', repo]
  for (const l of plan.add) args.push('--add-label', l)
  for (const l of plan.remove) args.push('--remove-label', l)
  if (plan.add.length || plan.remove.length) exec('gh', args)
  const summary = renderSummary(issue, answers, plan)
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, summary)
  log(`#${issue.number}: ${answers.route.choice} (${answers.route.confidence.toFixed(2)}), process ${answers.process.noul.toFixed(2)}`)
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then((code) => process.exit(code), (e) => { console.error(e.message); process.exit(1) })
}
