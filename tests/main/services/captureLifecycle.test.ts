import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, chmodSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { Readable } from 'stream'
import { createHash } from 'crypto'
import { initStorage, ensureCaseDir, getStorageRoot } from '@main/services/storage'
import { initDatabase, closeDatabase, getDb } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import * as captureRepo from '@main/services/db/captureRepo'
import { getCapture, insertCapture, listCaptures } from '@main/services/db/captureRepo'
import {
  initManifest,
  verifyManifestChain,
  appendManifestEntry,
  getManifestHead
} from '@main/services/manifest'
import { createCaptureStore } from '@main/services/captureStore'
import type { CaptureStore } from '@main/services/captureStore'
import type { BatchDeleteOutcome } from '@shared/ipc'
import type { Capture } from '@shared/types'
import { buildSyntheticToken } from '../../helpers/timestampFixtures'
import { createCaptureLifecycle, BatchCrossCaseError } from '@main/services/captureLifecycle'
import type { SelectorLifecycle } from '@main/services/selectorLifecycle'
import { initInstallationId, resetInstallationId } from '@main/services/installationId'
import { initSettings, updateSettings } from '@main/services/settings'
import {
  disposeLogger,
  flushSync as flushLogger,
  initLogger,
  readRecentEntries
} from '@main/services/logger'

// Keep ingest tests hermetic: the corroboration-only TLS re-fetch (#123) would
// otherwise open a real socket to https://example.com on every ingest. Default
// it to "nothing to corroborate" (null); the dedicated #123 tests below inject
// their own stub via createCaptureLifecycle({ fetchTlsCertChain }).
vi.mock('@main/services/tlsCertChain', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/services/tlsCertChain')>()
  return { ...actual, fetchCertChain: vi.fn(async () => null) }
})

// Flushes the setImmediate queue so post-capture work scheduled by
// runPostCaptureWork has time to run before we assert.
function flushImmediate(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve))
}

function buildIngestParams(
  caseId: string,
  body: Buffer | Readable,
  overrides: Record<string, unknown> = {}
) {
  const stream = Buffer.isBuffer(body) ? Readable.from([body]) : body
  return {
    caseId,
    url: 'https://example.com',
    title: 'Example',
    timestamp: '2026-04-05T12:00:00.000Z',
    stream: stream as unknown as ReadableStream<Uint8Array>,
    textContent: 'hello extracted text',
    headers: { 'content-type': 'text/html' },
    browserVersion: 'Chrome/120',
    userAgent: 'Mozilla/5.0',
    httpStatus: 200,
    extensionVersion: '0.1.0',
    operatorId: 'op-1',
    operatorName: 'Smith',
    toolVersion: '0.1.0',
    ...overrides
  }
}

