import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'fs'
import { dirname, join } from 'path'
import { tmpdir } from 'os'
import {
  NOTICE_NAME,
  buildEntries,
  installedOptionals,
  isLicenceFile,
  licenceFiles,
  listedPackages,
  locate,
  main,
  overrideProblems,
  readText,
  renderNotice,
  runLicensesList,
  wrap
  // @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
} from '../../scripts/third-party-notices/notices.mjs'

type Spec = {
  name: string
  version: string
  license?: string
  files?: Record<string, string>
  optionalDependencies?: Record<string, string>
  dependencies?: Record<string, string>
}
type Pkg = { name: string; version: string; license: string; path: string; homepage?: string }
type Text = { label: string; body: string }
type Entry = Pkg & { note?: string; texts: Text[] }

// pnpm's layout: every package's real directory sits under node_modules/.pnpm, and its
// dependencies are symlinked beside it, one node_modules level up.
const storeDir = (root: string, name: string, version: string) =>
  join(root, 'node_modules', '.pnpm', `${name.replace('/', '+')}@${version}`, 'node_modules')

const pkgDir = (root: string, name: string, version: string) =>
  join(storeDir(root, name, version), name)

function addPackage(root: string, spec: Spec): string {
  const { name, version, license = 'MIT', files = {}, optionalDependencies, dependencies } = spec
  const dir = pkgDir(root, name, version)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name, version, license, optionalDependencies, dependencies })
  )
  for (const [file, body] of Object.entries(files)) writeFileSync(join(dir, file), body)
  return dir
}

function link(root: string, from: Spec, to: Spec) {
  const at = join(storeDir(root, from.name, from.version), to.name)
  mkdirSync(dirname(at), { recursive: true })
  symlinkSync(pkgDir(root, to.name, to.version), at, 'junction')
}

const MIT_A = 'MIT License\n\nCopyright (c) A\n'

// A sharp-shaped tree: `native` lists three platform builds as optional dependencies; the x64
// pair is in the pnpm report, the arm64 pair is installed but unreported, win32 is absent.
const native: Spec = {
  name: 'native',
  version: '1.0.0',
  license: 'Apache-2.0',
  files: { LICENSE: 'Apache text\n' },
  optionalDependencies: { '@fx/native-x64': '1.0.0', '@fx/native-arm64': '1.0.0', '@fx/win': '1' }
}
const nativeX64: Spec = {
  name: '@fx/native-x64',
  version: '1.0.0',
  license: 'Apache-2.0',
  files: { LICENSE: 'Apache text\n' },
  optionalDependencies: { '@fx/lib-x64': '1.0.0' }
}
const libX64: Spec = {
  name: '@fx/lib-x64',
  version: '1.0.0',
  license: 'LGPL-3.0-or-later',
  files: { 'README.md': '# lib x64\n\n| lib | LGPLv3 |\n' }
}
const nativeArm64: Spec = {
  name: '@fx/native-arm64',
  version: '1.0.0',
  license: 'Apache-2.0',
  files: { LICENSE: 'Apache text\n' },
  optionalDependencies: { '@fx/lib-arm64': '1.0.0' }
}
const libArm64: Spec = {
  name: '@fx/lib-arm64',
  version: '1.0.0',
  license: 'LGPL-3.0-or-later',
  files: { 'README.md': '# lib arm64\n\n| lib | LGPLv3 |\n' }
}
const plain: Spec = {
  name: 'plain',
  version: '2.0.0',
  files: { 'LICENSE.md': MIT_A, NOTICE: 'Notice text\n', 'license.js': 'code' }
}

let tmp: string
let root: string

function buildTree() {
  for (const spec of [native, nativeX64, libX64, nativeArm64, libArm64, plain]) {
    addPackage(root, spec)
  }
  link(root, native, nativeX64)
  link(root, native, nativeArm64)
  link(root, nativeX64, libX64)
  link(root, nativeArm64, libArm64)
}

const reportFor = (base: string) => ({
  'Apache-2.0': [
    { name: 'native', versions: ['1.0.0'], paths: [pkgDir(base, 'native', '1.0.0')] },
    {
      name: '@fx/native-x64',
      versions: ['1.0.0'],
      paths: [pkgDir(base, '@fx/native-x64', '1.0.0')],
      homepage: 'https://native.example'
    }
  ],
  'LGPL-3.0-or-later': [
    { name: '@fx/lib-x64', versions: ['1.0.0'], paths: [pkgDir(base, '@fx/lib-x64', '1.0.0')] }
  ],
  MIT: [{ name: 'plain', versions: ['2.0.0'], paths: [pkgDir(base, 'plain', '2.0.0')] }]
})

