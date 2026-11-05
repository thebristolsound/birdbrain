import { describe, expect, it } from 'vitest'
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
