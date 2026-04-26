import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { BirdbrainSettings } from '@shared/types'
import { PartialBirdbrainSettingsSchema } from '@shared/schemas'
import { DEFAULT_ANALYSIS_SYSTEM_PROMPT } from '@shared/constants'

// Encrypt/decrypt API keys at rest using Electron's OS credential store.
// Falls back to plaintext when safeStorage is unavailable (e.g. tests, headless Linux).
let _safeStorage: typeof import('electron').safeStorage | null = null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  _safeStorage = require('electron').safeStorage
} catch {
  /* not in Electron context (e.g. tests) */
}

function encryptApiKey(key: string | null): string | null {
  if (!key) return null
  try {
    if (_safeStorage?.isEncryptionAvailable()) {
      return 'enc:' + _safeStorage.encryptString(key).toString('base64')
    }
  } catch {
    /* encryption not available */
  }
  return key
}

function decryptApiKey(stored: string | null): string | null {
  if (!stored) return null
  if (!stored.startsWith('enc:')) return stored
  try {
    if (_safeStorage?.isEncryptionAvailable()) {
      return _safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'))
    }
  } catch {
    /* decryption not available */
  }
  return null
}

let settingsPath: string

const DEFAULT_SETTINGS: BirdbrainSettings = {
  openRouterApiKey: null,
  defaultModel: 'anthropic/claude-sonnet-4',
  captureScreenshots: true,
  dedupeWindowSeconds: 60,
  ignoredUrlPatterns: [],
  storagePath: '',
  theme: 'light',
  operatorName: '',
  autoCaptureMode: 'notify',
  lastActiveCaseId: null,
  lastActiveSection: 'captures',
  hasCompletedOnboarding: false,
  analysisSystemPrompt: DEFAULT_ANALYSIS_SYSTEM_PROMPT
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
    const saved: unknown = JSON.parse(raw)
    const parsed = PartialBirdbrainSettingsSchema.safeParse(saved)
    if (!parsed.success) {
      console.warn(
        '[settings] stored file failed schema validation, falling back to defaults:',
        parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
      )
      return { ...DEFAULT_SETTINGS }
    }
    const merged = { ...DEFAULT_SETTINGS, ...parsed.data }
    merged.openRouterApiKey = decryptApiKey(merged.openRouterApiKey)
    return merged
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function updateSettings(partial: Partial<BirdbrainSettings>): BirdbrainSettings {
  const parsed = PartialBirdbrainSettingsSchema.safeParse(partial)
  if (!parsed.success) {
    throw new Error(
      `Invalid settings: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`
    )
  }
  const current = getSettings()
  const updated = { ...current, ...parsed.data }
  // Only re-encrypt the API key if it was explicitly changed in this update.
  // Otherwise preserve the raw stored value to avoid data loss when safeStorage
  // is unavailable (the encrypted blob would be unreadable but should not be erased).
  const toWrite = { ...updated }
  if ('openRouterApiKey' in partial) {
    toWrite.openRouterApiKey = encryptApiKey(updated.openRouterApiKey)
  } else {
    // Preserve whatever is on disk (may be encrypted)
    try {
      const raw = JSON.parse(readFileSync(settingsPath, 'utf-8'))
      if (raw.openRouterApiKey !== undefined) {
        toWrite.openRouterApiKey = raw.openRouterApiKey
      }
    } catch {
      /* file doesn't exist yet, use the merged value */
    }
  }
  writeFileSync(settingsPath, JSON.stringify(toWrite, null, 2), 'utf-8')
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
