import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, appendFileSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createHash, createSign, generateKeyPairSync } from 'crypto'
import {
  initManifest,
  appendManifestEntry,
  verifyManifestChain,
  readManifestSnapshot,
  readSharedCaseSnapshot
} from '@main/services/manifest'
import {
  resolveTrustedTime,
  buildTrustedTimeIndex,
  reconcileCaptureTrustedTime,
  reconcileAllMirrors
} from '@main/services/trustedTime'
import { initDatabase, closeDatabase } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { insertCapture, getCapture, setCaptureTrustedTime } from '@main/services/db/captureRepo'
import { initStorage, ensureCaseDir, getStorageRoot } from '@main/services/storage'
import { getPublicKeyPem, signEntryHash } from '@main/services/signingKey'
import { initSettings, updateSettings } from '@main/services/settings'
import { initInstallationId, resetInstallationId } from '@main/services/installationId'
import { createTimestampWorker } from '@main/services/timestampWorker'
import { logger } from '@main/services/logger'
import { canonicalStringify } from '@shared/verify'
import {
  resolveTrustedTimeFromEntries,
  buildTrustedTimeIndexFromEntries
} from '@shared/verify/trustedTime'
import { memberChainPath } from '../../../src/packages/evidence-package-layout/index'
import { buildSyntheticToken } from '../../helpers/timestampFixtures'

