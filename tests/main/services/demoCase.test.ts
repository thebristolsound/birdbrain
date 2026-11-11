import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
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
import {
  createCase,
  getCase,
  listAllCases,
  listCases,
  setCaseDemo,
  updateCase
} from '@main/services/db/caseRepo'
import { insertCapture, listCaptures } from '@main/services/db/captureRepo'
import { listExhibits } from '@main/services/db/exhibitRepo'
import { createNote } from '@main/services/db/noteRepo'
import { addTagToCapture, createTag, listTags } from '@main/services/db/tagRepo'
import { initStorage, ensureCaseDir, getStorageRoot } from '@main/services/storage'
import { initSettings, getSettings, updateSettings } from '@main/services/settings'
import { initInstallationId, resetInstallationId } from '@main/services/installationId'
import { initSigningKey, resetSigningKey } from '@main/services/signingKey'
import { runExhibitBackfill } from '@main/services/exhibitBackfill'
import {
  deleteDemoCase,
  getDemoCaseArchivePath,
  seedDemoCaseIfNeeded
} from '@main/services/demoCase'
import {
  PIPELINE_SELF_TEST_CASE_NAME,
  PIPELINE_SELF_TEST_URL,
  sweepPipelineSelfTestResidue
} from '@main/services/pipelineSelfTest'
import {
  DEMO_CASE_ARCHIVE_FILENAME,
  DEMO_CASE_OPERATOR_NAME,
  MANIFEST_FILENAME
} from '@shared/constants'

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
    Object.defineProperty(process, 'resourcesPath', {
      value: '/opt/app/resources',
      configurable: true
    })
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

  // The fixture was exported from another install, so its rows name that
  // install's case id (#1521, #1592). The seeded case must point at its own files.
  it('points every seeded capture and Exhibit at a file on disk', async () => {
    updateSettings({ isFreshInstall: true })

    const { caseId } = await seedDemoCaseIfNeeded()

    const captures = listCaptures(caseId!)
    const paths = [
      ...captures.flatMap((c) => [c.mhtmlPath, c.screenshotPath]),
      ...listExhibits(caseId!).map((e) => e.path)
    ]
    expect(captures).toHaveLength(3)
    expect(paths.every((path) => path?.startsWith(`${caseId}/`))).toBe(true)
    expect(paths.filter((path) => !existsSync(join(getStorageRoot(), path!)))).toEqual([])
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

  // The chain a fresh install writes (X47, #1332): the seed, then the startup backfill with no
  // name configured, leave no entry that names nobody.
  it('leaves no entry with an empty operator name when the backfill follows the seed', async () => {
    updateSettings({ isFreshInstall: true, operatorName: '' })
    const { caseId } = await seedDemoCaseIfNeeded()

    const [result] = await runExhibitBackfill({ toolVersion: '1.0.0-test' })

    const names = readFileSync(join(getStorageRoot(), caseId!, MANIFEST_FILENAME), 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map((line) => (JSON.parse(line) as { operatorName?: unknown }).operatorName)
    expect(names.length).toBeGreaterThan(0)
    expect(names.filter((name) => typeof name !== 'string' || name.trim() === '')).toEqual([])
    expect(result.skipped).toBe('operator_name_required')
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
    // The bound, since the title reads absolute: the guard is a probe, so it
    // holds only while a demo case is present. Delete the one seeded here on
    // such an install and the next launch seeds another, because this store
    // holds no other Case (#1301, #1333); a later test pins both halves.
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

  // #1333: settings.json and the database are separate files, so losing the
  // first marks an install fresh while the second still holds its evidence.
  describe('after the settings file is lost', () => {
    const loseSettings = (): void => {
      const lostDir = join(tempDir, 'lost-settings')
      mkdirSync(lostDir)
      initSettings(lostDir)
      expect(getSettings().isFreshInstall).toBe(true)
    }

    // What a self-test killed after ingest leaves in the database.
    const leaveSandbox = (): string => {
      const sandbox = createCase({ name: PIPELINE_SELF_TEST_CASE_NAME })
      insertCapture({
        caseId: sandbox.id,
        url: PIPELINE_SELF_TEST_URL,
        title: 'Self-test',
        hash: 'h-sandbox',
        timestamp: '2026-01-16T09:31:47.000Z',
        format: 'mhtml'
      })
      return sandbox.id
    }

    const expectSandboxCounted = async (sandboxId: string): Promise<void> => {
      expect(await seedDemoCaseIfNeeded()).toEqual({ seeded: false, reason: 'cases-present' })
      expect(listAllCases().map((c) => c.id)).toEqual([sandboxId])
    }

    it('seeds nothing into a store that already holds a Case', async () => {
      const own = createCase({ name: 'Real evidence' })
      loseSettings()

      const result = await seedDemoCaseIfNeeded()

      expect(result).toEqual({ seeded: false, reason: 'cases-present' })
      expect(listAllCases().map((c) => c.id)).toEqual([own.id])
      expect(getSettings().demoCaseSeeded).toBe(true)
    })

    it('counts an archived Case', async () => {
      const own = createCase({ name: 'Closed matter' })
      updateCase({ id: own.id, archived: true })
      loseSettings()

      expect(await seedDemoCaseIfNeeded()).toEqual({ seeded: false, reason: 'cases-present' })
    })

    it('still seeds a store that holds no Case at all', async () => {
      loseSettings()

      const result = await seedDemoCaseIfNeeded()

      expect(result.seeded).toBe(true)
      expect(listAllCases().map((c) => c.id)).toEqual([result.caseId])
    })

    const expectSeededBeside = async (sandboxId: string): Promise<void> => {
      const result = await seedDemoCaseIfNeeded()
      expect(result.seeded).toBe(true)
      expect(
        listAllCases()
          .map((c) => c.id)
          .sort()
      ).toEqual([sandboxId, result.caseId].sort())
    }

    it('does not count a self-test sandbox Case left behind', async () => {
      const sandboxId = leaveSandbox()
      loseSettings()

      await expectSeededBeside(sandboxId)
    })

    // The boot sweep deletes a leftover only on a storage root confirmed since
    // before the Case was made (pipelineSelfTest.ts), and a launch with no
    // record of the root confirms nothing. The seed asks only what the Case
    // holds, so a leftover the sweep kept still does not count.
    it('does not count a leftover the boot sweep kept on an unconfirmed storage root', async () => {
      const sandboxId = leaveSandbox()
      loseSettings()
      sweepPipelineSelfTestResidue(tempDir)
      expect(getCase(sandboxId)?.name).toBe(PIPELINE_SELF_TEST_CASE_NAME)

      await expectSeededBeside(sandboxId)
    })

    // The residue check refuses each of these (pipelineSelfTest.ts), so the
    // Case is one the operator wrote into, whatever it is named.
    it.each<[string, (caseId: string) => void]>([
      ['whose row was edited', (id) => updateCase({ id, description: 'Subject of the inquiry' })],
      ['holding a note', (id) => createNote({ caseId: id, body: 'Operator note' })]
    ])('counts a sandbox-named Case %s', async (_label, write) => {
      const sandboxId = leaveSandbox()
      write(sandboxId)
      loseSettings()

      await expectSandboxCounted(sandboxId)
    })

    // The residue check answers "not residue" when it cannot list the storage
    // root, since the Case having no folder there is then not known.
    it('counts a sandbox Case left behind when the storage root cannot be listed', async () => {
      const sandboxId = leaveSandbox()
      loseSettings()
      rmSync(getStorageRoot(), { recursive: true })

      await expectSandboxCounted(sandboxId)
    })

    it('counts a sandbox-named Case holding a capture the self-test did not write', async () => {
      const sandbox = createCase({ name: PIPELINE_SELF_TEST_CASE_NAME })
      insertCapture({
        caseId: sandbox.id,
        url: 'https://nightjar-exchange.invalid/custody',
        title: 'Custody',
        hash: 'h-foreign',
        timestamp: '2026-01-16T09:31:47.000Z',
        format: 'mhtml'
      })
      loseSettings()

      expect(await seedDemoCaseIfNeeded()).toEqual({ seeded: false, reason: 'cases-present' })
    })

    it('counts an archived self-test sandbox Case, which the boot sweep leaves alone', async () => {
      const sandbox = createCase({ name: PIPELINE_SELF_TEST_CASE_NAME })
      updateCase({ id: sandbox.id, archived: true })
      loseSettings()

      expect(await seedDemoCaseIfNeeded()).toEqual({ seeded: false, reason: 'cases-present' })
    })
  })

  it('brings a deleted demo case back with the latch lost only into an otherwise empty store', async () => {
    // The bound stated on `seedDemoCaseIfNeeded`: the database guards are
    // probes, so with a settings write that keeps failing a deleted demo case
    // returns, unless any other Case is there (#1301, #1333).
    initSettings(join(tempDir, 'never-created'))

    const first = await seedDemoCaseIfNeeded()
    expect(deleteDemoCase(first.caseId!)).toBe(true)
    const second = await seedDemoCaseIfNeeded()
    expect(second.seeded).toBe(true)

    createCase({ name: 'Real evidence' })
    expect(deleteDemoCase(second.caseId!)).toBe(true)
    expect(await seedDemoCaseIfNeeded()).toEqual({ seeded: false, reason: 'cases-present' })
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
