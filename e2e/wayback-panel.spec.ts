import { test, expect } from './fixtures/electronApp'
import { mkdtemp, rm } from 'fs/promises'
import { readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { CAPTURE_SERVER_BASE_URL } from '@shared/constants'
import type { BirdbrainAPI } from '@shared/birdbrainApi'

type Page = import('@playwright/test').Page
type ElectronApplication = import('@playwright/test').ElectronApplication

// The Wayback slide-out, the side-by-side compare and the pinned references the
// Evidence Package carries (#401).
//
// One thing this spec deliberately does not do is run a live CDX lookup. The
// lookup is the disclosure of the captured URL to archive.org, it is
// user-initiated by design, and putting a third party's availability on a
// required check would make the gate report on archive.org rather than on this
// branch. So the snapshot list and the replay guest are covered by the unit
// tests (tests/components/WaybackPanel.test.tsx and WaybackCompare.test.tsx),
// and what is proven here is the part that has to hold in the real app: the
// panel's layout and its refusal to look anything up unbidden, the compare's
// standing labelling, and a pin travelling through the real IPC handler into
// the export dialog and out into report.html.

function readStoredZipEntries(path: string): Map<string, string> {
  const zip = readFileSync(path)
  const entries = new Map<string, string>()
  let offset = 0
  while (offset < zip.length && zip.readUInt32LE(offset) === 0x04034b50) {
    const compressedSize = zip.readUInt32LE(offset + 18)
    const nameLength = zip.readUInt16LE(offset + 26)
    const extraLength = zip.readUInt16LE(offset + 28)
    const nameStart = offset + 30
    const dataStart = nameStart + nameLength + extraLength
    const name = zip.subarray(nameStart, nameStart + nameLength).toString('utf-8')
    entries.set(name, zip.subarray(dataStart, dataStart + compressedSize).toString('utf-8'))
    offset = dataStart + compressedSize
  }
  return entries
}

async function createCase(page: Page, name: string): Promise<string> {
  await page.evaluate(() => {
    window.location.hash = '/cases/new'
  })
  await page.waitForSelector('[data-testid="case-name-input"]', { timeout: 10000 })
  await page.fill('[data-testid="case-name-input"]', name)
  await page.click('[data-testid="case-create-btn"]')
  await page.waitForURL(/#\/cases\/.+\/overview/, { timeout: 10000 })
  const match = page.url().match(/cases\/([^/]+)/)
  if (!match) throw new Error('case id not in url')
  return match[1]
}

async function seedCapture(page: Page, caseId: string, url: string, title: string): Promise<void> {
  const ok = await page.evaluate(
    async ({ caseId, url, title, baseUrl }) => {
      const status = await fetch(`${baseUrl}/api/status`).then((r) => r.json())
      const token: string = status.serverToken ?? ''
      const form = new FormData()
      form.append('source', 'manual')
      form.append('caseId', caseId)
      form.append('url', url)
      form.append('title', title)
      form.append('timestamp', new Date().toISOString())
      form.append('textContent', title)
      form.append('extensionVersion', '0.1.0')
      form.append('browserVersion', 'Chrome/120')
      form.append('userAgent', 'Mozilla/5.0')
      form.append(
        'mhtml',
        new Blob([`<html><body>${title}</body></html>`], { type: 'multipart/related' }),
        'capture.mhtml'
      )
      const r = await fetch(`${baseUrl}/api/captures`, {
        method: 'POST',
        body: form,
        headers: { 'X-Birdbrain-Token': token }
      })
      return (await r.json()).status === 'ok'
    },
    { caseId, url, title, baseUrl: CAPTURE_SERVER_BASE_URL }
  )
  if (!ok) throw new Error(`capture upload failed for ${title}`)
}

async function stubSaveDialog(electronApp: ElectronApplication, filePath: string): Promise<void> {
  await electronApp.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: path })
  }, filePath)
}

