import { test, expect } from './fixtures/electronApp'
import { seedCapture, serverToken } from './fixtures/seed'

type Box = { x: number; y: number; width: number; height: number }
type Page = import('@playwright/test').Page

// The top-bar search used to sit at the window's centre on its own layer, so on
// a window about 1400px wide it covered the Capture Session switch and the REC
// indicator. It now takes its place between the two side groups.

const NAMES = ['Kestrel', 'Operation Kestrel Harbour Review of subject accounts and linked domains']

function overlapWidth(a: Box, b: Box): number {
  return Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
}

async function createCase(page: Page, name: string): Promise<string> {
  await page.evaluate(() => {
    window.location.hash = '/cases/new?blank=true'
  })
  await page.waitForSelector('[data-testid="case-name-input"]', { timeout: 10000 })
  await page.fill('[data-testid="case-name-input"]', name)
  await page.click('[data-testid="case-create-btn"]')
  await page.waitForURL(/#\/cases\/.+\/overview/, { timeout: 10000 })
  return page.url().match(/cases\/([^/]+)/)![1]
}

test.describe('Top bar layout', () => {
  test('keeps the case search clear of the side controls', async ({ electronApp, page }) => {
    test.setTimeout(120000)

    const search = page.getByTestId('global-search')
    const input = page.getByTestId('global-search-input')
    const caseName = page.getByTestId('topbar-case-name')
    const controls = page.getByTestId('topbar-controls')

    for (const name of NAMES) {
      const caseId = await createCase(page, name)

      // Stand in for a connected extension and a running session: the switch only
      // renders with an extension attached, and the REC pill only while recording.
      await electronApp.evaluate(({ BrowserWindow }, id) => {
        const { webContents } = BrowserWindow.getAllWindows()[0]
        webContents.send('event:extensionConnection', { connected: true })
        webContents.send('event:sessionStateChanged', { sessionActive: true, activeCaseId: id })
      }, caseId)
      await expect(page.getByTestId('topbar-rec')).toBeVisible({ timeout: 10000 })

      // The session switch sits in the case action bar, so the top bar's right side does
      // not grow toward the native window controls while recording. Export stays in the
      // top bar and folds to its icon on narrow windows.
      const actionBar = page.getByTestId('case-action-bar')
      await expect(actionBar.getByRole('switch', { name: 'Capture Session' })).toBeVisible()
      await expect(controls.getByRole('button', { name: /Export/ })).toBeVisible()
      await expect(controls.getByRole('switch', { name: 'Capture Session' })).toHaveCount(0)

      for (const width of [1400, 1100, 1000, 900]) {
        await electronApp.windows()[0].setViewportSize({ width, height: 800 })
        await expect(async () => {
          const searchBox = (await search.boundingBox())!
          const leftBox = (await caseName.boundingBox())!
          const rightBox = (await controls.boundingBox())!
          test.info().annotations.push({
            type: `layout@${name.length}@${width}`,
            description: JSON.stringify({
              caseName: [leftBox.x, leftBox.x + leftBox.width],
              search: [searchBox.x, searchBox.x + searchBox.width],
              controls: [rightBox.x, rightBox.x + rightBox.width]
            })
          })
          expect(overlapWidth(searchBox, leftBox)).toBeLessThanOrEqual(0)
          expect(overlapWidth(searchBox, rightBox)).toBeLessThanOrEqual(0)
        }).toPass({ timeout: 5000 })

        // Every control on the right stays inside the window, and nothing scrolls sideways.
        for (const button of await controls.getByRole('button').all()) {
          const { x, width: w } = (await button.boundingBox())!
          expect(x + w).toBeLessThanOrEqual(width)
        }
        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
        expect(scrollWidth).toBeLessThanOrEqual(width)

        // The Share pill keeps its label from 1,024px up and folds to the icon below that
        // (docs/design-handoff/2026-10-28-share-a-case/, frame G).
        const pill = controls.getByTestId('share-pill')
        await expect(pill).toHaveAttribute('data-state', 'share')
        const { width: pillWidth } = (await pill.boundingBox())!
        if (width >= 1024) expect(pillWidth).toBeGreaterThan(40)
        else expect(pillWidth).toBeLessThanOrEqual(30)

        // The text field keeps room to type, and the hint drops out below 16rem.
        const { width: inputWidth } = (await input.boundingBox())!
        expect(inputWidth).toBeGreaterThanOrEqual(80)
        const { width: searchWidth } = (await search.boundingBox())!
        await expect(search.getByText(/^(Ctrl|⌘) F$/)).toBeVisible({ visible: searchWidth >= 256 })

        // The results list keeps its own width whatever the box has shrunk to.
        await input.fill('zzq')
        const results = page.getByTestId('global-search-results')
        await expect(results).toBeVisible()
        const list = (await results.boundingBox())!
        test.info().annotations.push({
          type: `results@${name.length}@${width}`,
          description: JSON.stringify([list.x, list.x + list.width])
        })
        expect(list.width).toBeGreaterThanOrEqual(400)
        expect(list.x + list.width).toBeLessThanOrEqual(width)
        await page.getByLabel('Clear search').click()
        await expect(results).toHaveCount(0)
      }
    }

    // With the extension gone the right side is short, and the search sits at the
    // window's centre again.
    await electronApp.evaluate(({ BrowserWindow }) => {
      const { webContents } = BrowserWindow.getAllWindows()[0]
      webContents.send('event:sessionStateChanged', { sessionActive: false, activeCaseId: null })
      webContents.send('event:extensionConnection', { connected: false })
    })
    await expect(page.getByTestId('topbar-rec')).toHaveCount(0)
    await electronApp.windows()[0].setViewportSize({ width: 1400, height: 800 })
    await expect(async () => {
      const { x, width } = (await search.boundingBox())!
      expect(width).toBe(400)
      expect(Math.abs(x + width / 2 - 700)).toBeLessThanOrEqual(1)
    }).toPass({ timeout: 5000 })

    // Every state of the pill opens Members; a Case nobody shared lands on the not-shared card.
    await page.getByTestId('share-pill').click()
    await expect(page.getByTestId('not-shared-card')).toBeVisible()
    expect(await page.evaluate(() => window.location.hash)).toMatch(/#\/cases\/[^/]+\/settings$/)
  })

  test('the Export dialog covers the narrow-window details overlay', async ({
    electronApp,
    page
  }) => {
    const caseId = await createCase(page, 'Export over overlay')
    await seedCapture(page, caseId, await serverToken(page), { slug: 'export-overlay' })
    await electronApp.windows()[0].setViewportSize({ width: 1000, height: 800 })
    await page.evaluate((id) => {
      window.location.hash = `/cases/${id}/captures`
    }, caseId)
    await page.getByTestId('capture-item').first().click()
    await page.getByTitle('Show details', { exact: true }).click()
    const overlay = page.getByTestId('capture-details-overlay')
    await expect(overlay).toBeVisible()

    await page
      .getByTestId('topbar-controls')
      .getByRole('button', { name: /Export/ })
      .click()
    await page.getByRole('menuitem', { name: 'Export evidence report' }).click()
    await expect(page.getByRole('dialog', { name: 'Export case' })).toBeVisible()

    // The topmost element over the overlay belongs to the dialog's backdrop, not the overlay.
    const { x, y, width, height } = (await overlay.boundingBox())!
    const covered = await page.evaluate(
      ({ px, py }) => {
        const top = document.elementFromPoint(px, py)
        const panel = document.querySelector('[data-testid="capture-details-overlay"]')
        return !!top && !panel?.contains(top)
      },
      { px: x + width / 2, py: y + height - 20 }
    )
    expect(covered).toBe(true)
  })
})
