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
  await page.waitForURL(/#\/cases\/.+\/captures/, { timeout: 10000 })
  await page.waitForSelector('[data-testid="case-header-name-btn"]', { timeout: 10000 })
  // The renderer's own /api/status ping flips connectedToExtension=true, which
  // would hide the getting-started panel. Force it back to false for the test.
  await page.evaluate(() => {
    type StoreState = { setConnectedToExtension: (v: boolean) => void }
    type StoreApi = { getState: () => StoreState }
    const store = (window as unknown as { __BB_APP_STORE__?: StoreApi }).__BB_APP_STORE__
    store?.getState().setConnectedToExtension(false)
  })
}

test.describe('Empty Captures State', () => {
  test('shows illustrated empty list for a fresh case', async ({ page }) => {
    await dismissOnboardingAndCreateCase(page, 'Empty State Case')

    await expect(page.locator('[data-testid="capture-list-empty-state"]')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'No captures yet' })).toBeVisible()
  })

  test('Learn more opens an in-app onboarding overlay that can be dismissed', async ({ page }) => {
    await dismissOnboardingAndCreateCase(page, 'Overlay Case')

    // The right-pane getting-started panel is hidden when connectedToExtension
    // becomes true. The renderer's own /api/status ping flips that flag,
    // racing the panel render. Click() retries up to 30s so it resolves the
    // moment the panel is mounted (before the IPC connection event lands).
    await page.click('[data-testid="captures-getting-started-learn-more-btn"]')

    const overlay = page.locator('[data-testid="onboarding-wizard"][data-mode="overlay"]')
    await expect(overlay).toBeVisible()
    await expect(overlay.getByText('Connect Extension')).toBeVisible()

    await page.click('[data-testid="onboarding-overlay-close"]')
    await expect(overlay).toBeHidden()
  })
})
