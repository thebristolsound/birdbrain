import { test, expect } from './fixtures/electronApp'

test.describe('App Lifecycle', () => {
  test('launches and shows main window', async ({ page }) => {
    // The page fixture already calls firstWindow() and waits for DOM ready.
    // Just verify it resolved to a valid page.
    expect(page).toBeTruthy()
    const title = await page.title()
    expect(title).toBe('Birdbrain')
  })

  // The fixture seeds a settings.json, so every spec launches as an existing
  // install. That is what confines the tour to fresh installs (#404), and it is
  // why the dashboard is reachable here without dismissing anything.
  test('an existing install lands straight on the dashboard, untoured', async ({ page }) => {
    await expect(page.locator('[data-testid="dashboard"]')).toBeVisible()
    await expect(page.locator('[data-testid="onboarding-tour"]')).toBeHidden()
  })

  test('theme toggle persists between reloads', async ({ page }) => {
    // Should start in light mode (Chromium profile is fresh per test via --user-data-dir).
    await page.waitForFunction(() => !document.documentElement.classList.contains('dark'))

    // Click the theme toggle and wait for the dark class to appear
    const themeToggle = page.locator('button[title="Toggle theme"]')
    await themeToggle.click()
    await page.waitForFunction(() => document.documentElement.classList.contains('dark'))

    // Reload and verify persistence
    await page.reload()
    await page.waitForFunction(() => document.documentElement.classList.contains('dark'))
  })
})
