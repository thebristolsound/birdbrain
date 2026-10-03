/**
 * Builds sharp's native addon against the system libvips, for the test runner only.
 *
 * On Linux, Electron links the system GLib and exposes its symbols to the whole process
 * (electron/electron#46323). sharp's prebuilt libvips bundles a different GLib, so under
 * ELECTRON_RUN_AS_NODE a call such as `sharp(buffer).metadata()` releases an object through
 * the wrong GLib and the test worker dies with SIGSEGV. An addon linked against the system
 * libvips uses the same GLib as Electron, so the two agree.
 *
 * The build goes to .cache/test-sharp/, never into node_modules, and only
 * tests/setup/system-sharp.ts loads it, when BIRDBRAIN_TEST_SYSTEM_SHARP=1. The app and every
 * package keep the prebuilt addon, so no thumbnail or other evidence output changes.
 */

import { execFileSync } from 'child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'fs'
import { createRequire } from 'module'
import { basename, dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(import.meta.url)

function fail(message) {
  console.error(`build-test-sharp: ${message}`)
  process.exit(1)
}

if (process.platform !== 'linux') {
  fail('only Linux needs this build; the crash it works around is specific to Electron on Linux')
}

const sharpEntry = require.resolve('sharp')
const sharpDir = dirname(dirname(sharpEntry))
const sharpPkg = JSON.parse(readFileSync(join(sharpDir, 'package.json'), 'utf8'))
const minimum = sharpPkg.config.libvips.replace(/^>=/, '')

let system
try {
  system = execFileSync('pkg-config', ['--modversion', 'vips-cpp'], { encoding: 'utf8' }).trim()
} catch {
  fail('no system libvips found (`pkg-config --modversion vips-cpp` failed); install libvips first')
}

const parts = (v) => v.split('.').map((n) => Number.parseInt(n, 10))
const older = (a, b) => {
  const [x, y] = [parts(a), parts(b)]
  for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0)
  return false
}
if (older(system, minimum)) {
  fail(
    `system libvips ${system} is older than the ${minimum} sharp ${sharpPkg.version} requires; upgrade it first`
  )
}

// The build reads sharp's dist/ and package.json and requires node-addon-api and detect-libc,
// so copy the whole package and point NODE_PATH at the directories its dependencies live in.
const sharpRequire = createRequire(sharpEntry)
const nodeModulesDirOf = (dep) => {
  let dir = dirname(sharpRequire.resolve(dep))
  while (basename(dir) !== 'node_modules') dir = dirname(dir)
  return dir
}
const nodePath = [...new Set(['node-addon-api', 'detect-libc', 'semver'].map(nodeModulesDirOf))]

const outDir = join(repoRoot, '.cache', 'test-sharp', 'sharp')
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
for (const entry of ['package.json', 'dist', 'src']) {
  cpSync(join(sharpDir, entry), join(outDir, entry), {
    recursive: true,
    filter: (src) => !src.includes(`${join(sharpDir, 'src', 'build')}`)
  })
}

console.log(`Building sharp ${sharpPkg.version} against system libvips ${system} in ${outDir}`)
execFileSync(
  process.execPath,
  [require.resolve('node-gyp/bin/node-gyp.js'), 'rebuild', '--directory=src'],
  {
    cwd: outDir,
    stdio: 'inherit',
    env: { ...process.env, SHARP_FORCE_GLOBAL_LIBVIPS: '1', NODE_PATH: nodePath.join(':') }
  }
)

const addon = join(
  outDir,
  'src',
  'build',
  'Release',
  `sharp-linux-${process.arch}-${sharpPkg.version}.node`
)
if (!existsSync(addon)) fail(`the build finished but ${addon} is missing`)
console.log(`Built ${addon}`)
console.log('Run the tests with it: BIRDBRAIN_TEST_SYSTEM_SHARP=1 pnpm test')
