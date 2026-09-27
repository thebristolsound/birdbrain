import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  buildDispatchWorkspace,
  dispatchPrompt,
  installGhShim,
  parseVerdictComment
  // @ts-expect-error - tooling script with no type declarations; the tsconfigs exclude scripts/
} from '../../scripts/bench/review/lib/dispatch.mjs'
// @ts-expect-error - tooling script with no type declarations; the tsconfigs exclude scripts/
import { main, parseArgs } from '../../scripts/bench/review/run.mjs'

const line = (o: unknown) => JSON.stringify(o)
const SHIM = join(process.cwd(), 'scripts/bench/review/lib/gh-shim.mjs')

describe('parseVerdictComment', () => {
  const comment = [
    '**Review verdict: request changes**',
    '',
    '1. The change deletes data it should keep.',
    '2. One claim in the description is untrue.',
    '',
    '<details>',
    '<summary>Full report</summary>',
    '',
    'Reviewed commit: abc',
    '',
    '| # | severity | file:line | finding |',
    '|---|---|---|---|',
    '| 1 | blocking | src/a.ts:12 | `sweep` deletes the wrong folder |',
    '| 2 | advisory | PR body, Evidence impact | overclaims the restore path |',
    '| 3 | gate | tests/b.test.ts:4-9 | the trailer is present |',
    '| 4 | advisory | – | style only |',
    '| 5 | pass | src/c.ts | attribution line present |',
    '',
    '</details>',
    ''
  ].join('\n')

  it('reads the verdict and the report table, mapping severities to blocking', () => {
    const r = parseVerdictComment(comment)
    expect(r.verdict).toBe('request changes')
    expect(r.source).toBe('table')
    expect(r.findings).toEqual([
      {
        file: 'src/a.ts',
        line: 12,
        quote: null,
        summary: 'sweep deletes the wrong folder',
        blocking: true
      },
      {
        file: 'PR_BODY',
        line: null,
        quote: null,
        summary: 'overclaims the restore path',
        blocking: false
      },
      {
        file: 'tests/b.test.ts',
        line: 4,
        quote: null,
        summary: 'the trailer is present',
        blocking: true
      },
      { file: null, line: null, quote: null, summary: 'style only', blocking: false }
    ])
  })

  it('falls back to the top layer when the report has no table', () => {
    const r = parseVerdictComment(
      '**Review verdict: approve for human review**\n\n1. Fine.\n2. Also fine.\n'
    )
    expect(r.source).toBe('top')
    expect(r.findings.map((f: { blocking: boolean }) => f.blocking)).toEqual([false, false])
    expect(parseVerdictComment('no verdict here')).toBeNull()
    expect(parseVerdictComment('**Review verdict: maybe**')).toBeNull()
    expect(parseVerdictComment(null)).toBeNull()
  })
})

