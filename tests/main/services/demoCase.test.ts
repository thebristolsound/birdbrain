import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join, resolve } from 'path'
import { tmpdir } from 'os'

const isPackaged = { value: false }
const resourcesDir = { value: '' }

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return isPackaged.value
    },
    getVersion: () => '1.0.0-test'
  }
}))

import { initDatabase, closeDatabase } from '@main/services/db/core'
import { createCase, getCase, setCaseDemo } from '@main/services/db/caseRepo'
import { initStorage, ensureCaseDir, getStorageRoot } from '@main/services/storage'
import { initSettings, getSettings, updateSettings } from '@main/services/settings'
import { initInstallationId, resetInstallationId } from '@main/services/installationId'
import { initSigningKey, resetSigningKey } from '@main/services/signingKey'
import {
  deleteDemoCase,
  getDemoCaseArchivePath,
  seedDemoCaseIfNeeded
} from '@main/services/demoCase'
import { DEMO_CASE_ARCHIVE_FILENAME, DEMO_CASE_OPERATOR_NAME } from '@shared/constants'

const FIXTURE = resolve(__dirname, '../../../resources', DEMO_CASE_ARCHIVE_FILENAME)

describe('demo case seeding', () => {
  let tempDir: string
  let cwdSpy: ReturnType<typeof vi.spyOn>

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'bb-demo-case-'))
    initStorage(join(tempDir, 'captures'))
    await initDatabase(':memory:')
    resetInstallationId()
    initInstallationId(tempDir)
    resetSigningKey()
    initSigningKey(tempDir, { confirmUnprotectedKey: () => true })
    initSettings(tempDir)
    isPackaged.value = false
    resourcesDir.value = ''
    // getDemoCaseArchivePath resolves an unpackaged fixture from the working
    // directory, which under vitest is the repository root — so the default
    // resolves to the real shipped archive, and a test that wants a missing one
    // points cwd somewhere empty.
    cwdSpy = vi.spyOn(process, 'cwd')
    cwdSpy.mockReturnValue(resolve(__dirname, '../../..'))
  })

  afterEach(() => {
    cwdSpy.mockRestore()
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('resolves the fixture beside the app resources when packaged', () => {
    isPackaged.value = true
    const originalResourcesPath = process.resourcesPath
    Object.defineProperty(process, 'resourcesPath', { value: '/opt/app/resources', configurable: true })
    try {
      expect(getDemoCaseArchivePath()).toBe(join('/opt/app/resources', DEMO_CASE_ARCHIVE_FILENAME))
    } finally {
      Object.defineProperty(process, 'resourcesPath', {
        value: originalResourcesPath,
        configurable: true
      })
    }
  })

  it('resolves the fixture from the checkout when not packaged', () => {
    expect(getDemoCaseArchivePath()).toBe(FIXTURE)
  })

  it('does nothing on an install that is not fresh', async () => {
    updateSettings({ isFreshInstall: false })

    const result = await seedDemoCaseIfNeeded()

    expect(result).toEqual({ seeded: false, reason: 'not-a-fresh-install' })
    // The latch is untouched, so an upgrade never even records an attempt.
    expect(getSettings().demoCaseSeeded).toBe(false)
  })

  it('imports the bundled archive on a fresh install and latches', async () => {
    updateSettings({ isFreshInstall: true })

    const result = await seedDemoCaseIfNeeded()

    expect(result.seeded).toBe(true)
    expect(getCase(result.caseId!)?.isDemo).toBe(true)
    expect(getSettings().demoCaseSeeded).toBe(true)
  })

  it('seeds without an operator name configured', async () => {
    // The gate the ordinary import path enforces would refuse here: a fresh
    // install has never been given an operator name. Seeding names itself.
    updateSettings({ isFreshInstall: true, operatorName: '' })

    const result = await seedDemoCaseIfNeeded()

    expect(result.seeded).toBe(true)
    expect(getSettings().operatorName).toBe('')
  })

  it('never re-imports once the latch is set', async () => {
    updateSettings({ isFreshInstall: true, demoCaseSeeded: true })

    const result = await seedDemoCaseIfNeeded()

    expect(result).toEqual({ seeded: false, reason: 'already-seeded' })
  })

  it('latches and gives up when the fixture is not bundled', async () => {
    cwdSpy.mockReturnValue(tempDir)
    updateSettings({ isFreshInstall: true })

    const result = await seedDemoCaseIfNeeded()

    expect(result).toEqual({ seeded: false, reason: 'fixture-missing' })
    // Latched anyway: a build shipping without the fixture must not retry the
    // same missing file on every launch for the life of the install.
    expect(getSettings().demoCaseSeeded).toBe(true)
  })

  it('latches and gives up when the bundled archive cannot be imported', async () => {
    const brokenRoot = join(tempDir, 'broken')
    mkdirSync(join(brokenRoot, 'resources'), { recursive: true })
    writeFileSync(join(brokenRoot, 'resources', DEMO_CASE_ARCHIVE_FILENAME), 'not a zip')
    cwdSpy.mockReturnValue(brokenRoot)
    updateSettings({ isFreshInstall: true })

    const result = await seedDemoCaseIfNeeded()

    expect(result).toEqual({ seeded: false, reason: 'import-failed' })
    expect(getSettings().demoCaseSeeded).toBe(true)
  })

  it('does not throw when the latch write itself fails', async () => {
    // Startup awaits this without a local guard and treats anything thrown as
    // a fatal launch failure, so the latch write is the one place a broken
    // userData directory could cost more than the demo case. Pointing settings
    // at a directory that does not exist makes writeFileSync fail for real
    // rather than through a mock.
    initSettings(join(tempDir, 'never-created'))
    cwdSpy.mockReturnValue(tempDir)

    await expect(seedDemoCaseIfNeeded()).resolves.toEqual({
      seeded: false,
      reason: 'fixture-missing'
    })
    // The latch really did not persist — which is what makes the resolution
    // above evidence that the write threw and was swallowed.
    expect(getSettings().demoCaseSeeded).toBe(false)
  })
})

