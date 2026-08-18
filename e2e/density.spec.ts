import { test, expect } from './fixtures/electronApp'

type Page = import('@playwright/test').Page

function rootVar(page: Page, name: string): Promise<string> {
  return page.evaluate(
    (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(),
    name
  )
}

function densityAttr(page: Page): Promise<string | null> {
  return page.evaluate(() => document.documentElement.getAttribute('data-density'))
}

function storedDensity(page: Page): Promise<string | undefined> {
  return page.evaluate(async () => {
    const settings = await (
      window as unknown as {
        birdbrain: { settings: { get: () => Promise<{ density?: string }> } }
      }
    ).birdbrain.settings.get()
    return settings.density
  })
}

async function openAppearanceTab(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.location.hash = '/settings'
  })
  await page.getByRole('tab', { name: 'Appearance' }).click()
  await expect(page.getByTestId('density-compact')).toBeVisible()
}

test.describe('UI density', () => {
  test('a fresh profile renders the compact step', async ({ page }) => {
    expect(await densityAttr(page)).toBe('compact')
    expect(await rootVar(page, '--d-pad')).toBe('12px')
    expect(await rootVar(page, '--d-row')).toBe('26px')
  })

  test('switching density re-drives the root properties without touching radius', async ({
    page
  }) => {
    await openAppearanceTab(page)
    const radiusBefore = await rootVar(page, '--radius')
    const densityRadiusBefore = await rootVar(page, '--d-r')

    await page.click('[data-testid="density-comfortable"]')
    await expect.poll(() => densityAttr(page)).toBe('comfortable')
    expect(await rootVar(page, '--d-pad')).toBe('24px')
    expect(await rootVar(page, '--d-row')).toBe('36px')

    await page.click('[data-testid="density-default"]')
    await expect.poll(() => densityAttr(page)).toBe('default')
    expect(await rootVar(page, '--d-pad')).toBe('18px')
    expect(await rootVar(page, '--d-row')).toBe('30px')

    // Radius is deliberately not a density concern: --d-r is declared once on
    // :root and inherited by every step.
    expect(await rootVar(page, '--radius')).toBe(radiusBefore)
    expect(await rootVar(page, '--d-r')).toBe(densityRadiusBefore)
  })

  // A reload, not a relaunch: the fixture mints a fresh user-data-dir per test,
  // so a second launch against the same profile is not expressible here. This
  // covers the pre-paint path and the settings-file round trip; the restart case
  // is covered by proxy.
  test('the chosen step survives a reload and reaches the settings file', async ({ page }) => {
    await openAppearanceTab(page)
    await page.click('[data-testid="density-comfortable"]')
    await expect.poll(() => storedDensity(page)).toBe('comfortable')

    await page.reload()
    // Same boot budget the launch fixture allows: a renderer reload remounts the
    // whole app, which overruns the 5s expect default on a cold CI worker.
    await expect(page.getByTestId('app-ready')).toBeVisible({ timeout: 15000 })

    // Applied before first paint by theme-init.js, so it holds on a route that
    // never mounts the Settings screen.
    expect(await densityAttr(page)).toBe('comfortable')
    expect(await rootVar(page, '--d-pad')).toBe('24px')
    expect(await storedDensity(page)).toBe('comfortable')
  })
})

// #421: --d-row has to be the body-row height at every step, not only at
// comfortable. jsdom does not lay out, so the class-contract test in
// tests/components/SelectorTable.test.tsx cannot see a cell's padding push the
// row past the metric — this measures the rendered rows in the built app.
test.describe('Selector-table row density', () => {
  const steps = [
    ['compact', 26],
    ['default', 30],
    ['comfortable', 36]
  ] as const

  const wrappedPattern = Array.from({ length: 40 }, (_, i) => `wrapped-token-${i}`).join(' ')

  test('body rows track --d-row at every step and a wrapped pattern grows the row', async ({
    page
  }) => {
    // Seeded over the bridge: what is under test is the row layout, and the
    // create flows are covered by cases.spec.ts and bulk-selectors.spec.ts.
    const caseId = await page.evaluate(async (wrappedPattern) => {
      const { cases, selectors } = (
        window as unknown as {
          birdbrain: {
            cases: { create: (p: { name: string }) => Promise<{ id: string }> }
            selectors: {
              create: (p: {
                caseId: string
                pattern: string
                isRegex?: boolean
                label?: string
              }) => Promise<unknown>
            }
          }
        }
      ).birdbrain
      const { id } = await cases.create({ name: 'Row Density E2E' })
      await selectors.create({ caseId: id, pattern: 'acme', label: 'stringrow' })
      await selectors.create({ caseId: id, pattern: 'acme\\d+', isRegex: true, label: 'regexrow' })
      await selectors.create({ caseId: id, pattern: wrappedPattern, label: 'wrappedrow' })
      return id
    }, wrappedPattern)
    // The dashboard already fetched the (empty) cases list; a reload drops that
    // cache so the workspace resolves the seeded case. Same boot budget as the
    // reload test above.
    await page.reload()
    await expect(page.getByTestId('app-ready')).toBeVisible({ timeout: 15000 })

    for (const [step, rowPx] of steps) {
      await openAppearanceTab(page)
      await page.click(`[data-testid="density-${step}"]`)
      await expect.poll(() => densityAttr(page)).toBe(step)
      expect(await rootVar(page, '--d-row')).toBe(`${rowPx}px`)

      await page.evaluate((id) => {
        window.location.hash = `/cases/${id}/selectors`
      }, caseId)
      const rows = page.locator('tbody tr')
      await expect(rows).toHaveCount(3)

      const height = async (label: string) => {
        const box = await rows.filter({ hasText: label }).boundingBox()
        if (!box) throw new Error(`row "${label}" has no box at ${step}`)
        return box.height
      }
      // Single-line rows sit exactly on the metric: a py on any fixed-height cell
      // or on the regex chip would push these past --d-row (the #421 defect).
      expect(await height('stringrow'), `string row at ${step}`).toBe(rowPx)
      expect(await height('regexrow'), `regex row at ${step}`).toBe(rowPx)

      // A wrapped pattern grows the row rather than clipping, and keeps the
      // clearance the pattern cell's py provides between text and row borders.
      const wrappedRow = rows.filter({ hasText: 'wrappedrow' })
      const rowBox = await wrappedRow.boundingBox()
      const textBox = await wrappedRow.getByText(wrappedPattern).boundingBox()
      if (!rowBox || !textBox) throw new Error(`wrapped row has no box at ${step}`)
      expect(rowBox.height, `wrapped row at ${step}`).toBeGreaterThan(rowPx)
      expect(textBox.y - rowBox.y, `top clearance at ${step}`).toBeGreaterThanOrEqual(3)
      expect(
        rowBox.y + rowBox.height - (textBox.y + textBox.height),
        `bottom clearance at ${step}`
      ).toBeGreaterThanOrEqual(3)
    }
  })
})
