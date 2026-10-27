import { test, expect } from './fixtures/electronApp'
import { createServer, type Server } from 'http'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { Page } from '@playwright/test'

// Two 800px chunks at load, and one more each time the sentinel scrolls into
// view, up to five: the page ends 4001px tall (five chunks and the 1px
// sentinel) once the scroll phase has loaded all of it, then stops growing.
// Each chunk ends in a dark rule, so the screenshot has content down to its
// last rows and the trailing-background trim leaves it whole.
const LAZY_PAGE = `<!doctype html><html><head><title>Lazy Growth Fixture</title><style>
  html,body{margin:0;background:#fff}
  .chunk{height:800px;box-sizing:border-box;border-bottom:4px solid #222;background:#cde}
  #sentinel{height:1px}
</style></head><body>
<div id="content"></div><div id="sentinel"></div>
<script>
  const content = document.getElementById('content')
  const add = () => { const d = document.createElement('div'); d.className = 'chunk'; content.appendChild(d) }
  add(); add()
  let added = 2
  new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting) && added < 5) { add(); added++ }
  }, { rootMargin: '100px' }).observe(document.getElementById('sentinel'))
</script>
</body></html>`
const LAZY_PAGE_HEIGHT = 4001

// Pages whose content scrolls in inner panels, not the document. Each panel
// adds a chunk when its 1px sentinel scrolls into view, so a chunk's label in
// the stored text shows the scroll phase reached the end of that panel.
const lazyPanel = (panel: string, sentinel: string, box: string, chunk: string, max: number) =>
  `(() => { let n = 0; const root = document.getElementById('${panel}')
  new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting) && n < ${max}) {
      const d = document.createElement('div'); d.style.height = '${chunk}'
      d.textContent = '${panel.toUpperCase()}LAZY' + n++
      document.getElementById('${box}').appendChild(d)
    }
  }, { root }).observe(document.getElementById('${sentinel}')) })();`

// The app-shell layout: body{height:100vh} keeps the default 8px margin, so the
// document overflows by 16px, and <main> holds the content: 2000px plus a 1px
// sentinel, growing by four 2000px chunks to 10001px.
const APP_SHELL_PAGE = `<!doctype html><html><head><title>App Shell Fixture</title></head>
<body style="height:100vh"><main id="main" style="height:100%;overflow:auto">
<div id="main-box"><div style="height:2000px">MAIN</div></div><div id="main-end" style="height:1px"></div>
</main><script>${lazyPanel('main', 'main-end', 'main-box', '2000px', 4)}</script></body></html>`

// Two panes side by side, the document not overflowing: a 2001px <nav> that
// grows by one 1000px chunk, and a 4001px <main> that grows by one 2000px chunk.
const TWO_PANE_PAGE = `<!doctype html><html><head><title>Two Pane Fixture</title></head>
<body style="margin:0;display:flex;height:100vh">
<nav id="nav" style="width:300px;height:100%;overflow:auto">
<div id="nav-box"><div style="height:2000px">NAV</div></div><div id="nav-end" style="height:1px"></div></nav>
<main id="main" style="flex:1;height:100%;overflow:auto">
<div id="main-box"><div style="height:4000px">MAIN</div></div><div id="main-end" style="height:1px"></div></main>
<script>${lazyPanel('nav', 'nav-end', 'nav-box', '1000px', 1)}
${lazyPanel('main', 'main-end', 'main-box', '2000px', 1)}</script></body></html>`

