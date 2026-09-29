import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { Readable } from 'stream'
import { ensureCaseDir, initStorage } from '@main/services/storage'
import { closeDatabase, initDatabase } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { deleteCapture, insertCapture } from '@main/services/db/captureRepo'
import { getExhibit, listExhibits } from '@main/services/db/exhibitRepo'
import { createCaptureLifecycle, type CaptureLifecycle } from '@main/services/captureLifecycle'
import { commitStagedFiles, uploadToStaging } from '@main/services/staging'
import { backfillCase } from '@main/services/exhibitBackfill'
import { verifyExhibit } from '@main/services/exhibits'
import { exportCaseArchive, importCaseArchive } from '@main/services/caseArchive'
import { nextExhibitNumber } from '@main/services/exhibitNumbering'
import { appendManifestEntry, initManifest, verifyManifestChain } from '@main/services/manifest'
import { initInstallationId, resetInstallationId } from '@main/services/installationId'
import { initSettings, updateSettings } from '@main/services/settings'
import { exhibitNumberSequences } from '@shared/verify'
import { MANIFEST_FILENAME } from '@shared/constants'
import type { SelectorLifecycle } from '@main/services/selectorLifecycle'

// The next Exhibit Number comes from the chain, and a Capture's number rides
// on its own entry (#1270, X45, X46, X48), exercised through the real ingest,
// delete, commit, backfill and archive paths. The verify-core answers these
// rest on are frozen in tests/shared/verify/exhibitNumbers.test.ts.

vi.mock('@main/services/tlsCertChain', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/services/tlsCertChain')>()
  return { ...actual, fetchCertChain: vi.fn(async () => null) }
})

const TOOL_VERSION = '9.9.9-test'
const PDF = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n')

