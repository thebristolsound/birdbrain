/**
 * Rebuilds better-sqlite3 for Electron's Node runtime.
 *
 * electron-builder install-app-deps doesn't work with pnpm's .pnpm store
 * (it rebuilds at the symlink, not the actual hardlinked location). This
 * script uses require.resolve to find the real module path so the rebuild
 * targets the correct binary.
 */

import { execFileSync } from 'child_process'
import { createRequire } from 'module'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const require = createRequire(import.meta.url)
const sqlite3Dir = dirname(require.resolve('better-sqlite3/package.json'))
const electronVersion = require('electron/package.json').version

console.log(`Rebuilding better-sqlite3 for Electron ${electronVersion} at ${sqlite3Dir}`)

// Resolve node-gyp explicitly: npx walks up from the module dir and can pick
// up an old transitive copy from pnpm's hidden hoist (node-gyp <12 cannot
// detect Visual Studio 2026 on current windows-latest runners).
const nodeGypBin = require.resolve('node-gyp/bin/node-gyp.js')

const args = [
  nodeGypBin, 'rebuild',
  `--runtime=electron`,
  `--target=${electronVersion}`,
  '--dist-url=https://electronjs.org/headers'
]

const pythonPath = process.env.PYTHON_PATH || process.env.npm_config_python
if (pythonPath) {
  console.log(`Using Python: ${pythonPath}`)
  args.push(`--python=${pythonPath}`)
}

execFileSync(process.execPath, args, { cwd: sqlite3Dir, stdio: 'inherit' })

// Linux, opt-in: rebuild the system-libvips sharp the test runner uses when
// BIRDBRAIN_TEST_SYSTEM_SHARP=1 (docs/agents/testing.md, "sharp under Electron on Linux"), so a
// fresh install or worktree does not need a separate step. A failure only warns: the test setup
// names the missing build and the command that makes it.
if (process.platform === 'linux' && process.env.BIRDBRAIN_TEST_SYSTEM_SHARP === '1') {
  try {
    execFileSync(
      process.execPath,
      [join(dirname(fileURLToPath(import.meta.url)), 'build-test-sharp.mjs')],
      { stdio: 'inherit' }
    )
  } catch {
    console.warn('Could not build the test-only sharp; run pnpm build:test-sharp to see why')
  }
}
