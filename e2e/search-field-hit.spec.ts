import { test, expect } from './fixtures/electronApp'

// Case search over mail headers (docs/plans/2026-10-09-case-retrieval-first-slice.md,
// D6 and D7): a header address found from the top bar opens the Capture's Text tab with
// the address marked, and the exact check finds it in the stored text. The page, person
// and addresses are invented.

const HEADER_TEXT = [
  'Show original',
  '',
  'Received: from relay.quillmere.example.net',
  'From: Wren Hollis <wren@Hollis-Mail.example.org>',
  'Message-ID: <a1@quillmere.example.net>',
  '',
  'The notice follows.'
].join('\n')

test.describe('Case search field hits', () => {
  test('opens a header hit in the Text tab with its span marked', async ({ page }) => {
    test.setTimeout(60000)

    await page.evaluate(() => {
      window.location.hash = '/cases/new?blank=true'
    })
    await page.waitForSelector('[data-testid="case-name-input"]', { timeout: 10000 })
    await page.fill('[data-testid="case-name-input"]', 'Header Search E2E')
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
      window.location.hash = `/cases/${id}/captures`
    }, caseId)

    const input = page.getByTestId('global-search-input')
    const group = page.getByTestId('global-search-field-group').filter({ hasText: 'From header' })
    // The records are built after the ingest returns, so search until they are there.
    await expect(async () => {
      await input.fill('')
      await input.fill('WREN@hollis-mail')
      await expect(group).toBeVisible({ timeout: 2000 })
    }).toPass({ timeout: 20000 })

    await group.getByRole('button').click()

    await expect(page.getByRole('tab', { name: 'Text', selected: true })).toBeVisible({
      timeout: 10000
    })
    await expect(page.getByTestId('capture-text-hit')).toHaveText(
      'Wren Hollis <wren@Hollis-Mail.example.org>'
    )

    // The exact check (D7) re-reads the stored files through the real verification. The
    // form upload sends line breaks as CRLF, so the offsets are not HEADER_TEXT's.
    await page.getByRole('button', { name: 'Check against the stored file' }).click()
    await expect(page.getByTestId('field-hit-check-answer')).toHaveText(
      /^Present\. The Extracted Text holds the text the search recorded at characters \d+ to \d+\. The text file matches the digest in the capture's signed record\.$/,
      { timeout: 10000 }
    )
  })
})
