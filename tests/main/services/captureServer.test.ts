import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { initDatabase, closeDatabase, createCase, updateCase, listCaptures, getCapture, getEntitiesByCapture } from '@main/services/database'
import { readCaptureFile } from '@main/services/storage'
import { initStorage } from '@main/services/storage'
import { initSettings, updateSettings } from '@main/services/settings'
import { startCaptureServer, stopCaptureServer, getSessionState, resetSessionState, invalidateEntityTypeCache } from '@main/services/captureServer'

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
    invalidateEntityTypeCache()
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

  it('POST /api/captures stores a capture', async () => {
    const testCase = createCase({ name: 'Capture Test' })
    await fetch(`${baseUrl}/api/cases/${testCase.id}/activate`, { method: 'POST' })
    await fetch(`${baseUrl}/api/session/start`, { method: 'POST' })

    const res = await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
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

    // Verify capture was stored in DB
    const captures = listCaptures(testCase.id)
    expect(captures).toHaveLength(1)
    expect(captures[0].url).toBe('https://example.com')
  })

  it('POST /api/captures rejects without active case', async () => {
    const res = await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://example.com',
        html: '<html>test</html>'
      })
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/captures increments capture count', async () => {
    const testCase = createCase({ name: 'Count Test' })
    await fetch(`${baseUrl}/api/cases/${testCase.id}/activate`, { method: 'POST' })
    await fetch(`${baseUrl}/api/session/start`, { method: 'POST' })

    await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://a.com',
        title: 'A',
        html: '<html>a</html>'
      })
    })

    await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://b.com',
        title: 'B',
        html: '<html>b</html>'
      })
    })

    const state = getSessionState()
    expect(state.captureCount).toBe(2)
  })

  // --- Stream A: Status + Manual Capture ---

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

  it('POST /api/captures/manual stores capture without active session', async () => {
    const testCase = createCase({ name: 'Manual Test' })

    // No session started — manual capture should still work
    const res = await fetch(`${baseUrl}/api/captures/manual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
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

    // Verify in DB
    const captures = listCaptures(testCase.id)
    expect(captures).toHaveLength(1)
    expect(captures[0].url).toBe('https://example.com/manual')

    // Should NOT increment session capture count
    const state = getSessionState()
    expect(state.captureCount).toBe(0)
  })

  it('POST /api/captures/manual returns 400 without caseId', async () => {
    const res = await fetch(`${baseUrl}/api/captures/manual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://example.com',
        html: '<html>test</html>'
      })
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/captures/manual returns 404 for unknown case', async () => {
    const res = await fetch(`${baseUrl}/api/captures/manual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caseId: 'nonexistent-id',
        url: 'https://example.com',
        html: '<html>test</html>'
      })
    })
    expect(res.status).toBe(404)
  })

  // --- Stream B: Domain Blacklist ---

  it('POST /api/captures blocks blacklisted URL with 403', async () => {
    const testCase = createCase({ name: 'Blacklist Test' })
    await fetch(`${baseUrl}/api/cases/${testCase.id}/activate`, { method: 'POST' })
    await fetch(`${baseUrl}/api/session/start`, { method: 'POST' })

    updateSettings({ ignoredUrlPatterns: ['facebook.com'] })

    const res = await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://facebook.com/some-page',
        title: 'Facebook',
        html: '<html>fb</html>'
      })
    })

    expect(res.status).toBe(403)
    const data = await res.json()
    expect(data.pattern).toBe('facebook.com')
  })

  it('POST /api/captures allows non-blacklisted URL', async () => {
    const testCase = createCase({ name: 'Allow Test' })
    await fetch(`${baseUrl}/api/cases/${testCase.id}/activate`, { method: 'POST' })
    await fetch(`${baseUrl}/api/session/start`, { method: 'POST' })

    updateSettings({ ignoredUrlPatterns: ['facebook.com'] })

    const res = await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://example.com',
        title: 'Example',
        html: '<html>example</html>'
      })
    })

    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.status).toBe('ok')
  })

  it('POST /api/captures/manual blocks blacklisted URL with 403', async () => {
    const testCase = createCase({ name: 'Manual Blacklist' })
    updateSettings({ ignoredUrlPatterns: ['blocked-site.com'] })

    const res = await fetch(`${baseUrl}/api/captures/manual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caseId: testCase.id,
        url: 'https://blocked-site.com/page',
        html: '<html>blocked</html>'
      })
    })

    expect(res.status).toBe(403)
  })

  it('POST /api/captures/selector blocks blacklisted URL with 403', async () => {
    const testCase = createCase({ name: 'Selector Blacklist' })
    updateSettings({ ignoredUrlPatterns: ['spam.org'] })

    const res = await fetch(`${baseUrl}/api/captures/selector`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caseId: testCase.id,
        url: 'https://spam.org/content',
        title: 'Spam',
        html: '<html>spam</html>'
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
        url: 'https://example.com/users',
        title: 'Users',
        html: '<html>users</html>'
      })
    })
    // 'users' ends with 's' which matches the '?' — still blocked
    expect(allowedRes.status).toBe(403)
  })

  // --- PATCH /api/captures/:id/html ---

  it('PATCH /api/captures/:id/html updates stored HTML and hash', async () => {
    const testCase = createCase({ name: 'Patch Test' })

    // Create a capture first via manual endpoint
    const createRes = await fetch(`${baseUrl}/api/captures/manual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caseId: testCase.id,
        url: 'https://example.com/patch',
        title: 'Patch Page',
        html: '<html><body>Original</body></html>',
        timestamp: new Date().toISOString()
      })
    })
    const createData = await createRes.json()
    const captureId = createData.captureId
    const originalHash = createData.hash

    // Patch the HTML
    const patchRes = await fetch(`${baseUrl}/api/captures/${captureId}/html`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        html: '<html><body>Updated freeze-dried</body></html>',
        caseId: testCase.id
      })
    })

    expect(patchRes.status).toBe(200)
    const patchData = await patchRes.json()
    expect(patchData.status).toBe('ok')
    expect(patchData.captureId).toBe(captureId)
    expect(patchData.hash).not.toBe(originalHash)

    // Verify file on disk was updated
    const content = readCaptureFile(testCase.id, captureId, 'html')
    expect(content?.toString()).toBe('<html><body>Updated freeze-dried</body></html>')

    // Verify hash in DB was updated
    const capture = getCapture(captureId)
    expect(capture?.hash).toBe(patchData.hash)
  })

  it('PATCH /api/captures/:id/html returns 404 for unknown capture', async () => {
    const res = await fetch(`${baseUrl}/api/captures/nonexistent-id/html`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        html: '<html>test</html>'
      })
    })
    expect(res.status).toBe(404)
  })

  it('PATCH /api/captures/:id/html returns 400 when caseId does not match', async () => {
    const testCase = createCase({ name: 'Mismatch Test' })

    const createRes = await fetch(`${baseUrl}/api/captures/manual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caseId: testCase.id,
        url: 'https://example.com/mismatch',
        title: 'Mismatch',
        html: '<html>original</html>',
        timestamp: new Date().toISOString()
      })
    })
    const createData = await createRes.json()

    const res = await fetch(`${baseUrl}/api/captures/${createData.captureId}/html`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        html: '<html>updated</html>',
        caseId: 'wrong-case-id'
      })
    })
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('does not match')
  })

  it('PATCH /api/captures/:id/html returns 400 without html field', async () => {
    const testCase = createCase({ name: 'No HTML Test' })

    const createRes = await fetch(`${baseUrl}/api/captures/manual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caseId: testCase.id,
        url: 'https://example.com/nohtml',
        title: 'No HTML',
        html: '<html>original</html>',
        timestamp: new Date().toISOString()
      })
    })
    const createData = await createRes.json()

    const res = await fetch(`${baseUrl}/api/captures/${createData.captureId}/html`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caseId: testCase.id
      })
    })
    expect(res.status).toBe(400)
  })

  it('PATCH /api/captures/:id/html works without caseId in body (derives from DB)', async () => {
    const testCase = createCase({ name: 'No CaseId Body Test' })

    const createRes = await fetch(`${baseUrl}/api/captures/manual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caseId: testCase.id,
        url: 'https://example.com/nocaseid',
        title: 'No CaseId',
        html: '<html>original</html>',
        timestamp: new Date().toISOString()
      })
    })
    const createData = await createRes.json()

    const res = await fetch(`${baseUrl}/api/captures/${createData.captureId}/html`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        html: '<html>updated without caseId</html>'
      })
    })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.status).toBe('ok')

    // Verify file was updated correctly
    const content = readCaptureFile(testCase.id, createData.captureId, 'html')
    expect(content?.toString()).toBe('<html>updated without caseId</html>')
  })

  // --- Selector capture endpoint ---

  it('POST /api/captures/selector stores a capture', async () => {
    const testCase = createCase({ name: 'Selector Test' })

    const res = await fetch(`${baseUrl}/api/captures/selector`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caseId: testCase.id,
        url: 'https://example.com/selector',
        title: 'Selector Page',
        html: '<html><body>Selector match</body></html>',
        timestamp: new Date().toISOString(),
        textContent: 'Selector match'
      })
    })

    const data = await res.json()
    expect(res.status).toBe(200)
    expect(data.status).toBe('ok')
    expect(data.captureId).toBeDefined()
    expect(data.hash).toHaveLength(64)

    // Verify in DB
    const captures = listCaptures(testCase.id)
    expect(captures).toHaveLength(1)
    expect(captures[0].url).toBe('https://example.com/selector')
  })

  it('POST /api/captures/selector returns 400 without caseId', async () => {
    const res = await fetch(`${baseUrl}/api/captures/selector`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://example.com',
        html: '<html>test</html>'
      })
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/captures/selector returns 400 without url', async () => {
    const testCase = createCase({ name: 'Selector No URL' })
    const res = await fetch(`${baseUrl}/api/captures/selector`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caseId: testCase.id,
        html: '<html>test</html>'
      })
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/captures/selector returns 400 without html', async () => {
    const testCase = createCase({ name: 'Selector No HTML' })
    const res = await fetch(`${baseUrl}/api/captures/selector`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caseId: testCase.id,
        url: 'https://example.com'
      })
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/captures/selector does not increment session capture count', async () => {
    const testCase = createCase({ name: 'Selector Count' })
    await fetch(`${baseUrl}/api/cases/${testCase.id}/activate`, { method: 'POST' })
    await fetch(`${baseUrl}/api/session/start`, { method: 'POST' })

    await fetch(`${baseUrl}/api/captures/selector`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caseId: testCase.id,
        url: 'https://example.com/sel',
        html: '<html>sel</html>'
      })
    })

    const state = getSessionState()
    expect(state.captureCount).toBe(0)
  })

  // --- Manual capture: archived case ---

  it('POST /api/captures/manual returns 400 for archived case', async () => {
    const testCase = createCase({ name: 'Archive Test' })
    updateCase({ id: testCase.id, archived: true })

    const res = await fetch(`${baseUrl}/api/captures/manual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caseId: testCase.id,
        url: 'https://example.com/archived',
        html: '<html>archived</html>'
      })
    })
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('archived')
  })

  // --- Status endpoint: includeCases query param ---

  it('GET /api/status?includeCases=0 omits cases list', async () => {
    createCase({ name: 'Hidden Case' })

    const res = await fetch(`${baseUrl}/api/status?includeCases=0`)
    const data = await res.json()
    expect(data.running).toBe(true)
    expect(data.cases).toEqual([])
  })

  it('GET /api/status?includeCases=false omits cases list', async () => {
    createCase({ name: 'Hidden Case' })

    const res = await fetch(`${baseUrl}/api/status?includeCases=false`)
    const data = await res.json()
    expect(data.cases).toEqual([])
  })

  it('GET /api/status?includeCases=1 includes cases list', async () => {
    createCase({ name: 'Visible Case' })

    const res = await fetch(`${baseUrl}/api/status?includeCases=1`)
    const data = await res.json()
    expect(data.cases).toHaveLength(1)
    expect(data.cases[0].name).toBe('Visible Case')
  })

  it('GET /api/status without includeCases param includes cases by default', async () => {
    createCase({ name: 'Default Case' })

    const res = await fetch(`${baseUrl}/api/status`)
    const data = await res.json()
    expect(data.cases).toHaveLength(1)
  })

  // --- processCapture: title defaults to url ---

  it('POST /api/captures uses url as title when title is omitted', async () => {
    const testCase = createCase({ name: 'No Title Test' })
    await fetch(`${baseUrl}/api/cases/${testCase.id}/activate`, { method: 'POST' })
    await fetch(`${baseUrl}/api/session/start`, { method: 'POST' })

    await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: 'https://example.com/no-title',
        html: '<html>no title</html>'
      })
    })

    const captures = listCaptures(testCase.id)
    expect(captures).toHaveLength(1)
    expect(captures[0].title).toBe('https://example.com/no-title')
  })

  // --- processCapture: consistent hash across endpoints ---

  it('all capture endpoints produce consistent hashes for identical HTML', async () => {
    const testCase = createCase({ name: 'Hash Consistency' })
    await fetch(`${baseUrl}/api/cases/${testCase.id}/activate`, { method: 'POST' })
    await fetch(`${baseUrl}/api/session/start`, { method: 'POST' })

    const html = '<html><body>identical content</body></html>'

    const autoRes = await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://a.com', html })
    })
    const autoData = await autoRes.json()

    const selectorRes = await fetch(`${baseUrl}/api/captures/selector`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ caseId: testCase.id, url: 'https://b.com', html })
    })
    const selectorData = await selectorRes.json()

    const manualRes = await fetch(`${baseUrl}/api/captures/manual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ caseId: testCase.id, url: 'https://c.com', html })
    })
    const manualData = await manualRes.json()

    expect(autoData.hash).toBe(selectorData.hash)
    expect(selectorData.hash).toBe(manualData.hash)
  })

  // --- Entity type cache invalidation ---

  it('invalidateEntityTypeCache allows settings changes to take effect', async () => {
    const testCase = createCase({ name: 'Cache Invalidation' })

    // Enable only email extraction initially
    updateSettings({ enabledEntityTypes: ['email'] })

    // First capture with email — triggers cache population
    const res1 = await fetch(`${baseUrl}/api/captures/manual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caseId: testCase.id,
        url: 'https://example.com/page1',
        html: '<html>page1</html>',
        textContent: 'Contact us at test@example.com or 192.168.1.1'
      })
    })
    const data1 = await res1.json()

    // Wait for setImmediate post-capture work
    await new Promise(resolve => setTimeout(resolve, 100))

    const entities1 = getEntitiesByCapture(data1.captureId)
    const emailEntities1 = entities1.filter(e => e.type === 'email')
    const ipEntities1 = entities1.filter(e => e.type === 'ip_address')
    expect(emailEntities1.length).toBeGreaterThan(0)
    expect(ipEntities1.length).toBe(0)

    // Change settings to also include ip_address, then invalidate cache
    updateSettings({ enabledEntityTypes: ['email', 'ip_address'] })
    invalidateEntityTypeCache()

    // Second capture should now extract IP addresses too
    const res2 = await fetch(`${baseUrl}/api/captures/manual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caseId: testCase.id,
        url: 'https://example.com/page2',
        html: '<html>page2</html>',
        textContent: 'Contact us at test2@example.com or 10.0.0.1'
      })
    })
    const data2 = await res2.json()

    await new Promise(resolve => setTimeout(resolve, 100))

    const entities2 = getEntitiesByCapture(data2.captureId)
    const ipEntities2 = entities2.filter(e => e.type === 'ip_address')
    expect(ipEntities2.length).toBeGreaterThan(0)
  })

  // --- POST /api/captures missing fields ---

  it('POST /api/captures returns 400 without url', async () => {
    const testCase = createCase({ name: 'No URL' })
    await fetch(`${baseUrl}/api/cases/${testCase.id}/activate`, { method: 'POST' })
    await fetch(`${baseUrl}/api/session/start`, { method: 'POST' })

    const res = await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ html: '<html>test</html>' })
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/captures returns 400 without html', async () => {
    const testCase = createCase({ name: 'No HTML' })
    await fetch(`${baseUrl}/api/cases/${testCase.id}/activate`, { method: 'POST' })
    await fetch(`${baseUrl}/api/session/start`, { method: 'POST' })

    const res = await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com' })
    })
    expect(res.status).toBe(400)
  })

  // --- POST /api/captures/manual missing url/html ---

  it('POST /api/captures/manual returns 400 without url', async () => {
    const testCase = createCase({ name: 'Manual No URL' })
    const res = await fetch(`${baseUrl}/api/captures/manual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caseId: testCase.id,
        html: '<html>test</html>'
      })
    })
    expect(res.status).toBe(400)
  })

  it('POST /api/captures/manual returns 400 without html', async () => {
    const testCase = createCase({ name: 'Manual No HTML' })
    const res = await fetch(`${baseUrl}/api/captures/manual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caseId: testCase.id,
        url: 'https://example.com'
      })
    })
    expect(res.status).toBe(400)
  })
})
