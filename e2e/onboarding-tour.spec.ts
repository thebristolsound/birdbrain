import { test, expect } from './fixtures/electronApp'
import type { Page } from '@playwright/test'

type SettingsBridge = {
  birdbrain: { settings: { update: (p: object) => Promise<unknown> } }
}

/**
 * Opts this spec into the fresh-install path.
 *
 * The e2e fixture pre-writes a settings.json into every temp userData dir, so
 * every other spec launches as an existing install and is never toured. This is
 * the one that asks for it, and the reload is because a direct IPC write
 * bypasses React Query's cache.
 */
async function launchAsFreshInstall(page: Page) {
  await page.evaluate(async () => {
    await (window as unknown as SettingsBridge).birdbrain.settings.update({
      isFreshInstall: true,
      onboardingChapters: {}
    })
  })
  await page.reload()
  await page.waitForSelector('[data-testid="app-ready"]', { timeout: 15000 })
}

async function readChapters(page: Page): Promise<Record<string, boolean>> {
  return page.evaluate(async () => {
    const settings = await (
      window as unknown as {
        birdbrain: { settings: { get: () => Promise<{ onboardingChapters: object }> } }
      }
    ).birdbrain.settings.get()
    return settings.onboardingChapters as Record<string, boolean>
  })
}

test.describe('Onboarding tour', () => {
  test('a fresh install opens on the welcome card and walks the intro chapter', async ({
    page
  }) => {
    await launchAsFreshInstall(page)

    const welcome = page.locator('[data-testid="tour-welcome"]')
    await expect(welcome).toBeVisible()
    await expect(welcome.getByRole('heading', { name: 'Welcome to Birdbrain' })).toBeVisible()
    await expect(welcome.getByText('replays this tour anytime')).toBeVisible()

    await page.click('[data-testid="tour-next"]')

    // Mark 1 rings the dashboard's Start New Investigation button.
    const mark = page.locator('[data-testid="tour-mark"]')
    await expect(mark).toBeVisible()
    await expect(mark).toHaveAttribute('data-anchored', 'true')
    await expect(page.locator('[data-testid="tour-badge"]')).toHaveText('1')
    await expect(page.locator('[data-testid="tour-count"]')).toContainText('1 of 2')
    await expect(page.locator('[data-testid="tour-ring"]')).toBeVisible()

    // Mark 2 carries the install walkthrough, collapsed until asked for.
    await page.click('[data-testid="tour-next"]')
    await expect(page.locator('[data-testid="tour-count"]')).toContainText('2 of 2')
    await expect(page.locator('[data-testid="tour-install-step"]')).toHaveCount(0)
    await page.click('[data-testid="tour-install-toggle"]')
    await expect(page.locator('[data-testid="tour-install-step"]')).toHaveCount(3)

    await page.click('[data-testid="tour-next"]')
    await expect(page.locator('[data-testid="onboarding-tour"]')).toBeHidden()
    await expect.poll(() => readChapters(page)).toMatchObject({ intro: true })
  })

  test('skip ends the tour and it does not come back on the next launch', async ({ page }) => {
    await launchAsFreshInstall(page)
    await expect(page.locator('[data-testid="tour-welcome"]')).toBeVisible()

    await page.click('[data-testid="tour-skip"]')
    await expect(page.locator('[data-testid="onboarding-tour"]')).toBeHidden()

    // The ruling: skip completes every chapter, so none auto-fires again.
    await expect.poll(() => readChapters(page)).toEqual({ intro: true, ext: true, case: true })

    await page.reload()
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 15000 })
    await expect(page.locator('[data-testid="dashboard"]')).toBeVisible()
    await expect(page.locator('[data-testid="onboarding-tour"]')).toBeHidden()
  })

  test('the palette replays the walkthrough without resetting completion', async ({ page }) => {
    await launchAsFreshInstall(page)
    await page.click('[data-testid="tour-skip"]')
    await expect(page.locator('[data-testid="onboarding-tour"]')).toBeHidden()
    const before = await readChapters(page)

    await page.keyboard.press('Control+k')
    await page.click('[data-testid="palette-replay-tour"]')
    await expect(page.locator('[data-testid="tour-welcome"]')).toBeVisible()

    await page.click('[data-testid="tour-skip"]')
    await expect(page.locator('[data-testid="onboarding-tour"]')).toBeHidden()
    await expect.poll(() => readChapters(page)).toEqual(before)
  })
})
