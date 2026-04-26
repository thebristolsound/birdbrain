import { describe, it, expect, beforeEach } from 'vitest'
import {
  resetHashOnColdLaunch,
  __COLD_LAUNCH_FLAG
} from '@renderer/lib/coldLaunchHash'

describe('resetHashOnColdLaunch', () => {
  beforeEach(() => {
    sessionStorage.clear()
    // Start each test with a non-root hash as if the window just reopened
    // where it closed last time.
    window.location.hash = '#/cases/some-case-id/notes'
  })

  it('resets the hash to #/ and sets the flag on first call (cold launch)', () => {
    expect(sessionStorage.getItem(__COLD_LAUNCH_FLAG)).toBeNull()

    resetHashOnColdLaunch()

    expect(window.location.hash).toBe('#/')
    expect(sessionStorage.getItem(__COLD_LAUNCH_FLAG)).toBe('1')
  })

  it('leaves the hash alone on subsequent calls within the same session (HMR reload)', () => {
    resetHashOnColdLaunch()
    expect(window.location.hash).toBe('#/')

    // Simulate the user navigating somewhere after boot, then a dev HMR reload
    // that re-executes the router module.
    window.location.hash = '#/cases/abc/selectors'
    resetHashOnColdLaunch()

    expect(window.location.hash).toBe('#/cases/abc/selectors')
  })

  it('resets the hash again after sessionStorage is cleared (next cold launch)', () => {
    resetHashOnColdLaunch()
    window.location.hash = '#/settings'

    // Simulate a fresh cold launch — Electron clears sessionStorage when the
    // window closes.
    sessionStorage.clear()
    resetHashOnColdLaunch()

    expect(window.location.hash).toBe('#/')
  })
})
