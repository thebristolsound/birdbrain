import { describe, expect, it } from 'vitest'
import { createHash } from 'crypto'
import sharp from 'sharp'
import type { CdpSession } from '@main/services/launchedBrowser/cdpClient'
import {
  CaptureAbandoned,
  captureTab,
  TabNotInFront,
  type TabCaptureInput
} from '@main/services/launchedBrowser/captureTab'
import {
  createTabRecording,
  TAB_RECORDING_BUDGET
} from '@main/services/launchedBrowser/tabRecording'
import { readWarc } from '../../../../src/packages/transaction-record/warcReader'
import { writeTransactionRecord } from '../../../../src/packages/transaction-record/writer'
import { recordTexts } from '../../../helpers/transactionRecordText'

// The Capture sequence over a fake page session (#1832; spec, "The Capture sequence"). The live
// suite runs it against real browsers; this pins its order and its failure paths without one.

const TAB = 'TAB-1'
const TIMINGS = { networkIdleMs: 1, networkIdleMaxMs: 50, scrollMaxMs: 2_000, artifactMs: 500 }

type Reply = (params: Record<string, unknown>) => unknown

interface FakePage extends CdpSession {
  emit: (method: string, params: unknown) => void
  sent: string[]
  params: Array<{ method: string; params: Record<string, unknown> }>
  replies: Map<string, Reply>
}

const PNG = await sharp({
  create: { width: 20, height: 10, channels: 3, background: { r: 255, g: 0, b: 0 } }
})
  .png()
  .toBuffer()

function fakePage(): FakePage {
  const handlers = new Map<string, Set<(params: unknown) => void>>()
  const sent: string[] = []
  const params: FakePage['params'] = []
  const replies = new Map<string, Reply>([
    ['Page.createIsolatedWorld', () => ({ executionContextId: 7 })],
    [
      'Runtime.evaluate',
      ({ expression }) => {
        const text = String(expression)
        if (text === 'document.visibilityState') return { result: { value: 'visible' } }
        if (text.includes('innerText')) {
          return { result: { value: { text: 'Page text', title: 'Page title' } } }
        }
        // The scroll step finds nothing to scroll; the reset returns nothing.
        return { result: { value: null } }
      }
    ],
    ['Page.getLayoutMetrics', () => ({ cssContentSize: { x: 0, y: 0, width: 20, height: 10 } })],
    ['Page.captureScreenshot', () => ({ data: PNG.toString('base64') })],
    ['Page.captureSnapshot', () => ({ data: 'MIME-Version: 1.0\r\n\r\npage' })],
    ['Page.printToPDF', () => ({ data: Buffer.from('%PDF-1.4 page').toString('base64') })],
    [
      'Network.getResponseBody',
      () => ({ body: Buffer.from('<p>body</p>').toString('base64'), base64Encoded: true })
    ]
  ])
  const page = {
    sessionId: 'page-session',
    sent,
    params,
    replies,
    send: async (method: string, commandParams: Record<string, unknown>) => {
      sent.push(method)
      params.push({ method, params: commandParams })
      const reply = replies.get(method)
      if (!reply) throw new Error(`${method} has no reply`)
      return reply(commandParams)
    },
    on: (event: string, handler: (params: unknown) => void) => {
      const set = handlers.get(event) ?? new Set()
      handlers.set(event, set)
      set.add(handler)
      return () => set.delete(handler)
    },
    emit: (method: string, params: unknown) => {
      for (const handler of handlers.get(method) ?? []) handler(params)
    }
  }
  return page as unknown as FakePage
}

function loadDocument(page: FakePage, url = 'http://a.test/'): void {
  page.emit('Network.requestWillBeSent', {
    requestId: 'D1',
    loaderId: 'D1',
    frameId: TAB,
    type: 'Document',
    wallTime: 1_700_000_000,
    request: { url, method: 'GET', headers: { Cookie: 'sid=SECRET' } }
  })
  page.emit('Network.responseReceived', {
    requestId: 'D1',
    response: { url, status: 200, statusText: 'OK', headers: {}, mimeType: 'text/html' }
  })
  page.emit('Network.loadingFinished', { requestId: 'D1' })
  page.emit('Page.frameNavigated', { frame: { id: TAB, loaderId: 'D1', url } })
}

