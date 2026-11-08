import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  existsSync
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  buildManifest,
  canonical,
  corpusHash,
  manifestHash
  // @ts-expect-error - tooling script with no type declarations; the tsconfigs exclude scripts/
} from '../../scripts/bench/review/lib/manifest.mjs'
// @ts-expect-error - tooling script with no type declarations; the tsconfigs exclude scripts/
import { agentBody, buildPrompt, renderPrompt } from '../../scripts/bench/review/lib/prompt.mjs'
import {
  claudeArgs,
  claudeToolSpec,
  jsonFromText,
  parseClaudeRun
  // @ts-expect-error - tooling script with no type declarations; the tsconfigs exclude scripts/
} from '../../scripts/bench/review/lib/claude.mjs'
import {
  codexArgs,
  codexToolSpec,
  codexLevels,
  parseCodexRun
  // @ts-expect-error - tooling script with no type declarations; the tsconfigs exclude scripts/
} from '../../scripts/bench/review/lib/codex.mjs'
// @ts-expect-error - tooling script with no type declarations; the tsconfigs exclude scripts/
import { pendingRows, settledKeys } from '../../scripts/bench/review/lib/resume.mjs'
// @ts-expect-error - tooling script with no type declarations; the tsconfigs exclude scripts/
import { main, parseArgs, selectCases } from '../../scripts/bench/review/run.mjs'

const line = (o: unknown) => JSON.stringify(o)

describe('manifest', () => {
  it('canonical JSON sorts keys at every depth', () => {
    expect(canonical({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[2,{"y":2,"z":1}]},"b":1}'
    )
  })

  it('the id depends on the inputs and not on their order', () => {
    const base = {
      harness: 'claude',
      harnessVersion: '2.1.282',
      model: 'm',
      effort: 'high',
      tier: 'L0',
      promptTemplate: 'p',
      agentDefinition: 'a',
      instructions: 'i',
      corpus: 'c'
    }
    const a = buildManifest(base)
    const b = buildManifest({ ...base, effort: 'low' })
    const c = buildManifest({ ...base, promptTemplate: 'p2' })
    expect(a.id).toHaveLength(16)
    expect(a.id).toBe(buildManifest(Object.fromEntries(Object.entries(base).reverse())).id)
    expect(new Set([a.id, b.id, c.id]).size).toBe(3)
    expect(manifestHash(a.manifest)).toBe(a.id)
    expect(a.manifest.promptTemplate).not.toBe('p')
  })

  it('refuses a manifest with no effort', () => {
    expect(() =>
      buildManifest({
        harness: 'claude',
        harnessVersion: 'v',
        model: 'm',
        tier: 'L0',
        promptTemplate: 'p',
        corpus: 'c'
      })
    ).toThrow(/effort/)
  })

  it('the corpus hash moves with a truth file or a head', () => {
    const fx = (head: string, verdict: string) =>
      new Map([['a', { id: 'a', source: { head }, truth: { verdict, defects: [], refuted: [] } }]])
    const h1 = corpusHash(fx('1'.repeat(40), 'request changes'))
    expect(h1).toBe(corpusHash(fx('1'.repeat(40), 'request changes')))
    expect(h1).not.toBe(corpusHash(fx('2'.repeat(40), 'request changes')))
    expect(h1).not.toBe(corpusHash(fx('1'.repeat(40), 'approve for human review')))
  })
  it('the corpus hash moves with the PR body', () => {
    const fx = (prBody: string | null) =>
      new Map([['a', { id: 'a', source: { head: '1'.repeat(40) }, prBody, truth: {} }]])
    expect(corpusHash(fx('one'))).toBe(corpusHash(fx('one')))
    expect(corpusHash(fx('one'))).not.toBe(corpusHash(fx('two')))
    expect(corpusHash(fx('one'))).not.toBe(corpusHash(fx(null)))
  })
})

