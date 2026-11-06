import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'crypto'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { closeDatabase } from '@main/services/db/core'
import { getCapture } from '@main/services/db/captureRepo'
import { resetInstallationId } from '@main/services/installationId'
import { resetSigningKey } from '@main/services/signingKey'
import { readManifestSnapshot, readSharedCaseSnapshot } from '@main/services/manifest'
import { defaultCaptureStore } from '@main/services/captureStore'
import { getStorageRoot } from '@main/services/storage'
import { createCaptureLifecycle, verifyCapture } from '@main/services/captureLifecycle'
import type { SelectorLifecycle } from '@main/services/selectorLifecycle'
import { resetSyncStateMemory } from '@main/services/sharing/syncState'
import { ManifestEntrySchema } from '@shared/schemas'
import {
  activate,
  appendOwnChainLine,
  caseDirOf,
  createPeer,
  memberAddBody,
  memberChainText,
  parsedChain,
  pull,
  recordSource,
  seedSharedCase,
  type Peer
} from '../../../helpers/syncPeers'

// The two-peer test of the clicked-Capture step (#1832; spec, step 4, "Done when"): a `launched`
// Capture that one member admits reaches another member, whose copy of the author's entry
// verifies, and the receiver's Shared Case walk passes. #1512 merged first, so this step adds it.

const CASE_ID = '0196f7a2-aaaa-bbbb-cccc-000000001832'

const sha = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

describe('a launched Capture between two members (#1832)', () => {
  let root: string
  let A: Peer
  let B: Peer

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'birdbrain-launched-sync-'))
    A = await createPeer(root, 'alice', 'Alice Owner', 'AL')
    B = await createPeer(root, 'bob', 'Bob Member', 'BO')
    for (const peer of [A, B]) {
      await activate(peer)
      seedSharedCase(CASE_ID, A, [B])
    }
    await activate(A)
    appendOwnChainLine(CASE_ID, memberAddBody(CASE_ID, A, 'owner', A))
    appendOwnChainLine(CASE_ID, memberAddBody(CASE_ID, B, 'member', A))
  })

  afterEach(() => {
    closeDatabase()
    resetInstallationId()
    resetSigningKey()
    resetSyncStateMemory()
    rmSync(root, { recursive: true, force: true })
  })

  it("verifies the author's launched entry at the receiver, and the receiver's walk passes", async () => {
    const record = Buffer.from('invented warc.gz bytes of a launched capture')
    const pdf = Buffer.from('%PDF-1.4 invented print of a launched capture')
    const lifecycle = createCaptureLifecycle({
      selectorLifecycle: { runActiveSelectorsForCapture: vi.fn() } as unknown as SelectorLifecycle,
      fetchTlsCertChain: async () => null,
      egressIsDirect: () => true
    })
    const outcome = await lifecycle.admit({
      route: 'launched',
      caseId: CASE_ID,
      url: 'https://example.com/alice/launched',
      title: 'Launched page',
      timestamp: '2026-11-05T12:00:00.000Z',
      captureId: crypto.randomUUID(),
      mhtml: Buffer.from('MIME-Version: 1.0\r\n\r\nlaunched page'),
      screenshot: Buffer.from('PNG launched screenshot'),
      textContent: 'launched page',
      httpStatus: 200,
      userAgent: 'Mozilla/5.0 launched',
      browser: { product: 'Chrome', version: '154.0.8037.97', family: 'chromium' },
      inventory: {
        mhtml: { present: true, pinnedImages: 0, pinnedImagesNotLoaded: 0 },
        transactionRecord: {
          present: true,
          exchanges: 3,
          cached: 0,
          cancelled: 0,
          failed: 0,
          inFlight: 0,
          finishedWithoutResponse: 0,
          bodiesOmitted: 1,
          incompleteRequestBodies: 0,
          webSockets: 0,
          recordedTargets: 1,
          unrecordedTargets: 0,
          replacedHeaders: ['cookie'],
          budget: { totalBytes: 50_000_000, resourceBytes: 10_000_000 },
          servedByServiceWorker: 0,
          requestBodiesWithheld: 1,
          httpCacheDisabled: true
        },
        screenshot: {
          present: true,
          scaled: false,
          truncated: false,
          trimmed: false,
          contentWidth: 1,
          contentHeight: 1,
          width: 1,
          height: 1
        },
        pdf: { present: true, afterCollection: true }
      },
      transactionRecord: record,
      boundTlsAbsent: 'not-reported',
      pdf
    })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    const captureId = outcome.capture.id
    const source = recordSource(CASE_ID, A)

    await activate(B)
    const result = await pull(CASE_ID, source)
    expect(result.errors).toEqual([])

    const entry = parsedChain(memberChainText(CASE_ID, A)).find(
      (e) => e.type === 'capture' && e.captureId === captureId
    )
    expect(ManifestEntrySchema.safeParse(entry).success).toBe(true)
    expect(entry).toMatchObject({
      method: 'launched',
      browserProduct: 'Chrome',
      browserVersion: '154.0.8037.97',
      browserFamily: 'chromium',
      transactionRecordHash: sha(record),
      pdfHash: sha(pdf),
      schemaVersion: 7
    })
    expect(getCapture(captureId)?.method).toBe('launched')
    expect((await verifyCapture(captureId)).status).toBe('verified')
    const recordPath = defaultCaptureStore.artifactPaths(CASE_ID, captureId, 'warc.gz').rel
    expect(sha(readFileSync(join(getStorageRoot(), recordPath)))).toBe(sha(record))

    const caseDir = caseDirOf(CASE_ID)
    const walk = readSharedCaseSnapshot(caseDir, readManifestSnapshot(caseDir)).verification
    expect(walk?.findings).toEqual([])
    expect(walk?.outcome).toBe('pass')
  })
})
