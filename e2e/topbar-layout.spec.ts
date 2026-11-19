import { test, expect } from './fixtures/electronApp'
import { seedCapture, serverToken } from './fixtures/seed'

type Box = { x: number; y: number; width: number; height: number }
type Page = import('@playwright/test').Page

// The top-bar search used to sit at the window's centre on its own layer, so on
// a window about 1400px wide it covered the Capture Session switch and the REC
// indicator. It now takes its place between the two side groups. On a Case the top bar's right
// side carries the status group, then the capture control: Launch browser at rest, the recording
// mark while a Capture Session records. Share and Export are items of the Case menu on the Case
// name, Settings is in the rail, and no row sits under the bar.

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

// One row of chrome: the Case screen starts where the top bar ends and runs to the window's
// foot, so no row sits between the two.
async function expectOneRowOfChrome(page: Page): Promise<void> {
  const bar = page.getByTestId('topbar-controls').locator('xpath=ancestor::header')
  const screen = page.getByTestId('case-workspace').locator(':scope > *').first()
  const barBox = (await bar.boundingBox())!
  const screenBox = (await screen.boundingBox())!
  const windowHeight = await page.evaluate(() => window.innerHeight)
  expect(Math.abs(screenBox.y - (barBox.y + barBox.height))).toBeLessThanOrEqual(1)
  expect(Math.abs(screenBox.y + screenBox.height - windowHeight)).toBeLessThanOrEqual(1)
}

