import { describe, expect, it } from 'vitest'
import { existsSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { basename } from 'path'
import setup from './setup/tmpdir'

const isDirectory = (dir: string) => existsSync(dir) && statSync(dir).isDirectory()

describe('test run temporary directory', () => {
  it('points tmpdir() at the per-run directory the global setup made', () => {
    const dir = tmpdir()
    expect(basename(dir)).toMatch(/^birdbrain-test-run-/)
    // The global setup created it before this worker started, and removes it only at teardown.
    expect(isDirectory(dir)).toBe(true)
  })

  it('gives each run its own directory, and teardown removes it and restores the variables', () => {
    const before = { TMPDIR: process.env.TMPDIR, TMP: process.env.TMP, TEMP: process.env.TEMP }

    const teardownFirst = setup()
    const first = process.env.TMPDIR as string
    const teardownSecond = setup()
    const second = process.env.TMPDIR as string

    expect(first).not.toBe(second)
    expect([first, second].every(isDirectory)).toBe(true)
    expect([process.env.TMP, process.env.TEMP]).toEqual([second, second])

    teardownSecond()
    expect(isDirectory(second)).toBe(false)
    expect(process.env.TMPDIR).toBe(first)
    teardownFirst()
    expect(isDirectory(first)).toBe(false)
    expect({ TMPDIR: process.env.TMPDIR, TMP: process.env.TMP, TEMP: process.env.TEMP }).toEqual(
      before
    )
  })
})
