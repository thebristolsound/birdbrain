import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach, vi } from 'vitest'
import { createHash, createSign, generateKeyPairSync } from 'crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'fs'
import { dirname, join } from 'path'
import { tmpdir } from 'os'
import { closeDatabase, getDb, initDatabase } from '@main/services/db/core'
import { createCase, deleteCase, getCase } from '@main/services/db/caseRepo'
import { listExhibits } from '@main/services/db/exhibitRepo'
import { insertWithheldFlag, listWithheldFlags } from '@main/services/db/exhibitMarkRepo'
import {
  exhibitCitationResolver,
  listCaseMembers,
  upsertCaseMember
} from '@main/services/db/caseMemberRepo'
import { getStorageRoot, initStorage } from '@main/services/storage'
import {
  readCaseChains,
  readManifestSnapshot,
  readSharedCaseSnapshot
} from '@main/services/manifest'
import { generateReport } from '@main/services/export'
import { verifyCaseDerivedFiles, verifyExhibit } from '@main/services/exhibits'
import {
  exportCaseArchive,
  importCaseArchive,
  inspectCaseArchive
} from '@main/services/caseArchive'
import { createCaptureLifecycle, entryDescribesRow } from '@main/services/captureLifecycle'
import { backfillCase } from '@main/services/exhibitBackfill'
import { nextExhibitNumber } from '@main/services/exhibitNumbering'
import { createSelectorLifecycle } from '@main/services/selectorLifecycle'
import { initSettings, updateSettings } from '@main/services/settings'
import {
  getInstallationId,
  initInstallationId,
  resetInstallationId
} from '@main/services/installationId'
import { getPublicKeyPem, signEntryHash } from '@main/services/signingKey'
import { readStoredZip } from '@main/services/zipRead'
import { MANIFEST_SCHEMA_VERSION } from '@shared/constants'
import { canonicalStringify } from '@shared/verify'
import { verifyEvidencePackage } from '@shared/verify/evidencePackage'
import { extractTimestampTokenCertificatesPem } from '@shared/verify/timestampToken'
import {
  lineageChainPath,
  memberChainPath
} from '../../../src/packages/evidence-package-layout/index'
import type { ExportOptions } from '@shared/types'
import { rewriteArchive as rewriteRepairedArchive } from '../../helpers/archiveDerivedFiles'
import { HAS_JQ } from '../../helpers/jq'
import { HAS_OPENSSL } from '../../helpers/openssl'
import { createLocalTsa, type LocalTsa } from '../../helpers/localTsa'
import { extractRunbookBlocks, runRunbookBlocks } from '../../helpers/runbookBlocks'
import { runVerifyScript } from '../../helpers/verifyScript'
import { checkConformance } from '../../helpers/verifyConformance'

// Shared Cases, step 3 (#1511): the writers. The three acceptance criteria are
// frozen here, each end to end through the app's own export and import and
// the standalone package verifier:
//
//   1. A two-member Case exports as an Evidence Package that passes the
//      package verifier, `merge` heads included.
//   2. An export with an `exclude` lists who excluded the Exhibit and when,
//      and still encloses the Exhibit's bytes, which verify.
//   3. A fork from a non-Owner replica: the new chain is the Owner's chain
//      and an `import` naming the Owner's key, the other chains travel as
//      lineage, and the Case verifies.

vi.mock('@main/services/tlsCertChain', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/services/tlsCertChain')>()
  return { ...actual, fetchCertChain: vi.fn(async () => null) }
})

// The receipt stamp tests (#1515) replace the bundled DigiCert root with a
// throwaway local TSA's, as verifyRunbookExecution.test.ts does, so the
// package encloses the root its receipt token chains to. Empty until those
// tests set it, so every other test exports exactly as before.
const localRoot = vi.hoisted(() => ({ pem: '' }))

vi.mock('@main/services/tsaTrust', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/services/tsaTrust')>()
  return {
    ...actual,
    getTsaTrustBundle: (tsaUrl: string) =>
      localRoot.pem === ''
        ? actual.getTsaTrustBundle(tsaUrl)
        : { pem: localRoot.pem, bundled: true }
  }
})

interface KeyPair {
  publicKey: string
  privateKey: string
}

const keyPair = (): KeyPair =>
  generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  })

const signWith =
  (key: KeyPair) =>
  (entryHash: string): string =>
    createSign('sha256').update(entryHash).sign(key.privateKey, 'base64')

// A second installation's key and id: the member when this installation is
// the Owner, the Owner when this installation is the member.
const PEER_KEY = keyPair()
const PEER_ID = 'installation-peer-0001'

// A signed chain built line by line, the way appendManifestEntry builds one.
// The app has no writer for schema-4 entries until sync lands (step 4), so the
// fixtures write them as a remote peer would have.
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
  head(installationId: string): { installationId: string; index: number; entryHash: string } {
    const index = this.lines.length - 1
    return { installationId, index, entryHash: this.hashes[index] }
  }
}

const TIME = '2026-09-27T10:00:00.000Z'

function operator(installationId: string, operatorName: string) {
  return { operatorId: installationId, operatorName, toolVersion: '0.9.0' }
}

