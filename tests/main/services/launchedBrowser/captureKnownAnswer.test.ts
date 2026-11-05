import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawnSync } from 'child_process'
import { createHash, X509Certificate } from 'crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { createServer as createHttpsServer } from 'https'
import type { Socket } from 'net'
import { tmpdir } from 'os'
import { dirname, join, resolve } from 'path'
import { gzipSync, inflateRawSync } from 'zlib'
import { readWarc, type WarcRecord } from '../../../../src/packages/transaction-record/warcReader'
import { createLocalhostCert, type LocalhostCert } from '../../../helpers/tlsFixtures'
import { startSocks5Fixture, type Socks5Fixture } from '../../../helpers/socks5Fixture'
import type { BrowserFamily, LaunchedCaptureProgress } from '@shared/types'
import type { ExportOptions } from '@shared/types'
import { closeDatabase, initDatabase } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { getCapture } from '@main/services/db/captureRepo'
import { initManifest, readEntries } from '@main/services/manifest'
import { MANIFEST_FILENAME } from '@shared/constants'
import { ensureCaseDir, initStorage } from '@main/services/storage'
import { initSettings, updateSettings } from '@main/services/settings'
import { initInstallationId, resetInstallationId } from '@main/services/installationId'
import {
  createCaptureLifecycle,
  type CaptureLifecycle,
  type LaunchedAdmissionRequest
} from '@main/services/captureLifecycle'
import { createSelectorLifecycle } from '@main/services/selectorLifecycle'
import { generateReport } from '@main/services/export'
import { verifyEvidencePackage } from '@shared/verify/evidencePackage'
import {
  createLaunchedCaptures,
  type LaunchedCaptures
} from '@main/services/launchedBrowser/captures'
import { launchBrowser, type LaunchedBrowser } from '@main/services/launchedBrowser/launcher'
import {
  buildSuiteLaunchArgs,
  NEVER_SENT,
  PINNED_BROWSER,
  PINNED_VERSION,
  realBrowserSkipReason,
  suiteSpawn,
  withSwitches
} from '../../../helpers/launchedBrowserSuite'
import { HAS_OPENSSL } from '../../../helpers/openssl'

// The known answers of a clicked Capture in a launched browser (#1832; spec, "Validation"),
// against the pinned Chrome for Testing build under xvfb-run. The engine records the first tab
// from launch, the suite drives it to a fixture page by setting `location.href` in the main world,
// and every Capture goes through the real Capture Lifecycle into a Case, as a click in the panel
// does. Without the build, or outside xvfb-run, the suite reports itself skipped and says why.

// D23's hand reruns: BIRDBRAIN_SUITE_BROWSER names another executable, and
// BIRDBRAIN_SUITE_BROWSER_FAMILY its product family, so the same suite runs against an installed
// browser. Without them it runs the pinned build.
const OTHER_BROWSER = process.env.BIRDBRAIN_SUITE_BROWSER
const SUITE_BROWSER = {
  family: (OTHER_BROWSER
    ? (process.env.BIRDBRAIN_SUITE_BROWSER_FAMILY ?? 'chromium')
    : 'chrome-for-testing') as BrowserFamily,
  label: OTHER_BROWSER ? 'Browser under test' : 'Google Chrome for Testing',
  executablePath: OTHER_BROWSER ?? PINNED_BROWSER ?? ''
}
const pinnedSkip = realBrowserSkipReason()
// A run against another browser does not need the pinned build.
const skipReason = !HAS_OPENSSL
  ? 'no openssl to make the TLS fixture'
  : OTHER_BROWSER && pinnedSkip?.startsWith('no pinned')
    ? null
    : pinnedSkip

const BRAVE_ORIGIN_STARTUP = 'chrome://brave-origin-startup/'
// Its "Proceed with Origin for free" button, inside the page's shadow roots.
const PROCEED_WITH_ORIGIN =
  '(() => { const walk = (root) => [...root.querySelectorAll("*")].flatMap((el) =>' +
  ' [el, ...(el.shadowRoot ? walk(el.shadowRoot) : [])]);' +
  ' const leo = walk(document).find((el) => el.tagName === "LEO-BUTTON" &&' +
  ' /Proceed with Origin for free/.test(el.textContent || ""));' +
  ' const button = leo && leo.shadowRoot && leo.shadowRoot.querySelector("button");' +
  ' if (button || leo) (button || leo).click() })()'

// Brave Origin opens its first tab only once its startup page is answered; the suite answers it as
// the Operator would, from the page's own main world.
function answeringStartupPage(
  onRecordedSession: LaunchedCaptures['onRecordedSession']
): LaunchedCaptures['onRecordedSession'] {
  return (session, target, recorded) => {
    onRecordedSession(session, target, recorded)
    if (!target.url.startsWith(BRAVE_ORIGIN_STARTUP)) return
    setTimeout(() => {
      session.send('Runtime.evaluate', { expression: PROCEED_WITH_ORIGIN }).catch(() => {})
    }, 3_000)
  }
}

