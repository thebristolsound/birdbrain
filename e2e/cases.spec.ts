import { test, expect } from './fixtures/electronApp'

test.describe('Cases CRUD', () => {
  test('can create a new case', async ({ page }) => {
    // Click new case on dashboard
    await page.click('[data-testid="new-case-btn"]')

    // Fill in case details
    await page.fill('[data-testid="case-name-input"]', 'Test Investigation')
    await page.fill('[data-testid="case-description-input"]', 'A test case for E2E')

    // Submit
    await page.click('[data-testid="case-create-btn"]')

    // Verify case workspace loads with case name
    await expect(page.locator('text=Test Investigation')).toBeVisible()
  })

  test('case appears on dashboard after creation', async ({ page }) => {
    // Create a case
    await page.click('[data-testid="new-case-btn"]')
    await page.fill('[data-testid="case-name-input"]', 'Listed Case')
    await page.click('[data-testid="case-create-btn"]')

    // Go back to dashboard
    await page.reload()
    await page.waitForLoadState('domcontentloaded')

    // Verify case card appears on dashboard
    await expect(page.locator('[data-testid="case-card"]:has-text("Listed Case")')).toBeVisible()
  })

  // TODO: Add rename/delete to new UI (dashboard case cards or case workspace header)
  test.skip('can rename a case', async () => {
    // Rename via context menu was removed with sidebar
    // Needs to be re-implemented in the new UI
  })

  test.skip('can delete a case', async () => {
    // Delete via context menu was removed with sidebar
    // Needs to be re-implemented in the new UI
  })
})
