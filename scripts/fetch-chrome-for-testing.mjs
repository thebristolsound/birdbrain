#!/usr/bin/env node
// Downloads the pinned Chrome for Testing build that the launched-browser known-answer suite
// runs against (decision D23, docs/specs/2026-10-10-capture-engine-launched-browser-design.md).
// A pass names the browser version it ran on, so the version and each archive's SHA-256 are
// pinned here.
//
// The archive is hashed before anything is extracted. Extraction goes to a staging folder that
// is renamed to .cache/chrome-for-testing/<version>/ only once the pinned executable is in it,
// so that folder exists only for a verified, complete build, and a rerun with it in place
// downloads nothing.
//
// Usage: node scripts/fetch-chrome-for-testing.mjs
// Exit codes: 0 the build is in place, 1 it is not (no pin for this platform, a failed
// download, a hash mismatch, or a failed extraction), with nothing extracted.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'

// The oldest build the stage-2 probe passed on (probe spike, "Browsers"). Moving the pin means
// changing the version and every hash below together: download each archive from archiveUrl()
// and take its `sha256sum`.
export const CHROME_FOR_TESTING_VERSION = '149.0.7827.55'

// Keyed by `${process.platform}-${process.arch}`. `platform` is Chrome for Testing's own name
// for the build, as it appears in the download URL and the archive's top folder.
export const ARCHIVES = {
  'linux-x64': {
    platform: 'linux64',
    executable: 'chrome-linux64/chrome',
    sha256: '13113b963ac22fffdad898a677591028e4397c46c1daa9e61811258eed6e35b5'
  }
}

export const CACHE_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '.cache',
  'chrome-for-testing'
)

export const archiveUrl = (version, platform) =>
  `https://storage.googleapis.com/chrome-for-testing-public/${version}/${platform}/chrome-${platform}.zip`

// The tools extractWithCli in scripts/ensure-electron.mjs uses: bsdtar (shipped as `tar` on
// Windows 10+) reads zips, GNU tar does not, so everything else goes through unzip.
export const extractCommand = (platform, archivePath, destination) =>
  platform === 'win32'
    ? ['tar', ['-xf', archivePath, '-C', destination]]
    : ['unzip', ['-oq', archivePath, '-d', destination]]

const extract = (archivePath, destination) => {
  const [tool, args] = extractCommand(process.platform, archivePath, destination)
  mkdirSync(destination, { recursive: true })
  try {
    execFileSync(tool, args, { stdio: 'inherit' })
  } catch (err) {
    if (err.code === 'ENOENT') {
      throw new Error(`\`${tool}\` was not found on PATH`, { cause: err })
    }
    throw new Error(`\`${tool}\` failed to extract the archive: ${err.message}`, { cause: err })
  }
}

// Streams the response to disk and hashes the same bytes on the way, so the archive is read
// once.
const download = async (fetchImpl, url, archivePath) => {
  const response = await fetchImpl(url)
  if (!response.ok || !response.body) {
    throw new Error(`download failed: HTTP ${response.status} from ${url}`)
  }
  const hash = createHash('sha256')
  await pipeline(
    Readable.fromWeb(response.body),
    async function* (source) {
      for await (const chunk of source) {
        hash.update(chunk)
        yield chunk
      }
    },
    createWriteStream(archivePath)
  )
  return hash.digest('hex')
}

export const fetchChromeForTesting = async ({
  cacheDir = CACHE_DIR,
  version = CHROME_FOR_TESTING_VERSION,
  archives = ARCHIVES,
  fetchImpl = fetch,
  log = console.log
} = {}) => {
  const host = `${process.platform}-${process.arch}`
  const pin = archives[host]
  if (!pin) {
    const known = Object.keys(archives).join(', ') || 'none'
    throw new Error(`no Chrome for Testing archive is pinned for ${host} (pinned: ${known})`)
  }

  const versionDir = join(cacheDir, version)
  const executable = join(versionDir, pin.executable)
  if (existsSync(executable)) {
    log(`Chrome for Testing ${version} is already at ${executable}`)
    return executable
  }

  const url = archiveUrl(version, pin.platform)
  mkdirSync(cacheDir, { recursive: true })
  const work = mkdtempSync(join(cacheDir, '.download-'))
  try {
    const archivePath = join(work, `chrome-${pin.platform}.zip`)
    log(`Downloading Chrome for Testing ${version} from ${url}`)
    const actual = await download(fetchImpl, url, archivePath)
    if (actual !== pin.sha256) {
      throw new Error(`SHA-256 mismatch for ${url}: expected ${pin.sha256}, got ${actual}`)
    }

    const staging = join(work, 'extracted')
    extract(archivePath, staging)
    if (!existsSync(join(staging, pin.executable))) {
      throw new Error(`the archive from ${url} has no ${pin.executable}`)
    }
    rmSync(versionDir, { recursive: true, force: true })
    renameSync(staging, versionDir)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }

  log(`Chrome for Testing ${version} ready at ${executable}`)
  return executable
}

export const main = async (options = {}) => {
  const { error = console.error } = options
  try {
    await fetchChromeForTesting(options)
    return 0
  } catch (err) {
    error(`fetch-chrome-for-testing: ${err.message}`)
    return 1
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main())
}
