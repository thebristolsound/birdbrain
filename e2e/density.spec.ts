import { test, expect } from './fixtures/electronApp'

type Page = import('@playwright/test').Page

function rootVar(page: Page, name: string): Promise<string> {
  return page.evaluate(
    (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(),
    name
  )
}

function densityAttr(page: Page): Promise<string | null> {
  return page.evaluate(() => document.documentElement.getAttribute('data-density'))
}

function storedDensity(page: Page): Promise<string | undefined> {
  return page.evaluate(async () => {
    const settings = await (
      window as unknown as {
        birdbrain: { settings: { get: () => Promise<{ density?: string }> } }
      }
    ).birdbrain.settings.get()
    return settings.density
  })
}

async function openAppearanceTab(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.location.hash = '/settings'
  })
  await page.getByRole('tab', { name: 'Appearance' }).click()
  await page.waitForSelector('[data-testid="density-compact"]', { timeout: 10000 })
}

test.describe('UI density', () => {
  test('a fresh profile renders the compact step', async ({ page }) => {
    expect(await densityAttr(page)).toBe('compact')
    expect(await rootVar(page, '--d-pad')).toBe('12px')
    expect(await rootVar(page, '--d-row')).toBe('26px')
  })

  test('switching density re-drives the root properties without touching radius', async ({
    page
  }) => {
    await openAppearanceTab(page)
    const radiusBefore = await rootVar(page, '--radius')
    const densityRadiusBefore = await rootVar(page, '--d-r')

    await page.click('[data-testid="density-comfortable"]')
    await expect.poll(() => densityAttr(page)).toBe('comfortable')
    expect(await rootVar(page, '--d-pad')).toBe('24px')
    expect(await rootVar(page, '--d-row')).toBe('36px')

    await page.click('[data-testid="density-default"]')
    await expect.poll(() => densityAttr(page)).toBe('default')
    expect(await rootVar(page, '--d-pad')).toBe('18px')
    expect(await rootVar(page, '--d-row')).toBe('30px')

    // Radius is deliberately not a density concern: --d-r is declared once on
    // :root and inherited by every step.
    expect(await rootVar(page, '--radius')).toBe(radiusBefore)
    expect(await rootVar(page, '--d-r')).toBe(densityRadiusBefore)
  })

  test('the chosen step survives a reload and reaches the settings file', async ({ page }) => {
    await openAppearanceTab(page)
    await page.click('[data-testid="density-comfortable"]')
    await expect.poll(() => storedDensity(page)).toBe('comfortable')

    await page.reload()
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 15000 })

    // Applied before first paint by theme-init.js, so it holds on a route that
    // never mounts the Settings screen.
    expect(await densityAttr(page)).toBe('comfortable')
    expect(await rootVar(page, '--d-pad')).toBe('24px')
    expect(await storedDensity(page)).toBe('comfortable')
  })
})
