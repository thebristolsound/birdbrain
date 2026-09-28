// Writes out/THIRD_PARTY_NOTICES.txt, the third-party notice the packaged app carries as a plain
// file in its resources folder (package.json build.extraResources), or exits 1 without writing it
// when a package has no licence text (#1364). Every `package*` script runs this before
// electron-builder, and CI's build job runs it as well, so a gap shows on the pull request that
// brings in the package rather than first at release. CI runs on Linux, so it sees only the
// platform packages Linux installs.
//
// The package list is `pnpm licenses list --prod --json`. That list leaves out packages installed
// for a CPU other than this machine's, while pnpm-workspace.yaml installs both the x64 and the
// arm64 builds of sharp's native packages and electron-builder packs both. So the optional
// dependencies of listed packages, and the dependencies of those, are looked up on disk, and the
// ones installed are added.
//
// A package's licence text is every file at its root named like LICENSE, LICENCE, COPYING, NOTICE
// or THIRD_PARTY_LICENSES. A package with none takes its text from overrides.json, keyed by
// package name; an entry marked `append` adds to the text a package does carry. A package with
// neither is a gap, and a gap fails the run. `vendored` entries in the same file cover source
// code kept in this repository rather than installed.
//
// Usage: node scripts/third-party-notices/notices.mjs

import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const ROOT = resolve(HERE, '..', '..')
export const OVERRIDES_FILE = join(HERE, 'overrides.json')
export const TEXTS_DIR = join(HERE, 'texts')
export const NOTICE_NAME = 'THIRD_PARTY_NOTICES.txt'
export const OUTPUT = join(ROOT, 'out', NOTICE_NAME)

const LICENCE_NAME =
  /^(licen[cs]es?|copying|notices?|unlicense|third[-_]?party[-_]?(licen[cs]es?|notices?))([.-]|$)/i
const CODE_FILE = /\.([cm]?[jt]s|json|map)$/i
const WIDTH = 80

export const isLicenceFile = (name) => LICENCE_NAME.test(name) && !CODE_FILE.test(name)

export const licenceFiles = (dir) =>
  readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && isLicenceFile(entry.name))
    .map((entry) => entry.name)
    .sort()

const BYTE_ORDER_MARK = 0xfeff

export const readText = (path) => {
  const raw = readFileSync(path, 'utf8')
  const text = raw.charCodeAt(0) === BYTE_ORDER_MARK ? raw.slice(1) : raw
  return text.replace(/\r\n?/g, '\n').trimEnd()
}

const readManifest = (dir) => JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))

const id = ({ name, version }) => `${name}@${version}`

export function runLicensesList(root, spawn = spawnSync) {
  const result = spawn('pnpm', ['licenses', 'list', '--prod', '--json'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    // On Windows pnpm is a .cmd shim, which spawn cannot execute directly. The
    // arguments are literals, so there is nothing for a shell to interpolate.
    shell: process.platform === 'win32'
  })
  if (result.error) throw new Error(`could not run pnpm licenses list: ${result.error.message}`)
  if (result.status !== 0) {
    throw new Error(`pnpm licenses list exited ${result.status}: ${result.stderr.trim()}`)
  }
  return JSON.parse(result.stdout)
}

// The report groups packages by licence, each with parallel `versions` and `paths` arrays.
export const listedPackages = (report) =>
  Object.entries(report).flatMap(([license, packages]) =>
    packages.flatMap(({ name, versions, paths, homepage }) =>
      versions.map((version, i) => ({ name, version, license, path: paths[i], homepage }))
    )
  )

// Node's lookup order for `name` required from inside `dir`, stopped at the project root so a
// package installed above the checkout is never mistaken for one this build installed.
export function locate(dir, name, root) {
  for (let at = dir; ; at = dirname(at)) {
    const candidate = join(at, 'node_modules', name)
    if (basename(at) !== 'node_modules' && existsSync(join(candidate, 'package.json'))) {
      return realpathSync(candidate)
    }
    if (at === root || dirname(at) === at) return null
  }
}

export function installedOptionals(listed, root) {
  const top = realpathSync(root)
  const listedPaths = listed.map(({ path }) => realpathSync(path))
  const known = new Set(listedPaths)
  const found = []
  const visit = (dir, names) => {
    for (const name of names) {
      const path = locate(dir, name, top)
      if (!path || known.has(path)) continue
      known.add(path)
      const manifest = readManifest(path)
      const { version, homepage, dependencies, optionalDependencies } = manifest
      const license = typeof manifest.license === 'string' ? manifest.license : 'UNKNOWN'
      found.push({ name: manifest.name, version, license, path, homepage })
      visit(path, Object.keys({ ...dependencies, ...optionalDependencies }))
    }
  }
  for (const path of listedPaths) {
    visit(path, Object.keys(readManifest(path).optionalDependencies ?? {}))
  }
  return found
}

const byNameThenVersion = (a, b) => {
  if (a.name !== b.name) return a.name < b.name ? -1 : 1
  return a.version.localeCompare(b.version, 'en', { numeric: true })
}