const PASSWORD = 'PASSWORD-MARKER-5c1d'
const COOKIE = 'COOKIE-MARKER-77ab'
const AUTHORIZATION = 'AUTH-MARKER-e93f'
const BINARY = Buffer.from(Array.from({ length: 4096 }, (_, i) => (i * 7 + 3) % 256))
const GZ_PAYLOAD = Buffer.from(Array.from({ length: 8192 }, (_, i) => (i * 13 + 1) % 256))
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')

// Longer than the engine's own network quiet, so nothing the page started is still to come.
const QUIET_MS = 2_000

// Chromium's form for --ignore-certificate-errors-spki-list: base64 of the SPKI's SHA-256.
const spkiHash = (pem: string): string =>
  createHash('sha256')
    .update(new X509Certificate(pem).publicKey.export({ type: 'spki', format: 'der' }))
    .digest('base64')

const VERIFIER = resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'dist',
  'verifier',
  process.platform === 'win32' ? 'birdbrain-verify.exe' : 'birdbrain-verify'
)

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

interface PageFacts {
  webdriver: boolean
  chrome: string[]
  prepared: number
  resources: number
  focused: boolean
  visibility: string
}

interface Fixture {
  origin: string
  crossSite: string
  secureOrigin: string
  // Each request's method and path, in arrival order.
  requests: Array<{ method: string; path: string }>
  // What the page-visible facts page reported, in arrival order.
  facts: PageFacts[]
  close: () => Promise<void>
}

const html = (body: string): string => `<!doctype html><meta charset="utf-8">${body}`

const PAGES: Record<string, string> = {
  '/page': html(
    '<title>Known answer page</title><link rel="stylesheet" href="/style.css">' +
      '<p>Known answer text</p><img src="/pixel.gif">' +
      "<script>fetch('/data.bin'); fetch('/gz.bin')</script>"
  ),
  '/page2': html('<title>Second page</title><p>After the redirects</p>'),
  '/opener': html(
    '<title>Opener</title><a id="blank" target="_blank" href="/opened-by-link">link</a>' +
      '<p>Opens tabs</p>'
  ),
  '/opened-by-link': html('<title>Opened by link</title><img src="/pixel.gif">'),
  '/opened-by-script': html('<title>Opened by script</title><img src="/other.gif">'),
  '/framed': html(
    '<title>Framed</title><p>Holds a frame from another site</p>' +
      '<iframe id="frame" src="about:blank"></iframe>' +
      "<script>document.getElementById('frame').src = location.href.replace('127.0.0.1', " +
      "'localhost').replace('/framed', '/frame')</script>"
  ),
  '/frame': html("<title>Frame</title><script>fetch('/frame-data.bin')</script>"),
  '/secure': html('<title>Secure page</title><p>Served over TLS</p>'),
  '/other': html('<title>Other page</title><p>Another navigation</p><img src="/other.gif">'),
  '/login': html(
    '<title>Sign in</title><form method="post" action="/signed-in">' +
      `<input type="password" name="password" value="${PASSWORD}"></form>` +
      '<script>document.forms[0].submit()</script>'
  ),
  '/signed-in': html(
    '<title>Signed in</title><p>Welcome</p>' +
      `<script>fetch('/api', { headers: { Authorization: 'Bearer ${AUTHORIZATION}' } })</script>`
  ),
  '/cache-a': html('<title>Cache A</title><img src="/cacheable.gif">'),
  '/cache-b': html('<title>Cache B</title><img src="/cacheable.gif">'),
  '/holding': html("<title>Holding</title><script>fetch('/hold')</script>"),
  // The first slice's page-visible facts (spec, Validation, "Page-visible effects"), with the check
  // P3 kept: the page's own `Error.prepareStackTrace` runs for an Error passed to `console.debug`
  // only while `Runtime.enable` is on (probe, P3, Chromium 154). The page reports them every 250 ms.
  '/visible': html(
    '<title>Page-visible facts</title><p>Facts</p><img src="/pixel.gif">' +
      '<script>let prepared = 0\n' +
      'Error.prepareStackTrace = (error, frames) => { prepared++; return String(error) }\n' +
      'const report = () => { console.debug(new Error("probe")); const facts = {' +
      ' webdriver: navigator.webdriver, chrome: Object.keys(window.chrome || {}).sort(),' +
      ' prepared, resources: performance.getEntriesByType("resource").length,' +
      ' focused: document.hasFocus(), visibility: document.visibilityState };' +
      " navigator.sendBeacon('/facts', JSON.stringify(facts)) }\n" +
      'report(); setInterval(report, 250)</script>'
  ),
  // The full-page screenshot resizes the page's viewport (probe P2), so this page loads another
  // during the artifact commands.
  '/navigate-on-resize': html(
    '<title>Leaves on resize</title><p>A resize loads another page</p>' +
      "<script>addEventListener('resize', () => { location.href = '/other' })</script>"
  )
}

