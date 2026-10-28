import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHash } from 'crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createCaptureStore, type CaptureArtifactType } from '@main/services/captureStore'
import { ManifestEntrySchema, type ManifestEntry } from '@shared/schemas'
import {
  BLOB_PARTIAL_SUFFIX,
  acceptBlob,
  anchoredFiles,
  missingAnchoredFiles,
  safeCasePath
} from '@main/services/sharing/blobAcceptance'
import {
  ENGINE_CAPTURE_ID,
  ENGINE_FILES,
  ENGINE_HASHES,
  engineCaptureEntry
} from '../../../helpers/captureEnginePackage'

// Acceptance of another member's bytes (#1512): a file becomes visible under
// its path only once the bytes on disk hash to what the entry anchors, and a
// path is written only inside the Case's own directory.

const CASE_ID = '0196f7a2-aaaa-bbbb-cccc-000000000004'
const sha = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex')

describe('blob acceptance', () => {
  let storageRoot: string

  beforeEach(() => {
    storageRoot = mkdtempSync(join(tmpdir(), 'bb-blob-acceptance-'))
    mkdirSync(join(storageRoot, CASE_ID), { recursive: true })
  })

  afterEach(() => {
    rmSync(storageRoot, { recursive: true, force: true })
  })

  describe('safeCasePath', () => {
    const safe = (path: string) => safeCasePath(storageRoot, CASE_ID, path)

    it('accepts paths inside the Case directory, in any nesting, with either separator', () => {
      expect(safe(`${CASE_ID}/x.mhtml`)).toBe(join(storageRoot, CASE_ID, 'x.mhtml'))
      expect(safe(`${CASE_ID}/documents/a.pdf`)).toBe(
        join(storageRoot, CASE_ID, 'documents', 'a.pdf')
      )
      expect(safe(`${CASE_ID}\\documents\\a.pdf`)).toBe(
        join(storageRoot, CASE_ID, 'documents', 'a.pdf')
      )
    })

    it('refuses paths that leave the Case directory, name another Case, or climb as written', () => {
      expect(safe('other-case/x.mhtml')).toBeNull()
      expect(safe(`${CASE_ID}/../other-case/x.mhtml`)).toBeNull()
      expect(safe(`${CASE_ID}/documents/../../other-case/x.mhtml`)).toBeNull()
      expect(safe(`${CASE_ID}/./x.mhtml`)).toBeNull()
      expect(safe(`${CASE_ID}`)).toBeNull()
      expect(safe(`${CASE_ID}-2/x.mhtml`)).toBeNull()
      expect(safe('/etc/passwd')).toBeNull()
      // An empty segment is refused as written, not normalized away.
      expect(safe(`${CASE_ID}//x.mhtml`)).toBeNull()
      expect(safe(`${CASE_ID}/x.mhtml/`)).toBeNull()
    })

    it('refuses the names the replica itself owns and the directories that never sync', () => {
      expect(safe(`${CASE_ID}/manifest.jsonl`)).toBeNull()
      expect(safe(`${CASE_ID}/manifest.installation-x.jsonl`)).toBeNull()
      expect(safe(`${CASE_ID}/members.json`)).toBeNull()
      expect(safe(`${CASE_ID}/sync-state.json`)).toBeNull()
      expect(safe(`${CASE_ID}/sync-pauses.json`)).toBeNull()
      expect(safe(`${CASE_ID}/staging/pooled.bin`)).toBeNull()
      expect(safe(`${CASE_ID}/.pending-delete/x/x.mhtml`)).toBeNull()
      expect(safe(`${CASE_ID}/x.mhtml${BLOB_PARTIAL_SUFFIX}`)).toBeNull()
      // A chain-like name below the top level is an ordinary file.
      expect(safe(`${CASE_ID}/documents/manifest.jsonl`)).not.toBeNull()
    })

    // Review finding 4 on this PR: a lineage chain path was admitted, and the
    // chain reader walks the lineage directory into the Shared Case walk.
    it('refuses lineage chains and everything else under the lineage directory', () => {
      expect(safe(`${CASE_ID}/lineage/0196-src-case/manifest.x.jsonl`)).toBeNull()
      expect(safe(`${CASE_ID}/lineage/0196-src-case/anything.pdf`)).toBeNull()
      expect(safe(`${CASE_ID}/lineage/manifest.x.jsonl`)).toBeNull()
    })

    // Only the archive import writes there, and binding trusts what it holds (#1017).
    it('refuses everything under the carried id map directory', () => {
      expect(safe(`${CASE_ID}/import-id-maps/${'a'.repeat(64)}.json`)).toBeNull()
      expect(safe(`${CASE_ID}/import-id-maps/anything.pdf`)).toBeNull()
      expect(safe(`${CASE_ID}/Import-Id-Maps/${'a'.repeat(64)}.json`)).toBeNull()
    })

    // A case-insensitive filesystem would hand a reserved name or a chain
    // file to a peer under another spelling.
    it('refuses reserved names, chain files and unsynced directories whatever their case', () => {
      expect(safe(`${CASE_ID}/MEMBERS.JSON`)).toBeNull()
      expect(safe(`${CASE_ID}/Sync-State.json`)).toBeNull()
      expect(safe(`${CASE_ID}/Manifest.installation-x.JSONL`)).toBeNull()
      expect(safe(`${CASE_ID}/Lineage/src/Manifest.x.jsonl`)).toBeNull()
      expect(safe(`${CASE_ID}/STAGING/pooled.bin`)).toBeNull()
      expect(safe(`${CASE_ID}/x.mhtml${BLOB_PARTIAL_SUFFIX.toUpperCase()}`)).toBeNull()
    })
  })

  describe('acceptBlob', () => {
    const accept = (path: string, bytes: Buffer, expectedHash = sha(bytes)) =>
      acceptBlob({ storageRoot, caseId: CASE_ID, path, expectedHash, bytes })

    it('writes a file whose bytes hash to the entry, leaving no partial behind', () => {
      const bytes = Buffer.from('%PDF statement')
      const path = `${CASE_ID}/documents/a.pdf`
      expect(accept(path, bytes)).toEqual({ outcome: 'accepted', bytes: bytes.length })
      expect(readFileSync(join(storageRoot, path))).toEqual(bytes)
      expect(readdirSync(join(storageRoot, CASE_ID, 'documents'))).toEqual(['a.pdf'])
    })

    it('never makes a mismatched file visible, and leaves no partial', () => {
      const path = `${CASE_ID}/documents/a.pdf`
      const result = accept(path, Buffer.from('tampered'), sha('original'))
      expect(result).toEqual({
        outcome: 'hash-mismatch',
        expected: sha('original'),
        actual: sha('tampered')
      })
      expect(existsSync(join(storageRoot, path))).toBe(false)
      expect(readdirSync(join(storageRoot, CASE_ID, 'documents'))).toEqual([])
    })

    it('replaces a partial a dead session left behind', () => {
      const path = `${CASE_ID}/x.mhtml`
      const partial = join(storageRoot, `${path}${BLOB_PARTIAL_SUFFIX}`)
      writeFileSync(partial, 'half of something')
      const bytes = Buffer.from('whole')
      expect(accept(path, bytes)).toEqual({ outcome: 'accepted', bytes: bytes.length })
      expect(readFileSync(join(storageRoot, path), 'utf-8')).toBe('whole')
      expect(existsSync(partial)).toBe(false)
    })

    it('refuses a path outside the Case directory before writing anything', () => {
      expect(accept('other-case/x.mhtml', Buffer.from('x'))).toEqual({ outcome: 'unsafe-path' })
      expect(existsSync(join(storageRoot, 'other-case'))).toBe(false)
    })
  })

  describe('anchoredFiles', () => {
    const store = createCaptureStore({ getRoot: () => storageRoot })
    const common = {
      caseId: CASE_ID,
      timestamp: '2026-10-01T00:00:00.000Z',
      operatorId: 'inst-a',
      operatorName: 'A',
      toolVersion: '0.0.0',
      prevHash: '',
      signature: 'sig',
      entryHash: 'h'
    }
    const entry = (body: Record<string, unknown>): ManifestEntry =>
      ManifestEntrySchema.parse({ ...common, ...body })

    it('lists one file per capture hash field present, plus exhibit and derivation outputs', () => {
      const entries = [
        entry({
          type: 'capture',
          index: 0,
          captureId: 'cap-1',
          url: 'https://example.com',
          contentHash: 'c'.repeat(64),
          screenshotHash: 's'.repeat(64),
          textHash: 't'.repeat(64),
          sizeBytes: 1,
          schemaVersion: 2
        }),
        entry({
          type: 'capture',
          index: 1,
          captureId: 'cap-2',
          url: 'https://example.com/2',
          contentHash: 'd'.repeat(64),
          sizeBytes: 1,
          schemaVersion: 2
        }),
        entry({
          type: 'exhibit',
          index: 2,
          exhibitId: 'x-1',
          kind: 'document',
          origin: 'manual-upload',
          name: 'a.pdf',
          exhibitNumber: 3,
          path: `${CASE_ID}/documents/x-1.pdf`,
          contentHash: 'e'.repeat(64),
          sizeBytes: 1,
          schemaVersion: 3
        }),
        entry({
          type: 'derivation',
          index: 3,
          parentExhibitId: 'x-1',
          parentContentHash: 'e'.repeat(64),
          derivation: 'thumbnail',
          derivationToolVersion: '1',
          outputHash: 'f'.repeat(64),
          outputPath: `${CASE_ID}/documents/x-1_thumb.jpg`,
          schemaVersion: 3
        })
      ]
      expect(anchoredFiles(entries, CASE_ID, store)).toEqual([
        { path: store.artifactPaths(CASE_ID, 'cap-1', 'mhtml').rel, hash: 'c'.repeat(64) },
        { path: store.artifactPaths(CASE_ID, 'cap-1', 'png').rel, hash: 's'.repeat(64) },
        { path: store.artifactPaths(CASE_ID, 'cap-1', 'txt').rel, hash: 't'.repeat(64) },
        { path: store.artifactPaths(CASE_ID, 'cap-2', 'mhtml').rel, hash: 'd'.repeat(64) },
        { path: `${CASE_ID}/documents/x-1.pdf`, hash: 'e'.repeat(64) },
        { path: `${CASE_ID}/documents/x-1_thumb.jpg`, hash: 'f'.repeat(64) }
      ])
    })

    // Plan D14: a member fetches and hash-checks the capture engine's two files
    // as it does the screenshot.
    it('lists the Transaction Record and the PDF a schema-6 entry anchors, for acceptance', () => {
      const capture = entry({ ...engineCaptureEntry(), caseId: CASE_ID, index: 0 })
      const pathOf = (type: CaptureArtifactType): string =>
        store.artifactPaths(CASE_ID, ENGINE_CAPTURE_ID, type).rel

      const files = anchoredFiles([capture], CASE_ID, store)

      expect(files).toEqual([
        { path: pathOf('mhtml'), hash: ENGINE_HASHES.page },
        { path: pathOf('png'), hash: ENGINE_HASHES.screenshot },
        { path: pathOf('warc.gz'), hash: ENGINE_HASHES.transactionRecord },
        { path: pathOf('pdf'), hash: ENGINE_HASHES.pdf }
      ])
      const [, , record, pdf] = files
      const accept = ({ path, hash }: { path: string; hash: string }, bytes: Buffer) =>
        acceptBlob({ storageRoot, caseId: CASE_ID, path, expectedHash: hash, bytes })
      expect(accept(record, ENGINE_FILES.pdf).outcome).toBe('hash-mismatch')
      expect(accept(record, ENGINE_FILES.transactionRecord).outcome).toBe('accepted')
      expect(accept(pdf, ENGINE_FILES.pdf).outcome).toBe('accepted')
      expect(store.readArtifact(CASE_ID, ENGINE_CAPTURE_ID, 'warc.gz')).toEqual(
        ENGINE_FILES.transactionRecord
      )
      expect(store.readArtifact(CASE_ID, ENGINE_CAPTURE_ID, 'pdf')).toEqual(ENGINE_FILES.pdf)
    })

    it('skips what the author deleted and the history before an import', () => {
      const entries = [
        entry({
          type: 'exhibit',
          index: 0,
          caseId: 'source-case',
          exhibitId: 'old',
          kind: 'document',
          origin: 'manual-upload',
          name: 'old.pdf',
          exhibitNumber: 1,
          path: 'source-case/documents/old.pdf',
          contentHash: 'a'.repeat(64),
          sizeBytes: 1,
          schemaVersion: 3
        }),
        entry({
          type: 'import',
          index: 1,
          sourceCaseId: 'source-case',
          sourceInstallationId: 'inst-s',
          sourcePublicKeyPem: 'pem',
          packageHash: 'p'.repeat(64),
          idMapSha256: 'i'.repeat(64),
          verificationResult: {
            overallValid: true,
            chainValid: true,
            artifactCount: 0,
            artifactFailureCount: 0,
            captureCount: 0,
            captureHashFailureCount: 0
          },
          schemaVersion: 2
        }),
        entry({
          type: 'capture',
          index: 2,
          captureId: 'cap-gone',
          url: 'https://example.com',
          contentHash: 'c'.repeat(64),
          sizeBytes: 1,
          schemaVersion: 2
        }),
        entry({
          type: 'exhibit',
          index: 3,
          exhibitId: 'x-gone',
          kind: 'document',
          origin: 'manual-upload',
          name: 'g.pdf',
          exhibitNumber: 2,
          path: `${CASE_ID}/documents/x-gone.pdf`,
          contentHash: 'e'.repeat(64),
          sizeBytes: 1,
          schemaVersion: 3
        }),
        entry({
          type: 'derivation',
          index: 4,
          parentExhibitId: 'x-gone',
          parentContentHash: 'e'.repeat(64),
          derivation: 'thumbnail',
          derivationToolVersion: '1',
          outputHash: 'f'.repeat(64),
          outputPath: `${CASE_ID}/documents/x-gone_thumb.jpg`,
          schemaVersion: 3
        }),
        entry({
          type: 'deletion',
          index: 5,
          captureId: 'cap-gone',
          contentHash: 'c'.repeat(64),
          schemaVersion: 2
        }),
        entry({
          type: 'deletion',
          index: 6,
          captureId: 'x-gone',
          contentHash: 'e'.repeat(64),
          schemaVersion: 2
        }),
        entry({
          type: 'exhibit',
          index: 7,
          exhibitId: 'x-kept',
          kind: 'document',
          origin: 'manual-upload',
          name: 'k.pdf',
          exhibitNumber: 3,
          path: `${CASE_ID}/documents/x-kept.pdf`,
          contentHash: 'b'.repeat(64),
          sizeBytes: 1,
          schemaVersion: 3
        })
      ]
      expect(anchoredFiles(entries, CASE_ID, store)).toEqual([
        { path: `${CASE_ID}/documents/x-kept.pdf`, hash: 'b'.repeat(64) }
      ])
    })
  })

  it('missingAnchoredFiles lists each absent path once and skips files on disk', () => {
    const present = `${CASE_ID}/present.mhtml`
    writeFileSync(join(storageRoot, present), 'here')
    const files = [
      { path: present, hash: 'a' },
      { path: `${CASE_ID}/absent.mhtml`, hash: 'b' },
      { path: `${CASE_ID}/absent.mhtml`, hash: 'b' },
      { path: `${CASE_ID}/documents/absent.pdf`, hash: 'c' }
    ]
    expect(missingAnchoredFiles(files, storageRoot)).toEqual([
      { path: `${CASE_ID}/absent.mhtml`, hash: 'b' },
      { path: `${CASE_ID}/documents/absent.pdf`, hash: 'c' }
    ])
  })
})
