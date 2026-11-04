// The capture engine probe (D15 of docs/plans/2026-10-10-capture-engine-first-slice.md): does
// enabling the CDP Network domain change what a page can observe, do CDP bodies match the served
// payloads, and does printToPDF work offscreen? Taken from "The probe" in
// docs/specs/2026-10-02-capture-engine-probe-spike.md, as an ES module, with `history.length`
// added to the page facts (renderer spike, question 7), and with the on pass sending the page
// setup a background render sends after `Network.enable`: `Network.configureDurableMessages` and
// `Target.setAutoAttach` with `waitForDebuggerOnStart` (step 9). A standalone Electron main
// script, not the app: one pass per process, chosen by PROBE_PASS (`off` or `on`). run.mjs runs
// both passes and compares them.
import { app, BrowserWindow, session } from 'electron'
import { Buffer } from 'buffer'
import http from 'http'
import zlib from 'zlib'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

const OUT = process.env.PROBE_OUT || path.join(import.meta.dirname, 'out')
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)
const TXT = Buffer.from('known-answer payload '.repeat(200))
const requests = []
const PAGE = `<!doctype html><html><head><title>probe</title>
<style>@media print { body { background-image: url(/print-only.png) } }</style></head>
<body><h1>probe</h1><img src="/img.png"><img src="/img.png"><img src="/redir">
<script>
window.__print = []
addEventListener('beforeprint', () => __print.push('beforeprint'))
addEventListener('afterprint', () => __print.push('afterprint'))
matchMedia('print').addEventListener('change', (e) => __print.push('mq:' + e.matches))
let stackRead = 0
const e = new Error('x')
Object.defineProperty(e, 'stack', { get() { stackRead++; return '' } })
console.debug(e)
window.__ready = (async () => {
  const gz = await (await fetch('/gz.txt')).text()
  const plain = await (await fetch('/plain.txt')).text()
  await new Promise((r) => setTimeout(r, 300))
  return {
    webdriver: navigator.webdriver,
    chromeKeys: Object.keys(window.chrome || {}),
    stackRead,
    gzLen: gz.length,
    plainLen: plain.length,
    hasFocus: document.hasFocus(),
    visibility: document.visibilityState,
    historyLength: history.length,
    resources: performance.getEntriesByType('resource').map((r) => r.name.replace(location.origin, '')).sort()
  }
})()
</script></body></html>`

const server = http.createServer((req, res) => {
  requests.push(req.url)
  if (req.url === '/') return res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE)
  if (req.url.startsWith('/img.png'))
    return res
      .writeHead(200, { 'content-type': 'image/png', 'cache-control': 'max-age=3600' })
      .end(PNG)
  if (req.url === '/print-only.png')
    return res.writeHead(200, { 'content-type': 'image/png' }).end(PNG)
  if (req.url === '/redir') return res.writeHead(302, { location: '/img.png?r=1' }).end()
  if (req.url === '/gz.txt')
    return res
      .writeHead(200, { 'content-type': 'text/plain', 'content-encoding': 'gzip' })
      .end(zlib.gzipSync(TXT))
  if (req.url === '/plain.txt') return res.writeHead(200, { 'content-type': 'text/plain' }).end(TXT)
  res.writeHead(404).end()
})

