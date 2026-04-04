import { test, expect } from './fixtures/electronApp'

test.describe('Notes', () => {
  test('create, edit, search, and delete a note', async ({ page }) => {
    // Create a case via the dashboard wizard
    await page.click('[data-testid="new-case-btn"]')
    await page.fill('[data-testid="case-name-input"]', 'Notes E2E Case')
    await page.click('[data-testid="case-create-btn"]')
    await expect(page.getByRole('heading', { name: 'Notes E2E Case' })).toBeVisible()

    // Click the Notes tab
    await page.getByRole('link', { name: 'Notes' }).click()

    // The tab badge should exist and show 0 initially
    await expect(page.getByTestId('tab-badge-notes')).toHaveText('0')

    // Create a note
    await page.getByTestId('notes-new-button').click()
    await page.getByTestId('create-note-title').fill('Observation one')
    await page.getByTestId('create-note-body').fill('Something interesting about the target')
    await page.getByTestId('create-note-submit').click()

    // Note should appear and badge should update
    await expect(page.getByTestId('notes-list')).toBeVisible()
    await expect(page.getByText('Observation one')).toBeVisible()
    await expect(page.getByText('Something interesting about the target')).toBeVisible()
    await expect(page.getByTestId('tab-badge-notes')).toHaveText('1')

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
    await expect(page.getByTestId('tab-badge-notes')).toHaveText('0')
  })
})
