// Trusted history preparation for the review fleet (ADR-0057). The passes get no shell and no
// git, so what git would have told them is written here as files: every commit past main, a
// patch per commit, the pull requests below the head, the diff against a base branch other than
// main, and the repository's files as they stood before the change.
//
// Usage: history.mjs <owner/repo> <pr> <checkout> <inputs dir>
//
// The checkout is the pull request's tree, which is read and never run. Every git command gets
// its arguments as an array, with no shell and neither token in its environment. A branch name
// from the API is checked as a ref name and resolved to a commit id once; every later command
// takes commit ids. Each diff passes --no-ext-diff and --no-textconv. Git prints to this
// process, which writes the files under the inputs directory. The one command that writes
// objects, the automatic merge, writes them to a directory under the inputs that is removed
// before this returns. The files before the change are written from the stored blobs, so no
// checkout, filter, attribute or hook takes part.
import { Buffer } from 'node:buffer'
import { execFileSync, spawnSync } from 'node:child_process'
import { closeSync, mkdirSync, openSync, readSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ghList, ghRead } from './inputs.mjs'

// Going over either limit is stated: a head with more commits fails before the paid call, and a
// longer patch is cut at the limit with the cut recorded in commits.json and in the patch.
export const MAX_COMMITS = 300
export const PATCH_LIMIT = 256 * 1024
// The files of one commit, written out. A larger tree fails before the paid call.
export const MAX_TREE_BYTES = 512 * 1024 * 1024

const OID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/
const DIFF = ['diff', '--no-ext-diff', '--no-textconv', '--no-color']
const PATCH = [...DIFF, '--src-prefix=a/', '--dst-prefix=b/', '-M']
const BUFFER = 64 * 1024 * 1024
// Blobs are read from git this many bytes at a time.
const BATCH = 32 * 1024 * 1024

// What git needs to find itself and its configuration, and nothing else the job holds.
const GIT_ENV = [
  'PATH',
  'HOME',
  'XDG_CONFIG_HOME',
  'GIT_CONFIG_GLOBAL',
  'GIT_CONFIG_SYSTEM',
  'GIT_CONFIG_NOSYSTEM'
]

function gitIn(dir) {
  const argv = (args) => ['--no-pager', '-C', dir, ...args]
  const env = (more = {}) => {
    const kept = GIT_ENV.filter((name) => process.env[name] !== undefined)
    return { LC_ALL: 'C', ...Object.fromEntries(kept.map((n) => [n, process.env[n]])), ...more }
  }
  return {
    text: (args) =>
      execFileSync('git', argv(args), {
        encoding: 'utf8',
        env: env(),
        maxBuffer: BUFFER,
        stdio: ['ignore', 'pipe', 'pipe']
      }),
    // For a command whose exit status is an answer, not only an error.
    status: (args, more) => {
      const r = spawnSync('git', argv(args), {
        encoding: 'utf8',
        env: env(more),
        maxBuffer: BUFFER,
        stdio: ['ignore', 'pipe', 'pipe']
      })
      if (r.error) throw r.error
      return r
    },
    // Raw bytes out, for a command that reads its requests from standard input.
    bytes: (args, input, size) => {
      const r = spawnSync('git', argv(args), { input, env: env(), maxBuffer: size })
      if (r.error) throw r.error
      if (r.status !== 0) throw new Error(`git ${args[0]} failed: ${String(r.stderr).trim()}`)
      return r.stdout
    },
    toFile: (args, file) => {
      const fd = openSync(file, 'w')
      try {
        execFileSync('git', argv(args), { env: env(), stdio: ['ignore', fd, 'pipe'] })
      } finally {
        closeSync(fd)
      }
    }
  }
}

function oid(text, what) {
  const value = String(text).trim()
  if (!OID.test(value)) throw new Error(`${what} is not a commit id`)
  return value
}

// The tip of a branch as the checkout fetched it. The name comes from the API and never reaches
// git on its own: it is the end of a full ref name that git checks first.
function branchTip(git, name) {
  const ref = `refs/remotes/origin/${name}`
  if (typeof name !== 'string' || !name || git.status(['check-ref-format', ref]).status !== 0)
    throw new Error(`unusable base branch name: ${JSON.stringify(name)}`)
  const found = git.status([
    'rev-parse',
    '--verify',
    '--quiet',
    '--end-of-options',
    `${ref}^{commit}`
  ])
  if (found.status !== 0) throw new Error(`the checkout has no ${ref}`)
  return oid(found.stdout, ref)
}

