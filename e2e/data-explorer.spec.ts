import { join } from 'node:path'
import { test, expect } from './fixtures/electronApp'
import { createCase, mhtmlPage, seedCapture, serverToken } from './fixtures/seed'

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
    // The stored file path names the case and the capture it belongs to. It
    // is built with path.join, so the separator follows the platform.
    await expect(props).toContainText(join(caseId, `${alphaId}.mhtml`))
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

  // The MHTML Parts tab (#991) lists what main read from the stored file, over IPC.
  test('lists the parts of a stored MHTML, and says when the file is not one', async ({
    electronApp,
    page
  }) => {
    test.setTimeout(60000)
    const caseId = await createCase(page, 'MHTML Parts E2E')
    const token = await serverToken(page)
    const url = 'https://example.com/charlie'
    await seedCapture(page, caseId, token, {
      slug: 'charlie',
      url,
      title: 'Charlie listing',
      text: 'charlie extracted text line',
      mhtml: mhtmlPage(url, '<html><body><p>charlie</p></body></html>')
    })
    // The default seed body is a bare HTML page, with no MIME header block.
    await seedCapture(page, caseId, token, { slug: 'alpha', title: 'Alpha listing' })

    await electronApp.windows()[0].setViewportSize({ width: 1400, height: 900 })
    await page.getByRole('button', { name: 'Data', exact: true }).click()
    await page.waitForURL(/#\/cases\/.+\/data/)

    const rows = page
      .getByRole('grid', { name: 'Artifacts' })
      .locator('[data-testid^="artifact-row-"]')
    await expect(rows).toHaveCount(2, { timeout: 15000 })
    const tabs = page.getByTestId('artifact-tabs')

    await rows.filter({ hasText: 'Charlie listing' }).click()
    await expect(tabs).toContainText('Charlie listing')
    await tabs.getByRole('tab', { name: 'MHTML Parts' }).click()
    const table = page.getByTestId('mhtml-parts-table')
    await expect(table.getByRole('columnheader', { name: 'SHA-256 (computed now)' })).toBeVisible()
    await expect(table.locator('tbody tr')).toHaveCount(1)
    const parts = table.getByTestId('mhtml-part-1')
    await expect(parts.getByTestId('mhtml-part-location')).toHaveText(url)
    await expect(parts).toContainText('text/html')
    await expect(parts).toContainText('binary')
    await expect(parts.getByTestId('mhtml-part-html')).toHaveText('part 0main')
    await expect(parts.getByTestId('mhtml-part-sha256')).toHaveText(/^[0-9a-f]{64}$/)

    await rows.filter({ hasText: 'Alpha listing' }).click()
    await expect(tabs).toContainText('Alpha listing')
    await tabs.getByRole('tab', { name: 'MHTML Parts' }).click()
    const refused = page.getByTestId('mhtml-parts-refused')
    await expect(refused).toHaveText(
      'The stored file is not a multipart MHTML archive: it has no header block naming a boundary, so it holds no parts to list.'
    )
    await expect(refused).toHaveAttribute('data-reason', 'no-mime-header')
  })
})
