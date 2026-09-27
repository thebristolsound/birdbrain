// The codex exec driver: the argv for one run, the effort levels a model
// lists in the Codex model cache, and the parse of the JSONL it prints.
// Flags were read from `codex exec --help` (0.154.0) and the event shape from
// a probe run on 2026-09-26.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// Codex takes a sandbox mode, not a tool list; the tier maps onto that.
export function codexSandbox(tier) {
  switch (tier) {
    case 'L0':
    case 'L1':
      return 'read-only'
    case 'L2':
      return 'workspace-write'
    default:
      throw new Error(`unknown tier ${tier}`)
  }
}

// The effort levels the cache lists for a model, or null when the cache has
// no entry for it. Levels are per model, so they are read and never assumed.
export function codexLevels(model, codexHome) {
  const file = join(codexHome, 'models_cache.json')
  if (!existsSync(file)) return null
  const cache = JSON.parse(readFileSync(file, 'utf8'))
  const entry = (cache.models ?? []).find((m) => m.slug === model)
  if (!entry) return null
  return {
    levels: (entry.supported_reasoning_levels ?? []).map((l) => l.effort),
    defaultLevel: entry.default_reasoning_level ?? null,
    fetchedAt: cache.fetched_at ?? null
  }
}

export function codexArgs({ model, effort, tier, cwd, schemaFile, lastFile }) {
  return [
    'exec',
    '-m',
    model,
    '-c',
    `model_reasoning_effort=${JSON.stringify(effort)}`,
    '--sandbox',
    codexSandbox(tier),
    '-C',
    cwd,
    '--ephemeral',
    '--ignore-user-config',
    '--skip-git-repo-check',
    '--json',
    '--output-schema',
    schemaFile,
    '-o',
    lastFile,
    '-'
  ]
}

const RATE_LIMIT = /rate.?limit|usage.?limit|too many requests|"status":\s*429|status.*429/i

export const isRateLimit = (text) => RATE_LIMIT.test(String(text ?? ''))

export function parseCodexEvents(stdout) {
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
  const items = events.filter((e) => e.type === 'item.completed').map((e) => e.item)
  const message = [...items].reverse().find((i) => i.type === 'agent_message') ?? null
  const failure =
    events.find((e) => e.type === 'turn.failed')?.error?.message ??
    events.find((e) => e.type === 'error')?.message ??
    null
  const completed = events.find((e) => e.type === 'turn.completed') ?? null
  const toolCalls = items
    .filter((i) => i.type === 'command_execution')
    .map((i) => ({
      name: 'command_execution',
      input: i.command ?? null,
      exit: i.exit_code ?? null
    }))
  return { events, items, message, failure, completed, toolCalls }
}

export function parseCodexRun({ stdout, stderr, exitCode, timedOut, lastMessage }) {
  const { message, failure, completed, toolCalls } = parseCodexEvents(stdout)
  const base = {
    toolCalls,
    rateLimit: null,
    usage: completed?.usage ?? null,
    turns: completed ? 1 : null,
    durationMs: null
  }
  if (timedOut) return { ...base, status: 'error', error: 'timeout' }
  if (failure) {
    return {
      ...base,
      status: isRateLimit(failure) ? 'rate_limited' : 'error',
      error: String(failure).slice(0, 500)
    }
  }
  const text = lastMessage ?? message?.text ?? null
  if (!text) {
    const all = `${stdout}\n${stderr}`
    return {
      ...base,
      status: isRateLimit(all) ? 'rate_limited' : 'error',
      error: `no agent message (exit ${exitCode}): ${String(stderr).trim().slice(0, 500)}`
    }
  }
  try {
    return { ...base, status: 'ok', output: JSON.parse(text), outputSource: 'schema' }
  } catch {
    return { ...base, status: 'error', error: `final message is not JSON: ${text.slice(0, 200)}` }
  }
}
