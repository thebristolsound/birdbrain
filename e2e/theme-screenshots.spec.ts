import { test } from './fixtures/electronApp'

type Page = import('@playwright/test').Page

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAIAAAD/gAIDAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAA4klEQVR4nO3QoQEA' +
  'AAiAMP9/Wl+QvmUSs7zNP8WswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzA' +
  'rMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCs' +
  'wKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzA' +
  'rMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKz9zzotw8GdFsEYhAAAAABJRU5ErkJggg=='

async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.evaluate((t) => {
    localStorage.setItem('theme', t)
    document.documentElement.classList.toggle('dark', t === 'dark')
  }, theme)
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
    async ({ caseId, url, title, png }) => {
      const statusResponse = await fetch('http://127.0.0.1:19845/api/status')
      const status = await statusResponse.json()
      const token: string = status.serverToken ?? ''
      const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0))
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
      form.append('screenshot', new Blob([bytes], { type: 'image/png' }), 'shot.png')
      const r = await fetch('http://127.0.0.1:19845/api/captures', {
        method: 'POST',
        body: form,
        headers: { 'X-Birdbrain-Token': token }
      })
      const body = await r.json()
      return body.status === 'ok'
    },
    { caseId, url, title, png: PNG_BASE64 }
  )
  if (!ok) throw new Error(`capture upload failed for ${title}`)
}

test.describe('theme screenshots', () => {
  test('dashboard + case overview in both themes', async ({ page }) => {
    // Dashboard screenshots
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme)
      await page.waitForTimeout(150)
      await page.screenshot({ path: `test-results/theme-dashboard-${theme}.png`, fullPage: true })
    }

    // Seed a case with captures across two hostnames (mirrors case-overview.spec.ts)
    const caseId = await createCase(page, 'Theme Screenshot E2E')

    await seedCapture(page, caseId, 'https://example.com/a', 'Alpha Capture')
    await seedCapture(page, caseId, 'https://example.com/b', 'Bravo Capture')
    await seedCapture(page, caseId, 'https://test.org/c', 'Charlie Capture')

    // Confirm captures landed, then navigate to overview so SourcesBlock renders
    await page.evaluate((id) => {
      window.location.hash = `/cases/${id}/captures`
    }, caseId)
    await page.waitForSelector('[data-testid="capture-item"]', { timeout: 10000 })

    await page.evaluate((id) => {
      window.location.hash = `/cases/${id}/overview`
    }, caseId)
    await page.waitForSelector('[data-testid="case-overview"]', { timeout: 10000 })

    // CaseOverview screenshots in both themes
    for (const theme of ['light', 'dark'] as const) {
      await setTheme(page, theme)
      await page.waitForTimeout(150)
      await page.screenshot({ path: `test-results/theme-overview-${theme}.png`, fullPage: true })
    }
  })
})
