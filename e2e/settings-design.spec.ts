import { test, expect } from './fixtures/electronApp'
import { readFile } from 'node:fs/promises'

test('Settings keeps nested tabs horizontal, caps Operator width and runs maintenance', async ({
  page,
  electronApp
}, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.evaluate(() => {
    window.location.hash = '/settings'
  })
  await page.getByRole('tab', { name: 'Operator', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Operator', level: 2 })).toBeVisible()
  const field = page.getByLabel('Operator Name', { exact: false })
  await expect(field).toHaveValue('E2E Test Operator')
  expect((await field.boundingBox())!.width).toBeLessThanOrEqual(560)
  expect((await field.boundingBox())!.width).toBeGreaterThan(550)
  await page.screenshot({ path: testInfo.outputPath('operator.png') })

  await page.getByRole('tab', { name: 'Diagnostics', exact: true }).click()
  const snapshot = page.getByRole('tab', { name: 'Snapshot', exact: true })
  const log = page.getByRole('tab', { name: 'Log', exact: true })
  await expect(snapshot).toBeVisible()
  const first = (await snapshot.boundingBox())!
  const second = (await log.boundingBox())!
  expect(Math.abs(first.y - second.y)).toBeLessThan(1)
  expect(second.x).toBeGreaterThan(first.x)
  await snapshot.focus()
  await page.keyboard.press('ArrowRight')
  await expect(log).toHaveAttribute('aria-selected', 'true')
  await page.screenshot({ path: testInfo.outputPath('diagnostics.png') })

  const target = await electronApp.evaluate(({ app, dialog, shell }) => {
    const filePath = `${process.env.BIRDBRAIN_USER_DATA || app.getPath('userData')}/settings-logs.zip`
    dialog.showSaveDialog = async () => ({ canceled: false, filePath })
    shell.showItemInFolder = () => {}
    return filePath
  })
  await page.getByRole('button', { name: 'Export logs', exact: true }).click()
  await expect(page.getByText('Logs exported', { exact: true })).toBeVisible()
  expect((await readFile(target)).subarray(0, 4).toString('hex')).toBe('504b0304')

  await page.getByRole('tab', { name: 'Database', exact: true }).click()
  await page.getByRole('button', { name: 'Integrity check', exact: true }).click()
  await expect(page.getByRole('status')).toContainText(
    'SQLite integrity and foreign-key checks passed.'
  )
  await page.getByRole('button', { name: 'Integrity check', exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath('database.png') })
  expect(errors).toEqual([])
})
