const BASE_URL = 'http://127.0.0.1:19845'

interface StatusResponse {
  running: boolean
  activeCase: { id: string; name: string } | null
  sessionActive: boolean
  captureCount: number
  autoCaptureMode?: string
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
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers
    }
  })
  return res.json() as Promise<T>
}

export async function getStatus(): Promise<StatusResponse> {
  return request('/api/status')
}

export async function getCases(): Promise<CaseInfo[]> {
  return request('/api/cases')
}

export async function activateCase(id: string): Promise<{ status: string; case: { id: string; name: string } }> {
  return request(`/api/cases/${id}/activate`, { method: 'POST' })
}

export async function startSession(): Promise<{ status: string; sessionActive: boolean }> {
  return request('/api/session/start', { method: 'POST' })
}

export async function stopSession(): Promise<{ status: string; sessionActive: boolean }> {
  return request('/api/session/stop', { method: 'POST' })
}

export async function sendCapture(data: {
  url: string
  title: string
  html: string
  screenshot?: string
  timestamp: string
  headers?: Record<string, string>
  textContent?: string
}): Promise<CaptureResult> {
  return request('/api/captures', {
    method: 'POST',
    body: JSON.stringify(data)
  })
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

export async function getActiveSelectors(): Promise<ActiveCaseSelectors[]> {
  return request('/api/selectors/active')
}

export async function sendSelectorCapture(data: {
  caseId: string
  url: string
  title: string
  html: string
  screenshot?: string
  timestamp: string
  headers?: Record<string, string>
  textContent?: string
  matchedSelectors: SelectorMatchInfo[]
}): Promise<CaptureResult> {
  return request('/api/captures/selector', {
    method: 'POST',
    body: JSON.stringify(data)
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
