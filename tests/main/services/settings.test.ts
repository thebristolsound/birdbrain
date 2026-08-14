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
  getDefaultSettings,
  getOpenRouterKeyProtectionState
} from '@main/services/settings'
import { DEFAULT_TSA_URL } from '@shared/constants'
import { DEFAULT_UI_DENSITY, UI_DENSITIES, type UiDensity } from '@shared/types'

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

  it('defaults releaseChannel to stable and autoCheckForUpdates to true', () => {
    const s = getSettings()
    expect(s.releaseChannel).toBe('stable')
    expect(s.autoCheckForUpdates).toBe(true)
  })

  it('persists releaseChannel and autoCheckForUpdates', () => {
    updateSettings({ releaseChannel: 'beta', autoCheckForUpdates: false })
    const s = getSettings()
    expect(s.releaseChannel).toBe('beta')
    expect(s.autoCheckForUpdates).toBe(false)
  })

  it('rejects an unknown releaseChannel and falls back to defaults', () => {
    writeFileSync(settingsFile, JSON.stringify({ releaseChannel: 'nightly' }), 'utf-8')
    expect(getSettings().releaseChannel).toBe('stable')
  })

  it('defaults density to compact', () => {
    expect(getSettings().density).toBe(DEFAULT_UI_DENSITY)
    expect(getDefaultSettings().density).toBe('compact')
  })

  it('persists every density step', () => {
    for (const step of UI_DENSITIES) {
      updateSettings({ density: step })
      expect(getSettings().density).toBe(step)
    }
  })

  it('rejects an unknown density on update rather than persisting it', () => {
    updateSettings({ density: 'comfortable' })
    expect(() => updateSettings({ density: 'cosy' as UiDensity })).toThrow(/Invalid settings/)
    expect(getSettings().density).toBe('comfortable')
  })

  // Pins the loader's existing all-or-nothing behaviour now that a cosmetic
  // key can trigger it: one unrecognised enum discards every other stored
  // value, exactly as theme/releaseChannel/autoCaptureMode already do.
  it('discards the whole file when the stored density is unrecognised', () => {
    writeFileSync(
      settingsFile,
      JSON.stringify({ density: 'cosy', operatorName: 'Det. Smith' }),
      'utf-8'
    )
    const settings = getSettings()
    expect(settings.density).toBe('compact')
    expect(settings.operatorName).toBe('')
  })

  it('reports not-set when no OpenRouter key has ever been saved', () => {
    expect(getOpenRouterKeyProtectionState()).toBe('not-set')
  })

  it('reports not-set when the settings file exists but predates the key', () => {
    // Distinct from the "never saved" case above: the file exists (so the
    // early not-set return is skipped) but has no openRouterApiKey field at
    // all — an upgrade path, same as the density/theme "written before X
    // existed" cases elsewhere in this file.
    writeFileSync(settingsFile, JSON.stringify({ theme: 'dark' }), 'utf-8')
    expect(getOpenRouterKeyProtectionState()).toBe('not-set')
  })

  it('reports plaintext when safeStorage is unavailable (tests, headless Linux)', () => {
    // Same environment as the signing key: ELECTRON_RUN_AS_NODE has no
    // encryption backend, so encryptApiKey falls through to the raw value.
    updateSettings({ openRouterApiKey: 'sk-test-123' })
    expect(getOpenRouterKeyProtectionState()).toBe('plaintext')
  })

  it('reports protected when the stored value carries the enc: prefix', () => {
    writeFileSync(
      settingsFile,
      JSON.stringify({ openRouterApiKey: 'enc:' + Buffer.from('opaque').toString('base64') }),
      'utf-8'
    )
    expect(getOpenRouterKeyProtectionState()).toBe('protected')
  })

  it('reports not-set for a corrupted settings file rather than throwing', () => {
    writeFileSync(settingsFile, '{invalid json', 'utf-8')
    expect(getOpenRouterKeyProtectionState()).toBe('not-set')
  })

  it('reads a settings file written before density existed', () => {
    // Upgrade path: the key is absent, so the merge over defaults supplies it
    // and the rest of the file survives untouched.
    writeFileSync(
      settingsFile,
      JSON.stringify({ theme: 'dark', operatorName: 'Det. Smith' }),
      'utf-8'
    )
    const settings = getSettings()
    expect(settings.density).toBe('compact')
    expect(settings.theme).toBe('dark')
    expect(settings.operatorName).toBe('Det. Smith')
  })
})
