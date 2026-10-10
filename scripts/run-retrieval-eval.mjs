// Builds the synthetic retrieval-evaluation Case and measures Case search on
// it (docs/plans/2026-10-09-case-retrieval-first-slice.md, D10). Arguments
// after the script name pass through: `--eval-captures=<n>` and
// `--eval-phase=build|measure|all`.
//
// scripts/retrieval-eval/build.ts is main-process TypeScript, bundled and run
// under the real Electron binary the way scripts/build-demo-fixture.mjs runs
// the demo generator, and for the same reasons: it drives a Chromium window to
// produce genuine MHTML, and a package.json beside the bundle makes
// `app.getVersion()` report this Birdbrain release. On Linux without a display
// the run goes through xvfb-run.

import { build } from 'esbuild'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const appDir = join(root, 'out', 'retrieval-eval', 'app')
const bundlePath = join(appDir, 'build.cjs')
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'))

function log(msg) {
  process.stdout.write(`[run-retrieval-eval] ${msg}\n`)
}

async function bundle() {
  rmSync(appDir, { recursive: true, force: true })
  mkdirSync(appDir, { recursive: true })
  await build({
    entryPoints: [join(root, 'scripts', 'retrieval-eval', 'build.ts')],
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
    // import.meta.url is not available in the CJS output; the generator's own
    // source path resolves `pages/` and the repository root.
    define: {
      'import.meta.url': JSON.stringify(
        `file://${join(root, 'scripts', 'retrieval-eval', 'build.ts')}`
      )
    }
  })
  writeFileSync(
    join(appDir, 'package.json'),
    `${JSON.stringify({ name: 'birdbrain-retrieval-eval', version, main: 'build.cjs' }, null, 2)}\n`
  )
  log(`bundled -> ${bundlePath} (toolVersion ${version})`)
}

function runElectron(passThrough) {
  const electron = join(root, 'node_modules', '.bin', 'electron')
  if (!existsSync(electron)) throw new Error(`electron not found at ${electron}`)
  const needsXvfb = process.platform === 'linux' && !process.env.DISPLAY
  const command = needsXvfb ? 'xvfb-run' : electron
  // Xvfb is an X server, so Electron must not follow an inherited Wayland hint.
  const electronArgs = [
    appDir,
    '--no-sandbox',
    ...(needsXvfb ? ['--ozone-platform=x11'] : []),
    ...passThrough
  ]
  const args = needsXvfb ? ['--auto-servernum', electron, ...electronArgs] : electronArgs
  log(`running ${command} ${args.join(' ')}`)
  // A shell started from an Electron host can carry ELECTRON_RUN_AS_NODE, which
  // would start the binary as plain Node with no `app` for the generator to use.
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env })
  if (result.status !== 0) {
    throw new Error(`evaluation exited with status ${result.status ?? 'signal ' + result.signal}`)
  }
}

async function run() {
  await bundle()
  runElectron(process.argv.slice(2).filter((arg) => arg.startsWith('--eval-')))
  log('done')
}

run().catch((err) => {
  process.stderr.write(`[run-retrieval-eval] FAILED: ${err.message}\n`)
  process.exit(1)
})