const libOverride = {
  note: 'The package carries no licence file.',
  packageFiles: ['README.md'],
  texts: ['LGPL.txt']
}

function writeTexts(dir: string) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'LGPL.txt'), 'LGPL text\n')
  writeFileSync(join(dir, 'MIT.txt'), 'MIT text\n')
}

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'third-party-notices-')))
  root = join(tmp, 'project')
  mkdirSync(root)
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('isLicenceFile', () => {
  it.each([
    'LICENSE',
    'license',
    'LICENSE.md',
    'LICENCE.txt',
    'LICENSE-MIT.txt',
    'LICENSE.APACHE2',
    'COPYING',
    'COPYING.LESSER',
    'NOTICE',
    'UNLICENSE',
    'THIRD_PARTY_LICENSES.md',
    'ThirdPartyNotices.txt'
  ])('takes %s', (name) => {
    expect(isLicenceFile(name)).toBe(true)
  })

  it.each([
    'licensed.txt',
    'license.js',
    'licenses.json',
    'license.d.ts',
    'README.md',
    'CopyrightNotice.txt',
    'package.json'
  ])('leaves %s', (name) => {
    expect(isLicenceFile(name)).toBe(false)
  })
})

describe('licenceFiles', () => {
  it('lists the licence files at a package root in sorted order, ignoring directories', () => {
    const dir = addPackage(root, plain)
    mkdirSync(join(dir, 'LICENSES'))
    expect(licenceFiles(dir)).toEqual(['LICENSE.md', 'NOTICE'])
  })
})

describe('readText', () => {
  it('drops a byte-order mark, converts CRLF and CR to LF, and trims the end', () => {
    const file = join(tmp, 'text.txt')
    writeFileSync(file, `${String.fromCharCode(0xfeff)}one\r\ntwo\rthree  \n\n`)
    expect(readText(file)).toBe('one\ntwo\nthree')
  })
})

describe('listedPackages', () => {
  it('yields one package per installed version, each with its own path', () => {
    const report = {
      MIT: [
        {
          name: 'entities',
          versions: ['4.5.0', '6.0.1'],
          paths: ['/a/entities@4.5.0', '/a/entities@6.0.1'],
          homepage: 'https://h'
        }
      ],
      ISC: [{ name: 'boolbase', versions: ['1.0.0'], paths: ['/a/boolbase'] }]
    }
    expect(listedPackages(report)).toEqual([
      {
        name: 'entities',
        version: '4.5.0',
        license: 'MIT',
        path: '/a/entities@4.5.0',
        homepage: 'https://h'
      },
      {
        name: 'entities',
        version: '6.0.1',
        license: 'MIT',
        path: '/a/entities@6.0.1',
        homepage: 'https://h'
      },
      { name: 'boolbase', version: '1.0.0', license: 'ISC', path: '/a/boolbase' }
    ])
  })
})

describe('locate', () => {
  it('finds a dependency pnpm linked beside the package and returns its real directory', () => {
    buildTree()
    const from = pkgDir(root, 'native', '1.0.0')
    expect(locate(from, '@fx/native-arm64', root)).toBe(pkgDir(root, '@fx/native-arm64', '1.0.0'))
  })

  it('returns null for a dependency that is not installed', () => {
    buildTree()
    expect(locate(pkgDir(root, 'native', '1.0.0'), '@fx/win', root)).toBeNull()
  })

  it('does not look above the project root', () => {
    buildTree()
    const stray = join(tmp, 'node_modules', 'stray')
    mkdirSync(stray, { recursive: true })
    writeFileSync(join(stray, 'package.json'), '{"name":"stray","version":"1.0.0"}')
    const from = pkgDir(root, 'native', '1.0.0')
    expect(locate(from, 'stray', root)).toBeNull()
    expect(locate(from, 'stray', '/nowhere')).toBe(realpathSync(stray))
  })
})

