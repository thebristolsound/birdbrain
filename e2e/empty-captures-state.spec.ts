import { test, expect } from './fixtures/electronApp'

async function dismissOnboardingAndCreateCase(page: import('@playwright/test').Page, name: string) {
  // First-run wizard: skip step 1 (extension), then create a case from step 2.
  if (await page.locator('[data-testid="onboarding-skip-btn"]').isVisible()) {
    await page.click('[data-testid="onboarding-skip-btn"]')
    await page.waitForSelector('[data-testid="onboarding-name-input"]')
    await page.fill('[data-testid="onboarding-name-input"]', name)
    await page.keyboard.press('Enter')
  } else {
    await page.evaluate(() => {
      window.location.hash = '/cases/new'
    })
    await page.waitForSelector('[data-testid="case-name-input"]', { timeout: 10000 })
    await page.fill('[data-testid="case-name-input"]', name)
    await page.click('[data-testid="case-create-btn"]')
  }
  // Case creation now lands on the Overview; hop to the captures route, which is
  // what these empty-state tests exercise.
  await page.waitForURL(/#\/cases\/.+\/(overview|captures)/, { timeout: 10000 })
  await page.evaluate(() => {
    const m = window.location.hash.match(/#\/cases\/([^/]+)/)
    if (m) window.location.hash = `/cases/${m[1]}/captures`
  })
  await page.waitForURL(/#\/cases\/.+\/captures/, { timeout: 10000 })
  await page.waitForSelector('[data-testid="case-header-name-btn"]', { timeout: 10000 })
}

test.describe('Empty Captures State', () => {
  test('shows illustrated empty list and getting-started panel for a fresh case', async ({
    page
  }) => {
    await dismissOnboardingAndCreateCase(page, 'Empty State Case')

    await expect(page.locator('[data-testid="capture-list-empty-state"]')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'No captures yet' })).toBeVisible()

    await expect(page.locator('[data-testid="captures-getting-started"]')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Start capturing the web' })).toBeVisible()
    await expect(page.getByText('Install the browser extension')).toBeVisible()
    await expect(page.getByText('Enable Auto-Capture')).toBeVisible()
    await expect(page.getByText('Browse and investigate')).toBeVisible()
  })

  test('Learn more opens an in-app onboarding overlay that can be dismissed', async ({ page }) => {
    await dismissOnboardingAndCreateCase(page, 'Overlay Case')

    await page.click('[data-testid="captures-getting-started-learn-more-btn"]')

    const overlay = page.locator('[data-testid="onboarding-wizard"][data-mode="overlay"]')
    await expect(overlay).toBeVisible()
    await expect(overlay).toHaveAttribute('role', 'dialog')
    await expect(overlay).toHaveAttribute('aria-modal', 'true')
    await expect(overlay.getByText('Connect Extension')).toBeVisible()

    // Escape key dismisses the overlay
    await page.keyboard.press('Escape')
    await expect(overlay).toBeHidden()

    // Reopen and dismiss via the close button
    await page.click('[data-testid="captures-getting-started-learn-more-btn"]')
    await expect(overlay).toBeVisible()
    await page.click('[data-testid="onboarding-overlay-close"]')
    await expect(overlay).toBeHidden()
    await expect(page.locator('[data-testid="captures-getting-started"]')).toBeVisible()
  })
})
