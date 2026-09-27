// A gh stand-in for the dispatch mode. Answers the read-only queries the
// dispatch skill and the reviewer make from the fixture's pr.json and
// diff.patch, refuses every write, and logs each call so an unsupported
// query shows up in the row directory instead of as a silent failure.
//
// Env: BENCH_GH_FIXTURE (fixture dir), BENCH_GH_LOG (JSON lines, appended),
// BENCH_GH_HEAD and BENCH_GH_BASE (the clone's own commit ids, which stand in
// for the PR's real head and base so the reviewer sees the tree it has).

import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const argv = process.argv.slice(2)
const fixtureDir = process.env.BENCH_GH_FIXTURE
const logFile = process.env.BENCH_GH_LOG

function log(outcome) {
  if (!logFile) return
  appendFileSync(logFile, JSON.stringify({ argv, outcome }) + '\n')
}

function fail(reason, code = 1) {
  log(`refused: ${reason}`)
  process.stderr.write(`gh (benchmark stand-in): ${reason}\n`)
  process.exit(code)
}

if (!fixtureDir || !existsSync(join(fixtureDir, 'pr.json'))) fail('BENCH_GH_FIXTURE is not set')
const pr = JSON.parse(readFileSync(join(fixtureDir, 'pr.json'), 'utf8'))

// The PR body names its own commits (the Verification block is stamped with
// the head sha), so every reference to the real head or base, full or
// abbreviated, is rewritten to the clone's commit of the same length.
export function repinText(text, from, to) {
  if (typeof text !== 'string' || !from || !to) return text
  const re = new RegExp(`\\b${from.slice(0, 7)}[0-9a-f]*\\b`, 'g')
  return text.replace(re, (m) => (from.startsWith(m) ? to.slice(0, m.length) : m))
}

if (process.env.BENCH_GH_HEAD) {
  pr.body = repinText(pr.body, pr.headRefOid, process.env.BENCH_GH_HEAD)
  pr.headRefOid = process.env.BENCH_GH_HEAD
  pr.mergeCommit = null
  pr.state = 'OPEN'
}
if (process.env.BENCH_GH_BASE) {
  pr.body = repinText(pr.body, pr.baseRefOid, process.env.BENCH_GH_BASE)
  pr.baseRefOid = process.env.BENCH_GH_BASE
}
const spec = JSON.parse(readFileSync(join(fixtureDir, 'case.json'), 'utf8'))

const CHECKS = ['build', 'changes', 'e2e', 'lint', 'test', 'typecheck', 'Dependency audit']

const flag = (name) => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : null
}
const has = (name) => argv.includes(name)

function emit(value) {
  const jq = flag('--jq') ?? flag('-q')
  let text = JSON.stringify(value)
  if (jq !== null) {
    const r = spawnSync('jq', ['-r', jq], { input: text, encoding: 'utf8' })
    if (r.status !== 0) fail(`jq failed: ${r.stderr}`)
    text = r.stdout.replace(/\n$/, '')
  }
  process.stdout.write(text + '\n')
  log('ok')
  process.exit(0)
}