describe('gh stand-in', () => {
  let fixture: string
  let log: string
  const run = (...args: string[]) =>
    spawnSync('node', [SHIM, ...args], {
      encoding: 'utf8',
      env: { ...process.env, BENCH_GH_FIXTURE: fixture, BENCH_GH_LOG: log }
    })

  beforeAll(() => {
    fixture = mkdtempSync(join(tmpdir(), 'bench-gh-'))
    log = join(fixture, 'calls.jsonl')
    writeFileSync(
      join(fixture, 'pr.json'),
      line({
        number: 42,
        title: 'feat: thing',
        body: `Closes #7\n\nVerified at ${'a'.repeat(40)} (short ${'a'.repeat(8)}); unrelated abc1234 stays.`,
        url: 'https://example.test/pull/42',
        state: 'MERGED',
        isDraft: false,
        headRefOid: 'a'.repeat(40),
        baseRefOid: 'b'.repeat(40),
        headRefName: 'agent/7-thing',
        baseRefName: 'main',
        labels: [{ name: 'agent-authored' }, { name: 'evidence-affecting' }],
        mergeCommit: null,
        author: { login: 'bot' }
      })
    )
    writeFileSync(join(fixture, 'case.json'), line({ id: 'x', source: { pr: 42 } }))
    writeFileSync(
      join(fixture, 'diff.patch'),
      '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-a\n+b\n'
    )
  })
  afterAll(() => rmSync(fixture, { recursive: true, force: true }))

  it('answers the reads the pre-pass makes from the fixture', () => {
    expect(run('api', 'repos/o/r/pulls/42', '--jq', '.head.sha').stdout.trim()).toBe('a'.repeat(40))
    expect(run('api', 'repos/o/r/pulls/42', '--jq', '.auto_merge').stdout.trim()).toBe('null')
    expect(
      JSON.parse(run('api', 'repos/o/r/issues/42/labels', '--jq', '[.[].name]').stdout)
    ).toEqual(['agent-authored', 'evidence-affecting'])
    expect(JSON.parse(run('api', 'repos/o/r/issues/7/labels').stdout)).toEqual([])
    const view = JSON.parse(
      run('pr', 'view', '42', '--json', 'title,headRefOid,labels,commits,autoMerge,nosuchfield')
        .stdout
    )
    expect(view.title).toBe('feat: thing')
    expect(view.labels).toHaveLength(2)
    expect(view.commits[0].oid).toBe('a'.repeat(40))
    expect(view.autoMerge).toBeNull()
    expect(view.nosuchfield).toBeNull()
    expect(run('pr', 'checks', '42').stdout).toContain('typecheck\tpass')
    expect(run('pr', 'diff', '42').stdout).toContain('+++ b/src/a.ts')
    expect(
      run('api', `repos/o/r/commits/${'a'.repeat(40)}/status`, '--jq', '.state').stdout.trim()
    ).toBe('success')
    const pinned = spawnSync(
      'node',
      [SHIM, 'api', 'repos/o/r/pulls/42', '--jq', '.head.sha + " " + .base.sha'],
      {
        encoding: 'utf8',
        env: {
          ...process.env,
          BENCH_GH_FIXTURE: fixture,
          BENCH_GH_HEAD: 'c'.repeat(40),
          BENCH_GH_BASE: 'd'.repeat(40)
        }
      }
    )
    expect(pinned.stdout.trim()).toBe(`${'c'.repeat(40)} ${'d'.repeat(40)}`)
    const body = spawnSync('node', [SHIM, 'pr', 'view', '42', '--json', 'body', '--jq', '.body'], {
      encoding: 'utf8',
      env: { ...process.env, BENCH_GH_FIXTURE: fixture, BENCH_GH_HEAD: 'c'.repeat(40) }
    }).stdout
    expect(body).toContain(`Verified at ${'c'.repeat(40)} (short ${'c'.repeat(8)})`)
    expect(body).toContain('abc1234 stays')
  })

  it('refuses writes, other PRs and unknown reads, and logs every call', () => {
    expect(run('api', 'repos/o/r/issues/42/comments', '-X', 'POST', '-f', 'body=hi').status).toBe(1)
    expect(run('pr', 'comment', '42', '--body-file', 'x').status).toBe(1)
    expect(run('api', 'repos/o/r/pulls/43').status).toBe(1)
    expect(run('run', 'view', '1').status).toBe(1)
    const calls = readFileSync(log, 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l))
    expect(calls.length).toBeGreaterThanOrEqual(12)
    expect(calls.filter((c) => c.outcome.startsWith('refused')).length).toBe(4)
  })
})

