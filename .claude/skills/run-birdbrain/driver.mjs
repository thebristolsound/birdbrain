// REPL driver for the Birdbrain Electron app. Run under xvfb-run from the repo root,
// usually inside tmux: one command per line on stdin, results on stdout.
// Launch setup mirrors e2e/fixtures/electronApp.ts; see SKILL.md for why each step exists.
import { _electron as electron } from '@playwright/test'
import { generateKeyPairSync } from 'node:crypto'
import * as fs from 'node:fs'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import * as readline from 'node:readline'

const REPO = path.resolve(import.meta.dirname, '../../..')
const SHOT_DIR = process.env.SCREENSHOT_DIR || '/tmp/birdbrain-shots'
const SERVER = 'http://127.0.0.1:19845'
fs.mkdirSync(SHOT_DIR, { recursive: true })

let app = null
let page = null
let userData = null
let caseId = null

// Without a key on disk the app raises a native key-acknowledgement modal that Playwright
// cannot see or dismiss, and launch hangs. Skipping settings.json is what makes a fresh install.
function seedUserData(dir, fresh) {
  if (!fresh) {
    fs.writeFileSync(
      path.join(dir, 'settings.json'),
      JSON.stringify({ operatorName: 'Driver Operator' })
    )
  }
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  })
  fs.writeFileSync(path.join(dir, 'signing-key.pem'), privateKey)
  fs.writeFileSync(path.join(dir, 'signing-public-key.pem'), publicKey)
}

function portInUse(port) {
  return new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1')
    s.once('connect', () => (s.destroy(), resolve(true)))
    s.once('error', () => resolve(false))
  })
}

function need() {
  if (!page) throw new Error('launch first')
}

