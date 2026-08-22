import { test, expect } from './fixtures/electronApp'

type Page = import('@playwright/test').Page

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAIAAAD/gAIDAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAA4klEQVR4nO3QoQEA' +
  'AAiAMP9/Wl+QvmUSs7zNP8WswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzA' +
  'rMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCs' +
  'wKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKzA' +
  'rMCswKzArMCswKzArMCswKzArMCswKzArMCswKzArMCswKz9zzotw8GdFsEYhAAAAABJRU5ErkJggg=='

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

type MentionSpec = { targetType: 'capture' | 'selector' | 'tag' | 'note'; targetId: string }

/**
 * A note whose body document carries Mentions, written straight at the bridge.
 * Driving the editor's suggestion UI instead would couple this spec to a
 * different redesign ticket; the document shape is the contract either way.
 */
async function seedNoteWithMentions(
  page: Page,
  caseId: string,
  title: string,
  mentions: MentionSpec[]
): Promise<string> {
  return page.evaluate(
    async ({ caseId, title, mentions }) => {
      const bodyDoc = JSON.stringify({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: mentions.map((m) => ({
              type: 'mention',
              attrs: { targetType: m.targetType, targetId: m.targetId, label: m.targetId }
            }))
          }
        ]
      })
      const note = await (
        window as unknown as {
          birdbrain: { notes: { create: (p: object) => Promise<{ id: string }> } }
        }
      ).birdbrain.notes.create({ caseId, title, bodyDoc })
      return note.id
    },
    { caseId, title, mentions }
  )
}

async function seedSelector(page: Page, caseId: string, pattern: string): Promise<string> {
  return page.evaluate(
    async ({ caseId, pattern }) => {
      const selector = await (
        window as unknown as {
          birdbrain: { selectors: { create: (p: object) => Promise<{ id: string }> } }
        }
      ).birdbrain.selectors.create({ caseId, pattern, isRegex: false })
      return selector.id
    },
    { caseId, pattern }
  )
}

async function reloadToOverview(page: Page, caseId: string): Promise<void> {
  await page.reload()
  await page.waitForSelector('[data-testid="app-ready"]', { timeout: 15000 })
  await page.evaluate((id) => {
    window.location.hash = `/cases/${id}/overview`
  }, caseId)
  await expect(page.getByTestId('case-overview')).toBeVisible({ timeout: 10000 })
}

test.describe('Case Overview', () => {
  test('populated case shows metric counts and recent captures', async ({ page }) => {
    const caseId = await createCase(page, 'Overview Populated E2E')

    // Three captures across two distinct hostnames.
    await seedCapture(page, caseId, 'https://example.com/a', 'Alpha Capture')
    await seedCapture(page, caseId, 'https://example.com/b', 'Bravo Capture')
    await seedCapture(page, caseId, 'https://test.org/c', 'Charlie Capture')

    // Confirm the seeded captures landed (captures route), then return to Overview
    // so it remounts against the now-populated cache.
    await page.evaluate((id) => {
      window.location.hash = `/cases/${id}/captures`
    }, caseId)
    await expect(page.getByTestId('capture-item').first()).toBeVisible({ timeout: 10000 })

    await page.evaluate((id) => {
      window.location.hash = `/cases/${id}/overview`
    }, caseId)
    await expect(page.getByTestId('case-overview')).toBeVisible({ timeout: 10000 })

    await expect(page.getByTestId('overview-metric-captures')).toHaveText('3')
    await expect(page.getByTestId('overview-metric-sources')).toHaveText('2')

    await expect(page.getByTestId('overview-recent-captures')).toBeVisible()
    await expect(page.getByTestId('overview-recent-item')).toHaveCount(3)
  })

  test('empty case renders the overview without crashing', async ({ page }) => {
    await createCase(page, 'Overview Empty E2E')

    await expect(page.getByTestId('case-overview')).toBeVisible({ timeout: 10000 })
    // Zero-state metrics render as 0 — guards the divide-by-zero / empty-array paths.
    await expect(page.getByTestId('overview-metric-captures')).toHaveText('0')
    await expect(page.getByTestId('overview-metric-sources')).toHaveText('0')
    await expect(page.getByTestId('overview-recent-captures')).toHaveCount(0)
    // The map's own divide-by-zero: an empty case shows its empty state rather
    // than a lattice of NaN coordinates.
    await expect(page.getByTestId('overview-map-empty')).toHaveText('No notes in this case yet.')
    await expect(page.getByTestId('overview-map-node')).toHaveCount(0)
  })

  test('backlink map renders and filters on a seeded case', async ({ page }) => {
    const caseId = await createCase(page, 'Overview Map E2E')
    await seedCapture(page, caseId, 'https://example.com/a', 'Alpha Capture')
    const selectorId = await seedSelector(page, caseId, 'acme')
    const captureId = await page.evaluate(async (id) => {
      const list = await (
        window as unknown as {
          birdbrain: { captures: { list: (c: string) => Promise<{ id: string }[]> } }
        }
      ).birdbrain.captures.list(id)
      return list[0].id
    }, caseId)

    const first = await seedNoteWithMentions(page, caseId, 'Lead note', [
      { targetType: 'capture', targetId: captureId },
      { targetType: 'selector', targetId: selectorId }
    ])
    await seedNoteWithMentions(page, caseId, 'Follow-up note', [
      { targetType: 'note', targetId: first }
    ])

    await reloadToOverview(page, caseId)

    await expect(page.getByTestId('overview-link-map')).toBeVisible()
    // Two notes plus the capture and the selector they mention.
    await expect(page.getByTestId('overview-map-node')).toHaveCount(4)
    await expect(page.getByTestId('overview-map-count')).toHaveText('4 nodes · 1 backlinks')
    await expect(page.locator('[data-edge-kind="backlink"]')).toHaveCount(1)
    await expect(page.locator('[data-edge-kind="ref"]')).toHaveCount(2)

    // Ghost, do not hide the truth: the chip dims the capture node and leaves
    // the node count exactly where it was.
    await page.getByTestId('overview-map-legend-capture').click()
    await expect(page.getByTestId('overview-map-node')).toHaveCount(4)
    await expect(page.getByTestId('overview-map-count')).toHaveText('4 nodes · 1 backlinks')
    await expect(page.locator('[data-node-type="capture"]')).toHaveCSS('opacity', '0.12')
  })

  test('backlink map discloses the node ceiling', async ({ page }) => {
    const caseId = await createCase(page, 'Overview Map Cap E2E')
    // Tag Mentions accept any id, so the ceiling can be exercised without
    // seeding 30 real rows.
    await seedNoteWithMentions(
      page,
      caseId,
      'Busy note',
      Array.from({ length: 30 }, (_, i) => ({ targetType: 'tag' as const, targetId: `tag-${i}` }))
    )

    await reloadToOverview(page, caseId)

    await expect(page.getByTestId('overview-map-node')).toHaveCount(20)
    await expect(page.getByTestId('overview-map-count')).toHaveText(
      'showing 20 of 31 nodes · 0 backlinks'
    )
  })
})
