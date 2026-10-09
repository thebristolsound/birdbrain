import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync, chmodSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { writeFileSync } from 'fs'

const { loggerWarn } = vi.hoisted(() => ({ loggerWarn: vi.fn() }))
vi.mock('@main/services/logger', () => ({
  logger: { warn: loggerWarn, error: vi.fn(), info: vi.fn() }
}))

import {
  setSettingsPath,
  getSettings,
  updateSettings,
  resetSettings,
  getDefaultSettings,
  onThemeChange,
  InvalidSettingsError
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
    loggerWarn.mockClear()
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe('onThemeChange', () => {
    it('fires only when an update or reset moves the theme', () => {
      const listener = vi.fn()
      const off = onThemeChange(listener)
      updateSettings({ operatorName: 'Matt' })
      expect(listener).not.toHaveBeenCalled()
      updateSettings({ theme: 'light' })
      expect(listener).toHaveBeenCalledWith('light')
      updateSettings({ theme: 'light' })
      expect(listener).toHaveBeenCalledTimes(1)
      resetSettings()
      expect(listener).toHaveBeenLastCalledWith('dark')
      off()
      updateSettings({ theme: 'light' })
      expect(listener).toHaveBeenCalledTimes(2)
    })
  })

  it('returns default settings when no file exists', () => {
    const settings = getSettings()
    expect(settings.captureScreenshots).toBe(true)
    expect(settings.dedupeWindowSeconds).toBe(60)
    expect(settings.theme).toBe('dark')
  })

  it('updates settings and persists them', () => {
    updateSettings({ operatorName: 'Alex Smith' })
    const settings = getSettings()
    expect(settings.operatorName).toBe('Alex Smith')
    // Other defaults remain
    expect(settings.captureScreenshots).toBe(true)
    expect(settings.dedupeWindowSeconds).toBe(60)
  })

  it('merges partial updates without losing existing values', () => {
    updateSettings({ operatorName: 'Alex Smith' })
    updateSettings({ theme: 'light' })
    const settings = getSettings()
    expect(settings.operatorName).toBe('Alex Smith')
    expect(settings.theme).toBe('light')
  })

  it('resets settings to defaults', () => {
    updateSettings({ operatorName: 'Alex Smith', dedupeWindowSeconds: 120 })
    resetSettings()
    const settings = getSettings()
    expect(settings.operatorName).toBe('')
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
    expect(settings.theme).toBe('dark')
  })

  it('falls back to defaults when stored settings have wrong-typed fields', () => {
    writeFileSync(
      settingsFile,
      JSON.stringify({ dedupeWindowSeconds: 'not-a-number', theme: 'light' }),
      'utf-8'
    )
    const settings = getSettings()
    // Entire saved object rejected by schema → defaults returned
    expect(settings.dedupeWindowSeconds).toBe(60)
    expect(settings.theme).toBe('dark')
  })

  it('defaults the TSA endpoint to DigiCert', () => {
    expect(getSettings().tsaUrl).toBe(DEFAULT_TSA_URL)
  })

  it('persists a valid custom TSA endpoint', () => {
    updateSettings({ tsaUrl: 'https://freetsa.org/tsr' })
    expect(getSettings().tsaUrl).toBe('https://freetsa.org/tsr')
  })

  // #1522. An edit used to be coerced to the default like a bad value on load, so
  // one typing mistake moved an operator off their own authority without a word.
  it.each(['not a url', 'ftp://example.test/tsa', '  not a url  ', 'ftp://evil.example/tsa'])(
    'refuses the TSA endpoint %j and keeps the configured one',
    (tsaUrl) => {
      updateSettings({ tsaUrl: 'https://custom.example/tsr', theme: 'light' })
      const before = readFileSync(settingsFile, 'utf-8')
      expect(() => updateSettings({ tsaUrl, theme: 'dark' })).toThrow(InvalidSettingsError)
      expect(() => updateSettings({ tsaUrl })).toThrow(/tsaUrl: not an http:\/\/ or https:\/\//)
      expect(readFileSync(settingsFile, 'utf-8')).toBe(before)
      expect(getSettings().tsaUrl).toBe('https://custom.example/tsr')
      expect(getSettings().theme).toBe('light')
    }
  )

  it('refuses a TSA endpoint that is not a string', () => {
    updateSettings({ tsaUrl: 'https://custom.example/tsr' })
    expect(() => updateSettings({ tsaUrl: 42 as unknown as string })).toThrow(InvalidSettingsError)
    expect(getSettings().tsaUrl).toBe('https://custom.example/tsr')
  })

  it('stores a whitespace-padded valid TSA endpoint trimmed', () => {
    updateSettings({ tsaUrl: '  https://tsa.example/tsr  ' })
    expect(getSettings().tsaUrl).toBe('https://tsa.example/tsr')
  })

  it('stores the default when the TSA endpoint is cleared', () => {
    updateSettings({ tsaUrl: 'https://custom.example/tsr' })
    updateSettings({ tsaUrl: '   ' })
    expect(getSettings().tsaUrl).toBe(DEFAULT_TSA_URL)
  })

  it('leaves the TSA endpoint alone when an edit does not name it', () => {
    updateSettings({ tsaUrl: 'https://custom.example/tsr' })
    updateSettings({ theme: 'light' })
    expect(getSettings().tsaUrl).toBe('https://custom.example/tsr')
  })

  it('coerces an invalid stored tsaUrl without resetting other settings', () => {
    // A hand-edited file with a bad tsaUrl but otherwise-valid fields must NOT
    // trigger the whole-file reset that a genuinely wrong-typed field does.
    writeFileSync(
      settingsFile,
      JSON.stringify({ tsaUrl: 'not a url', theme: 'light', operatorName: 'Keep Me' }),
      'utf-8'
    )
    const settings = getSettings()
    expect(settings.tsaUrl).toBe(DEFAULT_TSA_URL)
    expect(settings.theme).toBe('light')
    expect(settings.operatorName).toBe('Keep Me')
  })

  // #1169. Trusted timestamping is on unless the operator says otherwise, and
  // the switch has to survive everything that can happen to a settings file,
  // because failing open puts a declined operator back on the network silently.
  describe('trusted-timestamping opt-out', () => {
    it('is enabled on a fresh install', () => {
      expect(getSettings().tsaEnabled).toBe(true)
    })

    it('round-trips the opt-out and the opt-back-in', () => {
      updateSettings({ tsaEnabled: false })
      expect(getSettings().tsaEnabled).toBe(false)
      updateSettings({ tsaEnabled: true })
      expect(getSettings().tsaEnabled).toBe(true)
    })

    it('stays enabled for a settings file written before the switch existed', () => {
      writeFileSync(settingsFile, JSON.stringify({ theme: 'light' }), 'utf-8')
      expect(getSettings().tsaEnabled).toBe(true)
    })

    it('rejects a non-boolean rather than coercing it', () => {
      expect(() => updateSettings({ tsaEnabled: 'no' as unknown as boolean })).toThrow(/tsaEnabled/)
      expect(getSettings().tsaEnabled).toBe(true)
    })

    it('keeps the opt-out when another field makes the whole file unparseable', () => {
      // Every other setting falls back to its default here. This one must not:
      // the operator declined, and a corrupt neighbouring field is not consent.
      writeFileSync(
        settingsFile,
        JSON.stringify({ tsaEnabled: false, dedupeWindowSeconds: 'soon' }),
        'utf-8'
      )
      const settings = getSettings()
      expect(settings.tsaEnabled).toBe(false)
      expect(settings.dedupeWindowSeconds).toBe(60)
    })

    it('does not invent an opt-out from an unparseable file that never had one', () => {
      writeFileSync(settingsFile, JSON.stringify({ dedupeWindowSeconds: 'soon' }), 'utf-8')
      expect(getSettings().tsaEnabled).toBe(true)
    })

    it('does not read a non-boolean as an opt-out', () => {
      // 'false' the string is not a decision the file records, so the default
      // stands rather than a coercion nobody asked for.
      writeFileSync(settingsFile, JSON.stringify({ tsaEnabled: 'false' }), 'utf-8')
      expect(getSettings().tsaEnabled).toBe(true)
    })

    // The schema-invalid branch above can still read the stored preference. This
    // one cannot: JSON.parse throws, so nothing in the file is legible and the
    // preference is unknown rather than known-absent. Falling open there is the
    // exact failure the opt-out exists to prevent — updateSettings persists with
    // a plain writeFileSync, so a kill mid-write leaves truncated JSON, and the
    // next launch would put a declined operator back in contact with the TSA.
    describe('a settings file that cannot be parsed at all', () => {
      const unreadable = [
        ['truncated mid-write', '{"tsaEnabled": false, "theme": "da'],
        ['trailing garbage', '{"tsaEnabled": false}}}'],
        ['not JSON at all', 'not json'],
        ['empty', '']
      ] as const

      for (const [label, contents] of unreadable) {
        it(`falls closed for timestamping when the file is ${label}`, () => {
          writeFileSync(settingsFile, contents, 'utf-8')
          expect(getSettings().tsaEnabled).toBe(false)
        })
      }

      it('still falls open for every other setting', () => {
        writeFileSync(settingsFile, '{"theme": "light", "dedupeWin', 'utf-8')
        const settings = getSettings()
        expect(settings.theme).toBe('dark')
        expect(settings.dedupeWindowSeconds).toBe(60)
        expect(settings.tsaUrl).toBe(DEFAULT_TSA_URL)
      })

      it('logs the fail-closed read rather than degrading silently', () => {
        writeFileSync(settingsFile, '{truncated', 'utf-8')
        getSettings()
        expect(loggerWarn).toHaveBeenCalledWith(
          'settings',
          'settings.unreadable_timestamping_fail_closed'
        )
      })

      it('leaves the switch usable, so the state is recoverable', () => {
        writeFileSync(settingsFile, '{truncated', 'utf-8')
        expect(getSettings().tsaEnabled).toBe(false)
        updateSettings({ tsaEnabled: true })
        expect(getSettings().tsaEnabled).toBe(true)
      })
    })

    // A file whose bytes are intact but which this process cannot read right now:
    // EACCES, EBUSY, an antivirus lock. The session falls closed the same way,
    // because the stored preference is illegible either way — but the decline must
    // not be written back, or a transient lock plus one routine settings write
    // persists an opt-out the operator never chose and blanks every other setting
    // with it (#1169 round-2 review). Skipped as root, which reads a 0o000 file.
    describe('a settings file that cannot be read', () => {
      it.skipIf(process.getuid?.() === 0)('falls closed for timestamping', () => {
        writeFileSync(settingsFile, JSON.stringify({ tsaEnabled: true }), 'utf-8')
        chmodSync(settingsFile, 0o000)
        try {
          expect(getSettings().tsaEnabled).toBe(false)
        } finally {
          chmodSync(settingsFile, 0o600)
        }
      })

      const locked = (stored: object, run: () => void): void => {
        writeFileSync(settingsFile, JSON.stringify(stored), 'utf-8')
        chmodSync(settingsFile, 0o000)
        try {
          run()
        } finally {
          chmodSync(settingsFile, 0o600)
        }
      }
      const onDisk = (): Record<string, unknown> => JSON.parse(readFileSync(settingsFile, 'utf-8'))

      it.skipIf(process.getuid?.() === 0)(
        'holds the change for the session, leaving the stored file intact',
        () => {
          const stored = { tsaEnabled: true, theme: 'light' }
          locked(stored, () => {
            expect(updateSettings({ operatorName: 'Someone' }).operatorName).toBe('Someone')
            expect(getSettings().operatorName).toBe('Someone')
            expect(loggerWarn).toHaveBeenCalledWith(
              'settings',
              'settings.unreadable_write_refused',
              undefined,
              expect.anything()
            )
          })
          expect(onDisk()).toEqual(stored)
        }
      )

      it.skipIf(process.getuid?.() === 0)(
        'lets the operator switch timestamping back on while the file is unreadable',
        () => {
          locked({ tsaEnabled: false }, () => {
            expect(getSettings().tsaEnabled).toBe(false)
            expect(updateSettings({ tsaEnabled: true }).tsaEnabled).toBe(true)
            loggerWarn.mockClear()
            expect(getSettings().tsaEnabled).toBe(true)
            // The switch now reflects the operator's choice, so nothing fell closed.
            expect(loggerWarn).not.toHaveBeenCalledWith(
              'settings',
              'settings.unreadable_timestamping_fail_closed',
              undefined,
              expect.anything()
            )
          })
        }
      )

      it.skipIf(process.getuid?.() === 0)(
        'keeps a held opt-out after the file becomes readable again',
        () => {
          locked({ tsaEnabled: true, theme: 'light' }, () => {
            updateSettings({ tsaEnabled: false })
          })
          const settings = getSettings()
          expect(settings.tsaEnabled).toBe(false)
          expect(settings.theme).toBe('light')
        }
      )

      it.skipIf(process.getuid?.() === 0)(
        'writes held choices with the next save that succeeds',
        () => {
          locked({ tsaEnabled: true, theme: 'light', operatorRole: 'Old' }, () => {
            updateSettings({ tsaEnabled: false, operatorRole: 'Analyst' })
          })
          updateSettings({ operatorName: 'Someone' })
          expect(onDisk()).toMatchObject({
            tsaEnabled: false,
            theme: 'light',
            operatorName: 'Someone',
            operatorRole: 'Analyst'
          })
        }
      )
    })
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
    updateSettings({ operatorName: 'Alex Smith' })
    expect(getSettings().operatorName).toBe('Alex Smith')
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
    expect(() => updateSettings({ captureScreenshots: 'yes' as unknown as boolean })).toThrow(
      /Invalid settings/
    )
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
      JSON.stringify({ density: 'cosy', operatorName: 'Alex Smith' }),
      'utf-8'
    )
    const settings = getSettings()
    expect(settings.density).toBe('compact')
    expect(settings.operatorName).toBe('')
  })

  // The retired AI analysis fields (openRouterApiKey, defaultModel,
  // analysisSystemPrompt) are no longer in the schema. A file still carrying
  // them must load with every other value intact, not fall back to defaults.
  it('loads a file carrying the retired AI fields without them', () => {
    writeFileSync(
      settingsFile,
      JSON.stringify({
        openRouterApiKey: 'sk-or-v1-stored',
        defaultModel: 'anthropic/claude-sonnet-4',
        analysisSystemPrompt: 'custom prompt',
        theme: 'light',
        operatorName: 'Alex Smith'
      }),
      'utf-8'
    )
    const settings = getSettings()
    expect(settings.theme).toBe('light')
    expect(settings.operatorName).toBe('Alex Smith')
    expect(settings).not.toHaveProperty('openRouterApiKey')
    expect(settings).not.toHaveProperty('defaultModel')
    expect(settings).not.toHaveProperty('analysisSystemPrompt')
    expect(loggerWarn).not.toHaveBeenCalled()
  })

  it('drops the retired AI fields from disk on the next save', () => {
    writeFileSync(
      settingsFile,
      JSON.stringify({ openRouterApiKey: 'sk-or-v1-stored', theme: 'light' }),
      'utf-8'
    )
    updateSettings({ operatorName: 'Alex Smith' })
    const stored = JSON.parse(readFileSync(settingsFile, 'utf-8'))
    expect(stored).not.toHaveProperty('openRouterApiKey')
    expect(stored).toMatchObject({ theme: 'light', operatorName: 'Alex Smith' })
  })

  it('reads a settings file written before density existed', () => {
    // Upgrade path: the key is absent, so the merge over defaults supplies it
    // and the rest of the file survives untouched.
    writeFileSync(
      settingsFile,
      JSON.stringify({ theme: 'light', operatorName: 'Alex Smith' }),
      'utf-8'
    )
    const settings = getSettings()
    expect(settings.density).toBe('compact')
    expect(settings.theme).toBe('light')
    expect(settings.operatorName).toBe('Alex Smith')
  })

  describe('tour state (#404)', () => {
    it('defaults to no chapters seen and not a fresh install', () => {
      const defaults = getDefaultSettings()
      expect(defaults.onboardingChapters).toEqual({})
      expect(defaults.isFreshInstall).toBe(false)
    })

    it('round-trips per-chapter completion', () => {
      updateSettings({ onboardingChapters: { intro: true } })
      expect(getSettings().onboardingChapters).toEqual({ intro: true })
      updateSettings({ onboardingChapters: { intro: true, ext: true, case: true } })
      expect(getSettings().onboardingChapters).toEqual({ intro: true, ext: true, case: true })
    })

    it('keeps tour state through an update that does not name it', () => {
      updateSettings({ isFreshInstall: true, onboardingChapters: { intro: true } })
      updateSettings({ theme: 'dark' })
      const settings = getSettings()
      expect(settings.isFreshInstall).toBe(true)
      expect(settings.onboardingChapters).toEqual({ intro: true })
    })

    it('rejects a non-boolean chapter value', () => {
      expect(() =>
        updateSettings({
          onboardingChapters: { intro: 'yes' } as unknown as Record<string, boolean>
        })
      ).toThrow(/Invalid settings/)
    })

    it('supplies both keys for a settings file written before they existed', () => {
      writeFileSync(settingsFile, JSON.stringify({ theme: 'light' }), 'utf-8')
      const settings = getSettings()
      expect(settings.onboardingChapters).toEqual({})
      expect(settings.isFreshInstall).toBe(false)
      expect(settings.theme).toBe('light')
    })
  })
})

