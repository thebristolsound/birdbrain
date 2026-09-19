import { test, expect } from './fixtures/electronApp'

type Page = import('@playwright/test').Page

// The top-bar search results have to paint over whatever page sits below them.
// The Data screen's sticky table header (z-[2]) used to show through the
// dropdown, because the bar's centring transform trapped the dropdown's z-50.

async function seedCapture(page: Page, caseId: string, token: string, slug: string) {
  const result = await page.evaluate(
    async ({ caseId, token, slug }) => {
      const form = new FormData()
      form.append('source', 'manual')
      form.append('caseId', caseId)
      form.append('url', `https://example.com/${slug}`)
      form.append('title', `Overlap ${slug}`)
      form.append('timestamp', new Date().toISOString())
      form.append('textContent', `overlap ${slug}`)
      form.append('extensionVersion', '0.1.0')
      form.append('browserVersion', 'Chrome/120')
      form.append('userAgent', 'Mozilla/5.0')
      form.append(
        'mhtml',
        new Blob([`<html><body>${slug}</body></html>`], { type: 'multipart/related' }),
        'capture.mhtml'
      )
      const r = await fetch('http://127.0.0.1:19845/api/captures', {
        method: 'POST',
        body: form,
        headers: { 'X-Birdbrain-Token': token }
      })
      return r.json()
    },
    { caseId, token, slug }
  )
  expect(result.status).toBe('ok')
}

test.describe('Global search dropdown', () => {
  test('paints above the Data screen table header', async ({ electronApp, page }) => {
    test.setTimeout(60000)

    await page.evaluate(() => {
      window.location.hash = '/cases/new'
    })
    await page.waitForSelector('[data-testid="case-name-input"]', { timeout: 10000 })
    await page.fill('[data-testid="case-name-input"]', 'Search Overlap E2E')
    await page.click('[data-testid="case-create-btn"]')
    await page.waitForURL(/#\/cases\/.+\/overview/, { timeout: 10000 })
    const caseId = page.url().match(/cases\/([^/]+)/)![1]

    const token = await page.evaluate(async () => {
      const r = await fetch('http://127.0.0.1:19845/api/status')
      return (await r.json()).serverToken ?? ''
    })
    for (const slug of ['alpha', 'bravo']) {
      await seedCapture(page, caseId, token, slug)
    }

    await electronApp.windows()[0].setViewportSize({ width: 1400, height: 900 })
    await page.evaluate((id) => {
      window.location.hash = `/cases/${id}/data`
    }, caseId)

    const header = page.getByTestId('artifact-table').getByRole('row').first()
    await expect(header).toBeVisible({ timeout: 15000 })

    await page.getByTestId('global-search-input').fill('Overlap')
    const results = page.getByTestId('global-search-results')
    await expect(results.getByRole('button')).toHaveCount(2, { timeout: 10000 })

    const dropdown = (await results.boundingBox())!
    const row = (await header.boundingBox())!
    const left = Math.max(dropdown.x, row.x)
    const right = Math.min(dropdown.x + dropdown.width, row.x + row.width)
    const top = Math.max(dropdown.y, row.y)
    const bottom = Math.min(dropdown.y + dropdown.height, row.y + row.height)
    expect(right).toBeGreaterThan(left)
    expect(bottom).toBeGreaterThan(top)

    const dropdownOnTop = await page.evaluate(
      ({ x, y }) =>
        Boolean(document.elementFromPoint(x, y)?.closest('[data-testid="global-search-results"]')),
      { x: (left + right) / 2, y: (top + bottom) / 2 }
    )
    expect(dropdownOnTop).toBe(true)
  })
})
