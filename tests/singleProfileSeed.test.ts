import { describe, expect, it } from 'vitest'
import { spawnSync } from 'child_process'
import { join } from 'path'

const ROOT = join(__dirname, '..')

// Every throwaway profile gets its signing key from prepareProfile in
// scripts/dev-seed/profile.mjs. Each copy of that setup drifts on its own from the filenames and
// encodings initSigningKey reads back, and four copies had grown before they were merged.
const KEY_FILE = 'signing-key.pem'
const ALLOWED = [
  'scripts/dev-seed/profile.mjs',
  'tests/main/services/signingKey.test.ts',
  'tests/singleProfileSeed.test.ts'
]

const codeFilesNaming = (needle: string): string[] => {
  const { status, stdout, stderr } = spawnSync(
    'git',
    ['grep', '-l', '-F', needle, '--', '*.ts', '*.tsx', '*.js', '*.mjs', '*.cjs', '*.sh', ':!src/'],
    { cwd: ROOT, encoding: 'utf-8' }
  )
  // git grep exits 1 when nothing matches; anything else is a failed search, not an empty one.
  if (status !== 0 && status !== 1) throw new Error(`git grep exited ${status}: ${stderr}`)
  return stdout.split('\n').filter(Boolean)
}

describe('throwaway profile seeding', () => {
  it('names the signing key file outside the app only in the shared profile module', () => {
    const files = codeFilesNaming(KEY_FILE)
    expect(files).toContain('scripts/dev-seed/profile.mjs')
    expect(files.filter((file) => !ALLOWED.includes(file))).toEqual([])
  })
})
