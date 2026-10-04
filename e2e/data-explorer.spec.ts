import { test, expect } from './fixtures/electronApp'
import { createCase, seedCapture, serverToken } from './fixtures/seed'

// The Data screen: the case's files as a tree, a table and a detail pane.
// search-dropdown.spec.ts only uses this screen as a backdrop; this spec reads
// what it says about two seeded captures.

test.describe('Data screen', () => {
  test('lists captures with their hashes, filters, and shows each detail tab', async ({
    electronApp,
    page
  }) => {
    test.setTimeout(60000)
    const caseId = await createCase(page, 'Data Screen E2E')
    const token = await serverToken(page)
    const alphaId = await seedCapture(page, caseId, token, {
      slug: 'alpha',
      title: 'Alpha listing',
      text: 'alpha extracted text line'
    })
    await seedCapture(page, caseId, token, {
      slug: 'bravo',
      title: 'Bravo listing',
      text: 'bravo extracted text line'
    })

    await electronApp.windows()[0].setViewportSize({ width: 1400, height: 900 })
    await page.getByRole('button', { name: 'Data', exact: true }).click()
    await page.waitForURL(/#\/cases\/.+\/data/)

    // The tree counts what the case holds.
    const tree = page.getByRole('tree', { name: 'Case data' })
    await expect(tree.getByRole('treeitem', { name: /^Captures\s*2$/ })).toBeVisible({
      timeout: 15000
    })
    await expect(tree.getByRole('treeitem', { name: /^Integrity Exceptions\s*0$/ })).toBeVisible()

    // One table row per capture, each with an exhibit number and a hash.
    const grid = page.getByRole('grid', { name: 'Artifacts' })
    const rows = grid.locator('[data-testid^="artifact-row-"]')
    await expect(rows).toHaveCount(2)
    const alphaRow = rows.filter({ hasText: 'Alpha listing' })
    await expect(alphaRow).toContainText(/Exhibit \d/)
    await expect(alphaRow).toContainText(/[0-9a-f]{14}/)

    // The search box narrows the table by name.
    const search = page.getByRole('textbox', { name: 'Search files, exhibits, kinds and hashes' })
    await search.fill('bravo')
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText('Bravo listing')
    await search.fill('no-such-artifact')
    await expect(rows).toHaveCount(0)
    await page.getByRole('button', { name: 'Clear search' }).click()
    await expect(rows).toHaveCount(2)

    // Selecting a row drives the detail pane.
    await alphaRow.click()
    const tabs = page.getByTestId('artifact-tabs')
    await expect(tabs).toContainText('Alpha listing')

    await tabs.getByRole('tab', { name: 'Extracted Text' }).click()
    await expect(page.getByTestId('extracted-text-tab')).toContainText('alpha extracted text line')

    await tabs.getByRole('tab', { name: 'Properties' }).click()
    const props = page.getByTestId('properties-tab')
    await expect(props).toContainText('SHA-256')
    // The stored file path names the case and the capture it belongs to.
    await expect(props).toContainText(`${caseId}/${alphaId}.mhtml`)
    await expect(props).toContainText('browser Chrome/120')
    await expect(props).toContainText('Mozilla/5.0')

    // The ledger tab verifies the hash chain for this case.
    await tabs.getByRole('tab', { name: 'Manifest Ledger' }).click()
    const ledger = page.getByTestId('manifest-ledger-tab')
    await expect(ledger.getByTestId('chain-verdict')).toContainText('Chain intact', {
      timeout: 15000
    })
    await expect(ledger).toContainText('https://example.com/alpha')
    await expect(ledger).toContainText('genesis')
  })
})
