import { describe, expect, it } from 'vitest'
import {
  countIssues,
  createKnipRunner,
  parseKnipReport
  // @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
} from '../../scripts/repo-health/lib/knip.mjs'
// @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
import { Unmeasured } from '../../scripts/repo-health/lib/unmeasured.mjs'
import { knipIssue } from './helpers'

type SpawnCall = { command: string; args: string[]; options: { env: Record<string, string> } }

const report = { issues: [knipIssue('src/a.ts', { exports: 2 }), knipIssue('src/b.ts')] }

const runner = (over: Record<string, unknown> = {}) => {
  const calls: SpawnCall[] = []
  const run = createKnipRunner({
    root: '/repo',
    exists: () => true,
    spawn: (command: string, args: string[], options: SpawnCall['options']) => {
      calls.push({ command, args, options })
      return { stdout: JSON.stringify(report), status: 1 }
    },
    env: { PATH: '/bin', GH_TOKEN: 'gh-secret', GITHUB_TOKEN: 'github-secret' },
    ...over
  })
  return { run, calls }
}

describe('parseKnipReport', () => {
  it('returns the report when it has an issues list', () => {
    expect(parseKnipReport(JSON.stringify(report))).toEqual(report)
  })

  it('is not measured on output that is not JSON', () => {
    expect(() => parseKnipReport('Error: cannot load vitest.config.ts')).toThrow(Unmeasured)
    expect(() => parseKnipReport('')).toThrow('knip printed no JSON report')
  })

  it('is not measured on JSON with no issues list, which is not a clean report', () => {
    expect(() => parseKnipReport('{}')).toThrow('knip report has no issues list')
    expect(() => parseKnipReport('null')).toThrow('knip report has no issues list')
    expect(() => parseKnipReport('{"issues":{}}')).toThrow('knip report has no issues list')
  })
})

describe('countIssues', () => {
  it('sums the named kinds over every file', () => {
    const counted = {
      issues: [
        knipIssue('a.ts', { exports: 2, types: 1, files: 1 }),
        knipIssue('b.ts', { exports: 3 })
      ]
    }
    expect(countIssues(counted, ['exports', 'types'])).toBe(6)
    expect(countIssues(counted, ['files'])).toBe(1)
    expect(countIssues({ issues: [] }, ['files'])).toBe(0)
  })

  it('is not measured when a kind is missing, so a renamed key cannot read as zero', () => {
    const renamed = { issues: [{ file: 'a.ts', unusedExports: [{ name: 'x' }] }] }
    expect(() => countIssues(renamed, ['exports'])).toThrow(Unmeasured)
    expect(() => countIssues(renamed, ['exports'])).toThrow('knip report has no "exports" list')
    expect(() => countIssues({ issues: [{ exports: {} }] }, ['exports'])).toThrow(Unmeasured)
    expect(() => countIssues({ issues: [null] }, ['exports'])).toThrow(Unmeasured)
  })
})

describe('createKnipRunner', () => {
  it('runs the installed knip with the JSON reporter in the repository root', () => {
    const { run, calls } = runner()
    expect(run()).toEqual(report)
    expect(calls).toHaveLength(1)
    expect(calls[0].command).toBe('/repo/node_modules/.bin/knip')
    expect(calls[0].args).toEqual(['--reporter', 'json', '--no-progress'])
    expect(calls[0].options).toMatchObject({ cwd: '/repo', encoding: 'utf8' })
  })

  it('keeps the GitHub tokens out of the environment knip and its plugins see', () => {
    const { run, calls } = runner()
    run()
    expect(calls[0].options.env).toEqual({ PATH: '/bin' })
  })

  it('falls back to the process environment, still without the tokens', () => {
    const { run, calls } = runner({ env: undefined })
    run()
    expect(calls[0].options.env).not.toHaveProperty('GH_TOKEN')
    expect(calls[0].options.env).not.toHaveProperty('GITHUB_TOKEN')
    expect(calls[0].options.env.PATH).toBe(process.env.PATH)
  })

  it('reads a non-zero exit with a report as a report: knip exits 1 on any finding', () => {
    const { run } = runner()
    expect(run().issues).toHaveLength(2)
  })

  it('runs knip once however many signals ask', () => {
    const { run, calls } = runner()
    run()
    run()
    run()
    expect(calls).toHaveLength(1)
  })

  it('is not measured without an install, and does not try to start knip', () => {
    const { run, calls } = runner({ exists: () => false })
    expect(run).toThrow(Unmeasured)
    expect(run).toThrow('knip is not installed')
    expect(calls).toHaveLength(0)
  })

  it('is not measured when knip cannot be started', () => {
    const { run } = runner({ spawn: () => ({ error: new Error('EACCES'), stdout: '' }) })
    expect(run).toThrow('knip could not be started')
  })

  it('remembers a failure too, so three signals do not start knip three times', () => {
    let starts = 0
    const { run } = runner({
      spawn: () => {
        starts += 1
        return { stdout: 'not json', status: 2 }
      }
    })
    expect(run).toThrow('knip printed no JSON report')
    expect(run).toThrow('knip printed no JSON report')
    expect(starts).toBe(1)
  })
})
