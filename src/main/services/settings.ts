import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { BirdbrainSettings, EntityType } from '@shared/types'

let settingsPath: string

const DEFAULT_SETTINGS: BirdbrainSettings = {
  openRouterApiKey: null,
  defaultModel: 'anthropic/claude-sonnet-4',
  autoExtractEntities: false,
  enabledEntityTypes: [
    'email', 'phone', 'domain', 'ip_address', 'username',
    'crypto_wallet', 'person', 'organization', 'date'
  ] as EntityType[],
  minEntityConfidence: 0.5,
  captureScreenshots: true,
  captureHtml: true,
  dedupeWindowSeconds: 60,
  ignoredUrlPatterns: [],
  storagePath: '',
  maxStorageMb: null,
  theme: 'dark',
  sidebarWidth: 300,
  autoCaptureMode: 'notify'
}

export function initSettings(userDataPath: string): void {
  settingsPath = join(userDataPath, 'settings.json')
  // Set default storage path
  if (!DEFAULT_SETTINGS.storagePath) {
    DEFAULT_SETTINGS.storagePath = join(userDataPath, 'captures')
  }
}

export function getSettings(): BirdbrainSettings {
  if (!settingsPath) throw new Error('Settings not initialized')
  if (!existsSync(settingsPath)) {
    return { ...DEFAULT_SETTINGS }
  }
  try {
    const raw = readFileSync(settingsPath, 'utf-8')
    const saved = JSON.parse(raw)
    return { ...DEFAULT_SETTINGS, ...saved }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function updateSettings(partial: Partial<BirdbrainSettings>): BirdbrainSettings {
  const current = getSettings()
  const updated = { ...current, ...partial }
  writeFileSync(settingsPath, JSON.stringify(updated, null, 2), 'utf-8')
  return updated
}

export function resetSettings(): BirdbrainSettings {
  const defaults = { ...DEFAULT_SETTINGS }
  writeFileSync(settingsPath, JSON.stringify(defaults, null, 2), 'utf-8')
  return defaults
}

// For testing
export function setSettingsPath(path: string): void {
  settingsPath = path
}

export function getDefaultSettings(): BirdbrainSettings {
  return { ...DEFAULT_SETTINGS }
}
