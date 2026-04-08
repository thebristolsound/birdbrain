import { describe, it, expect, vi, beforeEach } from 'vitest'
import { join } from 'path'

vi.mock('electron', () => ({
  app: {
    isPackaged: false
  }
}))

vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    existsSync: vi.fn()
  }
})

describe('extensionPath', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })

  describe('getExtensionPath', () => {
    it('returns dev path containing extension/dist when not packaged', async () => {
      vi.doMock('electron', () => ({
        app: { isPackaged: false }
      }))
      const { getExtensionPath } = await import('../../../src/main/services/extensionPath')
      const result = getExtensionPath()
      expect(result).toContain('extension')
      expect(result).toContain('dist')
    })

    it('returns resourcesPath/extension when packaged', async () => {
      vi.doMock('electron', () => ({
        app: { isPackaged: true }
      }))
      const origResourcesPath = process.resourcesPath
      Object.defineProperty(process, 'resourcesPath', {
        value: '/mock/resources',
        writable: true,
        configurable: true
      })
      try {
        const { getExtensionPath } = await import('../../../src/main/services/extensionPath')
        const result = getExtensionPath()
        expect(result).toBe(join('/mock/resources', 'extension'))
      } finally {
        Object.defineProperty(process, 'resourcesPath', {
          value: origResourcesPath,
          writable: true,
          configurable: true
        })
      }
    })
  })

  describe('extensionPathExists', () => {
    it('returns true when the extension directory exists', async () => {
      vi.doMock('electron', () => ({
        app: { isPackaged: false }
      }))
      vi.doMock('fs', async () => {
        const actual = await vi.importActual<typeof import('fs')>('fs')
        return { ...actual, existsSync: vi.fn().mockReturnValue(true) }
      })
      const { extensionPathExists } = await import('../../../src/main/services/extensionPath')
      expect(extensionPathExists()).toBe(true)
    })

    it('returns false when the extension directory does not exist', async () => {
      vi.doMock('electron', () => ({
        app: { isPackaged: false }
      }))
      vi.doMock('fs', async () => {
        const actual = await vi.importActual<typeof import('fs')>('fs')
        return { ...actual, existsSync: vi.fn().mockReturnValue(false) }
      })
      const { extensionPathExists } = await import('../../../src/main/services/extensionPath')
      expect(extensionPathExists()).toBe(false)
    })
  })
})
