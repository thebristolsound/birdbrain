// The measurement ADR-0031 asks for. Lens 1: issues carrying both a `lens:` label and a human
// triage label, agreement per pair. Lens 2: every `jev/evidence-hunks` status on agent PRs beside
// the evidence label the PR ended with, so a human can read where they disagree.
// Usage: node scripts/jev-lens/score.mjs [--json]
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { STATUS_CONTEXT } from './hunks.mjs'

const PAIRS = [
  ['lens:agent', 'ready-for-agent'],
  ['lens:human', 'ready-for-human'],
  ['lens:needs-info', 'needs-info'],
  ['lens:process', 'process']
]
const HUMAN_ROUTES = ['ready-for-agent', 'ready-for-human', 'needs-info']

// issues: [{ number, labels: [name] }]
export function triageAgreement(issues) {
  const routed = issues.filter((i) => i.labels.some((l) => HUMAN_ROUTES.includes(l)) && i.labels.some((l) => l.startsWith('lens:') && l !== 'lens:process'))
  const rows = PAIRS.map(([lens, human]) => {
    const pool = lens === 'lens:process' ? issues.filter((i) => i.labels.some((l) => l.startsWith('lens:'))) : routed
    const lensYes = pool.filter((i) => i.labels.includes(lens))
    const humanYes = pool.filter((i) => i.labels.includes(human))
    const both = lensYes.filter((i) => i.labels.includes(human))
    return { lens, human, lensSaid: lensYes.length, humanSaid: humanYes.length, both: both.length, precision: lensYes.length ? both.length / lensYes.length : null, recall: humanYes.length ? both.length / humanYes.length : null }
  })
  const agree = routed.filter((i) => PAIRS.slice(0, 3).some(([lens, human]) => i.labels.includes(lens) && i.labels.includes(human)))
  return { routed: routed.length, agreement: routed.length ? agree.length / routed.length : null, rows, disagreements: routed.filter((i) => !agree.includes(i)).map((i) => i.number) }
}

// prs: [{ number, labels: [name], status: description | null }]
export const hunkRows = (prs) =>
  prs.filter((p) => p.status).map((p) => ({ pr: p.number, evidenceLabel: p.labels.includes('evidence-affecting'), incidental: /(\d+) read incidental/.exec(p.status)?.[1] ?? '0', status: p.status }))

export function main(deps = {}) {
  const exec = deps.exec || ((cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 26 }))
  const log = deps.log || console.log
  const json = (deps.argv || process.argv.slice(2)).includes('--json')
  const repo = deps.repo || exec('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']).trim()
  const issues = JSON.parse(exec('gh', ['api', '--paginate', `repos/${repo}/issues?state=all&labels=&per_page=100`, '--jq', '[.[] | select(.pull_request | not) | {number, labels: [.labels[].name]}]']))
    .flat()
    .filter((i) => i.labels.some((l) => l.startsWith('lens:')))
  const prs = JSON.parse(exec('gh', ['pr', 'list', '--repo', repo, '--state', 'all', '--label', 'agent-authored', '--limit', '200', '--json', 'number,labels,headRefOid', '--jq', '[.[] | {number, sha: .headRefOid, labels: [.labels[].name]}]']))
  for (const p of prs) {
    const out = exec('gh', ['api', `repos/${repo}/commits/${p.sha}/status`, '--jq', `.statuses[] | select(.context=="${STATUS_CONTEXT}") | .description`]).trim()
    p.status = out || null
  }
  const report = { triage: triageAgreement(issues), hunks: hunkRows(prs) }
  log(json ? JSON.stringify(report, null, 1) : render(report))
  return 0
}

export const render = ({ triage, hunks }) =>
  [
    `Triage lens: ${triage.routed} issues routed by both; agreement ${triage.agreement == null ? '–' : `${(triage.agreement * 100).toFixed(0)}%`}`,
    ...triage.rows.map((r) => `  ${r.lens} vs ${r.human}: lens ${r.lensSaid}, human ${r.humanSaid}, both ${r.both}`),
    triage.disagreements.length ? `  disagreements: ${triage.disagreements.map((n) => `#${n}`).join(' ')}` : '',
    `Hunk lens: ${hunks.length} agent PRs with a status`,
    ...hunks.map((h) => `  #${h.pr} ${h.evidenceLabel ? 'evidence-affecting' : 'unlabelled'} — ${h.status}`)
  ].filter(Boolean).join('\n')

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main())
}
