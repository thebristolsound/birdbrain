import { test, expect } from './fixtures/electronApp'

type Page = import('@playwright/test').Page

// Select → act → clear round trip for the inline selection bar (#396). Seeds
// three captures over the local capture server, drives the gestures the
// handoff bundle specifies, runs one non-destructive batch action and one
// destructive one, and asserts the bar leaves when the selection does.

async function seedCapture(page: Page, caseId: string, token: string, slug: string) {
  const result = await page.evaluate(
    async ({ caseId, token, slug }) => {
      const form = new FormData()
      form.append('source', 'manual')
      form.append('caseId', caseId)
      form.append('url', `https://example.com/${slug}`)
      form.append('title', `Multiselect ${slug}`)
      form.append('timestamp', new Date().toISOString())
      form.append('textContent', `multiselect ${slug}`)
      form.append('extensionVersion', '0.1.0')
      form.append('browserVersion', 'Chrome/120')
      form.append('userAgent', 'Mozilla/5.0')
      form.append(
        'mhtml',
        new Blob([`<html><body>${slug}</body></html>`], { type: 'multipart/related' }),
        'capture.mhtml'
      )
      const r = await fetch('http://127.0.0.1:19845/api/captures', {
        method: 'POST',
        body: form,
        headers: { 'X-Birdbrain-Token': token }
      })
      return r.json()
    },
    { caseId, token, slug }
  )
  expect(result.status).toBe('ok')
}

test.describe('Captures multiselect', () => {
  test('selects rows, runs batch actions and clears the bar', async ({ electronApp, page }) => {
    test.setTimeout(90000)

    await page.evaluate(() => {
      window.location.hash = '/cases/new'
    })
    await page.waitForSelector('[data-testid="case-name-input"]', { timeout: 10000 })
    await page.fill('[data-testid="case-name-input"]', 'Multiselect E2E')
    await page.click('[data-testid="case-create-btn"]')
    await page.waitForURL(/#\/cases\/.+\/overview/, { timeout: 10000 })
    const caseId = page.url().match(/cases\/([^/]+)/)![1]

    const token = await page.evaluate(async () => {
      const r = await fetch('http://127.0.0.1:19845/api/status')
      return (await r.json()).serverToken ?? ''
    })
    // Seeded oldest-first so the newest-first list shows charlie, bravo, alpha.
    for (const slug of ['alpha', 'bravo', 'charlie']) {
      await seedCapture(page, caseId, token, slug)
    }

    await electronApp.windows()[0].setViewportSize({ width: 1400, height: 900 })
    await page.evaluate((id) => {
      window.location.hash = `/cases/${id}/captures`
    }, caseId)

    const rows = page.getByTestId('capture-item')
    await expect(rows).toHaveCount(3, { timeout: 15000 })
    const bar = page.getByTestId('capture-selection-bar')

    // A plain row click is browse, not selection: the bar must stay away.
    await rows.first().click()
    await expect(bar).toBeHidden()

    // The hover checkbox is the affordance.
    await rows.first().hover()
    await rows.first().getByTestId('capture-select-checkbox').click()
    await expect(bar).toBeVisible()
    await expect(bar.getByText('1 selected')).toBeVisible()

    // cmd/ctrl-click adds a second row; shift-click extends to the third.
    await rows.nth(1).click({ modifiers: ['ControlOrMeta'] })
    await expect(bar.getByText('2 selected')).toBeVisible()
    await rows.nth(2).click({ modifiers: ['Shift'] })
    await expect(bar.getByText('3 selected')).toBeVisible()

    // Act: favorite the whole selection through the batch backend.
    await bar.getByTitle('Favorite selection').click()
    await expect
      .poll(
        async () =>
          (
            await page.evaluate(
              (id) =>
                (
                  window as unknown as {
                    birdbrain: { captures: { listFavorites: (c: string) => Promise<string[]> } }
                  }
                ).birdbrain.captures.listFavorites(id),
              caseId
            )
          ).length,
        { timeout: 10000 }
      )
      .toBe(3)

    // Clear: Escape empties the selection and the bar leaves with it.
    await page.keyboard.press('Escape')
    await expect(bar).toBeHidden()

    // Select two rows again and delete them: confirm names the count, the
    // result names what actually went, and the list shrinks to one row.
    await rows.first().hover()
    await rows.first().getByTestId('capture-select-checkbox').click()
    await rows.nth(1).click({ modifiers: ['ControlOrMeta'] })
    await expect(bar.getByText('2 selected')).toBeVisible()
    await bar.getByTitle('Delete selection').click()

    const confirm = page.getByTestId('batch-delete-confirm')
    await expect(confirm.getByText('Delete 2 captures?')).toBeVisible()
    await expect(confirm.getByText('Deleting is not redacting.')).toBeVisible()
    await confirm.getByText('Delete 2 captures', { exact: true }).click()

    const result = page.getByTestId('batch-delete-result')
    await expect(result.getByText('Deleted 2 of 2')).toBeVisible({ timeout: 15000 })
    await result.getByText('Close').click()

    await expect(rows).toHaveCount(1)
    await expect(bar).toBeHidden()
  })
})
