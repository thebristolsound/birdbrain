import { test, expect } from './fixtures/electronApp'

type Page = import('@playwright/test').Page

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAIAAAD/gAIDAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAA4klEQVR4nO3QoQEA' +
  'AAiAMP9/Wl+QvmUSs7zNP8WswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzA' +
  'rMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCs' +
  'wKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzA' +
  'rMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKz9zzotw8GdFsEYhAAAAABJRU5ErkJggg=='

// The dashboard is no longer gated behind a first-run wizard (#404): the fixture
// seeds a settings.json, so the app launches as an existing install, is never
// toured, and the caseless dashboard — the Quick Start state under test — is
// reachable straight from a reload.
async function openCaselessDashboard(page: Page): Promise<void> {
  await reloadToDashboard(page)
}

// Retried: a hash assignment that lands while the router is still settling a
// previous navigation is silently dropped, which showed up as a flake rather
// than a failure.
async function goDashboard(page: Page): Promise<void> {
  await expect(async () => {
    await page.evaluate(() => {
      window.location.hash = '/'
    })
    await expect(page.getByTestId('dashboard')).toBeVisible({ timeout: 3000 })
  }).toPass({ timeout: 20000 })
}

// Seeding goes straight at the capture server and the IPC bridge, so it writes
// rows the renderer's React Query cache knows nothing about. A reload is what
// makes the assertions describe a fresh visit rather than a stale cache.
async function reloadToDashboard(page: Page): Promise<void> {
  await page.reload()
  await page.waitForSelector('[data-testid="app-ready"]', { timeout: 15000 })
  await goDashboard(page)
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
      const status = await fetch('http://127.0.0.1:19845/api/status').then((r) => r.json())
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

async function seedNote(page: Page, caseId: string, title: string): Promise<string> {
  return page.evaluate(
    async ({ caseId, title }) => {
      const note = await (
        window as unknown as {
          birdbrain: {
            notes: { create: (p: object) => Promise<{ id: string }> }
          }
        }
      ).birdbrain.notes.create({ caseId, title, body: `${title} body` })
      return note.id
    },
    { caseId, title }
  )
}

test.describe('Dashboard recent activity', () => {
  test('first run keeps Quick Start, and the feed replaces it once a case exists', async ({
    page
  }) => {
    await openCaselessDashboard(page)

    // No cases yet: the walkthrough, not the feed.
    await expect(page.getByRole('heading', { name: 'Quick Start' })).toBeVisible()
    await expect(page.getByTestId('recent-activity-feed')).toHaveCount(0)

    const caseId = await createCase(page, 'Activity Feed E2E')
    await goDashboard(page)

    // A case with no captures or notes yet: the feed's empty state, not Quick Start.
    await expect(page.getByTestId('recent-activity-feed')).toBeVisible()
    await expect(page.getByTestId('recent-activity-empty')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Quick Start' })).toHaveCount(0)

    await seedCapture(page, caseId, 'https://example.com/login', 'Alpha Capture')
    await seedNote(page, caseId, 'Kit fingerprint')
    await reloadToDashboard(page)

    const rows = page.getByTestId('recent-activity-row')
    await expect(rows).toHaveCount(2)
    await expect(rows.first()).toContainText('Edited note — Kit fingerprint')
    await expect(rows.nth(1)).toContainText('Captured Alpha Capture')
    await expect(rows.first()).toContainText('Activity Feed E2E')
  })

  test('a capture row opens that capture in its case', async ({ page }) => {
    await openCaselessDashboard(page)
    const caseId = await createCase(page, 'Capture Row E2E')
    await seedCapture(page, caseId, 'https://example.com/login', 'Bravo Capture')
    await reloadToDashboard(page)

    await page.getByTestId('recent-activity-row').first().click()

    await page.waitForURL(/#\/cases\/.+\/captures/, { timeout: 10000 })
    expect(page.url()).toContain(`/cases/${caseId}/captures`)
    // The viewer only mounts for a selected capture, so its title is the proof
    // the row selected the capture rather than merely changing route.
    await expect(page.getByText('Bravo Capture').first()).toBeVisible({ timeout: 10000 })
  })

  test('a note row opens Notes with that note selected', async ({ page }) => {
    await openCaselessDashboard(page)
    const caseId = await createCase(page, 'Note Row E2E')
    const noteId = await seedNote(page, caseId, 'Operator timezone')
    await reloadToDashboard(page)

    await page.getByTestId('recent-activity-row').first().click()

    await page.waitForURL(/#\/cases\/.+\/notes/, { timeout: 10000 })
    expect(page.url()).toContain(`/cases/${caseId}/notes`)
    const card = page.getByTestId(`note-card-${noteId}`)
    await expect(card).toBeVisible({ timeout: 10000 })
    await expect(card).toHaveAttribute('aria-current', 'true')
  })
})
