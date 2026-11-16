// Proof for a change to what a Capture writes: take the same two Captures with two builds,
// compare what they wrote, and verify one build's Captures with the other.
//
//   xvfb-run -a node capture-proof.mjs take <label> [--repo <checkout>] [--keep-profile]
//   node capture-proof.mjs compare <label-a> <label-b>
//   xvfb-run -a node capture-proof.mjs verify <label> [--repo <checkout>]
//
// `take` drives the build in <checkout>/out (this checkout by default): one background Capture
// and one launched Capture of a fixture page it serves on loopback, then copies the Case folder
// to <out>/<label>/case. `compare` describes each Capture without the values that differ
// between two runs and fails on any difference. `verify` opens the profile `take --keep-profile`
// left for <label> with the build in <checkout> and verifies each Capture, with a changed byte
// to show the verification read the record. Common options: --out <dir> (default
// .preflight/capture-proof in this checkout) and --port <n> (default 29411; the fixture page
// uses the next port). See SKILL.md, "Capture proof".
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as http from 'node:http'
import * as path from 'node:path'
import { gunzipSync } from 'node:zlib'

const HERE_REPO = path.resolve(import.meta.dirname, '../../..')
const USAGE =
  'usage: capture-proof.mjs take <label> | compare <label-a> <label-b> | verify <label>' +
  '  [--repo <checkout>] [--out <dir>] [--port <n>] [--keep-profile]'

function parse(argv) {
  const options = { repo: HERE_REPO, out: null, port: 29411, keepProfile: false }
  const positional = []
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--repo') options.repo = path.resolve(argv[(i += 1)])
    else if (argv[i] === '--out') options.out = path.resolve(argv[(i += 1)])
    else if (argv[i] === '--port') options.port = Number(argv[(i += 1)])
    else if (argv[i] === '--keep-profile') options.keepProfile = true
    else if (argv[i].startsWith('--')) throw new Error(`unknown option ${argv[i]}\n${USAGE}`)
    else positional.push(argv[i])
  }
  options.out ??= path.join(HERE_REPO, '.preflight', 'capture-proof')
  if (!Number.isInteger(options.port) || options.port < 1024) throw new Error('--port needs a port')
  return { command: positional[0], labels: positional.slice(1), options }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(what, read, done, ms = 90_000) {
  const startedAt = Date.now()
  for (;;) {
    const value = await read()
    if (done(value)) return value
    if (Date.now() - startedAt > ms) {
      throw new Error(`${what} did not happen: ${JSON.stringify(value).slice(0, 2000)}`)
    }
    await sleep(500)
  }
}

// The built app in `repo`, on a profile of its own. The Wayland variables go, so its windows
// and the launched browser's land on xvfb-run's display (SKILL.md, Gotchas).
async function launchApp(repo, userData, port) {
  if (!fs.existsSync(path.join(repo, 'out/main/index.js'))) {
    throw new Error(`${repo}/out/main/index.js is missing: run pnpm build there`)
  }
  if (!process.env.DISPLAY) throw new Error('no DISPLAY: run this command under xvfb-run -a')
  const { _electron: electron } = await import(
    path.join(repo, 'node_modules/@playwright/test/index.mjs')
  )
  const env = {
    ...process.env,
    BIRDBRAIN_USER_DATA: userData,
    BIRDBRAIN_CAPTURE_SERVER_PORT: String(port),
    BIRDBRAIN_E2E_ALLOW_LOOPBACK: '1',
    XDG_SESSION_TYPE: 'x11'
  }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.WAYLAND_DISPLAY
  const app = await electron.launch({
    args: ['.', `--user-data-dir=${userData}`, '--ozone-platform=x11'],
    cwd: repo,
    env,
    timeout: 60_000
  })
  const page = await app.firstWindow()
  await page.waitForSelector('[data-testid="app-ready"]', { timeout: 30_000 })
  return { app, page }
}

