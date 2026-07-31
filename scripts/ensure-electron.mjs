/**
 * Guarantees the Electron binary exists after `pnpm install`.
 *
 * Electron ships its binary via its own postinstall (`install.js`), which pnpm
 * only runs for packages listed in `onlyBuiltDependencies`. That list moved out
 * of package.json's "pnpm" field in pnpm 10.28 (see pnpm-workspace.yaml), and a
 * tree that installed while it was being ignored ends up with an empty `dist/`
 * and no `path.txt` — `pnpm test` / `pnpm dev` then die with "Electron failed to
 * install correctly". Fresh git worktrees hit this every time.
 *
 * This runs from the root postinstall, which pnpm always executes, so it repairs
 * the tree regardless of whether the dependency's own script was allowed to run.
 * It is a no-op when the binary is already present.
 *
 * Extraction does not use electron's own path: extract-zip never settles on some
 * hosts (reproducible under WSL2), which is exactly how install.js manages to
 * exit 0 having downloaded nothing. We race it against a timeout and fall back
 * to the platform's archive tool.
 */

import { execFileSync } from 'child_process'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { createRequire } from 'module'
import { dirname, join } from 'path'

const EXTRACT_TIMEOUT_MS = 60_000

const require = createRequire(import.meta.url)
const electronDir = dirname(require.resolve('electron/package.json'))
const electronRequire = createRequire(join(electronDir, 'package.json'))

const { version } = require('electron/package.json')
const distPath = join(electronDir, 'dist')

// Mirrors getPlatformPath() in electron/install.js.
function platformExecutable() {
  switch (process.platform) {
    case 'darwin':
    case 'mas':
      return 'Electron.app/Contents/MacOS/Electron'
    case 'win32':
      return 'electron.exe'
    default:
      return 'electron'
  }
}

const executable = platformExecutable()

function alreadyInstalled() {
  if (!existsSync(join(distPath, executable))) return false
  try {
    return readFileSync(join(distPath, 'version'), 'utf-8').replace(/^v/, '').trim() === version
  } catch {
    return false
  }
}

// extract-zip is the library electron itself uses; preferred when it works so we
// stay on the same code path electron tests against.
async function extractWithLibrary(zipPath) {
  const extract = electronRequire('extract-zip')
  let timer
  const timeout = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('extract-zip did not settle')), EXTRACT_TIMEOUT_MS)
  })
  try {
    await Promise.race([extract(zipPath, { dir: distPath }), timeout])
  } finally {
    clearTimeout(timer)
  }
}

// bsdtar (shipped as `tar` on Windows 10+ and macOS) reads zips; GNU tar does
// not, so Linux goes through unzip.
function extractWithCli(zipPath) {
  if (process.platform === 'win32') {
    execFileSync('tar', ['-xf', zipPath, '-C', distPath], { stdio: 'inherit' })
    return
  }
  execFileSync('unzip', ['-oq', zipPath, '-d', distPath], { stdio: 'inherit' })
}

if (alreadyInstalled()) {
  process.exit(0)
}

console.log(`Electron ${version} binary missing — fetching it`)

const { downloadArtifact } = electronRequire('@electron/get')
const zipPath = await downloadArtifact({
  version,
  artifactName: 'electron',
  checksums: require('electron/checksums.json'),
  platform: process.platform,
  arch: process.arch
})

try {
  await extractWithLibrary(zipPath)
} catch (err) {
  console.log(`  extract-zip unusable (${err.message}); falling back to the system archive tool`)
  extractWithCli(zipPath)
}

// The zip carries electron.d.ts at its root; electron expects it one level up.
const bundledTypes = join(distPath, 'electron.d.ts')
if (existsSync(bundledTypes)) {
  renameSync(bundledTypes, join(electronDir, 'electron.d.ts'))
}

// index.js resolves the binary through path.txt; without it the package throws
// even when dist/ is fully populated.
writeFileSync(join(electronDir, 'path.txt'), executable)

if (!alreadyInstalled()) {
  throw new Error(`Electron extraction finished but ${join(distPath, executable)} is still missing`)
}

console.log(`Electron ${version} ready at ${join(distPath, executable)}`)
