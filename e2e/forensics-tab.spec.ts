import { test, expect } from './fixtures/electronApp'

test.describe('Forensics tab', () => {
  test('renders chain sections for mhtml and legacy banner for html', async ({
    electronApp,
    page
  }) => {
    await page.evaluate(() => {
      window.location.hash = '/cases/new'
    })
    await page.waitForSelector('[data-testid="case-name-input"]', { timeout: 10000 })
    await page.fill('[data-testid="case-name-input"]', 'Forensics E2E')
    await page.click('[data-testid="case-create-btn"]')
    // Case creation lands on the Overview page, whose URL still carries the case id.
    await page.waitForURL(/#\/cases\/.+\/overview/, { timeout: 10000 })

    const caseIdMatch = page.url().match(/cases\/([^/]+)/)
    expect(caseIdMatch).toBeTruthy()
    const caseId = caseIdMatch![1]

    const serverToken = await page.evaluate(async () => {
      const r = await fetch('http://127.0.0.1:19845/api/status')
      const data = await r.json()
      return data.serverToken ?? ''
    })

    // Seed an MHTML capture with forensic fields.
    const upload = await page.evaluate(
      async ({ caseId, token }) => {
        const form = new FormData()
        form.append('source', 'manual')
        form.append('caseId', caseId)
        form.append('url', 'https://example.com/forensics-mhtml')
        form.append('title', 'Forensics MHTML')
        form.append('timestamp', new Date().toISOString())
        form.append('textContent', 'mhtml body')
        form.append('extensionVersion', '0.1.0')
        form.append('browserVersion', 'Chrome/120')
        form.append('userAgent', 'Mozilla/5.0')
        form.append(
          'mhtml',
          new Blob(['<html><body>mhtml</body></html>'], { type: 'multipart/related' }),
          'capture.mhtml'
        )
        const r = await fetch('http://127.0.0.1:19845/api/captures', {
          method: 'POST',
          body: form,
          headers: { 'X-Birdbrain-Token': token }
        })
        return r.json()
      },
      { caseId, token: serverToken }
    )
    expect(upload.status).toBe('ok')

    // Seed a legacy HTML capture directly. The Hono server only ingests MHTML,
    // so we insert a `format='html'` row via better-sqlite3 against the same
    // user-data DB. The renderer's first read of the capture list happens after
    // the navigate below, so React Query sees both rows on its initial fetch.
    await electronApp.evaluate(
      async ({ app }, { caseId }) => {
        // The evaluate callback runs in the main process global scope where
        // top-level `require` and dynamic import are unavailable. Build a
        // require via `process.getBuiltinModule('module').createRequire`,
        // anchored at the running electron binary so node_modules resolve.
        const proc = process as NodeJS.Process & {
          getBuiltinModule: (name: string) => unknown
        }
        const moduleApi = proc.getBuiltinModule('module') as {
          createRequire: (filename: string) => NodeRequire
        }
        const req = moduleApi.createRequire(process.execPath)
        const Database = req('better-sqlite3') as typeof import('better-sqlite3')
        const path = req('path') as typeof import('path')
        const userData = process.env.BIRDBRAIN_USER_DATA || app.getPath('userData')
        const db = new Database(path.join(userData, 'birdbrain.db'))
        try {
          const id = 'legacy-' + Math.random().toString(36).slice(2, 10)
          const now = new Date().toISOString()
          db.prepare(
            `INSERT INTO captures (
               id, case_id, url, title, html_path, screenshot_path, hash, timestamp, headers, created_at,
               format, mhtml_path, size_bytes, manifest_index, prev_hash, entry_hash,
               tool_version, extension_version, browser_version, user_agent, http_status,
               operator_id, operator_name
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(
            id,
            caseId,
            'https://example.com/forensics-html',
            'Legacy HTML',
            null,
            null,
            Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join(''),
            now,
            null,
            now,
            'html',
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null,
            null
          )
        } finally {
          db.close()
        }
      },
      { caseId }
    )

    const win = electronApp.windows()[0]
    await win.setViewportSize({ width: 1400, height: 900 })

    await page.evaluate((caseId) => {
      window.location.hash = `/cases/${caseId}/captures`
    }, caseId)

    await page.getByTestId('capture-item').first().waitFor({ timeout: 10000 })

    // MHTML path
    const mhtmlItem = page.getByTestId('capture-item').filter({ hasText: 'Forensics MHTML' })
    await mhtmlItem.click()
    await page.getByRole('button', { name: 'Forensics', exact: true }).click()

    await expect(page.getByText(/^Hash chain$/i)).toBeVisible()
    await expect(page.getByText(/^Identity$/i)).toBeVisible()
    await expect(page.getByText(/^Capture environment$/i)).toBeVisible()
    await expect(page.getByText(/^Headers$/i)).toHaveCount(0)
    await expect(page.getByTestId('forensics-reverify-btn')).toBeVisible()
    await expect(page.getByTestId('forensics-legacy-banner')).toHaveCount(0)
    await expect(page.getByTestId('forensics-chain-status-label')).toHaveText('Not verified')
    await expect(page.getByTestId('capture-details-provenance-label')).toHaveText('Not verified')
    await expect(page.getByTestId('capture-viewer-breadcrumb-provenance')).toHaveAttribute(
      'aria-label',
      'Not verified'
    )

    await page.getByTestId('forensics-reverify-btn').click()
    await expect(page.getByTestId('forensics-reverify-btn')).toBeEnabled({ timeout: 5000 })
    await expect(page.getByTestId('forensics-chain-status-label')).toHaveText('Verified')
    await expect(page.getByTestId('capture-details-provenance-label')).toHaveText('Verified')
    await expect(page.getByTestId('capture-viewer-breadcrumb-provenance')).toHaveAttribute(
      'aria-label',
      'Verified'
    )

    // Legacy path
    const legacyItem = page.getByTestId('capture-item').filter({ hasText: 'Legacy HTML' })
    await legacyItem.click()
    await page.getByRole('button', { name: 'Forensics', exact: true }).click()

    await expect(page.getByTestId('forensics-legacy-banner')).toBeVisible()
    await expect(page.getByText(/^Hash chain$/i)).toHaveCount(0)
    await expect(page.getByText(/^Identity$/i)).toBeVisible()
  })
})
