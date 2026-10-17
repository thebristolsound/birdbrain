import { test, expect } from './fixtures/electronApp'
import { createCase } from './fixtures/seed'
import { createServer, type Server } from 'http'
import type { Page } from '@playwright/test'

// A background capture refuses a link whose redirect lands on the Operator's own machine or
// network (#1726). The fixture is served on 127.0.0.1 through the e2e loopback switch, and it
// sends the render to private addresses two ways: a server redirect, and a page that
// navigates itself. Neither address is ever contacted: the hop is refused before Chromium
// follows it, so the addresses need not exist.
const SELF_NAVIGATING_PAGE = `<!doctype html><html><head><title>Self Navigating Fixture</title></head>
<body><p>leaving</p><script>location.href = 'http://192.168.255.1/'</script></body></html>`

const LANDING_PAGE = `<!doctype html><html><head><title>Landing Fixture</title></head>
<body><p>landed</p></body></html>`

interface ActivityEvent {
  type: string
  url: string
  skipReason?: string
}

async function recordActivity(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as {
      activity: ActivityEvent[]
      birdbrain: { onCaptureActivity: (cb: (event: ActivityEvent) => void) => () => void }
    }
    w.activity = []
    w.birdbrain.onCaptureActivity((event) => w.activity.push(event))
  })
}

async function enqueue(page: Page, caseId: string, urls: string[]) {
  return page.evaluate(
    ({ id, list }) => {
      const w = window as unknown as {
        birdbrain: {
          recapture: {
            enqueue: (payload: { caseId: string; urls: string[] }) => Promise<{
              accepted: number
              rejected: Array<{ url: string; reason: string }>
            }>
          }
        }
      }
      return w.birdbrain.recapture.enqueue({ caseId: id, urls: list })
    },
    { id: caseId, list: urls }
  )
}

async function endOf(page: Page, url: string): Promise<ActivityEvent> {
  const handle = await page.waitForFunction(
    (target) => {
      const w = window as unknown as { activity: ActivityEvent[] }
      return w.activity.find((e) => e.url === target && e.type !== 'received') ?? null
    },
    url,
    { timeout: 60000 }
  )
  return (await handle.jsonValue()) as ActivityEvent
}

async function captureCount(page: Page, caseId: string): Promise<number> {
  return page.evaluate(async (id) => {
    const w = window as unknown as {
      birdbrain: { captures: { list: (caseId: string) => Promise<unknown[]> } }
    }
    return (await w.birdbrain.captures.list(id)).length
  }, caseId)
}

test.describe('Recapture refuses a redirect to a local address', () => {
  let server: Server
  let baseUrl: string

  test.beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/redirect-private') {
        res.writeHead(302, { location: 'http://10.255.255.1/' })
        res.end()
        return
      }
      if (req.url === '/redirect-local') {
        res.writeHead(302, { location: '/landing' })
        res.end()
        return
      }
      if (req.url === '/navigate-private') {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end(SELF_NAVIGATING_PAGE)
        return
      }
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(LANDING_PAGE)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const addr = server.address()
    baseUrl = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : ''
    process.env.BIRDBRAIN_E2E_ALLOW_LOOPBACK = '1'
  })

  test.afterAll(async () => {
    delete process.env.BIRDBRAIN_E2E_ALLOW_LOOPBACK
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  test('refuses a server redirect and a page navigation to a private address', async ({ page }) => {
    test.setTimeout(150000)
    const caseId = await createCase(page, 'Local Redirect E2E')
    await recordActivity(page)

    const redirect = `${baseUrl}/redirect-private`
    const navigate = `${baseUrl}/navigate-private`
    const result = await enqueue(page, caseId, [redirect, navigate])
    expect(result).toEqual({ accepted: 2, rejected: [] })

    expect(await endOf(page, redirect)).toMatchObject({
      type: 'skipped',
      skipReason: 'Redirects to a private address'
    })
    expect(await endOf(page, navigate)).toMatchObject({
      type: 'skipped',
      skipReason: 'Redirects to a private address'
    })
    expect(await captureCount(page, caseId)).toBe(0)

    // A redirect that stays on an allowed address is followed and stored as before.
    const followed = `${baseUrl}/redirect-local`
    await enqueue(page, caseId, [followed])
    expect(await endOf(page, followed)).toMatchObject({ type: 'stored' })
    expect(await captureCount(page, caseId)).toBe(1)
  })
})

test.describe('Recapture without the e2e loopback switch', () => {
  test.beforeAll(() => {
    delete process.env.BIRDBRAIN_E2E_ALLOW_LOOPBACK
  })

  test('refuses a link to 127.0.0.1 at enqueue, naming the class', async ({ page }) => {
    const caseId = await createCase(page, 'Loopback Refused E2E')
    const result = await enqueue(page, caseId, ['http://127.0.0.1:9/'])
    expect(result).toEqual({
      accepted: 0,
      rejected: [{ url: 'http://127.0.0.1:9/', reason: 'Points at a loopback address' }]
    })
  })
})
