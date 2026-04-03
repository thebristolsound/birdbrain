import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  initDatabase,
  closeDatabase,
  createCase,
  updateCase,
  listCaptures,
  listSelectors,
  getSelectorMatchCounts
} from '@main/services/database'
import { initStorage } from '@main/services/storage'
import { initSettings, updateSettings } from '@main/services/settings'
import { startCaptureServer, stopCaptureServer, getSessionState, resetSessionState } from '@main/services/captureServer'

let nextPort = 19846

describe('captureServer', () => {
  let tempDir: string
  let baseUrl: string

  beforeEach(async () => {
    const port = nextPort++
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-server-test-'))
    initDatabase(':memory:')
    initStorage(join(tempDir, 'captures'))
    initSettings(tempDir)
    resetSessionState()
    baseUrl = `http://127.0.0.1:${port}`
    await startCaptureServer(port)
  })

  afterEach(async () => {
    await stopCaptureServer()
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('GET /api/status returns running state', async () => {
    const res = await fetch(`${baseUrl}/api/status`)
    const data = await res.json()
    expect(data.running).toBe(true)
    expect(data.activeCase).toBeNull()
    expect(data.sessionActive).toBe(false)
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
    const res = await fetch(`${baseUrl}/api/cases/${testCase.id}/activate`, { method: 'POST' })
    const data = await res.json()
    expect(data.status).toBe('ok')
    expect(data.case.name).toBe('Active Case')

    const state = getSessionState()
    expect(state.activeCaseId).toBe(testCase.id)
  })

  it('POST /api/cases/:id/activate returns 404 for unknown case', async () => {
    const res = await fetch(`${baseUrl}/api/cases/nonexistent/activate`, { method: 'POST' })
    expect(res.status).toBe(404)
  })

  it('POST /api/session/start fails without active case', async () => {
    const res = await fetch(`${baseUrl}/api/session/start`, { method: 'POST' })
    expect(res.status).toBe(400)
  })

  it('POST /api/session/start and /stop manage session state', async () => {
    const testCase = createCase({ name: 'Session Test' })
    await fetch(`${baseUrl}/api/cases/${testCase.id}/activate`, { method: 'POST' })

    const startRes = await fetch(`${baseUrl}/api/session/start`, { method: 'POST' })
    const startData = await startRes.json()
    expect(startData.sessionActive).toBe(true)

    const statusRes = await fetch(`${baseUrl}/api/status`)
    const statusData = await statusRes.json()
    expect(statusData.sessionActive).toBe(true)

    const stopRes = await fetch(`${baseUrl}/api/session/stop`, { method: 'POST' })
    const stopData = await stopRes.json()
    expect(stopData.sessionActive).toBe(false)
  })

  // --- Unified capture endpoint tests ---

  it('source=auto stores capture when session active', async () => {
    const testCase = createCase({ name: 'Capture Test' })
    await fetch(`${baseUrl}/api/cases/${testCase.id}/activate`, { method: 'POST' })
    await fetch(`${baseUrl}/api/session/start`, { method: 'POST' })

    const res = await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'auto',
        url: 'https://example.com',
        title: 'Example Page',
        html: '<html><body>Hello World</body></html>',
        timestamp: new Date().toISOString(),
        textContent: 'Hello World'
      })
    })

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
    await fetch(`${baseUrl}/api/cases/${testCase.id}/activate`, { method: 'POST' })

    const res = await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'auto',
        url: 'https://example.com',
        html: '<html>test</html>'
      })
    })
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('session')
  })

  it('source=auto rejects without active case', async () => {
    const res = await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'auto',
        url: 'https://example.com',
        html: '<html>test</html>'
      })
    })
    expect(res.status).toBe(400)
  })

  it('source=auto increments capture count', async () => {
    const testCase = createCase({ name: 'Count Test' })
    await fetch(`${baseUrl}/api/cases/${testCase.id}/activate`, { method: 'POST' })
    await fetch(`${baseUrl}/api/session/start`, { method: 'POST' })

    await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'auto',
        url: 'https://a.com',
        title: 'A',
        html: '<html>a</html>'
      })
    })

    await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'auto',
        url: 'https://b.com',
        title: 'B',
        html: '<html>b</html>'
      })
    })

    const state = getSessionState()
    expect(state.captureCount).toBe(2)
  })

  it('source=manual stores capture without active session', async () => {
    const testCase = createCase({ name: 'Manual Test' })

    const res = await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'manual',
        caseId: testCase.id,
        url: 'https://example.com/manual',
        title: 'Manual Page',
        html: '<html><body>Manual capture</body></html>',
        timestamp: new Date().toISOString(),
        textContent: 'Manual capture'
      })
    })

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
    const res = await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'manual',
        url: 'https://example.com',
        html: '<html>test</html>'
      })
    })
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('caseId')
  })

  it('source=manual returns 404 for unknown case', async () => {
    const res = await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'manual',
        caseId: 'nonexistent-id',
        url: 'https://example.com',
        html: '<html>test</html>'
      })
    })
    expect(res.status).toBe(404)
  })

  it('source=manual returns 400 for archived case', async () => {
    const testCase = createCase({ name: 'Archived Case' })
    updateCase({ id: testCase.id, archived: true })

    const res = await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'manual',
        caseId: testCase.id,
        url: 'https://example.com',
        html: '<html>test</html>'
      })
    })
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('archived')
  })

  it('source=selector requires caseId and matchedSelectors', async () => {
    const testCase = createCase({ name: 'Selector Test' })

    // Missing caseId
    const res1 = await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'selector',
        url: 'https://example.com',
        html: '<html>test</html>',
        matchedSelectors: ['h1']
      })
    })
    expect(res1.status).toBe(400)

    // Missing matchedSelectors
    const res2 = await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'selector',
        caseId: testCase.id,
        url: 'https://example.com',
        html: '<html>test</html>'
      })
    })
    expect(res2.status).toBe(400)
    const data2 = await res2.json()
    expect(data2.error).toContain('matchedSelectors')
  })

  it('source=selector stores capture', async () => {
    const testCase = createCase({ name: 'Selector Capture' })

    const res = await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'selector',
        caseId: testCase.id,
        url: 'https://example.com/selector',
        title: 'Selector Page',
        html: '<html><body>Selector content</body></html>',
        matchedSelectors: ['h1', '.article'],
        textContent: 'Selector content'
      })
    })

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

  it('rejects missing url or html', async () => {
    const testCase = createCase({ name: 'Validation Test' })
    await fetch(`${baseUrl}/api/cases/${testCase.id}/activate`, { method: 'POST' })
    await fetch(`${baseUrl}/api/session/start`, { method: 'POST' })

    const res = await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'auto',
        url: 'https://example.com'
      })
    })
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('url, html')
  })

  it('returns 400 for unknown source value', async () => {
    const testCase = createCase({ name: 'Unknown Source Test' })
    await fetch(`${baseUrl}/api/cases/${testCase.id}/activate`, { method: 'POST' })
    await fetch(`${baseUrl}/api/session/start`, { method: 'POST' })

    const res = await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'typoed-source',
        url: 'https://example.com',
        html: '<html>test</html>'
      })
    })
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('Invalid source')
  })

  it('defaults source to auto when not provided (backwards compat)', async () => {
    const testCase = createCase({ name: 'Default Source' })
    await fetch(`${baseUrl}/api/cases/${testCase.id}/activate`, { method: 'POST' })
    await fetch(`${baseUrl}/api/session/start`, { method: 'POST' })

    const res = await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://example.com/default',
        title: 'Default',
        html: '<html>default</html>'
      })
    })

    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.source).toBe('auto')
    expect(data.status).toBe('ok')

    const state = getSessionState()
    expect(state.captureCount).toBe(1)
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
  })

  // --- Blacklist tests ---

  it('source=auto blocks blacklisted URL with 403', async () => {
    const testCase = createCase({ name: 'Blacklist Test' })
    await fetch(`${baseUrl}/api/cases/${testCase.id}/activate`, { method: 'POST' })
    await fetch(`${baseUrl}/api/session/start`, { method: 'POST' })

    updateSettings({ ignoredUrlPatterns: ['facebook.com'] })

    const res = await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'auto',
        url: 'https://facebook.com/some-page',
        title: 'Facebook',
        html: '<html>fb</html>'
      })
    })

    expect(res.status).toBe(403)
    const data = await res.json()
    expect(data.pattern).toBe('facebook.com')
  })

  it('source=auto allows non-blacklisted URL', async () => {
    const testCase = createCase({ name: 'Allow Test' })
    await fetch(`${baseUrl}/api/cases/${testCase.id}/activate`, { method: 'POST' })
    await fetch(`${baseUrl}/api/session/start`, { method: 'POST' })

    updateSettings({ ignoredUrlPatterns: ['facebook.com'] })

    const res = await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'auto',
        url: 'https://example.com',
        title: 'Example',
        html: '<html>example</html>'
      })
    })

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.status).toBe('ok')
  })

  it('source=manual blocks blacklisted URL with 403', async () => {
    const testCase = createCase({ name: 'Manual Blacklist' })
    updateSettings({ ignoredUrlPatterns: ['blocked-site.com'] })

    const res = await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'manual',
        caseId: testCase.id,
        url: 'https://blocked-site.com/page',
        html: '<html>blocked</html>'
      })
    })

    expect(res.status).toBe(403)
  })

  it('source=selector blocks blacklisted URL with 403', async () => {
    const testCase = createCase({ name: 'Selector Blacklist' })
    updateSettings({ ignoredUrlPatterns: ['spam.org'] })

    const res = await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'selector',
        caseId: testCase.id,
        url: 'https://spam.org/content',
        title: 'Spam',
        html: '<html>spam</html>',
        matchedSelectors: ['div']
      })
    })

    expect(res.status).toBe(403)
  })

  it('blacklist supports regex patterns', async () => {
    const testCase = createCase({ name: 'Regex Blacklist' })
    await fetch(`${baseUrl}/api/cases/${testCase.id}/activate`, { method: 'POST' })
    await fetch(`${baseUrl}/api/session/start`, { method: 'POST' })

    updateSettings({ ignoredUrlPatterns: ['/.*\\.pdf$/i'] })

    const blockedRes = await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'auto',
        url: 'https://example.com/document.pdf',
        title: 'PDF',
        html: '<html>pdf</html>'
      })
    })
    expect(blockedRes.status).toBe(403)

    const allowedRes = await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'auto',
        url: 'https://example.com/page.html',
        title: 'HTML',
        html: '<html>html</html>'
      })
    })
    expect(allowedRes.status).toBe(200)
  })

  it('blacklist supports glob/wildcard patterns', async () => {
    const testCase = createCase({ name: 'Glob Blacklist' })
    await fetch(`${baseUrl}/api/cases/${testCase.id}/activate`, { method: 'POST' })
    await fetch(`${baseUrl}/api/session/start`, { method: 'POST' })

    updateSettings({ ignoredUrlPatterns: ['*.facebook.com*'] })

    const blockedRes = await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'auto',
        url: 'https://www.facebook.com/some/page',
        title: 'FB',
        html: '<html>fb</html>'
      })
    })
    expect(blockedRes.status).toBe(403)

    const allowedRes = await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'auto',
        url: 'https://example.com/page',
        title: 'Example',
        html: '<html>ok</html>'
      })
    })
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
    await fetch(`${baseUrl}/api/cases/${testCase.id}/activate`, { method: 'POST' })
    await fetch(`${baseUrl}/api/session/start`, { method: 'POST' })

    updateSettings({ ignoredUrlPatterns: ['example.com/user?'] })

    const blockedRes = await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'auto',
        url: 'https://example.com/userA',
        title: 'User A',
        html: '<html>a</html>'
      })
    })
    expect(blockedRes.status).toBe(403)

    const allowedRes = await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'auto',
        url: 'https://example.com/users',
        title: 'Users',
        html: '<html>users</html>'
      })
    })
    // 'users' ends with 's' which matches the '?' — still blocked
    expect(allowedRes.status).toBe(403)
  })

  // --- Manual capture dedup tests ---

  function manualCaptureBody(caseId: string, url = 'https://example.com/page', html = '<html>test</html>') {
    return JSON.stringify({
      source: 'manual',
      caseId,
      url,
      title: 'Test',
      html,
      timestamp: new Date().toISOString()
    })
  }

  it('source=manual rejects duplicate within 5s window', async () => {
    const testCase = createCase({ name: 'Dedup Test' })
    const headers = { 'Content-Type': 'application/json' }
    const body = manualCaptureBody(testCase.id)

    const first = await fetch(`${baseUrl}/api/captures`, { method: 'POST', headers, body })
    expect(first.status).toBe(200)

    const second = await fetch(`${baseUrl}/api/captures`, { method: 'POST', headers, body })
    expect(second.status).toBe(409)
    const data = await second.json()
    expect(data.error).toContain('Duplicate')

    const captures = listCaptures(testCase.id)
    expect(captures).toHaveLength(1)
  })

  it.skip('source=manual allows same URL after dedup window expires', async () => {
    const testCase = createCase({ name: 'Dedup Expiry' })
    const headers = { 'Content-Type': 'application/json' }
    const url = 'https://example.com/expiry-test'
    const body = manualCaptureBody(testCase.id, url)

    const first = await fetch(`${baseUrl}/api/captures`, { method: 'POST', headers, body })
    expect(first.status).toBe(200)

    // Advance time past the 5s window
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.advanceTimersByTime(6000)
    vi.useRealTimers()

    const second = await fetch(`${baseUrl}/api/captures`, { method: 'POST', headers, body })
    expect(second.status).toBe(200)

    const captures = listCaptures(testCase.id)
    expect(captures).toHaveLength(2)
  })

  it('source=manual allows different URLs in same case within window', async () => {
    const testCase = createCase({ name: 'Dedup Diff URL' })
    const headers = { 'Content-Type': 'application/json' }

    const first = await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      headers,
      body: manualCaptureBody(testCase.id, 'https://example.com/page-a')
    })
    expect(first.status).toBe(200)

    const second = await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      headers,
      body: manualCaptureBody(testCase.id, 'https://example.com/page-b')
    })
    expect(second.status).toBe(200)

    const captures = listCaptures(testCase.id)
    expect(captures).toHaveLength(2)
  })

  it('source=manual allows same URL in different cases within window', async () => {
    const caseA = createCase({ name: 'Case A' })
    const caseB = createCase({ name: 'Case B' })
    const headers = { 'Content-Type': 'application/json' }
    const url = 'https://example.com/shared-page'

    const first = await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      headers,
      body: manualCaptureBody(caseA.id, url)
    })
    expect(first.status).toBe(200)

    const second = await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      headers,
      body: manualCaptureBody(caseB.id, url)
    })
    expect(second.status).toBe(200)
  })

  it('source=auto is not affected by manual dedup', async () => {
    const testCase = createCase({ name: 'Auto No Dedup' })
    await fetch(`${baseUrl}/api/cases/${testCase.id}/activate`, { method: 'POST' })
    await fetch(`${baseUrl}/api/session/start`, { method: 'POST' })
    const headers = { 'Content-Type': 'application/json' }
    const url = 'https://example.com/auto-page'
    const autoBody = JSON.stringify({
      source: 'auto',
      url,
      title: 'Auto',
      html: '<html>auto</html>'
    })

    const first = await fetch(`${baseUrl}/api/captures`, { method: 'POST', headers, body: autoBody })
    expect(first.status).toBe(200)

    const second = await fetch(`${baseUrl}/api/captures`, { method: 'POST', headers, body: autoBody })
    expect(second.status).toBe(200)

    const captures = listCaptures(testCase.id)
    expect(captures).toHaveLength(2)
  })

  it('source=selector is not affected by manual dedup', async () => {
    const testCase = createCase({ name: 'Selector No Dedup' })
    const headers = { 'Content-Type': 'application/json' }
    const selectorBody = JSON.stringify({
      source: 'selector',
      caseId: testCase.id,
      url: 'https://example.com/selector-page',
      title: 'Selector',
      html: '<html>selector</html>',
      matchedSelectors: ['h1']
    })

    const first = await fetch(`${baseUrl}/api/captures`, { method: 'POST', headers, body: selectorBody })
    expect(first.status).toBe(200)

    const second = await fetch(`${baseUrl}/api/captures`, { method: 'POST', headers, body: selectorBody })
    expect(second.status).toBe(200)

    const captures = listCaptures(testCase.id)
    expect(captures).toHaveLength(2)
  })

  it('manual dedup state is cleared by resetSessionState', async () => {
    const testCase = createCase({ name: 'Dedup Reset' })
    const headers = { 'Content-Type': 'application/json' }
    const body = manualCaptureBody(testCase.id)

    const first = await fetch(`${baseUrl}/api/captures`, { method: 'POST', headers, body })
    expect(first.status).toBe(200)

    // Without reset, this would be 409
    resetSessionState()

    const second = await fetch(`${baseUrl}/api/captures`, { method: 'POST', headers, body })
    expect(second.status).toBe(200)
  })

  // --- POST /api/selectors (create selector from extension) ---

  async function activateSessionForCase(caseId: string) {
    await fetch(`${baseUrl}/api/cases/${caseId}/activate`, { method: 'POST' })
    await fetch(`${baseUrl}/api/session/start`, { method: 'POST' })
  }

  it('POST /api/selectors creates a literal selector', async () => {
    const testCase = createCase({ name: 'Selector Create Test' })
    await activateSessionForCase(testCase.id)

    const res = await fetch(`${baseUrl}/api/selectors`, {
      method: 'POST',
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

  it('POST /api/selectors returns 400 without active session', async () => {
    const testCase = createCase({ name: 'No Session Selector' })

    const res = await fetch(`${baseUrl}/api/selectors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caseId: testCase.id,
        pattern: 'test pattern'
      })
    })

    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('session')
  })

  it('POST /api/selectors returns 400 for empty pattern', async () => {
    const testCase = createCase({ name: 'Empty Pattern' })
    await activateSessionForCase(testCase.id)

    const res = await fetch(`${baseUrl}/api/selectors`, {
      method: 'POST',
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

    const res = await fetch(`${baseUrl}/api/selectors`, {
      method: 'POST',
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

    const res = await fetch(`${baseUrl}/api/selectors`, {
      method: 'POST',
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

    const res = await fetch(`${baseUrl}/api/selectors`, {
      method: 'POST',
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

    const res = await fetch(`${baseUrl}/api/selectors`, {
      method: 'POST',
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

    const res = await fetch(`${baseUrl}/api/selectors`, {
      method: 'POST',
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
    await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'auto',
        url: 'https://example.com/page1',
        title: 'Page 1',
        html: '<html><body>suspicious transaction detected here</body></html>',
        timestamp: new Date().toISOString(),
        textContent: 'suspicious transaction detected here'
      })
    })

    // Create another capture without the pattern
    await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'auto',
        url: 'https://example.com/page2',
        title: 'Page 2',
        html: '<html><body>nothing interesting</body></html>',
        timestamp: new Date().toISOString(),
        textContent: 'nothing interesting'
      })
    })

    // Now create a selector that matches the first capture
    const res = await fetch(`${baseUrl}/api/selectors`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caseId: testCase.id,
        pattern: 'suspicious transaction'
      })
    })

    expect(res.status).toBe(200)
    const data = await res.json()

    // Wait for setImmediate to complete retroactive matching
    await new Promise((resolve) => setTimeout(resolve, 50))

    // Check that the selector matched the first capture
    const matchCounts = getSelectorMatchCounts(testCase.id)
    expect(matchCounts[data.selector.id]).toBe(1)
  })

  it('POST /api/selectors creates selector without label', async () => {
    const testCase = createCase({ name: 'No Label' })
    await activateSessionForCase(testCase.id)

    const res = await fetch(`${baseUrl}/api/selectors`, {
      method: 'POST',
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
})