export function overrideProblems({ packages = {}, vendored = [] }, textsDir) {
  const problems = []
  const checkTexts = (owner, files) => {
    for (const file of files) {
      const at = join(textsDir, file)
      if (!existsSync(at) || !readText(at)) {
        problems.push(`${owner}: text ${file} is missing or empty`)
      }
    }
  }
  for (const [name, entry] of Object.entries(packages)) {
    if (!entry.note) problems.push(`${name}: the entry has no note saying why it exists`)
    if (!entry.texts?.length && !entry.packageFiles?.length) {
      problems.push(`${name}: the entry names no text`)
    }
    checkTexts(name, entry.texts ?? [])
  }
  for (const { name = 'a vendored entry', license, note, texts = [] } of vendored) {
    if (!license || !note || !texts.length) {
      problems.push(`${name}: a vendored entry needs a name, license, note and texts`)
    }
    checkTexts(name, texts)
  }
  return problems
}

const suppliedText = (textsDir) => (file) => ({ label: file, body: readText(join(textsDir, file)) })

// One entry per installed package: its own licence files, then the override's texts when it has
// none of its own or the override appends.
export function buildEntries(packages, { packages: overrides = {} }, textsDir) {
  const entries = []
  const gaps = []
  const unused = []
  const problems = []
  for (const pkg of [...packages].sort(byNameThenVersion)) {
    const own = licenceFiles(pkg.path)
    const override = overrides[pkg.name]
    if (!own.length && !override) {
      gaps.push(pkg)
      continue
    }
    const texts = own.map((file) => ({ label: file, body: readText(join(pkg.path, file)) }))
    const applies = Boolean(override) && (!own.length || Boolean(override.append))
    if (override && !applies) unused.push(pkg)
    if (applies) {
      for (const file of override.packageFiles ?? []) {
        const at = join(pkg.path, file)
        if (existsSync(at)) texts.push({ label: file, body: readText(at) })
        else problems.push(`${id(pkg)}: overrides.json names ${file}, which the package lacks`)
      }
      texts.push(...(override.texts ?? []).map(suppliedText(textsDir)))
    }
    entries.push({ ...pkg, note: applies ? override.note : undefined, texts })
  }
  return { entries, gaps, unused, problems }
}

export function wrap(text, width = WIDTH) {
  const lines = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line)
      line = word
    } else {
      line = line ? `${line} ${word}` : word
    }
  }
  if (line) lines.push(line)
  return lines
}

export function renderNotice({ product, version, license, entries, vendored }) {
  const lines = [
    `${product} ${version}: third-party notices`,
    '',
    ...wrap(
      `${product} is released under the ${license} licence. This file lists the third-party ` +
        'software in its production dependencies, with the licence text and notices each ' +
        'package carries. It is written each time the application is packaged.'
    ),
    '',
    ...wrap(
      'Where an entry has a note, some or all of its text was supplied with this file rather ' +
        'than taken from the package, and the note says why.'
    ),
    '',
    `Packages (${entries.length}):`,
    ...entries.map(({ name, version: v, license: l }) => `  ${name} ${v} (${l})`),
    '',
    `Source code included in ${product} (${vendored.length}):`,
    ...vendored.map(({ name, license: l }) => `  ${name} (${l})`)
  ]
  // Packages from one project often carry the same text byte for byte, so each distinct text is
  // printed once and later entries point back to it.
  const printed = new Map()
  const section = ({ title, license: l, homepage, note, texts }) => {
    lines.push('', '='.repeat(WIDTH), title, `License: ${l}`)
    if (homepage) lines.push(`Homepage: ${homepage}`)
    if (note) lines.push(...wrap(`Note: ${note}`))
    for (const { label, body } of texts) {
      lines.push('-'.repeat(WIDTH), label)
      if (printed.has(body)) {
        lines.push(`(The same text as printed under ${printed.get(body)} above.)`)
        continue
      }
      printed.set(body, title)
      lines.push('', body)
    }
  }
  for (const entry of entries) section({ ...entry, title: `${entry.name} ${entry.version}` })
  for (const entry of vendored) section({ ...entry, title: entry.name })
  return `${lines.join('\n')}\n`
}

export function main({
  root = ROOT,
  overridesFile = OVERRIDES_FILE,
  textsDir = TEXTS_DIR,
  output = OUTPUT,
  report = () => runLicensesList(root),
  log = console.log,
  error = console.error
} = {}) {
  // A failed run must not leave an earlier notice where electron-builder would pick it up.
  rmSync(output, { force: true })
  const fail = (problems) => {
    for (const problem of problems) error(`third-party notices: ${problem}`)
    error(`Fix ${relative(root, overridesFile)}; the header of notices.mjs says how it is read.`)
    return 1
  }
  const overrides = JSON.parse(readFileSync(overridesFile, 'utf8'))
  const invalid = overrideProblems(overrides, textsDir)
  if (invalid.length) return fail(invalid)
  const listed = listedPackages(report())
  const built = buildEntries([...listed, ...installedOptionals(listed, root)], overrides, textsDir)
  for (const pkg of built.unused) {
    log(`third-party notices: ${id(pkg)} ships licence text, so its overrides.json entry is unused`)
  }
  const gaps = built.gaps.map(
    (pkg) =>
      `${id(pkg)} (${pkg.license}) has no licence file in ${pkg.path} and no entry in overrides.json`
  )
  if (gaps.length || built.problems.length) return fail([...gaps, ...built.problems])
  const { version, license, build } = readManifest(root)
  const vendored = (overrides.vendored ?? []).map((entry) => ({
    ...entry,
    texts: entry.texts.map(suppliedText(textsDir))
  }))
  const text = renderNotice({
    product: build.productName,
    version,
    license,
    entries: built.entries,
    vendored
  })
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, text)
  log(
    `third-party notices: ${built.entries.length} packages and ${vendored.length} vendored ` +
      `source entries written to ${relative(root, output)}`
  )
  return 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main()
}
