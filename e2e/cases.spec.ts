import { test, expect } from './fixtures/electronApp'

test.describe('Cases CRUD', () => {
  test('can create a new case', async ({ page }) => {
    // Open create dialog
    await page.click('[data-testid="new-case-btn"]')

    // Fill in case details
    await page.fill('[data-testid="case-name-input"]', 'Test Investigation')
    await page.fill('[data-testid="case-description-input"]', 'A test case for E2E')

    // Submit
    await page.click('[data-testid="case-create-btn"]')

    // Verify case appears on page
    await expect(page.locator('text=Test Investigation')).toBeVisible()

    // Verify we navigated to case overview
    await expect(page.locator('h1:has-text("Test Investigation")')).toBeVisible()
  })

  test('case appears in the sidebar list', async ({ page }) => {
    // Create a case first
    await page.click('[data-testid="new-case-btn"]')
    await page.fill('[data-testid="case-name-input"]', 'Listed Case')
    await page.click('[data-testid="case-create-btn"]')

    // Reload so sidebar CaseList re-mounts and fetches from DB
    await page.reload()
    await page.waitForLoadState('domcontentloaded')

    // Verify it's in the sidebar
    await expect(page.locator('[data-testid="case-item"]:has-text("Listed Case")')).toBeVisible()
  })

  test('can rename a case via context menu', async ({ page }) => {
    // Create a case
    await page.click('[data-testid="new-case-btn"]')
    await page.fill('[data-testid="case-name-input"]', 'Old Name')
    await page.click('[data-testid="case-create-btn"]')

    // Reload so sidebar shows the new case
    await page.reload()
    await page.waitForLoadState('domcontentloaded')

    // Right-click to open context menu
    await page.click('[data-testid="case-item"]:has-text("Old Name")', { button: 'right' })

    // Click rename
    await page.click('[data-testid="case-rename-btn"]')

    // Clear and type new name
    const input = page.locator('[data-testid="case-item"] input')
    await input.fill('New Name')
    await input.press('Enter')

    // Verify renamed
    await expect(page.locator('[data-testid="case-item"]:has-text("New Name")')).toBeVisible()
    await expect(page.locator('[data-testid="case-item"]:has-text("Old Name")')).not.toBeVisible()
  })

  test('can delete a case via context menu', async ({ page }) => {
    // Create a case
    await page.click('[data-testid="new-case-btn"]')
    await page.fill('[data-testid="case-name-input"]', 'Doomed Case')
    await page.click('[data-testid="case-create-btn"]')

    // Reload so sidebar shows the new case
    await page.reload()
    await page.waitForLoadState('domcontentloaded')

    // Verify it exists
    await expect(page.locator('[data-testid="case-item"]:has-text("Doomed Case")')).toBeVisible()

    // Right-click and delete
    await page.click('[data-testid="case-item"]:has-text("Doomed Case")', { button: 'right' })
    await page.click('[data-testid="case-delete-btn"]')

    // Verify removed
    await expect(page.locator('[data-testid="case-item"]:has-text("Doomed Case")')).not.toBeVisible()
  })
})
