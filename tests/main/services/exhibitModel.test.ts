import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createHash, createPublicKey, generateKeyPairSync } from 'crypto'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync
} from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { Readable } from 'stream'
import Database from 'better-sqlite3'
import sharp from 'sharp'
import { ensureCaseDir, getCaseStorageSize, initStorage } from '@main/services/storage'
import { closeDatabase, getDb, initDatabase, LATEST_SCHEMA_VERSION } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { getCapture, insertCapture, deleteCapture } from '@main/services/db/captureRepo'
import {
  addTagToCapture,
  createTag,
  getTagsForCapture,
  collectCaptureTagsForCase
} from '@main/services/db/tagRepo'
import { getExhibit, listExhibits, nextExhibitNumber } from '@main/services/db/exhibitRepo'
import {
  getDerivedFile,
  hasDerivation,
  insertDerivedFile,
  listDerivedFilesForCase,
  listDerivedFilesForExhibit
} from '@main/services/db/derivedFileRepo'
import {
  deleteStagingFile,
  getStagingFile,
  insertStagingFile,
  listStagingFiles
} from '@main/services/db/stagingRepo'
import { cleanOrphans, findOrphans } from '@main/services/db/dbAdmin'
import { exportCaseArchive, importCaseArchive } from '@main/services/caseArchive'
import {
  backfillCase,
  runExhibitBackfill,
  THUMBNAIL_DERIVATION
} from '@main/services/exhibitBackfill'
import { renderThumbnail } from '@main/services/thumbnails'
import { logger } from '@main/services/logger'
import { getCaseInventory, getManifestSnapshot, signerSegments } from '@main/services/exhibits'
import { verifyCapture, createCaptureLifecycle } from '@main/services/captureLifecycle'
import { verifyExhibit } from '@main/services/exhibits'
import { initManifest, verifyManifestChain } from '@main/services/manifest'
import { createCaptureStore, defaultCaptureStore } from '@main/services/captureStore'
import { initInstallationId, resetInstallationId } from '@main/services/installationId'
import { initSettings, updateSettings } from '@main/services/settings'
import { getPublicKeyPem, signEntryHash } from '@main/services/signingKey'
import { canonicalStringify } from '@shared/verify'
import { MANIFEST_FILENAME } from '@shared/constants'
import type { SelectorLifecycle } from '@main/services/selectorLifecycle'
import type { InventoryExhibitRow, InventoryStagedRow } from '@shared/types'
import type { ManifestSnapshotEntry } from '@shared/manifestSnapshot'
import type { ManifestEntry } from '@shared/schemas'

// Known-answer tests for the Exhibit model's tables, migrations and read paths
// (#1147, ADR-0023 / ADR-0024). Four answers are frozen here:
//
//   1. RENUMBER. Every existing Capture gets an `exhibits` row with the same id
//      and a sequential per-Case number, anchored Captures in Manifest order
//      and legacy ones after them in capture order (X41); one `renumber` entry
//      per Case records the assignment, and the chain still verifies with it.
//   2. THUMBNAILS. A thumbnail regenerated from a screenshot the SIGNED chain
//      vouches for is anchored by a `derivation` entry; one whose screenshot is
//      missing or fails verification is recorded and left unanchored (X34).
//   3. INVENTORY. Anchored and pooled rows come back in one list with a
//      discriminator, each carrying whether its bytes are on disk (X16).
//   4. SIGNERS. `manifest:snapshot` reports one fingerprint per signing
//      segment, so an imported Case's two keys are never collapsed into one
//      unspecified signer (X36).
//
// A failure in 1 or 2 means an Exhibit Number or a Derived File in an existing
// Case would change or lose its anchoring — that is the finding, not the test.

vi.mock('@main/services/tlsCertChain', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/services/tlsCertChain')>()
  return { ...actual, fetchCertChain: vi.fn(async () => null) }
})

const MHTML_BODY = 'From: <Saved by Chrome>\nContent-Type: multipart/related\n\nexhibit bytes'
const TOOL_VERSION = '9.9.9-test'

async function screenshotPng(colour: { r: number; g: number; b: number }): Promise<Buffer> {
  return sharp({
    create: { width: 32, height: 24, channels: 3, background: colour }
  })
    .png()
    .toBuffer()
}

