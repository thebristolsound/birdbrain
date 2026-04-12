import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  initDatabase,
  closeDatabase,
  createCase,
  createSelector,
  updateCase,
  listCaptures,
  listSelectors,
  getSelectorMatchCounts
} from '@main/services/database'
import { initStorage } from '@main/services/storage'
import { initSettings, updateSettings } from '@main/services/settings'
import { initInstallationId, resetInstallationId } from '@main/services/installationId'
import {
  startCaptureServer,
  stopCaptureServer,
  getSessionState,
  resetSessionState
} from '@main/services/captureServer'
import { MAX_SCREENSHOT_SIZE } from '@shared/constants'

let nextPort = 19846
const TEST_TOKEN = 'test-server-token'

describe('captureServer', () => {
  let tempDir: string
  let baseUrl: string

  beforeEach(async () => {
    const port = nextPort++
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-server-test-'))
    initDatabase(':memory:')
    initStorage(join(tempDir, 'captures'))
    initSettings(tempDir)
    resetInstallationId()
    initInstallationId(tempDir)
    resetSessionState()
    baseUrl = `http://127.0.0.1:${port}`
    await startCaptureServer(port, TEST_TOKEN)
  })

  afterEach(async () => {
    await stopCaptureServer()
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  function serverPost(path: string, init?: RequestInit): Promise<Response> {
    return fetch(`${baseUrl}${path}`, {
      ...init,
      method: 'POST',
      headers: { 'X-Birdbrain-Token': TEST_TOKEN, ...(init?.headers as Record<string, string>) }
    })
  }

  function postCapture(
    fields: Record<string, string>,
    mhtmlContent = '<html>test</html>'
  ): Promise<Response> {
    const form = new FormData()
    for (const [k, v] of Object.entries(fields)) form.append(k, v)
    form.append('mhtml', new Blob([mhtmlContent], { type: 'multipart/related' }), 'capture.mhtml')
    return fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      body: form,
      headers: { 'X-Birdbrain-Token': TEST_TOKEN }
    })
  }

  it('GET /api/status returns running state', async () => {
    const res = await fetch(`${baseUrl}/api/status`)
    const data = await res.json()
    expect(data.running).toBe(true)
    expect(data.activeCase).toBeNull()
    expect(data.sessionActive).toBe(false)
  })

  it('GET /api/status exposes serverToken to extension and localhost origins', async () => {
    const res = await fetch(`${baseUrl}/api/status`, {
      headers: { Origin: 'chrome-extension://abcdef1234567890' }
    })
    const data = await res.json()
    expect(data.serverToken).toBe(TEST_TOKEN)
  })

  it('GET /api/status omits serverToken for unknown origins', async () => {
    const res = await fetch(`${baseUrl}/api/status`, {
      headers: { Origin: 'https://evil.example.com' }
    })
    const data = await res.json()
    expect(data.serverToken).toBeUndefined()
  })

  it('POST endpoints reject requests without a valid token', async () => {
    const testCase = createCase({ name: 'Auth Test' })
    const missing = await fetch(`${baseUrl}/api/cases/${testCase.id}/activate`, { method: 'POST' })
    expect(missing.status).toBe(401)

    const wrong = await fetch(`${baseUrl}/api/cases/${testCase.id}/activate`, {
      method: 'POST',
      headers: { 'X-Birdbrain-Token': 'not-the-right-token' }
    })
    expect(wrong.status).toBe(401)
  })

  it('GET /api/cases returns empty list initially', async () => {
    const res = await fetch(`${baseUrl}/api/cases`)
    const data = await res.json()
    expect(data).toEqual([])
  })

  it('GET /api/cases returns cases with capture counts', async () => {
    createCase({ name: 'Test Case' })
    const res = await fetch(`${baseUrl}/api/cases`)
    const data = await res.json()
    expect(data).toHaveLength(1)
    expect(data[0].name).toBe('Test Case')
    expect(data[0].captureCount).toBe(0)
  })

  it('POST /api/cases/:id/activate sets active case', async () => {
    const testCase = createCase({ name: 'Active Case' })
    const res = await serverPost(`/api/cases/${testCase.id}/activate`)
    const data = await res.json()
    expect(data.status).toBe('ok')
    expect(data.case.name).toBe('Active Case')

    const state = getSessionState()
    expect(state.activeCaseId).toBe(testCase.id)
  })

  it('POST /api/cases/:id/activate returns 404 for unknown case', async () => {
    const res = await serverPost('/api/cases/nonexistent/activate')
    expect(res.status).toBe(404)
  })

  it('POST /api/session/start fails without active case', async () => {
    const res = await serverPost('/api/session/start')
    expect(res.status).toBe(400)
  })

  it('POST /api/session/start and /stop manage session state', async () => {
    const testCase = createCase({ name: 'Session Test' })
    await serverPost(`/api/cases/${testCase.id}/activate`)

    const startRes = await serverPost('/api/session/start')
    const startData = await startRes.json()
    expect(startData.sessionActive).toBe(true)

    const statusRes = await fetch(`${baseUrl}/api/status`)
    const statusData = await statusRes.json()
    expect(statusData.sessionActive).toBe(true)

    const stopRes = await serverPost('/api/session/stop')
    const stopData = await stopRes.json()
    expect(stopData.sessionActive).toBe(false)
  })

  // --- Unified capture endpoint tests ---

  it('source=auto stores capture when session active', async () => {
    const testCase = createCase({ name: 'Capture Test' })
    await serverPost(`/api/cases/${testCase.id}/activate`)
    await serverPost('/api/session/start')

    const res = await postCapture(
      {
        source: 'auto',
        url: 'https://example.com',
        title: 'Example Page',
        timestamp: new Date().toISOString(),
        textContent: 'Hello World'
      },
      '<html><body>Hello World</body></html>'
    )

    const data = await res.json()
    expect(data.status).toBe('ok')
    expect(data.captureId).toBeDefined()
    expect(data.hash).toHaveLength(64)
    expect(data.source).toBe('auto')

    const captures = listCaptures(testCase.id)
    expect(captures).toHaveLength(1)
    expect(captures[0].url).toBe('https://example.com')
  })

  it('source=auto rejects without active session', async () => {
    const testCase = createCase({ name: 'No Session' })
    await serverPost(`/api/cases/${testCase.id}/activate`)

    const res = await postCapture({
      source: 'auto',
      url: 'https://example.com'
    })
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('session')
  })

  it('source=auto rejects without active case', async () => {
    const res = await postCapture({
      source: 'auto',
      url: 'https://example.com'
    })
    expect(res.status).toBe(400)
  })

  it('source=auto increments capture count', async () => {
    const testCase = createCase({ name: 'Count Test' })
    await serverPost(`/api/cases/${testCase.id}/activate`)
    await serverPost('/api/session/start')

    await postCapture(
      {
        source: 'auto',
        url: 'https://a.com',
        title: 'A'
      },
      '<html>a</html>'
    )

    await postCapture(
      {
        source: 'auto',
        url: 'https://b.com',
        title: 'B'
      },
      '<html>b</html>'
    )

    const state = getSessionState()
    expect(state.captureCount).toBe(2)
  })

  it('source=manual stores capture without active session', async () => {
    const testCase = createCase({ name: 'Manual Test' })

    const res = await postCapture(
      {
        source: 'manual',
        caseId: testCase.id,
        url: 'https://example.com/manual',
        title: 'Manual Page',
        timestamp: new Date().toISOString(),
        textContent: 'Manual capture'
      },
      '<html><body>Manual capture</body></html>'
    )

    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.status).toBe('ok')
    expect(data.captureId).toBeDefined()
    expect(data.hash).toHaveLength(64)
    expect(data.source).toBe('manual')

    const captures = listCaptures(testCase.id)
    expect(captures).toHaveLength(1)
    expect(captures[0].url).toBe('https://example.com/manual')

    // Should NOT increment session capture count
    const state = getSessionState()
    expect(state.captureCount).toBe(0)
  })

  it('source=manual returns 400 without caseId', async () => {
    const res = await postCapture({
      source: 'manual',
      url: 'https://example.com'
    })
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('caseId')
  })

  it('source=manual returns 404 for unknown case', async () => {
    const res = await postCapture({
      source: 'manual',
      caseId: 'nonexistent-id',
      url: 'https://example.com'
    })
    expect(res.status).toBe(404)
  })

  it('source=manual returns 400 for archived case', async () => {
    const testCase = createCase({ name: 'Archived Case' })
    updateCase({ id: testCase.id, archived: true })

    const res = await postCapture({
      source: 'manual',
      caseId: testCase.id,
      url: 'https://example.com'
    })
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('archived')
  })

  it('source=selector requires caseId', async () => {
    // Missing caseId
    const res = await postCapture({
      source: 'selector',
      url: 'https://example.com'
    })
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('caseId')
  })

  it('source=selector stores capture', async () => {
    const testCase = createCase({ name: 'Selector Capture' })

    const res = await postCapture(
      {
        source: 'selector',
        caseId: testCase.id,
        url: 'https://example.com/selector',
        title: 'Selector Page',
        textContent: 'Selector content'
      },
      '<html><body>Selector content</body></html>'
    )

    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.status).toBe('ok')
    expect(data.source).toBe('selector')

    const captures = listCaptures(testCase.id)
    expect(captures).toHaveLength(1)

    // Should NOT increment session capture count
    const state = getSessionState()
    expect(state.captureCount).toBe(0)
  })

  it('rejects when mhtml field is missing', async () => {
    const testCase = createCase({ name: 'Validation Test' })
    await serverPost(`/api/cases/${testCase.id}/activate`)
    await serverPost('/api/session/start')

    const form = new FormData()
    form.append('source', 'auto')
    form.append('url', 'https://example.com')
    const res = await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      body: form,
      headers: { 'X-Birdbrain-Token': TEST_TOKEN }
    })
    expect(res.status).toBe(400)
  })

  it('returns 400 with structured error when url is missing', async () => {
    const testCase = createCase({ name: 'Missing URL' })
    await serverPost(`/api/cases/${testCase.id}/activate`)
    await serverPost('/api/session/start')

    const form = new FormData()
    form.append('source', 'auto')
    form.append(
      'mhtml',
      new Blob(['<html>test</html>'], { type: 'multipart/related' }),
      'capture.mhtml'
    )
    const res = await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      body: form,
      headers: { 'X-Birdbrain-Token': TEST_TOKEN }
    })
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('url')
  })

  it('returns 400 for unknown source value', async () => {
    const testCase = createCase({ name: 'Unknown Source Test' })
    await serverPost(`/api/cases/${testCase.id}/activate`)
    await serverPost('/api/session/start')

    const form = new FormData()
    form.append('source', 'typoed-source')
    form.append('url', 'https://example.com')
    form.append(
      'mhtml',
      new Blob(['<html>test</html>'], { type: 'multipart/related' }),
      'capture.mhtml'
    )
    const res = await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      body: form,
      headers: { 'X-Birdbrain-Token': TEST_TOKEN }
    })
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('Invalid source')
  })

  // --- Status endpoint ---

  it('GET /api/status returns cases and ignoredUrlPatterns', async () => {
    createCase({ name: 'Case A' })
    createCase({ name: 'Case B' })

    const res = await fetch(`${baseUrl}/api/status`)
    const data = await res.json()
    expect(data.running).toBe(true)
    expect(data.cases).toHaveLength(2)
    expect(data.cases[0]).toHaveProperty('id')
    expect(data.cases[0]).toHaveProperty('name')
    expect(data.ignoredUrlPatterns).toEqual([])
    expect(data.captureScreenshots).toBe(true)
    expect(data.dedupeWindowSeconds).toBe(60)
  })

  // --- Blacklist tests ---

  it('source=auto blocks blacklisted URL with 403', async () => {
    const testCase = createCase({ name: 'Blacklist Test' })
    await serverPost(`/api/cases/${testCase.id}/activate`)
    await serverPost('/api/session/start')

    updateSettings({ ignoredUrlPatterns: ['facebook.com'] })

    const res = await postCapture(
      {
        source: 'auto',
        url: 'https://facebook.com/some-page',
        title: 'Facebook'
      },
      '<html>fb</html>'
    )

    expect(res.status).toBe(403)
    const data = await res.json()
    expect(data.pattern).toBe('facebook.com')
  })

  it('source=auto allows non-blacklisted URL', async () => {
    const testCase = createCase({ name: 'Allow Test' })
    await serverPost(`/api/cases/${testCase.id}/activate`)
    await serverPost('/api/session/start')

    updateSettings({ ignoredUrlPatterns: ['facebook.com'] })

    const res = await postCapture(
      {
        source: 'auto',
        url: 'https://example.com',
        title: 'Example'
      },
      '<html>example</html>'
    )

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.status).toBe('ok')
  })

  it('source=manual blocks blacklisted URL with 403', async () => {
    const testCase = createCase({ name: 'Manual Blacklist' })
    updateSettings({ ignoredUrlPatterns: ['blocked-site.com'] })

    const res = await postCapture(
      {
        source: 'manual',
        caseId: testCase.id,
        url: 'https://blocked-site.com/page'
      },
      '<html>blocked</html>'
    )

    expect(res.status).toBe(403)
  })

  it('source=selector blocks blacklisted URL with 403', async () => {
    const testCase = createCase({ name: 'Selector Blacklist' })
    updateSettings({ ignoredUrlPatterns: ['spam.org'] })

    const res = await postCapture(
      {
        source: 'selector',
        caseId: testCase.id,
        url: 'https://spam.org/content',
        title: 'Spam'
      },
      '<html>spam</html>'
    )

    expect(res.status).toBe(403)
  })

  it('blacklist supports regex patterns', async () => {
    const testCase = createCase({ name: 'Regex Blacklist' })
    await serverPost(`/api/cases/${testCase.id}/activate`)
    await serverPost('/api/session/start')

    updateSettings({ ignoredUrlPatterns: ['/.*\\.pdf$/i'] })

    const blockedRes = await postCapture(
      {
        source: 'auto',
        url: 'https://example.com/document.pdf',
        title: 'PDF'
      },
      '<html>pdf</html>'
    )
    expect(blockedRes.status).toBe(403)

    const allowedRes = await postCapture(
      {
        source: 'auto',
        url: 'https://example.com/page.html',
        title: 'HTML'
      },
      '<html>html</html>'
    )
    expect(allowedRes.status).toBe(200)
  })

  it('blacklist supports glob/wildcard patterns', async () => {
    const testCase = createCase({ name: 'Glob Blacklist' })
    await serverPost(`/api/cases/${testCase.id}/activate`)
    await serverPost('/api/session/start')

    updateSettings({ ignoredUrlPatterns: ['*.facebook.com*'] })

    const blockedRes = await postCapture(
      {
        source: 'auto',
        url: 'https://www.facebook.com/some/page',
        title: 'FB'
      },
      '<html>fb</html>'
    )
    expect(blockedRes.status).toBe(403)

    const allowedRes = await postCapture(
      {
        source: 'auto',
        url: 'https://example.com/page',
        title: 'Example'
      },
      '<html>ok</html>'
    )
    expect(allowedRes.status).toBe(200)
  })

  it('GET /api/captures/test returns pipeline health', async () => {
    createCase({ name: 'Pipeline Test Case' })

    const res = await fetch(`${baseUrl}/api/captures/test`)
    const data = await res.json()
    expect(data.success).toBe(true)
    expect(data.durationMs).toBeGreaterThanOrEqual(0)
    expect(data.error).toBeUndefined()
  })

  it('blacklist glob pattern with ? wildcard matches single character', async () => {
    const testCase = createCase({ name: 'Glob Question' })
    await serverPost(`/api/cases/${testCase.id}/activate`)
    await serverPost('/api/session/start')

    updateSettings({ ignoredUrlPatterns: ['example.com/user?'] })

    const blockedRes = await postCapture(
      {
        source: 'auto',
        url: 'https://example.com/userA',
        title: 'User A'
      },
      '<html>a</html>'
    )
    expect(blockedRes.status).toBe(403)

    const allowedRes = await postCapture(
      {
        source: 'auto',
        url: 'https://example.com/users',
        title: 'Users'
      },
      '<html>users</html>'
    )
    // 'users' ends with 's' which matches the '?' — still blocked
    expect(allowedRes.status).toBe(403)
  })

  // --- Manual capture dedup tests ---

  it('source=manual rejects duplicate within 5s window', async () => {
    const testCase = createCase({ name: 'Dedup Test' })
    const url = 'https://example.com/page'

    const first = await postCapture({
      source: 'manual',
      caseId: testCase.id,
      url,
      title: 'Test',
      timestamp: new Date().toISOString()
    })
    expect(first.status).toBe(200)

    const second = await postCapture({
      source: 'manual',
      caseId: testCase.id,
      url,
      title: 'Test',
      timestamp: new Date().toISOString()
    })
    expect(second.status).toBe(409)
    const data = await second.json()
    expect(data.error).toContain('Duplicate')

    const captures = listCaptures(testCase.id)
    expect(captures).toHaveLength(1)
  })

  it.skip('source=manual allows same URL after dedup window expires', async () => {
    const testCase = createCase({ name: 'Dedup Expiry' })
    const url = 'https://example.com/expiry-test'

    const first = await postCapture({
      source: 'manual',
      caseId: testCase.id,
      url,
      title: 'Test',
      timestamp: new Date().toISOString()
    })
    expect(first.status).toBe(200)

    // Advance time past the 5s window
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.advanceTimersByTime(6000)
    vi.useRealTimers()

    const second = await postCapture({
      source: 'manual',
      caseId: testCase.id,
      url,
      title: 'Test',
      timestamp: new Date().toISOString()
    })
    expect(second.status).toBe(200)

    const captures = listCaptures(testCase.id)
    expect(captures).toHaveLength(2)
  })

  it('source=manual allows different URLs in same case within window', async () => {
    const testCase = createCase({ name: 'Dedup Diff URL' })

    const first = await postCapture({
      source: 'manual',
      caseId: testCase.id,
      url: 'https://example.com/page-a',
      title: 'Test',
      timestamp: new Date().toISOString()
    })
    expect(first.status).toBe(200)

    const second = await postCapture({
      source: 'manual',
      caseId: testCase.id,
      url: 'https://example.com/page-b',
      title: 'Test',
      timestamp: new Date().toISOString()
    })
    expect(second.status).toBe(200)

    const captures = listCaptures(testCase.id)
    expect(captures).toHaveLength(2)
  })

  it('source=manual allows same URL in different cases within window', async () => {
    const caseA = createCase({ name: 'Case A' })
    const caseB = createCase({ name: 'Case B' })
    const url = 'https://example.com/shared-page'

    const first = await postCapture({
      source: 'manual',
      caseId: caseA.id,
      url,
      title: 'Test',
      timestamp: new Date().toISOString()
    })
    expect(first.status).toBe(200)

    const second = await postCapture({
      source: 'manual',
      caseId: caseB.id,
      url,
      title: 'Test',
      timestamp: new Date().toISOString()
    })
    expect(second.status).toBe(200)
  })

  it('source=auto is not affected by manual dedup', async () => {
    const testCase = createCase({ name: 'Auto No Dedup' })
    await serverPost(`/api/cases/${testCase.id}/activate`)
    await serverPost('/api/session/start')

    const first = await postCapture(
      {
        source: 'auto',
        url: 'https://example.com/auto-page',
        title: 'Auto'
      },
      '<html>auto</html>'
    )
    expect(first.status).toBe(200)

    const second = await postCapture(
      {
        source: 'auto',
        url: 'https://example.com/auto-page',
        title: 'Auto'
      },
      '<html>auto</html>'
    )
    expect(second.status).toBe(200)

    const captures = listCaptures(testCase.id)
    expect(captures).toHaveLength(2)
  })

  it('source=selector is not affected by manual dedup', async () => {
    const testCase = createCase({ name: 'Selector No Dedup' })

    const first = await postCapture(
      {
        source: 'selector',
        caseId: testCase.id,
        url: 'https://example.com/selector-page',
        title: 'Selector'
      },
      '<html>selector</html>'
    )
    expect(first.status).toBe(200)

    const second = await postCapture(
      {
        source: 'selector',
        caseId: testCase.id,
        url: 'https://example.com/selector-page',
        title: 'Selector'
      },
      '<html>selector</html>'
    )
    expect(second.status).toBe(200)

    const captures = listCaptures(testCase.id)
    expect(captures).toHaveLength(2)
  })

  it('manual dedup state is cleared by resetSessionState', async () => {
    const testCase = createCase({ name: 'Dedup Reset' })

    const first = await postCapture({
      source: 'manual',
      caseId: testCase.id,
      url: 'https://example.com/page',
      title: 'Test',
      timestamp: new Date().toISOString()
    })
    expect(first.status).toBe(200)

    // Without reset, this would be 409
    resetSessionState()

    const second = await postCapture({
      source: 'manual',
      caseId: testCase.id,
      url: 'https://example.com/page',
      title: 'Test',
      timestamp: new Date().toISOString()
    })
    expect(second.status).toBe(200)
  })

  // --- MHTML-specific test ---

  it('stores a manual MHTML capture with forensic fields', async () => {
    const c = createCase({ name: 'MHTML Test' })
    const mhtmlBytes = '<html><body>mhtml test</body></html>'
    const res = await postCapture(
      {
        source: 'manual',
        caseId: c.id,
        url: 'https://example.com/mhtml',
        title: 'MHTML Page',
        timestamp: new Date().toISOString(),
        textContent: 'mhtml test',
        extensionVersion: '0.1.0',
        browserVersion: 'Chrome/120',
        userAgent: 'Mozilla/5.0'
      },
      mhtmlBytes
    )

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.captureId).toBeDefined()
    expect(data.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(data.manifestIndex).toBe(0)

    const rows = listCaptures(c.id)
    expect(rows).toHaveLength(1)
    expect(rows[0].format).toBe('mhtml')
  })

  it('stores screenshot alongside MHTML capture', async () => {
    const c = createCase({ name: 'Screenshot Test' })
    const screenshotData = Buffer.from('fake-png-screenshot-data')

    const form = new FormData()
    form.append('source', 'manual')
    form.append('caseId', c.id)
    form.append('url', 'https://example.com/with-screenshot')
    form.append('title', 'Screenshot Page')
    form.append('timestamp', new Date().toISOString())
    form.append('textContent', 'page text')
    form.append(
      'mhtml',
      new Blob(['<html>ss</html>'], { type: 'multipart/related' }),
      'capture.mhtml'
    )
    form.append('screenshot', new Blob([screenshotData], { type: 'image/png' }), 'screenshot.png')

    const res = await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      body: form,
      headers: { 'X-Birdbrain-Token': TEST_TOKEN }
    })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.screenshotStatus).toBe('saved')

    const captures = listCaptures(c.id)
    expect(captures).toHaveLength(1)
    expect(captures[0].screenshotPath).toContain('.png')
  })

  it('returns screenshotStatus "dropped" when screenshot exceeds size limit', async () => {
    const c = createCase({ name: 'Large Screenshot Test' })
    const oversized = Buffer.alloc(MAX_SCREENSHOT_SIZE + 1, 0x42)

    const form = new FormData()
    form.append('source', 'manual')
    form.append('caseId', c.id)
    form.append('url', 'https://example.com/large-screenshot')
    form.append('title', 'Large Screenshot Page')
    form.append('timestamp', new Date().toISOString())
    form.append('textContent', 'page text')
    form.append(
      'mhtml',
      new Blob(['<html>large</html>'], { type: 'multipart/related' }),
      'capture.mhtml'
    )
    form.append('screenshot', new Blob([oversized], { type: 'image/png' }), 'screenshot.png')

    const res = await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      body: form,
      headers: { 'X-Birdbrain-Token': TEST_TOKEN }
    })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.screenshotStatus).toBe('dropped')
    expect(data.screenshotWarning).toContain('too large')

    const captures = listCaptures(c.id)
    expect(captures).toHaveLength(1)
    expect(captures[0].screenshotPath).toBeFalsy()
  })

  it('returns screenshotStatus "none" when no screenshot is sent', async () => {
    const c = createCase({ name: 'No Screenshot Test' })

    const res = await postCapture({
      source: 'manual',
      caseId: c.id,
      url: 'https://example.com/no-screenshot',
      title: 'No Screenshot Page',
      timestamp: new Date().toISOString(),
      textContent: 'page text'
    })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.screenshotStatus).toBe('none')
    expect(data.screenshotWarning).toBeUndefined()
  })

  // --- POST /api/selectors (create selector from extension) ---

  async function activateSessionForCase(caseId: string) {
    await serverPost(`/api/cases/${caseId}/activate`)
    await serverPost('/api/session/start')
  }

  it('POST /api/selectors creates a literal selector', async () => {
    const testCase = createCase({ name: 'Selector Create Test' })
    await activateSessionForCase(testCase.id)

    const res = await serverPost('/api/selectors', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caseId: testCase.id,
        pattern: 'suspicious transaction',
        label: 'from example.com'
      })
    })

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.status).toBe('ok')
    expect(data.selector).toBeDefined()
    expect(data.selector.pattern).toBe('suspicious transaction')
    expect(data.selector.isRegex).toBe(false)
    expect(data.selector.enabled).toBe(true)
    expect(data.selector.label).toBe('from example.com')
    expect(data.selector.caseId).toBe(testCase.id)
    expect(data.selector.id).toBeDefined()
    expect(data.selector.createdAt).toBeDefined()

    // Verify it persisted in the database
    const selectors = listSelectors(testCase.id)
    expect(selectors).toHaveLength(1)
    expect(selectors[0].pattern).toBe('suspicious transaction')
  })

  it('POST /api/selectors returns 400 without active case', async () => {
    const testCase = createCase({ name: 'No Session Selector' })

    const res = await serverPost('/api/selectors', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caseId: testCase.id,
        pattern: 'test pattern'
      })
    })

    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('active case')
  })

  it('POST /api/selectors returns 400 for empty pattern', async () => {
    const testCase = createCase({ name: 'Empty Pattern' })
    await activateSessionForCase(testCase.id)

    const res = await serverPost('/api/selectors', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caseId: testCase.id,
        pattern: ''
      })
    })

    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('pattern')
  })

  it('POST /api/selectors returns 400 for missing pattern', async () => {
    const testCase = createCase({ name: 'Missing Pattern' })
    await activateSessionForCase(testCase.id)

    const res = await serverPost('/api/selectors', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caseId: testCase.id
      })
    })

    expect(res.status).toBe(400)
  })

  it('POST /api/selectors returns 400 for missing caseId', async () => {
    const testCase = createCase({ name: 'Missing CaseId' })
    await activateSessionForCase(testCase.id)

    const res = await serverPost('/api/selectors', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pattern: 'test'
      })
    })

    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('caseId')
  })

  it('POST /api/selectors returns 400 for caseId not matching active case', async () => {
    const testCase = createCase({ name: 'Unknown Case Selector' })
    await activateSessionForCase(testCase.id)

    const res = await serverPost('/api/selectors', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caseId: 'nonexistent-case-id',
        pattern: 'test'
      })
    })

    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('active case')
  })

  it('POST /api/selectors returns 400 for archived case', async () => {
    const testCase = createCase({ name: 'Archived Selector' })
    updateCase({ id: testCase.id, archived: true })
    await activateSessionForCase(testCase.id)

    const res = await serverPost('/api/selectors', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caseId: testCase.id,
        pattern: 'test pattern'
      })
    })

    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('archived')
  })

  it('POST /api/selectors returns 400 when caseId does not match active case', async () => {
    const activeCase = createCase({ name: 'Active Case Mismatch' })
    const otherCase = createCase({ name: 'Other Case' })
    await activateSessionForCase(activeCase.id)

    const res = await serverPost('/api/selectors', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caseId: otherCase.id,
        pattern: 'test pattern'
      })
    })

    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('active case')
  })

  it('POST /api/selectors schedules retroactive matching', async () => {
    const testCase = createCase({ name: 'Retro Match Test' })
    await activateSessionForCase(testCase.id)

    // Create a capture with text content that contains the pattern
    await postCapture(
      {
        source: 'auto',
        url: 'https://example.com/page1',
        title: 'Page 1',
        timestamp: new Date().toISOString(),
        textContent: 'suspicious transaction detected here'
      },
      '<html><body>suspicious transaction detected here</body></html>'
    )

    // Create another capture without the pattern
    await postCapture(
      {
        source: 'auto',
        url: 'https://example.com/page2',
        title: 'Page 2',
        timestamp: new Date().toISOString(),
        textContent: 'nothing interesting'
      },
      '<html><body>nothing interesting</body></html>'
    )

    // Now create a selector that matches the first capture
    const res = await serverPost('/api/selectors', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caseId: testCase.id,
        pattern: 'suspicious transaction'
      })
    })

    expect(res.status).toBe(200)
    const data = await res.json()

    // Poll for retroactive matching to complete (chunked processing may need multiple ticks)
    let matchCounts = getSelectorMatchCounts(testCase.id)
    const deadline = Date.now() + 2000
    while (matchCounts[data.selector.id] !== 1 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20))
      matchCounts = getSelectorMatchCounts(testCase.id)
    }
    expect(matchCounts[data.selector.id]).toBe(1)
  })

  it('POST /api/selectors ignores non-string label', async () => {
    const testCase = createCase({ name: 'Bad Label Type' })
    await activateSessionForCase(testCase.id)

    const res = await serverPost('/api/selectors', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caseId: testCase.id,
        pattern: 'test',
        label: 12345
      })
    })

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.selector.label).toBeUndefined()
  })

  it('POST /api/selectors trims whitespace-only label to undefined', async () => {
    const testCase = createCase({ name: 'Whitespace Label' })
    await activateSessionForCase(testCase.id)

    const res = await serverPost('/api/selectors', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caseId: testCase.id,
        pattern: 'test',
        label: '   '
      })
    })

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.selector.label).toBeUndefined()
  })

  it('POST /api/selectors creates selector without label', async () => {
    const testCase = createCase({ name: 'No Label' })
    await activateSessionForCase(testCase.id)

    const res = await serverPost('/api/selectors', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caseId: testCase.id,
        pattern: 'test pattern'
      })
    })

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.selector.label).toBeUndefined()
  })

  it('GET /api/selectors/active returns only selectors for active case', async () => {
    const case1 = createCase({ name: 'Active Case' })
    const case2 = createCase({ name: 'Other Case' })
    createSelector({ caseId: case1.id, pattern: 'target-person' })
    createSelector({ caseId: case2.id, pattern: 'other-person' })

    // Activate case1
    await serverPost(`/api/cases/${case1.id}/activate`)

    const res = await fetch(`${baseUrl}/api/selectors/active`)
    const data = await res.json()
    expect(data).toHaveLength(1)
    expect(data[0].caseId).toBe(case1.id)
    expect(data[0].selectors).toHaveLength(1)
    expect(data[0].selectors[0].pattern).toBe('target-person')
  })

  it('GET /api/selectors/active returns empty when no case active', async () => {
    const case1 = createCase({ name: 'Some Case' })
    createSelector({ caseId: case1.id, pattern: 'some-pattern' })

    // Don't activate any case
    const res = await fetch(`${baseUrl}/api/selectors/active`)
    const data = await res.json()
    expect(data).toEqual([])
  })
})
