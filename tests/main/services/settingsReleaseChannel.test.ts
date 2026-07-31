import { describe, it, expect } from 'vitest'
import { isPrereleaseVersion } from '@main/services/settings'

// The first-run release channel is derived from the installed build's version:
// a prerelease suffix parks new installs on beta, a clean release on stable.
// (The app.getVersion() plumbing follows the same require('electron') pattern as
// safeStorage; this covers the version → channel decision it feeds.)
describe('isPrereleaseVersion', () => {
  it.each(['1.0.1-beta.11', '2.0.0-alpha.1', '1.0.0-rc.1', '1.2.3-beta.0+build.9'])(
    'treats %s as a prerelease',
    (version) => {
      expect(isPrereleaseVersion(version)).toBe(true)
    }
  )

  it.each(['1.1.0', '1.0.0', '2.3.4+build.5', '10.0.0+20130313144700'])(
    'treats %s as a stable release',
    (version) => {
      expect(isPrereleaseVersion(version)).toBe(false)
    }
  )
})
