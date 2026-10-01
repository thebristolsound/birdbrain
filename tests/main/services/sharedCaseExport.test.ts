import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createHash, createSign, generateKeyPairSync } from 'crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { tmpdir } from 'os'
import { closeDatabase, getDb, initDatabase } from '@main/services/db/core'
import { createCase, deleteCase, getCase } from '@main/services/db/caseRepo'
import { listExhibits } from '@main/services/db/exhibitRepo'
import {
  exhibitCitationResolver,
  listCaseMembers,
  upsertCaseMember
} from '@main/services/db/caseMemberRepo'
import { getStorageRoot, initStorage } from '@main/services/storage'
import { readManifestSnapshot, readSharedCaseSnapshot } from '@main/services/manifest'
import { generateReport } from '@main/services/export'
import { verifyCaseDerivedFiles, verifyExhibit } from '@main/services/exhibits'
import {
  exportCaseArchive,
  importCaseArchive,
  inspectCaseArchive
} from '@main/services/caseArchive'
import { createCaptureLifecycle } from '@main/services/captureLifecycle'
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
import { canonicalStringify } from '@shared/verify'
import { verifyEvidencePackage } from '@shared/verify/evidencePackage'
import {
  lineageChainPath,
  memberChainPath
} from '../../../src/packages/evidence-package-layout/index'
import type { ExportOptions } from '@shared/types'
import { HAS_JQ } from '../../helpers/jq'
import { HAS_OPENSSL } from '../../helpers/openssl'
import { extractRunbookBlocks, runRunbookBlocks } from '../../helpers/runbookBlocks'
import { runVerifyScript } from '../../helpers/verifyScript'

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
    author: { installationId: string; memberCode: string } | null
  ): { chain: Chain; earlierDoc: string } {
    let signed = 0
    const chain = new Chain((hash) => (signed++ === 0 ? signWith(EARLIER_KEY) : sign)(hash))
    const earlierDoc = document(chain, EARLIER, author, 2)
    chain.append({
      type: 'import',
      caseId,
      sourceCaseId: 'earlier-case',
      sourceInstallationId: EARLIER.operatorId,
      sourcePublicKeyPem: EARLIER_KEY.publicKey,
      packageHash: 'c'.repeat(64),
      idMapSha256: 'd'.repeat(64),
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
    return { chain, earlierDoc }
  }

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
})
