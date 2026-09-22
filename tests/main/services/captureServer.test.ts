import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { createServer } from 'node:http'
import { join } from 'path'
import { tmpdir } from 'os'
import { initDatabase, closeDatabase } from '@main/services/db/core'
import { createCase, listCases, setAutoCapturePolicy, updateCase } from '@main/services/db/caseRepo'
import { listCaptures } from '@main/services/db/captureRepo'
import { createTag, getTagsForCapture, listTags } from '@main/services/db/tagRepo'
import * as tagRepo from '@main/services/db/tagRepo'
import { listNotes } from '@main/services/db/noteRepo'
import * as noteRepo from '@main/services/db/noteRepo'
import {
  createSelector,
  listSelectors,
  getSelectorMatchCounts
} from '@main/services/db/selectorRepo'
import { initStorage } from '@main/services/storage'
import { initSettings, updateSettings } from '@main/services/settings'
import { initInstallationId, resetInstallationId } from '@main/services/installationId'
import {
  CaptureServerBindError,
  getCaptureServerPort,
  startCaptureServer,
  stopCaptureServer
} from '@main/services/captureServer'
import { sanitizeError } from '@main/services/logSafe'
import { createCaptureLifecycle } from '@main/services/captureLifecycle'
import { matchCaseExclusion } from '@main/services/exclusionPolicy'
import { createSessionService, type SessionService } from '@main/services/session'
import { createSelectorLifecycle } from '@main/services/selectorLifecycle'
import { getManifestHead } from '@main/services/manifest'
import { MAX_SCREENSHOT_SIZE, MANIFEST_FILENAME } from '@shared/constants'

// Keep ingest hermetic: the corroboration-only TLS re-fetch (#123) would
// otherwise open a real socket to https://example.com on every captured upload.
vi.mock('@main/services/tlsCertChain', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@main/services/tlsCertChain')>()
  return { ...actual, fetchCertChain: vi.fn(async () => null) }
})

let nextPort = 19846
let sessionService: SessionService
const TEST_TOKEN = 'test-server-token'

// The server's JSON payloads are ad-hoc shapes asserted field by field, and
// undici types Response.json() as unknown. Funnel every read through one
// loosely-keyed helper rather than casting at 50 call sites.
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped HTTP payloads read by key in assertions
type JsonBody = Record<string, any>
const readJson = async (res: Response): Promise<JsonBody> => (await res.json()) as JsonBody

