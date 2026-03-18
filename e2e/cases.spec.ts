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

  test('can rename a case', async ({ page }) => {
    // Create a case
    await page.click('[data-testid="new-case-btn"]')
    await page.fill('[data-testid="case-name-input"]', 'Original Name')
    await page.click('[data-testid="case-create-btn"]')
    // Wait for dialog to close before reloading
    await expect(page.locator('[data-testid="case-create-btn"]')).not.toBeVisible()

    // Go back to dashboard
    await page.reload()
    await page.waitForLoadState('domcontentloaded')

    // Hover over the case card to reveal the kebab menu
    const card = page.locator('[data-testid="case-card"]:has-text("Original Name")')
    await card.hover()

    // Open the kebab menu and click rename
    await card.locator('[data-testid="case-card-menu-btn"]').click()
    await page.click('[data-testid="case-card-rename-btn"]')

    // Wait for the inline rename input to appear
    await expect(page.locator('[data-testid="case-rename-input"]')).toBeVisible()

    // Clear and type the new name, then confirm with Enter
    await page.locator('[data-testid="case-rename-input"]').fill('Renamed Case')
    await page.locator('[data-testid="case-rename-input"]').press('Enter')

    // Verify the renamed case is visible on the dashboard
    await expect(page.locator('[data-testid="case-card"]:has-text("Renamed Case")')).toBeVisible()
    await expect(page.locator('[data-testid="case-card"]:has-text("Original Name")')).not.toBeVisible()
  })

  test('can delete a case', async ({ page }) => {
    // Create a case
    await page.click('[data-testid="new-case-btn"]')
    await page.fill('[data-testid="case-name-input"]', 'To Be Deleted')
    await page.click('[data-testid="case-create-btn"]')
    // Wait for dialog to close before reloading
    await expect(page.locator('[data-testid="case-create-btn"]')).not.toBeVisible()

    // Go back to dashboard
    await page.reload()
    await page.waitForLoadState('domcontentloaded')

    // Hover over the case card to reveal the kebab menu
    const card = page.locator('[data-testid="case-card"]:has-text("To Be Deleted")')
    await card.hover()

    // Open the kebab menu and click delete
    await card.locator('[data-testid="case-card-menu-btn"]').click()
    await page.click('[data-testid="case-card-delete-btn"]')

    // Confirm deletion
    await card.locator('[data-testid="case-card-delete-confirm-btn"]').click()

    // Verify the case is no longer visible on the dashboard
    await expect(page.locator('[data-testid="case-card"]:has-text("To Be Deleted")')).not.toBeVisible()
  })

})
