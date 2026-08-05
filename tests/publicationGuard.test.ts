import { describe, expect, it } from 'vitest'
import { spawnSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(__dirname, '..')

const readPackageJson = (path: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(ROOT, path), 'utf8'))

describe('registry publication guard', () => {
  it('marks the app private to npm', () => {
    expect(readPackageJson('package.json').private).toBe(true)
  })

  it('keeps the docs sub-project private to npm', () => {
    expect(readPackageJson('website/package.json').private).toBe(true)
  })

  // `private` alone is invisible to `npm publish --dry-run`: npm only reaches the
  // EPRIVATE check inside libnpmpublish, which the dry run skips. The lifecycle
  // hook is the half of the guard that fires on the rehearsal too, so losing it
  // would leave a publish attempt looking like it succeeded.
  it('fails the publish lifecycle before anything is uploaded', () => {
    const scripts = readPackageJson('package.json').scripts as Record<string, string>
    expect(scripts.prepublishOnly).toBe('node scripts/no-registry-publish.mjs')
    expect(existsSync(join(ROOT, 'scripts/no-registry-publish.mjs'))).toBe(true)
  })

  // Wiring assertions alone would still pass if npm stopped running the hook, so
  // run the rehearsal for real. This stays hermetic: the hook exits non-zero
  // before npm packs or contacts a registry, so no credentials and no network are
  // involved, and `--dry-run` means even a broken guard could not upload.
  // `--ignore-scripts=false` defeats an `ignore-scripts=true` in a developer's own
  // .npmrc, which would otherwise skip the hook and make this vacuously pass.
  it('refuses an actual `npm publish --dry-run`', () => {
    const result = spawnSync('npm', ['publish', '--dry-run', '--ignore-scripts=false'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 120_000
    })

    expect(result.error).toBeUndefined()
    expect(result.status).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toContain('Refusing to publish:')
  })
})
