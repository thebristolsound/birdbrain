import { test, expect } from './fixtures/electronApp'
import { mkdtemp, rm } from 'fs/promises'
import { readFileSync, statSync } from 'fs'
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
    window.location.hash = '/cases/new?blank=true'
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

// The dialog is named for what it exports, in both of its phases.
const exportDialog = (page: Page) => page.getByRole('dialog', { name: /^Export / })

// The Case menu has one export item, which opens the dialog for the Case on screen.
async function openExportDialog(page: Page, caseName: string): Promise<void> {
  await page.getByTestId('topbar-case-name').click()
  await page.getByRole('menuitem', { name: 'Export…', exact: true }).click()
  await expect(page.getByRole('heading', { name: `Export ${caseName}`, exact: true })).toBeVisible()
}

// A written export closes the dialog and names its path in a toast. The path is
// what tells this run's toast from the previous run's, still on screen. The
// dialog animates out, so wait for it to be gone before the next one opens.
async function runExport(page: Page, filePath: string): Promise<void> {
  await page.getByTestId('export-submit').click()
  await expect(page.getByText(`· ${filePath}`)).toBeVisible({ timeout: 15000 })
  await expect(exportDialog(page)).toHaveCount(0)
}

// #399 AC 6: every choice's output, read from the file each one writes. This shows the path
// works for each choice; the bytes are pinned by the known-answer unit test.
test.describe('Export dialog: the choices and what each one writes', () => {
  test('each choice exports the output it names', async ({ electronApp, page }) => {
    const tempDir = await mkdtemp(join(tmpdir(), 'birdbrain-export-'))
    const fullPath = join(tempDir, 'full.zip')
    const withoutNotesPath = join(tempDir, 'without-notes.zip')
    const workingPath = join(tempDir, 'working.zip')
    const archivePath = join(tempDir, 'two-classes.birdbrain')
    const evidence = page.getByRole('radio', { name: /^Evidence Package/ })
    const leaveOutNotes = page.getByRole('checkbox', { name: 'Leave out Operator notes' })

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

      // --- Evidence Package, the choice the dialog opens on ----------------
      await openExportDialog(page, 'Two Classes Case')
      await expect(evidence).toBeChecked()
      // Each choice shows its file type before Export is pressed.
      await expect(page.getByRole('radiogroup', { name: 'Export as' })).toContainText(
        /Evidence Package\s*\.zip.*Working Copy\s*\.zip.*Case Archive\s*\.birdbrain/s
      )
      await expect(leaveOutNotes).not.toBeChecked()
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
        expect(fullNames, `Evidence Package should contain ${name}`).toContain(name)
      }
      expect(fullNames).not.toContain('WORKING-COPY.json')

      // --- Evidence Package without Operator notes ------------------------
      await openExportDialog(page, 'Two Classes Case')
      await leaveOutNotes.check()
      await expect(evidence).toBeChecked()
      await stubSaveDialog(electronApp, withoutNotesPath)
      await runExport(page, withoutNotesPath)

      const withoutNotesNames = readStoredZipNames(withoutNotesPath)
      expect(withoutNotesNames).toContain('manifest.jsonl')
      expect(withoutNotesNames).toContain('certification.html')
      expect(withoutNotesNames).not.toContain('notes.md')
      expect(withoutNotesNames).not.toContain('WORKING-COPY.json')

      // --- Working Copy: non-evidentiary class ----------------------------
      await openExportDialog(page, 'Two Classes Case')
      await page.getByRole('radio', { name: /^Working Copy/ }).check()
      // The Evidence Package's own checkbox goes with its choice.
      await expect(leaveOutNotes).toHaveCount(0)
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

      // --- Case Archive: the whole Case, through the same dialog ----------
      await openExportDialog(page, 'Two Classes Case')
      await page.getByRole('radio', { name: /^Case Archive/ }).check()
      // Nothing that shapes a zip applies to an archive.
      await expect(page.getByRole('button', { name: 'Customise contents' })).toHaveCount(0)
      await expect(page.getByPlaceholder(/Disclosure under/)).toHaveCount(0)
      await stubSaveDialog(electronApp, archivePath)
      await page.getByTestId('export-submit').click()
      await expect(page.getByText('Case Archive saved')).toBeVisible({ timeout: 15000 })
      await expect(exportDialog(page)).toHaveCount(0)
      expect(statSync(archivePath).size).toBeGreaterThan(0)
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }
  })

  // The form scrolls between a fixed heading and a fixed footer, so the primary action needs
  // no scroll, whatever the form holds.
  test('Export is in view at 1440 by 900 when the dialog opens', async ({ electronApp, page }) => {
    // The window's own size: `page.setViewportSize` emulates one instead.
    const resize = async (width: number, height: number): Promise<void> => {
      await electronApp.evaluate(
        ({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setContentSize(w, h),
        [width, height]
      )
      await expect
        .poll(() => page.evaluate(() => [innerWidth, innerHeight]))
        .toEqual([width, height])
    }
    await resize(1440, 900)
    const caseId = await createCase(page, 'Footer In View Case')
    await seedCapture(page, caseId, 'https://example.com/footer', 'Footer Capture')

    await openExportDialog(page, 'Footer In View Case')

    const submit = page.getByTestId('export-submit')
    const form = page.getByTestId('export-form-scroll')
    await expect(submit).toBeInViewport({ ratio: 1 })
    expect(await form.evaluate((el) => el.scrollTop)).toBe(0)

    // A short window with the checklist open makes the form taller than the dialog: the form
    // takes the overflow and the button keeps its place.
    await page.getByRole('button', { name: 'Customise contents' }).click()
    await resize(1440, 640)
    await expect.poll(() => form.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)
    await expect(submit).toBeInViewport({ ratio: 1 })
  })

  // Real key handling, which jsdom does not model: an arrow key on a native
  // radio checks the next one, so focus must not open on the choices.
  test('an arrow key on open leaves the export on the Evidence Package', async ({ page }) => {
    const caseId = await createCase(page, 'Arrow Key Case')
    await seedCapture(page, caseId, 'https://example.com/arrow', 'Arrow Capture')

    await openExportDialog(page, 'Arrow Key Case')
    await expect(exportDialog(page)).toBeFocused()
    await page.keyboard.press('ArrowDown')

    await expect(page.getByRole('radio', { name: /^Evidence Package/ })).toBeChecked()
    await expect(page.getByRole('radio', { name: /^Working Copy/ })).not.toBeChecked()
  })
})
