import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createHash } from 'crypto'
import {
  initDatabase,
  closeDatabase,
  createCase,
  insertCapture,
  createTag,
  addTagToCapture,
  createSelector,
  toggleFavorite,
  createNote
} from '../../../src/main/services/database'
import { initStorage, ensureCaseDir, getCapturePath } from '../../../src/main/services/storage'
import {
  initManifest,
  appendManifestEntry,
  verifyManifestChain
} from '../../../src/main/services/manifest'
import { getStorageRoot } from '../../../src/main/services/storage'
import { getDb } from '../../../src/main/services/database'
import { initSettings, updateSettings } from '@main/services/settings'
import { initInstallationId, resetInstallationId } from '@main/services/installationId'
import { initSigningKey, resetSigningKey } from '@main/services/signingKey'
import { readStoredZip } from '../../../src/main/services/zipRead'
import { createStoredZip } from '../../../src/main/services/zip'
import { exportCaseArchive, inspectCaseArchive } from '../../../src/main/services/caseArchive'

// Reads the archive, mutates one entry's bytes, and rewrites the zip WITHOUT
// touching package.json — this is what makes it tampered: the recorded
// artifact hash/packageHash no longer matches the entry's actual bytes.
function tamperZipEntry(archivePath: string, entryName: string): void {
  const entries = readStoredZip(readFileSync(archivePath))
  const buf = entries.get(entryName)
  if (!buf) throw new Error(`Entry not found: ${entryName}`)
  const tampered = Buffer.from(buf)
  tampered[0] = tampered[0] ^ 0xff
  entries.set(entryName, tampered)
  const rebuilt = [...entries.entries()].map(([name, data]) => ({ name, data }))
  writeFileSync(archivePath, createStoredZip(rebuilt))
}

// Reads package.json, applies `mutate`, and rewrites the zip with only that
// entry replaced — used to simulate a header claiming a newer schema version.
function rewritePackageJson(
  archivePath: string,
  mutate: (header: Record<string, unknown>) => Record<string, unknown>
): void {
  const entries = readStoredZip(readFileSync(archivePath))
  const header = JSON.parse(entries.get('package.json')!.toString('utf-8'))
  const mutated = mutate(header)
  entries.set('package.json', Buffer.from(JSON.stringify(mutated, null, 2)))
  const rebuilt = [...entries.entries()].map(([name, data]) => ({ name, data }))
  writeFileSync(archivePath, createStoredZip(rebuilt))
}