function setUp() {
  const page = fakePage()
  const recording = createTabRecording({ tabId: TAB })
  recording.addSession(page, 'page', Promise.resolve())
  const input = (overrides: Partial<TabCaptureInput> = {}): TabCaptureInput => ({
    session: page,
    recording,
    tabId: TAB,
    scrollToLoad: false,
    captureId: 'capture-1',
    recordingBudget: TAB_RECORDING_BUDGET,
    timings: TIMINGS,
    writer: {
      birdbrainVersion: 'test',
      browserVersion: 'Chrome/154.0.8037.97',
      userAgent: 'Mozilla/5.0',
      egress: 'direct',
      warcinfo: { transport: 'pipe' }
    },
    ...overrides
  })
  return { page, recording, input }
}

describe('captureTab', () => {
  it.each(['failed', 'unanswered'])(
    'omits the record and Bound TLS when page setup is %s',
    async (state) => {
      const { page, input } = setUp()
      const recording = createTabRecording({ tabId: TAB })
      const setup =
        state === 'failed'
          ? Promise.reject(new Error('Network.setCacheDisabled failed'))
          : new Promise<never>(() => {})
      recording.addSession(page, 'page', setup)
      loadDocument(page)
      const artifacts = await captureTab(input({ recording }))
      expect(artifacts.inventory.transactionRecord).toEqual({
        present: false,
        reason: 'page-not-recorded'
      })
      expect(artifacts.transactionRecord).toBeUndefined()
      expect(artifacts.boundTls).toBeUndefined()
      expect(artifacts.boundTlsAbsent).toBe('not-recorded')
    }
  )

  it('takes the artifacts in order and writes the record from the cut', async () => {
    const { page, input } = setUp()
    loadDocument(page)
    const artifacts = await captureTab(input({ scrollToLoad: true }))
    const artifactCommands = page.sent.filter((method) => method.startsWith('Page.'))
    expect(artifactCommands).toEqual([
      'Page.createIsolatedWorld',
      'Page.getLayoutMetrics',
      'Page.captureScreenshot',
      'Page.captureSnapshot',
      'Page.printToPDF'
    ])
    expect(artifacts).toMatchObject({
      url: 'http://a.test/',
      title: 'Page title',
      text: 'Page text',
      httpStatus: 200,
      boundTlsAbsent: 'not-https',
      scrollToLoad: { requested: true, ran: true, outcome: 'nothing-to-scroll' },
      errors: []
    })
    expect(artifacts.mhtml.toString('utf8')).toContain('MIME-Version')
    expect(artifacts.pdf?.toString('latin1')).toBe('%PDF-1.4 page')
    expect(artifacts.inventory).toMatchObject({
      mhtml: { present: true, pinnedImages: 0, pinnedImagesNotLoaded: 0 },
      transactionRecord: {
        present: true,
        exchanges: 1,
        httpCacheDisabled: true,
        requestBodiesWithheld: 0,
        servedByServiceWorker: 0,
        replacedHeaders: ['cookie']
      },
      screenshot: { present: true, width: 20, height: 10 },
      pdf: { present: true, afterCollection: true }
    })
    const records = readWarc(artifacts.transactionRecord!)
    expect(records[0].block.toString('utf8')).toMatch(/^transport: pipe/m)
    expect(records.map((record) => record.warc('WARC-Type'))).toEqual([
      'warcinfo',
      'request',
      'response'
    ])
  })

  it('signs the address a same-document navigation moved the page to', async () => {
    const { page, input } = setUp()
    loadDocument(page, 'http://a.test/home')
    page.emit('Page.navigatedWithinDocument', { frameId: TAB, url: 'http://a.test/private/x' })
    const artifacts = await captureTab(input())
    expect(artifacts.url).toBe('http://a.test/private/x')
    expect(artifacts.committedUrl).toBe('http://a.test/home')
    // Bound TLS still reads the document that loaded, which matched its request.
    expect(artifacts.boundTlsAbsent).toBe('not-https')
  })

  it("runs every page read in the isolated world, never the page's own", async () => {
    const { page, input } = setUp()
    loadDocument(page)
    await captureTab(input({ scrollToLoad: true }))
    const reads = page.params.filter(({ method }) => method === 'Runtime.evaluate')
    // The visibility check, the scroll steps and reset, and the text and title read.
    expect(reads.length).toBeGreaterThan(2)
    for (const { params } of reads) expect(params.contextId).toBe(7)
    expect(page.params.find(({ method }) => method === 'Page.createIsolatedWorld')?.params).toEqual(
      { frameId: TAB, worldName: 'birdbrain-capture' }
    )
  })

  it('carries no record for a page its recording lacks the document request of', async () => {
    const { page, input } = setUp()
    page.emit('Page.frameNavigated', {
      frame: { id: TAB, loaderId: 'UNSEEN', url: 'http://a.test/' }
    })
    const artifacts = await captureTab(input())
    expect(artifacts.inventory.transactionRecord).toEqual({
      present: false,
      reason: 'page-not-recorded'
    })
    expect(artifacts.transactionRecord).toBeUndefined()
    expect(artifacts.boundTlsAbsent).toBe('not-recorded')
    expect(artifacts.httpStatus).toBe(0)
  })

  it('records the Transaction Record failed when the writer fails, and stores the rest', async () => {
    const { page, input } = setUp()
    loadDocument(page)
    const broken = new Error('writer broke')
    const artifacts = await captureTab(
      input({
        write: async () => {
          throw broken
        }
      })
    )
    expect(artifacts.inventory.transactionRecord).toEqual({ present: false, reason: 'failed' })
    expect(artifacts.boundTlsAbsent).toBe('not-recorded')
    expect(artifacts.errors).toEqual([broken])
    expect(artifacts.pdf).toBeDefined()
  })

  it('records the PDF failed when the print fails', async () => {
    const { page, input } = setUp()
    loadDocument(page)
    page.replies.set('Page.printToPDF', () => {
      throw new Error('Printing failed')
    })
    const artifacts = await captureTab(input())
    expect(artifacts.inventory.pdf).toEqual({ present: false, reason: 'failed' })
    expect(artifacts.pdf).toBeUndefined()
    expect(String(artifacts.errors[0])).toMatch(/Printing failed/)
  })

  it('does not print a page taller than the PDF limit', async () => {
    const { page, input } = setUp()
    loadDocument(page)
    page.replies.set('Page.getLayoutMetrics', () => ({
      cssContentSize: { x: 0, y: 0, width: 20, height: 60_000 }
    }))
    const artifacts = await captureTab(input())
    expect(artifacts.inventory.pdf).toEqual({ present: false, reason: 'failed' })
    expect(page.sent).not.toContain('Page.printToPDF')
  })

  it('refuses a tab behind another before it takes anything', async () => {
    const { page, input } = setUp()
    loadDocument(page)
    page.replies.set('Runtime.evaluate', () => ({ result: { value: 'hidden' } }))
    await expect(captureTab(input())).rejects.toBeInstanceOf(TabNotInFront)
    expect(page.sent).not.toContain('Page.captureScreenshot')
  })

  it('abandons the Capture when a new document commits while an artifact command waits', async () => {
    const { page, input } = setUp()
    loadDocument(page)
    page.replies.set('Page.captureSnapshot', () => {
      // The page leaves during the snapshot, which then never answers.
      page.emit('Page.frameNavigated', {
        frame: { id: TAB, loaderId: 'D2', url: 'http://a.test/b' }
      })
      return new Promise(() => {})
    })
    await expect(captureTab(input())).rejects.toBeInstanceOf(CaptureAbandoned)
    expect(page.sent).not.toContain('Page.printToPDF')
  })

  it('fails when a script in the isolated world throws', async () => {
    const { page, input } = setUp()
    loadDocument(page)
    page.replies.set('Runtime.evaluate', () => ({
      result: { type: 'undefined' },
      exceptionDetails: { exceptionId: 1, text: 'Uncaught', lineNumber: 0, columnNumber: 0 }
    }))
    await expect(captureTab(input())).rejects.toThrow(/isolated world failed: Uncaught/)
  })
})

