import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { initStorage, ensureCaseDir, getCaseStorageSize } from '@main/services/storage'

describe('storage', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-test-'))
    initStorage(tempDir)
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('ensureCaseDir creates the case directory', () => {
    const dir = ensureCaseDir('new-case')
    expect(dir).toBe(join(tempDir, 'new-case'))
    expect(existsSync(dir)).toBe(true)
  })

  it('calculates case storage size', () => {
    const dir = join(tempDir, 'case-1')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'cap-1.html'), 'a'.repeat(100))
    writeFileSync(join(dir, 'cap-2.html'), 'b'.repeat(200))

    const size = getCaseStorageSize('case-1')
    expect(size).toBe(300)
  })

  it('returns 0 for non-existent case directory', () => {
    expect(getCaseStorageSize('nonexistent')).toBe(0)
  })
})
