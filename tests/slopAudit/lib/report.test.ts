import { describe, expect, it } from 'vitest'
import {
  SCHEMA_VERSION,
  buildEnvelope,
  exitCode,
  renderJson,
  renderText
  // @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
} from '../../../scripts/slop-audit/lib/report.mjs'

type Finding = {
  id: string
  severity: string
  file: string
  line: number
  message: string
  evidence?: string
  section: string
}

const finding = (over: Partial<Finding> = {}): Finding => ({
  id: 'test.exit-zero',
  severity: 'blocking',
  file: 'tests/a.test.ts',
  line: 3,
  message: 'process.exit(0) in a test',
  evidence: 'process.exit(0)',
  section: '1.1',
  ...over
})

describe('buildEnvelope', () => {
  it('stamps the schema version, commit and dirty flag, and counts by severity', () => {
    const envelope = buildEnvelope({
      commit: 'abc123',
      dirty: true,
      findings: [finding(), finding({ severity: 'advisory', id: 'comments.narration' })]
    })
    expect(envelope.schemaVersion).toBe(SCHEMA_VERSION)
    expect(envelope.commit).toBe('abc123')
    expect(envelope.dirty).toBe(true)
    expect(envelope.counts).toEqual({ blocking: 1, advisory: 1 })
    expect(envelope.adapters).toEqual([])
    expect(envelope.skipped).toEqual([])
    expect(envelope.stale).toEqual([])
  })

  it('sorts findings by file, then line, then id, without mutating the input', () => {
    const input = [
      finding({ file: 'src/b.ts', line: 9 }),
      finding({ file: 'src/a.ts', line: 20, id: 'z.check' }),
      finding({ file: 'src/a.ts', line: 20, id: 'a.check' }),
      finding({ file: 'src/a.ts', line: 2 })
    ]
    const before = [...input]
    const { findings } = buildEnvelope({ commit: 'c', dirty: false, findings: input })
    expect(findings.map((f: Finding) => `${f.file}:${f.line}:${f.id}`)).toEqual([
      'src/a.ts:2:test.exit-zero',
      'src/a.ts:20:a.check',
      'src/a.ts:20:z.check',
      'src/b.ts:9:test.exit-zero'
    ])
    expect(input).toEqual(before)
  })

  it('rejects a severity outside the two tiers', () => {
    expect(() =>
      buildEnvelope({ commit: 'c', dirty: false, findings: [finding({ severity: 'gate' })] })
    ).toThrow('test.exit-zero: unknown severity "gate"')
  })
})

describe('renderJson', () => {
  it('round-trips the envelope', () => {
    const envelope = buildEnvelope({ commit: 'c', dirty: false, findings: [finding()] })
    expect(JSON.parse(renderJson(envelope))).toEqual(envelope)
  })
})

describe('renderText', () => {
  it('names the commit, marks a dirty tree, groups by id, and ends with the counts', () => {
    const envelope = buildEnvelope({
      commit: 'abc123',
      dirty: true,
      findings: [finding(), finding({ line: 8, evidence: undefined })],
      skipped: [{ name: 'jscpd', reason: 'not requested' }],
      stale: [{ id: 'test.exit-zero', path: 'tests/gone.test.ts' }]
    })
    const text = renderText(envelope)
    const lines = text.split('\n')
    expect(lines[0]).toBe('slop-audit: abc123 (dirty working tree)')
    expect(lines[1]).toBe('test.exit-zero - 2')
    expect(lines[2]).toBe('  blocking  tests/a.test.ts:3  process.exit(0) in a test')
    expect(lines[3]).toBe('      process.exit(0)')
    expect(lines[4]).toBe('  blocking  tests/a.test.ts:8  process.exit(0) in a test')
    expect(lines[5]).toBe('skipped jscpd: not requested')
    expect(lines[6]).toBe('stale allowlist entry: test.exit-zero tests/gone.test.ts')
    expect(lines[7]).toBe('slop-audit: 2 blocking, 0 advisory')
    expect(lines).toHaveLength(8)
  })

  it('prints only the header and the counts on a clean tree', () => {
    const envelope = buildEnvelope({ commit: 'abc123', dirty: false, findings: [] })
    expect(renderText(envelope)).toBe('slop-audit: abc123\nslop-audit: 0 blocking, 0 advisory')
  })
})

describe('exitCode', () => {
  const blocking = buildEnvelope({ commit: 'c', dirty: false, findings: [finding()] })
  const advisory = buildEnvelope({
    commit: 'c',
    dirty: false,
    findings: [finding({ severity: 'advisory' })]
  })

  it('is 0 without --strict whatever was found', () => {
    expect(exitCode({ envelope: blocking, strict: false })).toBe(0)
  })

  it('is 1 under --strict only when a blocking finding exists', () => {
    expect(exitCode({ envelope: blocking, strict: true })).toBe(1)
    expect(exitCode({ envelope: advisory, strict: true })).toBe(0)
  })
})