test.describe('Wayback panel, compare and pinned references', () => {
  test('opens the panel, pins a snapshot and carries it into the package', async ({
    electronApp,
    page
  }) => {
    test.setTimeout(120000)

    const tempDir = await mkdtemp(join(tmpdir(), 'birdbrain-wayback-'))
    const zipPath = join(tempDir, 'wayback-evidence.zip')

    try {
      const caseId = await createCase(page, 'Wayback E2E')
      await seedCapture(page, caseId, 'https://example.com/pinned', 'Pinned Capture')

      await page.evaluate((id) => {
        window.location.hash = `/cases/${id}/captures`
      }, caseId)

      const rows = page.getByTestId('capture-item')
      await expect(rows).toHaveCount(1, { timeout: 15000 })
      await rows.first().click()

      // 1. The panel opens with the tab, and the list gives up its column to it.
      await page.getByRole('tab', { name: 'Wayback', exact: true }).click()
      const panel = page.getByTestId('wayback-panel')
      await expect(panel).toBeVisible()
      expect(Math.round((await panel.boundingBox())!.width)).toBe(436)
      await expect(rows).toHaveCount(0)

      // 2. Nothing was disclosed to archive.org: the lookup waits for the operator.
      await expect(page.getByTestId('wayback-idle')).toBeVisible()
      await expect(page.getByTestId('wayback-summary')).toHaveText('Not looked up yet')
      await expect(
        panel.getByText(/looking up discloses the URL to archive\.org/)
      ).toBeVisible()

      // 3. The compare states the no-diff position and labels the replay pane as
      //    live non-evidence content before anything is loaded into it.
      await expect(page.getByTestId('wayback-compare')).toBeVisible()
      await expect(page.getByText(/Birdbrain doesn't diff the two/)).toBeVisible()
      await expect(page.getByTestId('wayback-nonevidence-label')).toContainText('not evidence')
      await expect(page.getByTestId('wayback-compare-empty')).toBeVisible()

      // 4. Pin a snapshot through the real IPC handler — the same call the row's
      //    pin control makes, validated main-side and persisted with no lookup.
      const snapshotUrl = await page.evaluate(async (id) => {
        // The preload bridge is not on the e2e project's `window` type — no other
        // spec reaches for it — so it is named here rather than declared globally.
        const { captures: capturesApi, wayback } = (
          window as unknown as { birdbrain: BirdbrainAPI }
        ).birdbrain
        const captures = await capturesApi.list(id)
        const capture = captures[0]
        const snapshot = {
          timestamp: '2026-01-02T03:04:05.000Z',
          snapshotUrl: `https://web.archive.org/web/20260102030405/${capture.url}`,
          originalUrl: capture.url,
          statusCode: 200,
          mimeType: 'text/html'
        }
        const ref = await wayback.pin({
          captureId: capture.id,
          snapshot,
          checkedAt: new Date().toISOString()
        })
        return ref.snapshotUrl
      }, caseId)
      expect(snapshotUrl).toContain('https://web.archive.org/web/20260102030405/')

      // 5. The export dialog states the pins the package will carry.
      await stubSaveDialog(electronApp, zipPath)
      await page.getByRole('button', { name: 'Export', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Export evidence report' }).click()
      await expect(page.getByRole('heading', { name: 'Export case' })).toBeVisible()
      const pinnedBlock = page.getByTestId('export-pinned-wayback')
      await expect(pinnedBlock).toBeVisible()
      await expect(pinnedBlock).toContainText('2026-01-02 03:04 UTC')
      await expect(pinnedBlock).toContainText('not downloaded or packaged')

      // 6. And the report ships it as a corroboration reference, not as content.
      await page.getByTestId('export-submit').click()
      await expect(page.getByText('Export complete')).toBeVisible({ timeout: 30000 })

      const entries = readStoredZipEntries(zipPath)
      const report = entries.get('report.html')!
      expect(report).toContain(
        'Corroboration only — archive.org references, not bound to the capture'
      )
      expect(report).toContain(snapshotUrl)
      expect(report).toContain('archive.org listed a snapshot at the stated time')
      // A pin adds no file to the package: the archived page is referenced, never
      // retrieved or stored.
      expect([...entries.keys()].some((name) => name.includes('archive'))).toBe(false)
    } finally {
      await rm(tempDir, { recursive: true, force: true })
    }
  })
})
