import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHash, createSign } from 'crypto'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { closeDatabase, getDb } from '@main/services/db/core'
import { listCaseMembers } from '@main/services/db/caseMemberRepo'
import { resetInstallationId } from '@main/services/installationId'
import { resetSigningKey } from '@main/services/signingKey'
import { readManifestSnapshot, readSharedCaseSnapshot } from '@main/services/manifest'
import { canonicalStringify } from '@shared/verify'
import { BYE_REASONS } from '@main/services/sharing/session'
import { memberChainPath } from '../../../../src/packages/evidence-package-layout/index'
import {
  activate,
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
  type Peer
} from '../../../helpers/syncPeers'

// Sync between real replicas (#1512): three installations, each with its own
// database, storage root, installation id and signing key, exchanging chains
// over the in-process transport. Every assertion here is about what landed on
// the dialing peer's disk and in its database.

const CASE_ID = '0196f7a2-aaaa-bbbb-cccc-000000000010'

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
    addDocument(CASE_ID, A, 1)
    const ownerChain = ownChainText(CASE_ID)
    const fromAlice = recordSource(CASE_ID, A)

    await activate(B)
    await pull(CASE_ID, fromAlice)
    addDocument(CASE_ID, B, 1)
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
})
