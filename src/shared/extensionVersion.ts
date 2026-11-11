// The extension's version comes from the root package.json, stamped into the
// built manifest by extension/vite.config.ts (#631). Chrome's manifest
// `version` takes one to four dot-separated integers, so a prerelease such as
// 1.0.1-beta.20 maps to 1.0.1.20 and the full string goes in `version_name`.

const MAX_PARTS = 4
const MAX_PART = 65535

// A release core of dot-separated integers, optionally followed by a single
// `-<tag>.<number>` prerelease. Anything else would need a choice about which
// identifier to keep, so it is refused rather than guessed at.
const PACKAGE_VERSION = /^(\d+(?:\.\d+)*)(?:-[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*\.(\d+))?$/

/** Maps a package.json version to the `version` Chrome accepts, or throws. */
export function chromeManifestVersion(packageVersion: string): string {
  const match = PACKAGE_VERSION.exec(packageVersion)
  if (!match) {
    throw new Error(
      `Package version "${packageVersion}" cannot be mapped to a Chrome extension version`
    )
  }
  const [, core, prerelease] = match
  const parts = prerelease === undefined ? core.split('.') : [...core.split('.'), prerelease]
  if (parts.length > MAX_PARTS) {
    throw new Error(`Package version "${packageVersion}" maps to more than four parts`)
  }
  for (const part of parts) {
    if (part.length > 1 && part.startsWith('0')) {
      throw new Error(`Package version "${packageVersion}" has a part with a leading zero`)
    }
    if (Number(part) > MAX_PART) {
      throw new Error(`Package version "${packageVersion}" has a part over ${MAX_PART}`)
    }
  }
  return parts.join('.')
}

export function stampManifestVersion<T extends object>(
  manifest: T,
  packageVersion: string
): T & { version: string; version_name: string } {
  return {
    ...manifest,
    version: chromeManifestVersion(packageVersion),
    version_name: packageVersion
  }
}

/** The build's check on the manifest it wrote: both fields must derive from the package. */
export function assertManifestMatchesPackage(
  manifest: { version?: unknown; version_name?: unknown },
  packageVersion: string
): void {
  const { version, version_name } = manifest
  const expected = chromeManifestVersion(packageVersion)
  if (version !== expected) {
    throw new Error(
      `Built manifest has version ${JSON.stringify(version)}, expected "${expected}" ` +
        `from package version "${packageVersion}"`
    )
  }
  if (version_name !== packageVersion) {
    throw new Error(
      `Built manifest has version_name ${JSON.stringify(version_name)}, ` +
        `expected "${packageVersion}"`
    )
  }
}

/** The version the extension shows and records: the full release string when stamped. */
export function extensionVersionOf(manifest: { version: string; version_name?: string }): string {
  return manifest.version_name ?? manifest.version
}
