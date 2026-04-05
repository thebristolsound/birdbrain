import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { initManifest, getManifestHead } from '@main/services/manifest'

describe('manifest init/getHead', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-manifest-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('creates manifest file on first init', () => {
    initManifest(tempDir)
    expect(existsSync(join(tempDir, 'manifest.jsonl'))).toBe(true)
  })

  it('returns empty head for new manifest', () => {
    initManifest(tempDir)
    const head = getManifestHead(tempDir)
    expect(head.prevHash).toBe('')
    expect(head.nextIndex).toBe(0)
  })

  it('is idempotent - does not truncate existing manifest', () => {
    initManifest(tempDir)
    const path = join(tempDir, 'manifest.jsonl')
    writeFileSync(path, '{"hello":"world"}\n')
    initManifest(tempDir)
    const content = readFileSync(path, 'utf-8')
    expect(content).toContain('hello')
  })
})
