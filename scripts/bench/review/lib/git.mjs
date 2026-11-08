// The git and gh calls the bench makes, kept thin so tests can inject
// replacements and so the one place that shells out is easy to read.

import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'

const run = (cwd, args, opts = {}) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts })

export function revExists(repo, sha) {
  try {
    run(repo, ['cat-file', '-e', `${sha}^{commit}`])
    return true
  } catch {
    return false
  }
}

export function fetchPullHead(repo, pr) {
  run(repo, ['fetch', '-q', 'origin', `refs/pull/${pr}/head`])
}

export function showFile(repo, sha, path) {
  try {
    return run(repo, ['show', `${sha}:${path}`], { maxBuffer: 64 * 1024 * 1024 })
  } catch {
    return null
  }
}

// A detached worktree at `head` with the mutated files written over it. The
// caller removes it with removeWorktree.
export function materialize(repo, head, files, dir) {
  run(repo, ['worktree', 'add', '--detach', '-q', dir, head])
  for (const [path, content] of files) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), content)
  }
  return dir
}

export function removeWorktree(repo, dir) {
  try {
    run(repo, ['worktree', 'remove', '--force', dir])
  } catch {
    rmSync(dir, { recursive: true, force: true })
    run(repo, ['worktree', 'prune'])
  }
}

// The diff a reviewer would read: base to the mutated tree, working copy
// included, so the mutation sits inside the PR's own hunks.
export function diffAgainst(dir, base) {
  return run(dir, ['diff', base, '--', '.'], { maxBuffer: 64 * 1024 * 1024 })
}

// The description as it read while `head` was the PR's newest commit: the last edit before
// the next commit, or the current body when nothing was pushed after `head`. A case pins the
// commit a reviewer saw, often an early one, and the final body describes later commits.
// GitHub's edit history holds the whole body at each edit, the PR's creation included.
export function bodyAt({ body, commits, edits }, head) {
  const i = commits.findIndex((c) => c.oid === head)
  if (i < 0) throw new Error(`${head} is not a commit of the PR`)
  if (i === commits.length - 1 || edits.length === 0) return body
  const cut = commits[i + 1].committedDate
  const sorted = [...edits].sort((a, b) => a.editedAt.localeCompare(b.editedAt))
  const before = sorted.filter((e) => e.editedAt < cut)
  // No edit before the next commit means the PR was opened after it: the first body is the
  // earliest one a reviewer could have read.
  return (before.at(-1) ?? sorted[0]).diff
}

const HISTORY = `query($owner: String!, $name: String!, $n: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $n) {
      commits(first: 100) { totalCount nodes { commit { oid committedDate } } }
      userContentEdits(first: 100) { totalCount nodes { editedAt diff } }
    }
  }
}`

export function prMetadata(pr, head = null) {
  const raw = execFileSync(
    'gh',
    [
      'pr',
      'view',
      String(pr),
      '--json',
      'number,title,body,url,state,isDraft,headRefOid,baseRefOid,headRefName,baseRefName,labels,mergeCommit,author'
    ],
    { encoding: 'utf8' }
  )
  const meta = JSON.parse(raw)
  if (!head) return meta
  const history = JSON.parse(
    execFileSync(
      'gh',
      [
        'api',
        'graphql',
        '-F',
        'owner={owner}',
        '-F',
        'name={repo}',
        '-F',
        `n=${pr}`,
        '-f',
        `query=${HISTORY}`
      ],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
    )
  ).data.repository.pullRequest
  for (const key of ['commits', 'userContentEdits']) {
    if (history[key].totalCount > history[key].nodes.length)
      throw new Error(`#${pr}: more ${key} than one page holds`)
  }
  const commits = history.commits.nodes.map((n) => n.commit)
  return {
    ...meta,
    body: bodyAt({ body: meta.body, commits, edits: history.userContentEdits.nodes }, head)
  }
}
