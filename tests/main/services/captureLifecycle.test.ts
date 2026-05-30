import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { Readable } from 'stream'
import { initStorage, ensureCaseDir, getStorageRoot } from '@main/services/storage'
import {
  initDatabase,
  closeDatabase,
  createCase,
  getCapture,
  insertCapture,
  listCaptures
} from '@main/services/database'
import { initManifest, verifyManifestChain, appendManifestEntry } from '@main/services/manifest'
import { buildSyntheticToken } from '../../helpers/timestampFixtures'
import { createCaptureLifecycle } from '@main/services/captureLifecycle'
import type { SelectorLifecycle } from '@main/services/selectorLifecycle'
import { initInstallationId, resetInstallationId } from '@main/services/installationId'
import { initSettings, updateSettings } from '@main/services/settings'

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

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-lifecycle-'))
    initStorage(join(tempDir, 'captures'))
    initDatabase(':memory:')
    caseId = createCase({ name: 'Lifecycle' }).id
    ensureCaseDir(caseId)
    initManifest(join(tempDir, 'captures', caseId))
    runActive = vi.fn()
    // Minimal SelectorLifecycle stub — captureLifecycle only ever calls
    // runActiveSelectorsForCapture on it; other methods are unused here.
    selectorStub = { runActiveSelectorsForCapture: runActive } as unknown as SelectorLifecycle
  })

  afterEach(() => {
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
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const lifecycle = createCaptureLifecycle({ selectorLifecycle: selectorStub })
    const body = Buffer.from('mhtml-body')

    const result = await lifecycle.ingest(buildIngestParams(caseId, body))
    await flushImmediate()

    expect(result.capture.id).toBeTruthy()
    expect(getCapture(result.capture.id)?.id).toBe(result.capture.id)
    expect(errSpy).toHaveBeenCalled()
    expect(errSpy.mock.calls.some((c) => String(c[0]).includes('selector matching failed'))).toBe(
      true
    )
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
    expect(verifyManifestChain(join(tempDir, 'captures', caseId)).trustedTime).toBe('none')

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

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-lifecycle-del-'))
    initStorage(join(tempDir, 'captures'))
    initDatabase(':memory:')
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

describe('createCaptureLifecycle.verify', () => {
  let tempDir: string
  let caseId: string
  let selectorStub: SelectorLifecycle

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-lifecycle-verify-'))
    initStorage(join(tempDir, 'captures'))
    initDatabase(':memory:')
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
})
