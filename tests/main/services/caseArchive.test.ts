import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync
} from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createHash } from 'crypto'
import { initDatabase, closeDatabase } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import {
  insertCapture,
  toggleFavorite,
  listCaptures,
  searchCaptures
} from '@main/services/db/captureRepo'
import {
  createTag,
  addTagToCapture,
  addTagToNote,
  listTags,
  getTagsForCapture,
  getTagsForNote
} from '@main/services/db/tagRepo'
import { createSelector, listSelectors } from '@main/services/db/selectorRepo'
import { createNote, listNotes } from '@main/services/db/noteRepo'
import { referencesForNote } from '@main/services/db/noteReferenceRepo'
import { getDb } from '@main/services/db/core'
import { initStorage, ensureCaseDir, getStorageRoot } from '@main/services/storage'
import { defaultCaptureStore } from '@main/services/captureStore'
import {
  initManifest,
  appendManifestEntry,
  readEntries,
  verifyManifestChain
} from '@main/services/manifest'
import { initSettings, updateSettings } from '@main/services/settings'
import { initInstallationId, resetInstallationId } from '@main/services/installationId'
import { initSigningKey, resetSigningKey } from '@main/services/signingKey'
import { readStoredZip } from '@main/services/zipRead'
import { createStoredZip } from '@main/services/zip'
import {
  collectCaseData,
  exportCaseArchive,
  inspectCaseArchive,
  importCaseArchive,
  CASE_ARCHIVE_SCHEMA_VERSION
} from '@main/services/caseArchive'
import { UNDATED_TAG_CREATED_AT } from '@main/services/db/migrations'
import { canonicalStringify } from '@shared/verify'
import { createCaptureLifecycle, verifyCapture } from '@main/services/captureLifecycle'
import { createSelectorLifecycle } from '@main/services/selectorLifecycle'
import { findOrphans } from '@main/services/db/dbAdmin'
import { ensureCaseFields } from '@main/services/search/fieldIndex'
import { getExhibitSearchBuild } from '@main/services/db/searchFieldRepo'
import { appendFutureEntry } from '../../helpers/futureManifestEntry'
import { insertDerivedFile, listDerivedFilesForCase } from '@main/services/db/derivedFileRepo'
import { verifyCaseDerivedFiles } from '@main/services/exhibits'
import { backfillCase } from '@main/services/exhibitBackfill'
import {
  downgradeToVersion10,
  rewriteArchive,
  signDerivedFile
} from '../../helpers/archiveDerivedFiles'