describe('demo case deletion', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'bb-demo-delete-'))
    initStorage(join(tempDir, 'captures'))
    await initDatabase(':memory:')
    initSettings(tempDir)
  })

  afterEach(() => {
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('removes the row and the case directory for a demo case', () => {
    const c = createCase({ name: 'Demo' })
    setCaseDemo(c.id, true)
    const caseDir = ensureCaseDir(c.id)
    writeFileSync(join(caseDir, 'manifest.jsonl'), '{}\n')

    expect(deleteDemoCase(c.id)).toBe(true)
    expect(getCase(c.id)).toBeUndefined()
    // The whole point of the separate path: cases:delete leaves this behind.
    expect(existsSync(caseDir)).toBe(false)
  })

  it('refuses a case that is not a demo case, artifacts included', () => {
    const c = createCase({ name: 'Real evidence' })
    const caseDir = ensureCaseDir(c.id)

    expect(deleteDemoCase(c.id)).toBe(false)
    expect(getCase(c.id)).toBeDefined()
    expect(existsSync(caseDir)).toBe(true)
  })

  it('refuses an unknown case id', () => {
    expect(deleteDemoCase('no-such-case')).toBe(false)
  })

  it('still reports success when the case directory was never created', () => {
    const c = createCase({ name: 'Demo without files' })
    setCaseDemo(c.id, true)

    expect(deleteDemoCase(c.id)).toBe(true)
    expect(existsSync(join(getStorageRoot(), c.id))).toBe(false)
  })

  it('clears the flag again when asked', () => {
    const c = createCase({ name: 'Demo' })
    setCaseDemo(c.id, true)
    setCaseDemo(c.id, false)

    expect(getCase(c.id)?.isDemo).toBe(false)
    expect(deleteDemoCase(c.id)).toBe(false)
  })
})

describe('demo case import attribution', () => {
  it('names the fixture operator with a single fixed string on both sides', () => {
    expect(DEMO_CASE_OPERATOR_NAME).toBe('Birdbrain demo fixture')
  })
})
