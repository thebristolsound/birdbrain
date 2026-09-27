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

// Choices the operator made while settings.json could not be read (#1169).
// updateSettings will not write over a file it cannot read, so without these
// the timestamping switch would be stuck in its fail-closed position until the
// file became readable. They apply for the rest of the session, including after
// the file becomes readable again, and are written out by the next save that
// succeeds; a restart before then discards them.
let unsavedChoices: Partial<BirdbrainSettings> = {}

const DEFAULT_SETTINGS: BirdbrainSettings = {
  openRouterApiKey: null,
  defaultModel: 'anthropic/claude-sonnet-4',
  captureScreenshots: true,
  dedupeWindowSeconds: DEFAULT_DEDUPE_WINDOW_SECONDS,
  ignoredUrlPatterns: [],
  storagePath: '',
  theme: 'dark',
  reduceMotion: false,
  density: DEFAULT_UI_DENSITY,
  operatorName: '',
  operatorRole: '',
  operatorOrganization: '',
  tsaUrl: DEFAULT_TSA_URL,
  tsaEnabled: true,
  autoCaptureMode: 'notify',
  lastActiveCaseId: null,
  lastActiveSection: 'captures',
  hasCompletedOnboarding: false,
  analysisSystemPrompt: DEFAULT_ANALYSIS_SYSTEM_PROMPT,
  detailsPanelCollapsed: false,
  tooltipsSeen: {},
  onboardingChapters: {},
  isFreshInstall: false,
  demoCaseSeeded: false,
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

// zod 4 applies a field's `.default()` even under `.partial()`, so a parse
// fills in every key the input omitted. Keep only the keys the input carried,
// or an update of one field would reset the rest to their defaults.
function suppliedKeysOnly<T extends object>(input: object, data: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(data).filter(([key]) => Object.hasOwn(input, key))
  ) as Partial<T>
}

// Every other setting fails open to its default when the file will not load.
// The trusted-timestamping opt-out must not: falling back to the enabled default
// would put an operator who declined TSA disclosure back on the network without
// telling them, and the failure mode of the control is the whole point of it
// (#1169). Two failures, and the difference between them is whether the stored
// preference is visible at all:
//
//   - The JSON parsed but the schema rejected it. Every key is legible, so the
//     preference is known: an explicit `false` survives the fallback, and
//     anything else keeps the default, because "not off" is the only reading
//     that does not invent an intent the file does not carry.
//   - The file exists and could not be read or parsed at all. Nothing is
//     legible, so the preference is unknown rather than known-absent, and the
//     only safe reading of an unknown privacy preference is the restrictive one
//     — see the catch in getSettings().
function declinedTimestamping(saved: unknown): boolean {
  return (
    typeof saved === 'object' &&
    saved !== null &&
    (saved as { tsaEnabled?: unknown }).tsaEnabled === false
  )
}

export function getSettings(): BirdbrainSettings {
  return { ...readStoredSettings(), ...unsavedChoices }
}

function readStoredSettings(): BirdbrainSettings {
  if (!settingsPath) throw new Error('Settings not initialized')
  if (!existsSync(settingsPath)) {
    return { ...DEFAULT_SETTINGS }
  }
  let raw: string
  try {
    raw = readFileSync(settingsPath, 'utf-8')
  } catch (err) {
    // The file's bytes are intact; this process cannot read them right now
    // (EACCES, EBUSY, an antivirus lock). The stored preference is unknown, so
    // the session falls closed like the parse failure below — but the decline is
    // not allowed to persist: updateSettings refuses to write over a file it
    // cannot read, so the operator's real preference is still on disk when the
    // lock clears (#1169 round-2 review). Once the operator has set the switch
    // this session, their choice governs timestamping and nothing fell closed.
    if (!('tsaEnabled' in unsavedChoices)) {
      logger.warn('settings', 'settings.unreadable_timestamping_fail_closed', undefined, err)
    }
    return { ...DEFAULT_SETTINGS, tsaEnabled: false }
  }
  try {
    const saved: unknown = JSON.parse(raw)
    const parsed = PartialBirdbrainSettingsSchema.safeParse(saved)
    if (!parsed.success) {
      logger.warn('settings', 'settings.schema_invalid')
      return { ...DEFAULT_SETTINGS, tsaEnabled: !declinedTimestamping(saved) }
    }
    const merged = { ...DEFAULT_SETTINGS, ...suppliedKeysOnly(saved as object, parsed.data) }
    merged.openRouterApiKey = decryptApiKey(merged.openRouterApiKey)
    return merged
  } catch {
    // A file that reads but will not parse — truncated by a kill mid-write
    // (updateSettings persists with a plain writeFileSync), trailing garbage,
    // not JSON at all. The operator's timestamping preference is unknown here,
    // not absent, so it falls closed: an activist who declined
    // must not be put back in contact with the TSA by a half-written file. Every
    // other setting still falls open, and the resulting state is visible in
    // Settings and Diagnostics and reversible with the switch.
    logger.warn('settings', 'settings.unreadable_timestamping_fail_closed')
    return { ...DEFAULT_SETTINGS, tsaEnabled: false }
  }
}

export function updateSettings(partial: Partial<BirdbrainSettings>): BirdbrainSettings {
  const parsed = PartialBirdbrainSettingsSchema.safeParse(partial)
  if (!parsed.success) {
    throw new Error(
      `Invalid settings: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`
    )
  }
  const supplied = suppliedKeysOnly(partial, parsed.data)
  // Refuse to overwrite a settings file this process cannot read (#1169 round-2
  // review). The merge below is built on getSettings(), which falls back to the
  // defaults plus tsaEnabled: false when the read throws, so writing it would
  // persist an opt-out the operator never chose — and blank every other setting —
  // because of a transient lock. The change is held for the session instead (see
  // unsavedChoices). A file that will not parse is already lost and is still
  // rewritten: that is the recovery path the switch depends on.
  if (existsSync(settingsPath)) {
    try {
      readFileSync(settingsPath, 'utf-8')
    } catch (err) {
      unsavedChoices = { ...unsavedChoices, ...supplied }
      logger.warn('settings', 'settings.unreadable_write_refused', undefined, err)
      return getSettings()
    }
  }
  const pendingKey = 'openRouterApiKey' in partial || 'openRouterApiKey' in unsavedChoices
  const current = getSettings()
  const updated = { ...current, ...supplied }
  // Only re-encrypt the API key if it was explicitly changed in this update or
  // held unsaved from earlier in the session. Otherwise preserve the raw stored
  // value to avoid data loss when safeStorage is unavailable (the encrypted blob
  // would be unreadable but should not be erased).
  const toWrite = { ...updated }
  if (pendingKey) {
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
  unsavedChoices = {}
  return updated
}

export function resetSettings(): BirdbrainSettings {
  const defaults = { ...DEFAULT_SETTINGS }
  writeFileSync(settingsPath, JSON.stringify(defaults, null, 2), 'utf-8')
  unsavedChoices = {}
  return defaults
}

// For testing. Unsaved choices belong to the file they could not be written to.
export function setSettingsPath(path: string): void {
  settingsPath = path
  unsavedChoices = {}
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
