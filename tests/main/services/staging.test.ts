import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createHash } from 'crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { Readable } from 'stream'
import { ensureCaseDir, initStorage } from '@main/services/storage'
import { closeDatabase, getDb, initDatabase } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { insertCapture, setCaptureTrustedTime } from '@main/services/db/captureRepo'
import { getExhibit, listExhibits } from '@main/services/db/exhibitRepo'
import { insertDerivedFile } from '@main/services/db/derivedFileRepo'
import { getStagingFile, listStagingFiles } from '@main/services/db/stagingRepo'
import {
  commitStagedFiles,
  detectExhibitKind,
  discardStagedFiles,
  uploadToStaging
} from '@main/services/staging'
import { verifyExhibit } from '@main/services/exhibits'
import { generateReport } from '@main/services/export'
import {
  exportCaseArchive,
  importCaseArchive,
  inspectCaseArchive
} from '@main/services/caseArchive'
import { createTimestampWorker } from '@main/services/timestampWorker'
import { createCaptureLifecycle } from '@main/services/captureLifecycle'
import {
  appendManifestEntry,
  initManifest,
  verifyManifestChain,
  withManifestEntry
} from '@main/services/manifest'
import { initInstallationId, resetInstallationId } from '@main/services/installationId'
import { initSettings, updateSettings } from '@main/services/settings'
import { createStoredZip } from '@main/services/zip'
import { readStoredZip } from '@main/services/zipRead'
import { IMPORT_ID_MAP_FILENAME, MANIFEST_FILENAME } from '@shared/constants'
import type { SelectorLifecycle } from '@main/services/selectorLifecycle'
import { buildSyntheticToken } from '../../helpers/timestampFixtures'

// Known-answer tests for the Staging Pool (#1148, ADR-0024). Frozen here:
//
//   1. UPLOAD writes a pooled row with an arrival hash and NOTHING to the
//      manifest; kind is detected from the bytes (X43).
//   2. COMMIT refuses changed bytes (X13), otherwise writes one `exhibit`
//      entry per file at schema 3 with a sequential Exhibit Number, and the
//      chain still verifies; the RFC 3161 request is handed off (X26).
//   3. DISCARD removes file and row and writes no entry (X29).
//   4. VERIFY reports verified, tampered and missing for a committed
//      attachment through `exhibits:verify`, and one outcome per Derived File
//      bound to its `derivation` entry (X37).
//   5. A `timestamp` entry over a committed attachment stamps schema 3 and a
//      Capture's still stamps 2 (#1180).
//   6. The Evidence Package is refused while a committed non-Capture Exhibit
//      exists (X44).
//   7. A `.birdbrain` archive round-trips pooled files as `staged` and
//      committed Exhibits with their numbers (X12, X30); an Exhibit whose id
//      was remapped on import still verifies through the anchored id map, and
//      an unanchored map fails closed.

vi.mock('@main/services/tlsCertChain', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/services/tlsCertChain')>()
  return { ...actual, fetchCertChain: vi.fn(async () => null) }
})

const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n')
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('not really an image but the magic is right')
])
const ZIP = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('zip payload')])

function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex')
}

