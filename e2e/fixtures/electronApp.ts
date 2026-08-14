import { test as base, _electron, type ElectronApplication, type Page } from '@playwright/test'
import { mkdtemp, rm, access, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { generateKeyPairSync } from 'crypto'

type ElectronFixtures = {
  electronApp: ElectronApplication
  page: Page
}

// Filenames, encodings and algorithm mirror initSigningKey in
// src/main/services/signingKey.ts: the app reads signing-key.pem back through
// unwrapPrivateKey, which returns any value without the 'enc:' prefix
// unchanged, and specs sign and verify real manifest entries against this pair.
async function seedSigningKey(userDataDir: string): Promise<void> {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  })
  await writeFile(join(userDataDir, 'signing-key.pem'), privateKey, 'utf-8')
  await writeFile(join(userDataDir, 'signing-public-key.pem'), publicKey, 'utf-8')
}

export const test = base.extend<ElectronFixtures>({
  electronApp: async ({}, use) => {
    const tempDir = await mkdtemp(join(tmpdir(), 'birdbrain-test-'))

    // Seed operator name so the #116 capture gate does not reject test captures.
    await writeFile(
      join(tempDir, 'settings.json'),
      JSON.stringify({ operatorName: 'E2E Test Operator' })
    )

    // Seed a plaintext signing keypair so initSigningKey takes its existing-key
    // branch and returns before the #414 acknowledgement gate. Playwright's
    // Electron loader calls app.commandLine.appendSwitch('password-store',
    // 'basic') before this app's main script (playwright-core/lib/server/
    // electron/loader.js), pinning Chromium's os_crypt to basic_text — so
    // safeStorage.isEncryptionAvailable() is false in every e2e run regardless
    // of the machine's real credential store, and appendSwitch beats argv, so
    // no --password-store arg can override it. Without a key on disk the gate
    // fires on a native modal that has no window and nothing to click it, and
    // every spec times out in firstWindow().
    //
    // The cost is that e2e no longer exercises key *generation*; the gate and
    // the generation path are covered by tests/main/services/signingKey.test.ts.
    // Generated per run, never committed: a private key in the repo would be a
    // real secret leak regardless of it being test-only.
    await seedSigningKey(tempDir)

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
