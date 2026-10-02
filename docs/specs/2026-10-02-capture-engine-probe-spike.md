# Capture engine probe: network domain, body digests, and PDF in the hidden window

**Date:** 2026-10-02

**Status:** Complete. A measurement, not a decision.

Answers three items the
[capture engine spec](2026-09-30-capture-engine-design.md) left open: whether enabling the CDP
`Network` domain changes anything a page can observe, whether the bodies CDP returns match what
the server sent, and whether a PDF can be taken in the offscreen hidden window.

## Method

A throwaway Electron main script, reproduced at the end of this page, opened one `BrowserWindow`
configured like `renderPageInHiddenWindow` (`show: false`, `offscreen: true`, `sandbox`,
`contextIsolation`, no `nodeIntegration`, a fresh session partition) and attached
`webContents.debugger`. It loaded a page from a local HTTP server on `127.0.0.1`. The page
referenced one image twice, an image behind a redirect, a text file served with `gzip`, the same
text served uncompressed, and an image used only by a print style rule. The page recorded what
it could observe about itself, and the server logged every request.

Two passes ran, each in its own Electron process: one with no CDP domain enabled, as the
renderer runs today, and one with `Network.enable` sent before the page loaded.

Runtime: Electron `44.3.0` on Chromium `152.0.7977.78`, under `xvfb-run` with `--no-sandbox`.

## Results

**Enabling `Network` changed nothing the page recorded.** Both passes returned the same values
for `navigator.webdriver` (`false`), the keys of `window.chrome` (none), `document.hasFocus()`,
`document.visibilityState`, the resource timing list, and the check the
[persona spike](2026-09-19-persona-bot-detection-spike.md) names for an attached debugger: a
getter on an `Error` object's `stack`, passed to `console.debug`, was read zero times in both.

**Every body matched its known answer.** `Network.getResponseBody` returned all five finished
bodies. Each digest equalled the digest of the fixture's payload.

| Resource | Served as | Returned | Digest matches the decoded payload |
| --- | --- | --- | --- |
| document | uncompressed | text, 1,163 bytes | not compared |
| image | uncompressed | base64, 70 bytes | yes |
| image behind a redirect | uncompressed | base64, 70 bytes | yes |
| text | `gzip`, 70 bytes on the wire | text, 4,200 bytes | yes |
| text | uncompressed | text, 4,200 bytes | yes |

**The `gzip` body came back decoded under its original header.** The response still reported
`Content-Encoding: gzip`. This confirms the mismatch the spec lists as an open question: a
payload digest can only be checked against the decoded payload.

**A resource used twice produced one exchange and no cache event.** The image referenced twice
reached the server once, and CDP reported one request and no `Network.requestServedFromCache`
event. The second use left no trace in the network events at all.

**A redirect is one request with no body of its own.** The redirect arrived as a
`redirectResponse` on the follow-up `Network.requestWillBeSent`, under the same request id.

**Header text was present on every exchange.** All seven `Network.responseReceivedExtraInfo`
events carried `headersText`. The fixture server speaks HTTP/1.1 only.

**`webContents.printToPDF` works in the offscreen hidden window.** It returned a valid PDF of
7,224 bytes. `Page.printToPDF` sent over `webContents.debugger` failed with the error
`'Page.printToPDF' wasn't found`, so the Electron method is the only route.

**Printing is visible to the page and starts requests.** The page received `beforeprint` and
`afterprint`, its print media query changed, and the print-only image was requested during the
print. This supports the spec's order: take the PDF last, after collection stops.

**`Network.enable` failed on a window that had not navigated.** Sent straight after
`debugger.attach`, it was rejected with the error `target closed while handling command`. Loading
`about:blank` first, then enabling, then loading the target worked. In the failing run the
browser then could not start a page process, so this run does not separate the two faults. The
order that worked still places the enable before the target's first request.

## What this does not show

