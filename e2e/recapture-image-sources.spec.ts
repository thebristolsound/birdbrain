import { test, expect } from './fixtures/electronApp'
import { createCase } from './fixtures/seed'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import type { ElectronApplication, Page } from '@playwright/test'
import { readStoredZip } from '@main/services/zipRead'
import { verifyEvidencePackage } from '@shared/verify/evidencePackage'
import { readWarc } from '../src/packages/transaction-record/warcReader'
import { PACKAGE_ROOT_FILES } from '../src/packages/evidence-package-layout/index'

// Image Source Pinning (#1843, ADR-0055): a background capture points each srcset image at the
// source it displayed before saving the MHTML, and signs how many it pinned. Every image the
// server sends is a 1x1 PNG followed by `TAG:<path>`, so the bytes of each MHTML part name the
// request that served them.

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

type Route = (req: IncomingMessage, res: ServerResponse) => void

const page = (title: string, head: string, body: string): string =>
  `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>${head}</head><body><h1>${title}</h1>${body}</body></html>`
const send =
  (type: string, body: string | Buffer, headers: Record<string, string> = {}): Route =>
  (_req, res) => {
    res.writeHead(200, { 'content-type': type, ...headers }).end(body)
  }
const png =
  (headers: Record<string, string> = {}): Route =>
  (req, res) => {
    res
      .writeHead(200, { 'content-type': 'image/png', ...headers })
      .end(Buffer.concat([PNG, Buffer.from(`TAG:${req.url}`)]))
  }
const MAX_AGE = { 'cache-control': 'max-age=3600' }
const NO_STORE = { 'cache-control': 'no-store' }

// The renderer spike's `q2-savepage` fixture
// (docs/specs/2026-10-11-capture-engine-renderer-spike.md, "Reproduce"), with tagged images.
const ROUTES: Record<string, Route> = {
  '/savepage': send(
    'text/html',
    page(
      'Savepage fixture',
      '<link rel="icon" href="/savepage/icon.png"><link rel="stylesheet" href="/savepage/style.css">',
      `<img src="/savepage/cacheable.png" width="40" height="40">
<img src="/savepage/nostore.png" width="40" height="40">
<img srcset="/savepage/srcset-1x.png 1x, /savepage/srcset-2x.png 2x" width="40" height="40">
<iframe src="/savepage/frame" width="200" height="80"></iframe>
<div style="height:3000px"></div>
<img loading="lazy" src="/savepage/lazy.png" width="40" height="40">`
    )
  ),
  '/savepage/style.css': send(
    'text/css',
    '@font-face{font-family:SpikeFont;src:url(/savepage/font.woff2)}' +
      'body{font-family:SpikeFont,sans-serif;background:url(/savepage/bg.png)}' +
      '@media print{body{background:url(/savepage/print-only.png)}}'
  ),
  '/savepage/font.woff2': send('font/woff2', Buffer.from('not a real font')),
  '/savepage/icon.png': png(),
  '/savepage/bg.png': png(NO_STORE),
  '/savepage/print-only.png': png(),
  '/savepage/cacheable.png': png(MAX_AGE),
  '/savepage/nostore.png': png(NO_STORE),
  '/savepage/srcset-1x.png': png(),
  '/savepage/srcset-2x.png': png(),
  '/savepage/lazy.png': png(NO_STORE),
  '/savepage/frame': send(
    'text/html',
    page('Savepage frame', '', '<img src="/savepage/frame-nostore.png">'),
    NO_STORE
  ),
  '/savepage/frame-nostore.png': png(NO_STORE),

  // The five images of the triage of #1843.
  '/five': send(
    'text/html',
    page(
      'Five images fixture',
      '',
      `<img srcset="/five/srcset-only-1x.png 1x, /five/srcset-only-2x.png 2x" width="10" height="10">
<img src="/five/src-fallback.png" srcset="/five/srcset-with-src-1x.png 1x, /five/srcset-with-src-2x.png 2x" width="10" height="10">
<img srcset="/five/srcset-w-400.png 400w, /five/srcset-w-800.png 800w" sizes="10px" width="10" height="10">
<picture><source srcset="/five/picture-source.png" type="image/png"><img src="/five/picture-fallback.png" width="10" height="10"></picture>
<img src="/five/plain.png" width="10" height="10">`
    )
  ),

  // A srcset image whose load fails: the browser chose it, and it has no image to show.
  '/broken': send(
    'text/html',
    page('Broken image fixture', '', '<img srcset="/broken/missing.png 1x" width="10" height="10">')
  ),
  '/broken/missing.png': (_req, res) => {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found')
  }
}

interface Fixture {
  origin: string
  served: string[]
  close: () => Promise<void>
}

async function startServer(): Promise<Fixture> {
  const served: string[] = []
  const server: Server = createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0]
    served.push(path)
    const route = ROUTES[path] ?? (path.startsWith('/five/') ? png() : undefined)
    if (route) route(req, res)
    else res.writeHead(404).end()
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  return {
    origin: `http://127.0.0.1:${port}`,
    served,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      })
  }
}