describe('prompt', () => {
  const fixture = {
    id: 'x',
    source: { pr: 7, base: 'b'.repeat(40), head: 'h'.repeat(40) },
    diff: 'diff --git a/x b/x\n',
    prBody: '# title\n\nbody',
    files: new Map()
  }
  const template = readFileSync('scripts/bench/review/prompts/code-review.md', 'utf8')
  const definition = '---\nname: r\ntools: Read\n---\n\nYou are the reviewer.\n'

  it('renders every placeholder and refuses a missing one', () => {
    expect(renderPrompt('a {{x}} b', { x: '1' })).toBe('a 1 b')
    expect(() => renderPrompt('a {{x}}', {})).toThrow(/\{\{x\}\}/)
  })

  it('strips front matter from an agent definition', () => {
    expect(agentBody(definition)).toBe('You are the reviewer.')
    expect(agentBody('no front matter')).toBe('no front matter')
  })

  it('L0 carries the diff and the codex form carries the reviewer instructions', () => {
    const codex = buildPrompt({
      template,
      tier: 'L0',
      fixture,
      agentDefinition: definition,
      instructionsInPrompt: true
    })
    expect(codex).toContain('You are the reviewer.')
    expect(codex).toContain('diff --git a/x b/x')
    expect(codex).toContain('pull request #7')
    expect(codex).not.toMatch(/\{\{/)
    const claude = buildPrompt({
      template,
      tier: 'L1',
      fixture,
      agentDefinition: definition,
      instructionsInPrompt: false
    })
    expect(claude).not.toContain('You are the reviewer.')
    expect(claude).not.toContain('diff --git')
    expect(claude).toContain(`git diff ${'b'.repeat(40)}`)
  })
})

describe('claude driver', () => {
  it('keeps StructuredOutput on every tier and narrows Bash to read-only git at L1', () => {
    expect(claudeToolSpec('L0').tools).toEqual(['StructuredOutput'])
    expect(claudeToolSpec('L1').tools).toContain('Bash')
    expect(claudeToolSpec('L1').allowed).toContain('Bash(git diff *)')
    expect(claudeToolSpec('L1').allowed.join(' ')).not.toMatch(/pnpm/)
    expect(claudeToolSpec('L2').allowed).toContain('Bash(pnpm test*)')
    const args = claudeArgs({
      model: 'm',
      effort: 'low',
      tier: 'L0',
      agentsFile: '/a.json',
      agentName: 'r',
      schema: { type: 'object' }
    })
    expect(args).toContain('--effort')
    expect(args[args.indexOf('--setting-sources') + 1]).toBe('')
    expect(args[args.indexOf('--tools') + 1]).toBe('StructuredOutput')
    expect(args).not.toContain('--allowedTools')
  })

  const init = line({
    type: 'system',
    subtype: 'init',
    tools: ['Read'],
    agents: ['r'],
    permissionMode: 'default'
  })
  const limit = line({
    type: 'rate_limit_event',
    rate_limit_info: { unifiedWindows: { five_hour: { utilization: 0.1, resetsAt: 1 } } }
  })
  const use = line({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: 'x' } }] }
  })
  const output = { verdict: 'request changes', findings: [] }
  const result = (extra: object) =>
    line({
      type: 'result',
      subtype: 'success',
      is_error: false,
      num_turns: 3,
      duration_ms: 10,
      usage: { output_tokens: 1 },
      permission_denials: [],
      ...extra
    })

  it('reads structured output, tool calls and the rate-limit windows from the stream', () => {
    const stdout = [init, limit, use, result({ structured_output: output })].join('\n')
    const r = parseClaudeRun({ stdout, stderr: '', exitCode: 0, timedOut: false })
    expect(r.status).toBe('ok')
    expect(r.output).toEqual(output)
    expect(r.outputSource).toBe('tool')
    expect(r.toolCalls).toEqual([{ name: 'Read', input: { file_path: 'x' } }])
    expect(r.rateLimit.five_hour.utilization).toBe(0.1)
    expect(r.turns).toBe(3)
  })

  it('recovers fenced JSON from a prose answer and marks the source', () => {
    const stdout = [init, result({ result: '```json\n' + line(output) + '\n```' })].join('\n')
    const r = parseClaudeRun({ stdout, stderr: '', exitCode: 0, timedOut: false })
    expect(r.status).toBe('ok')
    expect(r.outputSource).toBe('text')
    expect(jsonFromText('nothing here')).toBeNull()
  })

  it('classifies rate limits, errors and timeouts', () => {
    const limited = [
      init,
      result({
        is_error: true,
        subtype: 'error',
        result: 'You have hit your limit for today',
        api_error_status: 429
      })
    ].join('\n')
    expect(
      parseClaudeRun({ stdout: limited, stderr: '', exitCode: 1, timedOut: false }).status
    ).toBe('rate_limited')
    const failed = [init, result({ is_error: true, subtype: 'error', result: 'boom' })].join('\n')
    expect(
      parseClaudeRun({ stdout: failed, stderr: '', exitCode: 1, timedOut: false }).status
    ).toBe('error')
    expect(parseClaudeRun({ stdout: '', stderr: 'x', exitCode: 1, timedOut: false }).status).toBe(
      'error'
    )
    expect(
      parseClaudeRun({ stdout: '', stderr: 'rate limit exceeded', exitCode: 1, timedOut: false })
        .status
    ).toBe('rate_limited')
    expect(
      parseClaudeRun({ stdout: init, stderr: '', exitCode: null, timedOut: true })
    ).toMatchObject({ status: 'error', error: 'timeout' })
    const noJson = [init, result({ result: 'I could not decide.' })].join('\n')
    expect(
      parseClaudeRun({ stdout: noJson, stderr: '', exitCode: 0, timedOut: false }).status
    ).toBe('error')
  })
})

