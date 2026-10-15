import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHash, createSign } from 'crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs'
import { basename, join } from 'path'
import { tmpdir } from 'os'
import { closeDatabase, getDb } from '@main/services/db/core'
import { listCaseMembers } from '@main/services/db/caseMemberRepo'
import { insertCapture } from '@main/services/db/captureRepo'
import { createNote, deleteNote, getNote, listNotes, updateNote } from '@main/services/db/noteRepo'
import {
  addTagToCapture,
  addTagToNote,
  createTag,
  getTagsForCapture,
  getTagsForNote,
  listTags
} from '@main/services/db/tagRepo'
import { getAnnotations, saveAnnotations, upsertPin } from '@main/services/annotations'
import { readRow } from '@main/services/db/workingRowRepo'
import { toWireRows, verifyWireRow } from '@main/services/sharing/workingRows'
import { resetInstallationId } from '@main/services/installationId'
import { resetSigningKey } from '@main/services/signingKey'
import { readManifestSnapshot, readSharedCaseSnapshot } from '@main/services/manifest'
import { getStorageRoot } from '@main/services/storage'
import { defaultCaptureStore } from '@main/services/captureStore'
import { canonicalStringify } from '@shared/verify'
import { BYE_REASONS, liveSyncSource } from '@main/services/sharing/session'
import {
  MEMBERS_FILENAME,
  getSyncState,
  readSyncStateFile,
  resetSyncStateMemory
} from '@main/services/sharing/syncState'
import { memberChainPath } from '../../../../src/packages/evidence-package-layout/index'
import {
  activate,
  addCapture,
  addDocument,
  appendOwnChainLine,
  caseDirOf,
  createPeer,
  memberAddBody,
  memberChainText,
  memberRevokeBody,
  mergeEntries,
  ownChainText,
  parsedChain,
  pull,
  recordSource,
  seedSharedCase,
  TIME,
  type IngestedCapture,
  type Peer
} from '../../../helpers/syncPeers'

// Sync between real replicas (#1512): three installations, each with its own
// database, storage root, installation id and signing key, exchanging chains
// over the in-process transport. Every assertion here is about what landed on
// the dialing peer's disk and in its database.

const CASE_ID = '0196f7a2-aaaa-bbbb-cccc-000000000010'
const sha = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex')
const onDisk = (path: string): Buffer => readFileSync(join(getStorageRoot(), path))
const onDiskOf = (peer: Peer, path: string): Buffer => readFileSync(join(peer.storageRoot, path))

