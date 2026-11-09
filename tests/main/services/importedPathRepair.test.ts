import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createHash, randomUUID } from 'crypto'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { ensureCaseDir, initStorage } from '@main/services/storage'
import { closeDatabase, getDb, initDatabase } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { getExhibit, insertExhibit, listExhibits } from '@main/services/db/exhibitRepo'
import { getStagingFile, insertStagingFile, listStagingFiles } from '@main/services/db/stagingRepo'
import { commitStagedFiles, uploadToStaging } from '@main/services/staging'
import {
  exportCaseArchive,
  importCaseArchive,
  inspectCaseArchive
} from '@main/services/caseArchive'
import { initManifest } from '@main/services/manifest'
import { initInstallationId, resetInstallationId } from '@main/services/installationId'
import { initSettings, updateSettings } from '@main/services/settings'
import { readStoredZip } from '@main/services/zipRead'
import { logger } from '@main/services/logger'
import { ident } from '@main/services/logSafe'
import { runImportedPathRepair } from '@main/services/importedPathRepair'
import { MANIFEST_FILENAME } from '@shared/constants'

// #1610: before #1609 an archive import stored a non-Capture Exhibit's or a
// pooled file's path as the bare Case id, while still writing the file under
// the kind's subdirectory as `<row id><ext>`. The startup pass points such a
// row at that file when exactly one file carries its id, and does nothing else.

const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n')
const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('zip payload')])

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

// Every directory and file under `dir`, each file with the hash of its bytes.
function tree(dir: string, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {}
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix + entry.name
    if (entry.isDirectory()) {
      out[rel + '/'] = 'dir'
      Object.assign(out, tree(join(dir, entry.name), rel + '/'))
    } else {
      out[rel] = sha256(readFileSync(join(dir, entry.name)))
    }
  }
  return out
}

function allRows(): unknown[] {
  return [
    ...getDb().prepare('SELECT * FROM exhibits ORDER BY id').all(),
    ...getDb().prepare('SELECT * FROM staging_files ORDER BY id').all()
  ]
}

