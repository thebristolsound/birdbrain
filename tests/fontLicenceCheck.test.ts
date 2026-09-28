import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { execFileSync, spawnSync } from 'child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import {
  FONT_FILE,
  LICENCE_FILE,
  checkFontLicences
  // @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
} from '../scripts/font-licence-check.mjs'

const ROOT = resolve(__dirname, '..')
const SCRIPT = join(ROOT, 'scripts', 'font-licence-check.mjs')

describe('checkFontLicences', () => {
  it('passes when every font folder carries a licence file', () => {
    expect(
      checkFontLicences([
        'fonts/inter/inter-latin.woff2',
        'fonts/inter/OFL.txt',
        'fonts/mono/mono.ttf',
        'fonts/mono/LICENSE'
      ])
    ).toEqual({ folders: ['fonts/inter', 'fonts/mono'], missing: [] })
  })

  it('names each font folder that has no licence file, sorted', () => {
    expect(
      checkFontLicences(['z/b.otf', 'a/a.woff', 'a/fonts.css', 'm/OFL.txt', 'm/m.woff2']).missing
    ).toEqual(['a', 'z'])
  })

  // A licence has to sit beside the fonts it covers: one folder up or down is a
  // different folder, and would pass a font copied without its licence.
  it('does not accept a licence from a parent or child folder', () => {
    expect(
      checkFontLicences([
        'fonts/OFL.txt',
        'fonts/inter/inter.woff2',
        'fonts/mono/licence/LICENSE',
        'fonts/mono/mono.woff2'
      ]).missing
    ).toEqual(['fonts/inter', 'fonts/mono'])
  })

  it('reports a font at the repository root as the folder "."', () => {
    expect(checkFontLicences(['stray.woff2', 'README.md']).missing).toEqual(['.'])
  })

  it('passes a tree with no fonts in it', () => {
    expect(checkFontLicences(['src/index.ts', 'LICENSE'])).toEqual({ folders: [], missing: [] })
  })
})

describe('FONT_FILE', () => {
  it.each(['a.woff', 'a.woff2', 'a.ttf', 'a.otf', 'dir/A.WOFF2', 'dir/B.TTF'])(
    'treats %s as a font',
    (path) => expect(FONT_FILE.test(path)).toBe(true)
  )

  it.each(['fonts.css', 'woff2.md', 'a.woff2.map', 'a.eot', 'a.svg'])(
    'does not treat %s as a font',
    (path) => expect(FONT_FILE.test(path)).toBe(false)
  )
})

describe('LICENCE_FILE', () => {
  it.each([
    'OFL.txt',
    'OFL',
    'OFL-1.1.txt',
    'ofl.md',
    'LICENSE',
    'LICENSE.txt',
    'LICENSE.md',
    'Licence.txt',
    'COPYING'
  ])('accepts %s', (name) => expect(LICENCE_FILE.test(name)).toBe(true))

  // Near misses: the OFL FAQ is not the licence, and a stylesheet or a readme
  // beside the fonts says nothing about their terms.
  it.each(['OFL-FAQ.txt', 'README.md', 'fonts.css', 'LICENSE.woff2', 'my-LICENSE.txt'])(
    'rejects %s',
    (name) => expect(LICENCE_FILE.test(name)).toBe(false)
  )
})

// The script as the Security workflow runs it, against a throwaway repository:
// green with the licence tracked, red once the licence is removed, and green
// again when it is restored.
describe('font-licence-check CLI', () => {
  let repo: string

  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: repo,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 't',
        GIT_AUTHOR_EMAIL: 't@example.com',
        GIT_COMMITTER_NAME: 't',
        GIT_COMMITTER_EMAIL: 't@example.com',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1'
      }
    })

  const write = (rel: string, text: string) => {
    mkdirSync(join(repo, rel, '..'), { recursive: true })
    writeFileSync(join(repo, rel), text)
  }

  const run = () => {
    const result = spawnSync(process.execPath, [SCRIPT], { cwd: repo, encoding: 'utf8' })
    return { status: result.status, output: `${result.stdout}${result.stderr}` }
  }

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'font-licence-check-'))
    git('init', '-q', '-b', 'main')
    write('fonts/inter/inter-latin.woff2', 'wOF2')
    write('fonts/inter/OFL.txt', 'SIL Open Font License, Version 1.1')
    git('add', 'fonts/inter/inter-latin.woff2', 'fonts/inter/OFL.txt')
    git('commit', '-q', '-m', 'fonts with their licence')
  })

  afterEach(() => {
    rmSync(repo, { recursive: true, force: true })
  })

  it('fails with the licence removed and passes with it restored', () => {
    const tracked = run()
    expect(tracked.status).toBe(0)
    expect(tracked.output).toContain('1 tracked font folder(s), each with a licence file')

    git('rm', '-q', 'fonts/inter/OFL.txt')
    const removed = run()
    expect(removed.status).toBe(1)
    expect(removed.output).toContain('no licence file beside the fonts in fonts/inter/')

    write('fonts/inter/OFL.txt', 'SIL Open Font License, Version 1.1')
    git('add', 'fonts/inter/OFL.txt')
    expect(run().status).toBe(0)
  })

  // A licence file on disk that was never added is not in the published tree,
  // so it must not satisfy the check.
  it('ignores an untracked licence file', () => {
    git('rm', '-q', '--cached', 'fonts/inter/OFL.txt')
    expect(run().status).toBe(1)
  })
})

// The four licence files #1624 adds hold the OFL-1.1 text of the @fontsource
// packages the fonts were copied from, plus the copyright line of every family
// in the folder. extension/src/fonts belongs to #1363 and is not asserted here.
describe('committed design-font licences', () => {
  const FAMILIES = ['inter', 'jetbrains-mono']
  const upstream = (family: string) =>
    readFileSync(join(ROOT, 'node_modules', '@fontsource-variable', family, 'LICENSE'), 'utf8')
  const copyrightLine = (family: string) => upstream(family).split('\n')[0]
  const licenceBody = upstream('inter').split('\n').slice(1).join('\n')
  const exportFonts = (bundle: string) =>
    `docs/design-handoff/${bundle}/_ds/birdbrain-ui-9632b0b0-024d-4a3c-94db-688afdd4768f/fonts`

  it('rests on one OFL-1.1 body shared by both upstream packages', () => {
    expect(upstream('jetbrains-mono').split('\n').slice(1).join('\n')).toBe(licenceBody)
    expect(licenceBody).toContain('SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007')
  })

  it.each([
    '.design-sync/fonts/inter/files',
    '.design-sync/fonts/jetbrains-mono/files',
    exportFonts('2026-09-14-design-project-export'),
    exportFonts('2026-09-19-shared-case-members')
  ])('%s/OFL.txt carries the licence and each family copyright there', (folder) => {
    const fonts = readdirSync(join(ROOT, folder)).filter((name) => FONT_FILE.test(name))
    const familyOf = (name: string) => FAMILIES.find((family) => name.startsWith(`${family}-`))
    expect(fonts.length).toBeGreaterThan(0)
    expect(fonts.filter((name) => familyOf(name) === undefined)).toEqual([])

    const families = FAMILIES.filter((family) => fonts.some((name) => familyOf(name) === family))
    const text = readFileSync(join(ROOT, folder, 'OFL.txt'), 'utf8')
    expect(text).toBe(`${families.map(copyrightLine).join('\n')}\n${licenceBody}`)
  })
})
