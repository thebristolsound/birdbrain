import { spawnSync } from 'child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import {
  CODEX,
  FINDER_LEGS,
  RELAY_MARK,
  decide,
  mergeFinders,
  renderState,
  scopeCovers,
  treeEntries
  // @ts-expect-error - workflow script with no declarations
} from '../.github/scripts/review-fleet/fleet.mjs'
import {
  STACKED_REVIEW,
  decide as gate,
  fleetVerdict
  // @ts-expect-error - workflow script with no declarations
} from '../.github/scripts/merge/gate.mjs'

const SHA = 'a'.repeat(40)
const FROM = 'b'.repeat(40)
const MACHINE = 'birdbrain-agent'
const MAINTAINER = 'thebristolsound'
const REPO = 'thebristolsound/birdbrain'
const FLEET = join(__dirname, '..', '.github', 'scripts', 'review-fleet', 'fleet.mjs')

const output = {
  contract_version: 2,
  source_review_complete: true,
  not_checked: [],
  runtime_limitations: [],
  findings: []
}
const outputs = Object.fromEntries((FINDER_LEGS as string[]).map((l) => [l, output]))
const claimed = { v: 1, sha: SHA, startedAt: '2026-11-11T05:00:00Z' }
const whole = { base: 'main', from: FROM }
const narrow = { base: 'fix/the-parent', from: FROM }
const scopes = (scope: unknown, over: Record<string, unknown> = {}) => ({
  ...Object.fromEntries((FINDER_LEGS as string[]).map((l) => [l, scope])),
  ...over
})
const reviewed = (scope: unknown) => mergeFinders(claimed, outputs, scopes(scope))
// A head whose passes are done, whose relay went out and which Codex answered with no finding.
const judge = (state: unknown, facts: Record<string, unknown> = {}) =>
  decide({
    state,
    now: '2026-11-11T06:00:00Z',
    breakGlass: false,
    relay: { id: 1, at: '2026-11-11T05:30:00Z' },
    codexDone: true,
    codexTimeout: 45,
    rulings: {},
    codexFindings: [],
    ...facts
  })
const PASSED = 'no confirmed blocking finding (0 blocking raised and refuted)'
const OWED =
  'owed a review: the base is now main and the earlier review read only the change above its old base'

describe('the scope a review read is saved with it', () => {
  it('saves the base and the commit the passes measured their scope from', () => {
    expect(reviewed(narrow).claude.scope).toEqual(narrow)
    expect(reviewed(whole).claude.scope).toEqual(whole)
    expect(reviewed(narrow).claude.legs).toEqual(
      Object.fromEntries((FINDER_LEGS as string[]).map((l) => [l, 'done']))
    )
  })

  it.each([
    [undefined],
    [null],
    [{}],
    [{ base: 'main' }],
    [{ base: '', from: FROM }],
    [{ base: 'main', from: 'abc' }],
    [{ base: 7, from: FROM }],
    ['main']
  ])('fails a pass whose output carries no usable scope: %j', (scope) => {
    const merged = mergeFinders(claimed, outputs, scopes(whole, { claims: scope }))
    expect(merged.claude.legs).toMatchObject({ correctness: 'done', claims: 'failed' })
    expect(judge(merged).status).toBe('failure')
  })

  it('fails every pass when none says what it read', () => {
    const merged = mergeFinders(claimed, outputs)
    expect(Object.values(merged.claude.legs)).toEqual(['failed', 'failed', 'failed', 'failed'])
    expect(merged.claude.scope).toBeUndefined()
    expect(judge(merged).status).toBe('failure')
  })

  it.each([[{ base: 'main', from: FROM }], [{ base: 'fix/the-parent', from: 'c'.repeat(40) }]])(
    'fails a pass that read another scope than the first: %j',
    (other) => {
      const merged = mergeFinders(claimed, outputs, scopes(narrow, { tests: other }))
      expect(merged.claude.legs).toMatchObject({ correctness: 'done', tests: 'failed' })
      expect(merged.claude.scope).toEqual(narrow)
      expect(judge(merged, { base: 'fix/the-parent' }).status).toBe('failure')
    }
  )

  it.each([[null], ['main'], [{ base: 'main' }], [{ base: 'x', from: 'not a commit' }]])(
    'fails a saved review whose scope is malformed: %j',
    (scope) => {
      const state = reviewed(whole)
      state.claude.scope = scope
      expect(judge(state, { base: 'main', covers: true })).toMatchObject({
        status: 'failure',
        description: 'the saved source review is malformed'
      })
    }
  )
})

