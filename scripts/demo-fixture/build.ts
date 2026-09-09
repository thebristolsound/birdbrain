/**
 * Builds the bundled demonstration Case Archive shipped at
 * `resources/demo-case.birdbrain` (#405).
 *
 * The archive is produced by the product's own pipeline, never by hand: three
 * synthetic pages under `pages/` are served to a real Chromium window over an
 * intercepted https scheme, saved as MHTML with a screenshot, ingested through
 * `ingestMhtmlCapture` so every capture gets a signed manifest entry, and
 * exported through `exportCaseArchive`. What ships is therefore an ordinary
 * chain-verified archive whose only unusual property is that its case row
 * carries `is_demo = 1`.
 *
 * The pages are fictional by construction — every host is under the reserved
 * `.invalid` TLD (RFC 2606) and every page carries a visible notice — so no
 * third-party bytes are redistributed inside the installer (#405, Q4).
 *
 * Run it with `pnpm build:demo-fixture`, which bundles this file and hands it
 * to Electron. Regenerate whenever the DB schema or the archive schema moves
 * past what the committed fixture can satisfy; the guard is the known-answer
 * test at `tests/main/services/demoFixture.test.ts`, which imports the shipped
 * archive against the current schema.
 */

import { app, BrowserWindow, session } from 'electron'
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { initDatabase, closeDatabase } from '@main/services/db/core'
import * as caseRepo from '@main/services/db/caseRepo'
import * as noteRepo from '@main/services/db/noteRepo'
import * as selectorRepo from '@main/services/db/selectorRepo'
import * as tagRepo from '@main/services/db/tagRepo'
import { initSettings, updateSettings } from '@main/services/settings'
import { initInstallationId, getInstallationId } from '@main/services/installationId'
import { initSigningKey } from '@main/services/signingKey'
import { initStorage } from '@main/services/storage'
import { ingestMhtmlCapture } from '@main/services/captureLifecycle'
import { exportCaseArchive } from '@main/services/caseArchive'
import { DEMO_CASE_OPERATOR_NAME } from '@shared/constants'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(HERE, '..', '..')
const PAGES_DIR = join(HERE, 'pages')
const OUTPUT_PATH = join(REPO_ROOT, 'resources', 'demo-case.birdbrain')

const VIEWPORT = { width: 1280, height: 900 }
const PARTITION = 'demo-fixture'

interface DemoPage {
  file: string
  url: string
  /**
   * Recorded on the capture row and signed into the archive's `capture` entry,
   * so the demo case reads as a worked example with a history rather than three
   * pages grabbed at once. Invented, like the page and the host it belongs to:
   * nothing was acquired at these times, and they deliberately sit months
   * before the `exportedAt` the header records, which is the build date.
   */
  timestamp: string
}

const PAGES: DemoPage[] = [
  {
    file: 'harbourside-forum.html',
    url: 'https://harbourside-forum.invalid/warnings/digital-assets/thread-4482',
    timestamp: '2026-01-16T09:24:11.000Z'
  },
  {
    file: 'nightjar-exchange.html',
    url: 'https://nightjar-exchange.invalid/custody',
    timestamp: '2026-01-16T09:31:47.000Z'
  },
  {
    file: 'civicwatch-bulletin.html',
    url: 'https://civicwatch-bulletin.invalid/214/nightjar-withdrawal-freeze',
    timestamp: '2026-01-22T14:02:03.000Z'
  }
]

// Offscreen rendering composites through the GPU process, which has no usable
// device on a headless CI runner and fails `capturePage` with UnknownVizError.
// The demo pages carry no scripts, so software rasterization loses nothing.
app.disableHardwareAcceleration()

// Each page is rendered in its own window, so the default "quit when the last
// window closes" behaviour would end the process between captures.
app.on('window-all-closed', () => {})

function log(message: string): void {
  process.stdout.write(`[demo-fixture] ${message}\n`)
}

