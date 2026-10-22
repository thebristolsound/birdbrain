import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { basename, dirname, join } from 'path'
import { tmpdir } from 'os'
import { Readable } from 'stream'
import { closeDatabase, initDatabase } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { listExhibits } from '@main/services/db/exhibitRepo'
import { insertDerivedFile } from '@main/services/db/derivedFileRepo'
import { ensureCaseDir, initStorage } from '@main/services/storage'
import { initManifest } from '@main/services/manifest'
import { createCaptureLifecycle } from '@main/services/captureLifecycle'
import { exportCaseArchive, importCaseArchive } from '@main/services/caseArchive'
import { backfillCase, THUMBNAIL_DERIVATION } from '@main/services/exhibitBackfill'
import { verifyCaseDerivedFiles } from '@main/services/exhibits'
import { initInstallationId, resetInstallationId } from '@main/services/installationId'
import { initSettings, updateSettings } from '@main/services/settings'
import { IMPORT_ID_MAP_FILENAME } from '@shared/constants'
import type { SelectorLifecycle } from '@main/services/selectorLifecycle'
import { signDerivedFile } from '../../helpers/archiveDerivedFiles'

// The startup backfill runs before the window opens, on every Case, on every
// launch. On a renamed import each Capture row's signed id is resolved through
// the import's anchored id map, and reading that map once per row made a
// launch cost grow with the square of the renamed rows (#1814 review).

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>()
  return { ...actual, default: actual, readFileSync: vi.fn(actual.readFileSync) }
})

vi.mock('@main/services/tlsCertChain', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/services/tlsCertChain')>()
  return { ...actual, fetchCertChain: vi.fn(async () => null) }
})

const TOOL_VERSION = '9.9.9-test'
const CAPTURES = 300

function idMapReads(): number {
  return vi
    .mocked(readFileSync)
    .mock.calls.filter(
      ([path]) => typeof path === 'string' && basename(path) === IMPORT_ID_MAP_FILENAME
    ).length
}

// Reads of the id maps an import received with its archive (#1017).
function carriedMapReads(): number {
  return vi
    .mocked(readFileSync)
    .mock.calls.filter(
      ([path]) => typeof path === 'string' && basename(dirname(path)) === 'import-id-maps'
    ).length
}

