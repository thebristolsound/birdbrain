import { test, expect } from '@playwright/test'
import { mkdtemp, readFile, rm } from 'fs/promises'
import { createServer, type Server } from 'http'
import { type AddressInfo } from 'net'
import { join } from 'path'
import { tmpdir } from 'os'
import type { BirdbrainAPI } from '@shared/birdbrainApi'
import type { BackgroundJobView } from '@shared/ipc'
import { launchBirdbrain, readyPage } from './fixtures/electronApp'
// @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
import { prepareProfile } from '../scripts/dev-seed/profile.mjs'

// The pool's known-answer check (docs/specs/2026-11-09-batch-capture-throughput-design.md,
// "Evidence-path impact"): one Batch of fixture pages, each on its own site, rendered at
// concurrency 1 and then 2, records the same inventory, Scroll-to-load outcome and Consent
// Suppression for every page. Each page is on its own `*.localhost` host, which Chromium resolves
// to loopback, so the one-job-per-site rule lets two render at once.

type Win = { birdbrain: BirdbrainAPI }

// Two 800px chunks at load and one more each time the sentinel scrolls into view, up to five.
const LAZY_PAGE = `<!doctype html><html><head><title>Pool Lazy</title><style>
  html,body{margin:0;background:#fff}
  .chunk{height:800px;box-sizing:border-box;border-bottom:4px solid #222;background:#cde}
  #sentinel{height:1px}
</style></head><body><div id="content"></div><div id="sentinel"></div><script>
  const content = document.getElementById('content')
  const add = () => { const d = document.createElement('div'); d.className = 'chunk'; content.appendChild(d) }
  add(); add()
  let added = 2
  new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting) && added < 5) { add(); added++ }
  }, { rootMargin: '100px' }).observe(document.getElementById('sentinel'))
</script></body></html>`

// A full-viewport consent overlay and a body scroll lock, which the fixture filter list hides.
const CONSENT_PAGE = `<!doctype html><html><head><title>Pool Consent</title><style>
  body{margin:0;font-family:sans-serif}
  #onetrust-consent-sdk{position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:9999;color:#fff}
  .chunk{height:800px;border-bottom:2px solid #888;padding:20px;background:#eef}
</style></head><body>
<div id="onetrust-consent-sdk">CONSENT-WALL-TEXT We value your privacy</div>
<script>document.body.style.overflow='hidden'</script>
<div class="chunk">ONE</div><div class="chunk">TWO</div><div class="chunk">THREE</div>
</body></html>`

// A <main> that scrolls on its own and grows by two 2000px chunks.
const APP_SHELL_PAGE = `<!doctype html><html><head><title>Pool App Shell</title></head>
<body style="height:100vh"><main id="main" style="height:100%;overflow:auto">
<div id="box"><div style="height:2000px">MAIN</div></div><div id="end" style="height:1px"></div>
</main><script>(() => { let n = 0; const root = document.getElementById('main')
  new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting) && n < 2) {
      const d = document.createElement('div'); d.style.height = '2000px'
      d.textContent = 'MAINLAZY' + n++; document.getElementById('box').appendChild(d)
    }
  }, { root }).observe(document.getElementById('end')) })()</script></body></html>`

const PLAIN_PAGE = (title: string): string =>
  `<!doctype html><html><head><title>${title}</title></head>` +
  `<body><h1>${title}</h1><p>stable content</p></body></html>`

const PAGES: Record<string, string> = {
  lazy: LAZY_PAGE,
  consent: CONSENT_PAGE,
  'app-shell': APP_SHELL_PAGE,
  plain: PLAIN_PAGE('Pool Plain'),
  second: PLAIN_PAGE('Pool Second')
}

interface Recorded {
  inventory: unknown
  scrollToLoad: unknown
  consentSuppression: unknown
}

