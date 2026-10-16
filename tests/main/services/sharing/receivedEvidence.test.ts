import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHash } from 'crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import sharp from 'sharp'
import { closeDatabase, getDb } from '@main/services/db/core'
import {
  getCapture,
  listCaptures,
  searchCaptures,
  setCaptureTrustedTime
} from '@main/services/db/captureRepo'
import { getExhibit } from '@main/services/db/exhibitRepo'
import { listDerivedFilesForExhibit } from '@main/services/db/derivedFileRepo'
import { resetInstallationId } from '@main/services/installationId'
import { resetSigningKey } from '@main/services/signingKey'
import {
  appendManifestEntry,
  readManifestSnapshot,
  readSharedCaseSnapshot
} from '@main/services/manifest'
import { defaultCaptureStore } from '@main/services/captureStore'
import { createCaptureLifecycle, verifyCapture } from '@main/services/captureLifecycle'
import { createSelectorLifecycle } from '@main/services/selectorLifecycle'
import { createTimestampWorker } from '@main/services/timestampWorker'
import { backfillCase, runExhibitBackfill } from '@main/services/exhibitBackfill'
import { verifyCaseDerivedFiles } from '@main/services/exhibits'
import { getThumbnail } from '@main/services/thumbnails'
import { resetSyncStateMemory } from '@main/services/sharing/syncState'
import type { ManifestEntry } from '@shared/schemas'
import {
  activate,
  addCapture,
  addDocument,
  appendOwnChainLine,
  caseDirOf,
  createPeer,
  memberAddBody,
  memberChainText,
  ownChainText,
  parsedChain,
  pull,
  recordSource,
  seedSharedCase,
  TIME,
  type IngestedCapture,
  type Peer
} from '../../../helpers/syncPeers'
import { buildSyntheticToken } from '../../../helpers/timestampFixtures'

// Received evidence (#1811): after a sync, another member's Captures and
// Exhibits are rows on the receiver, attributed to their author, searchable,
// extracted, stamped through the author's chain, and removed on the author's
// deletion; and the receiver's own writers leave them alone. Every assertion
// is about the receiving peer's database, disk and chain. Content is invented.

const CASE_ID = '0196f7a2-aaaa-bbbb-cccc-000000001811'
const TITLE = 'Harbour Street ledger, March'
const sha = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex')

function mhtmlOf(title: string, body: string): Buffer {
  return Buffer.from(
    [
      'From: <Saved by Blink>',
      `Subject: ${title}`,
      'MIME-Version: 1.0',
      'Content-Type: multipart/related; type="text/html"; boundary="B1811"',
      '',
      '--B1811',
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: 7bit',
      'Content-Location: https://example.com/ledger',
      '',
      `<html><head><title>${title}</title></head><body>${body}</body></html>`,
      '--B1811--',
      ''
    ].join('\r\n')
  )
}

const realPng = (shade: number): Promise<Buffer> =>
  sharp({
    create: { width: 40, height: 30, channels: 3, background: { r: shade, g: 20, b: 30 } }
  })
    .png()
    .toBuffer()

const artifact = (id: string, type: 'mhtml' | 'png' | 'txt') =>
  defaultCaptureStore.artifactPaths(CASE_ID, id, type)

const by = (peer: Peer) => ({
  operatorId: peer.installationId,
  operatorName: peer.operatorName,
  toolVersion: '0.0.0'
})

// Every entry of the active peer's own chain other than its `merge` entries
// whose text names one of `needles`.
function ownEntriesNaming(needles: string[]): ManifestEntry[] {
  return parsedChain(ownChainText(CASE_ID)).filter((entry) => {
    if (entry.type === 'merge') return false
    const text = JSON.stringify(entry)
    return needles.some((needle) => text.includes(needle))
  })
}

