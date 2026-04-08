import { test, expect } from './fixtures/electronApp'

test.describe('App Lifecycle', () => {
  test('launches and shows main window', async ({ page }) => {
    // The page fixture already calls firstWindow() and waits for DOM ready.
    // Just verify it resolved to a valid page.
    expect(page).toBeTruthy()
    const title = await page.title()
    expect(title).toBe('Birdbrain')
  })

  test('dashboard renders with hero', async ({ page }) => {
    await expect(page.locator('[data-testid="dashboard"]')).toBeVisible()
    await expect(page.getByText('Welcome to')).toBeVisible()
  })

  test('new case button is visible', async ({ page }) => {
    await expect(page.locator('[data-testid="new-case-btn"]')).toBeVisible()
  })

  test('extension banner shows install button when not connected', async ({ page }) => {
    await expect(page.getByText('Install the Browser Extension')).toBeVisible()
    await expect(page.getByText('Install Extension')).toBeVisible()
  })

  test('theme toggle persists between reloads', async ({ page }) => {
    // Clear stale localStorage from prior runs (Chromium profile persists
    // across test runs even though BIRDBRAIN_USER_DATA is a fresh temp dir).
    await page.evaluate(() => localStorage.removeItem('theme'))
    await page.reload()
    await page.waitForLoadState('domcontentloaded')

    // Should start in light mode
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
