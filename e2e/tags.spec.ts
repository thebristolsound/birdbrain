import { test, expect } from './fixtures/electronApp'

test.describe('Tags CRUD', () => {
  test('can create a new tag', async ({ page }) => {
    // Open tag manager
    await page.click('[data-testid="manage-tags-btn"]')

    // Type tag name
    await page.fill('[data-testid="tag-name-input"]', 'Evidence')

    // Click add
    await page.click('[data-testid="tag-add-btn"]')

    // Verify tag appears in the manager's list
    await expect(page.locator('[data-testid="tag-manager"] >> text=Evidence')).toBeVisible()

    // Close manager and reload so sidebar TagList refetches
    await page.click('[data-testid="tag-done-btn"]')
    await page.reload()
    await page.waitForLoadState('domcontentloaded')

    // Verify tag badge appears in sidebar
    await expect(page.locator('text=Evidence')).toBeVisible()
  })

  test('can delete a tag', async ({ page }) => {
    // Open tag manager
    await page.click('[data-testid="manage-tags-btn"]')

    // Create a tag first
    await page.fill('[data-testid="tag-name-input"]', 'Temporary')
    await page.click('[data-testid="tag-add-btn"]')
    await expect(page.locator('[data-testid="tag-manager"] >> text=Temporary')).toBeVisible()

    // Delete it
    await page.click('[data-testid="tag-delete-btn"]')

    // Verify removed from manager list
    await expect(page.locator('[data-testid="tag-manager"] >> text=Temporary')).not.toBeVisible()

    // Close and verify removed from sidebar
    await page.click('[data-testid="tag-done-btn"]')
    await expect(page.locator('text=Temporary')).not.toBeVisible()
  })

  test('can create multiple tags with different colors', async ({ page }) => {
    await page.click('[data-testid="manage-tags-btn"]')

    // Create first tag (default color)
    await page.fill('[data-testid="tag-name-input"]', 'Tag One')
    await page.click('[data-testid="tag-add-btn"]')

    // Create second tag with different color
    await page.fill('[data-testid="tag-name-input"]', 'Tag Two')
    // Click second color swatch
    await page.click('[data-testid="tag-color-swatch"]:nth-child(2)')
    await page.click('[data-testid="tag-add-btn"]')

    // Verify both exist
    await expect(page.locator('[data-testid="tag-manager"] >> text=Tag One')).toBeVisible()
    await expect(page.locator('[data-testid="tag-manager"] >> text=Tag Two')).toBeVisible()

    await page.click('[data-testid="tag-done-btn"]')
  })
})
