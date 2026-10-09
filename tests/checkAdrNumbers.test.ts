import { describe, expect, it } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
// @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
import { ALLOWED_DUPLICATES, findDuplicates } from '../scripts/check-adr-numbers.mjs'

const SCRIPT = resolve(__dirname, '..', 'scripts', 'check-adr-numbers.mjs')

const runOn = (names: string[]) => {
  const dir = mkdtempSync(join(tmpdir(), 'adr-numbers-'))
  try {
    for (const name of names) writeFileSync(join(dir, name), '# ADR\n')
    try {
      execFileSync(process.execPath, [SCRIPT, dir], { encoding: 'utf8', stdio: 'pipe' })
      return { exitCode: 0, stderr: '' }
    } catch (error) {
      const { status, stderr } = error as { status: number; stderr: string }
      return { exitCode: status, stderr }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('findDuplicates', () => {
  it('reports two ADRs that share a number', () => {
    expect(findDuplicates(['0042-b.md', '0042-a.md', '0043-c.md'], new Map())).toEqual([
      { number: '0042', files: ['0042-a.md', '0042-b.md'] }
    ])
  })

  it('ignores files that are not numbered ADRs', () => {
    expect(findDuplicates(['README.md', 'template.md', '0001-a.md'], new Map())).toEqual([])
  })

  it('accepts an allowlisted pair', () => {
    const pair = ALLOWED_DUPLICATES.get('0029')
    expect(findDuplicates(pair)).toEqual([])
  })

  it('reports a third file that joins an allowlisted pair', () => {
    const names = [...ALLOWED_DUPLICATES.get('0029'), '0029-new.md']
    expect(findDuplicates(names)).toHaveLength(1)
  })
})

describe('check-adr-numbers CLI', () => {
  it('exits 1 and names both files on a duplicate', () => {
    const { exitCode, stderr } = runOn(['0050-one.md', '0050-two.md'])
    expect(exitCode).toBe(1)
    expect(stderr).toContain('ADR 0050 is used by 0050-one.md, 0050-two.md')
  })

  it('exits 0 when every number is unique', () => {
    expect(runOn(['0050-one.md', '0051-two.md']).exitCode).toBe(0)
  })

  it('passes on the repository ADRs', () => {
    expect(() => execFileSync(process.execPath, [SCRIPT], { stdio: 'pipe' })).not.toThrow()
  })
})