- Nothing about TLS. The fixture is plain HTTP, so Bound TLS Details are untested.
- Nothing about HTTP/2 or HTTP/3, where `headersText` is expected to be absent.
- Nothing about a body over the buffer limits, a failed request, a cancelled request, or a
  request still in flight.
- The consent filter was not loaded.
- One run of each pass, on one machine. The first attempt ran while the test suite was running
  and is not counted.
- "Nothing the page recorded changed" covers the listed facts only. It is not a claim that no
  detector can tell.

## Effect on the spec

- Open question 7 (PDF in a hidden window): answered. Use `webContents.printToPDF`.
- The risk section (enabling an event domain): no change observed in the listed facts.
- Open question 6 (cached responses): a repeated resource inside one page leaves no event, so the
  inventory cannot count it. The record holds the one exchange that happened.
- Open question 3 (decoded bodies under original headers): the mismatch is real and measured.
- New: enable the domain after a blank page has loaded, not on a fresh window.

## The probe

```js
// Throwaway probe: does enabling the CDP Network domain change what a page can
// observe, do CDP bodies match served payloads, and does printToPDF work offscreen?
const { app, BrowserWindow, session } = require('electron')
const http = require('http')
const zlib = require('zlib')
const crypto = require('crypto')
const fs = require('fs')
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
    resources: performance.getEntriesByType('resource').map((r) => r.name.replace(location.origin, '')).sort()
  }
})()
</script></body></html>`

const server = http.createServer((req, res) => {
  requests.push(req.url)
  if (req.url === '/') return res.writeHead(200, { 'content-type': 'text/html' }).end(PAGE)
  if (req.url.startsWith('/img.png'))
    return res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'max-age=3600' }).end(PNG)
  if (req.url === '/print-only.png') return res.writeHead(200, { 'content-type': 'image/png' }).end(PNG)
  if (req.url === '/redir') return res.writeHead(302, { location: '/img.png?r=1' }).end()
  if (req.url === '/gz.txt')
    return res.writeHead(200, { 'content-type': 'text/plain', 'content-encoding': 'gzip' }).end(zlib.gzipSync(TXT))
  if (req.url === '/plain.txt') return res.writeHead(200, { 'content-type': 'text/plain' }).end(TXT)
  res.writeHead(404).end()
})

