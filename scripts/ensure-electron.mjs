/**
 * Guarantees the Electron binary exists after `pnpm install`.
 *
 * Electron ships its binary via its own postinstall (`install.js`), which pnpm
 * only runs for packages listed in `onlyBuiltDependencies`. That list moved out
 * of package.json's "pnpm" field in pnpm 10.28 (see pnpm-workspace.yaml), and a
 * tree that installed while it was being ignored ends up with an empty or
 * missing `dist/` and no `path.txt` — `pnpm test` / `pnpm dev` then die with
 * "Electron failed to install correctly". Fresh git worktrees hit this every time.
 *
 * This runs from the root postinstall, which pnpm always executes, so it repairs
 * the tree regardless of whether the dependency's own script was allowed to run.
 * It is a no-op when the binary is already present.
 *
 * Extraction prefers the platform's archive tool over electron's own extract-zip
 * path: extract-zip never settles on some hosts (reproducible under WSL2), which
 * is exactly how install.js manages to exit 0 having downloaded nothing. The
 * library stays as the fallback for hosts with no usable CLI, guarded by a
 * timeout so it cannot hang the install.
 */

import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { createRequire } from 'module'
import { dirname, join } from 'path'

const EXTRACT_TIMEOUT_MS = 60_000
// Per-gap inactivity timeout, not a wall-clock budget: a slow-but-progressing
// download is fine, a stalled socket is not (it otherwise hangs silently, since
// @electron/get's progress bar never paints when zero bytes arrive).
const DOWNLOAD_SOCKET_TIMEOUT_MS = 120_000

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

// bsdtar (shipped as `tar` on Windows 10+ and macOS) reads zips; GNU tar does
// not, so Linux goes through unzip.
function extractWithCli(zipPath) {
  const [tool, args] =
    process.platform === 'win32'
      ? ['tar', ['-xf', zipPath, '-C', distPath]]
      : ['unzip', ['-oq', zipPath, '-d', distPath]]
  mkdirSync(distPath, { recursive: true })
  try {
    execFileSync(tool, args, { stdio: 'inherit' })
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`\`${tool}\` was not found on PATH`)
    }
    throw new Error(`\`${tool}\` failed to extract the archive: ${err.message}`)
  }
}

// extract-zip is the library electron itself uses. Only reached when the system
// archive tool is unavailable, and raced against a timeout because it is the
// component that hangs.
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

// @electron/get downloads through undici fetch with no retry of its own, so one
// ECONNRESET partway through ~100MB fails the whole install — and `pnpm install`
// runs on three runners per tag in release.yml, so that can kill a release build
// after the tag is already pushed (#620). Bounded and logged: a real outage still
// fails, just after three tries instead of one.
const DOWNLOAD_ATTEMPTS = 3
const RETRY_BASE_DELAY_MS = 2_000

async function withRetry(operation) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await operation()
    } catch (err) {
      if (attempt >= DOWNLOAD_ATTEMPTS) throw err
      const delay = RETRY_BASE_DELAY_MS * attempt
      console.log(
        `  download attempt ${attempt}/${DOWNLOAD_ATTEMPTS} failed (${err.message}); ` +
          `retrying in ${delay / 1000}s`
      )
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
}

// Honour the same opt-out install.js does, so a deliberate skip is not undone here.
if (process.env['ELECTRON_SKIP_BINARY_DOWNLOAD']) {
  process.exit(0)
}

if (alreadyInstalled()) {
  process.exit(0)
}

console.log(`Electron ${version} binary missing — fetching it`)

const { downloadArtifact } = electronRequire('@electron/get')
const zipPath = await withRetry(() =>
  downloadArtifact({
    version,
    artifactName: 'electron',
    checksums: require('electron/checksums.json'),
    platform: process.platform,
    arch: process.arch,
    // Same cache knobs install.js honours.
    cacheRoot: process.env['electron_config_cache'],
    force: process.env['force_no_cache'] === 'true',
    downloadOptions: { timeout: { socket: DOWNLOAD_SOCKET_TIMEOUT_MS } }
  })
)

try {
  extractWithCli(zipPath)
} catch (err) {
  console.log(`  ${err.message}; falling back to extract-zip`)
  await extractWithLibrary(zipPath)
}

// The zip carries electron.d.ts at its root; electron expects it one level up.
const bundledTypes = join(distPath, 'electron.d.ts')
if (existsSync(bundledTypes)) {
  renameSync(bundledTypes, join(electronDir, 'electron.d.ts'))
}

if (!alreadyInstalled()) {
  throw new Error(`Electron extraction finished but ${join(distPath, executable)} is still missing`)
}

// index.js resolves the binary through path.txt without checking that it exists,
// so this is written only once dist/ is known good.
writeFileSync(join(electronDir, 'path.txt'), executable)

console.log(`Electron ${version} ready at ${join(distPath, executable)}`)
