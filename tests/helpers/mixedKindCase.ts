import { mkdirSync, writeFileSync } from 'fs'
import { createHash } from 'crypto'
import { join } from 'path'
import { Readable } from 'stream'
import sharp from 'sharp'
import { createCase } from '@main/services/db/caseRepo'
import { listExhibits } from '@main/services/db/exhibitRepo'
import { insertDerivedFile, listDerivedFilesForCase } from '@main/services/db/derivedFileRepo'
import { ensureCaseDir } from '@main/services/storage'
import { initManifest } from '@main/services/manifest'
import { ingestMhtmlCapture } from '@main/services/captureLifecycle'
import { commitStagedFiles, uploadToStaging } from '@main/services/staging'
import { backfillCase } from '@main/services/exhibitBackfill'
import type { Exhibit } from '@shared/types'

// The one mixed-kind fixture Case the export tests, the package-verifier tests
// and the built-binary tests all build their packages from (#1156, D14).
//
// It holds every shape the Exhibit model can put in a package today: a Capture
// with its thumbnail Derived File (X34 — the only derivation that exists at
// head), and a committed attachment, image and document, each under the kind
// subdirectory the Case store uses. One definition, because three fixtures that
// drift produce three verifiers that agree with their own fixture and with
// nothing else.
//
// The caller owns the harness: storage, the database, settings and the
// installation id must already be initialised, exactly as each of those files
// already does in its own setup.

/** Magic bytes only — `detectExhibitKind` never reads the extension (X43). */
const ZIP_BYTES = Buffer.concat([
  Buffer.from([0x50, 0x4b, 0x03, 0x04]),
  Buffer.from('mixed-kind attachment payload')
])
const PDF_BYTES = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n')

export interface FixtureExhibit {
  id: string
  kind: string
  exhibitNumber: number
  bytes: Buffer
  /** Where the evidence package encloses it, e.g. `attachments/<id>.zip`. */
  packagePath: string
}

export interface MixedKindCase {
  caseId: string
  captureId: string
  captureHash: string
  /** Package path of the Capture's thumbnail Derived File. */
  thumbnailPackagePath: string
  attachment: FixtureExhibit
  image: FixtureExhibit
  document: FixtureExhibit
  /** The three committed non-Capture Exhibits, in Exhibit Number order. */
  committed: FixtureExhibit[]
}

function fixtureExhibit(exhibit: Exhibit, bytes: Buffer, extension: string): FixtureExhibit {
  return {
    id: exhibit.id,
    kind: exhibit.kind,
    exhibitNumber: exhibit.exhibitNumber,
    bytes,
    packagePath: `${exhibit.kind === 'image' ? 'images' : exhibit.kind + 's'}/${exhibit.id}${extension}`
  }
}

/**
 * A Derived File the chain does not anchor, of the exact shape
 * `exhibitBackfill.ts` writes when a thumbnail's source screenshot is missing
 * or fails verification (X34). The bytes are on disk and the row exists; no
 * `derivation` entry names either.
 */
export function seedUnanchoredDerivedFile(
  tempDir: string,
  caseId: string,
  exhibitId: string,
  derivation = 'text'
): { id: string; storedPath: string; bytes: Buffer } {
  const bytes = Buffer.from(`unanchored ${derivation} for ${exhibitId}`)
  const storedPath = join(caseId, `${exhibitId}_${derivation}.txt`)
  writeFileSync(join(tempDir, 'captures', storedPath), bytes)
  const row = insertDerivedFile({
    exhibitId,
    derivation,
    toolVersion: '0.1.0',
    contentHash: createHash('sha256').update(bytes).digest('hex'),
    path: storedPath,
    createdAt: '2026-04-05T12:05:00.000Z'
  })
  return { id: row.id, storedPath, bytes }
}

export async function seedMixedKindCase(options: {
  tempDir: string
  name?: string
}): Promise<MixedKindCase> {
  const { tempDir } = options
  const created = createCase({ name: options.name ?? 'Mixed Kind Case', description: 'every kind' })
  const caseId = created.id
  ensureCaseDir(caseId)
  initManifest(join(tempDir, 'captures', caseId))

  const png = await sharp({
    create: { width: 24, height: 24, channels: 4, background: { r: 5, g: 5, b: 5, alpha: 1 } }
  })
    .png()
    .toBuffer()

  const { capture } = await ingestMhtmlCapture({
    caseId,
    url: 'https://example.com/page',
    title: 'Page',
    timestamp: '2026-04-05T12:00:00.000Z',
    stream: Readable.from([
      Buffer.from('<html><body>Mixed kind packaged</body></html>')
    ]) as unknown as ReadableStream<Uint8Array>,
    textContent: 'extracted text',
    headers: {},
    browserVersion: '',
    userAgent: '',
    httpStatus: 200,
    extensionVersion: '',
    operatorId: 'op',
    operatorName: '',
    toolVersion: '0.1.0',
    screenshot: png
  })

  const uploads = join(tempDir, `uploads-${caseId}`)
  mkdirSync(uploads, { recursive: true })
  const source = (name: string, bytes: Buffer): string => {
    const path = join(uploads, name)
    writeFileSync(path, bytes)
    return path
  }
  const staged = await uploadToStaging(caseId, [
    source('bundle.zip', ZIP_BYTES),
    source('photo.png', png),
    source('statement.pdf', PDF_BYTES)
  ])
  await commitStagedFiles(
    caseId,
    staged.map((row) => row.id)
  )

  // Anchors the Capture's thumbnail as a Derived File and writes the Case's
  // `renumber` entry, which is where a Capture's Exhibit Number lives in the
  // chain — the number the verifier cites when it names a finding.
  await backfillCase(caseId, { toolVersion: '0.1.0' })

  const exhibits = listExhibits(caseId)
  const byKind = (kind: string): Exhibit => exhibits.find((e) => e.kind === kind)!
  const attachment = fixtureExhibit(byKind('attachment'), ZIP_BYTES, '.zip')
  const image = fixtureExhibit(byKind('image'), png, '.png')
  const document = fixtureExhibit(byKind('document'), PDF_BYTES, '.pdf')

  const thumbnail = listDerivedFilesForCase(caseId).find((file) => file.exhibitId === capture.id)
  if (!thumbnail) throw new Error('mixed-kind fixture: the capture thumbnail was not anchored')

  return {
    caseId,
    captureId: capture.id,
    captureHash: capture.hash,
    thumbnailPackagePath: `pages/${capture.id}_thumb.jpg`,
    attachment,
    image,
    document,
    committed: [attachment, image, document].sort((a, b) => a.exhibitNumber - b.exhibitNumber)
  }
}
