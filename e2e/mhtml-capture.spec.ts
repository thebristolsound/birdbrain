import { test, expect } from './fixtures/electronApp'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

// Smoke test that the MHTML capture + manifest path works end-to-end via the
// Hono server (bypasses the extension — the extension is tested separately).
test.describe('MHTML forensic capture', () => {
  test('capture is written, hashed, manifested, and verifies', async ({ electronApp, page }) => {
    // Create a case via the wizard
    await page.click('[data-testid="new-case-btn"]')
    await page.fill('[data-testid="case-name-input"]', 'MHTML E2E Test')
    await page.click('[data-testid="case-create-btn"]')
    await expect(page.getByRole('heading', { name: 'MHTML E2E Test' })).toBeVisible()

    // Get the case ID from the URL
    const url = page.url()
    const caseIdMatch = url.match(/cases\/([^/]+)/)
    expect(caseIdMatch).toBeTruthy()
    const caseId = caseIdMatch![1]

    // POST an MHTML capture to the Hono server
    const mhtmlContent = '<html><body>E2E MHTML test</body></html>'
    const uploadResult = await page.evaluate(
      async ({ caseId, content }) => {
        const form = new FormData()
        form.append('source', 'manual')
        form.append('caseId', caseId)
        form.append('url', 'https://example.com/e2e-mhtml')
        form.append('title', 'E2E MHTML Page')
        form.append('timestamp', new Date().toISOString())
        form.append('textContent', 'E2E MHTML test')
        form.append('extensionVersion', '0.1.0')
        form.append('browserVersion', 'Chrome/120')
        form.append('userAgent', 'Mozilla/5.0')
        form.append(
          'mhtml',
          new Blob([content], { type: 'multipart/related' }),
          'capture.mhtml'
        )
        const r = await fetch('http://127.0.0.1:19845/api/captures', {
          method: 'POST',
          body: form
        })
        return r.json()
      },
      { caseId, content: mhtmlContent }
    )

    expect(uploadResult.status).toBe('ok')
    expect(uploadResult.captureId).toBeDefined()
    expect(uploadResult.hash).toMatch(/^[0-9a-f]{64}$/)
    expect(uploadResult.manifestIndex).toBe(0)

    // Verify the capture via IPC
    const verify = await page.evaluate(async (captureId: string) => {
      const w = window as unknown as { birdbrain: { captures: { verify: (id: string) => Promise<{ status: string; storedHash: string; computedHash: string }> } } }
      return w.birdbrain.captures.verify(captureId)
    }, uploadResult.captureId)

    expect(verify.status).toBe('verified')
    expect(verify.storedHash).toBe(verify.computedHash)

    // Check manifest file exists on disk
    const userData = await electronApp.evaluate(({ app }) => app.getPath('userData'))
    const manifestPath = join(userData, 'captures', caseId, 'manifest.jsonl')
    expect(existsSync(manifestPath)).toBe(true)
    const lines = readFileSync(manifestPath, 'utf-8').trim().split('\n')
    expect(lines).toHaveLength(1)
    const entry = JSON.parse(lines[0])
    expect(entry.type).toBe('capture')
    expect(entry.index).toBe(0)
    expect(entry.prevHash).toBe('')

    // Mutate the MHTML file and verify tamper detection
    const mhtmlPath = join(userData, 'captures', caseId, uploadResult.captureId + '.mhtml')
    writeFileSync(mhtmlPath, 'mutated-content')

    const reverify = await page.evaluate(async (captureId: string) => {
      const w = window as unknown as { birdbrain: { captures: { verify: (id: string) => Promise<{ status: string }> } } }
      return w.birdbrain.captures.verify(captureId)
    }, uploadResult.captureId)

    expect(reverify.status).toBe('tampered')
  })
})
