import { spawnSync } from 'child_process'
import {
  type Dirent,
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { join, relative } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_COMMITS,
  MAX_TREE_BYTES,
  PATCH_LIMIT,
  prepareHistory
  // @ts-expect-error - workflow script with no declarations
} from '../.github/scripts/review-fleet/history.mjs'

const repo = 'thebristolsound/birdbrain'
const HISTORY = join(__dirname, '..', '.github', 'scripts', 'review-fleet', 'history.mjs')

type Commit = {
  oid: string
  parents: string[]
  author_date: string
  subject: string
  pull_request: number
  in_base_branch: boolean
  auto_merge: string | null
  patch: string
  patch_bytes: number
  patch_truncated: boolean
  files: { status: string; path: string }[]
}

// A throwaway repository standing in for the PR's checkout, and an inputs directory beside it.
function scratch() {
  const root = mkdtempSync(join(tmpdir(), 'fleet-history-'))
  const dir = join(root, 'pr')
  const out = join(root, 'in')
  mkdirSync(out)
  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 't',
    GIT_AUTHOR_EMAIL: 't@example.com',
    GIT_COMMITTER_NAME: 't',
    GIT_COMMITTER_EMAIL: 't@example.com'
  }
  let clock = Date.UTC(2026, 10, 1) / 1000
  const run = (...args: string[]) =>
    spawnSync('git', ['-C', dir, ...args], {
      encoding: 'utf8',
      env: { ...env, GIT_AUTHOR_DATE: `${clock} +0000`, GIT_COMMITTER_DATE: `${clock} +0000` }
    })
  const git = (...args: string[]) => {
    const r = run(...args)
    expect(r.status, `git ${args.join(' ')}: ${r.stderr}`).toBe(0)
    return r.stdout.trim()
  }
  spawnSync('git', ['init', '-q', '-b', 'main', dir], { env })
  const commit = (file: string, text: string, subject: string) => {
    clock += 60
    writeFileSync(join(dir, file), text)
    git('add', '--', file)
    git('commit', '-q', '-m', subject)
    return git('rev-parse', 'HEAD')
  }
  const origin = (branch: string, oid: string) =>
    git('update-ref', `refs/remotes/origin/${branch}`, oid)
  const read = (name: string) => readFileSync(join(out, name), 'utf8')
  return {
    root,
    dir,
    out,
    run,
    git,
    commit,
    origin,
    read,
    commits: () => JSON.parse(read('commits.json')) as { commits: Commit[]; head: string },
    stack: () => JSON.parse(read('stack.json')),
    done: () => rmSync(root, { recursive: true, force: true })
  }
}

const pull = (number: number, head: string, headRef: string, baseRef: string, more = {}) => ({
  number,
  state: 'open',
  title: `Pull request ${number}`,
  user: { login: 'thebristolsound' },
  head: { sha: head, ref: headRef, repo: { full_name: repo } },
  base: { ref: baseRef },
  ...more
})

// main: base, then m1. `parent` (#10, on main): p1, p2. `child` (#11, on parent): c1, an
// automatic merge of main, c2.
function stacked() {
  const s = scratch()
  const base = s.commit('base.txt', 'base\n', 'base')
  s.git('checkout', '-q', '-b', 'parent')
  const p1 = s.commit('parent.txt', 'one\n', 'parent: add the file')
  const p2 = s.commit('parent.txt', 'one\ntwo\n', 'parent: extend the file')
  s.git('checkout', '-q', '-b', 'child')
  const c1 = s.commit('child.txt', 'child\n', 'child: add the file')
  s.git('checkout', '-q', 'main')
  const m1 = s.commit('main.txt', 'main\n', 'main: move on')
  s.git('checkout', '-q', 'child')
  s.git('merge', '-q', '--no-ff', '-m', 'merge main', 'main')
  const mg = s.git('rev-parse', 'HEAD')
  const c2 = s.commit('child.txt', 'child\nmore\n', 'child: extend the file')
  s.origin('main', m1)
  s.origin('parent', p2)
  const pulls = [pull(10, p2, 'parent', 'main'), pull(11, c2, 'child', 'parent')]
  const prepare = (more: Record<string, unknown> = {}) =>
    prepareHistory({ dir: s.dir, out: s.out, number: 11, repo, pulls, closed: [], ...more })
  return { ...s, base, p1, p2, c1, m1, mg, c2, pulls, prepare }
}

let made: { done: () => void }[] = []
const keep = <T extends { done: () => void }>(s: T) => {
  made.push(s)
  return s
}

beforeEach(() => {
  vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null')
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1')
})
afterEach(() => {
  vi.unstubAllEnvs()
  for (const s of made) s.done()
  made = []
})