describe('codex driver', () => {
  let home: string
  beforeAll(() => {
    home = mkdtempSync(join(tmpdir(), 'bench-codex-'))
    writeFileSync(
      join(home, 'models_cache.json'),
      line({
        fetched_at: 't',
        models: [
          {
            slug: 'gpt-x',
            default_reasoning_level: 'medium',
            supported_reasoning_levels: [{ effort: 'low' }, { effort: 'high' }]
          }
        ]
      })
    )
  })
  afterAll(() => rmSync(home, { recursive: true, force: true }))

  it('reads the levels a model lists and returns null for an unknown model or a missing cache', () => {
    expect(codexLevels('gpt-x', home)).toEqual({
      levels: ['low', 'high'],
      defaultLevel: 'medium',
      fetchedAt: 't'
    })
    expect(codexLevels('gpt-y', home)).toBeNull()
    expect(codexLevels('gpt-x', join(home, 'nope'))).toBeNull()
  })

  it('builds explicit, config-free arguments', () => {
    const args = codexArgs({
      model: 'gpt-x',
      effort: 'high',
      tier: 'L1',
      cwd: '/w',
      schemaFile: '/s',
      lastFile: '/l'
    })
    expect(args).toContain('--ignore-user-config')
    expect(args).toContain('--ephemeral')
    expect(args[args.indexOf('-c') + 1]).toBe('model_reasoning_effort="high"')
    expect(args[args.indexOf('--sandbox') + 1]).toBe('read-only')
    expect(
      codexArgs({
        model: 'm',
        effort: 'low',
        tier: 'L2',
        cwd: '/w',
        schemaFile: '/s',
        lastFile: '/l'
      })
    ).toContain('workspace-write')
  })

  it('removes the shell tool at L0 and records that in the tool spec', () => {
    const l0Input = {
      model: 'm',
      effort: 'low',
      tier: 'L0',
      cwd: '/w',
      schemaFile: '/s',
      lastFile: '/l'
    }
    const l0 = codexArgs(l0Input)
    expect(l0).toContain('features.shell_tool=false')
    expect(codexArgs({ ...l0Input, tier: 'L1' })).not.toContain('features.shell_tool=false')
    expect(codexToolSpec('L0')).toEqual({ sandbox: 'read-only', shellTool: false })
    expect(codexToolSpec('L1')).toEqual({ sandbox: 'read-only' })
  })

  const output = { verdict: 'approve for human review', findings: [] }
  it('takes the final message, the usage and the commands from the event stream', () => {
    const stdout = [
      line({ type: 'thread.started' }),
      line({
        type: 'item.completed',
        item: { type: 'command_execution', command: 'git diff', exit_code: 0 }
      }),
      line({ type: 'item.completed', item: { type: 'agent_message', text: line(output) } }),
      line({ type: 'turn.completed', usage: { input_tokens: 5 } })
    ].join('\n')
    const r = parseCodexRun({ stdout, stderr: '', exitCode: 0, timedOut: false, lastMessage: null })
    expect(r).toMatchObject({
      status: 'ok',
      output,
      outputSource: 'schema',
      usage: { input_tokens: 5 }
    })
    expect(r.toolCalls).toEqual([{ name: 'command_execution', input: 'git diff', exit: 0 }])
    const viaFile = parseCodexRun({
      stdout,
      stderr: '',
      exitCode: 0,
      timedOut: false,
      lastMessage: line({ ...output, verdict: 'request changes' })
    })
    expect(viaFile.output.verdict).toBe('request changes')
  })

  it('classifies a failed turn, a rate limit, and a non-JSON answer', () => {
    const failed = line({
      type: 'turn.failed',
      error: { message: '{"status":400,"error":{"message":"bad schema"}}' }
    })
    expect(
      parseCodexRun({ stdout: failed, stderr: '', exitCode: 1, timedOut: false, lastMessage: null })
    ).toMatchObject({ status: 'error' })
    const limited = line({
      type: 'error',
      message: '{"status": 429, "error": {"type": "usage_limit_reached"}}'
    })
    expect(
      parseCodexRun({
        stdout: limited,
        stderr: '',
        exitCode: 1,
        timedOut: false,
        lastMessage: null
      }).status
    ).toBe('rate_limited')
    const prose = line({
      type: 'item.completed',
      item: { type: 'agent_message', text: 'looks fine' }
    })
    expect(
      parseCodexRun({ stdout: prose, stderr: '', exitCode: 0, timedOut: false, lastMessage: null })
        .status
    ).toBe('error')
    expect(
      parseCodexRun({ stdout: '', stderr: '', exitCode: null, timedOut: true, lastMessage: null })
        .error
    ).toBe('timeout')
  })
})

