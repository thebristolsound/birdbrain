import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterAll } from 'vitest'
import { initInstallationId } from '@main/services/installationId'

// Every write of a note, tag, tag application, annotation or pin signs the row
// as this installation (#1512, workingRows.ts), so any test that writes one
// needs an installation id, as any test that appends a manifest entry needs
// a signing key (signing-key.ts). Production sets it in index.ts at startup;
// this is the test-runtime equivalent, initialized once per test file. Tests
// that exercise the id itself reset and re-init it as they need. The
// directory holds one file and goes when the file's tests are done: a worker runs many files
// and may be killed rather than exit, so an exit handler left one directory per file.
const dir = mkdtempSync(join(tmpdir(), 'birdbrain-test-installation-'))
initInstallationId(dir)
afterAll(() => rmSync(dir, { recursive: true, force: true }))
