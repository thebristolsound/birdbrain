import { test, expect } from './fixtures/electronApp';
test.describe('Tags tab', () => {
    test('navigate to Tags tab, create and delete tags, see usage table', async ({ page }) => {
        // Create a case via the hash router.
        await page.evaluate(() => {
            window.location.hash = '/cases/new';
        });
        await page.waitForSelector('[data-testid="case-name-input"]', { timeout: 10000 });
        await page.fill('[data-testid="case-name-input"]', 'Tags E2E Case');
        await page.click('[data-testid="case-create-btn"]');
        await page.waitForSelector('[data-testid="case-header-name-btn"]', { timeout: 10000 });
        await expect(page.locator('[data-testid="case-header-name-btn"]')).toContainText('Tags E2E Case');
        // Navigate to Tags via the sidebar icon button.
        await page.click('button[aria-label="Tags"]');
        await page.waitForURL(/#\/cases\/.+\/tags/);
        // Create a tag from the inline manager.
        await page.getByTestId('tag-name-input').fill('important');
        await page.getByTestId('tag-add-btn').click();
        // The tag list inside TagManager should show the tag.
        await expect(page.getByTestId('tag-manager')).toContainText('important');
        // The usage table should list the tag with 0 usage in this case.
        await expect(page.getByTestId('tags-usage-table')).toContainText('important');
        await expect(page.getByTestId('tag-usage-count-important')).toHaveText('0');
        // Create a second tag and confirm it also appears in the usage table.
        await page.getByTestId('tag-name-input').fill('reviewed');
        await page.getByTestId('tag-add-btn').click();
        await expect(page.getByTestId('tag-usage-count-reviewed')).toHaveText('0');
        // Delete the first tag via the manager's delete button (first row in the manager list).
        await page.getByTestId('tag-delete-btn').first().click();
        // Wait for the deleted tag to leave the usage table.
        await expect(page.getByTestId('tags-usage-table')).not.toContainText('important');
    });
});