test.describe('Top bar layout', () => {
  // The status group is wide when it names a problem, which shows an icon and a word at every
  // width, so the layout is measured with a failed Capture logged. The longest problem word is
  // "Egress unknown", and no switch makes the Egress unreadable, so the test writes that word
  // into the control in place of the failure count before it measures. A session's Capture count
  // beside the word, and the queued and held marks, are not in this measure. The VPN is left not
  // seen: that is an advisory, a ring with no word, and it sits behind the problem once one is
  // logged.
  test.beforeAll(() => {
    process.env.BIRDBRAIN_E2E_VPN = 'not-seen'
  })
  test.afterAll(() => {
    delete process.env.BIRDBRAIN_E2E_VPN
  })

  test('keeps the case search clear of the side controls', async ({ electronApp, page }) => {
    test.setTimeout(120000)

    const search = page.getByTestId('global-search')
    const input = page.getByTestId('global-search-input')
    const caseName = page.getByTestId('topbar-case-name')
    const controls = page.getByTestId('topbar-controls')
    const mark = controls.getByTestId('topbar-capture-session')

    // Before a failure is logged the advisory is the worst signal, so the Egress dot is the ring.
    // Only a real window computes its CSS: an inset shadow with no fill. Forced colours drop
    // shadows, so the ring has a border there, and the built stylesheet has to hold that rule.
    const ring = controls.getByTestId('status-dot').nth(1)
    await expect(ring).toHaveAttribute('data-severity', 'warning')
    const drawn = await ring.evaluate((el) => {
      const { boxShadow, backgroundColor } = getComputedStyle(el)
      return { boxShadow, backgroundColor }
    })
    expect(drawn.boxShadow).toMatch(/0px 0px 0px 1\.5px inset$/)
    expect(drawn.backgroundColor).toBe('rgba(0, 0, 0, 0)')
    const forcedColoursRule = await page.evaluate(() =>
      Array.from(document.styleSheets).some((sheet) =>
        Array.from(sheet.cssRules).some((rule) =>
          /@media \(forced-colors: active\)\s*\{\s*\.forced-colors\\:border-2\s*\{[^}]*border-width: 2px/.test(
            rule.cssText
          )
        )
      )
    )
    expect(forcedColoursRule).toBe(true)

    for (const name of NAMES) {
      const caseId = await createCase(page, name)

      // At rest the capture control is Launch browser and its menu.
      await expect(controls.getByRole('button', { name: 'Launch browser' })).toBeVisible()
      await expect(controls.getByRole('button', { name: 'More ways to capture' })).toBeVisible()
      await expect(mark).toHaveCount(0)

      // Stand in for a connected extension and a running session, which the mark needs.
      // The app's own session update can land after the stand-in one, so send it until it holds.
      await expect(async () => {
        await electronApp.evaluate(({ BrowserWindow }, id) => {
          const { webContents } = BrowserWindow.getAllWindows()[0]
          webContents.send('event:extensionConnection', { connected: true })
          webContents.send('event:sessionStateChanged', { sessionActive: true, activeCaseId: id })
        }, caseId)
        await expect(mark.getByTestId('topbar-rec')).toBeVisible({ timeout: 1000 })
      }).toPass({ timeout: 10000 })
      // The mark is the whole capture control while the extension records: it opens the menu
      // that holds Stop, and there is no switch and no row under the bar to hold one.
      await expect(mark.getByTestId('topbar-rec')).toContainText('extension')
      await expect(controls.getByRole('button', { name: 'Launch browser' })).toHaveCount(0)
      await expect(page.getByRole('switch')).toHaveCount(0)
      await expectOneRowOfChrome(page)
      await expect(controls.getByRole('button', { name: /Export/ })).toHaveCount(0)
      await expect(page.getByTestId('share-pill')).toHaveCount(0)
      await expect(controls.getByTestId('status-group')).toBeVisible()
      await mark.click()
      await expect(page.getByTestId('launch-control-stop')).toBeVisible()
      await expect(page.getByTestId('launch-control-start-session')).toHaveCount(0)
      await page.keyboard.press('Escape')
      await expect(page.getByRole('menu')).toHaveCount(0)
      // The state the widths below are measured in: one failed Capture per Case created so far.
      await electronApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].webContents.send('event:captureActivity', {
          type: 'failed',
          source: 'extension',
          url: 'https://ferry.test/notices',
          timestamp: new Date().toISOString(),
          error: 'stand-in failure'
        })
      })
      const statusWord = controls.getByTestId('status-word')
      await expect(statusWord).toHaveText(/^\d failed$/)
      // A stand-in for the widest state: the same control and icon, with the longest word.
      await statusWord.evaluate((el) => {
        ;(el.firstChild as Text).data = 'Egress unknown'
      })

      // The viewport emulation below leaves the native window controls' room at what the window
      // opened with, so the room Linux's three buttons take is pinned here.
      await page.addStyleTag({ content: ':root { --window-controls-right: 113px !important; }' })

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
          // A control can spill out of the group's box, so each one is checked too.
          for (const control of await controls.locator(':scope > *').all()) {
            const box = await control.boundingBox()
            if (box) expect(overlapWidth(searchBox, box)).toBeLessThanOrEqual(0)
          }
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

        // A problem's word takes room at every width, and the stand-in word is still the one
        // measured.
        await expect(statusWord).toHaveText('Egress unknown')
        const { width: wordWidth } = (await statusWord.boundingBox())!
        expect(wordWidth).toBeGreaterThan(30)
        // The recording mark is still the control that was measured, not Launch browser.
        await expect(mark.getByTestId('topbar-rec')).toBeVisible()

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

      // Back at rest for the next Case. The bar then holds the Launch browser button and its
      // menu button, which the widths above did not measure, since the mark replaces them while
      // a session records.
      await electronApp.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0].webContents.send('event:sessionStateChanged', {
          sessionActive: false,
          activeCaseId: null
        })
      })
      const launch = controls.getByRole('button', { name: 'Launch browser' })
      await expect(launch).toBeVisible()
      const labelLines = await launch.evaluate((el) => {
        const range = document.createRange()
        range.selectNodeContents(el)
        return new Set(Array.from(range.getClientRects(), (rect) => Math.round(rect.top))).size
      })
      expect(labelLines).toBe(1)
      // At rest the bar fits at the two narrowest widths: 900 pixels, and 1,000, where the
      // Case name shows again and takes its room.
      for (const width of [900, 1000]) {
        await electronApp.windows()[0].setViewportSize({ width, height: 800 })
        await expect(async () => {
          for (const button of await controls.getByRole('button').all()) {
            const { x, width: w } = (await button.boundingBox())!
            expect(x + w).toBeLessThanOrEqual(width)
          }
          const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
          expect(scrollWidth).toBeLessThanOrEqual(width)
          const launchBox = (await launch.boundingBox())!
          expect(overlapWidth((await search.boundingBox())!, launchBox)).toBeLessThanOrEqual(0)
        }).toPass({ timeout: 5000 })
      }
      await electronApp.windows()[0].setViewportSize({ width: 1400, height: 800 })
    }

    // With the extension gone, and a window wide enough that both side groups fit in their
    // halves, the search sits at the window's centre again.
    await electronApp.evaluate(({ BrowserWindow }) => {
      const { webContents } = BrowserWindow.getAllWindows()[0]
      webContents.send('event:sessionStateChanged', { sessionActive: false, activeCaseId: null })
      webContents.send('event:extensionConnection', { connected: false })
    })
    await expect(page.getByTestId('topbar-rec')).toHaveCount(0)
    await electronApp.windows()[0].setViewportSize({ width: 1700, height: 800 })
    await expect(async () => {
      const { x, width } = (await search.boundingBox())!
      expect(width).toBe(400)
      expect(Math.abs(x + width / 2 - 850)).toBeLessThanOrEqual(1)
    }).toPass({ timeout: 5000 })

    // The Case menu's sharing item opens Members; a Case nobody shared lands on the not-shared
    // card.
    await caseName.click()
    await page.getByRole('menuitem', { name: 'Share this Case…' }).click()
    await expect(page.getByTestId('not-shared-card')).toBeVisible()
    expect(await page.evaluate(() => window.location.hash)).toMatch(/#\/cases\/[^/]+\/settings$/)
  })

  // With a launched browser and the extension both recording, the capture control in the top bar
  // is the recording mark, which says the extension records too. Launch browser leaves while the
  // browser is open: the Capture Session panel names the browser and holds the one stop control.
  // The mark's third part, the Case that Captures go into when it is not the one on screen, needs
  // a launched browser's pin: opening a Case activates it, which replaces a stand-in session.
  test('fits the Case controls while a launched browser records', async ({ electronApp, page }) => {
    const caseId = await createCase(page, NAMES[1])
    const controls = page.getByTestId('topbar-controls')
    const rail = page.getByTestId('capture-session-rail')
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
      // The mark is the dot and the elapsed time. The browser's name is the panel's to give,
      // where the rail is docked; a narrower window folds the panel to a strip.
      await expect(controls.getByTestId('topbar-rec').getByRole('timer')).toBeVisible({
        timeout: 1000
      })
      await expect(controls.getByTestId('topbar-rec')).not.toContainText('Google Chrome')
      await expect(rail.or(page.getByTestId('capture-session-strip'))).toBeVisible({
        timeout: 1000
      })
      // The panel can fold to its strip between the two lines below, so the check is short and
      // the caller's retry reads the folded state.
      if (await rail.isVisible()) {
        await expect(rail).toContainText('Launched Google Chrome', { timeout: 1000 })
      }
      // The mark says the extension records too, and the bar is measured with it.
      await expect(controls.getByTestId('rec-plus-extension')).toHaveText('+ extension', {
        timeout: 1000
      })
      await expect(controls.getByRole('button', { name: 'Launch browser' })).toHaveCount(0)
      await expect(page.getByRole('switch')).toHaveCount(0)
      await expectOneRowOfChrome(page)
    }
    const row = [
      page.getByTestId('global-search'),
      controls.getByTestId('status-group'),
      controls.getByTestId('topbar-capture-session')
    ]

    for (const width of [1440, 1280, 1100, 1024]) {
      await electronApp.windows()[0].setViewportSize({ width, height: 800 })
      await expect(async () => {
        await holdRecording()
        // The top bar's right group is never narrower than its content, so it cannot scroll;
        // each of its controls is held to the window's edge instead.
        for (const control of await controls.locator(':scope > *').all()) {
          const box = await control.boundingBox()
          if (box) expect(box.x + box.width).toBeLessThanOrEqual(width)
        }
        const pageOverflow = await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth
        )
        expect(pageOverflow).toBeLessThanOrEqual(0)
        // Left to right with no overlap: the search, the status group and the mark.
        let edge = 0
        for (const item of row) {
          const { x, width: itemWidth } = (await item.boundingBox())!
          expect(x).toBeGreaterThanOrEqual(edge)
          edge = x + itemWidth
        }
        await expect(controls.getByTestId('rec-plus-extension')).toBeInViewport({ ratio: 1 })
      }).toPass({ timeout: 5000 })
    }
  })

  // On Captures the Capture Session panel is a tab of the right panel, beside the details, so
  // the screen has four columns: the rail, the list, the viewer and the one right panel. The
  // other Case screens keep the panel as a rail of its own, as the test above measures.
  test('shows the Capture Session as a tab on Captures, in four columns', async ({
    electronApp,
    page
  }) => {
    const caseId = await createCase(page, NAMES[0])
    await seedCapture(page, caseId, await serverToken(page), { slug: 'right-panel' })
    await electronApp.windows()[0].setViewportSize({ width: 1440, height: 800 })
    await page.evaluate((id) => {
      window.location.hash = `/cases/${id}/captures`
    }, caseId)
    await expect(page.getByTestId('capture-item')).toHaveCount(1, { timeout: 15000 })

    const sessionTab = page.getByRole('tab', { name: 'Capture Session' })
    const detailsTab = page.getByRole('tab', { name: 'Details' })
    // A stand-in for a launched browser recording into this Case. The app's own session update
    // can land after it, and a stale status is read again from main, which has no browser, so
    // each step sends it again.
    const sendSession = () =>
      electronApp.evaluate(({ BrowserWindow }, id) => {
        const { webContents } = BrowserWindow.getAllWindows()[0]
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
    const holdRecording = async () => {
      await sendSession()
      await expect(sessionTab.getByTestId('session-tab-rec')).toBeVisible({ timeout: 1000 })
    }
    await expect(holdRecording).toPass({ timeout: 10000 })

    // A starting session shows its tab. The panel names the browser and its version, says where
    // Captures go without repeating the Case's name, and holds the one stop control.
    await expect(sessionTab).toHaveAttribute('aria-selected', 'true')
    const panel = page.getByRole('tabpanel', { name: 'Capture Session' })
    await expect(panel).toContainText('Launched Google Chrome')
    await expect(panel).toContainText('149.0.7827.55')
    await expect(panel).toContainText('Into this Case')
    await expect(panel.getByRole('button', { name: 'Stop…' })).toBeVisible()
    await expect(panel.getByRole('list', { name: 'Tabs' })).toContainText('Harbor notices')
    await expect(page.getByRole('button', { name: 'Pop out' })).toBeVisible()

    // No Capture Session rail, strip or popped-out strip beside the screen: the dock's row holds
    // the screen alone.
    for (const id of [
      'capture-session-rail',
      'capture-session-strip',
      'capture-session-popped-out'
    ]) {
      await expect(page.getByTestId(id)).toHaveCount(0)
    }
    await expect(page.getByTestId('case-workspace').locator(':scope > div > *')).toHaveCount(1)

    // Four columns, left to right with no gap wider than a separator, ending at the window's
    // edge. The viewer keeps its 480 pixels.
    const columns = [
      page.getByRole('navigation', { name: 'Sections' }),
      page.getByTestId('capture-list'),
      page.getByTestId('capture-viewer'),
      page.getByTestId('capture-details')
    ]
    await expect(async () => {
      let edge = 0
      for (const column of columns) {
        const { x, width } = (await column.boundingBox())!
        expect(x).toBeGreaterThanOrEqual(edge - 1)
        expect(x).toBeLessThanOrEqual(edge + 8)
        edge = x + width
      }
      expect(Math.abs(edge - 1440)).toBeLessThanOrEqual(1)
      const viewer = (await columns[2].boundingBox())!
      expect(viewer.width).toBeGreaterThanOrEqual(480)
    }).toPass({ timeout: 5000 })
    await expect(page.getByTestId('capture-details-aside')).toHaveCount(1)

    // Selecting a Capture switches to Details, in the same column, and the Capture Session tab
    // keeps its recording dot.
    await page.getByTestId('capture-item').first().click()
    await expect(detailsTab).toHaveAttribute('aria-selected', 'true')
    await expect(sessionTab).toHaveAttribute('aria-selected', 'false')
    await expect(holdRecording).toPass({ timeout: 10000 })
    await expect(page.getByTestId('capture-details-aside')).toHaveCount(1)
    await expect(page.getByTestId('capture-session-rail')).toHaveCount(0)

    // Both tabs from the keyboard: the arrow keys move between them and select as they go.
    await sendSession()
    await detailsTab.focus()
    await page.keyboard.press('ArrowRight')
    await expect(sessionTab).toBeFocused()
    await expect(sessionTab).toHaveAttribute('aria-selected', 'true')
    await expect(panel.getByRole('button', { name: 'Stop…' })).toBeVisible()
    await page.keyboard.press('ArrowLeft')
    await expect(detailsTab).toBeFocused()
    await expect(detailsTab).toHaveAttribute('aria-selected', 'true')

    // The other Case screens keep the rail.
    await page.evaluate((id) => {
      window.location.hash = `/cases/${id}/notes`
    }, caseId)
    await expect(async () => {
      await sendSession()
      await expect(page.getByTestId('capture-session-rail')).toContainText(
        'Launched Google Chrome',
        { timeout: 1000 }
      )
    }).toPass({ timeout: 10000 })
  })

  // A long Egress label used to squeeze the row's name to nothing, print over it and run past
  // the popover's edge. The label gives way now, and the value's title holds it whole.
  test('keeps a long Egress label inside its status popover row', async ({ page }) => {
    const label = 'Field office relay through the harbour authority gateway, floor three'
    await page.evaluate(() => {
      window.location.hash = '/settings'
    })
    await page.getByRole('tab', { name: 'Network' }).click()
    await page.locator('input[name="egressKind"][value="proxy"]').check()
    await page.fill('#egress-proxy', 'socks5://127.0.0.1:9')
    await page.press('#egress-proxy', 'Tab')
    // Each field saves as it loses focus, so wait for one save before starting the next.
    const egressText = page.getByTestId('egress-indicator')
    await expect(egressText).toHaveAttribute('title', 'Egress: Proxy')
    await page.fill('#egress-label', label)
    await page.press('#egress-label', 'Tab')
    await expect(egressText).toHaveAttribute('title', `Egress: Proxy: ${label}`)
    await createCase(page, NAMES[0])

    await page.getByTestId('status-group').click()
    const popover = page.getByRole('dialog', { name: 'Status' })
    const row = popover.getByTestId('status-row-egress')
    await expect(row).toContainText(`Proxy: ${label}`)
    const name = row.locator(':scope > span').first()
    const value = row.locator(':scope > span').last()
    await expect(name).toHaveText('Egress')
    const nameBox = (await name.boundingBox())!
    const valueBox = (await value.boundingBox())!
    const popoverBox = (await popover.boundingBox())!
    // The name is whole, the value starts after it and ends inside the popover.
    expect(await name.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0)
    expect(nameBox.width).toBeGreaterThan(20)
    expect(valueBox.x).toBeGreaterThanOrEqual(nameBox.x + nameBox.width)
    expect(valueBox.x + valueBox.width).toBeLessThanOrEqual(popoverBox.x + popoverBox.width)
    await expect(value).toHaveAttribute('title', `Proxy: ${label}`)
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

    await page.getByTestId('topbar-case-name').click()
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

    // The dialog opens from the Case name, which comes before the search in the bar, and the
    // search keeps a layer of its own for its results. The dialog's backdrop still covers it.
    const searchBox = (await page.getByTestId('global-search').boundingBox())!
    const searchCovered = await page.evaluate(
      ({ px, py }) => {
        const top = document.elementFromPoint(px, py)
        const search = document.querySelector('[data-testid="global-search"]')
        return !!top && !search?.contains(top)
      },
      { px: searchBox.x + searchBox.width / 2, py: searchBox.y + searchBox.height / 2 }
    )
    expect(searchCovered).toBe(true)
  })
})
