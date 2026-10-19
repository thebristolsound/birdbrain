import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { closeDatabase, getDb, initDatabase } from '@main/services/db/core'
import { restoreDatabase } from '@main/services/db/dbRestore'
import { createCase } from '@main/services/db/caseRepo'
import { upsertCaseMember } from '@main/services/db/caseMemberRepo'
import { createNote } from '@main/services/db/noteRepo'
import { createTag } from '@main/services/db/tagRepo'
import { readRow } from '@main/services/db/workingRowRepo'
import { getStorageRoot, initStorage } from '@main/services/storage'
import {
  getInstallationId,
  initInstallationId,
  resetInstallationId
} from '@main/services/installationId'
import { getPublicKeyPem } from '@main/services/signingKey'
import { initSettings, updateSettings } from '@main/services/settings'
import { allocateLocalVersion } from '@main/services/sharing/workingRows'
import {
  MEMBERS_FILENAME,
  SYNC_STATE_FILENAME,
  beginSession,
  finishSession,
  getSyncState,
  localVersionHighWater,
  memberTickets,
  readSyncStateFile,
  recordLocalVersion,
  rememberMemberTickets,
  resetSyncStateMemory,
  writeMembersFile,
  writeSyncStateFile
} from '@main/services/sharing/syncState'

// The sync state file, the members cache and the sync pill payload (#1512).
// The answer that matters most is frozen in the restore test: a version
// handed out after a database restore is above every version handed out
// before it, because the high-water mark lives in sync-state.json, which the
// restore does not touch.

const PEER_ID = 'installation-peer-0001'
const REVOKED_ID = 'installation-revoked-0001'

