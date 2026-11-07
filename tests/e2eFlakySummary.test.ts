import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
// @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
import {
  annotations,
  formatSummary,
  MAX_ANNOTATIONS,
  summarize
} from '../scripts/e2e-flaky-summary.mjs'

const SCRIPT = resolve(__dirname, '../scripts/e2e-flaky-summary.mjs')
const ROOT = '/repo/e2e'

const result = (status: string, retry: number) => ({ status, retry })

// The shape Playwright's JSON reporter writes: a suite per spec file, describe blocks nested
// under it, each spec holding one test per project.
const report = {
  config: { rootDir: ROOT },
  suites: [
    {
      title: 'capture.spec.ts',
      file: 'capture.spec.ts',
      specs: [
        {
          title: 'saves a page',
          file: 'capture.spec.ts',
          line: 12,
          tests: [{ status: 'expected', results: [result('passed', 0)] }]
        }
      ],
      suites: [
        {
          title: 'Case view',
          file: 'capture.spec.ts',
          specs: [
            {
              title: 'opens the evidence tab',
              file: 'capture.spec.ts',
              line: 40,
              tests: [
                {
                  status: 'flaky',
                  results: [result('failed', 0), result('timedOut', 1), result('passed', 2)]
                }
              ]
            }
          ]
        }
      ]
    },
    {
      title: 'export.spec.ts',
      file: 'export.spec.ts',
      specs: [
        {
          title: 'exports a report',
          file: 'export.spec.ts',
          line: 7,
          tests: [{ status: 'unexpected', results: [result('failed', 0)] }]
        },
        {
          title: 'skips on mac',
          file: 'export.spec.ts',
          line: 30,
          tests: [{ status: 'skipped', results: [result('skipped', 0)] }]
        }
      ]
    }
  ]
}

describe('summarize', () => {
  it('counts each test by its final status', () => {
    const stats = summarize(report, '/repo')
    expect(stats).toMatchObject({ total: 4, passed: 1, failed: 1, flaky: 1, skipped: 1 })
  })

  it('names a flaky spec by its describe path, repository path and failed attempts', () => {
    expect(summarize(report, '/repo').flakyTests).toEqual([
      {
        file: 'e2e/capture.spec.ts',
        line: 40,
        title: 'Case view > opens the evidence tab',
        attempts: 3,
        failures: 2
      }
    ])
  })

  it('keeps the reported path when the report carries no rootDir', () => {
    const stats = summarize({ suites: report.suites }, '/repo')
    expect(stats.flakyTests[0].file).toBe('capture.spec.ts')
  })

  it('treats a report with no suites as empty', () => {
    expect(summarize({}, '/repo')).toMatchObject({ total: 0, flaky: 0, flakyTests: [] })
  })
})

describe('formatSummary', () => {
  it('lists each flaky spec with its location', () => {
    const text = formatSummary(summarize(report, '/repo'))
    expect(text).toContain('| 4 | 1 | 1 | 1 | 1 |')
    expect(text).toContain(
      '| `e2e/capture.spec.ts:40` Case view > opens the evidence tab | 2 | 3 |'
    )
  })

  it('escapes a pipe so a title cannot end its table cell', () => {
    const text = formatSummary({
      total: 1,
      passed: 0,
      failed: 0,
      flaky: 1,
      skipped: 0,
      flakyTests: [{ file: 'e2e/a.spec.ts', line: 3, title: 'a | b', attempts: 2, failures: 1 }]
    })
    expect(text).toContain('| `e2e/a.spec.ts:3` a \\| b | 1 | 2 |')
  })

  it('says so when no spec needed a retry', () => {
    const text = formatSummary(summarize({ suites: [report.suites[1]] }, '/repo'))
    expect(text).toContain('No spec needed a retry to pass.')
    expect(text).not.toContain('Failed attempts')
  })
})

describe('annotations', () => {
  it('emits one warning per flaky spec at its file and line', () => {
    expect(annotations(summarize(report, '/repo'))).toEqual([
      '::warning file=e2e/capture.spec.ts,line=40,title=Flaky E2E spec::' +
        'Case view > opens the evidence tab failed 2 of 3 attempts before passing'
    ])
  })

  it('escapes workflow-command characters in the title and path', () => {
    const [line] = annotations({
      flakyTests: [{ file: 'e2e/a,b:c.ts', line: 1, title: '100%\nnew', attempts: 2, failures: 1 }]
    })
    expect(line).toBe(
      '::warning file=e2e/a%2Cb%3Ac.ts,line=1,title=Flaky E2E spec::' +
        '100%25%0Anew failed 1 of 2 attempts before passing'
    )
  })
})

describe('annotations past the per-step limit', () => {
  const flaky = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      file: 'e2e/a.spec.ts',
      line: i + 1,
      title: `spec ${i + 1}`,
      attempts: 2,
      failures: 1
    }))

  it('emits every warning when the specs fit the limit', () => {
    const lines = annotations({ flakyTests: flaky(MAX_ANNOTATIONS) })
    expect(lines).toHaveLength(MAX_ANNOTATIONS)
    expect(lines.at(-1)).toContain(`line=${MAX_ANNOTATIONS},`)
  })

  it('keeps the last slot for a count of the specs it left out', () => {
    const lines = annotations({ flakyTests: flaky(MAX_ANNOTATIONS + 3) })
    expect(lines).toHaveLength(MAX_ANNOTATIONS)
    expect(lines.at(-2)).toContain(`line=${MAX_ANNOTATIONS - 1},`)
    expect(lines.at(-1)).toBe(
      '::warning title=Flaky E2E spec::4 more flaky specs; the job summary lists every one'
    )
  })
})

describe('the script', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'e2e-flaky-'))
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  const run = (args: string[], env: Record<string, string> = {}) =>
    execFileSync(process.execPath, [SCRIPT, ...args], {
      cwd: dir,
      encoding: 'utf8',
      stdio: 'pipe',
      env: { ...process.env, GITHUB_STEP_SUMMARY: '', ...env }
    })

  it('writes the summary to the step summary file and annotations to stdout', () => {
    const reportPath = join(dir, 'report.json')
    const summaryPath = join(dir, 'summary.md')
    writeFileSync(reportPath, JSON.stringify({ ...report, config: { rootDir: join(dir, 'e2e') } }))
    writeFileSync(summaryPath, '')

    const stdout = run([reportPath], { GITHUB_STEP_SUMMARY: summaryPath })

    expect(readFileSync(summaryPath, 'utf8')).toContain('Case view > opens the evidence tab')
    expect(stdout).toContain('::warning file=e2e/capture.spec.ts,line=40,')
  })

  it('reports a missing report without failing', () => {
    const stdout = run([join(dir, 'absent.json')])
    expect(stdout).toContain('No Playwright JSON report at')
  })

  it('turns a report it cannot parse into a warning and exits 0', () => {
    const reportPath = join(dir, 'report.json')
    writeFileSync(reportPath, 'not json')
    const stdout = run([reportPath])
    expect(stdout).toMatch(/^::warning title=E2E retry report::Not written: /m)
  })
})
