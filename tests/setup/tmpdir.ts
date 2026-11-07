import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// Global setup for the node project: every temporary file a test makes through tmpdir() lands
// in one directory per run, removed when the run ends. A test or setup file that forgets its
// own cleanup then cannot fill /tmp, which on 2026-11-07 held 102,000 directories leaked by
// signing-key.ts and installation-id.ts. Workers and the processes tests spawn inherit the
// variables set here. A run that is killed leaves its one directory, named to be found.
const VARIABLES = ['TMPDIR', 'TMP', 'TEMP'] as const

export default function setup(): () => void {
  const saved = VARIABLES.map((name) => [name, process.env[name]] as const)
  const dir = mkdtempSync(join(tmpdir(), 'birdbrain-test-run-'))
  for (const name of VARIABLES) process.env[name] = dir
  return () => {
    for (const [name, value] of saved) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    rmSync(dir, { recursive: true, force: true })
  }
}