/**
 * Serves `pages/` over the fictional https hosts above.
 *
 * Intercepting https rather than loading `file://` URLs is what lets the
 * capture row, the MHTML `Content-Location` headers and the manifest entry all
 * record the same address — a fixture that recorded a local temp path would
 * misdescribe what was captured.
 */
function serveDemoHosts(): void {
  const ses = session.fromPartition(PARTITION)
  const byUrl = new Map(PAGES.map((page) => [page.url, page.file]))
  ses.protocol.handle('https', (request) => {
    const file = byUrl.get(request.url.replace(/\/$/, ''))
    if (!file) return new Response('Not found', { status: 404 })
    return new Response(readFileSync(join(PAGES_DIR, file)), {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' }
    })
  })
}

interface RenderedDemoPage {
  mhtml: Buffer
  screenshot: Buffer
  text: string
  title: string
  userAgent: string
}

async function render(url: string, scratchDir: string): Promise<RenderedDemoPage> {
  // A shown window, not an offscreen one: `capturePage` reads the compositor's
  // surface, and a window that never composites yields an empty image. The
  // build runs under xvfb (see scripts/build-demo-fixture.mjs), so nothing is
  // ever visible on a real display.
  const win = new BrowserWindow({
    show: true,
    width: VIEWPORT.width,
    height: VIEWPORT.height,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      partition: PARTITION
    }
  })
  try {
    await win.loadURL(url)
    // The pages carry no scripts and no subresources, so a single settle is
    // enough for layout to finish before the surface is read.
    await new Promise((resolve) => setTimeout(resolve, 400))

    const mhtmlPath = join(scratchDir, 'page.mhtml')
    await win.webContents.savePage(mhtmlPath, 'MHTML')
    const mhtml = readFileSync(mhtmlPath)

    const height = (await win.webContents.executeJavaScript(
      'document.documentElement.scrollHeight'
    )) as number
    win.setContentSize(VIEWPORT.width, Math.min(Math.max(height, VIEWPORT.height), 4000))
    await new Promise((resolve) => setTimeout(resolve, 400))
    const screenshot = (await win.webContents.capturePage()).toPNG()

    const text = (await win.webContents.executeJavaScript('document.body.innerText')) as string
    return {
      mhtml,
      screenshot,
      text,
      title: win.webContents.getTitle(),
      userAgent: win.webContents.getUserAgent()
    }
  } finally {
    win.destroy()
  }
}

function bufferStream(buf: Buffer): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(buf))
      controller.close()
    }
  })
}

function mentionDoc(
  segments: Array<string | { targetType: string; targetId: string; label: string }>
): string {
  return JSON.stringify({
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: segments.map((segment) =>
          typeof segment === 'string'
            ? { type: 'text', text: segment }
            : { type: 'mention', attrs: segment }
        )
      }
    ]
  })
}

