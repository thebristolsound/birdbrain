import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  SUITE_DIR,
  preconditionProblem,
  realBrowserSuites,
  suiteCommand,
  suiteOutcome
  // @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
} from '../scripts/test-real-browser.mjs'

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'real-browser-'))
  mkdirSync(join(root, SUITE_DIR), { recursive: true })
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('realBrowserSuites', () => {
  it('lists the test files that ask whether a real browser may run, in order', () => {
    const write = (name: string, text: string) => writeFileSync(join(root, SUITE_DIR, name), text)
    write('z.test.ts', 'const skipReason = realBrowserSkipReason()')
    write('a.test.ts', 'const skipReason = realBrowserSkipReason()')
    write('fake.test.ts', 'a suite over a fake browser')
    write('helper.ts', 'export function realBrowserSkipReason() {}')
    expect(realBrowserSuites(root)).toEqual([
      join(SUITE_DIR, 'a.test.ts'),
      join(SUITE_DIR, 'z.test.ts')
    ])
  })

  it('finds the suites this repository has', () => {
    const suites = realBrowserSuites(join(__dirname, '..'))
    expect(suites).toContain(join(SUITE_DIR, 'captureKnownAnswer.test.ts'))
    expect(suites).toContain(join(SUITE_DIR, 'knownAnswer.test.ts'))
  })
})

describe('preconditionProblem', () => {
  it('names a platform with no pinned build', () => {
    expect(preconditionProblem('plan9-mips', () => true)).toBe(
      'no pinned Chrome for Testing build for plan9-mips'
    )
  })

  it('names the fetch command when the pinned build is not on disk', () => {
    expect(preconditionProblem('linux-x64', () => false)).toContain(
      'run node scripts/fetch-chrome-for-testing.mjs'
    )
  })

  it('is null when the pinned build is there', () => {
    expect(preconditionProblem('linux-x64', () => true)).toBeNull()
  })
})

describe('suiteCommand', () => {
  const user = { uid: 1000, gid: 985 }

  it('gives a suite an xvfb-run of its own', () => {
    expect(suiteCommand('tests/a.test.ts', 'realBrowserSkipReason()', user)).toEqual([
      'xvfb-run',
      '--auto-servernum',
      'pnpm',
      'test',
      'tests/a.test.ts'
    ])
  })

  it('runs a suite with a namespace rule inside a loopback-only namespace as the caller', () => {
    expect(suiteCommand('tests/n.test.ts', 'function namespaceSkipReason() {}', user)).toEqual([
      'unshare',
      '-rn',
      'sh',
      '-c',
      'ip link set lo up && unshare -U --map-user=1000 --map-group=985 ' +
        'xvfb-run --auto-servernum pnpm test tests/n.test.ts'
    ])
  })
})

describe('suiteOutcome', () => {
  it('passes a suite whose Tests line counts a passed test', () => {
    expect(suiteOutcome(0, ' Test Files  1 passed (1)\n      Tests  21 passed (21)\n')).toBe(
      'passed'
    )
    expect(suiteOutcome(0, '      Tests  17 passed | 1 skipped (18)\n')).toBe('passed')
  })

  it('reads a coloured Tests line', () => {
    const coloured =
      '\x1b[2m      Tests \x1b[22m \x1b[1m\x1b[32m21 passed\x1b[39m\x1b[22m\x1b[90m (21)\x1b[39m\n'
    expect(suiteOutcome(0, coloured)).toBe('passed')
    expect(suiteOutcome(0, coloured.replace('21 passed', '1 skipped'))).toBe('ran no test')
  })

  it('does not pass a suite that skipped every test, or printed no Tests line', () => {
    expect(suiteOutcome(0, ' Test Files  1 skipped (1)\n      Tests  1 skipped (1)\n')).toBe(
      'ran no test'
    )
    expect(suiteOutcome(0, '      Tests  0 passed | 3 skipped (3)\n')).toBe('ran no test')
    expect(suiteOutcome(0, 'no summary')).toBe('ran no test')
  })

  it('fails on a non-zero exit whatever the output says', () => {
    expect(suiteOutcome(1, '      Tests  1 failed | 20 passed (21)\n')).toBe('failed')
  })
})
