// Runs the review benchmark: one harness, one model, one tier, a list of
// effort levels, R reps over the selected cases. One results/<manifest>/ per
// effort level, rows appended as JSON lines, resumable.
//
// Usage: node run.mjs --harness claude|codex --model <id> --tier L0|L1|L2
//                     [--mode direct|dispatch]
//                     --effort <level[,level...]> [--reps 3] [--cases <id,...>]
//                     [--tag <tag>] [--timeout <ms>] [--pause <ms>] [--dry-run]
//                     [--allow-l2] [--repo <path>] [--claude-config-dir <dir>]
//                     [--codex-home <dir>]
//
// Run by hand only. Stops on the first rate-limited row (exit 3); the next
// invocation with the same arguments resumes from the rows it still owes.

import { spawnSync } from 'node:child_process'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { loadFixtures } from './grade.mjs'
import { loadFixture } from './lib/fixture.mjs'
import { buildPrompt, agentBody } from './lib/prompt.mjs'
import { buildManifest, corpusHash, sha256 } from './lib/manifest.mjs'
import {
  CLAUDE_EFFORTS,
  claudeArgs,
  claudeToolSpec,
  dispatchClaudeArgs,
  parseClaudeRun,
  parseClaudeStream,
  isRateLimit
} from './lib/claude.mjs'
import {
  buildDispatchWorkspace,
  dispatchPrompt,
  installGhShim,
  parseVerdictComment
} from './lib/dispatch.mjs'
import { codexArgs, codexLevels, codexSandbox, parseCodexRun } from './lib/codex.mjs'
import { pendingRows, readRows } from './lib/resume.mjs'
import { HARNESSES, OUTPUT_SCHEMA, TIERS, validateOutput } from './lib/schema.mjs'
import { materialize, removeWorktree } from './lib/git.mjs'

const here = dirname(fileURLToPath(import.meta.url))
export const DEFAULTS = {
  reps: 3,
  timeoutMs: 30 * 60 * 1000,
  pauseMs: 5000,
  fixturesDir: join(here, 'fixtures'),
  resultsDir: join(here, 'results'),
  // Outside the repository so no CLAUDE.md, settings or auto-memory of this
  // checkout is discovered from the run's working directory.
  cacheDir: join(tmpdir(), 'bench-review'),
  promptFile: join(here, 'prompts', 'code-review.md'),
  agentFile: '.claude/agents/birdbrain-reviewer.md',
  instructionsFile: 'CLAUDE.md',
  agentName: 'birdbrain-reviewer',
  dispatchSkillFile: '.claude/skills/dispatch/SKILL.md'
}

export const MODES = ['direct', 'dispatch']

