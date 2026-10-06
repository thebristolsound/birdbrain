import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

// The spend ruling on #1310: a job that reads a stored secret runs only when the maintainer
// started the attempt, or on a schedule's first attempt where the workflow has one.
// github.triggering_actor names whoever started the attempt; github.actor keeps the first
// attempt's user on a re-run, which anyone with write access can start.
const WORKFLOWS = join(__dirname, '..', '.github', 'workflows')
const GUARD = "github.triggering_actor == 'thebristolsound'"
const SCHEDULED = "(github.event_name == 'schedule' && github.run_attempt == '1')"
// hunks also admits the machine account, which pushes agent PRs.
const GUARD_OR_MACHINE = `(${GUARD} || github.triggering_actor == 'birdbrain-agent')`
// release.yml runs on a `v*` tag push, and a tag ruleset lets only the maintainer create one.
const EXEMPT = ['release.yml']
// The maintainer's follow-up spend ruling of 2026-09-28: the paid credentials belong in this
// environment, which admits only main and `v*` tags. hunks runs on pull request refs, which it
// refuses, so it goes without.
const ENVIRONMENT = 'paid-runs'
const PAID_SECRETS = [
  'BIRDBRAIN_AGENT_GH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'RELEASES_REPO_TOKEN',
  'TYPESAFE_API_KEY'
]
const NO_ENVIRONMENT = ['jev-lens.yml hunks']
// Events whose GITHUB_REF is a pull request's merge ref, which the environment refuses.
const PR_REF_EVENTS = ['pull_request', 'pull_request_review', 'pull_request_review_comment']

