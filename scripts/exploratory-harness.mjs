/**
 * Exploratory-tester harness (rollout step 1 of
 * docs/specs/2026-08-14-claude-exploratory-tester-design.md).
 *
 * Launches the BUILT app (out/main/index.js — run `pnpm build` first) via Playwright
 * `_electron` in a throwaway userData dir. Never touches a real profile.
 *
 * Seeding matches e2e/fixtures/electronApp.ts on both counts that decide whether the app
 * starts: an operator name in settings.json, AND a plaintext signing keypair. Playwright's
 * Electron loader pins Chromium's os_crypt to basic_text, so safeStorage is unavailable and
 * initSigningKey would otherwise hit #414's acknowledgement gate — a native modal with no
 * window and nothing to click it, which hangs startup until firstWindow() times out.
 *
 * Two modes, one file:
 *
 *   node scripts/exploratory-harness.mjs serve [--skip-onboarding] [--window-size WxH]
 *     Launch app, listen on 127.0.0.1 (port + auth token written to the info file,
 *     $TMPDIR/birdbrain-harness.json by default, overridable with $BIRDBRAIN_HARNESS_INFO).
 *     Ctrl-C / `close` tool shuts down and deletes the temp dir.
 *     `--skip-onboarding` seeds the completed-onboarding setting so the dashboard opens.
 *     `--window-size` requests the app window's outer dimensions for layout testing.
 *     Accepted between 900x600 and 10000x10000 — the app ignores anything outside that, so
 *     it is refused here rather than silently becoming a default-sized window. The display
 *     and the 900x600 minimum still clamp what is granted; the realized size is reported at
 *     startup and a mismatch is warned about, because screenshots reflect the realized size.
 *     Starting a second serve against a live info file is refused — run it with a distinct
 *     $BIRDBRAIN_HARNESS_INFO for concurrent sessions.
 *     On start, dead harness profiles with a recorded server pid are swept from $TMPDIR.
 *     Headless hosts (WSL2 shells without $DISPLAY): prefix with
 *     `xvfb-run -a -s "-screen 0 1440x900x24"`.
 *
 *   node scripts/exploratory-harness.mjs <tool> [args...]
 *     Client: forward one tool call to the running server, print result.
 *
 * Tools:
 *   snapshot                    accessibility tree (aria snapshot) of the renderer
 *   click <selector>            Playwright selector, e.g. 'role=button[name="New case"]'
 *   type <selector> <text>      fill an input (clears first)
 *   typetext <text>             type into the focused element (works with rich editors)
 *   press <key>                 keyboard key on focused element, e.g. Enter, Control+k
 *   screenshot [name]           full-viewport PNG -> prints saved path
 *   console                     buffered console messages + page errors since last drain
 *   url                         current renderer URL/hash
 *   close                       shut down app + server
 */
import { _electron } from '@playwright/test'
import { createServer } from 'http'
import { mkdtemp, rm, access, writeFile, readFile, mkdir, readdir } from 'fs/promises'
import { join, resolve, dirname } from 'path'
import { tmpdir } from 'os'
import { fileURLToPath } from 'url'
import { generateKeyPairSync, randomBytes, timingSafeEqual } from 'crypto'
// Imported rather than taken from the global: eslint.config.js lints scripts/**/*.mjs against
// a hand-maintained globals list (no parserOptions.project), and Buffer is not on it.
import { Buffer } from 'buffer'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const INFO_FILE = process.env.BIRDBRAIN_HARNESS_INFO ?? join(tmpdir(), 'birdbrain-harness.json')
const TOKEN_HEADER = 'x-birdbrain-harness-token'

const [mode = 'help', ...rest] = process.argv.slice(2)

if (mode === 'serve') await serve(rest)
else if (mode === 'help' || mode === '--help') usage()
else await client(mode, rest)

function usage() {
  console.log(
    'usage: node scripts/exploratory-harness.mjs serve [--skip-onboarding] [--window-size WxH]\n' +
      '       node scripts/exploratory-harness.mjs <snapshot|click|type|typetext|press|screenshot|console|url|close> [args]'
  )
}

