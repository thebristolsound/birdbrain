import { test, expect } from './fixtures/electronApp'
import { createCase } from './fixtures/seed'
import { createServer, type Server } from 'http'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { ElectronApplication, Page } from '@playwright/test'

// The VPN warning (ADR-0032 rules 2 to 4, #1696) under a real Electron. The VPN check is
// stubbed through the unpackaged build's e2e switches: a VPN not seen on a network named
// Home, then Cafe. The pages come from a fixture server on 127.0.0.1, through the e2e
// loopback switch (#1726).
const PAGE = `<!doctype html><html><head><title>VPN Fixture</title></head>
<body><h1>VPN warning fixture page</h1></body></html>`

interface ActivityEvent {
  type: string
  url: string
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

async function stored(page: Page, url: string): Promise<void> {
  const handle = await page.waitForFunction(
    (target) => {
      const w = window as unknown as { activity: ActivityEvent[] }
      return w.activity.find((e) => e.url === target && e.type !== 'received') ?? null
    },
    url,
    { timeout: 90000 }
  )
  expect(((await handle.jsonValue()) as ActivityEvent).type).toBe('stored')
}

// What the VPN check reads in main, from the next check on.
async function setCheck(app: ElectronApplication, vpn: string, network: string): Promise<void> {
  await app.evaluate(
    (_, values) => {
      process.env.BIRDBRAIN_E2E_VPN = values.vpn
      process.env.BIRDBRAIN_E2E_NETWORK = values.network
    },
    { vpn, network }
  )
}

async function openCaptures(page: Page, caseId: string): Promise<void> {
  await page.evaluate((id) => {
    window.location.hash = `/cases/${id}/captures`
  }, caseId)
  await page.getByTestId('capture-menu-btn').waitFor({ timeout: 10000 })
}

async function submitUrl(page: Page, url: string): Promise<void> {
  await page.click('[data-testid="capture-menu-btn"]')
  await page.click('[data-testid="capture-menu-paste-urls"]')
  await page.fill('[data-testid="add-urls-input"]', url)
  await page.click('[data-testid="add-urls-submit"]')
}

// The paste-URLs dialog closes once everything queued, which a warning would have held open.
async function queuedWithoutWarning(page: Page): Promise<void> {
  await expect(page.getByTestId('add-urls-input')).toBeHidden({ timeout: 10000 })
  await expect(page.getByTestId('vpn-warning-dialog')).toHaveCount(0)
}

async function onlyCapture(page: Page, caseId: string): Promise<Record<string, unknown>> {
  const list = await page.evaluate(async (id) => {
    const w = window as unknown as {
      birdbrain: { captures: { list: (caseId: string) => Promise<Record<string, unknown>[]> } }
    }
    return w.birdbrain.captures.list(id)
  }, caseId)
  expect(list).toHaveLength(1)
  return list[0]
}

async function captureEntry(page: Page, caseId: string): Promise<Record<string, unknown>> {
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
  const captures = entries.filter((entry) => entry.type === 'capture')
  expect(captures).toHaveLength(1)
  return captures[0]
}

const keys = (record: Record<string, unknown>): string[] => Object.keys(record).sort()

// Every key at any depth, for a field this ticket might have added on the capture path, which
// a comparison between two Captures from the same build would not see.
function allKeys(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(allKeys)
  if (typeof value !== 'object' || value === null) return []
  return Object.entries(value).flatMap(([key, child]) => [key, ...allKeys(child)])
}

const VPN_FIELD = /vpn|network|tunnel/i

test.describe('VPN warning', () => {
  let server: Server
  let baseUrl: string
  const requested: string[] = []

  test.beforeAll(async () => {
    server = createServer((req, res) => {
      requested.push(req.url ?? '')
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(PAGE)
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    baseUrl = typeof address === 'object' && address ? `http://127.0.0.1:${address.port}` : ''
    process.env.BIRDBRAIN_E2E_ALLOW_LOOPBACK = '1'
    process.env.BIRDBRAIN_E2E_VPN = 'not-seen'
    process.env.BIRDBRAIN_E2E_NETWORK = 'Home'
  })

  test.afterAll(async () => {
    delete process.env.BIRDBRAIN_E2E_ALLOW_LOOPBACK
    delete process.env.BIRDBRAIN_E2E_VPN
    delete process.env.BIRDBRAIN_E2E_NETWORK
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  test('warns once per Case and per network, and records nothing about it', async ({
    electronApp,
    page
  }) => {
    test.setTimeout(240000)
    await recordActivity(page)
    await expect(page.getByTestId('egress-indicator')).toHaveAttribute(
      'title',
      'Egress: Direct · VPN not seen'
    )

    // A Capture with a VPN seen: no warning, and the record to compare against.
    await setCheck(electronApp, 'seen', '')
    const seenCase = await createCase(page, 'VPN seen')
    await openCaptures(page, seenCase)
    await submitUrl(page, `${baseUrl}/seen`)
    await queuedWithoutWarning(page)
    await stored(page, `${baseUrl}/seen`)

    // A VPN not seen: the first contact in a Case warns, and Continue lets it through.
    await setCheck(electronApp, 'not-seen', 'Home')
    const caseA = await createCase(page, 'VPN warning A')
    await openCaptures(page, caseA)
    await submitUrl(page, `${baseUrl}/a1`)
    const warning = page.getByTestId('vpn-warning-dialog')
    await expect(warning).toBeVisible({ timeout: 10000 })
    await expect(warning).not.toContainText(/no VPN/i)
    await expect(page.getByTestId('vpn-warning-session')).toHaveCount(0)
    await page.getByTestId('vpn-warning-continue').click()
    await queuedWithoutWarning(page)
    await stored(page, `${baseUrl}/a1`)

    // Rule 4: the warned Capture's row and Manifest Entry carry the same fields as the other,
    // and neither names a VPN or a network.
    const warnedRow = await onlyCapture(page, caseA)
    const warnedEntry = await captureEntry(page, caseA)
    expect(keys(warnedRow)).toEqual(keys(await onlyCapture(page, seenCase)))
    expect(keys(warnedEntry)).toEqual(keys(await captureEntry(page, seenCase)))
    expect(allKeys(warnedRow).filter((key) => VPN_FIELD.test(key))).toEqual([])
    expect(allKeys(warnedEntry).filter((key) => VPN_FIELD.test(key))).toEqual([])

    // The second contact in the same Case does not warn.
    await submitUrl(page, `${baseUrl}/a2`)
    await queuedWithoutWarning(page)

    // A new Case warns again; stop warning on this network.
    const caseB = await createCase(page, 'VPN warning B')
    await openCaptures(page, caseB)
    await submitUrl(page, `${baseUrl}/b1`)
    await expect(warning).toBeVisible({ timeout: 10000 })
    await page.getByTestId('vpn-warning-mute').click()
    await queuedWithoutWarning(page)
    await stored(page, `${baseUrl}/b1`)

    // The muted network's hash stays in settings and out of the Case's Manifest.
    const { storagePath, vpnWarningMutedNetworks: muted } = await page.evaluate(async () => {
      const w = window as unknown as {
        birdbrain: {
          settings: {
            get: () => Promise<{ storagePath: string; vpnWarningMutedNetworks: string[] }>
          }
        }
      }
      return w.birdbrain.settings.get()
    })
    expect(muted).toHaveLength(1)
    expect(readFileSync(join(storagePath, caseB, 'manifest.jsonl'), 'utf-8')).not.toContain(
      muted[0]
    )

    // The muted network stays quiet in a new Case.
    const caseC = await createCase(page, 'VPN warning C')
    await openCaptures(page, caseC)
    await submitUrl(page, `${baseUrl}/c1`)
    await queuedWithoutWarning(page)
    await stored(page, `${baseUrl}/c1`)

    // A different network warns again. Set up a proxy opens the Egress setting and sends
    // nothing.
    await setCheck(electronApp, 'not-seen', 'Cafe')
    await submitUrl(page, `${baseUrl}/c2`)
    await expect(warning).toBeVisible({ timeout: 10000 })
    await page.getByTestId('vpn-warning-proxy').click()
    await page.waitForURL(/#\/settings$/, { timeout: 10000 })
    await expect(page.getByRole('tab', { name: 'Operator' })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await expect(
      page.locator('[role="radiogroup"][aria-label="Egress"] input[value="direct"]')
    ).toBeFocused()
    const queue = await page.evaluate(async () => {
      const w = window as unknown as {
        birdbrain: { recapture: { queueStatus: () => Promise<Record<string, unknown>> } }
      }
      return w.birdbrain.recapture.queueStatus()
    })
    expect(queue).toEqual({ pending: 0, activeUrl: null })
    expect(requested).not.toContain('/c2')

    // Starting a Capture Session warns, and says the browser's route is not seen, in a Case
    // whose site warning was already answered (ADR-0032 rule 3).
    await openCaptures(page, caseA)
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.send('event:extensionConnection', {
        connected: true
      })
    })
    const session = page.getByTestId('case-action-bar').getByRole('switch', {
      name: 'Capture Session'
    })
    await session.click()
    await expect(page.getByTestId('vpn-warning-session')).toBeVisible({ timeout: 10000 })
    await page.getByTestId('vpn-warning-continue').click()
    await expect(session).toHaveAttribute('aria-checked', 'true', { timeout: 10000 })
  })

  test('does not warn while the Egress is a Proxy', async ({ page }) => {
    await page.evaluate(() => {
      window.location.hash = '/settings'
    })
    await page.getByRole('tab', { name: 'Operator' }).click()
    await page.locator('input[name="egressKind"][value="proxy"]').check()
    await page.fill('#egress-proxy', 'socks5://127.0.0.1:9')
    await page.press('#egress-proxy', 'Tab')
    const caseId = await createCase(page, 'VPN warning proxy')
    await openCaptures(page, caseId)
    await expect(page.getByTestId('egress-indicator')).toHaveAttribute('title', 'Egress: Proxy')
    await submitUrl(page, `${baseUrl}/proxy`)
    await queuedWithoutWarning(page)
  })
})