const artifactPath = (caseId: string, captureId: string, type: 'mhtml' | 'html' | 'png' | 'txt') =>
  defaultCaptureStore.artifactPaths(caseId, captureId, type).abs

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

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'bb-case-archive-'))
    initStorage(join(tempDir, 'captures'))
    await initDatabase(':memory:')
    resetInstallationId()
    initInstallationId(tempDir)
    resetSigningKey()
    initSigningKey(tempDir, { confirmUnprotectedKey: () => true })
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
    writeFileSync(artifactPath(caseId, mhtmlCaptureId, 'mhtml'), mhtmlBuf)
    writeFileSync(artifactPath(caseId, mhtmlCaptureId, 'png'), pngBuf)
    writeFileSync(artifactPath(caseId, mhtmlCaptureId, 'txt'), txtBuf)
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

  // Pinned as a literal, deliberately, and only here, so a bump is an act
  // rather than drift.
  //
  // 5 since #827: duplicate provenance travels in the archive, and a pre-#827
  // Birdbrain hits both bump arms — its strict manifest schema reports the
  // `method: 'duplicate'` entry as failed verification (a false tamper
  // reading), and an override import silently drops duplicate_of_capture_id.
  // 4 since #391: data.json carries a `noteTags` table, and a pre-v32
  // Birdbrain has no `note_tags` table to import it into — every tag raised
  // from a note would be silently dropped, which is exactly what the
  // constant's doc comment says to bump for. Contrast #400, where the
  // maintainer ruled no bump on 2026-08-19 for two added case columns; that
  // tension was recorded here and is preserved by this comment.
  // 6 since #1148: `exhibits` and `stagingFiles` in data.json, non-Capture
  // Exhibit bytes and `staged` pooled bytes in the zip, which a pre-v34 build
  // has no table or directory for.
  // 8 since Shared Cases (#1511): a pre-8 build would import the exporter's
  // chain alone and drop every other member's.
  // 9 since per-author working-layer keys (#1512): a pre-9 build would drop
  // the author columns, merge two members' same-name tags into one, and fail
  // the import outright on two members' annotation layers on one Capture.
  // 10 since the investigation records (#1909): a pre-10 build would import
  // the Case without its decisions, marks and run records.
  // 11 since Derived Files travel (#1813): a pre-11 build passes the checks
  // and then rejects the nested files/derived/ entry, abandoning the import.
  it('keeps CASE_ARCHIVE_SCHEMA_VERSION at 11 since Derived Files travel', () => {
    expect(CASE_ARCHIVE_SCHEMA_VERSION).toBe(11)
  })

  it('exports a .birdbrain archive with header, data, manifest, and files', async () => {
    const out = join(tempDir, 'case.birdbrain')
    await exportCaseArchive(caseId, out)
    const entries = readStoredZip(readFileSync(out))

    const header = JSON.parse(entries.get('package.json')!.toString('utf-8'))
    expect(header.schemaVersion).toBe(CASE_ARCHIVE_SCHEMA_VERSION)
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

  // AI analysis was removed. Rows an older release left in capture_analyses stay
  // in the database but no longer travel; the key is written empty because a
  // release from before the removal iterates it unguarded on import.
  it('writes an empty captureAnalyses table even when analysis rows exist', async () => {
    const now = new Date().toISOString()
    getDb()
      .prepare(
        `INSERT INTO capture_analyses (id, capture_id, case_id, content, model, token_usage, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run('analysis-1', mhtmlCaptureId, caseId, 'stored analysis', 'test/model', '{}', now, now)
    const out = join(tempDir, 'case.birdbrain')
    await exportCaseArchive(caseId, out)
    const entries = readStoredZip(readFileSync(out))
    const data = JSON.parse(entries.get('data.json')!.toString('utf-8'))
    expect(data.captureAnalyses).toEqual([])
    expect(entries.get('data.json')!.toString('utf-8')).not.toContain('stored analysis')
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

// Replaces the manifest with `mutate`'s output and repairs the header the way
// a genuine export would have written it, so only the chain decides the verdict.
function rewriteManifest(archivePath: string, mutate: (jsonl: string) => string): void {
  const entries = readStoredZip(readFileSync(archivePath))
  const manifest = Buffer.from(mutate(entries.get('manifest.jsonl')!.toString('utf-8')))
  entries.set('manifest.jsonl', manifest)

  const header = JSON.parse(entries.get('package.json')!.toString('utf-8'))
  const sha256 = createHash('sha256').update(manifest).digest('hex')
  header.artifacts = header.artifacts.map((a: { path: string }) =>
    a.path === 'manifest.jsonl' ? { path: a.path, sha256, sizeBytes: manifest.length } : a
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

describe('caseArchive inspect', () => {
  let tempDir: string
  let caseId: string
  let mhtmlCaptureId: string
  let archivePath: string

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'bb-case-archive-inspect-'))
    initStorage(join(tempDir, 'captures'))
    await initDatabase(':memory:')
    resetInstallationId()
    initInstallationId(tempDir)
    resetSigningKey()
    initSigningKey(tempDir, { confirmUnprotectedKey: () => true })
    initSettings(tempDir)
    updateSettings({ operatorName: 'Test Operator', operatorRole: '', operatorOrganization: '' })

    const c = createCase({ name: 'Test Case', description: 'A case for archive inspection' })
    caseId = c.id
    ensureCaseDir(caseId)
    const caseDir = join(getStorageRoot(), caseId)
    initManifest(caseDir)

    mhtmlCaptureId = 'capture-mhtml-1'
    const mhtmlBuf = Buffer.from('<html>mhtml content</html>')
    writeFileSync(artifactPath(caseId, mhtmlCaptureId, 'mhtml'), mhtmlBuf)
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
    writeFileSync(artifactPath(caseId, legacyCaptureId, 'html'), legacyBuf)
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
    expect(report.schemaVersion).toBe(CASE_ARCHIVE_SCHEMA_VERSION)
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

  // KAT (X25): a signed entry from a newer schema is reported as its own
  // outcome, never as an invalid custody chain.
  it('reports a chain holding a newer-schema entry as verifier too old', () => {
    rewriteManifest(archivePath, (jsonl) => appendFutureEntry(jsonl, caseId))
    const report = inspectCaseArchive(archivePath)
    expect(report.verifierTooOld?.reason).toContain("Entry type 'annotation-burn'")
    expect(report.verifierTooOld?.reason).toContain('verifier too old')
    expect(report.verification.chainValid).toBe(false)
    expect(report.verification.overallValid).toBe(false)
    expect(report.verification.artifactFailureCount).toBe(0)
    expect(report.verification.captureHashFailureCount).toBe(0)
  })

  it('reports an edited entry that also claims a newer schema as a broken chain', () => {
    rewriteManifest(archivePath, (jsonl) => {
      const lines = jsonl.split('\n').filter((l) => l.trim())
      lines[0] = JSON.stringify({
        ...JSON.parse(lines[0]),
        url: 'https://elsewhere.example',
        schemaVersion: 99
      })
      return lines.join('\n') + '\n'
    })
    const report = inspectCaseArchive(archivePath)
    expect(report.verifierTooOld).toBeUndefined()
    expect(report.verification.chainValid).toBe(false)
    expect(report.verification.chainReason).toBe('Entry hash mismatch')
  })

  it('leaves the too-old field off a clean archive', () => {
    expect(inspectCaseArchive(archivePath).verifierTooOld).toBeUndefined()
  })

  it('refuses newer schema versions', () => {
    rewritePackageJson(archivePath, (h) => ({ ...h, schemaVersion: 99 }))
    expect(() => inspectCaseArchive(archivePath)).toThrow(/newer version/i)
  })

  // The gate is the whole point of the #389 bump: a Birdbrain one version
  // behind must refuse a mention-bearing archive with the worded message
  // rather than fail opaquely mid-import on a node type it cannot parse. An
  // off-by-one here (>= vs >) would let exactly that archive through.
  it('refuses an archive exactly one version newer, and accepts its own version', () => {
    rewritePackageJson(archivePath, (h) => ({
      ...h,
      schemaVersion: CASE_ARCHIVE_SCHEMA_VERSION + 1
    }))
    expect(() => inspectCaseArchive(archivePath)).toThrow(/newer version/i)

    rewritePackageJson(archivePath, (h) => ({ ...h, schemaVersion: CASE_ARCHIVE_SCHEMA_VERSION }))
    expect(inspectCaseArchive(archivePath).schemaVersion).toBe(CASE_ARCHIVE_SCHEMA_VERSION)
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
  let mentionNoteId: string
  let plainNoteId: string
  const noteOnlyTagName = 'Analyst note'
  const taggedCaptureUrl = 'https://example.com/mhtml'
  // Single FTS5 token (no hyphens — those parse as column filters in MATCH).
  const distinctiveText = 'distinctivetextfromtxtsidecar'

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'bb-case-archive-import-'))
    initStorage(join(tempDir, 'captures'))
    await initDatabase(':memory:')
    resetInstallationId()
    initInstallationId(tempDir)
    resetSigningKey()
    initSigningKey(tempDir, { confirmUnprotectedKey: () => true })
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
    writeFileSync(artifactPath(caseId, mhtmlCaptureId, 'mhtml'), mhtmlBuf)
    writeFileSync(artifactPath(caseId, mhtmlCaptureId, 'png'), pngBuf)
    writeFileSync(artifactPath(caseId, mhtmlCaptureId, 'txt'), txtBuf)
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
      mhtmlPath: `${caseId}/${mhtmlCaptureId}.mhtml`,
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
    writeFileSync(artifactPath(caseId, legacyCaptureId, 'html'), legacyBuf)
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

    const plainNote = createNote({
      caseId,
      captureId: mhtmlCaptureId,
      title: 'Note 1',
      body: 'Body text'
    })

    const tag = createTag({ name: 'Evidence', color: '#00ff00' })
    addTagToCapture({ captureId: mhtmlCaptureId, tagId: tag.id })

    const selector = createSelector({
      caseId,
      pattern: 'foo',
      isRegex: false,
      label: 'Foo selector'
    })

    // A note carrying one Mention of each target type (#389). Re-import lands
    // in this same database with the source rows still present, so every
    // remappable id collides and the round-trip below sees the remap rather
    // than a lucky pass-through.
    mentionNoteId = createNote({
      caseId,
      title: 'Mentions',
      bodyDoc: JSON.stringify({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'links: ' },
              {
                type: 'mention',
                attrs: { targetType: 'capture', targetId: mhtmlCaptureId, label: 'stale' }
              },
              {
                type: 'mention',
                attrs: { targetType: 'selector', targetId: selector.id, label: '' }
              },
              { type: 'mention', attrs: { targetType: 'tag', targetId: tag.id, label: '' } },
              { type: 'mention', attrs: { targetType: 'note', targetId: plainNote.id, label: '' } }
            ]
          }
        ]
      })
    }).id

    toggleFavorite(mhtmlCaptureId)

    // Note-level tags (#391). `Evidence` also hangs off a capture, so it would
    // reach the archive through capture_tags regardless; the note-only tag is
    // carried by nothing but this note, which is the case that fails if
    // collectTagsForCase ignores the note_tags relation.
    plainNoteId = plainNote.id
    addTagToNote({ noteId: plainNote.id, tagId: tag.id })
    addTagToNote({ noteId: plainNote.id, tagId: createTag({ name: noteOnlyTagName }).id })

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
    expect(listNotes(newCaseId)).toHaveLength(2)
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

  // Case search field records are a cache outside the archive (ADR-0044): the export
  // leaves them out, and the imported Case builds its own from the imported files.
  it('leaves the search field records out of the archive, and the import builds them again', async () => {
    writeFileSync(
      artifactPath(caseId, legacyCaptureId, 'txt'),
      'From: Odile Marsh <odile@marsh-post.example.org>\nMessage-ID: <z9@marsh>\n'
    )
    expect(await ensureCaseFields(caseId)).toEqual({ indexed: 2, noSource: 0, failed: 0 })
    const withFields = join(tempDir, 'with-fields.birdbrain')
    await exportCaseArchive(caseId, withFields)

    const data = readStoredZip(readFileSync(withFields)).get('data.json')!.toString('utf-8')
    expect(data).not.toMatch(/exhibit_search|header\.from|header\.message-id|text\.address/)

    const { newCaseId } = await importCaseArchive(withFields)
    const imported = listCaptures(newCaseId)
    expect(imported.map((c) => getExhibitSearchBuild(c.id))).toEqual([undefined, undefined])

    expect(await ensureCaseFields(newCaseId)).toEqual({ indexed: 2, noSource: 0, failed: 0 })
    const legacy = imported.find((c) => c.url === 'https://legacy.example.com')!
    expect(getExhibitSearchBuild(legacy.id)).toMatchObject({
      caseId: newCaseId,
      contentHash: legacy.hash,
      outcome: 'built'
    })
    expect(
      getDb()
        .prepare('SELECT field, norm FROM exhibit_search_fields WHERE exhibit_id = ? ORDER BY id')
        .all(legacy.id)
    ).toEqual([
      { field: 'header.from', norm: 'odile@marsh-post.example.org' },
      { field: 'header.message-id', norm: '<z9@marsh>' },
      { field: 'text.address', norm: 'odile@marsh-post.example.org' }
    ])
  })

  it('keeps original ids when free (source rows absent)', async () => {
    // Simulate importing into a clean instance: drop the source case so ids are
    // free. The cascade (captures → capture_texts → trigger) cleans the index.
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

  // #1592: the import writes each file under the new case and id, so the row
  // must name that file. Left verbatim, it named the source case's file: on
  // this same install verify hashed the source's bytes, and elsewhere it found
  // nothing.
  it("re-import points each capture at its own file, not the source case's", async () => {
    const { newCaseId } = await importCaseArchive(archivePath)
    const imported = listCaptures(newCaseId).find((c) => c.url === taggedCaptureUrl)!
    expect(imported.id).not.toBe(mhtmlCaptureId)
    expect(imported.mhtmlPath).toBe(`${newCaseId}/${imported.id}.mhtml`)

    writeFileSync(artifactPath(caseId, mhtmlCaptureId, 'mhtml'), 'source bytes changed')
    const verification = await verifyCapture(imported.id)
    expect(verification.computedHash).toBe(originalHashes[0])
  })

  // #1523 known-answer: the exporter's saved verification result travels in
  // data.json and the import writes null over it, so the imported Capture has
  // no lastVerifiedStatus, which the Overview counts as unverified
  // (tests/renderer/overviewModel.test.ts). The signed import entry is built
  // from the inspection, not the rows, so clearing them leaves it as it was.
  it('imports a Capture the exporter verified as unverified, with the import entry unchanged', async () => {
    expect((await verifyCapture(mhtmlCaptureId)).status).toBe('verified')
    const verifiedArchive = join(tempDir, 'verified.birdbrain')
    await exportCaseArchive(caseId, verifiedArchive)
    const data = JSON.parse(
      readStoredZip(readFileSync(verifiedArchive)).get('data.json')!.toString('utf-8')
    ) as { captures: Array<Record<string, unknown>> }
    const exported = data.captures.find((row) => row.id === mhtmlCaptureId)!
    expect(exported.last_verified_status).toBe('verified')
    expect(exported.last_verified_at).toEqual(expect.any(String))
    expect(exported.last_verified_hash).toBe(originalHashes[0])

    const report = inspectCaseArchive(verifiedArchive)
    const { newCaseId } = await importCaseArchive(verifiedArchive)

    const entry = readEntries(
      readFileSync(join(getStorageRoot(), newCaseId, 'manifest.jsonl'), 'utf-8')
    ).find((e) => e.type === 'import')!
    expect(Object.keys(entry).sort()).toEqual([
      'caseId',
      'entryHash',
      'idMapSha256',
      'index',
      'operatorId',
      'operatorName',
      'packageHash',
      'prevHash',
      'schemaVersion',
      'signature',
      'sourceCaseId',
      'sourceInstallationId',
      'sourcePublicKeyPem',
      'timestamp',
      'toolVersion',
      'type',
      'verificationResult'
    ])
    expect(entry.verificationResult).toEqual(report.verification)
    expect(entry.verificationResult).toEqual({
      overallValid: true,
      chainValid: true,
      artifactCount: report.verification.artifactCount,
      artifactFailureCount: 0,
      captureCount: 2,
      captureHashFailureCount: 0
    })

    const imported = listCaptures(newCaseId)
    expect(imported).toHaveLength(2)
    for (const capture of imported) {
      expect(capture.lastVerifiedStatus).toBeUndefined()
      expect(capture.lastVerifiedAt).toBeUndefined()
      expect(capture.lastVerifiedHash).toBeUndefined()
    }
  })

  // #391 known-answer: export a case whose note carries two tags — one shared
  // with a capture, one reachable only through note_tags — and import it back
  // into the database that still holds the source rows, so every note id
  // collides and both tags merge by name. The imported note must carry the
  // same two tags, resolved to the LOCAL merged tag rows.
  it('carries note tags through import with note ids remapped and tags merged by name', async () => {
    const before = getTagsForNote(plainNoteId)
      .map((t) => t.name)
      .sort()
    expect(before).toEqual(['Analyst note', 'Evidence'])

    const { newCaseId } = await importCaseArchive(archivePath)

    const importedNote = listNotes(newCaseId).find((n) => n.title === 'Note 1')!
    expect(importedNote.id).not.toBe(plainNoteId) // remapped: the source row still holds that id
    const importedTags = getTagsForNote(importedNote.id)
    expect(importedTags.map((t) => t.name).sort()).toEqual(['Analyst note', 'Evidence'])
    // Merged, not duplicated: the imported links point at the local tag rows.
    expect(importedTags.map((t) => t.id).sort()).toEqual(
      getTagsForNote(plainNoteId)
        .map((t) => t.id)
        .sort()
    )
    expect(listTags().filter((t) => t.name === noteOnlyTagName)).toHaveLength(1)
  })

  // A .birdbrain written before schemaVersion 4 has no `noteTags` key at all.
  // It must import as a case whose notes carry no tags — which is what it is —
  // rather than throwing on the missing table.
  it('imports a pre-noteTags archive as a case whose notes carry no tags', async () => {
    const entries = readStoredZip(readFileSync(archivePath))
    const data = JSON.parse(entries.get('data.json')!.toString('utf-8')) as Record<string, unknown>
    delete data.noteTags
    entries.set('data.json', Buffer.from(JSON.stringify(data, null, 2)))
    const rebuilt = [...entries.entries()].map(([name, buf]) => ({ name, data: buf }))
    writeFileSync(archivePath, createStoredZip(rebuilt))

    // The rewrite invalidates the recorded artifact hash, so this is an
    // override-tamper import; the assertion is about the missing key, not the
    // verification result.
    const { newCaseId } = await importCaseArchive(archivePath, { overrideTamper: true })
    const importedNote = listNotes(newCaseId).find((n) => n.title === 'Note 1')!
    expect(getTagsForNote(importedNote.id)).toEqual([])
  })

  // An archive written while AI analysis existed carries its rows. It still
  // verifies and imports, and the rows are dropped rather than inserted.
  it('imports an archive carrying analysis rows and drops them', async () => {
    const now = new Date().toISOString()
    rewriteDataJson(archivePath, (d) => ({
      ...d,
      captureAnalyses: [
        {
          id: 'analysis-1',
          capture_id: mhtmlCaptureId,
          case_id: caseId,
          content: 'stored analysis',
          model: 'test/model',
          token_usage: '{"prompt":1,"completion":1,"total":2}',
          created_at: now,
          updated_at: now
        }
      ]
    }))

    const { newCaseId, report } = await importCaseArchive(archivePath)
    expect(report.verification.overallValid).toBe(true)
    expect(listCaptures(newCaseId)).toHaveLength(2)
    expect(listNotes(newCaseId)).toHaveLength(2)
    const analyses = getDb()
      .prepare('SELECT COUNT(*) AS n FROM capture_analyses WHERE case_id = ?')
      .get(newCaseId) as { n: number }
    expect(analyses.n).toBe(0)
  })

  it('merges tags by name instead of duplicating', async () => {
    // 'Evidence' already exists locally (created in the source fixture).
    const { newCaseId } = await importCaseArchive(archivePath)
    const all = listTags().filter((t) => t.name.toLowerCase() === 'evidence')
    expect(all).toHaveLength(1)
    void newCaseId
  })

  // #389 known-answer: export a mention-bearing case, import it back into the
  // database that still holds the source rows (so every remappable id
  // collides and the tag merges by name), and require the resolved references
  // to be the same set of targets — pointing at the IMPORTED rows. The index
  // itself never travels; this is what proves re-extraction reproduced it.
  it('carries note Mentions through import with ids remapped and references re-extracted', async () => {
    const before = referencesForNote(mentionNoteId)
    expect(before.map((r) => r.targetType)).toEqual(['capture', 'selector', 'tag', 'note'])

    const { newCaseId } = await importCaseArchive(archivePath)

    const importedMentionNote = listNotes(newCaseId).find((n) => n.title === 'Mentions')!
    const importedCapture = listCaptures(newCaseId).find((c) => c.url === taggedCaptureUrl)!
    const importedSelector = listSelectors(newCaseId)[0]
    const importedPlainNote = listNotes(newCaseId).find((n) => n.title === 'Note 1')!
    const mergedTag = listTags().find((t) => t.name.toLowerCase() === 'evidence')!

    const after = referencesForNote(importedMentionNote.id)
    expect(after).toEqual([
      {
        noteId: importedMentionNote.id,
        ord: 0,
        targetType: 'capture',
        targetId: importedCapture.id,
        label: 'MHTML Capture',
        resolved: true
      },
      {
        noteId: importedMentionNote.id,
        ord: 1,
        targetType: 'selector',
        targetId: importedSelector.id,
        label: 'Foo selector',
        resolved: true
      },
      {
        noteId: importedMentionNote.id,
        ord: 2,
        targetType: 'tag',
        targetId: mergedTag.id,
        label: mergedTag.name,
        resolved: true
      },
      {
        noteId: importedMentionNote.id,
        ord: 3,
        targetType: 'note',
        targetId: importedPlainNote.id,
        label: 'Note 1',
        resolved: true
      }
    ])
    // The remap actually happened for the collision-remapped types: the
    // imported references cite the new rows, not the source ones.
    expect(importedCapture.id).not.toBe(mhtmlCaptureId)
    expect(after.map((r) => ({ ord: r.ord, targetType: r.targetType, label: r.label }))).toEqual(
      before.map((r) => ({ ord: r.ord, targetType: r.targetType, label: r.label }))
    )

    // Derived state stays derived: no reference rows travel in the archive.
    const data = JSON.parse(
      readStoredZip(readFileSync(archivePath)).get('data.json')!.toString('utf-8')
    )
    expect(Object.keys(data)).not.toContain('noteReferences')
    expect(JSON.stringify(data)).not.toContain('note_references')
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

  // The explicit synthetic attribution the bundled demo case is seeded with
  // (#405, R7). It is an alternative NAME, never an exemption: an empty one
  // still fails the gate, a supplied one is what the custody entry records, and
  // the operator's own name is used whenever no override is given.
  it('records an explicitly supplied operator name on the import custody entry', async () => {
    updateSettings({ operatorName: '' })

    const { newCaseId } = await importCaseArchive(archivePath, {
      operatorName: 'Birdbrain demo fixture'
    })

    const entries = readEntries(
      readFileSync(join(getStorageRoot(), newCaseId, 'manifest.jsonl'), 'utf-8')
    )
    expect(entries.find((e) => e.type === 'import')?.operatorName).toBe('Birdbrain demo fixture')
  })

  it('refuses a blank explicit operator name just as it refuses a blank setting', async () => {
    updateSettings({ operatorName: '' })
    await expect(importCaseArchive(archivePath, { operatorName: '   ' })).rejects.toThrow(
      /operator name/i
    )
  })

  it('still records the local operator when no explicit name is supplied', async () => {
    const { newCaseId } = await importCaseArchive(archivePath)

    const entries = readEntries(
      readFileSync(join(getStorageRoot(), newCaseId, 'manifest.jsonl'), 'utf-8')
    )
    expect(entries.find((e) => e.type === 'import')?.operatorName).toBe('Test Operator')
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

  // #1512: per-author working-layer rows. A teammate (REMOTE) tagged the same
  // Capture with their own `Evidence`, annotated it, pinned it and wrote a
  // note carrying that tag, each row at its own version. The archive is
  // imported into a fresh database, where every id is free, so each row must
  // come back column for column apart from the Case id.
  describe('per-author working-layer rows (#1512)', () => {
    const REMOTE = 'installation-remote-0001'
    let remoteNoteId: string

    beforeEach(async () => {
      const db = getDb()
      db.prepare(
        `INSERT INTO tags (id, name, color, author_installation_id, version, created_at)
         VALUES ('remote-evidence', 'Evidence', '#0000ff', ?, 4, '2026-10-01T09:00:00.000Z')`
      ).run(REMOTE)
      db.prepare(
        `INSERT INTO exhibit_tags (exhibit_id, tag_id, author_installation_id, version, row_signature)
         VALUES (?, 'remote-evidence', ?, 5, 'sig-exhibit-tag')`
      ).run(mhtmlCaptureId, REMOTE)
      db.prepare(
        `INSERT INTO annotations (
           capture_id, schema_version, shapes_json, image_width, image_height, updated_at,
           updated_by, author_installation_id, version
         ) VALUES (?, 1, '[]', 640, 480, '2026-10-01T09:00:00.000Z', 'Marcus B', ?, 6)`
      ).run(mhtmlCaptureId, REMOTE)
      db.prepare(
        `INSERT INTO annotation_pins (
           id, capture_id, number, body, created_at, updated_at, author_installation_id,
           version, deleted_at
         ) VALUES ('remote-pin', ?, 2, 'Remote pin', '2026-10-01T09:00:00.000Z',
                   '2026-10-01T09:00:00.000Z', ?, 7, '2026-10-02T00:00:00.000Z')`
      ).run(mhtmlCaptureId, REMOTE)
      remoteNoteId = createNote({ caseId, title: 'Remote note', body: 'theirs' }).id
      db.prepare('UPDATE notes SET author_installation_id = ?, version = 8 WHERE id = ?').run(
        REMOTE,
        remoteNoteId
      )
      db.prepare(
        `INSERT INTO note_tags (note_id, tag_id, author_installation_id, version)
         VALUES (?, 'remote-evidence', ?, 9)`
      ).run(remoteNoteId, REMOTE)
      await exportCaseArchive(caseId, archivePath)
    })

    const sorted = (rows: Record<string, unknown>[] = []) =>
      [...rows].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
    const syncColumns = (rows: Record<string, unknown>[]) =>
      sorted(
        rows.map(({ id, author_installation_id, version, deleted_at, row_signature }) => ({
          id,
          author_installation_id,
          version,
          deleted_at,
          row_signature
        }))
      )

    it('keeps both same-name tags, every author and the new columns', async () => {
      const source = collectCaseData(caseId)
      expect(source.tags.filter((t) => t.name === 'Evidence')).toHaveLength(2)
      closeDatabase()
      await initDatabase(':memory:')

      const { newCaseId, report } = await importCaseArchive(archivePath)
      expect(report.verification.overallValid).toBe(true)
      const imported = collectCaseData(newCaseId)

      expect(sorted(imported.tags)).toEqual(sorted(source.tags))
      expect(
        sorted(imported.tags.filter((t) => t.name === 'Evidence')).map((t) => [
          t.author_installation_id,
          t.color,
          t.created_at
        ])
      ).toEqual(
        sorted(source.tags.filter((t) => t.name === 'Evidence')).map((t) => [
          t.author_installation_id,
          t.color,
          t.created_at
        ])
      )
      expect(
        getTagsForCapture(mhtmlCaptureId)
          .map((t) => t.id)
          .sort()
      ).toEqual(
        [
          'remote-evidence',
          source.tags.find((t) => t.name === 'Evidence' && !t.author_installation_id)!.id
        ].sort()
      )
      expect(sorted(imported.captureTags)).toEqual(sorted(source.captureTags))
      expect(sorted(imported.noteTags)).toEqual(sorted(source.noteTags))
      expect(sorted(imported.annotations)).toEqual(sorted(source.annotations))
      expect(sorted(imported.annotationPins)).toEqual(sorted(source.annotationPins))
      expect(syncColumns(imported.notes)).toEqual(syncColumns(source.notes))
      expect(imported.annotations.map((a) => a.author_installation_id).sort()).toEqual([
        REMOTE,
        null
      ])
    })

    it('merges each tag only into a same-author tag already in the database', async () => {
      const { newCaseId } = await importCaseArchive(archivePath)
      const evidence = getDb()
        .prepare("SELECT id, author_installation_id FROM tags WHERE lower(name) = 'evidence'")
        .all() as Array<{ id: string; author_installation_id: string | null }>
      // Still one tag per author: the import reused each, rather than adding
      // a third or folding the teammate's into the local one.
      expect(evidence.map((t) => t.author_installation_id).sort()).toEqual([REMOTE, null])
      const importedCapture = listCaptures(newCaseId).find((c) => c.url === taggedCaptureUrl)!
      expect(
        getTagsForCapture(importedCapture.id)
          .map((t) => t.id)
          .sort()
      ).toEqual(evidence.map((t) => t.id).sort())
    })

    // What a Birdbrain at Case Archive schema 8 wrote: no `created_at` on tags,
    // tag applications reduced to their two ids, pins without the sync columns.
    // The columns it lacks are filled as migration 39 fills them.
    it('still imports a version-8 archive, filling the columns it lacks', async () => {
      const without = (rows: unknown, keys: string[]) =>
        (rows as Record<string, unknown>[]).map((row) =>
          Object.fromEntries(Object.entries(row).filter(([key]) => !keys.includes(key)))
        )
      rewriteDataJson(archivePath, (d) => ({
        ...d,
        tags: without(d.tags, ['created_at']),
        captureTags: without(d.captureTags, [
          'author_installation_id',
          'version',
          'deleted_at',
          'row_signature'
        ]),
        annotationPins: without(d.annotationPins, [
          'author_installation_id',
          'version',
          'deleted_at',
          'row_signature'
        ])
      }))
      rewritePackageJson(archivePath, (h) => ({ ...h, schemaVersion: 8 }))
      closeDatabase()
      await initDatabase(':memory:')

      const { newCaseId, report } = await importCaseArchive(archivePath)
      expect(report.schemaVersion).toBe(8)
      expect(report.verification.overallValid).toBe(true)
      const imported = collectCaseData(newCaseId)
      expect(imported.tags.map((t) => t.created_at)).toEqual(
        imported.tags.map(() => UNDATED_TAG_CREATED_AT)
      )
      expect(
        sorted(imported.captureTags).map((r) => [r.author_installation_id, r.version])
      ).toEqual([
        [null, 0],
        [null, 0]
      ])
      expect(
        imported.annotationPins.map((p) => [p.author_installation_id, p.version, p.deleted_at])
      ).toEqual([
        [null, 0, null],
        [null, 0, null]
      ])
    })
  })
})

// #1813: a Case Archive carries each Derived File its verified chains anchor,
// and the import restores it only when its bytes hash to the signed
// `outputHash`. Every derivation here is signed by hand over arbitrary bytes.
describe('caseArchive Derived Files (#1813)', () => {
  let tempDir: string
  let storageRoot: string
  let caseId: string
  let caseDir: string
  let archivePath: string
  let contentHash: string
  const captureId = 'capture-mhtml-1'
  const legacyId = 'capture-legacy-1'
  const documentId = 'document-1'
  const thumbnail = Buffer.from('thumbnail bytes the chain anchors')
  const thumbName = `files/derived/${captureId}_thumb.jpg`
  const mhtmlBuf = Buffer.from('<html>derived source</html>')

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'bb-case-archive-derived-'))
    storageRoot = join(tempDir, 'captures')
    initStorage(storageRoot)
    await initDatabase(':memory:')
    resetInstallationId()
    initInstallationId(tempDir)
    resetSigningKey()
    initSigningKey(tempDir, { confirmUnprotectedKey: () => true })
    initSettings(tempDir)
    updateSettings({ operatorName: 'Test Operator', operatorRole: '', operatorOrganization: '' })

    caseId = createCase({ name: 'Derived Case', description: '' }).id
    ensureCaseDir(caseId)
    caseDir = join(getStorageRoot(), caseId)
    initManifest(caseDir)
    writeFileSync(artifactPath(caseId, captureId, 'mhtml'), mhtmlBuf)
    contentHash = createHash('sha256').update(mhtmlBuf).digest('hex')
    const { index, entryHash } = appendManifestEntry(caseDir, {
      type: 'capture',
      captureId,
      caseId,
      url: 'https://example.com/derived',
      timestamp: '2026-04-05T12:00:00.000Z',
      contentHash,
      sizeBytes: mhtmlBuf.length,
      exhibitNumber: 1,
      operatorId: 'op-1',
      operatorName: 'Test Operator',
      toolVersion: '0.1.0'
    })
    insertCapture({
      id: captureId,
      caseId,
      url: 'https://example.com/derived',
      title: 'Derived',
      hash: contentHash,
      timestamp: '2026-04-05T12:00:00.000Z',
      format: 'mhtml',
      mhtmlPath: `${caseId}/${captureId}.mhtml`,
      sizeBytes: mhtmlBuf.length,
      manifestIndex: index,
      entryHash,
      exhibitNumber: 1
    })
    createNote({ caseId, captureId, title: 'Seen', body: 'On the page.' })
    archivePath = join(tempDir, 'derived.birdbrain')
  })

  afterEach(() => {
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  const sign = (params: Partial<Parameters<typeof signDerivedFile>[0]> = {}) =>
    signDerivedFile({
      caseId,
      parentExhibitId: captureId,
      parentContentHash: contentHash,
      bytes: thumbnail,
      ...params
    })

  const zipNames = (path = archivePath): string[] => [...readStoredZip(readFileSync(path)).keys()]

  // An archive with `name` holding `bytes`, its header repaired.
  const plant = (name: string, bytes: Buffer): void =>
    rewriteArchive(archivePath, (entries) => {
      entries.set(name, bytes)
    })

  const importEntry = (newCaseId: string): Record<string, unknown> =>
    readEntries(readFileSync(join(storageRoot, newCaseId, 'manifest.jsonl'), 'utf-8')).find(
      (e) => e.type === 'import'
    )!

  // What an override import of a hostile archive must leave behind: no
  // Derived File, and none of the import's own files replaced.
  function expectNothingRestored(newCaseId: string): void {
    const newCaseDir = join(storageRoot, newCaseId)
    expect(listDerivedFilesForCase(newCaseId)).toEqual([])
    const [row] = listCaptures(newCaseId).filter((capture) => capture.hash === contentHash)
    expect(readFileSync(join(newCaseDir, `${row.id}.mhtml`))).toEqual(mhtmlBuf)
    expect(verifyManifestChain(newCaseDir).valid).toBe(true)
    const idMap = JSON.parse(readFileSync(join(newCaseDir, 'import-id-map.json'), 'utf-8'))
    expect(
      createHash('sha256')
        .update(Buffer.from(canonicalStringify(idMap), 'utf-8'))
        .digest('hex')
    ).toBe(importEntry(newCaseId).idMapSha256)
  }

  it("restores a renamed Capture's thumbnail under the name its signed entry gives it", async () => {
    sign()
    await exportCaseArchive(caseId, archivePath)

    const { newCaseId } = await importCaseArchive(archivePath)

    const [row] = listCaptures(newCaseId)
    expect(row.id).not.toBe(captureId)
    const [restored] = listDerivedFilesForCase(newCaseId)
    expect(restored.exhibitId).toBe(row.id)
    expect(restored.path).toBe(join(newCaseId, `${captureId}_thumb.jpg`))
    expect(readFileSync(join(storageRoot, restored.path))).toEqual(thumbnail)
    expect((await verifyCaseDerivedFiles(newCaseId)).get(row.id)).toEqual([
      expect.objectContaining({ derivedFileId: restored.id, status: 'verified' })
    ])
    const manifest = join(storageRoot, newCaseId, 'manifest.jsonl')
    const before = readFileSync(manifest)
    const backfill = await backfillCase(newCaseId, { toolVersion: '0.1.0' })
    expect([backfill.renumbered, backfill.thumbnailsAnchored]).toEqual([false, 0])
    expect(readFileSync(manifest)).toEqual(before)
  })

  // The row keeps its new id in the next archive while every entry still names
  // the source's, so the parent is found by the entry at the row's index.
  it("restores a renamed Capture's thumbnail again from an archive of that Case, on a fresh database", async () => {
    sign()
    await exportCaseArchive(caseId, archivePath)
    const { newCaseId: renamedCaseId } = await importCaseArchive(archivePath)
    const [renamed] = listCaptures(renamedCaseId)
    const again = join(tempDir, 'again.birdbrain')
    await exportCaseArchive(renamedCaseId, again)
    expect(zipNames(again)).toContain(thumbName)
    closeDatabase()
    await initDatabase(':memory:')

    const { newCaseId, report } = await importCaseArchive(again)

    expect(report.verification.overallValid).toBe(true)
    const [row] = listCaptures(newCaseId)
    expect(row.id).toBe(renamed.id)
    const [restored] = listDerivedFilesForCase(newCaseId)
    expect(restored).toMatchObject({
      exhibitId: row.id,
      path: join(newCaseId, `${captureId}_thumb.jpg`)
    })
    expect(readFileSync(join(storageRoot, restored.path))).toEqual(thumbnail)
    expect((await verifyCaseDerivedFiles(newCaseId)).get(row.id)).toEqual([
      expect.objectContaining({ derivedFileId: restored.id, status: 'verified' })
    ])
  })

  it("deletes a renamed Capture's restored thumbnail with it, and the source's stays", async () => {
    const { outputPath } = sign()
    await exportCaseArchive(caseId, archivePath)
    const { newCaseId } = await importCaseArchive(archivePath)
    const [row] = listCaptures(newCaseId)
    const restored = join(storageRoot, newCaseId, `${captureId}_thumb.jpg`)
    expect(existsSync(restored)).toBe(true)
    const lifecycle = createCaptureLifecycle({
      selectorLifecycle: createSelectorLifecycle({ emitRematched: () => {} })
    })

    expect(await lifecycle.delete(row.id)).toBe(true)

    expect(existsSync(restored)).toBe(false)
    expect(listDerivedFilesForCase(newCaseId)).toEqual([])
    expect(readFileSync(join(storageRoot, outputPath))).toEqual(thumbnail)
    expect(listDerivedFilesForCase(caseId)).toHaveLength(1)
    expect(findOrphans().fileOrphans).toEqual([])
  })

  it('still imports a version-10 archive, which carries no Derived Files', async () => {
    sign()
    await exportCaseArchive(caseId, archivePath)
    downgradeToVersion10(archivePath)
    expect(zipNames().some((name) => name.startsWith('files/derived/'))).toBe(false)
    closeDatabase()
    await initDatabase(':memory:')

    const { newCaseId, report } = await importCaseArchive(archivePath)

    expect(report.schemaVersion).toBe(10)
    expect(report.verification.overallValid).toBe(true)
    expect(listDerivedFilesForCase(newCaseId)).toEqual([])
    expect(existsSync(join(storageRoot, newCaseId, `${captureId}_thumb.jpg`))).toBe(false)
    expect(listCaptures(newCaseId).map((c) => c.id)).toEqual([captureId])
    expect(listNotes(newCaseId).map((n) => n.title)).toEqual(['Seen'])
  })

  it('fails a derived file whose bytes do not match its signed outputHash even with the header repaired, and restores nothing on override', async () => {
    sign()
    await exportCaseArchive(caseId, archivePath)
    plant(thumbName, Buffer.from('swapped thumbnail bytes'))

    const { verification } = inspectCaseArchive(archivePath)
    expect([verification.chainValid, verification.artifactFailureCount]).toEqual([true, 1])
    await expect(importCaseArchive(archivePath)).rejects.toThrow(/failed verification/i)

    const { newCaseId } = await importCaseArchive(archivePath, { overrideTamper: true })
    expectNothingRestored(newCaseId)
    expect(existsSync(join(storageRoot, newCaseId, `${captureId}_thumb.jpg`))).toBe(false)
    expect(importEntry(newCaseId).verificationResult).toMatchObject({
      overallValid: false,
      artifactFailureCount: 1
    })
  })

  it('fails a files/derived/ entry no verified derivation names', async () => {
    await exportCaseArchive(caseId, archivePath)
    plant('files/derived/stray.jpg', thumbnail)

    const { verification } = inspectCaseArchive(archivePath)
    expect([verification.chainValid, verification.artifactFailureCount]).toEqual([true, 1])

    const { newCaseId } = await importCaseArchive(archivePath, { overrideTamper: true })
    expectNothingRestored(newCaseId)
    expect(existsSync(join(storageRoot, newCaseId, 'stray.jpg'))).toBe(false)
  })

  it('does not carry a derived file no entry anchors', async () => {
    const path = `${caseId}/${captureId}_thumb.jpg`
    writeFileSync(join(storageRoot, path), thumbnail)
    insertDerivedFile({
      exhibitId: captureId,
      derivation: 'thumbnail',
      toolVersion: '0.1.0',
      contentHash: createHash('sha256').update(thumbnail).digest('hex'),
      path,
      createdAt: '2026-10-01T09:00:00.000Z',
      manifestSeq: null
    })
    await exportCaseArchive(caseId, archivePath)
    expect(zipNames()).not.toContain(thumbName)

    const { newCaseId } = await importCaseArchive(archivePath)
    expect(listDerivedFilesForCase(newCaseId)).toEqual([])
  })

  it('restores no derived file from a chain that does not verify, even on override', async () => {
    sign()
    await exportCaseArchive(caseId, archivePath)
    rewriteArchive(archivePath, (entries) => {
      const lines = entries.get('manifest.jsonl')!.toString('utf-8').trim().split('\n')
      const edited = lines.map((line) => {
        const entry = JSON.parse(line)
        return entry.type === 'derivation'
          ? JSON.stringify({ ...entry, outputHash: 'f'.repeat(64) })
          : line
      })
      entries.set('manifest.jsonl', Buffer.from(edited.join('\n') + '\n'))
    })
    expect(inspectCaseArchive(archivePath).verification.chainValid).toBe(false)

    const { newCaseId } = await importCaseArchive(archivePath, { overrideTamper: true })
    expect(listDerivedFilesForCase(newCaseId)).toEqual([])
    expect(existsSync(join(storageRoot, newCaseId, `${captureId}_thumb.jpg`))).toBe(false)
  })

  it.each([
    ['the id map', (id: string) => `${id}/import-id-map.json`, 'import-id-map.json'],
    ['the manifest', (id: string) => `${id}/manifest.jsonl`, 'manifest.jsonl'],
    [
      "a member's chain",
      (id: string) => `${id}/manifest.installation-peer-0001.jsonl`,
      'manifest.installation-peer-0001.jsonl'
    ],
    [
      'a lineage chain',
      (id: string) => `${id}/lineage/source/manifest.installation-peer-0001.jsonl`,
      'lineage/source/manifest.installation-peer-0001.jsonl'
    ],
    ['the Staging Pool', (id: string) => `${id}/staging/x.png`, 'staging/x.png'],
    ['the roster', (id: string) => `${id}/members.json`, 'members.json'],
    ["a Capture's bytes", (id: string) => `${id}/${captureId}.mhtml`, `${captureId}.mhtml`],
    ['a single segment', () => 'thumb.jpg', 'thumb.jpg'],
    ['the storage root', () => '/thumb.jpg', 'thumb.jpg'],
    ['the working directory', () => './thumb.jpg', 'thumb.jpg'],
    ['the parent directory', (id: string) => `${id}/../outside.jpg`, 'outside.jpg'],
    ['a backslash climb', (id: string) => `${id}\\..\\..\\outside.jpg`, 'outside.jpg']
  ])('never writes a derived file a signed path aims at %s', async (_, outputPath, planted) => {
    sign({ outputPath: outputPath(caseId), writeFile: false, recordRow: false })
    await exportCaseArchive(caseId, archivePath)
    expect(zipNames().some((name) => name.startsWith('files/derived/'))).toBe(false)
    plant(`files/derived/${planted}`, thumbnail)

    const { verification } = inspectCaseArchive(archivePath)
    expect([verification.chainValid, verification.artifactFailureCount]).toEqual([true, 1])

    const { newCaseId } = await importCaseArchive(archivePath, { overrideTamper: true })
    expectNothingRestored(newCaseId)
    expect(existsSync(join(storageRoot, 'outside.jpg'))).toBe(false)
    expect(existsSync(join(tempDir, 'outside.jpg'))).toBe(false)
    expect(existsSync(join(storageRoot, newCaseId, 'thumb.jpg'))).toBe(false)
  })

  it('exports a readable archive when a signed derivation path climbs out of the Case', async () => {
    writeFileSync(join(storageRoot, 'outside.jpg'), thumbnail)
    sign({ outputPath: `${caseId}/../outside.jpg`, writeFile: false, recordRow: false })

    await exportCaseArchive(caseId, archivePath)

    expect(zipNames().some((name) => name.startsWith('files/derived/'))).toBe(false)
    expect(inspectCaseArchive(archivePath).verification.overallValid).toBe(true)
  })

  it.each([
    ['missing', false],
    ['a directory', true]
  ])('carries nothing for an anchored path that is %s at the source', async (_, directory) => {
    const { outputPath } = sign({ writeFile: false, recordRow: false })
    if (directory) mkdirSync(join(storageRoot, outputPath))

    await exportCaseArchive(caseId, archivePath)

    expect(zipNames()).not.toContain(thumbName)
    const { newCaseId, report } = await importCaseArchive(archivePath)
    expect(report.verification.overallValid).toBe(true)
    expect(listDerivedFilesForCase(newCaseId)).toEqual([])
  })

  it('restores no derived file for a parent the archive does not carry', async () => {
    const outputPath = `${caseId}/not-in-archive_thumb.jpg`
    sign({ parentExhibitId: 'not-in-archive', outputPath, recordRow: false })
    await exportCaseArchive(caseId, archivePath)
    expect(zipNames().some((name) => name.startsWith('files/derived/'))).toBe(false)
    expect(inspectCaseArchive(archivePath).verification.overallValid).toBe(true)
    plant('files/derived/not-in-archive_thumb.jpg', thumbnail)

    expect(inspectCaseArchive(archivePath).verification.artifactFailureCount).toBe(1)
    const { newCaseId } = await importCaseArchive(archivePath, { overrideTamper: true })
    expectNothingRestored(newCaseId)
    expect(existsSync(join(storageRoot, newCaseId, 'not-in-archive_thumb.jpg'))).toBe(false)
  })

  it.each([
    ['two parents', [captureId, legacyId], ['shared_thumb.jpg', 'shared_thumb.jpg']],
    ['two spellings differing only in case', [captureId, captureId], ['Thumb.jpg', 'thumb.jpg']]
  ])('refuses a derived path claimed by %s', async (_, parents, names) => {
    insertCapture({
      id: legacyId,
      caseId,
      url: 'https://legacy.example.com',
      title: 'Legacy',
      hash: 'y'.repeat(64),
      timestamp: '2026-04-04T12:00:00.000Z'
    })
    for (const [i, parent] of parents.entries()) {
      sign({ parentExhibitId: parent, outputPath: `${caseId}/${names[i]}`, recordRow: false })
    }
    await exportCaseArchive(caseId, archivePath)
    expect(zipNames().some((name) => name.startsWith('files/derived/'))).toBe(false)
    plant(`files/derived/${names[1]}`, thumbnail)

    expect(inspectCaseArchive(archivePath).verification.artifactFailureCount).toBe(1)
    const { newCaseId } = await importCaseArchive(archivePath, { overrideTamper: true })
    expectNothingRestored(newCaseId)
  })

  it('leaves behind a source derived file whose bytes no longer match, and the archive still verifies', async () => {
    const { outputPath } = sign()
    writeFileSync(join(storageRoot, outputPath), 'redrawn by another build')

    await exportCaseArchive(caseId, archivePath)

    expect(zipNames()).not.toContain(thumbName)
    expect(inspectCaseArchive(archivePath).verification.overallValid).toBe(true)
    const { newCaseId } = await importCaseArchive(archivePath)
    expect(listDerivedFilesForCase(newCaseId)).toEqual([])
  })

  it('rejects a truncated archive that carries derived files before writing anything', async () => {
    sign()
    await exportCaseArchive(caseId, archivePath)
    expect(zipNames()).toContain(thumbName)
    const bytes = readFileSync(archivePath)
    writeFileSync(archivePath, bytes.subarray(0, bytes.length - 40))
    const dirsBefore = readdirSync(storageRoot).sort()
    const casesBefore = getDb().prepare('SELECT id FROM cases').all()

    expect(() => inspectCaseArchive(archivePath)).toThrow(/not a valid Birdbrain archive/i)
    await expect(importCaseArchive(archivePath)).rejects.toThrow(/not a valid Birdbrain archive/i)

    expect(readdirSync(storageRoot).sort()).toEqual(dirsBefore)
    expect(getDb().prepare('SELECT id FROM cases').all()).toEqual(casesBefore)
  })

  it('aborts and cleans up when a derived path collides with a file the import staged', async () => {
    const pdf = Buffer.from('%PDF-1.7 statement')
    mkdirSync(join(caseDir, 'documents'), { recursive: true })
    writeFileSync(join(caseDir, 'documents', `${documentId}.pdf`), pdf)
    getDb()
      .prepare(
        `INSERT INTO exhibits (id, case_id, kind, origin, exhibit_number, name, content_hash,
           path, size_bytes, committed_at) VALUES (?, ?, 'document', 'manual-upload', 2, ?, ?, ?, ?, ?)`
      )
      .run(
        documentId,
        caseId,
        'statement.pdf',
        createHash('sha256').update(pdf).digest('hex'),
        `${caseId}/documents/${documentId}.pdf`,
        pdf.length,
        '2026-04-05T12:00:00.000Z'
      )
    // Signed over the document's own path, so the exporter refuses to carry it.
    sign({
      outputPath: `${caseId}/documents/${documentId}.pdf`,
      bytes: pdf,
      writeFile: false,
      recordRow: false
    })
    await exportCaseArchive(caseId, archivePath)
    expect(zipNames().some((name) => name.startsWith('files/derived/'))).toBe(false)
    // A data.json path that disagrees with where the zip name stages the file
    // takes the document's own path out of the import's owned set.
    rewriteArchive(archivePath, (entries) => {
      const data = JSON.parse(entries.get('data.json')!.toString('utf-8'))
      data.exhibits = data.exhibits.map((row: Record<string, unknown>) =>
        row.id === documentId ? { ...row, path: `${caseId}/documents/elsewhere.pdf` } : row
      )
      entries.set('data.json', Buffer.from(JSON.stringify(data, null, 2)))
      entries.set(`files/derived/documents/${documentId}.pdf`, pdf)
    })
    expect(inspectCaseArchive(archivePath).verification.overallValid).toBe(true)
    // Another installation, so the document keeps its id and its staged name.
    closeDatabase()
    await initDatabase(':memory:')
    const dirsBefore = readdirSync(storageRoot).sort()
    const casesBefore = getDb().prepare('SELECT id FROM cases').all()

    await expect(importCaseArchive(archivePath)).rejects.toThrow(
      /derived file path collides with an imported file/
    )

    expect(readdirSync(storageRoot).sort()).toEqual(dirsBefore)
    expect(getDb().prepare('SELECT id FROM cases').all()).toEqual(casesBefore)
  })
})
