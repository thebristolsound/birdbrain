import { mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { initSigningKey } from '@main/services/signingKey'

// appendManifestEntry signs every entry, so any test that touches the capture
// or manifest path needs an installation signing key. Production wires this up
// in index.ts at startup; this setup file is the test-runtime equivalent,
// initialized once per test file. Tests that exercise the key service itself
// (signingKey.test.ts) reset and re-init it as needed.
initSigningKey(mkdtempSync(join(tmpdir(), 'birdbrain-test-signkey-')))
