import { test, expect } from './fixtures/electronApp'

test.describe('App Lifecycle', () => {
  test('launches and shows main window', async ({ electronApp }) => {
    const windows = electronApp.windows()
    expect(windows.length).toBe(1)
  })

  test('window has correct title', async ({ page }) => {
    const title = await page.title()
    expect(title).toBe('Birdbrain')
  })

  test('dashboard renders with header', async ({ page }) => {
    await expect(page.locator('[data-testid="dashboard"]')).toBeVisible()
    await expect(page.locator('text=Web investigation & capture tool')).toBeVisible()
  })

  test('sidebar is visible with cases section', async ({ page }) => {
    await expect(page.locator('[data-testid="new-case-btn"]')).toBeVisible()
  })
})
