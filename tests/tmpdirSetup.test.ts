import { describe, expect, it } from 'vitest'
import { existsSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { basename } from 'path'

describe('test run temporary directory', () => {
  it('points tmpdir() at the per-run directory the global setup made', () => {
    const dir = tmpdir()
    expect(basename(dir)).toMatch(/^birdbrain-test-run-/)
    // The global setup created it before this worker started, and removes it only at teardown.
    expect(existsSync(dir) && statSync(dir).isDirectory()).toBe(true)
  })
})
