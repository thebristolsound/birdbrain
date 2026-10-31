#!/usr/bin/env node
// The next-action label (docs/specs/2026-10-30-pr-next-action-labels-design.md).
// Usage: next.mjs [--dry-run] <owner/repo> [pr...]   label the PRs named, or every open PR
//        next.mjs --clear <owner/repo> <pr>             take the label off a closed PR
// --dry-run prints each decision and writes nothing.
// Writes with the GH_TOKEN in the environment. Exits 1 when any PR could not be labelled.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  approvalStamp,
  closedIssues,
  decide as gate,
  effectiveReview,
  maintainerOf,
  trustedPrepass
} from '../merge/gate.mjs'

const MAINTAINER_RED = 'b60205'
const WAIT_GREY = 'cfd3d7'
export const LABELS = {
  review: [
    'next: review',
    MAINTAINER_RED,
    'Maintainer: review this PR yourself; the next-action status says why'
  ],
  approve: [
    'next: approve',
    MAINTAINER_RED,
    'Maintainer: sign off at head with an approving review or the approved label'
  ],
  merge: ['next: merge', '0e8a16', 'Maintainer: everything is green; apply the merge label'],
  unstick: [
    'next: unstick',
    MAINTAINER_RED,
    'Maintainer: merge was requested but the PR is not merging; the next-action status says why'
  ],
  fix: [
    'next: fix',
    'd93f0b',
    'Author: a required check failed, main conflicts, or a review asked for changes'
  ],
  wait: [
    'next: wait',
    WAIT_GREY,
    'Nobody: checks, the pre-pass or a scheduled review are still running'
  ],
  merging: [
    'next: merging',
    WAIT_GREY,
    'Nobody: auto-merge is on and GitHub merges when the checks finish'
  ]
}
const NAMES = Object.values(LABELS).map(([name]) => name)
const STATUS_CONTEXT = 'next-action'
const MERGE_GATE = 'merge-gate'
const REVIEW_STATES = [
  'review:passed',
  'review:changes',
  'review:stale',
  'review:failed',
  'review:skipped'
]
// The scheduled review takes a maintainer PR after its first hour, four a day; past this age a
// PR it has not reached is the maintainer's to read.
const REVIEW_DUE_HOURS = 6

const PASSED = ['SUCCESS', 'SKIPPED', 'NEUTRAL']
const PENDING_STATES = ['PENDING', 'EXPECTED']

// The newest result per check name. A check that ran several times on one commit (merge-gate
// runs on every label event) is judged by its latest run; `staleRed` lists the names whose
// older runs are red while the latest is not, since GitHub can keep blocking on those.
export function latestChecks(rollup) {
  const runs = new Map()
  const results = new Map()
  for (const c of rollup) {
    if (c.__typename === 'StatusContext') {
      results.set(
        c.context,
        PENDING_STATES.includes(c.state) ? 'pending' : c.state === 'SUCCESS' ? 'pass' : 'fail'
      )
      continue
    }
    const result =
      c.status !== 'COMPLETED' ? 'pending' : PASSED.includes(c.conclusion) ? 'pass' : 'fail'
    const list = runs.get(c.name) ?? []
    // A queued run has no start time yet, and it is the newest run of its name.
    list.push({ at: c.startedAt ?? '9999', result })
    runs.set(c.name, list)
  }
  const staleRed = []
  for (const [name, list] of runs) {
    list.sort((a, b) => a.at.localeCompare(b.at))
    const latest = list[list.length - 1].result
    results.set(name, latest)
    if (latest !== 'fail' && list.some((r) => r.result === 'fail')) staleRed.push(name)
  }
  return { results, staleRed }
}

const list = (names) => names.join(', ')
const answer = (key, reason) => ({ label: LABELS[key][0], reason })

