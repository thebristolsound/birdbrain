import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { writeFileSync } from 'fs'
import {
  setSettingsPath,
  getSettings,
  updateSettings,
  resetSettings,
  getDefaultSettings
} from '@main/services/settings'
import { DEFAULT_TSA_URL } from '@shared/constants'

describe('settings', () => {
  let tempDir: string
  let settingsFile: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'bb-settings-'))
    settingsFile = join(tempDir, 'settings.json')
    setSettingsPath(settingsFile)
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('returns default settings when no file exists', () => {
    const settings = getSettings()
    expect(settings.openRouterApiKey).toBeNull()
    expect(settings.defaultModel).toBe('anthropic/claude-sonnet-4')
    expect(settings.captureScreenshots).toBe(true)
    expect(settings.dedupeWindowSeconds).toBe(60)
    expect(settings.theme).toBe('light')
  })

  it('updates settings and persists them', () => {
    updateSettings({ openRouterApiKey: 'sk-test-123' })
    const settings = getSettings()
    expect(settings.openRouterApiKey).toBe('sk-test-123')
    // Other defaults remain
    expect(settings.captureScreenshots).toBe(true)
    expect(settings.dedupeWindowSeconds).toBe(60)
  })

  it('merges partial updates without losing existing values', () => {
    updateSettings({ openRouterApiKey: 'sk-first' })
    updateSettings({ defaultModel: 'openai/gpt-4o' })
    const settings = getSettings()
    expect(settings.openRouterApiKey).toBe('sk-first')
    expect(settings.defaultModel).toBe('openai/gpt-4o')
  })

  it('resets settings to defaults', () => {
    updateSettings({ openRouterApiKey: 'sk-test', dedupeWindowSeconds: 120 })
    resetSettings()
    const settings = getSettings()
    expect(settings.openRouterApiKey).toBeNull()
    expect(settings.dedupeWindowSeconds).toBe(60)
  })

  it('creates settings file on first update', () => {
    expect(existsSync(settingsFile)).toBe(false)
    updateSettings({ theme: 'light' })
    expect(existsSync(settingsFile)).toBe(true)
  })

  it('handles corrupted settings file gracefully', () => {
    writeFileSync(settingsFile, '{invalid json', 'utf-8')
    const settings = getSettings()
    // Falls back to defaults
    expect(settings.theme).toBe('light')
  })

  it('falls back to defaults when stored settings have wrong-typed fields', () => {
    writeFileSync(
      settingsFile,
      JSON.stringify({ dedupeWindowSeconds: 'not-a-number', theme: 'dark' }),
      'utf-8'
    )
    const settings = getSettings()
    // Entire saved object rejected by schema → defaults returned
    expect(settings.dedupeWindowSeconds).toBe(60)
    expect(settings.theme).toBe('light')
  })

  it('defaults the TSA endpoint to DigiCert', () => {
    expect(getSettings().tsaUrl).toBe(DEFAULT_TSA_URL)
  })

  it('persists a valid custom TSA endpoint', () => {
    updateSettings({ tsaUrl: 'https://freetsa.org/tsr' })
    expect(getSettings().tsaUrl).toBe('https://freetsa.org/tsr')
  })

  it('normalizes a non-http(s) TSA endpoint to the default', () => {
    updateSettings({ tsaUrl: 'ftp://evil.example/tsa' })
    expect(getSettings().tsaUrl).toBe(DEFAULT_TSA_URL)
  })

  it('coerces an invalid stored tsaUrl without resetting other settings', () => {
    // A hand-edited file with a bad tsaUrl but otherwise-valid fields must NOT
    // trigger the whole-file reset that a genuinely wrong-typed field does.
    writeFileSync(
      settingsFile,
      JSON.stringify({ tsaUrl: 'not a url', theme: 'dark', operatorName: 'Keep Me' }),
      'utf-8'
    )
    const settings = getSettings()
    expect(settings.tsaUrl).toBe(DEFAULT_TSA_URL)
    expect(settings.theme).toBe('dark')
    expect(settings.operatorName).toBe('Keep Me')
  })

  it('preserves ignored URL patterns', () => {
    updateSettings({ ignoredUrlPatterns: ['*.google.com', '*.bing.com'] })
    const settings = getSettings()
    expect(settings.ignoredUrlPatterns).toEqual(['*.google.com', '*.bing.com'])
  })

  it('returns empty operatorName by default', () => {
    const s = getSettings()
    expect(s.operatorName).toBe('')
  })

  it('persists operatorName updates', () => {
    updateSettings({ operatorName: 'Det. Smith' })
    expect(getSettings().operatorName).toBe('Det. Smith')
  })

  it('includes lastActiveCaseId and lastActiveSection in defaults', () => {
    const defaults = getDefaultSettings()
    expect(defaults.lastActiveCaseId).toBeNull()
    expect(defaults.lastActiveSection).toBe('captures')
  })

  it('persists and retrieves session state fields', () => {
    updateSettings({ lastActiveCaseId: 'case-123', lastActiveSection: 'notes' })
    const settings = getSettings()
    expect(settings.lastActiveCaseId).toBe('case-123')
    expect(settings.lastActiveSection).toBe('notes')
  })

  it('persists data as lastActiveSection', () => {
    updateSettings({ lastActiveSection: 'data' })
    expect(getSettings().lastActiveSection).toBe('data')
  })

  it('persists overview as lastActiveSection', () => {
    updateSettings({ lastActiveSection: 'overview' })
    expect(getSettings().lastActiveSection).toBe('overview')
  })

  it('throws on a schema-invalid update rather than persisting garbage', () => {
    expect(() =>
      updateSettings({ captureScreenshots: 'yes' as unknown as boolean })
    ).toThrow(/Invalid settings/)
    // Nothing was written, so getSettings still yields defaults.
    expect(getSettings().captureScreenshots).toBe(true)
  })
})