describe('createCaptureLifecycle.ingest', () => {
  let tempDir: string
  let caseId: string
  let selectorStub: SelectorLifecycle
  let runActive: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-lifecycle-'))
    initStorage(join(tempDir, 'captures'))
    await initDatabase(':memory:')
    caseId = createCase({ name: 'Lifecycle' }).id
    ensureCaseDir(caseId)
    initManifest(join(tempDir, 'captures', caseId))
    runActive = vi.fn()
    // Minimal SelectorLifecycle stub — captureLifecycle only ever calls
    // runActiveSelectorsForCapture on it; other methods are unused here.
    selectorStub = { runActiveSelectorsForCapture: runActive } as unknown as SelectorLifecycle
    initLogger(tempDir, 'capture-lifecycle-test-session')
  })

  afterEach(() => {
    disposeLogger()
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('returns the ingested capture and inserts a manifest entry + DB row', async () => {
    const lifecycle = createCaptureLifecycle({ selectorLifecycle: selectorStub })
    const body = Buffer.from('From: <Saved by Chrome>\nContent-Type: multipart/related\n\nhello')
    const result = await lifecycle.ingest(buildIngestParams(caseId, body))

    expect(result.capture.format).toBe('mhtml')
    expect(result.capture.hash).toBe(result.contentHash)
    expect(getCapture(result.capture.id)?.id).toBe(result.capture.id)
    expect(verifyManifestChain(join(tempDir, 'captures', caseId)).valid).toBe(true)
  })

  it('records screenshotHash + textHash in the manifest body and DB, and the chain still verifies (#118)', async () => {
    const { createHash } = await import('crypto')
    const { readFileSync } = await import('fs')
    const lifecycle = createCaptureLifecycle({ selectorLifecycle: selectorStub })
    const screenshot = Buffer.from('PNG-screenshot-bytes')
    const textContent = 'hello extracted text'
    const { capture } = await lifecycle.ingest(
      buildIngestParams(caseId, Buffer.from('mhtml-body'), { screenshot, textContent })
    )

    const expectedScreenshotHash = createHash('sha256').update(screenshot).digest('hex')
    const expectedTextHash = createHash('sha256')
      .update(Buffer.from(textContent, 'utf-8'))
      .digest('hex')

    // DB mirror
    expect(getCapture(capture.id)?.screenshotHash).toBe(expectedScreenshotHash)
    expect(getCapture(capture.id)?.textHash).toBe(expectedTextHash)

    // Manifest body carries the same hashes and the chain verifies (entryHash +
    // signature cover the v2 body including the new fields).
    const manifestPath = join(tempDir, 'captures', caseId, 'manifest.jsonl')
    const lines = readFileSync(manifestPath, 'utf-8')
      .split('\n')
      .filter((l) => l.trim().length > 0)
    const captureEntry = JSON.parse(lines[lines.length - 1])
    expect(captureEntry.screenshotHash).toBe(expectedScreenshotHash)
    expect(captureEntry.textHash).toBe(expectedTextHash)
    expect(verifyManifestChain(join(tempDir, 'captures', caseId)).valid).toBe(true)
  })

  it('OMITS screenshotHash/textHash from the manifest body when absent (#118 backward-compat)', async () => {
    const { readFileSync } = await import('fs')
    const lifecycle = createCaptureLifecycle({ selectorLifecycle: selectorStub })
    const { capture } = await lifecycle.ingest(
      buildIngestParams(caseId, Buffer.from('mhtml-body'), { textContent: '' })
    )

    const manifestPath = join(tempDir, 'captures', caseId, 'manifest.jsonl')
    const lines = readFileSync(manifestPath, 'utf-8')
      .split('\n')
      .filter((l) => l.trim().length > 0)
    const captureEntry = JSON.parse(lines[lines.length - 1])
    // OMITTED, not '' / null — so legacy/no-artifact canonical bodies are unchanged.
    expect('screenshotHash' in captureEntry).toBe(false)
    expect('textHash' in captureEntry).toBe(false)
    expect(getCapture(capture.id)?.screenshotHash).toBeUndefined()
    expect(getCapture(capture.id)?.textHash).toBeUndefined()
    expect(verifyManifestChain(join(tempDir, 'captures', caseId)).valid).toBe(true)
  })

  it('persists headers to the DB and anchors them in the manifest body, chain still verifies (#119)', async () => {
    const { readFileSync } = await import('fs')
    const lifecycle = createCaptureLifecycle({ selectorLifecycle: selectorStub })
    const headers = { server: 'nginx', date: 'Wed, 21 Jun 2026 12:00:00 GMT' }
    const { capture } = await lifecycle.ingest(
      buildIngestParams(caseId, Buffer.from('mhtml-body'), { headers })
    )

    // (a) DB mirror
    expect(JSON.parse(getCapture(capture.id)!.headers!)).toEqual(headers)

    // (b) Manifest body carries the headers
    const manifestPath = join(tempDir, 'captures', caseId, 'manifest.jsonl')
    const lines = readFileSync(manifestPath, 'utf-8')
      .split('\n')
      .filter((l) => l.trim().length > 0)
    const captureEntry = JSON.parse(lines[lines.length - 1])
    expect(captureEntry.headers).toEqual(headers)
    // (d) specific keys survive server→lifecycle→manifest
    expect(captureEntry.headers.server).toBe('nginx')
    expect(captureEntry.headers.date).toBe('Wed, 21 Jun 2026 12:00:00 GMT')

    // (c) chain re-verifies (recomputed entryHash + signature cover the headers)
    expect(verifyManifestChain(join(tempDir, 'captures', caseId)).valid).toBe(true)
  })

  it('OMITS headers from the manifest body when empty, keeping v1-equivalent entries (#119)', async () => {
    const { readFileSync } = await import('fs')
    const lifecycle = createCaptureLifecycle({ selectorLifecycle: selectorStub })
    const { capture } = await lifecycle.ingest(
      buildIngestParams(caseId, Buffer.from('mhtml-body'), { headers: {} })
    )

    const manifestPath = join(tempDir, 'captures', caseId, 'manifest.jsonl')
    const lines = readFileSync(manifestPath, 'utf-8')
      .split('\n')
      .filter((l) => l.trim().length > 0)
    const captureEntry = JSON.parse(lines[lines.length - 1])
    // OMITTED from the signed body, not {} / null — so headerless canonical
    // bodies (and their chain hashes) are unchanged from v1.
    expect('headers' in captureEntry).toBe(false)
    expect(capture.id).toBeTruthy()
    expect(verifyManifestChain(join(tempDir, 'captures', caseId)).valid).toBe(true)
  })

  it('persists the TLS cert chain on the DB row, anchors it in the manifest body, and the chain still verifies (#123)', async () => {
    const { readFileSync } = await import('fs')
    const tls = {
      url: 'https://example.com',
      refetchedAt: '2026-04-05T12:00:05.000Z',
      chain: [
        {
          subject: 'CN=example.com',
          issuer: 'CN=Example CA',
          validFrom: 'Jan  1 00:00:00 2026 GMT',
          validTo: 'Jan  1 00:00:00 2027 GMT',
          fingerprint256: 'AA:BB:CC',
          serialNumber: '01',
          subjectAltNames: ['DNS:example.com', 'DNS:www.example.com']
        }
      ]
    }
    const fetchTlsCertChain = vi.fn(async () => tls)
    const lifecycle = createCaptureLifecycle({ selectorLifecycle: selectorStub, fetchTlsCertChain })
    const { capture } = await lifecycle.ingest(buildIngestParams(caseId, Buffer.from('mhtml-body')))

    // (a) re-fetcher was invoked with the captured URL
    expect(fetchTlsCertChain).toHaveBeenCalledWith('https://example.com')

    // (b) DB mirror carries the parsed chain
    expect(getCapture(capture.id)?.tlsCertChain).toEqual(tls)

    // (c) manifest body anchors the chain and the signed chain still verifies
    const manifestPath = join(tempDir, 'captures', caseId, 'manifest.jsonl')
    const lines = readFileSync(manifestPath, 'utf-8')
      .split('\n')
      .filter((l) => l.trim().length > 0)
    const captureEntry = JSON.parse(lines[lines.length - 1])
    expect(captureEntry.tls).toEqual(tls)
    expect(verifyManifestChain(join(tempDir, 'captures', caseId)).valid).toBe(true)
  })

  it('records a fail-soft TLS error marker without failing the capture (#123)', async () => {
    const tls = {
      url: 'https://example.com',
      refetchedAt: '2026-04-05T12:00:05.000Z',
      error: 'connect ECONNREFUSED'
    }
    const fetchTlsCertChain = vi.fn(async () => tls)
    const lifecycle = createCaptureLifecycle({ selectorLifecycle: selectorStub, fetchTlsCertChain })
    const { capture } = await lifecycle.ingest(buildIngestParams(caseId, Buffer.from('mhtml-body')))

    expect(getCapture(capture.id)?.tlsCertChain).toEqual(tls)
    expect(verifyManifestChain(join(tempDir, 'captures', caseId)).valid).toBe(true)
  })

  it('never fails the capture when the TLS re-fetcher itself throws (#123 fail-soft)', async () => {
    const fetchTlsCertChain = vi.fn(async () => {
      throw new Error('boom')
    })
    const lifecycle = createCaptureLifecycle({ selectorLifecycle: selectorStub, fetchTlsCertChain })
    const { capture } = await lifecycle.ingest(buildIngestParams(caseId, Buffer.from('mhtml-body')))

    expect(capture.id).toBeTruthy()
    expect(getCapture(capture.id)?.tlsCertChain).toBeUndefined()
    expect(verifyManifestChain(join(tempDir, 'captures', caseId)).valid).toBe(true)
  })

  it('OMITS the tls field from the manifest body when no cert chain is recorded (#123 backward-compat)', async () => {
    const { readFileSync } = await import('fs')
    // Default mocked fetcher returns null → nothing to corroborate.
    const lifecycle = createCaptureLifecycle({ selectorLifecycle: selectorStub })
    const { capture } = await lifecycle.ingest(buildIngestParams(caseId, Buffer.from('mhtml-body')))

    const manifestPath = join(tempDir, 'captures', caseId, 'manifest.jsonl')
    const lines = readFileSync(manifestPath, 'utf-8')
      .split('\n')
      .filter((l) => l.trim().length > 0)
    const captureEntry = JSON.parse(lines[lines.length - 1])
    // OMITTED, not null — so cert-less canonical bodies (and chain hashes) are
    // identical to pre-#123 entries.
    expect('tls' in captureEntry).toBe(false)
    expect(getCapture(capture.id)?.tlsCertChain).toBeUndefined()
    expect(verifyManifestChain(join(tempDir, 'captures', caseId)).valid).toBe(true)
  })

  it('records background method and supersedes link end-to-end', async () => {
    const lifecycle = createCaptureLifecycle({ selectorLifecycle: selectorStub })
    const original = await lifecycle.ingest(buildIngestParams(caseId, Buffer.from('original')))
    const params = buildIngestParams(caseId, Buffer.from('recaptured'), {
      method: 'background',
      supersedesCaptureId: original.capture.id,
      extensionVersion: undefined
    })
    const result = await lifecycle.ingest(params)
    expect(result.capture.method).toBe('background')
    expect(result.capture.supersedesCaptureId).toBe(original.capture.id)
    expect(result.capture.extensionVersion).toBeUndefined()
    expect(verifyManifestChain(join(tempDir, 'captures', caseId)).valid).toBe(true)
  })

  it('enqueues the ingested capture for trusted timestamping', async () => {
    const enqueueTimestamp = vi.fn()
    const lifecycle = createCaptureLifecycle({ selectorLifecycle: selectorStub, enqueueTimestamp })
    const body = Buffer.from('mhtml-body')
    const { capture } = await lifecycle.ingest(buildIngestParams(caseId, body))

    expect(enqueueTimestamp).toHaveBeenCalledWith(capture.id)
  })

  it('invokes selectorLifecycle.runActiveSelectorsForCapture on the next tick when textContent is provided', async () => {
    const lifecycle = createCaptureLifecycle({ selectorLifecycle: selectorStub })
    const body = Buffer.from('mhtml-body')
    const { capture } = await lifecycle.ingest(buildIngestParams(caseId, body))

    // The hook is scheduled via setImmediate — must not have fired synchronously.
    expect(runActive).not.toHaveBeenCalled()

    await flushImmediate()

    expect(runActive).toHaveBeenCalledTimes(1)
    expect(runActive).toHaveBeenCalledWith(capture.id, caseId, 'hello extracted text')
  })

  it('does NOT invoke selectorLifecycle when textContent is empty', async () => {
    const lifecycle = createCaptureLifecycle({ selectorLifecycle: selectorStub })
    const body = Buffer.from('mhtml-body')
    await lifecycle.ingest(buildIngestParams(caseId, body, { textContent: '' }))

    await flushImmediate()
    expect(runActive).not.toHaveBeenCalled()
  })

  it('swallows a throwing selectorLifecycle and does not unhandled-reject ingest', async () => {
    runActive.mockImplementation(() => {
      throw new Error('selector engine exploded')
    })
    const lifecycle = createCaptureLifecycle({ selectorLifecycle: selectorStub })
    const body = Buffer.from('mhtml-body')

    const result = await lifecycle.ingest(buildIngestParams(caseId, body))
    await flushImmediate()

    expect(result.capture.id).toBeTruthy()
    expect(getCapture(result.capture.id)?.id).toBe(result.capture.id)
    flushLogger()
    const entries = readRecentEntries(10)
    expect(
      entries.some(
        (e) =>
          e.source === 'captureLifecycle' && e.code === 'captureLifecycle.selector_match_failed'
      )
    ).toBe(true)
  })

  it('rejects and leaves no DB row, manifest entry, or file on disk when the upload stream errors mid-read', async () => {
    const lifecycle = createCaptureLifecycle({ selectorLifecycle: selectorStub })

    async function* erroringStream() {
      yield new Uint8Array(Buffer.from('partial-bytes-'))
      throw new Error('simulated network drop')
    }
    const stream = Readable.from(erroringStream())

    await expect(lifecycle.ingest(buildIngestParams(caseId, stream))).rejects.toThrow(
      /simulated network drop/
    )

    expect(listCaptures(caseId)).toHaveLength(0)
    expect(verifyManifestChain(join(tempDir, 'captures', caseId)).valid).toBe(true)
    expect(verifyManifestChain(join(tempDir, 'captures', caseId)).trustedTimes.size).toBe(0)

    // No mhtml file should exist for any capture id in the case dir.
    const caseDir = join(getStorageRoot(), caseId)
    expect(existsSync(caseDir)).toBe(true)
    const { readdirSync } = await import('fs')
    const files = readdirSync(caseDir).filter((f) => f.endsWith('.mhtml'))
    expect(files).toEqual([])
  })
})