// Queues one background capture and resolves with the stored Capture's id.
async function recapture(page: Page, caseId: string, url: string): Promise<string> {
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
  let stored = ''
  await expect
    .poll(
      async () => {
        stored = await page.evaluate(async (id) => {
          const w = window as unknown as {
            birdbrain: { captures: { list: (caseId: string) => Promise<Array<{ id: string }>> } }
          }
          const [capture] = await w.birdbrain.captures.list(id)
          return capture?.id ?? ''
        }, caseId)
        return stored
      },
      { timeout: 140000, intervals: [500] }
    )
    .not.toBe('')
  return stored
}

async function storagePathOf(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const w = window as unknown as {
      birdbrain: { settings: { get: () => Promise<{ storagePath: string }> } }
    }
    return (await w.birdbrain.settings.get()).storagePath
  })
}

function captureEntries(storagePath: string, caseId: string): Array<Record<string, unknown>> {
  return readFileSync(join(storagePath, caseId, 'manifest.jsonl'), 'utf-8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((entry) => entry.type === 'capture')
}

async function captureRow(
  page: Page,
  caseId: string,
  captureId: string
): Promise<{ id: string; inventory?: unknown }> {
  return page.evaluate(
    async ({ id, capture }) => {
      const w = window as unknown as {
        birdbrain: {
          captures: {
            list: (caseId: string) => Promise<Array<{ id: string; inventory?: unknown }>>
          }
        }
      }
      return (await w.birdbrain.captures.list(id)).find((row) => row.id === capture)!
    },
    { id: caseId, capture: captureId }
  )
}

async function verified(page: Page, captureId: string): Promise<string> {
  return page.evaluate(async (id: string) => {
    const w = window as unknown as {
      birdbrain: { captures: { verify: (id: string) => Promise<{ status: string }> } }
    }
    return (await w.birdbrain.captures.verify(id)).status
  }, captureId)
}

// The parts of an MHTML file: each part's Content-Location and its decoded bytes.
function mhtmlParts(mhtml: string): Array<{ location: string; bytes: Buffer }> {
  const boundary = /boundary="([^"]+)"/.exec(mhtml)![1]
  return mhtml
    .split(`--${boundary}`)
    .slice(1, -1)
    .map((chunk) => {
      const [head, ...rest] = chunk.replace(/^\r?\n/, '').split(/\r?\n\r?\n/)
      const header = (name: string) => new RegExp(`^${name}: *(.*)$`, 'mi').exec(head)?.[1].trim()
      const body = rest.join('\r\n\r\n')
      const bytes =
        header('Content-Transfer-Encoding') === 'base64'
          ? Buffer.from(body.replace(/\s+/g, ''), 'base64')
          : Buffer.from(body, 'latin1')
      return { location: header('Content-Location') ?? '', bytes }
    })
}

function storedMhtml(storagePath: string, caseId: string, captureId: string) {
  return mhtmlParts(readFileSync(join(storagePath, caseId, `${captureId}.mhtml`), 'latin1'))
}

// Exports the Case as an evidence package through the app, and unpacks it into a new directory.
async function exportedPackage(
  electronApp: ElectronApplication,
  page: Page,
  caseId: string
): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'birdbrain-pinning-package-'))
  const zipPath = join(dir, 'package.zip')
  await electronApp.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
  }, zipPath)
  const result = await page.evaluate(async (id) => {
    const w = window as unknown as {
      birdbrain: {
        export: {
          generateReport: (caseId: string, options: object) => Promise<{ canceled: boolean }>
        }
      }
    }
    return w.birdbrain.export.generateReport(id, {
      format: 'zip',
      exportClass: 'evidence',
      include: {
        captures: true,
        screenshots: true,
        auditTrail: true,
        notes: false,
        annotations: 'none'
      },
      outputPath: ''
    })
  }, caseId)
  expect(result.canceled).toBe(false)
  const unpacked = join(dir, 'unpacked')
  for (const [name, bytes] of readStoredZip(readFileSync(zipPath))) {
    mkdirSync(dirname(join(unpacked, name)), { recursive: true })
    writeFileSync(join(unpacked, name), bytes)
  }
  return unpacked
}

