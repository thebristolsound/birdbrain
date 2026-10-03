import { test, expect } from './fixtures/electronApp'
import { createServer, type Server } from 'http'
import { mkdtemp, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { pathToFileURL } from 'url'

type Page = import('@playwright/test').Page
type ElectronApplication = import('@playwright/test').ElectronApplication

// The stored-page viewer's links (#1708). The guest runs with `javascript=no`, so no
// `evaluate` reaches inside it; every input below is sent to the guest's webContents
// from the main process with `sendInputEvent`, at coordinates the fixture fixes with
// inline absolute positioning. Coordinates are the guest's own, so the outer pane's
// scroll does not enter into them.

// Every external URL in the fixture points at this server, which counts what reaches
// it. A request that arrives is a request the evidence viewer made.
interface Sentinel {
  origin: string
  requests: string[]
  close: () => Promise<void>
}

async function startSentinel(): Promise<Sentinel> {
  const requests: string[] = []
  const server: Server = createServer((req, res) => {
    requests.push(req.url ?? '')
    res.end('<html><body>sentinel</body></html>')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const { port } = server.address() as { port: number }
  return {
    origin: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  }
}

// One row per link, 30px apart from the top of its frame. The iframe sits at FRAME_TOP
// in the main document, so a subframe row's guest y is FRAME_TOP plus its own.
const ROW = { x: 60, height: 24, gap: 30 }
const FRAME_TOP = 320
const ROWS = ['relative', 'absolute', 'blank', 'file', 'form', 'fragment', 'public'] as const
type RowName = (typeof ROWS)[number]

function rowY(name: RowName, frame: 'main' | 'sub'): number {
  const top = ROWS.indexOf(name) * ROW.gap + 10 + ROW.height / 2
  return frame === 'main' ? top : FRAME_TOP + top
}

function linksDocument(sentinel: string, fileTarget: string, frame: 'main' | 'sub'): string {
  const at = (name: RowName) =>
    `position:absolute;left:10px;top:${ROWS.indexOf(name) * ROW.gap + 10}px;` +
    `width:300px;height:${ROW.height}px;margin:0;display:block`
  const iframe =
    frame === 'main'
      ? `<iframe src="cid:frame-sub@mhtml.blink" style="position:absolute;left:0;` +
        `top:${FRAME_TOP}px;width:700px;height:260px;border:0"></iframe>`
      : ''
  return (
    '<html><head><style>html,body{margin:0;padding:0;height:3000px}</style></head><body>' +
    `<a href="next-${frame}.html" style="${at('relative')}">${frame} relative</a>` +
    `<a href="${sentinel}/absolute-${frame}" style="${at('absolute')}">${frame} absolute</a>` +
    `<a href="${sentinel}/blank-${frame}" target="_blank" style="${at('blank')}">${frame} blank</a>` +
    `<a href="${fileTarget}" style="${at('file')}">${frame} file</a>` +
    `<form action="${fileTarget}" method="post" style="${at('form')}">` +
    `<button type="submit" style="width:300px;height:${ROW.height}px">${frame} form</button></form>` +
    `<a href="#far-${frame}" style="${at('fragment')}">${frame} fragment</a>` +
    `<a href="https://example.test/${frame}" style="${at('public')}">${frame} public</a>` +
    `<div id="far-${frame}" style="position:absolute;top:2600px">far</div>` +
    iframe +
    '</body></html>'
  )
}

function linksMhtml(sentinel: string, fileTarget: string): string {
  const part = (id: string, location: string, html: string) => [
    '------BOUNDARY',
    'Content-Type: text/html',
    `Content-ID: <${id}>`,
    'Content-Transfer-Encoding: binary',
    `Content-Location: ${location}`,
    '',
    html,
    ''
  ]
  return [
    'From: <Saved by Blink>',
    `Snapshot-Content-Location: ${sentinel}/page.html`,
    'Subject: Links',
    'MIME-Version: 1.0',
    'Content-Type: multipart/related; type="text/html"; boundary="----BOUNDARY"',
    '',
    ...part(
      'frame-main@mhtml.blink',
      `${sentinel}/page.html`,
      linksDocument(sentinel, fileTarget, 'main')
    ),
    ...part(
      'frame-sub@mhtml.blink',
      `${sentinel}/sub.html`,
      linksDocument(sentinel, fileTarget, 'sub')
    ),
    '------BOUNDARY--',
    ''
  ].join('\r\n')
}

async function seedCapture(page: Page, caseId: string, body: string, url: string) {
  const result = await page.evaluate(
    async ({ caseId, body, url }) => {
      const status = await fetch('http://127.0.0.1:19845/api/status')
      const token = (await status.json()).serverToken ?? ''
      const form = new FormData()
      form.append('source', 'manual')
      form.append('caseId', caseId)
      form.append('url', url)
      form.append('title', 'Links')
      form.append('timestamp', new Date().toISOString())
      form.append('textContent', 'links')
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
    { caseId, body, url }
  )
  expect(result.status).toBe('ok')
}

interface GuestEvent {
  ev: string
  url: string
  main?: boolean
  same?: boolean
}

// Records the guest's navigation events from the moment it is created, so the initial
// load is in the log too. Listeners are added after the app's own guard, so a
// `will-frame-navigate` entry here is one the guard has already answered.
async function recordGuestEvents(electronApp: ElectronApplication) {
  await electronApp.evaluate(({ app }) => {
    const g = globalThis as unknown as { guestLog: unknown[] }
    g.guestLog = []
    app.on('web-contents-created', (_event, wc) => {
      if (wc.getType() !== 'webview') return
      const push = (entry: unknown) => g.guestLog.push(entry)
      wc.on('will-frame-navigate', (d) => {
        push({ ev: 'will-frame-navigate', url: d.url, main: d.isMainFrame })
      })
      wc.on('did-start-navigation', (d) => {
        push({ ev: 'start', url: d.url, main: d.isMainFrame, same: d.isSameDocument })
      })
      wc.on('did-frame-navigate', (_e, url, _code, _status, main) => {
        push({ ev: 'commit', url, main })
      })
      wc.on('update-target-url', (_e, url) => push({ ev: 'target', url }))
    })
  })
}

async function takeGuestEvents(electronApp: ElectronApplication): Promise<GuestEvent[]> {
  return electronApp.evaluate(() => {
    const g = globalThis as unknown as { guestLog: GuestEvent[] }
    const out = g.guestLog
    g.guestLog = []
    return out
  })
}

type Button = 'left' | 'middle' | 'right'
type Modifier = 'control' | 'shift' | 'meta' | 'alt'

async function guestMouse(
  electronApp: ElectronApplication,
  input: { x: number; y: number; button?: Button; modifiers?: Modifier[] }
) {
  await electronApp.evaluate(({ webContents }, { x, y, button, modifiers = [] }) => {
    const guest = webContents.getAllWebContents().find((wc) => wc.getType() === 'webview')
    if (!guest) throw new Error('no guest webContents')
    guest.sendInputEvent({ type: 'mouseMove', x, y, modifiers })
    if (!button) return
    guest.sendInputEvent({ type: 'mouseDown', x, y, button, clickCount: 1, modifiers })
    guest.sendInputEvent({ type: 'mouseUp', x, y, button, clickCount: 1, modifiers })
  }, input)
}

async function openLinksCapture(page: Page, sentinel: Sentinel, fileTarget: string) {
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.evaluate(() => {
    window.location.hash = '/cases/new'
  })
  await page.waitForSelector('[data-testid="case-name-input"]', { timeout: 10000 })
  await page.fill('[data-testid="case-name-input"]', 'Link interactivity E2E')
  await page.click('[data-testid="case-create-btn"]')
  await page.waitForURL(/#\/cases\/.+\/overview/, { timeout: 10000 })
  const caseId = page.url().match(/cases\/([^/]+)/)![1]
  await seedCapture(
    page,
    caseId,
    linksMhtml(sentinel.origin, fileTarget),
    `${sentinel.origin}/page.html`
  )
  await page.evaluate((id) => {
    window.location.hash = `/cases/${id}/captures`
  }, caseId)
  const rows = page.getByTestId('capture-item')
  await expect(rows).toHaveCount(1, { timeout: 15000 })
  await rows.first().click()
  await page.getByRole('tab', { name: 'Page', exact: true }).click()
  await expect(page.getByTestId('mhtml-viewer')).toBeVisible({ timeout: 15000 })
  return caseId
}

test.describe('stored-page viewer links', () => {
  let sentinel: Sentinel
  let dir: string
  let fileTarget: string

  test.beforeEach(async () => {
    sentinel = await startSentinel()
    dir = await mkdtemp(join(tmpdir(), 'birdbrain-links-'))
    const target = join(dir, 'local-target.html')
    await writeFile(target, '<html><body>a local file outside the capture</body></html>')
    fileTarget = pathToFileURL(target).toString()
  })

  test.afterEach(async () => {
    await sentinel.close()
    await rm(dir, { recursive: true, force: true })
  })

  test('the main process drives the guest: a hover reports the link under it', async ({
    electronApp,
    page
  }) => {
    test.setTimeout(120000)
    await recordGuestEvents(electronApp)
    await openLinksCapture(page, sentinel, fileTarget)
    const load: GuestEvent[] = []
    await expect
      .poll(async () => {
        load.push(...(await takeGuestEvents(electronApp)))
        return load.some((e) => e.ev === 'commit' && e.main === false)
      })
      .toBe(true)
    // The src load and the archive's own iframe part both commit without raising
    // will-frame-navigate, which is why the guard keys on the commit rather than on
    // its own allow, and why blocking every frame after it leaves the iframe intact.
    expect(load.filter((e) => e.ev === 'commit').map((e) => e.main)).toEqual([true, false])
    expect(load.filter((e) => e.ev === 'will-frame-navigate')).toEqual([])

    await guestMouse(electronApp, { x: ROW.x, y: rowY('absolute', 'sub') })
    await expect
      .poll(async () => (await takeGuestEvents(electronApp)).map((e) => e.ev + ' ' + e.url))
      .toContain(`target ${sentinel.origin}/absolute-sub`)
    expect(sentinel.requests).toEqual([])
  })
})
