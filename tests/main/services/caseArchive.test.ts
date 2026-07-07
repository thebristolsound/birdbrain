import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'fs'
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
  createNote,
  listCaptures,
  listNotes,
  listSelectors,
  listTags,
  getTagsForCapture,
  searchCaptures
} from '@main/services/database'
import { initStorage, ensureCaseDir, getCapturePath } from '@main/services/storage'
import {
  initManifest,
  appendManifestEntry,
  verifyManifestChain
} from '@main/services/manifest'
import { getStorageRoot } from '@main/services/storage'
import { getDb } from '@main/services/database'
import { initSettings, updateSettings } from '@main/services/settings'
import { initInstallationId, resetInstallationId } from '@main/services/installationId'
import { initSigningKey, resetSigningKey } from '@main/services/signingKey'
import { readStoredZip } from '@main/services/zipRead'
import { createStoredZip } from '@main/services/zip'
import {
  exportCaseArchive,
  inspectCaseArchive,
  importCaseArchive
} from '@main/services/caseArchive'
import { canonicalStringify } from '@shared/verify'

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

// Rewrites data.json's parsed content via `mutate`, then repairs the header so
// verification still passes: updates data.json's artifact hash/size and
// re-derives packageHash. Used to force an import DB failure WITHOUT tripping
// tamper detection — the point of the "cleanup on failure" test.
function rewriteDataJson(
  archivePath: string,
  mutate: (data: Record<string, unknown>) => Record<string, unknown>
): void {
  const entries = readStoredZip(readFileSync(archivePath))
  const data = JSON.parse(entries.get('data.json')!.toString('utf-8'))
  const mutatedBuf = Buffer.from(JSON.stringify(mutate(data), null, 2))
  entries.set('data.json', mutatedBuf)

  const header = JSON.parse(entries.get('package.json')!.toString('utf-8'))
  const newHash = createHash('sha256').update(mutatedBuf).digest('hex')
  header.artifacts = header.artifacts.map((a: { path: string }) =>
    a.path === 'data.json'
      ? { path: 'data.json', sha256: newHash, sizeBytes: mutatedBuf.length }
      : a
  )
  const sorted = [...header.artifacts].sort((a: { path: string }, b: { path: string }) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0
  )
  header.packageHash = createHash('sha256')
    .update(Buffer.from(canonicalStringify(sorted), 'utf-8'))
    .digest('hex')
  entries.set('package.json', Buffer.from(JSON.stringify(header, null, 2)))

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
    expect(report.verification.captureHashFailureCount).toBeGreaterThan(0)
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

  it('throws a clean error when package.json is corrupted JSON', () => {
    const entries = readStoredZip(readFileSync(archivePath))
    entries.set('package.json', Buffer.from('{ not valid json'))
    const rebuilt = [...entries.entries()].map(([name, data]) => ({ name, data }))
    writeFileSync(archivePath, createStoredZip(rebuilt))

    expect(() => inspectCaseArchive(archivePath)).toThrow(/Not a valid Birdbrain archive/)
  })

  it('throws a clean error when data.json is missing', () => {
    const entries = readStoredZip(readFileSync(archivePath))
    entries.delete('data.json')
    // remove data.json's declared artifact entry too so this isn't conflated
    // with the "extraneous/missing artifact" check — we want to isolate the
    // "data.json itself is absent" path.
    const header = JSON.parse(entries.get('package.json')!.toString('utf-8'))
    header.artifacts = header.artifacts.filter((a: { path: string }) => a.path !== 'data.json')
    entries.set('package.json', Buffer.from(JSON.stringify(header, null, 2)))
    const rebuilt = [...entries.entries()].map(([name, data]) => ({ name, data }))
    writeFileSync(archivePath, createStoredZip(rebuilt))

    expect(() => inspectCaseArchive(archivePath)).toThrow(/Not a valid Birdbrain archive/)
  })

  it('throws a clean error when data.json is corrupted JSON', () => {
    const entries = readStoredZip(readFileSync(archivePath))
    entries.set('data.json', Buffer.from('{ not valid json'))
    const rebuilt = [...entries.entries()].map(([name, data]) => ({ name, data }))
    writeFileSync(archivePath, createStoredZip(rebuilt))

    expect(() => inspectCaseArchive(archivePath)).toThrow(/Not a valid Birdbrain archive/)
  })

  it('detects a tampered packageHash field', () => {
    rewritePackageJson(archivePath, (h) => ({ ...h, packageHash: 'f'.repeat(64) }))
    const report = inspectCaseArchive(archivePath)
    expect(report.verification.overallValid).toBe(false)
    expect(report.verification.artifactFailureCount).toBeGreaterThan(0)
  })

  it('detects an extraneous undeclared zip entry', () => {
    const entries = readStoredZip(readFileSync(archivePath))
    entries.set('files/extra.bin', Buffer.from('undeclared content'))
    const rebuilt = [...entries.entries()].map(([name, data]) => ({ name, data }))
    writeFileSync(archivePath, createStoredZip(rebuilt))

    const report = inspectCaseArchive(archivePath)
    expect(report.verification.overallValid).toBe(false)
    expect(report.verification.artifactFailureCount).toBeGreaterThan(0)
  })
})

