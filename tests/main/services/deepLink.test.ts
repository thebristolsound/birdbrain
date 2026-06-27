import { describe, it, expect } from 'vitest'
import { DEEP_LINK_SCHEME, parseDeepLink, findDeepLinkInArgv } from '@main/services/deepLink'

describe('deepLink', () => {
  describe('DEEP_LINK_SCHEME', () => {
    it('is birdbrain', () => {
      expect(DEEP_LINK_SCHEME).toBe('birdbrain')
    })
  })

  describe('parseDeepLink', () => {
    it('maps birdbrain://open to dashboard', () => {
      expect(parseDeepLink('birdbrain://open')).toBe('dashboard')
    })

    it('maps birdbrain://settings to settings', () => {
      expect(parseDeepLink('birdbrain://settings')).toBe('settings')
    })

    it('is case-insensitive on the host', () => {
      expect(parseDeepLink('birdbrain://Settings')).toBe('settings')
    })

    it('ignores a trailing path or slash', () => {
      expect(parseDeepLink('birdbrain://open/')).toBe('dashboard')
    })

    it('returns null for an unknown target', () => {
      expect(parseDeepLink('birdbrain://nope')).toBeNull()
    })

    it('returns null for a host-less url', () => {
      expect(parseDeepLink('birdbrain://')).toBeNull()
    })

    it('returns null for a different scheme', () => {
      expect(parseDeepLink('http://localhost:19845')).toBeNull()
    })

    it('returns null for an unparseable string', () => {
      expect(parseDeepLink('not a url')).toBeNull()
      expect(parseDeepLink('')).toBeNull()
    })
  })

  describe('findDeepLinkInArgv', () => {
    it('finds a birdbrain:// arg', () => {
      expect(findDeepLinkInArgv(['electron', '/app', 'birdbrain://open'])).toBe('birdbrain://open')
    })

    it('returns the first birdbrain:// arg when several are present', () => {
      expect(findDeepLinkInArgv(['x', 'birdbrain://settings', 'birdbrain://open'])).toBe(
        'birdbrain://settings'
      )
    })

    it('returns null when no deep link is present', () => {
      expect(findDeepLinkInArgv(['electron', '/app', '--flag'])).toBeNull()
    })
  })
})