function manifestLines(caseDir: string): Record<string, unknown>[] {
  return readFileSync(join(caseDir, MANIFEST_FILENAME), 'utf-8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
}

// Appends one correctly linked, correctly signed line to a case manifest. Used
// to stand in for a writer from a schema this build does not have: reaching the
// verifier-too-old outcome costs the case's signing key, so an entry that is
// merely malformed would report as tampering instead.
function appendSignedLine(caseDir: string, body: Record<string, unknown>): void {
  const lines = manifestLines(caseDir)
  const previous = lines.at(-1)
  const full = {
    ...body,
    index: lines.length,
    prevHash: (previous?.entryHash as string | undefined) ?? ''
  }
  const entryHash = createHash('sha256').update(canonicalStringify(full)).digest('hex')
  appendFileSync(
    join(caseDir, MANIFEST_FILENAME),
    JSON.stringify({ ...full, entryHash, signature: signEntryHash(entryHash) }) + '\n'
  )
}

function spkiFingerprint(pem: string): string {
  return createHash('sha256')
    .update(createPublicKey(pem).export({ type: 'spki', format: 'der' }))
    .digest('hex')
}

// Every ingest in this file goes through one helper so the required
// IngestParams fields stay in one place.
async function ingestInto(
  caseId: string,
  params: { url: string; title: string; timestamp: string; screenshot?: Buffer }
) {
  const lifecycle = createCaptureLifecycle({
    selectorLifecycle: { runActiveSelectorsForCapture: vi.fn() } as unknown as SelectorLifecycle
  })
  const result = await lifecycle.ingest({
    caseId,
    url: params.url,
    title: params.title,
    timestamp: params.timestamp,
    stream: Readable.from([Buffer.from(MHTML_BODY)]) as unknown as ReadableStream<Uint8Array>,
    textContent: 'exhibit text',
    headers: { server: 'nginx' },
    browserVersion: 'Chrome/120',
    userAgent: 'Mozilla/5.0',
    httpStatus: 200,
    operatorId: 'op-1',
    operatorName: 'Test Operator',
    toolVersion: TOOL_VERSION,
    ...(params.screenshot ? { screenshot: params.screenshot } : {})
  })
  if (!result.capture) throw new Error('ingest failed')
  return result.capture
}

describe('exhibit model', () => {
  let tempDir: string
  let storageRoot: string
  let caseId: string
  let caseDir: string

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-exhibits-'))
    storageRoot = join(tempDir, 'captures')
    initStorage(storageRoot)
    await initDatabase(':memory:')
    initSettings(tempDir)
    updateSettings({ operatorName: 'Test Operator' })
    resetInstallationId()
    initInstallationId(tempDir)
    caseId = createCase({ name: 'Exhibits' }).id
    ensureCaseDir(caseId)
    caseDir = join(storageRoot, caseId)
    initManifest(caseDir)
  })

  afterEach(() => {
    closeDatabase()
    resetInstallationId()
    rmSync(tempDir, { recursive: true, force: true })
  })

  describe('schema v34', () => {
    it('creates the three tables, retargets the tag relation and drops the old one', () => {
      const db = getDb()
      const tables = (
        db
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all() as Array<{ name: string }>
      ).map((row) => row.name)
      expect(tables).toEqual(expect.arrayContaining(['exhibits', 'derived_files', 'staging_files']))
      expect(tables).toContain('exhibit_tags')
      expect(tables).not.toContain('capture_tags')
      expect(db.pragma('user_version', { simple: true })).toBe(LATEST_SCHEMA_VERSION)

      const columns = (name: string): string[] =>
        (db.pragma(`table_info(${name})`) as Array<{ name: string }>).map((c) => c.name)
      expect(columns('exhibits')).toEqual([
        'id',
        'case_id',
        'kind',
        'origin',
        'exhibit_number',
        'name',
        'content_hash',
        'path',
        'size_bytes',
        'committed_at',
        'manifest_seq'
      ])
      expect(columns('derived_files')).toEqual([
        'id',
        'exhibit_id',
        'derivation',
        'tool_version',
        'content_hash',
        'path',
        'created_at',
        'manifest_seq'
      ])
      expect(columns('staging_files')).toEqual([
        'id',
        'case_id',
        'kind',
        'origin',
        'name',
        'content_hash',
        'path',
        'size_bytes',
        'arrived_at',
        'source_url',
        'source_claims'
      ])
      expect(columns('exhibit_tags')).toEqual(['exhibit_id', 'tag_id'])
    })

    it('refuses a second Exhibit with the same number in a case', () => {
      const capture = insertCapture({
        caseId,
        url: 'https://example.com/a',
        title: 'A',
        hash: 'a'.repeat(64),
        timestamp: '2026-04-05T12:00:00.000Z'
      })
      const exhibit = getExhibit(capture.id)!
      expect(() =>
        getDb()
          .prepare(
            `INSERT INTO exhibits (id, case_id, kind, origin, exhibit_number, name,
               content_hash, path, size_bytes, committed_at, manifest_seq)
             VALUES ('other', ?, 'capture', 'extension', ?, 'A', 'x', NULL, NULL, 'now', NULL)`
          )
          .run(caseId, exhibit.exhibitNumber)
      ).toThrow(/UNIQUE/i)
    })

    it('carries every capture_tags row across and keeps tag reads working', () => {
      const capture = insertCapture({
        caseId,
        url: 'https://example.com/tagged',
        title: 'Tagged',
        hash: 'b'.repeat(64),
        timestamp: '2026-04-05T12:00:00.000Z'
      })
      const tag = createTag({ name: 'relevant' })
      addTagToCapture({ captureId: capture.id, tagId: tag.id })

      expect(getTagsForCapture(capture.id).map((t) => t.name)).toEqual(['relevant'])
      // The archive payload keeps its `capture_id` key so a .birdbrain written
      // by this build still imports into a build that predates the rename.
      expect(collectCaptureTagsForCase(caseId)).toEqual([
        { capture_id: capture.id, tag_id: tag.id }
      ])
    })
  })

  // The v34 block's SQL is what runs on a real upgrade, so it is exercised
  // against a real pre-v34 schema rather than a hand-written minimal one: the
  // database is migrated forward, then wound back to v33 exactly as v34 found
  // it, then reopened.
  describe('renumber migration (X18, X41)', () => {
    function windBackToV33(dbPath: string): void {
      const raw = new Database(dbPath)
      raw.pragma('foreign_keys = OFF')
      raw.exec(`
        CREATE TABLE capture_tags (
          capture_id TEXT NOT NULL,
          tag_id TEXT NOT NULL,
          PRIMARY KEY (capture_id, tag_id),
          FOREIGN KEY (capture_id) REFERENCES captures(id) ON DELETE CASCADE,
          FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
        );
        INSERT INTO capture_tags (capture_id, tag_id)
          SELECT exhibit_id, tag_id FROM exhibit_tags;
        DROP TABLE exhibit_tags;
        DROP TABLE derived_files;
        DROP TABLE staging_files;
        DROP TABLE exhibits;
        CREATE INDEX idx_capture_tags_tag_id ON capture_tags(tag_id);
      `)
      raw.pragma('user_version = 33')
      raw.close()
    }

    it('numbers anchored captures by manifest index and legacy ones last', async () => {
      closeDatabase()
      const dbPath = join(tempDir, 'renumber.db')
      await initDatabase(dbPath)
      const numbered = createCase({ name: 'Renumber' }).id

      // Manifest indices deliberately out of insertion order and non-contiguous
      // (the chain holds deletion and timestamp entries too), and one legacy
      // capture with no entry at all.
      const rows = [
        { id: 'cap-second', manifestIndex: 5, timestamp: '2026-01-03T00:00:00.000Z' },
        { id: 'cap-legacy', manifestIndex: undefined, timestamp: '2026-01-01T00:00:00.000Z' },
        { id: 'cap-first', manifestIndex: 2, timestamp: '2026-01-02T00:00:00.000Z' }
      ]
      for (const row of rows) {
        insertCapture({
          id: row.id,
          caseId: numbered,
          url: `https://example.com/${row.id}`,
          title: row.id,
          hash: createHash('sha256').update(row.id).digest('hex'),
          timestamp: row.timestamp,
          manifestIndex: row.manifestIndex
        })
      }
      closeDatabase()

      windBackToV33(dbPath)
      await initDatabase(dbPath)

      const assigned = listExhibits(numbered).map((e) => ({
        id: e.id,
        exhibitNumber: e.exhibitNumber,
        manifestSeq: e.manifestSeq,
        kind: e.kind,
        origin: e.origin
      }))
      expect(assigned).toEqual([
        { id: 'cap-first', exhibitNumber: 1, manifestSeq: 2, kind: 'capture', origin: 'extension' },
        { id: 'cap-second', exhibitNumber: 2, manifestSeq: 5, kind: 'capture', origin: 'extension' },
        {
          id: 'cap-legacy',
          exhibitNumber: 3,
          manifestSeq: null,
          kind: 'capture',
          origin: 'extension'
        }
      ])
      closeDatabase()
      rmSync(dbPath, { force: true })
    })
  })

  describe('backfill', () => {
    it('writes one renumber entry per case and the chain still verifies', async () => {
      await ingestInto(caseId, {
        url: 'https://example.com/one',
        title: 'One',
        timestamp: '2026-04-05T12:00:00.000Z'
      })

      const result = await backfillCase(caseId, { toolVersion: TOOL_VERSION })

      expect(result.renumbered).toBe(true)
      const renumber = manifestLines(caseDir).filter((line) => line.type === 'renumber')
      expect(renumber).toHaveLength(1)
      expect(renumber[0].caseId).toBe(caseId)
      expect(renumber[0].schemaVersion).toBe(3)
      expect(renumber[0].assignments).toEqual([
        { exhibitId: listExhibits(caseId)[0].id, exhibitNumber: 1, manifestIndex: 0 }
      ])
      expect(verifyManifestChain(caseDir).valid).toBe(true)
    })

    it('lists a capture with no manifest entry as unanchored in the renumber entry', async () => {
      insertCapture({
        id: 'legacy-1',
        caseId,
        url: 'https://example.com/legacy',
        title: 'Legacy',
        hash: 'c'.repeat(64),
        timestamp: '2026-01-01T00:00:00.000Z'
      })

      await backfillCase(caseId, { toolVersion: TOOL_VERSION })

      const [renumber] = manifestLines(caseDir).filter((line) => line.type === 'renumber')
      // Present-means-anchored: the key is OMITTED, never null, so the chain
      // states plainly that this number is a citation aid and not an anchoring
      // claim.
      expect(renumber.assignments).toEqual([{ exhibitId: 'legacy-1', exhibitNumber: 1 }])
      expect(getExhibit('legacy-1')?.manifestSeq).toBeNull()
    })

    it('anchors a regenerated thumbnail with a derivation entry', async () => {
      const capture = await ingestInto(caseId, {
        url: 'https://example.com/shot',
        title: 'Shot',
        timestamp: '2026-04-05T12:00:00.000Z',
        screenshot: await screenshotPng({ r: 10, g: 120, b: 200 })
      })

      const result = await backfillCase(caseId, { toolVersion: TOOL_VERSION })
      expect(result.thumbnailsAnchored).toBe(1)
      expect(result.thumbnailsUnanchored).toBe(0)

      const [derived] = listDerivedFilesForCase(caseId)
      expect(derived.exhibitId).toBe(capture.id)
      expect(derived.derivation).toBe(THUMBNAIL_DERIVATION)
      expect(derived.toolVersion).toBe(TOOL_VERSION)
      expect(derived.manifestSeq).not.toBeNull()

      const thumbAbs = defaultCaptureStore.thumbnailPaths(caseId, capture.id).abs
      const onDisk = createHash('sha256').update(readFileSync(thumbAbs)).digest('hex')
      expect(derived.contentHash).toBe(onDisk)

      // The anchored bytes are the ones `renderThumbnail` reproduces from the
      // same parent screenshot: the backfill and `getThumbnail` share one
      // pipeline, so a regenerated thumbnail still hashes to what was signed.
      const parentAbs = defaultCaptureStore.artifactPaths(caseId, capture.id, 'png').abs
      const rerendered = await renderThumbnail(readFileSync(parentAbs))
      expect(createHash('sha256').update(rerendered).digest('hex')).toBe(onDisk)

      const [entry] = manifestLines(caseDir).filter((line) => line.type === 'derivation')
      expect(entry).toMatchObject({
        caseId,
        parentExhibitId: capture.id,
        parentContentHash: capture.hash,
        derivation: THUMBNAIL_DERIVATION,
        derivationToolVersion: TOOL_VERSION,
        outputHash: onDisk,
        outputPath: derived.path,
        schemaVersion: 3
      })
      expect(entry.index).toBe(derived.manifestSeq)
      expect(verifyManifestChain(caseDir).valid).toBe(true)
    })

    it('leaves a thumbnail unanchored when the screenshot no longer verifies', async () => {
      const capture = await ingestInto(caseId, {
        url: 'https://example.com/swapped',
        title: 'Swapped',
        timestamp: '2026-04-05T12:00:00.000Z',
        screenshot: await screenshotPng({ r: 200, g: 30, b: 30 })
      })
      // Swap the screenshot AFTER ingest: hashing what is on disk now and
      // anchoring a thumbnail computed from it would put a swapped file's
      // derivative into the chain under this migration's signature (X34).
      writeFileSync(
        defaultCaptureStore.artifactPaths(caseId, capture.id, 'png').abs,
        await screenshotPng({ r: 30, g: 30, b: 200 })
      )
      const thumb = defaultCaptureStore.thumbnailPaths(caseId, capture.id)
      writeFileSync(thumb.abs, Buffer.from('legacy thumbnail bytes'))

      const result = await backfillCase(caseId, { toolVersion: TOOL_VERSION })

      expect(result.thumbnailsAnchored).toBe(0)
      expect(result.thumbnailsUnanchored).toBe(1)
      const [derived] = listDerivedFilesForCase(caseId)
      expect(derived.manifestSeq).toBeNull()
      expect(derived.contentHash).toBe(
        createHash('sha256').update('legacy thumbnail bytes').digest('hex')
      )
      expect(manifestLines(caseDir).filter((line) => line.type === 'derivation')).toHaveLength(0)
    })

    it('records nothing for a capture with neither a screenshot nor a thumbnail', async () => {
      await ingestInto(caseId, {
        url: 'https://example.com/bare',
        title: 'Bare',
        timestamp: '2026-04-05T12:00:00.000Z'
      })

      const result = await backfillCase(caseId, { toolVersion: TOOL_VERSION })

      expect(result.thumbnailsAnchored).toBe(0)
      expect(result.thumbnailsUnanchored).toBe(0)
      expect(listDerivedFilesForCase(caseId)).toEqual([])
    })

    it('binds the derivation entry to the chain content hash, not the editable mirror', async () => {
      const capture = await ingestInto(caseId, {
        url: 'https://example.com/mirror',
        title: 'Mirror',
        timestamp: '2026-04-05T12:00:00.000Z',
        screenshot: await screenshotPng({ r: 90, g: 40, b: 10 })
      })
      // `exhibits.content_hash` and `captures.hash` are mirrors of the signed
      // capture entry, and `captures` is in the Database Admin hatch's allowed
      // tables. Edit both before the backfill runs: an operator (or anything
      // with write access to the .db) can do exactly this before upgrading.
      const edited = 'de'.repeat(32)
      getDb().prepare('UPDATE exhibits SET content_hash = ? WHERE id = ?').run(edited, capture.id)
      getDb().prepare('UPDATE captures SET hash = ? WHERE id = ?').run(edited, capture.id)

      await backfillCase(caseId, { toolVersion: TOOL_VERSION })

      const [entry] = manifestLines(caseDir).filter((line) => line.type === 'derivation')
      // The signed entry states the parent hash the CHAIN attests, so an edited
      // mirror never gets a signature over a claim no capture entry supports.
      expect(entry.parentContentHash).toBe(capture.hash)
      expect(entry.parentContentHash).not.toBe(edited)
      const chain = verifyManifestChain(caseDir)
      expect(chain.valid).toBe(true)
      expect(chain.captureEntriesByIndex.get(0)?.contentHash).toBe(entry.parentContentHash)
    })

    it('rolls the derivation entry back when its derived-file row cannot be written', async () => {
      await ingestInto(caseId, {
        url: 'https://example.com/rollback',
        title: 'Rollback',
        timestamp: '2026-04-05T12:00:00.000Z',
        screenshot: await screenshotPng({ r: 15, g: 90, b: 15 })
      })
      // Fails the INSERT while leaving the `hasDerivation` SELECT working, so
      // the throw lands between the append and the row exactly as a failed
      // write would.
      getDb().exec(
        `CREATE TRIGGER block_derived_insert BEFORE INSERT ON derived_files
         BEGIN SELECT RAISE(ABORT, 'no row for you'); END`
      )

      await expect(backfillCase(caseId, { toolVersion: TOOL_VERSION })).rejects.toThrow()

      expect(manifestLines(caseDir).filter((line) => line.type === 'derivation')).toHaveLength(0)
      expect(listDerivedFilesForCase(caseId)).toEqual([])
      expect(verifyManifestChain(caseDir).valid).toBe(true)

      getDb().exec('DROP TRIGGER block_derived_insert')
      await backfillCase(caseId, { toolVersion: TOOL_VERSION })
      expect(manifestLines(caseDir).filter((line) => line.type === 'derivation')).toHaveLength(1)
    })

    it('records the row against a derivation entry a previous run already appended', async () => {
      const capture = await ingestInto(caseId, {
        url: 'https://example.com/killed',
        title: 'Killed',
        timestamp: '2026-04-05T12:00:00.000Z',
        screenshot: await screenshotPng({ r: 40, g: 40, b: 160 })
      })
      await backfillCase(caseId, { toolVersion: TOOL_VERSION })
      const [entry] = manifestLines(caseDir).filter((line) => line.type === 'derivation')
      // A kill between the signed append and its database row: the entry is on
      // the chain, the row never landed.
      getDb().prepare('DELETE FROM derived_files WHERE exhibit_id = ?').run(capture.id)

      const result = await backfillCase(caseId, { toolVersion: TOOL_VERSION })

      // One entry, not two. A second signed entry for the same Derived File
      // would leave two timestamps and two hashes for one file.
      expect(manifestLines(caseDir).filter((line) => line.type === 'derivation')).toHaveLength(1)
      expect(result.thumbnailsAnchored).toBe(1)
      const [derived] = listDerivedFilesForCase(caseId)
      expect(derived.manifestSeq).toBe(entry.index)
      expect(derived.contentHash).toBe(entry.outputHash)
    })

    it('leaves the row unanchored when the bytes no longer match the entry already appended', async () => {
      const capture = await ingestInto(caseId, {
        url: 'https://example.com/killed-swapped',
        title: 'Killed and swapped',
        timestamp: '2026-04-05T12:00:00.000Z',
        screenshot: await screenshotPng({ r: 160, g: 40, b: 40 })
      })
      await backfillCase(caseId, { toolVersion: TOOL_VERSION })
      getDb().prepare('DELETE FROM derived_files WHERE exhibit_id = ?').run(capture.id)
      writeFileSync(
        defaultCaptureStore.thumbnailPaths(caseId, capture.id).abs,
        Buffer.from('not the bytes the entry names')
      )

      const result = await backfillCase(caseId, { toolVersion: TOOL_VERSION })

      expect(manifestLines(caseDir).filter((line) => line.type === 'derivation')).toHaveLength(1)
      expect(result.thumbnailsAnchored).toBe(0)
      expect(result.thumbnailsUnanchored).toBe(1)
      expect(listDerivedFilesForCase(caseId)[0].manifestSeq).toBeNull()
    })

    it('appends nothing on a second run', async () => {
      await ingestInto(caseId, {
        url: 'https://example.com/idem',
        title: 'Idempotent',
        timestamp: '2026-04-05T12:00:00.000Z',
        screenshot: await screenshotPng({ r: 5, g: 5, b: 5 })
      })
      await backfillCase(caseId, { toolVersion: TOOL_VERSION })
      const after = manifestLines(caseDir)

      const second = await backfillCase(caseId, { toolVersion: TOOL_VERSION })

      expect(second).toEqual({
        caseId,
        exhibitsCreated: 0,
        renumbered: false,
        thumbnailsAnchored: 0,
        thumbnailsUnanchored: 0
      })
      expect(manifestLines(caseDir)).toEqual(after)
      expect(listDerivedFilesForCase(caseId)).toHaveLength(1)
    })

    it('does nothing for a case with no captures', async () => {
      const empty = createCase({ name: 'Empty' }).id
      ensureCaseDir(empty)

      const result = await backfillCase(empty, { toolVersion: TOOL_VERSION })

      expect(result.renumbered).toBe(false)
      expect(existsSync(join(storageRoot, empty, MANIFEST_FILENAME))).toBe(false)
    })

    it('fills exhibit rows a capture insert path missed, in manifest order', async () => {
      // Straight into `captures`, past insertCapture: the state the v34
      // migration exists to repair, and the reason the backfill re-checks
      // rather than trusting that it ran.
      //
      // `raw-dup` is shaped like a duplicate (#827) — it carries the source
      // page's earlier timestamp with a LATER manifest index — so insertion
      // order, timestamp order and chain order all disagree. The chain order is
      // the one X18 fixes, and it is what the numbers must follow.
      const insert = getDb().prepare(
        `INSERT INTO captures (id, case_id, url, title, hash, timestamp, created_at, format,
           method, manifest_index)
         VALUES (?, ?, ?, ?, 'aa', ?, '2026-03-01', 'mhtml', 'extension', ?)`
      )
      insert.run('raw-dup', caseId, 'https://example.com/dup', 'Dup', '2026-01-01', 4)
      insert.run('raw-first', caseId, 'https://example.com/first', 'First', '2026-02-01', 1)

      const result = await backfillCase(caseId, { toolVersion: TOOL_VERSION })

      expect(result.exhibitsCreated).toBe(2)
      expect(listExhibits(caseId).map((e) => [e.id, e.exhibitNumber])).toEqual([
        ['raw-first', 1],
        ['raw-dup', 2]
      ])
      expect(getExhibit('raw-first')).toMatchObject({ name: 'First' })
    })

    it('numbers every case and keeps going past one that fails', async () => {
      const archived = createCase({ name: 'Archived' }).id
      ensureCaseDir(archived)
      getDb().prepare('UPDATE cases SET archived = 1 WHERE id = ?').run(archived)
      insertCapture({
        caseId: archived,
        url: 'https://example.com/archived',
        title: 'Archived',
        hash: 'ab'.repeat(32),
        timestamp: '2026-04-05T12:00:00.000Z'
      })
      // No case directory on disk, so appending its renumber entry throws. An
      // archived Case is still evidence and still gets numbered, and one
      // unreadable directory must not stop the app from opening.
      const broken = createCase({ name: 'Broken' }).id
      insertCapture({
        caseId: broken,
        url: 'https://example.com/broken',
        title: 'Broken',
        hash: 'cd'.repeat(32),
        timestamp: '2026-04-05T12:00:00.000Z'
      })
      const logged = vi.spyOn(logger, 'error').mockImplementation(() => 'log-id')

      const results = await runExhibitBackfill({ toolVersion: TOOL_VERSION })

      expect(results.map((r) => r.caseId)).toEqual([caseId, archived])
      expect(results[1].renumbered).toBe(true)
      expect(logged).toHaveBeenCalledWith(
        'exhibits',
        'exhibits.backfill_failed',
        { caseId: expect.anything() },
        expect.anything()
      )
      logged.mockRestore()
    })
  })

  describe('inventory', () => {
    it('returns anchored and staged rows in one list with on-disk existence', async () => {
      const capture = await ingestInto(caseId, {
        url: 'https://example.com/inventory',
        title: 'Inventory',
        timestamp: '2026-04-05T12:00:00.000Z',
        screenshot: await screenshotPng({ r: 1, g: 2, b: 3 })
      })
      await backfillCase(caseId, { toolVersion: TOOL_VERSION })
      insertStagingFile({
        caseId,
        kind: 'attachment',
        origin: 'manual-upload',
        name: 'statement.pdf',
        contentHash: 'e'.repeat(64),
        path: join(caseId, 'staging', 'statement.pdf'),
        sizeBytes: 12,
        arrivedAt: '2026-04-06T09:00:00.000Z',
        sourceUrl: 'https://example.com/statement.pdf'
      })
      // The missing-file case: the row stays, the existence column tells the
      // truth about it.
      unlinkSync(defaultCaptureStore.resolveAbsolute(capture.mhtmlPath!))

      const { rows } = getCaseInventory(caseId)

      expect(rows.map((row) => `${row.rowType}:${row.entity}`)).toEqual([
        'anchored:exhibit',
        'anchored:derived-file',
        'staged:staged-file'
      ])
      const exhibit = rows[0] as InventoryExhibitRow
      expect(exhibit).toMatchObject({
        id: capture.id,
        kind: 'capture',
        origin: 'extension',
        exhibitNumber: 1,
        name: 'Inventory',
        contentHash: capture.hash,
        anchored: true,
        exists: false
      })
      expect(rows[1]).toMatchObject({
        entity: 'derived-file',
        parentExhibitId: capture.id,
        derivation: THUMBNAIL_DERIVATION,
        anchored: true,
        exists: true
      })
      const staged = rows[2] as InventoryStagedRow
      expect(staged).toMatchObject({
        name: 'statement.pdf',
        kind: 'attachment',
        sourceUrl: 'https://example.com/statement.pdf',
        exists: false
      })
    })

    it('drops the exhibit, its tags and its derived files when the capture goes', async () => {
      const capture = insertCapture({
        caseId,
        url: 'https://example.com/doomed',
        title: 'Doomed',
        hash: 'f'.repeat(64),
        timestamp: '2026-04-05T12:00:00.000Z'
      })
      const tag = createTag({ name: 'gone' })
      addTagToCapture({ captureId: capture.id, tagId: tag.id })

      expect(deleteCapture(capture.id)).toBe(true)

      expect(getExhibit(capture.id)).toBeUndefined()
      expect(getCaseInventory(caseId).rows).toEqual([])
      expect(
        getDb().prepare('SELECT COUNT(*) AS n FROM exhibit_tags').get() as { n: number }
      ).toEqual({ n: 0 })
    })

    it('continues numbering above the highest number the case has used', () => {
      const first = insertCapture({
        caseId,
        url: 'https://example.com/1',
        title: '1',
        hash: '1'.repeat(64),
        timestamp: '2026-04-05T12:00:00.000Z'
      })
      const second = insertCapture({
        caseId,
        url: 'https://example.com/2',
        title: '2',
        hash: '2'.repeat(64),
        timestamp: '2026-04-05T12:01:00.000Z'
      })
      expect(getExhibit(first.id)?.exhibitNumber).toBe(1)
      expect(getExhibit(second.id)?.exhibitNumber).toBe(2)
      expect(nextExhibitNumber(caseId)).toBe(3)
    })
  })

  describe('manifest snapshot', () => {
    it('types the entries, reports the chain verdict and one local signer', async () => {
      await ingestInto(caseId, {
        url: 'https://example.com/snapshot',
        title: 'Snapshot',
        timestamp: '2026-04-05T12:00:00.000Z'
      })
      await backfillCase(caseId, { toolVersion: TOOL_VERSION })

      const snapshot = getManifestSnapshot(caseId)

      expect(snapshot.caseId).toBe(caseId)
      expect(snapshot.entries.map((entry) => (entry.parsed ? entry.entry.type : 'unparsed'))).toEqual(
        ['capture', 'renumber']
      )
      expect(snapshot.chain).toEqual({ valid: true })
      expect(snapshot.head?.index).toBe(1)
      expect(snapshot.signers).toEqual([
        { fromIndex: 0, toIndex: 1, fingerprint: spkiFingerprint(getPublicKeyPem()), source: 'local' }
      ])
    })

    it('passes the broken-chain verdict through with its position and reason', async () => {
      await ingestInto(caseId, {
        url: 'https://example.com/tamper',
        title: 'Tamper',
        timestamp: '2026-04-05T12:00:00.000Z'
      })
      const path = join(caseDir, MANIFEST_FILENAME)
      writeFileSync(
        path,
        readFileSync(path, 'utf-8').replace('example.com/tamper', 'example.com/edited')
      )

      const snapshot = getManifestSnapshot(caseId)

      expect(snapshot.chain.valid).toBe(false)
      expect(snapshot.chain.brokenAt).toBe(0)
      expect(snapshot.chain.reason).toBe('Entry hash mismatch')
      expect(snapshot.chain.unsupported).toBeUndefined()
    })

    it('names an unparseable line instead of dropping it', () => {
      writeFileSync(join(caseDir, MANIFEST_FILENAME), '{"type":"capture"}\n')

      const snapshot = getManifestSnapshot(caseId)

      expect(snapshot.entries).toEqual([
        { index: 0, parsed: false, reason: 'Entry does not match the manifest schema' }
      ])
      expect(snapshot.chain.valid).toBe(false)
    })

    it('reports a newer-schema entry as verifier-too-old and never as tampering', async () => {
      await ingestInto(caseId, {
        url: 'https://example.com/newer',
        title: 'Newer',
        timestamp: '2026-04-05T12:00:00.000Z'
      })
      appendSignedLine(caseDir, {
        type: 'annotation-burn',
        caseId,
        timestamp: '2026-04-05T12:30:00.000Z',
        operatorId: 'op-1',
        operatorName: 'Test Operator',
        toolVersion: TOOL_VERSION,
        schemaVersion: 4
      })

      const snapshot = getManifestSnapshot(caseId)

      // The whole point of X25: a chain this build is too old to read is its own
      // outcome, and a caller must never render it as a tamper verdict.
      expect(snapshot.chain.unsupported).toEqual({
        index: 1,
        entryType: 'annotation-burn',
        schemaVersionSeen: 4,
        supportedSchemaVersion: 3
      })
      expect(snapshot.chain.brokenAt).toBeUndefined()
      expect(snapshot.chain.reason).toContain('verifier too old')
    })

    it('reports no signer segments for a chain that did not verify', async () => {
      await ingestInto(caseId, {
        url: 'https://example.com/unsigned-signers',
        title: 'Unsigned',
        timestamp: '2026-04-05T12:00:00.000Z'
      })
      const path = join(caseDir, MANIFEST_FILENAME)
      writeFileSync(
        path,
        readFileSync(path, 'utf-8').replace('unsigned-signers', 'something-else')
      )

      const snapshot = getManifestSnapshot(caseId)

      // The keys segments are cut on come out of `import` lines. On a chain
      // that did not verify those are a forger's lines, and attributing custody
      // to them would be taking their word for who signed what.
      expect(snapshot.chain.valid).toBe(false)
      expect(snapshot.signers).toEqual([])
    })

    it('segments a real imported case at its import boundary', async () => {
      await ingestInto(caseId, {
        url: 'https://example.com/exported',
        title: 'Exported',
        timestamp: '2026-04-05T12:00:00.000Z'
      })
      await backfillCase(caseId, { toolVersion: TOOL_VERSION })
      const archivePath = join(tempDir, 'round-trip.birdbrain')
      await exportCaseArchive(caseId, archivePath)
      const { newCaseId } = await importCaseArchive(archivePath)

      const snapshot = getManifestSnapshot(newCaseId)

      // Exercised through a real export/import rather than a hand-built entry,
      // so the wiring from the manifest on disk to the segments is covered.
      // Both fingerprints are this installation's: a same-process round trip
      // signs the source entries and the `import` entry with one key, so this
      // pins the boundaries and the `embedded`/`local` split, not two distinct
      // keys — that answer stays with the synthetic case below.
      expect(snapshot.chain.valid).toBe(true)
      const importIndex = snapshot.entries.findIndex(
        (entry) => entry.parsed && entry.entry.type === 'import'
      )
      expect(importIndex).toBeGreaterThan(0)
      expect(snapshot.signers).toEqual([
        {
          fromIndex: 0,
          toIndex: importIndex - 1,
          fingerprint: spkiFingerprint(getPublicKeyPem()),
          source: 'embedded'
        },
        {
          fromIndex: importIndex,
          toIndex: snapshot.entries.length - 1,
          fingerprint: spkiFingerprint(getPublicKeyPem()),
          source: 'local'
        }
      ])
    })

    it('reports one fingerprint per signing segment for an imported chain', () => {
      // Two hops of custody: entries 0-1 signed by the source key the `import`
      // entry at 2 embeds, entries 2-3 by the local key. Reporting one signer
      // here would describe the first segment with a key that never signed it.
      const sourcePem = generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
      }).publicKey
      const entries: ManifestSnapshotEntry[] = [0, 1, 2, 3].map((index) => ({
        index,
        parsed: false,
        reason: 'placeholder'
      }))
      entries[2] = {
        index: 2,
        parsed: true,
        // Only `type` and `sourcePublicKeyPem` are read; the rest of the entry
        // is irrelevant to segmentation.
        entry: { type: 'import', sourcePublicKeyPem: sourcePem } as unknown as ManifestEntry
      }

      expect(signerSegments(entries, getPublicKeyPem())).toEqual([
        { fromIndex: 0, toIndex: 1, fingerprint: spkiFingerprint(sourcePem), source: 'embedded' },
        {
          fromIndex: 2,
          toIndex: 3,
          fingerprint: spkiFingerprint(getPublicKeyPem()),
          source: 'local'
        }
      ])
    })

    it('reports no signer for an empty manifest and a null fingerprint for an unreadable key', () => {
      expect(signerSegments([], getPublicKeyPem())).toEqual([])
      expect(signerSegments([{ index: 0, parsed: false, reason: 'x' }], 'not a pem')).toEqual([
        { fromIndex: 0, toIndex: 0, fingerprint: null, source: 'local' }
      ])
    })
  })

  describe('exhibits:verify', () => {
    it('returns the same result as captures:verify for the same capture', async () => {
      const capture = await ingestInto(caseId, {
        url: 'https://example.com/verify',
        title: 'Verify',
        timestamp: '2026-04-05T12:00:00.000Z'
      })

      const direct = await verifyCapture(capture.id)
      const viaExhibit = await verifyExhibit(caseId, capture.id)

      expect(viaExhibit.capture).toEqual(direct)
      expect(viaExhibit.status).toBe(direct.status)
      expect(viaExhibit.kind).toBe('capture')
    })

    it('reports an unknown exhibit as missing rather than throwing', async () => {
      expect(await verifyExhibit(caseId, 'no-such-exhibit')).toEqual({
        exhibitId: 'no-such-exhibit',
        caseId,
        kind: 'unknown',
        status: 'missing',
        reason: 'Exhibit not found in this case'
      })
    })

    it('reports a kind with no verify path yet as unsupported', async () => {
      getDb()
        .prepare(
          `INSERT INTO exhibits (id, case_id, kind, origin, exhibit_number, name,
             content_hash, path, size_bytes, committed_at, manifest_seq)
           VALUES ('att-1', ?, 'attachment', 'manual-upload', 1, 'brief.pdf', 'aa', NULL, NULL,
                   '2026-04-05T12:00:00.000Z', NULL)`
        )
        .run(caseId)

      const result = await verifyExhibit(caseId, 'att-1')

      expect(result.status).toBe('unsupported')
      expect(result.kind).toBe('attachment')
    })
  })

  describe('repositories', () => {
    it('reads a derived file back by id and by parent', () => {
      const capture = insertCapture({
        caseId,
        url: 'https://example.com/derived',
        title: 'Derived',
        hash: '3'.repeat(64),
        timestamp: '2026-04-05T12:00:00.000Z'
      })
      expect(hasDerivation(capture.id, THUMBNAIL_DERIVATION)).toBe(false)

      const created = insertDerivedFile({
        exhibitId: capture.id,
        derivation: 'text',
        toolVersion: TOOL_VERSION,
        contentHash: '4'.repeat(64),
        path: join(caseId, `${capture.id}.txt`),
        createdAt: '2026-04-05T12:05:00.000Z'
      })

      expect(getDerivedFile(created.id)).toEqual(created)
      expect(listDerivedFilesForExhibit(capture.id)).toEqual([created])
      expect(hasDerivation(capture.id, 'text')).toBe(true)
      // Unanchored by default: a Derived File is only anchored once a
      // `derivation` entry carries it.
      expect(created.manifestSeq).toBeNull()
    })

    it('reads, lists and discards a pooled file', () => {
      const staged = insertStagingFile({
        caseId,
        kind: 'attachment',
        origin: 'manual-upload',
        name: 'pooled.pdf',
        contentHash: '5'.repeat(64),
        path: join(caseId, 'staging', 'pooled.pdf'),
        sizeBytes: 7,
        arrivedAt: '2026-04-06T09:00:00.000Z'
      })

      expect(getStagingFile(staged.id)).toEqual(staged)
      expect(staged.sourceUrl).toBeNull()
      expect(staged.sourceClaims).toBeNull()
      expect(listStagingFiles(caseId)).toEqual([staged])
      // Discard writes nothing to the chain — the pool is outside it (X29).
      expect(deleteStagingFile(staged.id)).toBe(true)
      expect(deleteStagingFile(staged.id)).toBe(false)
      expect(listStagingFiles(caseId)).toEqual([])
      expect(existsSync(join(caseDir, MANIFEST_FILENAME))).toBe(true)
      expect(readFileSync(join(caseDir, MANIFEST_FILENAME), 'utf-8')).toBe('')
    })
  })

  describe('storage layout', () => {
    it('places each kind in its own directory and captures flat', () => {
      const store = createCaptureStore({ getRoot: () => storageRoot })
      expect(store.exhibitPaths(caseId, 'capture', 'a.mhtml').rel).toBe(join(caseId, 'a.mhtml'))
      expect(store.exhibitPaths(caseId, 'attachment', 'a.pdf').rel).toBe(
        join(caseId, 'attachments', 'a.pdf')
      )
      expect(store.exhibitPaths(caseId, 'image', 'a.jpg').rel).toBe(join(caseId, 'images', 'a.jpg'))
      expect(store.exhibitPaths(caseId, 'document', 'a.pdf').rel).toBe(
        join(caseId, 'documents', 'a.pdf')
      )
      expect(store.stagingPaths(caseId, 'a.pdf').rel).toBe(join(caseId, 'staging', 'a.pdf'))
      expect(store.existsRelative(null)).toBe(false)
      expect(store.existsRelative('')).toBe(false)
    })

    it('counts the subdirectories in the case storage size', () => {
      const flat = join(storageRoot, caseId, 'flat.mhtml')
      writeFileSync(flat, Buffer.alloc(10))
      const before = getCaseStorageSize(caseId)

      const pooled = defaultCaptureStore.stagingPaths(caseId, 'pooled.pdf')
      mkdirSync(join(storageRoot, caseId, 'staging'), { recursive: true })
      writeFileSync(pooled.abs, Buffer.alloc(25))

      expect(before).toBe(10)
      expect(getCaseStorageSize(caseId)).toBe(35)
    })

    it('reports a stray pooled file as an orphan and leaves a recorded one alone', () => {
      mkdirSync(join(storageRoot, caseId, 'staging'), { recursive: true })
      const known = defaultCaptureStore.stagingPaths(caseId, 'known.pdf')
      const stray = defaultCaptureStore.stagingPaths(caseId, 'stray.pdf')
      writeFileSync(known.abs, 'known')
      writeFileSync(stray.abs, 'stray')
      insertStagingFile({
        caseId,
        kind: 'attachment',
        origin: 'manual-upload',
        name: 'known.pdf',
        contentHash: 'd'.repeat(64),
        path: known.rel,
        sizeBytes: 5,
        arrivedAt: '2026-04-06T09:00:00.000Z'
      })

      const { fileOrphans } = findOrphans()

      expect(fileOrphans).toContain(stray.rel)
      expect(fileOrphans).not.toContain(known.rel)
    })

    it('drops the exhibit row when orphan cleanup removes its capture', async () => {
      const capture = await ingestInto(caseId, {
        url: 'https://example.com/orphaned',
        title: 'Orphaned',
        timestamp: '2026-04-05T12:00:00.000Z'
      })
      unlinkSync(defaultCaptureStore.artifactPaths(caseId, capture.id, 'mhtml').abs)

      const report = findOrphans()
      expect(report.dbOrphans.map((orphan) => orphan.id)).toContain(capture.id)
      const { dbRecordsRemoved } = cleanOrphans(report)

      // A row left behind would keep a deleted Capture's tags alive and list it
      // in the inventory: `exhibits` hangs off `cases`, so nothing cascades.
      expect(dbRecordsRemoved).toBe(1)
      expect(getCapture(capture.id)).toBeUndefined()
      expect(getExhibit(capture.id)).toBeUndefined()
    })
  })

  it('gives a capture created after the migration an exhibit row at ingest', () => {
    const capture = insertCapture({
      caseId,
      url: 'https://example.com/after',
      title: '',
      hash: '9'.repeat(64),
      timestamp: '2026-04-05T12:00:00.000Z',
      mhtmlPath: join(caseId, 'after.mhtml'),
      sizeBytes: 42,
      manifestIndex: 7,
      method: 'background'
    })

    expect(getExhibit(capture.id)).toMatchObject({
      id: capture.id,
      caseId,
      kind: 'capture',
      origin: 'background',
      // No title, so the URL is the recorded display name — never the storage
      // path (X35).
      name: 'https://example.com/after',
      contentHash: '9'.repeat(64),
      path: join(caseId, 'after.mhtml'),
      sizeBytes: 42,
      manifestSeq: 7
    })
    expect(getCapture(capture.id)?.id).toBe(capture.id)
  })
})
