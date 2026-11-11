import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'fs/promises'
import { createServer, type Server } from 'http'
import { type AddressInfo } from 'net'
import { join } from 'path'
import { tmpdir } from 'os'
import type { BirdbrainAPI } from '@shared/birdbrainApi'
import { launchBirdbrain, readyPage } from './fixtures/electronApp'
// @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
import { prepareProfile } from '../scripts/dev-seed/profile.mjs'

// The pass the main process runs at startup, before the queue can claim a job
// (docs/specs/2026-11-09-batch-capture-throughput-design.md, "Restart and snapshot restore"):
// jobs queued in the session before are held, and the one running when it closed is interrupted.

type Win = { birdbrain: BirdbrainAPI }

test.describe('Background jobs across a restart', () => {
  let userData: string
  let server: Server
  let app: ElectronApplication | undefined
  const requests: string[] = []

  test.beforeEach(async () => {
    requests.length = 0
    userData = await mkdtemp(join(tmpdir(), 'birdbrain-restart-'))
    await prepareProfile(userData, { operatorName: 'E2E Test Operator' })
    // Never answers, so the first job is still running when the app closes.
    server = createServer((req) => requests.push(req.url ?? ''))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  })

  test.afterEach(async () => {
    await app?.close().catch(() => {})
    server.closeAllConnections()
    server.close()
    await rm(userData, { recursive: true, force: true })
  })

  async function launch(): Promise<Page> {
    app = await launchBirdbrain(userData, { BIRDBRAIN_E2E_ALLOW_LOOPBACK: '1' })
    return readyPage(app)
  }

  test('holds the queued jobs and interrupts the running one, sending nothing for them', async () => {
    const { port } = server.address() as AddressInfo
    const urls = [1, 2, 3].map((n) => `http://127.0.0.1:${port}/${n}`)

    const first = await launch()
    const { caseId, batchId } = await first.evaluate(async (queued) => {
      const { birdbrain } = window as unknown as Win
      const { id } = await birdbrain.cases.create({ name: 'Restart' })
      const result = await birdbrain.recapture.enqueue({ urls: queued, caseId: id })
      return { caseId: id, batchId: result.batchId }
    }, urls)
    await expect.poll(() => requests).toEqual(['/1'])
    await app!.close()

    const second = await launch()
    const { status, jobs } = await second.evaluate(
      async ([id]) => {
        const { birdbrain } = window as unknown as Win
        return {
          status: await birdbrain.recapture.queueStatus(),
          jobs: await birdbrain.recapture.listJobs({ caseId: id })
        }
      },
      [caseId] as const
    )
    expect(status).toMatchObject({ pending: 0, queued: 0, running: 0, held: 2 })
    expect(status.heldBatches).toEqual([{ batchId, caseId, caseName: 'Restart', held: 2 }])
    expect(jobs.map(({ url, state, failureKind }) => [url, state, failureKind])).toEqual([
      [urls[0], 'failed', 'interrupted'],
      [urls[1], 'held', undefined],
      [urls[2], 'held', undefined]
    ])
    // Held jobs send no request of their own.
    await second.waitForTimeout(1500)
    expect(requests).toEqual(['/1'])
  })
})
