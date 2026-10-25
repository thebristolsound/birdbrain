import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'events'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  createRunner,
  electronBinary,
  killTree,
  parseReport,
  vitestArgs
  // @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
} from '../../scripts/test-reliability/lib/vitest.mjs'

type FakeChild = EventEmitter & {
  pid?: number
  stdout: EventEmitter
  stderr: EventEmitter
  kill: ReturnType<typeof vi.fn>
}

const fakeChild = (pid?: number): FakeChild =>
  Object.assign(new EventEmitter(), {
    pid,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
    kill: vi.fn()
  })

let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'test-reliability-vitest-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  vi.useRealTimers()
})

const outputFileOf = (args: string[]) =>
  args.find((arg) => arg.startsWith('--outputFile='))!.slice('--outputFile='.length)

const report = (success: boolean) => ({
  success,
  testResults: [
    {
      name: join(root, 'tests/a.test.ts'),
      status: success ? 'passed' : 'failed',
      message: '',
      assertionResults: [
        { fullName: 'a works', status: success ? 'passed' : 'failed', location: { line: 3 } }
      ]
    }
  ]
})

describe('vitestArgs', () => {
  it('runs named files with the JSON reporter, locations and no coverage', () => {
    expect(vitestArgs({ mode: 'run', files: ['tests/a.test.ts'], outputFile: '/o.json' })).toEqual([
      './node_modules/vitest/vitest.mjs',
      'run',
      'tests/a.test.ts',
      '--reporter=json',
      '--outputFile=/o.json',
      '--includeTaskLocation',
      '--coverage.enabled=false',
      '--passWithNoTests'
    ])
  })

  it('adds --run to related and --bail when asked', () => {
    const args = vitestArgs({
      mode: 'related',
      files: ['src/a.ts'],
      outputFile: '/o.json',
      bail: true
    })
    expect(args.slice(1, 4)).toEqual(['related', 'src/a.ts', '--run'])
    expect(args.at(-1)).toBe('--bail=1')
  })
})

describe('parseReport', () => {
  it('keeps each file relative to the root, with each test status and line', () => {
    expect(parseReport(report(true), root)).toEqual({
      success: true,
      files: [
        {
          path: 'tests/a.test.ts',
          status: 'passed',
          message: '',
          tests: [{ fullName: 'a works', status: 'passed', line: 3 }]
        }
      ]
    })
  })

  it('reads a report with no results and a test with no location', () => {
    expect(parseReport({ success: false }, root)).toEqual({ success: false, files: [] })
    const parsed = parseReport(
      { success: true, testResults: [{ name: join(root, 'b.test.ts'), status: 'passed' }] },
      root
    )
    expect(parsed.files[0]).toEqual({ path: 'b.test.ts', status: 'passed', message: '', tests: [] })
    const noLocation = parseReport(
      {
        success: true,
        testResults: [
          {
            name: join(root, 'c.test.ts'),
            status: 'passed',
            assertionResults: [{ fullName: 'c', status: 'passed' }]
          }
        ]
      },
      root
    )
    expect(noLocation.files[0].tests[0].line).toBeNull()
  })
})

describe('electronBinary', () => {
  it('resolves the installed electron binary path', () => {
    expect(electronBinary()).toMatch(/electron/)
  })
})

describe('killTree', () => {
  it('kills the process group on POSIX', () => {
    const kill = vi.fn()
    killTree(fakeChild(42), 'linux', kill)
    expect(kill).toHaveBeenCalledWith(-42, 'SIGKILL')
  })

  it('kills the child itself on Windows or when it never got a pid', () => {
    const windows = fakeChild(42)
    killTree(windows, 'win32', vi.fn())
    expect(windows.kill).toHaveBeenCalledWith('SIGKILL')
    const unspawned = fakeChild()
    killTree(unspawned, 'linux', vi.fn())
    expect(unspawned.kill).toHaveBeenCalledWith('SIGKILL')
  })

  it('ignores a group that already exited, and surfaces any other failure', () => {
    const gone = () => {
      throw Object.assign(new Error('no such process'), { code: 'ESRCH' })
    }
    expect(() => killTree(fakeChild(42), 'linux', gone)).not.toThrow()
    const denied = () => {
      throw Object.assign(new Error('not permitted'), { code: 'EPERM' })
    }
    expect(() => killTree(fakeChild(42), 'linux', denied)).toThrow(/not permitted/)
  })
})

