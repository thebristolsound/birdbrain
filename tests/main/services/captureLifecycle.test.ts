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
import { appendFutureEntry } from '../../helpers/futureManifestEntry'
import {
  createCaptureLifecycle,
  BatchCrossCaseError,
  verifyCapture
} from '@main/services/captureLifecycle'
import type { AdmissionRequest } from '@main/services/captureLifecycle'
import { createSessionService } from '@main/services/session'
import type { SessionService } from '@main/services/session'
import { setAutoCapturePolicy, updateCase } from '@main/services/db/caseRepo'
import type { CaptureEvent } from '@shared/types'
import { MAX_SCREENSHOT_SIZE } from '@shared/constants'
import { scanUnreconciledDeletions } from '@main/services/deletionReconciliation'
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

  it('anchors the HTTP status in the manifest body and mirrors it on the row (#797)', async () => {
    const { readFileSync } = await import('fs')
    const lifecycle = createCaptureLifecycle({ selectorLifecycle: selectorStub })
    const { capture } = await lifecycle.ingest(
      buildIngestParams(caseId, Buffer.from('mhtml-body'), { httpStatus: 404 })
    )

    // The row and the entry come from ONE derivation, so for a capture this
    // build ingests the report prints exactly what the chain attests. Rows
    // written before R7 are outside that guarantee (src/shared/httpStatus.ts).
    expect(getCapture(capture.id)!.httpStatus).toBe(404)
    const manifestPath = join(tempDir, 'captures', caseId, 'manifest.jsonl')
    const lines = readFileSync(manifestPath, 'utf-8')
      .split('\n')
      .filter((l) => l.trim().length > 0)
    const captureEntry = JSON.parse(lines[lines.length - 1])
    expect(captureEntry.httpStatus).toBe(404)
    expect(verifyManifestChain(join(tempDir, 'captures', caseId)).valid).toBe(true)
  })

  it('OMITS an unrecorded HTTP status from both the entry and the row (#797)', async () => {
    const { readFileSync } = await import('fs')
    const lifecycle = createCaptureLifecycle({ selectorLifecycle: selectorStub })
    // 0 is what the wire schema coerces a missing httpStatus field to, and 900
    // is not a status at all. Neither is written as a claim: the entry keeps
    // its pre-R7 canonical body and the row records nothing to display.
    for (const httpStatus of [0, 900]) {
      const { capture } = await lifecycle.ingest(
        buildIngestParams(caseId, Buffer.from('mhtml-body'), { httpStatus })
      )
      expect(getCapture(capture.id)!.httpStatus).toBeUndefined()
      const lines = readFileSync(join(tempDir, 'captures', caseId, 'manifest.jsonl'), 'utf-8')
        .split('\n')
        .filter((l) => l.trim().length > 0)
      const captureEntry = JSON.parse(lines[lines.length - 1])
      expect('httpStatus' in captureEntry).toBe(false)
    }
    expect(verifyManifestChain(join(tempDir, 'captures', caseId)).valid).toBe(true)
  })

  it('anchors a final URL only when the acquiring path supplies one (#797)', async () => {
    const { readFileSync } = await import('fs')
    const lifecycle = createCaptureLifecycle({ selectorLifecycle: selectorStub })
    const entryAfter = async (overrides: Record<string, unknown>) => {
      await lifecycle.ingest(buildIngestParams(caseId, Buffer.from('mhtml-body'), overrides))
      const lines = readFileSync(join(tempDir, 'captures', caseId, 'manifest.jsonl'), 'utf-8')
        .split('\n')
        .filter((l) => l.trim().length > 0)
      return JSON.parse(lines[lines.length - 1])
    }

    expect((await entryAfter({ finalUrl: 'https://example.com/landing' })).finalUrl).toBe(
      'https://example.com/landing'
    )
    // No final URL, and the empty string a caller might pass for "none": the
    // entry must carry no claim at all rather than an empty one.
    expect('finalUrl' in (await entryAfter({}))).toBe(false)
    expect('finalUrl' in (await entryAfter({ finalUrl: '' }))).toBe(false)
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

// Admission policy (the capture server's former POST /api/captures body),
// exercised with no HTTP in the loop: every refusal kind, the manual dedup
// window, the screenshot cap, the session count and the activity events. The
// status codes those become are pinned in captureServer.test.ts; the policy
// is pinned here.
describe('createCaptureLifecycle.admit', () => {
  let tempDir: string
  let caseId: string
  let sessionService: SessionService
  let events: CaptureEvent[]
  let newCaptures: Capture[]

  function buildLifecycle() {
    const selectorStub = {
      runActiveSelectorsForCapture: vi.fn()
    } as unknown as SelectorLifecycle
    return createCaptureLifecycle({
      selectorLifecycle: selectorStub,
      sessionService,
      emitCaptureEvent: (event) => events.push(event),
      emitNewCapture: (capture) => newCaptures.push(capture)
    })
  }

  function request(overrides: Partial<AdmissionRequest> = {}): AdmissionRequest {
    return {
      route: 'manual',
      caseId,
      url: 'https://example.com/page',
      title: 'Example',
      timestamp: '2026-04-05T12:00:00.000Z',
      stream: Readable.from([
        Buffer.from('<html>admitted</html>')
      ]) as unknown as ReadableStream<Uint8Array>,
      textContent: 'admitted text',
      headers: {},
      browserVersion: 'Chrome/120',
      userAgent: 'Mozilla/5.0',
      httpStatus: 200,
      extensionVersion: '0.1.0',
      ...overrides
    }
  }

  async function startSessionOn(id: string): Promise<void> {
    sessionService.activateCase(id)
    sessionService.start()
  }

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-admit-'))
    initStorage(join(tempDir, 'captures'))
    initSettings(tempDir)
    updateSettings({ operatorName: 'Test Operator', ignoredUrlPatterns: [] })
    resetInstallationId()
    initInstallationId(tempDir)
    await initDatabase(':memory:')
    caseId = createCase({ name: 'Admit' }).id
    ensureCaseDir(caseId)
    initManifest(join(tempDir, 'captures', caseId))
    sessionService = createSessionService()
    events = []
    newCaptures = []
    initLogger(tempDir, 'capture-admit-test-session')
  })

  afterEach(() => {
    disposeLogger()
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('admits a manual request: stores the capture, broadcasts it, and reports received then stored', async () => {
    const lifecycle = buildLifecycle()
    const outcome = await lifecycle.admit(request())
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.contentHash).toMatch(/^[0-9a-f]{64}$/)
    expect(outcome.screenshotStatus).toBe('none')
    expect(outcome.screenshotWarning).toBeUndefined()
    expect(listCaptures(caseId)).toHaveLength(1)
    expect(listCaptures(caseId)[0].id).toBe(outcome.capture.id)
    expect(newCaptures.map((c) => c.id)).toEqual([outcome.capture.id])
    expect(events.map((e) => e.type)).toEqual(['received', 'stored'])
    expect(events[1].captureId).toBe(outcome.capture.id)
    expect(events[1].source).toBe('manual')
    expect(events[1].durationMs).toBeGreaterThanOrEqual(0)
    expect(sessionService.snapshot().captureCount).toBe(0)
  })

  it('fills the title and timestamp from the URL and the clock when the request leaves them empty', async () => {
    const lifecycle = buildLifecycle()
    const before = Date.now()
    const outcome = await lifecycle.admit(request({ title: '', timestamp: '' }))
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.capture.title).toBe('https://example.com/page')
    expect(Date.parse(outcome.capture.timestamp)).toBeGreaterThanOrEqual(before)
  })

  // The fallback timestamp is what the manifest entry signs, so it is taken
  // when the request arrives, not after the policy checks and the screenshot
  // read have run (Codex review of #1565).
  it('takes the fallback timestamp at entry, before the screenshot is read', async () => {
    const lifecycle = buildLifecycle()
    const entered = new Date('2026-04-05T12:00:00.000Z')
    const later = new Date('2026-04-05T12:00:05.000Z')
    // Only Date is faked: the ingest streams to disk on real timers.
    vi.useFakeTimers({ toFake: ['Date'], now: entered })
    try {
      const slowScreenshot = {
        size: 4,
        arrayBuffer: async () => {
          vi.setSystemTime(later)
          return Buffer.from('png!').buffer
        }
      } as unknown as Blob
      const outcome = await lifecycle.admit(request({ timestamp: '', screenshot: slowScreenshot }))
      expect(outcome.ok).toBe(true)
      if (!outcome.ok) return
      expect(outcome.capture.timestamp).toBe(entered.toISOString())
      // And the duration covers the whole admission, screenshot read included.
      expect(events.find((e) => e.type === 'stored')!.durationMs).toBe(5000)
    } finally {
      vi.useRealTimers()
    }
  })

  it('records the operator, installation and tool version on the row', async () => {
    const lifecycle = buildLifecycle()
    const outcome = await lifecycle.admit(request())
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    const row = getCapture(outcome.capture.id)!
    expect(row.operatorName).toBe('Test Operator')
    expect(row.operatorId).toBeTruthy()
    expect(row.toolVersion).toBeTruthy()
    expect(row.method).toBe('extension')
  })

  it('refuses every route when the operator name is blank or whitespace, and reports the failure', async () => {
    const lifecycle = buildLifecycle()
    await startSessionOn(caseId)
    for (const operatorName of ['', '   ']) {
      updateSettings({ operatorName })
      for (const route of ['auto', 'manual', 'selector', 'attach'] as const) {
        events.length = 0
        const outcome = await lifecycle.admit(request({ route }))
        expect(outcome).toEqual({ ok: false, refusal: { kind: 'operator_name_required' } })
        expect(events).toHaveLength(1)
        expect(events[0].type).toBe('failed')
        expect(events[0].error).toBe('Operator name required')
        expect(events[0].source).toBe(route === 'attach' ? 'manual' : route)
      }
    }
    expect(listCaptures(caseId)).toHaveLength(0)
  })

  it('auto takes the Active Case from the session and counts into it', async () => {
    const lifecycle = buildLifecycle()
    await startSessionOn(caseId)
    const first = await lifecycle.admit(request({ route: 'auto', caseId: undefined }))
    const second = await lifecycle.admit(
      request({ route: 'auto', caseId: undefined, url: 'https://example.com/other' })
    )
    expect(first.ok && second.ok).toBe(true)
    expect(listCaptures(caseId)).toHaveLength(2)
    expect(sessionService.snapshot().captureCount).toBe(2)
    expect(events.filter((e) => e.type === 'stored').map((e) => e.source)).toEqual(['auto', 'auto'])
  })

  it('auto refuses without a running session, then without an Active Case', async () => {
    const lifecycle = buildLifecycle()
    sessionService.activateCase(caseId)
    expect(await lifecycle.admit(request({ route: 'auto' }))).toEqual({
      ok: false,
      refusal: { kind: 'no_active_session' }
    })
    sessionService.deactivateCase()
    sessionService.start()
    expect(await lifecycle.admit(request({ route: 'auto' }))).toEqual({
      ok: false,
      refusal: { kind: 'no_active_case' }
    })
    expect(events).toEqual([])
    expect(listCaptures(caseId)).toHaveLength(0)
  })

  it('manual, selector and attach refuse a missing, unknown or archived case without an event', async () => {
    const lifecycle = buildLifecycle()
    const archived = createCase({ name: 'Archived' })
    updateCase({ id: archived.id, archived: true })
    for (const route of ['manual', 'selector', 'attach'] as const) {
      expect(await lifecycle.admit(request({ route, caseId: '' }))).toEqual({
        ok: false,
        refusal: { kind: 'missing_case_id' }
      })
      expect(await lifecycle.admit(request({ route, caseId: undefined }))).toEqual({
        ok: false,
        refusal: { kind: 'missing_case_id' }
      })
      expect(await lifecycle.admit(request({ route, caseId: 'no-such-case' }))).toEqual({
        ok: false,
        refusal: { kind: 'case_not_found' }
      })
      expect(await lifecycle.admit(request({ route, caseId: archived.id }))).toEqual({
        ok: false,
        refusal: { kind: 'case_archived' }
      })
    }
    expect(events).toEqual([])
  })

  it('refuses an excluded URL on every route, naming the pattern and emitting one skipped event', async () => {
    const lifecycle = buildLifecycle()
    await startSessionOn(caseId)
    updateSettings({ ignoredUrlPatterns: ['facebook.com'] })
    for (const route of ['auto', 'manual', 'selector', 'attach'] as const) {
      events.length = 0
      const outcome = await lifecycle.admit(
        request({ route, url: 'https://facebook.com/some-page' })
      )
      expect(outcome).toEqual({ ok: false, refusal: { kind: 'excluded', pattern: 'facebook.com' } })
      expect(events).toHaveLength(1)
      expect(events[0].type).toBe('skipped')
      expect(events[0].skipReason).toBe('Blacklisted: facebook.com')
      expect(events[0].source).toBe(route === 'attach' ? 'manual' : route)
    }
    expect(listCaptures(caseId)).toHaveLength(0)
    expect(getManifestHead(join(tempDir, 'captures', caseId)).nextIndex).toBe(0)
  })

  it('admits a URL the list does not match', async () => {
    const lifecycle = buildLifecycle()
    updateSettings({ ignoredUrlPatterns: ['facebook.com'] })
    const outcome = await lifecycle.admit(request({ url: 'https://example.com/fine' }))
    expect(outcome.ok).toBe(true)
  })

  // The composed rule (`matchCaseExclusion`) is what runs here, so the
  // per-case list and its mode apply the same way they do to a recapture.
  it('reads the case list under its mode: override bypasses the global list, still blocks its own', async () => {
    const lifecycle = buildLifecycle()
    updateSettings({ ignoredUrlPatterns: ['global.com'] })
    setAutoCapturePolicy(caseId, { exclusions: ['caseonly.com'], mode: 'override' })
    expect((await lifecycle.admit(request({ url: 'https://global.com/x' }))).ok).toBe(true)
    expect(await lifecycle.admit(request({ url: 'https://caseonly.com/x' }))).toEqual({
      ok: false,
      refusal: { kind: 'excluded', pattern: 'caseonly.com' }
    })
  })

  it('matches regex and glob patterns, including the single-character wildcard', async () => {
    const lifecycle = buildLifecycle()
    updateSettings({ ignoredUrlPatterns: ['/.*\\.pdf$/i', '*.facebook.com*', 'example.com/user?'] })
    const refused = async (url: string) =>
      lifecycle.admit(request({ route: 'selector', url })).then((o) => !o.ok && o.refusal.kind)
    expect(await refused('https://example.com/document.pdf')).toBe('excluded')
    expect(await refused('https://www.facebook.com/some/page')).toBe('excluded')
    expect(await refused('https://example.com/userA')).toBe('excluded')
    // 'users' ends with 's', which the '?' matches — still excluded.
    expect(await refused('https://example.com/users')).toBe('excluded')
    expect(await refused('https://example.com/page.html')).toBe(false)
  })

  // #400 moved the exclusion check to AFTER case resolution, because a case's
  // 'override' mode has to be able to bypass the global list and the mode is
  // unknown until the case is. These pin what that reordering changed: an
  // excluded URL with no usable case answers the case refusal, not the
  // exclusion one, and leaves no skipped event.
  it('resolves the case before the exclusion list: an excluded URL with no usable case is a case refusal', async () => {
    const lifecycle = buildLifecycle()
    updateSettings({ ignoredUrlPatterns: ['blocked-site.com'] })
    const archived = createCase({ name: 'Archived' })
    updateCase({ id: archived.id, archived: true })
    const url = 'https://blocked-site.com/page'
    expect(await lifecycle.admit(request({ caseId: '', url }))).toEqual({
      ok: false,
      refusal: { kind: 'missing_case_id' }
    })
    expect(await lifecycle.admit(request({ caseId: 'no-such-case', url }))).toEqual({
      ok: false,
      refusal: { kind: 'case_not_found' }
    })
    expect(await lifecycle.admit(request({ caseId: archived.id, url }))).toEqual({
      ok: false,
      refusal: { kind: 'case_archived' }
    })
    expect(events).toEqual([])
  })

  it('refuses a second manual capture of the same case and URL inside the dedup window', async () => {
    const lifecycle = buildLifecycle()
    expect((await lifecycle.admit(request())).ok).toBe(true)
    const second = await lifecycle.admit(request())
    expect(second).toEqual({ ok: false, refusal: { kind: 'duplicate' } })
    expect(listCaptures(caseId)).toHaveLength(1)
    const skipped = events.filter((e) => e.type === 'skipped')
    expect(skipped).toHaveLength(1)
    expect(skipped[0].skipReason).toBe('Duplicate manual capture')
  })

  it('admits the same URL again once the dedup window has passed', async () => {
    const lifecycle = buildLifecycle()
    expect((await lifecycle.admit(request())).ok).toBe(true)
    const realNow = Date.now
    vi.spyOn(Date, 'now').mockImplementation(() => realNow() + 6000)
    expect((await lifecycle.admit(request())).ok).toBe(true)
    expect(listCaptures(caseId)).toHaveLength(2)
  })

  it('keys the dedup window on case and URL together', async () => {
    const lifecycle = buildLifecycle()
    const other = createCase({ name: 'Other' }).id
    ensureCaseDir(other)
    initManifest(join(tempDir, 'captures', other))
    expect((await lifecycle.admit(request())).ok).toBe(true)
    expect((await lifecycle.admit(request({ url: 'https://example.com/page-b' }))).ok).toBe(true)
    expect((await lifecycle.admit(request({ caseId: other }))).ok).toBe(true)
    expect(listCaptures(caseId)).toHaveLength(2)
    expect(listCaptures(other)).toHaveLength(1)
  })

  it('does not dedup auto, selector or attach captures', async () => {
    const lifecycle = buildLifecycle()
    await startSessionOn(caseId)
    for (const route of ['auto', 'selector', 'attach'] as const) {
      const url = `https://example.com/${route}`
      expect((await lifecycle.admit(request({ route, url }))).ok).toBe(true)
      expect((await lifecycle.admit(request({ route, url }))).ok).toBe(true)
    }
    expect(listCaptures(caseId)).toHaveLength(6)
  })

  it('a manual capture inside the window does not shadow an attach of the same URL', async () => {
    const lifecycle = buildLifecycle()
    expect((await lifecycle.admit(request({ route: 'manual' }))).ok).toBe(true)
    const attach = await lifecycle.admit(request({ route: 'attach' }))
    expect(attach.ok).toBe(true)
    if (!attach.ok) return
    expect(events.filter((e) => e.type === 'stored').map((e) => e.source)).toEqual([
      'manual',
      'manual'
    ])
  })

  it('a fresh lifecycle starts with an empty dedup window', async () => {
    expect((await buildLifecycle().admit(request())).ok).toBe(true)
    expect((await buildLifecycle().admit(request())).ok).toBe(true)
    expect(listCaptures(caseId)).toHaveLength(2)
  })

  it('stores a screenshot under the cap, as a Blob or a Buffer', async () => {
    const lifecycle = buildLifecycle()
    const asBlob = await lifecycle.admit(
      request({ screenshot: new Blob([Buffer.from('png-bytes')], { type: 'image/png' }) })
    )
    const asBuffer = await lifecycle.admit(
      request({ url: 'https://example.com/buffer', screenshot: Buffer.from('png-bytes') })
    )
    for (const outcome of [asBlob, asBuffer]) {
      expect(outcome.ok).toBe(true)
      if (!outcome.ok) return
      expect(outcome.screenshotStatus).toBe('saved')
      expect(getCapture(outcome.capture.id)!.screenshotPath).toContain('.png')
    }
  })

  it('drops an oversized screenshot, stores the capture, and says so on the outcome and the event', async () => {
    const lifecycle = buildLifecycle()
    const oversized = Buffer.alloc(MAX_SCREENSHOT_SIZE + 1, 0x42)
    const outcome = await lifecycle.admit(request({ screenshot: oversized }))
    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.screenshotStatus).toBe('dropped')
    expect(outcome.screenshotWarning).toContain('too large')
    expect(getCapture(outcome.capture.id)!.screenshotPath).toBeFalsy()
    const stored = events.find((e) => e.type === 'stored')!
    expect(stored.screenshotWarning).toBe(outcome.screenshotWarning)
    expect(listCaptures(caseId)).toHaveLength(1)
  })

  it('reports a failed ingest as an outcome with the error, emits failed, and leaves nothing behind', async () => {
    const lifecycle = buildLifecycle()
    const broken = new Readable({
      read() {
        this.destroy(new Error('upload cut'))
      }
    })
    const outcome = await lifecycle.admit(
      request({ stream: broken as unknown as ReadableStream<Uint8Array> })
    )
    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.refusal.kind).toBe('failed')
    expect(outcome.refusal.kind === 'failed' && String(outcome.refusal.error)).toContain(
      'upload cut'
    )
    expect(events.map((e) => e.type)).toEqual(['received', 'failed'])
    expect(events[1].error).toContain('upload cut')
    expect(newCaptures).toEqual([])
    expect(listCaptures(caseId)).toHaveLength(0)
    expect(getManifestHead(join(tempDir, 'captures', caseId)).nextIndex).toBe(0)
  })

  it('without a session or emitters, auto is refused and the other routes stay silent', async () => {
    const selectorStub = {
      runActiveSelectorsForCapture: vi.fn()
    } as unknown as SelectorLifecycle
    const headless = createCaptureLifecycle({ selectorLifecycle: selectorStub })
    expect(await headless.admit(request({ route: 'auto' }))).toEqual({
      ok: false,
      refusal: { kind: 'no_active_session' }
    })
    expect((await headless.admit(request({ route: 'selector' }))).ok).toBe(true)
    expect(events).toEqual([])
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
    expect(result.failedIds).toEqual([failing.id, caps[2].id])
    expect(result.manifest).toEqual({ baseIndex, committedEntries: 1 })
    expect(manifestEntries()).toHaveLength(baseIndex + 1)
    expect(verifyManifestChain(caseDir).valid).toBe(true)

    // db stage: k's files are gone but its row remains (retry proceeds through
    // the same path); k+1 untouched.
    expect(getCapture(failing.id)).toBeDefined()
    expect(mhtmlExists(failing)).toBe(false)
    expect(getCapture(caps[2].id)).toBeDefined()
    expect(mhtmlExists(caps[2])).toBe(true)

    // Retry through the same path once the row delete works again: the
    // rolled-back entry left no trace, so the retry's entry is the only
    // committed deletion entry for k.
    vi.spyOn(captureRepo, 'deleteCapture').mockImplementation(realDelete)
    const retry = await lifecycle.deleteMany(caseId, result.failedIds)
    expect(retry.outcomes.map((o) => o.status)).toEqual(['deleted', 'deleted'])
    expect(retry.manifest).toEqual({ baseIndex: baseIndex + 1, committedEntries: 2 })
    const entries = manifestEntries()
    expect(entries).toHaveLength(baseIndex + 3)
    expect(entries.slice(baseIndex).map((e) => e.captureId)).toEqual(caps.map((c) => c.id))
    expect(entries.filter((e) => e.captureId === failing.id && e.type === 'deletion')).toHaveLength(
      1
    )
    expect(verifyManifestChain(caseDir).valid).toBe(true)
    expect(listCaptures(caseId)).toHaveLength(0)
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

  // #622 recovery path. The artefact is not repairable from the manifest — it
  // holds the claim, not the data — so the documented remedy is to run the
  // delete again. This asserts that remedy works from the worst version of the
  // state (files already unlinked before the crash) and that it clears the
  // finding the Diagnostics panel raises.
  it('re-running delete over the crash artefact appends a clean entry and clears the finding', async () => {
    const lifecycle = createCaptureLifecycle({ selectorLifecycle: selectorStub })
    const [a] = await ingestN(lifecycle, 1)
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
    // The crash landed after the unlink, before the row delete: files gone, row
    // live. deleteArtifacts guards each unlink with existsSync, so the retry
    // must not throw over the missing files.
    createCaptureStore({ getRoot: getStorageRoot }).deleteArtifacts(caseId, a.id)
    expect(mhtmlExists(a)).toBe(false)
    expect(scanUnreconciledDeletions().findings.map((f) => f.captureId)).toEqual([a.id])

    expect(await lifecycle.delete(a.id)).toBe(true)

    // Two deletion entries for the same capture: the stale one stays, because
    // the manifest is append-only. The chain still verifies over both.
    expect(
      manifestEntries().filter((e) => e.type === 'deletion' && e.captureId === a.id)
    ).toHaveLength(2)
    expect(verifyManifestChain(caseDir).valid).toBe(true)
    expect(getCapture(a.id)).toBeUndefined()
    expect(scanUnreconciledDeletions().findings).toEqual([])
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

  it('returns the same verdict without writing when record is false (ADR-0036)', async () => {
    const lifecycle = createCaptureLifecycle({ selectorLifecycle: selectorStub })
    const { capture } = await lifecycle.ingest(buildIngestParams(caseId, Buffer.from('read-only')))
    await flushImmediate()
    // A stamp the mirror has not caught up with: the recording path would
    // reconcile trusted_time_status, so an unchanged row proves nothing ran.
    const token = buildSyntheticToken({
      contentHash: capture.hash,
      genTime: new Date('2026-05-30T09:05:00.000Z'),
      tsaDnsName: 'tsa.example.com'
    })
    appendManifestEntry(join(tempDir, 'captures', caseId), {
      type: 'timestamp',
      caseId,
      captureContentHash: capture.hash,
      timestamp: '2026-05-30T09:05:00.000Z',
      tsaToken: token.toString('base64'),
      operatorId: 'op-1',
      operatorName: 'Op',
      toolVersion: '0.1.0'
    })
    const before = getCapture(capture.id)

    const result = await verifyCapture(capture.id, undefined, { record: false })

    expect(result.status).toBe('verified')
    expect(result.trustedTime).toBe('rfc3161')
    expect(getCapture(capture.id)).toEqual(before)
    expect(before?.lastVerifiedStatus).toBeUndefined()
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

  // #1661: an absent file shows nothing about whether any bytes changed, so it
  // is reported as missing, the status an unreadable page file already gets.
  const sha256 = (data: string): string => createHash('sha256').update(data).digest('hex')
  const textPathOf = (id: string): string => join(getStorageRoot(), caseId, `${id}.txt`)

  it('reports missing, not tampered, when the recorded screenshot file is absent (#1661)', async () => {
    const lifecycle = createCaptureLifecycle({ selectorLifecycle: selectorStub })
    const { capture } = await lifecycle.ingest(
      buildIngestParams(caseId, Buffer.from('mhtml-body'), { screenshot: Buffer.from('shot') })
    )
    expect((await lifecycle.verify(capture.id)).status).toBe('verified')

    rmSync(join(getStorageRoot(), capture.screenshotPath!))

    const result = await lifecycle.verify(capture.id)
    expect(result.status).toBe('missing')
    expect(result.reason).toBe(
      'Screenshot missing: expected ' + sha256('shot').slice(0, 12) + '...'
    )
    expect(result.chainValid).toBe(true)
    expect(getCapture(capture.id)?.lastVerifiedStatus).toBe('missing')
  })

  it('reports missing, not tampered, when the recorded extracted-text file is absent (#1661)', async () => {
    const lifecycle = createCaptureLifecycle({ selectorLifecycle: selectorStub })
    const { capture } = await lifecycle.ingest(
      buildIngestParams(caseId, Buffer.from('mhtml-body'), { textContent: 'original text' })
    )
    expect((await lifecycle.verify(capture.id)).status).toBe('verified')

    rmSync(textPathOf(capture.id))

    const result = await lifecycle.verify(capture.id)
    expect(result.status).toBe('missing')
    expect(result.reason).toBe(
      'Extracted text missing: expected ' + sha256('original text').slice(0, 12) + '...'
    )
    expect(result.chainValid).toBe(true)
    expect(getCapture(capture.id)?.lastVerifiedStatus).toBe('missing')
  })

  it('reports an altered file as tampered even when the other recorded file is absent (#1661)', async () => {
    const { writeFileSync } = await import('fs')
    const lifecycle = createCaptureLifecycle({ selectorLifecycle: selectorStub })
    const params = { screenshot: Buffer.from('shot'), textContent: 'original text' }

    const { capture: textAltered } = await lifecycle.ingest(
      buildIngestParams(caseId, Buffer.from('first-body'), params)
    )
    rmSync(join(getStorageRoot(), textAltered.screenshotPath!))
    writeFileSync(textPathOf(textAltered.id), 'altered text', 'utf-8')
    const first = await lifecycle.verify(textAltered.id)
    expect(first.status).toBe('tampered')
    expect(first.reason).toBe(
      'Extracted text hash mismatch: expected ' +
        sha256('original text') +
        ', got ' +
        sha256('altered text')
    )

    const { capture: shotAltered } = await lifecycle.ingest(
      buildIngestParams(caseId, Buffer.from('second-body'), params)
    )
    writeFileSync(join(getStorageRoot(), shotAltered.screenshotPath!), 'altered shot')
    rmSync(textPathOf(shotAltered.id))
    const second = await lifecycle.verify(shotAltered.id)
    expect(second.status).toBe('tampered')
    expect(second.reason).toBe(
      'Screenshot hash mismatch: expected ' + sha256('shot') + ', got ' + sha256('altered shot')
    )
  })

  it('does not check a file with no recorded hash, including after an absent one (#1661)', async () => {
    const { writeFileSync } = await import('fs')
    const lifecycle = createCaptureLifecycle({ selectorLifecycle: selectorStub })

    // No screenshot recorded and none on disk: not reported as missing.
    const { capture: noShot } = await lifecycle.ingest(
      buildIngestParams(caseId, Buffer.from('first-body'))
    )
    expect(getCapture(noShot.id)?.screenshotHash).toBeUndefined()
    expect((await lifecycle.verify(noShot.id)).status).toBe('verified')

    // No text recorded: the absent screenshot lets the scan continue, and a
    // stray text file still yields no finding of its own.
    const { capture: noText } = await lifecycle.ingest(
      buildIngestParams(caseId, Buffer.from('second-body'), {
        screenshot: Buffer.from('shot'),
        textContent: ''
      })
    )
    expect(getCapture(noText.id)?.textHash).toBeUndefined()
    writeFileSync(textPathOf(noText.id), 'stray text', 'utf-8')
    rmSync(join(getStorageRoot(), noText.screenshotPath!))
    const result = await lifecycle.verify(noText.id)
    expect(result.status).toBe('missing')
    expect(result.reason).toBe(
      'Screenshot missing: expected ' + sha256('shot').slice(0, 12) + '...'
    )
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

  // KAT for the fourth outcome (X25): a chain holding a signed entry from a
  // newer schema is reported as such, never as a broken chain or as tampering.
  it('reports verifier-too-old for a chain with a newer-schema entry, and persists it', async () => {
    const { writeFileSync } = await import('fs')
    const { MANIFEST_FILENAME } = await import('@shared/constants')
    const lifecycle = createCaptureLifecycle({ selectorLifecycle: selectorStub })
    const { capture } = await lifecycle.ingest(buildIngestParams(caseId, Buffer.from('mhtml-body')))
    const manifestPath = join(getStorageRoot(), caseId, MANIFEST_FILENAME)
    writeFileSync(manifestPath, appendFutureEntry(readFileSync(manifestPath, 'utf-8'), caseId))

    const result = await lifecycle.verify(capture.id)
    expect(result.status).toBe('verifier-too-old')
    expect(result.chainValid).toBe(false)
    expect(result.reason).toContain("Entry type 'annotation-burn' from a newer schema")
    expect(result.reason).toContain('verifier too old')
    expect(getCapture(capture.id)?.lastVerifiedStatus).toBe('verifier-too-old')
  })

  it('makes no byte-level claim on a chain this build cannot read', async () => {
    // The same precedence chain-broken has: a stored-hash comparison is only
    // meaningful against a chain that verified, so it is never reached here.
    const { writeFileSync } = await import('fs')
    const { MANIFEST_FILENAME } = await import('@shared/constants')
    const lifecycle = createCaptureLifecycle({ selectorLifecycle: selectorStub })
    const { capture } = await lifecycle.ingest(buildIngestParams(caseId, Buffer.from('mhtml-body')))
    const manifestPath = join(getStorageRoot(), caseId, MANIFEST_FILENAME)
    writeFileSync(manifestPath, appendFutureEntry(readFileSync(manifestPath, 'utf-8'), caseId))
    writeFileSync(join(getStorageRoot(), capture.mhtmlPath!), 'changed bytes')

    expect((await lifecycle.verify(capture.id)).status).toBe('verifier-too-old')
  })

  it('still reports chain-broken when the edited entry also claims a newer schema', async () => {
    const { writeFileSync } = await import('fs')
    const { MANIFEST_FILENAME } = await import('@shared/constants')
    const lifecycle = createCaptureLifecycle({ selectorLifecycle: selectorStub })
    const { capture } = await lifecycle.ingest(buildIngestParams(caseId, Buffer.from('mhtml-body')))
    const manifestPath = join(getStorageRoot(), caseId, MANIFEST_FILENAME)
    const lines = readFileSync(manifestPath, 'utf-8')
      .split('\n')
      .filter((l) => l.trim())
    const at = lines.findIndex(
      (l) => (JSON.parse(l) as { captureId?: string }).captureId === capture.id
    )
    // Editing the body and bumping its version in one go: the entry's own hash
    // is checked before the too-old outcome is reported, so the bump buys nothing.
    const edited = { ...JSON.parse(lines[at]), url: 'https://elsewhere.example', schemaVersion: 99 }
    lines[at] = JSON.stringify(edited)
    writeFileSync(manifestPath, lines.join('\n') + '\n', 'utf-8')

    const result = await lifecycle.verify(capture.id)
    expect(result.status).toBe('chain-broken')
    expect(result.reason).toBe('Entry hash mismatch')
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