// initSettings mutates the module-level defaults, which is deliberate — it is
// how the fresh-install determination survives to the first read. That makes it
// sticky across tests, so each case here gets its own module instance.
describe('initSettings and the fresh-install latch', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'bb-settings-init-'))
    vi.resetModules()
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  async function load() {
    return import('@main/services/settings')
  }

  it('latches the flag and seeds the file when there is no settings.json', async () => {
    const { initSettings, getSettings: read } = await load()
    initSettings(tempDir)
    expect(existsSync(join(tempDir, 'settings.json'))).toBe(true)
    expect(read().isFreshInstall).toBe(true)
  })

  it('leaves an existing install alone', async () => {
    writeFileSync(
      join(tempDir, 'settings.json'),
      JSON.stringify({ operatorName: 'Alex Smith' }),
      'utf-8'
    )
    const { initSettings, getSettings: read } = await load()
    initSettings(tempDir)
    const settings = read()
    expect(settings.isFreshInstall).toBe(false)
    expect(settings.operatorName).toBe('Alex Smith')
  })

  // The upgrade case the acceptance criteria call out: an install predating
  // both keys still has a settings.json, so it is not fresh and is never toured.
  it('leaves an install predating the tour keys alone', async () => {
    writeFileSync(join(tempDir, 'settings.json'), JSON.stringify({ theme: 'dark' }), 'utf-8')
    const { initSettings, getSettings: read } = await load()
    initSettings(tempDir)
    expect(read().isFreshInstall).toBe(false)
    expect(read().onboardingChapters).toEqual({})
  })

  it('seeds a file with none of the retired AI fields', async () => {
    const { initSettings } = await load()
    initSettings(tempDir)
    const seeded = JSON.parse(readFileSync(join(tempDir, 'settings.json'), 'utf-8'))
    expect(seeded).not.toHaveProperty('openRouterApiKey')
    expect(seeded).not.toHaveProperty('defaultModel')
    expect(seeded).not.toHaveProperty('analysisSystemPrompt')
  })

  it('does not throw when the settings directory cannot be written', async () => {
    const { initSettings, getSettings: read } = await load()
    expect(() => initSettings(join(tempDir, 'does', 'not', 'exist'))).not.toThrow()
    expect(read().isFreshInstall).toBe(true)
    expect(loggerWarn).toHaveBeenCalledWith(
      'settings',
      'settings.fresh_install_seed_failed',
      undefined,
      expect.objectContaining({ code: 'ENOENT' })
    )
  })
})

