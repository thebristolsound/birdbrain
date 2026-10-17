import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHash } from 'crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs'
import { dirname, join } from 'path'
import { tmpdir } from 'os'
import { closeDatabase, getDb } from '@main/services/db/core'
import { listCaseMembers, upsertCaseMember } from '@main/services/db/caseMemberRepo'
import { createCase, getCase } from '@main/services/db/caseRepo'
import { resetInstallationId } from '@main/services/installationId'
import { resetSigningKey } from '@main/services/signingKey'
import { updateSettings } from '@main/services/settings'
import {
  appendManifestEntry,
  readManifestSnapshot,
  readSharedCaseSnapshot
} from '@main/services/manifest'
import { commitStagedFiles, uploadToStaging } from '@main/services/staging'
import { generateReport, type ExportOptions } from '@main/services/export'
import { exportCaseArchive, importCaseArchive } from '@main/services/caseArchive'
import { createCaptureLifecycle } from '@main/services/captureLifecycle'
import { createSelectorLifecycle } from '@main/services/selectorLifecycle'
import { readStoredZip } from '@main/services/zipRead'
import { SharingError } from '@main/services/sharing/errors'
import {
  addMember,
  excludeExhibit,
  revokeMember,
  shareCase
} from '@main/services/sharing/membership'
import { MEMBERS_FILENAME, resetSyncStateMemory } from '@main/services/sharing/syncState'
import { verifyEvidencePackage } from '@shared/verify/evidencePackage'
import { ManifestEntrySchema } from '@shared/schemas'
import type { SharedCaseVerifyResult } from '@shared/verify'
import { memberChainPath } from '../../../../src/packages/evidence-package-layout/index'
import {
  activate,
  addDocument,
  caseDirOf,
  createPeer,
  ownChainText,
  parsedChain,
  pull,
  recordSource,
  seedSharedCase,
  type Peer
} from '../../../helpers/syncPeers'

// The roster writers (#1810) on real replicas: what each one appends to the
// Owner's chain, what it refuses before writing, and that after every write
// the cache matches the chain and the Shared Case walk passes.

const sha = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

async function refused(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
  } catch (err) {
    if (err instanceof SharingError) return err.code
    throw err
  }
  throw new Error('expected a SharingError')
}

// The walk over the active peer's replica of `caseId`.
function walk(caseId: string): SharedCaseVerifyResult {
  const caseDir = caseDirOf(caseId)
  const verification = readSharedCaseSnapshot(caseDir, readManifestSnapshot(caseDir)).verification
  if (!verification) throw new Error('not a Shared Case')
  return verification
}

// Every file under the Case directory with its hash: what a refused write
// must leave untouched. `members.json` is left out: it is a cache with a
// write time, and the writers rebuild it before deciding.
function listing(caseId: string): Array<[string, string]> {
  const dir = caseDirOf(caseId)
  const out: Array<[string, string]> = []
  const visit = (at: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const abs = join(at, entry.name)
      if (entry.isDirectory()) visit(abs)
      else if (entry.name !== MEMBERS_FILENAME)
        out.push([abs.slice(dir.length), sha(readFileSync(abs))])
    }
  }
  visit(dir)
  return out.sort()
}

// The cache equals the roster the walk reads from the chain.
function expectCacheMatchesChain(caseId: string): SharedCaseVerifyResult {
  const verification = walk(caseId)
  expect(verification.valid).toBe(true)
  expect(verification.outcome).toBe('pass')
  expect(
    listCaseMembers(caseId).map((m) => [
      m.installationId,
      m.memberCode,
      m.role,
      m.addedAtIndex,
      m.revokedAtIndex
    ])
  ).toEqual(
    verification.members.map((m) => [
      m.installationId,
      m.memberCode,
      m.role,
      m.addedAt,
      m.revokedAt ?? null
    ])
  )
  const members = JSON.parse(readFileSync(join(caseDirOf(caseId), MEMBERS_FILENAME), 'utf-8'))
  expect(members.members.map((m: { installationId: string }) => m.installationId)).toEqual(
    listCaseMembers(caseId).map((m) => m.installationId)
  )
  return verification
}

