// The wire contract lives in the shared source tree, next to the Zod schemas
// that validate the requests these responses answer. Type-only imports: the
// extension trusts the server and adds no runtime validation, so nothing from
// @shared is bundled.
import type {
  ActiveSelectorsResult,
  CaptureServerCase,
  CaptureServerStatus,
  CaptureUploadResult,
  CaptureUploadSource,
  SelectorCreateResult,
  SelectorMatchInfo
} from '@shared/schemas'

/** Mirrors CAPTURE_SERVER_PORT. Exported so the options page displays the one
 *  address the extension actually talks to rather than a second literal. */
export const BASE_URL = 'http://127.0.0.1:19845'
const STORAGE_KEY = 'birdbrainServerToken'

let cachedServerToken: string | null = null
let hydrationPromise: Promise<void> | null = null
let refreshPromise: Promise<string | null> | null = null

export class ApiError extends Error {
  status: number
  detail: string
  constructor(status: number, statusText: string, detail: string) {
    super(`Request failed: ${status} ${statusText}`)
    this.status = status
    this.detail = detail
  }
}

function hasChromeStorage(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.storage?.local
}

async function hydrateFromStorage(): Promise<void> {
  if (cachedServerToken) return
  if (!hydrationPromise) {
    hydrationPromise = (async () => {
      try {
        if (hasChromeStorage()) {
          const result = await chrome.storage.local.get(STORAGE_KEY)
          const stored = result[STORAGE_KEY]
          if (typeof stored === 'string' && stored) {
            cachedServerToken = stored
          }
        }
      } catch {
        //
      }
    })()
  }
  await hydrationPromise
}

export async function setServerToken(token: string): Promise<void> {
  cachedServerToken = token
  try {
    if (hasChromeStorage()) {
      await chrome.storage.local.set({ [STORAGE_KEY]: token })
    }
  } catch {
    //
  }
}

export function getServerToken(): string | null {
  return cachedServerToken
}

async function throwIfNotOk(res: Response): Promise<void> {
  if (res.ok) return
  let detail = res.statusText
  try {
    detail = ((await res.json()) as { error?: string }).error || detail
  } catch {
    //
  }
  throw new ApiError(res.status, res.statusText, detail)
}

export interface StatusOptions {
  /** Pass false to skip the case list the server would otherwise enumerate. */
  includeCases?: boolean
}

async function fetchStatus(options?: StatusOptions): Promise<CaptureServerStatus> {
  const query = options?.includeCases === false ? '?includeCases=0' : ''
  const res = await fetch(`${BASE_URL}/api/status${query}`)
  await throwIfNotOk(res)
  const data = (await res.json()) as CaptureServerStatus
  if (data.serverToken) {
    await setServerToken(data.serverToken)
  }
  return data
}

async function refreshServerToken(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const status = await fetchStatus()
        return status.serverToken ?? cachedServerToken
      } catch {
        return null
      } finally {
        refreshPromise = null
      }
    })()
  }
  return refreshPromise
}

async function ensureTokenForMutation(): Promise<void> {
  if (cachedServerToken) return
  await hydrateFromStorage()
  if (!cachedServerToken) {
    await refreshServerToken()
  }
}

async function doFetch(path: string, options?: RequestInit): Promise<Response> {
  const headers: Record<string, string> = {
    ...(options?.headers as Record<string, string>)
  }
  if (typeof options?.body === 'string' && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json'
  }
  if (cachedServerToken) {
    headers['X-Birdbrain-Token'] = cachedServerToken
  }
  return fetch(`${BASE_URL}${path}`, {
    ...options,
    headers
  })
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const method = (options?.method ?? 'GET').toUpperCase()
  const isMutating = method !== 'GET' && method !== 'HEAD'

  if (isMutating) await ensureTokenForMutation()

  let res = await doFetch(path, options)
  if (res.status === 401 && isMutating) {
    const refreshed = await refreshServerToken()
    if (refreshed) {
      res = await doFetch(path, options)
    }
  }

  await throwIfNotOk(res)
  return res.json() as Promise<T>
}

export async function getStatus(options?: StatusOptions): Promise<CaptureServerStatus> {
  return fetchStatus(options)
}

export async function getCases(): Promise<CaptureServerCase[]> {
  return request('/api/cases')
}

export async function activateCase(
  id: string
): Promise<{ status: string; case: { id: string; name: string } }> {
  return request(`/api/cases/${id}/activate`, { method: 'POST' })
}

export async function startSession(): Promise<{ status: string; sessionActive: boolean }> {
  return request('/api/session/start', { method: 'POST' })
}

export async function stopSession(): Promise<{ status: string; sessionActive: boolean }> {
  return request('/api/session/stop', { method: 'POST' })
}

export async function sendMhtmlCapture(params: {
  source: CaptureUploadSource
  caseId?: string
  url: string
  title: string
  timestamp: string
  textContent: string
  mhtml: Blob
  screenshot?: Blob
  browserVersion: string
  userAgent: string
  extensionVersion: string
  httpStatus?: number
  headers?: Record<string, string>
  matchedSelectors?: SelectorMatchInfo[]
}): Promise<CaptureUploadResult> {
  const form = new FormData()
  form.append('source', params.source)
  if (params.caseId) form.append('caseId', params.caseId)
  form.append('url', params.url)
  form.append('title', params.title)
  form.append('timestamp', params.timestamp)
  form.append('textContent', params.textContent)
  form.append('browserVersion', params.browserVersion)
  form.append('userAgent', params.userAgent)
  form.append('extensionVersion', params.extensionVersion)
  if (params.httpStatus !== undefined) form.append('httpStatus', String(params.httpStatus))
  if (params.headers && Object.keys(params.headers).length > 0) {
    form.append('headers', JSON.stringify(params.headers))
  }
  if (params.matchedSelectors) {
    form.append('matchedSelectors', JSON.stringify(params.matchedSelectors))
  }
  if (params.screenshot) {
    form.append('screenshot', params.screenshot, 'screenshot.png')
  }
  form.append('mhtml', params.mhtml, 'capture.mhtml')

  return request<CaptureUploadResult>('/api/captures', {
    method: 'POST',
    body: form
  })
}

export async function testCapturePipeline(): Promise<{
  success: boolean
  durationMs: number
  error?: string
}> {
  return request('/api/captures/test', { method: 'POST' })
}

export async function getActiveSelectors(): Promise<ActiveSelectorsResult> {
  return request('/api/selectors/active')
}

export async function createSelector(params: {
  caseId: string
  pattern: string
  label?: string
}): Promise<SelectorCreateResult> {
  return request('/api/selectors', {
    method: 'POST',
    body: JSON.stringify(params)
  })
}

export async function checkConnection(): Promise<boolean> {
  try {
    const status = await getStatus()
    return status.running === true
  } catch {
    return false
  }
}
