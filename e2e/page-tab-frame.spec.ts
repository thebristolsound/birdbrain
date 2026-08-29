import { test, expect } from './fixtures/electronApp'

type Page = import('@playwright/test').Page

// The Page tab's guest geometry (#465). Only a real Electron guest shows the defect:
// Electron sizes a `<webview>`'s widget from the element's box but lays the guest's
// document out against the embedder window's viewport, so a frame sized to the pane
// painted the rest of the archived page outside its own element, where an
// overflow-hidden pane clipped it and nothing could scroll to it. jsdom has no guest
// and no layout, so it can only keep the shape of the fix, not its effect.

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

function readFrame(page: Page) {
  return page.evaluate(() => {
    const pane = document.querySelector('[data-testid="mhtml-viewer-scroll"]') as HTMLElement
    const guest = document.querySelector('[data-testid="mhtml-viewer"]') as HTMLElement
    const box = guest.getBoundingClientRect()
    return {
      paneWidth: pane.clientWidth,
      paneHeight: pane.clientHeight,
      scrollWidth: pane.scrollWidth,
      scrollHeight: pane.scrollHeight,
      frameWidth: Math.round(box.width),
      frameHeight: Math.round(box.height),
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight
    }
  })
}

test.describe('Page tab guest frame', () => {
  test('sizes the guest to the window and leaves the pane able to scroll to it', async ({
    page
  }) => {
    test.setTimeout(120000)
    await page.setViewportSize({ width: 1200, height: 800 })

    await page.evaluate(() => {
      window.location.hash = '/cases/new'
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

    // Three columns are up, so the viewer pane is a fraction of the window — the
    // configuration the bug was reported in.
    const withRail = await readFrame(page)
    expect(withRail.paneWidth).toBeLessThan(withRail.windowWidth)
    expect(withRail.frameWidth).toBe(withRail.windowWidth)
    expect(withRail.frameHeight).toBe(withRail.windowHeight)
    // Everything the guest laid out is inside the frame, and the pane can reach it.
    expect(withRail.scrollWidth).toBeGreaterThanOrEqual(withRail.windowWidth)
    expect(withRail.scrollWidth).toBeGreaterThan(withRail.paneWidth)

    const maxScrollLeft = await page.evaluate(() => {
      const pane = document.querySelector('[data-testid="mhtml-viewer-scroll"]') as HTMLElement
      pane.scrollLeft = pane.scrollWidth
      return pane.scrollLeft
    })
    expect(maxScrollLeft).toBe(withRail.scrollWidth - withRail.paneWidth)

    // Collapsing the details column widens the pane; the frame still carries the
    // window's size, which is what the guest keeps laying out against.
    await page.getByRole('button', { name: 'Collapse details panel' }).first().click()
    await expect
      .poll(async () => (await readFrame(page)).paneWidth)
      .toBeGreaterThan(withRail.paneWidth)
    const collapsed = await readFrame(page)
    expect(collapsed.frameWidth).toBe(collapsed.windowWidth)
    expect(collapsed.frameHeight).toBe(collapsed.windowHeight)
  })
})
