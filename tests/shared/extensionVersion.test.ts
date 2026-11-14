import { describe, it, expect } from 'vitest'
import {
  assertManifestMatchesPackage,
  chromeManifestVersion,
  extensionVersionOf,
  stampManifestVersion
} from '@shared/extensionVersion'

describe('chromeManifestVersion', () => {
  it('appends the prerelease number to the release core', () => {
    expect(chromeManifestVersion('1.0.1-beta.20')).toBe('1.0.1.20')
    expect(chromeManifestVersion('1.0.1-beta.26')).toBe('1.0.1.26')
    expect(chromeManifestVersion('2.3.0-rc.1')).toBe('2.3.0.1')
  })

  it('leaves a plain release unchanged', () => {
    expect(chromeManifestVersion('1.0.1')).toBe('1.0.1')
    expect(chromeManifestVersion('0.0.0')).toBe('0.0.0')
    expect(chromeManifestVersion('65535.65535.65535-beta.65535')).toBe('65535.65535.65535.65535')
  })

  it('refuses more than four parts', () => {
    expect(() => chromeManifestVersion('1.2.3.4-beta.5')).toThrow(/more than four/)
    expect(() => chromeManifestVersion('1.2.3.4.5')).toThrow(/more than four/)
  })

  it('refuses a part over 65535', () => {
    expect(() => chromeManifestVersion('1.0.65536')).toThrow(/65535/)
    expect(() => chromeManifestVersion('1.0.1-beta.70000')).toThrow(/65535/)
  })

  it('refuses a part with a leading zero', () => {
    expect(() => chromeManifestVersion('1.01.0')).toThrow(/leading zero/)
    expect(() => chromeManifestVersion('1.0.1-beta.07')).toThrow(/leading zero/)
  })

  it('refuses a version it cannot map without losing what tells two releases apart', () => {
    for (const version of [
      '',
      'v1.0.1',
      '1.0.1-beta',
      '1.0.1-beta.1.2',
      '1.0.1-0',
      '1.0.1+build.5',
      '1..1',
      '1.0.-1'
    ]) {
      expect(() => chromeManifestVersion(version), version).toThrow(/cannot be mapped/)
    }
  })
})

describe('stampManifestVersion', () => {
  it('writes the mapped version and the full string, keeping every other field', () => {
    const source = { manifest_version: 3, name: 'Birdbrain Capture', version: '1.0.0' }

    expect(stampManifestVersion(source, '1.0.1-beta.26')).toEqual({
      manifest_version: 3,
      name: 'Birdbrain Capture',
      version: '1.0.1.26',
      version_name: '1.0.1-beta.26'
    })
    expect(source.version).toBe('1.0.0')
  })

  it('refuses a package version Chrome would reject', () => {
    expect(() => stampManifestVersion({ version: '1.0.0' }, '1.0.1-beta')).toThrow()
  })
})

describe('assertManifestMatchesPackage', () => {
  it('accepts a manifest stamped from the same package version', () => {
    const stamped = stampManifestVersion({ version: '1.0.0' }, '1.0.1-beta.26')

    expect(() => assertManifestMatchesPackage(stamped, '1.0.1-beta.26')).not.toThrow()
  })

  it('fails when the version disagrees with the package', () => {
    expect(() =>
      assertManifestMatchesPackage(
        { version: '1.0.0', version_name: '1.0.1-beta.26' },
        '1.0.1-beta.26'
      )
    ).toThrow(/version "1.0.0".*"1.0.1.26"/)
  })

  it('fails when the full string disagrees with the package', () => {
    expect(() =>
      assertManifestMatchesPackage(
        { version: '1.0.1.26', version_name: '1.0.1-beta.25' },
        '1.0.1-beta.26'
      )
    ).toThrow(/version_name "1.0.1-beta.25"/)
  })

  it('fails when the full string is missing', () => {
    expect(() => assertManifestMatchesPackage({ version: '1.0.1.26' }, '1.0.1-beta.26')).toThrow(
      /version_name undefined/
    )
  })
})

describe('extensionVersionOf', () => {
  it('reads the full string when the manifest carries one', () => {
    expect(extensionVersionOf({ version: '1.0.1.26', version_name: '1.0.1-beta.26' })).toBe(
      '1.0.1-beta.26'
    )
  })

  it('falls back to the version of an unstamped manifest', () => {
    expect(extensionVersionOf({ version: '1.0.0' })).toBe('1.0.0')
  })
})