// Each job's lines under `jobs:`, keyed by job id.
function jobBlocks(content: string): Map<string, string[]> {
  const blocks = new Map<string, string[]>()
  const lines = content.split('\n')
  let current: string[] | undefined
  for (const line of lines.slice(lines.indexOf('jobs:') + 1)) {
    const header = line.match(/^ {2}([A-Za-z0-9_-]+):\s*$/)
    if (header) {
      current = []
      blocks.set(header[1], current)
    } else if (/^[^\s#]/.test(line)) {
      break
    } else {
      current?.push(line)
    }
  }
  return blocks
}

// A job's own `if:`, including the continuation lines of a block scalar.
function jobIf(block: string[]): string {
  const start = block.findIndex((line) => /^ {4}if:/.test(line))
  if (start === -1) return ''
  const rest = block.slice(start + 1)
  const end = rest.findIndex((line) => line.trim() !== '' && !/^ {5}/.test(line))
  return [block[start], ...rest.slice(0, end === -1 ? rest.length : end)].join('\n')
}

// The top-level trigger names under `on:`.
function triggers(content: string): string[] {
  const lines = content.split('\n')
  const names: string[] = []
  for (const line of lines.slice(lines.indexOf('on:') + 1)) {
    if (/^[^\s#]/.test(line)) break
    const name = line.match(/^ {2}([a-z_]+):/)
    if (name) names.push(name[1])
  }
  return names
}

// Split an expression on a top-level operator, ignoring any inside parentheses.
function splitTop(expr: string, op: '&&' | '||'): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < expr.length; i++) {
    if (expr[i] === '(') depth++
    else if (expr[i] === ')') depth--
    else if (depth === 0 && expr.startsWith(op, i)) {
      parts.push(expr.slice(start, i).trim())
      start = i + op.length
    }
  }
  return [...parts, expr.slice(start).trim()]
}

// The expression of a job's `if:`, on one line.
const expression = (condition: string): string =>
  condition
    .replace(/^\s*if:\s*(?:[>|]-?)?/, '')
    .replace(/\s+/g, ' ')
    .trim()

type Job = { file: string; job: string; condition: string; scheduled: boolean; block: string[] }

const allJobs: Job[] = readdirSync(WORKFLOWS)
  .filter((file) => file.endsWith('.yml'))
  .flatMap((file) => {
    const content = readFileSync(join(WORKFLOWS, file), 'utf8')
    return [...jobBlocks(content)].map(([job, block]) => ({
      file,
      job,
      condition: jobIf(block),
      scheduled: /^ {2}schedule:/m.test(content),
      block
    }))
  })

const readsSecret = ({ block }: Job): boolean =>
  block.some((line) => /\bsecrets\.[A-Z_]+/.test(line))

const secretJobs = allJobs
  .filter((job) => !EXEMPT.includes(job.file) && readsSecret(job))
  .map(({ file, job, condition, scheduled }): [string, string, string, boolean] => [
    file,
    job,
    condition,
    scheduled
  ])

const paidJobs = allJobs.filter(readsSecret)
const declaresEnvironment = ({ block }: Job): boolean =>
  block.some((line) => line === `    environment: ${ENVIRONMENT}`)

describe('spend guard on jobs that read a stored secret', () => {
  it('finds every such job', () => {
    expect(secretJobs.map(([file, job]) => `${file} ${job}`).sort()).toEqual([
      'claude.yml claude',
      'dispatch.yml cycle',
      'doc-curator.yml curate',
      'health.yml check',
      'jev-lens.yml hunks',
      'jev-lens.yml triage',
      'merge-on-label.yml request',
      'release-macos.yml build-macos',
      'release-macos.yml refresh-checksums'
    ])
  })

  // A disjunction at the top of the condition would let the guard be bypassed, so the
  // guard must be the whole condition, a top-level conjunct, or the scheduled-first-attempt
  // alternative's partner.
  it.each(secretJobs)('%s job %s checks who started the attempt', (_file, _job, condition) => {
    const expr = expression(condition)
    const alternatives = splitTop(expr, '||')
    if (alternatives.length > 1) {
      expect(alternatives).toEqual([SCHEDULED, GUARD])
    } else {
      const conjuncts = splitTop(expr, '&&')
      expect(conjuncts.some((c) => c === GUARD || c === GUARD_OR_MACHINE)).toBe(true)
    }
  })

  it.each(secretJobs.filter(([, , , scheduled]) => scheduled))(
    '%s job %s admits a scheduled run only on its first attempt',
    (_file, _job, condition) => {
      expect(splitTop(expression(condition), '||')).toEqual([SCHEDULED, GUARD])
    }
  )
})

describe(`the ${ENVIRONMENT} environment`, () => {
  it('holds every stored secret a workflow reads', () => {
    const read = new Set(
      paidJobs.flatMap(({ block }) =>
        block.flatMap((line) => [...line.matchAll(/\bsecrets\.([A-Z_]+)/g)].map((m) => m[1]))
      )
    )
    expect([...read].sort()).toEqual(PAID_SECRETS)
  })

  it.each(paidJobs.map((job): [string, string, Job] => [job.file, job.job, job]))(
    '%s job %s names the environment unless it runs on pull request refs',
    (file, job, entry) => {
      expect(declaresEnvironment(entry)).toBe(!NO_ENVIRONMENT.includes(`${file} ${job}`))
    }
  )

  // A job that names the environment and starts on a pull request's merge ref would fail at
  // the deployment check, so it must require some other event.
  it.each(
    paidJobs
      .filter(declaresEnvironment)
      .map((job): [string, string, Job] => [job.file, job.job, job])
  )('%s job %s never starts on a pull request ref', (file, _job, { condition }) => {
    const content = readFileSync(join(WORKFLOWS, file), 'utf8')
    const prEvents = triggers(content).filter((name) => PR_REF_EVENTS.includes(name))
    if (prEvents.length === 0) return
    const [first] = splitTop(expression(condition), '&&')
    const required = first.match(/^github\.event_name == '([a-z_]+)'$/)?.[1]
    expect(required).toBeDefined()
    expect(PR_REF_EVENTS).not.toContain(required)
  })
})
