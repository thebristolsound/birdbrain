import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
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
    warn: () => '',
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
      expect(readFileSync(join(userData.value, 'extension-version'), 'utf-8')).toBe('1.0.0-test')
      expect(extensionPathExists()).toBe(true)
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
      expect(extensionPathExists()).toBe(false)

      syncPackagedExtension()

      expect(JSON.parse(readFileSync(join(copy, 'manifest.json'), 'utf-8')).marker).toBe('v2')
      expect(existsSync(join(copy, 'stale-file.js'))).toBe(false)
      expect(readFileSync(join(userData.value, 'extension-version'), 'utf-8')).toBe('1.0.1-test')
      expect(extensionPathExists()).toBe(true)
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

    it('returns false when the copy has a matching stamp but no manifest', async () => {
      isPackaged.value = true
      mkdirSync(join(userData.value, 'extension'), { recursive: true })
      writeFileSync(join(userData.value, 'extension-version'), '1.0.0-test')
      const { extensionPathExists } = await import('@main/services/extensionPath')
      expect(extensionPathExists()).toBe(false)
    })
  })
})