describe('commit history handed to the passes', () => {
  it('lists every commit past main, parents first, with what each changed', () => {
    const s = keep(stacked())
    s.prepare()
    const { commits, head } = s.commits()
    expect(head).toBe(s.c2)
    expect(commits.map((c) => c.oid)).toEqual([s.p1, s.p2, s.c1, s.mg, s.c2])
    expect(commits.map((c) => c.parents)).toEqual([[s.base], [s.p1], [s.p2], [s.c1, s.m1], [s.mg]])
    expect(commits.map((c) => c.subject)).toEqual([
      'parent: add the file',
      'parent: extend the file',
      'child: add the file',
      'merge main',
      'child: extend the file'
    ])
    // Git versions spell a UTC offset as `Z` or `+00:00`.
    expect(commits.map((c) => new Date(c.author_date).toISOString())).toEqual(
      [2, 3, 4, 5, 6].map((minute) => `2026-11-01T00:0${minute}:00.000Z`)
    )
    expect(commits.map((c) => c.files)).toEqual([
      [{ status: 'A', path: 'parent.txt' }],
      [{ status: 'M', path: 'parent.txt' }],
      [{ status: 'A', path: 'child.txt' }],
      [{ status: 'A', path: 'main.txt' }],
      [{ status: 'M', path: 'child.txt' }]
    ])
  })

  it('writes one patch per commit against its first parent', () => {
    const s = keep(stacked())
    s.prepare()
    const { commits } = s.commits()
    expect(readdirSync(join(s.out, 'commits')).sort()).toEqual(commits.map((c) => c.patch.slice(8)))
    expect(commits[1].patch).toBe(`commits/002-${s.p2}.patch`)
    const extend = s.read(commits[1].patch)
    expect(extend).toContain('+++ b/parent.txt')
    expect(extend).toContain('+two')
    expect(extend).not.toContain('child.txt')
    // The merge's patch is what main brought in, not the branch's own files.
    const merge = s.read(commits[3].patch)
    expect(merge).toContain('+++ b/main.txt')
    expect(merge).not.toContain('child.txt')
    expect(commits.every((c) => !c.patch_truncated)).toBe(true)
    expect(commits[1].patch_bytes).toBe(statSync(join(s.out, commits[1].patch)).size)
  })

  it('cuts a patch at the size limit and says so', () => {
    const s = keep(scratch())
    const base = s.commit('base.txt', 'base\n', 'base')
    s.origin('main', base)
    const line = `${'x'.repeat(99)}\n`
    const head = s.commit('big.txt', line.repeat(4000), 'add a large file')
    prepareHistory({
      dir: s.dir,
      out: s.out,
      number: 7,
      repo,
      pulls: [pull(7, head, 'big', 'main')],
      closed: []
    })
    const [c] = s.commits().commits
    expect(c.patch_truncated).toBe(true)
    expect(c.patch_bytes).toBeGreaterThan(400_000)
    const text = s.read(c.patch)
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(PATCH_LIMIT + 200)
    expect(text.split('\n').at(-2)).toBe(
      `[review-fleet: patch cut at ${PATCH_LIMIT} of ${c.patch_bytes} bytes; the rest is not in the inputs]`
    )
    // Cut at a line end: every line before the notice is a whole diff line.
    expect(text.split('\n').at(-3)).toBe(`+${'x'.repeat(99)}`)
  })

  it('names the pull request each commit belongs to, and whether the base branch has it', () => {
    const s = keep(stacked())
    s.prepare()
    const { commits } = s.commits()
    expect(commits.map((c) => c.pull_request)).toEqual([10, 10, 11, 11, 11])
    expect(commits.map((c) => c.in_base_branch)).toEqual([true, true, false, false, false])
  })

  it('lists a commit with no parent against the empty tree', () => {
    const s = keep(stacked())
    s.git('checkout', '-q', '--orphan', 'island')
    s.git('rm', '-rfq', '.')
    const root = s.commit('island.txt', 'i\n', 'an unrelated root')
    s.git('checkout', '-q', 'child')
    s.git('merge', '-q', '--allow-unrelated-histories', '-m', 'merge the island', 'island')
    const head = s.git('rev-parse', 'HEAD')
    s.prepare({ pulls: [s.pulls[0], pull(11, head, 'child', 'parent')] })
    const { commits } = s.commits()
    const lone = commits.find((c) => c.oid === root)
    expect(lone).toMatchObject({ parents: [], files: [{ status: 'A', path: 'island.txt' }] })
    expect(s.read(lone?.patch ?? '')).toContain('+++ b/island.txt')
    expect(commits.at(-1)).toMatchObject({ parents: [s.c2, root], auto_merge: 'identical' })
  })
})

