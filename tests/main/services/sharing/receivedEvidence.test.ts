import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createHash, randomUUID } from 'crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { Readable } from 'stream'
import sharp from 'sharp'
import { closeDatabase, getDb } from '@main/services/db/core'
import * as captureRepo from '@main/services/db/captureRepo'
import {
  getCapture,
  insertCapture,
  listCaptures,
  searchCaptures,
  setCaptureTrustedTime
} from '@main/services/db/captureRepo'
import { createNote } from '@main/services/db/noteRepo'
import { getAnnotations, saveAnnotations } from '@main/services/annotations'
import { createCase } from '@main/services/db/caseRepo'
import { exhibitCitationResolver } from '@main/services/db/caseMemberRepo'
import { getExhibit } from '@main/services/db/exhibitRepo'
import { listDerivedFilesForExhibit } from '@main/services/db/derivedFileRepo'
import { resetInstallationId } from '@main/services/installationId'
import { resetSigningKey } from '@main/services/signingKey'
import {
  appendManifestEntry,
  appendMemberChainLines,
  readManifestSnapshot,
  readSharedCaseSnapshot
} from '@main/services/manifest'
import { defaultCaptureStore } from '@main/services/captureStore'
import {
  createCaptureLifecycle,
  ingestMhtmlCapture,
  verifyCapture
} from '@main/services/captureLifecycle'
import { createSelectorLifecycle } from '@main/services/selectorLifecycle'
import { createTimestampWorker } from '@main/services/timestampWorker'
import { backfillCase, runExhibitBackfill } from '@main/services/exhibitBackfill'
import { verifyCaseDerivedFiles } from '@main/services/exhibits'
import { getThumbnail } from '@main/services/thumbnails'
import { resetSyncStateMemory } from '@main/services/sharing/syncState'
import { getStorageRoot } from '@main/services/storage'
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
  type Peer,
  type RecordedSource
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

  // ADR-0040: a teammate's viewer shows "From a link in" from the received row.
  it("carries a link Capture's source, its Content Hash and the link address", async () => {
    await activate(A)
    const source = await addCapture(CASE_ID, A, 1)
    const linkProvenance = {
      linkedFromCaptureId: source.captureId,
      linkedFromContentHash: source.contentHash,
      linkHref: 'http://example.com/alice/linked'
    }
    const { capture } = await ingestMhtmlCapture(
      {
        caseId: CASE_ID,
        url: 'https://example.com/alice/linked',
        title: 'Linked',
        timestamp: TIME,
        stream: Readable.from([
          Buffer.from('<html><body>Linked page</body></html>')
        ]) as unknown as ReadableStream<Uint8Array>,
        textContent: '',
        headers: {},
        browserVersion: '',
        userAgent: '',
        httpStatus: 200,
        method: 'background',
        linkSource: { signed: linkProvenance, rowId: source.captureId },
        ...by(A)
      },
      async () => null
    )
    const recorded = recordSource(CASE_ID, A)

    await activate(B)
    const result = await pull(CASE_ID, recorded)
    expect(result.errors).toEqual([])
    expect(result.capturesApplied).toBe(2)
    expect(getCapture(capture.id)).toMatchObject(linkProvenance)
    expect(getExhibit(capture.id)?.authorInstallationId).toBe(A.installationId)
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
    const reuseId = randomUUID()
    const reuseBytes = Buffer.from('<html>reused number</html>')
    writeFileSync(artifact(reuseId, 'mhtml').abs, reuseBytes)
    const reuse = appendManifestEntry(caseDir, captureBody(reuseId, sha(reuseBytes), 1))
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
          detail: `capture ${reuseId}: Exhibit Number 1 is already held by ${first.captureId}`
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

  // Review finding 1 on this PR: the file and apply steps build a Capture's paths from the id
  // its author's entry states, and ids were compared only as strings, so an id that climbed out
  // of its segment, or an upper-case copy of one, named the receiver's own files, and the
  // author's later deletion of it removed them.
  describe('an entry whose id is not one this app writes', () => {
    const notAnId = (author: Peer, index: number, type: string, id: string) => ({
      kind: 'rejected-entry',
      detail: `entry ${index} of ${author.installationId} names ${type} id ${JSON.stringify(id)}, which is not an id this app writes`,
      installationId: author.installationId,
      index
    })
    const filesOf = (caseId: string, id: string): Record<string, string> =>
      Object.fromEntries(
        (['mhtml', 'png', 'txt'] as const).map((type) => [
          type,
          sha(readFileSync(defaultCaptureStore.artifactPaths(caseId, id, type).abs))
        ])
      )
    const aliasEntry = (alias: string, target: IngestedCapture, caseId: string) => ({
      type: 'capture' as const,
      captureId: alias,
      caseId,
      url: 'https://example.com/alias',
      timestamp: TIME,
      contentHash: target.contentHash,
      screenshotHash: target.screenshotHash,
      textHash: target.textHash,
      sizeBytes: 1,
      exhibitNumber: 9,
      ...by(A)
    })

    const aliases: Array<[string, (id: string, otherCase: string) => string, boolean]> = [
      ['climbs back into its own segment', (id) => `x/../${id}`, false],
      ['is an upper-case copy', (id) => id.toUpperCase(), false],
      ['climbs into another Case', (id, otherCase) => `../${otherCase}/${id}`, true]
    ]
    for (const [shape, alias, inOtherCase] of aliases) {
      it(`refuses a capture id that ${shape} of the receiver's own, and its deletion touches nothing`, async () => {
        await activate(B)
        const targetCase = inOtherCase ? createCase({ name: 'Bob private' }).id : CASE_ID
        const bobs = await addCapture(targetCase, B, 1)
        const before = filesOf(targetCase, bobs.captureId)

        await activate(A)
        const forged = alias(bobs.captureId, targetCase)
        const capture = appendManifestEntry(caseDirOf(CASE_ID), aliasEntry(forged, bobs, CASE_ID))
        const first = recordSource(CASE_ID, A)
        appendManifestEntry(caseDirOf(CASE_ID), {
          type: 'deletion',
          captureId: forged,
          caseId: CASE_ID,
          timestamp: TIME,
          contentHash: bobs.contentHash,
          ...by(A)
        })
        const second = recordSource(CASE_ID, A)

        await activate(B)
        for (const source of [first, second]) {
          const result = await pull(CASE_ID, source)
          expect(result.errors).toEqual([notAnId(A, capture.index, 'capture', forged)])
          expect(result.capturesApplied).toBe(0)
          expect(result.removed).toBe(0)
          expect(memberChainText(CASE_ID, A)).toBe('')
          expect(getCapture(forged)).toBeUndefined()
        }
        expect(getExhibit(bobs.captureId)?.authorInstallationId).toBeNull()
        expect(filesOf(targetCase, bobs.captureId)).toEqual(before)
        expect((await verifyCapture(bobs.captureId)).status).toBe('verified')
      })
    }

    it('writes no file at a path such an id names, and no row', async () => {
      await activate(A)
      const fresh = randomUUID()
      const bytes = Buffer.from('<html>planted under another id</html>')
      const forged = `x/../${fresh}`
      const capture = appendManifestEntry(caseDirOf(CASE_ID), {
        type: 'capture',
        captureId: forged,
        caseId: CASE_ID,
        url: 'https://example.com/planted',
        timestamp: TIME,
        contentHash: sha(bytes),
        sizeBytes: bytes.length,
        exhibitNumber: 1,
        ...by(A)
      })
      const source = recordSource(CASE_ID, A)
      const planted = artifact(fresh, 'mhtml')
      source.files.set(planted.rel.replace(/\\/g, '/'), bytes)

      await activate(B)
      const result = await pull(CASE_ID, source)
      expect(result.errors).toEqual([notAnId(A, capture.index, 'capture', forged)])
      expect(result.blobsReceived).toBe(0)
      expect(existsSync(artifact(fresh, 'mhtml').abs)).toBe(false)
      expect(listCaptures(CASE_ID)).toEqual([])
    })

    it('refuses an exhibit entry whose id is not one this app writes', async () => {
      await activate(A)
      const doc = addDocument(CASE_ID, A, 1)
      const forged = `x/../${doc.exhibitId}`
      const exhibit = appendManifestEntry(caseDirOf(CASE_ID), {
        type: 'exhibit',
        exhibitId: forged,
        caseId: CASE_ID,
        kind: 'document',
        origin: 'manual-upload',
        name: 'forged.pdf',
        exhibitNumber: 2,
        path: doc.path,
        contentHash: doc.contentHash,
        sizeBytes: 1,
        timestamp: TIME,
        ...by(A)
      })
      const source = recordSource(CASE_ID, A)

      await activate(B)
      const result = await pull(CASE_ID, source)
      expect(result.errors).toEqual([notAnId(A, exhibit.index, 'exhibit', forged)])
      expect(result.exhibitsApplied).toBe(0)
      expect(getExhibit(forged)).toBeUndefined()
      expect(getExhibit(doc.exhibitId)).toBeUndefined()
    })

    it('removes such an entry an older build stored, before the file and apply steps read it', async () => {
      await activate(B)
      const bobs = await addCapture(CASE_ID, B, 1)
      const before = filesOf(CASE_ID, bobs.captureId)

      await activate(A)
      const forged = `x/../${bobs.captureId}`
      const capture = appendManifestEntry(caseDirOf(CASE_ID), aliasEntry(forged, bobs, CASE_ID))
      const aliceLines = recordSource(CASE_ID, A).chains.get(A.installationId)!
      await activate(C)
      addDocument(CASE_ID, C, 1)
      const fromCarol = recordSource(CASE_ID, C)
      expect(fromCarol.chains.has(A.installationId)).toBe(false)

      await activate(B)
      appendMemberChainLines(caseDirOf(CASE_ID), A.installationId, aliceLines)
      const result = await pull(CASE_ID, fromCarol)
      expect(result.errors).toEqual([notAnId(A, capture.index, 'capture', forged)])
      expect(result.capturesApplied).toBe(0)
      expect(result.exhibitsApplied).toBe(1)
      expect(memberChainText(CASE_ID, A)).toBe('')
      expect(getCapture(forged)).toBeUndefined()
      expect(filesOf(CASE_ID, bobs.captureId)).toEqual(before)
    })

    it('removes nothing on a deletion naming a row whose id is not one, whatever wrote the row', async () => {
      await activate(B)
      const bobs = await addCapture(CASE_ID, B, 1)
      const before = filesOf(CASE_ID, bobs.captureId)
      // A row an imported archive can leave: its ids are the archive's own.
      const forged = `x/../${bobs.captureId}`
      insertCapture({
        id: forged,
        caseId: CASE_ID,
        url: 'https://example.com/imported',
        title: 'Imported',
        hash: bobs.contentHash,
        timestamp: TIME,
        format: 'mhtml',
        exhibitNumber: 9,
        author: { installationId: A.installationId, memberCode: 'AL' }
      })

      await activate(A)
      appendManifestEntry(caseDirOf(CASE_ID), {
        type: 'deletion',
        captureId: forged,
        caseId: CASE_ID,
        timestamp: TIME,
        contentHash: bobs.contentHash,
        ...by(A)
      })
      const source = recordSource(CASE_ID, A)

      await activate(B)
      const result = await pull(CASE_ID, source)
      expect(result.errors).toEqual([])
      expect(result.removed).toBe(0)
      expect(getCapture(forged)).toBeDefined()
      expect(filesOf(CASE_ID, bobs.captureId)).toEqual(before)
    })
  })

  // Review finding 2 on this PR: the Shared Case walk reports an `exhibit` entry claiming a code
  // other than its writer's as a citation-collision, so the receiver writes it no row.
  it("refuses an exhibit entry claiming another member's code, and keeps one stating its own", async () => {
    await activate(B)
    const bobs = await addCapture(CASE_ID, B, 1)
    expect(getCapture(bobs.captureId)?.exhibitCitation).toBe('BO-1')

    await activate(A)
    const exhibitBody = (exhibitId: string, memberCode: string, exhibitNumber: number) => {
      const path = `${CASE_ID}/documents/${exhibitId}.pdf`
      const bytes = Buffer.from(`%PDF statement ${exhibitId}`)
      writeFileSync(join(getStorageRoot(), path), bytes)
      return {
        type: 'exhibit',
        exhibitId,
        caseId: CASE_ID,
        kind: 'document',
        origin: 'manual-upload',
        name: `${exhibitId}.pdf`,
        exhibitNumber,
        memberCode,
        path,
        contentHash: sha(bytes),
        sizeBytes: bytes.length,
        timestamp: TIME,
        ...by(A),
        schemaVersion: 4
      }
    }
    mkdirSync(join(caseDirOf(CASE_ID), 'documents'), { recursive: true })
    const spoofedId = randomUUID()
    const ownId = randomUUID()
    const spoofed = appendOwnChainLine(CASE_ID, exhibitBody(spoofedId, 'BO', 1))
    appendOwnChainLine(CASE_ID, exhibitBody(ownId, 'AL', 2))
    const source = recordSource(CASE_ID, A)

    await activate(B)
    const result = await pull(CASE_ID, source)
    expect(result.errors).toEqual([
      {
        kind: 'rejected-entry',
        installationId: A.installationId,
        index: spoofed.index,
        detail: `exhibit ${spoofedId}: claims Member Code BO, its author's is AL`
      }
    ])
    expect(result.exhibitsApplied).toBe(1)
    expect(getExhibit(spoofedId)).toBeUndefined()
    expect(getExhibit(ownId)).toMatchObject({ memberCode: 'AL', exhibitNumber: 2 })
    const cite = exhibitCitationResolver(CASE_ID, 'app')
    expect(cite(getExhibit(ownId)!)).toBe('AL-2')
    expect(getCapture(bobs.captureId)?.exhibitCitation).toBe('BO-1')
  })

  // Review finding 5 on this PR: the refusals of non-Capture entries, Exhibit Numbers from a
  // `renumber` assignment, and the apply step throwing part way, had no test.
  describe('the apply step', () => {
    const refusal = (index: number, detail: string) => ({
      kind: 'rejected-entry',
      installationId: A.installationId,
      index,
      detail
    })

    it("numbers a Capture from its author's renumber entry, and refuses one with no number", async () => {
      await activate(A)
      const caseDir = caseDirOf(CASE_ID)
      const unnumbered = (captureId: string, bytes: Buffer) => {
        writeFileSync(artifact(captureId, 'mhtml').abs, bytes)
        return appendManifestEntry(caseDir, {
          type: 'capture',
          captureId,
          caseId: CASE_ID,
          url: `https://example.com/${captureId}`,
          timestamp: TIME,
          contentHash: sha(bytes),
          sizeBytes: bytes.length,
          ...by(A)
        })
      }
      const renumberedId = randomUUID()
      const looseId = randomUUID()
      const renumbered = unnumbered(renumberedId, Buffer.from('<html>numbered later</html>'))
      const loose = unnumbered(looseId, Buffer.from('<html>never numbered</html>'))
      appendManifestEntry(caseDir, {
        type: 'renumber',
        caseId: CASE_ID,
        assignments: [
          { exhibitId: renumberedId, exhibitNumber: 4, manifestIndex: renumbered.index }
        ],
        timestamp: TIME,
        ...by(A)
      })
      const source = recordSource(CASE_ID, A)

      await activate(B)
      const result = await pull(CASE_ID, source)
      expect(result.errors).toEqual([refusal(loose.index, `capture ${looseId}: no Exhibit Number`)])
      expect(result.capturesApplied).toBe(1)
      expect(getCapture(renumberedId)?.exhibitCitation).toBe('AL-4')
      expect(getCapture(looseId)).toBeUndefined()
    })

    it("refuses exhibit entries naming a held id, a taken number or the replica's own file, and such a derivation", async () => {
      await activate(B)
      const bobs = await addCapture(CASE_ID, B, 1)

      await activate(A)
      const doc = addDocument(CASE_ID, A, 1)
      const capture = await addCapture(CASE_ID, A, 2)
      const caseDir = caseDirOf(CASE_ID)
      const exhibit = (exhibitId: string, exhibitNumber: number, path: string) => ({
        type: 'exhibit' as const,
        exhibitId,
        caseId: CASE_ID,
        kind: 'document',
        origin: 'manual-upload',
        name: `${exhibitId}.pdf`,
        exhibitNumber,
        path,
        contentHash: doc.contentHash,
        sizeBytes: 1,
        timestamp: TIME,
        ...by(A)
      })
      const takenId = randomUUID()
      const outsideId = randomUUID()
      const reserved = `${CASE_ID}/manifest.jsonl`
      const held = appendManifestEntry(caseDir, exhibit(bobs.captureId, 3, doc.path))
      const taken = appendManifestEntry(caseDir, exhibit(takenId, 1, doc.path))
      const outside = appendManifestEntry(caseDir, exhibit(outsideId, 4, reserved))
      const derivation = appendManifestEntry(caseDir, {
        type: 'derivation',
        caseId: CASE_ID,
        parentExhibitId: capture.captureId,
        parentContentHash: capture.contentHash,
        derivation: 'thumbnail',
        derivationToolVersion: '0.0.0',
        outputHash: 'd'.repeat(64),
        outputPath: reserved,
        timestamp: TIME,
        ...by(A)
      })
      const source = recordSource(CASE_ID, A)

      await activate(B)
      const result = await pull(CASE_ID, source)
      expect(result.errors).toEqual([
        refusal(
          held.index,
          `exhibit ${bobs.captureId}: id ${bobs.captureId} is already held by another row`
        ),
        refusal(
          taken.index,
          `exhibit ${takenId}: Exhibit Number 1 is already held by ${doc.exhibitId}`
        ),
        refusal(outside.index, `${reserved}: not a path inside this Case`),
        refusal(derivation.index, `${reserved}: not a path inside this Case`)
      ])
      expect(result.exhibitsApplied).toBe(1)
      expect(result.capturesApplied).toBe(1)
      expect(getExhibit(bobs.captureId)?.authorInstallationId).toBeNull()
      expect(getExhibit(takenId)).toBeUndefined()
      expect(getExhibit(outsideId)).toBeUndefined()
      expect(listDerivedFilesForExhibit(capture.captureId)).toEqual([])
    })

    it('lands nothing when its transaction throws part way, and all of it in the next session', async () => {
      await activate(A)
      const first = await addCapture(CASE_ID, A, 1)
      const second = await addCapture(CASE_ID, A, 2)
      saveAnnotations({ captureId: first.captureId, shapes: [], imageWidth: 1, imageHeight: 1 })
      createNote({ caseId: CASE_ID, title: 'Alice note', body: '' })
      const source = recordSource(CASE_ID, A)

      await activate(B)
      const insert = captureRepo.insertCapture
      let inserts = 0
      const failing = vi.spyOn(captureRepo, 'insertCapture').mockImplementation((params) => {
        inserts += 1
        if (inserts === 2) throw new Error('disk I/O error')
        return insert(params)
      })
      const failed = await pull(CASE_ID, source)
      failing.mockRestore()
      expect(inserts).toBe(2)
      expect(failed.errors).toEqual([
        { kind: 'local', detail: 'received evidence could not be applied: disk I/O error' },
        {
          kind: 'peer',
          detail: expect.stringContaining(
            'rows received this session could not be applied: FOREIGN KEY'
          )
        }
      ])
      expect(failed.capturesApplied).toBe(0)
      expect(failed.rowsApplied).toBe(0)
      const count = (table: string): number =>
        (getDb().prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n
      for (const table of ['captures', 'capture_texts', 'exhibits', 'notes', 'annotations']) {
        expect(count(table)).toBe(0)
      }
      // The files arrived in the file step and stay for the next session to write rows for.
      for (const { captureId } of [first, second]) {
        for (const type of ['mhtml', 'png', 'txt'] as const) {
          expect(existsSync(artifact(captureId, type).abs)).toBe(true)
        }
      }

      const landed = await pull(CASE_ID, source)
      expect(landed.errors).toEqual([])
      expect(landed.blobsReceived).toBe(0)
      expect(landed.capturesApplied).toBe(2)
      expect(landed.rowsApplied).toBe(2)
      expect(getAnnotations(first.captureId).annotations).not.toBeNull()
    })
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
    // The `merge` the pull wrote is Bob's own entry: the worker stamps it with a
    // receipt (#1515), the one request beside Bob's own Capture.
    const mergeHash = parsedChain(ownChainText(CASE_ID)).find((e) => e.type === 'merge')?.entryHash

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
    expect(requested).toEqual([own.contentHash, mergeHash])
    expect(ownEntriesNaming(received)).toEqual([])

    closeDatabase()
    await activate(B)
    await runExhibitBackfill({ toolVersion: '0.0.0' })
    worker.start()
    await worker.processPending()
    worker.stop()
    expect(requested).toEqual([own.contentHash, mergeHash])
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

  // A deleted Capture's id stays dead (#1877): the rows other members keep on it
  // name it, so no capture entry may attach them to another page.
  it('refuses a capture entry whose id names a deleted Capture', async () => {
    await activate(A)
    const capture = await addCapture(CASE_ID, A, 1)
    const source = recordSource(CASE_ID, A)
    await activate(B)
    getDb()
      .prepare('INSERT INTO deleted_captures (id, case_id) VALUES (?, ?)')
      .run(capture.captureId, CASE_ID)

    const result = await pull(CASE_ID, source)
    expect(result.capturesApplied).toBe(0)
    expect(result.errors).toEqual([
      expect.objectContaining({
        kind: 'rejected-entry',
        installationId: A.installationId,
        detail: `capture ${capture.captureId}: id ${capture.captureId} names a deleted Capture`
      })
    ])
    expect(getCapture(capture.captureId)).toBeUndefined()
    expect(getExhibit(capture.captureId)).toBeUndefined()
  })

  // Review findings on #1877: entry acceptance has no rule across chains, so this copy cannot
  // tell an author's entries from a member's copy of the author's id. A record of a deleted
  // Capture is therefore never undone by another chain's claim: the rows other members keep on
  // it would otherwise show on the claimant's page.
  const records = () => getDb().prepare('SELECT * FROM deleted_captures').all()
  const refusedAsDeleted = (peer: Peer, id: string) =>
    expect.objectContaining({
      kind: 'rejected-entry',
      installationId: peer.installationId,
      detail: `capture ${id}: id ${id} names a deleted Capture`
    })

  describe("another member's capture entry for the id of a Capture its author deleted", () => {
    let deleted: IngestedCapture
    let fromB: RecordedSource
    let fromC: RecordedSource

    beforeEach(async () => {
      await activate(B)
      deleted = await addCapture(CASE_ID, B, 1)
      expect(await lifecycle().delete(deleted.captureId)).toBe(true)
      fromB = recordSource(CASE_ID, B)
      await activate(C)
      expect((await pull(CASE_ID, fromB)).errors).toEqual([])
      // Carol's own page under Bob's deleted id, with the bytes her entry anchors.
      const page = mhtmlOf('Another page', '<p>Not the deleted Capture</p>')
      appendManifestEntry(caseDirOf(CASE_ID), {
        type: 'capture',
        captureId: deleted.captureId,
        caseId: CASE_ID,
        url: 'https://example.com/claimed',
        timestamp: TIME,
        contentHash: sha(page),
        sizeBytes: page.length,
        exhibitNumber: 1,
        ...by(C)
      })
      fromC = recordSource(CASE_ID, C)
      fromC.files.set(artifact(deleted.captureId, 'mhtml').rel, page)
    })

    it('records the deletion and refuses the claim when both arrive in one session', async () => {
      await activate(A)
      const result = await pull(CASE_ID, fromC)
      expect(result.errors).toEqual([refusedAsDeleted(C, deleted.captureId)])
      expect(records()).toEqual([
        { id: deleted.captureId, case_id: CASE_ID, chain_author: B.installationId }
      ])
      expect(getCapture(deleted.captureId)).toBeUndefined()
      expect(getExhibit(deleted.captureId)).toBeUndefined()
    })

    it('keeps the record an earlier session made when the claim arrives later', async () => {
      await activate(A)
      expect((await pull(CASE_ID, fromB)).errors).toEqual([])
      expect(records()).toEqual([
        { id: deleted.captureId, case_id: CASE_ID, chain_author: B.installationId }
      ])

      const result = await pull(CASE_ID, fromC)
      expect(result.errors).toEqual([refusedAsDeleted(C, deleted.captureId)])
      expect(records()).toEqual([
        { id: deleted.captureId, case_id: CASE_ID, chain_author: B.installationId }
      ])
      expect(getCapture(deleted.captureId)).toBeUndefined()
      expect(getExhibit(deleted.captureId)).toBeUndefined()
    })
  })

  // The cost of that rule: a member's `capture` and `deletion` of another author's live id read
  // as the author's own deletion, so the Capture stays off a copy that has not landed it.
  describe("a member's chain that creates and deletes another author's live Capture id", () => {
    let real: IngestedCapture
    let fromB: RecordedSource
    let fromC: RecordedSource

    beforeEach(async () => {
      await activate(B)
      real = await addCapture(CASE_ID, B, 1)
      fromB = recordSource(CASE_ID, B)
      await activate(C)
      expect((await pull(CASE_ID, fromB)).errors).toEqual([])
      const copied = {
        captureId: real.captureId,
        caseId: CASE_ID,
        timestamp: TIME,
        contentHash: real.contentHash,
        ...by(C)
      }
      appendManifestEntry(caseDirOf(CASE_ID), {
        type: 'capture',
        ...copied,
        url: 'https://example.com/copied',
        sizeBytes: 1,
        exhibitNumber: 1
      })
      appendManifestEntry(caseDirOf(CASE_ID), { type: 'deletion', ...copied })
      fromC = recordSource(CASE_ID, C)
    })

    it("records the deletion and refuses the author's Capture in one session", async () => {
      await activate(A)
      expect((await pull(CASE_ID, fromC)).errors).toEqual([refusedAsDeleted(B, real.captureId)])
      expect(records()).toEqual([
        { id: real.captureId, case_id: CASE_ID, chain_author: C.installationId }
      ])
      expect(getExhibit(real.captureId)).toBeUndefined()
    })

    it("keeps the record when the author's chain arrives in a later session", async () => {
      const withheld = recordSource(CASE_ID, C)
      withheld.chains.delete(B.installationId)
      await activate(A)
      expect((await pull(CASE_ID, withheld)).errors).toEqual([])

      expect((await pull(CASE_ID, fromC)).errors).toEqual([refusedAsDeleted(B, real.captureId)])
      expect(records()).toEqual([
        { id: real.captureId, case_id: CASE_ID, chain_author: C.installationId }
      ])
      expect(getExhibit(real.captureId)).toBeUndefined()
    })

    it('leaves the Capture on a copy that landed it before the pair arrived', async () => {
      await activate(A)
      expect((await pull(CASE_ID, fromB)).errors).toEqual([])
      expect((await pull(CASE_ID, fromC)).errors).toEqual([])
      expect(getExhibit(real.captureId)?.authorInstallationId).toBe(B.installationId)
      expect(records()).toEqual([])
    })
  })
})