describe('createCaptureLifecycle.delete', () => {
  let tempDir: string
  let caseId: string
  let selectorStub: SelectorLifecycle

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-lifecycle-del-'))
    initStorage(join(tempDir, 'captures'))
    await initDatabase(':memory:')
    initSettings(tempDir)
    updateSettings({ operatorName: 'Test Operator' })
    resetInstallationId()
    initInstallationId(tempDir)
    caseId = createCase({ name: 'Del' }).id
    ensureCaseDir(caseId)
    initManifest(join(tempDir, 'captures', caseId))
    selectorStub = { runActiveSelectorsForCapture: vi.fn() } as unknown as SelectorLifecycle
  })

  afterEach(() => {
    closeDatabase()
    resetInstallationId()
    rmSync(tempDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('returns false when the capture does not exist (no manifest activity)', async () => {
    const lifecycle = createCaptureLifecycle({ selectorLifecycle: selectorStub })
    const result = await lifecycle.delete('does-not-exist')
    expect(result).toBe(false)
    expect(verifyManifestChain(join(tempDir, 'captures', caseId)).valid).toBe(true)
  })

  it('deletes legacy (non-mhtml) captures via the plain DB path and bypasses the deletion-manifest wrapper', async () => {
    const legacy = insertCapture({
      caseId,
      url: 'https://legacy.example.com',
      title: 'Legacy',
      hash: 'x'.repeat(64),
      timestamp: '2026-04-05T12:00:00.000Z'
    })
    const lifecycle = createCaptureLifecycle({ selectorLifecycle: selectorStub })

    const result = await lifecycle.delete(legacy.id)

    expect(result).toBe(true)
    expect(getCapture(legacy.id)).toBeUndefined()
    // No deletion entry should have been appended to the manifest.
    expect(verifyManifestChain(join(tempDir, 'captures', caseId)).valid).toBe(true)
  })

  it('deletes an MHTML capture end-to-end, removing files and appending a deletion manifest entry', async () => {
    const lifecycle = createCaptureLifecycle({ selectorLifecycle: selectorStub })
    const { capture } = await lifecycle.ingest(buildIngestParams(caseId, Buffer.from('mhtml-body')))
    expect(existsSync(join(getStorageRoot(), capture.mhtmlPath!))).toBe(true)

    const result = await lifecycle.delete(capture.id)

    expect(result).toBe(true)
    expect(getCapture(capture.id)).toBeUndefined()
    expect(existsSync(join(getStorageRoot(), capture.mhtmlPath!))).toBe(false)
    expect(verifyManifestChain(join(tempDir, 'captures', caseId)).valid).toBe(true)
  })
})

describe('createCaptureLifecycle.deleteMany (#394)', () => {
  let tempDir: string
  let caseId: string
  let caseDir: string
  let selectorStub: SelectorLifecycle

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-lifecycle-batch-'))
    initStorage(join(tempDir, 'captures'))
    await initDatabase(':memory:')
    initSettings(tempDir)
    updateSettings({ operatorName: 'Test Operator' })
    resetInstallationId()
    initInstallationId(tempDir)
    caseId = createCase({ name: 'Batch' }).id
    ensureCaseDir(caseId)
    caseDir = join(tempDir, 'captures', caseId)
    initManifest(caseDir)
    selectorStub = { runActiveSelectorsForCapture: vi.fn() } as unknown as SelectorLifecycle
  })

  afterEach(() => {
    closeDatabase()
    resetInstallationId()
    rmSync(tempDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  // Parsed manifest lines, for asserting chain length and entry order.
  function manifestEntries(): Array<{ type: string; captureId?: string; index: number }> {
    return readFileSync(join(caseDir, 'manifest.jsonl'), 'utf-8')
      .split('\n')
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l))
  }

  async function ingestN(
    lifecycle: ReturnType<typeof createCaptureLifecycle>,
    n: number
  ): Promise<Capture[]> {
    const out: Capture[] = []
    for (let i = 0; i < n; i++) {
      const { capture } = await lifecycle.ingest(
        buildIngestParams(caseId, Buffer.from(`mhtml-body-${i}`), {
          url: `https://example.com/${i}`
        })
      )
      out.push(capture)
    }
    return out
  }

  function mhtmlExists(capture: Capture): boolean {
    return existsSync(join(getStorageRoot(), capture.mhtmlPath!))
  }

  // A store whose deleteArtifacts throws for one capture id and otherwise
  // delegates to a real store rooted in this test's temp dir.
  function storeFailingOn(failId: string): CaptureStore {
    const real = createCaptureStore({ getRoot: getStorageRoot })
    return {
      ...real,
      deleteArtifacts: (cid, capId) => {
        if (capId === failId) {
          // Shaped like a real fs error: message carries the absolute path,
          // `code` carries the errno.
          const err: NodeJS.ErrnoException = new Error(
            `EACCES: simulated unlink failure, unlink '${join(getStorageRoot(), cid, capId)}'`
          )
          err.code = 'EACCES'
          throw err
        }
        real.deleteArtifacts(cid, capId)
      }
    }
  }

  it('deletes every capture in input order: N ordinary deletion entries, chain valid, proof fields match', async () => {
    const lifecycle = createCaptureLifecycle({ selectorLifecycle: selectorStub })
    const caps = await ingestN(lifecycle, 3)
    const baseIndex = getManifestHead(caseDir).nextIndex
    expect(baseIndex).toBe(3)

    const result = await lifecycle.deleteMany(
      caseId,
      caps.map((c) => c.id)
    )

    expect(result.outcomes).toEqual(caps.map((c) => ({ captureId: c.id, status: 'deleted' })))
    expect(result.deletedIds).toEqual(caps.map((c) => c.id))
    expect(result.failedIds).toEqual([])
    expect(result.haltedAt).toBeUndefined()
    expect(result.manifest).toEqual({ baseIndex, committedEntries: 3 })

    // ADR-0004 "what is proven": entries baseIndex..baseIndex+committedEntries-1
    // are ordinary deletion entries, one per deleted capture, in order.
    const entries = manifestEntries()
    expect(entries).toHaveLength(baseIndex + result.manifest.committedEntries)
    const batch = entries.slice(baseIndex)
    expect(batch.map((e) => e.type)).toEqual(['deletion', 'deletion', 'deletion'])
    expect(batch.map((e) => e.captureId)).toEqual(caps.map((c) => c.id))
    expect(verifyManifestChain(caseDir).valid).toBe(true)

    for (const c of caps) {
      expect(getCapture(c.id)).toBeUndefined()
      expect(mhtmlExists(c)).toBe(false)
    }
  })

  it('returns an empty result for an empty id list without touching the manifest', async () => {
    const lifecycle = createCaptureLifecycle({ selectorLifecycle: selectorStub })
    await ingestN(lifecycle, 1)
    const result = await lifecycle.deleteMany(caseId, [])
    expect(result).toEqual({
      outcomes: [],
      deletedIds: [],
      failedIds: [],
      manifest: { baseIndex: 1, committedEntries: 0 }
    })
    expect(manifestEntries()).toHaveLength(1)
  })

  it('rolls back at the k-th capture when its unlink throws: prefix committed, stage=artifacts, rest untouched', async () => {
    const probe = createCaptureLifecycle({ selectorLifecycle: selectorStub })
    const caps = await ingestN(probe, 4)
    const failing = caps[1]
    const lifecycle = createCaptureLifecycle({
      selectorLifecycle: selectorStub,
      store: storeFailingOn(failing.id)
    })
    const baseIndex = getManifestHead(caseDir).nextIndex

    const result = await lifecycle.deleteMany(
      caseId,
      caps.map((c) => c.id)
    )

    expect(result.outcomes.map((o) => o.status)).toEqual([
      'deleted',
      'rolled_back',
      'not_attempted',
      'not_attempted'
    ])
    const rolled = result.outcomes[1] as Extract<BatchDeleteOutcome, { status: 'rolled_back' }>
    expect(rolled.stage).toBe('artifacts')
    // Name + errno only: the fs message's absolute path must not cross the bridge.
    expect(rolled.error).toBe('Error (EACCES)')
    expect(rolled.error).not.toContain(tempDir)
    expect(result.haltedAt).toBe(failing.id)
    expect(result.deletedIds).toEqual([caps[0].id])
    expect(result.failedIds).toEqual([failing.id, caps[2].id, caps[3].id])
    expect(result.manifest).toEqual({ baseIndex, committedEntries: 1 })

    // Chain: exactly one new entry, and it is the committed deletion; the
    // rolled-back entry is not in the chain.
    const entries = manifestEntries()
    expect(entries).toHaveLength(baseIndex + 1)
    expect(entries.at(-1)?.captureId).toBe(caps[0].id)
    expect(verifyManifestChain(caseDir).valid).toBe(true)

    // artifacts stage: files + row for k intact, k+1..N untouched.
    expect(getCapture(caps[0].id)).toBeUndefined()
    for (const c of caps.slice(1)) {
      expect(getCapture(c.id)).toBeDefined()
      expect(mhtmlExists(c)).toBe(true)
    }

    // The retry payload, through a healthy store, finishes the job.
    const retry = await probe.deleteMany(caseId, result.failedIds)
    expect(retry.outcomes.every((o) => o.status === 'deleted')).toBe(true)
    expect(retry.manifest).toEqual({ baseIndex: baseIndex + 1, committedEntries: 3 })
    expect(verifyManifestChain(caseDir).valid).toBe(true)
    expect(listCaptures(caseId)).toHaveLength(0)
  })

  it('rolls back at the k-th capture when its row delete fails: stage=db, files gone, row remains', async () => {
    const lifecycle = createCaptureLifecycle({ selectorLifecycle: selectorStub })
    const caps = await ingestN(lifecycle, 3)
    const failing = caps[1]
    const realDelete = captureRepo.deleteCapture
    vi.spyOn(captureRepo, 'deleteCapture').mockImplementation((id: string) =>
      id === failing.id ? false : realDelete(id)
    )
    const baseIndex = getManifestHead(caseDir).nextIndex

    const result = await lifecycle.deleteMany(
      caseId,
      caps.map((c) => c.id)
    )

    expect(result.outcomes.map((o) => o.status)).toEqual([
      'deleted',
      'rolled_back',
      'not_attempted'
    ])
    const rolled = result.outcomes[1] as Extract<BatchDeleteOutcome, { status: 'rolled_back' }>
    expect(rolled.stage).toBe('db')
    expect(rolled.error).toBe('ManifestRollback')
    expect(result.haltedAt).toBe(failing.id)
    expect(result.manifest).toEqual({ baseIndex, committedEntries: 1 })
    expect(manifestEntries()).toHaveLength(baseIndex + 1)
    expect(verifyManifestChain(caseDir).valid).toBe(true)

    // db stage: k's files are gone but its row remains (retry proceeds through
    // the same path); k+1 untouched.
    expect(getCapture(failing.id)).toBeDefined()
    expect(mhtmlExists(failing)).toBe(false)
    expect(getCapture(caps[2].id)).toBeDefined()
    expect(mhtmlExists(caps[2])).toBe(true)
  })

  it('throws BATCH_CROSS_CASE before any write when an id belongs to another case', async () => {
    const lifecycle = createCaptureLifecycle({ selectorLifecycle: selectorStub })
    const caps = await ingestN(lifecycle, 2)
    const otherCaseId = createCase({ name: 'Other' }).id
    ensureCaseDir(otherCaseId)
    initManifest(join(tempDir, 'captures', otherCaseId))
    const { capture: foreign } = await lifecycle.ingest(
      buildIngestParams(otherCaseId, Buffer.from('foreign-body'))
    )
    const before = manifestEntries().length

    await expect(
      lifecycle.deleteMany(caseId, [caps[0].id, foreign.id, caps[1].id])
    ).rejects.toBeInstanceOf(BatchCrossCaseError)

    expect(manifestEntries()).toHaveLength(before)
    expect(verifyManifestChain(caseDir).valid).toBe(true)
    for (const c of [...caps, foreign]) {
      expect(getCapture(c.id)).toBeDefined()
      expect(mhtmlExists(c)).toBe(true)
    }
  })

  it('reports stale ids as rejected{not_found} and repeats as rejected{duplicate}, in input order', async () => {
    const lifecycle = createCaptureLifecycle({ selectorLifecycle: selectorStub })
    const [a, b] = await ingestN(lifecycle, 2)

    const result = await lifecycle.deleteMany(caseId, [a.id, 'ghost', a.id, b.id])

    expect(result.outcomes).toEqual([
      { captureId: a.id, status: 'deleted' },
      { captureId: 'ghost', status: 'rejected', reason: 'not_found' },
      { captureId: a.id, status: 'rejected', reason: 'duplicate' },
      { captureId: b.id, status: 'deleted' }
    ])
    expect(result.deletedIds).toEqual([a.id, b.id])
    // Rejected ids are not a retry payload.
    expect(result.failedIds).toEqual([])
    expect(result.manifest.committedEntries).toBe(2)
    expect(verifyManifestChain(caseDir).valid).toBe(true)
  })

  it('deletes legacy html captures as deleted_unmanifested, excluded from committedEntries', async () => {
    const lifecycle = createCaptureLifecycle({ selectorLifecycle: selectorStub })
    const [mhtml] = await ingestN(lifecycle, 1)
    const legacy = insertCapture({
      caseId,
      url: 'https://legacy.example.com',
      title: 'Legacy',
      hash: 'x'.repeat(64),
      timestamp: '2026-04-05T12:00:00.000Z'
    })
    const baseIndex = getManifestHead(caseDir).nextIndex

    const result = await lifecycle.deleteMany(caseId, [legacy.id, mhtml.id])

    expect(result.outcomes).toEqual([
      { captureId: legacy.id, status: 'deleted_unmanifested' },
      { captureId: mhtml.id, status: 'deleted' }
    ])
    expect(result.deletedIds).toEqual([legacy.id, mhtml.id])
    expect(result.manifest).toEqual({ baseIndex, committedEntries: 1 })
    expect(manifestEntries()).toHaveLength(baseIndex + 1)
    expect(getCapture(legacy.id)).toBeUndefined()
    expect(verifyManifestChain(caseDir).valid).toBe(true)
  })

  it('a legacy html unlink fault is a rolled_back outcome, not a throw: earlier outcomes survive, row intact', async () => {
    const probe = createCaptureLifecycle({ selectorLifecycle: selectorStub })
    const [mhtml, after] = await ingestN(probe, 2)
    const legacy = insertCapture({
      caseId,
      url: 'https://legacy.example.com',
      title: 'Legacy',
      hash: 'x'.repeat(64),
      timestamp: '2026-04-05T12:00:00.000Z'
    })
    const lifecycle = createCaptureLifecycle({
      selectorLifecycle: selectorStub,
      store: storeFailingOn(legacy.id)
    })
    const baseIndex = getManifestHead(caseDir).nextIndex

    const result = await lifecycle.deleteMany(caseId, [mhtml.id, legacy.id, after.id])

    expect(result.outcomes).toEqual([
      { captureId: mhtml.id, status: 'deleted' },
      { captureId: legacy.id, status: 'rolled_back', stage: 'artifacts', error: 'Error (EACCES)' },
      { captureId: after.id, status: 'not_attempted' }
    ])
    expect(result.deletedIds).toEqual([mhtml.id])
    expect(result.failedIds).toEqual([legacy.id, after.id])
    expect(result.haltedAt).toBe(legacy.id)
    expect(result.manifest).toEqual({ baseIndex, committedEntries: 1 })
    expect(manifestEntries()).toHaveLength(baseIndex + 1)
    expect(verifyManifestChain(caseDir).valid).toBe(true)
    // Files first, row second: the legacy row is still there to retry from.
    expect(getCapture(legacy.id)).toBeDefined()
    expect(getCapture(after.id)).toBeDefined()
    expect(mhtmlExists(after)).toBe(true)

    // Retry through a healthy store finishes the job without a second entry for the legacy row.
    const retry = await probe.deleteMany(caseId, result.failedIds)
    expect(retry.outcomes.map((o) => o.status)).toEqual(['deleted_unmanifested', 'deleted'])
    expect(retry.manifest).toEqual({ baseIndex: baseIndex + 1, committedEntries: 1 })
    expect(listCaptures(caseId)).toHaveLength(0)
  })

  it('single delete of a legacy html capture still surfaces an unlink fault as a throw, row intact', async () => {
    const legacy = insertCapture({
      caseId,
      url: 'https://legacy.example.com',
      title: 'Legacy',
      hash: 'x'.repeat(64),
      timestamp: '2026-04-05T12:00:00.000Z'
    })
    const lifecycle = createCaptureLifecycle({
      selectorLifecycle: selectorStub,
      store: storeFailingOn(legacy.id)
    })

    await expect(lifecycle.delete(legacy.id)).rejects.toThrow('EACCES')
    expect(getCapture(legacy.id)).toBeDefined()
  })

  // truncateSync on a read-only file fails for an unprivileged user only.
  it.skipIf(process.getuid?.() === 0)(
    'throws rather than report rolled_back when the rollback truncate itself fails and the entry stays in the chain',
    async () => {
      const probe = createCaptureLifecycle({ selectorLifecycle: selectorStub })
      const [a, b] = await ingestN(probe, 2)
      const manifestPath = join(caseDir, 'manifest.jsonl')
      const real = createCaptureStore({ getRoot: getStorageRoot })
      // The unlink fault lands after the entry is appended; making the manifest
      // read-only at that moment makes the seam's rollback truncate fail too.
      const lifecycle = createCaptureLifecycle({
        selectorLifecycle: selectorStub,
        store: {
          ...real,
          deleteArtifacts: (cid, capId) => {
            if (capId === b.id) {
              chmodSync(manifestPath, 0o444)
              throw new Error('EBUSY: simulated unlink failure')
            }
            real.deleteArtifacts(cid, capId)
          }
        }
      })
      const baseIndex = getManifestHead(caseDir).nextIndex

      try {
        await expect(lifecycle.deleteMany(caseId, [a.id, b.id])).rejects.toThrow()
      } finally {
        chmodSync(manifestPath, 0o644)
      }

      // The #622 artefact: a's entry committed, b's entry still in the chain
      // with b's files and row intact. No result claimed otherwise.
      const entries = manifestEntries()
      expect(entries).toHaveLength(baseIndex + 2)
      expect(entries.slice(baseIndex).map((e) => e.captureId)).toEqual([a.id, b.id])
      expect(verifyManifestChain(caseDir).valid).toBe(true)
      expect(getCapture(a.id)).toBeUndefined()
      expect(getCapture(b.id)).toBeDefined()
      expect(mhtmlExists(b)).toBe(true)
    }
  )

  it('serialises two overlapping batches on one case: each id deleted exactly once, the other sees not_found', async () => {
    const lifecycle = createCaptureLifecycle({ selectorLifecycle: selectorStub })
    const caps = await ingestN(lifecycle, 4)
    const ids = caps.map((c) => c.id)
    const baseIndex = getManifestHead(caseDir).nextIndex

    // Overlapping id sets, started without awaiting between them.
    const [first, second] = await Promise.all([
      lifecycle.deleteMany(caseId, [ids[0], ids[1], ids[2]]),
      lifecycle.deleteMany(caseId, [ids[1], ids[2], ids[3]])
    ])

    expect(first.outcomes.map((o) => o.status)).toEqual(['deleted', 'deleted', 'deleted'])
    expect(second.outcomes).toEqual([
      { captureId: ids[1], status: 'rejected', reason: 'not_found' },
      { captureId: ids[2], status: 'rejected', reason: 'not_found' },
      { captureId: ids[3], status: 'deleted' }
    ])
    expect(first.manifest).toEqual({ baseIndex, committedEntries: 3 })
    expect(second.manifest).toEqual({ baseIndex: baseIndex + 3, committedEntries: 1 })

    const entries = manifestEntries()
    expect(entries).toHaveLength(baseIndex + 4)
    expect(entries.slice(baseIndex).map((e) => e.captureId)).toEqual(ids)
    expect(verifyManifestChain(caseDir).valid).toBe(true)
    expect(listCaptures(caseId)).toHaveLength(0)
  })

  it('single delete shares the per-case slot with deleteMany and still verifies', async () => {
    const lifecycle = createCaptureLifecycle({ selectorLifecycle: selectorStub })
    const caps = await ingestN(lifecycle, 3)
    const ids = caps.map((c) => c.id)

    const [batch, single, stale] = await Promise.all([
      lifecycle.deleteMany(caseId, [ids[0], ids[1]]),
      lifecycle.delete(ids[2]),
      // Queued behind the batch that removes it: resolves false, no entry.
      lifecycle.delete(ids[0])
    ])

    expect(batch.deletedIds).toEqual([ids[0], ids[1]])
    expect(single).toBe(true)
    expect(stale).toBe(false)
    expect(
      manifestEntries()
        .slice(3)
        .map((e) => e.captureId)
    ).toEqual(ids)
    expect(verifyManifestChain(caseDir).valid).toBe(true)
  })

  it('single delete still surfaces an unlink fault as a throw, with the entry rolled back (#394 hoist keeps delete() semantics)', async () => {
    const probe = createCaptureLifecycle({ selectorLifecycle: selectorStub })
    const [cap] = await ingestN(probe, 1)
    const lifecycle = createCaptureLifecycle({
      selectorLifecycle: selectorStub,
      store: storeFailingOn(cap.id)
    })

    await expect(lifecycle.delete(cap.id)).rejects.toThrow('EACCES')
    expect(manifestEntries()).toHaveLength(1)
    expect(getCapture(cap.id)).toBeDefined()
    expect(verifyManifestChain(caseDir).valid).toBe(true)
  })

  it('single delete returns false when the row delete fails, entry rolled back (unchanged behaviour)', async () => {
    const lifecycle = createCaptureLifecycle({ selectorLifecycle: selectorStub })
    const [cap] = await ingestN(lifecycle, 1)
    vi.spyOn(captureRepo, 'deleteCapture').mockReturnValue(false)

    expect(await lifecycle.delete(cap.id)).toBe(false)
    expect(manifestEntries()).toHaveLength(1)
    expect(verifyManifestChain(caseDir).valid).toBe(true)
  })

  it('crash mid-item leaves a valid trailing deletion entry with a live row, and a later batch proceeds past it', async () => {
    // Simulate the write-ahead crash window: the deletion entry landed, the
    // process died before unlink/row delete ran. The artefact is a valid chain
    // whose tail is a deletion entry for a capture that still exists. #394
    // asserts that state; surfacing it is #622.
    const lifecycle = createCaptureLifecycle({ selectorLifecycle: selectorStub })
    const [a, b] = await ingestN(lifecycle, 2)
    appendManifestEntry(caseDir, {
      type: 'deletion',
      captureId: a.id,
      caseId,
      timestamp: new Date().toISOString(),
      contentHash: a.hash,
      operatorId: 'op',
      operatorName: 'Crash',
      toolVersion: '0.0.0'
    })
    expect(verifyManifestChain(caseDir).valid).toBe(true)
    expect(manifestEntries().at(-1)).toMatchObject({ type: 'deletion', captureId: a.id })
    expect(getCapture(a.id)).toBeDefined()
    expect(mhtmlExists(a)).toBe(true)

    // A subsequent batch treats the row as live: it appends its own deletion
    // entry (the chain now carries two for `a`) and actually removes it.
    const result = await lifecycle.deleteMany(caseId, [a.id, b.id])
    expect(result.outcomes.map((o) => o.status)).toEqual(['deleted', 'deleted'])
    expect(result.manifest).toEqual({ baseIndex: 3, committedEntries: 2 })
    expect(
      manifestEntries().filter((e) => e.captureId === a.id && e.type === 'deletion')
    ).toHaveLength(2)
    expect(verifyManifestChain(caseDir).valid).toBe(true)
    expect(listCaptures(caseId)).toHaveLength(0)
  })

  it('throws before the loop when the manifest head is unreadable, writing nothing', async () => {
    const lifecycle = createCaptureLifecycle({ selectorLifecycle: selectorStub })
    const [a] = await ingestN(lifecycle, 1)
    const { appendFileSync } = await import('fs')
    appendFileSync(join(caseDir, 'manifest.jsonl'), 'not json\n')

    await expect(lifecycle.deleteMany(caseId, [a.id])).rejects.toThrow()
    expect(getCapture(a.id)).toBeDefined()
    expect(mhtmlExists(a)).toBe(true)
  })
})

