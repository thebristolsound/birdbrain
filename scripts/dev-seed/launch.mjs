// Seeding and launching for `pnpm dev:seed` (scripts/dev-seed.mjs), also used by the e2e fixture.
// Both functions take the repository root rather than finding it from import.meta: Playwright
// compiles a file the fixture imports to CommonJS, and a compiled file that reads import.meta
// fails to load.

import { build } from 'esbuild'
import electron from 'electron'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { profileLaunch } from './profile.mjs'

export const OPERATOR_NAME = 'Dev Seed Operator'

/** The command that starts the development app against the profile in `dir`. */
export function devLaunch(root, dir) {
  const { args, env } = profileLaunch(dir)
  return {
    command: process.execPath,
    // electron-vite passes everything after `--` to Electron (ELECTRON_CLI_ARGS).
    args: [
      join(root, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js'),
      'dev',
      '--',
      ...args
    ],
    env: { ...process.env, ...env }
  }
}

/**
 * Seeds a profile directory that prepareProfile has prepared. dev-seed/seed.ts is main-process
 * TypeScript, so it is bundled with esbuild and run by the Electron binary as Node
 * (ELECTRON_RUN_AS_NODE): better-sqlite3 is built against Electron's ABI. The bundle stays out of
 * out/, which electron-builder packages whole and `pnpm build` does not clear, and inside the
 * repository, so its external imports resolve from node_modules.
 */
export async function seedProfile(root, dir) {
  const bundle = join(root, '.cache', 'dev-seed', 'run.cjs')
  await build({
    entryPoints: [join(root, 'scripts', 'dev-seed', 'run.ts')],
    outfile: bundle,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    logLevel: 'warning',
    external: ['electron', 'better-sqlite3', 'sharp'],
    alias: {
      '@main': join(root, 'src', 'main'),
      '@shared': join(root, 'src', 'shared')
    }
  })
  const result = spawnSync(electron, [bundle, dir], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  })
  if (result.status !== 0) {
    throw new Error(`seed exited with status ${result.status ?? 'signal ' + result.signal}`)
  }
}
