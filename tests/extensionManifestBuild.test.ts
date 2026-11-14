import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { loadConfigFromFile, type Plugin, type PluginOption, type ResolvedConfig } from 'vite'
import { chromeManifestVersion } from '@shared/extensionVersion'

const ROOT = resolve(__dirname, '..')
const CONFIG_FILE = resolve(ROOT, 'extension/vite.config.ts')

function flatten(options: PluginOption[]): Plugin[] {
  return options.flatMap((option) => {
    if (Array.isArray(option)) return flatten(option)
    if (option && typeof option === 'object' && 'name' in option) return [option]
    return []
  })
}

// Runs the extension build's own asset step against a scratch outDir, so the test
// fails when the config stops stamping the manifest it writes (#726).
async function runAssetStep(outDir: string): Promise<void> {
  process.env.BUILD_TARGET = ''
  const loaded = await loadConfigFromFile(
    { command: 'build', mode: 'production' },
    CONFIG_FILE,
    ROOT
  )
  const plugin = flatten(loaded!.config.plugins ?? []).find(
    ({ name }) => name === 'copy-extension-assets'
  )
  const { configResolved, closeBundle } = plugin!
  const resolved = { root: ROOT, build: { outDir } } as ResolvedConfig
  await (configResolved as (config: ResolvedConfig) => void)(resolved)
  await (closeBundle as () => void)()
}

describe('extension build manifest (#726)', () => {
  const original = process.env.BUILD_TARGET
  let outDir: string

  beforeEach(() => {
    outDir = mkdtempSync(join(tmpdir(), 'birdbrain-ext-manifest-'))
  })

  afterEach(() => {
    rmSync(outDir, { recursive: true, force: true })
    if (original === undefined) delete process.env.BUILD_TARGET
    else process.env.BUILD_TARGET = original
  })

  it('writes the manifest stamped from the root package version', async () => {
    const { version: packageVersion } = JSON.parse(
      readFileSync(resolve(ROOT, 'package.json'), 'utf-8')
    )

    await runAssetStep(outDir)

    const { version, version_name } = JSON.parse(
      readFileSync(join(outDir, 'manifest.json'), 'utf-8')
    )
    expect(version).toBe(chromeManifestVersion(packageVersion))
    expect(version_name).toBe(packageVersion)
  })

  it('keeps every other field of the source manifest', async () => {
    const source = JSON.parse(readFileSync(resolve(ROOT, 'extension/manifest.json'), 'utf-8'))

    await runAssetStep(outDir)

    const written = JSON.parse(readFileSync(join(outDir, 'manifest.json'), 'utf-8'))
    expect(Object.keys(written).sort()).toEqual([...Object.keys(source), 'version_name'].sort())
    expect({ ...written, version: source.version, version_name: undefined }).toEqual(source)
  })
})
