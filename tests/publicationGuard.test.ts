import { describe, expect, it } from 'vitest'
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
})
