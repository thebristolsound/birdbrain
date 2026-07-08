// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { CAPTURE_SERVER_BASE_URL } from '@shared/constants'

// The module caches the server token at module scope, so each test imports a
// fresh copy after resetModules() to isolate cache state.
async function loadModule() {
  vi.resetModules()
  return import('@renderer/lib/captureServerFetch')
}

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  } as unknown as Response
}

describe('captureServerFetch', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetches a token from /api/status then attaches it to the request', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ serverToken: 'tok-1' }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))

    const { captureServerFetch } = await loadModule()
    const res = await captureServerFetch('/api/captures')

    expect(res).toBeDefined()
    // First call is the token fetch, second is the actual request.
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `${CAPTURE_SERVER_BASE_URL}/api/status?includeCases=0`
    )
    const [url, init] = fetchMock.mock.calls[1]
    expect(url).toBe(`${CAPTURE_SERVER_BASE_URL}/api/captures`)
    const headers = init.headers as Headers
    expect(headers.get('X-Birdbrain-Token')).toBe('tok-1')
  })

  it('reuses the cached token on subsequent calls without re-fetching status', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ serverToken: 'tok-1' }))
      .mockResolvedValue(jsonResponse({ ok: true }))

    const { captureServerFetch } = await loadModule()
    await captureServerFetch('/api/a')
    await captureServerFetch('/api/b')

    // Status endpoint should only be hit once (initial token fetch).
    const statusCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes('/api/status')
    )
    expect(statusCalls).toHaveLength(1)
  })

  it('refreshes the token and retries once on 401', async () => {
    fetchMock
      // initial token fetch
      .mockResolvedValueOnce(jsonResponse({ serverToken: 'stale' }))
      // first request -> 401
      .mockResolvedValueOnce(jsonResponse({}, 401))
      // token refresh returns a new token
      .mockResolvedValueOnce(jsonResponse({ serverToken: 'fresh' }))
      // retried request succeeds
      .mockResolvedValueOnce(jsonResponse({ ok: true }, 200))

    const { captureServerFetch } = await loadModule()
    const res = await captureServerFetch('/api/protected')

    expect(res.status).toBe(200)
    // Final request carries the refreshed token.
    const lastInit = fetchMock.mock.calls[3][1]
    expect((lastInit.headers as Headers).get('X-Birdbrain-Token')).toBe('fresh')
  })

  it('does not retry when the refreshed token is unchanged', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ serverToken: 'same' }))
      .mockResolvedValueOnce(jsonResponse({}, 401))
      // refresh returns the same token -> no retry
      .mockResolvedValueOnce(jsonResponse({ serverToken: 'same' }))

    const { captureServerFetch } = await loadModule()
    const res = await captureServerFetch('/api/protected')

    expect(res.status).toBe(401)
    // token fetch + request + refresh = 3, no 4th retry request
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('proceeds with no token header when status fetch fails', async () => {
    fetchMock
      // token fetch rejects
      .mockRejectedValueOnce(new Error('offline'))
      // request still made, sans token
      .mockResolvedValueOnce(jsonResponse({ ok: true }))

    const { captureServerFetch } = await loadModule()
    const res = await captureServerFetch('/api/x')

    expect(res).toBeDefined()
    const requestInit = fetchMock.mock.calls[1][1]
    expect((requestInit.headers as Headers).get('X-Birdbrain-Token')).toBeNull()
  })

  it('treats a non-ok status response as no token', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({}, 500))
      .mockResolvedValueOnce(jsonResponse({ ok: true }))

    const { captureServerFetch } = await loadModule()
    await captureServerFetch('/api/y')

    const requestInit = fetchMock.mock.calls[1][1]
    expect((requestInit.headers as Headers).get('X-Birdbrain-Token')).toBeNull()
  })
})
