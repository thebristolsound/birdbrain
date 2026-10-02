import { test, expect } from './fixtures/electronApp'

type Page = import('@playwright/test').Page

// A capture row with no matching selector chips must stand as tall as one with
// a chip line, so the detailed list reads as a grid of equal rows.

async function seedCapture(page: Page, caseId: string, slug: string, text: string) {
  const result = await page.evaluate(
    async ({ caseId, slug, text }) => {
      const status = await fetch('http://127.0.0.1:19845/api/status').then((r) => r.json())
      const form = new FormData()
      form.append('source', 'manual')
      form.append('caseId', caseId)
      form.append('url', `https://example.com/${slug}`)
      form.append('title', `Row ${slug}`)
      form.append('timestamp', new Date().toISOString())
      form.append('textContent', text)
      form.append('extensionVersion', '0.1.0')
      form.append('browserVersion', 'Chrome/120')
      form.append('userAgent', 'Mozilla/5.0')
      form.append(
        'mhtml',
        new Blob([`<html><body>${text}</body></html>`], { type: 'multipart/related' }),
        'capture.mhtml'
      )
      const r = await fetch('http://127.0.0.1:19845/api/captures', {
        method: 'POST',
        body: form,
        headers: { 'X-Birdbrain-Token': status.serverToken ?? '' }
      })
      return r.json()
    },
    { caseId, slug, text }
  )
  expect(result.status).toBe('ok')
}

// Layout height, not the bounding box: the list animates row layout changes
// with transforms, and a box read mid-animation reports a scaled height.
function rowHeight(page: Page, title: string): Promise<number> {
  return page
    .getByTestId('capture-item')
    .filter({ hasText: title })
    .evaluate((el) => (el as HTMLElement).offsetHeight)
}

test.describe('Capture list row height', () => {
  test('a row without selector chips matches the height of a row with them', async ({ page }) => {
    await page.evaluate(() => {
      window.location.hash = '/cases/new'
    })
    await page.waitForSelector('[data-testid="case-name-input"]', { timeout: 10000 })
    await page.fill('[data-testid="case-name-input"]', 'Row Height E2E')
    await page.click('[data-testid="case-create-btn"]')
    await page.waitForURL(/#\/cases\/.+\/overview/, { timeout: 10000 })
    const caseId = page.url().match(/cases\/([^/]+)/)![1]

    await page.evaluate(async (id) => {
      await (
        window as unknown as {
          birdbrain: { selectors: { create: (p: object) => Promise<unknown> } }
        }
      ).birdbrain.selectors.create({ caseId: id, pattern: 'acme', isRegex: false })
    }, caseId)
    await seedCapture(page, caseId, 'chipped', 'acme widgets')
    await seedCapture(page, caseId, 'plain', 'nothing to see')

    await page.evaluate((id) => {
      window.location.hash = `/cases/${id}/captures`
    }, caseId)
    const chipped = page.getByTestId('capture-item').filter({ hasText: 'Row chipped' })
    await expect(chipped.getByText('acme')).toBeVisible({ timeout: 10000 })
    await expect(page.getByTestId('capture-item').filter({ hasText: 'Row plain' })).toBeVisible()

    const withChips = await rowHeight(page, 'Row chipped')
    const withoutChips = await rowHeight(page, 'Row plain')
    console.log(`row heights: chipped=${withChips}px plain=${withoutChips}px`)
    expect(withoutChips).toBe(withChips)
  })
})