function parseServeArgs(args) {
  let skipOnboarding = false
  let windowSize
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--skip-onboarding') {
      skipOnboarding = true
    } else if (arg === '--window-size') {
      windowSize = args[++i]
      if (!windowSize) throw new Error('--window-size requires a value such as 1600x1000')
    } else {
      throw new Error(`unknown serve option "${arg}"`)
    }
  }
  if (windowSize && !/^\d+x\d+$/.test(windowSize)) {
    throw new Error('--window-size must use WxH, for example 1600x1000')
  }
  if (windowSize) {
    // Same bounds as MIN_WINDOW_SIZE and MAX_WINDOW_DIMENSION in src/main/windowSize.ts.
    // Rejecting here rather than silently falling back keeps the charter honest about the size
    // it actually tested, and keeps the realized-size warning in serve() truthful: an
    // out-of-bounds request never reaches the window, so the only causes left for a mismatch
    // are the ones that warning names.
    const [w, h] = windowSize.split('x').map((n) => Number.parseInt(n, 10))
    if (w < 900 || h < 600) {
      throw new Error(`--window-size ${windowSize} is below the app's 900x600 minimum`)
    }
    if (w > 10000 || h > 10000) {
      throw new Error(`--window-size ${windowSize} is above the app's 10000x10000 maximum`)
    }
  }
  return { skipOnboarding, windowSize }
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err?.code === 'EPERM'
  }
}

async function sweepStaleProfiles() {
  const entries = await readdir(tmpdir(), { withFileTypes: true })
  await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('birdbrain-explore-'))
      .map(async (entry) => {
        const dir = join(tmpdir(), entry.name)
        let pid
        try {
          pid = Number.parseInt(await readFile(join(dir, 'server.pid'), 'utf8'), 10)
        } catch {
          return
        }
        if (!Number.isSafeInteger(pid) || pid <= 0 || !processIsAlive(pid)) {
          // Best effort: another local user's birdbrain-explore- dir is not ours to remove,
          // and an EACCES on it must not abort a serve that has nothing to do with it.
          await rm(dir, { recursive: true, force: true }).catch(() => {})
        }
      })
  )
}

// Mirrors seedSigningKey in e2e/fixtures/electronApp.ts — same filenames, encodings and
// algorithm as initSigningKey in src/main/services/signingKey.ts, which reads signing-key.pem
// back through unwrapPrivateKey and returns any value without the 'enc:' prefix unchanged.
// Seeding it takes initSigningKey's existing-key branch, so the #414 acknowledgement gate
// never fires. Generated per run and deleted with the temp profile; never committed.
async function seedSigningKey(userDataDir) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  })
  await writeFile(join(userDataDir, 'signing-key.pem'), privateKey, 'utf-8')
  await writeFile(join(userDataDir, 'signing-public-key.pem'), publicKey, 'utf-8')
}

// Refuses a second serve against the same info file: the client picks its target from that
// file alone, so two servers sharing one would silently hand an agent the wrong app, and
// either shutdown would delete the other's connection details.
async function assertInfoFileFree() {
  let info
  try {
    info = JSON.parse(await readFile(INFO_FILE, 'utf8'))
  } catch {
    return
  }
  if (Number.isSafeInteger(info?.pid) && info.pid > 0 && processIsAlive(info.pid)) {
    console.error(
      `A harness is already running (pid ${info.pid}, info file ${INFO_FILE}).\n` +
        'Close it first, or set $BIRDBRAIN_HARNESS_INFO to a different path for this session.'
    )
    process.exit(1)
  }
}

function isLoopbackHost(host) {
  const hostname = (host ?? '').replace(/:\d+$/, '').toLowerCase()
  return (
    hostname === '127.0.0.1' ||
    hostname === 'localhost' ||
    hostname === '[::1]' ||
    hostname === '::1'
  )
}