describe('whether a merge commit is the automatic merge', () => {
  // `child` and `main` each add a commit past `base`; `merge` builds the merge commit.
  const merged = (
    ours: [string, string],
    theirs: [string, string],
    merge: (s: ReturnType<typeof scratch>) => void
  ) => {
    const s = keep(scratch())
    s.commit('shared.txt', 'line\n', 'base')
    s.git('checkout', '-q', '-b', 'child')
    s.commit(ours[0], ours[1], 'child change')
    s.git('checkout', '-q', 'main')
    const main = s.commit(theirs[0], theirs[1], 'main change')
    s.git('checkout', '-q', 'child')
    merge(s)
    s.origin('main', main)
    const head = s.git('rev-parse', 'HEAD')
    const objects = () => s.git('count-objects', '-v')
    const before = objects()
    prepareHistory({
      dir: s.dir,
      out: s.out,
      number: 7,
      repo,
      pulls: [pull(7, head, 'child', 'main')],
      closed: []
    })
    return { ...s, head, wrote: objects() !== before }
  }
  const mergeOf = (s: ReturnType<typeof merged>) =>
    s.commits().commits.find((c) => c.parents.length > 1)

  it('reports a merge nobody edited as identical', () => {
    const s = merged(['child.txt', 'c\n'], ['main.txt', 'm\n'], (r) =>
      r.git('merge', '-q', '--no-ff', '-m', 'merge main', 'main')
    )
    expect(mergeOf(s)?.auto_merge).toBe('identical')
    expect(s.commits().commits.filter((c) => c.parents.length === 1)[0].auto_merge).toBeNull()
  })

  it('reports a clean merge that carries an extra edit as differing', () => {
    const s = merged(['child.txt', 'c\n'], ['main.txt', 'm\n'], (r) => {
      r.git('merge', '-q', '--no-ff', '--no-commit', 'main')
      writeFileSync(join(r.dir, 'main.txt'), 'edited by hand\n')
      r.git('add', '--', 'main.txt')
      r.git('commit', '-q', '-m', 'merge main')
    })
    expect(mergeOf(s)?.auto_merge).toBe('differs')
  })

  it('reports a merge that needed a resolution as conflicting', () => {
    const s = merged(['shared.txt', 'ours\n'], ['shared.txt', 'theirs\n'], (r) => {
      expect(r.run('merge', '-q', '--no-ff', '-m', 'merge main', 'main').status).toBe(1)
      writeFileSync(join(r.dir, 'shared.txt'), 'resolved\n')
      r.git('add', '--', 'shared.txt')
      r.git('commit', '-q', '-m', 'merge main')
    })
    expect(mergeOf(s)?.auto_merge).toBe('conflicts')
  })

  it('does not compute a merge of more than two parents', () => {
    const s = merged(['child.txt', 'c\n'], ['main.txt', 'm\n'], (r) => {
      r.git('checkout', '-q', '-b', 'side', 'main~1')
      r.commit('side.txt', 's\n', 'side change')
      r.git('checkout', '-q', 'child')
      r.git('merge', '-q', '--no-ff', '-m', 'merge both', 'main', 'side')
    })
    expect(mergeOf(s)?.parents).toHaveLength(3)
    expect(mergeOf(s)?.auto_merge).toBe('not-computed')
  })

  // The automatic merge of an edited merge is a tree the repository does not hold, so git has to
  // write it somewhere: a directory under the inputs that is gone when the step returns.
  // A merge made with the `ours` strategy keeps the branch's tree, so the automatic merge of its
  // parents is a tree the repository has never held, and git has to write it somewhere: a
  // directory under the inputs that is gone when the step returns.
  it('writes no object into the checkout, and leaves no object directory behind', () => {
    const s = merged(['child.txt', 'c\n'], ['main.txt', 'm\n'], (r) =>
      r.git('merge', '-q', '-s', 'ours', '-m', 'merge main', 'main')
    )
    expect(mergeOf(s)?.auto_merge).toBe('differs')
    expect(s.wrote).toBe(false)
    expect(readdirSync(s.out).sort()).toEqual([
      'base-tree',
      'commits',
      'commits.json',
      'scope.json',
      'stack.json'
    ])
  })
})

