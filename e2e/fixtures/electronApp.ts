import { test as base, _electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm, access } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
// @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
import { prepareProfile, profileLaunch } from '../../scripts/dev-seed/profile.mjs'
// @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
import { seedProfile } from '../../scripts/dev-seed/launch.mjs'

type ElectronFixtures = {
  electronApp: ElectronApplication
  page: Page
}

type ElectronOptions = {
  /**
   * Launch with no settings.json at all, so the app latches `isFreshInstall`
   * for itself and runs its first-launch work — which since #405 includes
   * seeding the bundled demonstration case. Off by default: the pre-written
   * settings.json is what gets every other spec past the operator-name gate.
   */
  freshInstall: boolean
  /**
   * Launch on the profile `pnpm dev:seed` opens on: onboarding completed, an ordinary Case and a
   * two-member Shared Case already in it. Off by default.
   */
  seeded: boolean
}

export const test = base.extend<ElectronFixtures & ElectronOptions>({
  freshInstall: [false, { option: true }],
  seeded: [false, { option: true }],

  electronApp: async ({ freshInstall, seeded }, use) => {
    const tempDir = await mkdtemp(join(tmpdir(), 'birdbrain-test-'))

    // The operator name clears the #116 capture gate and the signing key the #414 gate; both are
    // explained in scripts/dev-seed/profile.mjs. A fresh-install spec gets no settings.json, so
    // the app latches `isFreshInstall` for itself.
    await prepareProfile(
      tempDir,
      freshInstall ? undefined : { operatorName: 'E2E Test Operator', completedOnboarding: seeded }
    )
    if (seeded) await seedProfile(join(__dirname, '../..'), tempDir)

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
    // profileLaunch also gives each test a fresh Chromium profile (localStorage, IndexedDB).
    const { args, env } = profileLaunch(tempDir)
    const app = await _electron.launch({
      args: ['.', ...args],
      cwd: join(__dirname, '../..'),
      // BIRDBRAIN_E2E_SHARING_OFF (syncService.ts) keeps a seeded Shared Case
      // from starting a transport against n0's public relays at launch.
      env: { ...process.env, ...env, BIRDBRAIN_E2E_SHARING_OFF: '1' }
    })

    try {
      await use(app)
    } finally {
      await app.close().catch(() => {})
      await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    }
  },

  page: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow()
    await page.waitForLoadState('domcontentloaded')
    await page.waitForSelector('[data-testid="app-ready"]', { timeout: 15000 })
    await use(page)
  }
})

export { expect } from '@playwright/test'