describe('caseArchive export', () => {
  let tempDir: string
  let caseId: string
  let mhtmlCaptureId: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'bb-case-archive-'))
    initStorage(join(tempDir, 'captures'))
    initDatabase(':memory:')
    resetInstallationId()
    initInstallationId(tempDir)
    resetSigningKey()
    initSigningKey(tempDir)
    initSettings(tempDir)
    updateSettings({ operatorName: 'Test Operator', operatorRole: '', operatorOrganization: '' })

    const c = createCase({ name: 'Archive Test Case', description: 'A case for archive export' })
    caseId = c.id
    ensureCaseDir(caseId)
    const caseDir = join(getStorageRoot(), caseId)
    initManifest(caseDir)

    // Capture 1: mhtml + png + txt, backed by a real manifest capture entry.
    mhtmlCaptureId = 'capture-mhtml-1'
    const mhtmlBuf = Buffer.from('<html>mhtml content</html>')
    const pngBuf = Buffer.from('fake-png-bytes')
    const txtBuf = Buffer.from('extracted text')
    writeFileSync(getCapturePath(caseId, mhtmlCaptureId, 'mhtml'), mhtmlBuf)
    writeFileSync(getCapturePath(caseId, mhtmlCaptureId, 'png'), pngBuf)
    writeFileSync(getCapturePath(caseId, mhtmlCaptureId, 'txt'), txtBuf)
    const contentHash = createHash('sha256').update(mhtmlBuf).digest('hex')
    const { entryHash } = appendManifestEntry(caseDir, {
      type: 'capture',
      captureId: mhtmlCaptureId,
      caseId,
      url: 'https://example.com/mhtml',
      timestamp: '2026-04-05T12:00:00.000Z',
      contentHash,
      sizeBytes: mhtmlBuf.length,
      operatorId: 'op-1',
      operatorName: 'Test Operator',
      toolVersion: '0.1.0'
    })
    insertCapture({
      id: mhtmlCaptureId,
      caseId,
      url: 'https://example.com/mhtml',
      title: 'MHTML Capture',
      hash: contentHash,
      timestamp: '2026-04-05T12:00:00.000Z',
      format: 'mhtml',
      mhtmlPath: `${mhtmlCaptureId}.mhtml`,
      sizeBytes: mhtmlBuf.length,
      manifestIndex: 0,
      entryHash,
      operatorId: 'op-1',
      operatorName: 'Test Operator'
    })

    // Capture 2: legacy html-only capture, no manifest entry.
    const legacyCapture = insertCapture({
      caseId,
      url: 'https://legacy.example.com',
      title: 'Legacy Capture',
      hash: 'y'.repeat(64),
      timestamp: '2026-04-04T12:00:00.000Z'
    })

    createNote({ caseId, captureId: mhtmlCaptureId, title: 'Note 1', body: 'Body text' })

    const tag = createTag({ name: 'important' })
    addTagToCapture({ captureId: mhtmlCaptureId, tagId: tag.id })

    createSelector({ caseId, pattern: 'foo', isRegex: false, label: 'Foo selector' })

    toggleFavorite(mhtmlCaptureId)

    const now = new Date().toISOString()
    getDb()
      .prepare(
        `INSERT INTO annotations (capture_id, schema_version, shapes_json, image_width, image_height, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(mhtmlCaptureId, 1, '[]', 100, 100, now, null)
    getDb()
      .prepare(
        `INSERT INTO annotation_pins (id, capture_id, number, body, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run('pin-1', mhtmlCaptureId, 1, 'Pin body', now, now)

    void legacyCapture
  })

  afterEach(() => {
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('exports a .birdbrain archive with header, data, manifest, and files', async () => {
    const out = join(tempDir, 'case.birdbrain')
    await exportCaseArchive(caseId, out)
    const entries = readStoredZip(readFileSync(out))

    const header = JSON.parse(entries.get('package.json')!.toString('utf-8'))
    expect(header.schemaVersion).toBe(1)
    expect(header.generatedBy).toBe('Birdbrain')
    expect(header.signingPublicKeyPem).toContain('BEGIN PUBLIC KEY')
    expect(header.case).toMatchObject({
      id: caseId,
      name: 'Archive Test Case',
      description: 'A case for archive export'
    })
    expect(header.counts.captures).toBe(2)
    expect(header.counts.notes).toBe(1)
    expect(header.counts.tags).toBe(1)
    expect(header.counts.selectors).toBe(1)

    const data = JSON.parse(entries.get('data.json')!.toString('utf-8'))
    expect(data.case.id).toBe(caseId)
    expect(data.captures).toHaveLength(2)
    expect(data.notes).toHaveLength(1)
    expect(data.tags).toHaveLength(1)
    expect(data.captureTags).toHaveLength(1)
    expect(data.selectors).toHaveLength(1)
    expect(data.captureFavorites).toHaveLength(1)
    expect(data.annotations).toHaveLength(1)
    expect(data.annotationPins).toHaveLength(1)
    expect(data.selectorMatches).toHaveLength(0)
    expect(data.captureAnalyses).toHaveLength(0)
    expect(data.extractedData).toHaveLength(0)
    expect(data.captureArchiveRefs).toHaveLength(0)

    expect(entries.get('manifest.jsonl')).toBeDefined()
    expect(entries.get(`files/${mhtmlCaptureId}.mhtml`)).toBeDefined()
    expect(entries.get(`files/${mhtmlCaptureId}.png`)).toBeDefined()
    expect(entries.get(`files/${mhtmlCaptureId}.txt`)).toBeDefined()

    // every artifact hash in the header is correct
    for (const a of header.artifacts) {
      const buf = entries.get(a.path)!
      expect(createHash('sha256').update(buf).digest('hex')).toBe(a.sha256)
      expect(buf.length).toBe(a.sizeBytes)
    }
    // package.json itself is excluded from the artifact list (same rationale as evidence.json)
    expect(header.artifacts.some((a: { path: string }) => a.path === 'package.json')).toBe(false)

    // live manifest gained a signed archive-export entry and still verifies
    const chain = verifyManifestChain(join(getStorageRoot(), caseId))
    expect(chain.valid).toBe(true)
    const lines = readFileSync(join(getStorageRoot(), caseId, 'manifest.jsonl'), 'utf-8')
      .trim()
      .split('\n')
    const lastEntry = JSON.parse(lines.at(-1)!)
    expect(lastEntry.type).toBe('archive-export')
    expect(lastEntry.caseId).toBe(caseId)
    expect(lastEntry.packageHash).toBe(header.packageHash)
    expect(typeof lastEntry.signature).toBe('string')
  })

  it('refuses to export without an operator name', async () => {
    updateSettings({ operatorName: '' })
    await expect(exportCaseArchive(caseId, join(tempDir, 'x.birdbrain'))).rejects.toThrow(
      /operator name/i
    )
  })

  it('throws when the case does not exist', async () => {
    await expect(
      exportCaseArchive('does-not-exist', join(tempDir, 'missing.birdbrain'))
    ).rejects.toThrow(/case not found/i)
  })

  it('reports progress through collection, files, and completion', async () => {
    const out = join(tempDir, 'progress.birdbrain')
    const steps: Array<{ step: string; percent: number }> = []
    await exportCaseArchive(caseId, out, (step, percent) => steps.push({ step, percent }))

    expect(steps.length).toBeGreaterThan(0)
    expect(steps.at(-1)).toEqual({ step: 'Complete', percent: 100 })
    const percents = steps.map((s) => s.percent)
    for (let i = 1; i < percents.length; i++) {
      expect(percents[i]).toBeGreaterThanOrEqual(percents[i - 1])
    }
  })

  it('does not leave a partial archive on disk when the manifest append fails', async () => {
    const out = join(tempDir, 'orphan.birdbrain')
    // Corrupt the manifest file so appendManifestEntry's read of the head throws.
    const caseDir = join(getStorageRoot(), caseId)
    writeFileSync(join(caseDir, 'manifest.jsonl'), 'not valid json\n')

    await expect(exportCaseArchive(caseId, out)).rejects.toThrow()
    expect(existsSync(out)).toBe(false)
  })
})

