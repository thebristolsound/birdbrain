import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { Readable } from 'stream'
import { closeDatabase, getDb, initDatabase } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { insertCapture, listCaptures } from '@main/services/db/captureRepo'
import { insertExtractedData } from '@main/services/db/extractedDataRepo'
import { createNote } from '@main/services/db/noteRepo'
import { getStagingFile, listStagingFiles } from '@main/services/db/stagingRepo'
import { listExhibits } from '@main/services/db/exhibitRepo'
import { ensureCaseDir, initStorage } from '@main/services/storage'
import { initManifest } from '@main/services/manifest'
import { createCaptureLifecycle, type CaptureLifecycle } from '@main/services/captureLifecycle'
import { commitStagedFiles, uploadToStaging } from '@main/services/staging'
import { exportCaseArchive, importCaseArchive } from '@main/services/caseArchive'
import { initInstallationId, resetInstallationId } from '@main/services/installationId'
import { initSettings, updateSettings } from '@main/services/settings'
import { MANIFEST_FILENAME } from '@shared/constants'
import type { SelectorLifecycle } from '@main/services/selectorLifecycle'

// The revision triggers inside the custody paths (engine plan, Evidence impact):
// a Capture delete, a reprocess and a Case Archive import move the counter and
// still complete, and a trigger that fails rolls back the ingest or the Staging
// Pool commit it ran in, as any failed row write there does.
vi.mock('@main/services/tlsCertChain', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/services/tlsCertChain')>()
  return { ...actual, fetchCertChain: vi.fn(async () => null) }
})

const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n')

let tempDir: string
let storageRoot: string
let caseId: string
let caseDir: string
let lifecycle: CaptureLifecycle

function revision(id: string): { generation: string; counter: number } {
  return getDb()
    .prepare('SELECT generation, counter FROM case_revisions WHERE case_id = ?')
    .get(id) as { generation: string; counter: number }
}

function logAfter(id: string, counter: number): Array<{ kind: string; target_id: string }> {
  return getDb()
    .prepare(
      `SELECT kind, target_id FROM case_change_log
        WHERE case_id = ? AND counter > ? ORDER BY counter`
    )
    .all(id, counter) as Array<{ kind: string; target_id: string }>
}

function manifest(): string {
  const path = join(caseDir, MANIFEST_FILENAME)
  return existsSync(path) ? readFileSync(path, 'utf-8') : ''
}

async function ingest(body: string): Promise<string> {
  const { capture } = await lifecycle.ingest({
    caseId,
    url: 'https://harrow.example.net/',
    title: 'Harrow',
    timestamp: '2026-10-16T00:00:00.000Z',
    stream: Readable.from([Buffer.from(body)]) as unknown as ReadableStream<Uint8Array>,
    textContent: body,
    headers: {},
    browserVersion: 'Chrome/120',
    userAgent: 'Mozilla/5.0',
    httpStatus: 200,
    operatorId: 'op-1',
    operatorName: 'Test Operator',
    toolVersion: '0.1.0'
  })
  // Extraction and the field build run on the next turn of the event loop.
  await new Promise<void>((resolve) => setImmediate(resolve))
  return capture.id
}

beforeEach(async () => {
  tempDir = mkdtempSync(join(tmpdir(), 'bb-revision-lifecycle-'))
  storageRoot = join(tempDir, 'captures')
  initStorage(storageRoot)
  await initDatabase(':memory:')
  initSettings(tempDir)
  updateSettings({ operatorName: 'Test Operator' })
  resetInstallationId()
  initInstallationId(tempDir)
  caseId = createCase({ name: 'Custody' }).id
  ensureCaseDir(caseId)
  caseDir = join(storageRoot, caseId)
  initManifest(caseDir)
  lifecycle = createCaptureLifecycle({
    selectorLifecycle: { runActiveSelectorsForCapture: vi.fn() } as unknown as SelectorLifecycle
  })
})

afterEach(() => {
  closeDatabase()
  resetInstallationId()
  rmSync(tempDir, { recursive: true, force: true })
})