describe('dispatch workspace and runner', () => {
  let root: string
  let repo: string
  let fixtures: string
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 't',
        GIT_AUTHOR_EMAIL: 't@t',
        GIT_COMMITTER_NAME: 't',
        GIT_COMMITTER_EMAIL: 't@t'
      }
    }).trim()
  let base: string
  let head: string

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'bench-dispatch-'))
    repo = join(root, 'repo')
    mkdirSync(join(repo, 'src'), { recursive: true })
    git(repo, 'init', '-q', '-b', 'main')
    writeFileSync(join(repo, 'src', 'a.ts'), 'one\ntwo\n')
    mkdirSync(join(repo, '.claude', 'agents'), { recursive: true })
    writeFileSync(join(repo, '.claude', 'agents', 'birdbrain-reviewer.md'), 'old reviewer\n')
    writeFileSync(join(repo, 'CLAUDE.md'), 'old rules\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'base')
    base = git(repo, 'rev-parse', 'HEAD')
    writeFileSync(join(repo, 'src', 'a.ts'), 'one\ntwo\nthree\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'pr head')
    head = git(repo, 'rev-parse', 'HEAD')
    // Today's configuration, committed after the PR: the overlay source.
    writeFileSync(join(repo, '.claude', 'agents', 'birdbrain-reviewer.md'), 'new reviewer\n')
    mkdirSync(join(repo, '.claude', 'skills', 'dispatch'), { recursive: true })
    writeFileSync(join(repo, '.claude', 'skills', 'dispatch', 'SKILL.md'), 'dispatch skill\n')
    writeFileSync(join(repo, 'CLAUDE.md'), 'new rules\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-q', '-m', 'config update')
    mkdirSync(join(repo, 'node_modules'))
    fixtures = join(root, 'fixtures')
    const dir = join(fixtures, 'c-one')
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'case.json'),
      line({ id: 'c-one', kind: 'mutation', source: { pr: 42, base, head }, tags: [] })
    )
    writeFileSync(
      join(dir, 'truth.json'),
      line({
        verdict: 'request changes',
        defects: [
          {
            id: 'd',
            file: 'src/a.ts',
            lineStart: 3,
            lineEnd: 3,
            blocking: true,
            category: 'other',
            description: 'x'
          }
        ],
        refuted: []
      })
    )
    writeFileSync(join(dir, 'diff.patch'), 'diff\n')
    writeFileSync(join(dir, 'pr.md'), '# pr\n')
    writeFileSync(
      join(dir, 'pr.json'),
      line({
        number: 42,
        title: 'feat: thing',
        body: '',
        url: 'u',
        state: 'MERGED',
        isDraft: false,
        headRefOid: head,
        baseRefOid: base,
        headRefName: 'agent/42-thing',
        baseRefName: 'main',
        labels: [],
        author: { login: 'bot' }
      })
    )
    mkdirSync(join(dir, 'files', 'src'), { recursive: true })
    writeFileSync(join(dir, 'files', 'src', 'a.ts'), 'one\ntwo\nthree mutated\n')
  })
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  it('builds a clone whose refs carry the PR, the mutation and the overlay, with a dead remote', () => {
    const fixture = {
      id: 'c-one',
      source: { pr: 42, base, head },
      pr: { headRefName: 'agent/42-thing', title: 'feat: thing' },
      files: new Map([['src/a.ts', 'one\ntwo\nthree mutated\n']])
    }
    const dir = join(root, 'ws')
    const ws = buildDispatchWorkspace({ repo, fixture, dir })
    expect(ws.branch).toBe('agent/42-thing')
    expect(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('agent/42-thing')
    expect(git(dir, 'rev-parse', 'origin/main')).toBe(ws.base)
    expect(git(dir, 'rev-parse', 'origin/agent/42-thing')).toBe(ws.head)
    expect(git(dir, 'rev-parse', 'HEAD')).toBe(ws.head)
    const diff = git(dir, 'diff', 'origin/main...origin/agent/42-thing')
    expect(diff).toContain('+three mutated')
    expect(diff).not.toContain('reviewer')
    expect(readFileSync(join(dir, '.claude', 'agents', 'birdbrain-reviewer.md'), 'utf8')).toBe(
      'new reviewer\n'
    )
    expect(readFileSync(join(dir, 'CLAUDE.md'), 'utf8')).toBe('new rules\n')
    expect(git(dir, 'show', `${ws.base}:CLAUDE.md`)).toBe('new rules')
    expect(git(dir, 'log', '--format=%s', 'origin/main..HEAD')).toBe('feat: thing')
    expect(git(dir, 'remote', 'get-url', 'origin')).toBe('/nonexistent/bench-remote')
    expect(spawnSync('git', ['fetch', 'origin'], { cwd: dir }).status).not.toBe(0)
    expect(lstatSync(join(dir, 'node_modules')).isSymbolicLink()).toBe(true)
    // The test repo has no .gitignore, so the node_modules link shows as untracked.
    const dirty = git(dir, 'status', '--porcelain')
      .split('\n')
      .filter((l) => l && !l.includes('node_modules'))
    expect(dirty).toEqual([])
    // The same inputs give the same commit ids.
    const again = buildDispatchWorkspace({ repo, fixture, dir: join(root, 'ws2') })
    expect(again.head).toBe(ws.head)
  })

  it('installs a gh and agh stand-in and names both files in the prompt', () => {
    const bin = installGhShim(join(root, 'bin'))
    expect(readdirSync(bin).sort()).toEqual(['agh', 'gh'])
    expect(readFileSync(join(bin, 'gh'), 'utf8')).toContain('gh-shim.mjs')
    const p = dispatchPrompt({
      pr: 42,
      head: 'h'.repeat(40),
      commentFile: '/r/comment.md',
      reportFile: '/r/report.md'
    })
    expect(p.startsWith('/dispatch\n')).toBe(true)
    expect(p).toContain('PR #42')
    expect(p).toContain('/r/comment.md')
    expect(p).toContain('Post nothing')
  })

  it('parses the mode and pins the dispatch mode to tier L2', () => {
    expect(
      parseArgs(['--harness', 'claude', '--model', 'm', '--mode', 'dispatch', '--effort', 'low'])
    ).toMatchObject({ tier: 'L2', mode: 'dispatch', allowL2: true })
    expect(() =>
      parseArgs([
        '--harness',
        'claude',
        '--model',
        'm',
        '--mode',
        'dispatch',
        '--tier',
        'L1',
        '--effort',
        'low'
      ])
    ).toThrow(/L2/)
    expect(() =>
      parseArgs([
        '--harness',
        'claude',
        '--model',
        'm',
        '--mode',
        'other',
        '--tier',
        'L1',
        '--effort',
        'low'
      ])
    ).toThrow(/--mode/)
  })

  it('runs the dispatcher against the clone and grades the comment it wrote', () => {
    const results = join(root, 'results')
    const cache = join(root, 'cache')
    const calls: { cmd: string; args: string[]; opts: Record<string, unknown> }[] = []
    const exec = (cmd: string, args: string[], opts: Record<string, unknown>) => {
      calls.push({ cmd, args, opts })
      const ok = (stdout: string, stderr = '') => ({
        status: 0,
        signal: null,
        stdout,
        stderr,
        timedOut: false,
        error: null
      })
      if (args[0] === '--version') return ok('claude 1.0')
      if (args[0] === 'auth')
        return ok(
          line({ loggedIn: true, email: 'x@y', subscriptionType: 'max', configDirectory: '/c' })
        )
      const env = opts.env as Record<string, string>
      expect(
        existsSync(join(opts.cwd as string, '.claude', 'skills', 'dispatch', 'SKILL.md'))
      ).toBe(true)
      expect(env.PATH.split(':')[0]).toContain('/bin')
      expect(env.GH_TOKEN).toBe('benchmark-disabled')
      writeFileSync(
        env.BENCH_COMMENT_FILE,
        '**Review verdict: request changes**\n\n1. Bad.\n\n<details>\n<summary>Full report</summary>\n\n| # | severity | file:line | finding |\n|---|---|---|---|\n| 1 | blocking | src/a.ts:3 | mutated |\n\n</details>\n'
      )
      return ok(
        [
          line({
            type: 'system',
            subtype: 'init',
            tools: ['Bash'],
            agents: ['birdbrain-reviewer']
          }),
          line({
            type: 'result',
            subtype: 'success',
            is_error: false,
            num_turns: 4,
            duration_ms: 9,
            usage: {},
            permission_denials: [],
            result: 'DONE'
          })
        ].join('\n')
      )
    }
    const code = main(
      [
        '--harness',
        'claude',
        '--model',
        'm',
        '--mode',
        'dispatch',
        '--effort',
        'low',
        '--reps',
        '1',
        '--pause',
        '0'
      ],
      {
        exec,
        log: () => {},
        env: { PATH: '/usr/bin' },
        repo,
        dirs: { fixtures, results, cache },
        sleep: () => {}
      }
    )
    expect(code).toBe(0)
    const run = calls.find((c) => c.args[0] === '-p')
    expect(run?.args).toContain('--dangerously-skip-permissions')
    expect(run?.args).not.toContain('--json-schema')
    const dir = readdirSync(results)[0]
    const manifest = JSON.parse(readFileSync(join(results, dir, 'manifest.json'), 'utf8'))
    expect(manifest).toMatchObject({ mode: 'dispatch', tier: 'L2', placement: 'checkout' })
    expect(manifest.dispatchSkill).toHaveLength(64)
    const row = JSON.parse(readFileSync(join(results, dir, 'rows.jsonl'), 'utf8').trim())
    expect(row).toMatchObject({ status: 'ok', mode: 'dispatch', outputSource: 'comment:table' })
    expect(row.output.findings[0]).toMatchObject({ file: 'src/a.ts', line: 3, blocking: true })
    expect(existsSync(join(results, dir, 'rows', 'c-one-r1', 'comment.md'))).toBe(true)
    expect(existsSync(join(cache, 'dispatch'))).toBe(true)
    expect(readdirSync(join(cache, 'dispatch'))).toEqual([])
  })
})
