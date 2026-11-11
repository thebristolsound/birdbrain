import { test, expect } from './fixtures/electronApp'
import { seedCapture, serverToken } from './fixtures/seed'

type Box = { x: number; y: number; width: number; height: number }
type Page = import('@playwright/test').Page

// The top-bar search used to sit at the window's centre on its own layer, so on
// a window about 1400px wide it covered the Capture Session switch and the REC
// indicator. It now takes its place between the two side groups. Since the 2026-11-08
// top bar, the Case's actions (Share, Export, Launch browser, the switch and the recording
// mark) live in the Case action bar under it; the top bar keeps the status group and Settings.

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
    const actionBar = page.getByTestId('case-action-bar')

    for (const name of NAMES) {
      const caseId = await createCase(page, name)

      // Stand in for a connected extension and a running session: the switch only
      // renders with an extension attached, and the recording mark only while recording.
      // The app's own session update can land after the stand-in one, so send it until it holds.
      await expect(async () => {
        await electronApp.evaluate(({ BrowserWindow }, id) => {
          const { webContents } = BrowserWindow.getAllWindows()[0]
          webContents.send('event:extensionConnection', { connected: true })
          webContents.send('event:sessionStateChanged', { sessionActive: true, activeCaseId: id })
        }, caseId)
        // The Case's actions sit in the case action bar, so the top bar's right side does not
        // grow toward the native window controls while recording: the switch, the recording
        // mark, Export (which folds to its icon on narrow windows) and the Share pill.
        await expect(actionBar.getByTestId('topbar-rec')).toBeVisible({ timeout: 1000 })
      }).toPass({ timeout: 10000 })
      await expect(actionBar.getByRole('switch', { name: 'Capture Session' })).toBeVisible()
      await expect(actionBar.getByRole('button', { name: /Export/ })).toBeVisible()
      await expect(actionBar.getByTestId('case-action-bar-section')).toHaveText('Overview')
      await expect(controls.getByRole('switch', { name: 'Capture Session' })).toHaveCount(0)
      await expect(controls.getByRole('button', { name: /Export/ })).toHaveCount(0)
      await expect(controls.getByTestId('topbar-rec')).toHaveCount(0)
      await expect(controls.getByTestId('status-group')).toBeVisible()

      // 1,200 is the width where the design review of 2026-11-04 saw the name cut to "F.".
      for (const width of [1400, 1200, 1100, 1000, 900]) {
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

        // The case name's track keeps 160 pixels, and the name at least 64 of them, before the
        // search gives up width. Below 1,000 pixels the name hides with the full name in the
        // tooltip; never one letter.
        const nameText = caseName.getByTestId('topbar-case-name-text')
        if (width >= 1000) {
          // The text keeps its 64 pixels inside its own slot, clear of the search.
          const nameBox = (await nameText.boundingBox())!
          const slotBox = (await caseName.boundingBox())!
          expect(nameBox.width).toBeGreaterThanOrEqual(64)
          expect(nameBox.x + nameBox.width).toBeLessThanOrEqual(slotBox.x + slotBox.width + 1)
          expect(overlapWidth((await search.boundingBox())!, nameBox)).toBeLessThanOrEqual(0)
          // The long name stays on one line and is cut short; a wrapped name would not overflow.
          if (name === NAMES[1]) {
            expect(await nameText.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
          }
        } else {
          await expect(nameText).toBeHidden()
        }
        await expect
          .poll(async () => (await caseName.getAttribute('title'))?.startsWith(`${name} · `))
          .toBe(true)

        // Every control on the right stays inside the window, and nothing scrolls sideways.
        for (const button of await controls.getByRole('button').all()) {
          const { x, width: w } = (await button.boundingBox())!
          expect(x + w).toBeLessThanOrEqual(width)
        }
        const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
        expect(scrollWidth).toBeLessThanOrEqual(width)

        // The Share pill keeps its label from 1,024px up and folds to the icon below that
        // (docs/design-handoff/2026-10-28-share-a-case/, frame G), now in the action bar.
        const pill = actionBar.getByTestId('share-pill')
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

  // With a launched browser and the extension both recording, the action bar carries the
  // recording mark between Launch browser and the switch; the switch's source line gives way,
  // not the row.
  test('fits the Case action bar while a launched browser records', async ({
    electronApp,
    page
  }) => {
    const caseId = await createCase(page, NAMES[1])
    const actionBar = page.getByTestId('case-action-bar')
    // The app's own session update can land after the stand-in one, so each check sends the
    // stand-in again and confirms it holds; a bar with no session would fit trivially.
    const holdRecording = async () => {
      await electronApp.evaluate(({ BrowserWindow }, id) => {
        const { webContents } = BrowserWindow.getAllWindows()[0]
        webContents.send('event:extensionConnection', { connected: true })
        webContents.send('event:sessionStateChanged', { sessionActive: true, activeCaseId: id })
        webContents.send('event:launchedBrowserStatus', {
          state: 'open',
          browser: {
            family: 'chrome',
            label: 'Google Chrome',
            caseId: id,
            version: '149.0.7827.55',
            extensionWarnings: [],
            sessionStartedAt: Date.now() - 3_754_000,
            tabs: [{ targetId: 't1', title: 'Harbor notices', url: 'https://ferry.test/' }]
          }
        })
      }, caseId)
      await expect(actionBar.getByTestId('topbar-rec')).toContainText('Launched Google Chrome', {
        timeout: 1000
      })
      await expect(actionBar.getByTestId('session-source-line')).toContainText(
        'and the extension',
        { timeout: 1000 }
      )
    }
    const launch = actionBar.getByRole('button', { name: 'Launch browser' })
    const row = [
      actionBar.getByTestId('share-pill'),
      actionBar.getByRole('button', { name: /Export/ }),
      launch,
      actionBar.getByTestId('topbar-rec'),
      actionBar.getByRole('switch', { name: 'Capture Session' })
    ]

    for (const width of [1440, 1280, 1100, 1024]) {
      await electronApp.windows()[0].setViewportSize({ width, height: 800 })
      await expect(async () => {
        await holdRecording()
        const overflow = await actionBar.evaluate((el) => el.scrollWidth - el.clientWidth)
        expect(overflow).toBeLessThanOrEqual(0)
        const pageOverflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth
        )
        expect(pageOverflow).toBeLessThanOrEqual(0)
        // Left to right with no overlap: Share, Export, Launch browser, the mark, the switch.
        let edge = 0
        for (const item of row) {
          const { x, width: itemWidth } = (await item.boundingBox())!
          expect(x).toBeGreaterThanOrEqual(edge)
          edge = x + itemWidth
        }
        // One line: a wrapped label would double the button's height.
        expect((await launch.boundingBox())!.height).toBeLessThanOrEqual(32)
        await expect(actionBar.getByRole('switch', { name: 'Capture Session' })).toBeInViewport({
          ratio: 1
        })
      }).toPass({ timeout: 5000 })
    }
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
      .getByTestId('case-action-bar')
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
