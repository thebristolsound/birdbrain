import { test, expect } from './fixtures/electronApp'

async function createCaseAndOpenCaptures(page: import('@playwright/test').Page, name: string) {
  await page.evaluate(() => {
    window.location.hash = '/cases/new'
  })
  await page.waitForSelector('[data-testid="case-name-input"]', { timeout: 10000 })
  await page.fill('[data-testid="case-name-input"]', name)
  await page.click('[data-testid="case-create-btn"]')
  // Case creation lands on the Overview; hop to the captures route, which is
  // what these empty-state tests exercise.
  await page.waitForURL(/#\/cases\/.+\/(overview|captures)/, { timeout: 10000 })
  await page.evaluate(() => {
    const m = window.location.hash.match(/#\/cases\/([^/]+)/)
    if (m) window.location.hash = `/cases/${m[1]}/captures`
  })
  await page.waitForURL(/#\/cases\/.+\/captures/, { timeout: 10000 })
  await expect(page.locator('[data-testid="topbar-case-name"]')).toContainText(name, {
    timeout: 10000
  })
}

test.describe('Empty Captures State', () => {
  test('shows the empty list for a fresh case', async ({ page }) => {
    await createCaseAndOpenCaptures(page, 'Empty State Case')

    await expect(page.locator('[data-testid="capture-list-empty-state"]')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'No captures yet' })).toBeVisible()
  })
})