async function build(): Promise<void> {
  const workDir = mkdtempSync(join(tmpdir(), 'birdbrain-demo-fixture-'))
  const userData = join(workDir, 'userData')
  const scratch = join(workDir, 'scratch')
  mkdirSync(userData, { recursive: true })
  mkdirSync(scratch, { recursive: true })

  await initDatabase(join(userData, 'birdbrain.db'))
  initSettings(userData)
  // Both sides of the fixture's attribution are the same fixed string (#405,
  // Q3): the export gate below reads it, and nothing from the machine that
  // built the archive reaches the operators who import it.
  updateSettings({
    operatorName: DEMO_CASE_OPERATOR_NAME,
    operatorRole: '',
    operatorOrganization: ''
  })
  initInstallationId(userData)
  // The key is generated into a temp directory that is deleted below, so the
  // usual at-rest protection prompt has nothing to protect; declining the OS
  // credential store keeps the build non-interactive on a CI runner.
  initSigningKey(userData, {
    isEncryptionAvailable: () => false,
    confirmUnprotectedKey: () => true
  })
  initStorage(join(userData, 'captures'))

  const demoCase = caseRepo.createCase({
    name: 'Demo: Nightjar Exchange',
    description:
      'A worked example shipped with Birdbrain. Every page in it is fictional — no real site was captured.',
    type: 'fraud'
  })
  caseRepo.setCaseDemo(demoCase.id, true)
  log(`case ${demoCase.id}`)

  serveDemoHosts()

  const captures: Array<{ id: string; title: string; text: string }> = []
  for (const page of PAGES) {
    const rendered = await render(page.url, scratch)
    const { capture } = await ingestMhtmlCapture(
      {
        caseId: demoCase.id,
        url: page.url,
        title: rendered.title,
        timestamp: page.timestamp,
        stream: bufferStream(rendered.mhtml),
        screenshot: rendered.screenshot,
        textContent: rendered.text,
        headers: { 'content-type': 'text/html; charset=utf-8' },
        browserVersion: process.versions.chrome,
        userAgent: rendered.userAgent,
        httpStatus: 200,
        operatorId: getInstallationId(),
        operatorName: DEMO_CASE_OPERATOR_NAME,
        toolVersion: app.getVersion()
      },
      // The hosts are fictional, so there is no origin to re-fetch a
      // certificate from. Returning null records the same "not corroborated"
      // state a capture of an http page gets.
      async () => null
    )
    captures.push({ id: capture.id, title: rendered.title, text: rendered.text })
    log(`captured ${page.url}`)
  }

  const selectorSpecs = [
    { pattern: 'settlements@nightjar-exchange.invalid', label: 'Settlements address' },
    { pattern: 'bc1qdemo0nightjar0escrow0wallet0fixture0aa', label: 'Escrow wallet' },
    { pattern: '203.0.113.42', label: 'Portal host' }
  ]
  for (const spec of selectorSpecs) {
    const selector = selectorRepo.createSelector({
      caseId: demoCase.id,
      pattern: spec.pattern,
      label: spec.label,
      isRegex: false
    })
    selectorRepo.matchSelectorAgainstCaptures(
      selector.id,
      captures.map((c) => ({ captureId: c.id, text: c.text }))
    )
  }

  const tag = tagRepo.createTag({ name: 'nightjar', color: '#c2410c' })
  for (const capture of captures) {
    tagRepo.addTagToCapture({ captureId: capture.id, tagId: tag.id })
  }

  const walletSelector = selectorRepo
    .listSelectors(demoCase.id)
    .find((s) => s.label === 'Escrow wallet')!
  noteRepo.createNote({
    caseId: demoCase.id,
    title: 'One escrow address, three sources',
    bodyDoc: mentionDoc([
      'The same deposit address appears in the forum thread ',
      { targetType: 'capture', targetId: captures[0].id, label: captures[0].title },
      ' and on the firm’s own custody page ',
      { targetType: 'capture', targetId: captures[1].id, label: captures[1].title },
      ', which is what makes ',
      { targetType: 'selector', targetId: walletSelector.id, label: 'Escrow wallet' },
      ' worth watching.'
    ])
  })
  noteRepo.createNote({
    caseId: demoCase.id,
    title: 'Next steps',
    bodyDoc: mentionDoc([
      'Preserve original correspondence with full headers, then re-read ',
      { targetType: 'capture', targetId: captures[2].id, label: captures[2].title },
      ' for the dates the withdrawal requests were refused.'
    ])
  })

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true })
  rmSync(OUTPUT_PATH, { force: true })
  await exportCaseArchive(demoCase.id, OUTPUT_PATH)
  closeDatabase()
  rmSync(workDir, { recursive: true, force: true })
  log(`wrote ${OUTPUT_PATH}`)
}

app.whenReady().then(
  () =>
    build().then(
      () => app.exit(0),
      (err: unknown) => {
        process.stderr.write(`[demo-fixture] FAILED: ${String(err)}\n`)
        app.exit(1)
      }
    ),
  (err: unknown) => {
    process.stderr.write(`[demo-fixture] FAILED: ${String(err)}\n`)
    process.exit(1)
  }
)