describe('installedOptionals', () => {
  it('adds optional dependencies installed beside a listed package, and their own', () => {
    buildTree()
    const found: Pkg[] = installedOptionals(listedPackages(reportFor(root)), root)
    expect(found).toEqual([
      {
        name: '@fx/native-arm64',
        version: '1.0.0',
        license: 'Apache-2.0',
        path: pkgDir(root, '@fx/native-arm64', '1.0.0'),
        homepage: undefined
      },
      {
        name: '@fx/lib-arm64',
        version: '1.0.0',
        license: 'LGPL-3.0-or-later',
        path: pkgDir(root, '@fx/lib-arm64', '1.0.0'),
        homepage: undefined
      }
    ])
  })

  it('records UNKNOWN when a found package declares no licence string', () => {
    const parent = addPackage(root, {
      name: 'parent',
      version: '1.0.0',
      optionalDependencies: { odd: '1.0.0' }
    })
    const odd = addPackage(root, { name: 'odd', version: '1.0.0' })
    writeFileSync(
      join(odd, 'package.json'),
      JSON.stringify({ name: 'odd', version: '1.0.0', license: { type: 'MIT' } })
    )
    link(root, { name: 'parent', version: '1.0.0' }, { name: 'odd', version: '1.0.0' })
    const listed = [{ name: 'parent', version: '1.0.0', license: 'MIT', path: parent }]
    expect(installedOptionals(listed, root).map((p: Pkg) => p.license)).toEqual(['UNKNOWN'])
  })
})

describe('buildEntries', () => {
  beforeEach(() => writeTexts(join(tmp, 'texts')))

  const build = (packages: Pkg[], overrides: object) =>
    buildEntries(packages, overrides, join(tmp, 'texts')) as {
      entries: Entry[]
      gaps: Pkg[]
      unused: Pkg[]
      problems: string[]
    }

  const all = () => {
    buildTree()
    const listed = listedPackages(reportFor(root))
    return [...listed, ...installedOptionals(listed, root)]
  }

  it('reports a package with no licence file and no override as a gap', () => {
    const { entries, gaps } = build(all(), { packages: {} })
    expect(gaps.map((p) => p.name)).toEqual(['@fx/lib-arm64', '@fx/lib-x64'])
    expect(entries.map((e) => `${e.name}@${e.version}`)).toEqual([
      '@fx/native-arm64@1.0.0',
      '@fx/native-x64@1.0.0',
      'native@1.0.0',
      'plain@2.0.0'
    ])
  })

  it("takes a package's own licence files first", () => {
    const { entries } = build(all(), { packages: {} })
    const entry = entries.find((e) => e.name === 'plain')!
    expect(entry.texts).toEqual([
      { label: 'LICENSE.md', body: MIT_A.trimEnd() },
      { label: 'NOTICE', body: 'Notice text' }
    ])
    expect(entry.note).toBeUndefined()
  })

  it('fills a package with no licence file from its override: package files, then texts', () => {
    const packages = { '@fx/lib-x64': libOverride, '@fx/lib-arm64': libOverride }
    const { entries, gaps, problems } = build(all(), { packages })
    expect(gaps).toEqual([])
    expect(problems).toEqual([])
    const entry = entries.find((e) => e.name === '@fx/lib-x64')!
    expect(entry.note).toBe('The package carries no licence file.')
    expect(entry.texts).toEqual([
      { label: 'README.md', body: '# lib x64\n\n| lib | LGPLv3 |' },
      { label: 'LGPL.txt', body: 'LGPL text' }
    ])
  })

  it('adds an append override after the text the package carries', () => {
    const packages = { native: { note: 'Also LGPL.', append: true, texts: ['LGPL.txt'] } }
    const { entries, unused } = build(all(), { packages })
    expect(unused).toEqual([])
    const entry = entries.find((e) => e.name === 'native')!
    expect(entry.texts.map((t) => t.label)).toEqual(['LICENSE', 'LGPL.txt'])
    expect(entry.note).toBe('Also LGPL.')
  })

  it('leaves out, and reports unused, an override for a package that now has licence text', () => {
    const packages = { plain: { note: 'Stale.', texts: ['MIT.txt'] } }
    const { entries, unused } = build(all(), { packages })
    expect(unused.map((p) => p.name)).toEqual(['plain'])
    const entry = entries.find((e) => e.name === 'plain')!
    expect(entry.texts.map((t) => t.label)).toEqual(['LICENSE.md', 'NOTICE'])
    expect(entry.note).toBeUndefined()
  })

  it('reports an override that names a file the package lacks', () => {
    const packages = { '@fx/lib-x64': { ...libOverride, packageFiles: ['COPYRIGHT.md'] } }
    const { problems } = build(all(), { packages })
    expect(problems).toEqual([
      '@fx/lib-x64@1.0.0: overrides.json names COPYRIGHT.md, which the package lacks'
    ])
  })

  it('orders versions of one package numerically', () => {
    const dirs = ['10.0.0', '9.0.0'].map((version) =>
      addPackage(root, { name: 'multi', version, files: { LICENSE: 'x' } })
    )
    const packages = dirs.map((path, i) => ({
      name: 'multi',
      version: ['10.0.0', '9.0.0'][i],
      license: 'MIT',
      path
    }))
    expect(build(packages, {}).entries.map((e) => e.version)).toEqual(['9.0.0', '10.0.0'])
  })
})

