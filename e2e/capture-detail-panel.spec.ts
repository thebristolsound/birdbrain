import { test, expect } from './fixtures/electronApp'

// Seeds a case + a single MHTML capture, then exercises the new
// CaptureDetailsPanel: panel renders at 400px, favorite toggle persists,
// inline note saves on blur with a "Saved …" hint, and the panel collapses
// to the 40px rail when the viewport drops below 1100px.

test.describe('Capture detail panel', () => {
  test('renders panel, persists favorite, saves inline note, collapses on narrow viewport', async ({
    electronApp,
    page
  }) => {
    // Create a case via the hash router.
    await page.evaluate(() => {
      window.location.hash = '/cases/new'
    })
    await page.waitForSelector('[data-testid="case-name-input"]', { timeout: 10000 })
    await page.fill('[data-testid="case-name-input"]', 'Detail Panel E2E')
    await page.click('[data-testid="case-create-btn"]')
    // Case creation lands on the Overview page, whose URL still carries the case id.
    await page.waitForURL(/#\/cases\/.+\/overview/, { timeout: 10000 })

    // Capture the case ID from the URL.
    const caseIdMatch = page.url().match(/cases\/([^/]+)/)
    expect(caseIdMatch).toBeTruthy()
    const caseId = caseIdMatch![1]

    // Seed a capture by POSTing to the local Hono server.
    const serverToken = await page.evaluate(async () => {
      const r = await fetch('http://127.0.0.1:19845/api/status')
      const data = await r.json()
      return data.serverToken ?? ''
    })

    const upload = await page.evaluate(
      async ({ caseId, token }) => {
        const form = new FormData()
        form.append('source', 'manual')
        form.append('caseId', caseId)
        form.append('url', 'https://example.com/panel-e2e')
        form.append('title', 'Panel E2E Page')
        form.append('timestamp', new Date().toISOString())
        form.append('textContent', 'Panel E2E text')
        form.append('extensionVersion', '0.1.0')
        form.append('browserVersion', 'Chrome/120')
        form.append('userAgent', 'Mozilla/5.0')
        form.append(
          'mhtml',
          new Blob(['<html><body>panel-e2e</body></html>'], { type: 'multipart/related' }),
          'capture.mhtml'
        )
        const r = await fetch('http://127.0.0.1:19845/api/captures', {
          method: 'POST',
          body: form,
          headers: { 'X-Birdbrain-Token': token }
        })
        return r.json()
      },
      { caseId, token: serverToken }
    )
    expect(upload.status).toBe('ok')

    // Make sure the renderer is sized wide enough for the expanded panel.
    const win = electronApp.windows()[0]
    await win.setViewportSize({ width: 1400, height: 900 })

    // Navigate to the captures route and select the new capture.
    await page.evaluate((caseId) => {
      window.location.hash = `/cases/${caseId}/captures`
    }, caseId)
    const item = page.getByTestId('capture-item').first()
    await item.waitFor({ timeout: 10000 })
    await item.click()

    // Panel renders expanded.
    const aside = page.getByTestId('capture-details-aside')
    await expect(aside).toBeVisible()
    await expect(aside).toHaveClass(/w-\[400px\]/)

    // Toggle favorite — the star action now lives in the header ⋯ menu and its
    // label flips from "Star" to "Unstar".
    await page.getByTestId('capture-details-actions-btn').click()
    await page.getByTestId('capture-details-star-btn').click()
    await page.getByTestId('capture-details-actions-btn').click()
    await expect(page.getByTestId('capture-details-star-btn')).toContainText('Unstar')
    await page.keyboard.press('Escape')

    // Inline note: type, blur, expect "Saved …" line.
    const textarea = page.getByTestId('inline-note-textarea')
    await textarea.fill('hello from e2e')
    await textarea.blur()
    await expect(page.getByText(/^Saved /)).toBeVisible({ timeout: 5000 })

    // Narrow viewport — panel collapses to 40px rail; expand chevron hidden.
    await win.setViewportSize({ width: 1000, height: 800 })
    await expect(aside).toHaveClass(/w-10/)
    await expect(page.getByTitle('Expand details', { exact: true })).toHaveCount(0)

    // Restore wide viewport — panel returns to expanded.
    await win.setViewportSize({ width: 1400, height: 900 })
    await expect(aside).toHaveClass(/w-\[400px\]/)
  })
})
