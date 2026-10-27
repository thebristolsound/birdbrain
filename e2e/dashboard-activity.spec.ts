import { test, expect } from './fixtures/electronApp'
import { seedTitledCapture } from './fixtures/seed'

type Page = import('@playwright/test').Page

// The dashboard is no longer gated behind a first-run wizard (#404): the fixture
// seeds a settings.json, so the app launches as an existing install, is never
// toured, and the caseless dashboard — the no-feed state under test — is
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
  test('first run has no feed, and the feed appears once a case exists', async ({ page }) => {
    await openCaselessDashboard(page)

    await expect(page.getByTestId('recent-activity-feed')).toHaveCount(0)

    const caseId = await createCase(page, 'Activity Feed E2E')
    await goDashboard(page)

    // A case with no captures or notes yet: the feed's empty state.
    await expect(page.getByTestId('recent-activity-feed')).toBeVisible()
    await expect(page.getByTestId('recent-activity-empty')).toBeVisible()

    await seedTitledCapture(page, caseId, 'https://example.com/login', 'Alpha Capture')
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
    await seedTitledCapture(page, caseId, 'https://example.com/login', 'Bravo Capture')
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
    const card = page.getByTestId(`note-row-${noteId}`)
    await expect(card).toBeVisible({ timeout: 10000 })
    await expect(card).toHaveAttribute('aria-current', 'true')
  })
})