function tokenMatches(presented, expected) {
  const a = Buffer.from(String(presented ?? ''), 'utf8')
  const b = Buffer.from(expected, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

async function serve(args) {
  const { skipOnboarding, windowSize } = parseServeArgs(args)
  const mainPath = join(ROOT, 'out/main/index.js')
  try {
    await access(mainPath)
  } catch {
    console.error(`Built app not found at ${mainPath} — run \`pnpm build\` first.`)
    process.exit(1)
  }

  await assertInfoFileFree()
  await sweepStaleProfiles()
  const tempDir = await mkdtemp(join(tmpdir(), 'birdbrain-explore-'))
  const shotsDir = join(tempDir, 'screenshots')
  await mkdir(shotsDir)
  await writeFile(join(tempDir, 'server.pid'), String(process.pid))
  // Seed operator name so the #116 capture gate accepts test captures.
  await writeFile(
    join(tempDir, 'settings.json'),
    JSON.stringify({
      operatorName: 'Exploratory Tester',
      ...(skipOnboarding ? { hasCompletedOnboarding: true } : {})
    })
  )
  await seedSigningKey(tempDir)

  let app
  let page
  let server
  let consoleBuf = []
  // Everything up to the catch below runs before the shutdown handlers exist, so nothing in
  // here can rely on them: a throw would leave the Electron process holding the temp profile
  // until the next serve swept it. The try covers the whole window rather than the calls that
  // are known to throw today, because the last leak (a bad $BIRDBRAIN_HARNESS_INFO path) was
  // introduced by a later line landing outside a narrower guard.
  try {
    app = await _electron.launch({
      args: ['.', `--user-data-dir=${tempDir}`],
      cwd: ROOT,
      env: {
        ...process.env,
        BIRDBRAIN_USER_DATA: tempDir,
        ...(windowSize ? { BIRDBRAIN_WINDOW_SIZE: windowSize } : {})
      }
    })
    page = await app.firstWindow()
    // Attached before the readiness wait, so anything the renderer logs while it boots is
    // buffered. Everything the main process emits before the window exists is still outside
    // what this can see — see the coverage note in the design spec.
    page.on('console', (m) => consoleBuf.push({ type: m.type(), text: m.text() }))
    page.on('pageerror', (e) => consoleBuf.push({ type: 'pageerror', text: String(e) }))
    await page.waitForLoadState('domcontentloaded')
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 15000 })

    const [realWidth, realHeight] = await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].getSize()
    )
    if (windowSize && windowSize !== `${realWidth}x${realHeight}`) {
      console.warn(
        `warning: requested --window-size ${windowSize} but the window is ` +
          `${realWidth}x${realHeight}. The display size or the app's 900x600 minimum clamped ` +
          'it; screenshots and any layout finding reflect the realized size, not the request.'
      )
    }

    let shotN = 0
    const tools = {
      snapshot: () => page.locator('body').ariaSnapshot(),
      click: async ([selector]) => {
        await page.locator(selector).first().click({ timeout: 5000 })
        return `clicked ${selector}`
      },
      type: async ([selector, text]) => {
        await page.locator(selector).first().fill(text, { timeout: 5000 })
        return `typed into ${selector}`
      },
      typetext: async ([text]) => {
        await page.keyboard.type(text)
        return 'typed into focused element'
      },
      press: async ([key]) => {
        await page.keyboard.press(key)
        return `pressed ${key}`
      },
      screenshot: async ([name]) => {
        const file = join(shotsDir, `${String(++shotN).padStart(3, '0')}-${name ?? 'shot'}.png`)
        await page.screenshot({ path: file })
        return file
      },
      console: () => {
        const out = consoleBuf
        consoleBuf = []
        return out
      },
      url: () => page.url(),
      close: async () => {
        setTimeout(shutdown, 50)
        return 'closing'
      }
    }

    const token = randomBytes(32).toString('hex')

    // Same threat model as the capture server (src/main/services/captureServer.ts): binding
    // loopback is not access control. A page in the operator's browser can POST here without a
    // preflight if the body is a CORS-simple type, and DNS rebinding gets it a same-origin read
    // of the reply. Reject non-loopback Host, reject any Origin (no browser is a legitimate
    // client of this CLI), and require the per-run token — all before the body is read.
    server = createServer(async (req, res) => {
      const reply = (status, payload) => {
        if (res.destroyed || res.writableEnded) return
        res.writeHead(status, { 'content-type': 'application/json' })
        res.end(JSON.stringify(payload))
      }
      if (!isLoopbackHost(req.headers.host) || req.headers.origin) {
        req.resume()
        return reply(403, { ok: false, error: 'forbidden' })
      }
      if (!tokenMatches(req.headers[TOKEN_HEADER], token)) {
        req.resume()
        return reply(401, { ok: false, error: 'unauthorized' })
      }
      try {
        // Inside the try: an aborted upload rejects this loop, and an async listener that
        // rejects is an unhandled rejection, which Node 20 turns into a process exit — killing
        // the session and leaking the temp profile before shutdown() can remove it.
        let body = ''
        for await (const chunk of req) body += chunk
        const { tool, args = [] } = JSON.parse(body || '{}')
        if (!tools[tool]) throw new Error(`unknown tool "${tool}"`)
        const result = await tools[tool](args)
        reply(200, { ok: true, result })
      } catch (err) {
        reply(400, { ok: false, error: String(err?.message ?? err) })
      }
    })

    await new Promise((r) => server.listen(0, '127.0.0.1', r))
    const { port } = server.address()
    // 0600: the file carries the control token, and $TMPDIR is world-readable. The mode only
    // applies when this call creates the file, and the default path is predictable inside a
    // world-writable directory — so unlink first and create exclusively, rather than writing
    // the token into a file another local user pre-created and still owns.
    try {
      await rm(INFO_FILE, { force: true })
      await writeFile(
        INFO_FILE,
        JSON.stringify({ port, token, pid: process.pid, tempDir, shotsDir }),
        { mode: 0o600, flag: 'wx' }
      )
    } catch (err) {
      throw new Error(
        `Cannot create the info file ${INFO_FILE} (${String(err?.message ?? err)}). ` +
          'Point $BIRDBRAIN_HARNESS_INFO at a writable path you own.'
      )
    }
    console.log(`harness ready: http://127.0.0.1:${port}  userData=${tempDir}`)
    console.log(`window: ${realWidth}x${realHeight}`)
    console.log(`tools: ${Object.keys(tools).join(', ')}  (info file: ${INFO_FILE})`)
  } catch (err) {
    server?.close()
    await app?.close().catch(() => {})
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    throw err
  }

  let closing = false
  async function shutdown() {
    if (closing) return
    closing = true
    server.close()
    await app.close().catch(() => {})
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    await rm(INFO_FILE, { force: true }).catch(() => {})
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
  // Last resort: anything that escapes the handler above still has to take the temp profile
  // with it, or the profile outlives the process until the next serve sweeps it.
  process.on('uncaughtException', (err) => {
    console.error(`harness fatal: ${String(err?.stack ?? err)}`)
    shutdown()
  })
  process.on('unhandledRejection', (err) => {
    console.error(`harness fatal: ${String(err?.stack ?? err)}`)
    shutdown()
  })
  app.on('close', shutdown)
}

async function client(tool, args) {
  let info
  try {
    info = JSON.parse(await readFile(INFO_FILE, 'utf8'))
  } catch {
    console.error(`No running harness (missing ${INFO_FILE}). Start one with \`serve\`.`)
    process.exit(1)
  }
  // A stale info file left by a crashed server outlives the port it names, so both awaits
  // below can reject on a connection that no longer exists. Report that as the harness being
  // unavailable rather than printing an undici stack at the operator.
  let payload
  try {
    const res = await fetch(`http://127.0.0.1:${info.port}/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [TOKEN_HEADER]: info.token ?? '' },
      body: JSON.stringify({ tool, args })
    })
    payload = await res.json()
  } catch (err) {
    console.error(
      `Harness unavailable at 127.0.0.1:${info.port} (${String(err?.message ?? err)}). ` +
        `The info file ${INFO_FILE} may be stale — start a harness with \`serve\`.`
    )
    process.exit(1)
  }
  const { ok, result, error } = payload
  if (!ok) {
    console.error(`error: ${error}`)
    process.exit(1)
  }
  console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2))
}