describe('overrideProblems', () => {
  const textsDir = () => join(tmp, 'texts')
  beforeEach(() => writeTexts(textsDir()))

  it('accepts a complete file', () => {
    const vendored = [{ name: 'kit', license: 'MIT', note: 'Copied in.', texts: ['MIT.txt'] }]
    expect(overrideProblems({ packages: { a: libOverride }, vendored }, textsDir())).toEqual([])
    expect(overrideProblems({}, textsDir())).toEqual([])
  })

  it('names every incomplete entry and every missing or empty text', () => {
    writeFileSync(join(textsDir(), 'empty.txt'), '  \n')
    const overrides = {
      packages: {
        quiet: { texts: ['MIT.txt'] },
        hollow: { note: 'No text.' },
        broken: { note: 'Bad texts.', texts: ['gone.txt', 'empty.txt'] }
      },
      vendored: [
        { name: 'kit', texts: [] },
        { license: 'MIT', note: 'x', texts: ['gone.txt'] }
      ]
    }
    expect(overrideProblems(overrides, textsDir())).toEqual([
      'quiet: the entry has no note saying why it exists',
      'hollow: the entry names no text',
      'broken: text gone.txt is missing or empty',
      'broken: text empty.txt is missing or empty',
      'kit: a vendored entry needs a name, license, note and texts',
      'a vendored entry: text gone.txt is missing or empty'
    ])
  })
})

describe('wrap', () => {
  it('breaks between words at the width and keeps an overlong word whole', () => {
    expect(wrap('aaa bbb ccc', 7)).toEqual(['aaa bbb', 'ccc'])
    expect(wrap('https://a-very-long-address.example tail', 10)).toEqual([
      'https://a-very-long-address.example',
      'tail'
    ])
    expect(wrap('  ')).toEqual([])
  })
})

describe('renderNotice', () => {
  const same = { label: 'LICENSE', body: 'Shared text' }
  const entries = [
    {
      name: 'a',
      version: '1.0.0',
      license: 'MIT',
      homepage: 'https://a.example',
      texts: [same]
    },
    { name: 'b', version: '2.0.0', license: 'MIT', note: 'Supplied.', texts: [same] }
  ]
  const vendored = [
    { name: 'kit', license: 'MIT', note: 'Copied in.', texts: [{ label: 'kit.txt', body: 'K' }] }
  ]
  const text: string = renderNotice({
    product: 'Fixture',
    version: '9.9.9',
    license: 'MIT',
    entries,
    vendored
  })

  it('opens with the product, its version and licence, and an index of every entry', () => {
    const lines = text.split('\n')
    expect(lines[0]).toBe('Fixture 9.9.9: third-party notices')
    expect(text).toContain('Fixture is released under the MIT licence.')
    expect(text).toContain('Packages (2):\n  a 1.0.0 (MIT)\n  b 2.0.0 (MIT)\n')
    expect(text).toContain('Source code included in Fixture (1):\n  kit (MIT)\n')
    expect(text.endsWith('\n')).toBe(true)
    expect(Math.max(...lines.map((l) => l.length))).toBeLessThanOrEqual(80)
  })

  it('prints each distinct text once and points later entries back to it', () => {
    expect(text.split('Shared text')).toHaveLength(2)
    expect(text).toContain(
      'b 2.0.0\nLicense: MIT\nNote: Supplied.\n' +
        `${'-'.repeat(80)}\nLICENSE\n(The same text as printed under a 1.0.0 above.)`
    )
    expect(text).toContain(`a 1.0.0\nLicense: MIT\nHomepage: https://a.example\n${'-'.repeat(80)}`)
  })

  it('ends with the vendored source entries', () => {
    const tail = `kit\nLicense: MIT\nNote: Copied in.\n${'-'.repeat(80)}\nkit.txt\n\nK\n`
    expect(text.endsWith(tail)).toBe(true)
  })
})

