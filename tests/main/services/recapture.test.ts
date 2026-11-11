import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  createReadStream,
  unlinkSync,
  existsSync,
  mkdirSync,
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
import { initDatabase, closeDatabase, getDb } from '@main/services/db/core'
import { createCase, setAutoCapturePolicy } from '@main/services/db/caseRepo'
import { getCapture, insertCapture, listCaptures } from '@main/services/db/captureRepo'
import { exportCaseArchive, importCaseArchive } from '@main/services/caseArchive'
import { defaultCaptureStore } from '@main/services/captureStore'
import { appendManifestEntry, initManifest } from '@main/services/manifest'
import { initInstallationId, resetInstallationId } from '@main/services/installationId'
import { initSettings, updateSettings } from '@main/services/settings'
import { createCaptureLifecycle, verifyCapture } from '@main/services/captureLifecycle'
import type { SelectorLifecycle } from '@main/services/selectorLifecycle'
import {
  RecaptureTimeout,
  createRecaptureService,
  looksLikeLoginWall,
  redirectedFinalUrl,
  type RenderedPage,
  type RenderPage,
  type ScreenshotRecord
} from '@main/services/recapture'
import { RefusedAddressError } from '@main/services/localAddressPolicy'
import { getExhibit } from '@main/services/db/exhibitRepo'
import { resetSigningKey } from '@main/services/signingKey'
import { resetSyncStateMemory } from '@main/services/sharing/syncState'
import { logger } from '@main/services/logger'
import { sanitizeError } from '@main/services/logSafe'
import { ManifestEntrySchema, type BoundTls, type ScrollToLoadRecord } from '@shared/schemas'
import type { CaptureEvent, Capture } from '@shared/types'
import {
  activate,
  addCapture,
  appendOwnChainLine,
  createPeer,
  memberAddBody,
  pull,
  recordSource,
  seedSharedCase,
  type Peer
} from '../../helpers/syncPeers'

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

