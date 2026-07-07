import { test, expect } from './fixtures/electronApp'
import { createServer, type Server } from 'http'

// Background recapture against a consent-walled page: a full-viewport
// OneTrust-style overlay plus a body scroll lock, with lazy content below the
// fold that only loads as the viewport actually scrolls. The consent blocker
// (fed a locally served filter list via the BIRDBRAIN_CONSENT_LISTS seam) must
// hide the wall, the scroll phase must still reach the bottom despite the
// overflow lock, and the capture must record consent-suppression provenance
// with a manifest chain that still verifies. The 12 chunks (~9.7k px) also
// exercise the beyond-viewport screenshot on a page much taller than the
// viewport.
const FIXTURE_PAGE = `<!doctype html><html><head><title>Consent Wall Fixture</title><style>
  body{margin:0;font-family:sans-serif}
  #onetrust-consent-sdk{position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:9999;display:flex;align-items:center;justify-content:center;color:#fff;font-size:32px}
  .chunk{height:800px;border-bottom:2px solid #888;font-size:28px;padding:20px;background:#eef}
</style></head><body>
<div id="onetrust-consent-sdk"><div id="onetrust-banner-sdk">CONSENT-WALL-TEXT We value your privacy</div></div>
<script>document.body.style.overflow='hidden'</script>
<div id="content"></div>
<div id="sentinel" style="height:10px"></div>
<script>
  const content = document.getElementById('content')
  const add = (label) => { const d = document.createElement('div'); d.className = 'chunk'; d.textContent = label; content.appendChild(d) }
  for (let i = 0; i < 3; i++) add('CHUNK-' + i)
  let next = 3
  new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting) && next < 12) add('LAZYCHUNK' + next++)
  }, { rootMargin: '100px' }).observe(document.getElementById('sentinel'))
</script>
</body></html>`

// Generic cosmetic hide rule matching the fixture's overlay — the same shape
// the real EasyList Cookie List uses for OneTrust.
const FIXTURE_FILTER_LIST = '###onetrust-consent-sdk\n'

test.describe('Recapture through a consent wall', () => {
  let server: Server
  let baseUrl: string

  test.beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/filters.txt') {
        res.writeHead(200, { 'content-type': 'text/plain' })
        res.end(FIXTURE_FILTER_LIST)
        return
      }
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(FIXTURE_PAGE)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const addr = server.address()
    baseUrl = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : ''
    // Must be set before the electronApp fixture launches the app.
    process.env.BIRDBRAIN_CONSENT_LISTS = `${baseUrl}/filters.txt`
  })

  test.afterAll(async () => {
    delete process.env.BIRDBRAIN_CONSENT_LISTS
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  test('suppresses the wall, scrolls past the lock, and records provenance', async ({ page }) => {
    test.setTimeout(150000)

    await page.evaluate(() => {
      window.location.hash = '/cases/new'
    })
    await page.waitForSelector('[data-testid="case-name-input"]', { timeout: 10000 })
    await page.fill('[data-testid="case-name-input"]', 'Consent Wall E2E')
    await page.click('[data-testid="case-create-btn"]')
    await page.waitForURL(/#\/cases\/.+\/overview/, { timeout: 10000 })
    const caseId = page.url().match(/cases\/([^/]+)/)![1]

    await page.evaluate((id) => {
      window.location.hash = `/cases/${id}/captures`
    }, caseId)
    await page.waitForSelector('[data-testid="add-urls-input"]', { timeout: 10000 })
    await page.fill('[data-testid="add-urls-input"]', `${baseUrl}/page`)
    await page.click('[data-testid="add-urls-submit"]')

    await expect(page.getByText('Consent Wall Fixture')).toBeVisible({ timeout: 60000 })

    const capture = await page.evaluate(async (id) => {
      const w = window as unknown as {
        birdbrain: {
          captures: {
            list: (caseId: string) => Promise<
              Array<{
                id: string
                method: string
                consentSuppression?: string
                screenshotPath?: string
              }>
            >
          }
        }
      }
      const list = await w.birdbrain.captures.list(id)
      return list[0]
    }, caseId)
    expect(capture.method).toBe('background')
    expect(capture.consentSuppression).toBe('filter-list')
    expect(capture.screenshotPath).toBeTruthy()

    // The screenshot must cover the whole ~9.7k px document, painted. A capture
    // that loses content below the fold (or paints it blank) comes back short:
    // the trailing-background trim crops unpainted rows, so height is a proxy
    // for "content actually rendered all the way down".
    const screenshotHeight = await page.evaluate(async (captureId: string) => {
      const w = window as unknown as {
        birdbrain: {
          captures: { getContent: (id: string, type: 'png') => Promise<string | null> }
        }
      }
      const png = await w.birdbrain.captures.getContent(captureId, 'png')
      if (!png) return -1
      const img = new Image()
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve()
        img.onerror = () => reject(new Error('Failed to decode captured PNG'))
        img.src = `data:image/png;base64,${png}`
      })
      return img.naturalHeight
    }, capture.id)
    expect(screenshotHeight).toBeGreaterThan(9000)

    // The manifest chain must verify with the consentSuppression field present.
    const verification = await page.evaluate(async (captureId: string) => {
      const w = window as unknown as {
        birdbrain: { captures: { verify: (id: string) => Promise<{ status: string }> } }
      }
      return w.birdbrain.captures.verify(captureId)
    }, capture.id)
    expect(verification.status).toBe('verified')

    // Extracted text proves both halves of the fix: the last lazy chunk only
    // exists if the scroll phase beat the scroll lock, and the wall text is
    // only absent if the cosmetic filter hid it (innerText excludes
    // display:none subtrees).
    const text = await page.evaluate(async (captureId: string) => {
      const w = window as unknown as {
        birdbrain: {
          captures: { getContent: (id: string, type: 'txt') => Promise<string | null> }
        }
      }
      return w.birdbrain.captures.getContent(captureId, 'txt')
    }, capture.id)
    expect(text ?? '').toContain('LAZYCHUNK11')
    expect(text ?? '').not.toContain('CONSENT-WALL-TEXT')
  })
})