describe('the backfill on a renamed import of many Captures', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-backfill-idmap-'))
    initStorage(join(tempDir, 'captures'))
    await initDatabase(':memory:')
    initSettings(tempDir)
    updateSettings({ operatorName: 'Test Operator' })
    resetInstallationId()
    initInstallationId(tempDir)
  })

  afterEach(() => {
    closeDatabase()
    resetInstallationId()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('reads the id map at most once per run, and not for rows already recorded', async () => {
    const source = createCase({ name: 'Many' }).id
    ensureCaseDir(source)
    initManifest(join(tempDir, 'captures', source))
    const lifecycle = createCaptureLifecycle({
      selectorLifecycle: { runActiveSelectorsForCapture: vi.fn() } as unknown as SelectorLifecycle
    })
    // No screenshots: no row can be given a thumbnail, so every launch visits
    // every row, which is the most a launch can cost.
    for (let n = 0; n < CAPTURES; n++) {
      const body = `capture ${n}`
      await lifecycle.ingest({
        caseId: source,
        url: `https://example.com/${n}`,
        title: `Capture ${n}`,
        timestamp: '2026-04-05T12:00:00.000Z',
        stream: Readable.from([Buffer.from(body)]) as unknown as ReadableStream<Uint8Array>,
        textContent: body,
        headers: {},
        browserVersion: 'Chrome/120',
        userAgent: 'Mozilla/5.0',
        httpStatus: 200,
        operatorId: 'op-1',
        operatorName: 'Test Operator',
        toolVersion: TOOL_VERSION
      })
    }
    const archive = join(tempDir, 'many.birdbrain')
    await exportCaseArchive(source, archive)
    const { newCaseId } = await importCaseArchive(archive)
    const rows = listExhibits(newCaseId).filter((exhibit) => exhibit.kind === 'capture')
    expect(rows).toHaveLength(CAPTURES)
    expect(rows.every(({ id }) => !listExhibits(source).some((own) => own.id === id))).toBe(true)

    vi.mocked(readFileSync).mockClear()
    await backfillCase(newCaseId, { toolVersion: TOOL_VERSION })
    expect(idMapReads()).toBe(1)

    for (const { id } of rows) {
      insertDerivedFile({
        exhibitId: id,
        derivation: THUMBNAIL_DERIVATION,
        toolVersion: TOOL_VERSION,
        contentHash: 'recorded',
        path: `${newCaseId}/${id}_thumb.jpg`,
        createdAt: '2026-04-06T12:00:00.000Z'
      })
    }
    vi.mocked(readFileSync).mockClear()
    await backfillCase(newCaseId, { toolVersion: TOOL_VERSION })
    expect(idMapReads()).toBe(0)
  })

  it('reads the own map and each carried map once per backfill of a Case imported twice', async () => {
    const source = createCase({ name: 'Twice' }).id
    ensureCaseDir(source)
    initManifest(join(tempDir, 'captures', source))
    const lifecycle = createCaptureLifecycle({
      selectorLifecycle: { runActiveSelectorsForCapture: vi.fn() } as unknown as SelectorLifecycle
    })
    for (let n = 0; n < 30; n++) {
      const body = `twice ${n}`
      await lifecycle.ingest({
        caseId: source,
        url: `https://example.com/${n}`,
        title: `Capture ${n}`,
        timestamp: '2026-04-05T12:00:00.000Z',
        stream: Readable.from([Buffer.from(body)]) as unknown as ReadableStream<Uint8Array>,
        textContent: body,
        headers: {},
        browserVersion: 'Chrome/120',
        userAgent: 'Mozilla/5.0',
        httpStatus: 200,
        operatorId: 'op-1',
        operatorName: 'Test Operator',
        toolVersion: TOOL_VERSION
      })
    }
    // Both imports on this installation, so both rename every row.
    const once = join(tempDir, 'once.birdbrain')
    await exportCaseArchive(source, once)
    const { newCaseId: renamedCaseId } = await importCaseArchive(once)
    const twice = join(tempDir, 'twice.birdbrain')
    await exportCaseArchive(renamedCaseId, twice)
    const { newCaseId } = await importCaseArchive(twice)

    vi.mocked(readFileSync).mockClear()
    await backfillCase(newCaseId, { toolVersion: TOOL_VERSION })
    expect(idMapReads()).toBe(1)
    expect(carriedMapReads()).toBe(1)
  })

  // Each Exhibit's Derived Files are matched against every `derivation` entry
  // in the Case, so resolving the parent through the maps once per entry read
  // them, and the Case's rows, the square of the thumbnails times.
  it('reads the own map and each carried map once per Derived File pass of a Case imported twice', async () => {
    const source = createCase({ name: 'Thumbnails' }).id
    ensureCaseDir(source)
    initManifest(join(tempDir, 'captures', source))
    const lifecycle = createCaptureLifecycle({
      selectorLifecycle: { runActiveSelectorsForCapture: vi.fn() } as unknown as SelectorLifecycle
    })
    for (let n = 0; n < 12; n++) {
      const body = `thumbnailed ${n}`
      await lifecycle.ingest({
        caseId: source,
        url: `https://example.com/${n}`,
        title: `Capture ${n}`,
        timestamp: '2026-04-05T12:00:00.000Z',
        stream: Readable.from([Buffer.from(body)]) as unknown as ReadableStream<Uint8Array>,
        textContent: body,
        headers: {},
        browserVersion: 'Chrome/120',
        userAgent: 'Mozilla/5.0',
        httpStatus: 200,
        operatorId: 'op-1',
        operatorName: 'Test Operator',
        toolVersion: TOOL_VERSION
      })
    }
    for (const { id, contentHash } of listExhibits(source)) {
      signDerivedFile({
        caseId: source,
        parentExhibitId: id,
        parentContentHash: contentHash,
        bytes: Buffer.from(`thumbnail of ${id}`)
      })
    }
    const once = join(tempDir, 'once.birdbrain')
    await exportCaseArchive(source, once)
    const { newCaseId: renamedCaseId } = await importCaseArchive(once)
    const twice = join(tempDir, 'twice.birdbrain')
    await exportCaseArchive(renamedCaseId, twice)
    const { newCaseId } = await importCaseArchive(twice)

    vi.mocked(readFileSync).mockClear()
    const verified = await verifyCaseDerivedFiles(newCaseId)

    expect([...verified.values()].flat().map(({ status }) => status)).toEqual(
      Array(12).fill('verified')
    )
    expect(idMapReads()).toBe(1)
    expect(carriedMapReads()).toBe(1)
  })
})