// First match wins. `f.gate` is merge-gate's verdict on the same facts.
export function decideNext(f) {
  const requiredOther = f.required.filter((name) => name !== MERGE_GATE)
  const failed = requiredOther.filter((name) => f.checks.results.get(name) === 'fail')
  const pending = requiredOther.filter(
    (name) => (f.checks.results.get(name) ?? 'pending') === 'pending'
  )
  const missing = requiredOther.filter((name) => !f.checks.results.has(name))
  const fromMachine = f.gate.agent && f.author === f.machine
  const reviewState = REVIEW_STATES.find((l) => f.labels.includes(l))
  const review = effectiveReview(f.reviews, f.maintainer)

  // GitHub's list already marks a draft, so it carries no next label.
  if (f.draft) return { label: null, reason: 'draft' }
  if (failed.length) return answer('fix', `${list(failed)} failed`)
  if (f.mergeState === 'DIRTY') return answer('fix', 'merge conflict with main')
  if (fromMachine && ['failure', 'error'].includes(f.prepass))
    return answer('fix', 'the reviewer pre-pass asked for changes')
  if (review?.state === 'CHANGES_REQUESTED')
    return answer('fix', `${f.maintainer} requested changes`)
  if (reviewState === 'review:changes')
    return answer('fix', 'the scheduled review found a blocking issue; see its verdict comment')
  if (f.crossRepo && missing.length)
    return answer('review', `outside PR whose checks have not started; approve its workflow runs`)
  if (pending.length) return answer('wait', `waiting on ${list(pending)}`)
  if (fromMachine && f.prepass !== 'success')
    return answer('wait', 'waiting on the reviewer pre-pass')
  if (f.labels.includes('review:requested') || reviewState === 'review:stale')
    return answer('wait', 'a scheduled review is queued')
  const ownPr = f.author === f.maintainer && !f.crossRepo && !f.labels.includes('agent-pr')
  if (ownPr && !reviewState && f.ageHours < REVIEW_DUE_HOURS)
    return answer('wait', 'the scheduled review has not reached it yet')
  if ((f.gate.evidence || f.gate.credential) && !f.gate.signedOff) {
    const what = f.gate.evidence ? 'evidence-affecting' : 'changes release-credential paths'
    return answer('approve', `${what}; needs your sign-off at ${f.headSha.slice(0, 7)}`)
  }
  if (!ownPr && !fromMachine && !f.gate.signedOff)
    return answer('review', `opened by ${f.author}; nobody has approved it at head`)
  if (reviewState === 'review:failed')
    return answer('review', 'the scheduled review ended without a verdict')
  if (ownPr && !reviewState) return answer('review', 'no scheduled review has run')
  if (!f.mergeLabel) return answer('merge', 'everything is green; apply the merge label')
  if (!f.autoMerge)
    return answer('unstick', 'merge requested but auto-merge is off; read the Merge on label run')
  if (f.checks.staleRed.includes(MERGE_GATE))
    return answer('unstick', 'an older red merge-gate run still blocks; re-run it')
  if (f.mergeState === 'BLOCKED')
    return answer('unstick', 'merge requested and green, but GitHub reports it blocked')
  return answer('merging', 'auto-merge is on')
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8' })
}

function api(path) {
  return JSON.parse(gh(['api', '--paginate', '--slurp', path])).flat()
}

const labelPath = (name) => encodeURIComponent(name)

function ensureLabels(repo) {
  const existing = new Set(api(`repos/${repo}/labels?per_page=100`).map((l) => l.name))
  for (const [name, color, description] of Object.values(LABELS)) {
    if (existing.has(name)) continue
    gh([
      'api',
      '-X',
      'POST',
      `repos/${repo}/labels`,
      '-f',
      `name=${name}`,
      '-f',
      `color=${color}`,
      '-f',
      `description=${description}`
    ])
    console.log(`created label ${name}`)
  }
}

// Remove every next label but `want`, then add `want` if it is missing. Writes nothing when the
// PR already carries exactly the right label.
function setLabel(repo, n, current, want) {
  for (const name of current.filter((l) => NAMES.includes(l) && l !== want)) {
    gh(['api', '-X', 'DELETE', `repos/${repo}/issues/${n}/labels/${labelPath(name)}`])
  }
  if (want && !current.includes(want)) {
    gh(['api', '-X', 'POST', `repos/${repo}/issues/${n}/labels`, '-f', `labels[]=${want}`])
  }
}

