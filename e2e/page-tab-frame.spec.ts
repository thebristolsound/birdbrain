import { test, expect } from './fixtures/electronApp'

type Page = import('@playwright/test').Page
type ElectronApplication = import('@playwright/test').ElectronApplication

// The stored-page guest lays its page out against the pane it sits in (#1941), on both
// surfaces that mount it: the Page tab and the stored half of the Wayback tab.
//
// The guest's own layout viewport is read through the main process's debugger, because
// nothing in the renderer observes it: the guest runs with `javascript=no`, and the
// element's box says what the frame was given, not what the page laid out against.
// Window sizes are set on the BrowserWindow. `page.setViewportSize` emulates a viewport
// instead, and Playwright's own screenshot of a guest disagrees with the window's
// `capturePage()`, so neither is evidence of what the Operator sees.

// An archived page that fills its viewport, so any mismatch between the guest's layout
// viewport and its widget shows up as content nobody can reach.
const FULL_BLEED_PAGE =
  '<html><head><style>html,body{margin:0;padding:0}' +
  '#page{width:100%;height:100%;background:#c00}' +
  '</style></head><body><div id="page">archived</div></body></html>'

function mhtml(html: string): string {
  return [
    'From: <Saved by Birdbrain>',
    'Subject: Full bleed',
    'MIME-Version: 1.0',
    'Content-Type: multipart/related; type="text/html"; boundary="----BOUNDARY"',
    '',
    '------BOUNDARY',
    'Content-Type: text/html',
    'Content-ID: <frame-0>',
    'Content-Transfer-Encoding: binary',
    'Content-Location: https://example.com/full-bleed',
    '',
    html,
    '',
    '------BOUNDARY--',
    ''
  ].join('\r\n')
}

async function seedCapture(page: Page, caseId: string, token: string, body: string) {
  const result = await page.evaluate(
    async ({ caseId, token, body }) => {
      const form = new FormData()
      form.append('source', 'manual')
      form.append('caseId', caseId)
      form.append('url', 'https://example.com/full-bleed')
      form.append('title', 'Full bleed')
      form.append('timestamp', new Date().toISOString())
      form.append('textContent', 'archived')
      form.append('extensionVersion', '0.1.0')
      form.append('browserVersion', 'Chrome/120')
      form.append('userAgent', 'Mozilla/5.0')
      form.append('mhtml', new Blob([body], { type: 'multipart/related' }), 'capture.mhtml')
      const r = await fetch('http://127.0.0.1:19845/api/captures', {
        method: 'POST',
        body: form,
        headers: { 'X-Birdbrain-Token': token }
      })
      return r.json()
    },
    { caseId, token, body }
  )
  expect(result.status).toBe('ok')
}

async function resizeWindow(page: Page, electronApp: ElectronApplication, w: number, h: number) {
  await electronApp.evaluate(
    ({ BrowserWindow }, [w, h]) => {
      BrowserWindow.getAllWindows()[0].setContentSize(w, h)
    },
    [w, h]
  )
  await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([w, h])
}

function readPane(page: Page) {
  return page.evaluate(() => {
    const pane = document.querySelector('[data-testid="mhtml-viewer-pane"]') as HTMLElement
    return { width: pane.clientWidth, height: pane.clientHeight, windowWidth: innerWidth }
  })
}

// The CSS layout viewport the guest's page is laid out against.
function readGuestViewport(electronApp: ElectronApplication) {
  return electronApp.evaluate(async ({ webContents }) => {
    const guest = webContents.getAllWebContents().find((wc) => wc.getType() === 'webview')
    if (!guest) throw new Error('no guest webContents')
    guest.debugger.attach('1.3')
    try {
      const metrics = await guest.debugger.sendCommand('Page.getLayoutMetrics')
      const { clientWidth, clientHeight } = metrics.cssLayoutViewport
      return { width: clientWidth as number, height: clientHeight as number }
    } finally {
      guest.debugger.detach()
    }
  })
}

// The page is laid out against the pane, not the window: within a pixel, since the pane's
// box can be fractional and the viewport is whole.
async function expectGuestFitsPane(page: Page, electronApp: ElectronApplication, label: string) {
  const pane = await readPane(page)
  expect(pane.width, `${label}: the pane is narrower than the window`).toBeLessThan(
    pane.windowWidth
  )
  await expect
    .poll(
      async () => {
        const guest = await readGuestViewport(electronApp)
        return [Math.abs(guest.width - pane.width) <= 1, Math.abs(guest.height - pane.height) <= 1]
      },
      { message: label }
    )
    .toEqual([true, true])
  return pane
}

test.describe('stored-page guest frame', () => {
  test('lays the page out against its pane on the Page and Wayback tabs', async ({
    page,
    electronApp
  }) => {
    test.setTimeout(120000)
    await resizeWindow(page, electronApp, 1200, 800)

    await page.evaluate(() => {
      window.location.hash = '/cases/new?blank=true'
    })
    await page.waitForSelector('[data-testid="case-name-input"]', { timeout: 10000 })
    await page.fill('[data-testid="case-name-input"]', 'Page frame E2E')
    await page.click('[data-testid="case-create-btn"]')
    await page.waitForURL(/#\/cases\/.+\/overview/, { timeout: 10000 })
    const caseId = page.url().match(/cases\/([^/]+)/)![1]

    const token = await page.evaluate(async () => {
      const r = await fetch('http://127.0.0.1:19845/api/status')
      return (await r.json()).serverToken ?? ''
    })
    await seedCapture(page, caseId, token, mhtml(FULL_BLEED_PAGE))

    await page.evaluate((id) => {
      window.location.hash = `/cases/${id}/captures`
    }, caseId)
    const rows = page.getByTestId('capture-item')
    await expect(rows).toHaveCount(1, { timeout: 15000 })
    await rows.first().click()
    await page.getByRole('tab', { name: 'Page', exact: true }).click()
    await expect(page.getByTestId('mhtml-viewer')).toBeVisible({ timeout: 15000 })

    // Three columns are up, so the viewer pane is a fraction of the window: the
    // configuration both reports were made in.
    const withRail = await expectGuestFitsPane(page, electronApp, 'Page tab, details open')

    await page.getByRole('button', { name: 'Collapse details panel' }).first().click()
    await expect.poll(async () => (await readPane(page)).width).toBeGreaterThan(withRail.width)
    await expectGuestFitsPane(page, electronApp, 'Page tab, details collapsed')

    await resizeWindow(page, electronApp, 1500, 700)
    await expectGuestFitsPane(page, electronApp, 'Page tab, window resized')

    // The Wayback tab splits the viewer again; the stored half is the same guest.
    await page.getByRole('tab', { name: 'Wayback', exact: true }).click()
    await expect(page.getByTestId('wayback-compare')).toBeVisible()
    await expectGuestFitsPane(page, electronApp, 'Wayback tab')
  })
})