describe('the stack below the head and the diff against the base branch', () => {
  it('lists the open pull requests whose head is an ancestor, with the commits each holds', () => {
    const s = keep(stacked())
    s.prepare()
    expect(s.stack()).toEqual({
      pull_request: 11,
      base: 'parent',
      head: s.c2,
      merge_base_with_main: s.m1,
      merge_base_with_base: s.p2,
      commits: [s.c1, s.mg, s.c2],
      below: [
        {
          number: 10,
          state: 'open',
          title: 'Pull request 10',
          author: 'thebristolsound',
          head: s.p2,
          head_ref: 'parent',
          base: 'main',
          head_in_history: true,
          commits: [s.p1, s.p2]
        }
      ],
      closed_pull_requests_checked: 0,
      trees: [
        {
          path: 'base-tree',
          is: 'the merge base with main',
          commit: s.m1,
          files: 2,
          bytes: 10,
          skipped: []
        },
        {
          path: 'base-branch-tree',
          is: 'the merge base with the base branch',
          commit: s.p2,
          files: 2,
          bytes: 13,
          skipped: []
        }
      ]
    })
  })

  it('leaves out a pull request whose head is not an ancestor, a fork, and itself', () => {
    const s = keep(stacked())
    s.git('checkout', '-q', '-b', 'elsewhere', s.base)
    const other = s.commit('other.txt', 'o\n', 'unrelated')
    s.git('checkout', '-q', 'child')
    s.prepare({
      pulls: [
        ...s.pulls,
        pull(12, other, 'elsewhere', 'main'),
        pull(13, s.c1, 'child-copy', 'main', {
          head: { sha: s.c1, ref: 'child-copy', repo: { full_name: 'someone/birdbrain' } }
        })
      ]
    })
    expect(s.stack().below.map((p: { number: number }) => p.number)).toEqual([10])
  })

  it('orders the stack from the bottom up, each commit under the lowest head that has it', () => {
    const s = keep(stacked())
    s.prepare({ pulls: [pull(9, s.p1, 'grandparent', 'main'), ...s.pulls.reverse()] })
    const below = s.stack().below
    expect(below.map((p: { number: number }) => p.number)).toEqual([9, 10])
    expect(below.map((p: { commits: string[] }) => p.commits)).toEqual([[s.p1], [s.p2]])
    expect(s.commits().commits.map((c) => c.pull_request)).toEqual([9, 10, 11, 11, 11])
  })

  // grand (#9, on main): g1, later g2. parent (#10, on grand): p1 from g1, later p2. child
  // (#11, on parent): c1 from p1. Neither parent's head is in the child's history any more.
  it('follows the base branches to parents that have moved on', () => {
    const s = keep(scratch())
    const base = s.commit('base.txt', 'base\n', 'base')
    s.git('checkout', '-q', '-b', 'grand')
    const g1 = s.commit('grand.txt', 'g\n', 'grand: add the file')
    s.git('checkout', '-q', '-b', 'parent')
    const p1 = s.commit('parent.txt', 'p\n', 'parent: add the file')
    s.git('checkout', '-q', '-b', 'child')
    const c1 = s.commit('child.txt', 'c\n', 'child: add the file')
    s.git('checkout', '-q', 'grand')
    const g2 = s.commit('grand.txt', 'g\nmore\n', 'grand: move on')
    s.git('checkout', '-q', 'parent')
    const p2 = s.commit('parent.txt', 'p\nmore\n', 'parent: move on')
    s.git('checkout', '-q', 'child')
    s.origin('main', base)
    s.origin('grand', g2)
    s.origin('parent', p2)
    prepareHistory({
      dir: s.dir,
      out: s.out,
      number: 11,
      repo,
      pulls: [
        pull(11, c1, 'child', 'parent'),
        pull(10, p2, 'parent', 'grand'),
        pull(9, g2, 'grand', 'main'),
        pull(8, g2, 'elsewhere', 'main')
      ],
      closed: []
    })
    const stack = s.stack()
    expect(stack).toMatchObject({ merge_base_with_base: p1, commits: [c1] })
    expect(
      stack.below.map((p: Record<string, unknown>) => [p.number, p.head_in_history, p.commits])
    ).toEqual([
      [9, false, [g1]],
      [10, false, [p1]]
    ])
    const { commits } = s.commits()
    expect(commits.map((c) => c.pull_request)).toEqual([9, 10, 11])
    expect(commits.map((c) => c.in_base_branch)).toEqual([true, true, false])
    expect(s.read('diff-base.patch')).not.toContain('parent.txt')
  })

  it('names a parent that merged, from the recently closed pull requests', () => {
    const s = keep(stacked())
    const merged = pull(10, s.p2, 'parent', 'main', {
      state: 'closed',
      merged_at: '2026-11-10T00:00:00Z'
    })
    const dropped = pull(8, s.p1, 'abandoned', 'main', { state: 'closed', merged_at: null })
    const fork = pull(7, s.p1, 'theirs', 'main', {
      state: 'closed',
      head: { sha: s.p1, ref: 'theirs', repo: null }
    })
    s.prepare({ pulls: [pull(11, s.c2, 'child', 'main')], closed: [merged, dropped, fork] })
    const stack = s.stack()
    expect(stack.below.map((p: Record<string, unknown>) => [p.number, p.state, p.commits])).toEqual(
      [
        [8, 'closed', [s.p1]],
        [10, 'merged', [s.p2]]
      ]
    )
    expect(stack).toMatchObject({
      base: 'main',
      commits: [s.c1, s.mg, s.c2],
      closed_pull_requests_checked: 3
    })
    expect(s.commits().commits.map((c) => c.pull_request)).toEqual([8, 10, 11, 11, 11])
    expect(s.commits().commits.every((c) => !c.in_base_branch)).toBe(true)
  })

  it("says so when a parent's head is not in the checkout", () => {
    const s = keep(stacked())
    s.prepare({ pulls: [pull(10, 'f'.repeat(40), 'parent', 'main'), s.pulls[1]] })
    expect(s.stack().below).toEqual([
      expect.objectContaining({
        number: 10,
        head_in_history: false,
        commits: null,
        commits_unknown: 'its head is not a commit in the checkout'
      })
    ])
    // Nothing below claims a commit, so each stays with this pull request.
    expect(s.commits().commits.map((c) => c.pull_request)).toEqual([11, 11, 11, 11, 11])
  })

  it('says what the review reads: the base branch and the commit the scope starts from', () => {
    const s = keep(stacked())
    s.prepare()
    expect(JSON.parse(s.read('scope.json'))).toEqual({ base: 'parent', from: s.p2 })
    const whole = keep(stacked())
    whole.prepare({ number: 10, pulls: [pull(10, whole.c2, 'child', 'main')] })
    expect(JSON.parse(whole.read('scope.json'))).toEqual({ base: 'main', from: whole.m1 })
  })

  it("writes the pull request's own change when its base is not main", () => {
    const s = keep(stacked())
    s.prepare()
    const own = s.read('diff-base.patch')
    expect(own).toContain('+++ b/child.txt')
    expect(own).not.toContain('parent.txt')
    expect(own).toBe(
      s.git('diff', '--no-ext-diff', '--no-textconv', '--no-color', '-M', s.p2, s.c2) + '\n'
    )
  })

  it('writes no base diff when the base is main', () => {
    const s = keep(stacked())
    s.prepare({ number: 10, pulls: [pull(10, s.c2, 'child', 'main')] })
    expect(existsSync(join(s.out, 'diff-base.patch'))).toBe(false)
    expect(s.stack()).toMatchObject({ base: 'main', below: [] })
    expect(s.stack().commits).toEqual([s.p1, s.p2, s.c1, s.mg, s.c2])
  })
})

// Every file under a directory, as path to contents.
const filesUnder = (dir: string): Record<string, string> =>
  Object.fromEntries(
    (readdirSync(dir, { recursive: true, withFileTypes: true }) as Dirent[])
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const file = join(entry.parentPath, entry.name)
        return [relative(dir, file), readFileSync(file, 'utf8')]
      })
      .sort(([x], [y]) => (x < y ? -1 : 1))
  )