describe('createCaptureLifecycle.verify', () => {
  let tempDir: string
  let caseId: string
  let selectorStub: SelectorLifecycle

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-lifecycle-verify-'))
    initStorage(join(tempDir, 'captures'))
    await initDatabase(':memory:')
    caseId = createCase({ name: 'Verify' }).id
    ensureCaseDir(caseId)
    initManifest(join(tempDir, 'captures', caseId))
    selectorStub = { runActiveSelectorsForCapture: vi.fn() } as unknown as SelectorLifecycle
  })

  afterEach(() => {
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('returns missing for an unknown capture id', async () => {
    const lifecycle = createCaptureLifecycle({ selectorLifecycle: selectorStub })
    const result = await lifecycle.verify('does-not-exist')
    expect(result.status).toBe('missing')
  })

  it('returns verified for an intact freshly-ingested capture', async () => {
    const lifecycle = createCaptureLifecycle({ selectorLifecycle: selectorStub })
    const { capture } = await lifecycle.ingest(buildIngestParams(caseId, Buffer.from('verify-me')))

    const result = await lifecycle.verify(capture.id)

    expect(result.status).toBe('verified')
    expect(result.storedHash).toBe(result.computedHash)
  })

  it('reports the trusted-time axis orthogonally to integrity (pending before stamping)', async () => {
    const lifecycle = createCaptureLifecycle({ selectorLifecycle: selectorStub })
    const { capture } = await lifecycle.ingest(
      buildIngestParams(caseId, Buffer.from('not-stamped'))
    )

    const result = await lifecycle.verify(capture.id)

    // Integrity is verified even though no trusted timestamp exists yet — the
    // axes are independent; lacking a timestamp is NOT "not verified".
    expect(result.status).toBe('verified')
    expect(result.trustedTime).toBe('pending')
  })

  it('reports rfc3161 with TSA identity once a timestamp entry anchors the capture', async () => {
    const lifecycle = createCaptureLifecycle({ selectorLifecycle: selectorStub })
    const { capture } = await lifecycle.ingest(buildIngestParams(caseId, Buffer.from('stamp-me')))

    const caseDir = join(tempDir, 'captures', caseId)
    const token = buildSyntheticToken({
      contentHash: capture.hash,
      genTime: new Date('2026-05-30T09:05:00.000Z'),
      tsaDnsName: 'tsa.example.com'
    })
    appendManifestEntry(caseDir, {
      type: 'timestamp',
      caseId,
      captureContentHash: capture.hash,
      timestamp: '2026-05-30T09:05:00.000Z',
      tsaToken: token.toString('base64'),
      operatorId: 'op-1',
      operatorName: 'Op',
      toolVersion: '0.1.0'
    })

    const result = await lifecycle.verify(capture.id)

    expect(result.status).toBe('verified')
    expect(result.trustedTime).toBe('rfc3161')
    expect(result.tsaName).toBe('tsa.example.com')
    expect(result.stampedAt).toBe('2026-05-30T09:05:00.000Z')
  })

  it('FAILS verify with a screenshot-specific reason when the on-disk .png is overwritten (#118 AC#5)', async () => {
    const { writeFileSync } = await import('fs')
    const lifecycle = createCaptureLifecycle({ selectorLifecycle: selectorStub })
    const { capture } = await lifecycle.ingest(
      buildIngestParams(caseId, Buffer.from('mhtml-body'), {
        screenshot: Buffer.from('original-screenshot')
      })
    )

    // Unchanged screenshot verifies.
    expect((await lifecycle.verify(capture.id)).status).toBe('verified')

    // Tamper the screenshot bytes on disk; MHTML is untouched.
    writeFileSync(join(getStorageRoot(), capture.screenshotPath!), Buffer.from('tampered-bytes'))

    const result = await lifecycle.verify(capture.id)
    expect(result.status).toBe('tampered')
    expect(result.reason).toMatch(/screenshot/i)
  })

  it('FAILS verify with a text-specific reason when the on-disk .txt is overwritten (#118 AC#5 mirror)', async () => {
    const { writeFileSync } = await import('fs')
    const lifecycle = createCaptureLifecycle({ selectorLifecycle: selectorStub })
    const { capture } = await lifecycle.ingest(
      buildIngestParams(caseId, Buffer.from('mhtml-body'), { textContent: 'original text' })
    )

    expect((await lifecycle.verify(capture.id)).status).toBe('verified')

    const txtPath = join(getStorageRoot(), caseId, `${capture.id}.txt`)
    writeFileSync(txtPath, 'tampered text', 'utf-8')

    const result = await lifecycle.verify(capture.id)
    expect(result.status).toBe('tampered')
    expect(result.reason).toMatch(/text/i)
  })

  // #234: the defect being closed. Before this fix, verifySidecars trusted
  // captures.text_hash / captures.screenshot_hash -- a DB mirror an attacker
  // (or a bug) can edit right alongside the sidecar file. Editing BOTH
  // together, so they agree with each other, must still be caught because the
  // SIGNED manifest entry -- which neither edit touches -- still holds the
  // original digest. Proven non-vacuous below by reintroducing the defect.
  it('FAILS verify when the .txt sidecar AND its DB mirror are edited together (#234)', async () => {
    const lifecycle = createCaptureLifecycle({ selectorLifecycle: selectorStub })
    const { capture } = await lifecycle.ingest(
      buildIngestParams(caseId, Buffer.from('mhtml-body'), { textContent: 'original text' })
    )
    expect((await lifecycle.verify(capture.id)).status).toBe('verified')

    const tampered = 'tampered text, and the mirror now agrees'
    const { writeFileSync } = await import('fs')
    const txtPath = join(getStorageRoot(), caseId, `${capture.id}.txt`)
    writeFileSync(txtPath, tampered, 'utf-8')
    // The mirror is edited to MATCH the tampered sidecar -- exactly the
    // scenario migrations.ts:369 says the manifest, not this column, must
    // arbitrate.
    const matchingHash = createHash('sha256').update(tampered).digest('hex')
    getDb().prepare('UPDATE captures SET text_hash = ? WHERE id = ?').run(matchingHash, capture.id)
    expect(getCapture(capture.id)?.textHash).toBe(matchingHash) // fixture check: mirror really did move

    const result = await lifecycle.verify(capture.id)
    expect(result.status).toBe('tampered')
    expect(result.reason).toMatch(/text/i)
  })

  it('FAILS verify when the .png sidecar AND its DB mirror are edited together (#234)', async () => {
    const lifecycle = createCaptureLifecycle({ selectorLifecycle: selectorStub })
    const { capture } = await lifecycle.ingest(
      buildIngestParams(caseId, Buffer.from('mhtml-body'), {
        screenshot: Buffer.from('original-screenshot')
      })
    )
    expect((await lifecycle.verify(capture.id)).status).toBe('verified')

    const tamperedBytes = Buffer.from('tampered-bytes, mirror now agrees too')
    const { writeFileSync } = await import('fs')
    writeFileSync(join(getStorageRoot(), capture.screenshotPath!), tamperedBytes)
    const matchingHash = createHash('sha256').update(tamperedBytes).digest('hex')
    getDb()
      .prepare('UPDATE captures SET screenshot_hash = ? WHERE id = ?')
      .run(matchingHash, capture.id)
    expect(getCapture(capture.id)?.screenshotHash).toBe(matchingHash)

    const result = await lifecycle.verify(capture.id)
    expect(result.status).toBe('tampered')
    expect(result.reason).toMatch(/screenshot/i)
  })

  it('FAILS verify when the capture is truncated out of the manifest chain (#X-2)', async () => {
    const { readFileSync, writeFileSync } = await import('fs')
    const { MANIFEST_FILENAME } = await import('@shared/constants')
    const lifecycle = createCaptureLifecycle({ selectorLifecycle: selectorStub })

    const { capture: first } = await lifecycle.ingest(
      buildIngestParams(caseId, Buffer.from('first-body'))
    )
    const { capture: second } = await lifecycle.ingest(
      buildIngestParams(caseId, Buffer.from('second-body'))
    )
    expect((await lifecycle.verify(second.id)).status).toBe('verified')

    // Truncate the manifest suffix so the second capture's entry (and anything
    // after it) is gone. The remaining prefix is a shorter, still-internally-
    // valid chain — the MHTML bytes on disk are untouched — but the second
    // capture is no longer anchored.
    const manifestPath = join(getStorageRoot(), caseId, MANIFEST_FILENAME)
    const lines = readFileSync(manifestPath, 'utf-8')
      .split('\n')
      .filter((l) => l.trim())
    const cut = lines.findIndex(
      (l) => (JSON.parse(l) as { captureId?: string }).captureId === second.id
    )
    writeFileSync(manifestPath, lines.slice(0, cut).join('\n') + '\n', 'utf-8')

    // The surviving prefix still verifies the first capture...
    expect((await lifecycle.verify(first.id)).status).toBe('verified')
    // ...but the orphaned second capture must NOT report verified.
    const result = await lifecycle.verify(second.id)
    expect(result.status).toBe('chain-broken')
    expect(result.chainValid).toBe(true)
    expect(result.reason).toMatch(/anchor/i)
  })

  it('verifies a legacy capture with no recorded sidecar hashes (#118 grandfathering)', async () => {
    // No screenshot, empty textContent → no recorded hashes → not sidecar-checked.
    const lifecycle = createCaptureLifecycle({ selectorLifecycle: selectorStub })
    const { capture } = await lifecycle.ingest(
      buildIngestParams(caseId, Buffer.from('mhtml-body'), { textContent: '' })
    )

    const stored = getCapture(capture.id)
    expect(stored?.screenshotHash).toBeUndefined()
    expect(stored?.textHash).toBeUndefined()
    expect((await lifecycle.verify(capture.id)).status).toBe('verified')
  })
})