describe('the revision triggers in the custody paths', () => {
  it('deletes an MHTML Capture with Notes and Extracted Data under one deletion entry', async () => {
    const captureId = await ingest('capture body')
    createNote({ caseId, captureId, title: 'N', body: 'text' })
    insertExtractedData(captureId, caseId, 'https://harrow.example.net/', [
      { category: 'contact', subcategory: 'email', value: 'calloway@harrow.example.net' }
    ])
    const mark = revision(caseId).counter
    const deletions = () =>
      manifest()
        .split('\n')
        .filter((line) => line.includes('"type":"deletion"')).length

    const result = await lifecycle.deleteMany(caseId, [captureId])

    expect(result.outcomes).toEqual([{ captureId, status: 'deleted' }])
    expect(deletions()).toBe(1)
    expect(listCaptures(caseId)).toHaveLength(0)
    const kinds = logAfter(caseId, mark).map(({ kind }) => kind)
    expect(kinds).toEqual(expect.arrayContaining(['exhibit', 'extracted-datum', 'note']))
    expect(revision(caseId).counter - mark).toBe(kinds.length)
  })

  it('logs a reprocess as the Extracted Data and build rows it deletes and writes', async () => {
    const capture = insertCapture({
      caseId,
      url: 'https://harrow.example.net/',
      title: 'Harrow',
      hash: 'h1',
      timestamp: '2026-10-16T00:00:00.000Z'
    })
    mkdirSync(caseDir, { recursive: true })
    writeFileSync(
      join(caseDir, `${capture.id}.html`),
      '<html><body><a href="mailto:calloway@harrow.example.net">Write</a></body></html>'
    )
    insertExtractedData(capture.id, caseId, 'https://harrow.example.net/', [
      { category: 'contact', subcategory: 'email', value: 'stale@harrow.example.net' },
      { category: 'contact', subcategory: 'email', value: 'older@harrow.example.net' }
    ])
    getDb()
      .prepare(
        `INSERT INTO exhibit_search_builds
           (exhibit_id, case_id, content_hash, extractor, built_at, outcome)
         VALUES (?, ?, 'h1', 'fields/1', '2026-10-16T00:00:00.000Z', 'built')`
      )
      .run(capture.id, caseId)
    const count = (table: string, column: string) =>
      (
        getDb()
          .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`)
          .get(capture.id) as {
          n: number
        }
      ).n
    const before = { data: count('extracted_data', 'capture_id'), builds: 1 }
    const mark = revision(caseId).counter

    await lifecycle.reprocessCase(caseId)

    const after = {
      data: count('extracted_data', 'capture_id'),
      builds: count('exhibit_search_builds', 'exhibit_id')
    }
    expect(after.data).toBeGreaterThan(0)
    expect(revision(caseId).counter - mark).toBe(
      before.data + after.data + before.builds + after.builds
    )
    for (const row of logAfter(caseId, mark)) {
      expect(['extracted-datum', 'search-build']).toContain(row.kind)
      expect(row.target_id).toBe(capture.id)
    }
  })

  it('gives an imported Case its own generation and logs only what the import wrote', async () => {
    const captureId = await ingest('capture body')
    createNote({ caseId, captureId, title: 'N', body: 'text' })
    const source = revision(caseId)
    const archive = join(tempDir, 'custody.birdbrain')
    await exportCaseArchive(caseId, archive)

    const { newCaseId } = await importCaseArchive(archive)

    expect(revision(caseId)).toEqual(source)
    const imported = revision(newCaseId)
    expect(imported.generation).not.toBe(source.generation)
    const logged = logAfter(newCaseId, 0)
    expect(imported.counter).toBe(logged.length)
    expect(logged.map(({ kind }) => kind)).toEqual(expect.arrayContaining(['exhibit', 'note']))
  })

  describe('with a change log that refuses every row', () => {
    beforeEach(() => {
      getDb().exec(`
        CREATE TRIGGER test_refuse_change_log BEFORE INSERT ON case_change_log BEGIN
          SELECT RAISE(ABORT, 'change log refused');
        END;
      `)
    })

    it('rolls an ingest back: no capture entry, no row', async () => {
      const before = manifest()

      await expect(ingest('capture body')).rejects.toThrow(/change log refused/)

      expect(manifest()).toBe(before)
      for (const table of ['captures', 'exhibits', 'capture_texts']) {
        const { n } = getDb().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }
        expect(n, table).toBe(0)
      }
    })

    it('fails a Staging Pool commit and returns the file to the pool', async () => {
      const uploads = join(tempDir, 'uploads')
      mkdirSync(uploads)
      writeFileSync(join(uploads, 'report.pdf'), PDF)
      // The upload writes no input row, so it lands before the refusal matters.
      const [staged] = await uploadToStaging(caseId, [join(uploads, 'report.pdf')])
      const before = manifest()

      const result = await commitStagedFiles(caseId, [staged.id])

      expect(result.outcomes[0]).toMatchObject({ stagingId: staged.id, status: 'failed' })
      expect(manifest()).toBe(before)
      expect(getStagingFile(staged.id)).toBeDefined()
      expect(listStagingFiles(caseId)).toHaveLength(1)
      expect(existsSync(join(storageRoot, staged.path))).toBe(true)
      expect(listExhibits(caseId)).toHaveLength(0)
    })
  })
})