describe('Shared Case export, import and fork (#1511)', () => {
  let tempDir: string
  let caseId: string
  let localId: string
  const lifecycle = createCaptureLifecycle({
    selectorLifecycle: createSelectorLifecycle({ emitRematched: () => {} })
  })

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'bb-shared-export-'))
    initStorage(join(tempDir, 'captures'))
    await initDatabase(':memory:')
    initSettings(tempDir)
    updateSettings({ operatorName: 'Casey Operator' })
    resetInstallationId()
    initInstallationId(tempDir)
    localId = getInstallationId()
    caseId = createCase({ name: 'Shared' }).id
    mkdirSync(join(getStorageRoot(), caseId), { recursive: true })
  })

  afterEach(() => {
    closeDatabase()
    resetInstallationId()
    rmSync(tempDir, { recursive: true, force: true })
  })

  const LOCAL = () => operator(localId, 'Casey Operator')
  const PEER = operator(PEER_ID, 'Robin Peer')

  const memberAdd = (
    installationId: string,
    pem: string,
    code: string,
    name: string,
    role: 'owner' | 'member',
    by: ReturnType<typeof operator>
  ): Record<string, unknown> => ({
    type: 'member-add',
    caseId,
    memberInstallationId: installationId,
    memberPublicKeyPem: pem,
    memberCode: code,
    memberOperatorName: name,
    nodeId: `node-${installationId}`,
    role,
    timestamp: TIME,
    ...by,
    schemaVersion: 4
  })

  // One committed document: its bytes on disk, its row, and the chain entry
  // its author signed. `author` null is this installation, as in the app.
  function document(
    chain: Chain,
    by: ReturnType<typeof operator>,
    author: { installationId: string; memberCode: string } | null,
    exhibitNumber: number
  ): string {
    const exhibitId = `${by.operatorId}-doc-${exhibitNumber}`
    const path = `${caseId}/documents/${exhibitId}.pdf`
    const bytes = Buffer.from(`%PDF statement ${exhibitId}`)
    const contentHash = createHash('sha256').update(bytes).digest('hex')
    const abs = join(getStorageRoot(), path)
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, bytes)
    chain.append({
      type: 'exhibit',
      exhibitId,
      caseId,
      kind: 'document',
      origin: 'manual-upload',
      name: `statement-${exhibitNumber}.pdf`,
      exhibitNumber,
      path,
      contentHash,
      sizeBytes: bytes.length,
      timestamp: TIME,
      ...by,
      schemaVersion: 3
    })
    getDb()
      .prepare(
        `INSERT INTO exhibits (
           id, case_id, kind, origin, exhibit_number, name, content_hash, path,
           size_bytes, committed_at, manifest_seq, member_code, author_installation_id
         ) VALUES (?, ?, 'document', 'manual-upload', ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        exhibitId,
        caseId,
        exhibitNumber,
        `statement-${exhibitNumber}.pdf`,
        contentHash,
        path,
        bytes.length,
        TIME,
        chain.lines.length - 1,
        author?.memberCode ?? null,
        author?.installationId ?? null
      )
    return exhibitId
  }

  function roster(owner: string, ownerPem: string, member: string, memberPem: string): void {
    const base = { caseId, nodeId: 'node', revokedAtIndex: null }
    upsertCaseMember({
      ...base,
      installationId: owner,
      publicKeyPem: ownerPem,
      memberCode: 'CO',
      operatorName: 'Casey',
      role: 'owner',
      addedAtIndex: 0
    })
    upsertCaseMember({
      ...base,
      installationId: member,
      publicKeyPem: memberPem,
      memberCode: 'RP',
      operatorName: 'Robin',
      role: 'member',
      addedAtIndex: 1
    })
  }

  const caseDir = (id = caseId): string => join(getStorageRoot(), id)

  // This installation is the Owner; the peer is a member whose chain holds
  // one document, merged into the Owner's chain.
  function ownerReplica(
    extra: (owner: Chain, peerDoc: string) => void = () => {},
    peerExtra: (peer: Chain, peerDoc: string) => void = () => {}
  ) {
    const peer = new Chain(signWith(PEER_KEY))
    const peerDoc = document(peer, PEER, { installationId: PEER_ID, memberCode: 'RP' }, 1)
    peerExtra(peer, peerDoc)
    const owner = new Chain(signEntryHash)
    owner.append(memberAdd(localId, getPublicKeyPem(), 'CO', 'Casey', 'owner', LOCAL()))
    owner.append(memberAdd(PEER_ID, PEER_KEY.publicKey, 'RP', 'Robin', 'member', LOCAL()))
    const ownDoc = document(owner, LOCAL(), null, 1)
    owner.append({
      type: 'merge',
      caseId,
      heads: [{ ...peer.head(PEER_ID), entriesReceived: peer.lines.length }],
      timestamp: TIME,
      ...LOCAL(),
      schemaVersion: 4
    })
    extra(owner, peerDoc)
    writeFileSync(join(caseDir(), 'manifest.jsonl'), owner.jsonl)
    writeFileSync(join(caseDir(), memberChainPath(PEER_ID)), peer.jsonl)
    roster(localId, getPublicKeyPem(), PEER_ID, PEER_KEY.publicKey)
    return { owner, peer, peerDoc, ownDoc }
  }

  // This installation is a member; the peer is the Owner, whose chain holds
  // the roster and one document and which this installation merged.
  function memberReplica() {
    const owner = new Chain(signWith(PEER_KEY))
    owner.append(memberAdd(PEER_ID, PEER_KEY.publicKey, 'CO', 'Robin', 'owner', PEER))
    owner.append(memberAdd(localId, getPublicKeyPem(), 'RP', 'Casey', 'member', PEER))
    const ownerDoc = document(owner, PEER, { installationId: PEER_ID, memberCode: 'CO' }, 1)
    const local = new Chain(signEntryHash)
    const ownDoc = document(local, LOCAL(), null, 1)
    local.append({
      type: 'merge',
      caseId,
      heads: [{ ...owner.head(PEER_ID), entriesReceived: 3 }],
      timestamp: TIME,
      ...LOCAL(),
      schemaVersion: 4
    })
    writeFileSync(join(caseDir(), 'manifest.jsonl'), local.jsonl)
    writeFileSync(join(caseDir(), memberChainPath(PEER_ID)), owner.jsonl)
    roster(PEER_ID, PEER_KEY.publicKey, localId, getPublicKeyPem())
    return { owner, local, ownerDoc, ownDoc }
  }

  // An installation whose chain the Case's Owner continued by importing its
  // archive before the Case was shared: its document comes first, under its
  // own key, then the Owner's `import` naming that key.
  const EARLIER_KEY = keyPair()
  const EARLIER = operator('installation-earlier-0001', 'Zoe Earlier')

  // A chain whose first entry, the earlier document, the earlier installation
  // signed, and whose `import` on `sign` signs. `author` is the document row's,
  // as the replica holding the chain records it.
  function continuedChain(
    sign: (entryHash: string) => string,
    by: ReturnType<typeof operator>,
    author: { installationId: string; memberCode: string } | null,
    idMapSha256 = 'd'.repeat(64)
  ): { chain: Chain; earlierDoc: string } {
    let signed = 0
    const chain = new Chain((hash) => (signed++ === 0 ? signWith(EARLIER_KEY) : sign)(hash))
    const earlierDoc = document(chain, EARLIER, author, 2)
    chain.append(earlierImport(by, idMapSha256))
    return { chain, earlierDoc }
  }

  // The `import` that continued the earlier installation's chain.
  const earlierImport = (
    by: ReturnType<typeof operator>,
    idMapSha256: string
  ): Record<string, unknown> => ({
    type: 'import',
    caseId,
    sourceCaseId: 'earlier-case',
    sourceInstallationId: EARLIER.operatorId,
    sourcePublicKeyPem: EARLIER_KEY.publicKey,
    packageHash: 'c'.repeat(64),
    idMapSha256,
    verificationResult: {
      overallValid: true,
      chainValid: true,
      artifactCount: 0,
      artifactFailureCount: 0,
      captureCount: 0,
      captureHashFailureCount: 0
    },
    timestamp: TIME,
    ...by,
    schemaVersion: 2
  })

  // `ownerReplica`, with the Owner's chain continuing an earlier import.
  function ownerReplicaAfterImport() {
    const peer = new Chain(signWith(PEER_KEY))
    document(peer, PEER, { installationId: PEER_ID, memberCode: 'RP' }, 1)
    const { chain: owner, earlierDoc } = continuedChain(signEntryHash, LOCAL(), null)
    owner.append(memberAdd(localId, getPublicKeyPem(), 'CO', 'Casey', 'owner', LOCAL()))
    owner.append(memberAdd(PEER_ID, PEER_KEY.publicKey, 'RP', 'Robin', 'member', LOCAL()))
    document(owner, LOCAL(), null, 1)
    owner.append({
      type: 'merge',
      caseId,
      heads: [{ ...peer.head(PEER_ID), entriesReceived: peer.lines.length }],
      timestamp: TIME,
      ...LOCAL(),
      schemaVersion: 4
    })
    writeFileSync(join(caseDir(), 'manifest.jsonl'), owner.jsonl)
    writeFileSync(join(caseDir(), memberChainPath(PEER_ID)), peer.jsonl)
    roster(localId, getPublicKeyPem(), PEER_ID, PEER_KEY.publicKey)
    return { earlierDoc }
  }

  // `memberReplica`, with the Owner's chain continuing an earlier import.
  function memberReplicaAfterImport() {
    const { chain: owner, earlierDoc } = continuedChain(signWith(PEER_KEY), PEER, {
      installationId: PEER_ID,
      memberCode: 'CO'
    })
    owner.append(memberAdd(PEER_ID, PEER_KEY.publicKey, 'CO', 'Robin', 'owner', PEER))
    owner.append(memberAdd(localId, getPublicKeyPem(), 'RP', 'Casey', 'member', PEER))
    document(owner, PEER, { installationId: PEER_ID, memberCode: 'CO' }, 1)
    const local = new Chain(signEntryHash)
    document(local, LOCAL(), null, 1)
    local.append({
      type: 'merge',
      caseId,
      heads: [{ ...owner.head(PEER_ID), entriesReceived: owner.lines.length }],
      timestamp: TIME,
      ...LOCAL(),
      schemaVersion: 4
    })
    writeFileSync(join(caseDir(), 'manifest.jsonl'), local.jsonl)
    writeFileSync(join(caseDir(), memberChainPath(PEER_ID)), owner.jsonl)
    roster(PEER_ID, PEER_KEY.publicKey, localId, getPublicKeyPem())
    return { earlierDoc }
  }

  const options = (outputPath: string, captureIds?: string[]): ExportOptions => ({
    format: 'zip',
    include: {
      captures: true,
      screenshots: true,
      auditTrail: true,
      notes: false,
      annotations: 'none'
    },
    exportClass: 'evidence',
    outputPath,
    ...(captureIds ? { captureIds } : {})
  })

  // Exports the Case as an Evidence Package and unpacks it for the verifier.
  async function exportPackage(
    id = caseId,
    captureIds?: string[]
  ): Promise<{ dir: string; zip: Map<string, Buffer> }> {
    const out = join(tempDir, `${id}.zip`)
    await generateReport(id, options(out, captureIds), lifecycle)
    const zip = readStoredZip(readFileSync(out))
    const dir = join(tempDir, `${id}-unpacked`)
    for (const [name, bytes] of zip) {
      mkdirSync(dirname(join(dir, name)), { recursive: true })
      writeFileSync(join(dir, name), bytes)
    }
    return { dir, zip }
  }

  const failures = (dir: string) =>
    verifyEvidencePackage(dir).checks.filter((check) => check.status === 'fail')

  it('exports a two-member Case that the package verifier passes, merge heads included', async () => {
    const { peer, peerDoc, ownDoc } = ownerReplica()
    const { dir, zip } = await exportPackage()

    // The member's chain ships byte-for-byte beside the Owner's.
    expect(zip.get(memberChainPath(PEER_ID))?.toString('utf-8')).toBe(peer.jsonl)
    const result = verifyEvidencePackage(dir)
    expect(failures(dir)).toEqual([])
    expect(result.pass).toBe(true)
    expect(result.checks.find((c) => c.name === 'shared case')).toEqual({
      name: 'shared case',
      status: 'pass',
      reason: `manifest schema 4; 2 member(s): CO=${localId}, RP=${PEER_ID}`
    })

    // The remote Exhibit's bytes and index row ship with the local one's.
    const evidence = JSON.parse(zip.get('evidence.json')!.toString('utf-8'))
    expect(evidence.exhibits.map((row: { id: string }) => row.id).sort()).toEqual(
      [ownDoc, peerDoc].sort()
    )
    expect(evidence.sharedCase.members.map((m: { memberCode: string }) => m.memberCode)).toEqual([
      'CO',
      'RP'
    ])
    expect(evidence.sharedCase.manifestSchemaVersion).toBe(4)
  })

  it('does not claim an excluded Exhibit a selection export leaves out is enclosed', async () => {
    const { ownDoc } = ownerReplica((owner, doc) => {
      owner.append({
        type: 'exclude',
        caseId,
        exhibitId: doc,
        authorInstallationId: PEER_ID,
        timestamp: '2026-09-27T11:30:00.000Z',
        ...LOCAL(),
        schemaVersion: 4
      })
    })
    const { zip } = await exportPackage(caseId, [ownDoc])

    const evidence = JSON.parse(zip.get('evidence.json')!.toString('utf-8'))
    expect(evidence.exhibits.map((r: { id: string }) => r.id)).toEqual([ownDoc])
    expect(evidence.sharedCase.exclusions.map((e: { inExport: boolean }) => e.inExport)).toEqual([
      false
    ])
    const listed = "manifest entry #4 (outside this export's selection, not enclosed)"
    const report = zip.get('report.html')!.toString('utf-8')
    const certification = zip.get('certification.html')!.toString('utf-8')
    expect(report).toContain(listed)
    expect(report).toContain("Each one in this export's selection is still enclosed")
    expect(certification).toContain(listed)
    expect(certification).not.toContain('Exclusions (enclosed, not omitted)')
  })

  it("verifies another member's Exhibit against the chain its author signed", async () => {
    const { peerDoc, ownDoc } = ownerReplica()
    expect((await verifyExhibit(caseId, peerDoc)).status).toBe('verified')
    expect((await verifyExhibit(caseId, ownDoc)).status).toBe('verified')

    const [row] = listExhibits(caseId).filter((e) => e.id === peerDoc)
    writeFileSync(join(getStorageRoot(), row.path!), 'edited')
    expect((await verifyExhibit(caseId, peerDoc)).status).toBe('tampered')
  })

  it("verifies the Owner's Exhibit on a member's replica", async () => {
    const { ownerDoc, ownDoc } = memberReplica()
    expect((await verifyExhibit(caseId, ownerDoc)).status).toBe('verified')
    expect((await verifyExhibit(caseId, ownDoc)).status).toBe('verified')
  })

  it("verifies the Owner's Exhibit from before its earlier import on a member's replica", async () => {
    const { earlierDoc } = memberReplicaAfterImport()
    const v = await verifyExhibit(caseId, earlierDoc)
    expect([v.status, v.reason]).toEqual(['verified', undefined])
  })

  it("encloses another member's Derived File that its author's chain anchors", async () => {
    const thumbnail = Buffer.from('thumbnail bytes')
    const outputHash = createHash('sha256').update(thumbnail).digest('hex')
    const { peerDoc } = ownerReplica(undefined, (peer, doc) => {
      const [row] = listExhibits(caseId).filter((e) => e.id === doc)
      const path = `${caseId}/derived/${doc}.png`
      mkdirSync(dirname(join(getStorageRoot(), path)), { recursive: true })
      writeFileSync(join(getStorageRoot(), path), thumbnail)
      peer.append({
        type: 'derivation',
        caseId,
        parentExhibitId: doc,
        parentContentHash: row.contentHash,
        derivation: 'thumbnail',
        derivationToolVersion: '0.9.0',
        outputHash,
        outputPath: path,
        timestamp: TIME,
        ...PEER,
        schemaVersion: 3
      })
      getDb()
        .prepare(
          `INSERT INTO derived_files (id, exhibit_id, derivation, tool_version, content_hash,
             path, created_at, manifest_seq) VALUES (?, ?, 'thumbnail', '0.9.0', ?, ?, ?, ?)`
        )
        .run(`${doc}-thumb`, doc, outputHash, path, TIME, peer.lines.length - 1)
    })
    const derived = (await verifyCaseDerivedFiles(caseId)).get(peerDoc)
    expect(derived?.map((d) => d.status)).toEqual(['verified'])

    const { zip } = await exportPackage()
    const evidence = JSON.parse(zip.get('evidence.json')!.toString('utf-8'))
    const row = evidence.exhibits.find((r: { id: string }) => r.id === peerDoc)
    // Listed only because it is enclosed; an unanchored file is held back.
    expect(row.derivedFiles.map((d: { derivation: string }) => d.derivation)).toEqual(['thumbnail'])
    expect(zip.get(row.derivedFiles[0].path)).toEqual(thumbnail)
  })

  // #1813: a fork keeps another member's chain as lineage, and the Derived
  // File that chain anchors travels with it, restored under its signed name.
  it("restores another member's Derived File in a fork, anchored on its lineage chain", async () => {
    const thumbnail = Buffer.from('peer thumbnail bytes')
    const outputHash = createHash('sha256').update(thumbnail).digest('hex')
    let peerIndex = -1
    const { peerDoc } = ownerReplica(undefined, (peer, doc) => {
      const [row] = listExhibits(caseId).filter((e) => e.id === doc)
      const path = `${caseId}/derived/${doc}.png`
      mkdirSync(dirname(join(getStorageRoot(), path)), { recursive: true })
      writeFileSync(join(getStorageRoot(), path), thumbnail)
      peer.append({
        type: 'derivation',
        caseId,
        parentExhibitId: doc,
        parentContentHash: row.contentHash,
        derivation: 'thumbnail',
        derivationToolVersion: '0.9.0',
        outputHash,
        outputPath: path,
        timestamp: TIME,
        ...PEER,
        schemaVersion: 3
      })
      peerIndex = peer.lines.length - 1
      getDb()
        .prepare(
          `INSERT INTO derived_files (id, exhibit_id, derivation, tool_version, content_hash,
             path, created_at, manifest_seq) VALUES (?, ?, 'thumbnail', '0.9.0', ?, ?, ?, ?)`
        )
        .run(`${doc}-thumb`, doc, outputHash, path, TIME, peerIndex)
    })
    const out = join(tempDir, 'fork.birdbrain')
    await exportCaseArchive(caseId, out)
    expect(readStoredZip(readFileSync(out)).get(`files/derived/derived/${peerDoc}.png`)).toEqual(
      thumbnail
    )

    const { newCaseId } = await importCaseArchive(out)

    const forked = listExhibits(newCaseId).find((e) => e.authorInstallationId === PEER_ID)!
    expect(forked.id).not.toBe(peerDoc)
    const restored = getDb()
      .prepare('SELECT * FROM derived_files WHERE exhibit_id = ?')
      .all(forked.id) as Array<Record<string, unknown>>
    expect(restored).toEqual([
      expect.objectContaining({
        content_hash: outputHash,
        path: join(newCaseId, 'derived', `${peerDoc}.png`),
        manifest_seq: peerIndex
      })
    ])
    const derived = (await verifyCaseDerivedFiles(newCaseId)).get(forked.id)
    expect(derived?.map((d) => d.status)).toEqual(['verified'])

    const { dir, zip } = await exportPackage(newCaseId)
    const evidence = JSON.parse(zip.get('evidence.json')!.toString('utf-8'))
    const row = evidence.exhibits.find((r: { id: string }) => r.id === peerDoc)
    expect(row.derivedFiles.map((d: { path: string }) => d.path)).toEqual([
      `documents/${peerDoc}.png`
    ])
    expect(zip.get(`documents/${peerDoc}.png`)).toEqual(thumbnail)
    expect(failures(dir)).toEqual([])
    expect(verifyEvidencePackage(dir).pass).toBe(true)
  })

  it('fails the package when the member chain it merged is edited', async () => {
    ownerReplica()
    const { dir } = await exportPackage()
    const path = join(dir, memberChainPath(PEER_ID))
    writeFileSync(path, readFileSync(path, 'utf-8').replace('statement-1.pdf', 'statement-9.pdf'))
    expect(verifyEvidencePackage(dir).pass).toBe(false)
    expect(failures(dir).some((c) => c.name === 'shared case')).toBe(true)
  })

  it('lists an exclusion with the excluding Owner and time, and still verifies the bytes', async () => {
    const { peerDoc } = ownerReplica((owner, doc) => {
      owner.append({
        type: 'exclude',
        caseId,
        exhibitId: doc,
        authorInstallationId: PEER_ID,
        reason: 'outside the warrant',
        timestamp: '2026-09-27T11:30:00.000Z',
        ...LOCAL(),
        schemaVersion: 4
      })
    })
    const { dir, zip } = await exportPackage()

    expect(failures(dir)).toEqual([])
    // The excluded Exhibit is enclosed, and its bytes match the hash its
    // author's chain records.
    const evidence = JSON.parse(zip.get('evidence.json')!.toString('utf-8'))
    const row = evidence.exhibits.find((r: { id: string }) => r.id === peerDoc)
    expect(createHash('sha256').update(zip.get(row.path)!).digest('hex')).toBe(row.contentHash)
    expect(evidence.sharedCase.exclusions).toEqual([
      {
        exhibitId: peerDoc,
        citation: 'RP-1',
        authorInstallationId: PEER_ID,
        excludedBy: 'Casey Operator',
        excludedAt: '2026-09-27T11:30:00.000Z',
        manifestIndex: 4,
        reason: 'outside the warrant',
        sourceCaseId: null,
        inExport: true
      }
    ])
    const listed =
      'Exhibit RP-1 was excluded by Casey Operator (the Owner) at 2026-09-27T11:30:00Z, ' +
      'manifest entry #4: outside the warrant'
    expect(zip.get('certification.html')!.toString('utf-8')).toContain(listed)
    expect(zip.get('report.html')!.toString('utf-8')).toContain(listed)
    expect(
      verifyEvidencePackage(dir).checks.find((c) => c.name === `exhibit ${peerDoc} excluded`)
        ?.reason
    ).toContain('excluded by Casey Operator (the Owner) at 2026-09-27T11:30:00.000Z')
  })

  // #1657: a whole-case export from a fork whose ids the import renamed
  // encloses the excluded Exhibit, and its documents have to say so. The
  // exclusion names the Exhibit by the id its chain carries, not the new one.
  it('states an excluded Exhibit enclosed in a fork whose ids the import renamed', async () => {
    const { peerDoc } = ownerReplica((owner, doc) => {
      owner.append({
        type: 'exclude',
        caseId,
        exhibitId: doc,
        authorInstallationId: PEER_ID,
        timestamp: '2026-09-27T11:30:00.000Z',
        ...LOCAL(),
        schemaVersion: 4
      })
    })
    const out = join(tempDir, 'renamed-fork.birdbrain')
    await exportCaseArchive(caseId, out)
    // The source Case is still here, so the import renames every row it brings.
    const { newCaseId } = await importCaseArchive(out)
    expect(listExhibits(newCaseId).map((row) => row.id)).not.toContain(peerDoc)

    const { dir, zip } = await exportPackage(newCaseId)
    expect(failures(dir)).toEqual([])
    const evidence = JSON.parse(zip.get('evidence.json')!.toString('utf-8'))
    expect(
      evidence.sharedCase.exclusions.map((e: { exhibitId: string; inExport: boolean }) => [
        e.exhibitId,
        e.inExport
      ])
    ).toEqual([[peerDoc, true]])
    const report = zip.get('report.html')!.toString('utf-8')
    const certification = zip.get('certification.html')!.toString('utf-8')
    expect(report).not.toContain("(outside this export's selection, not enclosed)")
    expect(certification).not.toContain("(outside this export's selection, not enclosed)")
    expect(certification).toContain('Exclusions (enclosed, not omitted)')
  })

  it('carries every member chain and the roster in a Case Archive', async () => {
    const { owner } = memberReplica()
    const out = join(tempDir, 'shared.birdbrain')
    await exportCaseArchive(caseId, out)
    const entries = readStoredZip(readFileSync(out))
    expect(entries.get(memberChainPath(PEER_ID))?.toString('utf-8')).toBe(owner.jsonl)
    const data = JSON.parse(entries.get('data.json')!.toString('utf-8'))
    expect(data.caseMembers.map((m: { member_code: string }) => m.member_code)).toEqual([
      'CO',
      'RP'
    ])
    expect(inspectCaseArchive(out).verification.overallValid).toBe(true)
  })

  it('refuses a Case Archive whose Owner chain was edited', async () => {
    memberReplica()
    const out = join(tempDir, 'shared.birdbrain')
    await exportCaseArchive(caseId, out)
    const entries = readStoredZip(readFileSync(out))
    const name = memberChainPath(PEER_ID)
    const edited = entries.get(name)!.toString('utf-8').replace('"Robin"', '"Mallory"')
    const { createStoredZip } = await import('@main/services/zip')
    const header = JSON.parse(entries.get('package.json')!.toString('utf-8'))
    const bytes = Buffer.from(edited)
    // Re-hash the artifact so only the chain signature can catch the edit.
    header.artifacts = header.artifacts.map((a: { path: string }) =>
      a.path === name
        ? {
            path: name,
            sha256: createHash('sha256').update(bytes).digest('hex'),
            sizeBytes: bytes.length
          }
        : a
    )
    entries.set(name, bytes)
    entries.set('package.json', Buffer.from(JSON.stringify(header)))
    writeFileSync(out, createStoredZip([...entries].map(([n, data]) => ({ name: n, data }))))
    const { verification } = inspectCaseArchive(out)
    expect(verification.chainValid).toBe(false)
    expect(verification.chainReason).toMatch(/^chain-broken: /)
  })

  it('forks a non-Owner replica into a Case that continues the Owner chain and verifies', async () => {
    const { owner } = memberReplica()
    const out = join(tempDir, 'fork.birdbrain')
    await exportCaseArchive(caseId, out)
    const exportedLocal = readStoredZip(readFileSync(out)).get('manifest.jsonl')!

    const { newCaseId } = await importCaseArchive(out)
    const forkDir = caseDir(newCaseId)
    const lines = readFileSync(join(forkDir, 'manifest.jsonl'), 'utf-8').trim().split('\n')

    // The Owner's chain, byte-for-byte, then the import naming the Owner.
    expect(lines.slice(0, owner.lines.length)).toEqual(owner.lines)
    expect(lines).toHaveLength(owner.lines.length + 1)
    const importEntry = JSON.parse(lines.at(-1)!)
    expect(importEntry).toMatchObject({
      type: 'import',
      caseId: newCaseId,
      sourceCaseId: caseId,
      sourceInstallationId: PEER_ID,
      sourcePublicKeyPem: PEER_KEY.publicKey,
      operatorId: localId
    })
    // The forking member's own chain travels as lineage, as it was exported.
    expect(readFileSync(join(forkDir, lineageChainPath(caseId, localId)))).toEqual(exportedLocal)

    const verification = readSharedCaseSnapshot(
      forkDir,
      readManifestSnapshot(forkDir)
    ).verification!
    expect(verification.findings).toEqual([])
    expect(verification.members).toEqual([])
    expect(
      verification.lineage.map((l) => [l.sourceCaseId, l.members.map((m) => m.memberCode)])
    ).toEqual([[caseId, ['CO', 'RP']]])

    // One member, and the source Exhibits keep their authors and codes.
    expect(listCaseMembers(newCaseId)).toEqual([])
    expect(getCase(newCaseId)?.ownerInstallationId).toBeUndefined()
    // Each source Exhibit verifies against its author's chain: the Owner's is
    // the fork's own history, the forking member's is lineage.
    for (const exhibit of listExhibits(newCaseId)) {
      const v = await verifyExhibit(newCaseId, exhibit.id)
      expect([exhibit.authorInstallationId, exhibit.id, v.status, v.reason]).toEqual([
        exhibit.authorInstallationId,
        exhibit.id,
        'verified',
        undefined
      ])
    }
    const cite = exhibitCitationResolver(newCaseId, 'app')
    expect(
      listExhibits(newCaseId)
        .map((e) => [e.authorInstallationId, cite(e)])
        .sort()
    ).toEqual(
      [
        [localId, 'RP-1'],
        [PEER_ID, 'CO-1']
      ].sort()
    )
  })

  // Ruling 62 of 2026-10-10 (#1909): an investigation record with no author was
  // the exporter's own, and a fork stamps it with the installation it stamps
  // on the exporter's own Exhibits.
  it("stamps a fork's author-less investigation records as the exporter's Exhibits", async () => {
    const { ownDoc } = memberReplica()
    const flag = insertWithheldFlag({
      caseId,
      exhibitId: ownDoc,
      action: 'set',
      actedAt: TIME,
      operatorId: localId,
      operatorName: 'Casey Operator'
    })
    expect(flag.authorInstallationId).toBeNull()
    const out = join(tempDir, 'fork.birdbrain')
    await exportCaseArchive(caseId, out)

    const { newCaseId } = await importCaseArchive(out)

    const exporterOwn = listExhibits(newCaseId).find((exhibit) => exhibit.memberCode === 'RP')
    const [imported] = listWithheldFlags(newCaseId)
    expect(exporterOwn?.authorInstallationId).toBe(localId)
    expect(imported.authorInstallationId).toBe(exporterOwn?.authorInstallationId)
  })

  it("stamps a fork's records with the exporter its verified roster names, whatever the header says", async () => {
    const { ownDoc } = memberReplica()
    insertWithheldFlag({
      caseId,
      exhibitId: ownDoc,
      action: 'set',
      actedAt: TIME,
      operatorId: localId,
      operatorName: 'Casey Operator'
    })
    const out = join(tempDir, 'fork.birdbrain')
    await exportCaseArchive(caseId, out)
    // `package.json` is unsigned, so this edit passes verification.
    await rewriteArchive(out, (_, header) => {
      header.source.installationId = 'installation-forged'
    })
    expect(inspectCaseArchive(out).verification.overallValid).toBe(true)

    const { newCaseId } = await importCaseArchive(out)

    const [imported] = listWithheldFlags(newCaseId)
    expect(imported.authorInstallationId).toBe(localId)
  })

  it("renumbers none of a fork's member-authored Exhibits and numbers its own from 1", async () => {
    memberReplica()
    const out = join(tempDir, 'fork.birdbrain')
    await exportCaseArchive(caseId, out)
    const { newCaseId } = await importCaseArchive(out)
    const manifestPath = join(caseDir(newCaseId), 'manifest.jsonl')
    const imported = readFileSync(manifestPath, 'utf-8')

    // The import stamps every source row with its member author. The forking
    // member's own row is anchored in its lineage chain, and its index names
    // an unnumbered `member-add` in this one: a `renumber` listing it would
    // sign another chain's number into the fork's.
    expect(
      listExhibits(newCaseId)
        .map((e) => e.authorInstallationId)
        .sort()
    ).toEqual([localId, PEER_ID].sort())
    const result = await backfillCase(newCaseId, { toolVersion: '0.9.0' })

    expect(result.renumbered).toBe(false)
    expect(readFileSync(manifestPath, 'utf-8')).toBe(imported)
    expect(nextExhibitNumber(newCaseId)).toBe(1)
  })

  it('imports a Case Archive whose member chain gives one number to two Exhibits (X48)', async () => {
    // A number issued twice in one chain is an Integrity Exception, not a
    // failed walk, so the archive check no longer refuses the import.
    ownerReplica(
      () => {},
      (peer) => {
        peer.append({
          type: 'exhibit',
          exhibitId: `${PEER_ID}-other`,
          caseId,
          kind: 'document',
          origin: 'manual-upload',
          name: 'other.pdf',
          exhibitNumber: 1,
          path: `${caseId}/documents/${PEER_ID}-other.pdf`,
          contentHash: 'e'.repeat(64),
          sizeBytes: 1,
          timestamp: TIME,
          ...PEER,
          schemaVersion: 3
        })
      }
    )
    const out = join(tempDir, 'repeated.birdbrain')
    await exportCaseArchive(caseId, out)

    const { verification } = inspectCaseArchive(out)
    expect(verification.chainValid).toBe(true)
    expect(verification.overallValid).toBe(true)
    await expect(importCaseArchive(out)).resolves.toMatchObject({ newCaseId: expect.any(String) })
  })

  // Rewrites an archive's entries and header in place. `package.json` is not
  // among its own artifacts, so a header edit alone leaves every hash intact.
  async function rewriteArchive(
    out: string,
    edit: (entries: Map<string, Buffer>, header: Record<string, any>) => void // eslint-disable-line @typescript-eslint/no-explicit-any -- the header is edited as raw JSON
  ): Promise<void> {
    const { createStoredZip } = await import('@main/services/zip')
    const entries = readStoredZip(readFileSync(out))
    const header = JSON.parse(entries.get('package.json')!.toString('utf-8'))
    edit(entries, header)
    entries.set('package.json', Buffer.from(JSON.stringify(header)))
    writeFileSync(out, createStoredZip([...entries].map(([name, data]) => ({ name, data }))))
  }

  // A forged fork (#1017). The exporting member holds the Owner's key too. The
  // Owner's chain holds one import, whose carried map renames the earlier
  // document onto an id no entry signs while data.json keeps the document's
  // row. The exporter's chain repeats that import and adds one with no map, so
  // read against that chain the set would look partial and skip the rows
  // check, while the fork composes the map over the Owner's chain.
  it("checks a fork's carried id maps against the Owner chain the fork continues (#1017)", async () => {
    const earlierDocId = `${EARLIER.operatorId}-doc-2`
    const map = canonicalStringify({
      sourceCaseId: 'earlier-case',
      caseId,
      remapped: { [earlierDocId]: 'planted-row' }
    })
    const digest = createHash('sha256').update(map).digest('hex')
    const { chain: owner } = continuedChain(
      signWith(PEER_KEY),
      PEER,
      { installationId: PEER_ID, memberCode: 'CO' },
      digest
    )
    owner.append(memberAdd(PEER_ID, PEER_KEY.publicKey, 'CO', 'Robin', 'owner', PEER))
    owner.append(memberAdd(localId, getPublicKeyPem(), 'RP', 'Casey', 'member', PEER))
    let signed = 0
    const local = new Chain((hash) =>
      (signed++ === 0 ? signWith(EARLIER_KEY) : signEntryHash)(hash)
    )
    local.append(earlierImport(PEER, digest))
    local.append(earlierImport(LOCAL(), 'e'.repeat(64)))
    document(local, LOCAL(), null, 1)
    local.append({
      type: 'merge',
      caseId,
      heads: [{ ...owner.head(PEER_ID), entriesReceived: owner.lines.length }],
      timestamp: TIME,
      ...LOCAL(),
      schemaVersion: 4
    })
    writeFileSync(join(caseDir(), 'manifest.jsonl'), local.jsonl)
    writeFileSync(join(caseDir(), memberChainPath(PEER_ID)), owner.jsonl)
    roster(PEER_ID, PEER_KEY.publicKey, localId, getPublicKeyPem())
    const out = join(tempDir, 'fork.birdbrain')
    await exportCaseArchive(caseId, out)
    const name = `import-id-maps/${digest}.json`
    rewriteRepairedArchive(out, (entries) => {
      entries.set(name, Buffer.from(map))
    })

    const { verification } = inspectCaseArchive(out)

    expect(verification).toMatchObject({
      chainValid: true,
      overallValid: false,
      artifactFailureCount: 1
    })
    const { newCaseId } = await importCaseArchive(out, { overrideTamper: true })
    expect(existsSync(join(caseDir(newCaseId), name))).toBe(false)
  })

  // The binding's side of the test above (#1017). The Owner's carried map
  // renames the earlier document onto the exporting member's document, whose
  // id only that member's chain signs, a lineage chain once forked. Refused
  // at import, the map is then written into the new Case by hand.
  // The walk drops a missing or broken chain from the entries it accepts, so
  // the one chain that signs the target id going away must not let it bind.
  it.each([
    ['', (): void => {}],
    [' after its lineage chain is deleted', (path: string): void => rmSync(path)],
    [
      ' after its lineage chain is corrupted',
      (path: string): void => {
        const bytes = readFileSync(path)
        bytes[40] ^= 1
        writeFileSync(path, bytes)
      }
    ]
  ])(
    "binds nothing through a fork's planted map that renames onto a lineage chain's signed id%s",
    async (_, tamper) => {
      const earlierDocId = `${EARLIER.operatorId}-doc-2`
      const localDocId = `${localId}-doc-1`
      const map = canonicalStringify({
        sourceCaseId: 'earlier-case',
        caseId,
        remapped: { [earlierDocId]: localDocId }
      })
      const digest = createHash('sha256').update(map).digest('hex')
      const { chain: owner } = continuedChain(
        signWith(PEER_KEY),
        PEER,
        { installationId: PEER_ID, memberCode: 'CO' },
        digest
      )
      owner.append(memberAdd(PEER_ID, PEER_KEY.publicKey, 'CO', 'Robin', 'owner', PEER))
      owner.append(memberAdd(localId, getPublicKeyPem(), 'RP', 'Casey', 'member', PEER))
      const local = new Chain(signEntryHash)
      document(local, LOCAL(), null, 1)
      local.append({
        type: 'merge',
        caseId,
        heads: [{ ...owner.head(PEER_ID), entriesReceived: owner.lines.length }],
        timestamp: TIME,
        ...LOCAL(),
        schemaVersion: 4
      })
      writeFileSync(join(caseDir(), 'manifest.jsonl'), local.jsonl)
      writeFileSync(join(caseDir(), memberChainPath(PEER_ID)), owner.jsonl)
      roster(PEER_ID, PEER_KEY.publicKey, localId, getPublicKeyPem())
      getDb().prepare('DELETE FROM exhibits WHERE id = ?').run(earlierDocId)
      const out = join(tempDir, 'fork.birdbrain')
      await exportCaseArchive(caseId, out)
      const name = `import-id-maps/${digest}.json`
      rewriteRepairedArchive(out, (entries) => {
        entries.set(name, Buffer.from(map))
      })
      expect(inspectCaseArchive(out).verification.overallValid).toBe(false)
      const { newCaseId } = await importCaseArchive(out, { overrideTamper: true })
      expect(existsSync(join(caseDir(newCaseId), name))).toBe(false)
      mkdirSync(dirname(join(caseDir(newCaseId), name)))
      writeFileSync(join(caseDir(newCaseId), name), map)
      tamper(join(caseDir(newCaseId), lineageChainPath(caseId, localId)))

      const row = listExhibits(newCaseId).find(({ name }) => name === 'statement-1.pdf')!
      const own = readCaseChains(caseDir(newCaseId)).own
      expect(own.imports.map(({ idMapSha256 }) => idMapSha256)[0]).toBe(digest)
      expect(own.entries.some((entry) => entry.exhibitId === localDocId)).toBe(false)

      const earlier = { caseId, rowId: earlierDocId }
      expect(entryDescribesRow(earlier, row, own, caseDir(newCaseId))).toBe(false)
    }
  )

  it("names the source Case its Owner's roster states, whatever the header says", async () => {
    memberReplica()
    const out = join(tempDir, 'fork.birdbrain')
    await exportCaseArchive(caseId, out)
    await rewriteArchive(out, (_, header) => {
      header.case.id = '../../outside'
    })
    expect(inspectCaseArchive(out).verification.overallValid).toBe(true)

    const { newCaseId } = await importCaseArchive(out)
    const forkDir = caseDir(newCaseId)
    const lines = readFileSync(join(forkDir, 'manifest.jsonl'), 'utf-8').trim().split('\n')
    expect(JSON.parse(lines.at(-1)!).sourceCaseId).toBe(caseId)
    expect(readFileSync(join(forkDir, lineageChainPath(caseId, localId))).length).toBeGreaterThan(0)
    // `lineage/../../outside` under the staging directory is the storage root's.
    expect(existsSync(join(getStorageRoot(), 'outside'))).toBe(false)
  })

  it('refuses a lineage path an archive header would climb out of', async () => {
    // A chain no roster names is kept as lineage under the header's Case id.
    const stray = new Chain(signWith(PEER_KEY))
    document(stray, PEER, null, 1)
    const own = new Chain(signEntryHash)
    document(own, LOCAL(), null, 2)
    writeFileSync(join(caseDir(), 'manifest.jsonl'), own.jsonl)
    writeFileSync(join(caseDir(), memberChainPath(PEER_ID)), stray.jsonl)
    const out = join(tempDir, 'stray.birdbrain')
    await exportCaseArchive(caseId, out)
    await rewriteArchive(out, (_, header) => {
      header.case.id = '../../outside'
    })

    await expect(importCaseArchive(out, { overrideTamper: true })).rejects.toThrow(
      'malformed source Case id'
    )
    // `lineage/../../outside` under the staging directory is the storage root's.
    expect(existsSync(join(getStorageRoot(), 'outside'))).toBe(false)
  })

  it.skipIf(!HAS_JQ)(
    "passes the package runbook's merge heads on a fork of the Owner's replica",
    async () => {
      ownerReplica()
      const out = join(tempDir, 'fork.birdbrain')
      await exportCaseArchive(caseId, out)
      deleteCase(caseId)
      const { newCaseId } = await importCaseArchive(out)

      const { dir, zip } = await exportPackage(newCaseId)
      expect(failures(dir)).toEqual([])
      // The blocks of the VERIFY.md this package ships, run the way a reader
      // runs them: the history merge names the member's lineage chain.
      const blocks = extractRunbookBlocks(zip.get('VERIFY.md')!.toString('utf-8')).filter((b) =>
        b.section.startsWith('Shared Case packages')
      )
      const run = runRunbookBlocks(blocks, { cwd: dir })
      expect([run.failedBlock, run.stderr]).toEqual([null, ''])
      expect(run.stdout.split('\n').filter((l) => l.startsWith('head '))).toEqual([
        `head OK: ${PEER_ID} #0`
      ])
    }
  )

  it("verifies an Exhibit from before the Owner's earlier import after the Owner forks", async () => {
    const { earlierDoc } = ownerReplicaAfterImport()
    expect((await verifyExhibit(caseId, earlierDoc)).status).toBe('verified')
    const out = join(tempDir, 'fork.birdbrain')
    await exportCaseArchive(caseId, out)
    deleteCase(caseId)
    const { newCaseId } = await importCaseArchive(out)

    // The row keeps the Owner as its author, the installation whose chain
    // held the entry when the Case was forked.
    const row = listExhibits(newCaseId).find((e) => e.id === earlierDoc)
    expect(row?.authorInstallationId).toBe(localId)
    for (const exhibit of listExhibits(newCaseId)) {
      const v = await verifyExhibit(newCaseId, exhibit.id)
      expect([exhibit.id, v.status, v.reason]).toEqual([exhibit.id, 'verified', undefined])
    }
    const { dir } = await exportPackage(newCaseId)
    expect(failures(dir)).toEqual([])

    // A member that neither wrote the entry nor continued the chain holding
    // it is not its author.
    getDb()
      .prepare('UPDATE exhibits SET author_installation_id = ? WHERE id = ?')
      .run(PEER_ID, earlierDoc)
    expect((await verifyExhibit(newCaseId, earlierDoc)).status).toBe('chain-broken')
  })

  // #1638: a fork's `import` follows the source Owner's `member-add` entries,
  // and custody stops there. These forks run on one installation, so the
  // forking member is also the installation that imports the fork again.
  async function forkOf(id: string): Promise<string> {
    const out = join(tempDir, `${id}.birdbrain`)
    await exportCaseArchive(id, out)
    // With the source gone the import keeps every row id.
    deleteCase(id)
    return (await importCaseArchive(out)).newCaseId
  }

  const relabel = (exhibitId: string, author: string): void => {
    getDb()
      .prepare('UPDATE exhibits SET author_installation_id = ? WHERE id = ?')
      .run(author, exhibitId)
  }

  // The forking member's own row and the Owner's both carry Exhibit Number 1,
  // which one author holds once. Verifying an Exhibit reads no number.
  const renumber = (exhibitId: string): void => {
    getDb().prepare('UPDATE exhibits SET exhibit_number = 9 WHERE id = ?').run(exhibitId)
  }

  const verdict = async (id: string, exhibitId: string): Promise<[string, string | undefined]> => {
    const { status, reason } = await verifyExhibit(id, exhibitId)
    return [status, reason]
  }

  it("fails the source Owner's Exhibit relabelled to the forking member after a fork", async () => {
    const { owner, ownerDoc, ownDoc } = memberReplica()
    const newCaseId = await forkOf(caseId)
    const index = owner.lines.length - 1
    expect(await verdict(newCaseId, ownerDoc)).toEqual(['verified', undefined])

    renumber(ownDoc)
    relabel(ownerDoc, localId)
    expect(await verdict(newCaseId, ownerDoc)).toEqual([
      'chain-broken',
      `no verified chain of ${localId} holds entry ${index} for these bytes`
    ])
    relabel(ownerDoc, 'installation-unknown-0001')
    expect(await verdict(newCaseId, ownerDoc)).toEqual([
      'chain-broken',
      `no verified chain of installation-unknown-0001 holds entry ${index} for these bytes`
    ])
  })

  it("fails the source Owner's Exhibit relabelled to the importer after an ordinary import of a fork", async () => {
    const { owner, ownerDoc, ownDoc } = memberReplica()
    const reimported = await forkOf(await forkOf(caseId))
    expect(await verdict(reimported, ownerDoc)).toEqual(['verified', undefined])

    // Only the Owner's row: the forking member's own reads chain-broken here
    // before any relabel (#1836).
    renumber(ownDoc)
    relabel(ownerDoc, localId)
    expect(await verdict(reimported, ownerDoc)).toEqual([
      'chain-broken',
      `no verified chain of ${localId} holds entry ${owner.lines.length - 1} for these bytes`
    ])
  })

  it("keeps the Owner's pre-share import with the Owner in a member's fork, and fails it under the forking member", async () => {
    const { earlierDoc } = memberReplicaAfterImport()
    const newCaseId = await forkOf(caseId)
    const row = listExhibits(newCaseId).find((e) => e.id === earlierDoc)
    expect(row?.authorInstallationId).toBe(PEER_ID)
    expect(await verdict(newCaseId, earlierDoc)).toEqual(['verified', undefined])

    relabel(earlierDoc, localId)
    expect(await verdict(newCaseId, earlierDoc)).toEqual([
      'chain-broken',
      `no verified chain of ${localId} holds entry 0 for these bytes`
    ])
  })

  it('exports a fork as an Evidence Package that the package verifier passes', async () => {
    memberReplica()
    const out = join(tempDir, 'fork.birdbrain')
    await exportCaseArchive(caseId, out)
    // The source Case is gone, as it is on another machine or after Owner
    // loss; with it here, import would rename every colliding row id.
    deleteCase(caseId)
    const { newCaseId } = await importCaseArchive(out)

    const { dir, zip } = await exportPackage(newCaseId)
    expect(zip.has(lineageChainPath(caseId, localId))).toBe(true)
    expect(failures(dir)).toEqual([])
    expect(verifyEvidencePackage(dir).checks.find((c) => c.name === 'shared case')?.reason).toBe(
      `manifest schema 4; 0 member(s); forked from Case ${caseId}, ` +
        `2 member(s): CO=${PEER_ID}, RP=${localId}`
    )
  })

  // #1657: the fork's history before its `import` is the source Owner's, signed
  // with the Owner's key, so verify.sh has to check it under the key the
  // `import` carries, as the package verifier above does.
  it.skipIf(!HAS_OPENSSL || !HAS_JQ)('exports a fork whose verify.sh passes', async () => {
    const { owner } = memberReplica()
    const out = join(tempDir, 'fork.birdbrain')
    await exportCaseArchive(caseId, out)
    deleteCase(caseId)
    const { newCaseId } = await importCaseArchive(out)

    const { dir } = await exportPackage(newCaseId)
    const run = runVerifyScript(dir)
    expect(run.status, run.output).toBe(0)
    const last = owner.lines.length - 1
    const fingerprint = createHash('sha256').update(PEER_KEY.publicKey).digest('hex')
    expect(run.output).toContain(
      `entries 0 to ${last}: ${owner.lines.length} signed entr(ies) verified under the key ` +
        `import entry ${last + 1} carries (SHA-256 ${fingerprint})`
    )
  })

  // Receipt stamps (#1515, design decision 15): verify.sh and VERIFY.md check
  // the receipt token decoded from its signed line, over the merge entry's
  // Entry Hash, against the enclosed anchor. The token comes from a local TSA
  // so the anchor is the root it chains to (see helpers/localTsa.ts).
  describe('receipt stamps (#1515)', () => {
    const RUNS = HAS_OPENSSL && HAS_JQ
    let tsa: LocalTsa | null = null
    let otherTsa: LocalTsa | null = null

    beforeAll(() => {
      if (!RUNS) return
      tsa = createLocalTsa()
      otherTsa = createLocalTsa()
      localRoot.pem = tsa.rootPem
    })

    afterAll(() => {
      tsa?.dispose()
      otherTsa?.dispose()
      localRoot.pem = ''
    })

    // A receipt stamp over `hash`: `token` null leaves the entry tokenless.
    const receiptStamp = (hash: string, token: Buffer | null, by: ReturnType<typeof operator>) => ({
      type: 'timestamp',
      caseId,
      captureContentHash: hash,
      subject: 'entry',
      timestamp: TIME,
      ...(token === null ? {} : { tsaToken: token.toString('base64') }),
      ...by,
      schemaVersion: 4
    })

    // The Owner's replica with a receipt stamp at index 4, issued by `issuer`
    // over its merge (index 3), or over `over` when given.
    function receiptReplica(
      issuer: () => LocalTsa,
      { over, tokenless = false }: { over?: string; tokenless?: boolean } = {}
    ) {
      let receiptToken: Buffer = Buffer.alloc(0)
      const replica = ownerReplica((owner) => {
        const hash = over ?? owner.hashes[owner.hashes.length - 1]
        receiptToken = issuer().issueToken(hash)
        owner.append(receiptStamp(hash, tokenless ? null : receiptToken, LOCAL()))
      })
      return { ...replica, receiptToken }
    }

    // The member's chain continued past the head the Owner merged: a merge
    // (index 1) naming the Owner's document, and a receipt stamp (index 2)
    // over `hashOf` that merge, or over `over` when given.
    function peerReceipt(replica: ReturnType<typeof ownerReplica>, over?: string) {
      const { owner, peer } = replica
      peer.append({
        type: 'merge',
        caseId,
        heads: [
          { installationId: localId, index: 2, entryHash: owner.hashes[2], entriesReceived: 3 }
        ],
        timestamp: TIME,
        ...PEER,
        schemaVersion: 4
      })
      const hash = over ?? peer.hashes[1]
      peer.append(receiptStamp(hash, tsa!.issueToken(hash), PEER))
      writeFileSync(join(caseDir(), memberChainPath(PEER_ID)), peer.jsonl)
      return replica
    }

    const peerChain = memberChainPath(PEER_ID)

    // The package with its enclosed anchor removed, from the index too, as an
    // export under a non-default authority leaves it.
    function withoutAnchor(dir: string): void {
      rmSync(join(dir, 'tsa-root.pem'), { force: true })
      const path = join(dir, 'evidence.json')
      const index = JSON.parse(readFileSync(path, 'utf-8')) as {
        artifacts: Array<{ path: string }>
      }
      index.artifacts = index.artifacts.filter((a) => a.path !== 'tsa-root.pem')
      writeFileSync(path, JSON.stringify(index))
    }

    const receiptBlocks = (zip: Map<string, Buffer>) =>
      extractRunbookBlocks(zip.get('VERIFY.md')!.toString('utf-8')).filter(
        (b) =>
          b.section.startsWith('Step 6') &&
          b.placeholders.length === 0 &&
          b.code.includes('receipt')
      )

    it.skipIf(!RUNS)('verify.sh verifies the receipt token over the merge Entry Hash', async () => {
      const { owner } = receiptReplica(() => tsa!)
      const { dir, zip } = await exportPackage()
      expect(failures(dir)).toEqual([])

      const run = runVerifyScript(dir)
      expect(run.status, run.output).toBe(0)
      expect(run.output).toContain(
        `merge entry 3: receipt timestamp entry 4 verifies to tsa-root.pem over the Entry Hash ${owner.hashes[3]}`
      )
      // The chain carries no content token: the script says so without
      // saying it carries no token at all.
      expect(run.output).not.toContain('the signed manifest carries no RFC 3161 token')
      expect(run.output).not.toContain(
        'RFC 3161 token, so this package makes no trusted-time claim'
      )
      expect(run.output).toContain("RFC 3161 token over any Exhibit's content")
      expect(run.output).toContain('1 of its 1 receipt token(s) over merge entries')

      const blocks = receiptBlocks(zip)
      expect(blocks).toHaveLength(1)
      const runbook = runRunbookBlocks(blocks, { cwd: dir })
      expect([runbook.failedBlock, runbook.stderr]).toEqual([null, ''])
      expect(runbook.stdout.trim()).toBe('receipt OK: merge #3 of manifest.jsonl')
    })

    it.skipIf(!RUNS)("verifies a member chain's receipt over that chain's own merge", async () => {
      const { peer } = peerReceipt(receiptReplica(() => tsa!))
      const { dir, zip } = await exportPackage()
      expect(failures(dir)).toEqual([])

      const run = runVerifyScript(dir)
      expect(run.status, run.output).toBe(0)
      expect(run.output).toContain(
        `merge entry 1 of ${PEER_ID}: receipt timestamp entry 2 verifies to tsa-root.pem over ` +
          `the Entry Hash ${peer.hashes[1]}`
      )
      expect(run.output).toContain('2 of its 2 receipt token(s) over merge entries')
      const runbook = runRunbookBlocks(receiptBlocks(zip), { cwd: dir })
      expect(runbook.stdout.trim().split('\n')).toEqual([
        'receipt OK: merge #3 of manifest.jsonl',
        `receipt OK: merge #1 of ${peerChain}`
      ])
    })

    // The package's chains are read together for the content tokens, so a
    // receipt must not find its merge in another member's chain: the Owner's
    // merge hash in the member's receipt names nothing in the member's chain.
    it.skipIf(!RUNS)('matches a receipt only to a merge of its own chain', async () => {
      const replica = ownerReplica()
      const { owner } = peerReceipt(replica, replica.owner.hashes[3])
      const { dir, zip } = await exportPackage()
      expect(failures(dir)).toEqual([])
      expect(
        verifyEvidencePackage(dir).checks.filter((check) => check.name.includes('receipt'))
      ).toMatchObject([{ name: `receipt timestamp 2 in the chain of ${PEER_ID}`, status: 'skip' }])

      const run = runVerifyScript(dir)
      expect(run.status, run.output).toBe(0)
      expect(run.output).toContain(
        `receipt timestamp entry 2 of ${PEER_ID} names no merge entry in its chain (hash ` +
          `${owner.hashes[3]}), so nothing states what it attests`
      )
      expect(run.output).not.toContain('merge entry 3')
      const runbook = runRunbookBlocks(receiptBlocks(zip), { cwd: dir })
      expect(runbook.stdout.trim()).toBe(`RECEIPT NAMES NO MERGE: entry 2 of ${peerChain}`)
    })

    it.skipIf(!RUNS)('notes a receipt stamp naming no merge entry of its chain', async () => {
      const over = 'f'.repeat(64)
      receiptReplica(() => tsa!, { over })
      const { dir, zip } = await exportPackage()

      const run = runVerifyScript(dir)
      expect(run.status, run.output).toBe(0)
      expect(run.output).toContain(
        `receipt timestamp entry 4 names no merge entry in its chain (hash ${over}), so ` +
          'nothing states what it attests'
      )
      expect(run.output).not.toContain('receipt token(s) over merge entries')
      const runbook = runRunbookBlocks(receiptBlocks(zip), { cwd: dir })
      expect(runbook.stdout.trim()).toBe('RECEIPT NAMES NO MERGE: entry 4 of manifest.jsonl')
    })

    it.skipIf(!RUNS)('fails a receipt stamp that names a merge and carries no token', async () => {
      receiptReplica(() => tsa!, { tokenless: true })
      const { dir } = await exportPackage()
      expect(failures(dir).map((check) => [check.name, check.reason])).toEqual([
        [
          'merge 3 receipt timestamp',
          'the receipt timestamp entry at index 4 names merge entry 3 but carries no token'
        ]
      ])

      const run = runVerifyScript(dir)
      expect(run.status, run.output).toBe(1)
      expect(run.output).toContain(
        'FAIL [step 6] merge entry 3: its receipt timestamp entry 4 carries no token'
      )
    })

    it.skipIf(!RUNS)(
      'counts the receipt among the tokens left unverified without an anchor',
      async () => {
        receiptReplica(() => tsa!)
        const { dir } = await exportPackage()
        withoutAnchor(dir)

        const run = runVerifyScript(dir)
        expect(run.status, run.output).toBe(3)
        expect(run.output).toContain(
          'INCOMPLETE [step 6] 1 signed token(s) were not verified: no anchor is enclosed for ' +
            'this script to name'
        )
        expect(run.output).not.toContain('merge entry 3: receipt timestamp entry 4 verifies')
      }
    )

    it.skipIf(!RUNS)('fails a receipt token from another authority, naming the merge', async () => {
      receiptReplica(() => otherTsa!)
      const { dir, zip } = await exportPackage()
      // Structurally sound: the binary's check is the imprint, not the signer.
      expect(failures(dir)).toEqual([])

      const run = runVerifyScript(dir)
      expect(run.status, run.output).toBe(1)
      expect(run.output).toContain(
        'FAIL [step 6] merge entry 3: receipt timestamp entry 4 does not verify to tsa-root.pem'
      )
      const runbook = runRunbookBlocks(receiptBlocks(zip), { cwd: dir })
      expect(runbook.stdout.trim()).toBe('RECEIPT FAIL: merge #3 of manifest.jsonl')
    })

    it.skipIf(!RUNS)(
      'encloses the certificates the receipt token embeds in tsa-intermediates.pem',
      async () => {
        const { receiptToken } = receiptReplica(() => tsa!)
        const { zip } = await exportPackage()
        const intermediates = zip.get('tsa-intermediates.pem')!.toString('utf-8')
        const blocks = extractTimestampTokenCertificatesPem(receiptToken).match(
          /-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g
        )!
        expect(blocks.length).toBeGreaterThan(0)
        for (const block of blocks) expect(intermediates).toContain(block)
      }
    )
  })

  // #1864: verify.sh checks every member chain a Shared Case package carries,
  // and reaches the verdict the package verifier above reaches.
  describe.skipIf(!HAS_OPENSSL || !HAS_JQ)('verify.sh over the member chains (#1864)', () => {
    const peerFingerprint = createHash('sha256').update(PEER_KEY.publicKey).digest('hex')
    const peerChain = memberChainPath(PEER_ID)

    // Restates one file's hash in the unsigned index, so that only a check
    // against a signed chain can catch the edit.
    function reindex(dir: string, path: string): void {
      const indexPath = join(dir, 'evidence.json')
      const index = JSON.parse(readFileSync(indexPath, 'utf-8'))
      const sha256 = createHash('sha256')
        .update(readFileSync(join(dir, path)))
        .digest('hex')
      index.artifacts = index.artifacts.map((a: { path: string }) =>
        a.path === path ? { ...a, sha256 } : a
      )
      writeFileSync(indexPath, JSON.stringify(index))
    }

    const findings = (output: string, kind: 'FAIL' | 'INCOMPLETE'): string[] =>
      output
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith(`${kind} [`))

    // What the package verifier's Shared Case walk found, apart from its other
    // checks: an edit to a packaged file fails those whatever the walk says,
    // so its overall verdict cannot show the two verifiers agree on the walk.
    const sharedCaseFailures = (dir: string): string[] =>
      failures(dir)
        .filter((check) => check.name === 'shared case')
        .map((check) => check.reason ?? '')

    // `chain` with a schema-valid deletion of `exhibitId` appended, signed by
    // a key no member-add carries; `newline` false leaves it unterminated.
    function forgedDeletion(
      chain: Chain,
      exhibitId: string,
      by: ReturnType<typeof operator>,
      newline: boolean
    ): string {
      const [row] = listExhibits(caseId).filter((e) => e.id === exhibitId)
      const forger = new Chain(signWith(keyPair()))
      forger.lines = [...chain.lines]
      forger.hashes = [...chain.hashes]
      forger.append({
        type: 'deletion',
        caseId,
        captureId: exhibitId,
        contentHash: row.contentHash,
        timestamp: TIME,
        ...by,
        schemaVersion: 3
      })
      return newline ? forger.jsonl : forger.lines.join('\n')
    }

    it('passes the two-member package, naming each member chain and its key', async () => {
      const { peerDoc } = ownerReplica()
      const { dir } = await exportPackage()

      const run = runVerifyScript(dir)
      expect(run.status, run.output).toBe(0)
      expect(run.output).toContain('\n== Step 4a - member chains of a Shared Case\n')
      expect(run.output).toContain(`Case ${caseId}: 2 member(s): CO=${localId}, RP=${PEER_ID}`)
      expect(run.output).toContain(
        `${peerChain}: member RP (${PEER_ID}), 1 entr(ies) verified under the key the ` +
          `Owner's member-add for it carries (SHA-256 ${peerFingerprint})`
      )
      expect(run.output).toContain(
        '1 merge head(s) each name an entry of the chain they name, at that index and with ' +
          'that entryHash'
      )
      // The member's Exhibit is bound in step 5 under its citation.
      expect(run.output).toContain('2 exhibit(s) of other kinds bound to the signed chain')
      expect(verifyEvidencePackage(dir).pass).toBe(true)

      const [row] = listExhibits(caseId).filter((e) => e.id === peerDoc)
      const enclosed = row.path!.slice(caseId.length + 1)
      writeFileSync(join(dir, enclosed), 'edited')
      reindex(dir, enclosed)
      const edited = runVerifyScript(dir)
      expect(edited.status).toBe(1)
      expect(findings(edited.output, 'FAIL')).toEqual([
        `FAIL [step 5] Exhibit RP-1: ${enclosed} does not match the contentHash in its signed entry`
      ])
      expect(
        failures(dir)
          .filter((check) => check.name === `exhibit ${peerDoc}`)
          .map((check) => check.reason)
      ).toEqual([
        `Exhibit RP-1 (document): ${enclosed} does not match the contentHash in its signed entry`
      ])
    })

    it('fails a forged entry in the member chain, naming the chain and the entry', async () => {
      const { peer, peerDoc } = ownerReplica()
      const { dir } = await exportPackage()
      writeFileSync(join(dir, peerChain), forgedDeletion(peer, peerDoc, PEER, true))
      reindex(dir, peerChain)

      const run = runVerifyScript(dir)
      expect(run.status, run.output).toBe(1)
      // The Owner's merge names the member chain, and it no longer verifies.
      const merge =
        `merge entry 3 of ${localId} names installation ${PEER_ID}, whose chain ` +
        'is not present or did not verify'
      expect(findings(run.output, 'FAIL')).toEqual([
        `FAIL [step 4a] ${peerChain} (member RP): entry 1: Invalid signature`,
        `FAIL [step 4a] ${merge}`
      ])
      expect(sharedCaseFailures(dir)).toEqual([
        `chain-broken: chain of ${PEER_ID} (RP): Invalid signature`,
        `merge-head-mismatch: ${merge}`
      ])
    })

    // A shell `read` loop skips a last line with no newline after it, and jq
    // reads that line all the same, so step 4a once accepted a line its checks
    // had never read. evidence.json is left as exported: step 1 reports the
    // edited file, and the findings after it are the chain check's.
    it('fails a forged member entry written as the last line with no newline', async () => {
      const { peer, peerDoc } = ownerReplica()
      const { dir } = await exportPackage()
      writeFileSync(join(dir, peerChain), forgedDeletion(peer, peerDoc, PEER, false))

      const run = runVerifyScript(dir)
      expect(run.status, run.output).toBe(1)
      const merge =
        `merge entry 3 of ${localId} names installation ${PEER_ID}, whose chain ` +
        'is not present or did not verify'
      expect(findings(run.output, 'FAIL')).toEqual([
        'FAIL [step 1] one or more enclosed files do not match evidence.json',
        `FAIL [step 4a] ${peerChain} (member RP): entry 1: Invalid signature`,
        `FAIL [step 4a] ${merge}`
      ])
      expect(run.output).not.toContain('a later deletion entry accounts for it')
      expect(sharedCaseFailures(dir)).toEqual([
        `chain-broken: chain of ${PEER_ID} (RP): Invalid signature`,
        `merge-head-mismatch: ${merge}`
      ])
    })

    it("fails a forged Owner's entry with no newline, in a package a member exported", async () => {
      const { owner, ownerDoc } = memberReplica()
      const { dir } = await exportPackage()
      writeFileSync(join(dir, peerChain), forgedDeletion(owner, ownerDoc, PEER, false))

      const run = runVerifyScript(dir)
      expect(run.status, run.output).toBe(1)
      expect(findings(run.output, 'FAIL')).toEqual([
        'FAIL [step 1] one or more enclosed files do not match evidence.json',
        `FAIL [step 4a] ${peerChain} (the Owner): entry 3: Invalid signature`
      ])
      expect(run.output).not.toContain('a later deletion entry accounts for it')
      expect(sharedCaseFailures(dir)).toEqual(['chain-broken: Owner chain: Invalid signature'])
    })

    it('fails a merge head the member chain does not reach', async () => {
      ownerReplica(undefined, (peer) => {
        document(peer, PEER, { installationId: PEER_ID, memberCode: 'RP' }, 2)
      })
      const { dir } = await exportPackage()
      // The member chain the Owner merged up to index 1, cut back to index 0:
      // still a chain the member signed, but not the one the merge names.
      const [first] = readFileSync(join(dir, peerChain), 'utf-8').split('\n')
      writeFileSync(join(dir, peerChain), `${first}\n`)
      reindex(dir, peerChain)

      const run = runVerifyScript(dir)
      expect(run.status, run.output).toBe(1)
      expect(findings(run.output, 'FAIL')).toEqual([
        `FAIL [step 4a] merge entry 3 of ${localId} names index 1 of ${PEER_ID}, which has 1 entries`
      ])
      expect(sharedCaseFailures(dir)).toEqual([
        `merge-head-mismatch: merge entry 3 of ${localId} names index 1 of ${PEER_ID}, which ` +
          'has 1 entries'
      ])
    })

    it('reports a member chain it cannot read to the end as INCOMPLETE, never PASS', async () => {
      const { peer } = ownerReplica()
      const { dir } = await exportPackage()
      // A genuine entry the member's newer build wrote, signed by its key.
      peer.append({
        type: 'exhibit-review',
        caseId,
        timestamp: TIME,
        ...PEER,
        schemaVersion: MANIFEST_SCHEMA_VERSION + 1
      })
      writeFileSync(join(dir, peerChain), peer.jsonl)
      reindex(dir, peerChain)

      const run = runVerifyScript(dir)
      expect(run.status, run.output).toBe(3)
      expect(findings(run.output, 'FAIL')).toEqual([])
      expect(findings(run.output, 'INCOMPLETE')).toEqual([
        `INCOMPLETE [step 4a] ${peerChain} (member RP): entry 1 is from a newer schema than ` +
          `this script reads (type exhibit-review, schema version ${MANIFEST_SCHEMA_VERSION + 1}; ` +
          `it reads up to schema version ${MANIFEST_SCHEMA_VERSION}), so the chain was checked ` +
          'only up to that entry',
        'INCOMPLETE [step 4a] merge heads, citations and exclusions were not checked: a member ' +
          'chain was not read to its end'
      ])
      expect(run.output).not.toContain('PASS')
      const result = verifyEvidencePackage(dir)
      expect([result.pass, result.unsupported !== undefined]).toEqual([false, true])
    })

    it("fails an Exhibit entry that claims another member's Member Code", async () => {
      ownerReplica(undefined, (peer) => {
        peer.append({
          type: 'exhibit',
          exhibitId: `${PEER_ID}-claimed`,
          caseId,
          kind: 'document',
          origin: 'manual-upload',
          name: 'claimed.pdf',
          exhibitNumber: 5,
          memberCode: 'CO',
          path: `${caseId}/documents/${PEER_ID}-claimed.pdf`,
          contentHash: 'e'.repeat(64),
          sizeBytes: 1,
          timestamp: TIME,
          ...PEER,
          schemaVersion: 4
        })
      })
      const { dir } = await exportPackage()

      const run = runVerifyScript(dir)
      expect(run.status, run.output).toBe(1)
      // The entry names bytes the fixture never wrote, so step 5 finds them absent too.
      expect(findings(run.output, 'FAIL')).toEqual([
        `FAIL [step 4a] exhibit entry 1 of ${PEER_ID} claims Member Code CO, its writer's is RP`,
        `FAIL [step 5] Exhibit 5: documents/${PEER_ID}-claimed.pdf is missing and nothing ` +
          'signed accounts for its absence'
      ])
      expect(sharedCaseFailures(dir)).toEqual([
        `citation-collision: exhibit entry 1 of ${PEER_ID} claims Member Code CO, its ` +
          "writer's is RP"
      ])
    })

    it("fails an exclude naming an Exhibit its author's chain does not hold", async () => {
      ownerReplica((owner) => {
        owner.append({
          type: 'exclude',
          caseId,
          exhibitId: 'never-written',
          authorInstallationId: PEER_ID,
          timestamp: TIME,
          ...LOCAL(),
          schemaVersion: 4
        })
      })
      const { dir } = await exportPackage()

      const run = runVerifyScript(dir)
      expect(run.status, run.output).toBe(1)
      expect(findings(run.output, 'FAIL')).toEqual([
        `FAIL [step 4a] exclude at index 4 names Exhibit never-written, which the chain of ` +
          `${PEER_ID} does not hold`
      ])
      expect(sharedCaseFailures(dir)).toEqual([
        'roster-invalid: exclude at index 4 names Exhibit never-written, which the chain of ' +
          `${PEER_ID} does not hold`
      ])
      // The package fails nothing else, so the whole verdicts compare too.
      const conformance = checkConformance(dir)
      expect(conformance).toMatchObject({ binary: 'fail', script: 'fail', scriptSteps: ['4a'] })
      expect(conformance.binaryFailures.map((check) => check.name)).toEqual(['shared case'])
    })

    it('fails a member chain no member-add names', async () => {
      ownerReplica()
      const { dir } = await exportPackage()
      const stray = new Chain(signWith(keyPair()))
      document(stray, operator('installation-stray-0001', 'Sam Stray'), null, 7)
      const strayChain = memberChainPath('installation-stray-0001')
      writeFileSync(join(dir, strayChain), stray.jsonl)

      const run = runVerifyScript(dir)
      expect(run.status, run.output).toBe(1)
      expect(findings(run.output, 'FAIL')).toEqual([
        `FAIL [step 4a] ${strayChain}: no member-add names installation installation-stray-0001`
      ])
      expect(sharedCaseFailures(dir)).toEqual([
        'unknown-member: no member-add names installation installation-stray-0001'
      ])
    })

    // No member chain and no membership entry: the Member Code on the
    // exporter's own Exhibit entry is the only Shared Case signal.
    it('opens step 4a for an Exhibit entry that carries a Member Code', async () => {
      const owner = new Chain(signEntryHash)
      owner.append({
        type: 'exhibit',
        exhibitId: `${localId}-claimed`,
        caseId,
        kind: 'document',
        origin: 'manual-upload',
        name: 'claimed.pdf',
        exhibitNumber: 1,
        memberCode: 'CO',
        path: `${caseId}/documents/${localId}-claimed.pdf`,
        contentHash: 'e'.repeat(64),
        sizeBytes: 1,
        timestamp: TIME,
        ...LOCAL(),
        schemaVersion: 4
      })
      writeFileSync(join(caseDir(), 'manifest.jsonl'), owner.jsonl)
      const { dir } = await exportPackage()

      const run = runVerifyScript(dir)
      expect(run.status, run.output).toBe(1)
      expect(run.output).toContain('\n== Step 4a - member chains of a Shared Case\n')
      const claim = 'exhibit entry 0 claims Member Code CO in a Case with no roster'
      // The entry names bytes the fixture never wrote, so step 5 finds them absent too.
      expect(findings(run.output, 'FAIL')).toEqual([
        `FAIL [step 4a] ${claim}`,
        `FAIL [step 5] Exhibit 1: documents/${localId}-claimed.pdf is missing and nothing ` +
          'signed accounts for its absence'
      ])
      expect(sharedCaseFailures(dir)).toEqual([`citation-collision: ${claim}`])
    })

    // A shell glob's `*` skips a leading dot, so the script lists lineage
    // directories under three patterns; the package verifier lists them all.
    it('fails a lineage directory no import names, whatever its name starts with', async () => {
      ownerReplica()
      const { dir } = await exportPackage()
      const names = ['x', '.x', '..x']
      for (const name of names) mkdirSync(join(dir, 'lineage', name), { recursive: true })

      const run = runVerifyScript(dir)
      expect(run.status, run.output).toBe(1)
      const reason = (name: string): string =>
        `lineage chains supplied for Case ${name}, which no import in the Owner's chain names`
      expect(findings(run.output, 'FAIL').sort()).toEqual(
        names.map((name) => `FAIL [step 4a] ${reason(name)}`).sort()
      )
      expect(sharedCaseFailures(dir).sort()).toEqual(
        names.map((name) => `roster-invalid: ${reason(name)}`).sort()
      )
    })

    // A loop over a file the shell cannot open reads nothing, which once
    // printed "0 entr(ies) verified". The chain's row comes out of
    // evidence.json, or step 1, which cannot open it either, fails the
    // package first. Mode 000 means nothing to root, which reads it anyway.
    it.skipIf(process.getuid?.() === 0)(
      'reports a member chain file it cannot open as INCOMPLETE, never PASS',
      async () => {
        ownerReplica()
        const { dir } = await exportPackage()
        const indexPath = join(dir, 'evidence.json')
        const index = JSON.parse(readFileSync(indexPath, 'utf-8'))
        index.artifacts = index.artifacts.filter((a: { path: string }) => a.path !== peerChain)
        writeFileSync(indexPath, JSON.stringify(index))
        chmodSync(join(dir, peerChain), 0)

        try {
          const run = runVerifyScript(dir)
          expect(run.status, run.output).toBe(3)
          expect(findings(run.output, 'FAIL')).toEqual([])
          expect(findings(run.output, 'INCOMPLETE')).toEqual([
            `INCOMPLETE [step 4a] ${peerChain} (member RP): the file cannot be read, so none ` +
              'of its entries was checked',
            'INCOMPLETE [step 4a] merge heads, citations and exclusions were not checked: a ' +
              'member chain was not read to its end'
          ])
          // The package verifier reaches no verdict on a file it cannot read.
          expect(() => verifyEvidencePackage(dir)).toThrow('EACCES')
        } finally {
          chmodSync(join(dir, peerChain), 0o644)
        }
      }
    )

    // `jsonl` with `blank` inserted as its own line after line `at`.
    const withLine = (jsonl: string, at: number, blank: string): string => {
      const lines = jsonl.split('\n')
      lines.splice(at + 1, 0, blank)
      return lines.join('\n')
    }

    // The package verifier skips a line that String.prototype.trim empties.
    // jq's parser takes only space, tab, CR and LF between values, so a form
    // feed once ended every whole-file read of a chain the shell loop had
    // verified past it, and the entries after it went unchecked.
    it('fails an edited member Exhibit that follows a form-feed line in its chain', async () => {
      const { peer } = ownerReplica()
      const lateDoc = document(peer, PEER, { installationId: PEER_ID, memberCode: 'RP' }, 2)
      writeFileSync(join(caseDir(), peerChain), peer.jsonl)
      const { dir } = await exportPackage()
      const [row] = listExhibits(caseId).filter((e) => e.id === lateDoc)
      const enclosed = row.path!.slice(caseId.length + 1)
      writeFileSync(join(dir, enclosed), 'edited')
      reindex(dir, enclosed)
      writeFileSync(
        join(dir, peerChain),
        withLine(readFileSync(join(dir, peerChain), 'utf-8'), 0, '\f')
      )
      reindex(dir, peerChain)

      const run = runVerifyScript(dir)
      expect(run.status, run.output).toBe(1)
      expect(findings(run.output, 'FAIL')).toEqual([
        `FAIL [step 5] Exhibit RP-2: ${enclosed} does not match the contentHash in its signed entry`
      ])
      expect(
        failures(dir)
          .filter((check) => check.name === `exhibit ${lateDoc}`)
          .map((check) => check.reason)
      ).toEqual([
        `Exhibit RP-2 (document): ${enclosed} does not match the contentHash in its signed entry`
      ])
    })

    it("fails a revoked member's late entry that follows a form-feed line", async () => {
      const { peer } = ownerReplica((owner) => {
        owner.append({
          type: 'member-revoke',
          caseId,
          memberInstallationId: PEER_ID,
          timestamp: TIME,
          ...LOCAL(),
          schemaVersion: 4
        })
      })
      document(peer, PEER, { installationId: PEER_ID, memberCode: 'RP' }, 2)
      writeFileSync(join(caseDir(), peerChain), peer.jsonl)
      const { dir } = await exportPackage()
      writeFileSync(
        join(dir, peerChain),
        withLine(readFileSync(join(dir, peerChain), 'utf-8'), 0, '\f')
      )
      reindex(dir, peerChain)

      const run = runVerifyScript(dir)
      expect(run.status, run.output).toBe(1)
      const late =
        `entry 1 of ${PEER_ID} (RP) is after its revocation: the Owner merged up to index 0 ` +
        'before revoking it'
      expect(findings(run.output, 'FAIL')).toEqual([`FAIL [step 4a] ${late}`])
      expect(sharedCaseFailures(dir)).toEqual([`entry-after-revocation: ${late}`])
    })

    // The package verifier's verdict on a package whose evidence.json reindex
    // rewrote: it recomputes the package hash over that file and the script
    // does not, as its header states, so that is the one check it fails.
    function expectOnlyPackageHash(dir: string): void {
      expect(sharedCaseFailures(dir)).toEqual([])
      expect(failures(dir).map((check) => check.name)).toEqual(['package hash'])
    }

    // Every line the package verifier skips as blank, including the ones a
    // C-locale shell's [:space:] does not hold, and the one jq stops at.
    it('passes a member chain holding every kind of line the package verifier skips', async () => {
      ownerReplica(undefined, (peer) => {
        document(peer, PEER, { installationId: PEER_ID, memberCode: 'RP' }, 2)
      })
      const { dir } = await exportPackage()
      let jsonl = readFileSync(join(dir, peerChain), 'utf-8')
      for (const blank of ['\f', '\v', '\u00a0', '\u3000', '\u2028', '\ufeff', ' \t\r']) {
        jsonl = withLine(jsonl, 0, blank)
      }
      writeFileSync(join(dir, peerChain), jsonl)
      reindex(dir, peerChain)

      const run = runVerifyScript(dir)
      expect(run.status, run.output).toBe(0)
      expect(run.output).toContain(`${peerChain}: member RP (${PEER_ID}), 2 entr(ies) verified`)
      expectOnlyPackageHash(dir)
    })

    it("passes a member's package whose Owner chain holds a form-feed line", async () => {
      memberReplica()
      const { dir } = await exportPackage()
      writeFileSync(
        join(dir, peerChain),
        withLine(readFileSync(join(dir, peerChain), 'utf-8'), 0, '\f')
      )
      reindex(dir, peerChain)

      const run = runVerifyScript(dir)
      expect(run.status, run.output).toBe(0)
      expectOnlyPackageHash(dir)
    })

    // Each read step 4a makes of a member chain after its check, pinned by an
    // entry after a form-feed line that only that read acts on.
    it('fails a member entry naming another Case that follows a form-feed line', async () => {
      const { peer, peerDoc } = ownerReplica()
      const [row] = listExhibits(caseId).filter((e) => e.id === peerDoc)
      peer.append({
        type: 'deletion',
        caseId: 'case-elsewhere',
        captureId: peerDoc,
        contentHash: row.contentHash,
        timestamp: TIME,
        ...PEER,
        schemaVersion: 3
      })
      writeFileSync(join(caseDir(), peerChain), peer.jsonl)
      const { dir } = await exportPackage()
      writeFileSync(
        join(dir, peerChain),
        withLine(readFileSync(join(dir, peerChain), 'utf-8'), 0, '\f')
      )
      reindex(dir, peerChain)

      const run = runVerifyScript(dir)
      expect(run.status, run.output).toBe(1)
      const merge =
        `merge entry 3 of ${localId} names installation ${PEER_ID}, whose chain ` +
        'is not present or did not verify'
      const foreign = `entry 1 of ${PEER_ID} (RP) names Case case-elsewhere, the Shared Case is ${caseId}`
      expect(findings(run.output, 'FAIL')).toEqual([
        `FAIL [step 4a] ${foreign}`,
        `FAIL [step 4a] ${merge}`
      ])
      expect(sharedCaseFailures(dir)).toEqual([
        `roster-invalid: ${foreign}`,
        `merge-head-mismatch: ${merge}`
      ])
    })

    it('fails a membership entry in a member chain that follows a form-feed line', async () => {
      const { peer } = ownerReplica()
      peer.append(
        memberAdd('installation-extra-0001', keyPair().publicKey, 'EX', 'Ex', 'member', PEER)
      )
      writeFileSync(join(caseDir(), peerChain), peer.jsonl)
      const { dir } = await exportPackage()
      writeFileSync(
        join(dir, peerChain),
        withLine(readFileSync(join(dir, peerChain), 'utf-8'), 0, '\f')
      )
      reindex(dir, peerChain)

      const run = runVerifyScript(dir)
      expect(run.status, run.output).toBe(1)
      const outside = "entry 1: member-add entry written outside the Owner's chain"
      expect(findings(run.output, 'FAIL')).toEqual([`FAIL [step 4a] ${peerChain}: ${outside}`])
      expect(sharedCaseFailures(dir)).toEqual([
        "roster-invalid: member-add entry written outside the Owner's chain"
      ])
    })

    it("passes a revoked member's merged entries that follow a form-feed line", async () => {
      ownerReplica(
        (owner) => {
          owner.append({
            type: 'member-revoke',
            caseId,
            memberInstallationId: PEER_ID,
            timestamp: TIME,
            ...LOCAL(),
            schemaVersion: 4
          })
        },
        (peer) => {
          document(peer, PEER, { installationId: PEER_ID, memberCode: 'RP' }, 2)
        }
      )
      const { dir } = await exportPackage()
      writeFileSync(
        join(dir, peerChain),
        withLine(readFileSync(join(dir, peerChain), 'utf-8'), 0, '\f')
      )
      reindex(dir, peerChain)

      const run = runVerifyScript(dir)
      expect(run.status, run.output).toBe(0)
      expectOnlyPackageHash(dir)
    })

    // jq skips a byte-order mark at the start of its input and stops at one
    // anywhere after it; the package verifier's JSON.parse rejects the line.
    it('fails a member entry line that begins with a byte-order mark', async () => {
      const { peer } = ownerReplica()
      const lateDoc = document(peer, PEER, { installationId: PEER_ID, memberCode: 'RP' }, 2)
      writeFileSync(join(caseDir(), peerChain), peer.jsonl)
      const { dir } = await exportPackage()
      const [row] = listExhibits(caseId).filter((e) => e.id === lateDoc)
      const enclosed = row.path!.slice(caseId.length + 1)
      writeFileSync(join(dir, enclosed), 'edited')
      reindex(dir, enclosed)
      const lines = readFileSync(join(dir, peerChain), 'utf-8').split('\n')
      lines[1] = `\ufeff${lines[1]}`
      writeFileSync(join(dir, peerChain), lines.join('\n'))
      reindex(dir, peerChain)

      const run = runVerifyScript(dir)
      expect(run.status, run.output).toBe(1)
      const merge =
        `merge entry 3 of ${localId} names installation ${PEER_ID}, whose chain ` +
        'is not present or did not verify'
      expect(findings(run.output, 'FAIL')).toEqual([
        `FAIL [step 4a] ${peerChain} (member RP): entry 1: Invalid JSON`,
        `FAIL [step 4a] ${merge}`
      ])
      expect(sharedCaseFailures(dir)).toEqual([
        `chain-broken: chain of ${PEER_ID} (RP): Invalid JSON`,
        `merge-head-mismatch: ${merge}`
      ])
    })

    it('fails a manifest entry line that begins with a byte-order mark', async () => {
      const { peer } = ownerReplica()
      const lateDoc = document(peer, PEER, { installationId: PEER_ID, memberCode: 'RP' }, 2)
      writeFileSync(join(caseDir(), peerChain), peer.jsonl)
      const { dir } = await exportPackage()
      const [row] = listExhibits(caseId).filter((e) => e.id === lateDoc)
      const enclosed = row.path!.slice(caseId.length + 1)
      writeFileSync(join(dir, enclosed), 'edited')
      reindex(dir, enclosed)
      const lines = readFileSync(join(dir, 'manifest.jsonl'), 'utf-8').split('\n')
      lines[2] = `\ufeff${lines[2]}`
      writeFileSync(join(dir, 'manifest.jsonl'), lines.join('\n'))
      reindex(dir, 'manifest.jsonl')

      const run = runVerifyScript(dir)
      expect(run.status, run.output).toBe(1)
      expect(findings(run.output, 'FAIL')).toEqual([
        'FAIL [step 4] entry at position 2: Invalid JSON, it begins with a byte-order mark'
      ])
      expect(
        failures(dir)
          .filter((check) => check.name === 'manifest chain')
          .map((check) => check.reason)
      ).toEqual(['Invalid JSON (at index 2)'])
    })

    // read drops a NUL byte, so no loop sees one; JSON.parse rejects the line,
    // and jq stops at it in a whole-file read.
    it('fails a member entry line that holds a NUL byte, or is one', async () => {
      const { peer } = ownerReplica()
      document(peer, PEER, { installationId: PEER_ID, memberCode: 'RP' }, 2)
      writeFileSync(join(caseDir(), peerChain), peer.jsonl)
      const { dir } = await exportPackage()
      const exported = readFileSync(join(dir, peerChain), 'utf-8')
      const merge =
        `merge entry 3 of ${localId} names installation ${PEER_ID}, whose chain ` +
        'is not present or did not verify'
      const lines = exported.split('\n')
      lines[1] = `{\u0000${lines[1].slice(1)}`
      for (const jsonl of [lines.join('\n'), withLine(exported, 0, '\u0000')]) {
        writeFileSync(join(dir, peerChain), jsonl)
        reindex(dir, peerChain)

        const run = runVerifyScript(dir)
        expect(run.status, run.output).toBe(1)
        expect(findings(run.output, 'FAIL')).toEqual([
          `FAIL [step 4a] ${peerChain} (member RP): entry 1: Invalid JSON`,
          `FAIL [step 4a] ${merge}`
        ])
        expect(sharedCaseFailures(dir)).toEqual([
          `chain-broken: chain of ${PEER_ID} (RP): Invalid JSON`,
          `merge-head-mismatch: ${merge}`
        ])
      }
    })

    // The step-4 failure stops step 4a from reading a roster off the file, and
    // the copy every later read takes reports that jq did not finish it.
    it('fails a manifest line that holds a NUL byte and reports the short copy', async () => {
      ownerReplica()
      const { dir } = await exportPackage()
      const lines = readFileSync(join(dir, 'manifest.jsonl'), 'utf-8').split('\n')
      lines[2] = `{\u0000${lines[2].slice(1)}`
      writeFileSync(join(dir, 'manifest.jsonl'), lines.join('\n'))
      reindex(dir, 'manifest.jsonl')

      const run = runVerifyScript(dir)
      expect(run.status, run.output).toBe(1)
      expect(findings(run.output, 'FAIL')).toEqual([
        'FAIL [step 4] entry at position 2: Invalid JSON, it holds a NUL byte'
      ])
      expect(findings(run.output, 'INCOMPLETE')).toEqual([
        'INCOMPLETE [step 4] manifest.jsonl could not be read in full, so the entries after the ' +
          'point jq stopped were not checked',
        'INCOMPLETE [step 4a] the member chains were not checked: manifest.jsonl failed steps 2 ' +
          'to 4, so no roster can be read from it'
      ])
      expect(
        failures(dir)
          .filter((check) => check.name === 'manifest chain')
          .map((check) => check.reason)
      ).toEqual(['Invalid JSON (at index 2)'])
    })

    // Drops a chain's row from evidence.json, so step 1 does not report the
    // file the test replaces and the findings are step 4a's alone.
    function unindex(dir: string, path: string): void {
      const indexPath = join(dir, 'evidence.json')
      const index = JSON.parse(readFileSync(indexPath, 'utf-8'))
      index.artifacts = index.artifacts.filter((a: { path: string }) => a.path !== path)
      writeFileSync(indexPath, JSON.stringify(index))
    }

    // The package verifier lists every name the layout gives a chain and
    // throws on one it cannot read; the script reports it INCOMPLETE.
    it('reports a member chain path that is a dangling link as INCOMPLETE', async () => {
      ownerReplica()
      const { dir } = await exportPackage()
      unindex(dir, peerChain)
      rmSync(join(dir, peerChain))
      symlinkSync(join(dir, 'nowhere.jsonl'), join(dir, peerChain))

      const run = runVerifyScript(dir)
      expect(run.status, run.output).toBe(3)
      expect(findings(run.output, 'FAIL')).toEqual([])
      expect(findings(run.output, 'INCOMPLETE')).toEqual([
        `INCOMPLETE [step 4a] ${peerChain} (member RP): the file cannot be read, so none of ` +
          'its entries was checked',
        'INCOMPLETE [step 4a] merge heads, citations and exclusions were not checked: a member ' +
          'chain was not read to its end'
      ])
      expect(() => verifyEvidencePackage(dir)).toThrow('ENOENT')
    })

    it("reports an Owner's chain it cannot read, in a member's package, as INCOMPLETE", async () => {
      memberReplica()
      const { dir } = await exportPackage()
      unindex(dir, peerChain)
      rmSync(join(dir, peerChain))
      mkdirSync(join(dir, peerChain))

      const run = runVerifyScript(dir)
      expect(run.status, run.output).toBe(3)
      expect(findings(run.output, 'FAIL')).toEqual([])
      expect(findings(run.output, 'INCOMPLETE')).toEqual([
        `INCOMPLETE [step 4a] ${peerChain}: the file cannot be read, so whether it holds the ` +
          "Owner's chain was not checked"
      ])
      expect(() => verifyEvidencePackage(dir)).toThrow('EISDIR')
    })

    it("passes a package a member exported, anchoring the Owner's key in its merge", async () => {
      const { owner } = memberReplica()
      const { dir } = await exportPackage()

      const run = runVerifyScript(dir)
      expect(run.status, run.output).toBe(0)
      expect(run.output).toContain(
        `${peerChain}: the Owner's chain (${PEER_ID}), ${owner.lines.length} entr(ies) verified ` +
          `under the key its own member-add carries (SHA-256 ${peerFingerprint}), which a merge ` +
          `in manifest.jsonl anchors at index ${owner.lines.length - 1}`
      )
      const localFingerprint = createHash('sha256').update(getPublicKeyPem()).digest('hex')
      expect(run.output).toContain(
        `manifest.jsonl: member RP (${localId}), 2 entr(ies) verified under the key the ` +
          `Owner's member-add for it carries (SHA-256 ${localFingerprint})`
      )
      expect(verifyEvidencePackage(dir).pass).toBe(true)
    })

    // The Owner's chain begins with an entry an earlier installation signed,
    // which verifies under the key the Owner's import entry carries.
    it("passes a member's package whose Owner chain continues an earlier import", async () => {
      memberReplicaAfterImport()
      const { dir } = await exportPackage()

      const run = runVerifyScript(dir)
      expect(run.status, run.output).toBe(0)
      expect(run.output).toContain(
        `${peerChain}: the Owner's chain (${PEER_ID}), 5 entr(ies) verified under the key its ` +
          `own member-add carries (SHA-256 ${peerFingerprint})`
      )
      expect(verifyEvidencePackage(dir).pass).toBe(true)
    })

    it("fails a package a member exported when no merge anchors the Owner's key", async () => {
      // memberReplica without the merge: nothing this installation signed
      // names the Owner's chain, so the key that chain claims is not trusted.
      const owner = new Chain(signWith(PEER_KEY))
      owner.append(memberAdd(PEER_ID, PEER_KEY.publicKey, 'CO', 'Robin', 'owner', PEER))
      owner.append(memberAdd(localId, getPublicKeyPem(), 'RP', 'Casey', 'member', PEER))
      const local = new Chain(signEntryHash)
      document(local, LOCAL(), null, 1)
      writeFileSync(join(caseDir(), 'manifest.jsonl'), local.jsonl)
      writeFileSync(join(caseDir(), peerChain), owner.jsonl)
      roster(PEER_ID, PEER_KEY.publicKey, localId, getPublicKeyPem())
      const { dir } = await exportPackage()

      const run = runVerifyScript(dir)
      expect(run.status, run.output).toBe(1)
      expect(findings(run.output, 'FAIL')).toEqual([
        `FAIL [step 4a] no merge in manifest.jsonl names the Owner's chain (${PEER_ID}), so its ` +
          'key cannot be anchored'
      ])
      expect(sharedCaseFailures(dir)).toEqual([
        "roster-invalid: no merge in the local chain names the Owner's chain " +
          `(${PEER_ID}), so its key cannot be anchored`
      ])
    })
  })
})
