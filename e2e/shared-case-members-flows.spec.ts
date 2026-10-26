import { test, expect } from './fixtures/electronApp'
import type { Page } from '@playwright/test'
import {
  MEMBER_MEMBER_CODE,
  OWNER_MEMBER_CODE,
  REVOKED_MEMBER_NAME,
  SHARED_CASE_NAME
} from '../scripts/dev-seed/constants'
import type { BirdbrainAPI } from '@shared/birdbrainApi'
import { mhtmlPage, seedCapture, serverToken } from './fixtures/seed'

// The Members screens (#1514) driven the way an Owner uses them, on the seeded
// profile: the Owner (DS), Morgan Reyes (MR) and the revoked Priya Natarajan
// (PN). Sharing stays switched off, so nothing here needs a transport: revoke
// and exclude are local signed entries, and Invite meets the refusal.

const OWNER_NAME = 'E2E Test Operator'
const MEMBER_NAME = 'Morgan Reyes'

type Win = Window & { birdbrain: BirdbrainAPI }

async function sharedCaseId(page: Page): Promise<string> {
  return page.evaluate(async (name) => {
    const cases = await (window as unknown as Win).birdbrain.cases.list()
    const shared = cases.find((entry) => entry.name === name)
    if (!shared) throw new Error('Shared Case seed missing')
    return shared.id
  }, SHARED_CASE_NAME)
}

async function openMembers(page: Page, caseId: string): Promise<void> {
  await page.evaluate((id) => {
    window.location.hash = `/cases/${id}/settings`
  }, caseId)
  await expect(page.getByTestId('members-list')).toBeVisible()
}

const memberRow = (page: Page, name: string) =>
  page.getByTestId(/^member-row-/).filter({ hasText: name })

async function lastEntry(page: Page, caseId: string) {
  const snapshot = await page.evaluate(
    (id) => (window as unknown as Win).birdbrain.manifest.snapshot(id),
    caseId
  )
  const last = snapshot.entries.at(-1)
  return last?.parsed ? last.entry : undefined
}

