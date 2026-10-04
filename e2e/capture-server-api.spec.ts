import { request as httpRequest } from 'node:http'
import { test, expect } from './fixtures/electronApp'
import { CAPTURE_SERVER_BASE_URL, createCase, seedCapture, serverToken } from './fixtures/seed'

// The local capture server is the extension's only way into the app. Its
// routes have unit tests against an in-process Hono app; these drive the
// server the built app actually binds, and check what each answer does to the
// window the operator is looking at.

const api = (path: string) => `${CAPTURE_SERVER_BASE_URL}${path}`

test.describe('Capture server API against the running app', () => {
  test('status hands an origin-less caller the token and lists cases', async ({
    page,
    request
  }) => {
    const caseId = await createCase(page, 'Server Status Case')

    const res = await request.get(api('/api/status'))
    expect(res.status()).toBe(200)
    const status = await res.json()
    expect(status.running).toBe(true)
    expect(typeof status.serverToken).toBe('string')
    expect(status.serverToken.length).toBeGreaterThan(0)
    expect(status.cases).toContainEqual({ id: caseId, name: 'Server Status Case' })

    // includeCases=false drops the list but keeps the rest of the status.
    const lean = await (await request.get(api('/api/status?includeCases=false'))).json()
    expect(lean.cases).toEqual([])
    expect(lean.running).toBe(true)

    const cases = await (await request.get(api('/api/cases'))).json()
    expect(cases).toContainEqual(
      expect.objectContaining({ id: caseId, name: 'Server Status Case', captureCount: 0 })
    )
  })

  test('every POST without the right token is refused and writes nothing', async ({
    page,
    request
  }) => {
    // Opening a case makes it the active one, so the second case is active and
    // the first is the target of the refused activations.
    const caseId = await createCase(page, 'Server Auth Case')
    const activeId = await createCase(page, 'Server Auth Active Case')

    const missing = await request.post(api(`/api/cases/${caseId}/activate`))
    expect(missing.status()).toBe(401)
    expect(await missing.json()).toEqual({ error: 'Unauthorized' })

    const wrong = await request.post(api(`/api/cases/${caseId}/activate`), {
      headers: { 'X-Birdbrain-Token': 'not-the-token' }
    })
    expect(wrong.status()).toBe(401)

    const capture = await request.post(api('/api/captures'), {
      multipart: {
        source: 'manual',
        caseId,
        url: 'https://example.com/unauthorised',
        title: 'Unauthorised',
        timestamp: new Date().toISOString(),
        mhtml: {
          name: 'capture.mhtml',
          mimeType: 'multipart/related',
          buffer: Buffer.from('<html></html>')
        }
      }
    })
    expect(capture.status()).toBe(401)

    // Neither refused call changed state the status route reports.
    const status = await (await request.get(api('/api/status'))).json()
    expect(status.activeCase).toEqual({ id: activeId, name: 'Server Auth Active Case' })
    const cases = await (await request.get(api('/api/cases'))).json()
    expect(cases).toContainEqual(expect.objectContaining({ id: caseId, captureCount: 0 }))
  })

  test('a Host header that is not loopback is refused before routing', async ({ page }) => {
    // The DNS-rebinding guard: a page on a rebound hostname reaches 127.0.0.1
    // carrying its own name in Host, and must get nothing back, token included.
    // Node's http client is used because Playwright's request context connects
    // to whatever host the Host header names.
    await expect(page.getByTestId('app-ready')).toBeAttached()
    const { port } = new URL(CAPTURE_SERVER_BASE_URL)
    const { status, body } = await new Promise<{ status: number; body: string }>(
      (resolve, reject) => {
        const req = httpRequest(
          {
            host: '127.0.0.1',
            port: Number(port),
            path: '/api/status',
            headers: { Host: `attacker.example:${port}` }
          },
          (res) => {
            let data = ''
            res.on('data', (chunk) => (data += chunk))
            res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }))
          }
        )
        req.on('error', reject)
        req.end()
      }
    )
    expect(status).toBe(403)
    expect(JSON.parse(body)).toEqual({ error: 'Forbidden' })
    expect(body).not.toContain('serverToken')
  })

  test('activating a case and starting a session lights the REC indicator', async ({
    page,
    request
  }) => {
    await expect(page.getByTestId('dashboard')).toBeVisible()
    const { serverToken } = await (await request.get(api('/api/status'))).json()
    const headers = { 'X-Birdbrain-Token': serverToken }

    // On the dashboard no case is active yet, so a session cannot start, and
    // an unknown id does not become the active case.
    const early = await request.post(api('/api/session/start'), { headers })
    expect(early.status()).toBe(400)
    expect(await early.json()).toEqual({ error: 'No active case selected' })
    const unknown = await request.post(api('/api/cases/no-such-case/activate'), { headers })
    expect(unknown.status()).toBe(404)

    const caseId = await createCase(page, 'Server Session Case')

    const activated = await request.post(api(`/api/cases/${caseId}/activate`), { headers })
    expect(activated.status()).toBe(200)
    expect((await activated.json()).case).toEqual({ id: caseId, name: 'Server Session Case' })

    const rec = page.getByTestId('topbar-rec')
    await expect(rec).toHaveCount(0)

    const started = await request.post(api('/api/session/start'), { headers })
    expect(await started.json()).toEqual({ status: 'ok', sessionActive: true })
    await expect(rec.first()).toBeVisible({ timeout: 10000 })

    const status = await (await request.get(api('/api/status'))).json()
    expect(status.activeCase).toEqual({ id: caseId, name: 'Server Session Case' })
    expect(status.sessionActive).toBe(true)

    const stopped = await request.post(api('/api/session/stop'), { headers })
    expect(await stopped.json()).toEqual({ status: 'ok', sessionActive: false })
    await expect(rec).toHaveCount(0, { timeout: 10000 })
  })

  test('capture refusals map to their status codes and leave the list unchanged', async ({
    page,
    request
  }) => {
    test.setTimeout(60000)
    const caseId = await createCase(page, 'Server Refusal Case')
    const { serverToken } = await (await request.get(api('/api/status'))).json()
    const headers = { 'X-Birdbrain-Token': serverToken }

    const form = (fields: Record<string, string>) => ({
      source: 'manual',
      url: 'https://example.com/refusals',
      title: 'Refusals',
      timestamp: new Date().toISOString(),
      textContent: 'refusals',
      ...fields,
      mhtml: {
        name: 'capture.mhtml',
        mimeType: 'multipart/related',
        buffer: Buffer.from('<html><body>refusals</body></html>')
      }
    })

    // A case id that does not exist.
    const missingCase = await request.post(api('/api/captures'), {
      headers,
      multipart: form({ caseId: 'no-such-case' })
    })
    expect(missingCase.status()).toBe(404)
    expect(await missingCase.json()).toEqual({ error: 'Case not found' })

    // A payload the schema rejects: no MHTML part at all.
    const noBody = await request.post(api('/api/captures'), {
      headers,
      multipart: { source: 'manual', caseId, url: 'https://example.com/x', title: 'x' }
    })
    expect(noBody.status()).toBe(400)

    // The first manual capture of a URL lands; the same URL again inside the
    // dedupe window is a 409 and does not add a second row.
    const first = await request.post(api('/api/captures'), { headers, multipart: form({ caseId }) })
    expect(first.status()).toBe(200)
    const firstBody = await first.json()
    expect(firstBody.status).toBe('ok')
    expect(firstBody.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(firstBody.manifestIndex).toBe(0)

    const again = await request.post(api('/api/captures'), { headers, multipart: form({ caseId }) })
    expect(again.status()).toBe(409)
    expect(await again.json()).toEqual({ error: 'Duplicate capture', status: 'skipped' })

    await page.evaluate((id) => {
      window.location.hash = `/cases/${id}/captures`
    }, caseId)
    await expect(page.getByTestId('capture-item')).toHaveCount(1, { timeout: 15000 })
    await expect(page.getByTestId('capture-item').first()).toContainText('Refusals')

    // An archived case refuses new captures with a 400.
    await page.evaluate(
      (id) =>
        (
          window as unknown as {
            birdbrain: { cases: { update: (p: object) => Promise<unknown> } }
          }
        ).birdbrain.cases.update({ id, archived: true }),
      caseId
    )
    const archived = await request.post(api('/api/captures'), {
      headers,
      multipart: form({ caseId, url: 'https://example.com/after-archive' })
    })
    expect(archived.status()).toBe(400)
    expect(await archived.json()).toEqual({ error: 'Case is archived' })
  })

  test('a capture posted from outside appears in the open captures list', async ({ page }) => {
    // The renderer is told about new captures by event; no reload is involved.
    const caseId = await createCase(page, 'Server Live Case')
    await page.evaluate((id) => {
      window.location.hash = `/cases/${id}/captures`
    }, caseId)
    await expect(page.getByTestId('capture-item')).toHaveCount(0)

    await seedCapture(page, caseId, await serverToken(page), {
      slug: 'live',
      title: 'Arrives while open'
    })

    await expect(page.getByTestId('capture-item')).toHaveCount(1, { timeout: 15000 })
    await expect(page.getByTestId('capture-item').first()).toContainText('Arrives while open')
  })
})
