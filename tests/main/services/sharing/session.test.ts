import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createSign, generateKeyPairSync, randomBytes } from 'crypto'
import { mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { closeDatabase, getDb, initDatabase } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { upsertCaseMember } from '@main/services/db/caseMemberRepo'
import { getStorageRoot, initStorage } from '@main/services/storage'
import { initSettings, updateSettings } from '@main/services/settings'
import {
  getInstallationId,
  initInstallationId,
  resetInstallationId
} from '@main/services/installationId'
import { getPublicKeyPem, signEntryHash } from '@main/services/signingKey'
import {
  appendManifestEntry,
  appendMemberChainLines,
  initManifest,
  readMemberChainText
} from '@main/services/manifest'
import { verifyEntrySignature } from '@shared/verify'
import { MemoryHub, type ByteStream } from '@main/services/sharing/transport'
import { memberTickets, rememberMemberTickets } from '@main/services/sharing/syncState'
import {
  CHALLENGE_BYTES,
  MAX_BLOB_BYTES,
  MAX_HANDSHAKE_FRAME_BYTES,
  MessageReader,
  expectMessage,
  writeMessage,
  type SyncMessageOf
} from '@main/services/sharing/messages'
import {
  BYE_REASONS,
  PAGE_BYTES,
  helloDigest,
  liveSyncSource,
  pullFromPeer,
  serveSyncSession,
  type ServeOptions,
  type SyncSource
} from '@main/services/sharing/session'
import type { ReceivedCaptures } from '@main/services/sharing/receivedEvidence'
import type { CaseMember } from '@shared/types'
import { memberChainPath } from '../../../../src/packages/evidence-package-layout/index'

// The session's handshake (#1512): who gets past `hello`, and who gets `bye`.
// The dialer runs against this test's database, roster and key; the listener
// is a SyncSource standing in for the peer, with its own key and a roster the
// test can change mid-session. The peer-to-peer steps that move entries,
// files and rows between two real replicas are in syncPeers.test.ts.

// These sessions bring no Capture, so the apply step never calls either.
const receivedCaptures: ReceivedCaptures = {
  processReceived: () => {},
  removeReceived: async () => false
}

const keyPair = () =>
  generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  })

const signWith =
  (key: { privateKey: string }) =>
  (hex: string): string =>
    createSign('sha256').update(hex).sign(key.privateKey, 'base64')

const PEER_KEY = keyPair()
const OTHER_KEY = keyPair()
const PEER_ID = 'installation-peer-0001'