const joiner = (peer: Peer, memberCode = peer.memberCode) => ({
  installationId: peer.installationId,
  publicKeyPem: peer.publicKeyPem,
  operatorName: peer.operatorName,
  nodeId: `node-${peer.name}`,
  memberCode
})

describe('roster writers (#1810)', () => {
  let root: string
  let A: Peer
  let B: Peer
  let C: Peer
  let caseId: string

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'bb-membership-'))
    C = await createPeer(root, 'carol', 'Carol Member', 'CM')
    B = await createPeer(root, 'bob', 'Bob Member', 'BM')
    A = await createPeer(root, 'alice', 'Alice Owner', 'AO')
    caseId = createCase({ name: 'Shared' }).id
    mkdirSync(caseDirOf(caseId), { recursive: true })
  })

  afterEach(() => {
    closeDatabase()
    resetInstallationId()
    resetSigningKey()
    resetSyncStateMemory()
    rmSync(root, { recursive: true, force: true })
  })

  // Bob holds the Case as the join flow leaves it: the row, the roster, and
  // nothing in his chain yet.
  async function bobHoldsCase(id = caseId, owner = A, members = [B]): Promise<void> {
    await activate(B)
    seedSharedCase(id, owner, members)
    await activate(A)
  }

  describe('shareCase', () => {
    it('appends the Owner member-add once and sets shared_at and owner_installation_id', async () => {
      const before = getCase(caseId)!
      expect(before.sharedAt).toBeUndefined()
      const owner = await shareCase(caseId, { nodeId: 'node-alice' })
      expect(owner).toMatchObject({
        installationId: A.installationId,
        publicKeyPem: A.publicKeyPem,
        memberCode: 'AO',
        operatorName: 'Alice Owner',
        nodeId: 'node-alice',
        role: 'owner',
        addedAtIndex: 0,
        revokedAtIndex: null
      })
      const row = getCase(caseId)!
      expect(row.ownerInstallationId).toBe(A.installationId)
      expect(typeof row.sharedAt).toBe('string')
      const chain = parsedChain(ownChainText(caseId))
      expect(chain).toHaveLength(1)
      expect(chain[0]).toMatchObject({
        type: 'member-add',
        role: 'owner',
        memberInstallationId: A.installationId,
        schemaVersion: 4
      })
      expectCacheMatchesChain(caseId)

      // A second invite appends nothing and keeps the first shared_at.
      const bytes = ownChainText(caseId)
      await shareCase(caseId, { nodeId: 'node-alice-2' })
      expect(ownChainText(caseId)).toBe(bytes)
      expect(getCase(caseId)!.sharedAt).toBe(row.sharedAt)
      expect(listCaseMembers(caseId)).toHaveLength(1)
    })

    it('takes the Owner Member Code given, and refuses one memberCodeProblem rejects', async () => {
      expect(
        await refused(() => shareCase(caseId, { ownerMemberCode: 'alice', nodeId: 'n' }))
      ).toBe('member-code-rejected')
      expect(ownChainText(caseId)).toBe('')
      expect(getCase(caseId)!.sharedAt).toBeUndefined()
      const owner = await shareCase(caseId, { ownerMemberCode: 'AL7', nodeId: 'node-alice' })
      expect(owner.memberCode).toBe('AL7')
    })

    it('refuses an empty Operator name before writing', async () => {
      updateSettings({ operatorName: '  ' })
      expect(await refused(() => shareCase(caseId, { nodeId: 'n' }))).toBe('operator-name-required')
      expect(ownChainText(caseId)).toBe('')
    })

    it('repairs a row left unset between the append and the row write', async () => {
      await shareCase(caseId, { nodeId: 'node-alice' })
      const bytes = ownChainText(caseId)
      getDb()
        .prepare('UPDATE cases SET shared_at = NULL, owner_installation_id = NULL WHERE id = ?')
        .run(caseId)
      getDb().prepare('DELETE FROM case_members WHERE case_id = ?').run(caseId)
      await shareCase(caseId, { nodeId: 'node-alice' })
      expect(ownChainText(caseId)).toBe(bytes)
      expect(getCase(caseId)!.ownerInstallationId).toBe(A.installationId)
      expectCacheMatchesChain(caseId)
    })

    it('refuses on a member installation, which never holds the Owner member-add', async () => {
      await bobHoldsCase()
      await activate(B)
      expect(await refused(() => shareCase(caseId, { nodeId: 'node-bob' }))).toBe('not-owner')
      expect(ownChainText(caseId)).toBe('')
    })
  })

  describe('addMember', () => {
    beforeEach(async () => {
      await shareCase(caseId, { nodeId: 'node-alice' })
    })

    it('appends one member-add, keeps an empty chain for the member, and the walk passes', async () => {
      const member = await addMember(caseId, joiner(B))
      expect(member).toMatchObject({
        installationId: B.installationId,
        memberCode: 'BM',
        role: 'member',
        nodeId: 'node-bob',
        addedAtIndex: 1
      })
      const chain = parsedChain(ownChainText(caseId))
      expect(chain.map((e) => e.type)).toEqual(['member-add', 'member-add'])
      expect(chain[1]).toMatchObject({ memberInstallationId: B.installationId, schemaVersion: 4 })
      // The joiner has written nothing yet; the Owner keeps a file for it so
      // the walk does not report its chain missing.
      const file = join(caseDirOf(caseId), memberChainPath(B.installationId))
      expect(statSync(file).size).toBe(0)
      const verification = expectCacheMatchesChain(caseId)
      expect(verification.memberChains.get(B.installationId)?.valid).toBe(true)
      expect(verification.entries.get(B.installationId)).toEqual([])
    })

    it('refuses a taken code, a malformed code, a held installation and a held key', async () => {
      await addMember(caseId, joiner(B))
      const bytes = ownChainText(caseId)
      const files = listing(caseId)
      expect(await refused(() => addMember(caseId, joiner(C, 'AO')))).toBe('member-code-rejected')
      expect(await refused(() => addMember(caseId, joiner(C, 'bm')))).toBe('member-code-rejected')
      expect(await refused(() => addMember(caseId, joiner(C, '')))).toBe('member-code-rejected')
      expect(await refused(() => addMember(caseId, joiner(B, 'B2')))).toBe('already-member')
      expect(
        await refused(() =>
          addMember(caseId, { ...joiner(C), publicKeyPem: B.publicKeyPem + '\n' })
        )
      ).toBe('already-member')
      await expect(
        addMember(caseId, { ...joiner(C), installationId: '../escape' })
      ).rejects.toThrow(/cannot name a chain file/)
      expect(ownChainText(caseId)).toBe(bytes)
      expect(listing(caseId)).toEqual(files)
      expect(listCaseMembers(caseId)).toHaveLength(2)
    })

    it('refuses a revoked installation, whose code stays taken too', async () => {
      await addMember(caseId, joiner(B))
      await revokeMember(caseId, B.installationId)
      const bytes = ownChainText(caseId)
      expect(await refused(() => addMember(caseId, joiner(B, 'B2')))).toBe('already-member')
      expect(await refused(() => addMember(caseId, joiner(C, 'BM')))).toBe('member-code-rejected')
      expect(ownChainText(caseId)).toBe(bytes)
      await addMember(caseId, joiner(C))
      expectCacheMatchesChain(caseId)
    })

    it('rolls the entry back when the cache write fails', async () => {
      const bytes = ownChainText(caseId)
      getDb().exec(`CREATE TRIGGER roster_busy BEFORE INSERT ON case_members
        BEGIN SELECT RAISE(ABORT, 'busy'); END`)
      try {
        await expect(addMember(caseId, joiner(B))).rejects.toThrow(/busy/)
      } finally {
        getDb().exec('DROP TRIGGER roster_busy')
      }
      expect(ownChainText(caseId)).toBe(bytes)
      expect(existsSync(join(caseDirOf(caseId), memberChainPath(B.installationId)))).toBe(false)
      expect(listCaseMembers(caseId)).toHaveLength(1)
      expectCacheMatchesChain(caseId)
    })
  })

  describe('revokeMember', () => {
    beforeEach(async () => {
      await shareCase(caseId, { nodeId: 'node-alice' })
      await addMember(caseId, joiner(B))
    })

    it('appends one member-revoke and records its index in the cache', async () => {
      const revoked = await revokeMember(caseId, B.installationId)
      expect(revoked.revokedAtIndex).toBe(2)
      const chain = parsedChain(ownChainText(caseId))
      expect(chain[2]).toMatchObject({
        type: 'member-revoke',
        memberInstallationId: B.installationId,
        schemaVersion: 4
      })
      const verification = expectCacheMatchesChain(caseId)
      expect(verification.members.find((m) => m.installationId === B.installationId)).toMatchObject(
        {
          revokedAt: 2
        }
      )
    })

    it('refuses a stranger, the Owner and a member already revoked', async () => {
      await revokeMember(caseId, B.installationId)
      const bytes = ownChainText(caseId)
      expect(await refused(() => revokeMember(caseId, C.installationId))).toBe('not-a-member')
      expect(await refused(() => revokeMember(caseId, A.installationId))).toBe(
        'owner-not-revocable'
      )
      expect(await refused(() => revokeMember(caseId, B.installationId))).toBe('already-revoked')
      expect(ownChainText(caseId)).toBe(bytes)
    })
  })

  describe('excludeExhibit', () => {
    beforeEach(async () => {
      await shareCase(caseId, { nodeId: 'node-alice' })
      await addMember(caseId, joiner(B))
    })

    it('excludes the Owner own Exhibit, and lists it in the walk', async () => {
      const doc = addDocument(caseId, A, 1)
      const exclusion = await excludeExhibit(caseId, doc.exhibitId, 'duplicate of AO-2')
      expect(exclusion).toMatchObject({
        exhibitId: doc.exhibitId,
        authorInstallationId: A.installationId,
        reason: 'duplicate of AO-2',
        operatorName: 'Alice Owner',
        index: 3
      })
      const line = parsedChain(ownChainText(caseId))[3]
      expect(line).toMatchObject({ type: 'exclude', schemaVersion: 4 })
      const verification = expectCacheMatchesChain(caseId)
      expect(verification.exclusions.map((e) => e.exhibitId)).toEqual([doc.exhibitId])
      expect(await refused(() => excludeExhibit(caseId, doc.exhibitId))).toBe('already-excluded')
    })

    it('excludes a Capture received from a member, naming that member as author', async () => {
      await bobHoldsCase()
      await activate(B)
      const bobDoc = addDocument(caseId, B, 1)
      const fromBob = recordSource(caseId, B)
      await activate(A)
      const result = await pull(caseId, fromBob)
      expect(result.errors).toEqual([])
      const exclusion = await excludeExhibit(caseId, bobDoc.exhibitId)
      expect(exclusion).toMatchObject({
        exhibitId: bobDoc.exhibitId,
        authorInstallationId: B.installationId
      })
      expect('reason' in exclusion).toBe(false)
      expectCacheMatchesChain(caseId)
    })

    it('refuses an Exhibit no chain holds, and one two chains hold', async () => {
      await bobHoldsCase()
      await activate(B)
      const bobDoc = addDocument(caseId, B, 1)
      const fromBob = recordSource(caseId, B)
      await activate(A)
      await pull(caseId, fromBob)
      const bytes = ownChainText(caseId)
      expect(await refused(() => excludeExhibit(caseId, 'nobody-wrote-this'))).toBe(
        'exhibit-not-found'
      )
      // The Owner's chain claiming Bob's Exhibit id as its own: two accepted
      // entries, and the walk could not say which the exclusion names.
      appendManifestEntry(caseDirOf(caseId), {
        type: 'exhibit',
        exhibitId: bobDoc.exhibitId,
        caseId,
        kind: 'document',
        origin: 'manual-upload',
        name: 'claimed.pdf',
        exhibitNumber: 7,
        path: `${caseId}/documents/claimed.pdf`,
        contentHash: 'c'.repeat(64),
        sizeBytes: 1,
        timestamp: '2026-10-02T09:00:00.000Z',
        operatorId: A.installationId,
        operatorName: 'Alice Owner',
        toolVersion: '0.0.0'
      })
      const after = ownChainText(caseId)
      expect(await refused(() => excludeExhibit(caseId, bobDoc.exhibitId))).toBe(
        'exhibit-ambiguous'
      )
      expect(ownChainText(caseId)).toBe(after)
      expect(after.startsWith(bytes)).toBe(true)
    })
  })

  describe('on a member installation', () => {
    it('refuses revoke and exclude with not-owner and changes nothing', async () => {
      await shareCase(caseId, { nodeId: 'node-alice' })
      await addMember(caseId, joiner(B))
      const aliceDoc = addDocument(caseId, A, 1)
      const fromAlice = recordSource(caseId, A)
      await bobHoldsCase()
      await activate(B)
      addDocument(caseId, B, 1)
      const result = await pull(caseId, fromAlice)
      expect(result.errors).toEqual([])
      expect(walk(caseId).valid).toBe(true)
      const bytes = ownChainText(caseId)
      const members = listCaseMembers(caseId)
      const files = listing(caseId)
      expect(await refused(() => revokeMember(caseId, A.installationId))).toBe('not-owner')
      expect(await refused(() => excludeExhibit(caseId, aliceDoc.exhibitId))).toBe('not-owner')
      expect(await refused(() => addMember(caseId, joiner(C)))).toBe('not-owner')
      expect(ownChainText(caseId)).toBe(bytes)
      expect(listCaseMembers(caseId)).toEqual(members)
      expect(listing(caseId)).toEqual(files)
    })

    it('refuses on a Case nobody shared with not-shared', async () => {
      expect(await refused(() => revokeMember(caseId, B.installationId))).toBe('not-shared')
      expect(await refused(() => excludeExhibit(caseId, 'x'))).toBe('not-shared')
      expect(ownChainText(caseId)).toBe('')
    })

    it('holds an empty chain for a third member it learns of in a session', async () => {
      await shareCase(caseId, { nodeId: 'node-alice' })
      await addMember(caseId, joiner(B))
      await addMember(caseId, joiner(C))
      const fromAlice = recordSource(caseId, A)
      await bobHoldsCase()
      await activate(B)
      const result = await pull(caseId, fromAlice)
      expect(result.errors).toEqual([])
      expect(listCaseMembers(caseId).map((m) => m.installationId)).toEqual([
        A.installationId,
        B.installationId,
        C.installationId
      ])
      const carolFile = join(caseDirOf(caseId), memberChainPath(C.installationId))
      expect(statSync(carolFile).size).toBe(0)
      expect(existsSync(join(caseDirOf(caseId), memberChainPath(B.installationId)))).toBe(false)
      const verification = walk(caseId)
      expect(verification.findings).toEqual([])
      expect(verification.localInstallationId).toBe(B.installationId)
    })
  })

  describe('new exhibit entries', () => {
    it('carry no memberCode, stamp 3, and cite under the writer member-add code', async () => {
      await shareCase(caseId, { nodeId: 'node-alice' })
      const source = join(root, 'statement.pdf')
      writeFileSync(source, Buffer.from('%PDF-1.4 statement'))
      const staged = await uploadToStaging(caseId, [source])
      const result = await commitStagedFiles(
        caseId,
        staged.map((row) => row.id)
      )
      expect(result.outcomes.map((o) => o.status)).toEqual(['committed'])
      const entry = parsedChain(ownChainText(caseId)).at(-1)!
      expect(entry.type).toBe('exhibit')
      expect('memberCode' in entry).toBe(false)
      expect(entry.schemaVersion).toBe(3)
      expect(ManifestEntrySchema.safeParse(entry).success).toBe(true)
      const verification = expectCacheMatchesChain(caseId)
      expect([...verification.citations.keys()]).toEqual(['AO-1'])
    })
  })

  describe('a Case holding an empty member chain', () => {
    const lifecycle = createCaptureLifecycle({
      selectorLifecycle: createSelectorLifecycle({ emitRematched: () => {} })
    })
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

    it('exports a package the verifier passes, and a Case Archive that imports', async () => {
      await shareCase(caseId, { nodeId: 'node-alice' })
      await addMember(caseId, joiner(B))
      const source = join(root, 'statement.pdf')
      writeFileSync(source, Buffer.from('%PDF-1.4 statement'))
      const staged = await uploadToStaging(caseId, [source])
      await commitStagedFiles(
        caseId,
        staged.map((row) => row.id)
      )
      const out = join(root, 'package.zip')
      await generateReport(caseId, options(out), lifecycle)
      const zip = readStoredZip(readFileSync(out))
      expect(zip.get(memberChainPath(B.installationId))).toEqual(Buffer.alloc(0))
      const dir = join(root, 'unpacked')
      for (const [name, bytes] of zip) {
        mkdirSync(dirname(join(dir, name)), { recursive: true })
        writeFileSync(join(dir, name), bytes)
      }
      const verified = verifyEvidencePackage(dir)
      expect(verified.checks.filter((check) => check.status === 'fail')).toEqual([])
      expect(verified.pass).toBe(true)

      const archive = join(root, 'case.birdbrain')
      await exportCaseArchive(caseId, archive)
      const { newCaseId, report } = await importCaseArchive(archive)
      expect(report.verification.chainValid).toBe(true)
      const forkDir = caseDirOf(newCaseId)
      const forked = readSharedCaseSnapshot(forkDir, readManifestSnapshot(forkDir)).verification!
      expect(forked.findings).toEqual([])
    })
  })

  describe('a fork shared again', () => {
    it('rosters only the new members, on the Owner and on a member after a session', async () => {
      // Alice shares with Bob; Bob forks the Case by importing his own archive
      // of it, so his new chain continues Alice's roster behind an import.
      await shareCase(caseId, { nodeId: 'node-alice' })
      await addMember(caseId, joiner(B))
      addDocument(caseId, A, 1)
      const fromAlice = recordSource(caseId, A)
      await bobHoldsCase()
      await activate(B)
      addDocument(caseId, B, 1)
      expect((await pull(caseId, fromAlice)).errors).toEqual([])
      const archive = join(root, 'fork.birdbrain')
      await exportCaseArchive(caseId, archive)
      const { newCaseId: forkId } = await importCaseArchive(archive)
      expect(listCaseMembers(forkId)).toEqual([])
      const history = parsedChain(ownChainText(forkId))
      expect(history.filter((e) => e.type === 'member-add')).toHaveLength(2)
      expect(history.at(-1)?.type).toBe('import')

      // Bob shares the fork: his roster, and only his, with a code Alice's
      // Case already used.
      const owner = await shareCase(forkId, { ownerMemberCode: 'AO', nodeId: 'node-bob' })
      expect(owner).toMatchObject({ installationId: B.installationId, role: 'owner' })
      await addMember(forkId, joiner(C))
      expect(listCaseMembers(forkId).map((m) => [m.installationId, m.memberCode])).toEqual([
        [B.installationId, 'AO'],
        [C.installationId, 'CM']
      ])
      const verification = expectCacheMatchesChain(forkId)
      expect(verification.lineage.map((l) => l.members.map((m) => m.memberCode))).toEqual([
        ['AO', 'BM']
      ])
      const fromBob = recordSource(forkId, B)

      // Carol joins the fork and syncs. Her cache starts as the roster the
      // welcome copies from Bob's, and holds nothing of the source Case's.
      const bobRoster = listCaseMembers(forkId)
      await activate(C)
      seedSharedCase(forkId, B, [])
      for (const member of bobRoster) upsertCaseMember(member)
      const result = await pull(forkId, fromBob)
      expect(result.errors).toEqual([])
      expect(listCaseMembers(forkId).map((m) => [m.installationId, m.memberCode])).toEqual([
        [B.installationId, 'AO'],
        [C.installationId, 'CM']
      ])
      expect(existsSync(join(caseDirOf(forkId), memberChainPath(A.installationId)))).toBe(false)
    })
  })
})
