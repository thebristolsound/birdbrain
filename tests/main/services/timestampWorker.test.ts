import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createHash } from 'crypto'
import { initStorage, ensureCaseDir, getStorageRoot } from '@main/services/storage'
import { initDatabase, closeDatabase, getDb } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { insertCapture, getCapture, setCaptureTrustedTime } from '@main/services/db/captureRepo'
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

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-tsworker-'))
    initStorage(join(tempDir, 'captures'))
    await initDatabase(':memory:')
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

  // #1169. The privacy property the opt-out exists for is negative — that
  // nothing leaves the process — so every test below injects a requester that
  // fails the test by being called at all, rather than asserting on what it
  // returned.
  describe('with trusted timestamping declined (tsaEnabled=false)', () => {
    function refusingRequester() {
      return vi.fn(async () => {
        throw new Error('a TSA request was issued while timestamping was declined')
      })
    }

    beforeEach(() => {
      updateSettings({ tsaEnabled: false })
    })

    it('issues no TSA request when a freshly ingested capture is enqueued', async () => {
      const { id, hash } = seedCapture('declined-enqueue')
      const requestToken = refusingRequester()
      const worker = createTimestampWorker({ requestToken })

      worker.enqueue(id)
      await flushImmediate()
      await flushImmediate()

      expect(requestToken).not.toHaveBeenCalled()
      // The mirror still tracks the manifest, which resolves 'pending' for any
      // v2 capture entry carrying no token. Writing anything else would make the
      // cache disagree with the authoritative record and would hide the capture
      // from the queue if the operator turns timestamping back on.
      expect(getCapture(id)?.trustedTimeStatus).toBe('pending')
      expect(resolveTrustedTime(caseDir, hash).trustedTime).toBe('pending')
    })

    it('issues no TSA request from the retry loop, and counts no failures', async () => {
      seedCapture('declined-retry-a')
      seedCapture('declined-retry-b')
      const requestToken = refusingRequester()
      const worker = createTimestampWorker({ requestToken })

      const result = await worker.processPending()

      expect(requestToken).not.toHaveBeenCalled()
      // Nothing was attempted, so nothing failed: a failure count here would
      // report an outage for a state the operator chose.
      expect(result).toEqual({ stamped: 0, failed: 0 })
    })

    it('issues no TSA request when stampCapture is called directly', async () => {
      const { id, hash } = seedCapture('declined-direct')
      const requestToken = refusingRequester()
      const worker = createTimestampWorker({ requestToken })

      expect(await worker.stampCapture(id)).toBe(false)

      expect(requestToken).not.toHaveBeenCalled()
      expect(resolveTrustedTime(caseDir, hash).trustedTime).toBe('pending')
      const entries = readFileSync(join(caseDir, 'manifest.jsonl'), 'utf-8')
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as { type: string })
      expect(entries.some((entry) => entry.type === 'timestamp')).toBe(false)
    })

    it('stamps the captures made while it was off once it is turned back on', async () => {
      const { id, hash } = seedCapture('declined-then-resumed')
      const requestToken = grantingRequester()
      const worker = createTimestampWorker({ requestToken })

      worker.enqueue(id)
      await flushImmediate()
      await flushImmediate()
      expect(requestToken).not.toHaveBeenCalled()

      updateSettings({ tsaEnabled: true })
      const result = await worker.processPending()

      expect(result.stamped).toBe(1)
      expect(resolveTrustedTime(caseDir, hash).trustedTime).toBe('rfc3161')
    })
  })

  // Known-answer test over the stamping method itself (#1169 evidence gate).
  // The input is the committed DigiCert token and the digest it attests; the
  // answer is the manifest entry the worker writes and the axis that resolves
  // from it. Pinned both ways round the opt-out, so a change to the gate that
  // perturbed token handling — a re-encode, a different base64 round trip, a
  // dropped field — fails here rather than in front of a third party.
  describe('known answer: a real DigiCert token, either side of the opt-out', () => {
    const DIGICERT_IMPRINT = readFileSync(
      join(process.cwd(), 'tests/fixtures/timestamp/content-hash.txt'),
      'utf-8'
    ).trim()
    const DIGICERT_TOKEN = readFileSync(
      join(process.cwd(), 'tests/fixtures/timestamp/digicert-token.der')
    )

    // The token's preimage was never kept, so the capture is recorded as holding
    // exactly the digest the token attests — the same device the export test
    // uses to get a genuine commercial token onto a capture.
    function seedDigicertCapture(): string {
      const cap = insertCapture({
        caseId,
        url: 'https://example.com/digicert',
        title: 'DigiCert KAT',
        hash: DIGICERT_IMPRINT,
        timestamp: '2026-05-30T09:00:00.000Z',
        format: 'mhtml'
      })
      appendManifestEntry(caseDir, {
        type: 'capture',
        captureId: cap.id,
        caseId,
        url: cap.url,
        timestamp: cap.timestamp,
        contentHash: DIGICERT_IMPRINT,
        sizeBytes: 1,
        operatorId: 'op-1',
        operatorName: 'Op',
        toolVersion: '0.1.0'
      })
      setCaptureTrustedTime(cap.id, 'pending')
      return cap.id
    }

    function timestampEntries(): Array<Record<string, unknown>> {
      return readFileSync(join(caseDir, 'manifest.jsonl'), 'utf-8')
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .filter((entry) => entry.type === 'timestamp')
    }

    it('enabled: retains the token verbatim and resolves the answer off it', async () => {
      const id = seedDigicertCapture()
      const worker = createTimestampWorker({ requestToken: vi.fn(async () => DIGICERT_TOKEN) })

      expect(await worker.stampCapture(id)).toBe(true)

      const entries = timestampEntries()
      expect(entries).toHaveLength(1)
      expect(entries[0].captureContentHash).toBe(DIGICERT_IMPRINT)
      // Byte-for-byte: the retained token is the one the authority signed.
      expect(entries[0].tsaToken).toBe(DIGICERT_TOKEN.toString('base64'))

      const resolved = resolveTrustedTime(caseDir, DIGICERT_IMPRINT)
      expect(resolved.trustedTime).toBe('rfc3161')
      expect(resolved.tsaName).toBe('DigiCert SHA256 RSA4096 Timestamp Responder 2025 1')
      expect(resolved.stampedAt).toBe('2026-05-30T19:31:07.000Z')
    })

    it('declined: the same input yields no entry and no request', async () => {
      const id = seedDigicertCapture()
      updateSettings({ tsaEnabled: false })
      const requestToken = vi.fn(async () => DIGICERT_TOKEN)
      const worker = createTimestampWorker({ requestToken })

      expect(await worker.stampCapture(id)).toBe(false)

      expect(requestToken).not.toHaveBeenCalled()
      expect(timestampEntries()).toHaveLength(0)
      expect(resolveTrustedTime(caseDir, DIGICERT_IMPRINT).trustedTime).toBe('pending')
    })
  })
})
