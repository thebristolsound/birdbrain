// The local dispatch host as a T3 Code durable workflow: one fire of the dispatch routine on
// the maintainer's machine, with each gate of .github/workflows/dispatch.yml (ADR-0026) as one
// journaled step. phase.sh beside this file holds each gate's shell.
//
// T3 Code loads definitions only from ~/.t3/workflows/, so copy this file there to install it.
// It injects T3, Effect, Schema and Option as globals; importing effect here loads a second
// runtime the engine cannot run. Raise `version` whenever a body changes.
//
// One fire by hand:
//   t3 workflow start birdbrain-dispatch --key report-1 \
//     --input '{"mode":"report","checkout":"<absolute path of a checkout>"}'
// The hourly schedule does nothing until its switch is set, and `off` stops it again:
//   t3 workflow store set birdbrain-dispatch/schedule '{"mode":"report","checkout":"<path>"}'
import { spawn } from 'node:child_process'
import { join } from 'node:path'

const { workflow, step, sleep, title, stop, skip, start, store, every, Tick } = T3

const PHASE = 'scripts/dispatch-workflow/phase.sh'

const Fire = Schema.Struct({
  mode: Schema.Literals(['report', 'cycle']),
  checkout: Schema.String,
  issue: Schema.optional(Schema.Number)
})

// What cleanup.sh is told about the job. An outcome this table does not name reads as failure.
const JOB_STATUS = { completed: 'success', skipped: 'success', cancelled: 'cancelled' }

const lastLine = (text) => text.trim().split('\n').at(-1) ?? ''

const phase = (name, fire, runId, env = {}) =>
  Effect.tryPromise({
    try: (signal) =>
      new Promise((resolve, reject) => {
        const child = spawn('bash', [join(fire.checkout, PHASE), name], {
          env: {
            ...process.env,
            ...env,
            RUN_ID: runId.replace(/[^A-Za-z0-9._-]/g, '_'),
            MODE: fire.mode,
            TARGET_ISSUE: fire.issue === undefined ? '' : String(fire.issue)
          },
          stdio: ['ignore', 'pipe', 'pipe'],
          signal
        })
        let out = ''
        let err = ''
        child.stdout.on('data', (chunk) => (out = (out + chunk).slice(-4000)))
        child.stderr.on('data', (chunk) => (err = (err + chunk).slice(-4000)))
        child.on('error', reject)
        child.on('close', (code) =>
          code === 0
            ? resolve(lastLine(out))
            : reject(new Error(lastLine(err) || `${name} exited ${code}`))
        )
      }),
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause)))
  })

// A failed gate ends the run as stopped. A failed plain step would pause it instead, and a
// paused run resumes by itself: the paid cycle must not get a second attempt that way
// (ADR-0029). The next fire is the retry.
const gate = (name, fire, runId, as = name) =>
  Effect.gen(function* () {
    const result = yield* step.try(as, { returns: Schema.String }, phase(name, fire, runId))
    if (result.outcome === 'failed') return yield* stop(`${name}: ${result.reason}`)
    return result.value
  })

// phase.sh stops a cycle at DISPATCH_TIMEOUT_MINUTES, 110 by default, long before this many
// one-minute checks.
const CYCLE_CHECKS = 300

// The cycle runs outside any step and the body polls it. On 2026-11-26 T3 Code 0.1.13 left a
// step's process running after its run was cancelled and ran onEnd three minutes later; a
// run cancelled during a wait ran onEnd within two seconds.
const cycle = (fire, runId) =>
  Effect.gen(function* () {
    yield* gate('cycle-start', fire, runId)
    for (let n = 1; n <= CYCLE_CHECKS; n++) {
      const seen = yield* gate('cycle-check', fire, runId, `cycle-check-${n}`)
      if (seen !== 'running') return seen
      yield* sleep(`cycle-wait-${n}`, '1 minute')
    }
    return yield* stop(`cycle-check: still running after ${CYCLE_CHECKS} checks`)
  })

const dispatch = workflow(
  'birdbrain-dispatch',
  {
    version: 1,
    payload: Fire,
    // dispatch.yml's concurrency group: one fire at a time, and a later one queues.
    concurrency: 1,
    // dispatch.yml's always() steps. The hook sees no variable of the body, so phase.sh reads
    // what the run reached from its run directory, which is named after the run id.
    onEnd: (fire, end) =>
      phase('finish', fire, end.id, { JOB_STATUS: JOB_STATUS[end.outcome] ?? 'failure' })
  },
  Effect.fn(function* (fire, run) {
    yield* title(`Dispatch ${fire.mode}${fire.issue === undefined ? '' : ` #${fire.issue}`}`)
    yield* gate('identity', fire, run.id)
    const decision = yield* gate('pregate', fire, run.id)
    if (decision !== 'run') return yield* skip(decision)
    yield* gate('toolchain', fire, run.id)
    yield* gate('ledger', fire, run.id)
    yield* gate('credential', fire, run.id)
    yield* cycle(fire, run.id)
    if (fire.mode === 'cycle') yield* gate('postcheck', fire, run.id)
  })
)

const Switch = Schema.Struct({
  mode: Schema.Literals(['off', 'report', 'cycle']),
  checkout: Schema.String
})
const schedule = store.entry('birdbrain-dispatch/schedule', Switch)

workflow(
  'birdbrain-dispatch-schedule',
  { version: 1, payload: Tick, triggers: [every('1 hour')] },
  Effect.fn(function* (tick) {
    const fired = yield* step.try(
      'fire',
      { returns: Schema.NullOr(Schema.String) },
      Effect.gen(function* () {
        const set = yield* schedule.get
        if (Option.isNone(set) || set.value.mode === 'off') return null
        const { mode, checkout } = set.value
        const { runId } = yield* start(
          dispatch,
          { mode, checkout },
          { key: `tick/${tick.scheduledAt}` }
        )
        return runId
      })
    )
    if (fired.outcome === 'failed') return yield* stop(`fire: ${fired.reason}`)
    if (fired.value === null) return yield* skip('the schedule switch is off or unset')
  })
)
