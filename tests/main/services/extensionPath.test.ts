import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const isPackaged = { value: false }
const version = { value: '1.0.0-test' }
const userData = { value: '' }

const { logged } = vi.hoisted(() => ({ logged: [] as Array<{ level: string; code: string }> }))

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return isPackaged.value
    },
    getVersion: () => version.value,
    getPath: (name: string) => (name === 'userData' ? userData.value : '')
  }
}))

vi.mock('@main/services/logger', () => ({
  logger: {
    error: (_source: string, code: string) => {
      logged.push({ level: 'error', code })
      return 'log-id'
    },
    warn: (_source: string, code: string) => {
      logged.push({ level: 'warn', code })
      return 'log-id'
    },
    info: () => ''
  }
}))

// Bytes the packaged build ships under resources/extension.
function seedBundledExtension(resources: string, marker: string): string {
  const source = join(resources, 'extension')
  mkdirSync(join(source, 'icons'), { recursive: true })
  writeFileSync(join(source, 'manifest.json'), JSON.stringify({ name: 'Birdbrain', marker }))
  writeFileSync(join(source, 'background.js'), `// ${marker}`)
  writeFileSync(join(source, 'icons', 'icon-48.png'), marker)
  return source
}

// A copy an earlier launch left under user data, stamped with `stampedVersion`.
function seedExistingCopy(stampedVersion: string): string {
  const copy = join(userData.value, 'extension')
  mkdirSync(copy, { recursive: true })
  writeFileSync(join(copy, 'manifest.json'), JSON.stringify({ name: 'Birdbrain', marker: 'older' }))
  writeFileSync(join(userData.value, 'extension-version'), stampedVersion)
  return copy
}

let root = ''
let origResourcesPath = ''

function setResourcesPath(value: string): void {
  Object.defineProperty(process, 'resourcesPath', {
    value,
    writable: true,
    configurable: true
  })
}

