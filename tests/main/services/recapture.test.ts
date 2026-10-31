import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  createReadStream,
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { once } from 'events'
import { createHash } from 'crypto'
import { MANIFEST_FILENAME } from '@shared/constants'
import { initStorage, ensureCaseDir, getStorageRoot } from '@main/services/storage'
import { initDatabase, closeDatabase } from '@main/services/db/core'
import { createCase, setAutoCapturePolicy } from '@main/services/db/caseRepo'
import { getCapture } from '@main/services/db/captureRepo'
import { initInstallationId, resetInstallationId } from '@main/services/installationId'
import { initSettings, updateSettings } from '@main/services/settings'
import { createCaptureLifecycle, verifyCapture } from '@main/services/captureLifecycle'
import type { SelectorLifecycle } from '@main/services/selectorLifecycle'
import {
  createRecaptureService,
  looksLikeLoginWall,
  redirectedFinalUrl,
  type RenderedPage,
  type RenderPage,
  type ScreenshotRecord
} from '@main/services/recapture'
import { RefusedAddressError } from '@main/services/localAddressPolicy'
import { logger } from '@main/services/logger'
import { ManifestEntrySchema, type BoundTls, type ScrollToLoadRecord } from '@shared/schemas'
import type { CaptureEvent, Capture } from '@shared/types'

vi.mock('@main/services/tlsCertChain', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/services/tlsCertChain')>()
  return { ...actual, fetchCertChain: vi.fn(async () => null) }
})

// A 20000px page that stopped growing, its screenshot cut short at the 16384px
// texture ceiling.
const SCREENSHOT_RECORD: ScreenshotRecord = {
  scaled: false,
  truncated: true,
  trimmed: false,
  contentWidth: 1280,
  contentHeight: 20000,
  width: 1280,
  height: 16384
}

const SCROLL_TO_LOAD: ScrollToLoadRecord = {
  requested: true,
  ran: true,
  outcome: 'stopped-growing',
  endHeight: 20000,
  scrollLockLifted: true
}

// Step 9: invented record bytes, its inventory part, and the main document's
// Bound TLS Details. The store and the hash take the bytes as they are.
const WARC_GZ = Buffer.from('invented transaction record bytes')
const WARC_SHA256 = createHash('sha256').update(WARC_GZ).digest('hex')
const TRANSACTION_RECORD_PART = {
  present: true as const,
  exchanges: 4,
  cached: 1,
  cancelled: 1,
  failed: 0,
  inFlight: 1,
  finishedWithoutResponse: 1,
  bodiesOmitted: 1,
  incompleteRequestBodies: 0,
  webSockets: 0,
  recordedTargets: 2,
  unrecordedTargets: 1,
  replacedHeaders: ['cookie' as const, 'set-cookie' as const],
  budget: { totalBytes: 50_000_000, resourceBytes: 10_000_000 }
}
const BOUND_TLS: BoundTls = {
  protocol: 'TLS 1.3',
  keyExchange: '',
  keyExchangeGroup: 'X25519',
  cipher: 'AES_128_GCM',
  subjectName: 'example.com',
  sanList: ['example.com'],
  issuer: 'Invented CA',
  validFrom: '2026-01-01T00:00:00.000Z',
  validTo: '2027-01-01T00:00:00.000Z',
  signedCertificateTimestampList: [],
  certificateTransparencyCompliance: 'unknown',
  encryptedClientHello: false
}
const RECORDED: RenderedPage['transactionRecord'] = {
  present: true,
  warcGz: WARC_GZ,
  inventory: TRANSACTION_RECORD_PART,
  boundTls: BOUND_TLS
}

function fakeRender(overrides: Partial<RenderedPage> = {}): RenderPage {
  return async (url) => ({
    mhtmlStream: (async function* () {
      yield Buffer.from(`mhtml-of-${url}`)
    })(),
    screenshot: Buffer.from('png-bytes'),
    screenshotRecord: SCREENSHOT_RECORD,
    scrollToLoad: SCROLL_TO_LOAD,
    text: 'page text',
    title: 'Page Title',
    finalUrl: url,
    httpStatus: 200,
    userAgent: 'HiddenWindow UA',
    browserVersion: 'Chrome/130',
    transactionRecord: RECORDED,
    cleanup: async () => {},
    ...overrides
  })
}