test.describe('Image Source Pinning of a background capture', () => {
  let server: Fixture

  test.beforeAll(async () => {
    server = await startServer()
    // The fixture is on 127.0.0.1, which a background capture refuses unless an unpackaged
    // build is launched with this switch (#1726).
    process.env.BIRDBRAIN_E2E_ALLOW_LOOPBACK = '1'
  })

  test.afterAll(async () => {
    delete process.env.BIRDBRAIN_E2E_ALLOW_LOOPBACK
    await server.close()
  })

  test("saves the spike fixture's srcset-only image under the address it was fetched from", async ({
    page
  }) => {
    test.setTimeout(180000)
    const caseId = await createCase(page, 'Savepage pinning E2E')
    server.served.length = 0
    const captureId = await recapture(page, caseId, `${server.origin}/savepage`)
    const storagePath = await storagePathOf(page)

    const srcsetImage = `${server.origin}/savepage/srcset-1x.png`
    const part = storedMhtml(storagePath, caseId, captureId).find(
      ({ location }) => location === srcsetImage
    )
    expect(part, 'the MHTML has a part for the srcset image').toBeDefined()
    expect(part!.bytes.toString('latin1')).toMatch(/TAG:\/savepage\/srcset-1x\.png$/)
    expect(server.served).not.toContain('/savepage/srcset-2x.png')

    const [entry] = captureEntries(storagePath, caseId)
    expect(entry.inventory).toMatchObject({
      mhtml: { present: true, pinnedImages: 1, pinnedImagesNotLoaded: 0 }
    })
    expect((await captureRow(page, caseId, captureId)).inventory).toEqual(entry.inventory)
    expect(await verified(page, captureId)).toBe('verified')
  })

  test('stores each displayed image under its own address, and the package verifies', async ({
    page,
    electronApp
  }) => {
    test.setTimeout(180000)
    const caseId = await createCase(page, 'Five images pinning E2E')
    server.served.length = 0
    const captureId = await recapture(page, caseId, `${server.origin}/five`)
    const storagePath = await storagePathOf(page)

    // A part for each image's displayed source, holding the bytes served from that address.
    const parts = storedMhtml(storagePath, caseId, captureId)
    for (const path of [
      '/five/srcset-only-1x.png',
      '/five/srcset-with-src-1x.png',
      '/five/srcset-w-400.png',
      '/five/picture-source.png',
      '/five/plain.png'
    ]) {
      const part = parts.find(({ location }) => location === `${server.origin}${path}`)
      expect(part, path).toBeDefined()
      expect(part!.bytes.toString('latin1').endsWith(`TAG:${path}`)).toBe(true)
    }
    // No part under an address the server never served.
    expect(server.served).not.toContain('/five/src-fallback.png')
    const servedOrigins = new Set(server.served.map((path) => `${server.origin}${path}`))
    for (const { location } of parts) {
      if (location.startsWith(server.origin)) expect(servedOrigins).toContain(location)
    }

    const [entry] = captureEntries(storagePath, caseId)
    const mhtml = { present: true, pinnedImages: 3, pinnedImagesNotLoaded: 0 }
    expect(entry.inventory).toMatchObject({ mhtml })
    expect((await captureRow(page, caseId, captureId)).inventory).toEqual(entry.inventory)
    expect(await verified(page, captureId)).toBe('verified')

    // A Duplicate re-anchors the source's inventory, and its row mirrors what it re-anchors.
    const copy = await page.evaluate(async (id) => {
      const w = window as unknown as {
        birdbrain: {
          captures: {
            duplicate: (id: string) => Promise<{ status: string; capture?: { id: string } }>
          }
        }
      }
      return w.birdbrain.captures.duplicate(id)
    }, captureId)
    expect(copy.status).toBe('duplicated')
    const duplicateEntry = captureEntries(storagePath, caseId).at(-1)!
    expect(duplicateEntry).toMatchObject({ method: 'duplicate', inventory: { mhtml } })
    expect((await captureRow(page, caseId, copy.capture!.id)).inventory).toEqual(
      duplicateEntry.inventory
    )

    // The exported package verifies in the app's verifier and in the verify.sh it ships.
    const dir = await exportedPackage(electronApp, page, caseId)
    const result = verifyEvidencePackage(dir)
    expect(result.pass, JSON.stringify(result.checks, null, 2)).toBe(true)
    const script = execFileSync('/bin/sh', [PACKAGE_ROOT_FILES.verifyScript], {
      cwd: dir,
      encoding: 'utf-8'
    })
    expect(script).toContain('verify.sh: PASS')
    rmSync(dirname(dir), { recursive: true, force: true })
  })

  test('counts a pinned image that failed to load, whose second request the record lacks', async ({
    page
  }) => {
    test.setTimeout(180000)
    const caseId = await createCase(page, 'Broken image pinning E2E')
    server.served.length = 0
    const captureId = await recapture(page, caseId, `${server.origin}/broken`)
    const storagePath = await storagePathOf(page)

    const [entry] = captureEntries(storagePath, caseId)
    expect(entry.inventory).toMatchObject({
      mhtml: { present: true, pinnedImages: 1, pinnedImagesNotLoaded: 1 },
      transactionRecord: { present: true }
    })

    // The browser asked for the image again when it was pinned, after collection stopped.
    const missing = `${server.origin}/broken/missing.png`
    expect(server.served.filter((path) => path === '/broken/missing.png')).toHaveLength(2)
    const records = readWarc(readFileSync(join(storagePath, caseId, `${captureId}.warc.gz`)))
    const requests = records.filter(
      (record) =>
        record.warc('WARC-Type') === 'request' && record.warc('WARC-Target-URI') === missing
    )
    expect(requests).toHaveLength(1)
    expect(await verified(page, captureId)).toBe('verified')
  })
})