describe('resume', () => {
  it('owes rate-limited rows again and orders reps outermost', () => {
    const rows = [
      { case: 'a', rep: 1, status: 'ok' },
      { case: 'b', rep: 1, status: 'rate_limited' },
      { case: 'a', rep: 2, status: 'error' }
    ]
    expect([...settledKeys(rows)]).toEqual(['a#1', 'a#2'])
    expect(pendingRows(['a', 'b'], 2, rows)).toEqual([
      { case: 'b', rep: 1 },
      { case: 'b', rep: 2 }
    ])
  })
})

describe('run.mjs', () => {
  let root: string
  let repo: string
  let fixtures: string
  let results: string
  let cache: string
  const head = 'e'.repeat(40)
  const base = 'f'.repeat(40)

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'bench-run-'))
    repo = join(root, 'repo')
    fixtures = join(root, 'fixtures')
    results = join(root, 'results')
    cache = join(root, 'cache')
    mkdirSync(join(repo, '.claude', 'agents'), { recursive: true })
    writeFileSync(
      join(repo, '.claude', 'agents', 'birdbrain-reviewer.md'),
      '---\nname: r\n---\nReview it.\n'
    )
    writeFileSync(join(repo, 'CLAUDE.md'), '# rules\n')
    for (const id of ['c-one', 'c-two']) {
      const dir = join(fixtures, id)
      mkdirSync(dir, { recursive: true })
      writeFileSync(
        join(dir, 'case.json'),
        line({
          id,
          kind: 'real',
          source: { pr: 1, base, head },
          tags: [id === 'c-one' ? 'pilot' : 'rest']
        })
      )
      writeFileSync(
        join(dir, 'truth.json'),
        line({ verdict: 'request changes', defects: [], refuted: [] })
      )
      writeFileSync(join(dir, 'diff.patch'), 'diff\n')
      writeFileSync(join(dir, 'pr.md'), '# pr\n')
    }
  })
  afterAll(() => rmSync(root, { recursive: true, force: true }))

  const output = {
    verdict: 'request changes',
    findings: [{ file: 'a', line: 1, quote: null, summary: 's', blocking: true }]
  }
  const claudeResult = (extra: object) =>
    [
      line({ type: 'system', subtype: 'init', tools: [], agents: [] }),
      line({
        type: 'result',
        subtype: 'success',
        is_error: false,
        num_turns: 1,
        duration_ms: 5,
        usage: {},
        permission_denials: [],
        ...extra
      })
    ].join('\n')

  // A stand-in for spawnSync: answers the version and login probes, then
  // hands each run to `onRun`, recording every call.
  const fakeExec = (
    onRun: (cmd: string, args: string[], opts: Record<string, unknown>) => Record<string, unknown>
  ) => {
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
      if (args[0] === '--version') return ok(`${cmd} 1.0`)
      if (cmd === 'claude' && args[0] === 'auth')
        return ok(
          line({ loggedIn: true, email: 'x@y', subscriptionType: 'max', configDirectory: '/c' })
        )
      if (cmd === 'codex' && args[0] === 'login') return ok('', 'Logged in using ChatGPT\n')
      return {
        status: 0,
        signal: null,
        stderr: '',
        timedOut: false,
        error: null,
        ...onRun(cmd, args, opts)
      }
    }
    return { exec, calls }
  }
  const deps = (exec: unknown, env: Record<string, string> = {}) => ({
    exec,
    log: () => {},
    env: { PATH: '/bin', ...env },
    repo,
    dirs: { fixtures, results, cache },
    sleep: () => {}
  })
  const runs = (calls: { cmd: string; args: string[]; opts: Record<string, unknown> }[]) =>
    calls.filter((c) => c.args[0] === '-p' || c.args[0] === 'exec')

  it('parses arguments and selects cases by id prefix or tag', () => {
    const o = parseArgs([
      '--harness',
      'claude',
      '--model',
      'm',
      '--tier',
      'L0',
      '--effort',
      'low,high',
      '--reps',
      '2',
      '--cases',
      'c-one'
    ])
    expect(o.efforts).toEqual(['low', 'high'])
    expect(o.reps).toBe(2)
    expect(() => parseArgs(['--harness', 'claude', '--model', 'm', '--tier', 'L0'])).toThrow(
      /--effort/
    )
    expect(() =>
      parseArgs(['--harness', 'x', '--model', 'm', '--tier', 'L0', '--effort', 'low'])
    ).toThrow(/--harness/)
    const specs = new Map([
      ['c-one', { tags: ['pilot'] }],
      ['c-two', { tags: ['rest'] }]
    ])
    expect(selectCases(specs, { cases: ['c-one'], tag: null })).toEqual(['c-one'])
    expect(selectCases(specs, { cases: null, tag: 'rest' })).toEqual(['c-two'])
    expect(() => selectCases(specs, { cases: ['nope'], tag: null })).toThrow(/unknown case/)
  })

  it('refuses to start when the OAuth token would switch the account', () => {
    const { exec } = fakeExec(() => ({ stdout: '' }))
    expect(() =>
      main(
        ['--harness', 'claude', '--model', 'm', '--tier', 'L0', '--effort', 'low'],
        deps(exec, { CLAUDE_CODE_OAUTH_TOKEN: 't' })
      )
    ).toThrow(/CLAUDE_CODE_OAUTH_TOKEN/)
    expect(() =>
      main(['--harness', 'claude', '--model', 'm', '--tier', 'L2', '--effort', 'low'], deps(exec))
    ).toThrow(/--allow-l2/)
  })

  it('writes unsupported rows without a model call and ok rows with the output', () => {
    const { exec, calls } = fakeExec(() => ({
      stdout: claudeResult({ structured_output: output })
    }))
    const code = main(
      [
        '--harness',
        'claude',
        '--model',
        'm',
        '--tier',
        'L0',
        '--effort',
        'ultra,low',
        '--reps',
        '1',
        '--pause',
        '0'
      ],
      deps(exec)
    )
    expect(code).toBe(0)
    expect(runs(calls)).toHaveLength(2)
    const run = runs(calls)[0]
    expect(run.cmd).toBe('claude')
    expect(run.opts.env).toMatchObject({ CLAUDE_CONFIG_DIR: expect.stringContaining('.claude') })
    expect(String(run.opts.input)).toContain('pull request #1')
    const rowsFiles = ['ultra', 'low'].map((effort) => {
      const all = readdirSync(results) as string[]
      const dir = all.find(
        (d) => JSON.parse(readFileSync(join(results, d, 'manifest.json'), 'utf8')).effort === effort
      )
      return readFileSync(join(results, dir as string, 'rows.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l))
    })
    expect(rowsFiles[0].map((r) => r.status)).toEqual(['unsupported', 'unsupported'])
    expect(rowsFiles[1].map((r) => r.status)).toEqual(['ok', 'ok'])
    expect(rowsFiles[1][0].output).toEqual(output)
    expect(rowsFiles[1][0].outputSource).toBe('tool')
    expect(rowsFiles[1][0].manifest).toHaveLength(16)
    expect(
      existsSync(join(results, rowsFiles[1][0].manifest, 'rows', 'c-one-r1', 'prompt.txt'))
    ).toBe(true)
  })

  it('stops on a rate limit, exits 3, and resumes from that row', () => {
    rmSync(results, { recursive: true, force: true })
    let n = 0
    const { exec, calls } = fakeExec(() => {
      n += 1
      return n === 2
        ? {
            status: 1,
            stdout: claudeResult({
              is_error: true,
              subtype: 'error',
              result: 'usage limit reached',
              api_error_status: 429
            })
          }
        : { stdout: claudeResult({ structured_output: output }) }
    })
    const argv = [
      '--harness',
      'claude',
      '--model',
      'm',
      '--tier',
      'L0',
      '--effort',
      'low',
      '--reps',
      '2',
      '--pause',
      '0'
    ]
    expect(main(argv, deps(exec))).toBe(3)
    expect(runs(calls)).toHaveLength(2)
    expect(main(argv, deps(exec))).toBe(0)
    expect(runs(calls)).toHaveLength(2 + 3)
    const dir = readdirSync(results)[0] as string
    const rows = readFileSync(join(results, dir, 'rows.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l))
    expect(rows.map((r) => `${r.case}#${r.rep}:${r.status}`)).toEqual([
      'c-one#1:ok',
      'c-two#1:rate_limited',
      'c-two#1:ok',
      'c-one#2:ok',
      'c-two#2:ok'
    ])
  })

  it('drives codex with its own home and marks an unlisted effort unsupported', () => {
    rmSync(results, { recursive: true, force: true })
    const home = mkdtempSync(join(tmpdir(), 'bench-codex-home-'))
    writeFileSync(
      join(home, 'models_cache.json'),
      line({ models: [{ slug: 'gpt-x', supported_reasoning_levels: [{ effort: 'low' }] }] })
    )
    const { exec, calls } = fakeExec(() => ({
      stdout: [
        line({ type: 'item.completed', item: { type: 'agent_message', text: line(output) } }),
        line({ type: 'turn.completed', usage: {} })
      ].join('\n')
    }))
    const code = main(
      [
        '--harness',
        'codex',
        '--model',
        'gpt-x',
        '--tier',
        'L0',
        '--effort',
        'low,ultra',
        '--reps',
        '1',
        '--pause',
        '0',
        '--codex-home',
        home
      ],
      deps(exec)
    )
    expect(code).toBe(0)
    expect(runs(calls)).toHaveLength(2)
    expect(runs(calls)[0].opts.env).toMatchObject({ CODEX_HOME: home })
    expect(String(runs(calls)[0].opts.input)).toContain('Review it.')
    const all = readdirSync(results) as string[]
    const statuses = all.map((d) =>
      readFileSync(join(results, d, 'rows.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l).status)
    )
    expect(statuses.sort()).toEqual([
      ['ok', 'ok'],
      ['unsupported', 'unsupported']
    ])
    rmSync(home, { recursive: true, force: true })
  })
})
