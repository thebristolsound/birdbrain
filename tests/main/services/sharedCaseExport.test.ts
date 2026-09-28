import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createHash, createSign, generateKeyPairSync } from 'crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
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
import {
  exportCaseArchive,
  importCaseArchive,
  inspectCaseArchive
} from '@main/services/caseArchive'
import { createCaptureLifecycle } from '@main/services/captureLifecycle'
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
  function ownerReplica(extra: (owner: Chain, peerDoc: string) => void = () => {}) {
    const peer = new Chain(signWith(PEER_KEY))
    const peerDoc = document(peer, PEER, { installationId: PEER_ID, memberCode: 'RP' }, 1)
    const owner = new Chain(signEntryHash)
    owner.append(memberAdd(localId, getPublicKeyPem(), 'CO', 'Casey', 'owner', LOCAL()))
    owner.append(memberAdd(PEER_ID, PEER_KEY.publicKey, 'RP', 'Robin', 'member', LOCAL()))
    const ownDoc = document(owner, LOCAL(), null, 1)
    owner.append({
      type: 'merge',
      caseId,
      heads: [{ ...peer.head(PEER_ID), entriesReceived: 1 }],
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

  const options = (outputPath: string): ExportOptions => ({
    format: 'zip',
    include: {
      captures: true,
      screenshots: true,
      auditTrail: true,
      notes: false,
      annotations: 'none'
    },
    exportClass: 'evidence',
    outputPath
  })

  // Exports the Case as an Evidence Package and unpacks it for the verifier.
  async function exportPackage(id = caseId): Promise<{ dir: string; zip: Map<string, Buffer> }> {
    const out = join(tempDir, `${id}.zip`)
    await generateReport(id, options(out), lifecycle)
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
        sourceCaseId: null
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
})
