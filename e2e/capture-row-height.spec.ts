import { test, expect } from './fixtures/electronApp'

type Page = import('@playwright/test').Page

// A capture row with no matching Selector must stand as tall as one with a chip,
// at every list width, so the detailed list reads as a grid of equal rows.

async function seedCapture(page: Page, caseId: string, slug: string, text: string) {
  const result = await page.evaluate(
    async ({ caseId, slug, text }) => {
      const status = await fetch('http://127.0.0.1:19845/api/status').then((r) => r.json())
      const form = new FormData()
      form.append('source', 'manual')
      form.append('caseId', caseId)
      form.append('url', `https://example.com/${slug}`)
      form.append('title', `Row ${slug}`)
      form.append('timestamp', new Date().toISOString())
      form.append('textContent', text)
      form.append('extensionVersion', '0.1.0')
      form.append('browserVersion', 'Chrome/120')
      form.append('userAgent', 'Mozilla/5.0')
      form.append(
        'mhtml',
        new Blob([`<html><body>${text}</body></html>`], { type: 'multipart/related' }),
        'capture.mhtml'
      )
      const r = await fetch('http://127.0.0.1:19845/api/captures', {
        method: 'POST',
        body: form,
        headers: { 'X-Birdbrain-Token': status.serverToken ?? '' }
      })
      return r.json()
    },
    { caseId, slug, text }
  )
  expect(result.status).toBe('ok')
}

// Layout height, not the bounding box: the list animates row layout changes
// with transforms, and a box read mid-animation reports a scaled height.
function rowHeight(page: Page, title: string): Promise<number> {
  return page
    .getByTestId('capture-item')
    .filter({ hasText: title })
    .evaluate((el) => (el as HTMLElement).offsetHeight)
}