// The AI analysis feature was removed. An upgraded install may still hold its
// API key in settings.json, in plaintext or wrapped by safeStorage, and the
// key is a live credential, so startup rewrites the file without it.
describe('initSettings and the retired AI fields', () => {
  let tempDir: string
  let settingsFile: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'bb-settings-retired-'))
    settingsFile = join(tempDir, 'settings.json')
    vi.resetModules()
    loggerWarn.mockClear()
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  async function init(): Promise<typeof import('@main/services/settings')> {
    const settings = await import('@main/services/settings')
    settings.initSettings(tempDir)
    return settings
  }

  const onDisk = (): Record<string, unknown> => JSON.parse(readFileSync(settingsFile, 'utf-8'))

  it('removes a plaintext key and the other retired fields, keeping the rest', async () => {
    writeFileSync(
      settingsFile,
      JSON.stringify({
        openRouterApiKey: 'sk-or-v1-plaintext',
        defaultModel: 'openai/gpt-4o',
        analysisSystemPrompt: 'custom prompt',
        operatorName: 'Alex Smith',
        tsaEnabled: false,
        onboardingChapters: { intro: true }
      }),
      'utf-8'
    )
    const { getSettings: read } = await init()
    expect(onDisk()).toEqual({
      operatorName: 'Alex Smith',
      tsaEnabled: false,
      onboardingChapters: { intro: true }
    })
    expect(readFileSync(settingsFile, 'utf-8')).not.toContain('sk-or-v1-plaintext')
    expect(read().operatorName).toBe('Alex Smith')
    expect(read().tsaEnabled).toBe(false)
  })

  it('removes a key stored in its safeStorage-wrapped form', async () => {
    const wrapped = 'enc:' + Buffer.from('opaque-ciphertext').toString('base64')
    writeFileSync(
      settingsFile,
      JSON.stringify({ openRouterApiKey: wrapped, theme: 'light' }),
      'utf-8'
    )
    await init()
    expect(onDisk()).toEqual({ theme: 'light' })
  })

  it('does not rewrite a file that holds no retired fields', async () => {
    const original = '{"theme":"light"}'
    writeFileSync(settingsFile, original, 'utf-8')
    await init()
    expect(readFileSync(settingsFile, 'utf-8')).toBe(original)
  })

  it('leaves a file that will not parse untouched', async () => {
    const original = '{"openRouterApiKey": "sk-or-v1-trunc'
    writeFileSync(settingsFile, original, 'utf-8')
    await expect(init()).resolves.toBeDefined()
    expect(readFileSync(settingsFile, 'utf-8')).toBe(original)
  })

  it('leaves a file whose JSON is not an object untouched', async () => {
    writeFileSync(settingsFile, '["openRouterApiKey"]', 'utf-8')
    await init()
    expect(readFileSync(settingsFile, 'utf-8')).toBe('["openRouterApiKey"]')
  })

  it.skipIf(process.getuid?.() === 0)(
    'logs and carries on when the cleaned file cannot be written',
    async () => {
      writeFileSync(settingsFile, JSON.stringify({ openRouterApiKey: 'sk-or-v1-x' }), 'utf-8')
      chmodSync(settingsFile, 0o400)
      try {
        await expect(init()).resolves.toBeDefined()
        expect(loggerWarn).toHaveBeenCalledWith(
          'settings',
          'settings.retired_fields_cleanup_failed',
          undefined,
          expect.objectContaining({ code: 'EACCES' })
        )
      } finally {
        chmodSync(settingsFile, 0o600)
      }
    }
  )
})
