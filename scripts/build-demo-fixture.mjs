// Regenerates the bundled demonstration Case Archive at
// resources/demo-case.birdbrain (#405).
//
// scripts/demo-fixture/build.ts is main-process TypeScript, so it is bundled
// with esbuild (electron, better-sqlite3 and sharp stay external — they are
// native or host-provided) and handed to the real Electron binary. A real
// Electron app, not ELECTRON_RUN_AS_NODE: the generator drives a Chromium
// window to produce genuine MHTML and screenshots from the synthetic pages in
// scripts/demo-fixture/pages/.
//
// On Linux that needs a display, so the run goes through xvfb-run when one is
// not already present.

import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'out', 'demo-fixture')
const bundlePath = join(outDir, 'build.cjs')

function log(msg) {
  process.stdout.write(`[build-demo-fixture] ${msg}\n`)
}

async function bundle() {
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  await build({
    entryPoints: [join(root, 'scripts', 'demo-fixture', 'build.ts')],
    outfile: bundlePath,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    legalComments: 'none',
    external: ['electron', 'better-sqlite3', 'sharp'],
    alias: {
      '@main': join(root, 'src', 'main'),
      '@shared': join(root, 'src', 'shared')
    },
    // import.meta.url is not available in the CJS output, so the generator's
    // own source path is substituted at bundle time — it resolves `pages/` and
    // the repository root, which the bundle in out/ could not find for itself.
    define: {
      'import.meta.url': JSON.stringify(
        `file://${join(root, 'scripts', 'demo-fixture', 'build.ts')}`
      )
    }
  })
  log(`bundled -> ${bundlePath}`)
}

function runElectron() {
  const electron = join(root, 'node_modules', '.bin', 'electron')
  if (!existsSync(electron)) throw new Error(`electron not found at ${electron}`)
  const needsXvfb = process.platform === 'linux' && !process.env.DISPLAY
  const command = needsXvfb ? 'xvfb-run' : electron
  const args = needsXvfb
    ? ['--auto-servernum', electron, bundlePath, '--no-sandbox']
    : [bundlePath, '--no-sandbox']
  log(`running ${command} ${args.join(' ')}`)
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' })
  if (result.status !== 0) {
    throw new Error(`generator exited with status ${result.status ?? 'signal ' + result.signal}`)
  }
}

async function run() {
  await bundle()
  runElectron()
  log('done')
}

run().catch((err) => {
  process.stderr.write(`[build-demo-fixture] FAILED: ${err.message}\n`)
  process.exit(1)
})