describe('the repository as it stood before the change', () => {
  it('writes the files at the merge base with main, and none the change adds', () => {
    const s = keep(stacked())
    s.prepare({ number: 10, pulls: [pull(10, s.c2, 'child', 'main')] })
    expect(filesUnder(join(s.out, 'base-tree'))).toEqual({
      'base.txt': 'base\n',
      'main.txt': 'main\n'
    })
    expect(existsSync(join(s.out, 'base-branch-tree'))).toBe(false)
    expect(s.stack().trees).toEqual([
      {
        path: 'base-tree',
        is: 'the merge base with main',
        commit: s.m1,
        files: 2,
        bytes: 10,
        skipped: []
      }
    ])
  })

  it('writes the files at the merge base with the base branch of a stacked change too', () => {
    const s = keep(stacked())
    s.prepare()
    expect(filesUnder(join(s.out, 'base-tree'))).toEqual({
      'base.txt': 'base\n',
      'main.txt': 'main\n'
    })
    // What the parent had when this change last took it in: its file, and not main's newer one.
    expect(filesUnder(join(s.out, 'base-branch-tree'))).toEqual({
      'base.txt': 'base\n',
      'parent.txt': 'one\ntwo\n'
    })
  })

  it('writes one tree when the base branch is where main was', () => {
    const s = keep(stacked())
    s.origin('integration', s.m1)
    s.prepare({ pulls: [pull(11, s.c2, 'child', 'integration')] })
    expect(existsSync(join(s.out, 'base-branch-tree'))).toBe(false)
    expect(existsSync(join(s.out, 'diff-base.patch'))).toBe(true)
    expect(s.stack().trees.map((t: { path: string }) => t.path)).toEqual(['base-tree'])
  })

  // The base holds a nested file, bytes that are not text, an empty file, an executable, a
  // symbolic link out of the tree and a submodule.
  const odd = () => {
    const s = keep(scratch())
    const bytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i))
    mkdirSync(join(s.dir, 'deep', 'er'), { recursive: true })
    writeFileSync(join(s.dir, 'deep', 'er', 'bytes.bin'), bytes)
    writeFileSync(join(s.dir, 'empty'), '')
    writeFileSync(join(s.dir, 'run.sh'), '#!/bin/sh\n', { mode: 0o755 })
    symlinkSync('/proc/self/environ', join(s.dir, 'link'))
    s.git('add', '--', 'deep', 'empty', 'run.sh', 'link')
    s.git('update-index', '--add', '--cacheinfo', `160000,${'1'.repeat(40)},vendored`)
    const base = s.commit('base.txt', 'base\n', 'base')
    s.origin('main', base)
    const head = s.commit('new.txt', 'n\n', 'the change')
    prepareHistory({
      dir: s.dir,
      out: s.out,
      number: 7,
      repo,
      pulls: [pull(7, head, 'odd', 'main')],
      closed: []
    })
    return { ...s, bytes }
  }

  it('writes each file byte for byte, as a plain file', () => {
    const s = odd()
    const tree = join(s.out, 'base-tree')
    expect(readFileSync(join(tree, 'deep', 'er', 'bytes.bin')).equals(s.bytes)).toBe(true)
    expect(readFileSync(join(tree, 'empty'), 'utf8')).toBe('')
    expect(readFileSync(join(tree, 'run.sh'), 'utf8')).toBe('#!/bin/sh\n')
    expect(statSync(join(tree, 'run.sh')).mode & 0o111).toBe(0)
    expect(existsSync(join(tree, 'new.txt'))).toBe(false)
  })

  it('makes no symbolic link and no submodule, and lists what it left out', () => {
    const s = odd()
    const tree = join(s.out, 'base-tree')
    expect(() => lstatSync(join(tree, 'link'))).toThrow('ENOENT')
    expect(existsSync(join(tree, 'vendored'))).toBe(false)
    expect(s.stack().trees[0]).toMatchObject({
      files: 4,
      skipped: [
        { path: 'link', kind: 'symbolic link' },
        { path: 'vendored', kind: 'submodule' }
      ]
    })
  })

  // Git writes a file out through the filters its configuration names for the attributes a
  // tree sets. The step reads stored blobs, so no filter runs and no attribute hides a file.
  it('runs no filter the repository configures, and exports what an attribute would hide', () => {
    const s = keep(scratch())
    const ran = join(s.root, 'ran')
    const program = join(s.root, 'program')
    writeFileSync(program, `#!/usr/bin/env bash\ntouch ${ran}\ncat\n`)
    chmodSync(program, 0o755)
    writeFileSync(join(s.dir, '.gitattributes'), '* filter=fleet\nhidden.txt export-ignore\n')
    writeFileSync(join(s.dir, 'hidden.txt'), 'kept\n')
    s.git('add', '--', '.gitattributes', 'hidden.txt')
    const base = s.commit('data.txt', 'stored\n', 'base')
    s.origin('main', base)
    const head = s.commit('new.txt', 'n\n', 'the change')
    s.git('config', 'filter.fleet.smudge', program)
    s.git('config', 'filter.fleet.clean', 'cat')
    prepareHistory({
      dir: s.dir,
      out: s.out,
      number: 7,
      repo,
      pulls: [pull(7, head, 'filtered', 'main')],
      closed: []
    })
    expect(existsSync(ran)).toBe(false)
    expect(filesUnder(join(s.out, 'base-tree'))).toEqual({
      '.gitattributes': '* filter=fleet\nhidden.txt export-ignore\n',
      'data.txt': 'stored\n',
      'hidden.txt': 'kept\n'
    })
    // The control: `git archive` of the same commit runs the filter and drops the hidden file.
    const archive = s.run('archive', '--format=tar', base)
    expect(archive.status, archive.stderr).toBe(0)
    expect(existsSync(ran)).toBe(true)
    expect(archive.stdout).toContain('stored')
    expect(archive.stdout).not.toContain('kept')
  })

  it.each(['..', '.git', '.GIT'])('fails on a tree that names %j', (name) => {
    const s = keep(scratch())
    const normal = s.commit('base.txt', 'base\n', 'normal')
    const blob = s.git('rev-parse', `${normal}:base.txt`)
    const inner = spawnSync('git', ['-C', s.dir, 'mktree'], {
      encoding: 'utf8',
      input: `100644 blob ${blob}\t${name}\n`
    })
    expect(inner.status, inner.stderr).toBe(0)
    const outer = spawnSync('git', ['-C', s.dir, 'mktree'], {
      encoding: 'utf8',
      input: `040000 tree ${inner.stdout.trim()}\tdir\n`
    })
    expect(outer.status, outer.stderr).toBe(0)
    const base = s.git('commit-tree', outer.stdout.trim(), '-m', 'crafted base')
    const head = s.git('commit-tree', `${normal}^{tree}`, '-p', base, '-m', 'the change')
    s.git('checkout', '-q', '--detach', head)
    s.origin('main', base)
    expect(() =>
      prepareHistory({
        dir: s.dir,
        out: s.out,
        number: 7,
        repo,
        pulls: [pull(7, head, 'crafted', 'main')],
        closed: []
      })
    ).toThrow(`unsafe path in the tree of ${base}: ${JSON.stringify(`dir/${name}`)}`)
    expect(readdirSync(s.out)).toEqual([])
    expect(readdirSync(s.root).sort()).toEqual(['in', 'pr'])
  })

  it('fails when git answers a request for a file with anything but that file', () => {
    const s = keep(stacked())
    const bin = join(s.root, 'bin')
    mkdirSync(bin)
    const real = spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim()
    writeFileSync(
      join(bin, 'git'),
      `#!/usr/bin/env bash
for arg in "$@"; do
  if [ "$arg" = cat-file ] && [ "\${!#}" = --batch ]; then
    while read -r id; do echo "$id missing"; done
    exit 0
  fi
done
exec ${real} "$@"
`
    )
    chmodSync(join(bin, 'git'), 0o755)
    vi.stubEnv('PATH', `${bin}:${process.env.PATH}`)
    expect(() => s.prepare()).toThrow('git cat-file gave no blob for "base.txt"')
    expect(existsSync(join(s.out, 'base-tree', 'base.txt'))).toBe(false)
  })

  it('fails over the tree size limit, naming it, before it writes anything', () => {
    const s = keep(stacked())
    expect(MAX_TREE_BYTES).toBe(512 * 1024 * 1024)
    expect(() => s.prepare({ maxTreeBytes: 9 })).toThrow(
      `the tree at ${s.m1} is 10 bytes, over the limit of 9`
    )
    expect(readdirSync(s.out)).toEqual([])
    s.prepare({ maxTreeBytes: 13 })
    expect(existsSync(join(s.out, 'base-branch-tree', 'parent.txt'))).toBe(true)
  })
})

