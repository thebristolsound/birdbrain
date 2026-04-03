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
})