async function createCase(page: Page, name: string): Promise<string> {
  await page.evaluate(() => {
    window.location.hash = '/cases/new?blank=true'
  })
  await page.waitForSelector('[data-testid="case-name-input"]', { timeout: 10000 })
  await page.fill('[data-testid="case-name-input"]', name)
  await page.click('[data-testid="case-create-btn"]')
  await page.waitForURL(/#\/cases\/.+\/overview/, { timeout: 10000 })
  return page.url().match(/cases\/([^/]+)/)![1]
}

// One at a time with a pause between, so each Selector has a later creation
// time than the one before and the newest is known.
async function createSelectors(
  page: Page,
  caseId: string,
  selectors: Array<{ pattern: string; label?: string }>
) {
  await page.evaluate(
    async ({ caseId, selectors }) => {
      const { birdbrain } = window as unknown as {
        birdbrain: { selectors: { create: (p: object) => Promise<unknown> } }
      }
      for (const selector of selectors) {
        await birdbrain.selectors.create({ caseId, isRegex: false, ...selector })
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
    },
    { caseId, selectors }
  )
}

// A control's box in its row's own coordinates, from layout and not from the
// bounding box, for the reason `rowHeight` gives. The row is the offset parent
// of both controls.
function layoutBox(el: Element) {
  const { offsetLeft, offsetTop, offsetWidth, offsetHeight } = el as HTMLElement
  return { left: offsetLeft, top: offsetTop, width: offsetWidth, height: offsetHeight }
}

const LONG_LABEL = 'Consignment reference on the haulage desk manifest pages'

test.describe('Capture list row height', () => {
  test('rows are one height and one chip line at 240, 316 and 560 pixels', async ({
    page,
    electronApp
  }) => {
    const caseId = await createCase(page, 'Row Width E2E')
    await createSelectors(page, caseId, [
      { pattern: 'acme' },
      { pattern: 'widgets' },
      { pattern: 'consignment', label: LONG_LABEL }
    ])
    await seedCapture(page, caseId, 'many', 'acme widgets consignment')
    await seedCapture(page, caseId, 'single', 'acme only')
    await seedCapture(page, caseId, 'plain', 'nothing to see')
    await electronApp.windows()[0].setViewportSize({ width: 1440, height: 900 })

    const row = (slug: string) =>
      page.getByTestId('capture-item').filter({ hasText: `Row ${slug}` })
    const rowWidths: number[] = []
    for (const width of [240, 316, 560]) {
      // The list reads its stored width when its panel mounts, so leave the
      // screen and come back.
      await page.evaluate(
        ({ id, width }) => {
          localStorage.setItem('listColumnWidth', String(width))
          window.location.hash = `/cases/${id}/overview`
        },
        { id: caseId, width }
      )
      await page.waitForURL(/#\/cases\/.+\/overview/, { timeout: 10000 })
      await page.evaluate((id) => {
        window.location.hash = `/cases/${id}/captures`
      }, caseId)

      // The newest matching Selector is named and the other two are counted.
      const many = row('many')
      await expect(many.getByTestId('capture-item-selector-more')).toHaveText('+2', {
        timeout: 10000
      })
      await expect(many.getByTestId('capture-item-selector-chip')).toHaveCount(1)
      await expect(many.getByTestId('capture-item-selector-name')).toHaveText(LONG_LABEL)
      await expect(many.getByTestId('capture-item-selector-chip')).toHaveAttribute(
        'title',
        `${LONG_LABEL}, widgets, acme`
      )
      await expect(row('single').getByTestId('capture-item-selector-name')).toHaveText('acme')
      await expect(row('single').getByTestId('capture-item-selector-more')).toHaveCount(0)
      await expect(row('plain').getByTestId('capture-item-selector-chip')).toHaveCount(0)

      const heights = await Promise.all(
        ['many', 'single', 'plain'].map((slug) => rowHeight(page, `Row ${slug}`))
      )
      const lines = await Promise.all(
        ['many', 'single', 'plain'].map((slug) =>
          row(slug)
            .getByTestId('capture-item-chip-line')
            .evaluate((el) => (el as HTMLElement).offsetHeight)
        )
      )
      console.log(
        `list ${width}px: row heights ${heights.join(', ')}; chip lines ${lines.join(', ')}`
      )
      expect(heights[0]).toBe(heights[2])
      expect(heights[1]).toBe(heights[2])
      expect(lines[0]).toBe(lines[2])
      expect(lines[1]).toBe(lines[2])
      // The chip stays inside its line: nothing is pushed to a second line or
      // past the row's edge.
      const fits = await many.getByTestId('capture-item-chip-line').evaluate((el) => {
        const line = el as HTMLElement
        const chip = line.querySelector('[data-testid="capture-item-selector-chip"]') as HTMLElement
        return chip.offsetLeft + chip.offsetWidth <= line.offsetLeft + line.offsetWidth
      })
      expect(fits).toBe(true)
      rowWidths.push(await many.evaluate((el) => (el as HTMLElement).offsetWidth))
    }
    // Each stored width took effect, so the three passes measured three lists.
    expect(rowWidths[0]).toBeLessThan(rowWidths[1])
    expect(rowWidths[1]).toBeLessThan(rowWidths[2])

    // At 240 pixels the long name is cut, not wrapped. The loop ended at 560.
    await page.evaluate((id) => {
      localStorage.setItem('listColumnWidth', '240')
      window.location.hash = `/cases/${id}/overview`
    }, caseId)
    await page.waitForURL(/#\/cases\/.+\/overview/, { timeout: 10000 })
    await page.evaluate((id) => {
      window.location.hash = `/cases/${id}/captures`
    }, caseId)
    const name = row('many').getByTestId('capture-item-selector-name')
    await expect(name).toHaveText(LONG_LABEL, { timeout: 10000 })
    expect(await name.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true)
    await expect(row('many').getByTestId('capture-item-selector-more')).toBeVisible()
  })

  test('the checkbox and the Favorite button are 24 pixel targets that do not overlap', async ({
    page
  }) => {
    const caseId = await createCase(page, 'Row Targets E2E')
    await seedCapture(page, caseId, 'target', 'nothing to see')
    await page.evaluate((id) => {
      window.location.hash = `/cases/${id}/captures`
    }, caseId)
    const item = page.getByTestId('capture-item').filter({ hasText: 'Row target' })
    await expect(item).toBeVisible({ timeout: 10000 })

    const checkbox = await item.getByTestId('capture-select-checkbox').evaluate(layoutBox)
    const favorite = await item
      .getByRole('button', { name: 'Favorite capture' })
      .evaluate(layoutBox)
    for (const box of [checkbox, favorite]) {
      expect(box.width).toBeGreaterThanOrEqual(24)
      expect(box.height).toBeGreaterThanOrEqual(24)
    }
    const apart =
      checkbox.left + checkbox.width <= favorite.left ||
      favorite.left + favorite.width <= checkbox.left ||
      checkbox.top + checkbox.height <= favorite.top ||
      favorite.top + favorite.height <= checkbox.top
    expect(apart).toBe(true)
    // The glyphs keep their sizes inside the larger targets.
    const glyphs = await item.evaluate((el) => {
      const box = el.querySelector('[data-testid="capture-select-checkbox"] > span') as HTMLElement
      const star = el.querySelector('button[aria-label="Favorite capture"] svg') as SVGElement
      return {
        box: [box.offsetWidth, box.offsetHeight],
        star: [star.getBoundingClientRect().width, star.getBoundingClientRect().height]
      }
    })
    expect(glyphs.box).toEqual([14, 14])
    expect(glyphs.star.map(Math.round)).toEqual([11, 11])
  })

  test('each target takes a click at its corner, where the glyph is not', async ({ page }) => {
    const caseId = await createCase(page, 'Row Corner E2E')
    await seedCapture(page, caseId, 'corner', 'nothing to see')
    await page.evaluate((id) => {
      window.location.hash = `/cases/${id}/captures`
    }, caseId)
    const item = page.getByTestId('capture-item').filter({ hasText: 'Row corner' })
    await expect(item).toBeVisible({ timeout: 10000 })

    // Each point is measured from the glyph, not from the target, so it does not move with
    // the target's size. Five pixels up and left of the star is past the two pixels of padding
    // the button had before, and three pixels up and left of the box is past the checkbox it
    // was before, so only a 24 pixel target takes either click.
    const star = await item.locator('button[aria-label="Favorite capture"] svg').boundingBox()
    await page.mouse.click(star!.x - 5, star!.y - 5)
    await expect(item.getByRole('button', { name: 'Unfavorite capture' })).toBeVisible()
    const box = await item.locator('[data-testid="capture-select-checkbox"] > span').boundingBox()
    await page.mouse.click(box!.x - 3, box!.y - 3)
    await expect(item.getByTestId('capture-select-checkbox')).toHaveAttribute(
      'aria-checked',
      'true'
    )
  })

  test('a row without selector chips matches the height of a row with them', async ({ page }) => {
    await page.evaluate(() => {
      window.location.hash = '/cases/new?blank=true'
    })
    await page.waitForSelector('[data-testid="case-name-input"]', { timeout: 10000 })
    await page.fill('[data-testid="case-name-input"]', 'Row Height E2E')
    await page.click('[data-testid="case-create-btn"]')
    await page.waitForURL(/#\/cases\/.+\/overview/, { timeout: 10000 })
    const caseId = page.url().match(/cases\/([^/]+)/)![1]

    await page.evaluate(async (id) => {
      await (
        window as unknown as {
          birdbrain: { selectors: { create: (p: object) => Promise<unknown> } }
        }
      ).birdbrain.selectors.create({ caseId: id, pattern: 'acme', isRegex: false })
    }, caseId)
    await seedCapture(page, caseId, 'chipped', 'acme widgets')
    await seedCapture(page, caseId, 'plain', 'nothing to see')

    await page.evaluate((id) => {
      window.location.hash = `/cases/${id}/captures`
    }, caseId)
    const chipped = page.getByTestId('capture-item').filter({ hasText: 'Row chipped' })
    await expect(chipped.getByTestId('capture-item-selector-name')).toHaveText('acme', {
      timeout: 10000
    })
    await expect(page.getByTestId('capture-item').filter({ hasText: 'Row plain' })).toBeVisible()

    const withChips = await rowHeight(page, 'Row chipped')
    const withoutChips = await rowHeight(page, 'Row plain')
    console.log(`row heights: chipped=${withChips}px plain=${withoutChips}px`)
    expect(withoutChips).toBe(withChips)
  })
})
