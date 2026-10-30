import { test, expect } from './fixtures/electronApp'
import { createServer, type Server } from 'http'

// Background recapture must report the permission policy it enforces. Every
// permission request is refused, so permission checks must read `denied` too:
// the fixture page writes what it sees into its body, and the stored text is
// what the assertion reads.
const FIXTURE_PAGE = `<!doctype html><html><head><title>Permission Check Fixture</title></head>
<body><h1>Permission check fixture</h1><pre id="out"></pre>
<script>
  const out = document.getElementById('out')
  const write = (line) => { out.textContent += line + '\\n' }
  write('NOTIFICATION-API=' + Notification.permission)
  const query = (name, label) =>
    navigator.permissions.query({ name }).then(
      (status) => write(label + '=' + status.state),
      (err) => write(label + '=error:' + err.name)
    )
  query('notifications', 'NOTIFICATIONS-QUERY')
  query('geolocation', 'GEOLOCATION-QUERY')
</script>
</body></html>`

test.describe('Recapture permission checks', () => {
  let server: Server
  let baseUrl: string

  test.beforeAll(async () => {
    server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(FIXTURE_PAGE)
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

  test('the rendered page reads notification and location permission as denied', async ({
    page
  }) => {
    test.setTimeout(120000)

    await page.evaluate(() => {
      window.location.hash = '/cases/new?blank=true'
    })
    await page.waitForSelector('[data-testid="case-name-input"]', { timeout: 10000 })
    await page.fill('[data-testid="case-name-input"]', 'Permission Check E2E')
    await page.click('[data-testid="case-create-btn"]')
    await page.waitForURL(/#\/cases\/.+\/overview/, { timeout: 10000 })
    const caseId = page.url().match(/cases\/([^/]+)/)![1]

    await page.evaluate((id) => {
      window.location.hash = `/cases/${id}/captures`
    }, caseId)
    await page.click('[data-testid="capture-menu-btn"]')
    await page.click('[data-testid="capture-menu-paste-urls"]')
    await page.waitForSelector('[data-testid="add-urls-input"]', { timeout: 10000 })
    await page.fill('[data-testid="add-urls-input"]', `${baseUrl}/page`)
    await page.click('[data-testid="add-urls-submit"]')
    await page.keyboard.press('Escape')

    await expect(page.getByText('Permission Check Fixture')).toBeVisible({ timeout: 60000 })

    const capture = await page.evaluate(async (id) => {
      const w = window as unknown as {
        birdbrain: {
          captures: { list: (caseId: string) => Promise<Array<{ id: string; method: string }>> }
        }
      }
      const list = await w.birdbrain.captures.list(id)
      return list[0]
    }, caseId)
    expect(capture.method).toBe('background')

    const text = await page.evaluate(async (captureId: string) => {
      const w = window as unknown as {
        birdbrain: {
          captures: { getContent: (id: string, type: 'txt') => Promise<string | null> }
        }
      }
      return w.birdbrain.captures.getContent(captureId, 'txt')
    }, capture.id)
    expect(text ?? '').toContain('NOTIFICATION-API=denied')
    expect(text ?? '').toContain('NOTIFICATIONS-QUERY=denied')
    expect(text ?? '').toContain('GEOLOCATION-QUERY=denied')
  })
})
