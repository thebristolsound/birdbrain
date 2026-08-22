import { test, expect } from './fixtures/electronApp'

test.describe('Bulk import selectors', () => {
  test('open drawer, paste 3 patterns, verify 3 new selectors created', async ({ page }) => {
    // Create a case via the hash router.
    await page.evaluate(() => {
      window.location.hash = '/cases/new'
    })
    await page.waitForSelector('[data-testid="case-name-input"]', { timeout: 10000 })
    await page.fill('[data-testid="case-name-input"]', 'Bulk Selectors E2E')
    await page.click('[data-testid="case-create-btn"]')
    // Case creation lands on the Overview page.
    await page.waitForURL(/#\/cases\/.+\/overview/, { timeout: 10000 })
    await expect(page.getByRole('heading', { name: 'Bulk Selectors E2E' })).toBeVisible()

    // Navigate to the Signals section via the sidebar icon button.
    await page.click('button[aria-label="Signals"]')
    await page.waitForURL(/#\/cases\/.+\/signals/)

    // Open the bulk import drawer. It is inline on the Signals screen rather
    // than a modal, but it keeps the test ids and the live counts (#400).
    await page.getByTestId('bulk-add-btn').click()
    await expect(page.getByTestId('bulk-add-modal')).toBeVisible()

    // Paste 3 patterns plus a blank line plus a duplicate plus a trailing newline.
    // split('\n') on 'alpha\nbeta\n\ngamma\nalpha\n' yields 6 elements:
    //   'alpha', 'beta', '', 'gamma', 'alpha', ''
    // → 3 unique new patterns, 1 within-paste duplicate, 2 blank lines
    await page.getByTestId('bulk-add-textarea').fill('alpha\nbeta\n\ngamma\nalpha\n')

    // Live preview: 3 new, 1 duplicate, 2 blank lines (the empty middle line + trailing newline).
    await expect(page.getByTestId('bulk-add-new-count')).toHaveText('3')
    await expect(page.getByTestId('bulk-add-dup-count')).toHaveText('1')
    await expect(page.getByTestId('bulk-add-blank-count')).toHaveText('2')

    // Submit.
    await page.getByTestId('bulk-add-submit').click()

    // Drawer closes, the Selectors card shows the 3 new rows. An unlabelled
    // selector renders its pattern twice (name and sub-line), so match the
    // first occurrence rather than tripping strict mode.
    await expect(page.getByTestId('bulk-add-modal')).not.toBeVisible()
    await expect(page.getByText('alpha').first()).toBeVisible()
    await expect(page.getByText('beta').first()).toBeVisible()
    await expect(page.getByText('gamma').first()).toBeVisible()

    // Re-open the drawer and paste one already-existing pattern: 0 new, 1 dup.
    await page.getByTestId('bulk-add-btn').click()
    await page.getByTestId('bulk-add-textarea').fill('alpha')
    await expect(page.getByTestId('bulk-add-new-count')).toHaveText('0')
    await expect(page.getByTestId('bulk-add-dup-count')).toHaveText('1')
    // Import is disabled when there are 0 new patterns.
    await expect(page.getByTestId('bulk-add-submit')).toBeDisabled()
  })
})
