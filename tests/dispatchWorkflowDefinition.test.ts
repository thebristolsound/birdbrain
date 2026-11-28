import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { Effect, Option, Schema } from 'effect'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

// birdbrain-dispatch.ts runs here on real Effect, with stand-ins for the names T3 Code injects
// and for phase.sh. Each test reads which phases a fire ran, in what order and with what
// environment, and how the fire ended. Nothing here runs T3 Code's engine: the stand-ins
// follow its documented contract and what a probe of T3 Code 0.1.13 showed on 2026-11-26.
const SOURCE = resolve(__dirname, '..')
const PHASE = 'scripts/dispatch-workflow/phase.sh'
// A computed path keeps the file out of the typecheck. It is written for T3 Code's loader,
// with untyped parameters and names it expects as globals.
const DEFINITION = join(SOURCE, 'scripts/dispatch-workflow/birdbrain-dispatch.ts')
const SWITCH_KEY = 'birdbrain-dispatch/schedule'
const RUN = '0123456789abcdef0123456789abcdef'
const GATES = [
  'identity',
  'pregate',
  'toolchain',
  'ledger',
  'credential',
  'cycle-start',
  'cycle-check',
  'postcheck'
]

type Fx<A = unknown> = Effect.Effect<A, unknown>
type Decoder = Schema.Codec<unknown, unknown>
interface Definition {
  name: string
  options: {
    version: number
    payload: Decoder
    concurrency?: number
    triggers?: unknown[]
    onEnd?: (payload: unknown, end: { id: string; outcome: string }) => Fx
  }
  body: (payload: unknown, run: { id: string }) => Fx
}
interface Ending {
  ended: 'stopped' | 'skipped'
  reason: string
}
interface Entry {
  name: string
  kind: 'title' | 'done' | 'failed' | 'slept'
  value: unknown
}

const definitions = new Map<string, Definition>()
const journal: Entry[] = []
const started: { workflow: string; payload: unknown; options: unknown }[] = []
const stored = new Map<string, unknown>()
let startFails = false

const message = (cause: unknown) => (cause instanceof Error ? cause.message : String(cause))
const end = (ended: Ending['ended']) => (reason: string) => Effect.fail({ ended, reason })
const isEnding = (cause: unknown): cause is Ending =>
  typeof cause === 'object' && cause !== null && 'ended' in cause

// A plain step pauses its run on failure and the engine resumes it by itself, which would
// give the paid cycle a second attempt (ADR-0029). The definition must use step.try alone.
const step = () => {
  throw new Error('the definition called a plain step')
}
step.try = (name: string, options: { returns: Decoder }, effect: Fx) =>
  Effect.match(effect, {
    onFailure: (cause) => {
      journal.push({ name, kind: 'failed', value: message(cause) })
      return { outcome: 'failed', reason: message(cause) }
    },
    onSuccess: (value) => {
      Schema.decodeUnknownSync(options.returns)(value)
      journal.push({ name, kind: 'done', value })
      return { outcome: 'done', value }
    }
  })

const T3 = {
  workflow: (name: string, options: Definition['options'], body: Definition['body']) => {
    const definition = { name, options, body }
    definitions.set(name, definition)
    return definition
  },
  step,
  title: (text: string) =>
    Effect.sync(() => journal.push({ name: 'title', kind: 'title', value: text })),
  sleep: (name: string, duration: string) =>
    Effect.sync(() => journal.push({ name, kind: 'slept', value: duration })),
  stop: end('stopped'),
  skip: end('skipped'),
  start: (definition: Definition, payload: unknown, options: unknown) =>
    Effect.try({
      try: () => {
        if (startFails) throw new Error('the server refused the start')
        Schema.decodeUnknownSync(definition.options.payload)(payload)
        started.push({ workflow: definition.name, payload, options })
        return { runId: `started-${started.length}` }
      },
      catch: (cause) => new Error(message(cause))
    }),
  store: {
    entry: (key: string, schema: Decoder) => ({
      get: Effect.try({
        try: () =>
          stored.has(key)
            ? Option.some(Schema.decodeUnknownSync(schema)(stored.get(key)))
            : Option.none(),
        catch: (cause) => new Error(message(cause))
      })
    })
  },
  every: (interval: string) => ({ every: interval }),
  Tick: Schema.Struct({ scheduledAt: Schema.String })
}
const INJECTED = { T3, Effect, Schema, Option }