test.describe('Shared Case members flows', () => {
  test.use({ seeded: true })

  test('the roster shows the Owner, an offline member and a revoked member', async ({ page }) => {
    const caseId = await sharedCaseId(page)

    // The seeded profile reopens its last Case; the Case cards are on Home.
    await page.getByRole('button', { name: 'Home', exact: true }).click()
    await expect(page.getByTestId('case-card').filter({ hasText: SHARED_CASE_NAME })).toContainText(
      `Shared by ${OWNER_NAME} · 2 members`
    )

    await openMembers(page, caseId)
    await expect(page.getByTestId('members-count')).toHaveText('Members · 2')
    await expect(page.getByTestId('invite-button')).toBeVisible()

    const owner = memberRow(page, OWNER_NAME)
    await expect(owner).toContainText(OWNER_MEMBER_CODE)
    await expect(owner).toContainText('Owner · you')
    await expect(owner.getByTestId('member-connection')).toHaveText('This machine')
    await expect(owner.getByRole('button', { name: 'Revoke' })).toHaveCount(0)

    const member = memberRow(page, MEMBER_NAME)
    await expect(member).toContainText(MEMBER_MEMBER_CODE)
    await expect(member.getByTestId('member-connection')).toHaveText('Offline')
    await expect(member.getByRole('button', { name: 'Revoke' })).toHaveCount(1)

    const revoked = memberRow(page, REVOKED_MEMBER_NAME)
    await expect(revoked.getByTestId('member-connection')).toHaveText(
      /^Revoked \S.* · keeps their copy$/
    )
    await expect(revoked.getByRole('button', { name: 'Revoke' })).toHaveCount(0)
  })

  test('the Owner revokes a member and the chain records it', async ({ page }) => {
    const caseId = await sharedCaseId(page)
    const morgan = await page.evaluate(
      async ([id, name]) => {
        const { members } = await (window as unknown as Win).birdbrain.sharing.getMembers(id)
        return members.find((m) => m.operatorName === name)?.installationId ?? null
      },
      [caseId, MEMBER_NAME] as const
    )
    expect(morgan).not.toBeNull()
    await openMembers(page, caseId)

    const member = memberRow(page, MEMBER_NAME)
    await member.hover()
    await member.getByRole('button', { name: 'Revoke' }).click()
    const dialog = page.getByRole('dialog', { name: `Revoke ${MEMBER_NAME}?` })
    await expect(dialog).toBeVisible()
    // The summary names the member's Exhibit by its prefixed citation before
    // the confirm button unlocks.
    await expect(dialog).toContainText(`(${MEMBER_MEMBER_CODE}-1)`)
    await dialog.getByRole('button', { name: 'Revoke' }).click()
    await expect(dialog).toBeHidden()

    await expect(member.getByTestId('member-connection')).toHaveText(
      /^Revoked \S.* · keeps their copy$/
    )
    await expect(member.getByRole('button', { name: 'Revoke' })).toHaveCount(0)
    await expect(page.getByTestId('members-count')).toHaveText('Members · 1')

    const entry = await lastEntry(page, caseId)
    expect(entry?.type).toBe('member-revoke')
    expect(entry && 'memberInstallationId' in entry && entry.memberInstallationId).toBe(morgan)
    const revokedAt = await page.evaluate(
      async ([id, installationId]) => {
        const { members } = await (window as unknown as Win).birdbrain.sharing.getMembers(id)
        return members.find((m) => m.installationId === installationId)?.revokedAtIndex
      },
      [caseId, morgan ?? ''] as const
    )
    expect(revokedAt).toBe(entry?.index)
  })

  test('the Owner excludes a Capture from export and the ledger names the actor', async ({
    page
  }) => {
    const caseId = await sharedCaseId(page)
    const reason = 'out of scope for this request'
    await seedCapture(page, caseId, await serverToken(page), {
      slug: 'excluded',
      title: 'Excluded Capture',
      mhtml: mhtmlPage(
        'https://example.com/excluded',
        '<html><head><title>Excluded Capture</title></head><body>Excluded</body></html>'
      )
    })
    await page.evaluate((id) => {
      window.location.hash = `/cases/${id}/captures`
    }, caseId)
    await expect(page.getByTestId('capture-item')).toHaveCount(1)
    await page.getByTestId('capture-item').click()
    const showDetails = page.getByRole('button', { name: 'Show details', exact: true })
    const details = page.getByTestId('capture-sharing-details')
    await expect(details.or(showDetails).first()).toBeVisible()
    if (!(await details.isVisible())) await showDetails.click()
    await expect(details).toContainText(`Captured by you (${OWNER_MEMBER_CODE})`)

    await details.getByRole('button', { name: 'Exclude from export' }).click()
    const dialog = page.getByRole('dialog', {
      name: new RegExp(`^Exclude ${OWNER_MEMBER_CODE}-\\d+ from export\\?$`)
    })
    await expect(dialog).toBeVisible()
    await dialog.getByLabel(/Reason/).fill(reason)
    await dialog.getByRole('button', { name: 'Exclude from export' }).click()
    await expect(dialog).toBeHidden()

    const banner = details.getByTestId('capture-exclusion-banner')
    await expect(banner).toContainText('Excluded from export')
    await expect(banner).toContainText(`by ${OWNER_NAME} (Owner)`)
    await expect(banner).toContainText(`“${reason}”`)
    await expect(details.getByRole('button', { name: 'Exclude from export' })).toHaveCount(0)

    const entry = await lastEntry(page, caseId)
    expect(entry?.type).toBe('exclude')
    expect(entry && 'reason' in entry && entry.reason).toBe(reason)
    await expect(banner).toContainText(`exclude #${String(entry?.index).padStart(4, '0')}`)

    await page.evaluate((id) => {
      window.location.hash = `/cases/${id}/data`
    }, caseId)
    await page.getByRole('treeitem', { name: /Manifest Ledger/ }).click()
    const selector = page.getByTestId('ledger-chain-selector')
    await expect(selector).toBeVisible()
    const row = page.getByTestId(`ledger-row-${entry?.index}`)
    await expect(row).toHaveAttribute('data-entry-type', 'exclude')
    await expect(row).toContainText(OWNER_MEMBER_CODE)
    // The seed's own exclusion of MR-1 sits earlier in the same chain.
    await expect(page.locator('[data-entry-type="exclude"]')).toHaveCount(2)

    const timeline = selector.getByRole('button', { name: 'Timeline' })
    await timeline.click()
    await expect(timeline).toHaveAttribute('aria-pressed', 'true')
    await expect(selector).toContainText('Cross-chain order is by asserted time, not verified')
    await expect(row).toContainText(`${OWNER_MEMBER_CODE}·`)
  })

  test('Invite reports that sharing cannot start', async ({ page }) => {
    await openMembers(page, await sharedCaseId(page))
    await page.getByTestId('invite-button').click()
    await expect(page.getByTestId('invite-error')).toHaveText(
      'Sharing is not available on this computer.'
    )
    await expect(page.getByTestId('invite-dialog')).toHaveCount(0)
  })

  test('the Join card refuses text that is not an invite', async ({ page }) => {
    await page.evaluate(() => {
      window.location.hash = '/cases/new?join=true'
    })
    const card = page.getByTestId('join-case-card')
    await expect(card).toBeVisible()
    const join = card.getByRole('button', { name: 'Join', exact: true })
    await expect(join).toBeDisabled()

    await card.getByLabel('Invite').fill('not a birdbrain invite')
    const alert = card.getByRole('alert')
    await expect(alert).toBeVisible()
    await expect(join).toBeDisabled()

    await alert.getByRole('button', { name: 'Close' }).click()
    await expect(card).toBeHidden()
    await expect(page.getByTestId('case-start-step')).toBeVisible()
  })
})
