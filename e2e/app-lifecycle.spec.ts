import { test, expect } from './fixtures/electronApp'

test.describe('App Lifecycle', () => {
  test('launches and shows main window', async ({ page }) => {
    // The page fixture already calls firstWindow() and waits for DOM ready.
    // Just verify it resolved to a valid page.
    expect(page).toBeTruthy()
    const title = await page.title()
    expect(title).toBe('Birdbrain')
  })

  test('onboarding wizard renders on first launch', async ({ page }) => {
    // With no cases, the app shows the OnboardingWizard
    await expect(page.locator('[data-testid="onboarding-wizard"]')).toBeVisible()
    await expect(page.getByText('Connect Extension')).toBeVisible()
  })

  test('onboarding wizard skip button navigates to step 2', async ({ page }) => {
    await expect(page.locator('[data-testid="onboarding-skip-btn"]')).toBeVisible()
    await page.click('[data-testid="onboarding-skip-btn"]')
    await expect(page.getByText('Create Investigation')).toBeVisible()
    await expect(page.locator('[data-testid="onboarding-name-input"]')).toBeVisible()
  })

  test('theme toggle persists between reloads', async ({ page }) => {
    // Should start in light mode (Chromium profile is fresh per test via --user-data-dir).
    await page.waitForFunction(() => !document.documentElement.classList.contains('dark'))

    // Click the theme toggle and wait for the dark class to appear
    const themeToggle = page.locator('button[title="Switch to dark mode"]')
    await themeToggle.click()
    await page.waitForFunction(() => document.documentElement.classList.contains('dark'))

    // Reload and verify persistence
    await page.reload()
    await page.waitForFunction(() => document.documentElement.classList.contains('dark'))
  })
})
