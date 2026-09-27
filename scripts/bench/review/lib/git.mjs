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

export function prMetadata(pr) {
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
  return JSON.parse(raw)
}
