import { test, expect } from './fixtures/electronApp'

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
    window.location.hash = '/cases/new'
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
      await expect(page.getByRole('switch', { name: 'Capture Session' })).toBeVisible()

      // The bar drags the window, so the switch's label text has to opt out or a click
      // on it moves the window instead of toggling the session.
      const labelRegion = await page
        .getByText('Capture Session', { exact: true })
        .evaluate((el) => getComputedStyle(el).getPropertyValue('app-region'))
      expect(labelRegion).toBe('no-drag')

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
  })
})
