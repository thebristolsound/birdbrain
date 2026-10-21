import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, readdir, readFile, rm } from 'fs/promises'
import { createServer, type AddressInfo } from 'net'
import { join } from 'path'
import { tmpdir } from 'os'
import { decodeBase32 } from '@main/services/sharing/base32'
import type { BirdbrainAPI } from '@shared/birdbrainApi'
import { CAPTURE_SERVER_PORT } from '@shared/constants'
import type { ManifestEntry } from '@shared/schemas'
import { launchBirdbrain, readyPage } from './fixtures/electronApp'
import { createCase, mhtmlPage, seedCapture, serverToken } from './fixtures/seed'
// @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
import { prepareProfile } from '../scripts/dev-seed/profile.mjs'

// Two copies of the built app on one machine share a Case (#1882; the design's
// Testing section). Each runs on its own profile and Chromium profile, the
// second with its Capture Server on another port, and the two reach each other
// over the loopback bridge (src/main/services/sharing/loopbackTransport.ts),
// never the internet. The spec drives the sharing commands through
// window.birdbrain, since the members screens (#1514) are not built yet.

const CASE_NAME = 'Shared e2e Case'
const OWNER_CODE = 'AB'
const JOINER_CODE = 'CD'

type Win = Window & { birdbrain: BirdbrainAPI }

// The ticket inside an invite: the prefix, then base32 of a CBOR map (invite.ts).
// The map's `ticket` text is read here without the CBOR library, which ships as
// an ES module Playwright's loader does not take: the key is the 6-byte text
// header 0x66 and the word, and the value is a text header and its bytes.
function inviteTicket(invite: string): string {
  const prefix = 'bbinvite1'
  expect(invite.startsWith(prefix)).toBe(true)
  const bytes = Buffer.from(decodeBase32(invite.slice(prefix.length)))
  const key = Buffer.concat([Buffer.from([0x66]), Buffer.from('ticket')])
  const at = bytes.indexOf(key)
  expect(at).toBeGreaterThanOrEqual(0)
  const header = bytes[at + key.length]
  expect(header >> 5).toBe(3)
  const short = header & 0x1f
  const [length, start] =
    short < 24
      ? [short, at + key.length + 1]
      : short === 24
        ? [bytes[at + key.length + 1], at + key.length + 2]
        : [bytes.readUInt16BE(at + key.length + 1), at + key.length + 3]
  return bytes.subarray(start, start + length).toString('utf-8')
}

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

async function statusCases(port: number): Promise<string[]> {
  const response = await fetch(`http://127.0.0.1:${port}/api/status?includeCases=1`)
  expect(response.ok).toBe(true)
  const status = (await response.json()) as { cases: Array<{ name: string }> }
  return status.cases.map((c) => c.name)
}

function mergeEntries(entries: Array<{ parsed: boolean; entry?: ManifestEntry }>) {
  return entries.flatMap((e) => (e.parsed && e.entry?.type === 'merge' ? [e.entry] : []))
}