describe('sync state (#1512)', () => {
  let tempDir: string
  let dbPath: string
  let caseId: string
  let localId: string

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'bb-sync-state-'))
    initStorage(join(tempDir, 'captures'))
    dbPath = join(tempDir, 'birdbrain.db')
    await initDatabase(dbPath)
    resetInstallationId()
    initInstallationId(tempDir)
    initSettings(tempDir)
    localId = getInstallationId()
    resetSyncStateMemory()
    caseId = createCase({ name: 'Shared' }).id
  })

  afterEach(() => {
    closeDatabase()
    resetInstallationId()
    resetSyncStateMemory()
    rmSync(tempDir, { recursive: true, force: true })
  })

  const caseDir = (): string => join(getStorageRoot(), caseId)

  function share(id = caseId): void {
    getDb().prepare("UPDATE cases SET shared_at = '2026-10-01T00:00:00.000Z' WHERE id = ?").run(id)
    const base = { caseId: id, nodeId: 'node', publicKeyPem: 'pem', revokedAtIndex: null }
    upsertCaseMember({
      ...base,
      installationId: localId,
      publicKeyPem: getPublicKeyPem(),
      memberCode: 'LO',
      operatorName: 'Local',
      role: 'owner',
      addedAtIndex: 0
    })
    upsertCaseMember({
      ...base,
      installationId: PEER_ID,
      memberCode: 'PE',
      operatorName: 'Peer',
      role: 'member',
      addedAtIndex: 1
    })
    upsertCaseMember({
      ...base,
      installationId: REVOKED_ID,
      memberCode: 'RV',
      operatorName: 'Revoked',
      role: 'member',
      addedAtIndex: 2,
      revokedAtIndex: 3
    })
  }

  it('reads the empty state before any file exists, round-trips a write, and refuses garbage', () => {
    expect(readSyncStateFile(caseDir())).toEqual({
      schemaVersion: 1,
      localVersionHighWater: 0,
      lastSuccessAt: null,
      transfer: null,
      lastError: null,
      peers: {},
      tickets: {}
    })
    const state = {
      schemaVersion: 1 as const,
      localVersionHighWater: 12,
      lastSuccessAt: '2026-10-02T00:00:00.000Z',
      transfer: { entries: 1, blobs: 2, bytes: 3 },
      lastError: { kind: 'peer' as const, at: '2026-10-01T00:00:00.000Z', detail: 'x' },
      peers: {
        [PEER_ID]: { lastSessionAt: 'now', ok: true, heads: { a: { index: 1, entryHash: 'h' } } }
      },
      tickets: { [PEER_ID]: 'mem:peer' }
    }
    writeSyncStateFile(caseDir(), state)
    expect(readSyncStateFile(caseDir())).toEqual(state)
    expect(existsSync(join(caseDir(), `${SYNC_STATE_FILENAME}.partial`))).toBe(false)
    // A file written before `tickets` existed (#1810) reads with none.
    const older: Record<string, unknown> = { ...state }
    delete older.tickets
    writeFileSync(join(caseDir(), SYNC_STATE_FILENAME), JSON.stringify(older))
    expect(readSyncStateFile(caseDir()).tickets).toEqual({})
    writeFileSync(join(caseDir(), SYNC_STATE_FILENAME), '{"schemaVersion": 2}')
    expect(() => readSyncStateFile(caseDir())).toThrow('not a sync state file')
  })

  it('remembers member tickets by installation and replaces a changed one', () => {
    expect(memberTickets(caseId)).toEqual({})
    rememberMemberTickets(caseId, { [PEER_ID]: 'mem:peer', other: 'mem:other' })
    rememberMemberTickets(caseId, { [PEER_ID]: 'mem:peer-moved' })
    expect(memberTickets(caseId)).toEqual({ [PEER_ID]: 'mem:peer-moved', other: 'mem:other' })
    // A copy, not the file's object.
    memberTickets(caseId).other = 'changed'
    expect(memberTickets(caseId).other).toBe('mem:other')
    // The mark written beside them leaves them in place.
    writeSyncStateFile(caseDir(), { ...readSyncStateFile(caseDir()), localVersionHighWater: 5 })
    expect(readSyncStateFile(caseDir()).localVersionHighWater).toBe(5)
    expect(readSyncStateFile(caseDir()).tickets).toEqual({
      [PEER_ID]: 'mem:peer-moved',
      other: 'mem:other'
    })
  })

  it('keeps the high-water mark in every Shared Case and never lowers it', () => {
    expect(localVersionHighWater()).toBe(0)
    recordLocalVersion(5)
    expect(localVersionHighWater()).toBe(0)
    share()
    const second = createCase({ name: 'Also shared' }).id
    share(second)
    recordLocalVersion(5)
    expect(readSyncStateFile(caseDir()).localVersionHighWater).toBe(5)
    expect(readSyncStateFile(join(getStorageRoot(), second)).localVersionHighWater).toBe(5)
    recordLocalVersion(3)
    expect(localVersionHighWater()).toBe(5)
    expect(allocateLocalVersion()).toBe(6)
    expect(localVersionHighWater()).toBe(6)
  })

  it('hands out a version above every earlier one after a database restore', async () => {
    share()
    const first = createNote({ caseId, title: 'first', body: '' })
    expect(readRow('notes', { id: first.id }, null)?.version).toBe(1)
    const snapshot = join(tempDir, 'snapshot.db')
    await getDb().backup(snapshot)
    const second = createNote({ caseId, title: 'second', body: '' })
    expect(readRow('notes', { id: second.id }, null)?.version).toBe(2)
    expect(readSyncStateFile(caseDir()).localVersionHighWater).toBe(2)

    const outcome = await restoreDatabase({ kind: 'file', path: snapshot }, { dbPath })
    expect(outcome.status).toBe('restored')
    expect(readRow('notes', { id: second.id }, null)).toBeUndefined()
    expect(readSyncStateFile(caseDir()).localVersionHighWater).toBe(2)

    const third = createNote({ caseId, title: 'third', body: '' })
    expect(readRow('notes', { id: third.id }, null)?.version).toBe(3)
    expect(readSyncStateFile(caseDir()).localVersionHighWater).toBe(3)
  })

  // ADR-0032 rule 1: sync does not follow the Egress, so the state says when
  // the Egress is not Direct and the members screens can show the notice.
  it('reports the Egress kind, so a non-Direct Egress reads as not Direct (#1809)', () => {
    share()
    expect(getSyncState(caseId).egress).toBe('direct')
    updateSettings({
      egress: { kind: 'proxy', proxyUrl: 'socks5://127.0.0.1:1080', label: 'Frankfurt VPN' }
    })
    expect(getSyncState(caseId).egress).toBe('proxy')
    updateSettings({ egress: { kind: 'tor', proxyUrl: 'socks5://127.0.0.1:9050', label: '' } })
    expect(getSyncState(caseId).egress).toBe('tor')
    updateSettings({ egress: { kind: 'direct' } })
    expect(getSyncState(caseId).egress).toBe('direct')
  })

  it('reports the pill payload from the roster, the running sessions and the file', () => {
    share()
    expect(getSyncState(caseId)).toEqual({
      phase: 'idle',
      peersReachable: 0,
      peersTotal: 1,
      transfer: null,
      lastError: null,
      egress: 'direct'
    })
    beginSession(caseId)
    expect(getSyncState(caseId).phase).toBe('syncing')
    finishSession(caseId, {
      peerInstallationId: null,
      transfer: { entries: 0, blobs: 0, bytes: 0 },
      error: { kind: 'peer', detail: 'peer ended the session: not-a-member' },
      heads: {}
    })
    const failed = getSyncState(caseId)
    expect(failed.phase).toBe('error')
    expect(failed.peersReachable).toBe(0)
    expect(failed.lastError?.kind).toBe('peer')
    expect(failed.transfer).toEqual({ entries: 0, blobs: 0, bytes: 0 })
    expect(Object.keys(failed.lastError!)).toEqual(['kind', 'at'])

    beginSession(caseId)
    finishSession(caseId, {
      peerInstallationId: PEER_ID,
      transfer: { entries: 4, blobs: 2, bytes: 100 },
      error: null,
      heads: { [PEER_ID]: { index: 3, entryHash: 'h' } }
    })
    const ok = getSyncState(caseId)
    expect(ok.phase).toBe('idle')
    expect(ok.peersReachable).toBe(1)
    expect(ok.transfer).toEqual({ entries: 4, blobs: 2, bytes: 100 })
    expect(ok.lastError?.kind).toBe('peer')
    const file = readSyncStateFile(caseDir())
    expect(file.peers[PEER_ID]).toMatchObject({ ok: true, heads: { [PEER_ID]: { index: 3 } } })
    expect(file.lastSuccessAt).not.toBeNull()

    // A reached peer the roster has since revoked no longer counts.
    finishSession(caseId, {
      peerInstallationId: REVOKED_ID,
      transfer: { entries: 0, blobs: 0, bytes: 0 },
      error: null,
      heads: {}
    })
    expect(getSyncState(caseId).peersReachable).toBe(1)
  })

  it('writes members.json from the roster cache', () => {
    share()
    writeMembersFile(caseId)
    const file = JSON.parse(readFileSync(join(caseDir(), MEMBERS_FILENAME), 'utf-8')) as {
      caseId: string
      members: Array<Record<string, unknown>>
    }
    expect(file.caseId).toBe(caseId)
    expect(file.members.map((m) => m.installationId)).toEqual([localId, PEER_ID, REVOKED_ID])
    expect(file.members[2]).toMatchObject({ memberCode: 'RV', role: 'member', revokedAtIndex: 3 })
    expect(file.members[0]).toMatchObject({ publicKeyPem: getPublicKeyPem(), role: 'owner' })
    expect(existsSync(join(caseDir(), `${MEMBERS_FILENAME}.partial`))).toBe(false)
  })

  it('writes no file for a Case nobody shared', () => {
    createTag({ name: 'local' })
    createNote({ caseId, title: 'local', body: '' })
    expect(existsSync(join(caseDir(), SYNC_STATE_FILENAME))).toBe(false)
    expect(localVersionHighWater()).toBe(0)
  })
})
