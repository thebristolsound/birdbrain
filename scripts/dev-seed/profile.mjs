// The one preparation behind every throwaway Birdbrain profile: the e2e fixture
// (e2e/fixtures/electronApp.ts), the exploratory harness (scripts/exploratory-harness.mjs),
// `pnpm dev:seed` (scripts/dev-seed.mjs), the package smoke test (scripts/package-smoke.mjs) and
// the run-birdbrain driver (.claude/skills/run-birdbrain/driver.mjs);
// tests/singleProfileSeed.test.ts fails when other code names the key file. Each launches the app
// with nobody at the window, so startup has to clear the #116 operator-name gate and the #414
// signing-key acknowledgement gate by itself.

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
  return { privateKey, publicKey }
}

/**
 * Writes the signing keypair and, unless `settings` is omitted, a settings.json naming the
 * operator. Omit `settings` for a fresh-install launch: writing the file at all is what tells
 * initSettings the profile has been launched before. `completedOnboarding` writes the
 * `hasCompletedOnboarding` flag the New Case wizard sets; no startup code reads it, so it does not
 * change which screen opens (useSessionRestore.ts reopens the newest Case when there is one).
 *
 * Returns the keypair it wrote, so a test standing in for another installation (the sync peers
 * of tests/helpers/syncPeers.ts) can sign as that profile without reading the file back.
 *
 * @param {string} dir
 * @param {{ operatorName: string, completedOnboarding?: boolean }} [settings]
 * @returns {Promise<{ privateKey: string, publicKey: string }>}
 */
export async function prepareProfile(dir, settings) {
  if (settings) {
    await writeFile(
      join(dir, 'settings.json'),
      JSON.stringify({
        operatorName: settings.operatorName,
        // An existing install that has seen the Share mark, so a spec that opens a Case is
        // not handed the card; e2e/onboarding-tour.spec.ts clears it to see the mark.
        onboardingChapters: { share: true },
        ...(settings.completedOnboarding ? { hasCompletedOnboarding: true } : {})
      })
    )
  }
  return seedSigningKey(dir)
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
