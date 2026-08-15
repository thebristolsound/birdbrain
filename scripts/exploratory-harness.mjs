/**
 * Exploratory-tester harness (rollout step 1 of
 * docs/specs/2026-08-14-claude-exploratory-tester-design.md).
 *
 * Launches the BUILT app (out/main/index.js — run `pnpm build` first) via Playwright
 * `_electron` in a throwaway userData dir (same isolation as e2e/fixtures/electronApp.ts:
 * mkdtemp + seeded settings.json). Never touches a real profile.
 *
 * Two modes, one file:
 *
 *   node scripts/exploratory-harness.mjs serve
 *     Launch app, listen on 127.0.0.1 (port written to $TMPDIR/birdbrain-harness.json).
 *     Ctrl-C / `close` tool shuts down and deletes the temp dir.
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
 *   press <key>                 keyboard key on focused element, e.g. Enter, Control+k
 *   screenshot [name]           full-viewport PNG -> prints saved path
 *   console                     buffered console messages + page errors since last drain
 *   url                         current renderer URL/hash
 *   close                       shut down app + server
 */
import { _electron } from '@playwright/test'
import { createServer } from 'http'
import { mkdtemp, rm, access, writeFile, readFile, mkdir } from 'fs/promises'
import { join, resolve, dirname } from 'path'
import { tmpdir } from 'os'
import { fileURLToPath } from 'url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const INFO_FILE = join(tmpdir(), 'birdbrain-harness.json')

const [mode = 'help', ...rest] = process.argv.slice(2)

if (mode === 'serve') await serve()
else if (mode === 'help' || mode === '--help') usage()
else await client(mode, rest)

function usage() {
  console.log(
    'usage: node scripts/exploratory-harness.mjs serve\n' +
      '       node scripts/exploratory-harness.mjs <snapshot|click|type|press|screenshot|console|url|close> [args]'
  )
}

async function serve() {
  const mainPath = join(ROOT, 'out/main/index.js')
  try {
    await access(mainPath)
  } catch {
    console.error(`Built app not found at ${mainPath} — run \`pnpm build\` first.`)
    process.exit(1)
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'birdbrain-explore-'))
  const shotsDir = join(tempDir, 'screenshots')
  await mkdir(shotsDir)
  // Seed operator name so the #116 capture gate accepts test captures.
  await writeFile(
    join(tempDir, 'settings.json'),
    JSON.stringify({ operatorName: 'Exploratory Tester' })
  )

  let app
  try {
    app = await _electron.launch({
      args: ['.', `--user-data-dir=${tempDir}`],
      cwd: ROOT,
      env: { ...process.env, BIRDBRAIN_USER_DATA: tempDir }
    })
  } catch (err) {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    throw err
  }
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  await page.waitForSelector('[data-testid="app-ready"]', { timeout: 15000 })

  let consoleBuf = []
  page.on('console', (m) => consoleBuf.push({ type: m.type(), text: m.text() }))
  page.on('pageerror', (e) => consoleBuf.push({ type: 'pageerror', text: String(e) }))

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

  const server = createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    try {
      const { tool, args = [] } = JSON.parse(body || '{}')
      if (!tools[tool]) throw new Error(`unknown tool "${tool}"`)
      const result = await tools[tool](args)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, result }))
    } catch (err) {
      res.writeHead(400, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: false, error: String(err?.message ?? err) }))
    }
  })

  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const { port } = server.address()
  await writeFile(INFO_FILE, JSON.stringify({ port, tempDir, shotsDir }))
  console.log(`harness ready: http://127.0.0.1:${port}  userData=${tempDir}`)
  console.log(`tools: ${Object.keys(tools).join(', ')}  (info file: ${INFO_FILE})`)

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
  const res = await fetch(`http://127.0.0.1:${info.port}/`, {
    method: 'POST',
    body: JSON.stringify({ tool, args })
  })
  const { ok, result, error } = await res.json()
  if (!ok) {
    console.error(`error: ${error}`)
    process.exit(1)
  }
  console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2))
}