describe('a review of a stacked change counts only for what it read', () => {
  it('passes a stacked head under a description that says the review was the narrow one', () => {
    const v = judge(reviewed(narrow), { base: 'fix/the-parent' })
    expect(v).toMatchObject({ status: 'success', description: `${STACKED_REVIEW}${PASSED}` })
    expect(v.description.length).toBeLessThanOrEqual(140)
  })

  it('keeps the review once the base is main and main holds everything below it', () => {
    expect(judge(reviewed(narrow), { base: 'main', covers: true })).toMatchObject({
      status: 'success',
      description: PASSED,
      owed: null
    })
  })

  it.each([[false], [null], [undefined], ['yes'], [1]])(
    'owes a review once the base is main and coverage is %j',
    (covers) => {
      expect(judge(reviewed(narrow), { base: 'main', covers })).toEqual({
        status: 'pending',
        description: OWED,
        owed: 'review',
        reasons: []
      })
    }
  )

  it.each([[undefined], [null], [''], [7]])(
    'owes a review when the base it is asked about is %j',
    (base) => {
      expect(judge(reviewed(narrow), { base })).toMatchObject({ status: 'pending', owed: 'review' })
      expect(judge(reviewed(narrow), { base, covers: true }).status).toBe('success')
    }
  )

  it('owes a review in place of a failure the narrow review ended with', () => {
    const failed = mergeFinders(
      claimed,
      { ...outputs, claims: { ...output, not_checked: ['one thing'] } },
      scopes(narrow)
    )
    expect(judge(failed, { base: 'fix/the-parent' }).status).toBe('failure')
    expect(judge(failed, { base: 'main', covers: false })).toMatchObject({ owed: 'review' })
  })

  it('lets the override stand over a narrow review', () => {
    expect(judge(reviewed(narrow), { base: 'main', covers: false, breakGlass: true }).status).toBe(
      'success'
    )
  })

  it('counts a review of the whole diff whatever the base is now', () => {
    for (const base of ['main', 'fix/the-parent', undefined])
      expect(judge(reviewed(whole), { base, covers: false })).toMatchObject({
        status: 'success',
        description: PASSED
      })
  })

  // A review saved before scopes were recorded read the whole diff against main, the only scope
  // there was, and a pass that says nothing of its scope can no longer be saved as done.
  it('counts a review saved before scopes were recorded', () => {
    const before = reviewed(whole)
    delete before.claude.scope
    expect(judge(before, { base: 'main', covers: false })).toMatchObject({
      status: 'success',
      description: PASSED
    })
  })

  it('waits on a head whose new review is still running', () => {
    expect(judge(claimed, { base: 'main', covers: false })).toMatchObject({
      status: 'pending',
      description: 'Claude passes running',
      owed: null
    })
  })
})

// A tree as a commit holds it: path to contents. `m` is the merge base of main and the head.
const tree = (files: Record<string, string>) =>
  new Map(Object.entries(files).map(([path, text]) => [path, `100644 ${text}`]))
const covers = (trees: Record<'fork' | 'main' | 'head' | 'from', Record<string, string> | null>) =>
  scopeCovers(
    Object.fromEntries(Object.entries(trees).map(([name, files]) => [name, files && tree(files)]))
  )

