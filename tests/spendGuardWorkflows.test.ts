import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'

// The spend ruling on #1310: a job that reads a stored secret runs only when the maintainer
// started the attempt, or on a schedule's first attempt where the workflow has one.
// github.triggering_actor names whoever started the attempt; github.actor keeps the first
// attempt's user on a re-run, which anyone with write access can start.
const WORKFLOWS = join(__dirname, '..', '.github', 'workflows')
const GUARD = "github.triggering_actor == 'thebristolsound'"
// release.yml runs on a `v*` tag push, and a tag ruleset lets only the maintainer create one.
const EXEMPT = ['release.yml']

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

const secretJobs = readdirSync(WORKFLOWS)
  .filter((file) => file.endsWith('.yml') && !EXEMPT.includes(file))
  .flatMap((file) => {
    const content = readFileSync(join(WORKFLOWS, file), 'utf8')
    return [...jobBlocks(content)]
      .filter(([, block]) => block.some((line) => /\bsecrets\.[A-Z_]+/.test(line)))
      .map(([job, block]): [string, string, string, boolean] => [
        file,
        job,
        jobIf(block),
        /^ {2}schedule:/m.test(content)
      ])
  })

describe('spend guard on jobs that read a stored secret', () => {
  it('finds every such job', () => {
    expect(secretJobs.map(([file, job]) => `${file} ${job}`).sort()).toEqual([
      'claude.yml claude',
      'dispatch.yml cycle',
      'doc-curator.yml curate',
      'health.yml check',
      'jev-lens.yml hunks',
      'jev-lens.yml triage',
      'release-macos.yml build-macos'
    ])
  })

  it.each(secretJobs)('%s job %s checks who started the attempt', (_file, _job, condition) => {
    expect(condition).toContain(GUARD)
  })

  it.each(secretJobs.filter(([, , , scheduled]) => scheduled))(
    '%s job %s admits a scheduled run only on its first attempt',
    (_file, _job, condition) => {
      expect(condition).toContain("(github.event_name == 'schedule' && github.run_attempt == '1')")
    }
  )
})