const number = (s) => Number(String(s).replace(/^#/, ''))
const isThisPr = (n) => number(n) === pr.number || number(n) === spec.source.pr

const pullObject = () => ({
  number: pr.number,
  title: pr.title,
  body: pr.body,
  state: pr.state,
  draft: pr.isDraft,
  html_url: pr.url,
  labels: pr.labels,
  head: { sha: pr.headRefOid, ref: pr.headRefName },
  base: { sha: pr.baseRefOid, ref: pr.baseRefName },
  auto_merge: null,
  mergeable: true,
  mergeable_state: 'clean',
  user: pr.author
})

const [cmd, sub, ...rest] = argv

if (cmd === '--version') {
  process.stdout.write('gh version 2.96.0 (benchmark stand-in)\n')
  log('ok')
  process.exit(0)
}

if (cmd === 'auth' && sub === 'status') {
  process.stdout.write('Logged in to github.com (benchmark stand-in)\n')
  log('ok')
  process.exit(0)
}

if (cmd === 'pr') {
  const n = rest.find((a) => /^#?\d+$/.test(a))
  if (n !== undefined && !isThisPr(n)) fail(`only PR #${pr.number} exists here`)
  if (sub === 'view') {
    const fields = flag('--json')
    if (!fields) {
      process.stdout.write(
        `title:\t${pr.title}\nstate:\t${pr.state}\nurl:\t${pr.url}\n\n${pr.body ?? ''}\n`
      )
      log('ok')
      process.exit(0)
    }
    // The fields gh pr view can return, as the dispatcher and reviewer ask
    // for them; one synthetic commit stands for the PR's history. A field
    // not modelled here answers null and is logged, never refused.
    const all = {
      ...pr,
      statusCheckRollup: CHECKS.map((name) => ({
        name,
        status: 'COMPLETED',
        conclusion: 'SUCCESS'
      })),
      autoMergeRequest: null,
      autoMerge: null,
      commits: [
        { oid: pr.headRefOid, messageHeadline: pr.title, messageBody: '', authors: [pr.author] }
      ],
      mergeable: 'MERGEABLE',
      mergeStateStatus: 'CLEAN',
      reviewDecision: '',
      reviews: [],
      latestReviews: [],
      comments: [],
      closed: false,
      mergedAt: null,
      closedAt: null,
      additions: 0,
      deletions: 0,
      changedFiles: 0,
      files: []
    }
    const out = {}
    const unknown = []
    for (const f of fields.split(',')) {
      out[f] = f in all ? all[f] : null
      if (!(f in all)) unknown.push(f)
    }
    if (unknown.length) log(`unknown fields answered null: ${unknown.join(',')}`)
    emit(out)
  }
  if (sub === 'checks') {
    if (has('--json')) {
      emit(
        CHECKS.map((name) => ({
          name,
          state: 'SUCCESS',
          bucket: 'pass',
          workflow: 'ci',
          link: `${pr.url}/checks`,
          startedAt: '2026-01-01T00:00:00Z',
          completedAt: '2026-01-01T00:01:00Z'
        }))
      )
    }
    process.stdout.write(
      CHECKS.map((name) => `${name}\tpass\t1m0s\t${pr.url}/checks`).join('\n') + '\n'
    )
    log('ok')
    process.exit(0)
  }
  if (sub === 'diff') {
    process.stdout.write(readFileSync(join(fixtureDir, 'diff.patch'), 'utf8'))
    log('ok')
    process.exit(0)
  }
  fail(`pr ${sub} is not available`)
}

if (cmd === 'api') {
  const method = (flag('-X') ?? flag('--method') ?? 'GET').toUpperCase()
  const writes =
    method !== 'GET' ||
    has('-f') ||
    has('-F') ||
    has('--input') ||
    has('--field') ||
    has('--raw-field')
  if (writes) fail('writes are disabled in the benchmark')
  const path = argv
    .slice(1)
    .find((a) => !a.startsWith('-') && /^(repos|search|user|graphql)/.test(a))
  if (!path) fail('no api path')
  let m
  if ((m = path.match(/^repos\/[^/]+\/[^/]+\/pulls\/(\d+)$/))) {
    if (!isThisPr(m[1])) fail(`only PR #${pr.number} exists here`)
    emit(pullObject())
  }
  if (
    (m = path.match(/^repos\/[^/]+\/[^/]+\/pulls\/(\d+)\/(comments|reviews|requested_reviewers)$/))
  )
    emit([])
  if ((m = path.match(/^repos\/[^/]+\/[^/]+\/issues\/(\d+)\/labels$/))) {
    emit(isThisPr(m[1]) ? pr.labels.map((l) => ({ name: l.name })) : [])
  }
  if ((m = path.match(/^repos\/[^/]+\/[^/]+\/issues\/(\d+)\/comments$/))) emit([])
  if ((m = path.match(/^repos\/[^/]+\/[^/]+\/issues\/(\d+)$/))) {
    if (isThisPr(m[1]))
      emit({
        number: pr.number,
        title: pr.title,
        body: pr.body,
        labels: pr.labels,
        state: pr.state
      })
    emit({
      number: Number(m[1]),
      title: `Issue #${m[1]}`,
      body: '(issue body not available in the benchmark)',
      labels: [],
      state: 'open'
    })
  }
  if ((m = path.match(/^repos\/[^/]+\/[^/]+\/commits\/([0-9a-f]+)\/status$/))) {
    emit({
      state: 'success',
      sha: m[1],
      statuses: [
        ...CHECKS.map((c) => ({ context: c, state: 'success', description: 'ok' })),
        { context: 'agent/pre-pass', state: 'pending', description: 'Reviewer pre-pass running.' }
      ]
    })
  }
  if ((m = path.match(/^repos\/[^/]+\/[^/]+\/commits\/([0-9a-f]+)\/check-runs$/))) {
    emit({
      total_count: CHECKS.length,
      check_runs: CHECKS.map((name) => ({ name, status: 'completed', conclusion: 'success' }))
    })
  }
  if ((m = path.match(/^repos\/[^/]+\/[^/]+\/pulls\/(\d+)\/files$/))) {
    const files = readFileSync(join(fixtureDir, 'diff.patch'), 'utf8')
      .split('\n')
      .filter((l) => l.startsWith('+++ b/'))
      .map((l) => ({ filename: l.slice(6), status: 'modified' }))
    emit(files)
  }
  fail(`api ${path} is not available`)
}

fail(`${cmd} ${sub ?? ''} is not available`)
