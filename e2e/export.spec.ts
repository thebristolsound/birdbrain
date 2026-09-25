import { test, expect } from './fixtures/electronApp'
import { mkdtemp, rm } from 'fs/promises'
import { readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { CAPTURE_SERVER_BASE_URL } from '@shared/constants'

type Page = import('@playwright/test').Page
type ElectronApplication = import('@playwright/test').ElectronApplication

// Names of the entries in a Birdbrain stored ZIP (all entries STORE/method 0),
// mirroring the unit tests' reader — enough to prove what each class ships.
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
      const body = await r.json()
      return body.status === 'ok'
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

async function openExportDialog(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Export evidence report' }).click()
  await expect(page.getByRole('heading', { name: 'Export case' })).toBeVisible()
}

// A written export closes the dialog and names its path in a toast. The path is
// what tells this run's toast from the previous run's, still on screen. The
// dialog animates out, so wait for it to be gone before the next one opens.
async function runExport(page: Page, filePath: string): Promise<void> {
  await page.getByTestId('export-submit').click()
  await expect(page.getByText(`· ${filePath}`)).toBeVisible({ timeout: 15000 })
  await expect(page.getByRole('heading', { name: /^Export(ing)? case$/ })).toHaveCount(0)
}

// #399 AC 6: preset selection and both export classes' outputs, proven on the
// actual zips each preset writes.
test.describe('Export dialog: presets and the two export classes', () => {
  test('the three presets export the outputs their classes define', async ({
    electronApp,
    page
  }) => {
    const tempDir = await mkdtemp(join(tmpdir(), 'birdbrain-export-'))
    const fullPath = join(tempDir, 'full.zip')
    const courtPath = join(tempDir, 'court.zip')
    const workingPath = join(tempDir, 'working.zip')

    try {
      const caseId = await createCase(page, 'Two Classes Case')
      await seedCapture(page, caseId, 'https://example.com/one', 'Class Capture')

      // A note, so the Notes toggle has real content to include or exclude.
      await page.click('button[aria-label="Notes"]')
      await page.waitForURL(/#\/cases\/.+\/notes/)
      await page.getByTestId('notes-new-button').click()
      await page.getByTestId('note-title-input').fill('Export class note')
      await page.getByTestId('note-body-input').fill('Note body for the export class spec')
      await page.getByTestId('note-body-input').blur()
      await expect(page.getByRole('status').filter({ hasText: 'Saved just now' })).toBeVisible()
      await expect(page.getByText('Export class note')).toBeVisible()

      await page.click('button[aria-label="Overview"]')
      await page.waitForURL(/#\/cases\/.+\/overview/)

      // --- Full evidence bundle (default preset) --------------------------
      await openExportDialog(page)
      await expect(page.getByRole('radio', { name: /Full evidence bundle/ })).toBeChecked()
      await expect(page.getByTestId('export-custody-card')).toBeVisible()
      await stubSaveDialog(electronApp, fullPath)
      await runExport(page, fullPath)

      const fullNames = readStoredZipNames(fullPath)
      for (const name of [
        'manifest.jsonl',
        'certification.html',
        'evidence.json',
        'export-entry.json',
        'signing-public-key.pem',
        'notes.md'
      ]) {
        expect(fullNames, `full bundle should contain ${name}`).toContain(name)
      }
      expect(fullNames).not.toContain('WORKING-COPY.json')

      // --- Court exhibit: evidence class without notes --------------------
      await openExportDialog(page)
      await page.getByRole('radio', { name: /Court exhibit/ }).check()
      await expect(page.getByTestId('export-custody-card')).toBeVisible()
      await stubSaveDialog(electronApp, courtPath)
      await runExport(page, courtPath)

      const courtNames = readStoredZipNames(courtPath)
      expect(courtNames).toContain('manifest.jsonl')
      expect(courtNames).toContain('certification.html')
      expect(courtNames).not.toContain('notes.md')
      expect(courtNames).not.toContain('WORKING-COPY.json')

      // --- Working copy: non-evidentiary class ----------------------------
      await openExportDialog(page)
      await page.getByRole('radio', { name: /Working copy/ }).check()
      // The custody card gives way to the non-evidentiary notice.
      await expect(page.getByTestId('export-working-copy-notice')).toBeVisible()
      await expect(page.getByTestId('export-custody-card')).not.toBeVisible()
      await stubSaveDialog(electronApp, workingPath)
      await runExport(page, workingPath)

      const workingNames = readStoredZipNames(workingPath)
      expect(workingNames).toContain('WORKING-COPY.json')
      expect(workingNames).toContain('notes.md')
      for (const name of [
        'manifest.jsonl',
        'certification.html',
        'evidence.json',
        'export-entry.json',
        'signing-public-key.pem',
        'report.html'
      ]) {
        expect(workingNames, `working copy must not contain ${name}`).not.toContain(name)
      }
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }
  })
})