// A fixed page: a stylesheet, an image, a script that posts a body, and a cookie.
const SECRET = 'PROOFSECRET'
const POST_BODY = 'q=proof'
function serveFixture(port) {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  )
  const html = `<!doctype html><html><head><title>Capture proof page</title>
<link rel="stylesheet" href="/style.css"></head>
<body><h1>Capture proof</h1><p>One page, captured by both Capture Methods.</p>
<img src="/pixel.png" width="40" height="40" alt="pixel">
<script>fetch('/echo', { method: 'POST', body: '${POST_BODY}' })</script></body></html>`
  const server = http.createServer((request, response) => {
    const send = (status, type, body, extra = {}) => {
      response.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...extra })
      response.end(body)
    }
    if (request.url === '/') return send(200, 'text/html', html, { 'Set-Cookie': `sid=${SECRET}` })
    if (request.url === '/style.css') return send(200, 'text/css', 'body { font-family: serif }')
    if (request.url === '/pixel.png') return send(200, 'image/png', png)
    if (request.url === '/echo') return send(200, 'application/json', '{"ok":true}')
    return send(404, 'text/plain', 'not found')
  })
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)))
}

// The Operator types the address: focus the launched browser's window, then its address bar.
function typeAddress(url) {
  const xdo = (...args) => {
    try {
      return execFileSync('xdotool', args).toString().trim()
    } catch (error) {
      if (error.code === 'ENOENT') throw new Error('xdotool is not installed')
      return `${error.stdout ?? ''}`.trim()
    }
  }
  const windows = xdo('search', '--onlyvisible', '--name', '.')
    .split('\n')
    .filter(Boolean)
    .map((id) => ({ id, name: xdo('getwindowname', id) }))
  const target = windows.findLast(({ name }) => /about:blank|Chromium|Chrome/i.test(name))?.id
  if (!target) throw new Error(`no browser window on this display: ${JSON.stringify(windows)}`)
  execFileSync('xdotool', ['windowfocus', '--sync', target])
  execFileSync('xdotool', ['key', '--window', target, 'ctrl+l'])
  execFileSync('xdotool', ['type', '--window', target, '--delay', '20', url])
  execFileSync('xdotool', ['key', '--window', target, 'Return'])
}

const profileDir = (out, label) => path.join(out, `${label}-profile`)

