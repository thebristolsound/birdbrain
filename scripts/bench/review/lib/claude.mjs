// The claude -p driver: the argv for one run, and the parse of what it
// printed. Flags were read from `claude --help` (2.1.282) and the result
// shape from a probe run on 2026-09-26; nothing here is assumed.

export const CLAUDE_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

const READ_ONLY_GIT = ['git diff *', 'git show *', 'git log *', 'git status *', 'git ls-files *']

// The tool allowlist per tier. StructuredOutput is the tool --json-schema
// answers through, so it stays on every list: with --tools "" the model
// falls back to prose. Bash is on the list at L1 so read-only git works, and
// the permission allowlist below narrows it to those forms; a call outside
// the allowlist is denied without a prompt in -p mode and shows up in
// permission_denials.
export const STRUCTURED_OUTPUT_TOOL = 'StructuredOutput'

export function claudeToolSpec(tier) {
  switch (tier) {
    case 'L0':
      return { tools: [STRUCTURED_OUTPUT_TOOL], allowed: [] }
    case 'L1':
      return {
        tools: ['Read', 'Grep', 'Glob', 'Bash', STRUCTURED_OUTPUT_TOOL],
        allowed: ['Read', 'Grep', 'Glob', ...READ_ONLY_GIT.map((g) => `Bash(${g})`)]
      }
    case 'L2':
      return {
        tools: ['Read', 'Grep', 'Glob', 'Bash', STRUCTURED_OUTPUT_TOOL],
        allowed: [
          'Read',
          'Grep',
          'Glob',
          ...READ_ONLY_GIT.map((g) => `Bash(${g})`),
          'Bash(pnpm lint*)',
          'Bash(pnpm typecheck*)',
          'Bash(pnpm test*)'
        ]
      }
    default:
      throw new Error(`unknown tier ${tier}`)
  }
}

export function claudeArgs({ model, effort, tier, agentsFile, agentName, schema }) {
  const spec = claudeToolSpec(tier)
  const args = [
    '-p',
    '--model',
    model,
    '--effort',
    effort,
    '--output-format',
    'stream-json',
    '--verbose',
    '--no-session-persistence',
    '--strict-mcp-config',
    '--mcp-config',
    '{"mcpServers":{}}',
    '--setting-sources',
    '',
    '--tools',
    spec.tools.join(','),
    '--json-schema',
    JSON.stringify(schema)
  ]
  if (spec.allowed.length) args.push('--allowedTools', spec.allowed.join(','))
  if (agentsFile) args.push('--agents', agentsFile, '--agent', agentName)
  return args
}

const RATE_LIMIT = /rate.?limit|usage limit|hit your limit|limit reached|out of .*usage|429/i

export const isRateLimit = (text) => RATE_LIMIT.test(String(text ?? ''))

// stream-json prints one JSON object per line; the last `result` line is the
// same object `--output-format json` prints. Tool calls are the tool_use
// blocks on assistant messages.
export function parseClaudeStream(stdout) {
  const events = []
  for (const line of String(stdout).split('\n')) {
    const t = line.trim()
    if (!t.startsWith('{')) continue
    try {
      events.push(JSON.parse(t))
    } catch {
      // A partial last line when the process was killed mid-write.
    }
  }
  const result = [...events].reverse().find((e) => e.type === 'result') ?? null
  const init = events.find((e) => e.type === 'system' && e.subtype === 'init') ?? null
  const limit = [...events].reverse().find((e) => e.type === 'rate_limit_event') ?? null
  const toolCalls = []
  for (const e of events) {
    if (e.type !== 'assistant') continue
    for (const block of e.message?.content ?? []) {
      if (block.type === 'tool_use') toolCalls.push({ name: block.name, input: block.input })
    }
  }
  return { events, result, init, toolCalls, rateLimit: rateLimitWindows(limit) }
}

// The subscription windows as the harness reported them at the end of the
// run: utilisation 0..1 per window. This is what tells stage 3 how much of a
// window one case costs.
export function rateLimitWindows(event) {
  const w = event?.rate_limit_info?.unifiedWindows
  if (!w) return null
  const out = {}
  for (const [name, v] of Object.entries(w)) {
    out[name] = { utilization: v.utilization ?? null, resetsAt: v.resetsAt ?? null }
  }
  return out
}

// A model that answered in prose instead of through the StructuredOutput
// tool usually still wrote the JSON, often fenced. Recovered output is marked
// so the report can count how often the harness had to do this.
export function jsonFromText(text) {
  if (typeof text !== 'string') return null
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidates = [fenced?.[1], text, text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)]
  for (const c of candidates) {
    if (!c) continue
    try {
      const v = JSON.parse(c.trim())
      if (v && typeof v === 'object') return v
    } catch {
      // try the next candidate
    }
  }
  return null
}

export function parseClaudeRun({ stdout, stderr, exitCode, timedOut }) {
  const { result, init, toolCalls, rateLimit } = parseClaudeStream(stdout)
  const base = {
    toolCalls,
    rateLimit,
    init: init && { tools: init.tools, agents: init.agents, permissionMode: init.permissionMode },
    usage: result?.usage ?? null,
    modelUsage: result?.modelUsage ?? null,
    turns: result?.num_turns ?? null,
    durationMs: result?.duration_ms ?? null,
    denials: result?.permission_denials ?? null
  }
  if (timedOut) return { ...base, status: 'error', error: 'timeout' }
  if (!result) {
    const text = `${stdout}\n${stderr}`
    return {
      ...base,
      status: isRateLimit(text) ? 'rate_limited' : 'error',
      error: `no result event (exit ${exitCode}): ${String(stderr).trim().slice(0, 500)}`
    }
  }
  if (result.is_error || result.api_error_status) {
    const text = `${result.result ?? ''} ${result.api_error_status ?? ''}`
    return {
      ...base,
      status: result.api_error_status === 429 || isRateLimit(text) ? 'rate_limited' : 'error',
      error: `${result.subtype}: ${String(result.result ?? '').slice(0, 500)}`
    }
  }
  if (result.structured_output) {
    return { ...base, status: 'ok', output: result.structured_output, outputSource: 'tool' }
  }
  const recovered = jsonFromText(result.result)
  if (recovered) return { ...base, status: 'ok', output: recovered, outputSource: 'text' }
  return { ...base, status: 'error', error: 'result carries no structured_output and no JSON' }
}
