import { test, expect } from './fixtures/electronApp'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { pathToFileURL } from 'url'
import { readStoredZip } from '@main/services/zipRead'
import { createStoredZip } from '@main/services/zip'

type Page = import('@playwright/test').Page
type ElectronApplication = import('@playwright/test').ElectronApplication
type Bridge = {
  birdbrain: {
    cases: {
      exportArchive: (caseId: string) => Promise<unknown>
      importArchive: (path: string, overrideTamper: boolean) => Promise<{ newCaseId: string }>
    }
  }
}

// The pre-v11 HTML viewer's navigation guard (#1708). No producer writes a
// `format: 'html'` capture any more, so this spec makes one the way an Operator
// still can receive one: in a case archive from an older install. It exports a real
// case, rewrites its one capture into the legacy format, and imports the result with
// the tamper override, which records the rewrite in the imported case's manifest.

const LEGACY_PAGE = (fileTarget: string) =>
  '<html><head>' +
  `<meta http-equiv="refresh" content="1;url=${fileTarget}">` +
  '</head><body><p>legacy page</p>' +
  '<iframe src="data:text/html,%3Cp%3Einline%20frame%3C/p%3E"></iframe>' +
  '<iframe srcdoc="&lt;p&gt;srcdoc frame&lt;/p&gt;"></iframe>' +
  '<iframe src="sibling.html"></iframe>' +
  '</body></html>'

async function createCase(page: Page, name: string): Promise<string> {
  await page.evaluate(() => {
    window.location.hash = '/cases/new'
  })
  await page.waitForSelector('[data-testid="case-name-input"]', { timeout: 10000 })
  await page.fill('[data-testid="case-name-input"]', name)
  await page.click('[data-testid="case-create-btn"]')
  await page.waitForURL(/#\/cases\/.+\/overview/, { timeout: 10000 })
  return page.url().match(/cases\/([^/]+)/)![1]
}

async function seedMhtmlCapture(page: Page, caseId: string) {
  const result = await page.evaluate(async (caseId) => {
    const status = await fetch('http://127.0.0.1:19845/api/status')
    const token = (await status.json()).serverToken ?? ''
    const body = [
      'MIME-Version: 1.0',
      'Content-Type: multipart/related; type="text/html"; boundary="B"',
      '',
      '--B',
      'Content-Type: text/html',
      'Content-Location: https://legacy.example/page',
      '',
      '<html><body>placeholder</body></html>',
      '--B--',
      ''
    ].join('\r\n')
    const form = new FormData()
    form.append('source', 'manual')
    form.append('caseId', caseId)
    form.append('url', 'https://legacy.example/page')
    form.append('title', 'Legacy page')
    form.append('timestamp', new Date().toISOString())
    form.append('textContent', 'legacy')
    form.append('extensionVersion', '0.1.0')
    form.append('browserVersion', 'Chrome/120')
    form.append('userAgent', 'Mozilla/5.0')
    form.append('mhtml', new Blob([body], { type: 'multipart/related' }), 'capture.mhtml')
    const r = await fetch('http://127.0.0.1:19845/api/captures', {
      method: 'POST',
      body: form,
      headers: { 'X-Birdbrain-Token': token }
    })
    return r.json()
  }, caseId)
  expect(result.status).toBe('ok')
}

// Turns the archive's one MHTML capture into a pre-v11 HTML capture, and adds a
// file beside it that a relative iframe in the page would resolve to once imported.
async function rewriteAsLegacy(archivePath: string, page: string): Promise<void> {
  const entries = readStoredZip(await readFile(archivePath))
  const data = JSON.parse(entries.get('data.json')!.toString('utf-8'))
  const [capture] = data.captures as Record<string, unknown>[]
  capture.format = 'html'
  capture.mhtml_path = null
  capture.html_path = null
  const out = [...entries]
    .filter(([name]) => name !== `files/${capture.id}.mhtml`)
    .map(([name, buf]) => ({
      name,
      data: name === 'data.json' ? JSON.stringify(data, null, 2) : buf
    }))
  out.push({ name: `files/${capture.id}.html`, data: page })
  out.push({ name: 'files/sibling.html', data: '<p>a local file beside the capture</p>' })
  await writeFile(archivePath, createStoredZip(out))
}

async function guestState(electronApp: ElectronApplication) {
  return electronApp.evaluate(({ webContents }) => {
    const guest = webContents.getAllWebContents().find((wc) => wc.getType() === 'webview')
    if (!guest) return null
    return { url: guest.getURL(), frames: guest.mainFrame.framesInSubtree.map((f) => f.url) }
  })
}

test.describe('legacy HTML viewer guard', () => {
  test('a stored page cannot move the guest to a local file; local-scheme iframes render', async ({
    electronApp,
    page
  }) => {
    test.setTimeout(180000)
    const dir = await mkdtemp(join(tmpdir(), 'birdbrain-legacy-'))
    try {
      const target = join(dir, 'local-target.html')
      await writeFile(target, '<html><body>a local file outside the capture</body></html>')
      const fileTarget = pathToFileURL(target).toString()
      const archivePath = join(dir, 'legacy.birdbrain')

      const sourceCaseId = await createCase(page, 'Legacy source')
      await seedMhtmlCapture(page, sourceCaseId)
      await electronApp.evaluate(({ dialog }, path) => {
        dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: path })
      }, archivePath)
      await page.evaluate(
        (id) => (window as unknown as Bridge).birdbrain.cases.exportArchive(id),
        sourceCaseId
      )
      await rewriteAsLegacy(archivePath, LEGACY_PAGE(fileTarget))
      const { newCaseId } = await page.evaluate(
        (path) => (window as unknown as Bridge).birdbrain.cases.importArchive(path, true),
        archivePath
      )

      // The import went round the dialog, so the renderer's caches have not heard of
      // the new case; a reload reads it fresh.
      await page.reload()
      await page.waitForSelector('[data-testid="app-ready"]', { timeout: 15000 })
      await page.evaluate((id) => {
        window.location.hash = `/cases/${id}/captures`
      }, newCaseId)
      const rows = page.getByTestId('capture-item')
      await expect(rows).toHaveCount(1, { timeout: 15000 })
      await rows.first().click()
      await page.getByRole('tab', { name: 'Page', exact: true }).click()
      await expect(page.getByTestId('legacy-html-viewer')).toBeVisible({ timeout: 15000 })

      // The data: and srcdoc frames have committed, so the page has laid out.
      await expect
        .poll(async () => (await guestState(electronApp))?.frames ?? [], { timeout: 15000 })
        .toEqual(
          expect.arrayContaining(['data:text/html,%3Cp%3Einline%20frame%3C/p%3E', 'about:srcdoc'])
        )
      const loaded = (await guestState(electronApp))!
      expect(loaded.url).toMatch(/^file:\/\/\/.*\.html$/)
      // Past the meta refresh's one second, with room to spare.
      await page.waitForTimeout(2500)
      const after = (await guestState(electronApp))!
      expect(after.url).toBe(loaded.url)
      expect(after.frames.filter((url) => url.startsWith('file:'))).toEqual([loaded.url])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
