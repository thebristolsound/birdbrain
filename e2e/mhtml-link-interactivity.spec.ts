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
      wc.on('did-navigate-in-page', (_e, url, main) => push({ ev: 'in-page', url, main }))
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

// Waits for the guest's load to finish, which is its iframe part committing, and
// returns the events it raised on the way.
async function waitForGuestLoad(electronApp: ElectronApplication): Promise<GuestEvent[]> {
  const load: GuestEvent[] = []
  await expect
    .poll(async () => {
      load.push(...(await takeGuestEvents(electronApp)))
      return load.some((e) => e.ev === 'commit' && e.main === false)
    })
    .toBe(true)
  return load
}

async function guestState(electronApp: ElectronApplication) {
  return electronApp.evaluate(({ BrowserWindow, webContents }) => {
    const guest = webContents.getAllWebContents().find((wc) => wc.getType() === 'webview')
    if (!guest) throw new Error('no guest webContents')
    return {
      url: guest.getURL(),
      frames: guest.mainFrame.framesInSubtree.map((frame) => frame.url),
      windows: BrowserWindow.getAllWindows().length,
      contents: webContents.getAllWebContents().length
    }
  })
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
    const load = await waitForGuestLoad(electronApp)
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

  // #1708 D2, D17. Every link is live to the pointer now, so this is the click matrix
  // the removed stylesheet used to stand in front of.
  test('no click in the main frame leaves the stored page, opens a window or reaches the network', async ({
    electronApp,
    page
  }) => {
    test.setTimeout(180000)
    await recordGuestEvents(electronApp)
    await openLinksCapture(page, sentinel, fileTarget)
    await waitForGuestLoad(electronApp)
    const before = await guestState(electronApp)

    const clicks: { button: Button; modifiers?: Modifier[] }[] = [
      { button: 'left' },
      { button: 'middle' },
      { button: 'left', modifiers: ['control'] },
      { button: 'left', modifiers: ['shift'] }
    ]
    const rows: RowName[] = ['relative', 'absolute', 'blank', 'file', 'form', 'public']
    for (const name of rows) {
      for (const click of clicks) {
        await guestMouse(electronApp, { x: ROW.x, y: rowY(name, 'main'), ...click })
        await page.waitForTimeout(300)
        const events = await takeGuestEvents(electronApp)
        const label = `${name} ${click.button} ${click.modifiers?.join('+') ?? ''}`
        expect(
          events.filter((e) => e.ev === 'commit'),
          label
        ).toEqual([])
        expect(
          events.filter((e) => e.ev === 'in-page'),
          label
        ).toEqual([])
        expect(await guestState(electronApp), label).toEqual(before)
      }
    }
    // A left click on an http(s) link reached the guard, which refused it: the
    // will-frame-navigate entry is the guard being asked, and no commit followed.
    await guestMouse(electronApp, { x: ROW.x, y: rowY('absolute', 'main'), button: 'left' })
    await expect
      .poll(async () =>
        (await takeGuestEvents(electronApp)).filter((e) => e.ev === 'will-frame-navigate')
      )
      .toEqual([{ ev: 'will-frame-navigate', url: `${sentinel.origin}/absolute-main`, main: true }])

    // A fragment link in the main frame is not a same-document jump. Chromium resolves
    // it against the part's Content-Location, the page's original address, which is
    // not the stored file the frame shows, so it is a load of another document and
    // the guard refuses it: the page does not scroll.
    await guestMouse(electronApp, { x: ROW.x, y: rowY('fragment', 'main'), button: 'left' })
    await expect
      .poll(async () =>
        (await takeGuestEvents(electronApp)).filter((e) => e.ev !== 'target' && e.ev !== 'start')
      )
      .toEqual([
        { ev: 'will-frame-navigate', url: `${sentinel.origin}/page.html#far-main`, main: true }
      ])
    expect(await guestState(electronApp)).toEqual(before)

    expect(sentinel.requests).toEqual([])
  })

  // Chromium serves an MHTML document's subframes from the archive itself and never
  // asks the navigation throttles, so will-frame-navigate is not raised for them and
  // the guard is not consulted. What this pins is what a subframe click can do anyway:
  // nothing is fetched, no window opens, the main frame stays put and no frame reaches
  // a local file. A left click on a link to another document does swap the iframe for
  // a different, empty document; the viewer says so and offers a reload, and the
  // reload brings the stored frame back. That swap was possible before #1708 too,
  // since the stylesheet never reached a subframe.
  test('a click in the archive iframe reaches no network, and a swapped frame is flagged', async ({
    electronApp,
    page
  }) => {
    test.setTimeout(180000)
    await recordGuestEvents(electronApp)
    await openLinksCapture(page, sentinel, fileTarget)
    await waitForGuestLoad(electronApp)
    const before = await guestState(electronApp)
    expect(before.frames).toEqual([before.url, 'cid:frame-sub@mhtml.blink'])
    const notice = page.getByTestId('frame-changed-notice')
    // The iframe's own first commit is the archive's, and raises no notice.
    await expect(notice).toHaveCount(0)

    const rows: RowName[] = ['relative', 'absolute', 'blank', 'file', 'form', 'public']
    const subframeCommits: Record<string, string[]> = {}
    for (const name of rows) {
      for (const button of ['left', 'middle'] as const) {
        await guestMouse(electronApp, { x: ROW.x, y: rowY(name, 'sub'), button })
        await page.waitForTimeout(400)
        const events = await takeGuestEvents(electronApp)
        const label = `${name} ${button}`
        expect(
          events.filter((e) => e.ev === 'will-frame-navigate'),
          label
        ).toEqual([])
        expect(
          events.filter((e) => e.ev === 'commit' && e.main),
          label
        ).toEqual([])
        const after = await guestState(electronApp)
        expect(after.url, label).toBe(before.url)
        expect(after.windows, label).toBe(before.windows)
        expect(after.contents, label).toBe(before.contents)
        expect(
          after.frames.some((url) => url.startsWith('file:') && url !== before.url),
          label
        ).toBe(false)
        const commits = events.filter((e) => e.ev === 'commit').map((e) => e.url)
        if (commits.length > 0) {
          subframeCommits[label] = commits
          await expect(notice, label).toBeVisible()
          await notice.getByRole('button', { name: 'Reload' }).click()
          await waitForGuestLoad(electronApp)
          await expect(notice, label).toHaveCount(0)
          expect((await guestState(electronApp)).frames, label).toEqual(before.frames)
        } else {
          await expect(notice, label).toHaveCount(0)
        }
      }
    }
    // Exactly what the iframe committed, for each click that committed anything.
    expect(subframeCommits).toEqual({
      'relative left': ['about:blank#blocked'],
      'absolute left': [`${sentinel.origin}/absolute-sub`],
      'public left': ['https://example.test/sub']
    })

    // In the iframe a fragment link is a same-document jump, which goes ahead.
    await guestMouse(electronApp, { x: ROW.x, y: rowY('fragment', 'sub'), button: 'left' })
    await expect
      .poll(async () => (await takeGuestEvents(electronApp)).filter((e) => e.ev === 'in-page'))
      .toEqual([{ ev: 'in-page', url: 'cid:frame-sub@mhtml.blink#far-sub', main: false }])
    await expect(notice).toHaveCount(0)

    expect(sentinel.requests).toEqual([])
  })

  test('hover shows the destination, and each right-click opens the menu on its own link', async ({
    electronApp,
    page
  }) => {
    test.setTimeout(120000)
    await recordGuestEvents(electronApp)
    await openLinksCapture(page, sentinel, fileTarget)
    await waitForGuestLoad(electronApp)

    const bubble = page.getByTestId('link-status-bubble')
    await guestMouse(electronApp, { x: ROW.x, y: rowY('absolute', 'main') })
    await expect(bubble).toHaveText(`${sentinel.origin}/absolute-main`)
    await guestMouse(electronApp, { x: 900, y: 200 })
    await expect(bubble).toHaveCount(0)

    const menu = page.getByTestId('entity-context-menu')
    const capture = page.getByTestId('context-menu-item-link-capture')
    // Right-clicks a link and checks the menu opened on it, at the pointer. Radix
    // places the menu's corner on the point it is given, so a placement that missed
    // the pane's scroll or the guest's position lands far from the link.
    const rightClick = async (name: RowName, frame: 'main' | 'sub', label: string) => {
      const y = rowY(name, frame)
      await guestMouse(electronApp, { x: ROW.x, y, button: 'right' })
      await expect(menu).toHaveAttribute('aria-label', label)
      const guestBox = (await page.getByTestId('mhtml-viewer').boundingBox())!
      const menuBox = (await menu.boundingBox())!
      expect(Math.abs(menuBox.x - (guestBox.x + ROW.x)), `${label} x`).toBeLessThan(8)
      expect(Math.abs(menuBox.y - (guestBox.y + y)), `${label} y`).toBeLessThan(8)
      return guestBox
    }
    // Chromium re-measures where the guest sits shortly after the pane scrolls or the
    // window resizes, and reports a right-click from that measurement. The pause
    // stands for the Operator's own between scrolling and right-clicking.
    const settle = () => page.waitForTimeout(400)
    const scrollPane = async (top: number) => {
      const scrolled = await page.evaluate((amount) => {
        const pane = document.querySelector('[data-testid="mhtml-viewer-scroll"]') as HTMLElement
        pane.scrollTop = amount
        return pane.scrollTop
      }, top)
      await settle()
      return scrolled
    }

    expect(await scrollPane(120)).toBeGreaterThan(0)
    await rightClick('public', 'main', 'Link actions: https://example.test/main')
    await expect(capture).toHaveText('Capture link')
    await expect(capture).not.toHaveAttribute('data-disabled', '')

    // A second right-click, on another link, opens on that link.
    await rightClick('absolute', 'main', `Link actions: ${sentinel.origin}/absolute-main`)
    await expect(capture).toHaveText('Capture link (Points at a loopback address)')
    await expect(capture).toHaveAttribute('data-disabled', '')
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)

    // A window resize while scrolled, and then a collapsed details column, each move
    // the guest on screen.
    await page.setViewportSize({ width: 1250, height: 850 })
    expect(await scrollPane(60)).toBeGreaterThan(0)
    await page.setViewportSize({ width: 1200, height: 800 })
    await settle()
    await rightClick('public', 'sub', 'Link actions: https://example.test/sub')
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Collapse details panel' }).first().click()
    await settle()
    const guestBox = await rightClick(
      'relative',
      'main',
      `Link actions: ${sentinel.origin}/next-main.html`
    )

    // A real pointer-down on the guest closes it too.
    await page.mouse.click(guestBox.x + 900, guestBox.y + 200)
    await expect(menu).toHaveCount(0)
    expect(sentinel.requests).toEqual([])
  })

  test('the Links tab lists both frames’ links from the stored archive', async ({ page }) => {
    test.setTimeout(120000)
    await openLinksCapture(page, sentinel, fileTarget)
    await page.getByRole('tab', { name: 'Links', exact: true }).click()

    // Six anchors in each frame; the form is not a link.
    const rows = page.getByTestId('links-row')
    await expect(rows).toHaveCount(12)
    await expect(page.getByTestId('links-subframe')).toHaveCount(6)
    await expect(rows.filter({ hasText: 'main relative' })).toContainText(
      `${sentinel.origin.replace('http://', '')}/next-main.html`
    )
    await expect(rows.filter({ hasText: 'sub fragment' })).toContainText('same page')

    await page.getByLabel('External only').check()
    await expect(page.getByTestId('links-count')).toHaveText('2 of 12')

    await rows.filter({ hasText: 'main public' }).click({ button: 'right' })
    await expect(page.getByTestId('entity-context-menu')).toHaveAttribute(
      'aria-label',
      'Link actions: https://example.test/main'
    )
    // Reading the list reads the file, not the page's origin.
    expect(sentinel.requests).toEqual([])
  })
})
