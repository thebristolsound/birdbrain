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
import { dirname } from 'path'

const require = createRequire(import.meta.url)
const sqlite3Dir = dirname(require.resolve('better-sqlite3/package.json'))
const electronVersion = require('electron/package.json').version

console.log(`Rebuilding better-sqlite3 for Electron ${electronVersion} at ${sqlite3Dir}`)

const args = [
  'node-gyp', 'rebuild',
  `--runtime=electron`,
  `--target=${electronVersion}`,
  '--dist-url=https://electronjs.org/headers'
]

const pythonPath = process.env.npm_config_python || process.env.PYTHON
if (pythonPath) {
  args.push(`--python=${pythonPath}`)
}

execFileSync('npx', args, { cwd: sqlite3Dir, stdio: 'inherit', shell: true })