function hashOf(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

function appendCapture(caseDir: string, contentHash: string): void {
  appendManifestEntry(caseDir, {
    type: 'capture',
    captureId: 'cap-' + contentHash.slice(0, 8),
    caseId: 'case-1',
    url: 'https://example.com',
    timestamp: '2026-05-30T09:00:00.000Z',
    contentHash,
    sizeBytes: 100,
    operatorId: 'op-1',
    operatorName: 'Op One',
    toolVersion: '1.0.0'
  })
}

function appendTimestamp(caseDir: string, contentHash: string, tokenB64: string): void {
  appendManifestEntry(caseDir, {
    type: 'timestamp',
    caseId: 'case-1',
    captureContentHash: contentHash,
    timestamp: '2026-05-30T09:05:00.000Z',
    tsaToken: tokenB64,
    operatorId: 'op-1',
    operatorName: 'Op One',
    toolVersion: '1.0.0'
  })
}

describe('resolveTrustedTime', () => {
  let caseDir: string

  beforeEach(() => {
    caseDir = mkdtempSync(join(tmpdir(), 'birdbrain-tt-'))
    initManifest(caseDir)
  })

  afterEach(() => {
    rmSync(caseDir, { recursive: true, force: true })
  })

  it('is pending for a v2 capture with no timestamp entry', () => {
    const contentHash = hashOf('capture-bytes')
    appendCapture(caseDir, contentHash)

    const result = resolveTrustedTime(caseDir, contentHash)

    expect(result.trustedTime).toBe('pending')
    expect(result.stampedAt).toBeUndefined()
    expect(result.tsaName).toBeUndefined()
  })

  it('is rfc3161 with TSA identity and stamped-at once a timestamp entry exists', () => {
    const contentHash = hashOf('capture-bytes')
    const genTime = new Date('2026-05-30T09:05:00.000Z')
    appendCapture(caseDir, contentHash)
    const token = buildSyntheticToken({ contentHash, genTime, tsaDnsName: 'tsa.example.com' })
    appendTimestamp(caseDir, contentHash, token.toString('base64'))

    const result = resolveTrustedTime(caseDir, contentHash)

    expect(result.trustedTime).toBe('rfc3161')
    expect(result.tsaName).toBe('tsa.example.com')
    expect(result.stampedAt).toBe(genTime.toISOString())
  })

  it('is none for a content hash with no capture entry', () => {
    const result = resolveTrustedTime(caseDir, hashOf('never-captured'))
    expect(result.trustedTime).toBe('none')
  })

  it('is none for a grandfathered v1 capture entry', () => {
    // Hand-write a legacy v1 line (no signature, schemaVersion 1) — the shape
    // that predates timestamping. It must classify as none, not pending.
    const contentHash = hashOf('legacy-bytes')
    const line =
      JSON.stringify({
        type: 'capture',
        captureId: 'legacy-1',
        caseId: 'case-1',
        url: 'https://old.example.com',
        timestamp: '2025-01-01T00:00:00.000Z',
        contentHash,
        sizeBytes: 10,
        operatorId: 'op-1',
        operatorName: 'Op One',
        toolVersion: '0.1.0',
        index: 0,
        prevHash: '',
        schemaVersion: 1,
        entryHash: 'deadbeef'
      }) + '\n'
    appendFileSync(join(caseDir, 'manifest.jsonl'), line)

    expect(resolveTrustedTime(caseDir, contentHash).trustedTime).toBe('none')
  })

  it('keeps the hash chain valid after appending a timestamp entry', () => {
    const contentHash = hashOf('capture-bytes')
    appendCapture(caseDir, contentHash)
    const token = buildSyntheticToken({
      contentHash,
      genTime: new Date('2026-05-30T09:05:00.000Z')
    })
    appendTimestamp(caseDir, contentHash, token.toString('base64'))

    const chain = verifyManifestChain(caseDir)
    expect(chain.valid).toBe(true)
  })

  it('ignores a timestamp entry whose token imprint does not match the capture', () => {
    const contentHash = hashOf('capture-bytes')
    appendCapture(caseDir, contentHash)
    // Token over a DIFFERENT hash, but the entry claims to reference contentHash.
    const wrongToken = buildSyntheticToken({
      contentHash: hashOf('other-bytes'),
      genTime: new Date('2026-05-30T09:05:00.000Z')
    })
    appendTimestamp(caseDir, contentHash, wrongToken.toString('base64'))

    // A mismatched token is not proof of time for THIS capture → still pending.
    expect(resolveTrustedTime(caseDir, contentHash).trustedTime).toBe('pending')
  })

  it('buildTrustedTimeIndex resolves every capture in one pass', () => {
    const stampedHash = hashOf('idx-stamped')
    const pendingHash = hashOf('idx-pending')
    appendCapture(caseDir, stampedHash)
    appendCapture(caseDir, pendingHash)
    const token = buildSyntheticToken({
      contentHash: stampedHash,
      genTime: new Date('2026-05-30T09:05:00.000Z'),
      tsaDnsName: 'tsa.example.com'
    })
    appendTimestamp(caseDir, stampedHash, token.toString('base64'))

    const index = buildTrustedTimeIndex(caseDir)

    expect(index.get(stampedHash)).toMatchObject({
      trustedTime: 'rfc3161',
      tsaName: 'tsa.example.com'
    })
    expect(index.get(pendingHash)?.trustedTime).toBe('pending')
    expect(index.get(hashOf('absent'))).toBeUndefined()
    // The index must agree with the per-capture resolver it replaces in bulk.
    expect(index.get(stampedHash)?.trustedTime).toBe(
      resolveTrustedTime(caseDir, stampedHash).trustedTime
    )
  })
})

describe('reconcileCaptureTrustedTime / reconcileAllMirrors (DB mirror reconciliation)', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-tt-reconcile-'))
    initStorage(join(tempDir, 'captures'))
    await initDatabase(':memory:')
  })

  afterEach(() => {
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  function seedMhtmlCapture(caseId: string, content: string): { id: string; hash: string } {
    const hash = hashOf(content)
    const cap = insertCapture({
      caseId,
      url: 'https://example.com/' + hash.slice(0, 8),
      title: content,
      hash,
      timestamp: '2026-05-30T09:00:00.000Z',
      format: 'mhtml'
    })
    return { id: cap.id, hash }
  }

  function caseWithManifest(name: string): { caseId: string; caseDir: string } {
    const caseId = createCase({ name }).id
    const caseDir = join(getStorageRoot(), caseId)
    ensureCaseDir(caseId)
    initManifest(caseDir)
    return { caseId, caseDir }
  }

  it('self-heals a stale pending mirror to rfc3161 once a stamp lands, returning the result', () => {
    const { caseId, caseDir } = caseWithManifest('Case A')
    const { id, hash } = seedMhtmlCapture(caseId, 'reconcile-stamped')
    appendCapture(caseDir, hash)
    setCaptureTrustedTime(id, 'pending') // mirror behind reality

    const token = buildSyntheticToken({
      contentHash: hash,
      genTime: new Date('2026-05-30T09:05:00.000Z'),
      tsaDnsName: 'tsa.example.com'
    })
    appendTimestamp(caseDir, hash, token.toString('base64'))

    const result = reconcileCaptureTrustedTime({ id, caseId, hash })

    expect(result).toMatchObject({ trustedTime: 'rfc3161', tsaName: 'tsa.example.com' })
    expect(getCapture(id)?.trustedTimeStatus).toBe('rfc3161')
  })

  it('writes pending to the mirror for an eligible capture with no timestamp yet', () => {
    const { caseId, caseDir } = caseWithManifest('Case B')
    const { id, hash } = seedMhtmlCapture(caseId, 'reconcile-pending')
    appendCapture(caseDir, hash)
    setCaptureTrustedTime(id, 'none') // wrong/stale

    const result = reconcileCaptureTrustedTime({ id, caseId, hash })

    expect(result.trustedTime).toBe('pending')
    expect(getCapture(id)?.trustedTimeStatus).toBe('pending')
  })

  it('reconcileAllMirrors repaints every mhtml capture across cases from the manifest', () => {
    const a = caseWithManifest('A')
    const b = caseWithManifest('B')

    const stamped = seedMhtmlCapture(a.caseId, 'all-stamped')
    const pending = seedMhtmlCapture(a.caseId, 'all-pending')
    const orphan = seedMhtmlCapture(b.caseId, 'all-orphan') // no manifest entry → none
    appendCapture(a.caseDir, stamped.hash)
    appendCapture(a.caseDir, pending.hash)
    const token = buildSyntheticToken({
      contentHash: stamped.hash,
      genTime: new Date('2026-05-30T09:05:00.000Z'),
      tsaDnsName: 'tsa.example.com'
    })
    appendTimestamp(a.caseDir, stamped.hash, token.toString('base64'))

    // Corrupt every mirror so the rebuild has to repaint from the manifest.
    for (const id of [stamped.id, pending.id, orphan.id]) setCaptureTrustedTime(id, 'rfc3161')

    reconcileAllMirrors()

    expect(getCapture(stamped.id)?.trustedTimeStatus).toBe('rfc3161')
    expect(getCapture(pending.id)?.trustedTimeStatus).toBe('pending')
    expect(getCapture(orphan.id)?.trustedTimeStatus).toBe('none')
  })

  it('reconcileAllMirrors leaves non-mhtml captures untouched', () => {
    const { caseId } = caseWithManifest('C')
    const cap = insertCapture({
      caseId,
      url: 'https://example.com/html',
      title: 'html cap',
      hash: hashOf('html-bytes'),
      timestamp: '2026-05-30T09:00:00.000Z',
      format: 'html'
    })
    setCaptureTrustedTime(cap.id, 'pending')

    reconcileAllMirrors()

    expect(getCapture(cap.id)?.trustedTimeStatus).toBe('pending')
  })
})