describe('runLicensesList', () => {
  type Call = { command: string; args: string[]; options: { cwd: string; shell: boolean } }

  it('asks pnpm for the production licence report and parses it', () => {
    const calls: Call[] = []
    const spawn = (command: string, args: string[], options: Call['options']) => {
      calls.push({ command, args, options })
      return { status: 0, stdout: '{"MIT":[]}', stderr: '' }
    }
    expect(runLicensesList('/repo', spawn)).toEqual({ MIT: [] })
    expect(calls).toHaveLength(1)
    expect(calls[0].command).toBe('pnpm')
    expect(calls[0].args).toEqual(['licenses', 'list', '--prod', '--json'])
    expect(calls[0].options.cwd).toBe('/repo')
    expect(calls[0].options.shell).toBe(process.platform === 'win32')
  })

  it('throws when pnpm cannot start', () => {
    const spawn = () => ({ error: new Error('spawn pnpm ENOENT') })
    expect(() => runLicensesList('/repo', spawn)).toThrow(
      'could not run pnpm licenses list: spawn pnpm ENOENT'
    )
  })

  it('throws with pnpm stderr when it exits non-zero', () => {
    const spawn = () => ({ status: 1, stdout: '', stderr: 'ERR_PNPM_NO_LOCKFILE\n' })
    expect(() => runLicensesList('/repo', spawn)).toThrow(
      'pnpm licenses list exited 1: ERR_PNPM_NO_LOCKFILE'
    )
  })
})

describe('main', () => {
  const textsDir = () => join(tmp, 'texts')
  const overridesFile = () => join(tmp, 'overrides.json')
  const output = () => join(root, 'out', NOTICE_NAME)

  const run = (packages: object) => {
    writeTexts(textsDir())
    const vendored = [{ name: 'kit', license: 'MIT', note: 'Copied in.', texts: ['MIT.txt'] }]
    writeFileSync(overridesFile(), JSON.stringify({ packages, vendored }))
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ version: '9.9.9', license: 'MIT', build: { productName: 'Fixture' } })
    )
    buildTree()
    const logged: string[] = []
    const errors: string[] = []
    const code = main({
      root,
      overridesFile: overridesFile(),
      textsDir: textsDir(),
      output: output(),
      report: () => reportFor(root),
      log: (line: string) => logged.push(line),
      error: (line: string) => errors.push(line)
    })
    return { code, logged, errors }
  }

  it('writes the notice, including installed packages the report left out, and returns 0', () => {
    const { code, logged, errors } = run({
      '@fx/lib-x64': libOverride,
      '@fx/lib-arm64': libOverride
    })
    expect(errors).toEqual([])
    expect(code).toBe(0)
    const text = readFileSync(output(), 'utf8')
    expect(text.split('\n')[0]).toBe('Fixture 9.9.9: third-party notices')
    expect(text).toContain('  @fx/lib-arm64 1.0.0 (LGPL-3.0-or-later)')
    expect(text).toContain('  @fx/native-arm64 1.0.0 (Apache-2.0)')
    expect(text).toContain('Homepage: https://native.example')
    expect(text).toContain('Source code included in Fixture (1):\n  kit (MIT)')
    expect(logged).toEqual([
      'third-party notices: 6 packages and 1 vendored source entries written to ' +
        join('out', NOTICE_NAME)
    ])
  })

  it('returns 1, names each gap, and removes an earlier notice rather than keeping it', () => {
    mkdirSync(dirname(output()), { recursive: true })
    writeFileSync(output(), 'an earlier run')
    const { code, errors } = run({ '@fx/lib-x64': libOverride })
    expect(code).toBe(1)
    expect(existsSync(output())).toBe(false)
    expect(errors[0]).toBe(
      'third-party notices: @fx/lib-arm64@1.0.0 (LGPL-3.0-or-later) has no licence file in ' +
        `${pkgDir(root, '@fx/lib-arm64', '1.0.0')} and no entry in overrides.json`
    )
    expect(errors.at(-1)).toMatch(/^Fix .*overrides\.json; the header of notices\.mjs/)
  })

  it('returns 1 on a problem in the overrides file', () => {
    const { code, errors } = run({
      '@fx/lib-x64': libOverride,
      '@fx/lib-arm64': { ...libOverride, texts: ['gone.txt'] }
    })
    expect(code).toBe(1)
    expect(errors).toEqual([
      'third-party notices: @fx/lib-arm64: text gone.txt is missing or empty',
      expect.stringMatching(/^Fix /)
    ])
  })

  it('logs an override the build no longer needs', () => {
    const { code, logged } = run({
      '@fx/lib-x64': libOverride,
      '@fx/lib-arm64': libOverride,
      plain: { note: 'Stale.', texts: ['MIT.txt'] }
    })
    expect(code).toBe(0)
    expect(logged[0]).toBe(
      'third-party notices: plain@2.0.0 ships licence text, so its overrides.json entry is unused'
    )
  })
})