function manifestLines(caseDir: string): Record<string, unknown>[] {
  const path = join(caseDir, MANIFEST_FILENAME)
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf-8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

describe('Exhibit Numbers from the chain (#1270)', () => {
  let tempDir: string
  let storageRoot: string
  let caseId: string
  let caseDir: string
  let lifecycle: CaptureLifecycle

  async function ingest(title: string): Promise<string> {
    const result = await lifecycle.ingest({
      caseId,
      url: `https://example.com/${title}`,
      title,
      timestamp: '2026-09-20T10:00:00.000Z',
      stream: Readable.from([
        Buffer.from(`mhtml ${title}`)
      ]) as unknown as ReadableStream<Uint8Array>,
      textContent: 'text',
      headers: {},
      browserVersion: 'Chrome/140',
      userAgent: 'UA',
      httpStatus: 200,
      operatorId: 'op-1',
      operatorName: 'Test Operator',
      toolVersion: TOOL_VERSION
    })
    return result.capture.id
  }

  // A Capture as a build before X46 left it: an entry with no number, and a
  // row numbered above the live rows.
  function ingestPreX46(n: number): string {
    const id = `pre-x46-${n}`
    const hash = createHash('sha256').update(id).digest('hex')
    const { index } = appendManifestEntry(caseDir, {
      type: 'capture',
      captureId: id,
      caseId,
      url: `https://example.com/${id}`,
      timestamp: '2026-09-01T10:00:00.000Z',
      contentHash: hash,
      sizeBytes: 1,
      operatorId: 'op-1',
      operatorName: 'Test Operator',
      toolVersion: TOOL_VERSION
    })
    insertCapture({
      id,
      caseId,
      url: `https://example.com/${id}`,
      title: id,
      hash,
      timestamp: '2026-09-01T10:00:00.000Z',
      manifestIndex: index
    })
    return id
  }

  async function commitPdf(name: string): Promise<string> {
    const source = join(tempDir, 'uploads', name)
    writeFileSync(source, PDF)
    const [staged] = await uploadToStaging(caseId, [source])
    const { outcomes } = await commitStagedFiles(caseId, [staged.id])
    const [outcome] = outcomes
    if (outcome.status !== 'committed') throw new Error(`commit ${outcome.status}`)
    return outcome.exhibitId
  }

  const numberOf = (id: string): number | undefined => getExhibit(id)?.exhibitNumber

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-numbering-'))
    storageRoot = join(tempDir, 'captures')
    mkdirSync(join(tempDir, 'uploads'))
    initStorage(storageRoot)
    await initDatabase(':memory:')
    initSettings(tempDir)
    updateSettings({ operatorName: 'Test Operator' })
    resetInstallationId()
    initInstallationId(tempDir)
    caseId = createCase({ name: 'Numbering' }).id
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

  it('issues 4 after Exhibit 3 is deleted, and the chain shows 3 deleted and 4 assigned', async () => {
    const one = await ingest('one')
    const two = await ingest('two')
    const three = await ingest('three')
    expect([one, two, three].map(numberOf)).toEqual([1, 2, 3])

    expect(await lifecycle.delete(three)).toBe(true)
    const four = await ingest('four')

    expect(numberOf(four)).toBe(4)
    const lines = manifestLines(caseDir)
    expect(
      lines.filter((line) => line.type === 'capture').map((l) => [l.captureId, l.exhibitNumber])
    ).toEqual([
      [one, 1],
      [two, 2],
      [three, 3],
      [four, 4]
    ])
    expect(lines.filter((line) => line.type === 'deletion').map((l) => l.captureId)).toEqual([
      three
    ])
    expect(verifyManifestChain(caseDir).valid).toBe(true)
  })

  it('numbers a pool commit above a deleted Capture as well', async () => {
    await ingest('one')
    const two = await ingest('two')
    await lifecycle.delete(two)

    const document = await commitPdf('statement.pdf')

    expect(numberOf(document)).toBe(3)
    const [entry] = manifestLines(caseDir).filter((line) => line.type === 'exhibit')
    expect(entry).toMatchObject({ exhibitId: document, exhibitNumber: 3 })
  })

  it('records the number on the capture entry, stamped 3, equal to the row', async () => {
    ingestPreX46(1)
    await backfillCase(caseId, { toolVersion: TOOL_VERSION })

    const captured = await ingest('after-backfill')

    const entry = manifestLines(caseDir).find((line) => line.captureId === captured)
    expect(entry).toMatchObject({ type: 'capture', exhibitNumber: 2, schemaVersion: 3 })
    expect(numberOf(captured)).toBe(entry?.exhibitNumber)
    expect(verifyManifestChain(caseDir).valid).toBe(true)
  })

  it('gives a duplicate a number of its own on its own entry', async () => {
    const source = await ingest('source')

    const result = await lifecycle.duplicate(source)

    if (result.status !== 'duplicated') throw new Error(`duplicate ${result.status}`)
    const entry = manifestLines(caseDir).find((line) => line.captureId === result.capture.id)
    expect(entry).toMatchObject({ method: 'duplicate', exhibitNumber: 2 })
    expect(numberOf(result.capture.id)).toBe(2)
  })

  it('verifies a chain written before X46 and numbers from its renumber', async () => {
    const ids = [ingestPreX46(1), ingestPreX46(2), ingestPreX46(3)]
    await backfillCase(caseId, { toolVersion: TOOL_VERSION })
    // The row goes as a deletion takes it; the renumber still assigns 3.
    deleteCapture(ids[2])

    expect(verifyManifestChain(caseDir).valid).toBe(true)
    expect(listExhibits(caseId).map((e) => e.exhibitNumber)).toEqual([1, 2])
    expect(nextExhibitNumber(caseId)).toBe(4)
  })

  it('never reissues a number a pre-X46 row holds and no entry records', () => {
    // Ingested after the Case's renumber and before X46: the number is on the
    // row alone. The chain's highest is 1, and 2 is still taken.
    ingestPreX46(1)
    appendManifestEntry(caseDir, {
      type: 'renumber',
      caseId,
      assignments: [{ exhibitId: 'pre-x46-1', exhibitNumber: 1, manifestIndex: 0 }],
      timestamp: '2026-09-01T10:01:00.000Z',
      operatorId: 'op-1',
      operatorName: 'Test Operator',
      toolVersion: TOOL_VERSION
    })
    ingestPreX46(2)

    expect(numberOf('pre-x46-2')).toBe(2)
    expect(nextExhibitNumber(caseId)).toBe(3)
  })

  it('reports a number issued twice as an Integrity Exception naming both Exhibits', async () => {
    const ids = [ingestPreX46(1), ingestPreX46(2), ingestPreX46(3)]
    await backfillCase(caseId, { toolVersion: TOOL_VERSION })
    deleteCapture(ids[2])
    // What the MAX + 1 read over live rows did before #1270: 3 again.
    const numbering = await import('@main/services/exhibitNumbering')
    const spy = vi.spyOn(numbering, 'nextExhibitNumber').mockReturnValueOnce(3)
    const reissued = await commitPdf('reissued.pdf')
    spy.mockRestore()

    const result = await verifyExhibit(caseId, reissued)

    // The bytes verify; the number is the exception, and never tamper (X48).
    expect(result.status).toBe('verified')
    expect(result.exceptions).toEqual([
      {
        category: 'repeated-exhibit-number',
        exhibitNumber: 3,
        exhibitIds: [ids[2], reissued],
        reason: expect.stringContaining('Integrity Exception: Exhibit Number 3')
      }
    ])
    expect(result.exceptions?.[0].reason).toContain(`${ids[2]}, ${reissued}`)
    expect((await verifyExhibit(caseId, ids[0])).exceptions).toBeUndefined()
  })

  it('reports no number exception off a chain that does not verify', async () => {
    const ids = [ingestPreX46(1), ingestPreX46(2)]
    await backfillCase(caseId, { toolVersion: TOOL_VERSION })
    deleteCapture(ids[1])
    const numbering = await import('@main/services/exhibitNumbering')
    const spy = vi.spyOn(numbering, 'nextExhibitNumber').mockReturnValueOnce(2)
    const reissued = await commitPdf('reissued.pdf')
    spy.mockRestore()
    const path = join(caseDir, MANIFEST_FILENAME)
    writeFileSync(path, readFileSync(path, 'utf-8').replace('pre-x46-1"', 'pre-x46-9"'))

    const result = await verifyExhibit(caseId, reissued)

    expect(result.status).toBe('chain-broken')
    expect(result.exceptions).toBeUndefined()
  })

  it('keeps every number across an archive round trip and continues above the highest', async () => {
    await ingest('one')
    await ingest('two')
    const three = await ingest('three')
    await commitPdf('four.pdf')
    await lifecycle.delete(three)
    const sourceNumbers = listExhibits(caseId).map((e) => e.exhibitNumber)
    const sourceAssignments = exhibitNumberSequences(manifestLines(caseDir))

    const archivePath = join(tempDir, 'numbers.birdbrain')
    await exportCaseArchive(caseId, archivePath)
    const { newCaseId } = await importCaseArchive(archivePath)
    const importedDir = join(storageRoot, newCaseId)

    expect(listExhibits(newCaseId).map((e) => e.exhibitNumber)).toEqual(sourceNumbers)
    expect(sourceNumbers).toEqual([1, 2, 4])
    // The chain arrives verbatim, so it assigns what the source's did, the
    // deleted 3 included, and the import numbers above all of it.
    expect(exhibitNumberSequences(manifestLines(importedDir))).toEqual(sourceAssignments)
    expect(verifyManifestChain(importedDir).valid).toBe(true)
    expect(nextExhibitNumber(newCaseId)).toBe(5)
  })

  it('takes distinct numbers for two ingests running at once', async () => {
    const [a, b] = await Promise.all([ingest('a'), ingest('b')])
    expect([numberOf(a), numberOf(b)].sort()).toEqual([1, 2])
  })

  it("reads only this installation's chain, never another member's file", () => {
    // Numbers are per member (decision 7). A remote member's chain sits beside
    // the local one as `manifest.<installationId>.jsonl`.
    writeFileSync(
      join(caseDir, 'manifest.inst-remote.jsonl'),
      JSON.stringify({ type: 'exhibit', exhibitId: 'remote-50', exhibitNumber: 50 }) + '\n'
    )
    expect(nextExhibitNumber(caseId)).toBe(1)
  })

  it('numbers a fork from 1 and a plain import above the source', () => {
    const write = (lines: Record<string, unknown>[]): void =>
      writeFileSync(
        join(caseDir, MANIFEST_FILENAME),
        lines.map((line) => JSON.stringify(line)).join('\n') + '\n'
      )
    const source = { type: 'exhibit', exhibitId: 'source-7', exhibitNumber: 7 }
    const importEntry = { type: 'import', sourceCaseId: 'source-case' }

    write([source, importEntry])
    expect(nextExhibitNumber(caseId)).toBe(8)

    write([{ type: 'member-add', role: 'owner' }, source, importEntry])
    expect(nextExhibitNumber(caseId)).toBe(1)
  })
})
