import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'events'
import {
  TESTS_ENV,
  incrementalFile,
  main,
  parseArgs
  // @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
} from '../scripts/test-mutation.mjs'

describe('parseArgs', () => {
  it('passes every argument to Stryker when --tests is absent', () => {
    expect(parseArgs(['--mutate', 'src/shared/noteDoc.ts', '--force'])).toEqual({
      tests: null,
      stryker: ['--mutate', 'src/shared/noteDoc.ts', '--force']
    })
  })

  it('takes --tests out of the arguments in both spellings', () => {
    expect(parseArgs(['--tests', 'tests/shared', '--force'])).toEqual({
      tests: 'tests/shared',
      stryker: ['--force']
    })
    expect(parseArgs(['--force', '--tests=tests/shared,tests/main'])).toEqual({
      tests: 'tests/shared,tests/main',
      stryker: ['--force']
    })
  })

  it('refuses --tests with no path', () => {
    expect(() => parseArgs(['--tests'])).toThrow('--tests needs a path')
    expect(() => parseArgs(['--tests', '--force'])).toThrow('--tests needs a path')
    expect(() => parseArgs(['--tests', ''])).toThrow('--tests needs a path')
    expect(() => parseArgs(['--tests='])).toThrow('--tests needs a path')
  })
})

describe('incrementalFile', () => {
  const scope = { tests: 'tests/shared', stryker: ['--mutate', 'src/shared/noteDoc.ts'] }

  it('gives one set of arguments one file, with or without --force', () => {
    expect(incrementalFile(scope)).toMatch(/^\.cache\/stryker\/incremental-[0-9a-f]{12}\.json$/)
    expect(incrementalFile({ ...scope, stryker: [...scope.stryker] })).toBe(incrementalFile(scope))
    expect(incrementalFile({ ...scope, stryker: [...scope.stryker, '--force'] })).toBe(
      incrementalFile(scope)
    )
  })

  it('gives another --mutate or another --tests its own file', () => {
    const files = [
      incrementalFile(scope),
      incrementalFile({ ...scope, stryker: ['--mutate', 'src/shared/safeFilename.ts'] }),
      incrementalFile({ ...scope, tests: 'tests/main' }),
      incrementalFile({ tests: null, stryker: [] })
    ]
    expect(new Set(files).size).toBe(files.length)
  })
})

describe('main', () => {
  const start = (argv: string[], env: Record<string, string> = {}) => {
    const child = new EventEmitter()
    const run = vi.fn(() => child)
    const stderr = vi.fn()
    const exit = main(argv, { env, run, electron: () => '/electron', stderr }) as Promise<number>
    return { child, run, stderr, exit }
  }

  it('starts Stryker inside Electron with the test scope in the environment', async () => {
    const { child, run, exit } = start(['--tests', 'tests/shared', '--force'], { PATH: '/bin' })
    child.emit('exit', 0, null)

    expect(await exit).toBe(0)
    expect(run).toHaveBeenCalledWith(
      '/electron',
      [
        './node_modules/@stryker-mutator/core/bin/stryker.js',
        'run',
        '--incrementalFile',
        incrementalFile({ tests: 'tests/shared', stryker: ['--force'] }),
        '--force'
      ],
      {
        stdio: 'inherit',
        env: { PATH: '/bin', ELECTRON_RUN_AS_NODE: '1', [TESTS_ENV]: 'tests/shared' }
      }
    )
  })

  it('leaves the scope unset without --tests, so the config default applies', async () => {
    const { child, run, exit } = start([], { [TESTS_ENV]: 'tests/main' })
    child.emit('exit', 0, null)

    expect(await exit).toBe(0)
    expect(run).toHaveBeenCalledWith('/electron', expect.any(Array), {
      stdio: 'inherit',
      env: { ELECTRON_RUN_AS_NODE: '1' }
    })
  })

  it("returns Stryker's exit code, and 1 when a signal ended it", async () => {
    const failed = start([])
    failed.child.emit('exit', 3, null)
    expect(await failed.exit).toBe(3)

    const killed = start([])
    killed.child.emit('exit', null, 'SIGTERM')
    expect(await killed.exit).toBe(1)
  })

  it('returns 2 without starting anything when the arguments are wrong', async () => {
    const { run, stderr, exit } = start(['--tests'])

    expect(await exit).toBe(2)
    expect(run).not.toHaveBeenCalled()
    expect(stderr).toHaveBeenCalledWith('test-mutation: --tests needs a path')
  })

  it('returns 2 without starting anything when --tests is given an empty path', async () => {
    const { run, stderr, exit } = start(['--tests', ''])

    expect(await exit).toBe(2)
    expect(run).not.toHaveBeenCalled()
    expect(stderr).toHaveBeenCalledWith('test-mutation: --tests needs a path')
  })

  it('returns 2 when Electron cannot be started', async () => {
    const { child, stderr, exit } = start([])
    child.emit('error', new Error('spawn /electron ENOENT'))

    expect(await exit).toBe(2)
    expect(stderr).toHaveBeenCalledWith('test-mutation: spawn /electron ENOENT')
  })
})