function readFacts(repo, n, ctx) {
  const pr = JSON.parse(
    gh([
      'pr',
      'view',
      String(n),
      '-R',
      repo,
      '--json',
      'state,isDraft,author,labels,headRefOid,mergeStateStatus,autoMergeRequest,createdAt,body,reviews,statusCheckRollup,isCrossRepository'
    ])
  )
  const headSha = pr.headRefOid
  const labels = pr.labels.map((l) => l.name)
  const author = pr.author?.login
  const statuses = api(`repos/${repo}/commits/${headSha}/statuses?per_page=100`)
  // Only a PR someone else opened can trip the credential rule, so only it needs the file list.
  const files =
    author === ctx.maintainer
      ? []
      : api(`repos/${repo}/pulls/${n}/files?per_page=100`).flatMap((file) =>
          file.previous_filename ? [file.filename, file.previous_filename] : [file.filename]
        )
  const gateFacts = {
    headSha,
    author,
    machine: ctx.machine,
    files,
    labels,
    maintainer: ctx.maintainer,
    issueEvidence: closedIssues(pr.body).filter((i) =>
      api(`repos/${repo}/issues/${i}/labels`).some((l) => l.name === 'evidence-affecting')
    ),
    prepass: trustedPrepass(statuses, [ctx.maintainer, ctx.machine]),
    approvalStamp: approvalStamp(statuses),
    reviews: pr.reviews.map((r) => ({
      state: r.state,
      user: r.author?.login,
      commit: r.commit?.oid
    }))
  }
  return {
    ...gateFacts,
    open: pr.state === 'OPEN',
    draft: pr.isDraft,
    crossRepo: pr.isCrossRepository,
    mergeLabel: labels.includes('merge'),
    autoMerge: pr.autoMergeRequest != null,
    mergeState: pr.mergeStateStatus,
    ageHours: (Date.now() - Date.parse(pr.createdAt)) / 36e5,
    required: ctx.required,
    checks: latestChecks(pr.statusCheckRollup),
    gate: gate(gateFacts),
    currentStatus: statuses.find((s) => s.context === STATUS_CONTEXT)?.description ?? null
  }
}

function label(repo, n, ctx) {
  const f = readFacts(repo, n, ctx)
  if (ctx.dryRun) {
    const { label: want, reason } = f.open ? decideNext(f) : { label: null, reason: 'closed' }
    console.log(`#${n}: ${want ?? '(no label)'}: ${reason}`)
    return
  }
  if (!f.open) {
    setLabel(repo, n, f.labels, null)
    console.log(`#${n}: closed; next label cleared`)
    return
  }
  const { label: want, reason } = decideNext(f)
  setLabel(repo, n, f.labels, want)
  if (!want) {
    console.log(`#${n}: no next label: ${reason}`)
    return
  }
  const description = `${want}: ${reason}`.slice(0, 140)
  if (description !== f.currentStatus) {
    gh([
      'api',
      '-X',
      'POST',
      `repos/${repo}/statuses/${f.headSha}`,
      '-f',
      'state=success',
      '-f',
      `context=${STATUS_CONTEXT}`,
      '-f',
      `description=${description}`
    ])
  }
  console.log(`#${n}: ${description}`)
}

function main(argv) {
  const clear = argv[0] === '--clear'
  const dryRun = argv[0] === '--dry-run'
  const [repo, ...prs] = clear || dryRun ? argv.slice(1) : argv
  if (!repo || (clear && prs.length !== 1) || prs.some((n) => !/^\d+$/.test(n))) {
    console.error('usage: next.mjs <owner/repo> [pr...] | next.mjs --clear <owner/repo> <pr>')
    process.exit(2)
  }
  if (clear) {
    const labels = api(`repos/${repo}/issues/${prs[0]}/labels`).map((l) => l.name)
    setLabel(repo, prs[0], labels, null)
    console.log(`#${prs[0]}: next label cleared`)
    return
  }
  const maintainer = maintainerOf(readFileSync('.github/CODEOWNERS', 'utf8'))
  if (!maintainer) throw new Error('CODEOWNERS names no owner for *')
  const ctx = {
    dryRun,
    maintainer,
    machine: process.env.BIRDBRAIN_AGENT_GH_LOGIN || 'birdbrain-agent',
    required: api(`repos/${repo}/rules/branches/main`)
      .filter((r) => r.type === 'required_status_checks')
      .flatMap((r) => r.parameters.required_status_checks.map((c) => c.context))
  }
  if (!dryRun) ensureLabels(repo)
  const numbers = prs.length
    ? prs
    : JSON.parse(
        gh(['pr', 'list', '-R', repo, '--state', 'open', '--limit', '200', '--json', 'number'])
      ).map((p) => p.number)
  let failures = 0
  for (const n of numbers) {
    try {
      label(repo, n, ctx)
    } catch (err) {
      failures++
      console.error(`#${n}: could not label: ${err.message}`)
    }
  }
  if (failures) process.exit(1)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2))
