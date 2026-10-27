import { mkdir } from 'node:fs/promises'
import { test, expect } from './fixtures/electronApp'
import { SHARED_CASE_NAME } from '../scripts/dev-seed/constants'
import type { BirdbrainAPI } from '@shared/birdbrainApi'
import { mhtmlPage, seedCapture, serverToken } from './fixtures/seed'

const SCREENS = process.env.BIRDBRAIN_MEMBERS_SCREEN_DIR ?? 'test-results/shared-case-members'

test.describe('Shared Case members screens', () => {
  test.use({ seeded: true })

  test('renders the roster, attribution, ledger and Join in both themes', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.setViewportSize({ width: 1440, height: 1000 })
    await mkdir(SCREENS, { recursive: true })
    const caseId = await page.evaluate(async (name) => {
      const { birdbrain } = window as unknown as { birdbrain: BirdbrainAPI }
      const cases = await birdbrain.cases.list()
      const shared = cases.find((entry) => entry.name === name)
      if (!shared) throw new Error('Shared Case seed missing')
      return shared.id
    }, SHARED_CASE_NAME)
    await seedCapture(page, caseId, await serverToken(page), {
      slug: 'shared-ui',
      title: 'Shared UI Capture',
      mhtml: mhtmlPage(
        'https://example.com/shared-ui',
        '<html><head><title>Shared UI Capture</title></head><body>Shared UI Capture</body></html>'
      )
    })
    for (const theme of ['light', 'dark'] as const) {
      await page.evaluate((value) => {
        document.documentElement.classList.toggle('dark', value === 'dark')
        localStorage.setItem('theme', value)
      }, theme)
      await page.evaluate((id) => {
        window.location.hash = `/cases/${id}/settings`
      }, caseId)
      await expect(page.getByTestId('identity-card')).toBeVisible()
      await expect(page.getByTestId('members-list')).toContainText('Morgan Reyes')
      await page.screenshot({ path: `${SCREENS}/members-${theme}.png`, fullPage: true })
      await page.evaluate((id) => {
        window.location.hash = `/cases/${id}/captures`
      }, caseId)
      await expect(page.getByTestId('capture-item')).toHaveCount(1)
      await page.getByTestId('capture-item').click()
      const showDetails = page.getByRole('button', { name: 'Show details', exact: true })
      const details = page.getByTestId('capture-sharing-details')
      await expect(details.or(showDetails).first()).toBeVisible()
      if (!(await details.isVisible())) await showDetails.click()
      await expect(details).toContainText('Captured by you (DS)')
      await page.screenshot({ path: `${SCREENS}/attribution-${theme}.png`, fullPage: true })
      await page.evaluate((id) => {
        window.location.hash = `/cases/${id}/data`
      }, caseId)
      await page.getByRole('treeitem', { name: /Manifest Ledger/ }).click()
      await expect(page.getByTestId('ledger-chain-selector')).toBeVisible()
      await page.screenshot({ path: `${SCREENS}/ledger-${theme}.png`, fullPage: true })
      await page.evaluate(() => {
        window.location.hash = '/cases/new?join=true'
      })
      await expect(page.getByTestId('join-case-card')).toBeVisible()
      await page.screenshot({ path: `${SCREENS}/join-${theme}.png`, fullPage: true })
    }
  })

  test('reaches Members and Join through their entry points', async ({ page }) => {
    const caseId = await page.evaluate(async (name) => {
      const { birdbrain } = window as unknown as { birdbrain: BirdbrainAPI }
      const shared = (await birdbrain.cases.list()).find((entry) => entry.name === name)
      if (!shared) throw new Error('Shared Case seed missing')
      return shared.id
    }, SHARED_CASE_NAME)

    await page.evaluate(() => {
      window.location.hash = '/'
    })
    const card = page.getByTestId('case-card').filter({ hasText: SHARED_CASE_NAME })
    await card.hover()
    await card.getByTestId('case-card-menu-btn').click()
    await card.getByRole('menuitem', { name: 'Members' }).click()
    await expect(page.getByTestId('identity-card')).toBeVisible()

    await page.evaluate((id) => {
      window.location.hash = `/cases/${id}/captures`
    }, caseId)
    await page.getByTestId('sync-pill').click()
    await expect(page.getByTestId('identity-card')).toBeVisible()
    expect(await page.evaluate(() => window.location.hash)).toBe(`#/cases/${caseId}/settings`)

    await page.getByTestId('topbar-case-name').click()
    await page.getByRole('button', { name: 'Join a shared Case…' }).click()
    await expect(page.getByTestId('join-case-card')).toBeVisible()

    await page.getByRole('button', { name: 'Back' }).click()
    await expect(page.getByTestId('case-start-step')).toBeVisible()
    await page.getByTestId('case-start-join').click()
    await expect(page.getByTestId('join-case-card')).toBeVisible()
  })
})
