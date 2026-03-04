import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { initDatabase, closeDatabase, createCase, listCaptures } from '@main/services/database'
import { initStorage } from '@main/services/storage'
import { startCaptureServer, stopCaptureServer, getSessionState, resetSessionState } from '@main/services/captureServer'

const TEST_PORT = 19846

describe('captureServer', () => {
  let tempDir: string
  let baseUrl: string

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-server-test-'))
    initDatabase(':memory:')
    initStorage(join(tempDir, 'captures'))
    resetSessionState()
    baseUrl = `http://127.0.0.1:${TEST_PORT}`
    await startCaptureServer(TEST_PORT)
  })

  afterEach(() => {
    stopCaptureServer()
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
})