const COMMANDS = {
  async launch(arg) {
    if (app) return console.log('already launched')
    if (!fs.existsSync(path.join(REPO, 'out/main/index.js'))) {
      throw new Error('out/main/index.js missing - run pnpm build')
    }
    // A taken port makes main show a native error box (invisible under Xvfb) and exit before
    // opening a window, which surfaces only as a firstWindow timeout.
    if (await portInUse(19845)) {
      throw new Error('127.0.0.1:19845 is taken (another Birdbrain?); close it and launch again')
    }
    const fresh = arg === 'fresh'
    userData = fs.mkdtempSync(path.join(os.tmpdir(), 'birdbrain-driver-'))
    seedUserData(userData, fresh)
    const env = { ...process.env, BIRDBRAIN_USER_DATA: userData }
    // Inherited from an Electron-hosted agent shell, this makes the binary run as plain Node.
    delete env.ELECTRON_RUN_AS_NODE
    const t0 = Date.now()
    // --ozone-platform=x11: on a Wayland desktop Electron otherwise opens on the live session,
    // not Xvfb, even with WAYLAND_DISPLAY unset (XDG_SESSION_TYPE alone is enough).
    app = await electron.launch({
      args: ['.', `--user-data-dir=${userData}`, '--ozone-platform=x11'],
      cwd: REPO,
      env,
      timeout: 60_000
    })
    app.process().stderr.on('data', (d) => {
      if (process.env.DRIVER_STDERR) process.stderr.write('[electron] ' + d)
    })
    try {
      page = await app.firstWindow()
      await page.waitForSelector('[data-testid="app-ready"]', { timeout: 30_000 })
    } catch (e) {
      await COMMANDS.quit()
      throw e
    }
    console.log(`launched in ${Date.now() - t0}ms. userData: ${userData}`)
    console.log('url:', page.url())
  },

  async ss(name) {
    need()
    const f = path.join(SHOT_DIR, (name || `ss-${Date.now()}`) + '.png')
    await page.screenshot({ path: f })
    console.log('screenshot:', f)
  },

  // page.setViewportSize does not resize an Electron window; resize the BrowserWindow.
  async size(arg) {
    need()
    const [w, h] = (arg || '1440 900').split(/\s+/).map(Number)
    await app.evaluate(
      ({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setSize(w, h),
      [w, h]
    )
    await page.waitForTimeout(300)
    console.log('viewport:', JSON.stringify(await page.evaluate(() => [innerWidth, innerHeight])))
  },

  async goto(route) {
    need()
    await page.evaluate((r) => (window.location.hash = r), route.replace(/^#/, ''))
    await page.waitForTimeout(500)
    console.log('url:', page.url())
  },

  async 'case-view'(tab) {
    need()
    caseId ||= page.url().match(/cases\/([^/]+)/)?.[1]
    if (!caseId) throw new Error('open a case first (new-case, or click into one)')
    await COMMANDS.goto(`/cases/${caseId}/${tab || 'overview'}`)
  },

  async click(sel) {
    need()
    await page.locator(sel).first().click({ timeout: 10_000 })
    console.log('clicked', sel)
  },

  async 'click-text'(text) {
    need()
    await page.getByText(text, { exact: false }).first().click({ timeout: 10_000 })
    console.log('clicked text', JSON.stringify(text))
  },

  async 'click-role'(arg) {
    need()
    const [role, ...name] = arg.split(' ')
    await page.getByRole(role, { name: name.join(' ') }).first().click({ timeout: 10_000 })
    console.log('clicked', role, JSON.stringify(name.join(' ')))
  },

  async fill(arg) {
    need()
    const [sel, ...rest] = arg.split(' ')
    await page.fill(sel, rest.join(' '))
    console.log('filled', sel)
  },

  async type(text) {
    need()
    await page.keyboard.type(text, { delay: 20 })
  },

  async press(key) {
    need()
    await page.keyboard.press(key)
  },

  async wait(sel) {
    need()
    await page.waitForSelector(sel, { timeout: 10_000 })
    console.log('found:', sel)
  },

  async text(sel) {
    need()
    console.log(await page.locator(sel || 'body').first().innerText())
  },

  async testids() {
    need()
    const ids = await page.evaluate(() =>
      [...document.querySelectorAll('[data-testid]')].map((e) => e.getAttribute('data-testid'))
    )
    console.log([...new Set(ids)].join('\n'))
  },

  async eval(expr) {
    need()
    console.log(JSON.stringify(await page.evaluate(expr), null, 2))
  },

  // Runs in the Electron main process; the argument is a function body given `electron`.
  async 'eval-main'(body) {
    if (!app) throw new Error('launch first')
    const fn = `async (electron) => { ${body} }`
    const out = await app.evaluate((electronModule, src) => eval(src)(electronModule), fn)
    console.log(JSON.stringify(out, null, 2))
  },

  async 'new-case'(name) {
    need()
    await page.evaluate(() => (window.location.hash = '/cases/new'))
    await page.waitForSelector('[data-testid="case-name-input"]', { timeout: 10_000 })
    await page.fill('[data-testid="case-name-input"]', name || `Driver case ${Date.now()}`)
    await page.click('[data-testid="case-create-btn"]')
    await page.waitForURL(/#\/cases\/.+\/overview/, { timeout: 10_000 })
    caseId = page.url().match(/cases\/([^/]+)/)[1]
    console.log('case:', caseId)
  },

  // Posts a manual capture to the local capture server, the route the extension uses.
  async capture(slug) {
    need()
    if (!caseId) throw new Error('run new-case first')
    slug = slug || `page-${Date.now()}`
    const result = await page.evaluate(
      async ({ base, caseId, slug }) => {
        const { serverToken } = await (await fetch(`${base}/api/status`)).json()
        const form = new FormData()
        form.append('source', 'manual')
        form.append('caseId', caseId)
        form.append('url', `https://example.com/${slug}`)
        form.append('title', `Capture ${slug}`)
        form.append('timestamp', new Date().toISOString())
        form.append('textContent', slug)
        form.append('extensionVersion', '0.1.0')
        form.append('browserVersion', 'Chrome/120')
        form.append('userAgent', 'Mozilla/5.0')
        // A bare HTML body (what e2e/fixtures/seed.ts posts) renders blank in the Page tab.
        const mhtml = [
          'From: <Saved by Blink>',
          `Snapshot-Content-Location: https://example.com/${slug}`,
          `Subject: Capture ${slug}`,
          'MIME-Version: 1.0',
          'Content-Type: multipart/related; type="text/html"; boundary="----driver"',
          '',
          '------driver',
          'Content-Type: text/html',
          'Content-Transfer-Encoding: 8bit',
          `Content-Location: https://example.com/${slug}`,
          '',
          `<html><body><h1>${slug}</h1><p>Seeded by the run-birdbrain driver.</p></body></html>`,
          '------driver--',
          ''
        ].join('\r\n')
        form.append('mhtml', new Blob([mhtml], { type: 'multipart/related' }), 'capture.mhtml')
        const r = await fetch(`${base}/api/captures`, {
          method: 'POST',
          body: form,
          headers: { 'X-Birdbrain-Token': serverToken }
        })
        return r.json()
      },
      { base: SERVER, caseId, slug }
    )
    console.log(JSON.stringify(result))
  },

  async windows() {
    if (!app) throw new Error('launch first')
    for (const w of app.windows()) console.log(' ', w.url())
  },

  async quit() {
    if (app) await app.close().catch(() => {})
    if (userData) fs.rmSync(userData, { recursive: true, force: true })
    app = page = userData = caseId = null
    console.log('quit')
  },

  help() {
    console.log('commands:', Object.keys(COMMANDS).join(', '))
  }
}

// process.stdin, not fs.createReadStream('/dev/stdin'): a threadpool read blocked on the tty
// keeps process.exit() from returning. Playwright gives Electron its own pipes, so no sharing.
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: 'driver> '
})

rl.on('line', async (line) => {
  const [cmd, ...rest] = line.trim().split(/\s+/)
  if (!cmd) return rl.prompt()
  const fn = COMMANDS[cmd]
  if (!fn) {
    console.log('unknown:', cmd, '- try: help')
    return rl.prompt()
  }
  try {
    await fn(rest.join(' '))
  } catch (e) {
    console.log('ERROR:', e.message.split('\n')[0])
  }
  if (cmd === 'quit') process.exit(0)
  rl.prompt()
})
rl.on('close', async () => {
  await COMMANDS.quit()
  process.exit(0)
})

console.log('birdbrain driver - "help" for commands, "launch" to start')
rl.prompt()
