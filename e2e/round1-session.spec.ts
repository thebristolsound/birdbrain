import { test, expect } from './fixtures/electronApp'
import { _electron } from '@playwright/test'
import { mkdtemp, rm } from 'fs/promises'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { CAPTURE_SERVER_BASE_URL } from '@shared/constants'

type Page = import('@playwright/test').Page
type ElectronApplication = import('@playwright/test').ElectronApplication

// Steps 1 to 7 of the observed-session script
// (docs/plans/2026-09-05-observed-tester-sessions.md), by machine. The script is
// walked by a person once per tester; this spec walks the same path on every build
// so a candidate whose path is broken is caught before it costs a tester's visit.
// The capture goes in through the Hono server, as every other spec does: the
// extension has its own tests.

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

async function capturePage(
  page: Page,
  caseId: string,
  url: string,
  title: string
): Promise<string> {
  const captureId = await page.evaluate(
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
      const body = await r.json()
      return body.status === 'ok' ? (body.captureId as string) : ''
    },
    { caseId, url, title, baseUrl: CAPTURE_SERVER_BASE_URL }
  )
  if (!captureId) throw new Error(`capture upload failed for ${title}`)
  return captureId
}

function readStoredZipNames(path: string): string[] {
  const zip = readFileSync(path)
  const names: string[] = []
  let offset = 0
  while (offset < zip.length && zip.readUInt32LE(offset) === 0x04034b50) {
    const compressedSize = zip.readUInt32LE(offset + 18)
    const nameLength = zip.readUInt16LE(offset + 26)
    const extraLength = zip.readUInt16LE(offset + 28)
    const nameStart = offset + 30
    names.push(zip.subarray(nameStart, nameStart + nameLength).toString('utf-8'))
    offset = nameStart + nameLength + extraLength + compressedSize
  }
  return names
}

async function stubSaveDialog(electronApp: ElectronApplication, filePath: string): Promise<void> {
  await electronApp.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: path })
  }, filePath)
}

test.describe('Round-1 observed session, by machine', () => {
  test('create, capture twice, read provenance, note, export, relaunch', async ({
    electronApp,
    page
  }) => {
    const exportDir = await mkdtemp(join(tmpdir(), 'birdbrain-round1-'))
    const bundlePath = join(exportDir, 'handoff.zip')
    const userData = await electronApp.evaluate(
      ({ app }) => process.env.BIRDBRAIN_USER_DATA || app.getPath('userData')
    )
    let relaunched: ElectronApplication | undefined

    try {
      // Step 1: start an investigation.
      const caseName = 'Round 1 session'
      const caseId = await createCase(page, caseName)
      await expect(page.getByRole('heading', { name: caseName })).toBeVisible()

      // Steps 2 and 3: two captures, and both land in the list.
      const first = await capturePage(
        page,
        caseId,
        'https://en.wikipedia.org/wiki/Open-source_intelligence',
        'Open-source intelligence'
      )
      await capturePage(
        page,
        caseId,
        'https://en.wikipedia.org/wiki/Web_archiving',
        'Web archiving'
      )
      await page.evaluate((id) => {
        window.location.hash = `/cases/${id}/captures`
      }, caseId)
      await expect(page.getByTestId('capture-item')).toHaveCount(2)

      // Step 4: open the first capture and read what Birdbrain claims about it.
      // The claim the tester is asked to put in their own words is the one the
      // verifier makes: the stored hash matches the bytes on disk.
      await page.getByText('Open-source intelligence').first().click()
      await expect(page.getByTestId('capture-details-aside')).toBeVisible()
      const verdict = await page.evaluate(async (id: string) => {
        const w = window as unknown as {
          birdbrain: {
            captures: {
              verify: (
                id: string
              ) => Promise<{ status: string; storedHash: string; computedHash: string }>
            }
          }
        }
        return w.birdbrain.captures.verify(id)
      }, first)
      expect(verdict.status).toBe('verified')
      expect(verdict.storedHash).toBe(verdict.computedHash)

      // Step 5: a note.
      await page.click('button[aria-label="Notes"]')
      await page.waitForURL(/#\/cases\/.+\/notes/)
      await page.getByTestId('notes-new-button').click()
      await page.getByTestId('create-note-title').fill('Session note')
      await page.getByTestId('create-note-body').fill('Both pages captured without incident')
      await page.getByTestId('create-note-submit').click()
      await expect(page.getByText('Session note')).toBeVisible()

      // Step 6: hand it to someone without Birdbrain. The default preset is the
      // full evidence bundle; what the recipient can check is the manifest, the
      // certification and the public key, so those are what must be inside.
      await page.click('button[aria-label="Overview"]')
      await page.waitForURL(/#\/cases\/.+\/overview/)
      await page.getByRole('button', { name: 'Export', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Export evidence report' }).click()
      await expect(page.getByRole('heading', { name: 'Export case' })).toBeVisible()
      await expect(page.getByRole('radio', { name: /Full evidence bundle/ })).toBeChecked()
      await stubSaveDialog(electronApp, bundlePath)
      await page.getByTestId('export-submit').click()
      await expect(page.getByText('Export complete')).toBeVisible({ timeout: 15000 })
      await page.getByRole('button', { name: 'Done' }).click()
      expect(existsSync(bundlePath)).toBe(true)
      const names = readStoredZipNames(bundlePath)
      for (const name of ['manifest.jsonl', 'certification.html', 'signing-public-key.pem']) {
        expect(names, `bundle should contain ${name}`).toContain(name)
      }

      // Step 7: quit and reopen. The same userData directory, a fresh process;
      // the case and both captures have to be there without the tester doing
      // anything to bring them back. Session restore returns the operator to the
      // case they were in, so the overview heading is what the tester sees first.
      await electronApp.close()
      relaunched = await _electron.launch({
        args: ['.', `--user-data-dir=${userData}`],
        cwd: join(__dirname, '..'),
        env: { ...process.env, BIRDBRAIN_USER_DATA: userData }
      })
      const again = await relaunched.firstWindow()
      await again.waitForLoadState('domcontentloaded')
      await again.waitForSelector('[data-testid="app-ready"]', { timeout: 15000 })
      await expect(again.getByRole('heading', { name: caseName })).toBeVisible()
      await again.evaluate((id) => {
        window.location.hash = `/cases/${id}/captures`
      }, caseId)
      await expect(again.getByTestId('capture-item')).toHaveCount(2)
    } finally {
      await relaunched?.close().catch(() => {})
      await rm(exportDir, { recursive: true, force: true })
    }
  })
})
