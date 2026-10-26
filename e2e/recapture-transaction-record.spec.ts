import { test, expect } from './fixtures/electronApp'
import { createCase } from './fixtures/seed'
import { startSocks5Proxy, type Socks5Proxy } from './fixtures/socks5Proxy'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { createServer as createHttpsServer } from 'https'
import { execFileSync } from 'child_process'
import { createHash, X509Certificate } from 'crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { gzipSync } from 'zlib'
import type { Socket } from 'net'
import type { ElectronApplication, Page } from '@playwright/test'
import { readWarc, type WarcRecord } from '../src/packages/transaction-record/warcReader'

// Step 9 of docs/plans/2026-10-10-capture-engine-first-slice.md: a background capture records
// the Transaction Record, its inventory part, and Bound TLS Details, against fixture servers on
// loopback reached through CE-2's switch. Every body is invented.

// Known answers. The text fixtures are the charset spike's, whose bytes the plain body path
// returned re-encoded (docs/specs/2026-10-26-transaction-record-charset-spike.md, Question 1).
const TXT = Buffer.from('known-answer payload '.repeat(200))
const TEXT_BODIES: Record<string, { type: string; bytes: Buffer }> = {
  '/w1252': {
    type: 'text/html; charset=windows-1252',
    bytes: Buffer.from('3c703e636166e93c2f703e', 'hex')
  },
  '/sjis': {
    type: 'text/html; charset=Shift_JIS',
    bytes: Buffer.from('3c703e93fa967b3c2f703e', 'hex')
  },
  '/bom': {
    type: 'text/html; charset=utf-8',
    bytes: Buffer.from('efbbbf3c703e61623c2f703e', 'hex')
  },
  '/mojibake': {
    type: 'text/html; charset=windows-1252',
    bytes: Buffer.from('3c703e636166c3a93c2f703e', 'hex')
  }
}
// Over the 10,000,000-byte per-resource limit, so its body is omitted.
const BIG = Buffer.alloc(10_500_000, 0x61)
const COOKIE_SECRET = 'COOKIE-SECRET-1929'
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
)

const pagePath = (frameOrigin: string) => `<!doctype html><html><head>
<title>Transaction Record Fixture</title><link rel="stylesheet" href="/style.css"></head>
<body><h1>Transaction Record fixture</h1>
<img src="/redir-same" alt=""><img src="/redir-cross" alt="">
<iframe src="${frameOrigin}/frame"></iframe>
<script>
(async () => {
  const get = (url, options) => fetch(url, options).then((r) => r.arrayBuffer()).catch(() => null)
  new Worker('/worker.js')
  await Promise.all(['/gz.txt', '/plain.txt', '/w1252', '/sjis', '/bom', '/mojibake', '/big.bin',
    '/max-age.json'].map((url) => get(url)))
  // A second use of a cacheable response, which the disk cache serves (renderer spike, question 5).
  await get('/max-age.json')
  get('/mismatch')
  const abort = new AbortController()
  get('/slow', { signal: abort.signal })
  setTimeout(() => abort.abort(), 300)
  get('/hang')
  const blocked = document.createElement('script')
  blocked.src = '/blocked-by-consent.js'
  document.head.appendChild(blocked)
  await navigator.serviceWorker.register('/sw.js')
  if (!navigator.serviceWorker.controller) {
    await new Promise((resolve) =>
      navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }))
  }
  await get('/viasw.txt')
})()
</script></body></html>`

const FRAME = `<!doctype html><html><head><link rel="stylesheet" href="/frame.css"></head>
<body><p>cross-site frame</p><script>
fetch('/frame-data.txt').then((r) => r.text())
new Worker('/frame-worker.js')
</script></body></html>`

const SERVICE_WORKER = `
self.addEventListener('install', (event) => {
  self.skipWaiting()
  event.waitUntil(fetch('/sw-install.txt').then((r) => r.text()))
})
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
self.addEventListener('fetch', (event) => {
  if (event.request.url.includes('viasw')) event.respondWith(fetch(event.request))
})`

// A page with one cross-site frame, for the stubbed setup failures.
const STUB_PAGE = (frameOrigin: string) => `<!doctype html><html><head><title>Stub Fixture</title>
</head><body><iframe src="${frameOrigin}/frame"></iframe></body></html>`