function mergeBase(git, tip, head, what) {
  const found = git.status(['merge-base', tip, head])
  if (found.status !== 0) throw new Error(`the head has no merge base with ${what}`)
  return oid(found.stdout, 'the merge base')
}

// Commits reachable from `tip` and from none of `not`, each with its parents, parents first.
function revList(git, tip, not) {
  return git
    .text(['rev-list', '--topo-order', '--reverse', '--parents', tip, '--not', ...not])
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split(' ').map((id) => oid(id, 'a listed commit')))
}

function nameStatus(git, from, to) {
  const parts = git.text([...DIFF, '--no-renames', '--name-status', '-z', from, to]).split('\0')
  const files = []
  for (let i = 0; i + 1 < parts.length; i += 2) files.push({ status: parts[i], path: parts[i + 1] })
  return files
}

// Writes the diff and returns its full size. A patch over the limit is cut at a line end, and
// its last line says how much is missing.
function writePatch(git, from, to, file, limit = PATCH_LIMIT) {
  git.toFile([...PATCH, from, to], file)
  const bytes = statSync(file).size
  if (bytes <= limit) return { bytes, truncated: false }
  const kept = Buffer.alloc(limit)
  const fd = openSync(file, 'r')
  try {
    readSync(fd, kept, 0, limit, 0)
  } finally {
    closeSync(fd)
  }
  const notice = `[review-fleet: patch cut at ${limit} of ${bytes} bytes; the rest is not in the inputs]\n`
  writeFileSync(
    file,
    Buffer.concat([kept.subarray(0, kept.lastIndexOf(0x0a) + 1), Buffer.from(notice)])
  )
  return { bytes, truncated: true }
}

// Whether a merge commit's tree is what git's automatic merge of its two parents produces.
// `objects` sends the merged tree, which the repository may not hold, away from the checkout.
function autoMerge(git, id, parents, objects) {
  if (parents.length < 2) return null
  if (parents.length > 2) return 'not-computed'
  const merged = git.status(
    ['merge-tree', '--write-tree', '--no-messages', '--allow-unrelated-histories', ...parents],
    objects
  )
  if (merged.status === 1) return 'conflicts'
  if (merged.status !== 0)
    throw new Error(`git merge-tree failed for ${id}: ${merged.stderr.trim()}`)
  const tree = oid(merged.stdout.split('\n')[0], 'the merged tree')
  const actual = oid(git.text(['rev-parse', '--verify', `${id}^{tree}`]), 'the commit tree')
  return tree === actual ? 'identical' : 'differs'
}

// The regular files of a commit's tree, with what was left out. A symbolic link is not made,
// because the pass would read whatever it points at, and a submodule has no files here. A path
// that could leave the directory, or name a repository inside it, fails.
function treeFiles(git, commit, limit) {
  const files = []
  const skipped = []
  let bytes = 0
  for (const row of git.text(['ls-tree', '-r', '-l', '-z', '--full-tree', commit]).split('\0')) {
    if (!row) continue
    const tab = row.indexOf('\t')
    const [mode, , blob, size] = row.slice(0, tab).split(/ +/)
    const path = row.slice(tab + 1)
    if (path.split('/').some((part) => ['', '.', '..'].includes(part) || /^\.git$/i.test(part)))
      throw new Error(`unsafe path in the tree of ${commit}: ${JSON.stringify(path)}`)
    if (mode === '120000') skipped.push({ path, kind: 'symbolic link' })
    else if (mode === '160000') skipped.push({ path, kind: 'submodule' })
    else {
      files.push({ path, blob: oid(blob, 'a blob'), size: Number(size) })
      bytes += Number(size)
    }
  }
  if (bytes > limit)
    throw new Error(`the tree at ${commit} is ${bytes} bytes, over the limit of ${limit}`)
  return { commit, files, skipped, bytes }
}

// Writes each file as git stores it. `git cat-file --batch` answers `<id> blob <size>`, the
// bytes and a line feed for each id it is sent; an answer in any other shape fails.
function writeTree(git, { files }, dest) {
  mkdirSync(dest)
  let from = 0
  while (from < files.length) {
    let to = from
    let size = 0
    do size += files[to++].size
    while (to < files.length && size + files[to].size <= BATCH)
    const batch = files.slice(from, to)
    const out = git.bytes(
      ['cat-file', '--batch'],
      batch.map((f) => `${f.blob}\n`).join(''),
      size + 256 * batch.length + 1024
    )
    let at = 0
    for (const { path, blob, size: length } of batch) {
      const end = out.indexOf(0x0a, at)
      if (end < 0 || out.toString('latin1', at, end) !== `${blob} blob ${length}`)
        throw new Error(`git cat-file gave no blob for ${JSON.stringify(path)}`)
      const file = join(dest, path)
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(file, out.subarray(end + 1, end + 1 + length), { flag: 'wx', mode: 0o644 })
      at = end + 1 + length + 1
    }
    from = to
  }
}

