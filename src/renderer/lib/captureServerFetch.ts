import { CAPTURE_SERVER_BASE_URL } from '@shared/constants'

let cachedToken: string | null = null
let inflightFetch: Promise<string | null> | null = null

async function fetchServerToken(): Promise<string | null> {
  try {
    const res = await fetch(`${CAPTURE_SERVER_BASE_URL}/api/status`)
    if (!res.ok) return null
    const data = (await res.json()) as { serverToken?: string }
    return data.serverToken ?? null
  } catch {
    return null
  }
}

async function refreshToken(): Promise<string | null> {
  if (!inflightFetch) {
    inflightFetch = fetchServerToken()
      .then((token) => {
        if (token) cachedToken = token
        return token
      })
      .catch(() => null)
      .finally(() => {
        inflightFetch = null
      })
  }
  return inflightFetch
}

async function getToken(): Promise<string | null> {
  if (cachedToken) return cachedToken
  return refreshToken()
}

function buildRequest(path: string, init: RequestInit | undefined): Promise<Response> {
  const headers: Record<string, string> = {
    ...(init?.headers as Record<string, string>)
  }
  if (cachedToken) {
    headers['X-Birdbrain-Token'] = cachedToken
  }
  return fetch(`${CAPTURE_SERVER_BASE_URL}${path}`, { ...init, headers })
}

/**
 * fetch() wrapper that attaches the server auth token. On 401, refreshes the
 * token from /api/status and retries once — covers the window where the
 * Birdbrain app restarted and regenerated its token after the renderer cached
 * the previous one.
 */
export async function captureServerFetch(path: string, init?: RequestInit): Promise<Response> {
  const usedToken = await getToken()
  let res = await buildRequest(path, init)
  if (res.status === 401) {
    const refreshed = await refreshToken()
    if (refreshed && refreshed !== usedToken) {
      res = await buildRequest(path, init)
    }
  }
  return res
}