const definition = (name: string) => {
  const found = definitions.get(name)
  if (!found) throw new Error(`the file defines no workflow named ${name}`)
  return found
}

// One run as the engine documents it: the body, then onEnd with how the body ended.
const fire = async (name: string, payload: unknown, id = RUN) => {
  const { options, body } = definition(name)
  Schema.decodeUnknownSync(options.payload)(payload)
  journal.length = 0
  const result = await Effect.runPromise(
    Effect.match(body(payload, { id }), {
      onFailure: (cause) => {
        if (!isEnding(cause)) throw new Error(`the body failed: ${message(cause)}`)
        return { outcome: cause.ended as string, reason: cause.reason }
      },
      onSuccess: () => ({ outcome: 'completed', reason: '' })
    })
  )
  // The engine journals by name, so a name used twice in one run would replay the first result.
  const names = journal.map((entry) => entry.name)
  expect(names).toEqual([...new Set(names)])
  const onEnd = options.onEnd
    ? await Effect.runPromise(
        Effect.match(options.onEnd(payload, { id, outcome: result.outcome }), {
          onFailure: (cause) => `failed: ${message(cause)}`,
          onSuccess: (value) => String(value)
        })
      )
    : undefined
  return { ...result, onEnd, journal: [...journal] }
}

let root: string
let checkout: string
let plan: string

// What the stand-in phase script answers: for every call of a phase, or for its nth call.
const answer = (
  phase: string,
  { out, err, exit }: { out?: string; err?: string; exit?: number },
  nth?: number
) => {
  const base = join(plan, nth === undefined ? phase : `${phase}.${nth}`)
  if (out !== undefined) writeFileSync(`${base}.out`, out)
  if (err !== undefined) writeFileSync(`${base}.err`, err)
  if (exit !== undefined) writeFileSync(`${base}.exit`, String(exit))
}

const calls = () =>
  (existsSync(join(plan, 'calls')) ? readFileSync(join(plan, 'calls'), 'utf8') : '')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [phase, runId, mode, issue, jobStatus] = line.split('|')
      return { phase, runId, mode, issue, jobStatus }
    })
const phases = () => calls().map((call) => call.phase)
const finish = () => calls().find((call) => call.phase === 'finish')

