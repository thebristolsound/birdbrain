import { test, expect } from './fixtures/electronApp'

type Page = import('@playwright/test').Page

// The three-column Captures rework (#397): the tab set, the drag-resizable
// columns and their bounds, the 40px rails, and the Wayback tab's own layout
// (compare panes plus the archive.org slide-out, #401).

async function seedCapture(page: Page, caseId: string, token: string, slug: string) {
  const result = await page.evaluate(
    async ({ caseId, token, slug }) => {
      const form = new FormData()
      form.append('source', 'manual')
      form.append('caseId', caseId)
      form.append('url', `https://example.com/${slug}`)
      form.append('title', `Layout ${slug}`)
      form.append('timestamp', new Date().toISOString())
      form.append('textContent', `layout ${slug}`)
      form.append('extensionVersion', '0.1.0')
      form.append('browserVersion', 'Chrome/120')
      form.append('userAgent', 'Mozilla/5.0')
      form.append(
        'mhtml',
        new Blob([`<html><body>${slug}</body></html>`], { type: 'multipart/related' }),
        'capture.mhtml'
      )
      const r = await fetch('http://127.0.0.1:19845/api/captures', {
        method: 'POST',
        body: form,
        headers: { 'X-Birdbrain-Token': token }
      })
      return r.json()
    },
    { caseId, token, slug }
  )
  expect(result.status).toBe('ok')
}

async function widthOf(page: Page, testId: string): Promise<number> {
  const box = await page.getByTestId(testId).boundingBox()
  expect(box).not.toBeNull()
  return box!.width
}

// Drags the separator by `dx` from its own centre.
async function dragSeparator(page: Page, index: number, dx: number) {
  const separator = page.getByRole('separator').nth(index)
  const box = (await separator.boundingBox())!
  const y = box.y + box.height / 2
  await page.mouse.move(box.x + box.width / 2, y)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + dx, y, { steps: 12 })
  await page.mouse.up()
}

test.describe('Captures three-column layout', () => {
  test('resizes, collapses and re-tabs the columns', async ({ electronApp, page }) => {
    test.setTimeout(120000)

    await page.evaluate(() => {
      window.location.hash = '/cases/new'
    })
    await page.waitForSelector('[data-testid="case-name-input"]', { timeout: 10000 })
    await page.fill('[data-testid="case-name-input"]', 'Layout E2E')
    await page.click('[data-testid="case-create-btn"]')
    await page.waitForURL(/#\/cases\/.+\/overview/, { timeout: 10000 })
    const caseId = page.url().match(/cases\/([^/]+)/)![1]

    const token = await page.evaluate(async () => {
      const r = await fetch('http://127.0.0.1:19845/api/status')
      return (await r.json()).serverToken ?? ''
    })
    for (const slug of ['alpha', 'bravo']) {
      await seedCapture(page, caseId, token, slug)
    }

    await electronApp.windows()[0].setViewportSize({ width: 1400, height: 900 })
    await page.evaluate((id) => {
      window.location.hash = `/cases/${id}/captures`
    }, caseId)

    const rows = page.getByTestId('capture-item')
    await expect(rows).toHaveCount(2, { timeout: 15000 })
    await rows.first().click()
    await expect(page.getByTestId('capture-details-aside')).toBeVisible()

    // 1. Tab set: exactly Screenshot / Page / Text / Links / Wayback, and no Source.
    await expect(page.getByRole('tab')).toHaveCount(5)
    for (const name of ['Screenshot', 'Page', 'Text', 'Links', 'Wayback']) {
      await expect(page.getByRole('tab', { name, exact: true })).toBeVisible()
    }
    await expect(page.getByRole('tab', { name: 'Source' })).toHaveCount(0)

    // 2. Both columns are drag-resizable, and both clamp at their bounds.
    const listStart = await widthOf(page, 'capture-list')
    expect(listStart).toBeGreaterThan(280)
    expect(listStart).toBeLessThan(360)

    await dragSeparator(page, 0, 60)
    const listWider = await widthOf(page, 'capture-list')
    expect(listWider).toBeGreaterThan(listStart + 30)

    await dragSeparator(page, 0, 600)
    expect(await widthOf(page, 'capture-list')).toBeLessThanOrEqual(561)

    await dragSeparator(page, 0, -900)
    expect(await widthOf(page, 'capture-list')).toBeGreaterThanOrEqual(239)

    const detailsStart = await widthOf(page, 'capture-details')
    await dragSeparator(page, 1, 600)
    expect(await widthOf(page, 'capture-details')).toBeLessThan(detailsStart)
    expect(await widthOf(page, 'capture-details')).toBeGreaterThanOrEqual(319)

    // 3. The list collapses to a 40px rail and comes back.
    await page.getByTestId('capture-list-collapse').click()
    const rail = page.getByTestId('capture-list-rail')
    await expect(rail).toBeVisible()
    expect((await rail.boundingBox())!.width).toBe(40)
    await expect(rows).toHaveCount(0)

    await page.getByTestId('capture-list-rail-expand').click()
    await expect(rows).toHaveCount(2)
    await expect(rail).toHaveCount(0)

    // 4. Wayback takes the width: no list, no details, no list rail — the
    //    compare panes plus the 436px archive.org slide-out instead (#401). The
    //    lookup control kept its testid when it moved into the panel header.
    await page.getByRole('tab', { name: 'Wayback', exact: true }).click()
    await expect(page.getByTestId('wayback-panel')).toBeVisible()
    await expect(page.getByTestId('wayback-lookup-btn')).toBeVisible()
    await expect(page.getByTestId('wayback-compare')).toBeVisible()
    await expect(rows).toHaveCount(0)
    await expect(page.getByTestId('capture-list-rail')).toHaveCount(0)
    await expect(page.getByTestId('capture-details-aside')).toHaveCount(0)

    await page.getByRole('tab', { name: 'Screenshot', exact: true }).click()
    await expect(rows).toHaveCount(2)
    await expect(page.getByTestId('capture-details-aside')).toBeVisible()

    // 5. The dragged widths survive a reload. The layout is saved per panel
    // set, so the same three columns have to be on screen to compare against —
    // hence re-selecting a row before measuring.
    const listBeforeReload = await widthOf(page, 'capture-list')
    await page.reload()
    await expect(page.getByTestId('capture-item')).toHaveCount(2, { timeout: 15000 })
    await page.getByTestId('capture-item').first().click()
    await expect(page.getByTestId('capture-details-aside')).toBeVisible()
    expect(Math.abs((await widthOf(page, 'capture-list')) - listBeforeReload)).toBeLessThan(4)
  })
})
