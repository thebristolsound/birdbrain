import { test, expect } from './fixtures/electronApp'
import type { Page } from '@playwright/test'

type CasesBridge = {
  birdbrain: { cases: { list: () => Promise<Array<{ id: string; isDemo: boolean }>> } }
}

// The whole point of this spec: launch with no settings.json, so the app
// latches the fresh-install flag itself and seeds the bundled demonstration
// Case Archive through the ordinary chain-verified import path (#405).
test.use({ freshInstall: true })

async function listCases(page: Page): Promise<Array<{ id: string; isDemo: boolean }>> {
  return page.evaluate(() => (window as unknown as CasesBridge).birdbrain.cases.list())
}

/** Forward one step, whichever of the two surfaces it renders. */
async function advance(page: Page) {
  await page.locator('[data-testid="tour-next"]').click()
}

/** The mark on screen is the one named, and it is rung on a real anchor. */
async function expectAnchoredMark(page: Page, count: string) {
  await expect(page.locator('[data-testid="tour-count"]')).toContainText(count)
  await expect(page.locator('[data-testid="tour-mark"]')).toHaveAttribute('data-anchored', 'true')
}

/**
 * Walks from the chapter's opening screen card to its last mark.
 *
 * Ten steps: four screen cards and six coach marks, interleaved. Two of the
 * marks — the viewer tabs and the note editor — ring surfaces that do not exist
 * under default state, so those two are asserted anchored on the way past.
 * Reaching them is not itself an assertion: a step whose anchor never mounts
 * falls back to a centred card carrying the same Next button and the same mark
 * counter, so the walk alone would pass whether or not the side effects fired.
 */
async function walkToFinalStep(page: Page) {
  await expect(page.locator('[data-testid="tour-screen"]')).toBeVisible()
  await advance(page)
  // Anchored only because the step selected a capture (#405, Q2).
  await expectAnchoredMark(page, '1 of 6')
  for (let i = 0; i < 5; i += 1) await advance(page)
  // Anchored only because the step asked Notes to open its composer.
  await expectAnchoredMark(page, '4 of 6')
  for (let i = 0; i < 3; i += 1) await advance(page)
  await expect(page.locator('[data-testid="tour-count"]')).toContainText('6 of 6')
}

/** Ends whatever chapter is running and returns to the dashboard. */
async function dismissTour(page: Page) {
  await page.click('[data-testid="tour-skip"]')
  await expect(page.locator('[data-testid="onboarding-tour"]')).toBeHidden()
}

test.describe('The demonstration case and its tour', () => {
  test('seeds the demo case and opens the case tour on it', async ({ page }) => {
    // Session restore takes a fresh install straight into the only case there
    // is — the seeded one — so the case chapter is what the operator meets.
    await expect(page.locator('[data-testid="tour-screen"]')).toBeVisible()
    await expect(page.locator('[data-testid="tour-screen-count"]')).toContainText('Screen 1 of 4')
    // Copy that is written only when the case being toured is the demo case.
    await expect(page.locator('[data-testid="tour-screen"]')).toContainText('demo case')

    const seeded = await listCases(page)
    expect(seeded).toHaveLength(1)
    expect(seeded[0].isDemo).toBe(true)
  })

  test('rings all six marks, then offers both endings', async ({ page }) => {
    await walkToFinalStep(page)

    // The mark on the final step is anchored, not the centred fallback: the
    // Export button it rings is on screen.
    await expect(page.locator('[data-testid="tour-mark"]')).toHaveAttribute(
      'data-anchored',
      'true'
    )
    await expect(page.locator('[data-testid="tour-delete-demo"]')).toBeVisible()
    await expect(page.locator('[data-testid="tour-next"]')).toHaveText('Keep exploring')
  })

  test('Delete demo case removes it and leaves the operator on the dashboard', async ({ page }) => {
    await walkToFinalStep(page)

    await page.click('[data-testid="tour-delete-demo"]')

    await expect(page.locator('[data-testid="onboarding-tour"]')).toBeHidden()
    await expect(page.locator('[data-testid="dashboard"]')).toBeVisible()
    await expect.poll(() => listCases(page)).toEqual([])
  })

  test('Keep exploring leaves it as an ordinary case', async ({ page }) => {
    await walkToFinalStep(page)

    await page.click('[data-testid="tour-next"]')

    await expect(page.locator('[data-testid="onboarding-tour"]')).toBeHidden()
    const kept = await listCases(page)
    expect(kept).toHaveLength(1)
    // Still flagged, so an Evidence Package built from it still says what it is
    // — Keep exploring is not a way to launder fixture data into a real case.
    expect(kept[0].isDemo).toBe(true)
  })

  test('a replayed tour never seeds a second copy', async ({ page }) => {
    await dismissTour(page)
    expect(await listCases(page)).toHaveLength(1)

    await page.keyboard.press('Control+k')
    await page.click('[data-testid="palette-replay-tour"]')
    await expect(page.locator('[data-testid="tour-welcome"]')).toBeVisible()
    await dismissTour(page)

    // Replay is a renderer act and imports nothing: `seedDemoCaseIfNeeded` has
    // one caller, startup. The guard that holds there is the `is_demo` probe in
    // the database (`caseRepo.hasDemoCase`, #1301), not the settings latch —
    // the latch can fail to persist and the probe still answers, as long as the
    // case seeded above has not been deleted.
    expect(await listCases(page)).toHaveLength(1)

    await page.reload()
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 15000 })
    expect(await listCases(page)).toHaveLength(1)
  })
})