describe('history failures stop the pass', () => {
  it('fails when the pull request is not among the open ones', () => {
    const s = keep(stacked())
    expect(() => s.prepare({ pulls: [s.pulls[0]] })).toThrow(
      'pull request #11 is not among the open pull requests'
    )
  })

  it('fails when no pull request is open', () => {
    const s = keep(stacked())
    expect(() => s.prepare({ pulls: [] })).toThrow('not among the open pull requests')
  })

  it.each([null, {}, 'none'])('fails when the open pull requests are not a list: %j', (pulls) => {
    const s = keep(stacked())
    expect(() => s.prepare({ pulls })).toThrow('no list of open pull requests')
  })

  it.each([null, {}, undefined])(
    'fails when the recently closed pull requests are not a list: %j',
    (closed) => {
      const s = keep(stacked())
      expect(() => s.prepare({ closed })).toThrow('no list of recently closed pull requests')
      expect(existsSync(join(s.out, 'commits.json'))).toBe(false)
    }
  )

  it('fails when the base branch is not in the checkout', () => {
    const s = keep(stacked())
    expect(() => s.prepare({ pulls: [pull(11, s.c2, 'child', 'absent')] })).toThrow(
      'the checkout has no refs/remotes/origin/absent'
    )
    expect(existsSync(join(s.out, 'commits.json'))).toBe(false)
  })

  it.each(['', 'a..b', 'x^{/y}', 'a b', undefined])(
    'fails when the base branch name is not a branch name: %j',
    (name) => {
      const s = keep(stacked())
      const mine = pull(11, s.c2, 'child', 'parent', { base: { ref: name } })
      expect(() => s.prepare({ pulls: [mine] })).toThrow('unusable base branch name')
    }
  )

  it('fails when the head has no commit past main', () => {
    const s = keep(stacked())
    s.origin('main', s.c2)
    expect(() => s.prepare()).toThrow('the head has no commit past the merge base with main')
  })

  it('fails over the commit limit, naming it, instead of listing some', () => {
    const s = keep(stacked())
    expect(MAX_COMMITS).toBe(300)
    expect(() => s.prepare({ maxCommits: 4 })).toThrow('5 commits past main, over the limit of 4')
    expect(existsSync(join(s.out, 'commits.json'))).toBe(false)
    s.prepare({ maxCommits: 5 })
    expect(s.commits().commits).toHaveLength(5)
  })

  it('fails when the head shares no history with its base branch', () => {
    const s = keep(stacked())
    s.git('checkout', '-q', '--orphan', 'island')
    const lone = s.commit('island.txt', 'i\n', 'unrelated root')
    s.git('checkout', '-q', 'child')
    s.origin('island', lone)
    expect(() => s.prepare({ pulls: [pull(11, s.c2, 'child', 'island')] })).toThrow(
      'the head has no merge base with the base branch'
    )
    expect(readdirSync(s.out)).toEqual([])
  })

  it('fails, naming the commit, when git cannot compute a merge', () => {
    const s = keep(stacked())
    const bin = join(s.root, 'bin')
    mkdirSync(bin)
    const real = spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim()
    writeFileSync(
      join(bin, 'git'),
      `#!/usr/bin/env bash
for arg in "$@"; do
  if [ "$arg" = merge-tree ]; then echo "fatal: unable to read tree" >&2; exit 128; fi
done
exec ${real} "$@"
`
    )
    chmodSync(join(bin, 'git'), 0o755)
    vi.stubEnv('PATH', `${bin}:${process.env.PATH}`)
    expect(() => s.prepare()).toThrow(
      `git merge-tree failed for ${s.mg}: fatal: unable to read tree`
    )
    expect(existsSync(join(s.out, 'commits.json'))).toBe(false)
    expect(existsSync(join(s.out, '.objects'))).toBe(false)
  })

  // The checkout lacks a file's contents: the step says which file before it writes anything.
  it('fails before it writes anything when the tree names a blob the checkout lacks', () => {
    const s = keep(stacked())
    const blob = s.git('rev-parse', `${s.m1}:main.txt`)
    rmSync(join(s.dir, '.git', 'objects', blob.slice(0, 2), blob.slice(2)))
    expect(() => s.prepare()).toThrow(
      `the tree at ${s.m1} names a blob the checkout does not hold: "main.txt"`
    )
    expect(readdirSync(s.out)).toEqual([])
  })

  it('fails when the head shares no history with main', () => {
    const s = keep(stacked())
    s.git('checkout', '-q', '--orphan', 'island')
    const lone = s.commit('island.txt', 'i\n', 'unrelated root')
    expect(() => s.prepare({ pulls: [pull(11, lone, 'island', 'main')] })).toThrow('no merge base')
  })
})

