import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(__dirname, '..')

const { build } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  build: { files: string[] }
}

const positive = build.files.filter((pattern) => !pattern.startsWith('!'))
// First path segment of each positive pattern. A permissive `**/*` lands here
// as `**`, so the exact-set assertion below rejects it too.
const roots = positive.map((pattern) => pattern.split('/')[0])

// Categories, never a recorded path list: 12428 of the 12458 entries in the
// Linux build are node_modules paths and that set differs per target OS and
// architecture, so a committed baseline fails on the next runner for reasons
// that have nothing to do with this key.
const FORBIDDEN_ROOTS = ['docs', 'tests', 'e2e', 'src', '.claude', '.macroscope', '.env']

describe('electron-builder files allowlist', () => {
  // app-builder-lib's getMainFileMatchers() prepends `**/*` when
  // FileMatcher.containsOnlyIgnore() reports the list carries no positive
  // pattern. That makes an exclusion-only key additive to the defaults instead
  // of a filter: the whole project tree lands in app.asar and only the negated
  // path is trimmed (#1379). The predicate reports; the prepend is the caller's.
  it('carries at least one positive pattern', () => {
    expect(positive.length).toBeGreaterThan(0)
  })

  it('names every root the packaged app reads from', () => {
    // `out` is the electron-vite outDir behind the `main` entry point, and
    // src/main/index.ts reaches `../../resources/icon.png` from out/main.
    expect(build.files).toContain('out/**/*')
    expect(build.files).toContain('resources/**/*')
    expect(build.files).toContain('package.json')
    // Held for intent, not for effect. app-builder-lib hard-excludes the root
    // node_modules in util/filter.js and resolves production dependencies from
    // its own tree, so removing this entry yields a byte-identical archive. It
    // stays because a reader comparing this key against the packaged output
    // would otherwise ask where 12428 of the 12458 entries came from.
    expect(build.files).toContain('node_modules/**/*')
  })

  it('admits no top-level path beyond the allowlist', () => {
    for (const root of FORBIDDEN_ROOTS) expect(roots).not.toContain(root)
    expect([...new Set(roots)].sort()).toEqual(['node_modules', 'out', 'package.json', 'resources'])
  })
})
