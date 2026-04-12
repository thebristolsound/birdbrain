// Helper for making authenticated requests to the local capture server.
// The capture server requires an X-Birdbrain-Token header on POST endpoints.
// The token is generated at startup and exposed via /api/status.

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

async function getToken(): Promise<string | null> {
  if (cachedToken) return cachedToken
  if (!inflightFetch) {
    inflightFetch = fetchServerToken().then((token) => {
      cachedToken = token
      inflightFetch = null
      return token
    })
  }
  return inflightFetch
}

/**
 * fetch() wrapper that automatically attaches the server auth token.
 * Use for all calls to the local capture server from the renderer.
 */
export async function captureServerFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = await getToken()
  const headers = new Headers(init?.headers)
  if (token) {
    headers.set('X-Birdbrain-Token', token)
  }
  return fetch(`${CAPTURE_SERVER_BASE_URL}${path}`, { ...init, headers })
}
