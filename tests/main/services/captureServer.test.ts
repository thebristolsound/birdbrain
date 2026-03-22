import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { initDatabase, closeDatabase, createCase, updateCase, listCases, listCaptures, getCapture } from '@main/services/database'
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
})
