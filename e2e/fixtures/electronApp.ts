import { test as base, _electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm, access } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

type ElectronFixtures = {
  electronApp: ElectronApplication
  page: Page
}

export const test = base.extend<ElectronFixtures>({
  electronApp: async ({}, use) => {
    const tempDir = await mkdtemp(join(tmpdir(), 'birdbrain-test-'))

    const mainPath = join(__dirname, '../../out/main/index.js')

    try {
      await access(mainPath)
    } catch {
      throw new Error(
        `Electron main entrypoint not found at "${mainPath}". ` +
          'Make sure the application is built (e.g. run your build script) before running E2E tests.'
      )
    }

    // Launch via package.json `main` resolution (args: ['.']) so the test exercises the
    // same code path electron-builder uses in production (asar / asarUnpack / preload).
    // --user-data-dir gives each test a fresh Chromium profile (localStorage, IndexedDB).
    const app = await _electron.launch({
      args: ['.', `--user-data-dir=${tempDir}`],
      cwd: join(__dirname, '../..'),
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
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 15000 })
    await use(page)
  }
})

export { expect } from '@playwright/test'