// Distinct counts, so a part signed as 0 or with the two swapped shows.
const IMAGE_SOURCE_PINNING: RenderedPage['imageSourcePinning'] = {
  present: true,
  pinnedImages: 3,
  pinnedImagesNotLoaded: 1
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

// Step 10: invented PDF bytes, which the store and the hash take as they are.
const PDF = Buffer.from('%PDF-1.4 invented print of the page')
const PDF_SHA256 = createHash('sha256').update(PDF).digest('hex')
const PRINTED: RenderedPage['pdf'] = {
  present: true,
  bytes: PDF,
  inventory: { present: true, afterCollection: true }
}
const PRINT_FAILED: RenderedPage['pdf'] = {
  present: false,
  reason: 'failed',
  error: new Error('The print did not settle within 5000ms')
}

function fakeRender(overrides: Partial<RenderedPage> = {}): RenderPage {
  return async (url) => ({
    mhtmlStream: (async function* () {
      yield Buffer.from(`mhtml-of-${url}`)
    })(),
    screenshot: Buffer.from('png-bytes'),
    screenshotRecord: SCREENSHOT_RECORD,
    scrollToLoad: SCROLL_TO_LOAD,
    imageSourcePinning: IMAGE_SOURCE_PINNING,
    text: 'page text',
    title: 'Page Title',
    finalUrl: url,
    httpStatus: 200,
    userAgent: 'HiddenWindow UA',
    browserVersion: 'Chrome/130',
    transactionRecord: RECORDED,
    pdf: PRINTED,
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
      mhtml: IMAGE_SOURCE_PINNING,
      transactionRecord: TRANSACTION_RECORD_PART,
      screenshot: { present: true, ...SCREENSHOT_RECORD },
      pdf: { present: true, afterCollection: true }
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

      expect(events.map(({ type }) => type)).toEqual(['queued', 'received', 'stored'])
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

    // Step 10 of docs/plans/2026-10-10-capture-engine-first-slice.md.
    it('stores the PDF under the Capture id, signs its hash and part, and mirrors the hash', async () => {
      const svc = makeService(fakeRender())
      svc.enqueue([{ url: 'https://example.com/page', caseId }])
      await svc.idle()

      const [entry] = captureEntries()
      const parsed = ManifestEntrySchema.safeParse(entry)
      expect(parsed.success ? [] : parsed.error.issues).toEqual([])
      expect(entry).toMatchObject({
        pdfHash: PDF_SHA256,
        inventory: { pdf: { present: true, afterCollection: true } }
      })
      const row = getCapture(newCaptures[0].id)!
      expect(row.pdfHash).toBe(PDF_SHA256)
      const file = join(getStorageRoot(), caseId, `${row.id}.pdf`)
      expect(readFileSync(file).equals(PDF)).toBe(true)
      await expect(verifyCapture(row.id)).resolves.toMatchObject({ status: 'verified' })

      writeFileSync(file, Buffer.from('%PDF-1.4 invented print of the pagE'))
      await expect(verifyCapture(row.id)).resolves.toMatchObject({ status: 'tampered' })
    })

    it('stores the Capture with the PDF absent as failed, and no PDF file', async () => {
      const svc = makeService(fakeRender({ pdf: PRINT_FAILED }))
      svc.enqueue([{ url: 'https://example.com/page', caseId }])
      await svc.idle()

      expect(events.map(({ type }) => type)).toEqual(['queued', 'received', 'stored'])
      const [entry] = captureEntries()
      const parsed = ManifestEntrySchema.safeParse(entry)
      expect(parsed.success ? [] : parsed.error.issues).toEqual([])
      expect(entry).toMatchObject({
        inventory: { pdf: { present: false, reason: 'failed' } },
        transactionRecordHash: WARC_SHA256
      })
      expect(entry).not.toHaveProperty('pdfHash')
      const row = getCapture(newCaptures[0].id)!
      expect(row.pdfHash).toBeUndefined()
      expect(existsSync(join(getStorageRoot(), caseId, `${row.id}.pdf`))).toBe(false)
      await expect(verifyCapture(row.id)).resolves.toMatchObject({ status: 'verified' })
    })

    describe('the notice that the PDF failed', () => {
      const notices = (spy: { mock: { calls: unknown[][] } }) =>
        spy.mock.calls.filter(([, code]) => code === 'backgroundRenderer.pdf_failed')

      afterEach(() => {
        vi.restoreAllMocks()
      })

      it('is logged once the Capture is stored, with the error', async () => {
        const spy = vi.spyOn(logger, 'error')
        let storedWhenLogged = false
        spy.mockImplementation((_source, code) => {
          if (code === 'backgroundRenderer.pdf_failed') {
            storedWhenLogged = readFileSync(
              join(getStorageRoot(), caseId, MANIFEST_FILENAME),
              'utf-8'
            ).includes('"type":"capture"')
          }
          return ''
        })
        const svc = makeService(fakeRender({ pdf: PRINT_FAILED }))
        svc.enqueue([{ url: 'https://example.com/page', caseId }])
        await svc.idle()
        expect(notices(spy)).toEqual([
          ['backgroundRenderer', 'backgroundRenderer.pdf_failed', undefined, PRINT_FAILED.error]
        ])
        expect(storedWhenLogged).toBe(true)
      })

      it('is not logged for a printed PDF, or when the ingest fails', async () => {
        const spy = vi.spyOn(logger, 'error')
        const printed = makeService(fakeRender())
        printed.enqueue([{ url: 'https://example.com/page', caseId }])
        await printed.idle()

        const failing = createCaptureLifecycle({ selectorLifecycle })
        const svc = createRecaptureService({
          renderPage: fakeRender({ pdf: PRINT_FAILED }),
          captureLifecycle: { ...failing, ingest: () => Promise.reject(new Error('disk full')) },
          emitEvent: (e) => events.push(e),
          emitNewCapture: (c) => newCaptures.push(c)
        })
        svc.enqueue([{ url: 'https://example.com/other', caseId }])
        await svc.idle()
        expect(events.map(({ type }) => type)).toEqual([
          'queued',
          'received',
          'stored',
          'queued',
          'received',
          'failed'
        ])
        expect(notices(spy)).toEqual([])
      })
    })

    // Finding 4 of the review of #1999: the Operator hears of a stored Capture only once it is.
    describe('the notice that the record failed', () => {
      const FAILED: RenderedPage['transactionRecord'] = {
        present: false,
        reason: 'failed',
        error: new Error('The body fetches did not settle within 5000ms'),
        timeLeftMs: 4_321
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
            { captureId: newCaptures[0].id, timeLeftMs: 4_321 },
            FAILED.error
          ]
        ])
        expect(storedWhenLogged).toBe(true)
        // The time left reaches the log, not the signed inventory part.
        const entry = readFileSync(join(getStorageRoot(), caseId, MANIFEST_FILENAME), 'utf-8')
        expect(entry).toContain('"transactionRecord":{"present":false,"reason":"failed"}')
      })

      it('names no time left when the end phases never ran', async () => {
        const spy = vi.spyOn(logger, 'error')
        const svc = makeService(
          fakeRender({
            transactionRecord: {
              present: false,
              reason: 'failed',
              error: new Error('Network.enable failed or did not answer on the page')
            }
          })
        )
        svc.enqueue([{ url: 'https://example.com/page', caseId }])
        await svc.idle()
        expect(notices(spy).map(([, , context]) => context)).toEqual([
          { captureId: newCaptures[0].id }
        ])
      })

      it('is not logged when the job then refuses the final URL', async () => {
        const spy = vi.spyOn(logger, 'error')
        const svc = makeService(
          fakeRender({ transactionRecord: FAILED, finalUrl: 'http://192.168.1.1/' })
        )
        svc.enqueue([{ url: 'https://example.com/page', caseId }])
        await svc.idle()
        expect(events.map(({ type }) => type)).toEqual(['queued', 'received', 'skipped'])
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
        expect(events.map(({ type }) => type)).toEqual(['queued', 'received', 'failed'])
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
        transactionRecordHash: WARC_SHA256,
        pdfHash: PDF_SHA256
      })
      // D11: a Duplicate writes no Bound TLS Details, and its row mirrors its entry.
      expect(copy).not.toHaveProperty('boundTls')
      expect(copy).not.toHaveProperty('boundTlsAbsent')
      const row = getCapture(result.capture.id)!
      expect(row.inventory).toEqual(INVENTORY)
      expect(row.scrollToLoad).toEqual(SCROLL_TO_LOAD)
      expect(row.transactionRecordHash).toBe(WARC_SHA256)
      expect(row.pdfHash).toBe(PDF_SHA256)
      expect(readFileSync(join(getStorageRoot(), caseId, `${row.id}.pdf`)).equals(PDF)).toBe(true)
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

  // Slice 2 of docs/specs/2026-11-09-batch-capture-throughput-design.md (#2128).
  describe('job identity', () => {
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    const eventsOf = (jobId: string) => events.filter((e) => e.jobId === jobId)

    it('names each job and its Batch on every event, one Batch per call', async () => {
      const svc = makeService(fakeRender())
      const url = 'https://example.com/same'
      const first = svc.enqueue([
        { url, caseId },
        { url, caseId }
      ])
      const second = svc.enqueue([{ url, caseId }])
      await svc.idle()

      const jobIds = [...first.jobIds, ...second.jobIds]
      expect(jobIds).toHaveLength(3)
      expect(new Set(jobIds).size).toBe(3)
      for (const id of [...jobIds, first.batchId, second.batchId]) expect(id).toMatch(UUID)
      expect(second.batchId).not.toBe(first.batchId)
      expect(events.every((e) => e.jobId !== undefined)).toBe(true)
      for (const [jobId, batchId] of [
        [first.jobIds[0], first.batchId],
        [first.jobIds[1], first.batchId],
        [second.jobIds[0], second.batchId]
      ]) {
        expect(eventsOf(jobId).map(({ type, batchId }) => [type, batchId])).toEqual([
          ['queued', batchId],
          ['received', batchId],
          ['stored', batchId]
        ])
      }
    })

    it('emits one queued event per accepted job before the first render, and none for a refused URL', () => {
      setAutoCapturePolicy(caseId, { exclusions: ['secret.example.com'], mode: 'stack' })
      const seenAtRender: string[][] = []
      const svc = makeService(async (url, opts) => {
        seenAtRender.push(events.map(({ type }) => type))
        return fakeRender()(url, opts)
      })
      const original = 'capture-being-recaptured'
      const res = svc.enqueue([
        { url: 'https://example.com/a', caseId, supersedesCaptureId: original },
        { url: 'not-a-url', caseId },
        { url: 'https://secret.example.com/page', caseId },
        { url: 'https://example.com/b', caseId }
      ])

      expect(res.accepted).toBe(2)
      expect(res.rejected.map(({ url }) => url)).toEqual([
        'not-a-url',
        'https://secret.example.com/page'
      ])
      const queued = events.filter(({ type }) => type === 'queued')
      expect(queued).toEqual([
        expect.objectContaining({
          source: 'recapture',
          url: 'https://example.com/a',
          jobId: res.jobIds[0],
          batchId: res.batchId,
          supersedesCaptureId: original
        }),
        expect.objectContaining({
          source: 'recapture',
          url: 'https://example.com/b',
          jobId: res.jobIds[1],
          batchId: res.batchId
        })
      ])
      // The refused URL is no job: its skip names neither a job nor a Batch.
      expect(events.find(({ type }) => type === 'skipped')).not.toHaveProperty('jobId')
      // Both jobs are queued, in order, before the first one starts.
      expect(seenAtRender[0]).toEqual(['skipped', 'queued', 'queued', 'received'])
      return svc.idle()
    })

    it('reports queued and running jobs, with pending their sum', async () => {
      const gate: Array<() => void> = []
      const svc = makeService(async (url, opts) => {
        await new Promise<void>((resolve) => gate.push(resolve))
        return fakeRender()(url, opts)
      })
      const idle = {
        pending: 0,
        queued: 0,
        running: 0,
        held: 0,
        heldBatches: [],
        concurrency: 1,
        activeUrl: null
      }
      expect(svc.status()).toEqual(idle)

      svc.enqueue([
        { url: 'https://example.com/1', caseId },
        { url: 'https://example.com/2', caseId },
        { url: 'https://example.com/3', caseId }
      ])
      await vi.waitFor(() => expect(gate).toHaveLength(1))
      expect(svc.status()).toEqual({
        ...idle,
        pending: 3,
        queued: 2,
        running: 1,
        activeUrl: 'https://example.com/1'
      })

      gate.shift()!()
      await vi.waitFor(() => expect(gate).toHaveLength(1))
      expect(svc.status()).toEqual({
        ...idle,
        pending: 2,
        queued: 1,
        running: 1,
        activeUrl: 'https://example.com/2'
      })

      gate.shift()!()
      await vi.waitFor(() => expect(gate).toHaveLength(1))
      gate.shift()!()
      await svc.idle()
      expect(svc.status()).toEqual(idle)
    })
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

  // X47 (#1332): a recapture signs a `capture` entry, so it passes the operator gate like
  // every other signing path, and is refused before it contacts the site.
  describe('without an operator name (X47)', () => {
    const URL = 'https://example.com/page'
    const chainPath = (): string => join(getStorageRoot(), caseId, MANIFEST_FILENAME)

    for (const blank of ['', '   ']) {
      it(`refuses the job at enqueue and renders nothing (${JSON.stringify(blank)})`, async () => {
        updateSettings({ operatorName: blank })
        const render = vi.fn(fakeRender())
        const svc = makeService(render)

        const res = svc.enqueue([{ url: URL, caseId }])

        expect(res).toEqual({
          batchId: expect.any(String),
          accepted: 0,
          jobIds: [],
          rejected: [{ url: URL, reason: 'Operator name required' }]
        })
        await svc.idle()
        expect(render).not.toHaveBeenCalled()
        expect(newCaptures).toEqual([])
        expect(existsSync(chainPath())).toBe(false)
      })
    }

    it('fails a queued job whose name was cleared before it was stored, signing nothing', async () => {
      const svc = makeService(async (url, opts) => {
        updateSettings({ operatorName: ' ' })
        return fakeRender()(url, opts)
      })

      expect(svc.enqueue([{ url: URL, caseId }]).accepted).toBe(1)
      await svc.idle()

      expect(newCaptures).toEqual([])
      expect(listCaptures(caseId)).toEqual([])
      expect(events.find((e) => e.type === 'failed')?.error).toBe('Operator name required')
      expect(existsSync(chainPath())).toBe(false)
    })

    it('signs the trimmed name', async () => {
      updateSettings({ operatorName: '  Op  ' })
      const svc = makeService(fakeRender())

      svc.enqueue([{ url: URL, caseId }])
      await svc.idle()

      expect(newCaptures).toHaveLength(1)
      const [entry] = readFileSync(chainPath(), 'utf-8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { type: string; operatorName: string })
        .filter((line) => line.type === 'capture')
      expect(entry.operatorName).toBe('Op')
    })
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
  it('closes and unlinks a render accepted before the operator name was cleared', async () => {
    const tmpFile = join(tempDir, 'held-render.mhtml')
    writeFileSync(tmpFile, 'held render bytes')
    const mhtmlStream = createReadStream(tmpFile)
    await once(mhtmlStream, 'ready')
    let finish!: (value: RenderedPage) => void
    const render: RenderPage = () =>
      new Promise((resolve) => {
        finish = resolve
      })
    const cleanup = vi.fn(async () => {
      expect(mhtmlStream.closed).toBe(true)
      unlinkSync(tmpFile)
    })
    const svc = makeService(render)
    expect(svc.enqueue([{ url: 'https://example.com/held', caseId }]).accepted).toBe(1)
    updateSettings({ operatorName: '' })
    finish(
      await fakeRender({ mhtmlStream, cleanup })(
        'https://example.com/held',
        {} as Parameters<RenderPage>[1]
      )
    )
    await svc.idle()
    expect(events.find((event) => event.type === 'failed')).toMatchObject({
      error: 'Operator name required'
    })
    expect(newCaptures).toEqual([])
    expect(cleanup).toHaveBeenCalledOnce()
    expect(existsSync(tmpFile)).toBe(false)
    expect(mhtmlStream.destroyed).toBe(true)
    if (!mhtmlStream.closed) await once(mhtmlStream, 'close')
    expect(mhtmlStream.closed).toBe(true)
  })

  it('closes an unread stream on ingest errors and reports cleanup errors', async () => {
    const tmpFile = join(tempDir, 'failed-ingest.mhtml')
    writeFileSync(tmpFile, 'failed ingest bytes')
    const mhtmlStream = createReadStream(tmpFile)
    await once(mhtmlStream, 'ready')
    const ingestError = new Error('ingest refused before reading')
    const cleanupError = new Error('cleanup failed')
    const lifecycle = createCaptureLifecycle({ selectorLifecycle })
    vi.spyOn(lifecycle, 'ingest').mockRejectedValue(ingestError)
    const logged = vi.spyOn(logger, 'error').mockImplementation(() => 'log-id')
    const svc = createRecaptureService({
      renderPage: fakeRender({
        mhtmlStream,
        cleanup: async () => {
          throw cleanupError
        }
      }),
      captureLifecycle: lifecycle,
      emitEvent: (event) => events.push(event),
      emitNewCapture: (capture) => newCaptures.push(capture)
    })
    svc.enqueue([{ url: 'https://example.com/failed', caseId }])
    await svc.idle()
    expect(events.find((event) => event.type === 'failed')).toMatchObject({
      error: ingestError.message
    })
    expect(newCaptures).toEqual([])
    expect(mhtmlStream.destroyed).toBe(true)
    if (!mhtmlStream.closed) await once(mhtmlStream, 'close')
    expect(mhtmlStream.closed).toBe(true)
    expect(logged).toHaveBeenCalledWith(
      'backgroundRenderer',
      'backgroundRenderer.cleanup_failed',
      undefined,
      cleanupError
    )
    logged.mockRestore()
  })

  it('logs a genuine stream-open error while cleaning up an ingest refusal', async () => {
    const mhtmlStream = createReadStream(join(tempDir, 'missing-render.mhtml'))
    const lifecycle = createCaptureLifecycle({ selectorLifecycle })
    vi.spyOn(lifecycle, 'ingest').mockRejectedValue(new Error('ingest refused'))
    const logged = vi.spyOn(logger, 'error').mockImplementation(() => 'log-id')
    const cleanup = vi.fn(async () => undefined)
    const svc = createRecaptureService({
      renderPage: fakeRender({ mhtmlStream, cleanup }),
      captureLifecycle: lifecycle,
      emitEvent: (event) => events.push(event),
      emitNewCapture: vi.fn()
    })
    svc.enqueue([{ url: 'https://example.com/missing-render', caseId }])
    await svc.idle()
    expect(mhtmlStream.closed).toBe(true)
    expect(cleanup).toHaveBeenCalledOnce()
    expect(logged).toHaveBeenCalledWith(
      'backgroundRenderer',
      'backgroundRenderer.cleanup_failed',
      undefined,
      expect.objectContaining({ code: 'ENOENT' })
    )
    logged.mockRestore()
  })

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

    expect(events.filter(({ type }) => type !== 'queued' && type !== 'received')).toEqual([
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

  // Slice 1 of docs/specs/2026-11-09-batch-capture-throughput-design.md (#2127).
  describe("the job's log line", () => {
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    type Spy = { mock: { calls: unknown[][] } }
    const JOB_CODES = [
      'backgroundRenderer.job_stored',
      'backgroundRenderer.job_skipped',
      'backgroundRenderer.job_failed'
    ]
    const jobLines = (...spies: Spy[]) =>
      spies
        .flatMap((spy) => spy.mock.calls)
        .filter(([, code]) => JOB_CODES.includes(code as string))

    let info: ReturnType<typeof vi.spyOn>
    let warn: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      info = vi.spyOn(logger, 'info')
      warn = vi.spyOn(logger, 'warn')
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    // The log is handed over in bug reports, so no line of a job names its address.
    function expectNoAddress(...hosts: string[]): void {
      const logged = JSON.stringify([...info.mock.calls, ...warn.mock.calls])
      for (const host of hosts) expect(logged).not.toContain(host)
    }

    it('is one info line for a stored job, under the Capture id, with the ingest time', async () => {
      const svc = makeService(fakeRender())
      svc.enqueue([{ url: 'https://example.com/page', caseId }])
      await svc.idle()
      expect(jobLines(info, warn)).toEqual([
        [
          'backgroundRenderer',
          'backgroundRenderer.job_stored',
          {
            captureId: newCaptures[0].id,
            caseId,
            ms: expect.any(Number),
            ingestMs: expect.any(Number)
          }
        ]
      ])
      const [[, , { ms, ingestMs }]] = jobLines(info) as Array<
        [string, string, Record<string, number>]
      >
      expect(ingestMs).toBeLessThanOrEqual(ms)
      expectNoAddress('example.com')
    })

    it.each([
      {
        name: 'the render ends at a private address',
        failureKind: 'refused-address',
        render: fakeRender({ finalUrl: 'http://192.168.0.10/router' }),
        hosts: ['192.168.0.10']
      },
      {
        name: 'the render redirects into an excluded address',
        failureKind: 'excluded',
        exclusions: ['blocked.example'],
        render: fakeRender({ finalUrl: 'https://blocked.example/landing' }),
        hosts: ['blocked.example']
      },
      {
        name: 'the renderer refuses a hop',
        failureKind: 'refused-address',
        render: (async () => {
          throw new RefusedAddressError('a loopback address')
        }) as RenderPage,
        hosts: []
      }
    ])(
      'is one info line naming the kind, not the reason, when $name',
      async ({ failureKind, render, exclusions, hosts }) => {
        if (exclusions) setAutoCapturePolicy(caseId, { exclusions, mode: 'stack' })
        const svc = makeService(render)
        svc.enqueue([{ url: 'https://public.example/r', caseId }])
        await svc.idle()
        expect(events.map(({ type }) => type)).toEqual(['queued', 'received', 'skipped'])
        expect(jobLines(info, warn)).toEqual([
          [
            'backgroundRenderer',
            'backgroundRenderer.job_skipped',
            { captureId: expect.stringMatching(UUID), caseId, ms: expect.any(Number), failureKind }
          ]
        ])
        expectNoAddress('public.example', ...hosts)
      }
    )

    it('is one warn line with the error and the step the render reached, when the render throws', async () => {
      const error = new Error('net::ERR_NAME_NOT_RESOLVED')
      const svc = makeService(async (_url, { onStep }) => {
        onStep?.('setup')
        onStep?.('load')
        onStep?.('scroll')
        throw error
      })
      svc.enqueue([{ url: 'https://nope.example/', caseId }])
      await svc.idle()
      expect(jobLines(info, warn)).toEqual([
        [
          'backgroundRenderer',
          'backgroundRenderer.job_failed',
          {
            captureId: expect.stringMatching(UUID),
            caseId,
            ms: expect.any(Number),
            failureKind: 'render',
            step: 'scroll'
          },
          error
        ]
      ])
      expect(jobLines(warn)).toHaveLength(1)
      expectNoAddress('nope.example')
    })

    it('names no step when the render throws before its first', async () => {
      const svc = makeService(async () => {
        throw new Error('the Egress could not be read')
      })
      svc.enqueue([{ url: 'https://example.com/page', caseId }])
      await svc.idle()
      const [[, , context]] = jobLines(warn) as Array<[string, string, Record<string, unknown>]>
      expect(context).toMatchObject({ failureKind: 'render' })
      expect(context).not.toHaveProperty('step')
    })

    it('names a timeout, and the step the render last reached, when the render hangs', async () => {
      const svc = makeService(async (_url, { onStep }) => {
        onStep?.('setup')
        onStep?.('load')
        return new Promise<RenderedPage>(() => {})
      }, 50)
      svc.enqueue([{ url: 'https://slow.example/', caseId }])
      await svc.idle()
      const [[, , context, error]] = jobLines(warn) as Array<
        [string, string, Record<string, unknown>, unknown]
      >
      expect(context).toMatchObject({ failureKind: 'timeout', step: 'load' })
      expect(error).toBeInstanceOf(RecaptureTimeout)
      // The log keeps an error's name only when it is a known one.
      expect(sanitizeError(error).name).toBe('RecaptureTimeout')
      expect(events.at(-1)).toMatchObject({
        type: 'failed',
        error: 'Recapture timed out after 50ms'
      })
    })

    it("names a timeout when the renderer's own deadline ends the render", async () => {
      const svc = makeService(async (_url, { onStep }) => {
        onStep?.('setup')
        onStep?.('artifacts')
        throw new RecaptureTimeout(120_000)
      })
      svc.enqueue([{ url: 'https://example.com/page', caseId }])
      await svc.idle()
      const [[, , context]] = jobLines(warn) as Array<[string, string, Record<string, unknown>]>
      expect(context).toMatchObject({ failureKind: 'timeout', step: 'artifacts' })
    })

    it('names the ingest when the ingest fails, and logs no stored line', async () => {
      const failing = createCaptureLifecycle({ selectorLifecycle })
      const error = new Error('disk full')
      const svc = createRecaptureService({
        renderPage: fakeRender(),
        captureLifecycle: { ...failing, ingest: () => Promise.reject(error) },
        emitEvent: (e) => events.push(e),
        emitNewCapture: (c) => newCaptures.push(c)
      })
      svc.enqueue([{ url: 'https://example.com/page', caseId }])
      await svc.idle()
      expect(jobLines(info, warn)).toEqual([
        [
          'backgroundRenderer',
          'backgroundRenderer.job_failed',
          {
            captureId: expect.stringMatching(UUID),
            caseId,
            ms: expect.any(Number),
            failureKind: 'ingest',
            step: 'ingest'
          },
          error
        ]
      ])
    })

    // Review of #2133, finding 7: a development build's log call can throw (logSafe.ts). The
    // job's row is how it ends, so the row is written before the line is logged.
    it('ends a stored job stored, and reports no failure, when its stored line throws', async () => {
      info.mockImplementation((_source: unknown, code: unknown) => {
        if (code === 'backgroundRenderer.job_stored') throw new Error('log call threw')
        return 'log-id'
      })
      const error = vi.spyOn(logger, 'error')
      const cleanup = vi.fn(async () => {})
      const svc = makeService(fakeRender({ cleanup }))
      const { batchId } = svc.enqueue([{ url: 'https://example.com/page', caseId }])
      await svc.idle()
      expect(svc.listJobs({ batchId })).toEqual([
        expect.objectContaining({ state: 'stored', captureId: newCaptures[0].id })
      ])
      expect(svc.status()).toMatchObject({ pending: 0, running: 0 })
      expect(events.map(({ type }) => type)).toEqual(['queued', 'received', 'stored'])
      expect(jobLines(warn)).toEqual([])
      expect(cleanup).toHaveBeenCalledTimes(1)
      // The throw stops the queue loop, which logs it.
      expect(
        error.mock.calls.map(([, code, , err]) => [code, (err as Error).message])
      ).toContainEqual(['backgroundRenderer.job_queue_failed', 'log call threw'])
    })
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

// Capture link (ADR-0040): the job names the Capture whose stored page held the link and the
// link's address; the queue checks both and signs the source's Content Hash from its entry.
describe('Capture link jobs (ADR-0040)', () => {
  const LINK = 'http://example.com/linked'
  const LANDED = 'https://example.com/linked'
  let tempDir: string
  let caseId: string
  let events: CaptureEvent[]
  let newCaptures: Capture[]
  let captureLifecycle: ReturnType<typeof createCaptureLifecycle>
  let svc: ReturnType<typeof createRecaptureService>

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-link-capture-'))
    initStorage(join(tempDir, 'captures'))
    await initDatabase(':memory:')
    initSettings(tempDir)
    resetInstallationId()
    initInstallationId(tempDir)
    updateSettings({ operatorName: 'Op' })
    caseId = createCase({ name: 'Link source' }).id
    ensureCaseDir(caseId)
    events = []
    newCaptures = []
    captureLifecycle = createCaptureLifecycle({
      selectorLifecycle: { runActiveSelectorsForCapture: vi.fn() } as unknown as SelectorLifecycle
    })
    // The link redirects from http to https, the case where `url` alone loses the address.
    svc = createRecaptureService({
      renderPage: (url, opts) => fakeRender(url === LINK ? { finalUrl: LANDED } : {})(url, opts),
      captureLifecycle,
      emitEvent: (e) => events.push(e),
      emitNewCapture: (c) => newCaptures.push(c),
      timeoutMs: 45_000
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  const entries = (): Array<Record<string, unknown>> =>
    readFileSync(join(getStorageRoot(), caseId, MANIFEST_FILENAME), 'utf-8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
  const entryOf = (id: string) => entries().find((e) => e.captureId === id)!

  async function sourceCapture(url = 'https://example.com/source'): Promise<Capture> {
    svc.enqueue([{ url, caseId }])
    await svc.idle()
    return getCapture(newCaptures[newCaptures.length - 1].id)!
  }

  function linkPayload(captureId: string, urls: string[] = [LINK]) {
    return { urls, caseId, linkedFrom: { captureId, linkHref: LINK } }
  }

  // A refused job writes nothing: no Capture, no manifest line.
  async function expectNothingWritten(before: number, captures: number): Promise<void> {
    await svc.idle()
    expect(newCaptures).toHaveLength(captures)
    expect(entries()).toHaveLength(before)
  }

  it('signs the source, its Content Hash from the entry, and the link address', async () => {
    const source = await sourceCapture()
    expect(svc.enqueueLink(linkPayload(source.id))).toEqual({
      batchId: expect.any(String),
      accepted: 1,
      jobIds: [expect.any(String)],
      rejected: []
    })
    await svc.idle()

    const linked = getCapture(newCaptures[1].id)!
    expect(linked.url).toBe(LANDED)
    const provenance = {
      linkedFromCaptureId: source.id,
      linkedFromContentHash: entryOf(source.id).contentHash,
      linkHref: LINK
    }
    expect(provenance.linkedFromContentHash).toBe(source.hash)
    expect(linked).toMatchObject({ method: 'background', ...provenance })
    expect(entryOf(linked.id)).toMatchObject({ ...provenance, schemaVersion: 6 })
    expect((await verifyCapture(linked.id)).status).toBe('verified')
  })

  // The two schema-6 sets meet only on a link Capture, and the strict schema checks each.
  it('signs the capture engine fields beside the link fields, and the row mirrors both', async () => {
    const source = await sourceCapture()
    svc.enqueueLink(linkPayload(source.id))
    await svc.idle()

    const linked = newCaptures[1].id
    const entry = entryOf(linked)
    const parsed = ManifestEntrySchema.safeParse(entry)
    expect(parsed.success ? [] : parsed.error.issues).toEqual([])
    const provenance = {
      linkedFromCaptureId: source.id,
      linkedFromContentHash: source.hash,
      linkHref: LINK
    }
    const engine = {
      inventory: {
        mhtml: IMAGE_SOURCE_PINNING,
        transactionRecord: TRANSACTION_RECORD_PART,
        screenshot: { present: true, ...SCREENSHOT_RECORD },
        pdf: { present: true, afterCollection: true }
      },
      scrollToLoad: SCROLL_TO_LOAD,
      transactionRecordHash: WARC_SHA256,
      boundTls: BOUND_TLS,
      pdfHash: PDF_SHA256
    }
    expect(entry).toMatchObject({ ...provenance, ...engine, schemaVersion: 6 })
    expect(getCapture(linked)).toMatchObject({ ...provenance, ...engine })
    await expect(verifyCapture(linked)).resolves.toMatchObject({ status: 'verified' })
  })

  it('writes none of the fields on an ordinary job, or on a Recapture of a link Capture', async () => {
    const source = await sourceCapture()
    svc.enqueueLink(linkPayload(source.id))
    await svc.idle()
    const linkedId = newCaptures[1].id
    svc.enqueue([{ url: LINK, caseId, supersedesCaptureId: linkedId }])
    await svc.idle()
    const recaptureId = newCaptures[2].id

    for (const id of [source.id, recaptureId]) {
      const { linkedFromCaptureId, linkedFromContentHash, linkHref } = getCapture(id)!
      expect([linkedFromCaptureId, linkedFromContentHash, linkHref]).toEqual([
        undefined,
        undefined,
        undefined
      ])
      const entry = entryOf(id)
      const fields = ['linkedFromCaptureId', 'linkedFromContentHash', 'linkHref']
      expect(fields.filter((field) => field in entry)).toEqual([])
    }
    expect(getCapture(recaptureId)!.supersedesCaptureId).toBe(linkedId)
  })

  // `linkHref` is the address before canonicalization, so the check is exact: a spelling
  // that canonicalizes to the same address is still another string than the one signed.
  it.each([
    ['no address', []],
    ['two addresses', [LINK, 'http://example.com/other']],
    ['another address', ['http://example.com/other']],
    ['a canonical spelling of the address', ['http://example.com/linked/']]
  ])('refuses a payload whose urls hold %s', async (_label, urls) => {
    const source = await sourceCapture()
    const before = entries().length
    expect(svc.enqueueLink(linkPayload(source.id, urls))).toEqual({
      batchId: expect.any(String),
      accepted: 0,
      jobIds: [],
      rejected: [{ url: LINK, reason: 'Capture link takes exactly the link address' }]
    })
    await expectNothingWritten(before, 1)
  })

  it('refuses a payload with no source id, or one that also supersedes a Capture', async () => {
    const source = await sourceCapture()
    const before = entries().length
    expect(
      svc.enqueueLink({ urls: [LINK], caseId, linkedFrom: { captureId: '', linkHref: LINK } })
    ).toEqual({
      batchId: expect.any(String),
      accepted: 0,
      jobIds: [],
      rejected: [{ url: LINK, reason: 'Invalid link source' }]
    })
    expect(svc.enqueueLink({ urls: [LINK], caseId })).toEqual({
      batchId: expect.any(String),
      accepted: 0,
      jobIds: [],
      rejected: [{ url: '', reason: 'Invalid link source' }]
    })
    expect(svc.enqueueLink({ ...linkPayload(source.id), supersedesCaptureId: source.id })).toEqual({
      batchId: expect.any(String),
      accepted: 0,
      jobIds: [],
      rejected: [{ url: LINK, reason: 'A link capture supersedes nothing' }]
    })
    await expectNothingWritten(before, 1)
  })

  it('refuses a source in another Case, or one deleted', async () => {
    const source = await sourceCapture()
    const otherCase = createCase({ name: 'Other' }).id
    ensureCaseDir(otherCase)
    expect(svc.enqueueLink({ ...linkPayload(source.id), caseId: otherCase }).rejected).toEqual([
      { url: LINK, reason: 'Link source is in another case' }
    ])
    expect(await captureLifecycle.delete(source.id)).toBe(true)
    const before = entries().length
    expect(svc.enqueueLink(linkPayload(source.id)).rejected).toEqual([
      { url: LINK, reason: 'Link source not found' }
    ])
    await expectNothingWritten(before, 1)
  })

  // The payload checks run again when the job does, for a job that reached the queue by
  // another route or whose source went away after it was queued.
  it.each([
    ['a different address', 'other', 'Link address differs from the queued address'],
    ['a deleted source', 'deleted', 'Link source not found'],
    ['a source in another Case', 'elsewhere', 'Link source is in another case']
  ])('skips a queued job naming %s, before it renders', async (_label, kind, reason) => {
    const source = await sourceCapture()
    let job = { url: LINK, caseId, linkedFrom: { captureId: source.id, linkHref: LINK } }
    if (kind === 'other') job = { ...job, url: 'http://example.com/other' }
    if (kind === 'deleted') await captureLifecycle.delete(source.id)
    if (kind === 'elsewhere') {
      job = { ...job, caseId: createCase({ name: 'Other' }).id }
      ensureCaseDir(job.caseId)
    }
    const before = entries().length
    expect(svc.enqueue([job]).accepted).toBe(1)
    await expectNothingWritten(before, 1)
    expect(events.at(-1)).toMatchObject({ type: 'skipped', url: job.url, skipReason: reason })
  })

  // The exclusion skip names the final address, so only `linkedFrom` ties it to the job.
  it('names the job on each of its events, and on no other job', async () => {
    const source = await sourceCapture()
    expect(events.some((e) => 'linkedFrom' in e)).toBe(false)
    setAutoCapturePolicy(caseId, {
      exclusions: ['/^https:\\/\\/example\\.com\\/linked$/'],
      mode: 'stack'
    })
    const [before, written] = [events.length, entries().length]
    expect(svc.enqueueLink(linkPayload(source.id)).accepted).toBe(1)
    await expectNothingWritten(written, 1)

    const linkedFrom = { captureId: source.id, linkHref: LINK }
    expect(events.slice(before)).toMatchObject([
      { type: 'queued', url: LINK, linkedFrom },
      { type: 'received', url: LINK, linkedFrom },
      { type: 'skipped', url: LANDED, linkedFrom }
    ])
  })

  it('skips a source whose stored page no longer verifies', async () => {
    const source = await sourceCapture()
    writeFileSync(defaultCaptureStore.resolveAbsolute(source.mhtmlPath!), 'altered bytes')
    const before = entries().length
    expect(svc.enqueueLink(linkPayload(source.id)).accepted).toBe(1)
    await expectNothingWritten(before, 1)
    expect(events.at(-1)).toMatchObject({
      type: 'skipped',
      skipReason: 'Link source does not verify (tampered)'
    })
  })

  // The page still matches its entry, so only the verdict refuses it: a check that compared
  // the hash alone would sign a source whose screenshot no longer verifies.
  it('skips a source whose screenshot no longer verifies, though its page does', async () => {
    const source = await sourceCapture()
    writeFileSync(defaultCaptureStore.resolveAbsolute(source.screenshotPath!), 'altered png')
    const before = entries().length
    expect(svc.enqueueLink(linkPayload(source.id)).accepted).toBe(1)
    await expectNothingWritten(before, 1)
    expect(events.at(-1)).toMatchObject({
      type: 'skipped',
      skipReason: 'Link source does not verify (tampered)'
    })
  })

  // Maintainer ruling, 2026-10-26: the entry names the source by the id the source's own
  // entry signs, as a deletion entry does (#1815). An import into the installation that
  // already holds the row renames it, and the row keeps that new id for the viewer.
  it('names a source an archive import renamed by the id its own entry signs', async () => {
    const source = await sourceCapture()
    const archivePath = join(tempDir, 'source.bbcase')
    await exportCaseArchive(caseId, archivePath)
    const { newCaseId } = await importCaseArchive(archivePath)
    const [renamed] = listCaptures(newCaseId)
    expect(renamed.id).not.toBe(source.id)

    const payload = {
      urls: [LINK],
      caseId: newCaseId,
      linkedFrom: { captureId: renamed.id, linkHref: LINK }
    }
    expect(svc.enqueueLink(payload)).toEqual({
      batchId: expect.any(String),
      accepted: 1,
      jobIds: [expect.any(String)],
      rejected: []
    })
    await svc.idle()

    const linked = getCapture(newCaptures[1].id)!
    expect(linked.linkedFromCaptureId).toBe(renamed.id)
    const entry = readFileSync(join(getStorageRoot(), newCaseId, MANIFEST_FILENAME), 'utf-8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((e) => e.captureId === linked.id)
    expect(entry).toMatchObject({
      linkedFromCaptureId: source.id,
      linkedFromContentHash: source.hash,
      linkHref: LINK
    })
    expect((await verifyCapture(linked.id)).status).toBe('verified')
  })

  it('skips a source whose row points at another Capture’s entry', async () => {
    const source = await sourceCapture()
    const other = await sourceCapture('https://example.com/other-source')
    getDb()
      .prepare('UPDATE captures SET manifest_index = ? WHERE id = ?')
      .run(other.manifestIndex, source.id)
    const before = entries().length
    expect(svc.enqueueLink(linkPayload(source.id)).accepted).toBe(1)
    await expectNothingWritten(before, 2)
    expect(events.at(-1)).toMatchObject({
      type: 'skipped',
      skipReason: 'Link source has no verified manifest entry'
    })
  })

  it('skips a source with no manifest entry', async () => {
    const legacy = insertCapture({
      caseId,
      url: 'https://example.com/legacy',
      title: 'Legacy',
      hash: 'a'.repeat(64),
      timestamp: '2026-01-01T00:00:00.000Z'
    })
    expect(svc.enqueueLink(linkPayload(legacy.id)).accepted).toBe(1)
    await svc.idle()
    expect(newCaptures).toHaveLength(0)
    expect(events.at(-1)).toMatchObject({
      type: 'skipped',
      skipReason: 'Link source has no manifest entry'
    })
  })

  // #2127: the line names the kind, not the refusal.
  it('logs a refused source as a skipped job of kind link-source', async () => {
    const info = vi.spyOn(logger, 'info')
    const legacy = insertCapture({
      caseId,
      url: 'https://example.com/legacy',
      title: 'Legacy',
      hash: 'a'.repeat(64),
      timestamp: '2026-01-01T00:00:00.000Z'
    })
    svc.enqueueLink(linkPayload(legacy.id))
    await svc.idle()
    const skipped = info.mock.calls.filter(([, code]) => code === 'backgroundRenderer.job_skipped')
    expect(skipped).toEqual([
      [
        'backgroundRenderer',
        'backgroundRenderer.job_skipped',
        {
          captureId: expect.any(String),
          caseId,
          ms: expect.any(Number),
          failureKind: 'link-source'
        }
      ]
    ])
  })

  it('logs a link job whose source read and whose render then threw as kind render', async () => {
    const source = await sourceCapture()
    const warn = vi.spyOn(logger, 'warn')
    const linkSvc = createRecaptureService({
      renderPage: async () => {
        throw new Error('net::ERR_CONNECTION_RESET')
      },
      captureLifecycle,
      emitEvent: (e) => events.push(e),
      emitNewCapture: (c) => newCaptures.push(c),
      timeoutMs: 45_000
    })
    linkSvc.enqueueLink(linkPayload(source.id))
    await linkSvc.idle()
    const failed = warn.mock.calls.filter(([, code]) => code === 'backgroundRenderer.job_failed')
    expect(failed.map(([, , context]) => context)).toEqual([
      { captureId: expect.any(String), caseId, ms: expect.any(Number), failureKind: 'render' }
    ])
  })

  it('logs a source check that throws as a failed job of kind link-source-error', async () => {
    const source = await sourceCapture()
    const manifest = join(getStorageRoot(), caseId, MANIFEST_FILENAME)
    rmSync(manifest)
    mkdirSync(manifest)
    const warn = vi.spyOn(logger, 'warn')
    svc.enqueueLink(linkPayload(source.id))
    await svc.idle()
    expect(events.at(-1)).toMatchObject({ type: 'failed' })
    const failed = warn.mock.calls.filter(([, code]) => code === 'backgroundRenderer.job_failed')
    expect(failed).toHaveLength(1)
    expect(failed[0][2]).toEqual({
      captureId: expect.any(String),
      caseId,
      ms: expect.any(Number),
      failureKind: 'link-source-error'
    })
  })

  // The manifest writer runs no schema check, and the strict schema refuses a
  // `linkedFromContentHash` that is not lower-case SHA-256 hex. A signed capture entry's own
  // `contentHash` can be any string, so the queue refuses such a source rather than sign it.
  it('skips a source whose signed Content Hash is not lower-case SHA-256 hex', async () => {
    const contentHash = 'A'.repeat(64)
    const caseDir = join(getStorageRoot(), caseId)
    initManifest(caseDir)
    const id = 'upper-case-source'
    const { index } = appendManifestEntry(caseDir, {
      type: 'capture',
      captureId: id,
      caseId,
      url: 'https://example.com/upper',
      timestamp: '2026-01-01T00:00:00.000Z',
      contentHash,
      sizeBytes: 1,
      operatorId: 'op',
      operatorName: 'Op',
      toolVersion: '0.4.0'
    })
    insertCapture({
      id,
      caseId,
      url: 'https://example.com/upper',
      title: 'Upper',
      hash: contentHash,
      timestamp: '2026-01-01T00:00:00.000Z',
      format: 'mhtml',
      manifestIndex: index
    })
    const before = entries().length
    expect(svc.enqueueLink(linkPayload(id)).accepted).toBe(1)
    await expectNothingWritten(before, 0)
    expect(events.at(-1)).toMatchObject({
      type: 'skipped',
      skipReason: 'Link source Content Hash is not lower-case SHA-256 hex'
    })
  })
})

// A Shared Case member can link from a teammate's received Capture: its signed entry is on
// the author's chain, not the receiver's, and the writer reads it from there (ADR-0040).
describe("Capture link from a teammate's Capture (ADR-0040)", () => {
  const CASE_ID = '0196f7a2-aaaa-bbbb-cccc-000000001995'
  const LINK = 'http://example.com/alice/linked'
  let root: string
  let A: Peer
  let B: Peer

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'birdbrain-link-teammate-'))
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

  it("signs the author's entry for the source, and the Capture verifies", async () => {
    const source = await addCapture(CASE_ID, A, 1)
    const recorded = recordSource(CASE_ID, A)
    await activate(B)
    const result = await pull(CASE_ID, recorded)
    expect(result.errors).toEqual([])
    expect(getExhibit(source.captureId)?.authorInstallationId).toBe(A.installationId)

    const newCaptures: Capture[] = []
    const events: CaptureEvent[] = []
    const svc = createRecaptureService({
      renderPage: fakeRender(),
      captureLifecycle: createCaptureLifecycle({
        selectorLifecycle: { runActiveSelectorsForCapture: vi.fn() } as unknown as SelectorLifecycle
      }),
      emitEvent: (e) => events.push(e),
      emitNewCapture: (c) => newCaptures.push(c),
      timeoutMs: 45_000
    })
    const linkedFrom = { captureId: source.captureId, linkHref: LINK }
    expect(svc.enqueueLink({ urls: [LINK], caseId: CASE_ID, linkedFrom })).toEqual({
      batchId: expect.any(String),
      accepted: 1,
      jobIds: [expect.any(String)],
      rejected: []
    })
    await svc.idle()

    expect(events.filter(({ type }) => type === 'skipped')).toEqual([])
    expect(newCaptures).toHaveLength(1)
    const provenance = {
      linkedFromCaptureId: source.captureId,
      linkedFromContentHash: source.contentHash,
      linkHref: LINK
    }
    const linked = getCapture(newCaptures[0].id)!
    expect(linked).toMatchObject(provenance)
    const entry = readFileSync(join(getStorageRoot(), CASE_ID, MANIFEST_FILENAME), 'utf-8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((e) => e.captureId === linked.id)
    expect(entry).toMatchObject({ ...provenance, schemaVersion: 6 })
    expect((await verifyCapture(linked.id)).status).toBe('verified')
  })
})