describe('whether main already holds everything below a stacked change', () => {
  const fork = { 'app.ts': 'v1', 'other.ts': 'o1' }

  it('covers a child whose parent merged by squash, though main has moved elsewhere', () => {
    expect(
      covers({
        fork,
        // The parent's change to app.ts landed, and someone else changed other.ts since.
        main: { 'app.ts': 'parent', 'other.ts': 'o2', 'new-on-main.ts': 'n' },
        from: { 'app.ts': 'parent', 'other.ts': 'o1' },
        head: { 'app.ts': 'parent', 'other.ts': 'o1', 'README.md': 'child' }
      })
    ).toBe(true)
  })

  it('covers a child that edits a file its merged parent also edited', () => {
    expect(
      covers({
        fork,
        main: { 'app.ts': 'parent', 'other.ts': 'o1' },
        from: { 'app.ts': 'parent', 'other.ts': 'o1' },
        head: { 'app.ts': 'parent+child', 'other.ts': 'o1' }
      })
    ).toBe(true)
  })

  // The parent's review removed bypass.ts after the child was cut; the child never took that in.
  it('does not cover a file the parent dropped before it merged', () => {
    expect(
      covers({
        fork,
        main: { 'app.ts': 'v1', 'other.ts': 'o1' },
        from: { 'app.ts': 'v1', 'other.ts': 'o1', 'bypass.ts': 'return true' },
        head: { 'app.ts': 'v1', 'other.ts': 'o1', 'bypass.ts': 'return true', 'README.md': 'c' }
      })
    ).toBe(false)
  })

  it('does not cover a base branch whose change never reached main', () => {
    expect(
      covers({
        fork,
        main: fork,
        from: { 'app.ts': 'return true', 'other.ts': 'o1' },
        head: { 'app.ts': 'return true', 'other.ts': 'o1', 'docs.md': 'd' }
      })
    ).toBe(false)
  })

  it('does not cover a file that main and the head both changed, differently', () => {
    expect(
      covers({
        fork,
        main: { 'app.ts': 'parent, then edited on main', 'other.ts': 'o1' },
        from: { 'app.ts': 'parent', 'other.ts': 'o1' },
        head: { 'app.ts': 'parent+child', 'other.ts': 'o1' }
      })
    ).toBe(false)
  })

  it('does not cover a file the head deletes that main holds in another form', () => {
    expect(
      covers({
        fork,
        main: { 'app.ts': 'v1', 'other.ts': 'o2' },
        from: { 'app.ts': 'v1', 'other.ts': 'o1' },
        head: { 'app.ts': 'v1' }
      })
    ).toBe(false)
    expect(
      covers({
        fork,
        main: fork,
        from: fork,
        head: { 'app.ts': 'v1' }
      })
    ).toBe(true)
  })

  it('reads a change of file mode as a change', () => {
    const exec = new Map([['run.sh', '100755 s1']])
    const plain = new Map([['run.sh', '100644 s1']])
    expect(scopeCovers({ fork: plain, main: plain, from: exec, head: exec })).toBe(false)
    expect(scopeCovers({ fork: plain, main: plain, from: plain, head: exec })).toBe(true)
  })

  it.each(['fork', 'main', 'head', 'from'] as const)(
    'does not cover when the tree at %s could not be read',
    (missing) => {
      const all = { fork, main: fork, from: fork, head: fork }
      expect(covers(all)).toBe(true)
      expect(covers({ ...all, [missing]: null })).toBe(false)
    }
  )

  it('reads a tree listing by path, and none that GitHub cut short', () => {
    const listing = {
      truncated: false,
      tree: [
        { path: 'src', mode: '040000', type: 'tree', sha: 't1' },
        { path: 'src/app.ts', mode: '100644', type: 'blob', sha: 's1' },
        { path: 'vendored', mode: '160000', type: 'commit', sha: 'c1' }
      ]
    }
    expect([...treeEntries(listing)]).toEqual([
      ['src/app.ts', '100644 s1'],
      ['vendored', '160000 c1']
    ])
    expect(treeEntries({ ...listing, truncated: true })).toBeNull()
    expect(treeEntries({ tree: listing.tree })).toBeNull()
    expect(treeEntries({ truncated: false })).toBeNull()
    expect(treeEntries(null)).toBeNull()
  })
})

