import { existsSync, readFileSync } from 'fs'
import { createRequire } from 'module'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

// Opt-in, Linux only: hands sharp the addon scripts/build-test-sharp.mjs built against the
// system libvips, in place of the prebuilt one. Under ELECTRON_RUN_AS_NODE, Electron's system
// GLib and the prebuilt libvips's bundled GLib collide and the worker dies with SIGSEGV
// (electron/electron#46323). See the header of scripts/build-test-sharp.mjs.
//
// sharp loads its prebuilt addon with a plain require, so registering the system build in the
// module cache under the prebuilt addon's resolved path is enough: sharp receives it and the
// prebuilt library is never loaded. Only this test process sees the swap; the app and every
// package keep the prebuilt addon. Off unless BIRDBRAIN_TEST_SYSTEM_SHARP=1.
if (process.env.BIRDBRAIN_TEST_SYSTEM_SHARP === '1') {
  if (process.platform !== 'linux') {
    throw new Error('BIRDBRAIN_TEST_SYSTEM_SHARP is for Linux only; unset it on this platform')
  }
  const require = createRequire(import.meta.url)
  const sharpEntry = require.resolve('sharp')
  const sharpDir = dirname(dirname(sharpEntry))
  const { version } = JSON.parse(readFileSync(join(sharpDir, 'package.json'), 'utf8')) as {
    version: string
  }
  const systemAddon = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../.cache/test-sharp/sharp/src/build/Release',
    `sharp-linux-${process.arch}-${version}.node`
  )
  if (!existsSync(systemAddon)) {
    throw new Error(
      `BIRDBRAIN_TEST_SYSTEM_SHARP=1 but ${systemAddon} is missing; run pnpm build:test-sharp`
    )
  }
  const prebuiltAddon = createRequire(sharpEntry).resolve(
    `@img/sharp-linux-${process.arch}/sharp.node`
  )
  if (!require.cache[prebuiltAddon]) {
    const exports: unknown = require(systemAddon)
    require.cache[prebuiltAddon] = {
      id: prebuiltAddon,
      filename: prebuiltAddon,
      path: dirname(prebuiltAddon),
      loaded: true,
      exports,
      children: [],
      paths: []
    } as unknown as NodeJS.Module
  }
}