async function pass(base, name, enableNetwork) {
  requests.length = 0
  const ses = session.fromPartition('probe-' + name + '-' + Date.now())
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: {
      offscreen: true,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      session: ses,
      backgroundThrottling: false
    }
  })
  const wc = win.webContents
  wc.debugger.attach('1.3')
  const ev = {
    hops: [],
    reqs: new Map(),
    cache: [],
    extraInfo: 0,
    headersText: 0,
    finished: [],
    failed: [],
    redirects: 0
  }
  if (enableNetwork) {
    wc.debugger.on('message', (_e, method, p) => {
      // A target that attaches waits for the debugger; the render resumes each one, and so does
      // this pass. The fixture page starts none.
      if (method === 'Target.attachedToTarget') {
        ev.attached = (ev.attached ?? 0) + 1
        wc.debugger.sendCommand('Runtime.runIfWaitingForDebugger', {}, p.sessionId).catch(() => {})
      }
      if (method === 'Network.requestWillBeSent') {
        // One CDP request id spans every hop of a redirect; keep each hop as its own exchange.
        if (p.redirectResponse) {
          ev.redirects++
          const prev = ev.hops.filter((h) => h.requestId === p.requestId).pop()
          if (prev) prev.status = p.redirectResponse.status
        }
        ev.hops.push({ requestId: p.requestId, url: p.request.url })
        ev.reqs.set(p.requestId, { url: p.request.url })
      }
      if (method === 'Network.requestServedFromCache') ev.cache.push(p.requestId)
      if (method === 'Network.responseReceivedExtraInfo') {
        ev.extraInfo++
        if (p.headersText) ev.headersText++
      }
      if (method === 'Network.responseReceived') {
        const r = ev.reqs.get(p.requestId)
        if (r) {
          r.status = p.response.status
          r.fromDiskCache = p.response.fromDiskCache
          r.encodingHeader =
            p.response.headers['Content-Encoding'] || p.response.headers['content-encoding']
        }
      }
      if (method === 'Network.loadingFinished') ev.finished.push(p.requestId)
      if (method === 'Network.loadingFailed') ev.failed.push(p.requestId)
    })
    if (process.env.PROBE_BLANK_FIRST === '1') await wc.loadURL('about:blank')
    try {
      const limits = { maxTotalBufferSize: 50e6, maxResourceBufferSize: 10e6 }
      await wc.debugger.sendCommand('Network.enable', limits)
      await wc.debugger.sendCommand('Network.configureDurableMessages', limits)
      await wc.debugger.sendCommand('Target.setAutoAttach', {
        autoAttach: true,
        waitForDebuggerOnStart: true,
        flatten: true
      })
      ev.enableError = null
    } catch (err) {
      ev.enableError = String(err.message || err)
      console.error(name, 'Network.enable failed', ev.enableError)
      fs.writeFileSync(
        path.join(OUT, 'result-' + name + '-enable.json'),
        JSON.stringify(
          { versions: process.versions.electron, enableError: ev.enableError },
          null,
          2
        )
      )
      throw err
    }
    ev.enabledFresh = process.env.PROBE_BLANK_FIRST !== '1'
  }
  console.error(name, 'loading')
  await wc.loadURL(base + '/')
  console.error(name, 'loaded')
  const pageFacts = await wc.executeJavaScript('window.__ready')
  await sleep(500)
  const bodies = []
  if (enableNetwork) {
    for (const id of ev.finished) {
      const r = ev.reqs.get(id) || {}
      const url = (r.url || '').replace(base, '')
      try {
        const { body, base64Encoded } = await wc.debugger.sendCommand('Network.getResponseBody', {
          requestId: id
        })
        const buf = Buffer.from(body, base64Encoded ? 'base64' : 'utf8')
        bodies.push({
          url,
          sha: sha(buf).slice(0, 16),
          len: buf.length,
          base64Encoded,
          servedFromCache: ev.cache.includes(id),
          encodingHeader: r.encodingHeader
        })
      } catch (err) {
        bodies.push({
          url,
          error: String(err.message || err),
          servedFromCache: ev.cache.includes(id)
        })
      }
    }
  }
  console.error(name, 'bodies done')
  const serverBeforePdf = requests.slice()
  const finishedBeforePdf = ev.finished.length
  let pdf
  try {
    const buf = await wc.printToPDF({})
    fs.writeFileSync(path.join(OUT, 'page-' + name + '.pdf'), buf)
    pdf = { magic: buf.subarray(0, 5).toString(), bytes: buf.length }
  } catch (err) {
    pdf = { error: String(err) }
  }
  console.error(name, 'pdf', JSON.stringify(pdf))
  await sleep(500)
  let cdpPdf
  try {
    const { data } = await wc.debugger.sendCommand('Page.printToPDF', {})
    const buf = Buffer.from(data, 'base64')
    cdpPdf = { magic: buf.subarray(0, 5).toString(), bytes: buf.length }
  } catch (err) {
    cdpPdf = { error: String(err.message || err) }
  }
  console.error(name, 'cdpPdf', JSON.stringify(cdpPdf))
  await sleep(300)
  const printEvents = await wc.executeJavaScript('window.__print')
  const out = {
    pageFacts,
    serverRequestsBeforePdf: serverBeforePdf,
    serverRequestsDuringPdf: requests.slice(serverBeforePdf.length),
    pdf,
    cdpPdf,
    printEvents,
    cdp: enableNetwork
      ? {
          requestsSeen: ev.reqs.size,
          exchanges: ev.hops.map((h) => ({ url: h.url.replace(base, ''), status: h.status })),
          finished: finishedBeforePdf,
          finishedAfterPdf: ev.finished.length - finishedBeforePdf,
          enabledOnFreshWindow: ev.enabledFresh,
          attachedTargets: ev.attached ?? 0,
          enableError: ev.enableError,
          failed: ev.failed.length,
          servedFromCache: ev.cache.length,
          redirects: ev.redirects,
          extraInfoEvents: ev.extraInfo,
          extraInfoWithHeadersText: ev.headersText,
          bodies
        }
      : null
  }
  win.destroy()
  return out
}

app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-dev-shm-usage')
setTimeout(() => {
  console.error('probe timeout')
  app.exit(2)
}, 90000)
app
  .whenReady()
  .then(async () => {
    fs.mkdirSync(OUT, { recursive: true })
    await new Promise((r) => server.listen(0, '127.0.0.1', r))
    const base = 'http://127.0.0.1:' + server.address().port
    const result = {
      versions: { electron: process.versions.electron, chrome: process.versions.chrome },
      expected: {
        page: sha(Buffer.from(PAGE)).slice(0, 16),
        txt: sha(TXT).slice(0, 16),
        txtLen: TXT.length,
        png: sha(PNG).slice(0, 16),
        gzWireLen: zlib.gzipSync(TXT).length
      },
      [process.env.PROBE_PASS]: await pass(
        base,
        process.env.PROBE_PASS,
        process.env.PROBE_PASS === 'on'
      )
    }
    fs.writeFileSync(
      path.join(OUT, 'result-' + process.env.PROBE_PASS + '.json'),
      JSON.stringify(result, null, 2)
    )
    app.exit(0)
  })
  .catch((err) => {
    console.error('FATAL', (err && err.stack) || err)
    app.exit(1)
  })
process.on('unhandledRejection', (e) => console.error('UNHANDLED', (e && e.stack) || e))
app.on('render-process-gone', (_e, _wc, d) => console.error('RENDER GONE', JSON.stringify(d)))
