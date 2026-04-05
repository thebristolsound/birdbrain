import { test, expect } from './fixtures/electronApp'

test.describe('Tags tab', () => {
  test('navigate to Tags tab, create and delete tags, see usage table', async ({ page }) => {
    // Create a case via the dashboard wizard.
    await page.click('[data-testid="new-case-btn"]')
    await page.fill('[data-testid="case-name-input"]', 'Tags E2E Case')
    await page.click('[data-testid="case-create-btn"]')
    await expect(page.getByRole('heading', { name: 'Tags E2E Case' })).toBeVisible()

    // Click the Tags tab (added as a new first-class tab).
    await page.getByRole('link', { name: 'Tags' }).click()

    // Tab badge should exist and start at 0 (no tags used in this case yet).
    await expect(page.getByTestId('tab-badge-tags')).toHaveText('0')

    // Create a tag from the inline manager.
    await page.getByTestId('tag-name-input').fill('important')
    await page.getByTestId('tag-add-btn').click()

    // The tag list inside TagManager should show the tag.
    await expect(page.getByTestId('tag-manager')).toContainText('important')

    // The usage table should list the tag with 0 usage in this case.
    await expect(page.getByTestId('tags-usage-table')).toContainText('important')
    await expect(page.getByTestId('tag-usage-count-important')).toHaveText('0')

    // Badge remains 0 because no capture in this case is tagged.
    await expect(page.getByTestId('tab-badge-tags')).toHaveText('0')

    // Create a second tag and confirm it also appears in the usage table.
    await page.getByTestId('tag-name-input').fill('reviewed')
    await page.getByTestId('tag-add-btn').click()
    await expect(page.getByTestId('tag-usage-count-reviewed')).toHaveText('0')

    // Delete the first tag via the manager's delete button (first row in the manager list).
    await page.getByTestId('tag-delete-btn').first().click()
    // Wait for the deleted tag to leave the usage table.
    await expect(page.getByTestId('tags-usage-table')).not.toContainText('important')
  })
})
