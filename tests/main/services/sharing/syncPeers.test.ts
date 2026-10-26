import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createHash, createSign } from 'crypto'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { basename, join } from 'path'
import { tmpdir } from 'os'
import { closeDatabase, getDb } from '@main/services/db/core'
import { listCaseMembers, upsertCaseMember } from '@main/services/db/caseMemberRepo'
import { insertCapture, listCaptures } from '@main/services/db/captureRepo'
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
import { maxAuthorVersionInCase, readRow } from '@main/services/db/workingRowRepo'
import {
  rowDigest,
  toWireRows,
  verifyWireRow,
  type RowEnvelope
} from '@main/services/sharing/workingRows'
import { resetInstallationId } from '@main/services/installationId'
import { resetSigningKey } from '@main/services/signingKey'
import {
  appendManifestEntry,
  initManifest,
  readManifestSnapshot,
  readSharedCaseSnapshot
} from '@main/services/manifest'
import { getStorageRoot } from '@main/services/storage'
import { updateSettings } from '@main/services/settings'
import { defaultCaptureStore } from '@main/services/captureStore'
import { createTimestampWorker } from '@main/services/timestampWorker'
import { buildTrustedTimeIndex, resolveReceiptStamps } from '@main/services/trustedTime'
import { canonicalStringify } from '@shared/verify'
import {
  BYE_REASONS,
  MAX_ROW_PAGES,
  PAGE_BYTES,
  liveSyncSource,
  type SyncSource
} from '@main/services/sharing/session'
import type { WireRow } from '@main/services/sharing/messages'
import type { ManifestEntry } from '@shared/schemas'
import {
  MEMBERS_FILENAME,
  getSyncState,
  readSyncStateFile,
  resetSyncStateMemory
} from '@main/services/sharing/syncState'
import { memberChainPath } from '../../../../src/packages/evidence-package-layout/index'
import { buildSyntheticToken } from '../../../helpers/timestampFixtures'
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

  // Scheduled review finding 1: the roster was read from the peer's wire
  // lines by a count taken over chain lines, so a blank line in a relayed
  // Owner history threw after the lines were stored, and the revocation in
  // them never reached the roster, in that session or any later one.
  // Fourth pre-pass, finding 1: the roster was refreshed only from the lines
  // a session accepted, and a membership write that threw became an error
  // string, so a revocation stored on disk was never recorded. The roster is
  // rebuilt from the stored Owner chain every session; a failed write fails
  // the session, and the next one records the revocation from the file.
  it('records a revocation whose roster write failed once, in the next session', async () => {
    await activate(A)
    const revoke = appendOwnChainLine(CASE_ID, memberRevokeBody(CASE_ID, C, A))
    const ownerChain = ownChainText(CASE_ID)
    const source = recordSource(CASE_ID, A)

    await activate(B)
    getDb().exec(`CREATE TRIGGER roster_busy BEFORE UPDATE OF revoked_at_index ON case_members
      BEGIN SELECT RAISE(ABORT, 'database is busy'); END`)
    const failed = await pull(CASE_ID, source).catch((err: Error) => err.message)
    expect(failed).toBe('database is busy')
    expect(memberChainText(CASE_ID, A)).toBe(ownerChain)
    expect(readSyncStateFile(caseDirOf(CASE_ID)).lastError?.kind).toBe('local')
    getDb().exec('DROP TRIGGER roster_busy')

    const second = await pull(CASE_ID, source)
    expect(second.errors).toEqual([])
    expect(second.entriesReceived).toBe(0)
    expect(
      listCaseMembers(CASE_ID).find((m) => m.installationId === C.installationId)?.revokedAtIndex
    ).toBe(revoke.index)
  })

  it('records a stored revocation no session applied, in a session that receives nothing', async () => {
    await activate(A)
    const revoke = appendOwnChainLine(CASE_ID, memberRevokeBody(CASE_ID, C, A))
    const ownerChain = ownChainText(CASE_ID)
    const source = recordSource(CASE_ID, A)
    await activate(B)
    // The chain on disk as a build or a session that never refreshed the
    // roster left it.
    writeFileSync(join(caseDirOf(CASE_ID), memberChainPath(A.installationId)), ownerChain)
    const result = await pull(CASE_ID, source)
    expect(result.errors).toEqual([])
    expect(result.entriesReceived).toBe(0)
    expect(
      listCaseMembers(CASE_ID).find((m) => m.installationId === C.installationId)?.revokedAtIndex
    ).toBe(revoke.index)
  })

  it('records a revocation relayed with blank and joined lines in the Owner history', async () => {
    await activate(A)
    const revoke = appendOwnChainLine(CASE_ID, memberRevokeBody(CASE_ID, C, A))
    const ownerChain = ownChainText(CASE_ID)
    const fromAlice = recordSource(CASE_ID, A)
    await activate(C)
    expect((await pull(CASE_ID, fromAlice)).errors).toEqual([])
    const relayed = recordSource(CASE_ID, C)
    const [l0, l1, l2, l3] = relayed.chains.get(A.installationId)!
    relayed.chains.set(A.installationId, [' ', l0, '', `${l1}\n${l2}`, l3])

    await activate(B)
    const result = await pull(CASE_ID, relayed)
    expect(result.errors).toEqual([])
    expect(result.entriesReceived).toBe(4)
    expect(memberChainText(CASE_ID, A)).toBe(ownerChain)
    expect(
      listCaseMembers(CASE_ID).find((m) => m.installationId === C.installationId)?.revokedAtIndex
    ).toBe(revoke.index)
    expect(readSyncStateFile(caseDirOf(CASE_ID)).lastError).toBeNull()
  })

  // Review finding 3 on this PR: a revoked member's entries past the head
  // the Owner merged before the revocation arrived through a third peer,
  // with the files and rows behind them, and the Owner's own walk then
  // reported them.
  it('accepts a revoked member chain only to the head the Owner merged before revoking', async () => {
    await activate(C)
    addDocument(CASE_ID, C, 1)
    createNote({ caseId: CASE_ID, title: 'Carol note', body: '' })
    const fromCarolEarly = recordSource(CASE_ID, C)

    await activate(A)
    expect((await pull(CASE_ID, fromCarolEarly)).errors).toEqual([])
    expect(mergeEntries(CASE_ID)).toHaveLength(1)

    await activate(C)
    const later = addDocument(CASE_ID, C, 2)
    createNote({ caseId: CASE_ID, title: 'Carol later note', body: '' })
    const fromCarolLater = recordSource(CASE_ID, C)

    // Bob writes an entry of his own, then holds Carol's later entry before
    // anyone revoked her.
    await activate(B)
    addDocument(CASE_ID, B, 1)
    expect((await pull(CASE_ID, fromCarolLater)).errors).toEqual([])

    await activate(A)
    const revoke = appendOwnChainLine(CASE_ID, memberRevokeBody(CASE_ID, C, A))
    const carol = listCaseMembers(CASE_ID).find((m) => m.installationId === C.installationId)!
    upsertCaseMember({ ...carol, revokedAtIndex: revoke.index })

    await activate(B)
    const fromBob = recordSource(CASE_ID, B)
    // Bob as he stood before writing his merge for Carol's later entry: a
    // replica that holds the entry while nothing in its own chain names it.
    const bobChain = fromBob.chains.get(B.installationId)!
    fromBob.chains.set(
      B.installationId,
      bobChain.filter((line) => (JSON.parse(line) as { type: string }).type !== 'merge')
    )

    await activate(A)
    const held = memberChainText(CASE_ID, C)
    const result = await pull(CASE_ID, fromBob)
    expect(result.errors).toEqual([])
    expect(memberChainText(CASE_ID, C)).toBe(held)
    expect(parsedChain(held).map((e) => e.index)).toEqual([0])
    expect(
      mergeEntries(CASE_ID)
        .flatMap((m) => m.heads)
        .filter((h) => h.installationId === C.installationId)
    ).toHaveLength(1)
    expect(listNotes(CASE_ID).map((n) => n.title)).toEqual(['Carol note'])
    expect(existsSync(join(getStorageRoot(), later.path))).toBe(false)
    const caseDir = caseDirOf(CASE_ID)
    const walk = readSharedCaseSnapshot(caseDir, readManifestSnapshot(caseDir)).verification
    expect(walk?.findings).toEqual([])
    expect(walk?.outcome).toBe('pass')

    // Bob as he stands, with his merge naming Carol's later entry: Alice
    // still stores nothing of Carol past the bound; the walk then reports
    // Bob's merge as naming a head the Owner never accepted, which is the
    // walk's own rule (sharedCase.ts, merge heads), never entry-after-revocation.
    fromBob.chains.set(B.installationId, bobChain)
    const again = await pull(CASE_ID, fromBob)
    expect(again.errors).toEqual([])
    expect(memberChainText(CASE_ID, C)).toBe(held)
    expect(listNotes(CASE_ID).map((n) => n.title)).toEqual(['Carol note'])
    const walkAgain = readSharedCaseSnapshot(caseDir, readManifestSnapshot(caseDir)).verification
    expect(walkAgain?.findings.map((f) => [f.outcome, f.installationId])).toEqual([
      ['merge-head-mismatch', B.installationId]
    ])
  })

  it('accepts nothing of a revoked member the Owner never merged', async () => {
    await activate(C)
    addDocument(CASE_ID, C, 1)
    createNote({ caseId: CASE_ID, title: 'Carol note', body: '' })
    const fromCarol = recordSource(CASE_ID, C)
    await activate(B)
    expect((await pull(CASE_ID, fromCarol)).errors).toEqual([])
    const fromBob = recordSource(CASE_ID, B)

    await activate(A)
    const revoke = appendOwnChainLine(CASE_ID, memberRevokeBody(CASE_ID, C, A))
    const carol = listCaseMembers(CASE_ID).find((m) => m.installationId === C.installationId)!
    upsertCaseMember({ ...carol, revokedAtIndex: revoke.index })
    const result = await pull(CASE_ID, fromBob)
    expect(result.errors).toEqual([])
    expect(memberChainText(CASE_ID, C)).toBe('')
    expect(listNotes(CASE_ID)).toEqual([])
    expect(
      mergeEntries(CASE_ID)
        .flatMap((m) => m.heads)
        .map((h) => h.installationId)
    ).toEqual([B.installationId])
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

  // D14 of docs/plans/2026-10-10-capture-engine-first-slice.md: whichever of SC-2 and step 9
  // merged second adds this test, and step 9 writes the record.
  it('fetches a Transaction Record only when its bytes hash to the signed entry', async () => {
    await activate(A)
    const record = Buffer.from('invented warc.gz bytes of a background capture')
    const capture = await addCapture(CASE_ID, A, 1, { transactionRecord: record })
    const source = recordSource(CASE_ID, A)
    const path = defaultCaptureStore.artifactPaths(CASE_ID, capture.captureId, 'warc.gz').rel
    expect(source.files.has(path)).toBe(true)
    source.files.set(path, Uint8Array.from(Buffer.from('a record altered in transit')))

    await activate(B)
    const result = await pull(CASE_ID, source)
    expect(result.errors).toEqual([
      {
        kind: 'hash-mismatch',
        detail: `${path}: expected ${capture.transactionRecordHash}, received ${sha('a record altered in transit')}`
      }
    ])
    expect(existsSync(join(getStorageRoot(), path))).toBe(false)

    source.files.set(path, Uint8Array.from(record))
    const again = await pull(CASE_ID, source)
    expect(again.errors).toEqual([])
    expect(again.blobsReceived).toBe(1)
    expect(sha(onDisk(path))).toBe(capture.transactionRecordHash)
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
    const result = await pull(CASE_ID, source)
    expect(result.errors).toEqual([])
    // The apply step wrote Alice's Capture row before the rows step needed it.
    expect(result.capturesApplied).toBe(1)
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

  // Maintainer ruling of 2026-10-15: every row a session receives lands in
  // one transaction with foreign keys deferred, as the design's working-layer
  // rule states. One row referencing a Capture this replica lacks, here one
  // whose page archive has not arrived so the apply step wrote no row for it
  // (#1811), rolls back the whole session's rows, another member's included;
  // they land once the file arrives and the Capture row with it.
  it('rolls back every row of a session whose reference is missing, and lands them once it exists', async () => {
    await activate(C)
    createNote({ caseId: CASE_ID, title: 'Carol note', body: '' })
    const fromCarol = recordSource(CASE_ID, C)
    await activate(A)
    expect((await pull(CASE_ID, fromCarol)).rowsApplied).toBe(1)
    const capture = await addCapture(CASE_ID, A, 1)
    saveAnnotations({ captureId: capture.captureId, shapes: [], imageWidth: 1, imageHeight: 1 })
    createNote({ caseId: CASE_ID, title: 'Alice note', body: '' })
    const source = recordSource(CASE_ID, A)
    const mhtmlPath = defaultCaptureStore.artifactPaths(CASE_ID, capture.captureId, 'mhtml').rel
    const mhtml = source.files.get(mhtmlPath)!
    source.files.delete(mhtmlPath)

    await activate(B)
    const held = await pull(CASE_ID, source)
    expect(held.capturesApplied).toBe(0)
    expect(listCaptures(CASE_ID)).toEqual([])
    expect(held.rowsApplied).toBe(0)
    expect(held.errors).toEqual([
      {
        kind: 'peer',
        detail: expect.stringContaining(
          'rows received this session could not be applied: FOREIGN KEY'
        )
      }
    ])
    expect(listNotes(CASE_ID)).toEqual([])

    source.files.set(mhtmlPath, mhtml)
    const landed = await pull(CASE_ID, source)
    expect(landed.errors).toEqual([])
    expect(landed.capturesApplied).toBe(1)
    expect(landed.rowsApplied).toBe(3)
    expect(
      listNotes(CASE_ID)
        .map((n) => n.title)
        .sort()
    ).toEqual(['Alice note', 'Carol note'])
    expect(getAnnotations(capture.captureId).annotations).not.toBeNull()
  })

  // Review finding 3 on this PR, round two: a note edited after it was tagged
  // sits above its application, so the application reached an earlier page;
  // applied per page, that page failed its foreign key every session.
  it('applies a reference from a later page in the one transaction of the session', async () => {
    await activate(A)
    const note = createNote({ caseId: CASE_ID, title: 'N', body: 'x'.repeat(400) })
    const tag = createTag({ name: 't', color: '#0c0c0c' })
    addTagToNote({ noteId: note.id, tagId: tag.id })
    updateNote({ id: note.id, title: 'N edited' })
    const source = recordSource(CASE_ID, A)

    await activate(B)
    const result = await pull(CASE_ID, source, {}, { pageBytes: 300 })
    expect(result.errors).toEqual([])
    expect(result.rowsApplied).toBe(3)
    expect(getNote(note.id)?.title).toBe('N edited')
    expect(getTagsForNote(note.id)).toEqual([tag])
  })

  // Review finding 5 on this PR, round two: a listener answering `more` with
  // rows that do not verify held the dialer forever, and moved its cursor.
  it('stops asking a listener whose rows do not verify, and caps the pages of one that do', async () => {
    await activate(A)
    const genuine = createNote({ caseId: CASE_ID, title: 'Genuine', body: '' })
    const source = recordSource(CASE_ID, A)
    let calls = 0
    const forging: SyncSource = {
      ...source,
      rowsSince: (author, since) => {
        calls += 1
        const row: WireRow = {
          table: 'notes',
          author,
          version: since + 1,
          caseId: CASE_ID,
          deletedAt: null,
          fields: { id: `forged-${since}` },
          signature: 'forged'
        }
        return { rows: [row], more: true }
      }
    }
    await activate(B)
    const refused = await pull(CASE_ID, forging)
    expect(calls).toBe(2)
    expect(refused.rowsApplied).toBe(0)
    expect(refused.errors.map((e) => e.kind)).toEqual(['rejected-entry', 'rejected-entry'])
    expect(listNotes(CASE_ID)).toEqual([])
    expect(maxAuthorVersionInCase(CASE_ID, A.installationId)).toBe(0)

    // A listener that says `more` but sends nothing new moves no cursor, so
    // it is asked once more and then left; the other roster member costs the
    // one request every author gets.
    calls = 0
    const genuineRow = source.rows.get(A.installationId)!.find((r) => r.fields.id === genuine.id)!
    const stalled: SyncSource = {
      ...source,
      rowsSince: (author, since) => {
        calls += 1
        if (author !== A.installationId) return { rows: [], more: false }
        return { rows: since === 0 ? [genuineRow] : [], more: true }
      }
    }
    const stopped = await pull(CASE_ID, stalled)
    expect(calls).toBe(3)
    expect(stopped.rowsApplied).toBe(1)
    expect(stopped.errors).toEqual([])

    // A listener whose rows verify but never end is bounded by the page cap:
    // every page carries a fresh note signed with Alice's key.
    const sign = (hex: string): string =>
      createSign('sha256').update(hex).sign(A.privateKeyPem, 'base64')
    calls = 0
    const endless: SyncSource = {
      ...source,
      rowsSince: (author, since) => {
        calls += 1
        if (author !== A.installationId) return { rows: [], more: false }
        const envelope: RowEnvelope = {
          table: 'notes',
          author,
          version: since + 1,
          caseId: CASE_ID,
          deletedAt: null,
          fields: {
            id: `endless-${since + 1}`,
            case_id: CASE_ID,
            capture_id: null,
            title: `endless ${since + 1}`,
            body: '',
            body_doc: null,
            anchor_kind: null,
            anchor_json: null,
            source_url: null,
            screenshot_path: null,
            created_at: TIME,
            updated_at: TIME
          }
        }
        return { rows: [{ ...envelope, signature: sign(rowDigest(envelope)) }], more: true }
      }
    }
    await activate(C)
    const bounded = await pull(CASE_ID, endless)
    expect(calls).toBe(MAX_ROW_PAGES + 1)
    expect(bounded.errors).toEqual([])
    expect(bounded.rowsApplied).toBe(MAX_ROW_PAGES)
  })

  // Scheduled review finding 2: a member of one Shared Case could plant
  // notes, tag applications and annotations into any other Case the dialer
  // holds, because no received row was checked against the Case being
  // synced. The author signs the row's Case; a row of another Case, however
  // it is signed, is refused and nothing of it lands.
  it('refuses rows of a Case other than the one being synced', async () => {
    const PRIV = '0196f7a2-aaaa-bbbb-cccc-000000000777'
    const holdPrivateCase = (): void => {
      getDb()
        .prepare(
          `INSERT INTO cases (id, name, description, type, created_at, updated_at)
           VALUES (?, 'Private', NULL, 'custom', ?, ?)`
        )
        .run(PRIV, TIME, TIME)
    }
    await activate(B)
    holdPrivateCase()
    const bobsCapture = insertCapture({
      caseId: PRIV,
      url: 'https://example.com/private',
      title: 'Private',
      hash: 'p'.repeat(64),
      timestamp: TIME
    }).id

    await activate(C)
    holdPrivateCase()
    const planted = createNote({ caseId: PRIV, title: 'planted by Carol', body: '' })
    const [honestlySigned] = toWireRows(
      [readRow('notes', { id: planted.id }, null)!],
      C.installationId
    )
    expect(honestlySigned.caseId).toBe(PRIV)
    const sign = (hex: string): string =>
      createSign('sha256').update(hex).sign(C.privateKeyPem, 'base64')
    const forged = (envelope: RowEnvelope): WireRow => ({
      ...envelope,
      signature: sign(rowDigest(envelope))
    })
    const source = recordSource(CASE_ID, C)
    source.rows.set(C.installationId, [
      honestlySigned,
      forged({
        table: 'notes',
        author: C.installationId,
        version: 7,
        caseId: CASE_ID,
        deletedAt: null,
        fields: honestlySigned.fields
      }),
      forged({
        table: 'exhibit_tags',
        author: C.installationId,
        version: 8,
        caseId: CASE_ID,
        deletedAt: null,
        fields: { exhibit_id: bobsCapture, tag_id: 'planted-tag' }
      })
    ])

    await activate(B)
    const result = await pull(CASE_ID, source)
    expect(result.rowsApplied).toBe(0)
    expect(result.errors.map((e) => e.detail)).toEqual([
      `notes row of ${C.installationId} at version ${honestlySigned.version}: names Case ${PRIV}, this session syncs ${CASE_ID}`,
      `notes row of ${C.installationId} at version 7: references a row of Case ${PRIV}`,
      `exhibit_tags row of ${C.installationId} at version 8: references a row of Case ${PRIV}`
    ])
    expect(listNotes(PRIV)).toEqual([])
    expect(getTagsForCapture(bobsCapture)).toEqual([])
  })

  // Scheduled review finding 6: a session ending in a thrown error recorded
  // no error, so the state file took a fresh last-success time and the pill
  // read the crash as a success.
  it('records a session that threw as failed, under its own kind', async () => {
    await activate(A)
    addDocument(CASE_ID, A, 1)
    const source = recordSource(CASE_ID, A)
    await activate(B)
    const outcome = await pull(CASE_ID, source, {
      onPhase: (phase) => {
        if (phase === 'blobs') throw new Error('disk full')
      }
    }).catch((err: Error) => err.message)
    expect(outcome).toBe('disk full')
    const state = getSyncState(CASE_ID)
    expect(state.phase).toBe('error')
    expect(state.lastError?.kind).toBe('local')
    const file = readSyncStateFile(caseDirOf(CASE_ID))
    expect(file.lastSuccessAt).toBeNull()
    expect(file.lastError?.detail).toBe('session failed: disk full')
    expect(file.peers[A.installationId]?.ok).toBe(false)

    // Fourth pre-pass, finding 4: a throw after an earlier refusal in the
    // same session is still recorded as this replica's failure.
    await activate(A)
    const doc = addDocument(CASE_ID, A, 2)
    const tampered = recordSource(CASE_ID, A)
    tampered.files.set(doc.path, Uint8Array.from(Buffer.from('tampered')))
    await activate(B)
    const again = await pull(CASE_ID, tampered, {
      onPhase: (phase) => {
        if (phase === 'rows') throw new Error('disk full again')
      }
    }).catch((err: Error) => err.message)
    expect(again).toBe('disk full again')
    expect(getSyncState(CASE_ID).lastError?.kind).toBe('local')
    expect(readSyncStateFile(caseDirOf(CASE_ID)).lastError?.detail).toBe(
      'session failed: disk full again'
    )
  })

  it('leaves the session in sync-state.json and the roster in members.json', async () => {
    await activate(A)
    const doc = addDocument(CASE_ID, A, 1)
    const source = recordSource(CASE_ID, A)
    source.files.set(doc.path, Uint8Array.from(Buffer.from('tampered')))

    await activate(B)
    const unseen = { reachable: false, lastSessionAt: null, ok: null, heldHead: null }
    expect(getSyncState(CASE_ID)).toEqual({
      phase: 'idle',
      peersReachable: 0,
      peersTotal: 2,
      peers: [
        { installationId: A.installationId, ...unseen },
        { installationId: C.installationId, ...unseen }
      ],
      transfer: null,
      lastSuccessAt: null,
      lastError: null,
      egress: 'direct'
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
    const offered = liveSyncSource(CASE_ID)!.rowsSince(A.installationId, 2, PAGE_BYTES).rows
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

  // Review finding 5 on this PR: a chain segment and an author's rows each
  // travelled as one frame, built in full and refused past the frame cap,
  // after which that member could never sync. Both are now served in pages
  // under a budget, with the dialer asking again until nothing remains.
  it('serves entries and rows in pages under the frame budget and still lands all of them', async () => {
    await activate(A)
    const docs = Array.from({ length: 6 }, (_, n) => addDocument(CASE_ID, A, n + 1))
    const titles = Array.from(
      { length: 8 },
      (_, n) => createNote({ caseId: CASE_ID, title: `Note ${n}`, body: 'x'.repeat(120) }).title
    )
    const ownerChain = ownChainText(CASE_ID)
    const source = recordSource(CASE_ID, A)
    const calls = { chains: 0, rows: 0 }
    const counted: SyncSource = {
      ...source,
      chainLines: (id, from, max) => {
        calls.chains += 1
        return source.chainLines(id, from, max)
      },
      rowsSince: (author, since, max) => {
        calls.rows += 1
        return source.rowsSince(author, since, max)
      }
    }

    await activate(B)
    const result = await pull(CASE_ID, counted, {}, { pageBytes: 1500 })
    expect(result.errors).toEqual([])
    expect(memberChainText(CASE_ID, A)).toBe(ownerChain)
    const entries = parsedChain(ownerChain).length
    expect(entries).toBe(3 + docs.length)
    expect(result.entriesReceived).toBe(entries)
    expect(calls.chains).toBeGreaterThanOrEqual(entries)
    expect(mergeEntries(CASE_ID)).toHaveLength(1)
    expect(mergeEntries(CASE_ID)[0].heads).toEqual([
      {
        installationId: A.installationId,
        index: entries - 1,
        entryHash: parsedChain(ownerChain).at(-1)!.entryHash,
        entriesReceived: entries
      }
    ])
    for (const doc of docs) expect(sha(onDisk(doc.path))).toBe(doc.contentHash)
    expect(
      listNotes(CASE_ID)
        .map((n) => n.title)
        .sort()
    ).toEqual([...titles].sort())
    expect(result.rowsApplied).toBe(titles.length)
    expect(calls.rows).toBeGreaterThan(2)

    // A session with nothing new asks for no chain already at the peer's
    // head, and once per author for rows.
    const before = { ...calls }
    const quiet = await pull(CASE_ID, counted, {}, { pageBytes: 1500 })
    expect(quiet.errors).toEqual([])
    expect(quiet.entriesReceived).toBe(0)
    expect(quiet.rowsApplied).toBe(0)
    expect(calls.chains - before.chains).toBe(0)
    expect(calls.rows - before.rows).toBe(2)
  })

  // Review finding 4 on this PR, round two: which Case a chain names was
  // judged page by page, so a chain opening with history imported from
  // another Case was refused at its first line whenever that history did
  // not fit one page.
  it('accepts a chain whose imported history spans several pages, and refuses one naming another Case once whole', async () => {
    const OTHER = '0196f7a2-aaaa-bbbb-cccc-000000000555'
    await activate(C)
    const caseDir = caseDirOf(CASE_ID)
    initManifest(caseDir)
    const by = { operatorId: C.installationId, operatorName: C.operatorName, toolVersion: '0.0.0' }
    for (const n of [1, 2]) {
      appendManifestEntry(caseDir, {
        type: 'exhibit',
        exhibitId: `src-${n}`,
        caseId: OTHER,
        kind: 'document',
        origin: 'manual-upload',
        name: `src-${n}.pdf`,
        exhibitNumber: n,
        path: `${OTHER}/documents/src-${n}.pdf`,
        contentHash: 'c'.repeat(64),
        sizeBytes: 1,
        timestamp: TIME,
        ...by
      })
    }
    appendManifestEntry(caseDir, {
      type: 'import',
      caseId: CASE_ID,
      sourceCaseId: OTHER,
      sourceInstallationId: C.installationId,
      sourcePublicKeyPem: C.publicKeyPem,
      packageHash: 'd'.repeat(64),
      idMapSha256: 'e'.repeat(64),
      verificationResult: {
        overallValid: true,
        chainValid: true,
        artifactCount: 0,
        artifactFailureCount: 0,
        captureCount: 0,
        captureHashFailureCount: 0
      },
      timestamp: TIME,
      ...by
    })
    addDocument(CASE_ID, C, 1)
    const carolChain = ownChainText(CASE_ID)
    const fromCarol = recordSource(CASE_ID, C)

    await activate(B)
    const paged = await pull(CASE_ID, fromCarol, {}, { pageBytes: 1 })
    expect(paged.errors).toEqual([])
    expect(paged.entriesReceived).toBe(4)
    expect(memberChainText(CASE_ID, C)).toBe(carolChain)
    expect(mergeEntries(CASE_ID)[0].heads.map((h) => h.installationId)).toEqual([C.installationId])

    // Alice's chain names another Case in its current segment, with no
    // import to make it history: refused once whole, and nothing of it stays.
    await activate(A)
    appendManifestEntry(caseDirOf(CASE_ID), {
      type: 'exhibit',
      exhibitId: 'elsewhere',
      caseId: OTHER,
      kind: 'document',
      origin: 'manual-upload',
      name: 'elsewhere.pdf',
      exhibitNumber: 1,
      path: `${OTHER}/documents/elsewhere.pdf`,
      contentHash: 'f'.repeat(64),
      sizeBytes: 1,
      timestamp: TIME,
      operatorId: A.installationId,
      operatorName: A.operatorName,
      toolVersion: '0.0.0'
    })
    const fromAlice = recordSource(CASE_ID, A)
    await activate(B)
    const refused = await pull(CASE_ID, fromAlice, {}, { pageBytes: 1 })
    expect(refused.errors).toEqual([
      {
        kind: 'rejected-entry',
        detail: `entry 3 of ${A.installationId} names Case ${OTHER}, this Case is ${CASE_ID}`,
        installationId: A.installationId,
        index: 3
      }
    ])
    expect(refused.entriesReceived).toBe(0)
    expect(memberChainText(CASE_ID, A)).toBe('')
    expect(mergeEntries(CASE_ID)).toHaveLength(1)
  })

  // Review finding 1 on this PR, round two: a tag travels on every page
  // whatever the cursor, and the cursor read its version, so a tag above a
  // page's ceiling moved the cursor past the rows between, which were then
  // never asked for.
  it('pages past a tag above the ceiling without skipping the rows between', async () => {
    await activate(A)
    const body = 'x'.repeat(400)
    const n1 = createNote({ caseId: CASE_ID, title: 'n1', body })
    createNote({ caseId: CASE_ID, title: 'n2', body })
    createNote({ caseId: CASE_ID, title: 'n3', body })
    const tag = createTag({ name: 'late-tag', color: '#0b0b0b' })
    addTagToNote({ noteId: n1.id, tagId: tag.id })
    const source = recordSource(CASE_ID, A)

    await activate(B)
    const first = await pull(CASE_ID, source, {}, { pageBytes: 600 })
    expect(first.errors).toEqual([])
    expect(
      listNotes(CASE_ID)
        .map((n) => n.title)
        .sort()
    ).toEqual(['n1', 'n2', 'n3'])
    expect(getTagsForNote(n1.id)).toEqual([tag])
    expect(maxAuthorVersionInCase(CASE_ID, A.installationId)).toBe(5)
    const second = await pull(CASE_ID, source, {}, { pageBytes: 600 })
    expect(second.errors).toEqual([])
    expect(second.rowsApplied).toBe(0)
  })

  // Review finding 1 on this PR, round three: which Case a chain names was
  // judged only once the peer's head was reached, so a chain naming another
  // Case whose tail never arrived kept its lines on disk, was named by a
  // merge, and was never cut back by a later session. It is judged on every
  // way out of the member's loop, the exceptional ones included.
  describe('a chain naming another Case whose head is never reached', () => {
    const OTHER = '0196f7a2-aaaa-bbbb-cccc-000000000556'
    const foreignExhibit = (peer: Peer, n: number) => ({
      type: 'exhibit' as const,
      exhibitId: `elsewhere-${n}`,
      caseId: OTHER,
      kind: 'document' as const,
      origin: 'manual-upload' as const,
      name: `elsewhere-${n}.pdf`,
      exhibitNumber: n,
      path: `${OTHER}/documents/elsewhere-${n}.pdf`,
      contentHash: 'f'.repeat(64),
      sizeBytes: 1,
      timestamp: TIME,
      operatorId: peer.installationId,
      operatorName: peer.operatorName,
      toolVersion: '0.0.0'
    })
    const foreignError = (peer: Peer, index: number) => ({
      kind: 'rejected-entry',
      detail: `entry ${index} of ${peer.installationId} names Case ${OTHER}, this Case is ${CASE_ID}`,
      installationId: peer.installationId,
      index
    })
    const nothingOfCarolStored = (): void => {
      expect(memberChainText(CASE_ID, C)).toBe('')
      expect(mergeEntries(CASE_ID)).toEqual([])
    }

    it('is cut back when a later page is refused', async () => {
      await activate(C)
      initManifest(caseDirOf(CASE_ID))
      appendManifestEntry(caseDirOf(CASE_ID), foreignExhibit(C, 1))
      const source = recordSource(CASE_ID, C)
      // The peer's head is one line past what verifies under Carol's key.
      const lines = source.chains.get(C.installationId)!
      const last = JSON.parse(lines.at(-1)!) as { index: number; entryHash: string }
      const body = {
        ...foreignExhibit(C, 2),
        schemaVersion: 3,
        index: last.index + 1,
        prevHash: last.entryHash
      }
      const entryHash = createHash('sha256').update(canonicalStringify(body)).digest('hex')
      const signature = createSign('sha256').update(entryHash).sign(A.privateKeyPem, 'base64')
      lines.push(JSON.stringify({ ...body, entryHash, signature }))

      await activate(B)
      const result = await pull(CASE_ID, source, {}, { pageBytes: 1 })
      expect(result.errors).toEqual([
        {
          kind: 'rejected-entry',
          detail: `entry 1 of ${C.installationId} refused: Invalid signature`,
          installationId: C.installationId,
          index: 1
        },
        foreignError(C, 0)
      ])
      expect(result.entriesReceived).toBe(0)
      nothingOfCarolStored()
    })

    it('is cut back when the peer sends an empty page before its head', async () => {
      await activate(C)
      initManifest(caseDirOf(CASE_ID))
      appendManifestEntry(caseDirOf(CASE_ID), foreignExhibit(C, 1))
      const source = recordSource(CASE_ID, C)
      const short: SyncSource = {
        ...source,
        heads: () =>
          source
            .heads()
            .map((h) => (h.installationId === C.installationId ? { ...h, index: h.index + 1 } : h))
      }
      await activate(B)
      const result = await pull(CASE_ID, short, {}, { pageBytes: 1 })
      expect(result.errors).toEqual([foreignError(C, 0)])
      expect(result.entriesReceived).toBe(0)
      nothingOfCarolStored()
    })

    it('is cut back when the session fails mid-chain', async () => {
      await activate(C)
      initManifest(caseDirOf(CASE_ID))
      appendManifestEntry(caseDirOf(CASE_ID), foreignExhibit(C, 1))
      appendManifestEntry(caseDirOf(CASE_ID), foreignExhibit(C, 2))
      const source = recordSource(CASE_ID, C)
      let pages = 0
      const dying: SyncSource = {
        ...source,
        chainLines: (id, from, max) => {
          pages += 1
          if (pages > 1) throw new Error('listener died')
          return source.chainLines(id, from, max)
        }
      }
      await activate(B)
      const outcome = await pull(CASE_ID, dying, {}, { pageBytes: 1 }).catch(
        (err: Error) => err.message
      )
      expect(outcome).toBe('listener died')
      expect(getSyncState(CASE_ID).lastError?.kind).toBe('rejected-entry')
      nothingOfCarolStored()
    })

    it('is cut back to what the session found, leaving no partial file', async () => {
      await activate(C)
      initManifest(caseDirOf(CASE_ID))
      addDocument(CASE_ID, C, 1)
      const early = recordSource(CASE_ID, C)
      await activate(B)
      expect((await pull(CASE_ID, early)).errors).toEqual([])
      const kept = memberChainText(CASE_ID, C)
      await activate(C)
      appendManifestEntry(caseDirOf(CASE_ID), foreignExhibit(C, 2))
      const later = recordSource(CASE_ID, C)
      await activate(B)
      const result = await pull(CASE_ID, later, {}, { pageBytes: 1 })
      expect(result.errors).toEqual([foreignError(C, 1)])
      expect(result.entriesReceived).toBe(0)
      expect(memberChainText(CASE_ID, C)).toBe(kept)
      expect(readdirSync(caseDirOf(CASE_ID)).filter((f) => f.endsWith('.partial'))).toEqual([])
      expect(mergeEntries(CASE_ID)).toHaveLength(1)
    })

    // The roster is read from the Owner's lines only once the chain is
    // judged: a member-revoke on a chain that is cut back changes nothing.
    it('changes no membership from an Owner chain that is cut back', async () => {
      await activate(A)
      appendManifestEntry(caseDirOf(CASE_ID), foreignExhibit(A, 1))
      appendOwnChainLine(CASE_ID, memberRevokeBody(CASE_ID, C, A))
      const source = recordSource(CASE_ID, A)
      await activate(B)
      const result = await pull(CASE_ID, source, {}, { pageBytes: 1 })
      expect(result.errors).toEqual([foreignError(A, 3)])
      expect(memberChainText(CASE_ID, A)).toBe('')
      expect(mergeEntries(CASE_ID)).toEqual([])
      expect(
        listCaseMembers(CASE_ID).find((m) => m.installationId === C.installationId)?.revokedAtIndex
      ).toBeNull()
    })

    // Fourth pre-pass, finding 5: the judgement ran only in a session that
    // appended to the chain, so stored foreign lines the peer had nothing
    // new for stayed. Every stored chain is judged at the start of a session.
    it('removes a stored foreign chain in a session that receives none of it', async () => {
      await activate(C)
      initManifest(caseDirOf(CASE_ID))
      appendManifestEntry(caseDirOf(CASE_ID), foreignExhibit(C, 1))
      const carolChain = ownChainText(CASE_ID)
      await activate(A)
      const fromAlice = recordSource(CASE_ID, A)
      expect(fromAlice.chains.has(C.installationId)).toBe(false)
      await activate(B)
      writeFileSync(join(caseDirOf(CASE_ID), memberChainPath(C.installationId)), carolChain)
      const result = await pull(CASE_ID, fromAlice)
      expect(result.errors).toEqual([foreignError(C, 0)])
      expect(memberChainText(CASE_ID, C)).toBe('')
      expect(mergeEntries(CASE_ID).flatMap((m) => m.heads.map((h) => h.installationId))).toEqual([
        A.installationId
      ])
    })

    it('removes a chain whole when what an older build stored of it is already foreign', async () => {
      await activate(C)
      initManifest(caseDirOf(CASE_ID))
      appendManifestEntry(caseDirOf(CASE_ID), foreignExhibit(C, 1))
      const [first] = recordSource(CASE_ID, C).chains.get(C.installationId)!
      appendManifestEntry(caseDirOf(CASE_ID), foreignExhibit(C, 2))
      const source = recordSource(CASE_ID, C)
      await activate(B)
      writeFileSync(join(caseDirOf(CASE_ID), memberChainPath(C.installationId)), first + '\n')
      const result = await pull(CASE_ID, source, {}, { pageBytes: 1 })
      // Once when the session starts and judges what is stored, and once for
      // the same chain fetched again from its start and cut back.
      expect(result.errors).toEqual([foreignError(C, 0), foreignError(C, 0)])
      nothingOfCarolStored()
    })
  })

  // Receipt stamps (#1515, design decision 15): the session hands the `merge`
  // it writes to the timestamp worker, which stamps its Entry Hash. Bob's
  // worker fakes the TSA with a requester that records every hash it is
  // asked for and grants a synthetic token over it.
  describe('receipt stamps on the merge a session writes', () => {
    const flush = async (): Promise<void> => {
      await new Promise<void>((resolve) => setImmediate(resolve))
      await new Promise<void>((resolve) => setImmediate(resolve))
    }
    const recorder = () =>
      vi.fn(async (hash: string) =>
        buildSyntheticToken({ contentHash: hash, genTime: new Date(TIME), tsaDnsName: 'tsa.bob' })
      )
    const stamps = (): Array<Extract<ManifestEntry, { type: 'timestamp' }>> =>
      parsedChain(ownChainText(CASE_ID)).filter(
        (e): e is Extract<ManifestEntry, { type: 'timestamp' }> => e.type === 'timestamp'
      )
    const walkPasses = (): void => {
      const caseDir = caseDirOf(CASE_ID)
      const { verification } = readSharedCaseSnapshot(caseDir, readManifestSnapshot(caseDir))
      expect(verification?.outcome).toBe('pass')
      expect(verification?.valid).toBe(true)
    }
    // Alice's chain, carried to Bob through Carol so that Bob's replica holds
    // every roster member's chain and its walk can pass. Returns what Carol
    // serves after pulling Alice's `n` documents so far.
    const throughCarol = async (n: number): Promise<SyncSource> => {
      await activate(A)
      addDocument(CASE_ID, A, n)
      const fromAlice = recordSource(CASE_ID, A)
      await activate(C)
      await pull(CASE_ID, fromAlice)
      return recordSource(CASE_ID, C)
    }

    it('stamps exactly one receipt over the Entry Hash of the merge, and none without one', async () => {
      const source = await throughCarol(1)

      await activate(B)
      const requestToken = recorder()
      const worker = createTimestampWorker({ requestToken })
      const result = await pull(CASE_ID, source, {
        enqueueReceiptStamp: worker.enqueueReceiptStamp
      })
      await flush()

      const [merge] = mergeEntries(CASE_ID)
      expect(result.mergeIndex).toBe(merge.index)
      expect(requestToken.mock.calls.map(([hash]) => hash)).toEqual([merge.entryHash])
      const receipts = stamps()
      expect(receipts).toHaveLength(1)
      expect(receipts[0]).toMatchObject({
        type: 'timestamp',
        subject: 'entry',
        captureContentHash: merge.entryHash,
        schemaVersion: 4,
        operatorId: B.installationId
      })
      expect(receipts[0].index).toBeGreaterThan(merge.index)
      expect(resolveReceiptStamps(caseDirOf(CASE_ID)).merges[0].stamp?.tsaName).toBe('tsa.bob')
      walkPasses()

      // A session that brings nothing new writes no merge and asks for nothing.
      const before = ownChainText(CASE_ID)
      const again = await pull(CASE_ID, source, { enqueueReceiptStamp: worker.enqueueReceiptStamp })
      await flush()
      expect(again.mergeIndex).toBeNull()
      expect(requestToken).toHaveBeenCalledTimes(1)
      expect(ownChainText(CASE_ID)).toBe(before)
    })

    it('leaves content stamps and every Content Hash answer unchanged', async () => {
      const source = await throughCarol(1)

      await activate(B)
      const worker = createTimestampWorker({ requestToken: recorder() })
      const capture = await addCapture(CASE_ID, B, 1)
      expect(await worker.stampCapture(capture.captureId)).toBe(true)
      const caseDir = caseDirOf(CASE_ID)
      const before = buildTrustedTimeIndex(caseDir)
      expect(before.get(capture.contentHash)?.trustedTime).toBe('rfc3161')

      await pull(CASE_ID, source, { enqueueReceiptStamp: worker.enqueueReceiptStamp })
      await flush()

      const [content, receipt] = stamps()
      expect(content).toMatchObject({ captureContentHash: capture.contentHash, schemaVersion: 2 })
      expect('subject' in content).toBe(false)
      expect(receipt).toMatchObject({ subject: 'entry', schemaVersion: 4 })
      expect([...buildTrustedTimeIndex(caseDir)]).toEqual([...before])
      walkPasses()
    })

    it('asks nothing while timestamping is declined, and stamps the merge once it is on', async () => {
      await activate(A)
      addDocument(CASE_ID, A, 1)
      const source = recordSource(CASE_ID, A)

      await activate(B)
      updateSettings({ tsaEnabled: false })
      const requestToken = recorder()
      const worker = createTimestampWorker({ requestToken })
      const result = await pull(CASE_ID, source, {
        enqueueReceiptStamp: worker.enqueueReceiptStamp
      })
      await flush()
      expect(result.mergeIndex).toBe(0)
      expect(requestToken).not.toHaveBeenCalled()
      expect(stamps()).toHaveLength(0)

      updateSettings({ tsaEnabled: true })
      expect(await worker.processPending()).toEqual({ stamped: 1, failed: 0 })
      expect(requestToken).toHaveBeenCalledTimes(1)
      expect(stamps()).toHaveLength(1)
      expect(stamps()[0].captureContentHash).toBe(mergeEntries(CASE_ID)[0].entryHash)
    })

    it('stamps the next session’s merge after a failed request, and retries nothing older', async () => {
      const first = await throughCarol(1)
      const second = await throughCarol(2)

      await activate(B)
      let outage = true
      const requestToken = vi.fn(async (hash: string) => {
        if (outage) throw new Error('ENOTFOUND tsa.bob')
        return buildSyntheticToken({ contentHash: hash, genTime: new Date(TIME) })
      })
      const worker = createTimestampWorker({ requestToken })
      await pull(CASE_ID, first, { enqueueReceiptStamp: worker.enqueueReceiptStamp })
      await flush()
      expect(requestToken).toHaveBeenCalledTimes(1)
      expect(stamps()).toHaveLength(0)

      outage = false
      await pull(CASE_ID, second, { enqueueReceiptStamp: worker.enqueueReceiptStamp })
      await flush()
      const merges = mergeEntries(CASE_ID)
      expect(merges).toHaveLength(2)
      expect(stamps().map((e) => e.captureContentHash)).toEqual([merges[1].entryHash])

      // The older merge is covered through prevHash: no request for it.
      expect(await worker.processPending()).toEqual({ stamped: 0, failed: 0 })
      expect(requestToken).toHaveBeenCalledTimes(2)
      walkPasses()
    })
  })
})
