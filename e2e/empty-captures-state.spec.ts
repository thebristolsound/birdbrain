import { test, expect } from './fixtures/electronApp'

async function createCaseAndOpenCaptures(page: import('@playwright/test').Page, name: string) {
  await page.evaluate(() => {
    window.location.hash = '/cases/new'
  })
  await page.waitForSelector('[data-testid="case-name-input"]', { timeout: 10000 })
  await page.fill('[data-testid="case-name-input"]', name)
  await page.click('[data-testid="case-create-btn"]')
  // Case creation lands on the Overview; hop to the captures route, which is
  // what these empty-state tests exercise.
  await page.waitForURL(/#\/cases\/.+\/(overview|captures)/, { timeout: 10000 })
  await page.evaluate(() => {
    const m = window.location.hash.match(/#\/cases\/([^/]+)/)
    if (m) window.location.hash = `/cases/${m[1]}/captures`
  })
  await page.waitForURL(/#\/cases\/.+\/captures/, { timeout: 10000 })
  await expect(page.locator('[data-testid="topbar-case-name"]')).toContainText(name, {
    timeout: 10000
  })
}

test.describe('Empty Captures State', () => {
  test('shows illustrated empty list and getting-started panel for a fresh case', async ({
    page
  }) => {
    await createCaseAndOpenCaptures(page, 'Empty State Case')

    await expect(page.locator('[data-testid="capture-list-empty-state"]')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'No captures yet' })).toBeVisible()

    await expect(page.locator('[data-testid="captures-getting-started"]')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Start capturing the web' })).toBeVisible()
    await expect(page.getByText('Install the browser extension')).toBeVisible()
    await expect(page.getByText('Start a capture session')).toBeVisible()
    await expect(page.getByText('Browse and investigate')).toBeVisible()
  })

  // Shrinks the window to the app minimum so the panel is taller than the pane it
  // scrolls in — the state #474 was reported from. Without that precondition the
  // panel fits, centring is harmless and the assertion would pass either way, so it
  // is asserted rather than assumed.
  test('keeps the illustration reachable when the panel overflows the pane', async ({
    electronApp,
    page
  }) => {
    await createCaseAndOpenCaptures(page, 'Clipped Illustration Case')
    await expect(page.locator('[data-testid="captures-getting-started"]')).toBeVisible()

    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].setContentSize(900, 600)
    })

    const readMetrics = () =>
      page.evaluate(() => {
        const panel = document.querySelector<HTMLElement>('[data-testid="captures-getting-started"]')
        const art = document.querySelector<HTMLElement>(
          '[data-testid="captures-getting-started-illustration"]'
        )
        if (!panel || !art) return null
        panel.scrollTop = 0
        return {
          overflowing: panel.scrollHeight > panel.clientHeight,
          topOffset: art.getBoundingClientRect().top - panel.getBoundingClientRect().top
        }
      })

    await expect.poll(async () => (await readMetrics())?.overflowing).toBe(true)

    const metrics = await readMetrics()
    // Scrolled to the top of the range, the illustration must still be below the
    // pane's top edge. Centred overflow put it ~100px above it, where no amount of
    // scrolling reaches.
    expect(metrics?.topOffset).toBeGreaterThanOrEqual(0)
  })

  test('Learn more replays the extension chapter of the tour', async ({ page }) => {
    await createCaseAndOpenCaptures(page, 'Walkthrough Case')

    await page.click('[data-testid="captures-getting-started-learn-more-btn"]')

    // The extension chapter opens on the dashboard, where its anchor lives, with
    // the install walkthrough already expanded.
    await page.waitForURL(/#\/$/, { timeout: 10000 })
    const mark = page.locator('[data-testid="tour-mark"]')
    await expect(mark).toBeVisible()
    await expect(
      mark.getByRole('heading', { name: 'The extension does the capturing' })
    ).toBeVisible()
    await expect(page.locator('[data-testid="tour-install-step"]')).toHaveCount(3)

    await page.click('[data-testid="tour-skip"]')
    await expect(page.locator('[data-testid="onboarding-tour"]')).toBeHidden()
    await expect(page.locator('[data-testid="dashboard"]')).toBeVisible()
  })
})
