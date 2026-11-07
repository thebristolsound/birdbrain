import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterAll } from 'vitest'
import { initSigningKey } from '@main/services/signingKey'

// appendManifestEntry signs every entry, so any test that touches the capture
// or manifest path needs an installation signing key. Production wires this up
// in index.ts at startup; this setup file is the test-runtime equivalent,
// initialized once per test file. Tests that exercise the key service itself
// (signingKey.test.ts) reset and re-init it as needed.
//
// confirmUnprotectedKey: true — vitest runs via ELECTRON_RUN_AS_NODE with no
// encryption backend and no dialog to show, so the production default (which
// refuses when there is no GUI to ask through, #414) would otherwise fail
// every test file that touches the capture/manifest path.
const dir = mkdtempSync(join(tmpdir(), 'birdbrain-test-signkey-'))
initSigningKey(dir, {
  confirmUnprotectedKey: () => true
})
// One directory per test file, so it goes when the file's tests are done.
afterAll(() => rmSync(dir, { recursive: true, force: true }))
