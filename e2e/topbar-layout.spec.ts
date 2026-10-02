import { test, expect } from './fixtures/electronApp'

type Box = { x: number; y: number; width: number; height: number }

// The top-bar search used to sit at the window's centre on its own layer, so on
// a window about 1400px wide it covered the Capture Session switch and the REC
// indicator. It now takes its place between the two side groups.

function overlapWidth(a: Box, b: Box): number {
  return Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
}

test.describe('Top bar layout', () => {
  test('keeps the case search clear of the side controls', async ({ electronApp, page }) => {
    test.setTimeout(60000)

    await page.evaluate(() => {
      window.location.hash = '/cases/new'
    })
    await page.waitForSelector('[data-testid="case-name-input"]', { timeout: 10000 })
    await page.fill('[data-testid="case-name-input"]', 'Operation Kestrel Harbour Review')
    await page.click('[data-testid="case-create-btn"]')
    await page.waitForURL(/#\/cases\/.+\/overview/, { timeout: 10000 })
    const caseId = page.url().match(/cases\/([^/]+)/)![1]

    // Stand in for a connected extension and a running session: the switch only
    // renders with an extension attached, and the REC pill only while recording.
    await electronApp.evaluate(({ BrowserWindow }, id) => {
      const { webContents } = BrowserWindow.getAllWindows()[0]
      webContents.send('event:extensionConnection', { connected: true })
      webContents.send('event:sessionStateChanged', { sessionActive: true, activeCaseId: id })
    }, caseId)
    await expect(page.getByTestId('topbar-rec')).toBeVisible({ timeout: 10000 })
    await expect(page.getByRole('switch', { name: 'Capture Session' })).toBeVisible()

    const search = page.getByTestId('global-search')
    const caseName = page.getByTestId('topbar-case-name')
    const controls = page.getByTestId('topbar-controls')

    for (const width of [1400, 1100, 1000]) {
      await electronApp.windows()[0].setViewportSize({ width, height: 800 })
      await expect(async () => {
        const searchBox = (await search.boundingBox())!
        const leftBox = (await caseName.boundingBox())!
        const rightBox = (await controls.boundingBox())!
        test.info().annotations.push({
          type: `layout@${width}`,
          description: JSON.stringify({
            search: [searchBox.x, searchBox.x + searchBox.width],
            caseName: [leftBox.x, leftBox.x + leftBox.width],
            controls: [rightBox.x, rightBox.x + rightBox.width]
          })
        })
        expect(overlapWidth(searchBox, leftBox)).toBeLessThanOrEqual(0)
        expect(overlapWidth(searchBox, rightBox)).toBeLessThanOrEqual(0)
      }).toPass({ timeout: 5000 })

      // The shortcut hint drops out once the box is narrower than 16rem.
      const { width: searchWidth } = (await search.boundingBox())!
      await expect(search.getByText(/^(Ctrl|⌘) F$/)).toBeVisible({ visible: searchWidth >= 256 })

      // Every control on the right stays inside the window.
      const rightBox = (await controls.boundingBox())!
      expect(rightBox.x + rightBox.width).toBeLessThanOrEqual(width)
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