describe('what the pull request controls stays data', () => {
  // The marker a program would leave behind if git, or a shell, ever ran one.
  const marker = (s: { root: string }) => join(s.root, 'ran')

  it('reads a base branch and a file whose names carry shell syntax as names', () => {
    const s = keep(scratch())
    const base = s.commit('base.txt', 'base\n', 'base')
    s.origin('main', base)
    const branch = `$(touch\${IFS}${marker(s)})`
    const file = '-rf $(touch ran);\nsecond line'
    s.git('checkout', '-q', '-b', 'lower')
    const lower = s.commit('lower.txt', 'l\n', 'lower change')
    s.origin(branch, lower)
    const head = s.commit(file, 'f\n', 'odd file name; $(touch ran) `touch ran`')
    prepareHistory({
      dir: s.dir,
      out: s.out,
      number: 7,
      repo,
      pulls: [pull(7, head, 'odd', branch)],
      closed: []
    })
    expect(s.stack().base).toBe(branch)
    const last = s.commits().commits.at(-1)
    expect(last?.files).toEqual([{ status: 'A', path: file }])
    expect(last?.subject).toBe('odd file name; $(touch ran) `touch ran`')
    expect(existsSync(marker(s))).toBe(false)
    expect(readdirSync(s.root).sort()).toEqual(['in', 'pr'])
  })

  // The checkout's own configuration is not the pull request's to write. Were it ever to name a
  // diff program, the step still would not run it.
  it('runs no external diff and no textconv program the repository configures', () => {
    const s = keep(stacked())
    const program = join(s.root, 'program')
    writeFileSync(program, `#!/usr/bin/env bash\ntouch ${marker(s)}\ncat "$1" 2>/dev/null\n`)
    chmodSync(program, 0o755)
    writeFileSync(join(s.dir, '.gitattributes'), '* diff=fleet\n')
    s.git('add', '--', '.gitattributes')
    s.git('commit', '-q', '-m', 'attributes')
    const head = s.git('rev-parse', 'HEAD')
    s.git('config', 'diff.external', program)
    s.git('config', 'diff.fleet.textconv', program)
    s.git('config', 'diff.fleet.command', program)
    s.prepare({ pulls: [s.pulls[0], pull(11, head, 'child', 'parent')] })
    expect(existsSync(marker(s))).toBe(false)
    expect(s.read('diff-base.patch')).toContain('+++ b/child.txt')
    // The control: the same configuration does run the program for a plain `git diff`.
    s.git('diff', s.p2, head)
    expect(existsSync(marker(s))).toBe(true)
  })

  // A `.gitattributes` is the pull request's to write. It must neither mark a file as binary,
  // which would empty its hunks from the patch that sets the review scope, nor choose the
  // program a merge runs.
  it('takes no attribute from the tree: no hunk is emptied and no merge driver runs', () => {
    const s = keep(scratch())
    const ran = marker(s)
    const program = join(s.root, 'program')
    writeFileSync(program, `#!/usr/bin/env bash\ntouch ${ran}\nexit 1\n`)
    chmodSync(program, 0o755)
    const lines = (middle: string) => `top\n${'x\n'.repeat(8)}${middle}\n${'y\n'.repeat(8)}end\n`
    const base = s.commit('shared.txt', lines('middle'), 'base')
    s.git('checkout', '-q', '-b', 'lower')
    const lower = s.commit('lower.txt', 'l\n', 'lower change')
    s.git('checkout', '-q', '-b', 'child')
    writeFileSync(join(s.dir, '.gitattributes'), '*.txt -diff merge=fleet\n')
    s.git('add', '--', '.gitattributes')
    s.commit('shared.txt', lines('middle').replace('top', 'top, edited by the child'), 'child')
    s.git('checkout', '-q', 'main')
    const main = s.commit('shared.txt', lines('middle').replace('end', 'end, on main'), 'main')
    s.git('checkout', '-q', 'child')
    s.git('merge', '-q', '--no-ff', '-m', 'merge main', 'main')
    const head = s.git('rev-parse', 'HEAD')
    s.origin('main', main)
    s.origin('lower', lower)
    s.git('config', 'merge.fleet.driver', `${program} %A %O %B`)
    prepareHistory({
      dir: s.dir,
      out: s.out,
      number: 7,
      repo,
      pulls: [pull(7, head, 'child', 'lower')],
      closed: []
    })
    expect(existsSync(ran)).toBe(false)
    const { commits } = s.commits()
    expect(commits.at(-1)?.auto_merge).toBe('identical')
    const child = commits.find((c) => c.subject === 'child')
    expect(s.read(child?.patch ?? '')).toContain('+top, edited by the child')
    expect(s.read('diff-base.patch')).toContain('+top, edited by the child')
    for (const c of commits) expect(s.read(c.patch)).not.toContain('Binary files')
    expect(s.read('diff-base.patch')).not.toContain('Binary files')
    // The controls: the same repository does both things to a plain git command.
    expect(s.git('diff', base, head, '--', 'shared.txt')).toContain('Binary files')
    expect(s.run('merge-tree', '--write-tree', `${head}^1`, `${head}^2`).status).toBe(1)
    expect(existsSync(ran)).toBe(true)
  })

  it('gives git neither token', () => {
    const s = keep(stacked())
    const bin = join(s.root, 'bin')
    mkdirSync(bin)
    const real = spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim()
    const log = join(s.root, 'git-env.log')
    writeFileSync(join(bin, 'git'), `#!/usr/bin/env bash\nenv >> ${log}\nexec ${real} "$@"\n`)
    chmodSync(join(bin, 'git'), 0o755)
    vi.stubEnv('PATH', `${bin}:${process.env.PATH}`)
    vi.stubEnv('GH_TOKEN', 'ghs_notatoken000000')
    vi.stubEnv('CLAUDE_CODE_OAUTH_TOKEN', 'sk-ant-notatoken000000')
    s.prepare()
    const seen = readFileSync(log, 'utf8')
    expect(seen).toContain('GIT_CONFIG_GLOBAL=/dev/null')
    expect(seen).not.toContain('notatoken')
    expect(seen).not.toMatch(/TOKEN/)
  })
})