test.describe('Background job pool', () => {
  let server: Server
  let port: number

  test.beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/filters.txt') {
        res.writeHead(200, { 'content-type': 'text/plain' })
        res.end('###onetrust-consent-sdk\n')
        return
      }
      const host = (req.headers.host ?? '').split('.')[0]
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end(PAGES[host] ?? PLAIN_PAGE('Pool Unknown'))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    ;({ port } = server.address() as AddressInfo)
  })

  test.afterAll(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  // Renders every fixture page in one Batch with `workers` slots, and returns what each page's
  // manifest entry records, with the Batch's job rows.
  async function renderBatch(workers: number): Promise<{
    recorded: Record<string, Recorded>
    jobs: BackgroundJobView[]
    concurrency: number
  }> {
    const userData = await mkdtemp(join(tmpdir(), `birdbrain-pool-${workers}-`))
    await prepareProfile(userData, { operatorName: 'E2E Test Operator' })
    const app = await launchBirdbrain(userData, {
      BIRDBRAIN_E2E_ALLOW_LOOPBACK: '1',
      BIRDBRAIN_E2E_SHARING_OFF: '1',
      BIRDBRAIN_CONSENT_LISTS: `http://127.0.0.1:${port}/filters.txt`,
      BIRDBRAIN_BACKGROUND_WORKERS: String(workers)
    })
    try {
      const page = await readyPage(app)
      const urls = Object.keys(PAGES).map((name) => `http://${name}.localhost:${port}/`)
      const { caseId, batchId, concurrency } = await page.evaluate(async (queued) => {
        const { birdbrain } = window as unknown as Win
        const { id } = await birdbrain.cases.create({ name: 'Pool' })
        const result = await birdbrain.recapture.enqueue({ urls: queued, caseId: id })
        const { concurrency } = await birdbrain.recapture.queueStatus()
        return { caseId: id, batchId: result.batchId, concurrency }
      }, urls)
      const listJobs = () =>
        page.evaluate(
          (id) => (window as unknown as Win).birdbrain.recapture.listJobs({ batchId: id }),
          batchId
        )
      await expect
        .poll(async () => (await listJobs()).map(({ state }) => state), { timeout: 240_000 })
        .toEqual(urls.map(() => 'stored'))
      const jobs = await listJobs()

      const { storagePath } = await page.evaluate(() =>
        (window as unknown as Win).birdbrain.settings.get()
      )
      const entries = (await readFile(join(storagePath, caseId, 'manifest.jsonl'), 'utf-8'))
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as Record<string, unknown>)
        .filter(({ type }) => type === 'capture')
      const recorded: Record<string, Recorded> = {}
      for (const { url, captureId } of jobs) {
        const entry = entries.find((e) => e.captureId === captureId)
        expect(entry, url).toBeDefined()
        expect(entry!.url, url).toBe(url)
        const { inventory, scrollToLoad, consentSuppression } = entry!
        recorded[new URL(url).hostname] = { inventory, scrollToLoad, consentSuppression }
      }
      return { recorded, jobs, concurrency }
    } finally {
      await app.close().catch(() => {})
      await rm(userData, { recursive: true, force: true }).catch(() => {})
    }
  }

  // The most jobs whose start-to-end spans overlap at one instant.
  function peakOverlap(jobs: BackgroundJobView[]): number {
    const spans = jobs.map(({ startedAt, finishedAt }) => [
      Date.parse(startedAt!),
      Date.parse(finishedAt!)
    ])
    return Math.max(...spans.map(([at]) => spans.filter(([s, e]) => s <= at && at < e).length))
  }

  test('records the same inventory, Scroll-to-load and Consent Suppression at 1 and 2', async () => {
    test.setTimeout(600_000)

    const one = await renderBatch(1)
    const two = await renderBatch(2)

    expect([one.concurrency, two.concurrency]).toEqual([1, 2])
    expect(peakOverlap(one.jobs)).toBe(1)
    // Without an overlap the comparison would show nothing about concurrent renders.
    expect(peakOverlap(two.jobs)).toBe(2)

    expect(Object.keys(two.recorded).sort()).toEqual(Object.keys(one.recorded).sort())
    for (const [host, record] of Object.entries(one.recorded)) {
      expect(two.recorded[host], host).toEqual(record)
    }
    // Every page rendered with the consent blocker on, in both runs, at once in the second.
    for (const { consentSuppression } of [
      ...Object.values(one.recorded),
      ...Object.values(two.recorded)
    ]) {
      expect(consentSuppression).toBe('filter-list')
    }
  })
})
