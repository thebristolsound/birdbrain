import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { createRequire } from 'module'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
// @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
import { addonLoadError } from '../scripts/test-sharp-load.mjs'

const dirs: string[] = []
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), 'test-sharp-load-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('addonLoadError', () => {
  it.runIf(process.platform === 'linux' && process.arch === 'x64')(
    'returns null for an addon that loads',
    () => {
      const sharpEntry = require.resolve('sharp')
      const { version } = JSON.parse(
        readFileSync(join(dirname(dirname(sharpEntry)), 'package.json'), 'utf8')
      ) as { version: string }
      const prebuilt = join(
        dirname(createRequire(sharpEntry).resolve('@img/sharp-linux-x64/sharp.node')),
        'lib',
        `sharp-linux-x64-${version}.node`
      )

      expect(addonLoadError(prebuilt)).toBeNull()
    }
  )

  it('reports why a file that is not a shared library fails to load', () => {
    const addon = join(scratch(), 'broken.node')
    writeFileSync(addon, 'not an ELF file')

    const reason = addonLoadError(addon)

    expect(reason).toContain(addon)
    expect(reason).not.toMatch(/^\s*at /m)
  })

  it('reports a missing addon as a failure', () => {
    const addon = join(scratch(), 'absent.node')

    expect(addonLoadError(addon)).toContain('absent.node')
  })

  it('reports a runtime that cannot start as a failure', () => {
    expect(addonLoadError('/any.node', join(scratch(), 'no-such-node'))).toMatch(/ENOENT/)
  })
})
