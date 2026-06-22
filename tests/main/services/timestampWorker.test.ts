import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createHash } from 'crypto'
import { initStorage, ensureCaseDir, getStorageRoot } from '@main/services/storage'
import {
  initDatabase,
  closeDatabase,
  createCase,
  insertCapture,
  getCapture,
  getDb,
  setCaptureTrustedTime
} from '@main/services/database'
import { initManifest, appendManifestEntry } from '@main/services/manifest'
import { resolveTrustedTime } from '@main/services/trustedTime'
import { initSettings, updateSettings } from '@main/services/settings'
import { initInstallationId, resetInstallationId } from '@main/services/installationId'
import { createTimestampWorker } from '@main/services/timestampWorker'
import { buildSyntheticToken } from '../../helpers/timestampFixtures'

function flushImmediate(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

describe('timestampWorker', () => {
  let tempDir: string
  let caseId: string
  let caseDir: string

  // A capture present both in the DB and as a v2 capture entry in the manifest.
  function seedCapture(content: string): { id: string; hash: string } {
    const hash = createHash('sha256').update(content).digest('hex')
    const cap = insertCapture({
      caseId,
      url: 'https://example.com/' + hash.slice(0, 8),
      title: content,
      hash,
      timestamp: '2026-05-30T09:00:00.000Z',
      format: 'mhtml'
    })
    appendManifestEntry(caseDir, {
      type: 'capture',
      captureId: cap.id,
      caseId,
      url: cap.url,
      timestamp: cap.timestamp,
      contentHash: hash,
      sizeBytes: 1,
      operatorId: 'op-1',
      operatorName: 'Op',
      toolVersion: '0.1.0'
    })
    setCaptureTrustedTime(cap.id, 'pending')
    return { id: cap.id, hash }
  }

  // A token requester that fakes the TSA: returns a valid token over the same
  // hash it is asked to stamp.
  function grantingRequester(genTime = new Date('2026-05-30T09:05:00.000Z')) {
    return vi.fn(async (contentHash: string) =>
      buildSyntheticToken({ contentHash, genTime, tsaDnsName: 'tsa.example.com' })
    )
  }

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-tsworker-'))
    initStorage(join(tempDir, 'captures'))
    initDatabase(':memory:')
    initSettings(tempDir)
    updateSettings({ tsaUrl: 'http://tsa.example.com', operatorName: 'Op' })
    initInstallationId(tempDir)
    caseId = createCase({ name: 'TS Worker' }).id
    caseDir = join(getStorageRoot(), caseId)
    ensureCaseDir(caseId)
    initManifest(caseDir)
  })

  afterEach(() => {
    closeDatabase()
    resetInstallationId()
    rmSync(tempDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('offline: a TSA failure leaves the capture pending with no timestamp entry', async () => {
    const { id, hash } = seedCapture('offline-bytes')
    const requestToken = vi.fn(async () => {
      throw new Error('ENOTFOUND tsa.example.com')
    })
    const worker = createTimestampWorker({ requestToken })

    const result = await worker.processPending()

    expect(result.failed).toBe(1)
    expect(result.stamped).toBe(0)
    expect(getCapture(id)?.trustedTimeStatus).toBe('pending')
    expect(resolveTrustedTime(caseDir, hash).trustedTime).toBe('pending')
  })

  it('reconnect: a later success stamps the pending capture (rfc3161)', async () => {
    const { id, hash } = seedCapture('reconnect-bytes')
    const requestToken = grantingRequester()
    const worker = createTimestampWorker({ requestToken })

    const result = await worker.processPending()

    expect(result.stamped).toBe(1)
    expect(requestToken).toHaveBeenCalledWith(hash, 'http://tsa.example.com')
    expect(getCapture(id)?.trustedTimeStatus).toBe('rfc3161')
    const resolved = resolveTrustedTime(caseDir, hash)
    expect(resolved.trustedTime).toBe('rfc3161')
    expect(resolved.tsaName).toBe('tsa.example.com')
  })

  it('rejects a token whose imprint does not match the capture (stays pending)', async () => {
    const { id, hash } = seedCapture('mismatch-bytes')
    // TSA hands back a token over the wrong content — must not be accepted.
    const requestToken = vi.fn(async () =>
      buildSyntheticToken({
        contentHash: createHash('sha256').update('something-else').digest('hex'),
        genTime: new Date('2026-05-30T09:05:00.000Z')
      })
    )
    const worker = createTimestampWorker({ requestToken })

    const result = await worker.processPending()

    expect(result.stamped).toBe(0)
    expect(getCapture(id)?.trustedTimeStatus).toBe('pending')
    expect(resolveTrustedTime(caseDir, hash).trustedTime).toBe('pending')
  })

  it('enqueue stamps a capture asynchronously without blocking the caller', async () => {
    const { id, hash } = seedCapture('enqueue-bytes')
    const worker = createTimestampWorker({ requestToken: grantingRequester() })

    worker.enqueue(id)
    // Returns immediately; the capture is queued pending.
    expect(getCapture(id)?.trustedTimeStatus).toBe('pending')

    await flushImmediate()
    await flushImmediate()

    expect(resolveTrustedTime(caseDir, hash).trustedTime).toBe('rfc3161')
  })

  it('does not double-stamp a capture under concurrent attempts', async () => {
    const { id, hash } = seedCapture('concurrent-bytes')
    const worker = createTimestampWorker({ requestToken: grantingRequester() })

    // Two attempts race (e.g. capture-path enqueue + the retry loop).
    await Promise.all([worker.stampCapture(id), worker.stampCapture(id)])

    expect(resolveTrustedTime(caseDir, hash).trustedTime).toBe('rfc3161')
    // Exactly one timestamp entry should land in the manifest, not two.
    const timestampEntries = readFileSync(join(caseDir, 'manifest.jsonl'), 'utf-8')
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l))
      .filter((e) => e.type === 'timestamp' && e.captureContentHash === hash)
    expect(timestampEntries).toHaveLength(1)
  })

  it('rebuilds the mirror column from the manifest alone', async () => {
    const stamped = seedCapture('rebuild-stamped')
    const pending = seedCapture('rebuild-pending')
    const worker = createTimestampWorker({ requestToken: grantingRequester() })

    // Stamp only the first capture, then wipe the whole mirror column.
    await worker.stampCapture(stamped.id)
    getDb().prepare('UPDATE captures SET trusted_time_status = NULL').run()

    worker.rebuildMirror()

    // Reconstructed purely from the manifest: stamped → rfc3161, other → pending.
    expect(getCapture(stamped.id)?.trustedTimeStatus).toBe('rfc3161')
    expect(getCapture(pending.id)?.trustedTimeStatus).toBe('pending')
  })
})
