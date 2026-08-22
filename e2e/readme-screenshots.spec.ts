import { test, expect } from './fixtures/electronApp'
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

type Page = import('@playwright/test').Page
type ElectronApplication = import('@playwright/test').ElectronApplication

const OUT_DIR = join(__dirname, '../test-results/readme')

// ---------------------------------------------------------------------------
// Fictional page HTML used both as the capture "screenshot" (rendered in an
// offscreen BrowserWindow) and as the MHTML body (so extraction finds IoCs).
// ASCII only: the MHTML part is declared 7bit.
// ---------------------------------------------------------------------------

const PAGE_STYLE = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; background: #f5f5f7; color: #1c1c1e; }
  header { background: #14141c; color: #fff; padding: 18px 48px; display: flex; align-items: center; justify-content: space-between; }
  header .logo { font-size: 20px; font-weight: 700; letter-spacing: 0.5px; }
  header nav a { color: #b9b9c5; text-decoration: none; margin-left: 24px; font-size: 14px; }
  .hero { background: linear-gradient(135deg, #2b2b3d 0%, #1a1a26 100%); color: #fff; padding: 56px 48px; }
  .hero h1 { font-size: 34px; margin-bottom: 10px; }
  .hero p { color: #a7a7b5; font-size: 16px; max-width: 560px; }
  .content { padding: 36px 48px; }
  .grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-top: 18px; }
  .card { background: #fff; border-radius: 10px; padding: 18px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
  .card .thumb { height: 110px; border-radius: 6px; margin-bottom: 12px; }
  .card h3 { font-size: 15px; margin-bottom: 6px; }
  .card .price { color: #0a7d40; font-weight: 700; font-size: 17px; }
  .card .was { color: #999; text-decoration: line-through; font-size: 13px; margin-left: 6px; }
  .banner { background: #fff3cd; border: 1px solid #ffe69c; color: #664d03; padding: 12px 48px; font-size: 14px; }
  footer { background: #14141c; color: #8a8a97; padding: 28px 48px; font-size: 13px; line-height: 1.9; margin-top: 40px; }
  footer a { color: #b9b9c5; text-decoration: none; }
  h2.section { font-size: 22px; margin-bottom: 4px; }
  p.sub { color: #666; font-size: 14px; }
`

const STOREFRONT_HTML = `<html><head><title>Velvet Fox Deals - Clearance Electronics</title>
<style>${PAGE_STYLE}</style>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date()); gtag('config', 'G-8XK2M4PQ71');
</script>
<script data-src="https://www.googletagmanager.com/gtm.js?id=GTM-5WKX93F"></script>
<script>
  !function(f,b,e,v,n,t,s){/* fb pixel */}(window,document,'script');
  fbq('init', '482915067233918'); fbq('track', 'PageView');
</script>
</head><body>
<header>
  <div class="logo">VELVET FOX DEALS</div>
  <nav><a href="#">Electronics</a><a href="#">Gift Cards</a><a href="#">Crypto Pay</a><a href="/contact">Contact</a></nav>
</header>
<div class="banner">FLASH SALE - 85% off flagship phones. Payment by crypto or gift card only. No refunds.</div>
<div class="hero">
  <h1>Flagship phones from $89</h1>
  <p>Direct-from-warehouse clearance. Limited stock, shipped worldwide from our EU depot. Pay with BTC for an extra 10% off.</p>
</div>
<div class="content">
  <h2 class="section">Today's clearance</h2>
  <p class="sub">Prices valid for the next 2 hours</p>
  <div class="grid">
    <div class="card"><div class="thumb" style="background:#3a4a6b"></div><h3>NovaPhone 16 Pro 256GB</h3><span class="price">$89.00</span><span class="was">$1,099</span></div>
    <div class="card"><div class="thumb" style="background:#6b3a4a"></div><h3>GalaxyBook Ultra 15"</h3><span class="price">$129.00</span><span class="was">$1,450</span></div>
    <div class="card"><div class="thumb" style="background:#3a6b52"></div><h3>AirBuds Max II</h3><span class="price">$39.00</span><span class="was">$549</span></div>
    <div class="card"><div class="thumb" style="background:#5a3a6b"></div><h3>Steam Gift Card $500</h3><span class="price">$120.00</span><span class="was">$500</span></div>
    <div class="card"><div class="thumb" style="background:#6b5a3a"></div><h3>DroneX 4K Quadcopter</h3><span class="price">$75.00</span><span class="was">$899</span></div>
    <div class="card"><div class="thumb" style="background:#3a5a6b"></div><h3>SmartWatch S9 Titanium</h3><span class="price">$49.00</span><span class="was">$799</span></div>
  </div>
</div>
<footer>
  Velvet Fox Trading Ltd - support@velvetfox-deals.net - Telegram: t.me/velvetfoxdeals<br/>
  Twitter: twitter.com/velvetfoxdeals - Instagram: instagram.com/velvetfox.deals<br/>
  Mirror: vfxmarketplace4hzt6qqkxkdzk3ojjmi2xn2nl2bsqvyv3j5nvz7cnnid.onion<br/>
  Served by edge node 198.51.100.24 - AS64500
</footer>
</body></html>`

const CONTACT_HTML = `<html><head><title>Velvet Fox Deals - Contact and Payment</title>
<style>${PAGE_STYLE}
  .kv { background: #fff; border-radius: 10px; padding: 24px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); max-width: 640px; margin-top: 18px; }
  .kv dt { font-weight: 600; font-size: 13px; color: #666; margin-top: 14px; text-transform: uppercase; letter-spacing: 0.5px; }
  .kv dd { font-size: 15px; margin-top: 3px; font-family: Consolas, monospace; }
</style></head><body>
<header><div class="logo">VELVET FOX DEALS</div><nav><a href="/">Store</a><a href="#">Contact</a></nav></header>
<div class="content">
  <h2 class="section">Contact and payment details</h2>
  <p class="sub">Orders are confirmed only after 2 network confirmations.</p>
  <dl class="kv">
    <dt>Sales</dt>
    <dd>orders@velvetfox-deals.net</dd>
    <dt>Escrow disputes</dt>
    <dd>escrow-desk@protonmail.com</dd>
    <dt>Telegram</dt>
    <dd>t.me/velvetfox_support</dd>
    <dt>BTC</dt>
    <dd>bc1q9d3xk2m4pq71w8n5v0t2r6y4u9i3o5p7a1s3d5</dd>
    <dt>Backup domain</dt>
    <dd>velvetfox-outlet.com</dd>
    <dt>Payment API host</dt>
    <dd>pay.vfx-gateway.net (203.0.113.47)</dd>
  </dl>
</div>
<footer>Velvet Fox Trading Ltd - Registered agent: Wexford Formations, Roseau</footer>
</body></html>`

const REVIEW_HTML = `<html><head><title>ScamRadar Forum - Velvet Fox Deals thread</title>
<style>${PAGE_STYLE}
  .post { background: #fff; border-radius: 10px; padding: 18px 22px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); margin-top: 16px; max-width: 760px; }
  .post .meta { font-size: 12px; color: #888; margin-bottom: 8px; }
  .post p { font-size: 14px; line-height: 1.6; }
</style></head><body>
<header><div class="logo">SCAMRADAR FORUM</div><nav><a href="#">Threads</a><a href="#">Report</a></nav></header>
<div class="content">
  <h2 class="section">Thread: velvetfox-deals.net - anyone got their order?</h2>
  <p class="sub">14 replies - last activity 2 hours ago</p>
  <div class="post"><div class="meta">rustbelt_saver - 2 days ago</div>
    <p>Paid 0.0041 BTC for a NovaPhone on the 12th. Tracking number never arrived and now support redirects me to a Telegram bot. The checkout page posted my card BIN to pay.vfx-gateway.net before switching me to crypto.</p></div>
  <div class="post"><div class="meta">dns_diver - 2 days ago</div>
    <p>Domain is 11 days old. Same registrant rotated through velvetfox-outlet.com and aurora-clearance.shop last month. All three resolve to 203.0.113.47, and the checkout script matches the skimmer kit seen on the registrant's earlier storefronts.</p></div>
  <div class="post"><div class="meta">mod_annika - 1 day ago</div>
    <p>Marking as confirmed scam. Evidence archived. Do not send funds. If you paid, file a report and include the wallet bc1q9d3xk2m4pq71w8n5v0t2r6y4u9i3o5p7a1s3d5.</p></div>
</div>
<footer>ScamRadar community - reports@scamradar.example.org</footer>
</body></html>`

const CAPTURES = [
  {
    url: 'https://velvetfox-deals.net/',
    title: 'Velvet Fox Deals - Clearance Electronics',
    html: STOREFRONT_HTML,
    height: 1720
  },
  {
    url: 'https://velvetfox-deals.net/contact',
    title: 'Velvet Fox Deals - Contact and Payment',
    html: CONTACT_HTML,
    height: 760
  },
  {
    url: 'https://forum.scamradar.example.org/threads/velvetfox-deals',
    title: 'ScamRadar Forum - Velvet Fox Deals thread',
    html: REVIEW_HTML,
    height: 1100
  }
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildMhtml(url: string, title: string, html: string): string {
  const boundary = '----MultipartBoundary--birdbrainreadme1234'
  return [
    'From: <Saved by Blink>',
    `Snapshot-Content-Location: ${url}`,
    `Subject: ${title}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/related; type="text/html"; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/html',
    'Content-Transfer-Encoding: 7bit',
    `Content-Location: ${url}`,
    '',
    html,
    `--${boundary}--`,
    ''
  ].join('\r\n')
}

async function renderPageToPng(
  electronApp: ElectronApplication,
  html: string,
  width: number,
  height: number
): Promise<string> {
  return electronApp.evaluate(
    async ({ BrowserWindow }, { html, width, height }) => {
      const win = new BrowserWindow({
        show: false,
        width,
        height,
        frame: false,
        webPreferences: { offscreen: true }
      })
      try {
        await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
        await new Promise((r) => setTimeout(r, 600))
        const img = await win.webContents.capturePage()
        return img.toPNG().toString('base64')
      } finally {
        win.destroy()
      }
    },
    { html, width, height }
  )
}

async function seedCapture(
  page: Page,
  caseId: string,
  url: string,
  title: string,
  mhtml: string,
  screenshotBase64: string,
  textContent: string
): Promise<string> {
  return page.evaluate(
    async ({ caseId, url, title, mhtml, screenshotBase64, textContent }) => {
      const status = await fetch('http://127.0.0.1:19845/api/status').then((r) => r.json())
      const token: string = status.serverToken ?? ''
      const shot = Uint8Array.from(atob(screenshotBase64), (c) => c.charCodeAt(0))
      const form = new FormData()
      form.append('source', 'manual')
      form.append('caseId', caseId)
      form.append('url', url)
      form.append('title', title)
      form.append('timestamp', new Date().toISOString())
      form.append('textContent', textContent)
      form.append('extensionVersion', '0.4.2')
      form.append('browserVersion', 'Chrome/138')
      form.append('userAgent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)')
      form.append('mhtml', new Blob([mhtml], { type: 'multipart/related' }), 'capture.mhtml')
      form.append('screenshot', new Blob([shot], { type: 'image/png' }), 'shot.png')
      const r = await fetch('http://127.0.0.1:19845/api/captures', {
        method: 'POST',
        body: form,
        headers: { 'X-Birdbrain-Token': token }
      })
      const body = await r.json()
      if (body.status !== 'ok') throw new Error('Upload failed: ' + JSON.stringify(body))
      return body.captureId as string
    },
    { caseId, url, title, mhtml, screenshotBase64, textContent }
  )
}

async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.evaluate((t) => {
    localStorage.setItem('theme', t)
    document.documentElement.classList.toggle('dark', t === 'dark')
  }, theme)
  await page.waitForTimeout(500)
}

function stripTags(html: string): string {
  return html
    .replace(/<style>[\s\S]*?<\/style>/g, ' ')
    .replace(/<script>[\s\S]*?<\/script>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function shootBothThemes(page: Page, name: string) {
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme)
    await page.screenshot({ path: join(OUT_DIR, `${name}-${theme}.png`) })
  }
}

// ---------------------------------------------------------------------------

test.describe('README screenshots', () => {
  // Not a regression test — a screenshot generator for website/public/assets/. Run with:
  //   README_SHOTS=1 npx playwright test e2e/readme-screenshots.spec.ts
  test.skip(!process.env.README_SHOTS, 'set README_SHOTS=1 to regenerate README screenshots')

  test('capture all README assets', async ({ electronApp, page }) => {
    test.setTimeout(300000)
    mkdirSync(OUT_DIR, { recursive: true })

    const win = electronApp.windows()[0]
    await win.setViewportSize({ width: 1440, height: 900 })

    // Friendlier operator identity for the forensics panel; pre-dismiss the
    // annotation onboarding tooltip so it doesn't overlay the viewer shots.
    await page.evaluate(async () => {
      await (
        window as unknown as {
          birdbrain: { settings: { update: (p: object) => Promise<unknown> } }
        }
      ).birdbrain.settings.update({
        operatorName: 'A. Investigator',
        tooltipsSeen: { 'annotation-tools-always-live': true }
      })
    })

    // --- 0a. First-run onboarding, then the fresh dashboard ------------------
    await page.evaluate(() => {
      window.location.hash = '/'
    })
    await page.waitForTimeout(800)
    await shootBothThemes(page, 'screenshot-onboarding')

    // Mark onboarding complete (settings-gated), then reload for the clean
    // empty dashboard. Direct IPC bypasses React Query, hence the reload.
    await page.evaluate(async () => {
      await (
        window as unknown as {
          birdbrain: { settings: { update: (p: object) => Promise<unknown> } }
        }
      ).birdbrain.settings.update({ hasCompletedOnboarding: true })
    })
    await page.reload()
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 15000 })
    await page.evaluate(() => {
      window.location.hash = '/'
    })
    await page.waitForTimeout(800)
    await shootBothThemes(page, 'screenshot-dashboard-fresh')

    // --- 0b. New case wizard, filled in -------------------------------------
    await page.evaluate(() => {
      window.location.hash = '/cases/new'
    })
    await page.waitForSelector('[data-testid="case-name-input"]', { timeout: 10000 })
    await page.fill('[data-testid="case-name-input"]', 'Velvet Fox storefront takedown')
    const wizardDesc = page.locator('textarea').first()
    if (await wizardDesc.isVisible().catch(() => false)) {
      await wizardDesc.fill(
        'Suspected phishing storefront rotating domains; evidence for registrar abuse report.'
      )
    }
    // Toggle a few initial-selector presets for a richer wizard shot (these
    // also seed real selectors on case creation).
    for (const preset of ['Email Addresses', 'Crypto Addresses', 'IP Addresses', 'Domain Names']) {
      const chip = page.getByRole('button', { name: preset })
      if (await chip.isVisible().catch(() => false)) await chip.click()
    }
    await page.waitForTimeout(300)
    await shootBothThemes(page, 'screenshot-new-case')

    await page.click('[data-testid="case-create-btn"]')
    await page.waitForURL(/#\/cases\/.+\/overview/, { timeout: 10000 })
    const caseIdMatch = page.url().match(/cases\/([^/]+)/)
    if (!caseIdMatch) throw new Error('case id not in url')
    const caseId = caseIdMatch[1]

    const captureIds: string[] = []
    for (const c of CAPTURES) {
      const png = await renderPageToPng(electronApp, c.html, 1280, c.height ?? 1720)
      const id = await seedCapture(
        page,
        caseId,
        c.url,
        c.title,
        buildMhtml(c.url, c.title, c.html),
        png,
        stripTags(c.html)
      )
      captureIds.push(id)
    }

    // --- Seed tags, selectors, and notes via IPC ----------------------------
    await page.evaluate(
      async ({ caseId, captureIds }) => {
        const bb = (
          window as unknown as {
            birdbrain: {
              tags: {
                create: (p: { name: string; color?: string }) => Promise<{ id: string }>
                addToCapture: (p: { captureId: string; tagId: string }) => Promise<void>
              }
              selectors: {
                create: (p: {
                  caseId: string
                  pattern: string
                  isRegex?: boolean
                  label?: string
                }) => Promise<unknown>
              }
              notes: {
                create: (p: {
                  caseId: string
                  captureId?: string
                  title?: string
                  body?: string
                  sourceUrl?: string
                }) => Promise<unknown>
              }
            }
          }
        ).birdbrain

        const phishing = await bb.tags.create({ name: 'phishing', color: '#ef4444' })
        const cryptoScam = await bb.tags.create({ name: 'crypto-scam', color: '#f59e0b' })
        const corroboration = await bb.tags.create({ name: 'corroboration', color: '#22c55e' })
        const priority = await bb.tags.create({ name: 'priority', color: '#8b5cf6' })
        // storefront: phishing + crypto-scam + priority; contact: phishing + crypto-scam;
        // forum thread: corroboration.
        await bb.tags.addToCapture({ captureId: captureIds[0], tagId: phishing.id })
        await bb.tags.addToCapture({ captureId: captureIds[0], tagId: cryptoScam.id })
        await bb.tags.addToCapture({ captureId: captureIds[0], tagId: priority.id })
        await bb.tags.addToCapture({ captureId: captureIds[1], tagId: phishing.id })
        await bb.tags.addToCapture({ captureId: captureIds[1], tagId: cryptoScam.id })
        await bb.tags.addToCapture({ captureId: captureIds[2], tagId: corroboration.id })

        await bb.selectors.create({
          caseId,
          pattern: 'velvetfox',
          label: 'Brand name variants'
        })
        await bb.selectors.create({
          caseId,
          pattern: '203.0.113.47',
          label: 'Shared hosting IP'
        })
        await bb.selectors.create({
          caseId,
          pattern: 'bc1q[a-z0-9]{20,}',
          isRegex: true,
          label: 'BTC wallet addresses'
        })
        await bb.selectors.create({
          caseId,
          pattern: 'vfx-gateway',
          label: 'Payment gateway infra'
        })
        await bb.selectors.create({
          caseId,
          pattern: 'gift card',
          label: 'Gift card lure'
        })

        await bb.notes.create({
          caseId,
          title: 'Registrar abuse report - draft timeline',
          body: 'Domain registered 11 days ago via privacy proxy. Same registrant previously rotated velvetfox-outlet.com and aurora-clearance.shop. All three resolve to 203.0.113.47. Report filed with registrar abuse desk; awaiting case number.'
        })
        await bb.notes.create({
          caseId,
          captureId: captureIds[2],
          title: 'Forum thread corroborates payment flow',
          body: 'Independent victim reports match the checkout behavior observed on the storefront: card BIN posted to pay.vfx-gateway.net before redirect to crypto payment. Moderator confirmed scam and archived evidence.',
          sourceUrl: 'https://forum.scamradar.example.org/threads/velvetfox-deals'
        })
        await bb.notes.create({
          caseId,
          title: 'Next steps',
          body: '1. File registrar abuse report (done)\n2. Report wallet to chain-analysis exchange desks\n3. Submit storefront to Safe Browsing\n4. Re-capture in 48h to document takedown or rotation'
        })
      },
      { caseId, captureIds }
    )

    // Reload so React Query drops caches that predate the seeding above
    // (30s staleTime would otherwise serve empty lists to the views below).
    await page.reload()
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 15000 })

    // --- 1. Hero: captures workspace ---------------------------------------
    await page.evaluate((id) => {
      window.location.hash = `/cases/${id}/captures`
    }, caseId)
    await page.getByTestId('capture-item').first().waitFor({ timeout: 10000 })

    // Verify every capture first so status chips read "Verified" everywhere.
    const itemCount = await page.getByTestId('capture-item').count()
    for (let i = 0; i < itemCount; i++) {
      await page.getByTestId('capture-item').nth(i).click()
      await page.getByTestId('forensics-reverify-btn').waitFor({ timeout: 10000 })
      await page.getByTestId('forensics-reverify-btn').click()
      await expect(page.getByTestId('forensics-chain-status-label')).toHaveText('Verified', {
        timeout: 10000
      })
    }

    await page
      .getByTestId('capture-item')
      .filter({ hasText: 'Clearance Electronics' })
      .first()
      .click()
    // Let the screenshot image decode/render.
    await page.waitForTimeout(1500)
    await shootBothThemes(page, 'screenshot-case')

    // --- 2. Annotate: rectangle + arrow + pinned comment --------------------
    const rectangleTool = page.getByRole('button', { name: 'Rectangle' })
    await expect(rectangleTool).toBeVisible({ timeout: 10000 })
    await rectangleTool.click()
    const stage = page.locator('.konvajs-content').first()
    await expect(stage).toBeVisible()
    let box = await stage.boundingBox()
    if (!box) throw new Error('no stage box')
    // Rectangle around the flash-sale banner / hero pricing area.
    await page.mouse.move(box.x + 40, box.y + 55)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width - 60, box.y + 120, { steps: 12 })
    await page.mouse.up()

    // Pin with a comment on the gift-card product card.
    const pinTool = page.getByRole('button', { name: 'Pin' })
    await pinTool.click()
    box = await stage.boundingBox()
    if (!box) throw new Error('no stage box')
    await page.mouse.click(box.x + box.width / 2 - 185, box.y + 352)
    const pinTextarea = page.getByPlaceholder('What did you find?')
    await pinTextarea.waitFor({ timeout: 5000 })
    await pinTextarea.fill(
      'Crypto/gift-card-only payment and countdown pressure - classic storefront scam pattern.'
    )
    await page.waitForTimeout(400)
    await shootBothThemes(page, 'screenshot-annotate')
    await page.getByRole('button', { name: /^save$/i }).click()
    await page.waitForTimeout(1200)

    // --- 3. Verify: chain of custody (clean capture, no annotations) -------
    await page.getByTestId('capture-item').filter({ hasText: 'Contact and Pay' }).first().click()
    await expect(page.getByTestId('forensics-chain-status-label')).toHaveText('Verified', {
      timeout: 10000
    })
    await page.waitForTimeout(800)
    await shootBothThemes(page, 'screenshot-verify')

    // --- 4. Recon: data explorer -------------------------------------------
    await page.evaluate((id) => {
      window.location.hash = `/cases/${id}/data`
    }, caseId)
    // Wait for extraction results; reprocess if needed.
    const categoriesReady = async () =>
      page
        .locator('text=/indicator(s)? extracted/')
        .isVisible()
        .catch(() => false)
    if (!(await categoriesReady())) {
      await page.waitForTimeout(1500)
    }
    if (!(await categoriesReady())) {
      const reprocess = page.getByRole('button', { name: /reprocess/i })
      if (await reprocess.isVisible().catch(() => false)) {
        await reprocess.click()
        await page.waitForTimeout(3000)
      }
    }
    // Drill into Infrastructure (richest category), then its first subcategory.
    const infraRow = page.locator('button', { hasText: 'Infrastructure' }).first()
    if (await infraRow.isVisible().catch(() => false)) {
      await infraRow.click()
      await page.waitForTimeout(400)
      const domainRow = page.locator('button', { hasText: 'Domain Reference' }).first()
      const subRows = page.locator('.divide-x > div').nth(1).locator('button')
      if (await domainRow.isVisible().catch(() => false)) {
        await domainRow.click()
        await page.waitForTimeout(400)
      } else if ((await subRows.count()) > 0) {
        await subRows.first().click()
        await page.waitForTimeout(400)
      }
    }
    await shootBothThemes(page, 'screenshot-recon')

    // --- 4b. Signals (selectors + tags on one screen, #400) -----------------
    await page.evaluate((id) => {
      window.location.hash = `/cases/${id}/signals`
    }, caseId)
    await page.waitForTimeout(1200)
    await shootBothThemes(page, 'screenshot-signals')

    // --- 4c. Notes overview -------------------------------------------------
    await page.evaluate((id) => {
      window.location.hash = `/cases/${id}/notes`
    }, caseId)
    await page.waitForTimeout(1000)
    await shootBothThemes(page, 'screenshot-notes')

    // --- 4d. (was Tags overview) --------------------------------------------
    // Tags are part of the Signals screen shot above (#400/#700); there is no
    // separate Tags route left to photograph.

    // --- 4e. Command palette over the captures view -------------------------
    await page.evaluate((id) => {
      window.location.hash = `/cases/${id}/captures`
    }, caseId)
    await page.getByTestId('capture-item').first().waitFor({ timeout: 10000 })
    await page.keyboard.press('Control+k')
    await page.waitForTimeout(600)
    await shootBothThemes(page, 'screenshot-command-palette')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)

    // --- 4f. Export dialog ---------------------------------------------------
    await page.getByRole('button', { name: /export/i }).first().click()
    await page.getByRole('menuitem', { name: /export evidence report/i }).click()
    await page.waitForTimeout(800)
    const investigatorInput = page.getByPlaceholder(/your name/i)
    if (await investigatorInput.isVisible().catch(() => false)) {
      await investigatorInput.fill('A. Investigator')
    }
    await shootBothThemes(page, 'screenshot-export-dialog')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)

    // --- 4g. Settings --------------------------------------------------------
    await page.evaluate(() => {
      window.location.hash = '/settings'
    })
    await page.waitForTimeout(1000)
    await shootBothThemes(page, 'screenshot-settings')

    // --- 4h. Extension setup guide ------------------------------------------
    await page.evaluate(() => {
      window.location.hash = '/extension-setup'
    })
    await page.waitForTimeout(1000)
    await shootBothThemes(page, 'screenshot-extension-setup')

    // --- 5. Export: generate report and render it --------------------------
    const exportPath = join(tmpdir(), `birdbrain-readme-report-${Date.now()}.html`)
    await electronApp.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath })
    }, exportPath)

    const exportResult = await page.evaluate(async (caseId) => {
      const w = window as unknown as {
        birdbrain: {
          export: {
            generateReport: (
              caseId: string,
              options: object
            ) => Promise<{ canceled: boolean; filePath?: string }>
          }
        }
      }
      return w.birdbrain.export.generateReport(caseId, {
        format: 'html',
        include: { captures: true, screenshots: true, auditTrail: true, annotations: 'burned' },
        investigatorName: 'A. Investigator',
        outputPath: ''
      })
    }, caseId)
    expect(exportResult.canceled).toBe(false)

    const reportPng = await electronApp.evaluate(
      async ({ BrowserWindow }, { filePath, width, height }) => {
        const win = new BrowserWindow({
          show: false,
          width,
          height,
          frame: false,
          webPreferences: { offscreen: true }
        })
        try {
          await win.loadFile(filePath)
          await new Promise((r) => setTimeout(r, 800))
          const img = await win.webContents.capturePage()
          return img.toPNG().toString('base64')
        } finally {
          win.destroy()
        }
      },
      { filePath: exportResult.filePath!, width: 1280, height: 1400 }
    )
    writeFileSync(join(OUT_DIR, 'screenshot-export.png'), Buffer.from(reportPng, 'base64'))

    // --- 6. Case overview + populated dashboard -----------------------------
    await page.evaluate((id) => {
      window.location.hash = `/cases/${id}/overview`
    }, caseId)
    await page.waitForSelector('[data-testid="case-overview"]', { timeout: 10000 })
    await page.waitForTimeout(500)
    await shootBothThemes(page, 'screenshot-overview')

    await page.evaluate(() => {
      window.location.hash = '/'
    })
    await page.waitForTimeout(1000)
    await shootBothThemes(page, 'screenshot-dashboard')
  })
})
