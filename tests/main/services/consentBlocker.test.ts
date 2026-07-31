import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const { fromLists } = vi.hoisted(() => ({ fromLists: vi.fn() }))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp') }
}))

vi.mock('@ghostery/adblocker-electron', () => ({
  ElectronBlocker: { fromLists }
}))

async function loadGetConsentBlocker() {
  const mod = await import('@main/services/consentBlocker')
  return mod.getConsentBlocker
}

describe('consentBlocker', () => {
  beforeEach(() => {
    vi.resetModules()
    fromLists.mockReset()
    delete process.env.BIRDBRAIN_CONSENT_LISTS
  })

  afterEach(() => {
    delete process.env.BIRDBRAIN_CONSENT_LISTS
  })

  it('builds an engine from the override list without disk caching', async () => {
    process.env.BIRDBRAIN_CONSENT_LISTS = 'http://localhost/fixture.txt'
    const engine = { id: 'engine' }
    fromLists.mockResolvedValue(engine)

    const getConsentBlocker = await loadGetConsentBlocker()
    const result = await getConsentBlocker()

    expect(result).toBe(engine)
    expect(fromLists).toHaveBeenCalledTimes(1)
    const [fetchArg, lists, thirdArg, caching] = fromLists.mock.calls[0]
    expect(fetchArg).toBe(fetch)
    expect(lists).toEqual(['http://localhost/fixture.txt'])
    expect(thirdArg).toBeUndefined()
    // Override skips the disk cache so E2E runs stay deterministic/offline.
    expect(caching).toBeUndefined()
  })

  it('memoizes the engine so the same key returns the same promise', async () => {
    process.env.BIRDBRAIN_CONSENT_LISTS = 'http://localhost/fixture.txt'
    fromLists.mockResolvedValue({ id: 'engine' })

    const getConsentBlocker = await loadGetConsentBlocker()
    const first = getConsentBlocker()
    const second = getConsentBlocker()

    expect(first).toBe(second)
    expect(fromLists).toHaveBeenCalledTimes(1)
    await first
  })

  it('rebuilds when the override key changes', async () => {
    process.env.BIRDBRAIN_CONSENT_LISTS = 'http://localhost/a.txt'
    fromLists.mockResolvedValue({ id: 'engine' })

    const getConsentBlocker = await loadGetConsentBlocker()
    const first = getConsentBlocker()
    await first

    process.env.BIRDBRAIN_CONSENT_LISTS = 'http://localhost/b.txt'
    const second = getConsentBlocker()

    expect(second).not.toBe(first)
    expect(fromLists).toHaveBeenCalledTimes(2)
    expect(fromLists.mock.calls[1][1]).toEqual(['http://localhost/b.txt'])
    await second
  })

  it('uses the built-in consent lists and disk cache when no override is set', async () => {
    fromLists.mockResolvedValue({ id: 'engine' })

    const getConsentBlocker = await loadGetConsentBlocker()
    await getConsentBlocker()

    const [, lists, thirdArg, caching] = fromLists.mock.calls[0]
    expect(lists).toHaveLength(2)
    expect(lists[0]).toContain('fanboy-cookiemonster')
    expect(thirdArg).toBeUndefined()
    // Default path memoizes to a disk-cached engine binary under userData.
    expect(caching).toBeDefined()
    expect(caching.path).toContain('consent-filters-engine.bin')
    expect(typeof caching.read).toBe('function')
    expect(typeof caching.write).toBe('function')
  })

  it('fails soft to null and clears the memo so a later call retries', async () => {
    process.env.BIRDBRAIN_CONSENT_LISTS = 'http://localhost/fixture.txt'
    fromLists.mockRejectedValueOnce(new Error('offline, no cache'))

    const getConsentBlocker = await loadGetConsentBlocker()
    // Same fresh module registry as the consentBlocker import above (no
    // resetModules in between), so this resolves to the logger instance
    // consentBlocker.ts itself calls into.
    const { initLogger, disposeLogger, flushSync, readRecentEntries } =
      await import('@main/services/logger')
    const logDir = mkdtempSync(join(tmpdir(), 'birdbrain-consent-blocker-log-'))
    initLogger(logDir, 'consent-blocker-test-session')

    const failed = await getConsentBlocker()
    expect(failed).toBeNull()
    flushSync()
    const entries = readRecentEntries(10)
    expect(
      entries.some(
        (e) => e.source === 'consentBlocker' && e.code === 'consentBlocker.filter_engine_failed'
      )
    ).toBe(true)

    disposeLogger()
    rmSync(logDir, { recursive: true, force: true })

    // Memo was cleared on failure: the next call rebuilds rather than returning
    // the cached rejected promise.
    const engine = { id: 'engine' }
    fromLists.mockResolvedValue(engine)
    const retried = await getConsentBlocker()
    expect(retried).toBe(engine)
    expect(fromLists).toHaveBeenCalledTimes(2)
  })
})
