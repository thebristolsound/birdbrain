import { describe, expect, it } from 'vitest'
import type { CdpSession } from '@main/services/launchedBrowser/cdpClient'
import { createTabRecording } from '@main/services/launchedBrowser/tabRecording'

// One tab's recording (spec, "From a session-long recording to one Transaction Record per
// Capture"), fed synthetic events on fake sessions.

const TAB = 'TAB-1'

interface FakeSession extends CdpSession {
  emit: (method: string, params: unknown) => void
  sent: string[]
}

function fakeSession(sessionId: string): FakeSession {
  const handlers = new Map<string, Set<(params: unknown) => void>>()
  const sent: string[] = []
  const session = {
    sessionId,
    sent,
    send: (method: string, params: { requestId?: string }) => {
      sent.push(`${method}:${params.requestId ?? ''}`)
      return Promise.resolve({
        body: Buffer.from(`body-${params.requestId}`).toString('base64'),
        base64Encoded: true
      })
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
  return session as unknown as FakeSession
}

const settle = () => new Promise((resolve) => setImmediate(resolve))

let wall = 1_700_000_000

function sent(
  session: FakeSession,
  requestId: string,
  url: string,
  {
    type = 'Other',
    loaderId = 'L0',
    body
  }: { type?: string; loaderId?: string; body?: string } = {}
): void {
  session.emit('Network.requestWillBeSent', {
    requestId,
    loaderId,
    frameId: TAB,
    type,
    wallTime: (wall += 1),
    request: {
      url,
      method: body === undefined ? 'GET' : 'POST',
      headers: { Cookie: 'sid=SECRET' },
      ...(body === undefined ? {} : { hasPostData: true, postData: body })
    }
  })
}

function finished(session: FakeSession, requestId: string, url: string): void {
  session.emit('Network.responseReceived', {
    requestId,
    response: { url, status: 200, statusText: 'OK', headers: {}, mimeType: 'text/html' }
  })
  session.emit('Network.loadingFinished', { requestId })
}

function committed(session: FakeSession, loaderId: string, url: string, type = 'Navigation') {
  session.emit('Page.frameNavigated', { frame: { id: TAB, loaderId, url }, type })
}

function document(session: FakeSession, requestId: string, url: string, body?: string) {
  sent(session, requestId, url, { type: 'Document', loaderId: requestId, body })
  finished(session, requestId, url)
  committed(session, requestId, url)
}

function setUp() {
  const recording = createTabRecording({ tabId: TAB })
  const page = fakeSession('page-session')
  recording.addSession(page, 'page', Promise.resolve())
  return { recording, page }
}

const urls = async (recording: ReturnType<typeof setUp>['recording']): Promise<string[]> => {
  const { exchanges } = await recording.cut().collect(1_000)
  return exchanges.map(({ request }) => request.url)
}

describe('tab recording', () => {
  it('opens at a main-frame document request and flags the page recorded from it', async () => {
    const { recording, page } = setUp()
    expect(recording.fromFirstRequest()).toBe(false)
    expect(recording.committedUrl()).toBeUndefined()
    document(page, 'D1', 'https://a.test/')
    sent(page, 'R1', 'https://a.test/img.png')
    finished(page, 'R1', 'https://a.test/img.png')
    await settle()
    expect(recording.fromFirstRequest()).toBe(true)
    expect(recording.committedUrl()).toBe('https://a.test/')
    expect(await urls(recording)).toEqual(['https://a.test/', 'https://a.test/img.png'])
  })

  it('rolls over at a main-frame commit and keeps none of the previous page', async () => {
    const { recording, page } = setUp()
    document(page, 'D1', 'https://a.test/')
    sent(page, 'R1', 'https://a.test/old.js')
    // Still loading when the next document request starts: it stays with the old page.
    sent(page, 'D2', 'https://b.test/', { type: 'Document', loaderId: 'D2' })
    finished(page, 'D2', 'https://b.test/')
    finished(page, 'R1', 'https://a.test/old.js')
    committed(page, 'D2', 'https://b.test/')
    await settle()
    expect(recording.navigationId()).toBe(2)
    expect(await urls(recording)).toEqual(['https://b.test/'])
  })

  it('does not roll over for a same-document navigation or a navigation that never commits', async () => {
    const { recording, page } = setUp()
    document(page, 'D1', 'https://a.test/')
    page.emit('Page.navigatedWithinDocument', { frameId: TAB, url: 'https://a.test/#two' })
    // A 204 or a download: a document request that never commits.
    sent(page, 'D2', 'https://a.test/download', { type: 'Document', loaderId: 'D2' })
    finished(page, 'D2', 'https://a.test/download')
    await settle()
    expect(recording.navigationId()).toBe(1)
    expect(await urls(recording)).toEqual(['https://a.test/', 'https://a.test/download'])
  })

  it('commits a page with no recorded document request as not recorded', async () => {
    const { recording, page } = setUp()
    // A tab opened by Ctrl-click: its document request reached no session (probe P4).
    committed(page, 'UNSEEN', 'https://a.test/')
    expect(recording.fromFirstRequest()).toBe(false)
    expect(recording.cut()).toMatchObject({
      committedUrl: 'https://a.test/',
      fromFirstRequest: false,
      unrecorded: 'page-not-recorded'
    })
  })

  it('says a back-forward cache restore loaded nothing', () => {
    const { recording, page } = setUp()
    document(page, 'D1', 'https://a.test/')
    committed(page, 'D0', 'https://a.test/prev', 'BackForwardCacheRestore')
    expect(recording.cut()).toMatchObject({
      fromFirstRequest: false,
      unrecorded: 'back-forward-cache'
    })
  })

  it('collects only the exchanges that began before the cut', async () => {
    const { recording, page } = setUp()
    document(page, 'D1', 'https://a.test/')
    sent(page, 'R1', 'https://a.test/before')
    const cut = recording.cut()
    sent(page, 'R2', 'https://a.test/after')
    finished(page, 'R1', 'https://a.test/before')
    finished(page, 'R2', 'https://a.test/after')
    await settle()
    const { exchanges, counts } = await cut.collect(1_000)
    expect(exchanges.map(({ request }) => request.url)).toEqual([
      'https://a.test/',
      'https://a.test/before'
    ])
    // R1 finished after the cut and still counts: it began before it.
    expect(counts.inFlight).toBe(0)
  })

  it('fetches each body from the session that reported it and keeps it in memory', async () => {
    const { recording, page } = setUp()
    const frame = fakeSession('frame-session')
    recording.addSession(frame, 'iframe', Promise.resolve())
    document(page, 'D1', 'https://a.test/')
    sent(frame, 'F1', 'https://b.test/frame.js')
    finished(frame, 'F1', 'https://b.test/frame.js')
    await settle()
    expect(frame.sent).toEqual(['Network.getResponseBody:F1'])
    expect(page.sent).toEqual(['Network.getResponseBody:D1'])
    const { exchanges, counts } = await recording.cut().collect(1_000)
    expect(exchanges.find(({ requestId }) => requestId === 'F1')?.responseBody).toEqual({
      data: Buffer.from('body-F1').toString('base64'),
      base64Encoded: true
    })
    expect(counts).toMatchObject({ recordedTargets: 2, unrecordedTargets: 0 })
  })

  it('counts a target whose setup failed as unrecorded', async () => {
    const { recording, page } = setUp()
    const failed = Promise.reject(new Error('Network.setCacheDisabled failed'))
    failed.catch(() => {})
    recording.addSession(fakeSession('frame-session'), 'iframe', failed)
    document(page, 'D1', 'https://a.test/')
    await settle()
    const { counts } = await recording.cut().collect(1_000)
    expect(counts).toMatchObject({ recordedTargets: 1, unrecordedTargets: 1 })
  })

  it('withholds every request body, replaces credential values, and counts the withheld bodies', async () => {
    const { recording, page } = setUp()
    document(page, 'D1', 'https://a.test/signed-in', 'password=SECRET')
    sent(page, 'P1', 'https://a.test/api', { body: '{"token":"SECRET"}' })
    finished(page, 'P1', 'https://a.test/api')
    await settle()
    const collected = await recording.cut().collect(1_000)
    expect(collected.requestBodiesWithheld).toBe(2)
    expect(collected.counts.incompleteRequestBodies).toBe(0)
    for (const exchange of collected.exchanges) expect(exchange.requestBody).toBeUndefined()
    expect(JSON.stringify(collected.exchanges)).not.toContain('SECRET')
  })

  it('lets a crashed tab go until it loads again', async () => {
    const { recording, page } = setUp()
    document(page, 'D1', 'https://a.test/')
    recording.crashed()
    expect(recording.isCrashed()).toBe(true)
    expect(recording.committedUrl()).toBeUndefined()
    document(page, 'D2', 'https://a.test/')
    expect(recording.isCrashed()).toBe(false)
    expect(await urls(recording)).toEqual(['https://a.test/'])
  })

  it('records nothing once the tab has closed', async () => {
    const { recording, page } = setUp()
    document(page, 'D1', 'https://a.test/')
    recording.discard()
    sent(page, 'R1', 'https://a.test/late')
    await expect(recording.cut().collect(1_000)).rejects.toThrow()
  })
})
