// The signals that read GitHub: Dependabot pull requests nobody has merged,
// coverage and red runs on main, and branches left behind.
//
// Each one reads what a job already published. None of them starts a test, a
// coverage or a build run. A read that fails is "not measured" with a fixed
// reason; the raw error goes to the log, because the reason is published.

import { Buffer } from 'node:buffer'
import { Unmeasured } from './unmeasured.mjs'

const DAY_MS = 24 * 60 * 60 * 1000

const DEPENDABOT_LOGIN = 'dependabot[bot]'
const DEPENDABOT_MAX_AGE_DAYS = 14
const BADGE_BRANCH = 'coverage-badge'
const BADGE_MAX_AGE_DAYS = 14
const CI_WINDOW_DAYS = 7
const BRANCH_MAX_AGE_DAYS = 30
// Long-lived branches no pull request will ever close: the default branch, and
// the branch scripts/coverage-badge.mjs publishes the badge to.
export const KEPT_BRANCHES = ['main', BADGE_BRANCH]
// 100 branches a page. Past this many pages the listing is not one a weekly
// report should walk, and a partial count would read as a small one.
const BRANCH_PAGE_LIMIT = 20

const RED_CONCLUSIONS = ['failure', 'timed_out']

const BRANCH_QUERY = `query($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    refs(refPrefix: "refs/heads/", first: 100, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        name
        target { ... on Commit { committedDate } }
        associatedPullRequests(states: OPEN, first: 1) { totalCount }
      }
    }
  }
}`

// One GitHub read. Without a token or a repository there is nothing to ask; with
// them, a failure is logged in full and published as one fixed phrase.
const read = (ctx, args) => {
  if (!ctx.gh) throw new Unmeasured('no gh token')
  if (!ctx.repo) throw new Unmeasured('GITHUB_REPOSITORY is not set')
  try {
    return ctx.gh(args)
  } catch (error) {
    ctx.log?.(error.message)
    throw new Unmeasured('GitHub could not be read; see the run log')
  }
}

const ageInDays = (iso, now) => {
  const at = Date.parse(iso)
  if (Number.isNaN(at)) throw new Unmeasured('GitHub returned a date that could not be read')
  return (now - at) / DAY_MS
}

// `--slurp` prints one array per page, and an empty listing is one empty page, so
// no page at all means nothing was read.
export const staleDependabotPulls = (pages, now) => {
  if (!Array.isArray(pages) || pages.length === 0 || !pages.every(Array.isArray)) {
    throw new Unmeasured('GitHub returned no pull request list')
  }
  const pulls = pages.flat()
  if (!pulls.every((pull) => typeof pull?.user?.login === 'string')) {
    throw new Unmeasured('GitHub returned a pull request with no author')
  }
  const open = pulls.filter((pull) => pull.user.login === DEPENDABOT_LOGIN)
  const stale = open.filter((pull) => ageInDays(pull.created_at, now) > DEPENDABOT_MAX_AGE_DAYS)
  return { value: stale.length, note: `of ${open.length} open Dependabot pull request(s)` }
}

// The badge file is { schemaVersion, label, message, color } with the line
// percentage in `message`, as scripts/coverage-badge.mjs writes it.
export const badgeCoverage = (file, commits, now) => {
  let badge
  try {
    badge = JSON.parse(Buffer.from(file?.content ?? '', 'base64').toString('utf8'))
  } catch {
    throw new Unmeasured('the coverage badge file is not JSON')
  }
  const match = /^(\d+(?:\.\d+)?)%$/.exec(String(badge?.message ?? ''))
  if (!match || Number(match[1]) > 100) {
    throw new Unmeasured('the coverage badge holds no percentage')
  }
  const published = Array.isArray(commits) ? commits[0]?.commit?.committer?.date : undefined
  if (!published) throw new Unmeasured('the coverage badge has no commit date')
  const age = ageInDays(published, now)
  if (age > BADGE_MAX_AGE_DAYS) {
    throw new Unmeasured(`the coverage badge is more than ${BADGE_MAX_AGE_DAYS} days old`)
  }
  return { value: Number(match[1]), note: `published ${published.slice(0, 10)}` }
}

// A run that was cancelled is someone's choice, or a newer push replacing it, and
// says nothing about main. A run that needed a second attempt is the nearest
// thing to a flaky-test count the API exposes. The listing is one page, so a
// total past it means runs went unread and the count would read low.
export const redRuns = (response) => {
  const runs = response?.workflow_runs
  if (!Array.isArray(runs)) throw new Unmeasured('GitHub returned no run list')
  if (runs.length === 0) {
    throw new Unmeasured(`no completed CI run on main in the last ${CI_WINDOW_DAYS} days`)
  }
  if (!Number.isInteger(response.total_count)) {
    throw new Unmeasured('GitHub returned no run total')
  }
  if (response.total_count > runs.length) {
    throw new Unmeasured(`more than ${runs.length} CI runs on main in the window`)
  }
  const red = runs.filter(
    (run) =>
      run.conclusion !== 'cancelled' &&
      (RED_CONCLUSIONS.includes(run.conclusion) || (run.run_attempt ?? 1) > 1)
  )
  return { value: red.length, note: `of ${runs.length} completed run(s)` }
}

