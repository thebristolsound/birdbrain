import { test, expect } from './fixtures/electronApp'

test('tag menu drills into export and persists customisation without executing actions', async ({
  page
}, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.evaluate(() => {
    window.location.hash = '/cases/new'
  })
  await page.getByTestId('case-name-input').fill('Menu design review')
  await page.getByTestId('case-create-btn').click()
  await page.waitForURL(/#\/cases\/.+\/overview/)
  await page.getByRole('button', { name: 'Signals', exact: true }).click()
  await page.getByTestId('add-tag-input').fill('important')
  await page.getByTestId('add-tag-input').press('Enter')
  const row = page.getByTestId('signals-tag-list').locator('[data-testid^="signal-row-"]', {
    has: page.getByText('important', { exact: true })
  })
  await row.click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Duplicate', exact: true })).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('tag-menu.png') })
  await page.getByRole('menuitem', { name: 'Export…', exact: true }).click()
  await expect(page.getByRole('menu')).toHaveCount(1)
  await expect(page.getByRole('menuitem', { name: 'ZIP + manifest', exact: true })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'Copy as markdown', exact: true })).toBeVisible()
  await page.getByRole('menuitem', { name: 'Back', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Customise this menu…', exact: true }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Duplicate', exact: true }).click()
  await expect(
    page.getByRole('menuitemcheckbox', { name: 'Duplicate', exact: true })
  ).toHaveAttribute('aria-checked', 'false')
  await page.getByRole('menuitem', { name: /^Done/ }).click()
  await expect(page.getByRole('menuitem', { name: 'Duplicate', exact: true })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('signals-tag-list')).not.toContainText('important-copy')
  await page.reload()
  await row.click({ button: 'right' })
  await expect(page.getByRole('menuitem', { name: 'Duplicate', exact: true })).toHaveCount(0)
  await page.getByRole('menuitem', { name: 'Customise this menu…', exact: true }).click()
  await page.getByRole('menuitemcheckbox', { name: 'Duplicate', exact: true }).click()
  await page.getByRole('menuitem', { name: /^Done/ }).click()
  await page.getByRole('menuitem', { name: 'Duplicate', exact: true }).click()
  await expect(page.getByTestId('signals-tag-list')).toContainText('important-copy')
  expect(errors).toEqual([])
})