// One field per line and one file per line, so a search for a path or a commit id lands on it.
function commitsJson(doc) {
  const line = (key, value, pad) => `${pad}${JSON.stringify(key)}: ${JSON.stringify(value)}`
  const commit = ({ files, ...rest }) => {
    const fields = Object.entries(rest).map(([key, value]) => line(key, value, '      '))
    const list = files.map((file) => `        ${JSON.stringify(file)}`).join(',\n')
    fields.push(`      "files": [${list ? `\n${list}\n      ` : ''}]`)
    return `    {\n${fields.join(',\n')}\n    }`
  }
  const { commits, ...rest } = doc
  const fields = Object.entries(rest).map(([key, value]) => line(key, value, '  '))
  fields.push(`  "commits": [\n${commits.map(commit).join(',\n')}\n  ]`)
  return `{\n${fields.join(',\n')}\n}\n`
}

// The pull requests under this one. Three kinds count, none of them a fork's: an open one whose
// head this head contains; an open one on the chain of base branches, since a parent that has
// moved on is no longer an ancestor; and a recently closed one whose head this head contains,
// since a parent merged by squash leaves its commits here.
function lower({ pulls, closed, mine, repo, listed }) {
  const local = (p) => p?.head?.repo?.full_name === repo && p.number !== mine.number
  const found = new Map()
  for (const p of [...closed, ...pulls])
    if (local(p) && listed.has(p.head.sha)) found.set(p.number, p)
  const followed = new Set(['main'])
  const refs = [mine.base?.ref]
  while (refs.length) {
    const ref = refs.pop()
    if (followed.has(ref)) continue
    followed.add(ref)
    for (const p of pulls.filter((q) => local(q) && q.head.ref === ref)) {
      found.set(p.number, p)
      refs.push(p.base?.ref)
    }
  }
  return [...found.values()]
}

