import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  initInstallationId,
  getInstallationId,
  loadInstallationId,
  resetInstallationId
} from '@main/services/installationId'

describe('installationId', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-install-'))
    resetInstallationId()
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('generates a new UUID on first init', () => {
    initInstallationId(tempDir)
    const id = getInstallationId()
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    expect(existsSync(join(tempDir, 'installation-id'))).toBe(true)
  })

  it('returns the same UUID across restarts', () => {
    initInstallationId(tempDir)
    const first = getInstallationId()
    resetInstallationId()
    initInstallationId(tempDir)
    expect(getInstallationId()).toBe(first)
  })

  it('throws when accessed before init', () => {
    expect(() => getInstallationId()).toThrow(/not initialized/)
  })

  it('preserves existing id written manually', () => {
    const manual = '12345678-1234-1234-1234-123456789012'
    writeFileSync(join(tempDir, 'installation-id'), manual, 'utf-8')
    initInstallationId(tempDir)
    expect(getInstallationId()).toBe(manual)
  })

  it('loads the id the app wrote without writing one (ADR-0038)', () => {
    writeFileSync(join(tempDir, 'installation-id'), 'written-by-the-app\n')
    loadInstallationId(tempDir)
    expect(getInstallationId()).toBe('written-by-the-app')

    const empty = mkdtempSync(join(tmpdir(), 'birdbrain-install-'))
    try {
      loadInstallationId(empty)
      expect(() => getInstallationId()).toThrow('Installation ID not initialized')
      expect(existsSync(join(empty, 'installation-id'))).toBe(false)
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  })
})