async function pass(base, name, enableNetwork) {
  requests.length = 0
  const ses = session.fromPartition('probe-' + name + '-' + Date.now())
  const win = new BrowserWindow({
    show: false, width: 1280, height: 900,
    webPreferences: { offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, session: ses, backgroundThrottling: false }
  })
  const wc = win.webContents
  wc.debugger.attach('1.3')
  const ev = { reqs: new Map(), cache: [], extraInfo: 0, headersText: 0, finished: [], failed: [], redirects: 0 }
  if (enableNetwork) {
    wc.debugger.on('message', (_e, method, p) => {
      if (method === 'Network.requestWillBeSent') {
        if (p.redirectResponse) ev.redirects++
        ev.reqs.set(p.requestId, { url: p.request.url })
      }
      if (method === 'Network.requestServedFromCache') ev.cache.push(p.requestId)
      if (method === 'Network.responseReceivedExtraInfo') { ev.extraInfo++; if (p.headersText) ev.headersText++ }
      if (method === 'Network.responseReceived') {
        const r = ev.reqs.get(p.requestId)
        if (r) {
          r.status = p.response.status
          r.fromDiskCache = p.response.fromDiskCache
          r.encodingHeader = p.response.headers['Content-Encoding'] || p.response.headers['content-encoding']
        }
      }
      if (method === 'Network.loadingFinished') ev.finished.push(p.requestId)
      if (method === 'Network.loadingFailed') ev.failed.push(p.requestId)
    })
    if (process.env.PROBE_BLANK_FIRST === '1') await wc.loadURL('about:blank')
    await wc.debugger.sendCommand('Network.enable', { maxTotalBufferSize: 50e6, maxResourceBufferSize: 10e6 })
    ev.enabledFresh = process.env.PROBE_BLANK_FIRST !== '1'
  }
  console.error(name,'loading')
  await wc.loadURL(base + '/')
  console.error(name,'loaded')
  const pageFacts = await wc.executeJavaScript('window.__ready')
  await sleep(500)
  const bodies = []
  if (enableNetwork) {
    for (const id of ev.finished) {
      const r = ev.reqs.get(id) || {}
      const url = (r.url || '').replace(base, '')
      try {
        const { body, base64Encoded } = await wc.debugger.sendCommand('Network.getResponseBody', { requestId: id })
        const buf = Buffer.from(body, base64Encoded ? 'base64' : 'utf8')
        bodies.push({ url, sha: sha(buf).slice(0, 16), len: buf.length, base64Encoded, servedFromCache: ev.cache.includes(id), encodingHeader: r.encodingHeader })
      } catch (err) {
        bodies.push({ url, error: String(err.message || err), servedFromCache: ev.cache.includes(id) })
      }
    }
  }
  console.error(name,'bodies done')
  const serverBeforePdf = requests.slice()
  const finishedBeforePdf = ev.finished.length
  let pdf
  try {
    const buf = await wc.printToPDF({})
    pdf = { magic: buf.subarray(0, 5).toString(), bytes: buf.length }
  } catch (err) { pdf = { error: String(err) } }
  console.error(name,'pdf', JSON.stringify(pdf))
  await sleep(500)
  let cdpPdf
  try {
    const { data } = await wc.debugger.sendCommand('Page.printToPDF', {})
    const buf = Buffer.from(data, 'base64')
    cdpPdf = { magic: buf.subarray(0, 5).toString(), bytes: buf.length }
  } catch (err) { cdpPdf = { error: String(err.message || err) } }
  console.error(name,'cdpPdf', JSON.stringify(cdpPdf))
  await sleep(300)
  const printEvents = await wc.executeJavaScript('window.__print')
  const out = {
    pageFacts,
    serverRequestsBeforePdf: serverBeforePdf,
    serverRequestsDuringPdf: requests.slice(serverBeforePdf.length),
    pdf, cdpPdf, printEvents,
    cdp: enableNetwork ? {
      requestsSeen: ev.reqs.size, finished: finishedBeforePdf, finishedAfterPdf: ev.finished.length - finishedBeforePdf,
      enabledOnFreshWindow: ev.enabledFresh, failed: ev.failed.length, servedFromCache: ev.cache.length, redirects: ev.redirects,
      extraInfoEvents: ev.extraInfo, extraInfoWithHeadersText: ev.headersText, bodies
    } : null
  }
  win.destroy()
  return out
}

app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-dev-shm-usage')
setTimeout(() => { console.error('probe timeout'); app.exit(2) }, 90000)
app.whenReady().then(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  const base = 'http://127.0.0.1:' + server.address().port
  const result = {
    versions: { electron: process.versions.electron, chrome: process.versions.chrome },
    expected: { txt: sha(TXT).slice(0, 16), txtLen: TXT.length, png: sha(PNG).slice(0, 16), gzWireLen: zlib.gzipSync(TXT).length },
    [process.env.PROBE_PASS]: await pass(base, process.env.PROBE_PASS, process.env.PROBE_PASS === 'on')
  }
  fs.writeFileSync('/tmp/capture-probe/result-' + process.env.PROBE_PASS + '.json', JSON.stringify(result, null, 2))
  app.exit(0)
}).catch((err) => { console.error('FATAL', err && err.stack || err); app.exit(1) })
process.on('unhandledRejection', (e) => console.error('UNHANDLED', e && e.stack || e))
app.on('render-process-gone', (_e, _wc, d) => console.error('RENDER GONE', JSON.stringify(d)))
```

Run once per pass:

```shell
PROBE_PASS=off xvfb-run --auto-servernum node_modules/.bin/electron --no-sandbox main.js
PROBE_BLANK_FIRST=1 PROBE_PASS=on xvfb-run --auto-servernum node_modules/.bin/electron --no-sandbox main.js
```