describe('merge-gate and a narrow review', () => {
  const status = (description: string, state = 'success') => ({
    context: 'review/fleet',
    state,
    description,
    creator: { login: MACHINE }
  })
  const facts = (fleet: string) => ({
    headSha: SHA,
    author: MAINTAINER,
    machine: MACHINE,
    maintainer: MAINTAINER,
    files: [],
    labels: [],
    issueEvidence: [],
    prepass: 'absent',
    fleet,
    fleetRequired: true,
    breakGlass: false,
    approvalStamp: 'absent',
    reviews: []
  })

  it('does not read a narrow success as a review that passed', () => {
    expect(fleetVerdict([status(`${STACKED_REVIEW}${PASSED}`)], MACHINE)).toBe('stacked')
    expect(fleetVerdict([status(PASSED)], MACHINE)).toBe('success')
    expect(fleetVerdict([status(`${STACKED_REVIEW}${PASSED}`, 'failure')], MACHINE)).toBe('failure')
  })

  it('blocks the merge on it, and says why', () => {
    const v = gate(facts('stacked'))
    expect(v.pass).toBe(false)
    expect(v.reasons.join(' ')).toContain(
      'review/fleet read only this change above its base branch'
    )
    expect(gate(facts('success')).pass).toBe(true)
    expect(gate({ ...facts('stacked'), breakGlass: true }).pass).toBe(true)
  })

  it('reads the status the fleet posts for a stacked head as narrow', () => {
    const v = judge(reviewed(narrow), { base: 'fix/the-parent' })
    expect(fleetVerdict([status(v.description, v.status)], MACHINE)).toBe('stacked')
    const kept = judge(reviewed(narrow), { base: 'main', covers: true })
    expect(fleetVerdict([status(kept.description, kept.status)], MACHINE)).toBe('success')
  })
})

