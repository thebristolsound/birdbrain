import { test, expect } from './fixtures/electronApp'
import { createCase } from './fixtures/seed'

type Page = import('@playwright/test').Page

// Moving around the app without the URL bar: the command palette's case
// switcher, the case sidebar, the dashboard's case cards, and a reload.
// onboarding-tour.spec.ts opens the palette only to replay the tour; nothing
// else drove its case list or its keyboard handling.

const palette = (page: Page) => page.getByRole('dialog', { name: 'Command palette' })

test.describe('Command palette', () => {
  test('filters cases, switches with the keyboard, and falls through to New Case', async ({
    page
  }) => {
    const alphaId = await createCase(page, 'Palette Alpha')
    const bravoId = await createCase(page, 'Palette Bravo')
    expect(page.url()).toContain(bravoId)

    await page.keyboard.press('Control+k')
    await expect(palette(page)).toBeVisible()
    const input = palette(page).getByPlaceholder('Switch case...')
    await expect(input).toBeFocused()

    // Typing filters by name, case-insensitively.
    await input.fill('alpha')
    await expect(palette(page).getByRole('button', { name: /Palette Alpha/ })).toBeVisible()
    await expect(palette(page).getByRole('button', { name: /Palette Bravo/ })).toHaveCount(0)

    // Enter opens the highlighted case on its Captures view and closes.
    await input.press('Enter')
    await expect(palette(page)).toBeHidden()
    await page.waitForURL(new RegExp(`#/cases/${alphaId}/captures`))
    await expect(page.getByTestId('topbar-case-name')).toContainText('Palette Alpha')

    // Escape closes without navigating.
    await page.keyboard.press('Control+k')
    await expect(palette(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(palette(page)).toBeHidden()
    expect(page.url()).toContain(`/cases/${alphaId}/captures`)

    // Ctrl+K toggles: a second press closes it.
    await page.keyboard.press('Control+k')
    await expect(palette(page)).toBeVisible()
    await page.keyboard.press('Control+k')
    await expect(palette(page)).toBeHidden()

    // A query that matches nothing says so, and Enter goes to New Case.
    await page.keyboard.press('Control+k')
    await palette(page).getByPlaceholder('Switch case...').fill('zzz-no-such-case')
    await expect(palette(page)).toContainText('No cases match')
    await palette(page).getByPlaceholder('Switch case...').press('Enter')
    await expect(palette(page)).toBeHidden()
    await expect(page.getByTestId('case-name-input')).toBeVisible()
  })

  test('arrow keys move the highlight and clicking outside closes', async ({ page }) => {
    await createCase(page, 'Arrow One')
    await createCase(page, 'Arrow Two')

    await page.keyboard.press('Control+k')
    const input = palette(page).getByPlaceholder('Switch case...')
    await input.fill('Arrow')
    const options = palette(page).getByRole('button', { name: /Arrow (One|Two)/ })
    await expect(options).toHaveCount(2)

    // Whichever case is listed second is the one ArrowDown then Enter opens.
    const second = (await options.nth(1).innerText()).match(/Arrow (One|Two)/)![0]
    await input.press('ArrowDown')
    await input.press('Enter')
    await expect(page.getByTestId('topbar-case-name')).toContainText(second)

    // A click on the backdrop dismisses the palette.
    await page.keyboard.press('Control+k')
    await expect(palette(page)).toBeVisible()
    await page.mouse.click(10, 10)
    await expect(palette(page)).toBeHidden()
  })
})

test.describe('Case workspace navigation', () => {
  test('the sidebar reaches every section and Home returns to the case card', async ({ page }) => {
    const caseId = await createCase(page, 'Sidebar Tour Case')
    await expect(page.getByTestId('case-overview')).toBeVisible()

    const sections: Array<{ label: string; path: string; testId: string }> = [
      { label: 'Captures', path: 'captures', testId: 'capture-list-empty-state' },
      { label: 'Notes', path: 'notes', testId: 'notes-workspace' },
      { label: 'Signals', path: 'signals', testId: 'signals-overview' },
      { label: 'Data', path: 'data', testId: 'data-explorer' },
      { label: 'Overview', path: 'overview', testId: 'case-overview' }
    ]
    for (const { label, path, testId } of sections) {
      const button = page.getByRole('button', { name: label, exact: true })
      await button.click()
      await page.waitForURL(new RegExp(`#/cases/${caseId}/${path}$`))
      await expect(page.getByTestId(testId)).toBeVisible()
      // The breadcrumb keeps naming the case on every section.
      await expect(page.getByTestId('topbar-case-name')).toContainText('Sidebar Tour Case')
    }

    // Home lands on the dashboard, where the case has a card that reopens it.
    await page.getByRole('button', { name: 'Home', exact: true }).click()
    await expect(page.getByTestId('dashboard')).toBeVisible()
    const card = page.getByTestId('case-card').filter({ hasText: 'Sidebar Tour Case' })
    await expect(card).toBeVisible()
    await card.click()
    await page.waitForURL(new RegExp(`#/cases/${caseId}/`))
    await expect(page.getByTestId('topbar-case-name')).toContainText('Sidebar Tour Case')
  })

  test('a reload keeps the section and the case', async ({ page }) => {
    const caseId = await createCase(page, 'Reload Case')
    await page.getByRole('button', { name: 'Signals', exact: true }).click()
    await page.waitForURL(new RegExp(`#/cases/${caseId}/signals$`))

    await page.reload()
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 15000 })
    await expect(page.getByTestId('signals-overview')).toBeVisible()
    expect(page.url()).toMatch(new RegExp(`#/cases/${caseId}/signals$`))
    await expect(page.getByTestId('topbar-case-name')).toContainText('Reload Case')
  })
})
