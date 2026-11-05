import { describe, expect, it, vi } from 'vitest'
import type { CdpSession } from '@main/services/launchedBrowser/cdpClient'
import { createLaunchedCaptures } from '@main/services/launchedBrowser/captures'

// The engine's release of its recordings when the browser closes (`dispose`), on a fake session.

const TAB = 'TAB-1'

function fakeSession(): CdpSession & { emit: (method: string, params: unknown) => void } {
  const handlers = new Map<string, Set<(params: unknown) => void>>()
  const session = {
    sessionId: 'page-session',
    send: vi.fn(async () => ({ body: '', base64Encoded: false })),
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
  return session as unknown as CdpSession & { emit: (method: string, params: unknown) => void }
}

describe('launched captures', () => {
  it('lets every recording go at dispose, so a tab records nothing more', async () => {
    const captures = createLaunchedCaptures({
      sink: {
        screenLaunched: () => null,
        admit: async () => ({ ok: false, refusal: { kind: 'duplicate' } }),
        abandonedLaunched: () => {}
      },
      activeCaseId: () => 'case-1',
      birdbrainVersion: 'test',
      citationOf: () => '',
      onChange: () => {},
      log: { warn: (_source, code) => code }
    })
    const session = fakeSession()
    const target = {
      targetId: TAB,
      type: 'page',
      title: '',
      url: 'about:blank',
      attached: true,
      browserContextId: 'default'
    }
    captures.onRecordedSession(session, target, {
      tabId: TAB,
      setup: Promise.resolve(),
      firstTab: true
    })
    const row = { targetId: TAB, title: '', url: '' }
    const document = (requestId: string, url: string) => {
      session.emit('Network.requestWillBeSent', {
        requestId,
        loaderId: requestId,
        frameId: TAB,
        type: 'Document',
        wallTime: 1,
        request: { url, method: 'GET', headers: {} }
      })
      session.emit('Page.frameNavigated', { frame: { id: TAB, loaderId: requestId, url } })
      session.emit('Network.loadingFinished', { requestId })
    }
    document('D1', 'https://a.test/')
    await new Promise((resolve) => setImmediate(resolve))
    expect(captures.decorate([row])[0]).toMatchObject({ firstRequest: true })
    expect(session.send).toHaveBeenCalledWith('Network.getResponseBody', { requestId: 'D1' })

    captures.dispose()
    vi.mocked(session.send).mockClear()
    document('D2', 'https://a.test/next')
    await new Promise((resolve) => setImmediate(resolve))
    expect(session.send).not.toHaveBeenCalled()
    expect(captures.decorate([row])).toEqual([row])
  })
})
