import { test } from './fixtures/electronApp'
import { seedTitledCapture } from './fixtures/seed'

type Page = import('@playwright/test').Page

async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.evaluate((t) => {
    localStorage.setItem('theme', t)
    document.documentElement.classList.toggle('dark', t === 'dark')
  }, theme)
}

async function createCase(page: Page, name: string): Promise<string> {
  await page.evaluate(() => {
    window.location.hash = '/cases/new?blank=true'
  })
  await page.waitForSelector('[data-testid="case-name-input"]', { timeout: 10000 })
  await page.fill('[data-testid="case-name-input"]', name)
  await page.click('[data-testid="case-create-btn"]')
  await page.waitForURL(/#\/cases\/.+\/overview/, { timeout: 10000 })
  const match = page.url().match(/cases\/([^/]+)/)
  if (!match) throw new Error('case id not in url')
  return match[1]
}

test.describe('theme screenshots', () => {
  test('dashboard + case overview in both themes', async ({ page }) => {
    // Dashboard screenshots
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme)
      await page.waitForTimeout(150)
      await page.screenshot({ path: `test-results/theme-dashboard-${theme}.png`, fullPage: true })
    }

    // Seed a case with captures across two hostnames (mirrors case-overview.spec.ts)
    const caseId = await createCase(page, 'Theme Screenshot E2E')

    await seedTitledCapture(page, caseId, 'https://example.com/a', 'Alpha Capture')
    await seedTitledCapture(page, caseId, 'https://example.com/b', 'Bravo Capture')
    await seedTitledCapture(page, caseId, 'https://test.org/c', 'Charlie Capture')

    // Confirm captures landed, then navigate to overview so SourcesBlock renders
    await page.evaluate((id) => {
      window.location.hash = `/cases/${id}/captures`
    }, caseId)
    await page.waitForSelector('[data-testid="capture-item"]', { timeout: 10000 })

    await page.evaluate((id) => {
      window.location.hash = `/cases/${id}/overview`
    }, caseId)
    await page.waitForSelector('[data-testid="case-overview"]', { timeout: 10000 })
    // The link map is the last block to settle: it waits on the note-references
    // query, so shooting on `case-overview` alone can catch a half-drawn card.
    await page.waitForSelector('[data-testid="overview-map-canvas"]', { timeout: 10000 })

    // CaseOverview screenshots in both themes
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme)
      await page.waitForTimeout(150)
      await page.screenshot({ path: `test-results/theme-overview-${theme}.png`, fullPage: true })
    }
  })
})