async function take(label, { repo, out, port, keepProfile }) {
  const log = (...args) => console.log(`[${label}]`, ...args)
  const dir = path.join(out, label)
  const userData = profileDir(out, label)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.rmSync(userData, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  fs.mkdirSync(userData, { recursive: true })
  const { prepareProfile } = await import(path.join(repo, 'scripts/dev-seed/profile.mjs'))
  await prepareProfile(userData, { operatorName: 'Proof Operator' })
  const server = await serveFixture(port + 1)
  const url = `http://127.0.0.1:${port + 1}/`
  let app
  try {
    const launched = await launchApp(repo, userData, port)
    app = launched.app
    const { page } = launched
    log('version', await app.evaluate(({ app: a }) => a.getVersion()))
    const { id: caseId } = await page.evaluate(() =>
      window.birdbrain.cases.create({ name: 'Capture proof' })
    )

    await page.evaluate(
      ({ url, caseId }) => window.birdbrain.recapture.enqueue({ urls: [url], caseId }),
      { url, caseId }
    )
    const jobs = await until(
      'the background job',
      () => page.evaluate((caseId) => window.birdbrain.recapture.listJobs({ caseId }), caseId),
      (list) =>
        list.length > 0 && list.every((job) => !['queued', 'held', 'running'].includes(job.state)),
      150_000
    )
    log('background job', JSON.stringify(jobs.map(({ state, error }) => ({ state, error }))))
    // A job that ended any other way stored no Capture, and the run would compare one method.
    if (jobs.some((job) => job.state !== 'stored')) throw new Error('the background job failed')

    // A launched Capture, in the first browser the app lists. A platform that offers none
    // fails here: a run that skipped a method must not read as one that compared it.
    await page.evaluate((caseId) => window.birdbrain.session.activateCase(caseId), caseId)
    const browsers = await page.evaluate(() => window.birdbrain.launchedBrowser.list())
    if (browsers.length === 0) throw new Error('the app lists no browser to launch')
    log('browser', browsers[0].family, browsers[0].executablePath)
    await page.evaluate(
      (executablePath) => window.birdbrain.launchedBrowser.launch(executablePath),
      browsers[0].executablePath
    )
    const status = () => page.evaluate(() => window.birdbrain.launchedBrowser.status())
    await until('the browser to open', status, (value) => value.state === 'open')
    await sleep(1_500)
    typeAddress(url)
    const open = await until(
      'the tab to load the fixture',
      status,
      (value) => value.browser?.tabs?.some((tab) => tab.url === url && tab.firstRequest),
      30_000
    )
    await sleep(1_500)
    const captured = await page.evaluate(
      (targetId) => window.birdbrain.launchedBrowser.capture(targetId, { scrollToLoad: false }),
      open.browser.tabs.find((tab) => tab.url === url).targetId
    )
    log('launched capture', JSON.stringify(captured.browser?.capture ?? captured).slice(0, 400))
    if (captured.browser?.capture?.state !== 'captured') throw new Error('the launched Capture failed')
    await page.evaluate(() => window.birdbrain.launchedBrowser.endSession())

    fs.cpSync(caseFolder(userData), path.join(dir, 'case'), { recursive: true })
    log('copied', path.join(dir, 'case'))
  } finally {
    await app?.close().catch(() => {})
    server.close()
    if (!keepProfile) fs.rmSync(userData, { recursive: true, force: true })
  }
}

// The Case folder the run wrote: the one manifest that is not the demo Case's.
function caseFolder(userData) {
  const manifests = fs
    .readdirSync(userData, { recursive: true })
    .map(String)
    .filter((name) => name.endsWith('manifest.jsonl') && !name.includes('demo'))
  if (manifests.length !== 1) {
    throw new Error(`expected one Case manifest under ${userData}, found ${manifests.length}`)
  }
  return path.dirname(path.join(userData, manifests[0]))
}

const captureEntries = (dir) =>
  fs
    .readFileSync(path.join(dir, 'manifest.jsonl'), 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
    .filter((entry) => entry.type === 'capture')

// The two Capture Methods `take` drives, one Capture each. A run that lacks one proves nothing
// about it, so every reader of a run refuses it: two runs that both lack a method must not
// compare as identical, and a second Capture of one method would hide the first.
const METHODS = ['background', 'launched']
function requireBothMethods(entries, where) {
  for (const method of METHODS) {
    const count = entries.filter((entry) => entry.method === method).length
    if (count !== 1) throw new Error(`${where} holds ${count} ${method} Captures, not one`)
  }
  if (entries.length !== METHODS.length) {
    throw new Error(`${where} holds a Capture of a method other than ${METHODS.join(' and ')}`)
  }
  return entries
}

// Every file an entry declares must be there and hash to the value the entry signs, and a file
// its inventory declares absent must be absent. Two runs that both lost a file would otherwise
// describe alike and compare as identical.
function requireArtifacts(dir, entry, where) {
  const { inventory } = entry
  const declared = [
    ['mhtml', entry.contentHash, true],
    ['png', entry.screenshotHash, inventory.screenshot.present],
    ['txt', entry.textHash, entry.textHash !== undefined],
    ['warc.gz', entry.transactionRecordHash, inventory.transactionRecord.present],
    ['pdf', entry.pdfHash, inventory.pdf.present]
  ]
  for (const [ext, hash, present] of declared) {
    const file = path.join(dir, `${entry.captureId}.${ext}`)
    const what = `${where}: the ${entry.method} Capture's ${ext} file`
    if (!present) {
      if (fs.existsSync(file)) throw new Error(`${what} is there, and its entry declares none`)
      continue
    }
    if (!fs.existsSync(file)) throw new Error(`${what} is missing, and its entry declares one`)
    if (!hash || sha(fs.readFileSync(file)) !== hash) {
      throw new Error(`${what} does not hash to the value its entry signs`)
    }
  }
}

// The stored MHTML without its boundary, its date and its frame ids: the page it was saved
// from, and each part's type, location and a digest of its encoded body.
function describeMhtml(bytes) {
  const text = bytes.toString('latin1')
  const boundary = text.match(/boundary="([^"]+)"/)?.[1]
  if (!boundary) return 'no multipart boundary'
  const [head, ...parts] = text.split(`--${boundary}`)
  const field = (block, name) => block.match(new RegExp(`^${name}: (.*)$`, 'm'))?.[1]?.trim()
  return {
    snapshot: field(head, 'Snapshot-Content-Location'),
    subject: field(head, 'Subject'),
    parts: parts
      .filter((part) => part.includes('\r\n\r\n'))
      .map((part) => {
        const headers = part.slice(0, part.indexOf('\r\n\r\n'))
        const body = part.slice(part.indexOf('\r\n\r\n') + 4)
        return `${field(headers, 'Content-Type')} ${field(headers, 'Content-Location')} ${sha(body)}`
      })
  }
}

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')

// One Capture without its ids, times, and the hashes of files that embed a time. What stays:
// the signed inventory, Bound TLS Details or their absence, the MHTML's parts, and each
// record's type, request or status line, header names, payload digest and credential header
// lines. `requireArtifacts` has already held every file to the hash its entry signs.
function describeCapture(dir, entry) {
  const file = (ext) => path.join(dir, `${entry.captureId}.${ext}`)
  const read = (ext) => (fs.existsSync(file(ext)) ? fs.readFileSync(file(ext)) : null)
  const warc = read('warc.gz')
  const pdf = read('pdf')
  const mhtml = read('mhtml')
  const png = read('png')
  const text = warc ? gunzipSync(warc).toString('latin1') : null
  const records = text?.split(/(?=WARC\/1\.1\r\n)/).map((record) => {
    const head = record.slice(0, record.indexOf('\r\n\r\n'))
    const header = (name) => head.match(new RegExp(`^${name}: (.*)$`, 'm'))?.[1]
    const block = record.slice(record.indexOf('\r\n\r\n') + 4)
    if (header('WARC-Type') === 'warcinfo') {
      const fields = block
        .trim()
        .split('\r\n')
        .map((line) => line.replace(/^(capture-id|tab-target-id): .*/, '$1: ID'))
      return `warcinfo ${fields.join(' | ')}`
    }
    const lines = block.split('\r\n\r\n')[0].split('\r\n')
    const names = lines.slice(1).map((line) => line.split(':')[0].toLowerCase())
    const credentials = lines.slice(1).filter((l) => /^(cookie|set-cookie|authorization)/i.test(l))
    return (
      `${header('WARC-Type')} ${lines[0]} ${header('WARC-Target-URI')} ` +
      `payload=${header('WARC-Payload-Digest')} headers=[${names.sort().join(',')}] ` +
      credentials.join(';')
    )
  })
  return {
    schemaVersion: entry.schemaVersion,
    url: entry.url,
    httpStatus: entry.httpStatus,
    inventory: entry.inventory,
    scrollToLoad: entry.scrollToLoad ?? null,
    boundTls: entry.boundTls ?? null,
    boundTlsAbsent: entry.boundTlsAbsent ?? null,
    mhtml: describeMhtml(mhtml),
    pdfPages: pdf ? (pdf.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length : null,
    screenshot: png
      ? { width: png.readUInt32BE(16), height: png.readUInt32BE(20), sha: sha(png) }
      : null,
    text: read('txt')?.toString('utf8') ?? null,
    recordHoldsCookieValue: text ? text.includes(SECRET) : null,
    recordHoldsPostBody: text ? text.includes(POST_BODY) : null,
    records: records ?? null
  }
}

function describeRun(out, label) {
  const dir = path.join(out, label, 'case')
  if (!fs.existsSync(dir)) throw new Error(`no run labelled ${label} under ${out}: take it first`)
  const described = {}
  for (const entry of requireBothMethods(captureEntries(dir), `the run ${label}`)) {
    requireArtifacts(dir, entry, `the run ${label}`)
    described[entry.method] = describeCapture(dir, entry)
  }
  fs.writeFileSync(path.join(out, `${label}.json`), JSON.stringify(described, null, 2))
  return described
}

function compare(a, b, { out }) {
  const [A, B] = [describeRun(out, a), describeRun(out, b)]
  let different = false
  for (const method of new Set([...Object.keys(A), ...Object.keys(B)])) {
    if (!A[method] || !B[method]) {
      console.log(`${method}: only in ${A[method] ? a : b}`)
      different = true
      continue
    }
    const keys = Object.keys(A[method]).filter(
      (key) => JSON.stringify(A[method][key]) !== JSON.stringify(B[method][key])
    )
    console.log(`${method}: ${keys.length ? 'DIFFERENT' : 'IDENTICAL'} between ${a} and ${b}`)
    for (const key of keys) {
      console.log(`  ${key}\n    ${a}: ${JSON.stringify(A[method][key])}`)
      console.log(`    ${b}: ${JSON.stringify(B[method][key])}`)
      different = true
    }
  }
  console.log(`descriptions: ${path.join(out, `${a}.json`)} ${path.join(out, `${b}.json`)}`)
  return different ? 1 : 0
}

async function verify(label, { repo, out, port }) {
  const userData = profileDir(out, label)
  if (!fs.existsSync(userData)) {
    throw new Error(`no kept profile for ${label}: run take ${label} --keep-profile first`)
  }
  const dir = caseFolder(userData)
  const entries = requireBothMethods(captureEntries(dir), `the profile of ${label}`)
  const { app, page } = await launchApp(repo, userData, port)
  let failed = false
  try {
    console.log('verifying with', await app.evaluate(({ app: a }) => a.getVersion()), 'at', repo)
    const status = async (id) =>
      (await page.evaluate((id) => window.birdbrain.captures.verify(id), id)).status
    const expect = (what, got, pass) => {
      console.log(`${what}: ${got}${pass ? '' : '  <- FAILED'}`)
      if (!pass) failed = true
    }
    for (const { captureId, method, toolVersion } of entries) {
      const first = await status(captureId)
      expect(`${method}, written by ${toolVersion}`, first, first === 'verified')
      // A changed byte must stop it verifying, or the line above proved nothing.
      const record = path.join(dir, `${captureId}.warc.gz`)
      if (!fs.existsSync(record)) {
        expect(`${method}, record file`, 'absent, so the changed-byte check cannot run', false)
        continue
      }
      const bytes = fs.readFileSync(record)
      const changed = Buffer.from(bytes)
      changed[changed.length - 1] ^= 0xff
      fs.writeFileSync(record, changed)
      try {
        const tampered = await status(captureId)
        expect(`${method}, one record byte changed`, tampered, tampered !== 'verified')
      } finally {
        fs.writeFileSync(record, bytes)
      }
      const restored = await status(captureId)
      expect(`${method}, restored`, restored, restored === 'verified')
    }
  } finally {
    await app.close().catch(() => {})
  }
  return failed ? 1 : 0
}

async function main() {
  const { command, labels, options } = parse(process.argv.slice(2))
  if (command === 'take' && labels.length === 1) return (await take(labels[0], options), 0)
  if (command === 'compare' && labels.length === 2) return compare(labels[0], labels[1], options)
  if (command === 'verify' && labels.length === 1) return verify(labels[0], options)
  throw new Error(USAGE)
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`capture-proof: ${process.env.DEBUG ? error?.stack : (error?.message ?? error)}`)
    process.exit(1)
  }
)
