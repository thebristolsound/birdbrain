import { execSync } from 'child_process'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)

export function setup() {
  try {
    // require('better-sqlite3') only loads the JS wrapper.
    // The native .node binary is loaded lazily when a Database is instantiated,
    // so we must actually create one to detect version mismatches.
    const Database = require('better-sqlite3')
    const db = new Database(':memory:')
    db.close()
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('NODE_MODULE_VERSION')) {
      console.log(
        '\n[ensure-native-modules] better-sqlite3 was compiled for a different Node version, rebuilding for system Node...'
      )
      execSync('pnpm rebuild better-sqlite3', {
        stdio: 'inherit',
        cwd: process.cwd()
      })
      console.log('[ensure-native-modules] Rebuild complete.\n')
    } else {
      throw err
    }
  }
}

export function teardown() {
  try {
    execSync('npx electron-builder install-app-deps', {
      stdio: 'inherit',
      cwd: process.cwd()
    })
    console.log(
      '\n[ensure-native-modules] Restored Electron-compatible native modules.\n'
    )
  } catch (err) {
    console.warn(
      '\n[ensure-native-modules] Warning: failed to restore Electron native modules.',
      err instanceof Error ? err.message : err
    )
  }
}