// A repository always has its default branch, so an empty listing is a failed read.
export const staleBranches = (nodes, now) => {
  if (nodes.length === 0) throw new Unmeasured('GitHub returned no branches')
  const stale = nodes.filter((node) => {
    if (KEPT_BRANCHES.includes(node.name)) return false
    if (typeof node.associatedPullRequests?.totalCount !== 'number') {
      throw new Unmeasured('GitHub returned a branch with no pull request count')
    }
    if (node.associatedPullRequests.totalCount > 0) return false
    return ageInDays(node.target?.committedDate, now) > BRANCH_MAX_AGE_DAYS
  })
  return { value: stale.length, note: `of ${nodes.length} branch(es)` }
}

const listBranches = (ctx) => {
  const [owner, name] = String(ctx.repo ?? '').split('/')
  const nodes = []
  let after = null
  for (let page = 0; page < BRANCH_PAGE_LIMIT; page++) {
    const args = ['graphql', '-f', `query=${BRANCH_QUERY}`, '-f', `owner=${owner}`]
    args.push('-f', `name=${name}`)
    if (after) args.push('-f', `after=${after}`)
    const refs = read(ctx, args)?.data?.repository?.refs
    if (!Array.isArray(refs?.nodes)) throw new Unmeasured('GitHub returned no branch list')
    nodes.push(...refs.nodes)
    if (!refs.pageInfo?.hasNextPage) return nodes
    after = refs.pageInfo.endCursor
  }
  throw new Unmeasured(`the repository has more than ${BRANCH_PAGE_LIMIT * 100} branches`)
}

export const REMOTE_DEPENDENCY_SIGNALS = [
  {
    id: 'stale-dependabot-pulls',
    family: 'dependencies',
    label: `Dependabot pull requests open over ${DEPENDABOT_MAX_AGE_DAYS} days`,
    unit: 'count',
    better: 'lower',
    budget: 0,
    why: 'Dependabot opens its groups weekly, so one two weeks old has missed two rounds',
    needs: 'gh',
    measure: (ctx) =>
      staleDependabotPulls(
        read(ctx, ['--paginate', '--slurp', `repos/${ctx.repo}/pulls?state=open&per_page=100`]),
        ctx.now
      )
  }
]

export const REMOTE_TEST_SIGNALS = [
  {
    id: 'line-coverage-on-main',
    family: 'tests',
    label: 'Line coverage on main',
    unit: 'percent',
    better: 'higher',
    budget: 95,
    why: 'the badge read 95.93% on 2026-11-20; the global threshold in vitest.config.ts is 38',
    needs: 'gh',
    measure: (ctx) =>
      badgeCoverage(
        read(ctx, [`repos/${ctx.repo}/contents/coverage.json?ref=${BADGE_BRANCH}`]),
        read(ctx, [`repos/${ctx.repo}/commits?sha=${BADGE_BRANCH}&per_page=1`]),
        ctx.now
      )
  },
  {
    id: 'red-ci-runs-on-main',
    family: 'tests',
    label: `CI runs on main that failed or needed a re-run, ${CI_WINDOW_DAYS} days`,
    unit: 'count',
    better: 'lower',
    budget: 1,
    why: 'none of the 40 runs in the week before 2026-11-20 failed; one is a flake, two is a pattern',
    needs: 'gh',
    measure: (ctx) => {
      // The full time, not the date: a date opens the window at midnight, up to a day
      // early, and a run near the edge would count in two weekly reports.
      const since = new Date(ctx.now - CI_WINDOW_DAYS * DAY_MS)
        .toISOString()
        .replace(/\.\d{3}Z$/, 'Z')
      const query = `branch=main&event=push&status=completed&created=%3E%3D${since}&per_page=100`
      return redRuns(read(ctx, [`repos/${ctx.repo}/actions/workflows/ci.yml/runs?${query}`]))
    }
  }
]

export const REMOTE_REPOSITORY_SIGNALS = [
  {
    id: 'stale-branches',
    family: 'repository',
    label: `Branches with no open pull request and no commit in ${BRANCH_MAX_AGE_DAYS} days`,
    unit: 'count',
    better: 'lower',
    budget: 80,
    why: '80 of 98 branches on 2026-11-22, so any growth shows; no sweep deletes remote branches',
    needs: 'gh',
    measure: (ctx) => staleBranches(listBranches(ctx), ctx.now)
  }
]
