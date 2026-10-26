import { test, expect } from './fixtures/electronApp'

// The unreviewed view (docs/plans/2026-10-09-case-retrieval-first-slice.md, D8): a Capture
// no note names, listed under its From address on the Data screen, opens in the Text tab
// with the address marked, as a search hit opens. The page, person and addresses are
// invented.

const HEADER_TEXT = [
  'Show original',
  '',
  'Received: from relay.quillmere.example.net',
  'From: Wren Hollis <wren@Hollis-Mail.example.org>',
  'Message-ID: <a1@quillmere.example.net>',
  '',
  'The notice follows.'
].join('\n')

test.describe('Unreviewed captures', () => {
  test('opens a Capture listed under its From address at that header', async ({ page }) => {
    test.setTimeout(60000)

    await page.evaluate(() => {
      window.location.hash = '/cases/new?blank=true'
    })
    await page.waitForSelector('[data-testid="case-name-input"]', { timeout: 10000 })
    await page.fill('[data-testid="case-name-input"]', 'Unreviewed View E2E')
    await page.click('[data-testid="case-create-btn"]')
    await page.waitForURL(/#\/cases\/.+\/overview/, { timeout: 10000 })
    const caseId = page.url().match(/cases\/([^/]+)/)![1]

    const result = await page.evaluate(
      async ({ caseId, text }) => {
        const status = await fetch('http://127.0.0.1:19845/api/status')
        const token = (await status.json()).serverToken ?? ''
        const form = new FormData()
        form.append('source', 'manual')
        form.append('caseId', caseId)
        form.append('url', 'https://quillmere.example.net/original/14')
        form.append('title', 'Quillmere original message')
        form.append('timestamp', new Date().toISOString())
        form.append('textContent', text)
        form.append('extensionVersion', '0.1.0')
        form.append('browserVersion', 'Chrome/120')
        form.append('userAgent', 'Mozilla/5.0')
        form.append(
          'mhtml',
          new Blob(['<html><body>original</body></html>'], { type: 'multipart/related' }),
          'capture.mhtml'
        )
        const r = await fetch('http://127.0.0.1:19845/api/captures', {
          method: 'POST',
          body: form,
          headers: { 'X-Birdbrain-Token': token }
        })
        return r.json()
      },
      { caseId, text: HEADER_TEXT }
    )
    expect(result.status).toBe('ok')
    await page.evaluate((id) => {
      window.location.hash = `/cases/${id}/data`
    }, caseId)

    const pickNode = (key: string) =>
      page.getByTestId(`data-tree-node-${key}`).locator('button').last().click()
    const address = page
      .getByTestId('unreviewed-row-key')
      .filter({ hasText: 'wren@hollis-mail.example.org' })
    // The records are built after the ingest returns, and the view reads each time it
    // opens, so open it until the address is listed.
    await expect(async () => {
      await pickNode('views')
      await pickNode('unreviewed')
      await expect(address).toBeVisible({ timeout: 2000 })
    }).toPass({ timeout: 20000 })

    await address.click()
    await page.locator('[data-testid^="unreviewed-capture-"]').first().click()

    await expect(page.getByRole('tab', { name: 'Text', selected: true })).toBeVisible({
      timeout: 10000
    })
    await expect(page.getByTestId('capture-text-hit')).toHaveText(
      'Wren Hollis <wren@Hollis-Mail.example.org>'
    )
    // The exact check sits beside the opened hit, as for a search hit.
    await expect(page.getByRole('button', { name: 'Check against the stored file' })).toBeVisible()
  })
})
