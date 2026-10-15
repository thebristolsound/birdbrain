import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// A teammate's entry from a newer Birdbrain (#1512, ruling 3 of 2026-10-10):
// the chain stops before it with the `newer-version` kind, never a forged
// verdict, and resumes once this build can read it. The read ceiling is the
// only thing that separates the older build from the newer one on this path,
// so the ceiling is a mocked getter: the peer writes an entry one above the
// real ceiling, the dialer runs first with the real ceiling and then with the
// raised one. verify-core and the session are imported after a resetModules
// so they see the mock (the node project's setup files pull the constants in
// first, as manifestSchema4TooOld.test.ts explains).

const ceiling = vi.hoisted(() => ({ value: 0, real: 0 }))

vi.mock('@shared/constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shared/constants')>()
  ceiling.real = actual.MANIFEST_SCHEMA_VERSION
  ceiling.value = actual.MANIFEST_SCHEMA_VERSION + 1
  return {
    ...actual,
    get MANIFEST_SCHEMA_VERSION() {
      return ceiling.value
    }
  }
})

let peers: typeof import('../../../helpers/syncPeers')
let manifest: typeof import('@main/services/manifest')
let core: typeof import('@main/services/db/core')
let syncState: typeof import('@main/services/sharing/syncState')
let installation: typeof import('@main/services/installationId')
let signingKey: typeof import('@main/services/signingKey')

beforeAll(async () => {
  vi.resetModules()
  peers = await import('../../../helpers/syncPeers')
  manifest = await import('@main/services/manifest')
  core = await import('@main/services/db/core')
  syncState = await import('@main/services/sharing/syncState')
  installation = await import('@main/services/installationId')
  signingKey = await import('@main/services/signingKey')
})

const CASE_ID = '0196f7a2-aaaa-bbbb-cccc-000000000011'

describe('an entry from a newer schema (#1512)', () => {
  let root: string

  afterEach(() => {
    core.closeDatabase()
    installation.resetInstallationId()
    signingKey.resetSigningKey()
    ceiling.value = ceiling.real + 1
    rmSync(root, { recursive: true, force: true })
  })

  it('stops that member chain at the entry, records newer-version, and resumes after an upgrade', async () => {
    root = mkdtempSync(join(tmpdir(), 'bb-newer-version-'))
    const A = await peers.createPeer(root, 'alice', 'Alice Owner', 'AL')
    const B = await peers.createPeer(root, 'bob', 'Bob Member', 'BO')
    for (const peer of [A, B]) {
      await peers.activate(peer)
      peers.seedSharedCase(CASE_ID, A, [B])
    }

    // Alice, on the newer build, writes two ordinary entries, one the older
    // build cannot read, and one more after it.
    await peers.activate(A)
    peers.appendOwnChainLine(CASE_ID, peers.memberAddBody(CASE_ID, A, 'owner', A))
    peers.appendOwnChainLine(CASE_ID, peers.memberAddBody(CASE_ID, B, 'member', A))
    const before = peers.addDocument(CASE_ID, A, 1)
    const newer = manifest.appendManifestEntry(
      peers.caseDirOf(CASE_ID),
      {
        type: 'exhibit',
        exhibitId: 'from-the-future',
        caseId: CASE_ID,
        kind: 'document',
        origin: 'manual-upload',
        name: 'future.pdf',
        exhibitNumber: 2,
        path: `${CASE_ID}/documents/future.pdf`,
        contentHash: 'f'.repeat(64),
        sizeBytes: 1,
        timestamp: peers.TIME,
        operatorId: A.installationId,
        operatorName: A.operatorName,
        toolVersion: '9.0.0'
      },
      { minReaderSchemaVersion: ceiling.real + 1 }
    )
    expect(JSON.parse(newer.line).schemaVersion).toBe(ceiling.real + 1)
    const after = peers.addDocument(CASE_ID, A, 3)
    const ownerChain = peers.ownChainText(CASE_ID)
    const source = peers.recordSource(CASE_ID, A)

    // Bob runs the older build.
    ceiling.value = ceiling.real
    await peers.activate(B)
    const stopped = await peers.pull(CASE_ID, source)
    expect(stopped.errors).toEqual([
      {
        kind: 'newer-version',
        detail: expect.stringContaining(`entry ${newer.index} of ${A.installationId}`),
        installationId: A.installationId,
        index: newer.index
      }
    ])
    expect(stopped.errors[0].detail).toContain('verifier too old')
    expect(stopped.entriesReceived).toBe(newer.index)
    const held = peers.parsedChain(peers.memberChainText(CASE_ID, A))
    expect(held.map((e) => e.index)).toEqual([0, 1, before.index])
    expect(peers.mergeEntries(CASE_ID)).toHaveLength(1)
    expect(peers.mergeEntries(CASE_ID)[0].heads).toEqual([
      {
        installationId: A.installationId,
        index: before.index,
        entryHash: held[before.index].entryHash,
        entriesReceived: newer.index
      }
    ])
    expect(syncState.getSyncState(CASE_ID).lastError?.kind).toBe('newer-version')
    expect(syncState.getSyncState(CASE_ID).phase).toBe('error')

    // The same build asks for the same index again and stops again.
    const again = await peers.pull(CASE_ID, source)
    expect(again.errors[0]?.kind).toBe('newer-version')
    expect(again.entriesReceived).toBe(0)
    expect(peers.mergeEntries(CASE_ID)).toHaveLength(1)

    // Bob upgrades: the chain resumes at the entry and runs to the head.
    ceiling.value = ceiling.real + 1
    const resumed = await peers.pull(CASE_ID, source)
    expect(resumed.errors).toEqual([])
    expect(resumed.entriesReceived).toBe(2)
    expect(peers.memberChainText(CASE_ID, A)).toBe(ownerChain)
    expect(peers.mergeEntries(CASE_ID)).toHaveLength(2)
    expect(peers.mergeEntries(CASE_ID)[1].heads[0]).toMatchObject({
      installationId: A.installationId,
      index: after.index,
      entriesReceived: 2
    })
    expect(syncState.getSyncState(CASE_ID).phase).toBe('idle')
  })
})