export function parseArgs(argv) {
  const o = {
    harness: null,
    model: null,
    tier: null,
    mode: 'direct',
    efforts: [],
    reps: DEFAULTS.reps,
    cases: null,
    tag: null,
    timeoutMs: DEFAULTS.timeoutMs,
    pauseMs: DEFAULTS.pauseMs,
    dryRun: false,
    allowL2: false,
    repo: null,
    claudeConfigDir: null,
    codexHome: null
  }
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`)
      return argv[++i]
    }
    if (a === '--harness') o.harness = next()
    else if (a === '--model') o.model = next()
    else if (a === '--tier') o.tier = next()
    else if (a === '--mode') o.mode = next()
    else if (a === '--effort') o.efforts.push(...next().split(',').filter(Boolean))
    else if (a === '--reps') o.reps = Number(next())
    else if (a === '--cases') o.cases = next().split(',').filter(Boolean)
    else if (a === '--tag') o.tag = next()
    else if (a === '--timeout') o.timeoutMs = Number(next())
    else if (a === '--pause') o.pauseMs = Number(next())
    else if (a === '--dry-run') o.dryRun = true
    else if (a === '--allow-l2') o.allowL2 = true
    else if (a === '--repo') o.repo = next()
    else if (a === '--claude-config-dir') o.claudeConfigDir = next()
    else if (a === '--codex-home') o.codexHome = next()
    else throw new Error(`unknown argument ${a}`)
  }
  if (!HARNESSES.includes(o.harness)) throw new Error(`--harness: one of ${HARNESSES.join(', ')}`)
  if (!o.model) throw new Error('--model is required')
  if (!MODES.includes(o.mode)) throw new Error(`--mode: one of ${MODES.join(', ')}`)
  // The dispatch mode is the full pre-pass, which is tier L2 by definition.
  if (o.mode === 'dispatch') {
    if (o.tier === null) o.tier = 'L2'
    else if (o.tier !== 'L2') throw new Error('--mode dispatch runs at tier L2 only')
    o.allowL2 = true
  }
  if (!TIERS.includes(o.tier)) throw new Error(`--tier: one of ${TIERS.join(', ')}`)
  if (o.efforts.length === 0) throw new Error('--effort is required and never inherited')
  if (!Number.isInteger(o.reps) || o.reps < 1) throw new Error('--reps: positive integer')
  if (!Number.isInteger(o.timeoutMs) || o.timeoutMs < 1) throw new Error('--timeout: ms')
  if (!Number.isInteger(o.pauseMs) || o.pauseMs < 0) throw new Error('--pause: ms')
  return o
}

export function selectCases(fixtures, { cases, tag }) {
  let ids = [...fixtures.keys()]
  if (cases) {
    ids = ids.filter((id) => cases.some((c) => id === c || id.startsWith(`${c}-`)))
    const missing = cases.filter((c) => !ids.some((id) => id === c || id.startsWith(`${c}-`)))
    if (missing.length) throw new Error(`unknown case ${missing.join(', ')}`)
  }
  if (tag) ids = ids.filter((id) => fixtures.get(id).tags.includes(tag))
  if (ids.length === 0) throw new Error('no cases selected')
  return ids
}

// spawnSync wrapped so tests can replace it. timedOut is the one signal the
// runner cannot read from the exit code.
export function execDefault(cmd, args, { cwd, input, env, timeoutMs }) {
  const r = spawnSync(cmd, args, {
    cwd,
    input: input ?? '',
    env,
    encoding: 'utf8',
    timeout: timeoutMs,
    killSignal: 'SIGKILL',
    maxBuffer: 256 * 1024 * 1024
  })
  return {
    status: r.status,
    signal: r.signal,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    timedOut: r.error?.code === 'ETIMEDOUT',
    error: r.error && r.error.code !== 'ETIMEDOUT' ? String(r.error) : null
  }
}

function sleep(ms) {
  if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function version(exec, cmd, env) {
  const r = exec(cmd, ['--version'], { env, timeoutMs: 60_000 })
  if (r.status !== 0) throw new Error(`${cmd} --version failed: ${r.stderr || r.error}`)
  return r.stdout.trim()
}

// Which login the harness will use, with the identifying value hashed so a
// committed manifest never carries an address.
function loginState(exec, harness, env) {
  if (harness === 'claude') {
    const r = exec('claude', ['auth', 'status'], { env, timeoutMs: 60_000 })
    if (r.status !== 0) throw new Error(`claude auth status failed: ${r.stderr || r.error}`)
    const s = JSON.parse(r.stdout)
    if (!s.loggedIn) throw new Error('claude is not logged in')
    return {
      manifest: { id: sha256(String(s.email ?? '')).slice(0, 12), plan: s.subscriptionType },
      detail: {
        configDirectory: s.configDirectory,
        authMethod: s.authMethod,
        plan: s.subscriptionType
      }
    }
  }
  const r = exec('codex', ['login', 'status'], { env, timeoutMs: 60_000 })
  if (r.status !== 0) throw new Error(`codex login status failed: ${r.stderr || r.error}`)
  // codex prints the status line on stderr.
  const line = `${r.stdout}\n${r.stderr}`.trim().split('\n')[0]
  if (!/logged in/i.test(line)) throw new Error(`codex is not logged in: ${line}`)
  return {
    manifest: { id: sha256(env.CODEX_HOME).slice(0, 12), plan: line },
    detail: { codexHome: env.CODEX_HOME, status: line }
  }
}

function harnessEnv(o, baseEnv) {
  const env = { ...baseEnv }
  if (o.harness === 'claude') {
    delete env.CLAUDE_CODE_OAUTH_TOKEN
    env.CLAUDE_CONFIG_DIR = o.claudeConfigDir ?? join(homedir(), '.claude')
  } else {
    env.CODEX_HOME = o.codexHome ?? join(homedir(), '.codex')
  }
  return env
}

// The directory the harness runs in. L0 is an empty directory so no CLAUDE.md
// or AGENTS.md is discovered; L1 and L2 are a detached worktree at the case's
// head with the mutation written over it, gone again after the run.
function openWorkspace(o, fixture, dirs, deps) {
  if (o.tier === 'L0') {
    const dir = mkdtempSync(join(dirs.cache, 'l0-'))
    return { dir, close: () => rmSync(dir, { recursive: true, force: true }) }
  }
  const dir = join(dirs.cache, 'worktrees', `${fixture.id}-${process.pid}`)
  if (existsSync(dir)) removeWorktree(deps.repo, dir)
  materialize(deps.repo, fixture.source.head, fixture.files, dir)
  if (o.tier === 'L2') symlinkSync(join(deps.repo, 'node_modules'), join(dir, 'node_modules'))
  return { dir, close: () => removeWorktree(deps.repo, dir) }
}

// The dispatch mode: the model is the dispatcher, the PR is a local clone,
// gh is the stand-in, and the graded output is the verdict comment it wrote.
function runDispatchRow(o, ctx, fixture, rep, deps) {
  const rowDir = join(ctx.dir, 'rows', `${fixture.id}-r${rep}`)
  mkdirSync(rowDir, { recursive: true })
  const commentFile = join(rowDir, 'comment.md')
  const reportFile = join(rowDir, 'report.md')
  const binDir = installGhShim(join(rowDir, 'bin'))
  const wsDir = join(deps.dirs.cache, 'dispatch', `${fixture.id}-${process.pid}`)
  const ws = buildDispatchWorkspace({ repo: deps.repo, fixture, dir: wsDir })
  const prompt = dispatchPrompt({ pr: fixture.source.pr, head: ws.head, commentFile, reportFile })
  writeFileSync(join(rowDir, 'prompt.txt'), prompt)
  const env = {
    ...ctx.env,
    PATH: `${binDir}:${ctx.env.PATH ?? ''}`,
    GH_TOKEN: 'benchmark-disabled',
    GIT_TERMINAL_PROMPT: '0',
    BENCH_GH_FIXTURE: join(deps.dirs.fixtures, fixture.id),
    BENCH_GH_LOG: join(rowDir, 'gh-calls.jsonl'),
    BENCH_COMMENT_FILE: commentFile
  }
  const startedAt = new Date().toISOString()
  const t0 = Date.now()
  let r
  try {
    r = deps.exec('claude', dispatchClaudeArgs({ model: o.model, effort: ctx.effort }), {
      cwd: ws.dir,
      input: prompt,
      env,
      timeoutMs: o.timeoutMs
    })
  } finally {
    rmSync(ws.dir, { recursive: true, force: true })
  }
  writeFileSync(join(rowDir, 'stdout.txt'), r.stdout)
  writeFileSync(join(rowDir, 'stderr.txt'), r.stderr)
  const { result, init, toolCalls, rateLimit } = parseClaudeStream(r.stdout)
  let parsed = {
    toolCalls,
    rateLimit,
    init: init && { tools: init.tools, agents: init.agents, permissionMode: init.permissionMode },
    usage: result?.usage ?? null,
    modelUsage: result?.modelUsage ?? null,
    turns: result?.num_turns ?? null,
    durationMs: result?.duration_ms ?? null,
    denials: result?.permission_denials ?? null,
    workspace: { base: ws.base, head: ws.head, branch: ws.branch }
  }
  const comment = existsSync(commentFile) ? readFileSync(commentFile, 'utf8') : null
  const verdict = parseVerdictComment(comment)
  if (r.timedOut) parsed = { ...parsed, status: 'error', error: 'timeout' }
  else if (!result && isRateLimit(`${r.stdout}\n${r.stderr}`)) {
    parsed = { ...parsed, status: 'rate_limited', error: 'rate limited before a result' }
  } else if (result?.api_error_status === 429 || (result?.is_error && isRateLimit(result.result))) {
    parsed = { ...parsed, status: 'rate_limited', error: String(result.result).slice(0, 500) }
  } else if (comment === null) {
    parsed = {
      ...parsed,
      status: 'error',
      error: `no comment file written (exit ${r.status}): ${String(result?.result ?? r.stderr).slice(0, 300)}`
    }
  } else if (!verdict) {
    parsed = { ...parsed, status: 'error', error: 'comment has no verdict line' }
  } else {
    const { source, ...output } = verdict
    parsed = { ...parsed, status: 'ok', output, outputSource: `comment:${source}` }
  }
  return finishRow(o, ctx, fixture, rep, rowDir, parsed, startedAt, Date.now() - t0)
}

function runRow(o, ctx, fixture, rep, deps) {
  if (o.mode === 'dispatch') return runDispatchRow(o, ctx, fixture, rep, deps)
  const rowDir = join(ctx.dir, 'rows', `${fixture.id}-r${rep}`)
  mkdirSync(rowDir, { recursive: true })
  const prompt = buildPrompt({
    template: ctx.promptTemplate,
    tier: o.tier,
    fixture,
    agentDefinition: ctx.agentDefinition,
    instructionsInPrompt: o.harness === 'codex'
  })
  writeFileSync(join(rowDir, 'prompt.txt'), prompt)
  const ws = openWorkspace(o, fixture, deps.dirs, deps)
  const startedAt = new Date().toISOString()
  const t0 = Date.now()
  let parsed
  try {
    if (o.harness === 'claude') {
      const agentsFile = join(rowDir, 'agents.json')
      writeFileSync(
        agentsFile,
        JSON.stringify({
          [DEFAULTS.agentName]: {
            description: 'Adversarial code reviewer for birdbrain PRs',
            prompt: agentBody(ctx.agentDefinition),
            tools: claudeToolSpec(o.tier).tools
          }
        })
      )
      const args = claudeArgs({
        model: o.model,
        effort: ctx.effort,
        tier: o.tier,
        agentsFile,
        agentName: DEFAULTS.agentName,
        schema: OUTPUT_SCHEMA
      })
      const r = deps.exec('claude', args, {
        cwd: ws.dir,
        input: prompt,
        env: ctx.env,
        timeoutMs: o.timeoutMs
      })
      writeFileSync(join(rowDir, 'stdout.txt'), r.stdout)
      writeFileSync(join(rowDir, 'stderr.txt'), r.stderr)
      parsed = parseClaudeRun({ ...r, exitCode: r.status })
    } else {
      const schemaFile = join(rowDir, 'schema.json')
      const lastFile = join(rowDir, 'last-message.json')
      writeFileSync(schemaFile, JSON.stringify(OUTPUT_SCHEMA))
      const args = codexArgs({
        model: o.model,
        effort: ctx.effort,
        tier: o.tier,
        cwd: ws.dir,
        schemaFile,
        lastFile
      })
      const r = deps.exec('codex', args, {
        cwd: ws.dir,
        input: prompt,
        env: ctx.env,
        timeoutMs: o.timeoutMs
      })
      writeFileSync(join(rowDir, 'stdout.txt'), r.stdout)
      writeFileSync(join(rowDir, 'stderr.txt'), r.stderr)
      const lastMessage = existsSync(lastFile) ? readFileSync(lastFile, 'utf8') : null
      parsed = parseCodexRun({ ...r, exitCode: r.status, lastMessage })
    }
  } finally {
    ws.close()
  }
  return finishRow(o, ctx, fixture, rep, rowDir, parsed, startedAt, Date.now() - t0)
}

function finishRow(o, ctx, fixture, rep, rowDir, parsed, startedAt, wallMs) {
  if (parsed.status === 'ok') {
    const problems = validateOutput(parsed.output)
    if (problems.length) {
      parsed = { ...parsed, status: 'error', error: `output: ${problems.join('; ')}` }
      delete parsed.output
    }
  }
  const { toolCalls, init, ...rest } = parsed
  writeFileSync(join(rowDir, 'tools.jsonl'), toolCalls.map((t) => JSON.stringify(t)).join('\n'))
  writeFileSync(join(rowDir, 'result.json'), JSON.stringify({ ...rest, init }, null, 2))
  const row = {
    case: fixture.id,
    head: fixture.source.head,
    harness: o.harness,
    model: o.model,
    tier: o.tier,
    mode: o.mode,
    effort: ctx.effort,
    rep,
    manifest: ctx.id,
    status: parsed.status,
    startedAt,
    wallMs,
    durationMs: parsed.durationMs,
    turns: parsed.turns,
    toolCalls: toolCalls.length,
    usage: parsed.usage,
    rateLimit: parsed.rateLimit ?? null,
    outputSource: parsed.outputSource ?? null
  }
  if (parsed.status === 'ok') row.output = parsed.output
  else row.error = parsed.error
  return row
}

export function main(argv, overrides = {}) {
  const o = parseArgs(argv)
  const deps = {
    exec: execDefault,
    log: console.log,
    env: process.env,
    repo: o.repo ?? resolve(here, '..', '..', '..'),
    dirs: {
      fixtures: DEFAULTS.fixturesDir,
      results: DEFAULTS.resultsDir,
      cache: DEFAULTS.cacheDir
    },
    promptFile: DEFAULTS.promptFile,
    ...overrides
  }
  if (o.harness === 'claude' && deps.env.CLAUDE_CODE_OAUTH_TOKEN) {
    throw new Error(
      'CLAUDE_CODE_OAUTH_TOKEN is set and would silently switch the account; unset it to run'
    )
  }
  if (o.tier === 'L2' && !o.allowL2) throw new Error('tier L2 needs --allow-l2')
  const env = harnessEnv(o, deps.env)
  const specs = loadFixtures(deps.dirs.fixtures)
  const caseIds = selectCases(specs, o)
  const fixtures = new Map(caseIds.map((id) => [id, loadFixture(join(deps.dirs.fixtures, id))]))
  const promptTemplate = readFileSync(deps.promptFile, 'utf8')
  const agentDefinition = readFileSync(join(deps.repo, DEFAULTS.agentFile), 'utf8')
  const instructions = readFileSync(join(deps.repo, DEFAULTS.instructionsFile), 'utf8')
  const harnessVersion = version(deps.exec, o.harness, env)
  const login = loginState(deps.exec, o.harness, env)
  const levels = o.harness === 'codex' ? codexLevels(o.model, env.CODEX_HOME) : null
  // Codex has no dispatch flow: the skill, the subagent and the hooks are
  // Claude Code's, so a Codex dispatch row is unsupported rather than faked.
  const supported =
    o.harness === 'claude'
      ? (e) => CLAUDE_EFFORTS.includes(e)
      : (e) => o.mode === 'direct' && levels !== null && levels.levels.includes(e)
  const dispatchSkill =
    o.mode === 'dispatch' ? readFileSync(join(deps.repo, DEFAULTS.dispatchSkillFile), 'utf8') : null
  mkdirSync(deps.dirs.cache, { recursive: true })
  const corpus = corpusHash(fixtures)
  let stoppedBy = null

  for (const effort of o.efforts) {
    const { manifest, id } = buildManifest({
      harness: o.harness,
      harnessVersion,
      model: o.model,
      effort,
      tier: o.tier,
      toolSpec: o.harness === 'claude' ? claudeToolSpec(o.tier) : { sandbox: codexSandbox(o.tier) },
      promptTemplate,
      agentDefinition,
      instructions,
      placement: o.mode === 'dispatch' ? 'checkout' : o.harness === 'claude' ? 'agent' : 'prompt',
      mode: o.mode,
      dispatchSkill,
      corpus,
      nodeVersion: process.version,
      timeoutMs: o.timeoutMs,
      login: login.manifest
    })
    const dir = join(deps.dirs.results, id)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
    writeFileSync(
      join(dir, 'environment.json'),
      JSON.stringify(
        {
          ...login.detail,
          harnessVersion,
          node: process.version,
          codexLevels: levels,
          cases: caseIds
        },
        null,
        2
      ) + '\n'
    )
    const rowsFile = join(dir, 'rows.jsonl')
    const pending = pendingRows(caseIds, o.reps, readRows(rowsFile))
    const label = `${o.harness} ${o.model} ${o.tier}${o.mode === 'dispatch' ? ' dispatch' : ''} ${effort}`
    deps.log(`${label}  manifest ${id}  ${pending.length} rows pending`)
    if (pending.length === 0) continue
    if (!supported(effort)) {
      const known = levels ? levels.levels.join(', ') : CLAUDE_EFFORTS.join(', ')
      const why =
        o.harness === 'codex' && o.mode === 'dispatch'
          ? 'the dispatch mode runs Claude Code only'
          : `effort ${effort} is not listed for ${o.model} (${known})`
      deps.log(`  ${why}; rows marked unsupported`)
      for (const p of pending) {
        const row = {
          case: p.case,
          head: fixtures.get(p.case).source.head,
          harness: o.harness,
          model: o.model,
          tier: o.tier,
          effort,
          rep: p.rep,
          manifest: id,
          status: 'unsupported'
        }
        appendFileSync(rowsFile, JSON.stringify(row) + '\n')
      }
      continue
    }
    if (o.dryRun) {
      for (const p of pending) deps.log(`  would run ${p.case} rep ${p.rep}`)
      continue
    }
    const ctx = { id, dir, effort, env, promptTemplate, agentDefinition }
    for (const p of pending) {
      const row = runRow(o, ctx, fixtures.get(p.case), p.rep, deps)
      appendFileSync(rowsFile, JSON.stringify(row) + '\n')
      const note = row.status === 'ok' ? row.output.verdict : row.error
      deps.log(`  ${row.status.padEnd(12)} ${p.case} rep ${p.rep}  ${row.wallMs}ms  ${note}`)
      if (row.status === 'rate_limited') {
        stoppedBy = row
        break
      }
      ;(deps.sleep ?? sleep)(o.pauseMs)
    }
    if (stoppedBy) break
  }
  if (stoppedBy) {
    deps.log(`stopped: rate limited on ${stoppedBy.case}; rerun the same command to resume`)
    return 3
  }
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2))
}
