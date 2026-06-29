import { test, expect } from './fixtures/electronApp'

type Page = import('@playwright/test').Page

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAIAAAD/gAIDAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAA4klEQVR4nO3QoQEA' +
  'AAiAMP9/Wl+QvmUSs7zNP8WswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzA' +
  'rMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCs' +
  'wKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzA' +
  'rMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKz9zzotw8GdFsEYhAAAAABJRU5ErkJggg=='

async function createCase(page: Page, name: string): Promise<string> {
  await page.evaluate(() => {
    window.location.hash = '/cases/new'
  })
  await page.waitForSelector('[data-testid="case-name-input"]', { timeout: 10000 })
  await page.fill('[data-testid="case-name-input"]', name)
  await page.click('[data-testid="case-create-btn"]')
  // A freshly created case lands on its Overview page.
  await page.waitForURL(/#\/cases\/.+\/overview/, { timeout: 10000 })
  const match = page.url().match(/cases\/([^/]+)/)
  if (!match) throw new Error('case id not in url')
  return match[1]
}

async function seedCapture(page: Page, caseId: string, url: string, title: string): Promise<void> {
  const ok = await page.evaluate(
    async ({ caseId, url, title, png }) => {
      const status = await fetch('http://127.0.0.1:19845/api/status').then((r) => r.json())
      const token: string = status.serverToken ?? ''
      const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0))
      const form = new FormData()
      form.append('source', 'manual')
      form.append('caseId', caseId)
      form.append('url', url)
      form.append('title', title)
      form.append('timestamp', new Date().toISOString())
      form.append('textContent', title)
      form.append('extensionVersion', '0.1.0')
      form.append('browserVersion', 'Chrome/120')
      form.append('userAgent', 'Mozilla/5.0')
      form.append(
        'mhtml',
        new Blob([`<html><body>${title}</body></html>`], { type: 'multipart/related' }),
        'capture.mhtml'
      )
      form.append('screenshot', new Blob([bytes], { type: 'image/png' }), 'shot.png')
      const r = await fetch('http://127.0.0.1:19845/api/captures', {
        method: 'POST',
        body: form,
        headers: { 'X-Birdbrain-Token': token }
      })
      const body = await r.json()
      return body.status === 'ok'
    },
    { caseId, url, title, png: PNG_BASE64 }
  )
  if (!ok) throw new Error(`capture upload failed for ${title}`)
}

test.describe('Case Overview', () => {
  test('populated case shows metric counts and recent captures', async ({ page }) => {
    const caseId = await createCase(page, 'Overview Populated E2E')

    // Three captures across two distinct hostnames.
    await seedCapture(page, caseId, 'https://example.com/a', 'Alpha Capture')
    await seedCapture(page, caseId, 'https://example.com/b', 'Bravo Capture')
    await seedCapture(page, caseId, 'https://test.org/c', 'Charlie Capture')

    // Confirm the seeded captures landed (captures route), then return to Overview
    // so it remounts against the now-populated cache.
    await page.evaluate((id) => {
      window.location.hash = `/cases/${id}/captures`
    }, caseId)
    await expect(page.getByTestId('capture-item').first()).toBeVisible({ timeout: 10000 })

    await page.evaluate((id) => {
      window.location.hash = `/cases/${id}/overview`
    }, caseId)
    await expect(page.getByTestId('case-overview')).toBeVisible({ timeout: 10000 })

    await expect(page.getByTestId('overview-metric-captures')).toHaveText('3')
    await expect(page.getByTestId('overview-metric-sources')).toHaveText('2')

    await expect(page.getByTestId('overview-recent-captures')).toBeVisible()
    await expect(page.getByTestId('overview-recent-item')).toHaveCount(3)
  })

  test('empty case renders the overview without crashing', async ({ page }) => {
    await createCase(page, 'Overview Empty E2E')

    await expect(page.getByTestId('case-overview')).toBeVisible({ timeout: 10000 })
    // Zero-state metrics render as 0 — guards the divide-by-zero / empty-array paths.
    await expect(page.getByTestId('overview-metric-captures')).toHaveText('0')
    await expect(page.getByTestId('overview-metric-sources')).toHaveText('0')
    await expect(page.getByTestId('overview-recent-captures')).toHaveCount(0)
  })
})
