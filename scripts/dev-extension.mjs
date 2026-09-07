// Watch mode for the Chrome extension: both build targets, not just the first (#1245).
//
// `pnpm build:extension` is two Vite passes over one config file, selected by
// BUILD_TARGET: the default pass emits the ES-module background and the popup and
// options pages, and the `content` pass emits the content script as an IIFE, because
// Chrome content_scripts cannot load ES modules. A single `vite build --watch` runs
// one pass, so editing extension/src/content.ts used to need a manual full build.
//
// This starts both passes as watchers in one process, through Vite's JS API rather
// than two child processes, so the BUILD_TARGET selection happens in-process and no
// dependency for running concurrent commands is needed.
//
// The output has to stay byte-identical to a `pnpm build:extension` pass. Two rules
// hold that: the dist directory is emptied here, once, before either watcher starts,
// and both watchers then run with emptyOutDir off. Leaving it on for the default pass
// would let a background.ts rebuild delete the content script the other watcher owns.

import { rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

export const CONFIG_FILE = resolve(ROOT, 'extension/vite.config.ts')
export const OUT_DIR = resolve(ROOT, 'extension/dist')

// BUILD_TARGET values, in the order `build:extension` runs them. '' is the default
// pass; extension/vite.config.ts branches on the literal 'content'.
export const TARGETS = [
  { buildTarget: '', label: 'background, popup and options (ES modules)' },
  { buildTarget: 'content', label: 'content script (IIFE)' }
]

// emptyOutDir is off because runWatchers empties the directory once up front; see
// the note above on why the default pass must not empty it per rebuild.
export const WATCH_OVERRIDES = { build: { emptyOutDir: false, watch: {} } }

const defaultLog = (msg) => process.stdout.write(`[dev-extension] ${msg}\n`)

// build and rmDir are injected so the ordering rules above are testable without
// running Vite. Vite's build() resolves once it has loaded the config file and
// created the watcher, so awaiting each call in turn means every target reads its
// own BUILD_TARGET value before the next one is assigned.
export async function runWatchers({ build, rmDir = rm, log = defaultLog, env = process.env } = {}) {
  await rmDir(OUT_DIR, { recursive: true, force: true })
  const watchers = []
  for (const { buildTarget, label } of TARGETS) {
    env.BUILD_TARGET = buildTarget
    log(`watching ${label}`)
    watchers.push(await build({ configFile: CONFIG_FILE, ...WATCH_OVERRIDES }))
  }
  return watchers
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { build } = await import('vite')
  await runWatchers({ build })
}