describe('recapture service', () => {
  let tempDir: string
  let caseId: string
  let events: CaptureEvent[]
  let newCaptures: Capture[]
  const selectorLifecycle = {
    runActiveSelectorsForCapture: vi.fn()
  } as unknown as SelectorLifecycle

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-recapture-'))
    initStorage(join(tempDir, 'captures'))
    await initDatabase(':memory:')
    initSettings(tempDir)
    resetInstallationId()
    initInstallationId(tempDir)
    updateSettings({ operatorName: 'Op' })
    caseId = createCase({ name: 'Recapture' }).id
    ensureCaseDir(caseId)
    events = []
    newCaptures = []
  })

  afterEach(() => {
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  function makeService(renderPage: RenderPage, timeoutMs = 45_000) {
    const captureLifecycle = createCaptureLifecycle({ selectorLifecycle })
    return createRecaptureService({
      renderPage,
      captureLifecycle,
      emitEvent: (e) => events.push(e),
      emitNewCapture: (c) => newCaptures.push(c),
      timeoutMs
    })
  }

  it('captures a URL end-to-end with background provenance', async () => {
    const svc = makeService(fakeRender())
    const res = svc.enqueue([{ url: 'https://example.com/page', caseId }])
    expect(res.accepted).toBe(1)
    await svc.idle()
    expect(newCaptures).toHaveLength(1)
    const cap = getCapture(newCaptures[0].id)!
    expect(cap.method).toBe('background')
    expect(cap.userAgent).toBe('HiddenWindow UA')
    expect(cap.extensionVersion).toBeUndefined()
    const stored = events.find((e) => e.type === 'stored')
    expect(stored?.source).toBe('recapture')
  })

  it('records the supersedes link', async () => {
    const svc = makeService(fakeRender())
    svc.enqueue([{ url: 'https://example.com/a', caseId }])
    await svc.idle()
    const originalId = newCaptures[0].id
    svc.enqueue([{ url: 'https://example.com/a', caseId, supersedesCaptureId: originalId }])
    await svc.idle()
    expect(getCapture(newCaptures[1].id)!.supersedesCaptureId).toBe(originalId)
  })

  it('records consent-suppression provenance in the capture row and manifest entry', async () => {
    const svc = makeService(fakeRender({ consentSuppression: 'filter-list' }))
    svc.enqueue([{ url: 'https://example.com/page', caseId }])
    await svc.idle()
    expect(newCaptures).toHaveLength(1)
    expect(getCapture(newCaptures[0].id)!.consentSuppression).toBe('filter-list')
    const manifest = readFileSync(join(getStorageRoot(), caseId, MANIFEST_FILENAME), 'utf-8')
    expect(manifest).toContain('"consentSuppression":"filter-list"')
    // The chain must still verify with the new field present — the verifier's
    // strict entry schema silently rejects unknown keys as chain-broken.
    const verification = await verifyCapture(newCaptures[0].id)
    expect(verification.status).toBe('verified')
  })

  // D4, D5 and D9 of docs/plans/2026-10-10-capture-engine-first-slice.md.
  describe('the inventory and the Scroll-to-load record', () => {
    const INVENTORY = {
      mhtml: { present: true, pinnedImages: 0, pinnedImagesNotLoaded: 0 },
      transactionRecord: TRANSACTION_RECORD_PART,
      screenshot: { present: true, ...SCREENSHOT_RECORD },
      pdf: { present: false, reason: 'not-taken' }
    }

    function captureEntries(): Array<Record<string, unknown>> {
      return readFileSync(join(getStorageRoot(), caseId, MANIFEST_FILENAME), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .filter((entry) => entry.type === 'capture')
    }

    it('signs both in the entry, which the strict schema accepts, and mirrors both on the row', async () => {
      const svc = makeService(fakeRender())
      svc.enqueue([{ url: 'https://example.com/page', caseId }])
      await svc.idle()

      const [entry] = captureEntries()
      // `appendManifestEntry` signs without a schema check, so this is where a
      // shape the verifier would refuse is caught.
      const parsed = ManifestEntrySchema.safeParse(entry)
      expect(parsed.success ? [] : parsed.error.issues).toEqual([])
      expect(entry).toMatchObject({
        method: 'background',
        inventory: INVENTORY,
        scrollToLoad: SCROLL_TO_LOAD,
        schemaVersion: 6
      })
      expect(entry).not.toHaveProperty('pdfHash')

      const row = getCapture(newCaptures[0].id)!
      expect(row.inventory).toEqual(INVENTORY)
      expect(row.scrollToLoad).toEqual(SCROLL_TO_LOAD)
      await expect(verifyCapture(row.id)).resolves.toMatchObject({ status: 'verified' })
    })

    // Step 9 of docs/plans/2026-10-10-capture-engine-first-slice.md.
    it('stores the Transaction Record and signs its hash and Bound TLS Details', async () => {
      const seen: string[] = []
      const svc = makeService(async (url, opts) => {
        seen.push(opts.captureId)
        return fakeRender()(url, opts)
      })
      svc.enqueue([{ url: 'https://example.com/page', caseId }])
      await svc.idle()

      const [entry] = captureEntries()
      const parsed = ManifestEntrySchema.safeParse(entry)
      expect(parsed.success ? [] : parsed.error.issues).toEqual([])
      expect(entry).toMatchObject({
        transactionRecordHash: WARC_SHA256,
        boundTls: BOUND_TLS,
        inventory: { transactionRecord: TRANSACTION_RECORD_PART }
      })
      expect(entry).not.toHaveProperty('boundTlsAbsent')
      // The record's `warcinfo` names the id the render was given, so the Capture keeps it.
      expect(entry.captureId).toBe(seen[0])
      expect(newCaptures[0].id).toBe(seen[0])
      const file = join(getStorageRoot(), caseId, `${seen[0]}.warc.gz`)
      expect(readFileSync(file).equals(WARC_GZ)).toBe(true)

      const row = getCapture(seen[0])!
      expect(row.transactionRecordHash).toBe(WARC_SHA256)
      expect(row.boundTls).toEqual(BOUND_TLS)
      expect(row.boundTlsAbsent).toBeUndefined()
      await expect(verifyCapture(row.id)).resolves.toMatchObject({ status: 'verified' })

      // A changed byte in the stored record fails verification.
      writeFileSync(file, Buffer.from('invented transaction record byteS'))
      await expect(verifyCapture(row.id)).resolves.toMatchObject({ status: 'tampered' })
    })

    it('signs why Bound TLS Details are absent beside a present record', async () => {
      const svc = makeService(
        fakeRender({
          transactionRecord: {
            present: true,
            warcGz: WARC_GZ,
            inventory: TRANSACTION_RECORD_PART,
            boundTlsAbsent: 'not-https'
          }
        })
      )
      svc.enqueue([{ url: 'http://example.com/page', caseId }])
      await svc.idle()

      const [entry] = captureEntries()
      expect(ManifestEntrySchema.safeParse(entry).success).toBe(true)
      expect(entry.boundTlsAbsent).toBe('not-https')
      expect(entry).not.toHaveProperty('boundTls')
      expect(getCapture(newCaptures[0].id)!.boundTlsAbsent).toBe('not-https')
    })

    it('stores the Capture with the record absent as failed and Bound TLS Details not-recorded', async () => {
      const svc = makeService(
        fakeRender({
          transactionRecord: {
            present: false,
            reason: 'failed',
            error: new Error('The body fetches did not settle within 5000ms')
          }
        })
      )
      svc.enqueue([{ url: 'https://example.com/page', caseId }])
      await svc.idle()

      expect(events.map(({ type }) => type)).toEqual(['received', 'stored'])
      const [entry] = captureEntries()
      const parsed = ManifestEntrySchema.safeParse(entry)
      expect(parsed.success ? [] : parsed.error.issues).toEqual([])
      expect(entry).toMatchObject({
        inventory: { transactionRecord: { present: false, reason: 'failed' } },
        boundTlsAbsent: 'not-recorded'
      })
      expect(entry).not.toHaveProperty('transactionRecordHash')
      expect(entry).not.toHaveProperty('boundTls')
      const row = getCapture(newCaptures[0].id)!
      expect(row.transactionRecordHash).toBeUndefined()
      expect(row.boundTlsAbsent).toBe('not-recorded')
      expect(existsSync(join(getStorageRoot(), caseId, `${row.id}.warc.gz`))).toBe(false)
      await expect(verifyCapture(row.id)).resolves.toMatchObject({ status: 'verified' })
    })

    // Finding 4 of the review of #1999: the Operator hears of a stored Capture only once it is.
    describe('the notice that the record failed', () => {
      const FAILED: RenderedPage['transactionRecord'] = {
        present: false,
        reason: 'failed',
        error: new Error('The body fetches did not settle within 5000ms')
      }
      const notices = (spy: { mock: { calls: unknown[][] } }) =>
        spy.mock.calls.filter(([, code]) => code === 'backgroundRenderer.transaction_record_failed')

      afterEach(() => {
        vi.restoreAllMocks()
      })

      it('is logged once the Capture is stored, with the error', async () => {
        const spy = vi.spyOn(logger, 'error')
        let storedWhenLogged = false
        spy.mockImplementation((_source, code) => {
          if (code === 'backgroundRenderer.transaction_record_failed') {
            storedWhenLogged = readFileSync(
              join(getStorageRoot(), caseId, MANIFEST_FILENAME),
              'utf-8'
            ).includes('"type":"capture"')
          }
          return ''
        })
        const svc = makeService(fakeRender({ transactionRecord: FAILED }))
        svc.enqueue([{ url: 'https://example.com/page', caseId }])
        await svc.idle()
        expect(notices(spy)).toEqual([
          [
            'backgroundRenderer',
            'backgroundRenderer.transaction_record_failed',
            undefined,
            FAILED.error
          ]
        ])
        expect(storedWhenLogged).toBe(true)
      })

      it('is not logged when the job then refuses the final URL', async () => {
        const spy = vi.spyOn(logger, 'error')
        const svc = makeService(
          fakeRender({ transactionRecord: FAILED, finalUrl: 'http://192.168.1.1/' })
        )
        svc.enqueue([{ url: 'https://example.com/page', caseId }])
        await svc.idle()
        expect(events.map(({ type }) => type)).toEqual(['received', 'skipped'])
        expect(notices(spy)).toEqual([])
      })

      it('is not logged when the ingest fails', async () => {
        const spy = vi.spyOn(logger, 'error')
        const failing = createCaptureLifecycle({ selectorLifecycle })
        const svc = createRecaptureService({
          renderPage: fakeRender({ transactionRecord: FAILED }),
          captureLifecycle: {
            ...failing,
            ingest: () => Promise.reject(new Error('disk full'))
          },
          emitEvent: (e) => events.push(e),
          emitNewCapture: (c) => newCaptures.push(c)
        })
        svc.enqueue([{ url: 'https://example.com/page', caseId }])
        await svc.idle()
        expect(events.map(({ type }) => type)).toEqual(['received', 'failed'])
        expect(notices(spy)).toEqual([])
      })
    })

    it('signs a phase that did not run with no outcome and no height', async () => {
      const notRun: ScrollToLoadRecord = { requested: true, ran: false, scrollLockLifted: false }
      const svc = makeService(fakeRender({ scrollToLoad: notRun }))
      svc.enqueue([{ url: 'https://example.com/page', caseId }])
      await svc.idle()

      const [entry] = captureEntries()
      expect(ManifestEntrySchema.safeParse(entry).success).toBe(true)
      expect(entry.scrollToLoad).toEqual(notRun)
      expect(getCapture(newCaptures[0].id)!.scrollToLoad).toEqual(notRun)
    })

    it("re-anchors both on a Duplicate's entry and mirrors them on its row", async () => {
      const lifecycle = createCaptureLifecycle({ selectorLifecycle })
      const svc = createRecaptureService({
        renderPage: fakeRender(),
        captureLifecycle: lifecycle,
        emitEvent: (e) => events.push(e),
        emitNewCapture: (c) => newCaptures.push(c)
      })
      svc.enqueue([{ url: 'https://example.com/page', caseId }])
      await svc.idle()

      const result = await lifecycle.duplicate(newCaptures[0].id)
      if (result.status !== 'duplicated') throw new Error('expected a duplicate')

      const [, copy] = captureEntries()
      const parsed = ManifestEntrySchema.safeParse(copy)
      expect(parsed.success ? [] : parsed.error.issues).toEqual([])
      expect(copy).toMatchObject({
        method: 'duplicate',
        inventory: INVENTORY,
        scrollToLoad: SCROLL_TO_LOAD,
        transactionRecordHash: WARC_SHA256
      })
      // D11: a Duplicate writes no Bound TLS Details, and its row mirrors its entry.
      expect(copy).not.toHaveProperty('boundTls')
      expect(copy).not.toHaveProperty('boundTlsAbsent')
      const row = getCapture(result.capture.id)!
      expect(row.inventory).toEqual(INVENTORY)
      expect(row.scrollToLoad).toEqual(SCROLL_TO_LOAD)
      expect(row.transactionRecordHash).toBe(WARC_SHA256)
      expect(row.boundTls).toBeUndefined()
      expect(row.boundTlsAbsent).toBeUndefined()
      await expect(verifyCapture(row.id)).resolves.toMatchObject({ status: 'verified' })
    })
  })

  it('signs the Egress the render went through, its label and the user agent (ADR-0032)', async () => {
    const svc = makeService(fakeRender({ egress: { kind: 'tor', label: 'Tor Browser' } }))
    svc.enqueue([{ url: 'https://example.com/page', caseId }])
    await svc.idle()
    expect(newCaptures).toHaveLength(1)
    const lines = readFileSync(join(getStorageRoot(), caseId, MANIFEST_FILENAME), 'utf-8')
      .trim()
      .split('\n')
    const entry = JSON.parse(lines[lines.length - 1])
    expect(entry).toMatchObject({
      egressKind: 'tor',
      egressLabel: 'Tor Browser',
      userAgent: 'HiddenWindow UA',
      tlsSkipped: 'egress-not-direct'
    })
    expect((await verifyCapture(newCaptures[0].id)).status).toBe('verified')
  })

  it('omits consent-suppression provenance when the renderer did not suppress', async () => {
    const svc = makeService(fakeRender())
    svc.enqueue([{ url: 'https://example.com/page', caseId }])
    await svc.idle()
    expect(getCapture(newCaptures[0].id)!.consentSuppression).toBeUndefined()
    const manifest = readFileSync(join(getStorageRoot(), caseId, MANIFEST_FILENAME), 'utf-8')
    expect(manifest).not.toContain('consentSuppression')
  })

  it('anchors the final post-redirect URL when the render redirected (#797)', async () => {
    const svc = makeService(fakeRender({ finalUrl: 'https://example.com/landing' }))
    svc.enqueue([{ url: 'https://example.com/page', caseId }])
    await svc.idle()

    // The capture is stored under the URL the bytes came from, as it always
    // has been. `finalUrl` is what lets a chain reader tell that the stored URL
    // is a redirect target and not where the operator aimed.
    expect(getCapture(newCaptures[0].id)!.url).toBe('https://example.com/landing')
    const manifest = readFileSync(join(getStorageRoot(), caseId, MANIFEST_FILENAME), 'utf-8')
    expect(manifest).toContain('"finalUrl":"https://example.com/landing"')
    expect(manifest).toContain('"httpStatus":200')
    // The verifier's strict entry schema rejects unknown keys as chain-broken,
    // so this is also the check that the new fields are readable.
    const verification = await verifyCapture(newCaptures[0].id)
    expect(verification.status).toBe('verified')
  })

  it('omits the final URL when the requested URL is what was served (#797)', async () => {
    const svc = makeService(fakeRender())
    svc.enqueue([{ url: 'https://example.com/page', caseId }])
    await svc.idle()
    const manifest = readFileSync(join(getStorageRoot(), caseId, MANIFEST_FILENAME), 'utf-8')
    // Writing the requested URL here would claim a redirect that never
    // happened, so nothing is written at all.
    expect(manifest).not.toContain('finalUrl')
  })

  it('omits the final URL when only canonicalization differs (#797)', async () => {
    // The real renderer returns `wc.getURL()`, which is always canonical; the
    // operator's pasted URL is not. The fake above echoes its input, so it
    // cannot reach this case — pin the canonical form explicitly.
    const svc = makeService(fakeRender({ finalUrl: 'https://example.com/' }))
    svc.enqueue([{ url: 'https://example.com', caseId }])
    await svc.idle()
    const manifest = readFileSync(join(getStorageRoot(), caseId, MANIFEST_FILENAME), 'utf-8')
    expect(manifest).not.toContain('finalUrl')
    const verification = await verifyCapture(newCaptures[0].id)
    expect(verification.status).toBe('verified')
  })

  it('runs jobs serially in FIFO order', async () => {
    const order: string[] = []
    const gate: Array<() => void> = []
    const render: RenderPage = async (url, opts) => {
      order.push(`start:${url}`)
      await new Promise<void>((resolve) => gate.push(resolve))
      order.push(`end:${url}`)
      return fakeRender()(url, opts)
    }
    const svc = makeService(render)
    svc.enqueue([
      { url: 'https://example.com/1', caseId },
      { url: 'https://example.com/2', caseId }
    ])
    // Only the first job may start until its render resolves.
    await vi.waitFor(() => expect(order).toContain('start:https://example.com/1'))
    expect(order).not.toContain('start:https://example.com/2')
    gate.shift()!()
    await vi.waitFor(() => expect(order).toContain('start:https://example.com/2'))
    gate.shift()!()
    await svc.idle()
    expect(newCaptures).toHaveLength(2)
  })

  it('rejects invalid URLs at enqueue with per-URL reasons', async () => {
    const svc = makeService(fakeRender())
    const res = svc.enqueue([
      { url: 'not-a-url', caseId },
      { url: 'ftp://example.com/x', caseId },
      { url: 'https://example.com/ok', caseId }
    ])
    expect(res.accepted).toBe(1)
    expect(res.rejected).toHaveLength(2)
    expect(res.rejected[0].url).toBe('not-a-url')
    // The one accepted URL still triggers a background job — drain it before the
    // test ends so it doesn't leak into the next test's shared db/storage fixtures.
    await svc.idle()
  })

  // #400: the per-case exclusion list blocks every capture route, manual
  // included. Recapture is a producer the capture server never sees, so it
  // enforces the list itself — at enqueue for the requested URL, and again
  // after the render for the URL that would actually be stored.
  it('refuses a recapture of an excluded URL at enqueue, naming the pattern', async () => {
    setAutoCapturePolicy(caseId, { exclusions: ['secret.example.com'], mode: 'stack' })
    const svc = makeService(fakeRender())
    const res = svc.enqueue([
      { url: 'https://secret.example.com/page', caseId },
      { url: 'https://example.com/ok', caseId }
    ])
    expect(res.accepted).toBe(1)
    expect(res.rejected).toEqual([
      { url: 'https://secret.example.com/page', reason: 'Blacklisted: secret.example.com' }
    ])
    const skipped = events.find((e) => e.type === 'skipped')
    expect(skipped?.source).toBe('recapture')
    expect(skipped?.url).toBe('https://secret.example.com/page')
    expect(skipped?.skipReason).toBe('Blacklisted: secret.example.com')
    await svc.idle()
    // Only the permitted URL was ever rendered and stored.
    expect(newCaptures).toHaveLength(1)
    expect(getCapture(newCaptures[0].id)!.url).toBe('https://example.com/ok')
  })

  it('refuses a recapture that redirects into an excluded URL, before it is ingested', async () => {
    setAutoCapturePolicy(caseId, { exclusions: ['/\\/login$/', 'blocked.example'], mode: 'stack' })
    const svc = makeService(fakeRender({ finalUrl: 'https://blocked.example/landing' }))
    const res = svc.enqueue([{ url: 'https://example.com/page', caseId }])
    // The requested URL is clean, so the job is accepted and rendered.
    expect(res.accepted).toBe(1)
    await svc.idle()
    expect(newCaptures).toHaveLength(0)
    const skipped = events.find((e) => e.type === 'skipped')
    expect(skipped?.url).toBe('https://blocked.example/landing')
    expect(skipped?.skipReason).toBe('Blacklisted: blocked.example')
    expect(events.find((e) => e.type === 'stored')).toBeUndefined()
    // Nothing written to the database, and nothing appended to the hash chain:
    // the case directory has no manifest at all, because no entry was ever made.
    expect(existsSync(join(getStorageRoot(), caseId, MANIFEST_FILENAME))).toBe(false)
  })

  // A real ReadStream rather than a spy: what leaks is an open fd, and the
  // renderer's cleanup unlinks the temp file without closing it, so an
  // abandoned stream pins the deleted file's blocks (#766).
  it('releases the rendered stream when the redirect is blocked', async () => {
    setAutoCapturePolicy(caseId, { exclusions: ['blocked.example'], mode: 'stack' })
    const tmpFile = join(tempDir, 'rendered.mhtml')
    writeFileSync(tmpFile, 'mhtml-bytes')
    const mhtmlStream = createReadStream(tmpFile)
    // The fd is opened lazily, so wait for it: an assertion that a
    // never-opened stream is closed would pass without proving anything.
    await once(mhtmlStream, 'ready')
    const svc = makeService(
      fakeRender({ finalUrl: 'https://blocked.example/landing', mhtmlStream })
    )
    svc.enqueue([{ url: 'https://example.com/page', caseId }])
    await svc.idle()

    expect(newCaptures).toHaveLength(0)
    expect(mhtmlStream.destroyed).toBe(true)
    if (!mhtmlStream.closed) await once(mhtmlStream, 'close')
    expect(mhtmlStream.closed).toBe(true)
  })

  // Unit tests run with no Electron app, as a packaged build reads it: the e2e loopback
  // switch is off, so 127.0.0.1 is refused here as it is in production (#1726).
  it('refuses a link to a loopback or private address at enqueue, naming the class', async () => {
    let rendered = 0
    const svc = makeService(async (url, opts) => {
      rendered++
      return fakeRender()(url, opts)
    })
    const res = svc.enqueue([
      { url: 'http://127.0.0.1:8080/', caseId },
      { url: 'http://localhost/admin', caseId },
      { url: 'http://192.168.1.1/', caseId },
      { url: 'http://[::ffff:10.0.0.1]/', caseId },
      { url: 'http://wiki/', caseId }
    ])
    await svc.idle()

    expect(res.accepted).toBe(0)
    expect(res.rejected.map((r) => r.reason)).toEqual([
      'Points at a loopback address',
      'Points at this computer',
      'Points at a private address',
      'Points at a private address',
      'Points at a private network'
    ])
    expect(rendered).toBe(0)
    expect(newCaptures).toHaveLength(0)
  })

  function caseDirFiles(): string[] {
    return readdirSync(join(getStorageRoot(), caseId), { recursive: true }) as string[]
  }

  it.each([
    ['a loopback address', 'Redirects to a loopback address'],
    ['a private address', 'Redirects to a private address']
  ])('ends a job the renderer refused at a hop to %s, writing nothing', async (cls, reason) => {
    const before = caseDirFiles()
    const render: RenderPage = async () => {
      throw new RefusedAddressError(cls)
    }
    const svc = makeService(render)
    expect(svc.enqueue([{ url: 'https://public.example/r', caseId }]).accepted).toBe(1)
    await svc.idle()

    expect(events.filter((e) => e.type !== 'received')).toEqual([
      expect.objectContaining({
        type: 'skipped',
        source: 'recapture',
        url: 'https://public.example/r',
        skipReason: reason
      })
    ])
    expect(newCaptures).toHaveLength(0)
    expect(existsSync(join(getStorageRoot(), caseId, MANIFEST_FILENAME))).toBe(false)
    expect(caseDirFiles()).toEqual(before)
  })

  it('refuses a render whose final URL is a private address, before it is ingested', async () => {
    const before = caseDirFiles()
    const tmpFile = join(tempDir, 'rendered.mhtml')
    writeFileSync(tmpFile, 'mhtml-bytes')
    const mhtmlStream = createReadStream(tmpFile)
    await once(mhtmlStream, 'ready')
    const svc = makeService(fakeRender({ finalUrl: 'http://192.168.0.10/router', mhtmlStream }))
    svc.enqueue([{ url: 'https://public.example/r', caseId }])
    await svc.idle()

    expect(newCaptures).toHaveLength(0)
    const skipped = events.find((e) => e.type === 'skipped')
    expect(skipped?.url).toBe('https://public.example/r')
    expect(skipped?.skipReason).toBe('Redirects to a private address')
    expect(events.find((e) => e.type === 'stored' || e.type === 'failed')).toBeUndefined()
    expect(existsSync(join(getStorageRoot(), caseId, MANIFEST_FILENAME))).toBe(false)
    expect(caseDirFiles()).toEqual(before)
    expect(mhtmlStream.destroyed).toBe(true)
  })

  it('emits a failed event (and no capture) when rendering throws', async () => {
    const render: RenderPage = async () => {
      throw new Error('net::ERR_NAME_NOT_RESOLVED')
    }
    const svc = makeService(render)
    svc.enqueue([{ url: 'https://nope.invalid/', caseId }])
    await svc.idle()
    expect(newCaptures).toHaveLength(0)
    const failed = events.find((e) => e.type === 'failed')
    expect(failed?.error).toContain('ERR_NAME_NOT_RESOLVED')
    expect(failed?.source).toBe('recapture')
  })

  it('fails a job that exceeds the timeout', async () => {
    const render: RenderPage = (url, { timeoutMs }) =>
      new Promise(() => {
        // Contract: renderPage implementations honor timeoutMs themselves; the
        // service ALSO wraps with a race so a hung renderer cannot wedge the queue.
        void url
        void timeoutMs
      }) as Promise<RenderedPage>
    const svc = makeService(render, 50)
    svc.enqueue([{ url: 'https://slow.example.com/', caseId }])
    await svc.idle()
    const failed = events.find((e) => e.type === 'failed')
    expect(failed?.error).toMatch(/timed out/i)
  })

  it('stores login-wall pages but flags the stored event with a warning', async () => {
    const svc = makeService(
      fakeRender({ finalUrl: 'https://example.com/login?next=%2Fpage', title: 'Sign in' })
    )
    svc.enqueue([{ url: 'https://example.com/page', caseId }])
    await svc.idle()
    expect(newCaptures).toHaveLength(1)
    const stored = events.find((e) => e.type === 'stored')
    expect(stored?.warning).toMatch(/login/i)
  })
})

describe('looksLikeLoginWall', () => {
  it('flags login-ish titles', () => {
    expect(
      looksLikeLoginWall({
        requestedUrl: 'https://x.com/user',
        finalUrl: 'https://x.com/user',
        title: 'Log in to X'
      })
    ).toBe(true)
  })

  it('flags redirects to login paths', () => {
    expect(
      looksLikeLoginWall({
        requestedUrl: 'https://a.com/doc',
        finalUrl: 'https://a.com/accounts/signin?next=/doc',
        title: 'Welcome'
      })
    ).toBe(true)
  })

  it('flags off-hostname redirects', () => {
    expect(
      looksLikeLoginWall({
        requestedUrl: 'https://a.com/doc',
        finalUrl: 'https://sso.b.com/auth',
        title: 'Anything'
      })
    ).toBe(true)
  })

  it('passes normal pages', () => {
    expect(
      looksLikeLoginWall({
        requestedUrl: 'https://a.com/doc',
        finalUrl: 'https://a.com/doc',
        title: 'The Document'
      })
    ).toBe(false)
  })
})

describe('redirectedFinalUrl (#797)', () => {
  // Every pair here is the same destination spelled two ways. Reporting any of
  // them as a redirect would put a false provenance claim in a signed entry.
  it.each([
    ['https://example.com', 'https://example.com/'],
    ['https://Example.COM/Path', 'https://example.com/Path'],
    ['https://example.com:443/a', 'https://example.com/a'],
    ['http://example.com:80/a', 'http://example.com/a'],
    ['https://example.com/página', 'https://example.com/p%C3%A1gina']
  ])('treats %s and %s as the same destination', (requested, final) => {
    expect(redirectedFinalUrl(requested, final)).toBeUndefined()
  })

  it('reports a genuine redirect, verbatim as the renderer resolved it', () => {
    expect(redirectedFinalUrl('https://example.com/a', 'https://example.com/b')).toBe(
      'https://example.com/b'
    )
    expect(redirectedFinalUrl('https://example.com', 'https://elsewhere.test/')).toBe(
      'https://elsewhere.test/'
    )
  })

  it('compares unparseable input as text rather than throwing', () => {
    expect(redirectedFinalUrl('not a url', 'not a url')).toBeUndefined()
    expect(redirectedFinalUrl('not a url', 'https://example.com/')).toBe('https://example.com/')
  })
})