const FILTER_LIST = '/blocked-by-consent.js\n'

interface Logged {
  url: string
  cookie?: string
}

interface Fixture {
  server: Server
  origin: string
  log: Logged[]
  close: () => Promise<void>
}

async function listen(
  server: Server,
  host: string,
  scheme: 'http' | 'https',
  log: Logged[]
): Promise<Fixture> {
  const sockets = new Set<Socket>()
  server.on('connection', (socket: Socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return {
    server,
    origin: `${scheme}://${host}:${port}`,
    log,
    close: async () => {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
}

function logRequest(log: Logged[], req: IncomingMessage, scheme: string): void {
  log.push({ url: `${scheme}://${req.headers.host}${req.url}`, cookie: req.headers.cookie })
}

const send = (res: ServerResponse, type: string, body: Buffer | string, extra = {}) => {
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', ...extra })
  res.end(body)
}

// Server A holds the page; server B, reached as `localhost`, is another site to it.
function startPageServer(log: Logged[], frameOrigin: () => string): Server {
  return createServer((req, res) => {
    logRequest(log, req, 'http')
    const path = req.url ?? '/'
    const text = TEXT_BODIES[path]
    if (text) return send(res, text.type, text.bytes)
    switch (path.split('?')[0]) {
      case '/tr':
        return send(res, 'text/html', pagePath(frameOrigin()), {
          'set-cookie': `bb_session=${COOKIE_SECRET}; Path=/`
        })
      case '/stub':
        return send(res, 'text/html', STUB_PAGE(frameOrigin()))
      case '/simple':
        return send(res, 'text/html', '<!doctype html><title>Simple</title><p>simple</p>')
      case '/style.css':
        return send(res, 'text/css', 'h1 { color: #222 }')
      case '/redir-same':
        res.writeHead(302, { location: '/img.png?r=same' })
        return res.end()
      case '/redir-cross':
        res.writeHead(302, { location: `${frameOrigin()}/img.png?r=cross` })
        return res.end()
      case '/img.png':
        return send(res, 'image/png', PNG)
      case '/gz.txt':
        return send(res, 'text/plain', gzipSync(TXT), { 'content-encoding': 'gzip' })
      case '/plain.txt':
      case '/worker-data.txt':
      case '/sw-install.txt':
      case '/viasw.txt':
        return send(res, 'text/plain', TXT)
      case '/big.bin':
        return send(res, 'application/octet-stream', BIG)
      case '/max-age.json':
        res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'max-age=3600' })
        return res.end('{"cached":true}')
      case '/mismatch':
        // Fewer bytes than the declared length, then the connection closes.
        res.writeHead(200, { 'content-type': 'text/plain', 'content-length': '100' })
        res.write('short')
        return setTimeout(() => req.socket.destroy(), 50)
      case '/slow':
        return setTimeout(() => send(res, 'text/plain', 'late'), 5_000)
      case '/hang':
        return
      case '/worker.js':
        return send(res, 'text/javascript', "fetch('/worker-data.txt').then((r) => r.text())")
      case '/sw.js':
        return send(res, 'text/javascript', SERVICE_WORKER)
      case '/filters.txt':
        return send(res, 'text/plain', FILTER_LIST)
      default:
        res.writeHead(404)
        res.end()
    }
  })
}

function startFrameServer(log: Logged[]): Server {
  return createServer((req, res) => {
    logRequest(log, req, 'http')
    switch ((req.url ?? '/').split('?')[0]) {
      case '/frame':
        return send(res, 'text/html', FRAME)
      case '/frame.css':
        return send(res, 'text/css', 'p { margin: 0 }')
      case '/frame-data.txt':
      case '/frame-worker-data.txt':
        return send(res, 'text/plain', TXT)
      case '/frame-worker.js':
        return send(res, 'text/javascript', "fetch('/frame-worker-data.txt').then((r) => r.text())")
      case '/img.png':
        return send(res, 'image/png', PNG)
      default:
        res.writeHead(404)
        res.end()
    }
  })
}

interface ActivityEvent {
  type: string
  url: string
  captureId?: string
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

async function recapture(page: Page, caseId: string, url: string): Promise<ActivityEvent> {
  const accepted = await page.evaluate(
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
  expect(accepted).toBe(1)
  const handle = await page.waitForFunction(
    (target) => {
      const w = window as unknown as { activity: ActivityEvent[] }
      return w.activity.find((e) => e.url === target && e.type !== 'received') ?? null
    },
    url,
    { timeout: 140000 }
  )
  return (await handle.jsonValue()) as ActivityEvent
}

interface Stored {
  entry: Record<string, unknown>
  transactionRecord: Record<string, unknown>
  records: WarcRecord[]
  inflated: string
}

async function storedCapture(page: Page, caseId: string, captureId: string): Promise<Stored> {
  const storagePath = await page.evaluate(async () => {
    const w = window as unknown as {
      birdbrain: { settings: { get: () => Promise<{ storagePath: string }> } }
    }
    return (await w.birdbrain.settings.get()).storagePath
  })
  const entry = readFileSync(join(storagePath, caseId, 'manifest.jsonl'), 'utf-8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .find((candidate) => candidate.type === 'capture' && candidate.captureId === captureId)!
  const transactionRecord = (entry.inventory as { transactionRecord: Record<string, unknown> })
    .transactionRecord
  const file = readFileSync(join(storagePath, caseId, `${captureId}.warc.gz`))
  expect(createHash('sha256').update(file).digest('hex')).toBe(entry.transactionRecordHash)
  const records = readWarc(file)
  return {
    entry,
    transactionRecord,
    records,
    inflated: records.map(({ inflated }) => inflated.toString('latin1')).join('')
  }
}

async function verified(page: Page, captureId: string): Promise<string> {
  return page.evaluate(async (id: string) => {
    const w = window as unknown as {
      birdbrain: { captures: { verify: (id: string) => Promise<{ status: string }> } }
    }
    return (await w.birdbrain.captures.verify(id)).status
  }, captureId)
}

const ofType = (records: WarcRecord[], type: string) =>
  records.filter((record) => record.warc('WARC-Type') === type)

const responseFor = (records: WarcRecord[], url: string): WarcRecord => {
  const found = ofType(records, 'response').filter((r) => r.warc('WARC-Target-URI') === url)
  expect(found, url).toHaveLength(1)
  return found[0]
}

const sha256 = (bytes: Buffer): string =>
  `sha256:${createHash('sha256').update(bytes).digest('hex')}`

const sorted = (values: string[]): string[] => [...values].sort()

// A favicon request, if Chromium makes one for the page, is left out of both sides.
const notFavicon = (url: string): boolean => !url.endsWith('/favicon.ico')

// Patches the debugger of every window made after this call, in the main process, so a setup
// command fails as if the browser had refused it. Nothing in the app changes.
async function stubCommandFailure(
  electronApp: ElectronApplication,
  failure: 'page-auto-attach' | 'child-setup'
): Promise<void> {
  await electronApp.evaluate(({ app }, which) => {
    app.on('web-contents-created', (_event, contents) => {
      const dbg = contents.debugger
      const original = dbg.sendCommand.bind(dbg)
      dbg.sendCommand = (method: string, params?: object, sessionId?: string) => {
        const onPage = sessionId === undefined || sessionId === ''
        if (which === 'page-auto-attach' && method === 'Target.setAutoAttach' && onPage) {
          return Promise.reject(new Error('stubbed auto-attach failure'))
        }
        if (which === 'child-setup' && method === 'Network.enable' && !onPage) {
          return Promise.reject(new Error('stubbed child setup failure'))
        }
        return original(method, params, sessionId)
      }
    })
  }, failure)
}

test.describe('Transaction Record of a background capture', () => {
  const log: Logged[] = []
  let pageServer: Fixture
  let frameServer: Fixture

  test.beforeAll(async () => {
    frameServer = await listen(startFrameServer(log), 'localhost', 'http', log)
    pageServer = await listen(
      startPageServer(log, () => frameServer.origin),
      '127.0.0.1',
      'http',
      log
    )
    process.env.BIRDBRAIN_E2E_ALLOW_LOOPBACK = '1'
    process.env.BIRDBRAIN_CONSENT_LISTS = `${pageServer.origin}/filters.txt`
  })

  test.afterAll(async () => {
    delete process.env.BIRDBRAIN_E2E_ALLOW_LOOPBACK
    delete process.env.BIRDBRAIN_CONSENT_LISTS
    await pageServer.close()
    await frameServer.close()
  })

  test('records every exchange of the page, its frame and its workers, with known answers', async ({
    page
  }) => {
    test.setTimeout(180000)
    const caseId = await createCase(page, 'Transaction Record E2E')
    await recordActivity(page)
    log.length = 0
    const url = `${pageServer.origin}/tr`
    const end = await recapture(page, caseId, url)
    expect(end).toMatchObject({ type: 'stored' })
    // The app downloads the consent filter list itself, outside the page.
    const served = log
      .map(({ url: logged }) => logged)
      .filter((logged) => notFavicon(logged) && logged !== `${pageServer.origin}/filters.txt`)
    const { entry, transactionRecord, records, inflated } = await storedCapture(
      page,
      caseId,
      end.captureId!
    )

    // Every request a server logged is one exchange, each one written as a request record.
    // Beyond the log: the cached second use, which never reached the server, the page's copy
    // of the response its service worker answered (plan D17), and the request the consent
    // filter blocked.
    const requested = ofType(records, 'request')
      .map((record) => record.warc('WARC-Target-URI')!)
      .filter(notFavicon)
    expect(sorted(requested)).toEqual(
      sorted([
        ...served,
        `${pageServer.origin}/max-age.json`,
        `${pageServer.origin}/viasw.txt`,
        `${pageServer.origin}/blocked-by-consent.js`
      ])
    )

    // The page, its dedicated worker, the frame, the frame's worker and the service worker.
    expect(transactionRecord).toMatchObject({
      present: true,
      cached: 1,
      cancelled: 1,
      failed: 2,
      // The request left hanging, and the service worker's main script, which its session
      // reported finished with no response.
      inFlight: 2,
      webSockets: 0,
      recordedTargets: 5,
      unrecordedTargets: 0,
      replacedHeaders: ['cookie', 'set-cookie'],
      budget: { totalBytes: 50_000_000, resourceBytes: 10_000_000 }
    })
    const responses = ofType(records, 'response')
    expect(transactionRecord.exchanges).toBe(responses.length)
    const truncated = responses.filter((r) => r.warc('WARC-Truncated') === 'unspecified')
    expect(transactionRecord.bodiesOmitted).toBe(truncated.length)
    // Over the per-resource limit, and the page's copy of the service worker's answer.
    expect(sorted(truncated.map((r) => r.warc('WARC-Target-URI')!))).toEqual(
      expect.arrayContaining([`${pageServer.origin}/big.bin`, `${pageServer.origin}/viasw.txt`])
    )
    // The service worker's own fetch of the same URL holds the served body.
    const viaWorker = responses.filter(
      (r) => r.warc('WARC-Target-URI') === `${pageServer.origin}/viasw.txt`
    )
    expect(viaWorker.map((r) => r.http?.payload.equals(TXT))).toEqual(
      expect.arrayContaining([true])
    )

    // Payload digests are the digests of the bodies the server sent, before content coding.
    const gz = responseFor(records, `${pageServer.origin}/gz.txt`)
    expect(gz.warc('WARC-Payload-Digest')).toBe(sha256(TXT))
    expect(gz.http?.headers).toEqual(expect.arrayContaining([['x-orig-content-encoding', 'gzip']]))
    expect(responseFor(records, `${pageServer.origin}/plain.txt`).warc('WARC-Payload-Digest')).toBe(
      sha256(TXT)
    )
    for (const [path, { bytes }] of Object.entries(TEXT_BODIES)) {
      const response = responseFor(records, `${pageServer.origin}${path}`)
      expect(response.http?.payload.equals(bytes), path).toBe(true)
      expect(response.warc('WARC-Payload-Digest'), path).toBe(sha256(bytes))
    }

    // Redirects, same-origin and cross-origin: the hop has headers and no body.
    for (const [hop, next] of [
      ['/redir-same', `${pageServer.origin}/img.png?r=same`],
      ['/redir-cross', `${frameServer.origin}/img.png?r=cross`]
    ]) {
      const redirect = responseFor(records, `${pageServer.origin}${hop}`)
      expect(redirect.http?.statusLine).toBe('HTTP/1.1 302 Found')
      expect(redirect.http?.payload.length).toBe(0)
      expect(responseFor(records, next).http?.payload.equals(PNG)).toBe(true)
    }

    // Partial exchanges have a request record only.
    for (const path of ['/mismatch', '/slow', '/hang', '/blocked-by-consent.js']) {
      expect(
        ofType(records, 'response').some(
          (r) => r.warc('WARC-Target-URI') === `${pageServer.origin}${path}`
        ),
        path
      ).toBe(false)
    }

    // The cookie the page set reached the server, and appears nowhere in the record.
    expect(log.some(({ cookie }) => cookie?.includes(COOKIE_SECRET))).toBe(true)
    expect(inflated).not.toContain(COOKIE_SECRET)

    // Direct, so the record states the address; an http page has no Bound TLS Details.
    expect(responseFor(records, url).warc('WARC-IP-Address')).toBe('127.0.0.1')
    expect(entry).toMatchObject({ boundTlsAbsent: 'not-https', schemaVersion: 6 })
    expect(entry).not.toHaveProperty('boundTls')
    expect(inflated).not.toContain('x-birdbrain-decoded-text')

    expect(await verified(page, end.captureId!)).toBe('verified')
  })

  test('counts a target whose setup failed, and keeps the record', async ({
    page,
    electronApp
  }) => {
    test.setTimeout(150000)
    await stubCommandFailure(electronApp, 'child-setup')
    const caseId = await createCase(page, 'Child Setup Stub E2E')
    await recordActivity(page)
    const end = await recapture(page, caseId, `${pageServer.origin}/stub`)
    expect(end).toMatchObject({ type: 'stored' })
    const { transactionRecord } = await storedCapture(page, caseId, end.captureId!)
    // The frame, and the worker the frame starts, which attaches below it.
    expect(transactionRecord).toMatchObject({
      present: true,
      recordedTargets: 1,
      unrecordedTargets: 2
    })
  })

  test('counts the page when its auto-attach fails, and keeps the record', async ({
    page,
    electronApp
  }) => {
    test.setTimeout(150000)
    await stubCommandFailure(electronApp, 'page-auto-attach')
    const caseId = await createCase(page, 'Page Auto-attach Stub E2E')
    await recordActivity(page)
    const end = await recapture(page, caseId, `${pageServer.origin}/stub`)
    expect(end).toMatchObject({ type: 'stored' })
    const { transactionRecord, records } = await storedCapture(page, caseId, end.captureId!)
    expect(transactionRecord).toMatchObject({
      present: true,
      recordedTargets: 0,
      unrecordedTargets: 1
    })
    expect(
      ofType(records, 'response').some(
        (r) => r.warc('WARC-Target-URI') === `${pageServer.origin}/stub`
      )
    ).toBe(true)
  })
})

// A leaf for 127.0.0.1 from a test authority made for this run. No key material is committed.
function makeTestCertificate(): { key: string; cert: string } {
  const dir = mkdtempSync(join(tmpdir(), 'birdbrain-tr-tls-'))
  const run = (args: string[]) => execFileSync('openssl', args, { stdio: 'pipe', cwd: dir })
  const key = ['-newkey', 'rsa:2048', '-nodes']
  try {
    run(
      ['req', '-x509', ...key, '-keyout', 'ca.key', '-out', 'ca.pem', '-days', '2'].concat([
        '-subj',
        '/CN=Birdbrain Test CA'
      ])
    )
    run(['req', ...key, '-keyout', 'leaf.key', '-out', 'leaf.csr', '-subj', '/CN=127.0.0.1'])
    writeFileSync(join(dir, 'leaf.ext'), 'subjectAltName=IP:127.0.0.1\n')
    run(
      ['x509', '-req', '-in', 'leaf.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key'].concat([
        '-CAcreateserial',
        '-out',
        'leaf.pem',
        '-days',
        '2',
        '-extfile',
        'leaf.ext'
      ])
    )
    return {
      key: readFileSync(join(dir, 'leaf.key'), 'utf8'),
      cert: readFileSync(join(dir, 'leaf.pem'), 'utf8')
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test.describe('Bound TLS Details of a background capture', () => {
  const log: Logged[] = []
  let tls: Fixture
  let leaf: X509Certificate

  test.beforeAll(async () => {
    const { key, cert } = makeTestCertificate()
    leaf = new X509Certificate(cert)
    tls = await listen(
      createHttpsServer({ key, cert }, (req, res) => {
        logRequest(log, req, 'https')
        send(res, 'text/html', '<!doctype html><title>TLS Fixture</title><p>tls</p>')
      }),
      '127.0.0.1',
      'https',
      log
    )
    process.env.BIRDBRAIN_E2E_ALLOW_LOOPBACK = '1'
  })

  test.afterAll(async () => {
    delete process.env.BIRDBRAIN_E2E_ALLOW_LOOPBACK
    delete process.env.BIRDBRAIN_E2E_TRUST_CERT_SHA256
    await tls.close()
  })

  test.describe('with the test certificate allowance', () => {
    test.beforeAll(() => {
      process.env.BIRDBRAIN_E2E_TRUST_CERT_SHA256 = createHash('sha256')
        .update(leaf.raw)
        .digest('hex')
    })

    test.afterAll(() => {
      delete process.env.BIRDBRAIN_E2E_TRUST_CERT_SHA256
    })

    test("signs the main document's Bound TLS Details, matching the certificate", async ({
      page
    }) => {
      test.setTimeout(150000)
      const caseId = await createCase(page, 'Bound TLS E2E')
      await recordActivity(page)
      const end = await recapture(page, caseId, `${tls.origin}/tls`)
      expect(end).toMatchObject({ type: 'stored' })
      const { entry } = await storedCapture(page, caseId, end.captureId!)
      const boundTls = entry.boundTls as Record<string, unknown>
      expect(boundTls).toMatchObject({
        subjectName: '127.0.0.1',
        sanList: ['127.0.0.1'],
        issuer: 'Birdbrain Test CA',
        validFrom: new Date(leaf.validFrom).toISOString(),
        validTo: new Date(leaf.validTo).toISOString()
      })
      expect(entry).not.toHaveProperty('boundTlsAbsent')
      expect(await verified(page, end.captureId!)).toBe('verified')
    })
  })

  test('refuses the test certificate without the allowance', async ({ page }) => {
    test.setTimeout(150000)
    const caseId = await createCase(page, 'No Allowance E2E')
    await recordActivity(page)
    const end = await recapture(page, caseId, `${tls.origin}/refused`)
    expect(end.type).toBe('failed')
    expect(end.error).toMatch(/ERR_CERT_AUTHORITY_INVALID/)
  })
})

test.describe('Transaction Record through a proxy Egress', () => {
  const log: Logged[] = []
  let target: Fixture
  let proxy: Socks5Proxy

  test.beforeAll(async () => {
    target = await listen(
      startPageServer(log, () => target.origin),
      '127.0.0.1',
      'http',
      log
    )
    const targetPort = Number(new URL(target.origin).port)
    proxy = await startSocks5Proxy((host, port) => host === '127.0.0.1' && port === targetPort)
    process.env.BIRDBRAIN_E2E_ALLOW_LOOPBACK = '1'
  })

  test.afterAll(async () => {
    delete process.env.BIRDBRAIN_E2E_ALLOW_LOOPBACK
    await proxy.close()
    await target.close()
  })

  test("holds neither the proxy's host nor its port", async ({ page }) => {
    test.setTimeout(150000)
    const caseId = await createCase(page, 'Proxy Record E2E')
    await recordActivity(page)
    await page.evaluate(
      async (value) => {
        const w = window as unknown as {
          birdbrain: { settings: { update: (partial: object) => Promise<unknown> } }
        }
        await w.birdbrain.settings.update({ egress: value })
      },
      { kind: 'proxy', proxyUrl: `socks5://127.0.0.1:${proxy.port}`, label: 'E2E SOCKS' }
    )

    const end = await recapture(page, caseId, `${target.origin}/simple`)
    expect(end).toMatchObject({ type: 'stored' })
    expect(proxy.connects).toContain(new URL(target.origin).host)
    const { entry, records, inflated } = await storedCapture(page, caseId, end.captureId!)
    // The proxy listens on 127.0.0.1 like the target, so its host is the target's; the record
    // names neither through the address field, and nowhere names the proxy's port.
    expect(records.some((record) => record.warc('WARC-IP-Address') !== undefined)).toBe(false)
    expect(inflated).not.toContain(`:${proxy.port}`)
    expect(JSON.stringify(entry.inventory)).not.toContain(String(proxy.port))
    expect(entry).toMatchObject({ egressKind: 'proxy', boundTlsAbsent: 'not-https' })
  })
})