// The literal command leg.sh runs, with a `gh` that answers the list of open pull requests.
describe('the history command', () => {
  const command = (
    s: ReturnType<typeof stacked>,
    pulls: unknown,
    number = '11',
    closed: unknown = []
  ) => {
    const bin = join(s.root, 'bin')
    mkdirSync(bin)
    writeFileSync(join(s.root, 'pulls.json'), JSON.stringify(pulls))
    writeFileSync(join(s.root, 'closed.json'), JSON.stringify(closed))
    writeFileSync(
      join(bin, 'gh'),
      `#!/usr/bin/env bash
echo "$*" >> "${join(s.root, 'gh.log')}"
[ -n "\${GH_FAIL:-}" ] && { echo "gh: Server Error (HTTP 502)" >&2; exit 1; }
case "$2" in
  *state=closed*) cat "${join(s.root, 'closed.json')}" ;;
  *) cat "${join(s.root, 'pulls.json')}" ;;
esac
`
    )
    chmodSync(join(bin, 'gh'), 0o755)
    return (env = {}, out = s.out, cwd?: string) =>
      spawnSync('node', [HISTORY, repo, number, s.dir, out], {
        encoding: 'utf8',
        cwd,
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          GIT_CONFIG_GLOBAL: '/dev/null',
          ...env
        }
      })
  }

  it('writes the history from one read of the open and one of the closed pull requests', () => {
    const s = keep(stacked())
    const r = command(s, [s.pulls])()
    expect(r.status, r.stderr).toBe(0)
    expect(readdirSync(s.out).sort()).toEqual([
      'base-branch-tree',
      'base-tree',
      'commits',
      'commits.json',
      'diff-base.patch',
      'scope.json',
      'stack.json'
    ])
    expect(readFileSync(join(s.root, 'gh.log'), 'utf8').trim().split('\n')).toEqual([
      `api repos/${repo}/pulls?state=open&per_page=100 --paginate --slurp`,
      `api repos/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=100`
    ])
  })

  it('exits non-zero and writes nothing when the closed pull requests are not a list', () => {
    const s = keep(stacked())
    const r = command(s, [s.pulls], '11', { message: 'Not Found' })()
    expect(r.status).not.toBe(0)
    expect(r.stderr).toContain('no list of recently closed pull requests')
    expect(readdirSync(s.out)).toEqual([])
  })

  // The automatic merge of an `ours` merge is a new tree, which git writes under the inputs
  // directory: a relative one must mean the same place to git as to this process.
  it('writes the history into an inputs directory given as a relative path', () => {
    const s = keep(stacked())
    s.git('checkout', '-q', '-b', 'side', s.m1)
    s.commit('side.txt', 's\n', 'side change')
    s.git('checkout', '-q', 'child')
    s.git('merge', '-q', '-s', 'ours', '-m', 'merge side, keeping ours', 'side')
    const head = s.git('rev-parse', 'HEAD')
    const r = command(s, [[s.pulls[0], pull(11, head, 'child', 'parent')]])({}, 'in', s.root)
    expect(r.status, r.stderr).toBe(0)
    expect(s.commits().commits.at(-1)).toMatchObject({ oid: head, auto_merge: 'differs' })
    expect(existsSync(join(s.out, '.objects'))).toBe(false)
    expect(existsSync(join(s.dir, 'in'))).toBe(false)
  })

  it('exits non-zero and writes nothing when the read fails', () => {
    const s = keep(stacked())
    const r = command(s, [s.pulls])({ GH_FAIL: '1' })
    expect(r.status).not.toBe(0)
    expect(r.stderr).toContain('HTTP 502')
    expect(readdirSync(s.out)).toEqual([])
  })

  it.each(['', 'eleven', '11; touch ran'])(
    'exits non-zero for a pull request number that is not a number: %j',
    (number) => {
      const s = keep(stacked())
      const r = command(s, [s.pulls], number)()
      expect(r.status).not.toBe(0)
      expect(r.stderr).toContain('usage: history.mjs')
      expect(existsSync(join(s.root, 'gh.log'))).toBe(false)
    }
  )
})