describe('caseArchive import', () => {
  let tempDir: string
  let caseId: string
  let mhtmlCaptureId: string
  let legacyCaptureId: string
  let archivePath: string
  let originalCaptureIds: string[]
  let originalHashes: string[]
  const taggedCaptureUrl = 'https://example.com/mhtml'
  // Single FTS5 token (no hyphens — those parse as column filters in MATCH).
  const distinctiveText = 'distinctivetextfromtxtsidecar'

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'bb-case-archive-import-'))
    initStorage(join(tempDir, 'captures'))
    initDatabase(':memory:')
    resetInstallationId()
    initInstallationId(tempDir)
    resetSigningKey()
    initSigningKey(tempDir)
    initSettings(tempDir)
    updateSettings({ operatorName: 'Test Operator', operatorRole: '', operatorOrganization: '' })

    const c = createCase({ name: 'Import Source Case', description: 'Source for import' })
    caseId = c.id
    ensureCaseDir(caseId)
    const caseDir = join(getStorageRoot(), caseId)
    initManifest(caseDir)

    // Capture 1: mhtml + png + txt (with distinctive text), manifest-backed.
    // Modeled as a background recapture superseding the legacy capture, so the
    // round-trip exercises the v23 method/supersedes columns and the FK remap.
    mhtmlCaptureId = 'capture-mhtml-1'
    legacyCaptureId = 'capture-legacy-1'
    const mhtmlBuf = Buffer.from('<html>mhtml content</html>')
    const pngBuf = Buffer.from('fake-png-bytes')
    const txtBuf = Buffer.from(distinctiveText)
    writeFileSync(getCapturePath(caseId, mhtmlCaptureId, 'mhtml'), mhtmlBuf)
    writeFileSync(getCapturePath(caseId, mhtmlCaptureId, 'png'), pngBuf)
    writeFileSync(getCapturePath(caseId, mhtmlCaptureId, 'txt'), txtBuf)
    const contentHash = createHash('sha256').update(mhtmlBuf).digest('hex')
    const { entryHash } = appendManifestEntry(caseDir, {
      type: 'capture',
      captureId: mhtmlCaptureId,
      caseId,
      url: taggedCaptureUrl,
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
      url: taggedCaptureUrl,
      title: 'MHTML Capture',
      hash: contentHash,
      timestamp: '2026-04-05T12:00:00.000Z',
      format: 'mhtml',
      mhtmlPath: `${mhtmlCaptureId}.mhtml`,
      sizeBytes: mhtmlBuf.length,
      manifestIndex: 0,
      entryHash,
      operatorId: 'op-1',
      operatorName: 'Test Operator',
      method: 'background',
      supersedesCaptureId: legacyCaptureId
    })

    // Capture 2: legacy html-only capture, no manifest entry.
    const legacyBuf = Buffer.from('<html>legacy content</html>')
    const legacyHash = createHash('sha256').update(legacyBuf).digest('hex')
    writeFileSync(getCapturePath(caseId, legacyCaptureId, 'html'), legacyBuf)
    insertCapture({
      id: legacyCaptureId,
      caseId,
      url: 'https://legacy.example.com',
      title: 'Legacy Capture',
      hash: legacyHash,
      timestamp: '2026-04-04T12:00:00.000Z'
    })

    originalCaptureIds = [mhtmlCaptureId, legacyCaptureId]
    originalHashes = [contentHash, legacyHash]

    createNote({ caseId, captureId: mhtmlCaptureId, title: 'Note 1', body: 'Body text' })

    const tag = createTag({ name: 'Evidence', color: '#00ff00' })
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

    archivePath = join(tempDir, 'case.birdbrain')
    await exportCaseArchive(caseId, archivePath)
  })

  afterEach(() => {
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('round-trips a case: every table, files, and a verifying chain', async () => {
    const { newCaseId } = await importCaseArchive(archivePath)
    expect(newCaseId).not.toBe(caseId)

    const imported = listCaptures(newCaseId)
    expect(imported).toHaveLength(2)
    expect(imported.map((c) => c.hash).sort()).toEqual([...originalHashes].sort())
    expect(listNotes(newCaseId)).toHaveLength(1)
    expect(listSelectors(newCaseId)).toHaveLength(1)

    // files landed under the new case dir, named by each capture's (possibly
    // remapped) id — the source case is still present here so ids collide.
    const importedMhtml = imported.find((c) => c.url === taggedCaptureUrl)!
    expect(existsSync(join(getStorageRoot(), newCaseId, `${importedMhtml.id}.mhtml`))).toBe(true)

    // v23 provenance survives the round-trip; the supersedes FK is remapped to
    // the imported sibling's (possibly remapped) id, not the source id.
    const importedLegacy = imported.find((c) => c.url === 'https://legacy.example.com')!
    expect(importedMhtml.method).toBe('background')
    expect(importedMhtml.supersedesCaptureId).toBe(importedLegacy.id)

    // chain: source entries + import entry all verify (single instance: same key)
    const chain = verifyManifestChain(join(getStorageRoot(), newCaseId))
    expect(chain.valid).toBe(true)
    const lines = readFileSync(join(getStorageRoot(), newCaseId, 'manifest.jsonl'), 'utf-8')
      .trim()
      .split('\n')
    const last = JSON.parse(lines.at(-1)!)
    expect(last.type).toBe('import')
    expect(last.caseId).toBe(newCaseId)

    // FTS works for imported content (from the staged .txt sidecar)
    expect(searchCaptures(distinctiveText).length).toBeGreaterThan(0)
  })

  it('keeps original ids when free (source rows absent)', async () => {
    // Simulate importing into a clean instance: drop the source case so ids are free.
    getDb().prepare('DELETE FROM captures_fts').run()
    getDb().prepare('DELETE FROM cases WHERE id = ?').run(caseId)

    const { newCaseId } = await importCaseArchive(archivePath)
    const imported = listCaptures(newCaseId)
    expect(imported.map((c) => c.id).sort()).toEqual([...originalCaptureIds].sort())
    // tag still attached to the mhtml capture
    expect(getTagsForCapture(mhtmlCaptureId)).toHaveLength(1)
  })

  it('re-import remaps colliding capture ids consistently and records the map', async () => {
    const first = await importCaseArchive(archivePath)
    const second = await importCaseArchive(archivePath)
    const captures2 = listCaptures(second.newCaseId)
    expect(captures2).toHaveLength(2)
    // ids differ from the originals now (source case rows already occupy them)
    expect(captures2.map((c) => c.id).sort()).not.toEqual([...originalCaptureIds].sort())
    // FKs intact: tag still attached to the remapped capture
    const remappedTagged = captures2.find((c) => c.url === taggedCaptureUrl)!
    expect(getTagsForCapture(remappedTagged.id)).toHaveLength(1)
    // id map file written
    const mapPath = join(getStorageRoot(), second.newCaseId, 'import-id-map.json')
    expect(existsSync(mapPath)).toBe(true)
    // and files are named by the NEW ids
    expect(existsSync(join(getStorageRoot(), second.newCaseId, `${remappedTagged.id}.mhtml`))).toBe(
      true
    )
    void first
  })

  it('merges tags by name instead of duplicating', async () => {
    // 'Evidence' already exists locally (created in the source fixture).
    const { newCaseId } = await importCaseArchive(archivePath)
    const all = listTags().filter((t) => t.name.toLowerCase() === 'evidence')
    expect(all).toHaveLength(1)
    void newCaseId
  })

  it('blocks tampered archives unless overridden, and records the override', async () => {
    tamperZipEntry(archivePath, `files/${mhtmlCaptureId}.mhtml`)
    await expect(importCaseArchive(archivePath)).rejects.toThrow(/failed verification/i)
    const { newCaseId } = await importCaseArchive(archivePath, { overrideTamper: true })
    const lines = readFileSync(join(getStorageRoot(), newCaseId, 'manifest.jsonl'), 'utf-8')
      .trim()
      .split('\n')
    const last = JSON.parse(lines.at(-1)!)
    expect(last.type).toBe('import')
    expect(last.verificationResult.overallValid).toBe(false)
  })

  it('requires an operator name', async () => {
    updateSettings({ operatorName: '' })
    await expect(importCaseArchive(archivePath)).rejects.toThrow(/operator name/i)
  })

  it('cleans up staging and the moved case dir on failure', async () => {
    // Null out the case row's NOT NULL name so the cases INSERT fails inside the
    // transaction — which runs AFTER renameSync(stagingDir → caseDir), so this
    // exercises the post-move rmSync(caseDir) cleanup, not just staging removal.
    rewriteDataJson(archivePath, (d) => ({
      ...d,
      case: { ...(d.case as Record<string, unknown>), name: null }
    }))
    const dirsBefore = [...readdirSync(getStorageRoot())].sort()
    await expect(importCaseArchive(archivePath)).rejects.toThrow()
    // Neither an orphaned staging dir nor the renamed case dir survives.
    expect([...readdirSync(getStorageRoot())].sort()).toEqual(dirsBefore)
  })

  it('rejects an archive with a path-traversal file entry (zip-slip)', async () => {
    const entries = readStoredZip(readFileSync(archivePath))
    entries.set('files/../evil.txt', Buffer.from('pwned'))
    const rebuilt = [...entries.entries()].map(([name, data]) => ({ name, data }))
    writeFileSync(archivePath, createStoredZip(rebuilt))
    await expect(importCaseArchive(archivePath)).rejects.toThrow(/not a valid Birdbrain archive/i)
  })
})
