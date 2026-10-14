import { test, expect } from './fixtures/electronApp'
import { ORDINARY_CASE_NAME, SHARED_CASE_NAME } from '../scripts/dev-seed/constants'

// The profile `pnpm dev:seed` opens on: what it holds is pinned by tests/devSeed.test.ts, and this
// spec shows the built app opens it past the startup gates with both Cases listed.
test.describe('pnpm dev:seed profile', () => {
  test.use({ seeded: true })

  test('opens on the ordinary Case and lists both Cases on the dashboard', async ({ page }) => {
    // With any Case present the app reopens the most recently updated one, which the seed makes
    // the ordinary Case.
    await expect(page.getByTestId('capture-item')).toHaveCount(3, { timeout: 10000 })

    await page.getByRole('button', { name: 'Home', exact: true }).click()
    await expect(page.getByTestId('dashboard')).toBeVisible({ timeout: 10000 })
    const cards = page.getByTestId('case-card')
    await expect(cards.filter({ hasText: ORDINARY_CASE_NAME })).toBeVisible()
    await expect(cards.filter({ hasText: SHARED_CASE_NAME })).toBeVisible()
  })
})
