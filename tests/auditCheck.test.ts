import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
// @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
import { collectFindings, evaluateAudit, parseExceptions } from '../scripts/audit-check.mjs'

const ROOT = join(__dirname, '..')

type Finding = {
  tree: string
  ghsa: string
  package: string
  severity: string
  title: string
  paths: string[]
}

type Exception = { ghsa: string; package: string; tree: string; reason: string; expires: string }

const finding = (over: Partial<Finding> = {}): Finding => ({
  tree: '.',
  ghsa: 'GHSA-aaaa-bbbb-cccc',
  package: 'left-pad',
  severity: 'high',
  title: 'test advisory',
  paths: ['.>left-pad'],
  ...over
})

const exception = (over: Partial<Exception> = {}): Exception => ({
  ghsa: 'GHSA-aaaa-bbbb-cccc',
  package: 'left-pad',
  tree: '.',
  reason: 'test',
  expires: '2099-01-01',
  ...over
})

describe('collectFindings', () => {
  it('collapses one advisory reported against several version ranges', () => {
    const report = {
      advisories: {
        '1': {
          github_advisory_id: 'GHSA-1',
          module_name: 'brace-expansion',
          severity: 'high',
          title: 'DoS',
          findings: [{ version: '1.1.15', paths: ['.>a>brace-expansion'] }]
        },
        '2': {
          github_advisory_id: 'GHSA-1',
          module_name: 'brace-expansion',
          severity: 'high',
          title: 'DoS',
          findings: [{ version: '2.1.1', paths: ['.>b>brace-expansion', '.>a>brace-expansion'] }]
        }
      }
    }

    const findings = collectFindings(report, '.')

    expect(findings).toHaveLength(1)
    expect(findings[0].paths).toEqual(['.>a>brace-expansion', '.>b>brace-expansion'])
  })

  it('returns nothing for a clean report', () => {
    expect(collectFindings({ advisories: {} }, '.')).toEqual([])
    expect(collectFindings({}, 'website')).toEqual([])
  })
})

describe('evaluateAudit', () => {
  const today = '2026-08-05'

  it('blocks a high advisory with no exception', () => {
    const { violations } = evaluateAudit({ findings: [finding()], exceptions: [], today })

    expect(violations).toHaveLength(1)
    expect(violations[0].why).toBe('no accepted exception')
  })

  it('accepts an unexpired exception', () => {
    const result = evaluateAudit({
      findings: [finding()],
      exceptions: [exception({ expires: '2026-08-06' })],
      today
    })

    expect(result.violations).toEqual([])
    expect(result.accepted).toHaveLength(1)
  })

  // The whole point of the expiry field: an accepted advisory becomes a build
  // failure on its own, without anyone remembering to revisit it.
  it('blocks once the exception has expired', () => {
    const { violations } = evaluateAudit({
      findings: [finding()],
      exceptions: [exception({ expires: '2026-08-04' })],
      today
    })

    expect(violations).toHaveLength(1)
    expect(violations[0].why).toBe('exception expired on 2026-08-04')
  })

  it('treats the expiry date itself as still accepted', () => {
    const { violations } = evaluateAudit({
      findings: [finding()],
      exceptions: [exception({ expires: today })],
      today
    })

    expect(violations).toEqual([])
  })

  it('does not let an exception cover another tree or another package', () => {
    const { violations } = evaluateAudit({
      findings: [finding({ tree: 'website' }), finding({ package: 'right-pad' })],
      exceptions: [exception()],
      today
    })

    expect(violations).toHaveLength(2)
    expect(
      violations.every((v: Finding & { why: string }) => v.why === 'no accepted exception')
    ).toBe(true)
  })

  it('ignores advisories below the blocking severities', () => {
    const result = evaluateAudit({
      findings: [finding({ severity: 'moderate' }), finding({ severity: 'low' })],
      exceptions: [],
      today
    })

    expect(result.blocking).toEqual([])
    expect(result.violations).toEqual([])
  })

  it('blocks a critical advisory', () => {
    const { violations } = evaluateAudit({
      findings: [finding({ severity: 'critical' })],
      exceptions: [],
      today
    })

    expect(violations).toHaveLength(1)
  })

  it('reports an exception whose advisory is gone without failing the build', () => {
    const result = evaluateAudit({ findings: [], exceptions: [exception()], today })

    expect(result.violations).toEqual([])
    expect(result.unused).toHaveLength(1)
  })
})

describe('parseExceptions', () => {
  it('rejects a file with no exceptions array', () => {
    expect(() => parseExceptions({})).toThrow(/exceptions/)
  })

  it('rejects an entry missing its reason', () => {
    const entry: Partial<Exception> = exception()
    delete entry.reason
    expect(() => parseExceptions({ exceptions: [entry] })).toThrow(/reason/)
  })

  it('rejects a non-ISO expiry', () => {
    expect(() => parseExceptions({ exceptions: [exception({ expires: '03/11/2026' })] })).toThrow(
      /YYYY-MM-DD/
    )
  })

  it('rejects an unknown tree', () => {
    expect(() => parseExceptions({ exceptions: [exception({ tree: 'extension' })] })).toThrow(
      /tree/
    )
  })

  it('accepts the checked-in exception file', () => {
    const raw = JSON.parse(readFileSync(join(ROOT, 'audit-exceptions.json'), 'utf8'))
    expect(() => parseExceptions(raw)).not.toThrow()
  })
})
