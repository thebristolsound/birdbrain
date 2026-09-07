import { afterEach, describe, expect, it } from 'vitest'
import { resolve } from 'path'
import { loadConfigFromFile } from 'vite'
import {
  CONFIG_FILE,
  OUT_DIR,
  TARGETS,
  WATCH_OVERRIDES,
  runWatchers
  // @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
} from '../scripts/dev-extension.mjs'

type InlineConfig = {
  configFile: string
  build: { emptyOutDir: boolean; watch: Record<string, unknown> }
}
type BuildCall = { config: InlineConfig; buildTarget: string | undefined }

const fakes = () => {
  const removed: string[] = []
  const calls: BuildCall[] = []
  const env: Record<string, string> = {}
  const build = async (config: InlineConfig) => {
    calls.push({ config, buildTarget: env.BUILD_TARGET })
    return { close: async () => {} }
  }
  const rmDir = async (dir: string) => {
    removed.push(dir)
  }
  return { removed, calls, env, build, rmDir, log: () => {} }
}

describe('dev-extension watcher', () => {
  it('empties the dist directory once, before any watcher starts', async () => {
    const f = fakes()
    await runWatchers(f)
    expect(f.removed).toEqual([OUT_DIR])
  })

  it('runs both build targets in the order build:extension uses', async () => {
    const f = fakes()
    const watchers = await runWatchers(f)
    expect(f.calls.map((c) => c.buildTarget)).toEqual(['', 'content'])
    expect(watchers).toHaveLength(2)
  })

  it('watches with emptyOutDir off so neither pass deletes the other output', async () => {
    const f = fakes()
    await runWatchers(f)
    for (const { config } of f.calls) {
      expect(config.configFile).toBe(CONFIG_FILE)
      expect(config.build.emptyOutDir).toBe(false)
      expect(config.build.watch).toEqual({})
    }
    expect(WATCH_OVERRIDES.build.emptyOutDir).toBe(false)
  })
})

describe('extension vite config, per BUILD_TARGET', () => {
  const original = process.env.BUILD_TARGET

  afterEach(() => {
    if (original === undefined) delete process.env.BUILD_TARGET
    else process.env.BUILD_TARGET = original
  })

  const loadFor = async (buildTarget: string) => {
    process.env.BUILD_TARGET = buildTarget
    const loaded = await loadConfigFromFile(
      { command: 'build', mode: 'production' },
      CONFIG_FILE,
      resolve(__dirname, '..')
    )
    return loaded!.config.build!.rollupOptions!
  }

  // The watcher assumes the config file is re-evaluated per build() call, so the
  // second target really gets the IIFE config rather than a cached default one.
  it('selects the IIFE content build only when BUILD_TARGET is content', async () => {
    const main = await loadFor('')
    const content = await loadFor('content')

    expect(Object.keys(main.input as Record<string, string>).sort()).toEqual([
      'background',
      'options',
      'popup'
    ])
    expect(Object.keys(content.input as Record<string, string>)).toEqual(['content'])
    expect((content.output as { format?: string }).format).toBe('iife')
    expect((main.output as { format?: string }).format).toBeUndefined()
  })

  it('covers every target the watcher runs', async () => {
    expect(TARGETS.map((t: { buildTarget: string }) => t.buildTarget)).toEqual(['', 'content'])
  })
})
