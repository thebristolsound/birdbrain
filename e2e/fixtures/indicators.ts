import { expect, type Page } from '@playwright/test'

// Reads the Data screen's Indicators group, the extracted-data browser, for specs
// that check what extraction wrote for a Capture.

export type Indicator = { category: string; subcategory: string; value: string }

type ExtractedDataBridge = {
  birdbrain: { extractedData: { count: (caseId: string) => Promise<number> } }
}

/** How many extracted rows the case holds, read the way the Indicators view reads them. */
export async function extractedCount(page: Page, caseId: string): Promise<number> {
  return page.evaluate(
    (id) => (window as unknown as ExtractedDataBridge).birdbrain.extractedData.count(id),
    caseId
  )
}

/**
 * Opens the case's Data screen on its Indicators group and expects each indicator listed
 * under its category and subcategory. Open it only once extraction has written the rows:
 * the view reads them when it opens.
 */
export async function expectIndicatorsListed(
  page: Page,
  caseId: string,
  indicators: Indicator[]
): Promise<void> {
  await page.evaluate((id) => {
    window.location.hash = `/cases/${id}/data`
  }, caseId)
  await page.waitForURL(/#\/cases\/.+\/data/)
  await page
    .getByRole('tree', { name: 'Case data' })
    .getByRole('treeitem', { name: /^Indicators/ })
    .click()
  for (const { category, subcategory, value } of indicators) {
    // The view's columns are buttons; the rail's nodes are tree items, so these match the view.
    await page.getByRole('button', { name: new RegExp(`^${category}\\s*\\d`) }).click()
    await page.getByRole('button', { name: new RegExp(`^${subcategory}\\s*\\d`) }).click()
    await expect(page.getByText(value, { exact: true })).toBeVisible({ timeout: 10000 })
  }
}
