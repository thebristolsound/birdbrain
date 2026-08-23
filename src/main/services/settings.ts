import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { DEFAULT_UI_DENSITY, type BirdbrainSettings, type KeyProtectionState } from '@shared/types'
import { PartialBirdbrainSettingsSchema } from '@shared/schemas'
import {
  DEFAULT_ANALYSIS_SYSTEM_PROMPT,
  DEFAULT_DEDUPE_WINDOW_SECONDS,
  DEFAULT_TSA_URL
} from '@shared/constants'
import { logger } from '@main/services/logger'

// Encrypt/decrypt API keys at rest using Electron's OS credential store.
// Falls back to plaintext when safeStorage is unavailable (e.g. tests, headless Linux).
let _safeStorage: typeof import('electron').safeStorage | null = null
let _app: typeof import('electron').app | null = null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const electron = require('electron')
  _safeStorage = electron.safeStorage
  _app = electron.app
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
  dedupeWindowSeconds: DEFAULT_DEDUPE_WINDOW_SECONDS,
  ignoredUrlPatterns: [],
  storagePath: '',
  theme: 'light',
  reduceMotion: false,
  density: DEFAULT_UI_DENSITY,
  operatorName: '',
  operatorRole: '',
  operatorOrganization: '',
  tsaUrl: DEFAULT_TSA_URL,
  autoCaptureMode: 'notify',
  lastActiveCaseId: null,
  lastActiveSection: 'captures',
  hasCompletedOnboarding: false,
  analysisSystemPrompt: DEFAULT_ANALYSIS_SYSTEM_PROMPT,
  detailsPanelCollapsed: false,
  tooltipsSeen: {},
  onboardingChapters: {},
  isFreshInstall: false,
  releaseChannel: 'stable',
  autoCheckForUpdates: true
}

// A semver prerelease is signalled by a hyphen before any build-metadata `+`
// (e.g. `1.0.1-beta.11`). Beta testers install prerelease builds, so on first
// run they default to the beta channel rather than being parked on stable.
// Exported for unit testing the release-channel derivation.
export function isPrereleaseVersion(version: string): boolean {
  const core = version.split('+')[0]
  return core.includes('-')
}

export function initSettings(userDataPath: string): void {
  settingsPath = join(userDataPath, 'settings.json')
  // Set default storage path
  if (!DEFAULT_SETTINGS.storagePath) {
    DEFAULT_SETTINGS.storagePath = join(userDataPath, 'captures')
  }
  // Derive the first-run release channel from the installed build so prerelease
  // testers stay on beta. Never throws — falls back to the 'stable' default.
  try {
    const version = _app?.getVersion?.()
    if (version) {
      DEFAULT_SETTINGS.releaseChannel = isPrereleaseVersion(version) ? 'beta' : 'stable'
    }
  } catch {
    /* keep the 'stable' default */
  }
  // Latch the fresh-install determination (#404). No settings.json means this
  // launch is the first one, and only a fresh install ever auto-fires a tour
  // chapter. The determination has to be persisted here rather than re-derived
  // later, because the very next write creates the file and the signal is gone.
  // Runs last so the storagePath and releaseChannel derivations above are
  // already on DEFAULT_SETTINGS when they get written out.
  if (!existsSync(settingsPath)) {
    DEFAULT_SETTINGS.isFreshInstall = true
    try {
      writeFileSync(settingsPath, JSON.stringify(DEFAULT_SETTINGS, null, 2), 'utf-8')
    } catch (err) {
      // An unwritable userData directory is already fatal elsewhere; failing to
      // seed the file here only costs the tour, so never throw from init.
      logger.warn('settings', 'settings.fresh_install_seed_failed', undefined, err)
    }
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
      logger.warn('settings', 'settings.schema_invalid')
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

// Backs the Settings/Diagnostics indicator from #414. Reads the raw on-disk
// value directly (not decryptApiKey's merged/decrypted view) so the result
// reflects at-rest protection rather than whether the app can currently read
// the key back. Unlike the signing key, there is no acknowledgement gate
// here — the OpenRouter key is a revocable credential, not evidence (#289).
export function getOpenRouterKeyProtectionState(): KeyProtectionState {
  if (!settingsPath || !existsSync(settingsPath)) return 'not-set'
  try {
    const raw: unknown = JSON.parse(readFileSync(settingsPath, 'utf-8'))
    const stored =
      raw && typeof raw === 'object' && 'openRouterApiKey' in raw
        ? (raw as { openRouterApiKey: unknown }).openRouterApiKey
        : null
    if (!stored || typeof stored !== 'string') return 'not-set'
    return stored.startsWith('enc:') ? 'protected' : 'plaintext'
  } catch {
    // A corrupted settings.json is otherwise indistinguishable from "no key
    // was ever saved" — log it so the failure is actionable instead of
    // silently reading as an unremarkable not-set in Diagnostics.
    logger.warn('settings', 'settings.key_protection_state_unreadable')
    return 'not-set'
  }
}