describe('extensionPath', () => {
  beforeEach(() => {
    vi.resetModules()
    // resetModules clears the module registry but not the mock registry, so a
    // doMock('fs') from one test would otherwise still be in force in the next
    // and make it pass or fail for the wrong reason.
    vi.doUnmock('fs')
    logged.length = 0
    root = mkdtempSync(join(tmpdir(), 'birdbrain-extpath-'))
    userData.value = join(root, 'user-data')
    mkdirSync(userData.value, { recursive: true })
    isPackaged.value = false
    version.value = '1.0.0-test'
    origResourcesPath = process.resourcesPath
    setResourcesPath(join(root, 'resources'))
    delete process.env.BIRDBRAIN_USER_DATA
  })

  afterEach(() => {
    setResourcesPath(origResourcesPath)
    delete process.env.BIRDBRAIN_USER_DATA
    rmSync(root, { recursive: true, force: true })
  })

  describe('getExtensionPath', () => {
    it('returns the exact dev path when not packaged', async () => {
      const { getExtensionPath } = await import('@main/services/extensionPath')
      expect(getExtensionPath()).toBe(join(process.cwd(), 'extension', 'dist'))
    })

    it('returns the user-data copy when packaged, not the ephemeral resources path', async () => {
      isPackaged.value = true
      const { getExtensionPath } = await import('@main/services/extensionPath')
      expect(getExtensionPath()).toBe(join(userData.value, 'extension'))
      expect(getExtensionPath()).not.toContain(process.resourcesPath)
    })

    it('honours BIRDBRAIN_USER_DATA over app.getPath', async () => {
      isPackaged.value = true
      const redirected = join(root, 'redirected')
      mkdirSync(redirected, { recursive: true })
      process.env.BIRDBRAIN_USER_DATA = redirected
      const { getExtensionPath } = await import('@main/services/extensionPath')
      expect(getExtensionPath()).toBe(join(redirected, 'extension'))
    })
  })

  describe('syncPackagedExtension', () => {
    it('does nothing in dev mode', async () => {
      seedBundledExtension(process.resourcesPath, 'bundled')
      const { syncPackagedExtension } = await import('@main/services/extensionPath')
      syncPackagedExtension()
      expect(existsSync(join(userData.value, 'extension'))).toBe(false)
      expect(logged).toEqual([])
    })

    it('copies the bundled extension under user data and stamps the version', async () => {
      isPackaged.value = true
      seedBundledExtension(process.resourcesPath, 'bundled')
      const { syncPackagedExtension, extensionPathExists, getExtensionPath } =
        await import('@main/services/extensionPath')

      syncPackagedExtension()

      const copy = getExtensionPath()
      expect(readdirSync(copy).sort()).toEqual(['background.js', 'icons', 'manifest.json'])
      expect(readFileSync(join(copy, 'icons', 'icon-48.png'), 'utf-8')).toBe('bundled')
      expect(readFileSync(join(copy, 'background.js'), 'utf-8')).toBe('// bundled')
      expect(JSON.parse(readFileSync(join(copy, 'manifest.json'), 'utf-8')).marker).toBe('bundled')
      expect(readFileSync(join(userData.value, 'extension-version'), 'utf-8')).toBe('1.0.0-test')
      expect(extensionPathExists()).toBe(true)
      // Nothing beside the copy: no staging directory, no retired one.
      expect(readdirSync(userData.value).sort()).toEqual(['extension', 'extension-version'])
      expect(logged).toEqual([])
    })

    it('survives a relaunch: the copy is left alone when the stamp matches', async () => {
      isPackaged.value = true
      seedBundledExtension(process.resourcesPath, 'bundled')
      const { syncPackagedExtension, getExtensionPath } =
        await import('@main/services/extensionPath')
      syncPackagedExtension()
      writeFileSync(join(getExtensionPath(), 'user-edit.txt'), 'kept')

      // Second launch: the AppImage mount is a different directory every time.
      const remount = join(root, 'resources-remount')
      seedBundledExtension(remount, 'bundled')
      setResourcesPath(remount)
      syncPackagedExtension()

      expect(existsSync(join(getExtensionPath(), 'user-edit.txt'))).toBe(true)
    })

    it('refreshes the copy when the stamp is from another version', async () => {
      isPackaged.value = true
      seedBundledExtension(process.resourcesPath, 'v1')
      const { syncPackagedExtension, getExtensionPath, extensionPathExists } =
        await import('@main/services/extensionPath')
      syncPackagedExtension()
      const copy = getExtensionPath()
      writeFileSync(join(copy, 'stale-file.js'), 'from the old version')

      rmSync(join(process.resourcesPath, 'extension'), { recursive: true, force: true })
      seedBundledExtension(process.resourcesPath, 'v2')
      version.value = '1.0.1-test'
      // Stale, and still advertised until the refresh replaces it.
      expect(extensionPathExists()).toBe(true)

      syncPackagedExtension()

      expect(JSON.parse(readFileSync(join(copy, 'manifest.json'), 'utf-8')).marker).toBe('v2')
      expect(existsSync(join(copy, 'stale-file.js'))).toBe(false)
      expect(readFileSync(join(userData.value, 'extension-version'), 'utf-8')).toBe('1.0.1-test')
      expect(extensionPathExists()).toBe(true)
      // The replaced copy is moved aside and then removed, not left behind.
      expect(readdirSync(userData.value).sort()).toEqual(['extension', 'extension-version'])
    })

    it('refreshes the copy when the stamp is missing', async () => {
      isPackaged.value = true
      seedBundledExtension(process.resourcesPath, 'bundled')
      const { syncPackagedExtension, getExtensionPath, extensionPathExists } =
        await import('@main/services/extensionPath')
      syncPackagedExtension()
      rmSync(join(userData.value, 'extension-version'), { force: true })
      expect(extensionPathExists()).toBe(false)

      syncPackagedExtension()

      expect(extensionPathExists()).toBe(true)
      expect(existsSync(join(getExtensionPath(), 'manifest.json'))).toBe(true)
    })

    it('leaves nothing at the advertised path when the copy fails part-way', async () => {
      isPackaged.value = true
      seedBundledExtension(process.resourcesPath, 'bundled')
      vi.doMock('fs', async () => {
        const actual = await vi.importActual<typeof import('fs')>('fs')
        return {
          ...actual,
          cpSync: (_src: string, dest: string) => {
            actual.writeFileSync(join(dest, 'half-a-file.js'), 'truncated')
            throw new Error('ENOSPC: no space left on device')
          }
        }
      })
      const { syncPackagedExtension, extensionPathExists, getExtensionPath } =
        await import('@main/services/extensionPath')

      syncPackagedExtension()

      expect(existsSync(getExtensionPath())).toBe(false)
      expect(existsSync(join(userData.value, 'extension-version'))).toBe(false)
      expect(readdirSync(userData.value)).toEqual([])
      expect(extensionPathExists()).toBe(false)
      expect(logged).toEqual([{ level: 'error', code: 'app.extension_sync_failed' }])
    })

    it('fails loudly when the bundled extension is missing', async () => {
      isPackaged.value = true
      const { syncPackagedExtension, extensionPathExists } =
        await import('@main/services/extensionPath')

      syncPackagedExtension()

      expect(extensionPathExists()).toBe(false)
      expect(logged).toEqual([{ level: 'error', code: 'app.extension_sync_failed' }])
    })

    // Root ignores the mode bits, so the sync would succeed and the assertions
    // below would be about nothing.
    it.skipIf(process.getuid?.() === 0)(
      'fails loudly on a read-only user-data directory and lets the launch continue',
      async () => {
        isPackaged.value = true
        seedBundledExtension(process.resourcesPath, 'bundled')
        const readOnly = join(root, 'read-only')
        mkdirSync(readOnly, { recursive: true, mode: 0o555 })
        userData.value = readOnly
        const { syncPackagedExtension, extensionPathExists } =
          await import('@main/services/extensionPath')

        expect(() => syncPackagedExtension()).not.toThrow()

        expect(existsSync(join(readOnly, 'extension'))).toBe(false)
        expect(extensionPathExists()).toBe(false)
        expect(logged).toEqual([{ level: 'error', code: 'app.extension_sync_failed' }])
      }
    )

    // A stamp that cannot be read used to throw out of here and into the
    // whenReady catch, which ends the launch (#1493 review).
    it('returns and logs when the stamp is a directory', async () => {
      isPackaged.value = true
      seedBundledExtension(process.resourcesPath, 'bundled')
      seedExistingCopy('1.0.0-test')
      rmSync(join(userData.value, 'extension-version'), { force: true })
      mkdirSync(join(userData.value, 'extension-version'), { recursive: true })
      const { syncPackagedExtension, extensionPathExists } =
        await import('@main/services/extensionPath')

      expect(() => syncPackagedExtension()).not.toThrow()

      expect(extensionPathExists()).toBe(false)
      expect(logged).toEqual([{ level: 'error', code: 'app.extension_sync_failed' }])
    })

    it.skipIf(process.getuid?.() === 0)(
      'returns and logs when the stamp cannot be read',
      async () => {
        isPackaged.value = true
        seedBundledExtension(process.resourcesPath, 'bundled')
        seedExistingCopy('1.0.0-test')
        chmodSync(join(userData.value, 'extension-version'), 0o000)
        const { syncPackagedExtension, extensionPathExists } =
          await import('@main/services/extensionPath')

        expect(() => syncPackagedExtension()).not.toThrow()

        expect(extensionPathExists()).toBe(false)
        expect(logged).toEqual([{ level: 'error', code: 'app.extension_sync_failed' }])
        chmodSync(join(userData.value, 'extension-version'), 0o644)
      }
    )

    // The folder Chrome has loaded stays loadable AND advertised through a
    // failed refresh; the version mismatch is reported instead (#1493 round 3).
    it('leaves the previous copy advertised when it cannot be moved aside', async () => {
      isPackaged.value = true
      seedBundledExtension(process.resourcesPath, 'v2')
      seedExistingCopy('0.9.0-test')
      vi.doMock('fs', async () => {
        const actual = await vi.importActual<typeof import('fs')>('fs')
        return {
          ...actual,
          renameSync: (src: string, dest: string) => {
            // Windows: Chrome holds handles into the folder it loaded.
            if (src === join(userData.value, 'extension')) {
              throw new Error('EPERM: operation not permitted, rename')
            }
            return actual.renameSync(src, dest)
          }
        }
      })
      const { syncPackagedExtension, extensionPathExists, getExtensionPath } =
        await import('@main/services/extensionPath')

      syncPackagedExtension()

      const copy = getExtensionPath()
      expect(JSON.parse(readFileSync(join(copy, 'manifest.json'), 'utf-8')).marker).toBe('older')
      expect(readFileSync(join(userData.value, 'extension-version'), 'utf-8')).toBe('0.9.0-test')
      expect(readdirSync(userData.value).sort()).toEqual(['extension', 'extension-version'])
      expect(extensionPathExists()).toBe(true)
      expect(logged).toEqual([
        { level: 'error', code: 'app.extension_sync_failed' },
        { level: 'error', code: 'app.extension_version_stale' }
      ])
    })

    it('puts the previous copy back when the new one cannot be swapped in', async () => {
      isPackaged.value = true
      seedBundledExtension(process.resourcesPath, 'v2')
      seedExistingCopy('0.9.0-test')
      vi.doMock('fs', async () => {
        const actual = await vi.importActual<typeof import('fs')>('fs')
        return {
          ...actual,
          renameSync: (src: string, dest: string) => {
            // Only the staging swap fails; the retire and the restore go
            // through, which is the window the JSDoc claims is covered.
            if (src.includes('extension-staging-')) {
              throw new Error('EPERM: operation not permitted, rename')
            }
            return actual.renameSync(src, dest)
          }
        }
      })
      const { syncPackagedExtension, extensionPathExists, getExtensionPath } =
        await import('@main/services/extensionPath')

      syncPackagedExtension()

      const copy = getExtensionPath()
      expect(JSON.parse(readFileSync(join(copy, 'manifest.json'), 'utf-8')).marker).toBe('older')
      expect(readFileSync(join(userData.value, 'extension-version'), 'utf-8')).toBe('0.9.0-test')
      expect(readdirSync(userData.value).sort()).toEqual(['extension', 'extension-version'])
      expect(extensionPathExists()).toBe(true)
      expect(logged).toEqual([
        { level: 'error', code: 'app.extension_sync_failed' },
        { level: 'error', code: 'app.extension_version_stale' }
      ])
    })

    it('keeps the retired bytes when the restore fails too', async () => {
      isPackaged.value = true
      seedBundledExtension(process.resourcesPath, 'v2')
      seedExistingCopy('0.9.0-test')
      vi.doMock('fs', async () => {
        const actual = await vi.importActual<typeof import('fs')>('fs')
        return {
          ...actual,
          renameSync: (src: string, dest: string) => {
            if (dest === join(userData.value, 'extension')) {
              throw new Error('EPERM: operation not permitted, rename')
            }
            return actual.renameSync(src, dest)
          }
        }
      })
      const { syncPackagedExtension, extensionPathExists, getExtensionPath } =
        await import('@main/services/extensionPath')

      syncPackagedExtension()

      expect(existsSync(getExtensionPath())).toBe(false)
      const retired = readdirSync(userData.value).filter((n) => n.startsWith('extension-retired-'))
      expect(retired).toHaveLength(1)
      expect(
        JSON.parse(readFileSync(join(userData.value, retired[0], 'manifest.json'), 'utf-8')).marker
      ).toBe('older')
      expect(extensionPathExists()).toBe(false)
      expect(logged).toEqual([
        { level: 'error', code: 'app.extension_sync_failed' },
        { level: 'error', code: 'app.extension_sync_failed' }
      ])
    })

    // The sweep runs only where this launch has a copy of its own, so the one
    // folder the operator still has is not cleared by a launch that then fails
    // to replace it (#1493 round 3).
    it('keeps a retired copy across repeated failures and clears it after a success', async () => {
      isPackaged.value = true
      seedBundledExtension(process.resourcesPath, 'v2')
      seedExistingCopy('0.9.0-test')
      vi.doMock('fs', async () => {
        const actual = await vi.importActual<typeof import('fs')>('fs')
        return {
          ...actual,
          renameSync: (src: string, dest: string) => {
            // The swap and the restore both fail, every launch.
            if (dest === join(userData.value, 'extension')) {
              throw new Error('EPERM: operation not permitted, rename')
            }
            return actual.renameSync(src, dest)
          }
        }
      })
      const failing = await import('@main/services/extensionPath')

      failing.syncPackagedExtension()
      failing.syncPackagedExtension()

      const retired = readdirSync(userData.value).filter((n) => n.startsWith('extension-retired-'))
      expect(retired).toHaveLength(1)
      expect(
        JSON.parse(readFileSync(join(userData.value, retired[0], 'manifest.json'), 'utf-8')).marker
      ).toBe('older')
      expect(failing.extensionPathExists()).toBe(false)

      vi.doUnmock('fs')
      vi.resetModules()
      const working = await import('@main/services/extensionPath')
      working.syncPackagedExtension()

      expect(readdirSync(userData.value).sort()).toEqual(['extension', 'extension-version'])
      expect(
        JSON.parse(readFileSync(join(working.getExtensionPath(), 'manifest.json'), 'utf-8')).marker
      ).toBe('v2')
      expect(working.extensionPathExists()).toBe(true)
    })

    // The guard placement is the structural half of the round-1 fix, and no
    // other test sees it: `readStamp` is total on its own, so moving the probe
    // back outside the try left every assertion green (#1493 round 2).
    it('returns and logs once when the staleness probe itself throws', async () => {
      isPackaged.value = true
      seedBundledExtension(process.resourcesPath, 'bundled')
      vi.doMock('fs', async () => {
        const actual = await vi.importActual<typeof import('fs')>('fs')
        return {
          ...actual,
          existsSync: () => {
            throw new Error('EIO: i/o error, stat')
          }
        }
      })
      const { syncPackagedExtension } = await import('@main/services/extensionPath')

      expect(() => syncPackagedExtension()).not.toThrow()

      expect(logged).toEqual([{ level: 'error', code: 'app.extension_sync_failed' }])
    })

    it('sweeps staging and retired directories left by a killed sync', async () => {
      isPackaged.value = true
      seedBundledExtension(process.resourcesPath, 'bundled')
      for (const leftover of ['extension-staging-aaaaaa', 'extension-retired-bbbbbb']) {
        mkdirSync(join(userData.value, leftover), { recursive: true })
        writeFileSync(join(userData.value, leftover, 'manifest.json'), '{}')
      }
      const { syncPackagedExtension } = await import('@main/services/extensionPath')

      syncPackagedExtension()

      expect(readdirSync(userData.value).sort()).toEqual(['extension', 'extension-version'])
      expect(logged).toEqual([])
    })

    // Its own code at its own level: the copy below succeeded, so telling the
    // operator the folder could not be prepared would be wrong (#1493 round 2).
    it('warns and still copies when the sweep cannot read the user data directory', async () => {
      isPackaged.value = true
      seedBundledExtension(process.resourcesPath, 'bundled')
      vi.doMock('fs', async () => {
        const actual = await vi.importActual<typeof import('fs')>('fs')
        return {
          ...actual,
          readdirSync: () => {
            throw new Error('EACCES: permission denied, scandir')
          }
        }
      })
      const { syncPackagedExtension, extensionPathExists } =
        await import('@main/services/extensionPath')

      syncPackagedExtension()

      expect(extensionPathExists()).toBe(true)
      expect(logged).toEqual([{ level: 'warn', code: 'app.extension_sweep_failed' }])
    })
  })

  describe('extensionPathExists', () => {
    it('returns true when the dev extension directory exists', async () => {
      vi.doMock('fs', async () => {
        const actual = await vi.importActual<typeof import('fs')>('fs')
        return { ...actual, existsSync: vi.fn().mockReturnValue(true) }
      })
      const { extensionPathExists } = await import('@main/services/extensionPath')
      expect(extensionPathExists()).toBe(true)
    })

    it('returns false when the dev extension directory does not exist', async () => {
      vi.doMock('fs', async () => {
        const actual = await vi.importActual<typeof import('fs')>('fs')
        return { ...actual, existsSync: vi.fn().mockReturnValue(false) }
      })
      const { extensionPathExists } = await import('@main/services/extensionPath')
      expect(extensionPathExists()).toBe(false)
    })

    // The ruled predicate (#1493 round 3): the channels ask whether there is a
    // copy Chrome can load, not whether it matches this build. Taking a working
    // folder away over a version mismatch is the breakage #653 is about.
    it('advertises a consistent copy left by an earlier version', async () => {
      isPackaged.value = true
      seedExistingCopy('0.9.0-test')
      const { extensionPathExists } = await import('@main/services/extensionPath')
      expect(extensionPathExists()).toBe(true)
    })

    // The IPC handlers gate on this, and the handle() wrapper rethrows anything
    // that is not an IpcFailure — so a throw here is a rejected channel instead
    // of the EXT_NOT_FOUND the handlers exist to return (#1493 review).
    it('reports false rather than throwing when the stamp cannot be read', async () => {
      isPackaged.value = true
      seedExistingCopy('1.0.0-test')
      rmSync(join(userData.value, 'extension-version'), { force: true })
      mkdirSync(join(userData.value, 'extension-version'), { recursive: true })
      const { extensionPathExists } = await import('@main/services/extensionPath')
      expect(extensionPathExists()).toBe(false)
    })

    it('returns false when the copy has a matching stamp but no manifest', async () => {
      isPackaged.value = true
      mkdirSync(join(userData.value, 'extension'), { recursive: true })
      writeFileSync(join(userData.value, 'extension-version'), '1.0.0-test')
      const { extensionPathExists } = await import('@main/services/extensionPath')
      expect(extensionPathExists()).toBe(false)
    })
  })
})
