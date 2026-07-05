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
    const cut = lines.findIndex((l) => (JSON.parse(l) as { captureId?: string }).captureId === second.id)
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