describe('captureServer', () => {
  let tempDir: string
  let baseUrl: string

  beforeEach(async () => {
    const port = nextPort++
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-server-test-'))
    await initDatabase(':memory:')
    initStorage(join(tempDir, 'captures'))
    initSettings(tempDir)
    // Default operator name set so existing tests pass; operator-gating tests override as needed
    updateSettings({ operatorName: 'Test Operator' })
    resetInstallationId()
    initInstallationId(tempDir)
    sessionService = createSessionService()
    baseUrl = `http://127.0.0.1:${port}`
    const selectorLifecycle = createSelectorLifecycle({ emitRematched: () => {} })
    // The lifecycle admits every route, so it shares the server's session:
    // 'auto' takes the Active Case from it and counts into it.
    const captureLifecycle = createCaptureLifecycle({ selectorLifecycle, sessionService })
    await startCaptureServer(
      { selectorLifecycle, captureLifecycle, token: TEST_TOKEN, sessionService },
      port
    )
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
    const data = await readJson(res)
    expect(data.running).toBe(true)
    expect(data.activeCase).toBeNull()
    expect(data.sessionActive).toBe(false)
  })

  it('GET /api/status exposes the app theme', async () => {
    updateSettings({ theme: 'light' })
    const light = await readJson(await fetch(`${baseUrl}/api/status`))
    expect(light.theme).toBe('light')

    updateSettings({ theme: 'dark' })
    const dark = await readJson(await fetch(`${baseUrl}/api/status`))
    expect(dark.theme).toBe('dark')
  })

  it('GET /api/status exposes serverToken to the extension origin', async () => {
    const res = await fetch(`${baseUrl}/api/status`, {
      headers: { Origin: 'chrome-extension://abcdef1234567890' }
    })
    const data = await readJson(res)
    expect(data.serverToken).toBe(TEST_TOKEN)
  })

  // #228: the renderer moved to IPC, so the dev-server origins that used to be
  // granted the token no longer are. Only the extension (and the origin-less
  // pairing fetch) may read it.
  it('GET /api/status omits serverToken for dev-server renderer origins', async () => {
    for (const origin of ['http://localhost:5173', 'http://127.0.0.1:5173']) {
      const res = await fetch(`${baseUrl}/api/status`, { headers: { Origin: origin } })
      const data = await readJson(res)
      expect(data.serverToken).toBeUndefined()
    }
  })

  it('GET /api/status omits serverToken for unknown origins', async () => {
    const res = await fetch(`${baseUrl}/api/status`, {
      headers: { Origin: 'https://evil.example.com' }
    })
    const data = await readJson(res)
    expect(data.serverToken).toBeUndefined()
  })

  it('GET /api/status does not update extensionLastSeen when Origin is not chrome-extension://', async () => {
    await fetch(`${baseUrl}/api/status`)
    expect(sessionService.snapshot().extensionLastSeen).toBe(0)

    await fetch(`${baseUrl}/api/status`, { headers: { Origin: 'https://evil.example.com' } })
    expect(sessionService.snapshot().extensionLastSeen).toBe(0)

    await fetch(`${baseUrl}/api/status`, { headers: { Origin: 'file:///index.html' } })
    expect(sessionService.snapshot().extensionLastSeen).toBe(0)
  })

  it('GET /api/status updates extensionLastSeen when Origin is chrome-extension://', async () => {
    expect(sessionService.snapshot().extensionLastSeen).toBe(0)
    await fetch(`${baseUrl}/api/status`, {
      headers: { Origin: 'chrome-extension://abcdef1234567890' }
    })
    expect(sessionService.snapshot().extensionLastSeen).toBeGreaterThan(0)
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
    const data = await readJson(res)
    expect(data).toEqual([])
  })

  it('GET /api/cases returns cases with capture counts', async () => {
    createCase({ name: 'Test Case' })
    const res = await fetch(`${baseUrl}/api/cases`)
    const data = await readJson(res)
    expect(data).toHaveLength(1)
    expect(data[0].name).toBe('Test Case')
    expect(data[0].captureCount).toBe(0)
  })

  it('POST /api/cases/:id/activate sets active case', async () => {
    const testCase = createCase({ name: 'Active Case' })
    const res = await serverPost(`/api/cases/${testCase.id}/activate`)
    const data = await readJson(res)
    expect(data.status).toBe('ok')
    expect(data.case.name).toBe('Active Case')

    const state = sessionService.snapshot()
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
    const startData = await readJson(startRes)
    expect(startData.sessionActive).toBe(true)

    const statusRes = await fetch(`${baseUrl}/api/status`)
    const statusData = await readJson(statusRes)
    expect(statusData.sessionActive).toBe(true)

    const stopRes = await serverPost('/api/session/stop')
    const stopData = await readJson(stopRes)
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

    const data = await readJson(res)
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
    const data = await readJson(res)
    expect(data.error).toContain('session')
  })

  it('source=auto rejects without active case', async () => {
    const res = await postCapture({
      source: 'auto',
      url: 'https://example.com'
    })
    expect(res.status).toBe(400)
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

    const data = await readJson(res)
    expect(res.status).toBe(200)
    expect(data.status).toBe('ok')
    expect(data.captureId).toBeDefined()
    expect(data.hash).toHaveLength(64)
    expect(data.source).toBe('manual')

    const captures = listCaptures(testCase.id)
    expect(captures).toHaveLength(1)
    expect(captures[0].url).toBe('https://example.com/manual')

    // Should NOT increment session capture count
    const state = sessionService.snapshot()
    expect(state.captureCount).toBe(0)
  })

  it('source=manual returns 400 without caseId', async () => {
    const res = await postCapture({
      source: 'manual',
      url: 'https://example.com'
    })
    expect(res.status).toBe(400)
    const data = await readJson(res)
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
    const data = await readJson(res)
    expect(data.error).toContain('archived')
  })

  it('source=selector requires caseId', async () => {
    // Missing caseId
    const res = await postCapture({
      source: 'selector',
      url: 'https://example.com'
    })
    expect(res.status).toBe(400)
    const data = await readJson(res)
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

    const data = await readJson(res)
    expect(res.status).toBe(200)
    expect(data.status).toBe('ok')
    expect(data.source).toBe('selector')

    const captures = listCaptures(testCase.id)
    expect(captures).toHaveLength(1)

    // Should NOT increment session capture count
    const state = sessionService.snapshot()
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
    const data = await readJson(res)
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
    const data = await readJson(res)
    expect(data.error).toContain('Invalid source')
  })

  it('answers 500 when the lifecycle reports a failed ingest', async () => {
    const testCase = createCase({ name: 'Failed Ingest' })
    // Rebind the server to a lifecycle whose admission fails — the injection
    // seam the server exposes for exactly this kind of test.
    await stopCaptureServer()
    const port = nextPort++
    baseUrl = `http://127.0.0.1:${port}`
    const selectorLifecycle = createSelectorLifecycle({ emitRematched: () => {} })
    const realLifecycle = createCaptureLifecycle({ selectorLifecycle, sessionService })
    const failingLifecycle = {
      ...realLifecycle,
      admit: async (): ReturnType<typeof realLifecycle.admit> => ({
        ok: false,
        refusal: { kind: 'failed', error: new Error('ingest exploded') }
      })
    }
    await startCaptureServer(
      { selectorLifecycle, captureLifecycle: failingLifecycle, token: TEST_TOKEN, sessionService },
      port
    )
    const res = await postCapture({
      source: 'manual',
      caseId: testCase.id,
      url: 'https://example.com/fails'
    })
    expect(res.status).toBe(500)
    expect((await readJson(res)).error).toBe('Failed to process capture')
    expect(listCaptures(testCase.id)).toHaveLength(0)
  })

  // --- Status endpoint ---

  it('GET /api/status without Origin does not update extensionLastSeen', async () => {
    const before = sessionService.snapshot().extensionLastSeen
    await fetch(`${baseUrl}/api/status`)
    const after = sessionService.snapshot().extensionLastSeen
    expect(after).toBe(before)
  })

  it('GET /api/status with chrome-extension Origin updates extensionLastSeen', async () => {
    const before = Date.now()
    await fetch(`${baseUrl}/api/status`, {
      headers: { Origin: 'chrome-extension://abcdefghijklmnop' }
    })
    const after = sessionService.snapshot().extensionLastSeen
    expect(after).toBeGreaterThanOrEqual(before)
  })

  it('GET /api/status returns cases and ignoredUrlPatterns', async () => {
    createCase({ name: 'Case A' })
    createCase({ name: 'Case B' })

    const res = await fetch(`${baseUrl}/api/status`)
    const data = await readJson(res)
    expect(data.running).toBe(true)
    expect(data.cases).toHaveLength(2)
    expect(data.cases[0]).toHaveProperty('id')
    expect(data.cases[0]).toHaveProperty('name')
    expect(data.ignoredUrlPatterns).toEqual([])
    // Always published (#400) so the extension mirrors what is actually in
    // force. The per-case matrix lives in perCaseExclusions.test.ts.
    expect(data.effectiveIgnoredUrlPatterns).toEqual([])
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
    const data = await readJson(res)
    expect(data.pattern).toBe('facebook.com')
  })

  it('POST /api/captures/test returns pipeline health', async () => {
    createCase({ name: 'Pipeline Test Case' })

    const res = await serverPost('/api/captures/test')
    const data = await readJson(res)
    expect(data.success).toBe(true)
    expect(data.durationMs).toBeGreaterThanOrEqual(0)
    expect(data.error).toBeUndefined()
  })

  // The self-test used to ingest into `listCases()[0]` and needed a case to
  // exist; since #614 it makes its own sandbox, so an operator can prove the
  // pipeline works before opening their first investigation.
  it('POST /api/captures/test succeeds with no case in the database', async () => {
    const res = await serverPost('/api/captures/test')
    const data = await readJson(res)
    expect(data.success).toBe(true)
    expect(data.error).toBeUndefined()
    // And it left no case behind to hold what it ingested.
    expect(listCases()).toHaveLength(0)
  })

  it('POST /api/captures/test leaves the real case chain untouched', async () => {
    const testCase = createCase({ name: 'Pipeline Chain Case' })

    const res = await serverPost('/api/captures/test')
    expect((await readJson(res)).success).toBe(true)

    // Nothing was appended, so nothing was created: before #614 this ingested
    // into the case and the directory existed with a two-entry manifest in it.
    const caseDir = join(tempDir, 'captures', testCase.id)
    expect(existsSync(join(caseDir, MANIFEST_FILENAME))).toBe(false)
    expect(getManifestHead(caseDir).nextIndex).toBe(0)
    expect(listCaptures(testCase.id)).toHaveLength(0)
  })

  // The pipeline self-test is the deliberate exception to the per-case
  // exclusion list (#400, #766): it acquires nothing — fixed sentinel URL,
  // literal body — so a policy written about web pages must not be able to
  // disable the operator's proof that the capture pipeline works.
  it('POST /api/captures/test runs even when the case excludes its sentinel URL', async () => {
    const testCase = createCase({ name: 'Excluding Everything' })
    setAutoCapturePolicy(testCase.id, { exclusions: ['/./'], mode: 'override' })
    // Self-proving: without this the test would pass on a pattern that never
    // matched the sentinel, and pin nothing.
    expect(matchCaseExclusion('birdbrain://pipeline-test', testCase.id)).toBe('/./')

    const res = await serverPost('/api/captures/test')
    const data = await readJson(res)
    expect(data.success).toBe(true)
    // Since #614 the run is invisible to the case either way, so the exemption
    // shows up only as the route still succeeding under a pattern that matches
    // its sentinel — and as the case chain staying empty regardless.
    expect(existsSync(join(tempDir, 'captures', testCase.id, MANIFEST_FILENAME))).toBe(false)
    expect(listCaptures(testCase.id)).toHaveLength(0)
  })

  it('POST /api/captures/test rejects unauthenticated requests and writes nothing', async () => {
    const testCase = createCase({ name: 'Auth Test Case' })
    const caseDir = join(tempDir, 'captures', testCase.id)
    // Sanity: the case dir is created lazily by ingestMhtmlCapture, so it
    // must not exist before any request to /api/captures/test.
    expect(existsSync(caseDir)).toBe(false)

    const missing = await fetch(`${baseUrl}/api/captures/test`, { method: 'POST' })
    expect(missing.status).toBe(401)

    const wrong = await fetch(`${baseUrl}/api/captures/test`, {
      method: 'POST',
      headers: { 'X-Birdbrain-Token': 'not-the-right-token' }
    })
    expect(wrong.status).toBe(401)

    // An unauthenticated request is rejected before the handler runs at all, so
    // nothing is ingested and nothing is cleaned up. Assert the persistent
    // signals: the case dir was never created and no manifest entry appended.
    // (When the handler does run, cleanup writes a deletion entry — see the
    // preceding test.)
    expect(existsSync(caseDir)).toBe(false)
    expect(getManifestHead(caseDir).nextIndex).toBe(0)
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
    const data = await readJson(second)
    expect(data.error).toContain('Duplicate')

    const captures = listCaptures(testCase.id)
    expect(captures).toHaveLength(1)
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
    const data = await readJson(res)
    expect(data.captureId).toBeDefined()
    expect(data.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(data.manifestIndex).toBe(0)

    const rows = listCaptures(c.id)
    expect(rows).toHaveLength(1)
    expect(rows[0].format).toBe('mhtml')
  })

  it('round-trips a headers form field into the stored capture (#119)', async () => {
    const c = createCase({ name: 'Headers Test' })
    const headers = { server: 'nginx', date: 'Wed, 21 Jun 2026 12:00:00 GMT' }
    const res = await postCapture({
      source: 'manual',
      caseId: c.id,
      url: 'https://example.com/headers',
      title: 'Headers Page',
      timestamp: new Date().toISOString(),
      headers: JSON.stringify(headers)
    })
    expect(res.status).toBe(200)

    const rows = listCaptures(c.id)
    expect(rows).toHaveLength(1)
    expect(JSON.parse(rows[0].headers!)).toEqual(headers)
  })

  it('does not 500 when headers is malformed or absent (#119)', async () => {
    const c = createCase({ name: 'Bad Headers Test' })
    const malformed = await postCapture({
      source: 'manual',
      caseId: c.id,
      url: 'https://example.com/bad-headers',
      title: 'Bad Headers',
      timestamp: new Date().toISOString(),
      headers: 'not-json{{{'
    })
    expect(malformed.status).toBe(200)

    const absent = await postCapture({
      source: 'manual',
      caseId: c.id,
      url: 'https://example.com/no-headers',
      title: 'No Headers',
      timestamp: new Date().toISOString()
    })
    expect(absent.status).toBe(200)
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
    const data = await readJson(res)
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
    const data = await readJson(res)
    expect(data.screenshotStatus).toBe('dropped')
    expect(data.screenshotWarning).toContain('too large')

    const captures = listCaptures(c.id)
    expect(captures).toHaveLength(1)
    expect(captures[0].screenshotPath).toBeFalsy()
    // 15s rather than the 5s default because this streams a 100MB oversized
    // screenshot through the multipart parser. On a 2-core CI runner it costs
    // ~0.9s idle, ~1.0s under coverage and ~4.6s at 3.5x CPU oversubscription,
    // rising roughly linearly from there: ~9.8s at 8x, so 15s is reachable near
    // 12x. At the ~3x contention #555 reports the budget is ample, so look for a
    // beforeEach port collision (#948) before raising this again.
  }, 15000)

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
    const data = await readJson(res)
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
    const data = await readJson(res)
    expect(data.status).toBe('ok')
    expect(data.selector).toBeDefined()
    expect(data.selector.pattern).toBe('suspicious transaction')
    expect(data.selector.isRegex).toBe(false)
    expect(data.selector.enabled).toBe(true)
    expect(data.selector.label).toBe('from example.com')
    expect(data.selector.caseId).toBe(testCase.id)
    expect(data.selector.origin).toBe('extension')
    expect(data.selector.id).toBeDefined()
    expect(data.selector.createdAt).toBeDefined()

    // Verify it persisted in the database
    const selectors = listSelectors(testCase.id)
    expect(selectors).toHaveLength(1)
    expect(selectors[0].pattern).toBe('suspicious transaction')
    expect(selectors[0].origin).toBe('extension')
  })

  it('POST /api/selectors stamps origin server-side, ignoring any supplied value', async () => {
    const testCase = createCase({ name: 'Origin Is Server Stamped' })
    await activateSessionForCase(testCase.id)

    const res = await serverPost('/api/selectors', {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        caseId: testCase.id,
        pattern: 'forged provenance',
        origin: 'manual'
      })
    })

    // Provenance is a claim about how a selector entered the case, so it is
    // never taken from the request body — anything that can reach the loopback
    // port could otherwise assert a false one.
    expect(res.status).toBe(200)
    const data = await readJson(res)
    expect(data.selector.origin).toBe('extension')
    expect(listSelectors(testCase.id)[0].origin).toBe('extension')
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
    const data = await readJson(res)
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
    const data = await readJson(res)
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
    const data = await readJson(res)
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
    const data = await readJson(res)
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
    const data = await readJson(res)
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
    const data = await readJson(res)
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
    const data = await readJson(res)

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
    const data = await readJson(res)
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
    const data = await readJson(res)
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
    const data = await readJson(res)
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
    const data = await readJson(res)
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
    const data = await readJson(res)
    expect(data).toEqual([])
  })

  // --- Operator identity gating ---

  it('POST /api/captures returns 400 with clear message when operator name is blank', async () => {
    updateSettings({ operatorName: '' })
    const testCase = createCase({ name: 'Blank Operator' })
    const res = await postCapture({
      source: 'manual',
      caseId: testCase.id,
      url: 'https://example.com',
      title: 'Test'
    })
    expect(res.status).toBe(400)
    const data = await readJson(res)
    expect(data.error).toMatch(/operator name/i)
  })

  it('POST /api/captures/test returns 400 when operator name is blank', async () => {
    updateSettings({ operatorName: '' })
    createCase({ name: 'Pipeline Test Case' })
    // Send the token so the request reaches the operator-name precondition.
    const res = await fetch(`${baseUrl}/api/captures/test`, {
      method: 'POST',
      headers: { 'X-Birdbrain-Token': TEST_TOKEN }
    })
    expect(res.status).toBe(400)
    const data = await readJson(res)
    expect(data.error).toMatch(/operator name/i)
  })

  // Regression locks for the /api/status token-exposure check (captureServer.ts
  // ~line 190). The check uses prefix matching like `origin.startsWith('http://localhost:')`
  // — that's safe today because a literal `:` follows the host, but the check
  // would be trivially broken if anyone dropped the colon or widened the prefix.
  // These tests pin the contract: only the explicit allowed shapes (with port)
  // get the token; close-but-spoofed origins do not.
  describe('/api/status token exposure — spoofed and edge-case origins', () => {
    const spoofs = [
      'http://localhost.attacker.com',
      'http://127.0.0.1.attacker.com',
      'http://localhost', // no port
      'http://127.0.0.1', // no port
      'https://localhost:19845', // wrong scheme
      'https://127.0.0.1:19845',
      'null',
      'data:text/html,evil',
      'chrome-extension:', // missing slashes
      'CHROME-EXTENSION://abcdef1234567890' // case mismatch (startsWith is case-sensitive)
    ]

    for (const spoof of spoofs) {
      it(`does not expose serverToken to Origin: ${spoof}`, async () => {
        const res = await fetch(`${baseUrl}/api/status`, {
          headers: { Origin: spoof }
        })
        const data = await readJson(res)
        expect(data.serverToken).toBeUndefined()
      })
    }

    it('exposes serverToken when no Origin header is present (same-origin / curl)', async () => {
      const res = await fetch(`${baseUrl}/api/status`)
      const data = await readJson(res)
      expect(data.serverToken).toBe(TEST_TOKEN)
    })

    it('does not expose serverToken to file:// origins (#D3)', async () => {
      const res = await fetch(`${baseUrl}/api/status`, {
        headers: { Origin: 'file:///Users/foo/page.html' }
      })
      const data = await readJson(res)
      expect(data.serverToken).toBeUndefined()
    })

    // #D3: a rebound hostname resolving to 127.0.0.1 reaches us as same-origin
    // (no Origin header, so CORS never fires) but carries its own hostname in
    // Host. The guard rejects it before the token or any route is reachable.
    it('rejects a non-loopback Host header (DNS-rebinding guard)', async () => {
      const { request } = await import('http')
      const url = new URL(baseUrl)
      const status = await new Promise<number>((resolve, reject) => {
        const req = request(
          {
            hostname: url.hostname,
            port: Number(url.port),
            path: '/api/status',
            method: 'GET',
            headers: { Host: 'evil.example.com' }
          },
          (res) => {
            res.resume()
            resolve(res.statusCode ?? 0)
          }
        )
        req.on('error', reject)
        req.end()
      })
      expect(status).toBe(403)
    })
  })

  describe('extension write endpoints (#392)', () => {
    const PAGE_URL = 'https://example.com/page'

    function activateCase(id: string): Promise<Response> {
      return serverPost(`/api/cases/${id}/activate`)
    }

    function postAttach(
      path: string,
      fields: Record<string, string>,
      mhtmlContent?: string,
      screenshot?: Blob
    ): Promise<Response> {
      const form = new FormData()
      for (const [k, v] of Object.entries(fields)) form.append(k, v)
      if (mhtmlContent !== undefined) {
        form.append('mhtml', new Blob([mhtmlContent], { type: 'multipart/related' }), 'page.mhtml')
      }
      if (screenshot !== undefined) {
        form.append('screenshot', screenshot, 'screenshot.png')
      }
      return fetch(`${baseUrl}${path}`, {
        method: 'POST',
        body: form,
        headers: { 'X-Birdbrain-Token': TEST_TOKEN }
      })
    }

    function postLookup(body: unknown): Promise<Response> {
      return serverPost('/api/captures/lookup', {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
    }

    // The token guard fires on POST only and Hono runs middleware only for
    // routes registered after it, so this pins that every new route inherits
    // the guard (R23) — a route registered above the app.use block would
    // answer 200 here and nothing else would catch it.
    it('answers 401 on every new route without a valid token', async () => {
      for (const path of ['/api/captures/lookup', '/api/tags/apply', '/api/notes']) {
        const missing = await fetch(`${baseUrl}${path}`, { method: 'POST' })
        expect(missing.status).toBe(401)
        const wrong = await fetch(`${baseUrl}${path}`, {
          method: 'POST',
          headers: { 'X-Birdbrain-Token': 'not-the-right-token' }
        })
        expect(wrong.status).toBe(401)
      }
    })

    describe('POST /api/captures/lookup', () => {
      it('returns 404 for an unknown case', async () => {
        const res = await postLookup({ caseId: 'nope', url: PAGE_URL })
        expect(res.status).toBe(404)
      })

      it('rejects a non-http(s) url', async () => {
        const testCase = createCase({ name: 'Lookup Case' })
        const res = await postLookup({ caseId: testCase.id, url: 'ftp://example.com/x' })
        expect(res.status).toBe(400)
        expect((await readJson(res)).error).toContain('url')
      })

      it('reports found=false when the case holds no capture of the URL', async () => {
        const testCase = createCase({ name: 'Lookup Case' })
        const res = await postLookup({ caseId: testCase.id, url: PAGE_URL })
        const data = await readJson(res)
        expect(res.status).toBe(200)
        expect(data.found).toBe(false)
        expect(data.capture).toBeNull()
        expect(data.canonicalUrl).toBe(PAGE_URL)
      })

      it('finds a capture across fragment and trailing-slash differences', async () => {
        const testCase = createCase({ name: 'Lookup Case' })
        const stored = await readJson(
          await postCapture({ source: 'manual', caseId: testCase.id, url: `${PAGE_URL}/` })
        )
        const res = await postLookup({ caseId: testCase.id, url: `${PAGE_URL}#section` })
        const data = await readJson(res)
        expect(data.found).toBe(true)
        expect(data.capture.id).toBe(stored.captureId)
        expect(data.canonicalUrl).toBe(PAGE_URL)
      })
    })

    describe('POST /api/tags/apply', () => {
      it('attaches to the existing capture without ingesting again', async () => {
        const testCase = createCase({ name: 'Tag Case' })
        await activateCase(testCase.id)
        const stored = await readJson(
          await postCapture({ source: 'manual', caseId: testCase.id, url: `${PAGE_URL}/` })
        )
        const res = await postAttach('/api/tags/apply', {
          caseId: testCase.id,
          url: `${PAGE_URL}#section`,
          tagName: 'Evidence'
        })
        const data = await readJson(res)
        expect(res.status).toBe(200)
        expect(data.status).toBe('ok')
        expect(data.captured).toBe(false)
        expect(data.captureId).toBe(stored.captureId)
        expect(getTagsForCapture(stored.captureId).map((t) => t.name)).toEqual(['Evidence'])
        expect(listCaptures(testCase.id)).toHaveLength(1)
      })

      it('prefers the exactly-named tag when case variants coexist', async () => {
        const testCase = createCase({ name: 'Tag Case' })
        await activateCase(testCase.id)
        // `tags.name` is case-sensitive and the IPC path permits both, so the
        // insensitive lookup alone could attach either identity (#835 review).
        const lower = createTag({ name: 'evidence' })
        const upper = createTag({ name: 'Evidence' })
        const stored = await readJson(
          await postCapture({ source: 'manual', caseId: testCase.id, url: PAGE_URL })
        )
        const res = await postAttach('/api/tags/apply', {
          caseId: testCase.id,
          url: PAGE_URL,
          tagName: 'Evidence'
        })
        const data = await readJson(res)
        expect(data.tag.id).toBe(upper.id)
        expect(data.tag.name).toBe('Evidence')
        expect(getTagsForCapture(stored.captureId).map((t) => t.id)).toEqual([upper.id])
        expect(listTags()).toHaveLength(2)
        expect(lower.id).not.toBe(upper.id)
      })

      it('reports the screenshot outcome on both attach paths', async () => {
        const testCase = createCase({ name: 'Shot Case' })
        await activateCase(testCase.id)
        // Auto-capture carrying an oversized screenshot: stored, but the
        // caller is told the artifact was dropped rather than getting an
        // unqualified success (#835 review).
        const oversized = new Blob([new Uint8Array(MAX_SCREENSHOT_SIZE + 1)], { type: 'image/png' })
        const dropped = await readJson(
          await postAttach(
            '/api/tags/apply',
            { caseId: testCase.id, url: PAGE_URL, tagName: 'Evidence' },
            '<html>page</html>',
            oversized
          )
        )
        expect(dropped.captured).toBe(true)
        expect(dropped.screenshotStatus).toBe('dropped')
        expect(dropped.screenshotWarning).toContain('exceeds')

        // Attaching to that existing capture acquires nothing at all.
        const note = await readJson(
          await postAttach('/api/notes', {
            caseId: testCase.id,
            url: PAGE_URL,
            noteTitle: 'Note',
            noteText: 'attached'
          })
        )
        expect(note.captured).toBe(false)
        expect(note.screenshotStatus).toBe('none')
        expect(note.screenshotWarning).toBeUndefined()
      })

      it('reuses an existing tag by case-insensitive name', async () => {
        const testCase = createCase({ name: 'Tag Case' })
        await activateCase(testCase.id)
        const existing = createTag({ name: 'Evidence' })
        const stored = await readJson(
          await postCapture({ source: 'manual', caseId: testCase.id, url: PAGE_URL })
        )
        const res = await postAttach('/api/tags/apply', {
          caseId: testCase.id,
          url: PAGE_URL,
          tagName: 'evidence'
        })
        const data = await readJson(res)
        expect(data.tag.id).toBe(existing.id)
        expect(data.tag.name).toBe('Evidence')
        expect(listTags()).toHaveLength(1)
        expect(getTagsForCapture(stored.captureId)).toHaveLength(1)
      })

      it('auto-captures the supplied payload first when no capture exists', async () => {
        const testCase = createCase({ name: 'Tag Case' })
        await activateCase(testCase.id)
        const res = await postAttach(
          '/api/tags/apply',
          { caseId: testCase.id, url: PAGE_URL, tagName: 'Evidence', title: 'Example Page' },
          '<html>tagged page</html>'
        )
        const data = await readJson(res)
        expect(res.status).toBe(200)
        expect(data.captured).toBe(true)
        const captures = listCaptures(testCase.id)
        expect(captures).toHaveLength(1)
        expect(captures[0].id).toBe(data.captureId)
        expect(captures[0].url).toBe(PAGE_URL)
        // Operator-witnessed, honestly (R2): the row defaults to 'extension'.
        expect(captures[0].method).toBe('extension')
        expect(getTagsForCapture(data.captureId).map((t) => t.name)).toEqual(['Evidence'])
      })

      it('says on the 500 whether the failed apply had freshly ingested the capture', async () => {
        const testCase = createCase({ name: 'Tag Case' })
        await activateCase(testCase.id)
        // The 500 names real evidence either way; `captured` is what lets the
        // extension distinguish "captured just now" from a capture the case
        // already held (#961 review).
        const spy = vi.spyOn(tagRepo, 'addTagToCapture').mockImplementation(() => {
          throw new Error('tag apply exploded')
        })
        try {
          const res = await postAttach(
            '/api/tags/apply',
            { caseId: testCase.id, url: PAGE_URL, tagName: 'Evidence' },
            '<html>tagged page</html>'
          )
          expect(res.status).toBe(500)
          const data = await readJson(res)
          expect(data.error).toBe('Failed to apply tag')
          expect(data.captured).toBe(true)
          const captures = listCaptures(testCase.id)
          expect(captures).toHaveLength(1)
          expect(data.captureId).toBe(captures[0].id)
        } finally {
          spy.mockRestore()
        }
      })

      it('refuses without a payload when no capture exists, leaving no orphan', async () => {
        const testCase = createCase({ name: 'Tag Case' })
        await activateCase(testCase.id)
        const res = await postAttach('/api/tags/apply', {
          caseId: testCase.id,
          url: PAGE_URL,
          tagName: 'Evidence'
        })
        expect(res.status).toBe(422)
        expect(listTags()).toHaveLength(0)
        expect(listCaptures(testCase.id)).toHaveLength(0)
      })

      it('saves a size-conformant screenshot with the auto-capture', async () => {
        const testCase = createCase({ name: 'Tag Case' })
        await activateCase(testCase.id)
        const res = await postAttach(
          '/api/tags/apply',
          { caseId: testCase.id, url: PAGE_URL, tagName: 'Evidence' },
          '<html>page</html>',
          new Blob([new Uint8Array(64)], { type: 'image/png' })
        )
        expect(res.status).toBe(200)
        const captures = listCaptures(testCase.id)
        expect(captures).toHaveLength(1)
        expect(captures[0].screenshotPath).toBeTruthy()
      })

      it('drops an oversized screenshot but keeps the auto-capture', async () => {
        const testCase = createCase({ name: 'Tag Case' })
        await activateCase(testCase.id)
        const res = await postAttach(
          '/api/tags/apply',
          { caseId: testCase.id, url: PAGE_URL, tagName: 'Evidence' },
          '<html>page</html>',
          new Blob([new Uint8Array(MAX_SCREENSHOT_SIZE + 1)], { type: 'image/png' })
        )
        expect(res.status).toBe(200)
        const captures = listCaptures(testCase.id)
        expect(captures).toHaveLength(1)
        expect(captures[0].screenshotPath).toBeFalsy()
      })

      it('resolves several captures of one URL to the most recent', async () => {
        const testCase = createCase({ name: 'Tag Case' })
        await activateCase(testCase.id)
        await readJson(
          await postCapture({
            source: 'manual',
            caseId: testCase.id,
            url: PAGE_URL,
            timestamp: '2026-01-01T00:00:00.000Z'
          })
        )
        const newer = await readJson(
          await postCapture({
            source: 'manual',
            caseId: testCase.id,
            url: `${PAGE_URL}/`,
            timestamp: '2026-02-01T00:00:00.000Z'
          })
        )
        const res = await postAttach('/api/tags/apply', {
          caseId: testCase.id,
          url: PAGE_URL,
          tagName: 'Evidence'
        })
        const data = await readJson(res)
        expect(data.captureId).toBe(newer.captureId)
        expect(getTagsForCapture(newer.captureId)).toHaveLength(1)
      })

      it('refuses an auto-capture of an excluded URL (#400)', async () => {
        updateSettings({ ignoredUrlPatterns: ['blocked-site.com'] })
        const testCase = createCase({ name: 'Tag Case' })
        await activateCase(testCase.id)
        const res = await postAttach(
          '/api/tags/apply',
          { caseId: testCase.id, url: 'https://blocked-site.com/x', tagName: 'Evidence' },
          '<html>blocked</html>'
        )
        expect(res.status).toBe(403)
        expect(listCaptures(testCase.id)).toHaveLength(0)
        expect(listTags()).toHaveLength(0)
      })

      it('requires an operator name before an auto-capture, leaving no orphan', async () => {
        updateSettings({ operatorName: '' })
        const testCase = createCase({ name: 'Tag Case' })
        await activateCase(testCase.id)
        const res = await postAttach(
          '/api/tags/apply',
          { caseId: testCase.id, url: PAGE_URL, tagName: 'Evidence' },
          '<html>page</html>'
        )
        expect(res.status).toBe(400)
        expect(listCaptures(testCase.id)).toHaveLength(0)
        expect(listTags()).toHaveLength(0)
      })

      it('requires an active case, and the matching one', async () => {
        const testCase = createCase({ name: 'Tag Case' })
        const noActive = await postAttach('/api/tags/apply', {
          caseId: testCase.id,
          url: PAGE_URL,
          tagName: 'Evidence'
        })
        expect(noActive.status).toBe(400)
        expect((await readJson(noActive)).error).toBe('No active case selected')

        const other = createCase({ name: 'Other Case' })
        await activateCase(other.id)
        const mismatch = await postAttach('/api/tags/apply', {
          caseId: testCase.id,
          url: PAGE_URL,
          tagName: 'Evidence'
        })
        expect(mismatch.status).toBe(400)
        expect((await readJson(mismatch)).error).toBe('caseId does not match active case')
      })

      it('rejects a missing tagName with a field-specific error', async () => {
        const testCase = createCase({ name: 'Tag Case' })
        await activateCase(testCase.id)
        const res = await postAttach('/api/tags/apply', { caseId: testCase.id, url: PAGE_URL })
        expect(res.status).toBe(400)
        expect((await readJson(res)).error).toBe('Missing or empty required field: tagName')
      })

      it('reports a failed ingest and attaches nothing', async () => {
        const testCase = createCase({ name: 'Fail Case' })
        await activateCase(testCase.id)
        // Rebind the server to a lifecycle whose ingest throws — the injection
        // seam the server already exposes for exactly this kind of test.
        await stopCaptureServer()
        const port = nextPort++
        baseUrl = `http://127.0.0.1:${port}`
        const selectorLifecycle = createSelectorLifecycle({ emitRematched: () => {} })
        const realLifecycle = createCaptureLifecycle({ selectorLifecycle, sessionService })
        const failingLifecycle = {
          ...realLifecycle,
          admit: async (): ReturnType<typeof realLifecycle.admit> => ({
            ok: false,
            refusal: { kind: 'failed', error: new Error('ingest exploded') }
          })
        }
        await startCaptureServer(
          {
            selectorLifecycle,
            captureLifecycle: failingLifecycle,
            token: TEST_TOKEN,
            sessionService
          },
          port
        )
        const res = await postAttach(
          '/api/tags/apply',
          { caseId: testCase.id, url: PAGE_URL, tagName: 'Evidence' },
          '<html>page</html>'
        )
        expect(res.status).toBe(500)
        expect((await readJson(res)).error).toBe('Failed to capture page; nothing was attached')
        expect(listCaptures(testCase.id)).toHaveLength(0)
        expect(listTags()).toHaveLength(0)
      })
    })

    describe('concurrent attach requests (#835 review)', () => {
      it('serializes same-URL requests so a race never ingests twice', async () => {
        const testCase = createCase({ name: 'Race Case' })
        await activateCase(testCase.id)
        // Rebind the server to a lifecycle whose ingest blocks on a gate, so
        // the first request is provably inside ingest — past its candidate
        // lookup — while the second arrives. Unserialized, the second passes
        // its own lookup too and ingest runs twice.
        await stopCaptureServer()
        const port = nextPort++
        baseUrl = `http://127.0.0.1:${port}`
        const selectorLifecycle = createSelectorLifecycle({ emitRematched: () => {} })
        const realLifecycle = createCaptureLifecycle({ selectorLifecycle, sessionService })
        let release!: () => void
        const gate = new Promise<void>((resolve) => {
          release = resolve
        })
        let ingestEntries = 0
        const gatedLifecycle = {
          ...realLifecycle,
          admit: async (args: Parameters<typeof realLifecycle.admit>[0]) => {
            ingestEntries++
            await gate
            return realLifecycle.admit(args)
          }
        }
        await startCaptureServer(
          {
            selectorLifecycle,
            captureLifecycle: gatedLifecycle,
            token: TEST_TOKEN,
            sessionService
          },
          port
        )

        const first = postAttach(
          '/api/tags/apply',
          { caseId: testCase.id, url: PAGE_URL, tagName: 'Evidence' },
          '<html>tagged page</html>'
        )
        await vi.waitFor(() => expect(ingestEntries).toBe(1))
        const second = postAttach(
          '/api/notes',
          { caseId: testCase.id, url: PAGE_URL, noteTitle: 'Note', noteText: 'seen live' },
          '<html>noted page</html>'
        )
        // Long enough for the second request to reach the server and, were
        // the chain missing, enter ingest as a second entry.
        await new Promise((resolve) => setTimeout(resolve, 150))
        release()
        const [tagRes, noteRes] = await Promise.all([first, second])
        const tagData = await readJson(tagRes)
        const noteData = await readJson(noteRes)

        expect(tagRes.status).toBe(200)
        expect(noteRes.status).toBe(200)
        expect(ingestEntries).toBe(1)
        expect(tagData.captured).toBe(true)
        expect(noteData.captured).toBe(false)
        expect(noteData.captureId).toBe(tagData.captureId)
        const captures = listCaptures(testCase.id)
        expect(captures).toHaveLength(1)
        expect(captures[0].id).toBe(tagData.captureId)
        expect(getTagsForCapture(tagData.captureId).map((t) => t.name)).toEqual(['Evidence'])
        expect(listNotes(testCase.id)).toHaveLength(1)
        expect(listNotes(testCase.id)[0].captureId).toBe(tagData.captureId)
      })
    })

    describe('POST /api/notes', () => {
      it('creates a note on the existing capture, born on the document schema', async () => {
        const testCase = createCase({ name: 'Note Case' })
        await activateCase(testCase.id)
        const stored = await readJson(
          await postCapture({ source: 'manual', caseId: testCase.id, url: `${PAGE_URL}/` })
        )
        const res = await postAttach('/api/notes', {
          caseId: testCase.id,
          url: `${PAGE_URL}#quote`,
          noteTitle: 'From the page',
          noteText: 'first line\nsecond line'
        })
        const data = await readJson(res)
        expect(res.status).toBe(200)
        expect(data.captured).toBe(false)
        expect(data.captureId).toBe(stored.captureId)
        const notes = listNotes(testCase.id)
        expect(notes).toHaveLength(1)
        expect(notes[0].id).toBe(data.note.id)
        expect(notes[0].title).toBe('From the page')
        expect(notes[0].captureId).toBe(stored.captureId)
        expect(notes[0].sourceUrl).toBe(`${PAGE_URL}#quote`)
        // Born Mention-capable (#389): body_doc holds the document and the
        // plain body is derived from it, block-per-line.
        expect(notes[0].bodyDoc).toBeDefined()
        expect(JSON.parse(notes[0].bodyDoc!).type).toBe('doc')
        expect(notes[0].body).toBe('first line\nsecond line')
      })

      it('auto-captures the supplied payload first when no capture exists', async () => {
        const testCase = createCase({ name: 'Note Case' })
        await activateCase(testCase.id)
        const res = await postAttach(
          '/api/notes',
          { caseId: testCase.id, url: PAGE_URL, noteText: 'observed content' },
          '<html>noted page</html>'
        )
        const data = await readJson(res)
        expect(res.status).toBe(200)
        expect(data.captured).toBe(true)
        const captures = listCaptures(testCase.id)
        expect(captures).toHaveLength(1)
        expect(captures[0].id).toBe(data.captureId)
        const notes = listNotes(testCase.id)
        expect(notes).toHaveLength(1)
        expect(notes[0].captureId).toBe(data.captureId)
      })

      it('marks the pre-existing capture as not captured on the 500 a failed note raises', async () => {
        const testCase = createCase({ name: 'Note Case' })
        await activateCase(testCase.id)
        const stored = await readJson(
          await postCapture({ source: 'manual', caseId: testCase.id, url: PAGE_URL })
        )
        // The resolve branch acquired nothing: the named capture is old
        // evidence, and `captured: false` is what keeps the extension from
        // reporting it as captured just now (#961 review).
        const spy = vi.spyOn(noteRepo, 'createNote').mockImplementation(() => {
          throw new Error('note create exploded')
        })
        try {
          const res = await postAttach('/api/notes', {
            caseId: testCase.id,
            url: PAGE_URL,
            noteText: 'never lands'
          })
          expect(res.status).toBe(500)
          const data = await readJson(res)
          expect(data.error).toBe('Failed to create note')
          expect(data.captured).toBe(false)
          expect(data.captureId).toBe(stored.captureId)
        } finally {
          spy.mockRestore()
        }
      })

      it('refuses without a payload when no capture exists, leaving no orphan', async () => {
        const testCase = createCase({ name: 'Note Case' })
        await activateCase(testCase.id)
        const res = await postAttach('/api/notes', {
          caseId: testCase.id,
          url: PAGE_URL,
          noteText: 'orphan-to-be'
        })
        expect(res.status).toBe(422)
        expect(listNotes(testCase.id)).toHaveLength(0)
        expect(listCaptures(testCase.id)).toHaveLength(0)
      })

      it('rejects a missing noteText with a field-specific error', async () => {
        const testCase = createCase({ name: 'Note Case' })
        await activateCase(testCase.id)
        const res = await postAttach('/api/notes', { caseId: testCase.id, url: PAGE_URL })
        expect(res.status).toBe(400)
        expect((await readJson(res)).error).toBe('Missing or empty required field: noteText')
      })
    })
  })
})

