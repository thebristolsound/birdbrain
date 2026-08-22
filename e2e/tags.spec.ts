import { test, expect } from './fixtures/electronApp'

// Tags moved onto the Signals screen with #400/#700 — same job, same case, one
// page. The old inline manager and the separate usage table are gone; the card
// row carries the name and the per-case count together.
test.describe('Tags on the Signals screen', () => {
  test('navigate to Signals, create and delete tags, see per-case counts', async ({ page }) => {
    // Create a case via the hash router.
    await page.evaluate(() => {
      window.location.hash = '/cases/new'
    })
    await page.waitForSelector('[data-testid="case-name-input"]', { timeout: 10000 })
    await page.fill('[data-testid="case-name-input"]', 'Tags E2E Case')
    await page.click('[data-testid="case-create-btn"]')
    // Case creation lands on the Overview page.
    await page.waitForURL(/#\/cases\/.+\/overview/, { timeout: 10000 })
    await expect(page.getByRole('heading', { name: 'Tags E2E Case' })).toBeVisible()

    // Navigate to Signals via the sidebar icon button.
    await page.click('button[aria-label="Signals"]')
    await page.waitForURL(/#\/cases\/.+\/signals/)

    // Create a tag from the inline add row.
    const tagInput = page.getByTestId('add-tag-input')
    await tagInput.fill('important')
    await tagInput.press('Enter')

    const tagList = page.getByTestId('signals-tag-list')
    await expect(tagList).toContainText('important')
    // Zero captures in this case, so the row's count reads 0.
    const importantRow = tagList.locator('[data-testid^="signal-row-"]', {
      hasText: 'important'
    })
    await expect(importantRow.getByTestId('signal-count')).toHaveText('0')

    // A second tag, added without leaving the field.
    await tagInput.fill('reviewed')
    await tagInput.press('Enter')
    await expect(tagList).toContainText('reviewed')

    // Delete the first tag from its row.
    await page.getByLabel('Delete important').click()
    await expect(tagList).not.toContainText('important')
    await expect(tagList).toContainText('reviewed')
  })
})
