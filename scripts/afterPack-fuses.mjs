// electron-builder afterPack hook: flip Electron fuses on the packaged binary
// (issue #88). Runs before code signing so the flips don't invalidate the
// signature. Disables the Node.js escape hatches a packaged app should never
// honor and turns on ASAR integrity enforcement.
import { flipFuses, FuseVersion, FuseV1Options } from '@electron/fuses'
import path from 'node:path'

export default async function afterPack(context) {
  const { appOutDir, packager, electronPlatformName } = context
  const executableName = packager.appInfo.productFilename

  let electronBinaryPath
  if (electronPlatformName === 'darwin') {
    electronBinaryPath = path.join(
      appOutDir,
      `${executableName}.app`,
      'Contents',
      'MacOS',
      executableName
    )
  } else if (electronPlatformName === 'win32') {
    electronBinaryPath = path.join(appOutDir, `${executableName}.exe`)
  } else {
    electronBinaryPath = path.join(appOutDir, executableName)
  }

  await flipFuses(electronBinaryPath, {
    version: FuseVersion.V1,
    // macOS binaries carry an ad-hoc signature that flipping invalidates;
    // reset it so subsequent signing/notarization starts from a valid state.
    resetAdHocDarwinSignature: electronPlatformName === 'darwin',
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.EnableCookieEncryption]: true
  })

  console.log(`  • flipped Electron fuses on ${electronBinaryPath}`)
}
