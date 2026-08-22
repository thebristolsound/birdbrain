// getStatus() gained an optional includeCases flag for the options page (#406).
// The three existing zero-argument callers (background.ts, PopupApp.tsx and
// api.ts's own checkConnection) must keep hitting the unqualified URL, because
// the server only skips the case list when the query string says so.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BASE_URL, getStatus, getServerToken } from '@extension/utils/api'

const TOKEN = `${'b'.repeat(60)}7a21`

let requested: string[] = []

function stubFetch(body: Record<string, unknown>): void {
  requested = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      requested.push(url)
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => body
      } as unknown as Response
    })
  )
}

beforeEach(() => {
  stubFetch({ running: true })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getStatus query string', () => {
  it('exports the one address the extension talks to', () => {
    expect(BASE_URL).toBe('http://127.0.0.1:19845')
  })

  it('sends no query string when called with no argument', async () => {
    await getStatus()

    expect(requested).toEqual([`${BASE_URL}/api/status`])
  })

  it('sends no query string when cases are explicitly wanted', async () => {
    await getStatus({ includeCases: true })

    expect(requested).toEqual([`${BASE_URL}/api/status`])
  })

  it('asks the server to skip the case list when told to', async () => {
    await getStatus({ includeCases: false })

    expect(requested).toEqual([`${BASE_URL}/api/status?includeCases=0`])
  })

  it('caches a serverToken from the response so getServerToken can read it', async () => {
    expect(getServerToken()).toBeNull()

    stubFetch({ running: true, serverToken: TOKEN })
    await getStatus({ includeCases: false })

    expect(getServerToken()).toBe(TOKEN)
  })
})
