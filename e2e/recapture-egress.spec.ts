import { test, expect } from './fixtures/electronApp'
import { createCase } from './fixtures/seed'
import { startSocks5Proxy, type Socks5Proxy } from './fixtures/socks5Proxy'
import { createServer, type Server } from 'http'
import { readFileSync } from 'fs'
import { join } from 'path'
import type { Page } from '@playwright/test'

// The Egress (ADR-0032, #1695) under a real Electron: a background capture's requests
// all go through a SOCKS5 proxy and its signed entry names the Egress; with the proxy
// stopped the capture fails naming it and nothing reaches the target; and the session
// electron-updater sends on carries the same proxy. The target and the proxy both run
// on 127.0.0.1, through the e2e loopback switch (#1726).
const PAGE = `<!doctype html><html><head><title>Egress Fixture</title></head>
<body><h1>Egress fixture page</h1><img src="/pixel.png" alt=""></body></html>`
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
)

interface ActivityEvent {
  type: string
  url: string
  error?: string
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

async function setEgress(page: Page, egress: object): Promise<void> {
  await page.evaluate(async (value) => {
    const w = window as unknown as {
      birdbrain: { settings: { update: (partial: object) => Promise<unknown> } }
    }
    await w.birdbrain.settings.update({ egress: value })
  }, egress)
}

async function enqueue(page: Page, caseId: string, url: string): Promise<number> {
  return page.evaluate(
    async ({ id, target }) => {
      const w = window as unknown as {
        birdbrain: {
          recapture: {
            enqueue: (payload: { caseId: string; urls: string[] }) => Promise<{ accepted: number }>
          }
        }
      }
      return (await w.birdbrain.recapture.enqueue({ caseId: id, urls: [target] })).accepted
    },
    { id: caseId, target: url }
  )
}

async function endOf(page: Page, url: string): Promise<ActivityEvent> {
  const handle = await page.waitForFunction(
    (target) => {
      const w = window as unknown as { activity: ActivityEvent[] }
      return w.activity.find((e) => e.url === target && e.type !== 'received') ?? null
    },
    url,
    { timeout: 90000 }
  )
  return (await handle.jsonValue()) as ActivityEvent
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

// A port nothing listens on: bound once, then released.
async function stoppedProxyPort(): Promise<number> {
  const proxy = await startSocks5Proxy(() => false)
  await proxy.close()
  return proxy.port
}

test.describe('Recapture through the Egress', () => {
  let target: Server
  let targetUrl: string
  let targetPort: number
  let proxy: Socks5Proxy
  const seen: Array<{ url: string; remotePort: number }> = []

  test.beforeAll(async () => {
    target = createServer((req, res) => {
      seen.push({ url: req.url ?? '', remotePort: req.socket.remotePort ?? 0 })
      if (req.url === '/pixel.png') {
        res.writeHead(200, { 'content-type': 'image/png' })
        res.end(PIXEL)
        return
      }
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(PAGE)
    })
    await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve))
    const address = target.address()
    targetPort = typeof address === 'object' && address ? address.port : 0
    targetUrl = `http://127.0.0.1:${targetPort}`
    // Only the target: the TSA request and the filter-list download the capture
    // also sends are refused, so nothing leaves the machine.
    proxy = await startSocks5Proxy((host, port) => host === '127.0.0.1' && port === targetPort)
    process.env.BIRDBRAIN_E2E_ALLOW_LOOPBACK = '1'
  })

  test.afterAll(async () => {
    delete process.env.BIRDBRAIN_E2E_ALLOW_LOOPBACK
    await proxy.close()
    await new Promise<void>((resolve) => target.close(() => resolve()))
  })

  test('sends every request of a background capture through the proxy and signs the Egress', async ({
    page
  }) => {
    test.setTimeout(150000)
    const caseId = await createCase(page, 'Egress Proxy E2E')
    await recordActivity(page)
    await setEgress(page, {
      kind: 'proxy',
      proxyUrl: `socks5://127.0.0.1:${proxy.port}`,
      label: 'E2E SOCKS'
    })

    const before = seen.length
    const url = `${targetUrl}/page`
    expect(await enqueue(page, caseId, url)).toBe(1)
    expect(await endOf(page, url)).toMatchObject({ type: 'stored' })

    const requests = seen.slice(before)
    expect(requests.map((r) => r.url)).toEqual(expect.arrayContaining(['/page', '/pixel.png']))
    for (const request of requests) {
      expect(proxy.outboundPorts.has(request.remotePort), request.url).toBe(true)
    }
    expect(proxy.connects).toContain(`127.0.0.1:${targetPort}`)

    const entry = await lastCaptureEntry(page, caseId)
    expect(entry).toMatchObject({
      method: 'background',
      egressKind: 'proxy',
      egressLabel: 'E2E SOCKS',
      // A background entry also carries the capture engine's inventory, a
      // schema-6 field.
      schemaVersion: 6
    })
    expect(String(entry.userAgent)).toContain('Electron/')
    // The record names the kind and the label, never where the proxy is.
    expect(JSON.stringify(entry)).not.toContain(String(proxy.port))
  })

  test('fails a capture through a stopped proxy, naming it, and nothing reaches the target', async ({
    page
  }) => {
    test.setTimeout(150000)
    const caseId = await createCase(page, 'Egress Stopped E2E')
    await recordActivity(page)
    const port = await stoppedProxyPort()
    await setEgress(page, { kind: 'tor', proxyUrl: `socks5://127.0.0.1:${port}`, label: '' })

    const before = seen.length
    const url = `${targetUrl}/stopped`
    expect(await enqueue(page, caseId, url)).toBe(1)
    const end = await endOf(page, url)
    expect(end.type).toBe('failed')
    expect(end.error).toContain(`Could not go through the Egress proxy socks5://127.0.0.1:${port}`)
    expect(seen.slice(before)).toEqual([])
  })

  test('puts the stopped proxy on the update and Wayback sessions, so an update request fails', async ({
    page,
    electronApp
  }) => {
    const port = await stoppedProxyPort()
    await setEgress(page, { kind: 'proxy', proxyUrl: `socks5://127.0.0.1:${port}`, label: '' })

    const before = seen.length
    // The update session takes the proxy asynchronously after the change.
    await expect
      .poll(() =>
        electronApp.evaluate(
          ({ session }, url) =>
            session.fromPartition('electron-updater', { cache: false }).resolveProxy(url),
          `${targetUrl}/latest.yml`
        )
      )
      .toBe(`SOCKS5 127.0.0.1:${port}`)

    // The Wayback replay partition takes the same proxy.
    await expect
      .poll(() =>
        electronApp.evaluate(
          ({ session }, url) => session.fromPartition('wayback-replay').resolveProxy(url),
          'https://web.archive.org/'
        )
      )
      .toBe(`SOCKS5 127.0.0.1:${port}`)

    const outcome = await electronApp.evaluate(async ({ session }, url) => {
      try {
        await session.fromPartition('electron-updater', { cache: false }).fetch(url)
        return 'fetched'
      } catch (err) {
        return String(err)
      }
    }, `${targetUrl}/latest.yml`)
    expect(outcome).not.toBe('fetched')
    expect(seen.slice(before)).toEqual([])
  })
})