describe('createRunner', () => {
  const reportDir = () => join(root, '.cache/test-reliability/reports')

  it('runs vitest under electron as node and reads the report it wrote', async () => {
    const calls: { command: string; args: string[]; options: Record<string, unknown> }[] = []
    const spawn = (command: string, args: string[], options: Record<string, unknown>) => {
      calls.push({ command, args, options })
      const child = fakeChild(7)
      writeFileSync(outputFileOf(args), JSON.stringify(report(true)))
      setImmediate(() => {
        child.stdout.emit('data', 'some output')
        child.emit('close', 0)
      })
      return child
    }
    let clock = 1000
    const { run } = createRunner({
      root,
      reportDir: reportDir(),
      spawn,
      electron: () => '/bin/electron',
      env: { PATH: '/bin' },
      now: () => (clock += 250)
    })
    const result = await run({ mode: 'run', files: ['tests/a.test.ts'] })
    expect(calls[0].command).toBe('/bin/electron')
    expect(calls[0].args).not.toContain('--bail=1')
    expect(calls[0].options.detached).toBe(process.platform !== 'win32')
    expect(calls[0].options).toMatchObject({
      cwd: root,
      env: { PATH: '/bin', ELECTRON_RUN_AS_NODE: '1' }
    })
    expect(result).toMatchObject({ ok: true, timedOut: false, code: 0, durationMs: 250 })
    expect(result.report.files[0].path).toBe('tests/a.test.ts')
    expect(result.output).toBe('some output')
  })

  it('is not ok when vitest fails, and has no report when vitest wrote none', async () => {
    const spawn = (_command: string, args: string[]) => {
      const child = fakeChild(7)
      if (args.includes('tests/a.test.ts')) {
        writeFileSync(outputFileOf(args), JSON.stringify(report(false)))
      }
      setImmediate(() => {
        child.stderr.emit('data', 'boom')
        child.emit('close', 1)
      })
      return child
    }
    const { run } = createRunner({ root, reportDir: reportDir(), spawn, electron: () => 'e' })
    const failed = await run({ mode: 'run', files: ['tests/a.test.ts'] })
    expect(failed.ok).toBe(false)
    expect(failed.report.success).toBe(false)
    const missing = await run({ mode: 'run', files: ['tests/b.test.ts'] })
    expect(missing).toMatchObject({ ok: false, report: null, output: 'boom' })
  })

  it('deletes a stale report before each run', async () => {
    const spawn = () => {
      const child = fakeChild(7)
      setImmediate(() => child.emit('close', 0))
      return child
    }
    const stale = join(reportDir(), 'run-1.json')
    mkdirSync(reportDir(), { recursive: true })
    writeFileSync(stale, JSON.stringify(report(true)))
    const { run } = createRunner({ root, reportDir: reportDir(), spawn, electron: () => 'e' })
    const result = await run({ mode: 'run', files: [] })
    expect(existsSync(stale)).toBe(false)
    expect(result).toMatchObject({ ok: false, report: null })
  })

  it('reports a spawn error as a failed run', async () => {
    const spawn = () => {
      const child = fakeChild()
      setImmediate(() => child.emit('error', new Error('ENOENT electron')))
      return child
    }
    const { run } = createRunner({ root, reportDir: reportDir(), spawn, electron: () => 'e' })
    const result = await run({ mode: 'run', files: [] })
    expect(result).toMatchObject({ ok: false, code: null, timedOut: false })
    expect(result.output).toMatch(/ENOENT electron/)
  })

  it('kills a run that passes its timeout and reports it as timed out', async () => {
    vi.useFakeTimers()
    const child = fakeChild()
    child.kill.mockImplementation(() => child.emit('close', null))
    const { run } = createRunner({
      root,
      reportDir: reportDir(),
      spawn: () => child,
      electron: () => 'e'
    })
    const pending = run({ mode: 'run', files: [], timeoutMs: 5000 })
    await vi.advanceTimersByTimeAsync(5000)
    const result = await pending
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
    expect(result).toMatchObject({ ok: false, timedOut: true })
  })

  it('clears the timeout once the run ends, so a finished run is never killed', async () => {
    vi.useFakeTimers()
    const closing = fakeChild()
    const { run } = createRunner({
      root,
      reportDir: reportDir(),
      spawn: () => {
        setTimeout(() => closing.emit('close', 0), 10)
        return closing
      },
      electron: () => 'e'
    })
    const pending = run({ mode: 'run', files: [], timeoutMs: 5000 })
    await vi.advanceTimersByTimeAsync(10)
    expect((await pending).timedOut).toBe(false)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(closing.kill).not.toHaveBeenCalled()

    const failing = fakeChild()
    const errored = createRunner({
      root,
      reportDir: reportDir(),
      spawn: () => {
        setTimeout(() => failing.emit('error', new Error('spawn failed')), 10)
        return failing
      },
      electron: () => 'e'
    })
    const failed = errored.run({ mode: 'run', files: [], timeoutMs: 5000 })
    await vi.advanceTimersByTimeAsync(10)
    expect((await failed).timedOut).toBe(false)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(failing.kill).not.toHaveBeenCalled()
  })

  it('stops the active run on request, and does nothing when none is running', async () => {
    const child = fakeChild()
    child.kill.mockImplementation(() => child.emit('close', null))
    const runner = createRunner({
      root,
      reportDir: reportDir(),
      spawn: () => child,
      electron: () => 'e'
    })
    runner.stop()
    expect(child.kill).not.toHaveBeenCalled()
    const pending = runner.run({ mode: 'run', files: [] })
    runner.stop()
    const result = await pending
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
    expect(result.ok).toBe(false)
  })
})
