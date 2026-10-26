import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'fs/promises'
import { createServer, type AddressInfo } from 'net'
import { join } from 'path'
import { tmpdir } from 'os'
import type { BirdbrainAPI } from '@shared/birdbrainApi'
import { launchBirdbrain, readyPage } from './fixtures/electronApp'
import { createCase, mhtmlPage, seedCapture, serverToken } from './fixtures/seed'
// @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
import { prepareProfile } from '../scripts/dev-seed/profile.mjs'

// The invite, join and approval of #1514 driven through the Members screens
// on two copies of the built app, which reach each other over the loopback
// bridge as in shared-case-sync.spec.ts. That spec drives the same commands
// through window.birdbrain; this one clicks and types where a person would.

const CASE_NAME = 'Members UI join Case'
const OWNER_NAME = 'Owner Operator'
const JOINER_NAME = 'Joiner Operator'
// suggestMemberCode takes the initials of each operator name.
const OWNER_CODE = 'OO'
const SUGGESTED_JOINER_CODE = 'JO'
const JOINER_CODE = 'CD'

type Win = Window & { birdbrain: BirdbrainAPI }

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

async function goTo(page: Page, hash: string): Promise<void> {
  await page.evaluate((value) => {
    window.location.hash = value
  }, hash)
}

const memberRow = (page: Page, name: string) =>
  page.getByTestId(/^member-row-/).filter({ hasText: name })