describe('sync session handshake (#1512)', () => {
  let tempDir: string
  let caseId: string
  let localId: string
  // The listener's roster: the peer is the Owner and this installation its
  // member. Mutable, so a test can revoke mid-session.
  let serverRoster: CaseMember[]

  function member(installationId: string, overrides: Partial<CaseMember> = {}): CaseMember {
    return {
      caseId,
      installationId,
      publicKeyPem: installationId === PEER_ID ? PEER_KEY.publicKey : getPublicKeyPem(),
      memberCode: installationId === PEER_ID ? 'PR' : 'LO',
      operatorName: installationId === PEER_ID ? 'Robin Peer' : 'Casey Local',
      nodeId: `node-${installationId}`,
      role: installationId === PEER_ID ? 'owner' : 'member',
      addedAtIndex: installationId === PEER_ID ? 0 : 1,
      revokedAtIndex: null,
      ...overrides
    }
  }

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'bb-sync-session-'))
    initStorage(join(tempDir, 'captures'))
    await initDatabase(':memory:')
    initSettings(tempDir)
    updateSettings({ operatorName: 'Casey Local' })
    resetInstallationId()
    initInstallationId(tempDir)
    localId = getInstallationId()
    caseId = createCase({ name: 'Shared' }).id
    getDb()
      .prepare('UPDATE cases SET shared_at = ?, owner_installation_id = ? WHERE id = ?')
      .run('2026-10-01T00:00:00.000Z', PEER_ID, caseId)
    mkdirSync(join(getStorageRoot(), caseId), { recursive: true })
    upsertCaseMember(member(PEER_ID))
    upsertCaseMember(member(localId))
    serverRoster = [member(PEER_ID), member(localId)]
  })

  afterEach(() => {
    closeDatabase()
    resetInstallationId()
    rmSync(tempDir, { recursive: true, force: true })
  })

  function peerSource(overrides: Partial<SyncSource> = {}): SyncSource {
    return {
      installationId: PEER_ID,
      caseId,
      roster: () => serverRoster,
      heads: () => [],
      chainLines: () => [],
      blob: () => null,
      rowsSince: () => ({ rows: [], more: false }),
      sign: signWith(PEER_KEY),
      ...overrides
    }
  }

  // Runs one session: this installation dials, the source answers.
  async function session(
    source: SyncSource | null,
    options: Partial<Parameters<typeof pullFromPeer>[2]> = {},
    serve: ServeOptions = {}
  ) {
    const hub = new MemoryHub()
    const dialer = hub.createTransport('dialer')
    const listener = hub.createTransport('listener')
    const served = new Promise<void>((resolve, reject) => {
      void listener.listen((stream) => {
        serveSyncSession(stream, (id) => (source && id === caseId ? source : null), serve).then(
          resolve,
          reject
        )
      })
    })
    const stream = await dialer.openStream(await dialer.dial(listener.ticket))
    const result = await pullFromPeer(caseId, stream, { receivedCaptures, ...options })
    await served
    return result
  }

  // A hand-driven dialer, for the listener's refusals the real dialer never
  // provokes.
  async function rawDialer(
    source: SyncSource,
    serve: ServeOptions = {}
  ): Promise<{
    stream: ByteStream
    reader: MessageReader
    served: Promise<void>
  }> {
    const hub = new MemoryHub()
    const dialer = hub.createTransport('dialer')
    const listener = hub.createTransport('listener')
    const served = new Promise<void>((resolve, reject) => {
      void listener.listen((stream) => {
        serveSyncSession(stream, () => source, serve).then(resolve, reject)
      })
    })
    const stream = await dialer.openStream(await dialer.dial(listener.ticket))
    return { stream, reader: new MessageReader(stream), served }
  }

  it('completes the handshake with a roster member and exchanges heads', async () => {
    const heads = vi.fn(() => [{ installationId: PEER_ID, index: 0, entryHash: 'h' }])
    const result = await session(peerSource({ heads }))
    expect(result.errors).toEqual([])
    expect(result.peerInstallationId).toBe(PEER_ID)
    expect(heads).toHaveBeenCalledTimes(1)
  })

  it('gives an installation the listener roster does not name bye and nothing else', async () => {
    serverRoster = [member(PEER_ID)]
    const heads = vi.fn(() => [])
    const result = await session(peerSource({ heads }))
    expect(result.peerInstallationId).toBeNull()
    expect(result.errors).toEqual([
      { kind: 'peer', detail: `peer ended the session: ${BYE_REASONS.notMember}` }
    ])
    expect(heads).not.toHaveBeenCalled()
  })

  it('gives a revoked installation bye at hello', async () => {
    serverRoster = [member(PEER_ID), member(localId, { revokedAtIndex: 4 })]
    const result = await session(peerSource())
    expect(result.errors[0]?.detail).toBe(`peer ended the session: ${BYE_REASONS.revoked}`)
  })

  it('ends the session at the next request when the member is revoked mid-session', async () => {
    const heads = vi.fn(() => [])
    const result = await session(peerSource({ heads }), {
      onPhase: (phase) => {
        if (phase === 'heads')
          serverRoster = [member(PEER_ID), member(localId, { revokedAtIndex: 7 })]
      }
    })
    expect(result.peerInstallationId).toBe(PEER_ID)
    expect(result.errors[0]?.detail).toBe(`peer ended the session: ${BYE_REASONS.revoked}`)
    expect(heads).not.toHaveBeenCalled()
  })

  it('says bye to a peer its own roster does not name', async () => {
    getDb().prepare('DELETE FROM case_members WHERE installation_id = ?').run(PEER_ID)
    const heads = vi.fn(() => [])
    const result = await session(peerSource({ heads }))
    expect(result.peerInstallationId).toBeNull()
    expect(result.errors[0]).toEqual({
      kind: 'peer',
      detail: `peer ${PEER_ID} is ${BYE_REASONS.notMember}`
    })
    expect(heads).not.toHaveBeenCalled()
  })

  it('says bye to a peer its own roster names as revoked', async () => {
    upsertCaseMember(member(PEER_ID, { revokedAtIndex: 3 }))
    const result = await session(peerSource())
    expect(result.errors[0]?.detail).toBe(`peer ${PEER_ID} is ${BYE_REASONS.revoked}`)
  })

  it('says bye to a peer whose proof does not verify under the roster key', async () => {
    const result = await session(peerSource({ sign: signWith(OTHER_KEY) }))
    expect(result.peerInstallationId).toBeNull()
    expect(result.errors[0]?.detail).toBe(`peer ${PEER_ID} failed to prove its key`)
  })

  it('says bye to a peer that answers for another Case', async () => {
    const result = await session(peerSource({ caseId: 'another-case' }))
    expect(result.errors[0]?.detail).toBe('peer answered for Case another-case')
  })

  it('is refused for a Case the listener does not share', async () => {
    const result = await session(null)
    expect(result.errors[0]?.detail).toBe(`peer ended the session: ${BYE_REASONS.unknownCase}`)
  })

  it('refuses a dialer claiming the listener installation', async () => {
    const result = await session(peerSource({ installationId: localId }))
    expect(result.errors[0]?.detail).toBe(`peer ended the session: ${BYE_REASONS.ownInstallation}`)
  })

  it('refuses a proof that does not verify, a message before hello, and an unknown request', async () => {
    const hello = (): SyncMessageOf<'hello'> => ({
      t: 'hello',
      caseId,
      installationId: localId,
      challenge: randomBytes(CHALLENGE_BYTES),
      proof: null
    })

    const bad = await rawDialer(peerSource())
    await writeMessage(bad.stream, hello())
    await expectMessage(bad.reader, 'hello')
    await writeMessage(bad.stream, { t: 'proof', signature: 'bm90IGEgc2lnbmF0dXJl' })
    expect(await bad.reader.next()).toEqual({ t: 'bye', reason: BYE_REASONS.badProof })
    await bad.served

    const early = await rawDialer(peerSource())
    await writeMessage(early.stream, { t: 'heads', heads: [] })
    expect(await early.reader.next()).toEqual({ t: 'bye', reason: BYE_REASONS.protocol })
    await early.served

    const odd = await rawDialer(peerSource())
    const first = hello()
    await writeMessage(odd.stream, first)
    const answer = await expectMessage(odd.reader, 'hello')
    expect(
      verifyEntrySignature(
        helloDigest(caseId, first.challenge, PEER_ID),
        answer.proof!,
        PEER_KEY.publicKey
      )
    ).toBe(true)
    await writeMessage(odd.stream, { t: 'proof', signature: 'bm90IGEgc2lnbmF0dXJl' })
    expect(await odd.reader.next()).toEqual({ t: 'bye', reason: BYE_REASONS.badProof })
    await odd.served

    const garbage = await rawDialer(peerSource())
    await garbage.stream.write(new Uint8Array([0, 0, 0, 2, 0xff, 0xff]))
    expect(await garbage.reader.next()).toEqual({ t: 'bye', reason: BYE_REASONS.protocol })
    await garbage.served
  })

  // A ticket names the relay its node started on, so each session refreshes
  // the one the other side dials, and only once the sender has proved its key
  // (#1809).
  it("tells each side the other's current ticket once both have proved their keys", async () => {
    rememberMemberTickets(caseId, { [PEER_ID]: 'ticket-on-the-old-relay' })
    const rememberTicket = vi.fn()
    const result = await session(
      peerSource(),
      { ticket: 'dialer-ticket' },
      { ticket: 'listener-ticket', rememberTicket }
    )
    expect(result.errors).toEqual([])
    expect(memberTickets(caseId)[PEER_ID]).toBe('listener-ticket')
    expect(rememberTicket).toHaveBeenCalledWith(caseId, localId, 'dialer-ticket')
  })

  it('keeps the held ticket when the session sends none, or the same one', async () => {
    rememberMemberTickets(caseId, { [PEER_ID]: 'listener-ticket' })
    await session(peerSource())
    expect(memberTickets(caseId)[PEER_ID]).toBe('listener-ticket')
    const rememberTicket = vi.fn()
    await session(peerSource(), {}, { ticket: 'listener-ticket', rememberTicket })
    expect(memberTickets(caseId)[PEER_ID]).toBe('listener-ticket')
    expect(rememberTicket).not.toHaveBeenCalled()
  })

  it('takes no ticket from a side that fails to prove its key', async () => {
    await session(peerSource({ sign: signWith(OTHER_KEY) }), {}, { ticket: 'forged-ticket' })
    expect(memberTickets(caseId)[PEER_ID]).toBeUndefined()

    const rememberTicket = vi.fn()
    const bad = await rawDialer(peerSource(), { rememberTicket })
    await writeMessage(bad.stream, {
      t: 'hello',
      caseId,
      installationId: localId,
      challenge: randomBytes(CHALLENGE_BYTES),
      proof: null,
      ticket: 'forged-ticket'
    })
    await expectMessage(bad.reader, 'hello')
    await writeMessage(bad.stream, { t: 'proof', signature: 'bm90IGEgc2lnbmF0dXJl' })
    expect(await bad.reader.next()).toEqual({ t: 'bye', reason: BYE_REASONS.badProof })
    await bad.served
    expect(rememberTicket).not.toHaveBeenCalled()
  })

  it('reads no frame above the handshake cap until the dialer proves its key', async () => {
    const oversized = new Uint8Array(4)
    new DataView(oversized.buffer).setUint32(0, MAX_HANDSHAKE_FRAME_BYTES + 1)

    // A stranger's header alone is refused: no body follows, and none is awaited.
    const stranger = await rawDialer(peerSource())
    await stranger.stream.write(oversized)
    expect(await stranger.reader.next()).toEqual({ t: 'bye', reason: BYE_REASONS.protocol })
    await stranger.served

    // The same request after the proof is served.
    const blob = vi.fn(() => null)
    const proven = await rawDialer(peerSource({ blob }))
    const challenge = randomBytes(CHALLENGE_BYTES)
    await writeMessage(proven.stream, {
      t: 'hello',
      caseId,
      installationId: localId,
      challenge,
      proof: null
    })
    const answer = await expectMessage(proven.reader, 'hello')
    await writeMessage(proven.stream, {
      t: 'proof',
      signature: signEntryHash(helloDigest(caseId, answer.challenge, localId))
    })
    const paths = Array.from({ length: 70 }, (_, i) => `${i}-${'p'.repeat(1000)}`)
    await writeMessage(proven.stream, { t: 'blobs-request', paths })
    for (const path of paths) {
      expect(await expectMessage(proven.reader, 'blobs')).toEqual({ t: 'blobs', path, bytes: null })
    }
    expect(blob).toHaveBeenCalledTimes(paths.length)
    proven.stream.close()
    await proven.served
  })

  it('ends quietly when the dialer closes without a word', async () => {
    const { stream, served } = await rawDialer(peerSource())
    stream.close()
    await expect(served).resolves.toBeUndefined()
  })

  it('refuses to pull for a Case nobody shared', async () => {
    const lonely = createCase({ name: 'Lonely' }).id
    const hub = new MemoryHub()
    const dialer = hub.createTransport('dialer')
    const listener = hub.createTransport('listener')
    await listener.listen(() => {})
    const stream = await dialer.openStream(await dialer.dial(listener.ticket))
    await expect(pullFromPeer(lonely, stream, { receivedCaptures })).rejects.toThrow(
      'not a Shared Case'
    )
  })

  it('serves a shared Case live: roster, every chain head, and this installation key', () => {
    expect(liveSyncSource(createCase({ name: 'Lonely' }).id)).toBeNull()
    const caseDir = join(getStorageRoot(), caseId)
    initManifest(caseDir)
    const own = appendManifestEntry(caseDir, {
      type: 'exhibit',
      exhibitId: 'x-1',
      caseId,
      kind: 'document',
      origin: 'manual-upload',
      name: 'a.pdf',
      exhibitNumber: 1,
      path: `${caseId}/documents/x-1.pdf`,
      contentHash: 'a'.repeat(64),
      sizeBytes: 1,
      timestamp: '2026-10-01T00:00:00.000Z',
      operatorId: localId,
      operatorName: 'Casey Local',
      toolVersion: '0.0.0'
    })
    writeFileSync(
      join(caseDir, memberChainPath(PEER_ID)),
      JSON.stringify({ index: 2, entryHash: 'peer-head' }) + '\n'
    )
    const source = liveSyncSource(caseId)!
    expect(source.installationId).toBe(localId)
    expect(source.caseId).toBe(caseId)
    expect(source.roster().map((m) => m.installationId)).toEqual([PEER_ID, localId])
    expect(source.heads()).toEqual([
      { installationId: localId, index: own.index, entryHash: own.entryHash },
      { installationId: PEER_ID, index: 2, entryHash: 'peer-head' }
    ])
    const digest = helloDigest(caseId, randomBytes(CHALLENGE_BYTES), localId)
    expect(verifyEntrySignature(digest, source.sign(digest), getPublicKeyPem())).toBe(true)
  })

  // Review finding 1 on this PR: the id a peer sends names a chain file on
  // the listener, so an id that is not one path segment reached another
  // Case's chain. Checked at the codec, in the live source, and at the file.
  // Scheduled review finding 7: a file is sized before it is read, and one
  // no frame could carry is answered as not held without a read.
  it('serves a file under the Case directory, and none above the frame cap', () => {
    const documents = join(getStorageRoot(), caseId, 'documents')
    mkdirSync(documents, { recursive: true })
    writeFileSync(join(documents, 'small.pdf'), 'small')
    // A sparse file: the size is what the check reads, and nothing is read.
    writeFileSync(join(documents, 'big.pdf'), '')
    truncateSync(join(documents, 'big.pdf'), MAX_BLOB_BYTES + 1)
    const live = liveSyncSource(caseId)!
    expect(Buffer.from(live.blob(`${caseId}/documents/small.pdf`)!).toString()).toBe('small')
    expect(live.blob(`${caseId}/documents/big.pdf`)).toBeNull()
    expect(live.blob(`${caseId}/documents/absent.pdf`)).toBeNull()
  })

  it('serves no chain for an installation id that is not one path segment, nor for a stranger', async () => {
    const other = createCase({ name: 'Other' }).id
    mkdirSync(join(getStorageRoot(), other), { recursive: true })
    writeFileSync(join(getStorageRoot(), other, 'manifest.jsonl'), '{"other":"case chain"}\n')
    const traversal = `./../../${other}/manifest`
    const caseDir = join(getStorageRoot(), caseId)
    initManifest(caseDir)
    const live = liveSyncSource(caseId)!
    expect(live.chainLines(traversal, 0, PAGE_BYTES)).toEqual([])
    expect(live.chainLines('installation-not-on-roster', 0, PAGE_BYTES)).toEqual([])
    expect(live.chainLines(PEER_ID, 0, PAGE_BYTES)).toEqual([])
    expect(() => readMemberChainText(caseDir, traversal)).toThrow('cannot name a chain file')
    expect(() => appendMemberChainLines(caseDir, traversal, ['{}'])).toThrow(
      'cannot name a chain file'
    )
    expect(() => appendMemberChainLines(caseDir, 'a\\b', ['{}'])).toThrow(
      'cannot name a chain file'
    )

    // The live listener, dialed by the peer under its own key: the request
    // is refused at the codec and the session ends with bye.
    const { stream, reader, served } = await rawDialer(live)
    const opening: SyncMessageOf<'hello'> = {
      t: 'hello',
      caseId,
      installationId: PEER_ID,
      challenge: randomBytes(CHALLENGE_BYTES),
      proof: null
    }
    await writeMessage(stream, opening)
    const answer = await expectMessage(reader, 'hello')
    expect(answer.installationId).toBe(localId)
    await writeMessage(stream, {
      t: 'proof',
      signature: signWith(PEER_KEY)(helloDigest(caseId, answer.challenge, PEER_ID))
    })
    await writeMessage(stream, { t: 'heads', heads: [] })
    expect((await expectMessage(reader, 'heads')).heads).toEqual([])
    await writeMessage(stream, { t: 'entries-request', installationId: traversal, fromIndex: 0 })
    expect(await reader.next()).toEqual({ t: 'bye', reason: BYE_REASONS.protocol })
    await served
  })
})