describe.skipIf(process.platform === 'win32')('birdbrain-dispatch.ts', () => {
  beforeAll(async () => {
    Object.assign(globalThis, INJECTED)
    await import(DEFINITION)
  })

  afterAll(() => {
    for (const name of Object.keys(INJECTED)) Reflect.deleteProperty(globalThis, name)
  })

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'dispatch-definition-'))
    checkout = join(root, 'checkout')
    plan = join(root, 'plan')
    mkdirSync(join(checkout, PHASE, '..'), { recursive: true })
    mkdirSync(plan)
    writeFileSync(
      join(checkout, PHASE),
      `#!/usr/bin/env bash
# A stand-in for phase.sh: records the call, then answers from the plan directory.
plan='${plan}'
echo "$1|$RUN_ID|$MODE|$TARGET_ISSUE|\${JOB_STATUS-unset}" >> "$plan/calls"
env > "$plan/env-$1"
n="$(grep -c "^$1|" "$plan/calls")"
answer="$plan/$1.$n"
[ -e "$answer.out" ] || [ -e "$answer.err" ] || [ -e "$answer.exit" ] || answer="$plan/$1"
if [ -f "$answer.err" ]; then cat "$answer.err" >&2; fi
if [ -f "$answer.out" ]; then cat "$answer.out"; else echo ok; fi
exit "$(cat "$answer.exit" 2>/dev/null || echo 0)"
`
    )
    chmodSync(join(checkout, PHASE), 0o755)
    answer('pregate', { out: 'run\n' })
    answer('cycle-check', { out: 'Cycle: finished\n' })
    started.length = 0
    stored.clear()
    startFails = false
    vi.stubEnv('JOB_STATUS', undefined)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    rmSync(root, { recursive: true, force: true })
  })

  describe('what the file defines', () => {
    it('defines the fire with one run at a time and no trigger of its own', () => {
      const { options } = definition('birdbrain-dispatch')
      expect(options.concurrency).toBe(1)
      expect(options.triggers).toBeUndefined()
      expect(options.version).toBe(1)
    })

    it('defines the schedule with an hourly trigger', () => {
      expect(definition('birdbrain-dispatch-schedule').options.triggers).toEqual([
        { every: '1 hour' }
      ])
      expect([...definitions.keys()].sort()).toEqual([
        'birdbrain-dispatch',
        'birdbrain-dispatch-schedule'
      ])
    })

    it.each([
      ['a mode that is neither report nor cycle', { mode: 'off', checkout: '/c' }],
      ['no checkout', { mode: 'report' }],
      ['an issue that is not a number', { mode: 'cycle', checkout: '/c', issue: '12' }]
    ])('refuses a fire with %s', (_what, payload) => {
      const { payload: schema } = definition('birdbrain-dispatch').options
      expect(() => Schema.decodeUnknownSync(schema)(payload)).toThrow()
    })

    it('calls only phases that phase.sh has', async () => {
      await fire('birdbrain-dispatch', { mode: 'cycle', checkout })
      const real = readFileSync(join(SOURCE, PHASE), 'utf8').split('case "$phase" in')[1] ?? ''
      const known = [...real.matchAll(/^ {2}([a-z-]+)\)$/gm)].map((match) => match[1])
      expect(known.length).toBeGreaterThan(0)
      expect(known).toEqual(expect.arrayContaining(phases()))
    })
  })

  describe('a fire', () => {
    it('runs every gate of a report-mode fire in order and leaves out the post-check', async () => {
      const run = await fire('birdbrain-dispatch', { mode: 'report', checkout })

      expect(run.outcome).toBe('completed')
      expect(phases()).toEqual([...GATES.slice(0, 7), 'finish'])
      expect(run.journal[0]).toEqual({ name: 'title', kind: 'title', value: 'Dispatch report' })
      expect(run.journal.slice(1).map((entry) => entry.name)).toEqual([
        ...GATES.slice(0, 6),
        'cycle-check-1'
      ])
      for (const call of calls()) {
        expect(call).toMatchObject({ runId: RUN, mode: 'report', issue: '' })
      }
    })

    it('runs the post-check after the cycle of a cycle-mode fire', async () => {
      const run = await fire('birdbrain-dispatch', { mode: 'cycle', checkout })

      expect(run.outcome).toBe('completed')
      expect(phases()).toEqual([...GATES, 'finish'])
      for (const call of calls()) expect(call.mode).toBe('cycle')
    })

    it('carries a target issue to the title and to every phase', async () => {
      const run = await fire('birdbrain-dispatch', { mode: 'cycle', checkout, issue: 1234 })

      expect(run.journal[0].value).toBe('Dispatch cycle #1234')
      expect(calls().length).toBe(GATES.length + 1)
      for (const call of calls()) expect(call.issue).toBe('1234')
    })

    it("hands the server's environment on to every phase", async () => {
      vi.stubEnv('DISPATCH_STATE_DIR', '/a/state/directory')

      await fire('birdbrain-dispatch', { mode: 'report', checkout })

      expect(phases()).toContain('finish')
      for (const phase of phases()) {
        expect(readFileSync(join(plan, `env-${phase}`), 'utf8')).toMatch(
          /^DISPATCH_STATE_DIR=\/a\/state\/directory$/m
        )
      }
    })

    it('takes the run id, the mode and the target from the fire, not from the server', async () => {
      vi.stubEnv('RUN_ID', 'ambient')
      vi.stubEnv('MODE', 'cycle')
      vi.stubEnv('TARGET_ISSUE', '99')
      vi.stubEnv('JOB_STATUS', 'success')
      answer('toolchain', { err: 'no toolchain\n', exit: 1 })

      await fire('birdbrain-dispatch', { mode: 'report', checkout })

      for (const call of calls()) {
        expect(call).toMatchObject({ runId: RUN, mode: 'report', issue: '' })
      }
      expect(finish()?.jobStatus).toBe('failure')
    })

    it('rewrites a run id that is not a file name, for the gates and for the last phase', async () => {
      await fire('birdbrain-dispatch', { mode: 'report', checkout }, 'run/7:a b')

      expect(calls().length).toBe(8)
      for (const call of calls()) expect(call.runId).toBe('run_7_a_b')
    })

    it('skips an idle fire at the pre-gate and still runs the last phase as a success', async () => {
      answer('pregate', { out: 'idle: the slot is free but the queue is empty\n' })

      const run = await fire('birdbrain-dispatch', { mode: 'cycle', checkout })

      expect(run.outcome).toBe('skipped')
      expect(run.reason).toBe('idle: the slot is free but the queue is empty')
      expect(phases()).toEqual(['identity', 'pregate', 'finish'])
      expect(finish()?.jobStatus).toBe('success')
    })

    it('reads the last line a phase printed as its result', async () => {
      answer('pregate', { out: `${'a line of noise\n'.repeat(600)}idle: nothing queued\n` })

      const run = await fire('birdbrain-dispatch', { mode: 'report', checkout })

      expect(run.outcome).toBe('skipped')
      expect(run.reason).toBe('idle: nothing queued')
    })

    it.each(GATES)('stops at %s when it fails, and runs nothing after it', async (gate) => {
      answer(gate, { out: 'run\n', err: 'a warning\nthe reason it failed\n', exit: 1 })

      const run = await fire('birdbrain-dispatch', { mode: 'cycle', checkout })

      expect(run.outcome).toBe('stopped')
      expect(run.reason).toBe(`${gate}: the reason it failed`)
      expect(phases()).toEqual([...GATES.slice(0, GATES.indexOf(gate) + 1), 'finish'])
      expect(run.journal.at(-1)).toMatchObject({ kind: 'failed', value: 'the reason it failed' })
      expect(finish()?.jobStatus).toBe('failure')
    })

    it('names the exit status when a failed phase printed no reason', async () => {
      answer('ledger', { exit: 3 })

      const run = await fire('birdbrain-dispatch', { mode: 'cycle', checkout })

      expect(run.outcome).toBe('stopped')
      expect(run.reason).toBe('ledger: ledger exited 3')
    })

    it('stops when the checkout holds no phase script, and the last phase fails too', async () => {
      const run = await fire('birdbrain-dispatch', { mode: 'report', checkout: join(root, 'gone') })

      expect(run.outcome).toBe('stopped')
      expect(run.reason).toMatch(/^identity: .*No such file or directory/)
      expect(run.onEnd).toMatch(/^failed: .*No such file or directory/)
    })
  })

  describe('the cycle', () => {
    it('checks the cycle once a minute until it has ended', async () => {
      answer('cycle-check', { out: 'running\n' }, 1)
      answer('cycle-check', { out: 'running\n' }, 2)

      const run = await fire('birdbrain-dispatch', { mode: 'cycle', checkout })

      expect(run.outcome).toBe('completed')
      expect(run.journal.slice(6)).toEqual([
        { name: 'cycle-start', kind: 'done', value: 'ok' },
        { name: 'cycle-check-1', kind: 'done', value: 'running' },
        { name: 'cycle-wait-1', kind: 'slept', value: '1 minute' },
        { name: 'cycle-check-2', kind: 'done', value: 'running' },
        { name: 'cycle-wait-2', kind: 'slept', value: '1 minute' },
        { name: 'cycle-check-3', kind: 'done', value: 'Cycle: finished' },
        { name: 'postcheck', kind: 'done', value: 'ok' }
      ])
      expect(phases().filter((phase) => phase === 'cycle-start')).toHaveLength(1)
    })

    it('stops at a failed check without waiting again or running the post-check', async () => {
      answer('cycle-check', { out: 'running\n' }, 1)
      answer('cycle-check', { err: 'the cycle exited 3\n', exit: 1 }, 2)

      const run = await fire('birdbrain-dispatch', { mode: 'cycle', checkout })

      expect(run.outcome).toBe('stopped')
      expect(run.reason).toBe('cycle-check: the cycle exited 3')
      expect(run.journal.filter((entry) => entry.kind === 'slept')).toHaveLength(1)
      expect(phases()).not.toContain('postcheck')
      expect(finish()?.jobStatus).toBe('failure')
    })

    it('stops a cycle that never ends after 300 checks, without the post-check', async () => {
      answer('cycle-check', { out: 'running\n' })

      const run = await fire('birdbrain-dispatch', { mode: 'cycle', checkout })

      expect(run.outcome).toBe('stopped')
      expect(run.reason).toBe('cycle-check: still running after 300 checks')
      expect(phases().filter((phase) => phase === 'cycle-check')).toHaveLength(300)
      expect(run.journal.filter((entry) => entry.kind === 'slept')).toHaveLength(300)
      expect(phases()).not.toContain('postcheck')
      expect(finish()?.jobStatus).toBe('failure')
    }, 60_000)
  })

  describe('the last phase', () => {
    it.each([
      ['completed', 'success'],
      ['skipped', 'success'],
      ['cancelled', 'cancelled'],
      ['stopped', 'failure'],
      ['an outcome the table does not name', 'failure']
    ])('tells cleanup that a run which ended as %s was a %s', async (outcome, jobStatus) => {
      const { onEnd } = definition('birdbrain-dispatch').options
      answer('finish', { out: 'Run ended\n' })

      const printed = await Effect.runPromise(
        onEnd!({ mode: 'cycle', checkout, issue: 7 }, { id: RUN, outcome })
      )

      expect(printed).toBe('Run ended')
      expect(calls()).toEqual([
        { phase: 'finish', runId: RUN, mode: 'cycle', issue: '7', jobStatus }
      ])
    })

    it('fails when the phase script fails', async () => {
      const { onEnd } = definition('birdbrain-dispatch').options
      answer('finish', { err: 'cleanup failed\n', exit: 1 })

      const failure = await Effect.runPromise(
        Effect.flip(onEnd!({ mode: 'report', checkout }, { id: RUN, outcome: 'completed' }))
      )

      expect(message(failure)).toBe('cleanup failed')
    })
  })

  describe('the schedule', () => {
    const tick = { scheduledAt: '2026-11-26T22:00:00.000Z' }

    it('starts nothing while its switch is unset', async () => {
      const run = await fire('birdbrain-dispatch-schedule', tick)

      expect(run.outcome).toBe('skipped')
      expect(run.reason).toBe('the schedule switch is off or unset')
      expect(started).toEqual([])
    })

    it('starts nothing while its switch is off', async () => {
      stored.set(SWITCH_KEY, { mode: 'off', checkout })

      const run = await fire('birdbrain-dispatch-schedule', tick)

      expect(run.outcome).toBe('skipped')
      expect(started).toEqual([])
    })

    it.each(['report', 'cycle'])('starts one %s fire, keyed by the tick', async (mode) => {
      stored.set(SWITCH_KEY, { mode, checkout })

      const run = await fire('birdbrain-dispatch-schedule', tick)

      expect(run.outcome).toBe('completed')
      expect(started).toEqual([
        {
          workflow: 'birdbrain-dispatch',
          payload: { mode, checkout },
          options: { key: 'tick/2026-11-26T22:00:00.000Z' }
        }
      ])
      expect(run.journal).toEqual([{ name: 'fire', kind: 'done', value: 'started-1' }])
      expect(calls()).toEqual([])
    })

    it('stops on a switch value it cannot read, and starts nothing', async () => {
      stored.set(SWITCH_KEY, { mode: 'sometimes', checkout })

      const run = await fire('birdbrain-dispatch-schedule', tick)

      expect(run.outcome).toBe('stopped')
      expect(run.reason).toMatch(/^fire: /)
      expect(started).toEqual([])
    })

    it('stops when the fire cannot be started', async () => {
      stored.set(SWITCH_KEY, { mode: 'report', checkout })
      startFails = true

      const run = await fire('birdbrain-dispatch-schedule', tick)

      expect(run.outcome).toBe('stopped')
      expect(run.reason).toBe('fire: the server refused the start')
    })
  })
})