test.describe('two instances share a Case', () => {
  // Two launches, a join and two sync sessions take longer than one spec's default.
  test.setTimeout(180_000)

  let ownerDir: string
  let joinerDir: string
  let bridgeDir: string
  let owner: ElectronApplication | undefined
  let joiner: ElectronApplication | undefined

  test.beforeEach(async () => {
    ownerDir = await mkdtemp(join(tmpdir(), 'birdbrain-owner-'))
    joinerDir = await mkdtemp(join(tmpdir(), 'birdbrain-joiner-'))
    bridgeDir = await mkdtemp(join(tmpdir(), 'birdbrain-bridge-'))
    await prepareProfile(ownerDir, { operatorName: 'Owner Operator' })
    await prepareProfile(joinerDir, { operatorName: 'Joiner Operator' })
  })

  test.afterEach(async () => {
    await owner?.close().catch(() => {})
    await joiner?.close().catch(() => {})
    for (const dir of [ownerDir, joinerDir, bridgeDir]) {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  })

  test('the Owner invites, the second instance joins, and a Capture arrives', async () => {
    const joinerPort = await freePort()
    const sharingEnv = { BIRDBRAIN_E2E_SHARING_OFF: '0', BIRDBRAIN_E2E_SHARING_BRIDGE: bridgeDir }
    owner = await launchBirdbrain(ownerDir, sharingEnv)
    const ownerPage: Page = await readyPage(owner)
    // The second launch holds its own single-instance lock (keyed on the profile)
    // and binds its Capture Server to the override port, or it would not reach
    // its window: a bind failure is fatal at boot.
    joiner = await launchBirdbrain(joinerDir, {
      ...sharingEnv,
      BIRDBRAIN_CAPTURE_SERVER_PORT: String(joinerPort)
    })
    const joinerPage: Page = await readyPage(joiner)

    // The Owner's Case and Capture, posted the way the extension posts one.
    const caseId = await createCase(ownerPage, CASE_NAME)
    const token = await serverToken(ownerPage)
    const url = 'https://example.com/shared-page'
    await seedCapture(ownerPage, caseId, token, {
      slug: 'shared-page',
      url,
      title: 'Shared page',
      // The joiner re-derives the title from the received page (#1811), so it needs one.
      mhtml: mhtmlPage(
        url,
        '<html><head><title>Shared page</title></head><body>Shared page</body></html>'
      )
    })
    await ownerPage.evaluate((id) => {
      window.location.hash = `/cases/${id}/captures`
    }, caseId)
    await expect(ownerPage.getByTestId('capture-item')).toHaveCount(1, { timeout: 15000 })

    // Which process answers on which port: the Owner's lists its Case on the
    // fixed port, and the second instance lists nothing on the override port.
    expect(await statusCases(CAPTURE_SERVER_PORT)).toEqual([CASE_NAME])
    expect(await statusCases(joinerPort)).toEqual([])

    const { invite } = await ownerPage.evaluate(
      ([id, code]) => (window as unknown as Win).birdbrain.sharing.createInvite(id, code),
      [caseId, OWNER_CODE] as const
    )
    // The invite names a node, never an address or a port (ruling 74).
    const ticket = inviteTicket(invite)
    expect(ticket.startsWith('loop:')).toBe(true)
    expect(ticket).not.toMatch(/\d{1,3}(\.\d{1,3}){3}/)
    expect(ticket).not.toMatch(/:\d{2,5}\b/)

    // The join waits for the Owner's approval, so it runs while the Owner
    // reads the pending request and approves it.
    const joining = joinerPage.evaluate(
      (text) => (window as unknown as Win).birdbrain.sharing.join(text),
      invite
    )
    const pending = await expect
      .poll(
        async () => {
          const members = await ownerPage.evaluate(
            (id) => (window as unknown as Win).birdbrain.sharing.getMembers(id),
            caseId
          )
          return members.pendingJoins[0]?.requestId ?? null
        },
        { timeout: 30000 }
      )
      .not.toBeNull()
      .then(() =>
        ownerPage.evaluate(
          (id) => (window as unknown as Win).birdbrain.sharing.getMembers(id),
          caseId
        )
      )
    expect(pending.pendingJoins[0].operatorName).toBe('Joiner Operator')
    await ownerPage.evaluate(
      ([id, requestId, code]) =>
        (window as unknown as Win).birdbrain.sharing.approveJoin(id, requestId, code),
      [caseId, pending.pendingJoins[0].requestId, JOINER_CODE] as const
    )
    const joined = await joining
    expect(joined).toEqual({ caseId, caseName: CASE_NAME })

    // Both nodes recorded a loopback address in the bridge directory and nothing else.
    const records = await Promise.all(
      (await readdir(bridgeDir)).sort().map(async (name) => {
        const record = JSON.parse(await readFile(join(bridgeDir, name), 'utf-8')) as {
          host: string
        }
        return record.host
      })
    )
    expect(records).toEqual(['127.0.0.1', '127.0.0.1'])

    // The join's first session brought the Owner's chain, so the joiner's own
    // chain holds one merge, naming an entry the Owner's chain really has.
    const ownerSnapshot = await ownerPage.evaluate(
      (id) => (window as unknown as Win).birdbrain.manifest.snapshot(id),
      caseId
    )
    const ownerInstallationId = pending.installationId
    const afterJoin = await joinerPage.evaluate(
      (id) => (window as unknown as Win).birdbrain.manifest.snapshot(id),
      caseId
    )
    const merges = mergeEntries(afterJoin.entries)
    expect(merges).toHaveLength(1)
    expect(merges[0].heads).toHaveLength(1)
    const [head] = merges[0].heads
    expect(head.installationId).toBe(ownerInstallationId)
    const named = ownerSnapshot.entries[head.index]
    expect(named.parsed && named.entry.entryHash).toBe(head.entryHash)
    expect(afterJoin.chain.valid).toBe(true)

    // Sync now reaches the Owner again, with nothing new to bring.
    const outcomes = await joinerPage.evaluate(
      (id) => (window as unknown as Win).birdbrain.sharing.syncNow(id),
      caseId
    )
    expect(outcomes).toHaveLength(1)
    expect(outcomes[0]).toMatchObject({ installationId: ownerInstallationId, outcome: 'synced' })

    // The Owner's Capture, cited with the Owner's Member Code in front of its
    // Exhibit Number.
    await joinerPage.evaluate((id) => {
      window.location.hash = `/cases/${id}/captures`
    }, caseId)
    await expect(joinerPage.getByTestId('capture-item')).toHaveCount(1, { timeout: 30000 })
    await expect(joinerPage.getByTestId('capture-item-citation')).toHaveText(`${OWNER_CODE}-1`)
    await expect(joinerPage.getByTestId('capture-item')).toContainText('Shared page')

    const finalSnapshot = await joinerPage.evaluate(
      (id) => (window as unknown as Win).birdbrain.manifest.snapshot(id),
      caseId
    )
    expect(finalSnapshot.chain.valid).toBe(true)
  })
})