// Known answers for what a clicked Capture signs and writes once the cut is taken: the Transaction
// Record, Bound TLS Details, the PDF and the inventory. The inventory, the details, the status,
// the PDF and a digest of the written record are literals, and the record's date is checked
// against the cut, so a change to how the finish is put together that alters any of them fails
// here.
describe('captureTab, known answers for the record, the PDF and the inventory', () => {
  const TLS = {
    protocol: 'TLS 1.3',
    keyExchange: '',
    keyExchangeGroup: 'X25519',
    cipher: 'AES_128_GCM',
    certificateId: 7,
    subjectName: 'a.test',
    sanList: ['a.test'],
    issuer: 'Birdbrain Test CA',
    validFrom: 1767225600,
    validTo: 1798761600,
    signedCertificateTimestampList: [],
    certificateTransparencyCompliance: 'unknown',
    encryptedClientHello: false
  }

  // A page over https with a credential header, a form post a service worker answered, and an
  // image that failed.
  function loadSignedInPage(page: FakePage, securityDetails: unknown = TLS): void {
    page.emit('Network.requestWillBeSent', {
      requestId: 'D1',
      loaderId: 'D1',
      frameId: TAB,
      type: 'Document',
      wallTime: 1_700_000_000,
      request: { url: 'https://a.test/', method: 'GET', headers: { Cookie: 'sid=SECRET' } }
    })
    page.emit('Network.responseReceived', {
      requestId: 'D1',
      response: {
        url: 'https://a.test/',
        status: 203,
        statusText: 'Non-Authoritative Information',
        headers: { 'content-type': 'text/html' },
        mimeType: 'text/html',
        protocol: 'h2',
        securityDetails
      }
    })
    page.emit('Network.dataReceived', { requestId: 'D1', dataLength: 11 })
    page.emit('Network.loadingFinished', { requestId: 'D1' })
    page.emit('Page.frameNavigated', { frame: { id: TAB, loaderId: 'D1', url: 'https://a.test/' } })
    page.emit('Network.requestWillBeSent', {
      requestId: 'P1',
      loaderId: 'D1',
      frameId: TAB,
      type: 'Fetch',
      wallTime: 1_700_000_001,
      request: {
        url: 'https://a.test/search',
        method: 'POST',
        headers: { Authorization: 'Bearer SECRET', 'Content-Type': 'text/plain' },
        hasPostData: true,
        postData: 'q=secret'
      }
    })
    page.emit('Network.responseReceived', {
      requestId: 'P1',
      response: {
        url: 'https://a.test/search',
        status: 200,
        statusText: 'OK',
        headers: {},
        mimeType: 'application/json',
        fromServiceWorker: true
      }
    })
    page.emit('Network.loadingFinished', { requestId: 'P1' })
    page.emit('Network.requestWillBeSent', {
      requestId: 'F1',
      loaderId: 'D1',
      frameId: TAB,
      type: 'Image',
      wallTime: 1_700_000_002,
      request: { url: 'https://a.test/missing.png', method: 'GET', headers: {} }
    })
    page.emit('Network.loadingFailed', {
      requestId: 'F1',
      errorText: 'net::ERR_FAILED',
      canceled: false
    })
  }

  const SCREENSHOT_PART = {
    present: true,
    scaled: false,
    truncated: false,
    trimmed: false,
    contentWidth: 20,
    contentHeight: 10,
    width: 20,
    height: 10
  }
  const MHTML_PART = { present: true, pinnedImages: 0, pinnedImagesNotLoaded: 0 }
  const RECORD_PART = {
    present: true,
    exchanges: 2,
    cached: 0,
    cancelled: 0,
    failed: 1,
    inFlight: 0,
    finishedWithoutResponse: 0,
    bodiesOmitted: 0,
    incompleteRequestBodies: 0,
    webSockets: 0,
    recordedTargets: 1,
    unrecordedTargets: 0,
    replacedHeaders: ['authorization', 'cookie'],
    budget: { totalBytes: 50_000_000, resourceBytes: 10_000_000 },
    servedByServiceWorker: 1,
    requestBodiesWithheld: 1,
    httpCacheDisabled: true
  }
  const PDF_PART = { present: true, afterCollection: true }
  const PDF_FAILED = { present: false, reason: 'failed' }

  it('signs every part, Bound TLS Details and the status of a page loaded over https', async () => {
    const { page, input } = setUp()
    loadSignedInPage(page)
    const artifacts = await captureTab(input())
    expect(Object.keys(artifacts)).toEqual([
      'capturedAt',
      'url',
      'committedUrl',
      'title',
      'httpStatus',
      'mhtml',
      'screenshot',
      'text',
      'inventory',
      'transactionRecord',
      'boundTls',
      'pdf',
      'errors'
    ])
    expect(artifacts.inventory).toEqual({
      mhtml: MHTML_PART,
      transactionRecord: RECORD_PART,
      screenshot: SCREENSHOT_PART,
      pdf: PDF_PART
    })
    expect(Object.keys(artifacts.inventory)).toEqual([
      'mhtml',
      'transactionRecord',
      'screenshot',
      'pdf'
    ])
    expect(Object.keys(artifacts.inventory.transactionRecord)).toEqual(Object.keys(RECORD_PART))
    expect(artifacts.boundTls).toEqual({
      protocol: 'TLS 1.3',
      keyExchange: '',
      keyExchangeGroup: 'X25519',
      cipher: 'AES_128_GCM',
      subjectName: 'a.test',
      sanList: ['a.test'],
      issuer: 'Birdbrain Test CA',
      validFrom: '2026-01-01T00:00:00.000Z',
      validTo: '2027-01-01T00:00:00.000Z',
      signedCertificateTimestampList: [],
      certificateTransparencyCompliance: 'unknown',
      encryptedClientHello: false
    })
    expect(artifacts.httpStatus).toBe(203)
    expect(artifacts.pdf?.toString('latin1')).toBe('%PDF-1.4 page')
    expect(artifacts.errors).toEqual([])
  })

  it('keeps the order of its fields when Scroll-to-load ran', async () => {
    const { page, input } = setUp()
    loadSignedInPage(page)
    const artifacts = await captureTab(input({ scrollToLoad: true }))
    expect(Object.keys(artifacts)).toEqual([
      'capturedAt',
      'url',
      'committedUrl',
      'title',
      'httpStatus',
      'mhtml',
      'screenshot',
      'text',
      'inventory',
      'scrollToLoad',
      'transactionRecord',
      'boundTls',
      'pdf',
      'errors'
    ])
    expect(artifacts.scrollToLoad).toEqual({
      requested: true,
      ran: true,
      outcome: 'nothing-to-scroll',
      scrollLockLifted: false
    })
  })

  it('writes the same Transaction Record for the same recording', async () => {
    const { page, input } = setUp()
    loadSignedInPage(page)
    const inputs: unknown[] = []
    const artifacts = await captureTab(
      input({
        write: async (writerInput) => {
          inputs.push(writerInput)
          return writeTransactionRecord(writerInput)
        }
      })
    )
    const [handed] = inputs as Array<Record<string, unknown>>
    expect(Object.keys(handed).sort()).toEqual([
      'birdbrainVersion',
      'browserVersion',
      'captureId',
      'date',
      'egress',
      'exchanges',
      'userAgent',
      'warcinfo'
    ])
    expect(handed).toMatchObject({
      birdbrainVersion: 'test',
      browserVersion: 'Chrome/154.0.8037.97',
      userAgent: 'Mozilla/5.0',
      egress: 'direct',
      warcinfo: { transport: 'pipe' },
      captureId: 'capture-1',
      date: artifacts.capturedAt
    })
    const records = readWarc(artifacts.transactionRecord!)
    expect(
      records.map((record) => `${record.warc('WARC-Type')} ${record.http?.statusLine}`)
    ).toEqual([
      'warcinfo undefined',
      'request GET / HTTP/1.1',
      'response HTTP/1.1 203 Non-Authoritative Information',
      'request POST /search HTTP/1.1',
      'response HTTP/1.1 200 OK',
      'request GET /missing.png HTTP/1.1'
    ])
    // Every byte the writer wrote, apart from each record's random id and the `warcinfo` date.
    const texts = recordTexts(artifacts.transactionRecord!)
    expect(createHash('sha256').update(texts.join('')).digest('hex'), texts.join('')).toBe(
      'efd811e8c2ccd5790481e43beb2e9c67da6dad40acc2cbececf3af07edcd279b'
    )
  })

  it.each([
    ['page-not-recorded', undefined],
    ['back-forward-cache', 'BackForwardCacheRestore']
  ])('carries no record, as %s, for a page no recorded request loaded', async (reason, type) => {
    const { page, input } = setUp()
    page.emit('Page.frameNavigated', {
      frame: { id: TAB, loaderId: 'UNSEEN', url: 'https://a.test/' },
      ...(type ? { type } : {})
    })
    const artifacts = await captureTab(input())
    expect(Object.keys(artifacts)).toEqual([
      'capturedAt',
      'url',
      'committedUrl',
      'title',
      'httpStatus',
      'mhtml',
      'screenshot',
      'text',
      'inventory',
      'boundTlsAbsent',
      'pdf',
      'errors'
    ])
    expect(artifacts.inventory).toEqual({
      mhtml: MHTML_PART,
      transactionRecord: { present: false, reason },
      screenshot: SCREENSHOT_PART,
      pdf: PDF_PART
    })
    expect(artifacts.boundTlsAbsent).toBe('not-recorded')
    expect(artifacts.httpStatus).toBe(0)
    expect(artifacts.errors).toEqual([])
  })

  it.each([
    [
      'the writer throws',
      {
        write: async () => {
          throw new Error('writer broke')
        }
      },
      TLS,
      'Error: writer broke'
    ],
    [
      'the writer outlasts its bound',
      { write: () => new Promise<never>(() => {}), timings: { ...TIMINGS, writeMs: 20 } },
      TLS,
      'Error: The Transaction Record writer did not answer within 20 ms'
    ],
    [
      'the main document reports details the schema refuses',
      {},
      // Year 33658: `toISOString` writes a six-digit year, which ISO 8601 parsing refuses.
      { ...TLS, validTo: 1e12 },
      /"validTo"[\s\S]*Invalid ISO datetime/
    ]
  ] as const)(
    'records the Transaction Record failed, and stores the rest, when %s',
    async (_name, overrides, securityDetails, error) => {
      const { page, input } = setUp()
      loadSignedInPage(page, securityDetails)
      const artifacts = await captureTab(input(overrides as Partial<TabCaptureInput>))
      expect(Object.keys(artifacts)).toEqual([
        'capturedAt',
        'url',
        'committedUrl',
        'title',
        'httpStatus',
        'mhtml',
        'screenshot',
        'text',
        'inventory',
        'boundTlsAbsent',
        'pdf',
        'errors'
      ])
      expect(artifacts.inventory).toEqual({
        mhtml: MHTML_PART,
        transactionRecord: { present: false, reason: 'failed' },
        screenshot: SCREENSHOT_PART,
        pdf: PDF_PART
      })
      expect(artifacts.boundTlsAbsent).toBe('not-recorded')
      expect(artifacts.httpStatus).toBe(0)
      expect(artifacts.errors).toHaveLength(1)
      expect(String(artifacts.errors[0])).toMatch(error)
    }
  )

  it('records the Transaction Record failed when a body fetch outlasts the collection bound', async () => {
    const { page, input } = setUp()
    page.replies.set('Network.getResponseBody', () => new Promise(() => {}))
    loadSignedInPage(page)
    const artifacts = await captureTab(input({ timings: { ...TIMINGS, collectMs: 20 } }))
    expect(artifacts.inventory).toEqual({
      mhtml: MHTML_PART,
      transactionRecord: { present: false, reason: 'failed' },
      screenshot: SCREENSHOT_PART,
      pdf: PDF_PART
    })
    expect(artifacts.boundTlsAbsent).toBe('not-recorded')
    expect(artifacts.httpStatus).toBe(0)
    expect(artifacts.errors.map(String)).toEqual([
      'Error: The body fetches did not settle within 20ms'
    ])
  })

  it.each([
    [
      'the print throws',
      (page: FakePage) =>
        page.replies.set('Page.printToPDF', () => {
          throw new Error('Printing failed')
        }),
      'Error: Printing failed',
      true
    ],
    [
      'the print outlasts its bound',
      (page: FakePage) => page.replies.set('Page.printToPDF', () => new Promise(() => {})),
      'Error: Page.printToPDF did not answer within 20 ms',
      true
    ],
    [
      'the page is taller than the layout bound',
      (page: FakePage) =>
        page.replies.set('Page.getLayoutMetrics', () => ({
          cssContentSize: { x: 0, y: 0, width: 20, height: 50_001 }
        })),
      'Error: The page is 50001 CSS pixels tall, over MAX_PDF_CONTENT_HEIGHT_PX (50000), so it ' +
        'was not printed',
      false
    ],
    [
      'the PDF is over the size limit',
      (page: FakePage) =>
        page.replies.set('Page.printToPDF', () => ({
          data: Buffer.alloc(100 * 1024 * 1024 + 1).toString('base64')
        })),
      'Error: The PDF is 104857601 bytes, over MAX_PDF_SIZE (104857600), so it was discarded',
      true
    ]
  ] as const)(
    'records the PDF failed, and keeps the record, when %s',
    async (_name, arrange, error, prints) => {
      const { page, input } = setUp()
      loadSignedInPage(page)
      arrange(page)
      const artifacts = await captureTab(input({ timings: { ...TIMINGS, printMs: 20 } }))
      expect(Object.keys(artifacts)).toEqual([
        'capturedAt',
        'url',
        'committedUrl',
        'title',
        'httpStatus',
        'mhtml',
        'screenshot',
        'text',
        'inventory',
        'transactionRecord',
        'boundTls',
        'errors'
      ])
      expect(artifacts.inventory.pdf).toEqual(PDF_FAILED)
      expect(artifacts.inventory.transactionRecord).toEqual(RECORD_PART)
      expect(page.sent.includes('Page.printToPDF')).toBe(prints)
      expect(artifacts.errors.map(String)).toEqual([error])
    }
  )

  it('lists the record failure before the print failure when both fail', async () => {
    const { page, input } = setUp()
    loadSignedInPage(page)
    page.replies.set('Page.printToPDF', () => {
      throw new Error('Printing failed')
    })
    const artifacts = await captureTab(
      input({
        write: async () => {
          throw new Error('writer broke')
        }
      })
    )
    expect(artifacts.errors.map(String)).toEqual(['Error: writer broke', 'Error: Printing failed'])
    expect(artifacts.inventory).toEqual({
      mhtml: MHTML_PART,
      transactionRecord: { present: false, reason: 'failed' },
      screenshot: SCREENSHOT_PART,
      pdf: PDF_FAILED
    })
  })

  it.each([
    ['fails', () => Promise.reject(new Error('Printing failed'))],
    ['never answers', () => new Promise(() => {})]
  ])(
    'abandons the Capture, and records no failed PDF, when the page changes and the print %s',
    async (_name, answer) => {
      const { page, input } = setUp()
      loadSignedInPage(page)
      page.replies.set('Page.printToPDF', () => {
        page.emit('Page.frameNavigated', {
          frame: { id: TAB, loaderId: 'D2', url: 'https://a.test/b' }
        })
        return answer()
      })
      await expect(captureTab(input())).rejects.toBeInstanceOf(CaptureAbandoned)
    }
  )
})
