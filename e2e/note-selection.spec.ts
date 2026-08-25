import type { Page } from '@playwright/test'
import { test, expect } from './fixtures/electronApp'

interface SelectionBridge {
  birdbrain: {
    selectors: {
      list: (caseId: string) => Promise<
        Array<{ id: string; pattern: string; label?: string; origin?: string; enabled: boolean }>
      >
    }
    tags: {
      getForNote: (noteId: string) => Promise<Array<{ id: string; name: string }>>
    }
    notes: {
      list: (caseId: string) => Promise<Array<{ id: string; title: string }>>
    }
    onSelectorRematched: (cb: (e: { selectorIds: string[]; status: string }) => void) => () => void
  }
  __rematched?: Array<{ selectorIds: string[]; status: string }>
}

async function createCase(page: Page, name: string): Promise<string> {
  await page.evaluate(() => {
    window.location.hash = '/cases/new'
  })
  await page.waitForSelector('[data-testid="case-name-input"]', { timeout: 10000 })
  await page.fill('[data-testid="case-name-input"]', name)
  await page.click('[data-testid="case-create-btn"]')
  await page.waitForURL(/#\/cases\/.+\/overview/, { timeout: 10000 })
  return page.evaluate(() => window.location.hash.split('/')[2])
}

/**
 * Selects everything in the note body and lets the bar see it.
 *
 * Mod-A is ProseMirror's select-all inside the document, and the editor body
 * raises the bar on keyup — so this is the keyboard equivalent of dragging
 * across the passage, without depending on glyph coordinates.
 */
async function selectNoteBody(page: Page, testId: string): Promise<void> {
  await page.getByTestId(testId).click()
  await page.keyboard.press('ControlOrMeta+a')
}

test.describe('Note selection actions', () => {
  test('selection becomes a Selector with origin note and enters the lifecycle', async ({
    page
  }) => {
    const caseId = await createCase(page, 'Note Selection E2E Case')

    // Subscribed BEFORE the write: the retroactive match is asynchronous, and
    // this event is what the lifecycle emits when it finishes. Seeing it is
    // what proves the selector went through selectorLifecycle rather than
    // being written straight to the repo.
    await page.evaluate(() => {
      const w = window as unknown as SelectionBridge
      w.__rematched = []
      w.birdbrain.onSelectorRematched((e) => w.__rematched!.push(e))
    })

    await page.click('button[aria-label="Notes"]')
    await page.waitForURL(/#\/cases\/.+\/notes/)

    await page.getByTestId('notes-new-button').click()
    await page.getByTestId('create-note-title').fill('Selection observation')
    await page.getByTestId('create-note-body').fill('meridian-trust.com')

    await selectNoteBody(page, 'create-note-body')

    // The bar offers two actions here and only two — a Quote action in the
    // note editor would be a note quoting itself.
    const bar = page.getByTestId('note-selection-bar')
    await expect(bar).toBeVisible()
    await expect(bar.getByRole('button')).toHaveCount(2)

    await page.getByTestId('note-selection-selector').click()

    // Typed confirm: the classifier read the passage as a domain, and Backfill
    // states that it always runs rather than offering a choice.
    await expect(page.getByTestId('note-selection-kind')).toHaveText('domain')
    await expect(page.getByTestId('note-selection-value')).toHaveText('meridian-trust.com')
    await expect(page.getByTestId('note-selection-backfill')).toBeChecked()
    await expect(page.getByTestId('note-selection-backfill')).toBeDisabled()

    await page.getByTestId('note-selection-confirm-submit').click()
    await expect(page.getByTestId('note-selection-confirm')).toBeHidden()

    const selectors = await page.evaluate(
      (id) => (window as unknown as SelectionBridge).birdbrain.selectors.list(id),
      caseId
    )
    expect(selectors).toHaveLength(1)
    expect(selectors[0]).toMatchObject({
      pattern: 'meridian-trust.com',
      origin: 'note',
      enabled: true
    })

    await expect
      .poll(
        async () =>
          page.evaluate(
            () => (window as unknown as SelectionBridge).__rematched?.map((e) => e.status) ?? []
          ),
        { timeout: 10000 }
      )
      .toContain('done')
    const events = await page.evaluate(
      () => (window as unknown as SelectionBridge).__rematched ?? []
    )
    expect(events.some((e) => e.selectorIds.includes(selectors[0].id))).toBe(true)
  })

  test('selection becomes a Tag on the note, saving the draft on the way', async ({ page }) => {
    const caseId = await createCase(page, 'Note Tag E2E Case')

    await page.click('button[aria-label="Notes"]')
    await page.waitForURL(/#\/cases\/.+\/notes/)

    await page.getByTestId('notes-new-button').click()
    await page.getByTestId('create-note-title').fill('Tag observation')
    await page.getByTestId('create-note-body').fill('Meridian Trust')

    await selectNoteBody(page, 'create-note-body')
    await page.getByTestId('note-selection-tag').click()
    await expect(page.getByTestId('note-selection-value')).toHaveText('meridian-trust')
    await page.getByTestId('note-selection-confirm-submit').click()
    await expect(page.getByTestId('note-selection-confirm')).toBeHidden()

    // The draft had no note behind it, so the action had to write one before
    // the tag could attach — the Tag action never no-ops (#391, ruling R15).
    const tags = await page.evaluate(async (id) => {
      const bb = (window as unknown as SelectionBridge).birdbrain
      const notes = await bb.notes.list(id)
      return bb.tags.getForNote(notes[0].id)
    }, caseId)
    expect(tags.map((t) => t.name)).toEqual(['meridian-trust'])
  })
})
