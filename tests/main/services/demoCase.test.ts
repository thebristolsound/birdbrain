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
import { createCase, getCase, listCases, setCaseDemo, updateCase } from '@main/services/db/caseRepo'
import { insertCapture } from '@main/services/db/captureRepo'
import { addTagToCapture, createTag, listTags } from '@main/services/db/tagRepo'
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

  it('leaves no tag behind when the seeded case is deleted again', async () => {
    updateSettings({ isFreshInstall: true })
    const { caseId } = await seedDemoCaseIfNeeded()
    // The fixture's own tag, which the import puts in the global tags table.
    expect(listTags().map((t) => t.name)).toContain('nightjar')

    expect(deleteDemoCase(caseId!)).toBe(true)

    expect(listTags()).toEqual([])
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

  it('never imports a second demo case, however many launches lose the latch', async () => {
    // The #1301 trace: `latchSeeded` swallows a failing settings write and
    // `isFreshInstall` is never cleared, so before the database guard existed
    // every launch imported another full copy. Settings point at a directory
    // that does not exist, so the write throws for real rather than by a mock.
    initSettings(join(tempDir, 'never-created'))

    const first = await seedDemoCaseIfNeeded()
    const second = await seedDemoCaseIfNeeded()
    const third = await seedDemoCaseIfNeeded()

    expect(first.seeded).toBe(true)
    expect(getSettings().demoCaseSeeded).toBe(false)
    expect(second).toEqual({ seeded: false, reason: 'demo-case-present' })
    expect(third).toEqual({ seeded: false, reason: 'demo-case-present' })
    expect(listCases().filter((c) => c.isDemo)).toHaveLength(1)
  })

  it('counts an archived demo case, which listCases would not return', async () => {
    const c = createCase({ name: 'Demo' })
    setCaseDemo(c.id, true)
    updateCase({ id: c.id, archived: true })
    updateSettings({ isFreshInstall: true })

    expect(await seedDemoCaseIfNeeded()).toEqual({ seeded: false, reason: 'demo-case-present' })
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

  // A capture row is what a tag can hang off: `exhibit_tags` keys on the
  // Exhibit row `insertCapture` writes alongside it.
  const seedCapture = (caseId: string): string =>
    insertCapture({
      caseId,
      url: 'https://nightjar-exchange.invalid/custody',
      title: 'Custody',
      hash: `h-${caseId}`,
      timestamp: '2026-01-16T09:31:47.000Z',
      format: 'mhtml'
    }).id

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

  it('takes the demo tags with it', () => {
    const demo = createCase({ name: 'Demo' })
    setCaseDemo(demo.id, true)
    const tag = createTag({ name: 'nightjar', color: '#c2410c' })
    addTagToCapture({ captureId: seedCapture(demo.id), tagId: tag.id })

    expect(deleteDemoCase(demo.id)).toBe(true)

    // Tags are global, so the cascade alone would leave this in every picker
    // for the life of the install.
    expect(listTags().some((t) => t.id === tag.id)).toBe(false)
  })

  it('keeps a tag the operator has put on their own evidence', () => {
    const demo = createCase({ name: 'Demo' })
    setCaseDemo(demo.id, true)
    const own = createCase({ name: 'Real evidence' })
    const tag = createTag({ name: 'nightjar', color: '#c2410c' })
    addTagToCapture({ captureId: seedCapture(demo.id), tagId: tag.id })
    // The archive import merges tags by name, so the demo's tag and the
    // operator's can be the same row.
    addTagToCapture({ captureId: seedCapture(own.id), tagId: tag.id })

    expect(deleteDemoCase(demo.id)).toBe(true)

    expect(listTags().some((t) => t.id === tag.id)).toBe(true)
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
