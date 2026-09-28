import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'fs'
import { join, relative } from 'path'
import {
  NOTICE_NAME,
  OUTPUT,
  OVERRIDES_FILE,
  ROOT,
  TEXTS_DIR,
  overrideProblems
  // @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
} from '../../scripts/third-party-notices/notices.mjs'

type Override = { note: string; texts?: string[]; packageFiles?: string[]; append?: boolean }
type Vendored = { name: string; license: string; note: string; texts: string[] }
type Overrides = { packages: Record<string, Override>; vendored: Vendored[] }

const overrides = JSON.parse(readFileSync(OVERRIDES_FILE, 'utf8')) as Overrides
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>
  build: { extraResources: { from: string; to: string }[] }
}

const LIBVIPS_TEXTS = ['LGPL-3.0.txt', 'GPL-3.0.txt']

describe('the committed overrides file', () => {
  it('names only texts that exist and gives every entry a note', () => {
    expect(overrideProblems(overrides, TEXTS_DIR)).toEqual([])
  })

  it('references every text it ships, so none is dead weight', () => {
    const used = new Set([
      ...Object.values(overrides.packages).flatMap((entry) => entry.texts ?? []),
      ...overrides.vendored.flatMap((entry) => entry.texts)
    ])
    expect(readdirSync(TEXTS_DIR).sort()).toEqual([...used].sort())
  })

  // pnpm-workspace.yaml installs the x64 and arm64 variants for the host OS, so a build can pack
  // either, and pnpm's licence report names only the host CPU's.
  it.each([
    '@img/sharp-libvips-linux-x64',
    '@img/sharp-libvips-linux-arm64',
    '@img/sharp-libvips-darwin-x64',
    '@img/sharp-libvips-darwin-arm64'
  ])('fills %s with its README and the LGPL and GPL texts', (name) => {
    const entry = overrides.packages[name]
    expect(entry.packageFiles).toEqual(['README.md'])
    expect(entry.texts).toEqual(LIBVIPS_TEXTS)
    expect(entry.append).toBeUndefined()
  })

  it.each(['@img/sharp-win32-x64', '@img/sharp-win32-arm64'])(
    'adds the libvips README and the LGPL and GPL texts to the Apache text %s carries',
    (name) => {
      const entry = overrides.packages[name]
      expect(entry.append).toBe(true)
      expect(entry.packageFiles).toEqual(['README.md'])
      expect(entry.texts).toEqual(LIBVIPS_TEXTS)
    }
  )

  it('covers the production packages that ship no licence file on Linux', () => {
    for (const name of [
      '@electron-internal/extract-zip',
      '@hono/zod-validator',
      'boolbase',
      'lazy-val',
      'react-remove-scroll-bar'
    ]) {
      expect(overrides.packages[name]?.texts?.length).toBeGreaterThan(0)
    }
  })

  it('has one shadcn/ui entry, under MIT, for the shared UI folder', () => {
    expect(overrides.vendored).toHaveLength(1)
    const [entry] = overrides.vendored
    expect(entry.name).toBe('shadcn/ui')
    expect(entry.license).toBe('MIT')
    expect(entry.note).toContain('src/renderer/components/ui')
    expect(readFileSync(join(TEXTS_DIR, entry.texts[0]), 'utf8')).toMatch(/^MIT License\n/)
  })
})

describe('packaging wiring', () => {
  it('runs the generator from build:notices', () => {
    expect(pkg.scripts['build:notices']).toBe('node scripts/third-party-notices/notices.mjs')
  })

  it.each(['package', 'package:win', 'package:mac', 'package:linux'])(
    '%s writes the notice after the app build and before electron-builder',
    (script) => {
      const steps = pkg.scripts[script].split(' && ')
      const appBuild = steps.indexOf('electron-vite build')
      const notices = steps.indexOf('pnpm build:notices')
      expect(appBuild).toBeGreaterThanOrEqual(0)
      expect(notices).toBeGreaterThan(appBuild)
      expect(steps[notices + 1]).toMatch(/^electron-builder /)
    }
  )

  // extraResources puts a plain copy in the installed app's resources folder, outside app.asar,
  // the way the demo case archive ships.
  it('ships the generated notice as a plain file in the resources folder', () => {
    expect(pkg.build.extraResources).toContainEqual({
      from: relative(ROOT, OUTPUT).split('\\').join('/'),
      to: NOTICE_NAME
    })
  })

  it("runs the generator in CI's build job", () => {
    const ci = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8')
    const job = ci.slice(ci.indexOf('\n  build:\n'), ci.indexOf('\n  e2e:\n'))
    expect(job).toContain('run: pnpm build:notices')
  })
})

// The extension build copies this into extension/dist, which the release zips and the app
// carries under resources/extension.
describe('the extension notice', () => {
  const notice = readFileSync(join(ROOT, 'extension', NOTICE_NAME), 'utf8')

  it('names the font file the extension ships and points at its licence file', () => {
    const [font] = notice.match(/fonts\/[\w-]+\.woff2/) ?? []
    expect(font).toBeDefined()
    expect(existsSync(join(ROOT, 'extension', 'src', font!))).toBe(true)
    expect(notice).toContain('SIL Open Font License, Version 1.1')
    expect(notice).toContain('fonts/OFL.txt')
  })

  it('is copied into the extension build output', () => {
    const config = readFileSync(join(ROOT, 'extension', 'vite.config.ts'), 'utf8')
    expect(config).toContain(`resolve(__dirname, '${NOTICE_NAME}')`)
    expect(config).toContain(`resolve(dist, '${NOTICE_NAME}')`)
  })
})