async function queueUrl(page: Page, caseName: string, url: string): Promise<string> {
  await page.evaluate(() => {
    window.location.hash = '/cases/new'
  })
  await page.waitForSelector('[data-testid="case-name-input"]', { timeout: 10000 })
  await page.fill('[data-testid="case-name-input"]', caseName)
  await page.click('[data-testid="case-create-btn"]')
  await page.waitForURL(/#\/cases\/.+\/overview/, { timeout: 10000 })
  const caseId = page.url().match(/cases\/([^/]+)/)![1]
  await page.evaluate((id) => {
    window.location.hash = `/cases/${id}/captures`
  }, caseId)
  await page.click('[data-testid="capture-menu-btn"]')
  await page.click('[data-testid="capture-menu-paste-urls"]')
  await page.waitForSelector('[data-testid="add-urls-input"]', { timeout: 10000 })
  await page.fill('[data-testid="add-urls-input"]', url)
  await page.click('[data-testid="add-urls-submit"]')
  await page.keyboard.press('Escape')
  return caseId
}

async function lastCaptureEntry(page: Page, caseId: string): Promise<Record<string, unknown>> {
  const storagePath = await page.evaluate(async () => {
    const w = window as unknown as {
      birdbrain: { settings: { get: () => Promise<{ storagePath: string }> } }
    }
    return (await w.birdbrain.settings.get()).storagePath
  })
  const entries = readFileSync(join(storagePath, caseId, 'manifest.jsonl'), 'utf-8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as Record<string, unknown>)
  return entries.filter((entry) => entry.type === 'capture').at(-1)!
}

// End-to-end background recapture: serve a fixture page from a local HTTP
// server, queue it via the Add URLs box, and assert the capture lands with
// background provenance, a screenshot, and a verifiable manifest chain.
test.describe('Recapture (background capture)', () => {
  let server: Server
  let baseUrl: string

  test.beforeAll(async () => {
    server = createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      const fixtures: Record<string, string> = {
        '/lazy': LAZY_PAGE,
        '/app-shell': APP_SHELL_PAGE,
        '/two-pane': TWO_PANE_PAGE
      }
      if (req.url && fixtures[req.url]) {
        res.end(fixtures[req.url])
        return
      }
      res.end(
        '<html><head><title>Recapture Fixture</title></head>' +
          '<body><h1>Recapture fixture page</h1><p>stable content</p></body></html>'
      )
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const addr = server.address()
    baseUrl = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : ''
    // The fixture is served on 127.0.0.1, which a background capture refuses unless an
    // unpackaged build is launched with this switch (#1726). Set before the app launches.
    process.env.BIRDBRAIN_E2E_ALLOW_LOOPBACK = '1'
  })

  test.afterAll(async () => {
    delete process.env.BIRDBRAIN_E2E_ALLOW_LOOPBACK
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  test('captures a URL in the background with full provenance', async ({ page }) => {
    // Two sequential background renders, each allowed up to 60s below; the
    // default 30s per-test cap would undercut them on a slow CI runner.
    test.setTimeout(150000)

    // Create a case (same flow as mhtml-capture.spec.ts)
    await page.evaluate(() => {
      window.location.hash = '/cases/new'
    })
    await page.waitForSelector('[data-testid="case-name-input"]', { timeout: 10000 })
    await page.fill('[data-testid="case-name-input"]', 'Recapture E2E')
    await page.click('[data-testid="case-create-btn"]')
    await page.waitForURL(/#\/cases\/.+\/overview/, { timeout: 10000 })
    const caseId = page.url().match(/cases\/([^/]+)/)![1]

    // Navigate to the Captures tab and queue the fixture URL
    await page.evaluate((id) => {
      window.location.hash = `/cases/${id}/captures`
    }, caseId)
    // The paste-URLs box now lives in the top-bar Capture menu dialog.
    await page.click('[data-testid="capture-menu-btn"]')
    await page.click('[data-testid="capture-menu-paste-urls"]')
    await page.waitForSelector('[data-testid="add-urls-input"]', { timeout: 10000 })
    await page.fill('[data-testid="add-urls-input"]', `${baseUrl}/page`)
    await page.click('[data-testid="add-urls-submit"]')
    // Close the dialog so it doesn't overlay the capture list.
    await page.keyboard.press('Escape')

    // The capture appears in the list when the background job completes
    await expect(page.getByText('Recapture Fixture')).toBeVisible({ timeout: 60000 })

    // Provenance: background method + supersedes-free + verified chain
    const capture = await page.evaluate(async (id) => {
      const w = window as unknown as {
        birdbrain: {
          captures: {
            list: (caseId: string) => Promise<
              Array<{
                id: string
                method: string
                supersedesCaptureId?: string
                screenshotPath?: string
                hash: string
              }>
            >
          }
        }
      }
      const list = await w.birdbrain.captures.list(id)
      return list[0]
    }, caseId)
    expect(capture.method).toBe('background')
    expect(capture.supersedesCaptureId).toBeUndefined()
    expect(capture.screenshotPath).toBeTruthy()
    expect(capture.hash).toMatch(/^[0-9a-f]{64}$/)

    // Background captures are visually distinguished by a recapture badge on the
    // list thumbnail. Scope by the stable data-capture-id, not display copy.
    await expect(
      page.locator(`[data-capture-id="${capture.id}"] [data-testid="recapture-thumb-badge"]`)
    ).toBeVisible()

    const verification = await page.evaluate(async (captureId: string) => {
      const w = window as unknown as {
        birdbrain: { captures: { verify: (id: string) => Promise<{ status: string }> } }
      }
      return w.birdbrain.captures.verify(captureId)
    }, capture.id)
    expect(verification.status).toBe('verified')

    // Recapture the capture itself → linked sibling. Recapture now lives in the
    // top-bar Capture menu; it targets the currently selected capture.
    await page.getByTestId('capture-item').filter({ hasText: 'Recapture Fixture' }).first().click()
    await page.click('[data-testid="capture-menu-btn"]')
    await page.click('[data-testid="recapture-btn"]')
    // While the background job runs, the button reflects the in-flight state
    // (driven by the recapture 'received' event, not the enqueue IPC).
    await expect(page.getByTestId('recapture-in-progress')).toBeVisible({ timeout: 8000 })
    await expect(page.locator('[data-testid="supersedes-link-recapture"]')).toBeVisible({
      timeout: 60000
    })
    const captures = await page.evaluate(async (id) => {
      const w = window as unknown as {
        birdbrain: {
          captures: {
            list: (
              caseId: string
            ) => Promise<Array<{ id: string; method: string; supersedesCaptureId?: string }>>
          }
        }
      }
      return w.birdbrain.captures.list(id)
    }, caseId)
    expect(captures).toHaveLength(2)
    const sibling = captures.find((c) => c.supersedesCaptureId === capture.id)
    expect(sibling).toBeTruthy()
    expect(sibling!.method).toBe('background')
  })

  // D4 to D6 and D9 of docs/plans/2026-10-10-capture-engine-first-slice.md.
  test('records how Scroll-to-load ended and the screenshot facts, signed and mirrored', async ({
    page
  }) => {
    test.setTimeout(150000)

    const caseId = await queueUrl(page, 'Scroll record E2E', `${baseUrl}/lazy`)
    await expect(page.getByText('Lazy Growth Fixture')).toBeVisible({ timeout: 60000 })

    const capture = await page.evaluate(async (id) => {
      const w = window as unknown as {
        birdbrain: {
          captures: {
            list: (caseId: string) => Promise<
              Array<{
                id: string
                method: string
                inventory?: unknown
                scrollToLoad?: unknown
                pdfHash?: string
              }>
            >
          }
        }
      }
      return (await w.birdbrain.captures.list(id))[0]
    }, caseId)
    expect(capture.method).toBe('background')

    // The stored PNG's own dimensions, which the record must state.
    const stored = await page.evaluate(async (captureId: string) => {
      const w = window as unknown as {
        birdbrain: {
          captures: { getContent: (id: string, type: 'png') => Promise<string | null> }
        }
      }
      const png = await w.birdbrain.captures.getContent(captureId, 'png')
      const img = new Image()
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('Failed to decode captured PNG'))
        img.src = `data:image/png;base64,${png}`
      })
      return { width: img.naturalWidth, height: img.naturalHeight }
    }, capture.id)

    const entry = await lastCaptureEntry(page, caseId)
    const scrollToLoad = {
      requested: true,
      ran: true,
      outcome: 'stopped-growing',
      endHeight: LAZY_PAGE_HEIGHT,
      scrollLockLifted: false
    }
    expect(entry.scrollToLoad).toEqual(scrollToLoad)
    const inventory = entry.inventory as {
      screenshot: Record<string, unknown>
      mhtml: unknown
      transactionRecord: unknown
      pdf: unknown
    }
    expect(inventory.screenshot).toMatchObject({
      present: true,
      scaled: false,
      truncated: false,
      trimmed: false,
      contentHeight: LAZY_PAGE_HEIGHT,
      width: stored.width,
      height: stored.height
    })
    expect(inventory.screenshot.contentWidth).toBeGreaterThan(0)
    expect(inventory.mhtml).toEqual({ present: true, pinnedImages: 0, pinnedImagesNotLoaded: 0 })
    expect(inventory.transactionRecord).toMatchObject({ present: true, exchanges: 1 })
    // Step 10 prints the PDF; e2e/recapture-transaction-record.spec.ts reads it.
    expect(inventory.pdf).toEqual({ present: true, afterCollection: true })
    expect(entry.schemaVersion).toBe(6)

    // The row mirrors the entry.
    expect(capture.scrollToLoad).toEqual(scrollToLoad)
    expect(capture.inventory).toEqual(entry.inventory)
    expect(capture.pdfHash).toBe(entry.pdfHash)

    const verification = await page.evaluate(async (captureId: string) => {
      const w = window as unknown as {
        birdbrain: { captures: { verify: (id: string) => Promise<{ status: string }> } }
      }
      return w.birdbrain.captures.verify(captureId)
    }, capture.id)
    expect(verification.status).toBe('verified')
  })

  // The phase scrolls a page's inner panels, larger overflow first, and ends on
  // the stall detector at the end of the largest one.
  for (const fixture of [
    {
      name: 'an app-shell page whose content scrolls in an inner panel',
      path: '/app-shell',
      title: 'App Shell Fixture',
      endHeight: 10001,
      chunks: ['MAINLAZY3']
    },
    {
      name: 'a page with two scrolling panes',
      path: '/two-pane',
      title: 'Two Pane Fixture',
      endHeight: 6001,
      chunks: ['NAVLAZY0', 'MAINLAZY0']
    }
  ]) {
    test(`scrolls ${fixture.name} and records where it stopped growing`, async ({ page }) => {
      test.setTimeout(150000)

      const caseId = await queueUrl(page, `${fixture.title} E2E`, `${baseUrl}${fixture.path}`)
      await expect(page.getByText(fixture.title, { exact: true }).first()).toBeVisible({
        timeout: 60000
      })

      const entry = await lastCaptureEntry(page, caseId)
      expect(entry.scrollToLoad).toEqual({
        requested: true,
        ran: true,
        outcome: 'stopped-growing',
        endHeight: fixture.endHeight,
        scrollLockLifted: false
      })

      const text = await page.evaluate(async (captureId: string) => {
        const w = window as unknown as {
          birdbrain: {
            captures: { getContent: (id: string, type: 'txt') => Promise<string | null> }
          }
        }
        return w.birdbrain.captures.getContent(captureId, 'txt')
      }, String(entry.captureId))
      for (const chunk of fixture.chunks) expect(text ?? '').toContain(chunk)
    })
  }
})
