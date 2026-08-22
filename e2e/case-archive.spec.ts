import { test, expect } from './fixtures/electronApp'
import { mkdtemp, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { CAPTURE_SERVER_BASE_URL } from '@shared/constants'

type Page = import('@playwright/test').Page
type ElectronApplication = import('@playwright/test').ElectronApplication

async function createCase(page: Page, name: string): Promise<string> {
  await page.evaluate(() => {
    window.location.hash = '/cases/new'
  })
  await page.waitForSelector('[data-testid="case-name-input"]', { timeout: 10000 })
  await page.fill('[data-testid="case-name-input"]', name)
  await page.click('[data-testid="case-create-btn"]')
  // A freshly created case lands on its Overview page.
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

// Stubs Electron's native save/open dialogs for the life of the Electron app —
// Playwright cannot drive OS file pickers, so the main process's `dialog`
// module is replaced directly per the documented ElectronApplication.evaluate
// pattern (see Playwright docs: "Mocking native dialogs").
async function stubSaveDialog(electronApp: ElectronApplication, filePath: string): Promise<void> {
  await electronApp.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = () => Promise.resolve({ canceled: false, filePath: path })
  }, filePath)
}

async function stubOpenDialog(electronApp: ElectronApplication, filePath: string): Promise<void> {
  await electronApp.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [path] })
  }, filePath)
}

test.describe('Case archive export/import round-trip', () => {
  test('exports a case to .birdbrain and imports it as a new case', async ({
    electronApp,
    page
  }) => {
    const tempDir = await mkdtemp(join(tmpdir(), 'birdbrain-archive-'))
    const archivePath = join(tempDir, 'roundtrip.birdbrain')

    try {
      // Seed a case with a capture, a note, a tag and an auto-capture exclusion
      // so the archive round-trip exercises more than just the empty-case path.
      const caseId = await createCase(page, 'Archive Roundtrip Case')
      await seedCapture(page, caseId, 'https://example.com/roundtrip', 'Roundtrip Capture')

      await page.click('button[aria-label="Notes"]')
      await page.waitForURL(/#\/cases\/.+\/notes/)
      await page.getByTestId('notes-new-button').click()
      await page.getByTestId('create-note-title').fill('Roundtrip note')
      await page.getByTestId('create-note-body').fill('Note body for archive round-trip')
      await page.getByTestId('create-note-submit').click()
      await expect(page.getByText('Roundtrip note')).toBeVisible()

      await page.click('button[aria-label="Signals"]')
      await page.waitForURL(/#\/cases\/.+\/signals/)
      const tagInput = page.getByTestId('add-tag-input')
      await tagInput.fill('roundtrip-tag')
      await tagInput.press('Enter')
      await expect(page.getByTestId('signals-tag-list')).toContainText('roundtrip-tag')

      // And a per-case auto-capture exclusion (#400), so the round-trip covers
      // the two columns migration v30 adds to the case row. An exclusion that
      // did not survive export would let a re-imported case capture pages the
      // operator had excluded, with nothing on screen to say the rule was lost.
      await page.getByTestId('exclusions-summary').click()
      const exclusionInput = page.getByTestId('exclusion-input')
      await exclusionInput.fill('*.roundtrip-excluded.test')
      await exclusionInput.press('Enter')
      await expect(page.getByTestId('exclusion-chip')).toContainText('*.roundtrip-excluded.test')
      await page.getByRole('radio', { name: 'Override global' }).click()
      await expect(page.getByTestId('exclusions-summary')).toContainText(
        '1 exclusion · overrides global'
      )

      // Back to Overview, where the export button lives.
      await page.click('button[aria-label="Overview"]')
      await page.waitForURL(/#\/cases\/.+\/overview/)

      await stubSaveDialog(electronApp, archivePath)
      await page.getByRole('button', { name: 'Export' }).click()
      await page.getByRole('menuitem', { name: 'Export case file' }).click()
      await expect(page.getByText('Archive saved')).toBeVisible({ timeout: 15000 })

      // Navigate to the dashboard to trigger the import flow.
      await page.evaluate(() => {
        window.location.hash = '/'
      })
      await expect(page.locator('[data-testid="dashboard"]')).toBeVisible()

      await stubOpenDialog(electronApp, archivePath)
      await page.getByTestId('import-case-btn').click()

      // The import dialog shows the verification report before committing.
      await expect(page.getByText('Import Case Archive')).toBeVisible({ timeout: 10000 })
      await expect(page.getByText('Archive verified')).toBeVisible()
      await expect(
        page.getByRole('paragraph').filter({ hasText: 'Archive Roundtrip Case' })
      ).toBeVisible()

      await page.getByRole('button', { name: 'Import case', exact: true }).click()

      // Navigation lands on the newly created case (a different id than the source).
      await page.waitForURL(/#\/cases\/.+\/overview/, { timeout: 15000 })
      const newCaseIdMatch = page.url().match(/cases\/([^/]+)/)
      expect(newCaseIdMatch).toBeTruthy()
      const newCaseId = newCaseIdMatch![1]
      expect(newCaseId).not.toBe(caseId)
      await expect(page.getByRole('heading', { name: 'Archive Roundtrip Case' })).toBeVisible()

      // The imported case carries over its capture, note, tag and exclusions.
      await page.click('button[aria-label="Captures"]')
      await page.waitForURL(/#\/cases\/.+\/captures/)
      await expect(page.getByTestId('capture-item').first()).toBeVisible({ timeout: 10000 })
      await expect(page.getByText('Roundtrip Capture')).toBeVisible()

      await page.click('button[aria-label="Notes"]')
      await page.waitForURL(/#\/cases\/.+\/notes/)
      await expect(page.getByText('Roundtrip note')).toBeVisible()

      await page.click('button[aria-label="Signals"]')
      await page.waitForURL(/#\/cases\/.+\/signals/)
      await expect(page.getByTestId('signals-tag-list')).toContainText('roundtrip-tag')

      // The exclusion list and its mode survived the round-trip, so the
      // imported case enforces the policy it was exported under.
      await expect(page.getByTestId('exclusions-summary')).toContainText(
        '1 exclusion · overrides global'
      )
      await page.getByTestId('exclusions-summary').click()
      await expect(page.getByTestId('exclusion-chip')).toContainText('*.roundtrip-excluded.test')

      // Dashboard now lists both the source case and the imported one.
      await page.evaluate(() => {
        window.location.hash = '/'
      })
      await expect(page.locator('[data-testid="dashboard"]')).toBeVisible()
      await expect(page.getByTestId('case-card')).toHaveCount(2)
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }
  })
})