describe('received evidence (#1811)', () => {
  let root: string
  let A: Peer
  let B: Peer
  let C: Peer

  const lifecycle = () =>
    createCaptureLifecycle({
      selectorLifecycle: createSelectorLifecycle({ emitRematched: () => {} })
    })

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'bb-received-'))
    A = await createPeer(root, 'alice', 'Alice Owner', 'AL')
    B = await createPeer(root, 'bob', 'Bob Member', 'BO')
    C = await createPeer(root, 'carol', 'Carol Member', 'CA')
    for (const peer of [A, B, C]) {
      await activate(peer)
      seedSharedCase(CASE_ID, A, [B, C])
    }
    await activate(A)
    appendOwnChainLine(CASE_ID, memberAddBody(CASE_ID, A, 'owner', A))
    appendOwnChainLine(CASE_ID, memberAddBody(CASE_ID, B, 'member', A))
    appendOwnChainLine(CASE_ID, memberAddBody(CASE_ID, C, 'member', A))
  })

  afterEach(() => {
    closeDatabase()
    resetInstallationId()
    resetSigningKey()
    resetSyncStateMemory()
    rmSync(root, { recursive: true, force: true })
  })

  describe('a received Capture', () => {
    let ledger: IngestedCapture
    let other: IngestedCapture

    beforeEach(async () => {
      await activate(A)
      ledger = await addCapture(CASE_ID, A, 1, {
        mhtml: mhtmlOf(TITLE, '<p>Contact analyst@ledger.example.org about the ledger.</p>'),
        text: 'The brackwater depot ledger for March'
      })
      other = await addCapture(CASE_ID, A, 2)
      const source = recordSource(CASE_ID, A)
      await activate(B)
      const result = await pull(CASE_ID, source)
      expect(result.errors).toEqual([])
      expect(result.capturesApplied).toBe(2)
    })

    it("is listed with the author's Member Code in its citation", () => {
      const listed = listCaptures(CASE_ID)
      expect(listed.map((c) => c.id).sort()).toEqual([ledger.captureId, other.captureId].sort())
      expect(getCapture(ledger.captureId)?.exhibitCitation).toBe('AL-1')
      expect(getCapture(other.captureId)?.exhibitCitation).toBe('AL-2')
      expect(getExhibit(ledger.captureId)).toMatchObject({
        authorInstallationId: A.installationId,
        memberCode: 'AL'
      })
    })

    it('takes its title from the received MHTML', () => {
      expect(getCapture(ledger.captureId)?.title).toBe(TITLE)
      const text = getDb()
        .prepare('SELECT title FROM capture_texts WHERE capture_id = ?')
        .get(ledger.captureId) as { title: string }
      expect(text.title).toBe(TITLE)
      expect(getExhibit(ledger.captureId)?.name).toBe(TITLE)
    })

    it('is found by Case search through a word only its received text holds', () => {
      expect(searchCaptures('brackwater', CASE_ID).map((c) => c.id)).toEqual([ledger.captureId])
    })

    it('gets the extracted data of its page', () => {
      const values = (
        getDb()
          .prepare('SELECT value FROM extracted_data WHERE capture_id = ?')
          .all(ledger.captureId) as Array<{ value: string }>
      ).map(({ value }) => value)
      expect(values).toContain('analyst@ledger.example.org')
    })

    it("verifies against its author's chain", async () => {
      const result = await verifyCapture(ledger.captureId)
      expect(result.status).toBe('verified')
    })

    it('cannot be deleted by a member who is not its author', async () => {
      const bobs = lifecycle()
      const batch = await bobs.deleteMany(CASE_ID, [ledger.captureId])
      expect(batch.outcomes).toEqual([
        { captureId: ledger.captureId, status: 'rejected', reason: 'not_author' }
      ])
      expect(await bobs.delete(ledger.captureId)).toBe(false)
      expect(parsedChain(ownChainText(CASE_ID)).filter((e) => e.type === 'deletion')).toEqual([])
      expect(getCapture(ledger.captureId)).toBeDefined()
      expect(existsSync(artifact(ledger.captureId, 'mhtml').abs)).toBe(true)
    })

    it("is removed on its author's deletion, which the receiver does not sign itself", async () => {
      await activate(A)
      expect(await lifecycle().delete(ledger.captureId)).toBe(true)
      const source = recordSource(CASE_ID, A)

      await activate(B)
      const result = await pull(CASE_ID, source)
      expect(result.errors).toEqual([])
      expect(result.removed).toBe(1)
      expect(listCaptures(CASE_ID).map((c) => c.id)).toEqual([other.captureId])
      for (const type of ['mhtml', 'png', 'txt'] as const) {
        expect(existsSync(artifact(ledger.captureId, type).abs)).toBe(false)
      }
      const authorDeletions = parsedChain(memberChainText(CASE_ID, A)).filter(
        (e) => e.type === 'deletion'
      )
      expect(authorDeletions.map((e) => e.type === 'deletion' && e.captureId)).toEqual([
        ledger.captureId
      ])
      expect(parsedChain(ownChainText(CASE_ID)).filter((e) => e.type === 'deletion')).toEqual([])

      // The walk wants every member's chain, so Carol's arrives too before it runs.
      await activate(C)
      addDocument(CASE_ID, C, 1)
      const fromCarol = recordSource(CASE_ID, C)
      await activate(B)
      expect((await pull(CASE_ID, fromCarol)).errors).toEqual([])
      const caseDir = caseDirOf(CASE_ID)
      const { verification } = readSharedCaseSnapshot(caseDir, readManifestSnapshot(caseDir))
      expect(verification?.findings).toEqual([])
      expect(verification?.valid).toBe(true)
      expect(verification?.outcome).toBe('pass')
    })
  })

  it('writes no row while a file is missing or fails its hash, and writes it once it arrives', async () => {
    await activate(A)
    const capture = await addCapture(CASE_ID, A, 1)
    const source = recordSource(CASE_ID, A)
    const mhtml = artifact(capture.captureId, 'mhtml')
    const png = artifact(capture.captureId, 'png')
    const genuineMhtml = source.files.get(mhtml.rel)!
    const genuinePng = source.files.get(png.rel)!

    await activate(B)
    const bobsPng = artifact(capture.captureId, 'png').abs
    source.files.delete(mhtml.rel)
    source.files.delete(png.rel)
    const missing = await pull(CASE_ID, source)
    expect(missing.errors).toEqual([])
    expect(listCaptures(CASE_ID)).toEqual([])

    // A tampered file is refused on arrival and so never reaches the apply step.
    source.files.set(mhtml.rel, genuineMhtml)
    source.files.set(png.rel, Buffer.from('tampered screenshot'))
    const tampered = await pull(CASE_ID, source)
    expect(tampered.errors).toEqual([
      expect.objectContaining({ kind: 'hash-mismatch', detail: expect.stringContaining(png.rel) })
    ])
    expect(existsSync(bobsPng)).toBe(false)
    expect(listCaptures(CASE_ID)).toEqual([])

    // A file already at the path is never fetched again; the apply step hashes it itself.
    writeFileSync(bobsPng, 'written here, not by the author')
    const local = await pull(CASE_ID, source)
    expect(local.errors).toEqual([
      expect.objectContaining({
        kind: 'hash-mismatch',
        installationId: A.installationId,
        detail: expect.stringContaining(`${png.rel}: expected ${capture.screenshotHash}`)
      })
    ])
    expect(listCaptures(CASE_ID)).toEqual([])

    rmSync(bobsPng)
    source.files.set(png.rel, genuinePng)
    const landed = await pull(CASE_ID, source)
    expect(landed.errors).toEqual([])
    expect(landed.capturesApplied).toBe(1)
    expect(listCaptures(CASE_ID).map((c) => c.id)).toEqual([capture.captureId])
  })

  it('refuses entries naming a held id or a taken number, and deletions of the receiver own', async () => {
    await activate(B)
    const bobs = await addCapture(CASE_ID, B, 1)
    const target = await addCapture(CASE_ID, B, 2)

    await activate(A)
    const first = await addCapture(CASE_ID, A, 1)
    const caseDir = caseDirOf(CASE_ID)
    const captureBody = (captureId: string, contentHash: string, exhibitNumber: number) => ({
      type: 'capture' as const,
      captureId,
      caseId: CASE_ID,
      url: `https://example.com/${captureId}`,
      timestamp: TIME,
      contentHash,
      sizeBytes: 1,
      exhibitNumber,
      ...by(A)
    })
    // An entry whose id is Bob's own Capture: Bob's file is already at its path.
    const stolen = appendManifestEntry(caseDir, captureBody(bobs.captureId, bobs.contentHash, 7))
    // A second Capture reusing the number Alice's first one holds.
    const reuseBytes = Buffer.from('<html>reused number</html>')
    writeFileSync(artifact('alice-reuse', 'mhtml').abs, reuseBytes)
    const reuse = appendManifestEntry(caseDir, captureBody('alice-reuse', sha(reuseBytes), 1))
    // A deletion naming another of Bob's own Captures.
    appendManifestEntry(caseDir, {
      type: 'deletion',
      captureId: target.captureId,
      caseId: CASE_ID,
      timestamp: TIME,
      contentHash: target.contentHash,
      ...by(A)
    })
    const source = recordSource(CASE_ID, A)

    await activate(B)
    const result = await pull(CASE_ID, source)
    expect(result.errors).toEqual(
      expect.arrayContaining([
        {
          kind: 'rejected-entry',
          installationId: A.installationId,
          index: stolen.index,
          detail: `capture ${bobs.captureId}: id ${bobs.captureId} is already held by another row`
        },
        {
          kind: 'rejected-entry',
          installationId: A.installationId,
          index: reuse.index,
          detail: `capture alice-reuse: Exhibit Number 1 is already held by ${first.captureId}`
        }
      ])
    )
    expect(result.errors).toHaveLength(2)
    expect(result.removed).toBe(0)
    expect(
      listCaptures(CASE_ID)
        .map((c) => c.id)
        .sort()
    ).toEqual([bobs.captureId, target.captureId, first.captureId].sort())
    expect(getExhibit(bobs.captureId)?.authorInstallationId).toBeNull()
    expect(existsSync(artifact(bobs.captureId, 'mhtml').abs)).toBe(true)
    expect(existsSync(artifact(target.captureId, 'mhtml').abs)).toBe(true)
    expect(await lifecycle().removeReceived(target.captureId)).toBe(false)
    expect(getCapture(target.captureId)).toBeDefined()
  })

  describe('Trusted Time', () => {
    const stamper = () =>
      createTimestampWorker({
        requestToken: async (contentHash) =>
          buildSyntheticToken({ contentHash, genTime: new Date(TIME) })
      })

    it("reads stamped when the author's chain holds the stamp", async () => {
      await activate(A)
      const capture = await addCapture(CASE_ID, A, 1)
      expect(await stamper().stampCapture(capture.captureId)).toBe(true)
      const source = recordSource(CASE_ID, A)

      await activate(B)
      expect((await pull(CASE_ID, source)).errors).toEqual([])
      expect(getCapture(capture.captureId)?.trustedTimeStatus).toBe('rfc3161')
    })

    it('reads stamped once a stamp arriving in a later session lands', async () => {
      await activate(A)
      const capture = await addCapture(CASE_ID, A, 1)
      const before = recordSource(CASE_ID, A)
      await activate(B)
      await pull(CASE_ID, before)
      expect(getCapture(capture.captureId)?.trustedTimeStatus).toBe('none')

      await activate(A)
      expect(await stamper().stampCapture(capture.captureId)).toBe(true)
      const after = recordSource(CASE_ID, A)
      await activate(B)
      expect((await pull(CASE_ID, after)).errors).toEqual([])
      expect(getCapture(capture.captureId)?.trustedTimeStatus).toBe('rfc3161')
    })
  })

  it("keeps the receiver's stamping and backfill off received content, then and after a restart", async () => {
    await activate(A)
    const doc = addDocument(CASE_ID, A, 1)
    const capture = await addCapture(CASE_ID, A, 2)
    const source = recordSource(CASE_ID, A)

    await activate(B)
    const own = await addCapture(CASE_ID, B, 1, { screenshot: await realPng(200) })
    expect((await pull(CASE_ID, source)).errors).toEqual([])
    expect(getExhibit(doc.exhibitId)?.authorInstallationId).toBe(A.installationId)

    const requested: string[] = []
    const worker = createTimestampWorker({
      requestToken: async (contentHash) => {
        requested.push(contentHash)
        return buildSyntheticToken({ contentHash, genTime: new Date(TIME) })
      }
    })
    const received = [
      doc.exhibitId,
      doc.contentHash,
      capture.captureId,
      capture.contentHash,
      capture.screenshotHash,
      capture.textHash
    ]

    setCaptureTrustedTime(own.captureId, 'pending')
    setCaptureTrustedTime(capture.captureId, 'pending')
    await worker.processPending()
    expect(await worker.stampExhibit(doc.exhibitId)).toBe(false)
    expect(await worker.stampCapture(capture.captureId)).toBe(false)
    expect(requested).toEqual([own.contentHash])
    expect(ownEntriesNaming(received)).toEqual([])

    closeDatabase()
    await activate(B)
    await runExhibitBackfill({ toolVersion: '0.0.0' })
    worker.start()
    await worker.processPending()
    worker.stop()
    expect(requested).toEqual([own.contentHash])
    expect(ownEntriesNaming(received)).toEqual([])
    // The positive control: Bob's own Capture did get its thumbnail derivation.
    expect(ownEntriesNaming([own.captureId]).map((e) => e.type)).toContain('derivation')
  })

  it("signs no derivation for a received Capture whose index matches the receiver's own", async () => {
    const screenshot = await realPng(90)
    await activate(A)
    const alice = await addCapture(CASE_ID, A, 1, { screenshot })
    const source = recordSource(CASE_ID, A)
    const aliceIndex = getExhibit(alice.captureId)!.manifestSeq!

    await activate(B)
    for (let n = 1; n <= aliceIndex; n++) addDocument(CASE_ID, B, n)
    const bob = await addCapture(CASE_ID, B, aliceIndex + 1, { screenshot })
    expect(getExhibit(bob.captureId)?.manifestSeq).toBe(aliceIndex)
    expect((await pull(CASE_ID, source)).errors).toEqual([])
    expect(getExhibit(alice.captureId)?.manifestSeq).toBe(aliceIndex)

    await backfillCase(CASE_ID, { toolVersion: '0.0.0' })
    const derivations = parsedChain(ownChainText(CASE_ID)).filter((e) => e.type === 'derivation')
    expect(derivations.map((e) => e.type === 'derivation' && e.parentExhibitId)).toEqual([
      bob.captureId
    ])
  })

  describe('thumbnail', () => {
    it("is rendered in memory and recorded nowhere when the author's chain anchors none", async () => {
      await activate(A)
      const capture = await addCapture(CASE_ID, A, 1, { screenshot: await realPng(60) })
      const source = recordSource(CASE_ID, A)

      await activate(B)
      expect((await pull(CASE_ID, source)).errors).toEqual([])
      const thumb = await getThumbnail(CASE_ID, capture.captureId, defaultCaptureStore, {
        persist: false
      })
      expect(thumb).not.toBeNull()
      const thumbPath = defaultCaptureStore.thumbnailPaths(CASE_ID, capture.captureId)
      expect(existsSync(thumbPath.abs)).toBe(false)
      expect(listDerivedFilesForExhibit(capture.captureId)).toEqual([])
      expect(parsedChain(ownChainText(CASE_ID)).filter((e) => e.type === 'derivation')).toEqual([])
    })

    it("arrives anchored once the author's chain holds its derivation", async () => {
      await activate(A)
      const capture = await addCapture(CASE_ID, A, 1, { screenshot: await realPng(120) })
      await backfillCase(CASE_ID, { toolVersion: '0.0.0' })
      const derivation = parsedChain(ownChainText(CASE_ID)).find((e) => e.type === 'derivation')
      expect(derivation?.type === 'derivation' && derivation.parentExhibitId).toBe(
        capture.captureId
      )
      const source = recordSource(CASE_ID, A)

      await activate(B)
      expect((await pull(CASE_ID, source)).errors).toEqual([])
      const thumbPath = defaultCaptureStore.thumbnailPaths(CASE_ID, capture.captureId)
      expect(derivation?.type === 'derivation' && sha(readFileSync(thumbPath.abs))).toBe(
        derivation?.type === 'derivation' && derivation.outputHash
      )
      const [row] = listDerivedFilesForExhibit(capture.captureId)
      expect(row.manifestSeq).toBe(derivation!.index)
      expect(row.path).toBe(thumbPath.rel.replace(/\\/g, '/'))
      const verified = await verifyCaseDerivedFiles(CASE_ID)
      expect(verified.get(capture.captureId)?.map((r) => r.status)).toEqual(['verified'])
    })
  })
})