// A held port is the one startup failure an operator can cause by hand — a
// second copy of the app, or the exploratory harness against a throwaway
// profile — and before #513 it arrived as an unhandled 'error' event rather
// than a rejection boot could report.
describe('startCaptureServer bind failure', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'birdbrain-bind-test-'))
    await initDatabase(':memory:')
    initStorage(join(tempDir, 'captures'))
    initSettings(tempDir)
    resetInstallationId()
    initInstallationId(tempDir)
    sessionService = createSessionService()
  })

  afterEach(async () => {
    await stopCaptureServer()
    closeDatabase()
    rmSync(tempDir, { recursive: true, force: true })
  })

  function startOn(port: number): Promise<void> {
    const selectorLifecycle = createSelectorLifecycle({ emitRematched: () => {} })
    const captureLifecycle = createCaptureLifecycle({ selectorLifecycle })
    return startCaptureServer(
      { selectorLifecycle, captureLifecycle, token: TEST_TOKEN, sessionService },
      port
    )
  }

  async function occupy(port: number): Promise<() => Promise<void>> {
    const blocker = createServer()
    await new Promise<void>((resolve) => blocker.listen(port, '127.0.0.1', resolve))
    return () => new Promise<void>((resolve) => blocker.close(() => resolve()))
  }

  it('rejects with CaptureServerBindError when the port is already held', async () => {
    const port = nextPort++
    const release = await occupy(port)
    try {
      const err = await startOn(port).catch((e: unknown) => e)
      expect(err).toBeInstanceOf(CaptureServerBindError)
      const bindError = err as CaptureServerBindError
      expect(bindError.code).toBe('EADDRINUSE')
      expect(bindError.port).toBe(port)
      expect(bindError.message).toContain(`127.0.0.1:${port}`)
      // Nothing was published, so the port lookup the app resolves its own
      // server through still says "not running" rather than naming a port the
      // other process answers on.
      expect(getCaptureServerPort()).toBeNull()
    } finally {
      await release()
    }
  })

  it('leaves the server startable on another port after a failed bind', async () => {
    const held = nextPort++
    const release = await occupy(held)
    try {
      await expect(startOn(held)).rejects.toBeInstanceOf(CaptureServerBindError)
    } finally {
      await release()
    }
    const free = nextPort++
    await startOn(free)
    expect(getCaptureServerPort()).toBe(free)
  })

  // The durable app.startup_failed entry is all an operator sends in, and
  // sanitizeError flattens any name outside ERROR_NAMES to 'UnknownError' —
  // which would leave a bind failure indistinguishable from every other fatal
  // boot error in that log.
  it('survives log sanitizing with its own name and errno', async () => {
    const port = nextPort++
    const release = await occupy(port)
    try {
      const err = await startOn(port).catch((e: unknown) => e)
      const logged = sanitizeError(err)
      expect(logged.name).toBe('CaptureServerBindError')
      expect(logged.code).toBe('EADDRINUSE')
    } finally {
      await release()
    }
  })
})
