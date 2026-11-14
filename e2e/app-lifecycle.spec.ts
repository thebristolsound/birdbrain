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

  test('theme choice persists between reloads', async ({ page }) => {
    // Should start in dark mode (Chromium profile is fresh per test via --user-data-dir).
    await page.waitForFunction(() => document.documentElement.classList.contains('dark'))

    // The theme is chosen in Settings → Appearance; the chrome carries no toggle
    // (2026-11-08 top bar).
    await page.evaluate(() => {
      window.location.hash = '/settings'
    })
    await page.getByRole('tab', { name: 'Appearance' }).click()
    await page.getByRole('button', { name: 'Light', exact: true }).click()
    await page.waitForFunction(() => !document.documentElement.classList.contains('dark'))

    // Reload and verify persistence
    await page.reload()
    await page.waitForFunction(() => !document.documentElement.classList.contains('dark'))
  })
})