// `fleet.mjs gate` against a `gh` that answers from a table and records each status it is asked
// to post. The head has a finished narrow review; `base` is the pull request's base now.
describe('the status the fleet posts once the base changes', () => {
  const MAIN = 'c'.repeat(40)
  const FORK = 'd'.repeat(40)
  const listing = (files: Record<string, string>, truncated = false) => ({
    truncated,
    tree: Object.entries(files).map(([path, sha]) => ({ path, mode: '100644', type: 'blob', sha }))
  })
  const run = (base: string, trees: Record<string, unknown>) => {
    const dir = mkdtempSync(join(tmpdir(), 'fleet-scope-'))
    try {
      const state = reviewed(narrow)
      const paged = {
        [`repos/${REPO}/pulls/7`]: [
          {
            state: 'open',
            draft: false,
            labels: [],
            user: { login: MAINTAINER },
            head: { sha: SHA, repo: { full_name: REPO } },
            base: { ref: base }
          }
        ],
        [`repos/${REPO}/issues/7/comments?per_page=100`]: [
          {
            id: 7,
            user: { login: MACHINE },
            body: renderState(state, { status: 'pending', description: 'checking' })
          },
          {
            id: 8,
            user: { login: MAINTAINER },
            body: `<!-- ${RELAY_MARK} ${SHA} -->`,
            created_at: '2026-11-11T05:30:00Z'
          }
        ],
        [`repos/${REPO}/pulls/7/reviews?per_page=100`]: [
          { user: { login: CODEX }, commit_id: SHA, submitted_at: '2026-11-11T05:40:00Z' }
        ],
        [`repos/${REPO}/pulls/7/comments?per_page=100`]: [],
        [`repos/${REPO}/issues/7/events?per_page=100`]: [],
        [`repos/${REPO}/commits/${SHA}/statuses?per_page=100`]: [],
        [`repos/${REPO}/commits/${SHA}/check-runs?check_name=merge-gate&per_page=100`]: [
          { check_runs: [] }
        ]
      }
      const single = {
        [`repos/${REPO}/compare/main...${SHA}?per_page=1`]: {
          base_commit: { sha: MAIN },
          merge_base_commit: { sha: FORK }
        },
        ...Object.fromEntries(
          Object.entries(trees).map(([id, t]) => [`repos/${REPO}/git/trees/${id}?recursive=1`, t])
        )
      }
      writeFileSync(join(dir, 'data.json'), JSON.stringify({ paged, single }))
      writeFileSync(
        join(dir, 'gh'),
        `#!/usr/bin/env node
const fs = require('node:fs')
const a = process.argv.slice(2)
const { paged, single } = JSON.parse(fs.readFileSync(process.env.DATA, 'utf8'))
if (a.includes('-X')) {
  if (a[3].includes('/statuses/')) fs.appendFileSync(process.env.POSTED, JSON.stringify(a.filter((x) => /^(state|description)=/.test(x))) + '\\n')
  else fs.readFileSync(0, 'utf8')
  console.log('{}')
} else if (a.includes('--paginate')) {
  const path = a.at(-1)
  if (!(path in paged)) throw new Error('unexpected list read ' + path)
  console.log(JSON.stringify([paged[path]]))
} else {
  const path = a[1]
  fs.appendFileSync(process.env.READS, path + '\\n')
  if (single[path] === 'missing') { console.error('gh: Not Found (HTTP 404)'); process.exit(1) }
  if (!(path in single)) { console.error('gh: Server Error (HTTP 502)'); process.exit(1) }
  console.log(JSON.stringify(single[path]))
}
`
      )
      chmodSync(join(dir, 'gh'), 0o755)
      writeFileSync(join(dir, 'posted'), '')
      writeFileSync(join(dir, 'reads'), '')
      const r = spawnSync(process.execPath, [FLEET, 'gate', REPO, '7'], {
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH}`,
          DATA: join(dir, 'data.json'),
          POSTED: join(dir, 'posted'),
          READS: join(dir, 'reads'),
          MACHINE,
          MAINTAINER,
          REVIEW_FLEET_ENABLED: 'true'
        }
      })
      const lines = (name: string) =>
        readFileSync(join(dir, name), 'utf8').split('\n').filter(Boolean)
      return {
        status: r.status,
        stderr: r.stderr,
        posted: lines('posted').map((line) => JSON.parse(line)),
        reads: lines('reads').map((path) => path.replace(`repos/${REPO}/`, ''))
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }
  const fork = { 'app.ts': 'v1' }
  const landed = {
    [FORK]: listing(fork),
    [MAIN]: listing({ 'app.ts': 'parent', 'elsewhere.ts': 'm' }),
    [FROM]: listing({ 'app.ts': 'parent' }),
    [SHA]: listing({ 'app.ts': 'parent', 'README.md': 'child' })
  }

  it('posts the narrow success, and reads no tree, while the head is still stacked', () => {
    const r = run('fix/the-parent', {})
    expect(r.status, r.stderr).toBe(0)
    expect(r.posted).toEqual([['state=success', `description=${STACKED_REVIEW}${PASSED}`]])
    expect(r.reads).toEqual([])
  })

  it('posts a plain success once the base is main and main holds the parent', () => {
    const r = run('main', landed)
    expect(r.status, r.stderr).toBe(0)
    expect(r.posted).toEqual([['state=success', `description=${PASSED}`]])
    expect(r.reads).toEqual([
      `compare/main...${SHA}?per_page=1`,
      ...[FORK, MAIN, SHA, FROM].map((id) => `git/trees/${id}?recursive=1`)
    ])
  })

  it('posts that a review is owed when main does not hold what was below', () => {
    const r = run('main', { ...landed, [MAIN]: listing({ 'app.ts': 'v1' }) })
    expect(r.status, r.stderr).toBe(0)
    expect(r.posted).toEqual([['state=pending', `description=${OWED}`]])
  })

  it.each([
    ['cut short', listing({ 'app.ts': 'parent' }, true)],
    ['not there', 'missing']
  ])('posts that a review is owed when a tree is %s', (_, answer) => {
    const r = run('main', { ...landed, [FROM]: answer })
    expect(r.status, r.stderr).toBe(0)
    expect(r.posted).toEqual([['state=pending', `description=${OWED}`]])
  })

  it('posts nothing, and fails, when a tree cannot be read for another reason', () => {
    const { [FROM]: gone, ...rest } = landed
    void gone
    const r = run('main', rest)
    expect(r.status).not.toBe(0)
    expect(r.stderr).toContain('HTTP 502')
    expect(r.posted).toEqual([])
  })
})
