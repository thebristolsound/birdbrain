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
} from '../../../src/main/services/settings'

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
})