describe('sync session between peers (#1512)', () => {
  let root: string
  let A: Peer
  let B: Peer
  let C: Peer

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'bb-sync-peers-'))
    A = await createPeer(root, 'alice', 'Alice Owner', 'AL')
    B = await createPeer(root, 'bob', 'Bob Member', 'BO')
    C = await createPeer(root, 'carol', 'Carol Member', 'CA')
    // Each peer holds the Case and the full roster, as the join flow leaves
    // them; the Owner's chain states the roster.
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

  it('first sync copies the Owner chain byte for byte and writes exactly one merge', async () => {
    await activate(A)
    const doc = addDocument(CASE_ID, A, 1)
    const ownerChain = ownChainText(CASE_ID)
    const source = recordSource(CASE_ID, A)

    await activate(B)
    const result = await pull(CASE_ID, source)
    expect(result.errors).toEqual([])
    expect(result.peerInstallationId).toBe(A.installationId)
    expect(result.entriesReceived).toBe(4)
    expect(memberChainText(CASE_ID, A)).toBe(ownerChain)

    const merges = mergeEntries(CASE_ID)
    expect(merges).toHaveLength(1)
    expect(result.mergeIndex).toBe(0)
    const ownerHead = parsedChain(ownerChain).at(-1)!
    expect(ownerHead.index).toBe(doc.index)
    expect(merges[0].heads).toEqual([
      {
        installationId: A.installationId,
        index: ownerHead.index,
        entryHash: ownerHead.entryHash,
        entriesReceived: 4
      }
    ])
    expect(merges[0].operatorId).toBe(B.installationId)
    expect(merges[0].operatorName).toBe('Bob Member')
    expect(merges[0].schemaVersion).toBe(4)

    // A session that brings nothing new writes no merge.
    const again = await pull(CASE_ID, source)
    expect(again.errors).toEqual([])
    expect(again.entriesReceived).toBe(0)
    expect(again.mergeIndex).toBeNull()
    expect(mergeEntries(CASE_ID)).toHaveLength(1)
  })

  it('incremental sync appends only the new entries and writes a second merge', async () => {
    await activate(A)
    addDocument(CASE_ID, A, 1)
    await activate(B)
    await pull(
      CASE_ID,
      await (async () => {
        await activate(A)
        const source = recordSource(CASE_ID, A)
        await activate(B)
        return source
      })()
    )
    const before = memberChainText(CASE_ID, A)

    await activate(A)
    const second = addDocument(CASE_ID, A, 2)
    const ownerChain = ownChainText(CASE_ID)
    const source = recordSource(CASE_ID, A)

    await activate(B)
    const result = await pull(CASE_ID, source)
    expect(result.errors).toEqual([])
    expect(result.entriesReceived).toBe(1)
    expect(memberChainText(CASE_ID, A)).toBe(ownerChain)
    expect(ownerChain.startsWith(before)).toBe(true)
    const merges = mergeEntries(CASE_ID)
    expect(merges).toHaveLength(2)
    expect(merges[1].heads).toEqual([
      {
        installationId: A.installationId,
        index: second.index,
        entryHash: parsedChain(ownerChain).at(-1)!.entryHash,
        entriesReceived: 1
      }
    ])
  })

  it('does not append a forged entry, sets rejected-entry, and writes no merge', async () => {
    await activate(A)
    addDocument(CASE_ID, A, 1)
    const source = recordSource(CASE_ID, A)
    // A line linked to the Owner's head but signed with Carol's key.
    const lines = source.chains.get(A.installationId)!
    const last = JSON.parse(lines.at(-1)!) as { index: number; entryHash: string }
    const body = {
      type: 'exhibit',
      exhibitId: 'planted',
      caseId: CASE_ID,
      kind: 'document',
      origin: 'manual-upload',
      name: 'planted.pdf',
      exhibitNumber: 2,
      path: `${CASE_ID}/documents/planted.pdf`,
      contentHash: 'b'.repeat(64),
      sizeBytes: 1,
      timestamp: '2026-10-02T10:00:00.000Z',
      operatorId: A.installationId,
      operatorName: 'Alice Owner',
      toolVersion: '0.0.0',
      schemaVersion: 3,
      index: last.index + 1,
      prevHash: last.entryHash
    }
    const entryHash = createHash('sha256').update(canonicalStringify(body)).digest('hex')
    const signature = createSign('sha256').update(entryHash).sign(C.privateKeyPem, 'base64')
    lines.push(JSON.stringify({ ...body, entryHash, signature }))

    await activate(B)
    const result = await pull(CASE_ID, source)
    expect(result.entriesReceived).toBe(0)
    expect(result.mergeIndex).toBeNull()
    expect(result.errors).toEqual([
      {
        kind: 'rejected-entry',
        detail: `entry ${last.index + 1} of ${A.installationId} refused: Invalid signature`,
        installationId: A.installationId,
        index: last.index + 1
      }
    ])
    expect(existsSync(join(caseDirOf(CASE_ID), memberChainPath(A.installationId)))).toBe(false)
    expect(mergeEntries(CASE_ID)).toHaveLength(0)
  })

  it('three peers: Carol receives Alice entries through Bob, and her replica verifies', async () => {
    await activate(A)
    const aliceDoc = addDocument(CASE_ID, A, 1)
    const ownerChain = ownChainText(CASE_ID)
    const fromAlice = recordSource(CASE_ID, A)

    await activate(B)
    await pull(CASE_ID, fromAlice)
    const bobDoc = addDocument(CASE_ID, B, 1)
    const bobChain = ownChainText(CASE_ID)
    const fromBob = recordSource(CASE_ID, B)

    await activate(C)
    const result = await pull(CASE_ID, fromBob)
    expect(result.errors).toEqual([])
    expect(result.peerInstallationId).toBe(B.installationId)
    expect(memberChainText(CASE_ID, A)).toBe(ownerChain)
    expect(memberChainText(CASE_ID, B)).toBe(bobChain)
    const [merge] = mergeEntries(CASE_ID)
    expect(merge.heads.map((h) => h.installationId).sort()).toEqual(
      [A.installationId, B.installationId].sort()
    )
    const caseDir = caseDirOf(CASE_ID)
    const { verification } = readSharedCaseSnapshot(caseDir, readManifestSnapshot(caseDir))
    expect(verification?.outcome).toBe('pass')
    expect(verification?.valid).toBe(true)
    expect([...verification!.entries.keys()].sort()).toEqual(
      [A.installationId, B.installationId, C.installationId].sort()
    )
    // Alice's bytes reached Carol through Bob's replica, hash-checked twice.
    expect(sha(onDisk(aliceDoc.path))).toBe(aliceDoc.contentHash)
    expect(sha(onDisk(bobDoc.path))).toBe(bobDoc.contentHash)
    expect(result.blobsReceived).toBe(2)
  })

  // Review finding 1 on this PR, the write side: a member-add whose id is
  // not one path segment would name a chain file outside the Case directory
  // on every replica, so the roster refresh refuses it.
  it('refuses a member-add whose installation id cannot name a chain file', async () => {
    await activate(A)
    const escape = `../../${CASE_ID}-escape`
    appendOwnChainLine(CASE_ID, {
      ...memberAddBody(CASE_ID, C, 'member', A),
      memberInstallationId: escape,
      memberCode: 'ES',
      nodeId: 'node-escape'
    })
    const source = recordSource(CASE_ID, A)
    await activate(B)
    const result = await pull(CASE_ID, source)
    expect(result.errors).toEqual([
      {
        kind: 'rejected-entry',
        detail: `member-add at index 3: installation id ${JSON.stringify(escape)} cannot name a chain file`,
        installationId: A.installationId
      }
    ])
    expect(result.entriesReceived).toBe(4)
    expect(listCaseMembers(CASE_ID).map((m) => m.installationId)).toEqual([
      A.installationId,
      B.installationId,
      C.installationId
    ])
    expect(existsSync(join(getStorageRoot(), `${CASE_ID}-escape`))).toBe(false)
  })

  it('learns who the Owner added or revoked from the Owner chain', async () => {
    await activate(B)
    getDb().prepare('DELETE FROM case_members WHERE installation_id = ?').run(C.installationId)
    await activate(A)
    const fromAlice = recordSource(CASE_ID, A)
    await activate(B)
    expect(listCaseMembers(CASE_ID).map((m) => m.installationId)).toEqual([
      A.installationId,
      B.installationId
    ])
    const result = await pull(CASE_ID, fromAlice)
    expect(result.errors).toEqual([])
    const carol = listCaseMembers(CASE_ID).find((m) => m.installationId === C.installationId)
    expect(carol).toMatchObject({
      publicKeyPem: C.publicKeyPem,
      memberCode: 'CA',
      operatorName: 'Carol Member',
      role: 'member',
      addedAtIndex: 2,
      revokedAtIndex: null
    })

    await activate(A)
    const revoke = appendOwnChainLine(CASE_ID, memberRevokeBody(CASE_ID, C, A))
    const revoked = recordSource(CASE_ID, A)
    await activate(B)
    await pull(CASE_ID, revoked)
    expect(
      listCaseMembers(CASE_ID).find((m) => m.installationId === C.installationId)?.revokedAtIndex
    ).toBe(revoke.index)
  })

  it('gives a member revoked mid-session bye before any entry reaches it', async () => {
    await activate(A)
    addDocument(CASE_ID, A, 1)
    const source = recordSource(CASE_ID, A)
    await activate(B)
    const result = await pull(CASE_ID, source, {
      onPhase: (phase) => {
        if (phase !== 'entries') return
        source.members = source.members.map((m) =>
          m.installationId === B.installationId ? { ...m, revokedAtIndex: 9 } : m
        )
      }
    })
    expect(result.peerInstallationId).toBe(A.installationId)
    expect(result.errors).toEqual([
      { kind: 'peer', detail: `peer ended the session: ${BYE_REASONS.revoked}` }
    ])
    expect(result.entriesReceived).toBe(0)
    expect(existsSync(join(caseDirOf(CASE_ID), memberChainPath(A.installationId)))).toBe(false)
    expect(mergeEntries(CASE_ID)).toHaveLength(0)
  })

  it('gives an installation outside the roster bye and no entries', async () => {
    await activate(A)
    addDocument(CASE_ID, A, 1)
    const source = recordSource(CASE_ID, A)
    const D = await createPeer(root, 'dave', 'Dave Outsider', 'DA')
    // Dave believes he is a member; Alice's roster says otherwise.
    seedSharedCase(CASE_ID, A, [D])
    const result = await pull(CASE_ID, source)
    expect(result.peerInstallationId).toBeNull()
    expect(result.errors).toEqual([
      { kind: 'peer', detail: `peer ended the session: ${BYE_REASONS.notMember}` }
    ])
    expect(existsSync(join(caseDirOf(CASE_ID), memberChainPath(A.installationId)))).toBe(false)
    expect(existsSync(join(caseDirOf(CASE_ID), 'manifest.jsonl'))).toBe(false)
  })

  it('fetches every file the received entries anchor, each visible only once its hash matches', async () => {
    await activate(A)
    const doc = addDocument(CASE_ID, A, 1)
    const tampered = addDocument(CASE_ID, A, 2)
    const capture = await addCapture(CASE_ID, A, 1)
    const source = recordSource(CASE_ID, A)
    const genuine = source.files.get(tampered.path)!
    source.files.set(tampered.path, Uint8Array.from(Buffer.from('tampered in transit')))

    await activate(B)
    const result = await pull(CASE_ID, source)
    const artifact = (type: 'mhtml' | 'png' | 'txt') =>
      defaultCaptureStore.artifactPaths(CASE_ID, capture.captureId, type)
    expect(sha(onDisk(doc.path))).toBe(doc.contentHash)
    expect(sha(readFileSync(artifact('mhtml').abs))).toBe(capture.contentHash)
    expect(sha(readFileSync(artifact('png').abs))).toBe(capture.screenshotHash)
    expect(sha(readFileSync(artifact('txt').abs))).toBe(capture.textHash)
    expect(existsSync(join(getStorageRoot(), tampered.path))).toBe(false)
    expect(readdirSync(join(caseDirOf(CASE_ID), 'documents'))).toEqual([basename(doc.path)])
    expect(result.blobsReceived).toBe(4)
    expect(result.bytesReceived).toBe(
      [doc.path, artifact('mhtml').rel, artifact('png').rel, artifact('txt').rel]
        .map((path) => onDisk(path).length)
        .reduce((a, b) => a + b, 0)
    )
    expect(result.errors).toEqual([
      {
        kind: 'hash-mismatch',
        detail: `${tampered.path}: expected ${tampered.contentHash}, received ${sha('tampered in transit')}`
      }
    ])

    // The next session asks for the file again and gets the genuine bytes.
    source.files.set(tampered.path, genuine)
    const again = await pull(CASE_ID, source)
    expect(again.errors).toEqual([])
    expect(again.blobsReceived).toBe(1)
    expect(sha(onDisk(tampered.path))).toBe(tampered.contentHash)
  })

  it('leaves a file the peer does not hold for a later session, without an error', async () => {
    await activate(A)
    const doc = addDocument(CASE_ID, A, 1)
    const source = recordSource(CASE_ID, A)
    const bytes = source.files.get(doc.path)!
    source.files.delete(doc.path)

    await activate(B)
    const result = await pull(CASE_ID, source)
    expect(result.errors).toEqual([])
    expect(result.blobsReceived).toBe(0)
    expect(existsSync(join(getStorageRoot(), doc.path))).toBe(false)

    source.files.set(doc.path, bytes)
    const again = await pull(CASE_ID, source)
    expect(again.blobsReceived).toBe(1)
    expect(sha(onDisk(doc.path))).toBe(doc.contentHash)
  })

  // Rows on a teammate's Capture reference its `captures` row, which #1811
  // writes; until then the test writes the row itself where a scenario needs it.
  function standInCaptureRow(capture: IngestedCapture, by: Peer): void {
    insertCapture({
      id: capture.captureId,
      caseId: CASE_ID,
      url: `https://example.com/${by.name}`,
      title: 'Stand-in',
      hash: capture.contentHash,
      timestamp: TIME
    })
  }

  it('brings every working-layer row across signed, and a tombstone removes it again', async () => {
    await activate(A)
    const capture = await addCapture(CASE_ID, A, 1)
    const note = createNote({ caseId: CASE_ID, title: 'Alice note', body: 'from alice' })
    const tag = createTag({ name: 'alice-tag', color: '#123456' })
    addTagToCapture({ captureId: capture.captureId, tagId: tag.id })
    addTagToNote({ noteId: note.id, tagId: tag.id })
    saveAnnotations({ captureId: capture.captureId, shapes: [], imageWidth: 3, imageHeight: 4 })
    const pin = upsertPin({ captureId: capture.captureId, body: 'alice pin' })
    const source = recordSource(CASE_ID, A)

    await activate(B)
    standInCaptureRow(capture, A)
    const result = await pull(CASE_ID, source)
    expect(result.errors).toEqual([])
    expect(result.rowsApplied).toBe(6)
    expect(listNotes(CASE_ID).map((n) => n.title)).toEqual(['Alice note'])
    expect(listTags()).toEqual([tag])
    expect(getTagsForCapture(capture.captureId)).toEqual([tag])
    expect(getTagsForNote(note.id)).toEqual([tag])
    expect(getAnnotations(capture.captureId).annotations?.imageHeight).toBe(4)
    expect(getAnnotations(capture.captureId).pins.map((p) => p.id)).toEqual([pin.id])
    const stored = readRow('notes', { id: note.id }, A.installationId)!
    expect(stored.author).toBe(A.installationId)
    expect(verifyWireRow(toWireRows([stored], B.installationId)[0], A.publicKeyPem)).toBe(true)
    // Bob cannot edit what Alice wrote.
    expect(updateNote({ id: note.id, title: 'Bob edit' })).toBeUndefined()
    expect(deleteNote(note.id)).toBe(false)

    // A session with nothing new applies nothing.
    const quiet = await pull(CASE_ID, source)
    expect(quiet.rowsApplied).toBe(0)

    await activate(A)
    expect(deleteNote(note.id)).toBe(true)
    const tombstoned = recordSource(CASE_ID, A)
    await activate(B)
    const removal = await pull(CASE_ID, tombstoned)
    expect(removal.errors).toEqual([])
    expect(removal.rowsApplied).toBe(1)
    expect(listNotes(CASE_ID)).toEqual([])
    expect(readRow('notes', { id: note.id }, A.installationId)?.deletedAt).not.toBeNull()
  })

  it('refuses a forged row without losing the genuine ones beside it', async () => {
    await activate(A)
    const tampered = createNote({ caseId: CASE_ID, title: 'Tampered in transit', body: '' })
    const genuine = createNote({ caseId: CASE_ID, title: 'Genuine', body: '' })
    // A tag syncs through the Case it is applied in (collectTagsForCase);
    // one applied nowhere stays with its author.
    const applied = createTag({ name: 'applied', color: '#010101' })
    addTagToNote({ noteId: genuine.id, tagId: applied.id })
    createTag({ name: 'unapplied' })
    const source = recordSource(CASE_ID, A)
    const rows = source.rows.get(A.installationId)!
    expect(rows.map((r) => r.table).sort()).toEqual(['note_tags', 'notes', 'notes', 'tags'])
    const forged = rows.find((r) => r.table === 'notes' && r.fields.id === tampered.id)!
    forged.fields = { ...forged.fields, title: 'Forged' }

    await activate(B)
    const result = await pull(CASE_ID, source)
    expect(result.errors).toEqual([
      {
        kind: 'rejected-entry',
        detail: `notes row of ${A.installationId} at version ${forged.version}: invalid signature`,
        installationId: A.installationId
      }
    ])
    expect(result.rowsApplied).toBe(3)
    expect(getNote(tampered.id)).toBeUndefined()
    expect(getNote(genuine.id)?.title).toBe('Genuine')
    expect(listTags()).toEqual([applied])
    expect(getTagsForNote(genuine.id)).toEqual([applied])
  })

  it('three peers: Carol receives Alice rows through Bob, still under Alice signature', async () => {
    await activate(A)
    const note = createNote({ caseId: CASE_ID, title: 'Via Bob', body: '' })
    const fromAlice = recordSource(CASE_ID, A)
    await activate(B)
    await pull(CASE_ID, fromAlice)
    createNote({ caseId: CASE_ID, title: 'Bob note', body: '' })
    const fromBob = recordSource(CASE_ID, B)

    await activate(C)
    const result = await pull(CASE_ID, fromBob)
    expect(result.errors).toEqual([])
    expect(result.rowsApplied).toBe(2)
    expect(
      listNotes(CASE_ID)
        .map((n) => n.title)
        .sort()
    ).toEqual(['Bob note', 'Via Bob'])
    const stored = readRow('notes', { id: note.id }, A.installationId)!
    expect(verifyWireRow(toWireRows([stored], C.installationId)[0], A.publicKeyPem)).toBe(true)
  })

  it('holds back an author batch whose Capture row is missing, and lands it once it exists', async () => {
    await activate(A)
    const capture = await addCapture(CASE_ID, A, 1)
    saveAnnotations({ captureId: capture.captureId, shapes: [], imageWidth: 1, imageHeight: 1 })
    createNote({ caseId: CASE_ID, title: 'Alice note', body: '' })
    const source = recordSource(CASE_ID, A)

    await activate(B)
    const held = await pull(CASE_ID, source)
    expect(held.rowsApplied).toBe(0)
    expect(held.errors).toHaveLength(1)
    expect(held.errors[0]).toMatchObject({ kind: 'peer', installationId: A.installationId })
    expect(held.errors[0].detail).toContain('could not be applied')
    expect(listNotes(CASE_ID)).toEqual([])

    standInCaptureRow(capture, A)
    const landed = await pull(CASE_ID, source)
    expect(landed.errors).toEqual([])
    expect(landed.rowsApplied).toBe(2)
    expect(listNotes(CASE_ID).map((n) => n.title)).toEqual(['Alice note'])
    expect(getAnnotations(capture.captureId).annotations).not.toBeNull()
  })

  it('leaves the session in sync-state.json and the roster in members.json', async () => {
    await activate(A)
    const doc = addDocument(CASE_ID, A, 1)
    const source = recordSource(CASE_ID, A)
    source.files.set(doc.path, Uint8Array.from(Buffer.from('tampered')))

    await activate(B)
    expect(getSyncState(CASE_ID)).toEqual({
      phase: 'idle',
      peersReachable: 0,
      peersTotal: 2,
      transfer: null,
      lastError: null
    })
    const result = await pull(CASE_ID, source, {
      onPhase: (phase) => {
        if (phase === 'entries') expect(getSyncState(CASE_ID).phase).toBe('syncing')
      }
    })
    expect(result.errors[0]?.kind).toBe('hash-mismatch')
    const failed = getSyncState(CASE_ID)
    expect(failed.phase).toBe('error')
    expect(failed.peersReachable).toBe(1)
    expect(failed.transfer).toEqual({ entries: 4, blobs: 0, bytes: 0 })
    expect(failed.lastError?.kind).toBe('hash-mismatch')
    const file = readSyncStateFile(caseDirOf(CASE_ID))
    expect(file.peers[A.installationId]).toMatchObject({
      ok: false,
      heads: {
        [A.installationId]: { index: doc.index },
        [B.installationId]: { index: 0 }
      }
    })
    expect(file.localVersionHighWater).toBe(0)
    const members = JSON.parse(
      readFileSync(join(caseDirOf(CASE_ID), MEMBERS_FILENAME), 'utf-8')
    ) as { members: Array<{ installationId: string }> }
    expect(members.members.map((m) => m.installationId)).toEqual([
      A.installationId,
      B.installationId,
      C.installationId
    ])

    source.files.set(doc.path, Uint8Array.from(onDiskOf(A, doc.path)))
    const ok = await pull(CASE_ID, source)
    expect(ok.errors).toEqual([])
    expect(getSyncState(CASE_ID)).toMatchObject({ phase: 'idle', peersReachable: 1 })
    expect(readSyncStateFile(caseDirOf(CASE_ID)).peers[A.installationId]?.ok).toBe(true)
  })

  // Review finding 2 on this PR: a tag keeps the version it took at creation
  // and enters the Case only when applied, so once a peer's cursor had
  // passed that version the tag was never offered again and every
  // application of it failed its foreign key on that peer for good.
  it('offers a tag created before the peer cursor once it is applied in the Case', async () => {
    await activate(A)
    const tag = createTag({ name: 'old-tag', color: '#0a0a0a' })
    const note = createNote({ caseId: CASE_ID, title: 'N', body: '' })
    const first = recordSource(CASE_ID, A)
    expect(first.rows.get(A.installationId)!.map((r) => r.table)).toEqual(['notes'])

    await activate(B)
    const r1 = await pull(CASE_ID, first)
    expect(r1.errors).toEqual([])
    expect(r1.rowsApplied).toBe(1)
    expect(listTags()).toEqual([])

    await activate(A)
    addTagToNote({ noteId: note.id, tagId: tag.id })
    // The live source offers the tag above any cursor, with the application.
    const offered = liveSyncSource(CASE_ID)!.rowsSince(A.installationId, 2)
    expect(offered.map((r) => [r.table, r.version])).toEqual([
      ['tags', 1],
      ['note_tags', 3]
    ])
    const second = recordSource(CASE_ID, A)

    await activate(B)
    const r2 = await pull(CASE_ID, second)
    expect(r2.errors).toEqual([])
    expect(r2.rowsApplied).toBe(2)
    expect(listTags()).toEqual([tag])
    expect(getTagsForNote(note.id)).toEqual([tag])
    // A later session offers the tag again and the receiver skips it.
    const r3 = await pull(CASE_ID, second)
    expect(r3.errors).toEqual([])
    expect(r3.rowsApplied).toBe(0)
  })
})
