import { test, expect } from './fixtures/electronApp'

test.describe('Notes', () => {
  test('create, edit, search, and delete a note', async ({ page }) => {
    // Create a case via the hash router
    await page.evaluate(() => {
      window.location.hash = '/cases/new'
    })
    await page.waitForSelector('[data-testid="case-name-input"]', { timeout: 10000 })
    await page.fill('[data-testid="case-name-input"]', 'Notes E2E Case')
    await page.click('[data-testid="case-create-btn"]')
    // Case creation lands on the Overview page.
    await page.waitForURL(/#\/cases\/.+\/overview/, { timeout: 10000 })
    await expect(page.getByRole('heading', { name: 'Notes E2E Case' })).toBeVisible()

    // Navigate to Notes via the sidebar icon button
    await page.click('button[aria-label="Notes"]')
    await page.waitForURL(/#\/cases\/.+\/notes/)

    // Create a note
    await page.getByTestId('notes-new-button').click()
    await page.getByTestId('create-note-title').fill('Observation one')
    await page.getByTestId('create-note-body').fill('Something interesting about the target')
    await page.getByTestId('create-note-submit').click()

    // Note should appear
    await expect(page.getByTestId('notes-list')).toBeVisible()
    await expect(page.getByText('Observation one')).toBeVisible()
    await expect(page.getByText('Something interesting about the target')).toBeVisible()

    // Edit the note
    await page.getByTestId('note-edit').first().click()
    await page.getByTestId('note-title-input').fill('Renamed note')
    await page.getByTestId('note-save').click()
    await expect(page.getByText('Renamed note')).toBeVisible()

    // Search for a matching term
    await page.getByTestId('notes-search').fill('interesting')
    await expect(page.getByText('Renamed note')).toBeVisible()

    // Search for a non-matching term — empty state visible
    await page.getByTestId('notes-search').fill('nomatchxyz')
    await expect(page.getByText(/No notes match/)).toBeVisible()

    // Clear search — full list returns
    await page.getByTestId('notes-search').fill('')
    await expect(page.getByText('Renamed note')).toBeVisible()

    // Delete the note (requires confirmation)
    await page.getByTestId('note-delete').first().click()
    await page.getByTestId('note-confirm-delete').click()
    await expect(page.getByText('Renamed note')).not.toBeVisible()
  })
})