async function startFixture(tls: LocalhostCert): Promise<Fixture> {
  const requests: Fixture['requests'] = []
  const facts: PageFacts[] = []
  const sockets = new Set<Socket>()
  const held: ServerResponse[] = []
  const handler = (request: IncomingMessage, response: ServerResponse): void => {
    const path = (request.url ?? '/').split('?')[0]
    requests.push({ method: request.method ?? 'GET', path })
    if (path === '/facts') {
      const chunks: Buffer[] = []
      request.on('data', (chunk: Buffer) => chunks.push(chunk))
      request.on('end', () => facts.push(JSON.parse(Buffer.concat(chunks).toString('utf8'))))
      response.writeHead(204)
      response.end()
      return
    }
    // Drain any body; the fixture never reads it.
    request.resume()
    const page = PAGES[path]
    if (page !== undefined) {
      const headers: Record<string, string> = { 'content-type': 'text/html; charset=utf-8' }
      if (path === '/signed-in') headers['set-cookie'] = `session=${COOKIE}; Path=/; HttpOnly`
      response.writeHead(200, headers)
      response.end(page)
      return
    }
    switch (path) {
      case '/redirect1':
        response.writeHead(302, { location: '/redirect2' })
        response.end()
        return
      case '/redirect2':
        response.writeHead(302, { location: '/page2' })
        response.end()
        return
      case '/style.css':
        response.writeHead(200, { 'content-type': 'text/css' })
        response.end('@media print { body { background-image: url(/print.gif) } }')
        return
      case '/frame-data.bin':
      case '/data.bin':
        response.writeHead(200, { 'content-type': 'application/octet-stream' })
        response.end(BINARY)
        return
      case '/gz.bin':
        response.writeHead(200, {
          'content-type': 'application/octet-stream',
          'content-encoding': 'gzip'
        })
        response.end(gzipSync(GZ_PAYLOAD))
        return
      case '/pixel.gif':
      case '/other.gif':
      case '/print.gif':
        response.writeHead(200, { 'content-type': 'image/gif' })
        response.end(GIF)
        return
      case '/cacheable.gif':
        response.writeHead(200, { 'content-type': 'image/gif', 'cache-control': 'max-age=3600' })
        response.end(GIF)
        return
      case '/hold':
        held.push(response)
        return
      default:
        response.writeHead(204)
        response.end()
    }
  }
  const server: Server = createServer(handler)
  const secure = createHttpsServer({ key: tls.key, cert: tls.cert }, handler)
  for (const listening of [server, secure]) {
    listening.on('connection', (socket: Socket) => {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
    })
  }
  const portOf = async (listening: Server): Promise<number> => {
    await new Promise<void>((resolve) => listening.listen(0, '127.0.0.1', () => resolve()))
    const address = listening.address()
    if (address === null || typeof address === 'string') throw new Error('no TCP address')
    return address.port
  }
  const port = await portOf(server)
  const securePort = await portOf(secure)
  return {
    origin: `http://127.0.0.1:${port}`,
    // Another site, for cross-site frames and navigations, on the same server.
    crossSite: `http://localhost:${port}`,
    secureOrigin: `https://localhost:${securePort}`,
    requests,
    facts,
    close: () =>
      new Promise((resolve) => {
        for (const response of held) response.destroy()
        for (const socket of sockets) socket.destroy()
        secure.close()
        server.close(() => resolve())
      })
  }
}

async function waitFor<T>(
  read: () => T | null | undefined | false | Promise<T | null | undefined | false>,
  what: string,
  timeoutMs = 15_000
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await read()
    if (value) return value
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

function requestRecords(records: WarcRecord[]): WarcRecord[] {
  return records.filter((record) => record.warc('WARC-Type') === 'request')
}

function pathOf(record: WarcRecord): string {
  return new URL(record.warc('WARC-Target-URI') ?? '').pathname
}

// Every byte of the record, each member inflated, for a search by known value.
function inflatedRecord(warcGz: Buffer): string {
  return readWarc(warcGz)
    .map((record) => record.inflated.toString('latin1'))
    .join('')
}

function filesUnder(dir: string, skip: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (path === skip) return []
    return statSync(path).isDirectory() ? filesUnder(path, skip) : [path]
  })
}