describe('caseArchive inspect', () => {
  let tempDir: string
  let caseId: string
  let mhtmlCaptureId: string
  let archivePath: string

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'bb-case-archive-inspect-'))
    initStorage(join(tempDir, 'captures'))
    initDatabase(':memory:')
    resetInstallationId()
    initInstallationId(tempDir)
    resetSigningKey()
    initSigningKey(tempDir)
    initSettings(tempDir)
    updateSettings({ operatorName: 'Test Operator', operatorRole: '', operatorOrganization: '' })

    const c = createCase({ name: 'Test Case', description: 'A case for archive inspection' })
    caseId = c.id
    ensureCaseDir(caseId)
    const caseDir = join(getStorageRoot(), caseId)
    initManifest(caseDir)

    mhtmlCaptureId = 'capture-mhtml-1'
    const mhtmlBuf = Buffer.from('<html>mhtml content</html>')
    writeFileSync(getCapturePath(caseId, mhtmlCaptureId, 'mhtml'), mhtmlBuf)
    const contentHash = createHash('sha256').update(mhtmlBuf).digest('hex')
    const { entryHash } = appendManifestEntry(caseDir, {
      type: 'capture',
      captureId: mhtmlCaptureId,
      caseId,
      url: 'https://example.com/mhtml',
      timestamp: '2026-04-05T12:00:00.000Z',
      contentHash,
      sizeBytes: mhtmlBuf.length,
      operatorId: 'op-1',
      operatorName: 'Test Operator',
      toolVersion: '0.1.0'
    })
    insertCapture({
      id: mhtmlCaptureId,
      caseId,
      url: 'https://example.com/mhtml',
      title: 'MHTML Capture',
      hash: contentHash,
      timestamp: '2026-04-05T12:00:00.000Z',
      format: 'mhtml',
      mhtmlPath: `${mhtmlCaptureId}.mhtml`,
      sizeBytes: mhtmlBuf.length,
      manifestIndex: 0,
      entryHash,
      operatorId: 'op-1',
      operatorName: 'Test Operator'
    })

    const legacyBuf = Buffer.from('<html>legacy content</html>')
    const legacyCaptureId = 'capture-legacy-1'
    writeFileSync(getCapturePath(caseId, legacyCaptureId, 'html'), legacyBuf)
    insertCapture({
      id: legacyCaptureId,
      caseId,
      url: 'https://legacy.example.com',
      title: 'Legacy Capture',
      hash: createHash('sha256').update(legacyBuf).digest('hex'),
      timestamp: '2026-04-04T12:00:00.000Z'
    })

    archivePath = join(tempDir, 'case.birdbrain')
    await exportCaseArchive(caseId, archivePath)
  })

  afterEach(() => {
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('inspects a clean archive as valid', () => {
    const report = inspectCaseArchive(archivePath)
    expect(report.verification.overallValid).toBe(true)
    expect(report.verification.chainValid).toBe(true)
    expect(report.verification.artifactFailureCount).toBe(0)
    expect(report.verification.captureHashFailureCount).toBe(0)
    expect(report.caseName).toBe('Test Case')
    expect(report.caseDescription).toBe('A case for archive inspection')
    expect(report.schemaVersion).toBe(1)
    expect(report.sourceOperatorName).toBe('Test Operator')
    expect(typeof report.sourceInstallationId).toBe('string')
    expect(typeof report.exportedAt).toBe('string')
    expect(typeof report.toolVersion).toBe('string')
    expect(report.archivePath).toBe(archivePath)
    expect(report.counts.captures).toBe(2)
  })

  it('detects a tampered capture file', () => {
    tamperZipEntry(archivePath, `files/${mhtmlCaptureId}.mhtml`)
    const report = inspectCaseArchive(archivePath)
    expect(report.verification.overallValid).toBe(false)
    expect(report.verification.artifactFailureCount).toBeGreaterThan(0)
  })

  it('detects a tampered manifest', () => {
    tamperZipEntry(archivePath, 'manifest.jsonl')
    const report = inspectCaseArchive(archivePath)
    expect(report.verification.overallValid).toBe(false)
    expect(report.verification.chainValid).toBe(false)
  })

  it('refuses newer schema versions', () => {
    rewritePackageJson(archivePath, (h) => ({ ...h, schemaVersion: 99 }))
    expect(() => inspectCaseArchive(archivePath)).toThrow(/newer version/i)
  })

  it('does not write to disk or mutate the archive file', () => {
    const before = readFileSync(archivePath)
    inspectCaseArchive(archivePath)
    const after = readFileSync(archivePath)
    expect(after.equals(before)).toBe(true)
  })
})