test.describe('the Members screens invite and admit a second instance', () => {
  // Two launches, a join and its first sync session take longer than one spec's default.
  test.setTimeout(180_000)

  let ownerDir: string
  let joinerDir: string
  let bridgeDir: string
  let owner: ElectronApplication | undefined
  let joiner: ElectronApplication | undefined
  let ownerPage: Page
  let joinerPage: Page
  let caseId: string

  test.beforeEach(async () => {
    ownerDir = await mkdtemp(join(tmpdir(), 'birdbrain-owner-'))
    joinerDir = await mkdtemp(join(tmpdir(), 'birdbrain-joiner-'))
    bridgeDir = await mkdtemp(join(tmpdir(), 'birdbrain-bridge-'))
    await prepareProfile(ownerDir, { operatorName: OWNER_NAME })
    await prepareProfile(joinerDir, { operatorName: JOINER_NAME })
    const sharingEnv = { BIRDBRAIN_E2E_SHARING_OFF: '0', BIRDBRAIN_E2E_SHARING_BRIDGE: bridgeDir }
    owner = await launchBirdbrain(ownerDir, sharingEnv)
    ownerPage = await readyPage(owner)
    joiner = await launchBirdbrain(joinerDir, {
      ...sharingEnv,
      BIRDBRAIN_CAPTURE_SERVER_PORT: String(await freePort())
    })
    joinerPage = await readyPage(joiner)

    caseId = await createCase(ownerPage, CASE_NAME)
    await seedCapture(ownerPage, caseId, await serverToken(ownerPage), {
      slug: 'members-join',
      title: 'Members join page',
      mhtml: mhtmlPage(
        'https://example.com/members-join',
        '<html><head><title>Members join page</title></head><body>Members join</body></html>'
      )
    })
  })

  test.afterEach(async () => {
    await owner?.close().catch(() => {})
    await joiner?.close().catch(() => {})
    for (const dir of [ownerDir, joinerDir, bridgeDir]) {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  })

  // The Owner shares the Case from the not-shared card and copies the invite;
  // the joiner pastes it into the Join card. Returns the invite text.
  async function inviteAndRequest(): Promise<string> {
    await goTo(ownerPage, `/cases/${caseId}/settings`)
    const notShared = ownerPage.getByTestId('not-shared-card')
    await expect(notShared).toContainText(`Your Member Code will be ${OWNER_CODE}`)
    await notShared.getByRole('button', { name: 'Invite' }).click()

    const dialog = ownerPage.getByTestId('invite-dialog')
    await expect(dialog).toHaveAttribute('data-step', 'created')
    await expect(dialog.getByTestId('invite-qr')).toBeVisible()
    const invite = (await dialog.getByTestId('invite-string').textContent()) ?? ''
    expect(invite.startsWith('bbinvite1')).toBe(true)
    // The first invite shared the Case, so the roster replaced the card behind the dialog.
    await expect(memberRow(ownerPage, OWNER_NAME)).toContainText('Owner · you')

    await ownerPage.bringToFront()
    await dialog.getByRole('button', { name: 'Copy invite' }).click()
    await expect(dialog).toHaveAttribute('data-step', 'waiting')
    await expect(dialog).toContainText('Waiting for someone to use this invite')
    expect(await owner!.evaluate(({ clipboard }) => clipboard.readText())).toBe(invite)

    await goTo(joinerPage, '/cases/new?join=true')
    const card = joinerPage.getByTestId('join-case-card')
    await card.getByLabel('Invite').fill(invite)
    await expect(card).toContainText(OWNER_NAME)
    await card.getByRole('button', { name: 'Join', exact: true }).click()
    await expect(card.getByRole('status')).toContainText(`Waiting for ${OWNER_NAME} to approve`, {
      timeout: 30000
    })

    await expect(dialog).toHaveAttribute('data-step', 'request', { timeout: 30000 })
    await expect(dialog.getByTestId('join-request')).toContainText(JOINER_NAME)
    await expect(memberRow(ownerPage, JOINER_NAME)).toContainText('Pending your approval')
    return invite
  }

  test('the Owner approves the request with a chosen Member Code', async () => {
    await inviteAndRequest()
    const dialog = ownerPage.getByTestId('invite-dialog')
    const code = dialog.getByTestId('member-code-input')
    await expect(code).toHaveValue(SUGGESTED_JOINER_CODE)
    await code.fill(JOINER_CODE)
    await expect(dialog.getByTestId('member-code-ok')).toHaveText('Unique in this Case')
    await dialog.getByRole('button', { name: 'Approve' }).click()

    const done = dialog.getByTestId('invite-done')
    await expect(done).toContainText(JOINER_NAME)
    await expect(done).toContainText(JOINER_CODE)
    await expect(done).toContainText(/member-add #\d{4} written to your chain/)
    await done.getByRole('button', { name: 'Done' }).click()
    await expect(dialog).toBeHidden()

    const admitted = memberRow(ownerPage, JOINER_NAME)
    await expect(admitted).toContainText(JOINER_CODE)
    await expect(admitted).toContainText('Member')
    await expect(admitted).not.toContainText('Pending your approval')
    await expect(ownerPage.getByTestId('members-count')).toHaveText('Members · 2')

    // The joiner lands in the Case once the welcome is adopted.
    await joinerPage.waitForURL(new RegExp(`#/cases/${caseId}`), { timeout: 60000 })
    await goTo(joinerPage, `/cases/${caseId}/settings`)
    await expect(memberRow(joinerPage, OWNER_NAME)).toContainText(OWNER_CODE)
    await expect(memberRow(joinerPage, OWNER_NAME)).toContainText('Owner')
    const self = memberRow(joinerPage, JOINER_NAME)
    await expect(self).toContainText('Member · you')
    await expect(self.getByTestId('member-connection')).toHaveText('This machine')
    await expect(joinerPage.getByTestId('invite-button')).toHaveCount(0)

    // The first session brought the Owner's Capture, attributed to the Owner.
    await goTo(joinerPage, `/cases/${caseId}/captures`)
    await expect(joinerPage.getByTestId('capture-item')).toHaveCount(1, { timeout: 30000 })
    await joinerPage.getByTestId('capture-item').click()
    const showDetails = joinerPage.getByRole('button', { name: 'Show details', exact: true })
    const details = joinerPage.getByTestId('capture-sharing-details')
    await expect(details.or(showDetails).first()).toBeVisible()
    if (!(await details.isVisible())) await showDetails.click()
    await expect(details).toContainText(`Captured by ${OWNER_NAME} (${OWNER_CODE}), their machine`)
    await expect(details).toContainText('received by you')
    // Only the Owner may exclude.
    await expect(details.getByRole('button', { name: 'Exclude from export' })).toHaveCount(0)
  })

  test('the Owner declines the request and nothing is created on the joiner', async () => {
    await inviteAndRequest()
    const dialog = ownerPage.getByTestId('invite-dialog')
    await dialog.getByRole('button', { name: 'Decline' }).click()
    await expect(dialog).toBeHidden()
    await expect(memberRow(ownerPage, JOINER_NAME)).toHaveCount(0)
    await expect(ownerPage.getByTestId('members-count')).toHaveText('Members · 1')

    const card = joinerPage.getByTestId('join-case-card')
    const alert = card.getByRole('alert')
    await expect(alert).toContainText(`${OWNER_NAME} declined`, { timeout: 30000 })
    await expect(alert).toContainText('Nothing was created on either machine.')
    const cases = await joinerPage.evaluate(() => (window as unknown as Win).birdbrain.cases.list())
    expect(cases.map((c) => c.id)).not.toContain(caseId)
  })
})