function readStoredZipEntries(path: string): Map<string, Buffer> {
  const zip = readFileSync(path)
  const entries = new Map<string, Buffer>()
  let offset = 0
  while (offset < zip.length && zip.readUInt32LE(offset) === 0x04034b50) {
    const method = zip.readUInt16LE(offset + 8)
    const compressedSize = zip.readUInt32LE(offset + 18)
    const nameLength = zip.readUInt16LE(offset + 26)
    const extraLength = zip.readUInt16LE(offset + 28)
    const nameStart = offset + 30
    const dataStart = nameStart + nameLength + extraLength
    const name = zip.subarray(nameStart, nameStart + nameLength).toString('utf-8')
    const data = zip.subarray(dataStart, dataStart + compressedSize)
    entries.set(name, method === 8 ? inflateRawSync(data) : data)
    offset = dataStart + compressedSize
  }
  return entries
}

describe.skipIf(skipReason !== null)(
  `clicked launched Captures, ${OTHER_BROWSER ?? `Chrome for Testing ${PINNED_VERSION}`}` +
    (skipReason ? ` (skipped: ${skipReason})` : ''),
  () => {
    let root: string
    let caseId: string
    let fixture: Fixture
    let tlsCert: LocalhostCert
    let lifecycle: CaptureLifecycle
    let browser: LaunchedBrowser
    let captures: LaunchedCaptures
    const admitted: LaunchedAdmissionRequest[] = []
    const events: Array<{ type: string; source: string; error?: string }> = []
    const warnings: string[] = []

    const tabId = (): string => browser.firstTab.targetId

    // `path` is on the fixture's first site unless it names an origin.
    async function navigate(path: string, settled: string = path): Promise<void> {
      const before = fixture.requests.length
      const url = path.startsWith('http') ? path : `${fixture.origin}${path}`
      await browser.firstTab.session.send('Runtime.evaluate', {
        expression: `location.href = ${JSON.stringify(url)}`
      })
      settled = settled.startsWith('http') ? new URL(settled).pathname : settled
      await waitFor(
        () => fixture.requests.slice(before).some((request) => request.path === settled),
        `${settled} to be requested`
      )
      // The commit, then the page's own subresources and the browser's favicon request: the
      // fixture sees no request for a while, so the suite's view of the cut matches the engine's.
      await waitFor(
        () =>
          captures.decorate([{ targetId: tabId(), title: '', url: '' }])[0].refusal === undefined,
        `${path} to commit`
      )
      // The facts page reports every 250 ms; those reports do not count.
      const loads = (): number => fixture.requests.filter(({ path: p }) => p !== '/facts').length
      let seen = loads()
      let quietSince = Date.now()
      await waitFor(() => {
        if (loads() !== seen) {
          seen = loads()
          quietSince = Date.now()
        }
        return Date.now() - quietSince >= QUIET_MS
      }, `${path} to go quiet`)
    }

    async function capture(scrollToLoad = false): Promise<LaunchedCaptureProgress> {
      return captures.capture(tabId(), { scrollToLoad })
    }

    function lastAdmitted(): LaunchedAdmissionRequest {
      const request = admitted.at(-1)
      if (!request) throw new Error('nothing was admitted')
      return request
    }

    beforeAll(async () => {
      root = mkdtempSync(join(tmpdir(), 'birdbrain-launched-capture-'))
      initStorage(join(root, 'captures'))
      await initDatabase(':memory:')
      resetInstallationId()
      initInstallationId(root)
      initSettings(root)
      updateSettings({ operatorName: 'Known Answer', operatorRole: '', operatorOrganization: '' })
      caseId = createCase({ name: 'Launched known answers', description: '' }).id
      ensureCaseDir(caseId)
      initManifest(join(root, 'captures', caseId))
      lifecycle = createCaptureLifecycle({
        selectorLifecycle: createSelectorLifecycle({ emitRematched: () => {} }),
        egressIsDirect: () => true,
        fetchTlsCertChain: async () => null,
        emitCaptureEvent: (event) => events.push(event)
      })
      tlsCert = createLocalhostCert()
      fixture = await startFixture(tlsCert)
      captures = createLaunchedCaptures({
        sink: {
          screenLaunched: (id, url) => lifecycle.screenLaunched(id, url),
          abandonedLaunched: (url) => lifecycle.abandonedLaunched(url),
          admit: (request) => {
            admitted.push(request)
            return lifecycle.admit(request)
          }
        },
        activeCaseId: () => caseId,
        birdbrainVersion: 'known-answer',
        citationOf: (id) => getCapture(id)?.exhibitCitation ?? '',
        onChange: () => {},
        log: {
          warn: (_source, code, _context, error) => {
            warnings.push(`${code}: ${String(error)}`)
            return code
          }
        }
      })
      captures.setEgress({ kind: 'direct' })
      browser = await launchBrowser(
        {
          browser: SUITE_BROWSER,
          egress: { kind: 'direct' },
          sessionDataPath: join(root, 'sessionData'),
          hooks: { onRecordedSession: answeringStartupPage(captures.onRecordedSession) }
        },
        {
          spawn: suiteSpawn,
          // The suite's own launch accepts the TLS fixture's certificate and no other.
          buildArgs: withSwitches(buildSuiteLaunchArgs, [
            `--ignore-certificate-errors-spki-list=${spkiHash(tlsCert.cert)}`
          ])
        }
      )
      captures.attach(browser.client, browser.identity, browser.firstTab)
    }, 60_000)

    afterAll(async () => {
      captures?.dispose()
      await browser?.stop()
      await fixture?.close()
      closeDatabase()
      rmSync(root, { recursive: true, force: true })
    }, 30_000)

    it('refuses the start tab, which is not an http page, and stores nothing', async () => {
      const progress = await capture()
      expect(progress).toMatchObject({ state: 'refused' })
      expect((progress as { message: string }).message).toMatch(/http and https pages only/)
      expect(admitted).toHaveLength(0)
    })

    it('records a typed navigation from its first request and leaves out what printing loads', async () => {
      const before = fixture.requests.length
      await navigate('/page')
      await waitFor(
        () => fixture.requests.slice(before).some(({ path }) => path === '/gz.bin'),
        'the page to fetch its resources'
      )
      expect(captures.decorate([{ targetId: tabId(), title: '', url: '' }])[0]).toMatchObject({
        firstRequest: true
      })
      const cutAt = fixture.requests.length
      const progress = await capture()
      expect(progress).toMatchObject({ state: 'captured' })
      const request = lastAdmitted()
      const { inventory, transactionRecord } = request
      expect(inventory.transactionRecord).toMatchObject({
        present: true,
        httpCacheDisabled: true,
        requestBodiesWithheld: 0,
        servedByServiceWorker: 0
      })
      expect(request.boundTlsAbsent).toBe('not-https')
      expect(request.browser).toEqual({
        product: browser.identity.product,
        version: browser.identity.version,
        family: SUITE_BROWSER.family
      })
      if (!OTHER_BROWSER) expect(browser.identity.version).toBe(PINNED_VERSION)
      const records = readWarc(transactionRecord!)
      const recorded = requestRecords(records).map(pathOf)
      // Every request the fixture logged before the cut is in the record, once: the fixture's
      // request count equals the record's exchange count.
      const fixturePaths = fixture.requests.slice(before, cutAt).map(({ path }) => path)
      expect([...recorded].sort(), JSON.stringify({ recorded, fixturePaths })).toEqual(
        [...fixturePaths].sort()
      )
      // The print loads its image after the cut, so the fixture saw it and the record does not.
      await waitFor(() => fixture.requests.some(({ path }) => path === '/print.gif'), 'the print')
      expect(recorded).not.toContain('/print.gif')
      // Payload digests: the browser returns these bodies as base64, which the record keeps.
      const responseTo = (path: string): WarcRecord | undefined =>
        records.find((r) => r.warc('WARC-Type') === 'response' && pathOf(r) === path)
      expect(responseTo('/data.bin')?.http?.payload.equals(BINARY)).toBe(true)
      expect(responseTo('/gz.bin')?.http?.payload.equals(GZ_PAYLOAD)).toBe(true)
      expect(sha256(responseTo('/gz.bin')!.http!.payload)).toBe(sha256(GZ_PAYLOAD))
      // The warcinfo names the transport, the disabled cache and the withheld bodies.
      const info = records[0].block.toString('utf8')
      expect(info).toMatch(/^transport: .*--remote-debugging-pipe/m)
      expect(info).toMatch(/^http-cache: .*Network\.setCacheDisabled/m)
      expect(info).toMatch(/^request-bodies: .*ADR-0051/m)
    }, 60_000)

    it('stores the Capture with the signed browser fields and a row that keeps the version', async () => {
      const progress = await capture()
      expect(progress).toMatchObject({ state: 'captured' })
      const { captureId } = progress as { captureId: string }
      const row = getCapture(captureId)
      expect(row?.method).toBe('launched')
      expect(row?.browserVersion).toBe(browser.identity.version)
      const jsonl = readFileSync(join(root, 'captures', caseId, MANIFEST_FILENAME), 'utf8')
      const entry = readEntries(jsonl).find(
        (e) => e.type === 'capture' && e.captureId === captureId
      )
      expect(entry).toMatchObject({
        method: 'launched',
        browserProduct: browser.identity.product,
        browserVersion: browser.identity.version,
        browserFamily: SUITE_BROWSER.family,
        schemaVersion: 7
      })
      expect(entry).not.toHaveProperty('egressKind')
    }, 60_000)

    it('records each hop of a redirect chain as its own exchange', async () => {
      await navigate('/redirect1', '/page2')
      expect(await capture()).toMatchObject({ state: 'captured' })
      const records = readWarc(lastAdmitted().transactionRecord!)
      const documents = records.filter(
        (r) => r.warc('WARC-Target-URI') !== undefined && /^\/(redirect|page2)/.test(pathOf(r))
      )
      expect(requestRecords(documents).map(pathOf)).toEqual(['/redirect1', '/redirect2', '/page2'])
      const statuses = documents
        .filter((r) => r.warc('WARC-Type') === 'response')
        .map((r) => r.http?.statusLine)
      expect(statuses).toEqual(['HTTP/1.1 302 Found', 'HTTP/1.1 302 Found', 'HTTP/1.1 200 OK'])
    }, 60_000)

    it('keeps no cookie, Authorization value or submitted password in any file it wrote', async () => {
      await navigate('/login', '/api')
      expect(await capture()).toMatchObject({ state: 'captured' })
      const request = lastAdmitted()
      expect(request.inventory.transactionRecord).toMatchObject({ requestBodiesWithheld: 1 })
      const records = readWarc(request.transactionRecord!)
      const post = records.find(
        (r) => r.warc('WARC-Type') === 'request' && pathOf(r) === '/signed-in'
      )
      expect(post?.http?.statusLine).toMatch(/^POST \/signed-in /)
      expect(post?.http?.payload.length).toBe(0)
      const replaced = request.inventory.transactionRecord
      expect(replaced).toMatchObject({ replacedHeaders: ['authorization', 'cookie', 'set-cookie'] })
      const haystacks = [
        inflatedRecord(request.transactionRecord!),
        JSON.stringify(request.inventory),
        request.mhtml.toString('latin1'),
        request.textContent,
        // The Case's files, the database's folder and every temporary file Birdbrain wrote;
        // the browser's own profile is the browser's.
        ...filesUnder(root, join(root, 'sessionData')).map((path) =>
          readFileSync(path).toString('latin1')
        )
      ]
      for (const marker of [PASSWORD, COOKIE, AUTHORIZATION]) {
        for (const haystack of haystacks) expect(haystack).not.toContain(marker)
      }
    }, 60_000)

    it('sends each recorded target Network.setCacheDisabled, so a cached resource loads again', async () => {
      const count = (): number =>
        fixture.requests.filter(({ path }) => path === '/cacheable.gif').length
      const start = count()
      await navigate('/cache-a', '/cacheable.gif')
      await navigate('/cache-b')
      await waitFor(() => count() === start + 2, 'the second load to reach the fixture')
      const log = browser.client.commandLog()
      const enables = log.filter((method) => method === 'Network.enable').length
      const disables = log.filter((method) => method === 'Network.setCacheDisabled').length
      expect(disables).toBe(enables)
      for (const method of [...NEVER_SENT, 'Network.getRequestPostData']) {
        expect(log).not.toContain(method)
      }
    }, 60_000)

    it('lists a response still held open as in flight', async () => {
      await navigate('/holding', '/hold')
      expect(await capture()).toMatchObject({ state: 'captured' })
      expect(lastAdmitted().inventory.transactionRecord).toMatchObject({ inFlight: 1 })
    }, 60_000)

    it('takes two overlapping Captures of one navigation, each with its own record', async () => {
      await navigate('/other', '/other.gif')
      const first = await capture()
      const firstRecord = lastAdmitted().transactionRecord!
      const second = await capture()
      const secondRecord = lastAdmitted().transactionRecord!
      expect(first).toMatchObject({ state: 'captured' })
      expect(second).toMatchObject({ state: 'captured' })
      expect(requestRecords(readWarc(secondRecord)).map(pathOf)).toEqual(
        requestRecords(readWarc(firstRecord)).map(pathOf)
      )
    }, 60_000)

    it('holds none of the previous navigation in a Capture after a new one', async () => {
      const before = fixture.requests.length
      await navigate('/page2')
      const cutAt = fixture.requests.length
      expect(await capture()).toMatchObject({ state: 'captured' })
      const recorded = requestRecords(readWarc(lastAdmitted().transactionRecord!)).map(pathOf)
      expect(recorded[0]).toBe('/page2')
      expect(recorded).not.toContain('/other')
      expect(recorded).not.toContain('/other.gif')
      expect([...recorded].sort()).toEqual(
        fixture.requests
          .slice(before, cutAt)
          .map(({ path }) => path)
          .sort()
      )
    }, 60_000)

    it('records a cross-site frame on its own session, every request the fixture logged once', async () => {
      const before = fixture.requests.length
      await navigate('/framed', '/frame-data.bin')
      const cutAt = fixture.requests.length
      expect(await capture()).toMatchObject({ state: 'captured' })
      const request = lastAdmitted()
      const recorded = requestRecords(readWarc(request.transactionRecord!)).map(pathOf)
      expect(recorded).toEqual(expect.arrayContaining(['/framed', '/frame', '/frame-data.bin']))
      expect([...recorded].sort()).toEqual(
        fixture.requests
          .slice(before, cutAt)
          .map(({ path }) => path)
          .sort()
      )
      expect(request.inventory.transactionRecord).toMatchObject({ unrecordedTargets: 0 })
      const { recordedTargets } = request.inventory.transactionRecord as { recordedTargets: number }
      expect(recordedTargets).toBeGreaterThanOrEqual(2)
    }, 60_000)

    it('records a cross-site navigation from its first request', async () => {
      await navigate(`${fixture.crossSite}/page2`)
      expect(captures.decorate([{ targetId: tabId(), title: '', url: '' }])[0]).toMatchObject({
        firstRequest: true
      })
      expect(await capture()).toMatchObject({ state: 'captured' })
      const request = lastAdmitted()
      expect(request.url).toBe(`${fixture.crossSite}/page2`)
      expect(requestRecords(readWarc(request.transactionRecord!)).map(pathOf)[0]).toBe('/page2')
    }, 60_000)

    it("signs Bound TLS Details that match the TLS fixture's certificate", async () => {
      await navigate(`${fixture.secureOrigin}/secure`)
      expect(await capture()).toMatchObject({ state: 'captured' })
      const { boundTls, boundTlsAbsent } = lastAdmitted()
      expect(boundTlsAbsent).toBeUndefined()
      const certificate = new X509Certificate(tlsCert.cert)
      expect(boundTls).toMatchObject({
        subjectName: 'localhost',
        issuer: 'localhost',
        validFrom: new Date(certificate.validFrom).toISOString(),
        validTo: new Date(certificate.validTo).toISOString()
      })
      expect(boundTls?.sanList).toEqual(expect.arrayContaining(['localhost', '127.0.0.1']))
    }, 60_000)

    it('changes none of the page-visible facts while it records and captures with Scroll-to-load', async () => {
      await navigate('/visible', '/pixel.gif')
      await waitFor(() => fixture.facts.length > 0, 'the first facts')
      const before = fixture.facts.at(-1)!
      const reported = fixture.facts.length
      expect(await capture(true)).toMatchObject({ state: 'captured' })
      await waitFor(() => fixture.facts.length > reported + 2, 'facts after the Capture')
      const after = fixture.facts.slice(reported)
      // The values each pairing records in the validation record, where a hand run asks for them.
      const report = process.env.BIRDBRAIN_SUITE_REPORT
      if (report) {
        const line = { browser: browser.identity, before, after: after.at(-1) }
        writeFileSync(report, `${JSON.stringify(line)}\n`, { flag: 'a' })
      }
      for (const reading of [before, ...after]) {
        expect(reading.prepared).toBe(0)
        expect(reading.webdriver).toBe(true)
        expect(reading.chrome).toEqual(before.chrome)
      }
    }, 60_000)

    it('abandons a Capture when a new page commits before every artifact is taken', async () => {
      await navigate('/navigate-on-resize')
      const stored = admitted.length
      const progress = await capture()
      expect(progress).toMatchObject({ state: 'abandoned' })
      expect(admitted).toHaveLength(stored)
      expect(events.at(-1)).toMatchObject({ type: 'failed', source: 'launched' })
    }, 60_000)

    it('exports a launched Capture whose package verifies, and fails on a changed record byte', async () => {
      const outputPath = join(root, 'launched.zip')
      const options: ExportOptions = {
        format: 'zip',
        include: {
          captures: true,
          screenshots: true,
          auditTrail: true,
          notes: false,
          annotations: 'none'
        },
        exportClass: 'evidence',
        outputPath
      }
      await generateReport(caseId, options, lifecycle)
      const dir = join(root, 'unpacked')
      const entries = readStoredZipEntries(outputPath)
      for (const [name, bytes] of entries) {
        mkdirSync(dirname(join(dir, name)), { recursive: true })
        writeFileSync(join(dir, name), bytes)
      }
      const result = verifyEvidencePackage(dir)
      expect(result.pass, JSON.stringify(result.checks.filter((c) => c.status !== 'pass'))).toBe(
        true
      )
      // The standalone verifier, where `pnpm build:verifier` has built it.
      const standalone = (): ReturnType<typeof spawnSync> | null =>
        existsSync(VERIFIER) ? spawnSync(VERIFIER, [dir], { encoding: 'utf-8' }) : null
      const passed = standalone()
      if (passed) expect(passed.status, `${passed.stdout}${passed.stderr}`).toBe(0)
      const record = [...entries.keys()].find((name) => name.endsWith('.warc.gz'))
      if (!record) throw new Error('no Transaction Record in the package')
      const bytes = readFileSync(join(dir, record))
      bytes[bytes.length - 1] ^= 0xff
      writeFileSync(join(dir, record), bytes)
      expect(verifyEvidencePackage(dir).pass).toBe(false)
      const failed = standalone()
      if (failed) expect(failed.status).toBe(1)
    }, 120_000)

    // A second browser, through the SOCKS5 fixture: the entry carries the Egress fields, and
    // neither the record nor the inventory holds the proxy's address or any WARC-IP-Address.
    it('signs the Egress fields through the SOCKS5 fixture and records no proxy address', async () => {
      const proxy: Socks5Fixture = await startSocks5Fixture()
      const proxied = createLaunchedCaptures({
        sink: {
          screenLaunched: (id, url) => lifecycle.screenLaunched(id, url),
          abandonedLaunched: (url) => lifecycle.abandonedLaunched(url),
          admit: (request) => {
            admitted.push(request)
            return lifecycle.admit(request)
          }
        },
        activeCaseId: () => caseId,
        birdbrainVersion: 'known-answer',
        citationOf: (id) => getCapture(id)?.exhibitCitation ?? '',
        onChange: () => {},
        log: { warn: (_source, code) => code }
      })
      const egress = { kind: 'proxy' as const, proxyUrl: proxy.url, label: 'SOCKS5 fixture' }
      proxied.setEgress(egress)
      const second = await launchBrowser(
        {
          browser: SUITE_BROWSER,
          egress,
          sessionDataPath: join(root, 'sessionData'),
          hooks: { onRecordedSession: answeringStartupPage(proxied.onRecordedSession) }
        },
        { spawn: suiteSpawn, buildArgs: buildSuiteLaunchArgs }
      )
      try {
        proxied.attach(second.client, second.identity, second.firstTab)
        const tab = second.firstTab.targetId
        await second.firstTab.session.send('Runtime.evaluate', {
          expression: `location.href = ${JSON.stringify(`${fixture.origin}/page2`)}`
        })
        await waitFor(
          () => proxied.decorate([{ targetId: tab, title: '', url: '' }])[0].firstRequest,
          'the proxied page to commit'
        )
        await new Promise((resolve) => setTimeout(resolve, QUIET_MS))
        expect(await proxied.capture(tab, { scrollToLoad: false })).toMatchObject({
          state: 'captured'
        })
        const request = lastAdmitted()
        expect(request.egress).toEqual({ kind: 'proxy', label: 'SOCKS5 fixture' })
        const { port } = proxy
        const records = readWarc(request.transactionRecord!)
        expect(records.some((record) => record.warc('WARC-IP-Address') !== undefined)).toBe(false)
        for (const text of [
          inflatedRecord(request.transactionRecord!),
          JSON.stringify(request.inventory)
        ]) {
          expect(text).not.toContain(proxy.url)
          expect(text).not.toContain(`:${port}`)
        }
        const jsonl = readFileSync(join(root, 'captures', caseId, MANIFEST_FILENAME), 'utf8')
        const entry = readEntries(jsonl).find(
          (e) => e.type === 'capture' && e.captureId === request.captureId
        )
        expect(entry).toMatchObject({
          egressKind: 'proxy',
          egressLabel: 'SOCKS5 fixture',
          userAgent: second.identity.userAgent
        })
        expect(JSON.stringify(entry)).not.toContain(`:${port}`)
      } finally {
        proxied.dispose()
        await second.stop()
        await proxy.close()
      }
    }, 90_000)

    // Last, because the tabs it opens put the first tab behind them.
    it('gives a target=_blank tab and a window.open popup their own records, naming the opener', async () => {
      await navigate('/opener')
      const opened = async (path: string): Promise<string> => {
        const { targetInfos } = await browser.client.send('Target.getTargets', {})
        return targetInfos.find(({ type, url }) => type === 'page' && url.endsWith(path))
          ?.targetId as string
      }
      // Each opens in front, so each is captured before the next opens. A gesture each, as a
      // click would give, so the popup blocker lets both open.
      for (const [expression, path] of [
        ["document.getElementById('blank').click()", '/opened-by-link'],
        ["window.open('/opened-by-script', 'popup')", '/opened-by-script']
      ]) {
        await browser.firstTab.session.send('Runtime.evaluate', {
          expression,
          userGesture: true
        } as never)
        let targetId = ''
        await waitFor(async () => (targetId = await opened(path)), `${path} to open`)
        await waitFor(
          () => captures.decorate([{ targetId, title: '', url: '' }])[0].firstRequest === true,
          `${path} to commit`
        )
        expect(await captures.capture(targetId, { scrollToLoad: false })).toMatchObject({
          state: 'captured'
        })
        const records = readWarc(lastAdmitted().transactionRecord!)
        expect(requestRecords(records).map(pathOf)[0]).toBe(path)
        const info = records[0].block.toString('utf8')
        expect(info).toContain(`tab-target-id: ${targetId}`)
        expect(info).toContain(`tab-opener-target-id: ${tabId()}`)
      }
      // The first tab is now behind the popups: its Capture is refused before anything is taken.
      const stored = admitted.length
      expect(await capture()).toMatchObject({
        state: 'refused',
        message: expect.stringMatching(/Bring it to the front/)
      })
      expect(admitted).toHaveLength(stored)
    }, 60_000)
  }
)