function manifestLines(caseDir: string): Record<string, unknown>[] {
  const path = join(caseDir, MANIFEST_FILENAME)
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf-8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

describe('staging pool', () => {
  let tempDir: string
  let storageRoot: string
  let uploads: string
  let caseId: string
  let caseDir: string

  function sourceFile(name: string, bytes: Buffer): string {
    const path = join(uploads, name)
    writeFileSync(path, bytes)
    return path
  }

  async function ingestCapture(title: string): Promise<string> {
    const lifecycle = createCaptureLifecycle({
      selectorLifecycle: { runActiveSelectorsForCapture: vi.fn() } as unknown as SelectorLifecycle
    })
    const result = await lifecycle.ingest({
      caseId,
      url: 'https://example.com/' + title,
      title,
      timestamp: '2026-09-01T10:00:00.000Z',
      stream: Readable.from([
        Buffer.from('mhtml ' + title)
      ]) as unknown as ReadableStream<Uint8Array>,
      textContent: 'text',
      headers: {},
      browserVersion: 'Chrome/140',
      userAgent: 'UA',
      httpStatus: 200,
      operatorId: 'op-1',
      operatorName: 'Test Operator',
      toolVersion: '9.9.9-test'
    })
    return result.capture.id
  }

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-staging-'))
    storageRoot = join(tempDir, 'captures')
    uploads = join(tempDir, 'uploads')
    mkdirSync(uploads)
    initStorage(storageRoot)
    await initDatabase(':memory:')
    initSettings(tempDir)
    updateSettings({ operatorName: 'Test Operator', tsaUrl: 'http://tsa.example.com' })
    resetInstallationId()
    initInstallationId(tempDir)
    caseId = createCase({ name: 'Pool' }).id
    ensureCaseDir(caseId)
    caseDir = join(storageRoot, caseId)
    initManifest(caseDir)
  })

  afterEach(() => {
    closeDatabase()
    resetInstallationId()
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe('kind detection (X43)', () => {
    it('reads the magic bytes, never the extension', () => {
      expect(detectExhibitKind(PDF)).toBe('document')
      expect(detectExhibitKind(PNG)).toBe('image')
      expect(detectExhibitKind(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image')
      expect(detectExhibitKind(Buffer.from('GIF89a'))).toBe('image')
      expect(detectExhibitKind(Buffer.from('RIFF....WEBPVP8 '))).toBe('image')
      expect(detectExhibitKind(ZIP)).toBe('attachment')
      expect(detectExhibitKind(Buffer.alloc(0))).toBe('attachment')
    })
  })

  describe('upload', () => {
    it('lands files in the pool with an arrival hash and writes nothing to the manifest', async () => {
      const staged = await uploadToStaging(caseId, [
        sourceFile('report.pdf', PDF),
        sourceFile('photo.png', PNG),
        sourceFile('bundle.zip', ZIP)
      ])

      expect(staged.map((row) => [row.name, row.kind])).toEqual([
        ['report.pdf', 'document'],
        ['photo.png', 'image'],
        ['bundle.zip', 'attachment']
      ])
      for (const [row, bytes] of [
        [staged[0], PDF],
        [staged[1], PNG],
        [staged[2], ZIP]
      ] as const) {
        expect(row.origin).toBe('manual-upload')
        expect(row.contentHash).toBe(sha256(bytes))
        expect(row.sizeBytes).toBe(bytes.length)
        expect(row.path.startsWith(join(caseId, 'staging') + '/')).toBe(true)
        expect(readFileSync(join(storageRoot, row.path))).toEqual(bytes)
      }
      expect(listStagingFiles(caseId)).toHaveLength(3)
      expect(listExhibits(caseId)).toHaveLength(0)
      expect(manifestLines(caseDir)).toEqual([])
    })

    it('refuses a file over the ceiling and leaves neither file nor row', async () => {
      await expect(
        uploadToStaging(caseId, [sourceFile('big.bin', ZIP)], { maxSizeBytes: 4 })
      ).rejects.toThrow(/ceiling/)
      expect(listStagingFiles(caseId)).toHaveLength(0)
      expect(
        existsSync(join(caseDir, 'staging')) ? readdirEmpty(join(caseDir, 'staging')) : true
      ).toBe(true)
    })
  })

  describe('commit', () => {
    it('writes one exhibit entry per file at schema 3, numbers sequentially, and the chain verifies', async () => {
      await ingestCapture('first')
      const staged = await uploadToStaging(caseId, [
        sourceFile('report.pdf', PDF),
        sourceFile('bundle.zip', ZIP)
      ])
      const enqueueTimestamp = vi.fn()

      const result = await commitStagedFiles(
        caseId,
        staged.map((row) => row.id),
        { enqueueTimestamp }
      )

      expect(result.outcomes.map((o) => o.status)).toEqual(['committed', 'committed'])
      const committed = result.outcomes.filter((o) => o.status === 'committed')
      expect(committed.map((o) => o.exhibitNumber)).toEqual([2, 3])
      expect(enqueueTimestamp.mock.calls.map((c) => c[0])).toEqual(
        committed.map((o) => o.exhibitId)
      )

      const exhibits = listExhibits(caseId)
      expect(exhibits.map((e) => [e.kind, e.exhibitNumber])).toEqual([
        ['capture', 1],
        ['document', 2],
        ['attachment', 3]
      ])
      const pdf = exhibits[1]
      expect(pdf.name).toBe('report.pdf')
      expect(pdf.origin).toBe('manual-upload')
      expect(pdf.contentHash).toBe(sha256(PDF))
      expect(pdf.path).toBe(join(caseId, 'documents', pdf.id + '.pdf'))
      expect(readFileSync(join(storageRoot, pdf.path!))).toEqual(PDF)
      expect(exhibits[2].path).toBe(join(caseId, 'attachments', exhibits[2].id + '.zip'))
      expect(listStagingFiles(caseId)).toHaveLength(0)
      expect(existsSync(join(caseDir, 'staging', staged[0].id + '.pdf'))).toBe(false)

      const entries = manifestLines(caseDir).filter((line) => line.type === 'exhibit')
      expect(entries).toHaveLength(2)
      expect(entries[0]).toMatchObject({
        type: 'exhibit',
        exhibitId: pdf.id,
        caseId,
        kind: 'document',
        origin: 'manual-upload',
        name: 'report.pdf',
        exhibitNumber: 2,
        path: pdf.path,
        contentHash: sha256(PDF),
        sizeBytes: PDF.length,
        schemaVersion: 3,
        operatorName: 'Test Operator'
      })
      expect(pdf.manifestSeq).toBe(entries[0].index)
      expect(verifyManifestChain(caseDir).valid).toBe(true)
    })

    it('refuses a file whose bytes changed since arrival and leaves it in the pool', async () => {
      const [staged] = await uploadToStaging(caseId, [sourceFile('report.pdf', PDF)])
      writeFileSync(join(storageRoot, staged.path), Buffer.concat([PDF, Buffer.from('!')]))
      const before = manifestLines(caseDir).length

      const result = await commitStagedFiles(caseId, [staged.id])

      expect(result.outcomes).toEqual([
        { stagingId: staged.id, status: 'refused', reason: 'changed' }
      ])
      expect(getStagingFile(staged.id)).toBeDefined()
      expect(listExhibits(caseId)).toHaveLength(0)
      expect(manifestLines(caseDir)).toHaveLength(before)
    })

    it('reports a missing file and an unknown id as refusals, not throws', async () => {
      const [staged] = await uploadToStaging(caseId, [sourceFile('report.pdf', PDF)])
      unlinkSync(join(storageRoot, staged.path))
      const other = createCase({ name: 'Other' }).id

      const result = await commitStagedFiles(caseId, [staged.id, 'nope'])
      expect(result.outcomes).toEqual([
        { stagingId: staged.id, status: 'refused', reason: 'missing' },
        { stagingId: 'nope', status: 'refused', reason: 'not_found' }
      ])
      // A row from another Case is not_found here, never committed into it.
      const [foreign] = await uploadToStaging(other, [sourceFile('x.zip', ZIP)])
      expect((await commitStagedFiles(caseId, [foreign.id])).outcomes[0]).toEqual({
        stagingId: foreign.id,
        status: 'refused',
        reason: 'not_found'
      })
    })

    it('rolls the entry back and returns the file to the pool when the row insert throws', async () => {
      const [staged] = await uploadToStaging(caseId, [sourceFile('report.pdf', PDF)])
      // Break the insert: a foreign exhibits row already at the number the
      // commit will take violates UNIQUE(case_id, exhibit_number).
      getDb()
        .prepare(
          `INSERT INTO exhibits (id, case_id, kind, origin, exhibit_number, name, content_hash, committed_at)
           VALUES ('blocker', ?, 'capture', 'extension', 1, 'b', 'h', '2026-01-01T00:00:00.000Z')`
        )
        .run(caseId)
      getDb().prepare('UPDATE exhibits SET exhibit_number = 0 WHERE id = ?').run('blocker')
      const before = manifestLines(caseDir).length
      const spy = vi
        .spyOn(await import('@main/services/db/exhibitRepo'), 'nextExhibitNumber')
        .mockReturnValue(0)

      const result = await commitStagedFiles(caseId, [staged.id])

      spy.mockRestore()
      expect(result.outcomes[0]).toMatchObject({ stagingId: staged.id, status: 'failed' })
      expect(manifestLines(caseDir)).toHaveLength(before)
      expect(getStagingFile(staged.id)).toBeDefined()
      expect(existsSync(join(storageRoot, staged.path))).toBe(true)
      expect(listExhibits(caseId).filter((e) => e.id !== 'blocker')).toHaveLength(0)
    })
  })

  describe('discard (X29)', () => {
    it('keeps the row when the bytes cannot be removed, so nothing undeclared stays on disk', async () => {
      const [staged] = await uploadToStaging(caseId, [sourceFile('a.zip', ZIP)])
      const pool = join(caseDir, 'staging')
      // A read-only directory refuses the unlink (EACCES) while the file stays.
      chmodSync(pool, 0o555)
      try {
        const result = await discardStagedFiles(caseId, [staged.id])
        expect(result).toEqual({ discarded: [] })
        expect(getStagingFile(staged.id)).toBeDefined()
        expect(existsSync(join(storageRoot, staged.path))).toBe(true)
      } finally {
        chmodSync(pool, 0o755)
      }
      // Already-absent bytes are the one case the row goes anyway.
      unlinkSync(join(storageRoot, staged.path))
      expect(await discardStagedFiles(caseId, [staged.id])).toEqual({ discarded: [staged.id] })
      expect(getStagingFile(staged.id)).toBeUndefined()
    })

    it('removes the file and the row and writes no entry', async () => {
      const staged = await uploadToStaging(caseId, [
        sourceFile('a.zip', ZIP),
        sourceFile('b.zip', ZIP)
      ])
      const result = await discardStagedFiles(caseId, [staged[0].id, 'nope'])
      expect(result).toEqual({ discarded: [staged[0].id] })
      expect(existsSync(join(storageRoot, staged[0].path))).toBe(false)
      expect(getStagingFile(staged[0].id)).toBeUndefined()
      expect(getStagingFile(staged[1].id)).toBeDefined()
      expect(manifestLines(caseDir)).toEqual([])
    })
  })

  describe('verify (X37)', () => {
    async function committedAttachment(): Promise<string> {
      const [staged] = await uploadToStaging(caseId, [sourceFile('bundle.zip', ZIP)])
      const result = await commitStagedFiles(caseId, [staged.id])
      const outcome = result.outcomes[0]
      if (outcome.status !== 'committed') throw new Error('commit failed')
      return outcome.exhibitId
    }

    it('reports verified for an untouched attachment, tampered after the bytes change, missing when gone', async () => {
      const exhibitId = await committedAttachment()
      const path = join(storageRoot, getExhibit(exhibitId)!.path!)

      expect(await verifyExhibit(caseId, exhibitId)).toMatchObject({
        exhibitId,
        kind: 'attachment',
        status: 'verified',
        derived: []
      })

      writeFileSync(path, Buffer.concat([ZIP, Buffer.from('tamper')]))
      expect((await verifyExhibit(caseId, exhibitId)).status).toBe('tampered')

      unlinkSync(path)
      expect((await verifyExhibit(caseId, exhibitId)).status).toBe('missing')
    })

    it('reports chain-broken when the row is not anchored where it claims', async () => {
      const exhibitId = await committedAttachment()
      getDb().prepare('UPDATE exhibits SET manifest_seq = 99 WHERE id = ?').run(exhibitId)
      expect(await verifyExhibit(caseId, exhibitId)).toMatchObject({
        status: 'chain-broken',
        reason: 'Exhibit not anchored in manifest chain'
      })
    })

    it('reports one outcome per derived file bound to its derivation entry', async () => {
      const exhibitId = await committedAttachment()
      const exhibit = getExhibit(exhibitId)!
      const output = Buffer.from('extracted text')
      const rel = join(caseId, 'derived', 'text.txt')
      mkdirSync(join(caseDir, 'derived'))
      writeFileSync(join(storageRoot, rel), output)
      const derived = await withManifestEntry(
        caseDir,
        {
          type: 'derivation',
          caseId,
          parentExhibitId: exhibitId,
          parentContentHash: exhibit.contentHash,
          derivation: 'text',
          derivationToolVersion: '9.9.9-test',
          outputHash: sha256(output),
          outputPath: rel,
          timestamp: '2026-09-01T10:00:00.000Z',
          operatorId: 'op-1',
          operatorName: 'Test Operator',
          toolVersion: '9.9.9-test'
        },
        (appended) =>
          insertDerivedFile({
            exhibitId,
            derivation: 'text',
            toolVersion: '9.9.9-test',
            contentHash: sha256(output),
            path: rel,
            createdAt: '2026-09-01T10:00:00.000Z',
            manifestSeq: appended.index
          })
      )
      const outcome = async () => (await verifyExhibit(caseId, exhibitId)).derived

      expect(await outcome()).toEqual([
        { derivedFileId: derived.id, derivation: 'text', status: 'verified' }
      ])

      writeFileSync(join(storageRoot, rel), Buffer.concat([output, Buffer.from('!')]))
      expect(await outcome()).toMatchObject([{ status: 'tampered' }])

      unlinkSync(join(storageRoot, rel))
      expect(await outcome()).toMatchObject([
        { status: 'missing', reason: 'Derived file unreadable' }
      ])

      // The parent's own outcome is untouched by its derived files.
      expect((await verifyExhibit(caseId, exhibitId)).status).toBe('verified')

      // The row's manifest index is NOT what binds (#1156, D7): the binding is
      // the `derivation` entry that names this parent and this path and carries
      // the digest of these bytes. Repointing the mirror column at the parent's
      // own `exhibit` entry, or clearing it, changes nothing the chain says, so
      // it changes no outcome. Before this the index decided on its own, which
      // is what let a row be vouched for by an entry written about another
      // Exhibit's file.
      writeFileSync(join(storageRoot, rel), output)
      const seqAt = (seq: number | null) =>
        getDb()
          .prepare('UPDATE derived_files SET manifest_seq = ? WHERE id = ?')
          .run(seq, derived.id)
      seqAt(exhibit.manifestSeq)
      expect(await outcome()).toMatchObject([{ status: 'verified' }])
      seqAt(null)
      expect(await outcome()).toMatchObject([{ status: 'verified' }])
    })

    it('reports a derived file the chain does not anchor as unverified (X34)', async () => {
      const exhibitId = await committedAttachment()
      const rel = join(caseId, 'derived', 'thumb.jpg')
      mkdirSync(join(caseDir, 'derived'))
      const bytes = Buffer.from('a thumbnail nothing anchors')
      writeFileSync(join(storageRoot, rel), bytes)

      // No `derivation` entry was ever written for this file — X34's case, a
      // legacy thumbnail whose source could not be verified. It is recorded so
      // the inventory can show it, and reported as unanchored rather than
      // re-hashed into a claim.
      const unanchored = insertDerivedFile({
        exhibitId,
        derivation: 'thumbnail',
        toolVersion: '9.9.9-test',
        contentHash: sha256(bytes),
        path: rel,
        createdAt: '2026-09-01T10:00:00.000Z'
      })
      expect((await verifyExhibit(caseId, exhibitId)).derived).toEqual([
        {
          derivedFileId: unanchored.id,
          derivation: 'thumbnail',
          status: 'unverified',
          reason: 'No manifest entry anchors this derived file'
        }
      ])

      // An index pointing somewhere real does not rescue it: with no entry
      // naming this parent and path, nothing on the chain is about these bytes.
      getDb()
        .prepare('UPDATE derived_files SET manifest_seq = 0 WHERE id = ?')
        .run(unanchored.id)
      expect((await verifyExhibit(caseId, exhibitId)).derived).toEqual([
        {
          derivedFileId: unanchored.id,
          derivation: 'thumbnail',
          status: 'unverified',
          reason: 'Derived file is not anchored in the verified chain'
        }
      ])
    })
  })

  describe('trusted time (X26, #1180)', () => {
    function granting() {
      return vi.fn(async (contentHash: string) =>
        buildSyntheticToken({
          contentHash,
          genTime: new Date('2026-09-14T09:05:00.000Z'),
          tsaDnsName: 'tsa.example.com'
        })
      )
    }

    it('stamps a committed attachment at schema 3 and a capture at 2, once each', async () => {
      const cap = insertCapture({
        caseId,
        url: 'https://example.com/cap',
        title: 'cap',
        hash: sha256(Buffer.from('cap bytes')),
        timestamp: '2026-09-01T10:00:00.000Z',
        format: 'mhtml'
      })
      appendManifestEntry(caseDir, {
        type: 'capture',
        captureId: cap.id,
        caseId,
        url: cap.url,
        timestamp: cap.timestamp,
        contentHash: cap.hash,
        sizeBytes: 9,
        operatorId: 'op-1',
        operatorName: 'Op',
        toolVersion: '0.1.0'
      })
      setCaptureTrustedTime(cap.id, 'pending')
      const [staged] = await uploadToStaging(caseId, [sourceFile('bundle.zip', ZIP)])
      const requestToken = granting()
      const worker = createTimestampWorker({ requestToken })
      await commitStagedFiles(caseId, [staged.id], {
        enqueueTimestamp: (id) => worker.enqueueExhibit(id)
      })
      // Let the enqueued stamp run, then sweep for anything still pending.
      await new Promise((resolve) => setImmediate(resolve))
      await new Promise((resolve) => setTimeout(resolve, 20))
      const first = await worker.processPending()
      const second = await worker.processPending()

      const stamps = manifestLines(caseDir).filter((line) => line.type === 'timestamp')
      expect(stamps).toHaveLength(2)
      const forCapture = stamps.find((s) => s.captureContentHash === cap.hash)
      const forAttachment = stamps.find((s) => s.captureContentHash === sha256(ZIP))
      expect(forCapture?.schemaVersion).toBe(2)
      expect(forAttachment?.schemaVersion).toBe(3)
      expect(first.failed + second.failed).toBe(0)
      expect(second.stamped).toBe(0)
      expect(verifyManifestChain(caseDir).valid).toBe(true)
    })

    it('leaves the attachment unstamped and retries when the TSA fails', async () => {
      const [staged] = await uploadToStaging(caseId, [sourceFile('bundle.zip', ZIP)])
      await commitStagedFiles(caseId, [staged.id])
      const worker = createTimestampWorker({
        requestToken: vi.fn(async () => {
          throw new Error('ENOTFOUND')
        })
      })
      expect(await worker.processPending()).toEqual({ stamped: 0, failed: 1 })
      expect(manifestLines(caseDir).filter((line) => line.type === 'timestamp')).toHaveLength(0)
    })
  })

  describe('export coverage (X44, #1156)', () => {
    it('never packages pooled bytes in an Evidence Package', async () => {
      await ingestCapture('first')
      const [staged] = await uploadToStaging(caseId, [sourceFile('report.pdf', PDF)])
      const outputPath = join(tempDir, 'pooled-only.zip')
      const lifecycle = createCaptureLifecycle({
        selectorLifecycle: {
          runActiveSelectorsForCapture: vi.fn()
        } as unknown as SelectorLifecycle
      })
      await generateReport(
        caseId,
        {
          format: 'zip',
          exportClass: 'evidence',
          include: {
            captures: true,
            screenshots: false,
            auditTrail: true,
            notes: false,
            annotations: 'none'
          },
          outputPath
        },
        lifecycle
      )
      const zip = readStoredZip(readFileSync(outputPath))
      const names = [...zip.keys()]
      expect(names.some((name) => name.includes('staging') || name.includes(staged.id))).toBe(false)
      expect([...zip.values()].some((buf) => buf.equals(PDF))).toBe(false)
      const evidence = zip.get('evidence.json')!.toString('utf-8')
      expect(evidence.includes(sha256(PDF))).toBe(false)
    })

    // The X44 refusal is gone (#1156): the package covers every kind, so an
    // Evidence Package over a Case holding a committed attachment is produced
    // and encloses it, rather than being refused to avoid claiming completeness
    // it could not deliver.
    it('packages a committed non-capture exhibit instead of refusing the export', async () => {
      const [staged] = await uploadToStaging(caseId, [sourceFile('bundle.zip', ZIP)])
      const [outcome] = (await commitStagedFiles(caseId, [staged.id])).outcomes
      const exhibitId = outcome.status === 'committed' ? outcome.exhibitId : ''
      const outputPath = join(tempDir, 'evidence.zip')

      await generateReport(
        caseId,
        {
          format: 'zip',
          exportClass: 'evidence',
          include: {
            captures: true,
            screenshots: true,
            auditTrail: true,
            notes: false,
            annotations: 'none'
          },
          outputPath
        },
        createCaptureLifecycle({
          selectorLifecycle: {
            runActiveSelectorsForCapture: vi.fn()
          } as unknown as SelectorLifecycle
        })
      )

      const zip = readStoredZip(readFileSync(outputPath))
      expect(zip.get(`attachments/${exhibitId}.zip`)).toEqual(ZIP)
      const evidence = JSON.parse(zip.get('evidence.json')!.toString('utf-8')) as {
        schemaVersion: number
        exhibits: Array<{
          id: string
          kind: string
          origin: string
          exhibitNumber: number
          name: string
          contentHash: string
          path: string | null
          derivedFiles: unknown[]
        }>
      }
      expect(evidence.schemaVersion).toBe(2)
      expect(evidence.exhibits).toHaveLength(1)
      expect(evidence.exhibits[0]).toMatchObject({
        id: exhibitId,
        kind: 'attachment',
        origin: 'manual-upload',
        exhibitNumber: 1,
        name: 'bundle.zip',
        contentHash: sha256(ZIP),
        path: `attachments/${exhibitId}.zip`,
        derivedFiles: []
      })
    })
  })

  describe('archive round trip (X12, X30)', () => {
    it('carries committed exhibits with their numbers and pooled files flagged staged', async () => {
      await ingestCapture('first')
      const staged = await uploadToStaging(caseId, [
        sourceFile('bundle.zip', ZIP),
        sourceFile('report.pdf', PDF)
      ])
      await commitStagedFiles(caseId, [staged[0].id])
      const archivePath = join(tempDir, 'case.birdbrain')

      await exportCaseArchive(caseId, archivePath)

      const zip = readStoredZip(readFileSync(archivePath))
      const header = JSON.parse(zip.get('package.json')!.toString('utf-8')) as {
        schemaVersion: number
        staged: string[]
        artifacts: Array<{ path: string }>
      }
      expect(header.schemaVersion).toBe(6)
      const attachment = listExhibits(caseId).find((e) => e.kind === 'attachment')!
      expect(header.artifacts.map((a) => a.path)).toEqual(
        expect.arrayContaining([
          `files/exhibits/${attachment.id}.zip`,
          `files/staging/${staged[1].id}.pdf`
        ])
      )
      expect(header.staged).toEqual([`files/staging/${staged[1].id}.pdf`])
      expect(inspectCaseArchive(archivePath).verification.overallValid).toBe(true)

      const { newCaseId } = await importCaseArchive(archivePath)

      const imported = listExhibits(newCaseId)
      expect(imported.map((e) => [e.kind, e.exhibitNumber])).toEqual([
        ['capture', 1],
        ['attachment', 2]
      ])
      const importedAttachment = imported[1]
      // Same DB, so every id collided and was remapped; the file follows.
      expect(importedAttachment.id).not.toBe(attachment.id)
      expect(importedAttachment.path).toBe(
        join(newCaseId, 'attachments', importedAttachment.id + '.zip')
      )
      expect(readFileSync(join(storageRoot, importedAttachment.path!))).toEqual(ZIP)
      const pool = listStagingFiles(newCaseId)
      expect(pool).toHaveLength(1)
      expect(pool[0].name).toBe('report.pdf')
      expect(pool[0].contentHash).toBe(sha256(PDF))
      expect(pool[0].path).toBe(join(newCaseId, 'staging', pool[0].id + '.pdf'))
      expect(readFileSync(join(storageRoot, pool[0].path))).toEqual(PDF)
      // Pooled, never anchored: no exhibits row and no entry names the PDF.
      expect(imported.some((e) => e.contentHash === sha256(PDF))).toBe(false)
      const newCaseDir = join(storageRoot, newCaseId)
      expect(verifyManifestChain(newCaseDir).valid).toBe(true)

      // The `exhibit` entry still names the source id; the row resolves to it
      // through the id map the `import` entry anchors.
      expect(await verifyExhibit(newCaseId, importedAttachment.id)).toMatchObject({
        exhibitId: importedAttachment.id,
        kind: 'attachment',
        status: 'verified'
      })

      // A map the import entry did not anchor may not say so: same mapping,
      // different bytes, so its digest no longer matches `idMapSha256`.
      const idMapPath = join(newCaseDir, IMPORT_ID_MAP_FILENAME)
      const idMap = JSON.parse(readFileSync(idMapPath, 'utf-8')) as {
        remapped: Record<string, string>
      }
      expect(idMap.remapped[attachment.id]).toBe(importedAttachment.id)
      writeFileSync(idMapPath, JSON.stringify({ ...idMap, forged: true }))
      expect(verifyManifestChain(newCaseDir).valid).toBe(true)
      expect(await verifyExhibit(newCaseId, importedAttachment.id)).toMatchObject({
        status: 'chain-broken',
        reason: 'Exhibit not anchored in manifest chain'
      })
    })

    it('fails verification when a pooled entry is altered or its flag is dropped', async () => {
      const [staged] = await uploadToStaging(caseId, [sourceFile('report.pdf', PDF)])
      const archivePath = join(tempDir, 'case.birdbrain')
      await exportCaseArchive(caseId, archivePath)
      const entryName = `files/staging/${staged.id}.pdf`

      const zip = readStoredZip(readFileSync(archivePath))
      const rewrite = (mutate: (entries: Map<string, Buffer>) => void, out: string) => {
        const copy = new Map(zip)
        mutate(copy)
        writeFileSync(
          out,
          createStoredZip([...copy.entries()].map(([name, data]) => ({ name, data })))
        )
        return inspectCaseArchive(out).verification.overallValid
      }

      expect(
        rewrite(
          (e) => e.set(entryName, Buffer.concat([PDF, Buffer.from('!')])),
          join(tempDir, 'a.birdbrain')
        )
      ).toBe(false)
      expect(
        rewrite(
          (e) => {
            const header = JSON.parse(e.get('package.json')!.toString('utf-8')) as {
              staged: string[]
            }
            header.staged = []
            e.set('package.json', Buffer.from(JSON.stringify(header)))
          },
          join(tempDir, 'b.birdbrain')
        )
      ).toBe(false)
    })
  })
})

function readdirEmpty(dir: string): boolean {
  return readdirSync(dir).length === 0
}
