import { test, expect } from './fixtures/electronApp'

const SCREENSHOT_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAIAAAD/gAIDAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAA4klEQVR4nO3QoQEA' +
  'AAiAMP9/Wl+QvmUSs7zNP8WswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzA' +
  'rMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCs' +
  'wKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzA' +
  'rMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKz9zzotw8GdFsEYhAAAAABJRU5ErkJggg=='

async function seedCaseAndCapture(page: import('@playwright/test').Page, caseName: string) {
  await page.evaluate(() => {
    window.location.hash = '/cases/new'
  })
  await page.waitForSelector('[data-testid="case-name-input"]', { timeout: 10000 })
  await page.fill('[data-testid="case-name-input"]', caseName)
  await page.click('[data-testid="case-create-btn"]')
  // Case creation lands on the Overview page, whose URL still carries the case id.
  await page.waitForURL(/#\/cases\/.+\/overview/, { timeout: 10000 })

  const caseIdMatch = page.url().match(/cases\/([^/]+)/)
  if (!caseIdMatch) throw new Error('case id not in url')
  const caseId = caseIdMatch[1]

  const captureId = await page.evaluate(
    async ({ caseId, screenshotBase64 }) => {
      const status = await fetch('http://127.0.0.1:19845/api/status').then((r) => r.json())
      const token: string = status.serverToken ?? ''
      const screenshotBytes = Uint8Array.from(atob(screenshotBase64), (c) => c.charCodeAt(0))
      const form = new FormData()
      form.append('source', 'manual')
      form.append('caseId', caseId)
      form.append('url', 'https://example.com/zoom-bar-e2e')
      form.append('title', 'Zoom Bar E2E Page')
      form.append('timestamp', new Date().toISOString())
      form.append('textContent', 'Zoom bar e2e')
      form.append('extensionVersion', '0.1.0')
      form.append('browserVersion', 'Chrome/120')
      form.append('userAgent', 'Mozilla/5.0')
      form.append(
        'mhtml',
        new Blob(['<html><body>Zoom bar e2e</body></html>'], { type: 'multipart/related' }),
        'capture.mhtml'
      )
      form.append('screenshot', new Blob([screenshotBytes], { type: 'image/png' }), 'shot.png')
      const r = await fetch('http://127.0.0.1:19845/api/captures', {
        method: 'POST',
        body: form,
        headers: { 'X-Birdbrain-Token': token }
      })
      const body = await r.json()
      if (body.status !== 'ok') throw new Error('Upload failed: ' + JSON.stringify(body))
      return body.captureId as string
    },
    { caseId, screenshotBase64: SCREENSHOT_PNG_BASE64 }
  )

  await page.evaluate(
    ({ caseId }) => {
      window.location.hash = `/cases/${caseId}/captures`
    },
    { caseId }
  )

  await page.getByTestId('capture-item').filter({ hasText: 'Zoom Bar E2E Page' }).first().click()

  return { caseId, captureId }
}

test.describe('ScreenshotZoomBar', () => {
  test('zoom in/out, fit, 1:1, hand toggle, and eye visibility', async ({ page }) => {
    await seedCaseAndCapture(page, 'Zoom Bar Basics')

    const zoomLabel = page.locator('text=/^\\d+%$/').first()
    await expect(zoomLabel).toBeVisible({ timeout: 10000 })
    const initial = await zoomLabel.textContent()
    expect(initial).toBe('100%')

    await page.getByRole('button', { name: 'Zoom in' }).click()
    await expect(zoomLabel).not.toHaveText('100%')

    await page.getByRole('button', { name: 'Zoom out' }).click()
    await page.getByRole('button', { name: 'Zoom out' }).click()
    // After two zoom-outs from a single zoom-in we should be below 100%.
    const afterOut = await zoomLabel.textContent()
    expect(afterOut).not.toBe('100%')

    await page.getByRole('button', { name: 'Fit' }).click()
    await expect(zoomLabel).toHaveText('100%')

    await page.getByRole('button', { name: '1:1' }).click()
    // 1:1 may equal 100% if image fits — accept any digit string here, just confirm no crash.
    await expect(zoomLabel).toHaveText(/^\d+%$/)

    // Hand tool persistent toggle
    const hand = page.getByRole('button', { name: 'Hand tool' })
    await expect(hand).toHaveAttribute('aria-pressed', 'false')
    await hand.click()
    await expect(hand).toHaveAttribute('aria-pressed', 'true')
    await hand.click()
    await expect(hand).toHaveAttribute('aria-pressed', 'false')

    // Eye toggle hides annotations (overlay state) — pressed=true means hidden.
    const hide = page.getByRole('button', { name: 'Hide annotations' })
    await expect(hide).toBeVisible()
    await hide.click()
    await expect(page.getByRole('button', { name: 'Show annotations' })).toBeVisible()
  })

  test('picking a draw tool auto-shows overlay and disables eye', async ({ page }) => {
    await seedCaseAndCapture(page, 'Zoom Bar Draw Auto')

    // Hide overlay first.
    await page.getByRole('button', { name: 'Hide annotations' }).click()
    await expect(page.getByRole('button', { name: 'Show annotations' })).toBeVisible()

    // Pick Rectangle — overlay should auto-show, and the eye should now be disabled.
    await page.getByRole('button', { name: 'Rectangle' }).click()
    const eye = page.getByRole('button', { name: 'Hide annotations' })
    await expect(eye).toBeVisible()
    await expect(eye).toHaveAttribute('aria-disabled', 'true')

    // Switching back to the cursor tool re-enables the eye.
    await page.getByRole('button', { name: 'Select', exact: true }).click()
    await expect(eye).toHaveAttribute('aria-disabled', 'false')
  })

  test('one-time tooltip dismisses and persists', async ({ page, electronApp }) => {
    await seedCaseAndCapture(page, 'Tooltip E2E')

    const tip = page.getByText('Drawing tools are now always live', { exact: false })
    await expect(tip).toBeVisible({ timeout: 5000 })

    await page.getByRole('button', { name: 'Dismiss tip' }).click()
    await expect(tip).toHaveCount(0)

    // Reload renderer; tooltip must stay dismissed.
    const win = electronApp.windows()[0]
    await win.reload()
    await expect(page.locator('[data-testid="topbar-case-name"]')).toContainText('Tooltip E2E', {
      timeout: 10000
    })
    await page.getByTestId('capture-item').filter({ hasText: 'Zoom Bar E2E Page' }).first().click()
    await expect(page.getByText('Drawing tools are now always live', { exact: false })).toHaveCount(
      0
    )
  })
})
