import { test, expect } from './fixtures/electronApp'
import { createServer, type Server } from 'http'

// End-to-end background recapture: serve a fixture page from a local HTTP
// server, queue it via the Add URLs box, and assert the capture lands with
// background provenance, a screenshot, and a verifiable manifest chain.
test.describe('Recapture (background capture)', () => {
  let server: Server
  let baseUrl: string

  test.beforeAll(async () => {
    server = createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(
        '<html><head><title>Recapture Fixture</title></head>' +
          '<body><h1>Recapture fixture page</h1><p>stable content</p></body></html>'
      )
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const addr = server.address()
    baseUrl = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : ''
  })

  test.afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  test('captures a URL in the background with full provenance', async ({ page }) => {
    // Two sequential background renders, each allowed up to 60s below; the
    // default 30s per-test cap would undercut them on a slow CI runner.
    test.setTimeout(150000)

    // Create a case (same flow as mhtml-capture.spec.ts)
    await page.evaluate(() => {
      window.location.hash = '/cases/new'
    })
    await page.waitForSelector('[data-testid="case-name-input"]', { timeout: 10000 })
    await page.fill('[data-testid="case-name-input"]', 'Recapture E2E')
    await page.click('[data-testid="case-create-btn"]')
    await page.waitForURL(/#\/cases\/.+\/overview/, { timeout: 10000 })
    const caseId = page.url().match(/cases\/([^/]+)/)![1]

    // Navigate to the Captures tab and queue the fixture URL
    await page.evaluate((id) => {
      window.location.hash = `/cases/${id}/captures`
    }, caseId)
    await page.waitForSelector('[data-testid="add-urls-input"]', { timeout: 10000 })
    await page.fill('[data-testid="add-urls-input"]', `${baseUrl}/page`)
    await page.click('[data-testid="add-urls-submit"]')

    // The capture appears in the list when the background job completes
    await expect(page.getByText('Recapture Fixture')).toBeVisible({ timeout: 60000 })

    // Background captures are visually distinguished by a recapture badge on the
    // list thumbnail.
    await expect(page.getByTestId('recapture-thumb-badge').first()).toBeVisible()

    // Provenance: background method + supersedes-free + verified chain
    const capture = await page.evaluate(async (id) => {
      const w = window as unknown as {
        birdbrain: {
          captures: {
            list: (caseId: string) => Promise<
              Array<{
                id: string
                method: string
                supersedesCaptureId?: string
                screenshotPath?: string
                hash: string
              }>
            >
          }
        }
      }
      const list = await w.birdbrain.captures.list(id)
      return list[0]
    }, caseId)
    expect(capture.method).toBe('background')
    expect(capture.supersedesCaptureId).toBeUndefined()
    expect(capture.screenshotPath).toBeTruthy()
    expect(capture.hash).toMatch(/^[0-9a-f]{64}$/)

    const verification = await page.evaluate(async (captureId: string) => {
      const w = window as unknown as {
        birdbrain: { captures: { verify: (id: string) => Promise<{ status: string }> } }
      }
      return w.birdbrain.captures.verify(captureId)
    }, capture.id)
    expect(verification.status).toBe('verified')

    // Recapture the capture itself → linked sibling
    await page.getByTestId('capture-item').filter({ hasText: 'Recapture Fixture' }).first().click()
    await page.click('[data-testid="recapture-btn"]')
    // While the background job runs, the button reflects the in-flight state
    // (driven by the recapture 'received' event, not the enqueue IPC).
    await expect(page.getByTestId('recapture-in-progress')).toBeVisible({ timeout: 8000 })
    await expect(page.locator('[data-testid="supersedes-link-recapture"]')).toBeVisible({
      timeout: 60000
    })
    const captures = await page.evaluate(async (id) => {
      const w = window as unknown as {
        birdbrain: {
          captures: {
            list: (
              caseId: string
            ) => Promise<Array<{ id: string; method: string; supersedesCaptureId?: string }>>
          }
        }
      }
      return w.birdbrain.captures.list(id)
    }, caseId)
    expect(captures).toHaveLength(2)
    const sibling = captures.find((c) => c.supersedesCaptureId === capture.id)
    expect(sibling).toBeTruthy()
    expect(sibling!.method).toBe('background')
  })
})