// #1713. A member writes its stamps to its own chain, so in a Shared Case the
// stamp over another member's Capture is only in that member's chain. This
// installation is the Owner; the peer is a member whose chain holds a Capture
// and the stamp over it, merged into the Owner's chain.
describe('trusted time in a Shared Case', () => {
  const OWNER_ID = 'installation-owner-0001'
  const PEER_ID = 'installation-peer-0001'
  const TIME = '2026-09-27T10:00:00.000Z'
  // The committed DigiCert token and the digest it attests: the known answer
  // for a stamp read off another member's chain.
  const DIGICERT_IMPRINT = readFileSync(
    join(process.cwd(), 'tests/fixtures/timestamp/content-hash.txt'),
    'utf-8'
  ).trim()
  const DIGICERT_TOKEN = readFileSync(
    join(process.cwd(), 'tests/fixtures/timestamp/digicert-token.der')
  )
  const keyPair = (): { publicKey: string; privateKey: string } =>
    generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    })
  const PEER_KEY = keyPair()
  const OTHER_KEY = keyPair()
  const signWith =
    (privateKey: string) =>
    (entryHash: string): string =>
      createSign('sha256').update(entryHash).sign(privateKey, 'base64')

  // A signed chain built line by line, the way appendManifestEntry builds one.
  class Chain {
    lines: string[] = []
    hashes: string[] = []
    constructor(private sign: (entryHash: string) => string) {}
    append(body: Record<string, unknown>): this {
      const full = { ...body, index: this.lines.length, prevHash: this.hashes.at(-1) ?? '' }
      const entryHash = createHash('sha256').update(canonicalStringify(full)).digest('hex')
      this.lines.push(JSON.stringify({ ...full, entryHash, signature: this.sign(entryHash) }))
      this.hashes.push(entryHash)
      return this
    }
    get jsonl(): string {
      return this.lines.join('\n') + '\n'
    }
  }

  let tempDir: string
  let caseId: string
  let caseDir: string

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-tt-shared-'))
    initStorage(join(tempDir, 'captures'))
    await initDatabase(':memory:')
    initSettings(tempDir)
    updateSettings({ tsaUrl: 'http://tsa.example.com', operatorName: 'Owner' })
    initInstallationId(tempDir)
    caseId = createCase({ name: 'Shared' }).id
    caseDir = join(getStorageRoot(), caseId)
    ensureCaseDir(caseId)
  })

  afterEach(() => {
    closeDatabase()
    resetInstallationId()
    rmSync(tempDir, { recursive: true, force: true })
  })

  const by = (operatorId: string) => ({
    operatorId,
    operatorName: operatorId,
    toolVersion: '0.9.0'
  })

  const memberAdd = (id: string, pem: string, code: string, role: 'owner' | 'member') => ({
    type: 'member-add',
    caseId,
    memberInstallationId: id,
    memberPublicKeyPem: pem,
    memberCode: code,
    memberOperatorName: id,
    nodeId: `node-${id}`,
    role,
    timestamp: TIME,
    ...by(OWNER_ID),
    schemaVersion: 4
  })

  const captureEntry = (contentHash: string) => ({
    type: 'capture',
    captureId: `cap-${contentHash.slice(0, 8)}`,
    caseId,
    url: 'https://example.com/peer',
    timestamp: TIME,
    contentHash,
    sizeBytes: 1,
    ...by(PEER_ID),
    schemaVersion: 2
  })

  const stampEntry = (contentHash: string, token: Buffer) => ({
    type: 'timestamp',
    caseId,
    captureContentHash: contentHash,
    timestamp: TIME,
    tsaToken: token.toString('base64'),
    ...by(PEER_ID),
    schemaVersion: 2
  })

  // Writes the Owner's manifest and the peer's chain. `peerSign` signs the
  // peer's entries; a key other than the one the roster names breaks the chain.
  function sharedCase(
    peerEntries: Record<string, unknown>[],
    peerSign = signWith(PEER_KEY.privateKey)
  ): void {
    const peer = new Chain(peerSign)
    for (const entry of peerEntries) peer.append(entry)
    const owner = new Chain(signEntryHash)
      .append(memberAdd(OWNER_ID, getPublicKeyPem(), 'CO', 'owner'))
      .append(memberAdd(PEER_ID, PEER_KEY.publicKey, 'RP', 'member'))
    const index = peer.lines.length - 1
    owner.append({
      type: 'merge',
      caseId,
      heads: [
        {
          installationId: PEER_ID,
          index,
          entryHash: peer.hashes[index],
          entriesReceived: peer.lines.length
        }
      ],
      timestamp: TIME,
      ...by(OWNER_ID),
      schemaVersion: 4
    })
    writeFileSync(join(caseDir, 'manifest.jsonl'), owner.jsonl)
    writeFileSync(join(caseDir, memberChainPath(PEER_ID)), peer.jsonl)
  }

  const stampedPeerCase = (): void =>
    sharedCase([captureEntry(DIGICERT_IMPRINT), stampEntry(DIGICERT_IMPRINT, DIGICERT_TOKEN)])

  // A Capture row of this installation's database over `hash`, its mirror
  // reading `mirror`.
  function captureRow(hash: string, mirror: 'none' | 'pending'): string {
    const cap = insertCapture({
      caseId,
      url: 'https://example.com/peer',
      title: 'Peer capture',
      hash,
      timestamp: TIME,
      format: 'mhtml'
    })
    setCaptureTrustedTime(cap.id, mirror)
    return cap.id
  }

  // What the local chain alone answers, which is all the app read before #1713.
  const localOnly = (hash: string) =>
    resolveTrustedTimeFromEntries(readManifestSnapshot(caseDir).entries, hash)

  const sharedVerification = () =>
    readSharedCaseSnapshot(caseDir, readManifestSnapshot(caseDir)).verification

  it('builds a Shared Case whose walk accepts the peer chain', () => {
    stampedPeerCase()

    expect(sharedVerification()?.valid).toBe(true)
    expect(sharedVerification()?.entries.get(PEER_ID)).toHaveLength(2)
  })

  it("resolves another member's stamp from that member's accepted chain", () => {
    stampedPeerCase()

    expect(localOnly(DIGICERT_IMPRINT).trustedTime).toBe('none')
    expect(resolveTrustedTime(caseDir, DIGICERT_IMPRINT)).toEqual({
      trustedTime: 'rfc3161',
      tsaName: 'DigiCert SHA256 RSA4096 Timestamp Responder 2025 1',
      stampedAt: '2026-05-30T19:31:07.000Z'
    })
  })

  it('includes that stamp in the one-pass index', () => {
    stampedPeerCase()

    expect(buildTrustedTimeIndex(caseDir).get(DIGICERT_IMPRINT)).toEqual(
      resolveTrustedTime(caseDir, DIGICERT_IMPRINT)
    )
  })

  it('stores that stamp in the mirror on reconcile and on rebuild', () => {
    stampedPeerCase()
    const id = captureRow(DIGICERT_IMPRINT, 'none')

    const result = reconcileCaptureTrustedTime({ id, caseId, hash: DIGICERT_IMPRINT })
    expect(result.trustedTime).toBe('rfc3161')
    expect(getCapture(id)?.trustedTimeStatus).toBe('rfc3161')

    setCaptureTrustedTime(id, 'none')
    reconcileAllMirrors()
    expect(getCapture(id)?.trustedTimeStatus).toBe('rfc3161')
  })

  it('takes nothing from a member chain the walk did not accept', () => {
    sharedCase(
      [captureEntry(DIGICERT_IMPRINT), stampEntry(DIGICERT_IMPRINT, DIGICERT_TOKEN)],
      signWith(OTHER_KEY.privateKey)
    )

    expect(sharedVerification()?.findings.map((f) => f.outcome)).toContain('chain-broken')
    expect(resolveTrustedTime(caseDir, DIGICERT_IMPRINT)).toEqual(localOnly(DIGICERT_IMPRINT))
    expect(buildTrustedTimeIndex(caseDir).get(DIGICERT_IMPRINT)).toBeUndefined()
  })

  it("leaves pending or none to the local chain for another member's unstamped Capture", () => {
    const hash = hashOf('peer-unstamped')
    sharedCase([captureEntry(hash)])

    expect(resolveTrustedTime(caseDir, hash)).toEqual(localOnly(hash))
    expect(resolveTrustedTime(caseDir, hash).trustedTime).toBe('none')
    expect(buildTrustedTimeIndex(caseDir).get(hash)).toBeUndefined()
  })

  it('keeps the local stamp when both chains hold one for the same bytes', () => {
    const genTime = new Date('2026-05-30T09:05:00.000Z')
    const hash = hashOf('stamped-twice')
    const localToken = buildSyntheticToken({ contentHash: hash, genTime, tsaDnsName: 'local.tsa' })
    const peerToken = buildSyntheticToken({ contentHash: hash, genTime, tsaDnsName: 'peer.tsa' })
    sharedCase([captureEntry(hash), stampEntry(hash, peerToken)])
    appendManifestEntry(caseDir, {
      type: 'timestamp',
      caseId,
      captureContentHash: hash,
      timestamp: TIME,
      tsaToken: localToken.toString('base64'),
      ...by(OWNER_ID)
    })

    expect(resolveTrustedTime(caseDir, hash).tsaName).toBe('local.tsa')
    expect(buildTrustedTimeIndex(caseDir).get(hash)?.tsaName).toBe('local.tsa')
  })

  // A structurally valid token with no TSA signature, back-dated. In-app
  // resolution checks a token's structure only, so a member's chain can carry
  // one over any hash.
  const forgedStamp = (hash: string) =>
    stampEntry(
      hash,
      buildSyntheticToken({
        contentHash: hash,
        genTime: new Date('2020-01-01T00:00:00.000Z'),
        tsaDnsName: 'not-a-tsa'
      })
    )

  it("takes no stamp from another member's chain over this installation's own Capture", async () => {
    const hash = hashOf('own-capture')
    sharedCase([forgedStamp(hash)])
    appendManifestEntry(caseDir, {
      type: 'capture',
      captureId: 'cap-own',
      caseId,
      url: 'https://example.com/own',
      timestamp: TIME,
      contentHash: hash,
      sizeBytes: 1,
      ...by(OWNER_ID)
    })
    expect(sharedVerification()?.entries.get(PEER_ID)).toHaveLength(1)

    expect(resolveTrustedTime(caseDir, hash)).toEqual({ trustedTime: 'pending' })
    expect(buildTrustedTimeIndex(caseDir).get(hash)).toEqual({ trustedTime: 'pending' })

    const id = captureRow(hash, 'pending')
    const ownToken = buildSyntheticToken({
      contentHash: hash,
      genTime: new Date(TIME),
      tsaDnsName: 'local.tsa'
    })
    const requestToken = vi.fn(async () => ownToken)
    expect(await createTimestampWorker({ requestToken }).stampCapture(id)).toBe(true)

    expect(requestToken).toHaveBeenCalledOnce()
    expect(resolveTrustedTime(caseDir, hash).tsaName).toBe('local.tsa')
    expect(getCapture(id)?.trustedTimeStatus).toBe('rfc3161')
  })

  it("takes no stamp from another member's chain over this installation's own Exhibit", () => {
    const hash = hashOf('own-exhibit')
    sharedCase([forgedStamp(hash)])
    appendManifestEntry(caseDir, {
      type: 'exhibit',
      exhibitId: 'exh-own',
      caseId,
      kind: 'document',
      origin: 'manual-upload',
      name: 'own.pdf',
      exhibitNumber: 1,
      path: `${caseId}/documents/exh-own.pdf`,
      contentHash: hash,
      sizeBytes: 1,
      timestamp: TIME,
      ...by(OWNER_ID)
    })

    expect(resolveTrustedTime(caseDir, hash)).toEqual({ trustedTime: 'none' })
    expect(buildTrustedTimeIndex(caseDir).get(hash)).toBeUndefined()
  })

  // The second pre-pass's scenario: the Owner observes member B's Capture, and
  // member C, whose chain file sorts before B's, carries a forged stamp over it.
  it("prefers the stamp of the chain that records the Capture over a third member's", () => {
    const AUTHOR_ID = 'installation-zz-author'
    const THIRD_ID = 'installation-aa-third'
    const AUTHOR_KEY = keyPair()
    const THIRD_KEY = keyPair()
    const hash = hashOf('authored-by-b')
    const genuine = buildSyntheticToken({
      contentHash: hash,
      genTime: new Date(TIME),
      tsaDnsName: 'genuine.tsa'
    })
    const author = new Chain(signWith(AUTHOR_KEY.privateKey))
      .append({ ...captureEntry(hash), ...by(AUTHOR_ID) })
      .append({ ...stampEntry(hash, genuine), ...by(AUTHOR_ID) })
    const third = new Chain(signWith(THIRD_KEY.privateKey)).append({
      ...forgedStamp(hash),
      ...by(THIRD_ID)
    })
    const head = (installationId: string, { lines, hashes }: Chain) => ({
      installationId,
      index: lines.length - 1,
      entryHash: hashes[lines.length - 1],
      entriesReceived: lines.length
    })
    const owner = new Chain(signEntryHash)
      .append(memberAdd(OWNER_ID, getPublicKeyPem(), 'CO', 'owner'))
      .append(memberAdd(AUTHOR_ID, AUTHOR_KEY.publicKey, 'AB', 'member'))
      .append(memberAdd(THIRD_ID, THIRD_KEY.publicKey, 'TC', 'member'))
      .append({
        type: 'merge',
        caseId,
        heads: [head(AUTHOR_ID, author), head(THIRD_ID, third)],
        timestamp: TIME,
        ...by(OWNER_ID),
        schemaVersion: 4
      })
    writeFileSync(join(caseDir, 'manifest.jsonl'), owner.jsonl)
    writeFileSync(join(caseDir, memberChainPath(AUTHOR_ID)), author.jsonl)
    writeFileSync(join(caseDir, memberChainPath(THIRD_ID)), third.jsonl)
    const walked = [...(sharedVerification()?.entries.keys() ?? [])]
    expect(walked.indexOf(THIRD_ID)).toBeLessThan(walked.indexOf(AUTHOR_ID))

    const expected = {
      trustedTime: 'rfc3161',
      tsaName: 'genuine.tsa',
      stampedAt: TIME
    }
    expect(resolveTrustedTime(caseDir, hash)).toEqual(expected)
    expect(buildTrustedTimeIndex(caseDir).get(hash)).toEqual(expected)
  })

  it('reads no other chain to resolve a hash the local chain records as its own', () => {
    initManifest(caseDir)
    const own = hashOf('own-no-walk')
    appendCapture(caseDir, own)
    // A directory where a member's chain file belongs: reading the chains fails,
    // and the failure is logged.
    mkdirSync(join(caseDir, memberChainPath(PEER_ID)))
    const logged = vi.spyOn(logger, 'error').mockImplementation(() => 'log-id')

    expect(resolveTrustedTime(caseDir, own)).toEqual({ trustedTime: 'pending' })
    expect(logged).not.toHaveBeenCalled()
    resolveTrustedTime(caseDir, hashOf('not-own'))
    expect(logged).toHaveBeenCalledOnce()
    logged.mockRestore()
  })

  // The second pre-pass's other scenario: the launch's mirror rebuild meets a
  // directory at a member chain path (EISDIR). That Case resolves from its
  // local chain alone, the rebuild carries on over the other Cases, and the
  // failure is logged against the Case.
  it('keeps the launch rebuild going when a Case cannot read its member chains', () => {
    stampedPeerCase()
    mkdirSync(join(caseDir, memberChainPath('installation-broken-0001')))
    const remote = captureRow(DIGICERT_IMPRINT, 'pending')
    const otherCaseId = createCase({ name: 'Unshared' }).id
    const otherDir = join(getStorageRoot(), otherCaseId)
    ensureCaseDir(otherCaseId)
    initManifest(otherDir)
    const stamped = hashOf('other-case-stamped')
    appendCapture(otherDir, stamped)
    const token = buildSyntheticToken({ contentHash: stamped, genTime: new Date(TIME) })
    appendTimestamp(otherDir, stamped, token.toString('base64'))
    const other = insertCapture({
      caseId: otherCaseId,
      url: 'https://example.com/other',
      title: 'Other case capture',
      hash: stamped,
      timestamp: TIME,
      format: 'mhtml'
    })
    setCaptureTrustedTime(other.id, 'pending')
    const logged = vi.spyOn(logger, 'error').mockImplementation(() => 'log-id')

    expect(() => reconcileAllMirrors()).not.toThrow()

    expect(getCapture(remote)?.trustedTimeStatus).toBe(localOnly(DIGICERT_IMPRINT).trustedTime)
    expect(getCapture(other.id)?.trustedTimeStatus).toBe('rfc3161')
    expect(resolveTrustedTime(caseDir, DIGICERT_IMPRINT)).toEqual(localOnly(DIGICERT_IMPRINT))
    expect(logged).toHaveBeenCalledWith(
      'trustedTime',
      'trustedTime.shared_chains_unreadable',
      { caseId },
      expect.objectContaining({ code: 'EISDIR' })
    )
    logged.mockRestore()
  })

  // The issue's own scenario: this installation is a member, the Owner's chain
  // and a peer member's chain are the remote ones, and each stamps a Capture of
  // its own.
  it("resolves stamps from the Owner's and a peer's chain when this installation is a member", () => {
    const LOCAL_ID = 'installation-member-0001'
    const OWNER_KEY = keyPair()
    const ownerHash = hashOf('owner-capture')
    const ownerToken = buildSyntheticToken({
      contentHash: ownerHash,
      genTime: new Date(TIME),
      tsaDnsName: 'owner.tsa'
    })
    const peer = new Chain(signWith(PEER_KEY.privateKey))
      .append(captureEntry(DIGICERT_IMPRINT))
      .append(stampEntry(DIGICERT_IMPRINT, DIGICERT_TOKEN))
    const owner = new Chain(signWith(OWNER_KEY.privateKey))
      .append(memberAdd(OWNER_ID, OWNER_KEY.publicKey, 'CO', 'owner'))
      .append(memberAdd(LOCAL_ID, getPublicKeyPem(), 'LM', 'member'))
      .append(memberAdd(PEER_ID, PEER_KEY.publicKey, 'RP', 'member'))
      .append({ ...captureEntry(ownerHash), ...by(OWNER_ID) })
      .append({ ...stampEntry(ownerHash, ownerToken), ...by(OWNER_ID) })
    const local = new Chain(signEntryHash).append({
      type: 'merge',
      caseId,
      heads: [OWNER_ID, PEER_ID].map((installationId) => {
        const chain = installationId === OWNER_ID ? owner : peer
        const index = chain.lines.length - 1
        return {
          installationId,
          index,
          entryHash: chain.hashes[index],
          entriesReceived: chain.lines.length
        }
      }),
      timestamp: TIME,
      ...by(LOCAL_ID),
      schemaVersion: 4
    })
    writeFileSync(join(caseDir, 'manifest.jsonl'), local.jsonl)
    writeFileSync(join(caseDir, memberChainPath(OWNER_ID)), owner.jsonl)
    writeFileSync(join(caseDir, memberChainPath(PEER_ID)), peer.jsonl)

    expect(sharedVerification()?.localInstallationId).toBe(LOCAL_ID)
    expect(localOnly(DIGICERT_IMPRINT).trustedTime).toBe('none')
    expect(localOnly(ownerHash).trustedTime).toBe('none')
    expect(resolveTrustedTime(caseDir, DIGICERT_IMPRINT).tsaName).toBe(
      'DigiCert SHA256 RSA4096 Timestamp Responder 2025 1'
    )
    expect(resolveTrustedTime(caseDir, ownerHash).tsaName).toBe('owner.tsa')
    const index = buildTrustedTimeIndex(caseDir)
    expect(index.get(DIGICERT_IMPRINT)?.trustedTime).toBe('rfc3161')
    expect(index.get(ownerHash)?.tsaName).toBe('owner.tsa')
  })

  it("asks no TSA to stamp a Capture another member's chain already stamps", async () => {
    stampedPeerCase()
    const id = captureRow(DIGICERT_IMPRINT, 'pending')
    const requestToken = vi.fn(async () => DIGICERT_TOKEN)
    const before = readFileSync(join(caseDir, 'manifest.jsonl'), 'utf-8')

    expect(await createTimestampWorker({ requestToken }).stampCapture(id)).toBe(true)

    expect(requestToken).not.toHaveBeenCalled()
    expect(readFileSync(join(caseDir, 'manifest.jsonl'), 'utf-8')).toBe(before)
    expect(getCapture(id)?.trustedTimeStatus).toBe('rfc3161')
  })

  it('asks no TSA when the local chain stamps a Capture the mirror still calls pending', async () => {
    initManifest(caseDir)
    const hash = hashOf('local-stamped')
    appendCapture(caseDir, hash)
    const token = buildSyntheticToken({ contentHash: hash, genTime: new Date(TIME) })
    appendTimestamp(caseDir, hash, token.toString('base64'))
    const id = captureRow(hash, 'pending')
    const requestToken = vi.fn(async () => token)

    expect(await createTimestampWorker({ requestToken }).stampCapture(id)).toBe(true)

    expect(requestToken).not.toHaveBeenCalled()
    expect(getCapture(id)?.trustedTimeStatus).toBe('rfc3161')
  })

  it('resolves a Case that is not shared from the local chain exactly', () => {
    initManifest(caseDir)
    const stamped = hashOf('unshared-stamped')
    const pending = hashOf('unshared-pending')
    appendCapture(caseDir, stamped)
    appendCapture(caseDir, pending)
    const token = buildSyntheticToken({ contentHash: stamped, genTime: new Date(TIME) })
    appendTimestamp(caseDir, stamped, token.toString('base64'))
    const { entries } = readManifestSnapshot(caseDir)

    expect(sharedVerification()).toBeUndefined()
    for (const hash of [stamped, pending, hashOf('absent')]) {
      expect(resolveTrustedTime(caseDir, hash)).toEqual(
        resolveTrustedTimeFromEntries(entries, hash)
      )
    }
    expect(buildTrustedTimeIndex(caseDir)).toEqual(buildTrustedTimeIndexFromEntries(entries))
  })
})
