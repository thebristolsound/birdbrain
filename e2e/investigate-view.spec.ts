import { test, expect } from './fixtures/electronApp'
import { createCase, seedCapture, serverToken } from './fixtures/seed'

// The Investigate route has no sidebar or palette entry yet (ruling 57), so the spec opens it by
// its address. Playwright starts an unpackaged app, where the fake engine answers the view's
// channels from its invented fixture.

const INQUIRY = 'Are M. Calloway, Jun Sato, and The Ferryman the same writer?'

test.describe('Investigate route', () => {
  test('runs from the setup, shows the header, and arranges its panes by width', async ({
    page
  }) => {
    test.setTimeout(60000)
    await page.setViewportSize({ width: 1200, height: 800 })

    const caseId = await createCase(page, 'Investigate E2E')
    // A Capture keeps the Case out of the empty-Case state.
    await seedCapture(page, caseId, await serverToken(page), { slug: 'harbour-notice' })
    await page.evaluate((id) => {
      window.location.hash = `/cases/${id}/investigate`
    }, caseId)

    await expect(page.getByRole('heading', { name: 'Ask the Case' })).toBeVisible({
      timeout: 15000
    })
    await expect(
      page.getByRole('button', { name: 'Add Rowan Pike (byline, gazette.example.com)' })
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Add Rowan Pike (harbour board minutes)' })
    ).toBeVisible()
    const withheld = page.getByTestId('investigate-withheld-row')
    await expect(withheld).toHaveCount(2)
    await expect(withheld.nth(0)).toContainText('Private notes page')
    await expect(withheld.nth(1)).toContainText('Source contact sheet')

    await page.getByLabel('Inquiry or claim').fill(INQUIRY)
    await page.getByRole('button', { name: 'Run', exact: true }).click()

    const counts = page.getByTestId('investigate-header-counts')
    await expect(counts).toHaveText(/^\d+ Exhibits read · \d+ withheld · \d+ not read$/, {
      timeout: 15000
    })
    await expect(page.getByText('Followed: 2 Joints out from each starting Subject')).toBeVisible()

    // The default 1200-pixel window leaves the view 1152 pixels beside the sidebar.
    await expect(page.getByRole('region', { name: 'Source inspector' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Joint map and list' })).toBeVisible()
    await expect(page.getByRole('tablist')).toHaveCount(0)

    await page.setViewportSize({ width: 1000, height: 800 })
    await expect(page.getByRole('tablist')).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Joints' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Source' })).toBeVisible()
  })
})