describe('imported path repair (#1610)', () => {
  let tempDir: string
  let storageRoot: string
  let caseId: string
  let caseDir: string

  function file(rel: string, bytes: Buffer = ZIP): void {
    const abs = join(caseDir, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, bytes)
  }

  function exhibit(kind: string, path: string | null, id = randomUUID()): string {
    insertExhibit({
      id,
      caseId,
      kind,
      origin: 'manual-upload',
      name: 'bundle.zip',
      contentHash: sha256(ZIP),
      path,
      committedAt: '2026-09-01T10:00:00.000Z'
    })
    return id
  }

  function pooled(path: string, id = randomUUID()): string {
    insertStagingFile({
      id,
      caseId,
      kind: 'document',
      origin: 'manual-upload',
      name: 'report.pdf',
      contentHash: sha256(PDF),
      path,
      sizeBytes: PDF.length,
      arrivedAt: '2026-09-01T10:00:00.000Z'
    })
    return id
  }

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-path-repair-'))
    storageRoot = join(tempDir, 'captures')
    initStorage(storageRoot)
    await initDatabase(':memory:')
    initSettings(tempDir)
    updateSettings({ operatorName: 'Test Operator' })
    resetInstallationId()
    initInstallationId(tempDir)
    caseId = createCase({ name: 'Imported' }).id
    caseDir = ensureCaseDir(caseId)
    initManifest(caseDir)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    closeDatabase()
    resetInstallationId()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('points an attachment row at its one file, keeping its hash', () => {
    const id = exhibit('attachment', caseId)
    file(`attachments/${id}.zip`)

    expect(runImportedPathRepair()).toEqual({ repaired: 1, unrepaired: 0 })

    expect(getExhibit(id)).toMatchObject({
      path: `${caseId}/attachments/${id}.zip`,
      contentHash: sha256(ZIP)
    })
    // One change-log row for the insert, and one from the repair's update.
    expect(
      getDb()
        .prepare('SELECT COUNT(*) AS n FROM case_change_log WHERE kind = ? AND target_id = ?')
        .get('exhibit', id)
    ).toEqual({ n: 2 })
  })

  it('points a pooled row at its one file, keeping its hash', () => {
    const id = pooled(caseId)
    file(`staging/${id}.pdf`, PDF)

    expect(runImportedPathRepair()).toEqual({ repaired: 1, unrepaired: 0 })

    expect(getStagingFile(id)).toMatchObject({
      path: `${caseId}/staging/${id}.pdf`,
      contentHash: sha256(PDF)
    })
  })

  it('accepts a file with no extension, and looks flat for a kind with no subdirectory', () => {
    const bare = exhibit('image', caseId)
    file(`images/${bare}`)
    const flat = exhibit('recording', caseId)
    file(`${flat}.webm`)

    expect(runImportedPathRepair()).toEqual({ repaired: 2, unrepaired: 0 })

    expect(getExhibit(bare)!.path).toBe(`${caseId}/images/${bare}`)
    expect(getExhibit(flat)!.path).toBe(`${caseId}/${flat}.webm`)
  })

  it('leaves and logs rows with no matching file or with two, naming no path', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => 'log-id')
    const none = exhibit('attachment', caseId)
    // A name that starts with the id but carries no extension separator is not its file.
    file(`attachments/${none}-copy.zip`)
    const two = exhibit('document', caseId)
    file(`documents/${two}.pdf`, PDF)
    file(`documents/${two}.txt`)
    const lost = pooled(caseId)
    // A directory carrying the id is not a file either.
    mkdirSync(join(caseDir, 'staging', `${lost}.pdf`), { recursive: true })
    const before = allRows()

    expect(runImportedPathRepair()).toEqual({ repaired: 0, unrepaired: 3 })

    expect(allRows()).toEqual(before)
    expect(warn).toHaveBeenCalledTimes(3)
    expect(warn.mock.calls).toEqual(
      expect.arrayContaining([
        ['exhibits', 'exhibits.path_unrepaired', { exhibitId: ident(none), count: 0 }, undefined],
        ['exhibits', 'exhibits.path_unrepaired', { exhibitId: ident(two), count: 2 }, undefined],
        ['staging', 'staging.path_unrepaired', { stagingId: ident(lost), count: 0 }, undefined]
      ])
    )
    const logged = JSON.stringify(warn.mock.calls)
    expect(logged).not.toContain(storageRoot)
    expect(logged).not.toContain(caseId)
  })

  it('leaves and logs a row whose directory cannot be listed, and goes on', () => {
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => 'log-id')
    const unreadable = exhibit('attachment', caseId)
    // A file where the directory should be makes the listing throw.
    writeFileSync(join(caseDir, 'attachments'), 'not a directory')
    const fine = pooled(caseId)
    file(`staging/${fine}.pdf`, PDF)

    expect(runImportedPathRepair()).toEqual({ repaired: 1, unrepaired: 1 })

    expect(getExhibit(unreadable)!.path).toBe(caseId)
    expect(getStagingFile(fine)!.path).toBe(`${caseId}/staging/${fine}.pdf`)
    expect(warn).toHaveBeenCalledWith(
      'exhibits',
      'exhibits.path_unrepaired',
      { exhibitId: ident(unreadable) },
      expect.objectContaining({ code: 'ENOTDIR' })
    )
  })

  it('never touches a row whose path names a file, a Capture row included', () => {
    const named = exhibit('attachment', `${caseId}/attachments/old.zip`)
    file(`attachments/${named}.zip`)
    const windows = pooled(`${caseId}\\staging\\old.pdf`)
    file(`staging/${windows}.pdf`, PDF)
    // A Capture is out of scope even in the shape the pass looks for.
    const capture = exhibit('capture', caseId)
    file(`${capture}.mhtml`)
    const missing = exhibit('attachment', null)
    file(`attachments/${missing}.zip`)
    const before = allRows()

    expect(runImportedPathRepair()).toEqual({ repaired: 0, unrepaired: 0 })

    expect(allRows()).toEqual(before)
  })

  it('creates, changes and removes no file, and a second run changes nothing', () => {
    const attachment = exhibit('attachment', caseId)
    file(`attachments/${attachment}.zip`)
    const staged = pooled(caseId)
    file(`staging/${staged}.pdf`, PDF)
    const skipped = exhibit('document', caseId)
    vi.spyOn(logger, 'warn').mockImplementation(() => 'log-id')
    const files = tree(storageRoot)

    expect(runImportedPathRepair()).toEqual({ repaired: 2, unrepaired: 1 })
    const once = allRows()
    expect(runImportedPathRepair()).toEqual({ repaired: 0, unrepaired: 1 })

    expect(allRows()).toEqual(once)
    expect(getExhibit(skipped)!.path).toBe(caseId)
    expect(tree(storageRoot)).toEqual(files)
  })

  it('writes nothing to a database with no affected rows', () => {
    const native = exhibit('attachment', null)
    file(`attachments/${native}.zip`)
    getDb()
      .prepare('UPDATE exhibits SET path = ? WHERE id = ?')
      .run(`${caseId}/attachments/${native}.zip`, native)
    pooled(`${caseId}/staging/x.pdf`)
    const changes = (): number =>
      (getDb().prepare('SELECT total_changes() AS n').get() as { n: number }).n
    const before = changes()

    expect(runImportedPathRepair()).toEqual({ repaired: 0, unrepaired: 0 })

    expect(changes()).toBe(before)
  })

  it('lets an imported Case export again and its pooled file commit', async () => {
    const [attachmentUpload, pdfUpload] = await uploadToStaging(caseId, [
      writeSource('bundle.zip', ZIP),
      writeSource('report.pdf', PDF)
    ])
    await commitStagedFiles(caseId, [attachmentUpload.id])
    const source = join(tempDir, 'source.birdbrain')
    await exportCaseArchive(caseId, source)
    const { newCaseId } = await importCaseArchive(source)
    const attachment = listExhibits(newCaseId).find((e) => e.kind === 'attachment')!
    const [pool] = listStagingFiles(newCaseId)
    expect(pool.id).not.toBe(pdfUpload.id)
    // The rows as the import before #1609 left them.
    getDb().prepare('UPDATE exhibits SET path = case_id WHERE id = ?').run(attachment.id)
    getDb().prepare('UPDATE staging_files SET path = case_id WHERE id = ?').run(pool.id)
    const newCaseDir = join(storageRoot, newCaseId)
    const manifest = readFileSync(join(newCaseDir, MANIFEST_FILENAME))
    const broken = join(tempDir, 'broken.birdbrain')
    await expect(exportCaseArchive(newCaseId, broken)).rejects.toThrow()

    expect(runImportedPathRepair()).toEqual({ repaired: 2, unrepaired: 0 })

    expect(getExhibit(attachment.id)).toMatchObject({
      path: `${newCaseId}/attachments/${attachment.id}.zip`,
      contentHash: attachment.contentHash
    })
    expect(getStagingFile(pool.id)!.path).toBe(`${newCaseId}/staging/${pool.id}.pdf`)
    expect(readFileSync(join(newCaseDir, MANIFEST_FILENAME))).toEqual(manifest)
    const repaired = join(tempDir, 'repaired.birdbrain')
    await exportCaseArchive(newCaseId, repaired)
    const zip = readStoredZip(readFileSync(repaired))
    expect(zip.get(`files/exhibits/${attachment.id}.zip`)).toEqual(ZIP)
    expect(zip.get(`files/staging/${pool.id}.pdf`)).toEqual(PDF)
    expect(inspectCaseArchive(repaired).verification.overallValid).toBe(true)
    const committed = await commitStagedFiles(newCaseId, [pool.id])
    expect(committed.outcomes).toEqual([expect.objectContaining({ status: 'committed' })])
  })

  function writeSource(name: string, bytes: Buffer): string {
    const dir = join(tempDir, 'uploads')
    mkdirSync(dir, { recursive: true })
    const path = join(dir, name)
    writeFileSync(path, bytes)
    return path
  }
})
