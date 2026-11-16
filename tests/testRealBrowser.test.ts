import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  SUITE_DIR,
  preconditionProblem,
  realBrowserSuites,
  runSuites,
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
    expect(suites).toContain(join(SUITE_DIR, 'egressNetns.test.ts'))
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

describe("this repository's Egress suite", () => {
  const suite = join(SUITE_DIR, 'egressNetns.test.ts')
  const source = readFileSync(join(__dirname, '..', suite), 'utf8')

  it('is run by the command the suite itself prints, with the caller as the mapped user', () => {
    // The suite builds its command from two template literals; read them out of its source.
    const [, first, second] = /const NETNS_COMMAND =\s*`([^`]*)` \+\s*`([^`]*)`/.exec(source) ?? []
    expect(first, 'the suite no longer declares NETNS_COMMAND in this shape').toBeDefined()
    const printed = `${first}${second}`
      .replace('$(id -u)', '1000')
      .replace('$(id -g)', '985')
      .replace('${FILE}', suite)
    const [command, flag, shell, option, script] = suiteCommand(suite, source, {
      uid: 1000,
      gid: 985
    })
    expect(`${command} ${flag} ${shell} ${option} "${script}"`).toBe(printed)
  })
})

describe('a suite file name the shell would split', () => {
  it('is quoted inside the namespace command and left whole outside it', () => {
    const user = { uid: 1000, gid: 985 }
    const odd = "tests/it's here/n.test.ts"
    expect(suiteCommand(odd, 'namespaceSkipReason', user)[4]).toBe(
      'ip link set lo up && unshare -U --map-user=1000 --map-group=985 ' +
        "xvfb-run --auto-servernum pnpm test 'tests/it'\\''s here/n.test.ts'"
    )
    expect(suiteCommand(odd, 'realBrowserSkipReason', user)[4]).toBe(odd)
  })
})

describe('runSuites', () => {
  const user = { uid: 1000, gid: 985 }
  const passed = '      Tests  2 passed (2)\n'
  const drive = (results: Record<string, { status?: number; stdout?: string; error?: Error }>) => {
    const written: string[] = []
    const commands: string[][] = []
    for (const name of Object.keys(results)) {
      writeFileSync(join(root, SUITE_DIR, name), 'realBrowserSkipReason()')
    }
    const code = runSuites(
      Object.keys(results).map((name) => join(SUITE_DIR, name)),
      {
        root,
        user,
        out: { write: (text: string) => written.push(text) },
        spawn: (command: string, args: string[]) => {
          commands.push([command, ...args])
          const name = args[args.length - 1].split('/').pop() as string
          return { status: 0, stdout: '', ...results[name] }
        }
      }
    )
    return { code, output: written.join(''), commands }
  }

  it('runs each suite under an xvfb-run of its own and passes when all passed', () => {
    const { code, output, commands } = drive({
      'a.test.ts': { stdout: passed },
      'b.test.ts': { stdout: passed }
    })
    expect(code).toBe(0)
    expect(commands).toEqual([
      ['xvfb-run', '--auto-servernum', 'pnpm', 'test', join(SUITE_DIR, 'a.test.ts')],
      ['xvfb-run', '--auto-servernum', 'pnpm', 'test', join(SUITE_DIR, 'b.test.ts')]
    ])
    expect(output).toContain('test:real-browser: 2 of 2 suites passed\n')
  })

  it('fails and names a suite that failed and one that ran no test', () => {
    const { code, output } = drive({
      'a.test.ts': { stdout: passed },
      'b.test.ts': { status: 1, stdout: '      Tests  1 failed (1)\n' },
      'c.test.ts': { stdout: '      Tests  3 skipped (3)\n' }
    })
    expect(code).toBe(1)
    expect(output).toContain(
      `1 of 3 suites passed; not passed: ${join(SUITE_DIR, 'b.test.ts')} (failed), ` +
        `${join(SUITE_DIR, 'c.test.ts')} (ran no test)`
    )
  })

  it('reads a suite named by an absolute path where it is', () => {
    const elsewhere = join(root, 'elsewhere.test.ts')
    writeFileSync(elsewhere, 'realBrowserSkipReason()')
    const commands: string[][] = []
    const code = runSuites([elsewhere], {
      root: join(root, SUITE_DIR),
      user,
      out: { write: () => true },
      spawn: (command: string, args: string[]) => {
        commands.push([command, ...args])
        return { status: 0, stdout: passed }
      }
    })
    expect(code).toBe(0)
    expect(commands).toEqual([['xvfb-run', '--auto-servernum', 'pnpm', 'test', elsewhere]])
  })

  it('fails when the command cannot start, and when there is no suite', () => {
    const { code, output } = drive({ 'a.test.ts': { error: new Error('spawn xvfb-run ENOENT') } })
    expect(code).toBe(1)
    expect(output).toContain('cannot start xvfb-run: spawn xvfb-run ENOENT')
    const none = drive({})
    expect(none.code).toBe(1)
    expect(none.output).toContain('no real-browser suite under')
  })
})
