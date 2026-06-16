import { test, expect } from './fixtures/electronApp'

// Helper: navigate to /cases/new via the hash router and wait for the form
async function goToNewCase(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    window.location.hash = '/cases/new'
  })
  await page.waitForSelector('[data-testid="case-name-input"]', { timeout: 10000 })
}

// Helper: a freshly created case now lands on its Overview page, which has no
// CaseHeader. The header (and the tests that use it) live on the captures route,
// so hop there first before asserting on the header.
async function waitForCaseHeader(page: import('@playwright/test').Page, name: string) {
  await page.waitForURL(/#\/cases\/.+\/(overview|captures)/, { timeout: 10000 })
  await page.evaluate(() => {
    const m = window.location.hash.match(/#\/cases\/([^/]+)/)
    if (m) window.location.hash = `/cases/${m[1]}/captures`
  })
  await page.waitForSelector('[data-testid="case-header-name-btn"]', { timeout: 10000 })
  await expect(page.locator('[data-testid="case-header-name-btn"]')).toContainText(name)
}

test.describe('Cases CRUD', () => {
  test('can create a new case', async ({ page }) => {
    await goToNewCase(page)

    // Fill in case details on the wizard page
    await page.fill('[data-testid="case-name-input"]', 'Test Investigation')
    await page.fill('[data-testid="case-description-input"]', 'A test case for E2E')

    // Submit
    await page.click('[data-testid="case-create-btn"]')

    // Verify case workspace loads with case name in header
    await waitForCaseHeader(page, 'Test Investigation')
  })

  test('case lands on the overview page after creation', async ({ page }) => {
    await goToNewCase(page)
    await page.fill('[data-testid="case-name-input"]', 'Listed Case')
    await page.click('[data-testid="case-create-btn"]')

    // A freshly created case opens on its Overview landing page.
    await expect(page).toHaveURL(/#\/cases\/.+\/overview/)
    await expect(page.getByRole('heading', { name: 'Listed Case' })).toBeVisible()
  })

  test('can rename a case via the case header', async ({ page }) => {
    await goToNewCase(page)
    await page.fill('[data-testid="case-name-input"]', 'Original Name')
    await page.click('[data-testid="case-create-btn"]')
    await waitForCaseHeader(page, 'Original Name')

    // Click the case name button in the CaseHeader to enter edit mode
    await page.click('[data-testid="case-header-name-btn"]')

    // Type the new name and confirm with Enter
    await page.waitForSelector('[data-testid="case-header-name-input"]')
    await page.fill('[data-testid="case-header-name-input"]', 'Renamed Case')
    await page.press('[data-testid="case-header-name-input"]', 'Enter')

    // Verify the renamed case is visible in the header
    await expect(page.locator('[data-testid="case-header-name-btn"]')).toContainText('Renamed Case')
    await expect(page.locator('[data-testid="case-header-name-btn"]')).not.toContainText(
      'Original Name'
    )
  })

  test('can delete a case via IPC', async ({ page }) => {
    await goToNewCase(page)
    await page.fill('[data-testid="case-name-input"]', 'To Be Deleted')
    await page.click('[data-testid="case-create-btn"]')
    await waitForCaseHeader(page, 'To Be Deleted')

    // Get the case ID from the URL
    const url = page.url()
    const caseIdMatch = url.match(/cases\/([^/]+)/)
    expect(caseIdMatch).toBeTruthy()
    const caseId = caseIdMatch![1]

    // Delete via IPC
    await page.evaluate((id: string) => {
      const w = window as unknown as {
        birdbrain: { cases: { delete: (id: string) => Promise<void> } }
      }
      return w.birdbrain.cases.delete(id)
    }, caseId)

    // Navigate back to root — should show dashboard (onboarding only on first launch)
    await page.evaluate(() => {
      window.location.hash = '/'
    })
    await expect(page.locator('[data-testid="dashboard"]')).toBeVisible()
  })
})
