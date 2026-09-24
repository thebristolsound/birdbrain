import type { Page } from '@playwright/test'
import type { BirdbrainAPI } from '@shared/birdbrainApi'
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
    await page.getByTestId('note-title-input').fill('Observation one')
    await page.getByTestId('note-body-input').fill('Something interesting about the target')
    await page.getByTestId('note-body-input').blur()
    await expect(page.getByRole('status').filter({ hasText: 'Saved just now' })).toBeVisible()

    // Note should appear
    await expect(page.getByTestId('notes-list')).toBeVisible()
    await expect(page.getByText('Observation one')).toBeVisible()
    await expect(
      page.getByTestId('notes-list').getByText('Something interesting about the target')
    ).toBeVisible()

    // Edit the note
    await page.getByTestId('note-title-input').fill('Renamed note')
    await page.getByTestId('note-title-input').blur()
    await expect(page.getByRole('status').filter({ hasText: 'Saved just now' })).toBeVisible()
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
    await page.getByTestId('note-title-input').fill('Mention observation')
    // pressSequentially, not fill: fill sets the content directly and the
    // suggestion plugin never sees the trigger character typed.
    await page.getByTestId('note-body-input').click()
    await page.getByTestId('note-body-input').pressSequentially('Seen on #Night')

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

    await page.getByTestId('note-body-input').blur()
    await expect(page.getByRole('status').filter({ hasText: 'Saved just now' })).toBeVisible()

    // The saved list row masks the Mention to prose rather than drawing a chip.
    const row = page.getByTestId('notes-list').getByText('Seen on #Nightjar handle')
    await expect(row).toBeVisible()

    // --- Rename the target -------------------------------------------------
    await page.evaluate(async (id) => {
      const bb = (window as unknown as SelectorBridge).birdbrain
      await bb.selectors.update({ id, label: 'Renamed handle' })
    }, selectorId)
    await reloadToNotes(page, caseId)

    await expect(page.getByTestId('notes-list').getByText('Seen on #Renamed handle')).toBeVisible()

    // --- Delete the target -------------------------------------------------
    await page.evaluate(async (id) => {
      const bb = (window as unknown as SelectorBridge).birdbrain
      await bb.selectors.delete(id)
    }, selectorId)
    await reloadToNotes(page, caseId)

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
    const body = page.getByTestId('note-body-input')
    await body.click()
    await body.pressSequentially('Seen on #Night')
    await expect(page.getByTestId('mention-popup')).toBeVisible()

    const before = await body.textContent()
    await page.keyboard.press('Escape')

    await expect(page.getByTestId('mention-popup')).toBeHidden()
    // The draft survives: Escape dismissed the popup and nothing else.
    await expect(body).toHaveText(before ?? '')
    await expect(page.getByTestId('note-body-input')).toBeVisible()
    await body.blur()
    await expect(page.getByRole('status').filter({ hasText: 'Saved just now' })).toBeVisible()
  })
})

test('two-pane workspace keeps one editor and saves a formatted image note', async ({
  page
}, testInfo) => {
  const ids = await page.evaluate(async () => {
    const bb = (window as unknown as { birdbrain: BirdbrainAPI }).birdbrain
    const c = await bb.cases.create({ name: 'Meridian investigation' })
    const related = await bb.notes.create({
      caseId: c.id,
      title: 'Source timeline',
      body: 'Compare the registration dates and changes in page ownership.'
    })
    const active = await bb.notes.create({
      caseId: c.id,
      title: 'Working observations',
      bodyDoc: JSON.stringify({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              {
                type: 'text',
                text: 'The same handle appears across three public pages. Compare this finding with '
              },
              {
                type: 'mention',
                attrs: { targetType: 'note', targetId: related.id, label: 'Source timeline' }
              },
              { type: 'text', text: ' before drawing a conclusion.' }
            ]
          },
          { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Next steps' }] },
          {
            type: 'bulletList',
            content: [
              {
                type: 'listItem',
                content: [
                  {
                    type: 'paragraph',
                    content: [
                      {
                        type: 'text',
                        text: 'Review the archived pages and record the corroborating sources.'
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      })
    })
    await bb.notes.create({
      caseId: c.id,
      title: 'Questions to revisit',
      body: 'Which source first used the handle? Is the contact address still present?'
    })
    return { caseId: c.id, activeId: active.id }
  })
  await reloadToNotes(page, ids.caseId)
  await page.getByTestId(`note-row-${ids.activeId}`).click()
  await expect(page.getByTestId('note-body-input')).toHaveCount(1)
  const listBox = await page.getByLabel('Notes list', { exact: true }).boundingBox()
  const detailBox = await page.getByLabel('Note workspace', { exact: true }).boundingBox()
  expect(listBox?.width).toBe(320)
  expect(detailBox!.x).toBeGreaterThan(listBox!.x)
  await expect(page.getByText('3 notes in this case')).toBeVisible()
  await page.getByRole('button', { name: 'List view', exact: true }).click()
  await expect(page.getByRole('button', { name: 'List view', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await page.getByRole('button', { name: 'Detailed view', exact: true }).click()
  await page.getByTestId('note-title-input').fill('Working observations — reviewed')
  await page.getByTestId('note-title-input').blur()
  await expect(page.getByRole('status').filter({ hasText: 'Saved just now' })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('notes-workspace.png') })
  await page.getByLabel('Choose note image').setInputFiles({
    name: 'sample.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1AAAAAASUVORK5CYII=',
      'base64'
    )
  })
  await expect(page.locator('.note-editor img')).toHaveCount(1)
  await page.getByTestId('note-body-input').blur()
  await expect
    .poll(async () =>
      page.evaluate(
        async ({ caseId, activeId }) => {
          const bb = (window as unknown as { birdbrain: BirdbrainAPI }).birdbrain
          return (await bb.notes.list(caseId)).find((n) => n.id === activeId)?.bodyDoc
        },
        ids
      )
    )
    .toContain('data:image/png;base64,')
  await page.reload()
  await page.waitForSelector('[data-testid="app-ready"]')
  await page.getByTestId(`note-row-${ids.activeId}`).click()
  await expect(page.getByTestId('note-title-input')).toHaveValue('Working observations — reviewed')
  await expect(page.locator('.note-editor img')).toHaveAttribute('alt', 'sample.png')
})
