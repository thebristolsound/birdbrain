import { test, expect } from './fixtures/electronApp'
import { SCREENSHOT_PNG_BASE64, seedCapture, serverToken } from './fixtures/seed'

async function seedCaseAndCapture(page: import('@playwright/test').Page, caseName: string) {
  await page.evaluate(() => {
    window.location.hash = '/cases/new?blank=true'
  })
  await page.waitForSelector('[data-testid="case-name-input"]', { timeout: 10000 })
  await page.fill('[data-testid="case-name-input"]', caseName)
  await page.click('[data-testid="case-create-btn"]')
  // Case creation lands on the Overview page, whose URL still carries the case id.
  await page.waitForURL(/#\/cases\/.+\/overview/, { timeout: 10000 })

  const caseIdMatch = page.url().match(/cases\/([^/]+)/)
  if (!caseIdMatch) throw new Error('case id not in url')
  const caseId = caseIdMatch[1]

  const captureId = await seedCapture(page, caseId, await serverToken(page), {
    slug: 'zoom-bar-e2e',
    title: 'Zoom Bar E2E Page',
    text: 'Zoom bar e2e',
    screenshot: SCREENSHOT_PNG_BASE64
  })

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
})
