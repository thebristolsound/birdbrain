const BASE_URL = 'http://127.0.0.1:19845'

let cachedServerToken: string | null = null

export function setServerToken(token: string): void {
  cachedServerToken = token
}

export function getServerToken(): string | null {
  return cachedServerToken
}

export class ApiError extends Error {
  status: number
  detail: string
  constructor(status: number, statusText: string, detail: string) {
    super(`Request failed: ${status} ${statusText}`)
    this.status = status
    this.detail = detail
  }
}

interface StatusResponse {
  running: boolean
  serverToken?: string
  activeCase: { id: string; name: string } | null
  sessionActive: boolean
  captureCount: number
  autoCaptureMode?: string
  cases?: Array<{ id: string; name: string }>
  ignoredUrlPatterns?: string[]
  captureScreenshots?: boolean
  dedupeWindowSeconds?: number
}

interface CaseInfo {
  id: string
  name: string
  captureCount: number
}

interface CaptureResult {
  captureId: string
  hash: string
  status: string
  source: string
  manifestIndex?: number
  screenshotStatus?: 'saved' | 'dropped' | 'none'
  screenshotWarning?: string
}

interface SelectorInfo {
  id: string
  caseId: string
  pattern: string
  isRegex: boolean
  enabled: boolean
  label?: string
  createdAt: string
}

interface ActiveCaseSelectors {
  caseId: string
  caseName: string
  selectors: SelectorInfo[]
}

interface SelectorMatchInfo {
  selectorId: string
  caseId: string
  caseName: string
  pattern: string
  matchText: string
  context: string
  index: number
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string>)
  }
  if (cachedServerToken) {
    headers['X-Birdbrain-Token'] = cachedServerToken
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers
  })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = await res.json()
      detail = body.error || detail
    } catch {
      /* no JSON body */
    }
    throw new ApiError(res.status, res.statusText, detail)
  }
  return res.json() as Promise<T>
}

export async function getStatus(): Promise<StatusResponse> {
  return request('/api/status')
}

export async function getCases(): Promise<CaseInfo[]> {
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
  source: 'auto' | 'manual' | 'selector'
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
  matchedSelectors?: SelectorMatchInfo[]
}): Promise<CaptureResult> {
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
  if (params.matchedSelectors) {
    form.append('matchedSelectors', JSON.stringify(params.matchedSelectors))
  }
  if (params.screenshot) {
    form.append('screenshot', params.screenshot, 'screenshot.png')
  }
  form.append('mhtml', params.mhtml, 'capture.mhtml')

  const captureHeaders: Record<string, string> = {}
  if (cachedServerToken) {
    captureHeaders['X-Birdbrain-Token'] = cachedServerToken
  }
  const res = await fetch(BASE_URL + '/api/captures', {
    method: 'POST',
    body: form,
    headers: captureHeaders
  })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = await res.json()
      detail = body.error || detail
    } catch {
      /* no JSON body */
    }
    throw new ApiError(res.status, res.statusText, detail)
  }
  return res.json() as Promise<CaptureResult>
}

export async function testCapturePipeline(): Promise<{
  success: boolean
  durationMs: number
  error?: string
}> {
  return request('/api/captures/test')
}

export async function getActiveSelectors(): Promise<ActiveCaseSelectors[]> {
  return request('/api/selectors/active')
}

interface CreateSelectorResult {
  selector: SelectorInfo
  status: string
}

export async function createSelector(params: {
  caseId: string
  pattern: string
  label?: string
}): Promise<CreateSelectorResult> {
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
