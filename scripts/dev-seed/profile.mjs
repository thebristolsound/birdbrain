// The one preparation behind every throwaway Birdbrain profile: the e2e fixture
// (e2e/fixtures/electronApp.ts), the exploratory harness (scripts/exploratory-harness.mjs) and
// `pnpm dev:seed` (scripts/dev-seed.mjs). Each launches the app with nobody at the window, so
// startup has to clear the #116 operator-name gate and the #414 signing-key acknowledgement gate
// by itself.

import { generateKeyPairSync } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// Filenames, encodings and algorithm mirror initSigningKey in src/main/services/signingKey.ts:
// the app reads signing-key.pem back through unwrapPrivateKey, which returns any value without the
// 'enc:' prefix unchanged, and specs sign and verify real manifest entries against this pair.
//
// Seeding it takes initSigningKey's existing-key branch, so the #414 gate never fires. That gate
// matters most under Playwright: its Electron loader calls app.commandLine.appendSwitch(
// 'password-store', 'basic') before this app's main script (playwright-core/lib/server/electron/
// loader.js), pinning Chromium's os_crypt to basic_text, so safeStorage.isEncryptionAvailable() is
// false in every e2e run regardless of the machine's real credential store, and appendSwitch beats
// argv, so no --password-store arg can override it. Without a key on disk the gate fires on a
// native modal that has no window and nothing to click it, and startup hangs until firstWindow()
// times out.
//
// The cost is that e2e no longer exercises key *generation*; the gate and the generation path are
// covered by tests/main/services/signingKey.test.ts. Generated per profile, never committed: a
// private key in the repo would be a real secret leak regardless of it being test-only.
async function seedSigningKey(dir) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
  })
  await writeFile(join(dir, 'signing-key.pem'), privateKey, 'utf-8')
  await writeFile(join(dir, 'signing-public-key.pem'), publicKey, 'utf-8')
}

/**
 * Writes the signing keypair and, unless `settings` is omitted, a settings.json naming the
 * operator. Omit `settings` for a fresh-install launch: writing the file at all is what tells
 * initSettings the profile has been launched before. `completedOnboarding` records the onboarding
 * as done, so the app opens on the dashboard.
 *
 * @param {string} dir
 * @param {{ operatorName: string, completedOnboarding?: boolean }} [settings]
 */
export async function prepareProfile(dir, settings) {
  if (settings) {
    await writeFile(
      join(dir, 'settings.json'),
      JSON.stringify({
        operatorName: settings.operatorName,
        ...(settings.completedOnboarding ? { hasCompletedOnboarding: true } : {})
      })
    )
  }
  await seedSigningKey(dir)
}

/**
 * The launch arguments and environment that point one app process at `dir`: Birdbrain's data
 * directory (read in src/main/index.ts) and Chromium's own profile (localStorage, IndexedDB), so a
 * run never reads or writes the real profile.
 *
 * @param {string} dir
 */
export function profileLaunch(dir) {
  return { args: [`--user-data-dir=${dir}`], env: { BIRDBRAIN_USER_DATA: dir } }
}
