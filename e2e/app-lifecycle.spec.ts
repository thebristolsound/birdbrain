import { test, expect } from './fixtures/electronApp'

test.describe('App Lifecycle', () => {
  test('launches and shows main window', async ({ electronApp }) => {
    const page = await electronApp.firstWindow()
    expect(page).toBeTruthy()
  })

  test('window has correct title', async ({ page }) => {
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
    // App should start in light mode (no .dark class)
    const htmlClass = await page.evaluate(() => document.documentElement.className)
    expect(htmlClass).not.toContain('dark')

    // Find and click the theme toggle (Moon icon button)
    const themeToggle = page.locator('button[title="Switch to dark mode"]')
    await themeToggle.click()

    // Should now have .dark class
    const darkClass = await page.evaluate(() => document.documentElement.className)
    expect(darkClass).toContain('dark')

    // Reload and verify persistence
    await page.reload()
    await page.waitForLoadState('domcontentloaded')
    const afterReload = await page.evaluate(() => document.documentElement.className)
    expect(afterReload).toContain('dark')
  })
})
