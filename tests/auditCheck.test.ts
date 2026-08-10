import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  collectFindings,
  describeReportProblem,
  evaluateAudit,
  parseExceptions,
  MAX_EXCEPTION_DAYS
  // @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
} from '../scripts/audit-check.mjs'

const ROOT = join(__dirname, '..')

type Finding = {
  tree: string
  ghsa: string
  package: string
  severity: string
  title: string
  paths: string[]
}

type Exception = {
  ghsa: string
  package: string
  tree: string
  path: string
  reason: string
  expires: string
}

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
  path: '.>left-pad',
  reason: 'test',
  expires: '2026-09-01',
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

  // The exception matcher identifies a finding by ghsa + tree + package, so the
  // collector has to as well. Keyed on the GHSA alone, a second package's finding
  // was dropped and an exception for the first silently covered it.
  it('keeps two packages reported under one advisory id apart', () => {
    const report = {
      advisories: {
        '1': {
          github_advisory_id: 'GHSA-1',
          module_name: 'pkg-a',
          severity: 'high',
          title: 'a',
          findings: [{ paths: ['.>pkg-a'] }]
        },
        '2': {
          github_advisory_id: 'GHSA-1',
          module_name: 'pkg-b',
          severity: 'critical',
          title: 'b',
          findings: [{ paths: ['.>pkg-b'] }]
        }
      }
    }

    const findings = collectFindings(report, '.')

    expect(findings).toHaveLength(2)
    expect(findings.map((f: { package: string }) => f.package)).toEqual(['pkg-a', 'pkg-b'])
    expect(findings[1].severity).toBe('critical')
  })

  it('keeps the highest severity when one advisory and package repeats', () => {
    const report = {
      advisories: {
        '1': {
          github_advisory_id: 'GHSA-1',
          module_name: 'pkg-a',
          severity: 'moderate',
          title: 'first',
          findings: [{ paths: ['.>a>pkg-a'] }]
        },
        '2': {
          github_advisory_id: 'GHSA-1',
          module_name: 'pkg-a',
          severity: 'critical',
          title: 'escalated',
          findings: [{ paths: ['.>b>pkg-a'] }]
        }
      }
    }

    const [only] = collectFindings(report, '.')

    expect(only.severity).toBe('critical')
    expect(only.title).toBe('escalated')
    expect(only.paths).toEqual(['.>a>pkg-a', '.>b>pkg-a'])
  })
})

// `pnpm audit` answers a registry failure with valid JSON on stdout and a
// non-zero exit, which parses to zero advisories. Without this check the gate
// read an outage as a clean tree and went green.
describe('describeReportProblem', () => {
  it('passes a real audit report', () => {
    expect(describeReportProblem({ advisories: {}, metadata: { vulnerabilities: {} } })).toBeNull()
  })

  it('rejects pnpm’s own error envelope', () => {
    const problem = describeReportProblem({
      error: { code: 'ERR_PNPM_AUDIT_ENDPOINT_NOT_EXISTS', message: 'the audit endpoint...' }
    })

    expect(problem).toContain('ERR_PNPM_AUDIT_ENDPOINT_NOT_EXISTS')
  })

  it('rejects a report with no metadata block', () => {
    expect(describeReportProblem({ advisories: {} })).toContain('metadata')
  })

  it('rejects a non-object body', () => {
    expect(describeReportProblem(null)).toContain('not a JSON object')
    expect(describeReportProblem('ok')).toContain('not a JSON object')
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

  // "Time-bounded" has to mean something: without a cap, a far-future date is a
  // permanent acceptance wearing an expiry field.
  it('blocks an exception written further out than the cap', () => {
    const { horizon } = evaluateAudit({
      findings: [finding()],
      exceptions: [exception({ expires: '2030-01-01' })],
      today
    })

    expect(horizon).toHaveLength(1)
    expect(horizon[0].days).toBeGreaterThan(MAX_EXCEPTION_DAYS)
  })

  it('applies the cap to entries whose advisory is not currently reported', () => {
    const { horizon } = evaluateAudit({
      findings: [],
      exceptions: [exception({ expires: '2030-01-01' })],
      today
    })

    expect(horizon).toHaveLength(1)
  })

  it('warns before an expiry rather than only failing on the day', () => {
    const { expiringSoon, violations } = evaluateAudit({
      findings: [finding()],
      exceptions: [exception({ expires: '2026-08-19' })],
      today
    })

    expect(violations).toEqual([])
    expect(expiringSoon).toHaveLength(1)
    expect(expiringSoon[0].days).toBe(14)
  })

  it('does not warn about an expiry that is still far off', () => {
    const { expiringSoon } = evaluateAudit({
      findings: [finding()],
      exceptions: [exception({ expires: '2026-11-03' })],
      today
    })

    expect(expiringSoon).toEqual([])
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

  it('rejects an entry missing the resolved path', () => {
    const entry: Partial<Exception> = exception()
    delete entry.path
    expect(() => parseExceptions({ exceptions: [entry] })).toThrow(/path/)
  })

  it('rejects a non-ISO expiry', () => {
    expect(() => parseExceptions({ exceptions: [exception({ expires: '03/11/2026' })] })).toThrow(
      /YYYY-MM-DD/
    )
  })

  // A regex on the shape let "9999-99-99" through, which is an exception that
  // never expires. 2026-02-30 is the subtler one: Date.parse accepts it and rolls
  // it to March 2.
  it('rejects a date that is only shaped like one', () => {
    expect(() => parseExceptions({ exceptions: [exception({ expires: '9999-99-99' })] })).toThrow(
      /real calendar day/
    )
    expect(() => parseExceptions({ exceptions: [exception({ expires: '2026-02-30' })] })).toThrow(
      /real calendar day/
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
