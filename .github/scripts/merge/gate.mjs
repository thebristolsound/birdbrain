#!/usr/bin/env node
// The merge-gate rule (ADR-0041). Usage: gate.mjs <owner/repo> <pr-number>
// Reads the PR with the GH_TOKEN in the environment (read-only is enough), prints the verdict,
// and exits 0 when the PR may merge, 1 when it may not, 2 when the facts cannot be read.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const AGENT_LABELS = ['agent-pr', 'agent-authored']

// Issues a PR closes: only a first line starting "Closes" names them, as in merge.sh.
export function closedIssues(body) {
  const first = (body ?? '').replace(/\r\n/g, '\n').split('\n')[0]
  if (!/^Closes /.test(first)) return []
  return [...first.matchAll(/#(\d+)/g)].map((m) => Number(m[1]))
}

// The code owner of every path, from the `*` line of CODEOWNERS.
export function maintainerOf(codeowners) {
  const line = codeowners.split('\n').find((l) => /^\*\s+@/.test(l.trim()))
  return line ? line.trim().split(/\s+/)[1].slice(1) : null
}

// The newest agent/pre-pass state posted by a trusted account; statuses arrive newest first.
export function trustedPrepass(statuses, trusted) {
  const mine = statuses.find(
    (s) => s.context === 'agent/pre-pass' && trusted.includes(s.creator?.login)
  )
  return mine ? mine.state : 'absent'
}

// The sign-off stamp merge-on-label.yml posts on the commit the maintainer labelled: the
// newest `merge/approved` status at head from the workflow token. A label carries no commit, so
// the stamp is what binds it to one.
export function approvalStamp(statuses) {
  const stamp = statuses.find(
    (s) => s.context === 'merge/approved' && s.creator?.login === 'github-actions[bot]'
  )
  return stamp ? stamp.state : 'absent'
}

// The maintainer's effective review: the newest that approves, requests changes or was
// dismissed. A comment-only review changes nothing.
export function effectiveReview(reviews, maintainer) {
  const states = ['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED']
  const mine = reviews.filter((r) => r.user === maintainer && states.includes(r.state))
  return mine[mine.length - 1] ?? null
}

export function decide(f) {
  const reasons = []
  // The reviewer pre-pass stands in for the maintainer's attention on PRs the machine account
  // opened. A PR opened under the maintainer's account comes from a session the maintainer
  // watched, so its agent label alone does not demand one.
  const agent = f.labels.some((l) => AGENT_LABELS.includes(l))
  if (agent && f.author === f.machine && f.prepass !== 'success') {
    reasons.push(`agent PR without a success agent/pre-pass at head (it is ${f.prepass})`)
  }
  const evidence = f.labels.includes('evidence-affecting') || f.issueEvidence.length > 0
  if (evidence) {
    const review = effectiveReview(f.reviews, f.maintainer)
    const approvedReview = review?.state === 'APPROVED' && review.commit === f.headSha
    // The label counts only with the stamp on this commit; the withdraw job removing the label
    // on push is a second line, not the one this rests on.
    const approvedLabel = f.labels.includes('approved') && f.approvalStamp === 'success'
    if (!approvedReview && !approvedLabel) {
      reasons.push(
        `evidence-affecting with no sign-off at head: needs an approving review from ${f.maintainer} on this commit, or the approved label applied by ${f.maintainer} while this commit was the head`
      )
    }
  }
  return { pass: reasons.length === 0, agent, evidence, reasons }
}

function api(path) {
  const out = execFileSync('gh', ['api', '--paginate', '--slurp', path], { encoding: 'utf8' })
  return JSON.parse(out).flat()
}

function main([repo, n]) {
  if (!repo || !n) {
    console.error('usage: gate.mjs <owner/repo> <pr-number>')
    process.exit(2)
  }
  try {
    const [pr] = api(`repos/${repo}/pulls/${n}`)
    const headSha = pr.head.sha
    const labels = pr.labels.map((l) => l.name)
    const maintainer = maintainerOf(readFileSync('.github/CODEOWNERS', 'utf8'))
    if (!maintainer) throw new Error('CODEOWNERS names no owner for *')
    const machine = process.env.BIRDBRAIN_AGENT_GH_LOGIN || 'birdbrain-agent'
    const issueEvidence = closedIssues(pr.body).filter((i) =>
      api(`repos/${repo}/issues/${i}/labels`).some((l) => l.name === 'evidence-affecting')
    )
    const statuses = api(`repos/${repo}/commits/${headSha}/statuses?per_page=100`)
    const facts = {
      headSha,
      author: pr.user?.login,
      machine,
      labels,
      maintainer,
      issueEvidence,
      prepass: trustedPrepass(statuses, [maintainer, machine]),
      approvalStamp: approvalStamp(statuses),
      reviews: api(`repos/${repo}/pulls/${n}/reviews?per_page=100`).map((r) => ({
        state: r.state,
        user: r.user?.login,
        commit: r.commit_id
      }))
    }
    const verdict = decide(facts)
    console.log(
      `PR #${n} at ${headSha.slice(0, 12)}: agent=${verdict.agent} evidence=${verdict.evidence}`
    )
    if (verdict.evidence && issueEvidence.length)
      console.log(`evidence-affecting through issue(s) #${issueEvidence.join(', #')}`)
    if (verdict.pass) {
      console.log('merge-gate: pass')
      process.exit(0)
    }
    for (const r of verdict.reasons) console.log(`merge-gate: blocked: ${r}`)
    process.exit(1)
  } catch (err) {
    console.error(`merge-gate: cannot read the facts: ${err.message}`)
    process.exit(2)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2))
