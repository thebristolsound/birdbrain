import { test as base, _electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

type ElectronFixtures = {
  electronApp: ElectronApplication
  page: Page
}

export const test = base.extend<ElectronFixtures>({
  electronApp: async ({}, use) => {
    const tempDir = await mkdtemp(join(tmpdir(), 'birdbrain-test-'))

    const app = await _electron.launch({
      args: [join(__dirname, '../../out/main/index.js')],
      env: {
        ...process.env,
        BIRDBRAIN_USER_DATA: tempDir
      }
    })

    await use(app)

    await app.close()
    await rm(tempDir, { recursive: true, force: true })
  },

  page: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await use(page)
  }
})

export { expect } from '@playwright/test'
