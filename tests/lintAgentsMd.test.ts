import { describe, expect, it } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import {
  LEFT,
  RIGHT,
  compareDocuments,
  summarize
  // @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
} from '../scripts/lint-agents-md.mjs'

const SCRIPT = resolve(__dirname, '..', 'scripts', 'lint-agents-md.mjs')

// Runs the script as CI does, in a throwaway directory holding just the two
// files, and returns what a caller sees: the exit code and the output.
const runIn = (left: string, right: string, env: NodeJS.ProcessEnv = {}) => {
  const dir = mkdtempSync(join(tmpdir(), 'agents-md-'))
  try {
    writeFileSync(join(dir, LEFT), left)
    writeFileSync(join(dir, RIGHT), right)
    const stdout = execFileSync(process.execPath, [SCRIPT], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, GITHUB_ACTIONS: '', ...env }
    })
    return { exitCode: 0, stdout }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('compareDocuments', () => {
  it('reports identical files as identical with nothing on either side', () => {
    expect(compareDocuments('a\nb\n', 'a\nb\n')).toEqual({
      identical: true,
      onlyInLeft: [],
      onlyInRight: []
    })
  })

  it('attributes a line to the side that holds it', () => {
    const result = compareDocuments('shared\nclaude only\n', 'shared\nagents only\n')

    expect(result.identical).toBe(false)
    expect(result.onlyInLeft).toEqual(['claude only'])
    expect(result.onlyInRight).toEqual(['agents only'])
  })

  it('ignores blank lines, which carry no content', () => {
    const result = compareDocuments('a\n\n\nb\n', 'a\nb\n')

    expect(result.identical).toBe(false)
    expect(result.onlyInLeft).toEqual([])
    expect(result.onlyInRight).toEqual([])
  })

  it('does not report a reordered section as drift', () => {
    const result = compareDocuments('first\nsecond\n', 'second\nfirst\n')

    expect(result.onlyInLeft).toEqual([])
    expect(result.onlyInRight).toEqual([])
  })

  it('counts a repeated line once per extra occurrence', () => {
    const result = compareDocuments('dup\ndup\n', 'dup\n')

    expect(result.onlyInLeft).toEqual(['dup'])
    expect(result.onlyInRight).toEqual([])
  })
})

describe('summarize', () => {
  it('names both sides when each holds lines the other does not', () => {
    const summary = summarize({ identical: false, onlyInLeft: ['a'], onlyInRight: ['b', 'c'] })

    expect(summary).toBe(`${LEFT} and ${RIGHT} differ - 1 only in ${LEFT}, 2 only in ${RIGHT}`)
  })

  it('names only the side that holds them', () => {
    const summary = summarize({ identical: false, onlyInLeft: ['a'], onlyInRight: [] })

    expect(summary).toBe(`${LEFT} and ${RIGHT} differ - 1 only in ${LEFT}`)
  })

  it('calls a difference that moved no content whitespace only', () => {
    const summary = summarize({ identical: false, onlyInLeft: [], onlyInRight: [] })

    expect(summary).toBe(`${LEFT} and ${RIGHT} differ - whitespace only`)
  })

  it('says the files match when they are identical', () => {
    expect(summarize({ identical: true, onlyInLeft: [], onlyInRight: [] })).toBe(
      `${LEFT} and ${RIGHT} match`
    )
  })
})

describe('the script as CI runs it', () => {
  it('exits 0 and says so when the two files match', () => {
    const { exitCode, stdout } = runIn('same\n', 'same\n')

    expect(exitCode).toBe(0)
    expect(stdout).toContain(`lint:agents-md: ${LEFT} and ${RIGHT} match`)
  })

  // The whole point of the change: drift is reported, never fatal, because
  // CLAUDE.md is expected to carry overrides AGENTS.md has no use for.
  it('exits 0 when the two files differ', () => {
    const { exitCode, stdout } = runIn('shared\nclaude only\n', 'shared\n')

    expect(exitCode).toBe(0)
    expect(stdout).toContain(`1 only in ${LEFT}`)
    expect(stdout).toContain('advisory only, this does not fail the build')
  })

  it('emits a workflow warning annotation under GitHub Actions', () => {
    const { stdout } = runIn('shared\nclaude only\n', 'shared\n', { GITHUB_ACTIONS: 'true' })

    expect(stdout).toContain(`::warning file=${RIGHT},title=Agent instructions drift::`)
  })

  it('emits no annotation outside GitHub Actions', () => {
    const { stdout } = runIn('shared\nclaude only\n', 'shared\n')

    expect(stdout).not.toContain('::warning')
  })
})
