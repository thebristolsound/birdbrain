import { test, expect } from './fixtures/electronApp'
import { createCase, seedCapture, serverToken } from './fixtures/seed'

// Selectors on the Signals screen, driven through the UI the way an analyst
// builds them: type a pattern, read its matches, narrow the captures list with
// it, switch it off, and delete it. bulk-selectors.spec.ts covers the bulk
// drawer and tags.spec.ts covers tags; neither adds a selector one at a time.

test.describe('Selectors on the Signals screen', () => {
  test('add exact and regex selectors, read matches, filter, disable and delete', async ({
    electronApp,
    page
  }) => {
    test.setTimeout(90000)
    const caseId = await createCase(page, 'Selectors E2E')
    const token = await serverToken(page)
    await seedCapture(page, caseId, token, {
      slug: 'acme',
      title: 'Acme widgets page',
      text: 'acme widgets for sale'
    })
    await seedCapture(page, caseId, token, {
      slug: 'other',
      title: 'Other page',
      text: 'nothing to see here, order 12345'
    })

    await electronApp.windows()[0].setViewportSize({ width: 1400, height: 900 })
    await page.getByRole('button', { name: 'Signals', exact: true }).click()
    await page.waitForURL(/#\/cases\/.+\/signals/)
    await expect(page.getByTestId('signals-overview')).toBeVisible()

    // An exact-text selector, entered from the add row.
    const input = page.getByTestId('add-selector-input')
    await input.fill('acme')
    await input.press('Enter')
    await expect(input).toHaveValue('')

    const acmeRow = page.getByRole('row', { name: 'acme', exact: true })
    await expect(acmeRow).toBeVisible()
    // Creation matches the captures already in the case.
    await expect(acmeRow.getByTestId('signal-count')).toHaveText('1', { timeout: 15000 })

    // A regex selector: switch the add row's mode first.
    await page.getByTestId('add-selector-mode').click()
    await expect(input).toHaveAttribute('placeholder', 'Add regex selector')
    await input.fill('order \\d{5}')
    await input.press('Enter')
    const regexRow = page.getByRole('row', { name: 'order \\d{5}', exact: true })
    await expect(regexRow).toBeVisible()
    await expect(regexRow.getByTestId('signal-count')).toHaveText('1', { timeout: 15000 })

    // The rail describes the selected selector and lists where it appears.
    // The add row's match-mode cards fold away when it loses focus, which moves
    // the list up. Blur first so the click lands on the row it aims at.
    await input.blur()
    await expect(page.getByRole('radiogroup', { name: 'Match mode' })).toBeHidden()
    await acmeRow.getByTestId('signal-name-block').click()
    await expect(acmeRow).toHaveAttribute('aria-selected', 'true')
    const rail = page.getByTestId('signal-rail')
    await expect(rail.getByTestId('signal-pattern')).toContainText('acme')
    await expect(rail.getByRole('button', { name: /Acme widgets page/ })).toBeVisible()
    await expect(rail.getByRole('button', { name: /Other page/ })).toHaveCount(0)

    // Filter in Captures narrows the list to the one match.
    await rail.getByTestId('signal-filter-in-captures').click()
    await page.waitForURL(/#\/cases\/.+\/captures/)
    const rows = page.getByTestId('capture-item')
    await expect(rows).toHaveCount(1, { timeout: 15000 })
    await expect(rows.first()).toContainText('Acme widgets page')
    const narrowing = page.getByTestId('capture-list-narrowing')
    await expect(narrowing).toBeVisible()

    // Clearing the narrowing brings both captures back.
    await narrowing.getByRole('button').click()
    await expect(narrowing).toBeHidden()
    await expect(rows).toHaveCount(2)

    // Back on Signals: switching the selector off keeps it, and keeps its count.
    await page.getByRole('button', { name: 'Signals', exact: true }).click()
    await page.waitForURL(/#\/cases\/.+\/signals/)
    const enable = acmeRow.getByRole('switch', { name: 'Enable acme' })
    await expect(enable).toHaveAttribute('aria-checked', 'true')
    await enable.click()
    await expect(enable).toHaveAttribute('aria-checked', 'false')
    const stored = await page.evaluate(
      (id) =>
        (
          window as unknown as {
            birdbrain: {
              selectors: {
                list: (id: string) => Promise<Array<{ pattern: string; enabled: boolean }>>
              }
            }
          }
        ).birdbrain.selectors.list(id),
      caseId
    )
    expect(stored.find((s) => s.pattern === 'acme')?.enabled).toBe(false)

    // Delete asks first; cancel keeps the row, confirm removes it.
    await acmeRow.hover()
    await acmeRow.getByRole('button', { name: 'Delete acme' }).click()
    const dialog = page.getByTestId('delete-selector-dialog')
    await expect(dialog).toBeVisible()
    await page.getByTestId('delete-selector-cancel').click()
    await expect(dialog).toBeHidden()
    await expect(acmeRow).toBeVisible()

    await acmeRow.hover()
    await acmeRow.getByRole('button', { name: 'Delete acme' }).click()
    await page.getByTestId('delete-selector-confirm').click()
    await expect(acmeRow).toHaveCount(0)
    await expect(regexRow).toBeVisible()
  })
})
