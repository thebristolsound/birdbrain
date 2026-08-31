import { describe, it, expect, afterEach, vi } from 'vitest'
import { accelerator, modifierLabel } from '@renderer/lib/accelerator'
import { MAC_PLATFORM, restorePlatform, stubPlatform } from '../platformStub'

// Order matters: the navigator has to be back before the platform stub on it
// can be undone.
afterEach(() => {
  vi.unstubAllGlobals()
  restorePlatform()
})

describe('modifierLabel', () => {
  it('names Ctrl on Windows and on Linux', () => {
    stubPlatform('Win32')
    expect(modifierLabel()).toBe('Ctrl')
    stubPlatform('Linux x86_64')
    expect(modifierLabel()).toBe('Ctrl')
  })

  it('names the Command glyph on macOS', () => {
    stubPlatform(MAC_PLATFORM)
    expect(modifierLabel()).toBe('⌘')
  })

  it('reads the platform case-insensitively', () => {
    stubPlatform('macintel')
    expect(modifierLabel()).toBe('⌘')
  })

  // jsdom's own value, and the answer any browser that has stopped reporting
  // the deprecated property would give.
  it('falls back to Ctrl when the platform is unreported', () => {
    stubPlatform('')
    expect(modifierLabel()).toBe('Ctrl')
  })

  // The module sits under `src/renderer`, but nothing stops a main-process or
  // node-environment import from reaching it transitively.
  it('falls back to Ctrl where there is no navigator at all', () => {
    vi.stubGlobal('navigator', undefined)
    expect(modifierLabel()).toBe('Ctrl')
  })
})

describe('accelerator', () => {
  it('joins with a plus off macOS and sets the glyph flush on it', () => {
    stubPlatform('Win32')
    expect(accelerator('K')).toBe('Ctrl+K')
    stubPlatform(MAC_PLATFORM)
    expect(accelerator('K')).toBe('⌘K')
  })

  it('takes the separator a site already reads with', () => {
    stubPlatform('Win32')
    expect(accelerator('F', { join: ' ' })).toBe('Ctrl F')
    expect(accelerator('click', { join: '-' })).toBe('Ctrl-click')
  })

  // A word-spelled chord needs a separator on macOS too: '⌘click' does not read
  // the way '⌘C' does.
  it('takes a macOS separator independently of the other one', () => {
    stubPlatform(MAC_PLATFORM)
    expect(accelerator('click', { macJoin: '-' })).toBe('⌘-click')
    expect(accelerator('click', { join: ' ' })).toBe('⌘click')
  })

  it('is read per call rather than cached at import', () => {
    stubPlatform('Win32')
    expect(accelerator('C')).toBe('Ctrl+C')
    stubPlatform(MAC_PLATFORM)
    expect(accelerator('C')).toBe('⌘C')
    stubPlatform('Win32')
    expect(accelerator('C')).toBe('Ctrl+C')
  })
})
