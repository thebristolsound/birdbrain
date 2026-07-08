import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  initServerToken,
  getServerToken,
  resetServerTokenForTesting
} from '@main/services/serverToken'

describe('serverToken', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-token-'))
    resetServerTokenForTesting()
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('generates a persisted 64-char hex token on first init', () => {
    initServerToken(tempDir)
    const token = getServerToken()
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    const tokenPath = join(tempDir, 'server-token')
    expect(existsSync(tokenPath)).toBe(true)
    expect(readFileSync(tokenPath, 'utf-8').trim()).toBe(token)
  })

  it('loads the same token across restarts', () => {
    initServerToken(tempDir)
    const first = getServerToken()
    resetServerTokenForTesting()
    initServerToken(tempDir)
    expect(getServerToken()).toBe(first)
  })

  it('regenerates when the stored token is malformed', () => {
    writeFileSync(join(tempDir, 'server-token'), 'not-a-valid-token', 'utf-8')
    initServerToken(tempDir)
    const token = getServerToken()
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect(token).not.toBe('not-a-valid-token')
    expect(readFileSync(join(tempDir, 'server-token'), 'utf-8').trim()).toBe(token)
  })

  it('accepts a 64-char hex token written externally', () => {
    const manual = 'a'.repeat(64)
    writeFileSync(join(tempDir, 'server-token'), manual, 'utf-8')
    initServerToken(tempDir)
    expect(getServerToken()).toBe(manual)
  })

  it('returns a token even before init is called', () => {
    // Module-level fallback prevents an empty string reaching captureServer
    // if init is skipped (tests, unusual startup orders).
    const token = getServerToken()
    expect(token).toMatch(/^[0-9a-f]{64}$/)
  })

  it('regenerates when the token path is unreadable for a non-ENOENT reason', () => {
    // A directory where the token file should be: readFileSync throws EISDIR
    // (not ENOENT), which is warned about rather than silently ignored.
    mkdirSync(join(tempDir, 'server-token'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    initServerToken(tempDir)

    expect(getServerToken()).toMatch(/^[0-9a-f]{64}$/)
    expect(warnSpy).toHaveBeenCalled()
  })

  it('keeps an in-memory token when persistence fails', () => {
    // A missing parent directory makes readFileSync ENOENT (no warn) but
    // writeFileSync fail — the fresh token is kept in memory regardless.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const missingDir = join(tempDir, 'does', 'not', 'exist')

    initServerToken(missingDir)

    expect(getServerToken()).toMatch(/^[0-9a-f]{64}$/)
    expect(existsSync(join(missingDir, 'server-token'))).toBe(false)
    expect(warnSpy).toHaveBeenCalledWith(
      '[serverToken] failed to persist token, using in-memory value:',
      expect.anything()
    )
  })
})
