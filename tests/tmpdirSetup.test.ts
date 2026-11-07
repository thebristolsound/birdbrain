import { describe, expect, it } from 'vitest'
import { tmpdir } from 'os'
import { basename } from 'path'

describe('test run temporary directory', () => {
  it('points tmpdir() at the per-run directory the global setup made', () => {
    expect(basename(tmpdir())).toMatch(/^birdbrain-test-run-/)
  })
})
