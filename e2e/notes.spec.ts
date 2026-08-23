import type { Page } from '@playwright/test'
import { test, expect } from './fixtures/electronApp'

interface SelectorBridge {
  birdbrain: {
    cases: { create: (p: { name: string }) => Promise<{ id: string }> }
    selectors: {
      create: (p: { caseId: string; pattern: string; label?: string }) => Promise<{ id: string }>
      update: (p: { id: string; label?: string }) => Promise<unknown>
      delete: (id: string) => Promise<boolean>
    }
  }
}

/** Seed a Selector straight at the bridge, bypassing the UI that creates them. */
async function seedSelector(
  page: Page,
  caseId: string,
  pattern: string,
  label: string
): Promise<string> {
  return page.evaluate(
    async ({ caseId, pattern, label }) => {
      const bb = (window as unknown as SelectorBridge).birdbrain
      const selector = await bb.selectors.create({ caseId, pattern, label })
      return selector.id
    },
    { caseId, pattern, label }
  )
}

/**
 * The seeds above write rows React Query knows nothing about, and the
 * autocompletes rank over that cache. Reload so the popup describes the
 * database rather than whatever was cached before the seed.
 */
async function reloadToNotes(page: Page, caseId: string): Promise<void> {
  await page.reload()
  await page.waitForSelector('[data-testid="app-ready"]', { timeout: 15000 })
  await page.evaluate((id) => {
    window.location.hash = `/cases/${id}/notes`
  }, caseId)
  await page.waitForURL(/#\/cases\/.+\/notes/, { timeout: 10000 })
}

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

  test('write a Mention, then rename and delete what it points at', async ({ page }) => {
    await page.evaluate(() => {
      window.location.hash = '/cases/new'
    })
    await page.waitForSelector('[data-testid="case-name-input"]', { timeout: 10000 })
    await page.fill('[data-testid="case-name-input"]', 'Mention E2E Case')
    await page.click('[data-testid="case-create-btn"]')
    await page.waitForURL(/#\/cases\/.+\/overview/, { timeout: 10000 })

    const caseId = await page.evaluate(() => window.location.hash.split('/')[2])

    const selectorId = await seedSelector(page, caseId, 'nightjar', 'Nightjar handle')
    // A second case's Selector, to prove the popup does not leak across cases.
    const otherCaseId = await page.evaluate(async () => {
      const bb = (window as unknown as SelectorBridge).birdbrain
      const other = await bb.cases.create({ name: 'Other Mention Case' })
      return other.id
    })
    await seedSelector(page, otherCaseId, 'kestrel', 'Kestrel handle')

    await reloadToNotes(page, caseId)

    // --- Write the Mention -------------------------------------------------
    await page.getByTestId('notes-new-button').click()
    await page.getByTestId('create-note-title').fill('Mention observation')
    // pressSequentially, not fill: fill sets the content directly and the
    // suggestion plugin never sees the trigger character typed.
    await page.getByTestId('create-note-body').click()
    await page.getByTestId('create-note-body').pressSequentially('Seen on #Night')

    const popup = page.getByTestId('mention-popup')
    await expect(popup).toBeVisible()
    await expect(popup.getByText('selectors · tags')).toBeVisible()
    await expect(page.getByTestId(`mention-option-selector-${selectorId}`)).toBeVisible()
    // Only current-case entities: the other case's Selector is not on offer.
    await expect(popup.getByText('Kestrel handle')).toHaveCount(0)

    await page.keyboard.press('Enter')
    await expect(popup).toBeHidden()

    const chip = page.locator(`[data-mention-chip][data-target-id="${selectorId}"]`)
    await expect(chip).toBeVisible()
    await expect(chip).toHaveText('#Nightjar handle')

    await page.getByTestId('create-note-submit').click()

    // The saved list row masks the Mention to prose rather than drawing a chip.
    const row = page.getByText('Seen on #Nightjar handle')
    await expect(row).toBeVisible()

    // --- Rename the target -------------------------------------------------
    await page.evaluate(async (id) => {
      const bb = (window as unknown as SelectorBridge).birdbrain
      await bb.selectors.update({ id, label: 'Renamed handle' })
    }, selectorId)
    await reloadToNotes(page, caseId)

    await expect(page.getByText('Seen on #Renamed handle')).toBeVisible()

    // --- Delete the target -------------------------------------------------
    await page.evaluate(async (id) => {
      const bb = (window as unknown as SelectorBridge).birdbrain
      await bb.selectors.delete(id)
    }, selectorId)
    await reloadToNotes(page, caseId)

    await page.getByTestId('note-edit').first().click()
    const brokenChip = page.locator(`[data-mention-broken][data-target-id="${selectorId}"]`)
    await expect(brokenChip).toBeVisible()
    await expect(brokenChip).toHaveAttribute('title', /target deleted/)
  })

  test('Escape closes the Mention popup without touching the note', async ({ page }) => {
    await page.evaluate(() => {
      window.location.hash = '/cases/new'
    })
    await page.waitForSelector('[data-testid="case-name-input"]', { timeout: 10000 })
    await page.fill('[data-testid="case-name-input"]', 'Escape E2E Case')
    await page.click('[data-testid="case-create-btn"]')
    await page.waitForURL(/#\/cases\/.+\/overview/, { timeout: 10000 })

    const caseId = await page.evaluate(() => window.location.hash.split('/')[2])
    await seedSelector(page, caseId, 'nightjar', 'Nightjar handle')
    await reloadToNotes(page, caseId)

    await page.getByTestId('notes-new-button').click()
    const body = page.getByTestId('create-note-body')
    await body.click()
    await body.pressSequentially('Seen on #Night')
    await expect(page.getByTestId('mention-popup')).toBeVisible()

    const before = await body.textContent()
    await page.keyboard.press('Escape')

    await expect(page.getByTestId('mention-popup')).toBeHidden()
    // The draft survives: Escape dismissed the popup and nothing else.
    await expect(body).toHaveText(before ?? '')
    await expect(page.getByTestId('create-note-submit')).toBeVisible()
  })
})
