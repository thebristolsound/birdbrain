import { test, expect } from './fixtures/electronApp'

test.describe('Captures empty state', () => {
  test('shows the no-captures empty state on the captures tab for a new case', async ({
    page
  }) => {
    // Create a new case — this lands us on its captures tab with zero captures.
    await page.evaluate(() => {
      window.location.hash = '/cases/new'
    })
    await page.waitForSelector('[data-testid="case-name-input"]', { timeout: 10000 })
    await page.fill('[data-testid="case-name-input"]', 'Empty Captures Case')
    await page.click('[data-testid="case-create-btn"]')

    // Case workspace loaded on the captures tab.
    await page.waitForSelector('[data-testid="case-header-name-btn"]', { timeout: 10000 })
    await expect(page).toHaveURL(/#\/cases\/.+\/captures/)

    // Shared EmptyState renders with role="status" and the expected copy.
    const empty = page.getByRole('status').filter({ hasText: 'No captures yet' })
    await expect(empty).toBeVisible()
    await expect(
      page.getByText(
        /Connect the Birdbrain browser extension.*turn on Auto-Capture in the top bar/i
      )
    ).toBeVisible()
  })
})