// `pulls` is every open pull request of the repository and `closed` its most recently updated
// closed ones, as the API lists them. Everything that can fail is settled before the first file
// is written.
export function prepareHistory({
  dir,
  out,
  number,
  repo,
  pulls,
  closed,
  maxCommits = MAX_COMMITS,
  maxTreeBytes = MAX_TREE_BYTES
}) {
  if (!Array.isArray(pulls)) throw new Error('no list of open pull requests')
  if (!Array.isArray(closed)) throw new Error('no list of recently closed pull requests')
  const mine = pulls.find((p) => p?.number === number)
  if (!mine) throw new Error(`pull request #${number} is not among the open pull requests`)
  const git = gitIn(dir)
  const head = oid(git.text(['rev-parse', '--verify', 'HEAD^{commit}']), 'HEAD')
  const mainTip = branchTip(git, 'main')
  const base = mine.base?.ref
  const baseTip = base === 'main' ? mainTip : branchTip(git, base)
  const fromMain = mergeBase(git, mainTip, head, 'main')
  const fromBase = base === 'main' ? fromMain : mergeBase(git, baseTip, head, 'the base branch')
  const rows = revList(git, head, [fromMain])
  if (!rows.length) throw new Error('the head has no commit past the merge base with main')
  if (rows.length > maxCommits)
    throw new Error(
      `the pull request has ${rows.length} commits past main, over the limit of ${maxCommits}`
    )

  // The listed commits a tip contains, oldest first, or null for a tip the checkout lacks.
  const listed = new Set(rows.map(([id]) => id))
  const reached = (tip) =>
    OID.test(tip) && git.status(['cat-file', '-e', `${tip}^{commit}`]).status === 0
      ? revList(git, tip, [fromMain])
          .map(([id]) => id)
          .filter((id) => listed.has(id))
      : null
  // Each commit goes to the lowest pull request whose head contains it: the one that contains
  // the fewest of the listed commits. What no lower pull request contains is this one's.
  const holder = new Map()
  const below = lower({ pulls, closed, mine, repo, listed })
    .map((p) => ({ p, reach: reached(p.head.sha) }))
    .sort(
      (a, b) =>
        (a.reach?.length ?? Infinity) - (b.reach?.length ?? Infinity) || a.p.number - b.p.number
    )
    .map(({ p, reach }) => {
      const commits = reach?.filter((id) => !holder.has(id)) ?? null
      for (const id of commits ?? []) holder.set(id, p.number)
      return {
        number: p.number,
        state: p.state === 'open' ? 'open' : p.merged_at ? 'merged' : 'closed',
        title: String(p.title ?? ''),
        author: p.user?.login ?? null,
        head: p.head.sha,
        head_ref: p.head.ref ?? null,
        base: p.base?.ref ?? null,
        head_in_history: listed.has(p.head.sha),
        commits,
        ...(commits ? {} : { commits_unknown: 'its head is not a commit in the checkout' })
      }
    })
  const own = rows.map(([id]) => id).filter((id) => !holder.has(id))
  const inBase = new Set(base === 'main' ? [] : reached(baseTip))
  // The repository before the change: at the merge base with main, and, when the base branch
  // has moved past that, at the merge base with the base branch too.
  const trees = [
    { path: 'base-tree', is: 'the merge base with main', ...treeFiles(git, fromMain, maxTreeBytes) }
  ]
  if (fromBase !== fromMain)
    trees.push({
      path: 'base-branch-tree',
      is: 'the merge base with the base branch',
      ...treeFiles(git, fromBase, maxTreeBytes)
    })

  mkdirSync(join(out, 'commits'))
  const emptyTree = () => oid(git.text(['hash-object', '-t', 'tree', '/dev/null']), 'empty tree')
  const quarantine = join(out, '.objects')
  let commits
  try {
    mkdirSync(quarantine)
    const objects = {
      GIT_OBJECT_DIRECTORY: quarantine,
      GIT_ALTERNATE_OBJECT_DIRECTORIES: git
        .text(['rev-parse', '--path-format=absolute', '--git-path', 'objects'])
        .trim()
    }
    commits = rows.map(([id, ...parents], i) => {
      const [authored, ...subject] = git
        .text(['log', '-1', '--no-show-signature', '--format=%aI%n%s', id])
        .replace(/\n$/, '')
        .split('\n')
      const from = parents[0] ?? emptyTree()
      const patch = `commits/${String(i + 1).padStart(3, '0')}-${id}.patch`
      const { bytes, truncated } = writePatch(git, from, id, join(out, patch))
      return {
        oid: id,
        parents,
        author_date: authored,
        subject: subject.join('\n'),
        pull_request: holder.get(id) ?? number,
        in_base_branch: inBase.has(id),
        auto_merge: autoMerge(git, id, parents, objects),
        patch,
        patch_bytes: bytes,
        patch_truncated: truncated,
        files: nameStatus(git, from, id)
      }
    })
  } finally {
    rmSync(quarantine, { recursive: true, force: true })
  }
  writeFileSync(
    join(out, 'commits.json'),
    commitsJson({
      head,
      merge_base_with_main: fromMain,
      order: 'oldest first: a commit comes after every parent it has in this list',
      patch_limit_bytes: PATCH_LIMIT,
      commits
    })
  )
  if (base !== 'main') git.toFile([...PATCH, fromBase, head], join(out, 'diff-base.patch'))
  for (const tree of trees) writeTree(git, tree, join(out, tree.path))
  const stack = {
    pull_request: number,
    base,
    head,
    merge_base_with_main: fromMain,
    merge_base_with_base: fromBase,
    commits: own,
    below,
    closed_pull_requests_checked: closed.length,
    trees: trees.map(({ path, is, commit, files, bytes, skipped }) => ({
      path,
      is,
      commit,
      files: files.length,
      bytes,
      skipped
    }))
  }
  writeFileSync(join(out, 'stack.json'), `${JSON.stringify(stack, null, 2)}\n`)
  return { commits: commits.length, below: below.length, stacked: base !== 'main' }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [repo, pr, dir, out] = process.argv.slice(2)
  if (!repo || !/^\d+$/.test(pr ?? '') || !dir || !out) {
    console.error('usage: history.mjs <owner/repo> <pr> <checkout> <inputs dir>')
    process.exit(2)
  }
  const pulls = ghList(`repos/${repo}/pulls?state=open&per_page=100`)
  // One page, newest first: a parent that merged is recent, and the repository's whole closed
  // history is thousands of pull requests.
  const closed = ghRead(`repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=100`)
  const made = prepareHistory({ dir, out, number: Number(pr), repo, pulls, closed })
  console.log(
    `review-fleet: history for #${pr}: ${made.commits} commit(s), ${made.below} pull request(s) below, ${made.stacked ? 'base is not main' : 'base is main'}`
  )
}
