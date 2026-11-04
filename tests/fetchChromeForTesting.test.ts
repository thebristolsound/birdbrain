import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'crypto'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createStoredZip } from '@main/services/zip'
import {
  ARCHIVES,
  CHROME_FOR_TESTING_VERSION,
  archiveUrl,
  extractCommand,
  fetchChromeForTesting,
  main
  // @ts-expect-error - build script with no type declarations; the tsconfigs exclude scripts/
} from '../scripts/fetch-chrome-for-testing.mjs'

const HOST = `${process.platform}-${process.arch}`
const VERSION = '1.2.3.4'
const EXECUTABLE = 'chrome-test/chrome'
const BROWSER = 'fixture browser\n'

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

const archive = createStoredZip([
  { name: EXECUTABLE, data: BROWSER },
  { name: 'chrome-test/resources/about.txt', data: 'about\n' }
])

const pinned = (hash: string) => ({
  [HOST]: { platform: 'test64', executable: EXECUTABLE, sha256: hash }
})

const serving = (bytes: Buffer | null, status = 200) =>
  vi.fn<(url: string) => Promise<Response>>(
    async () => new Response(bytes === null ? null : new Uint8Array(bytes), { status })
  )

describe('fetch-chrome-for-testing', () => {
  let cacheDir: string
  let messages: string[]
  const log = (line: string) => messages.push(line)

  const run = (bytes: Buffer | null, hash: string, status = 200) => {
    const fetchImpl = serving(bytes, status)
    const options = {
      cacheDir,
      version: VERSION,
      archives: pinned(hash),
      fetchImpl,
      log,
      error: log
    }
    return { fetchImpl, options }
  }

  beforeEach(() => {
    cacheDir = join(mkdtempSync(join(tmpdir(), 'fetch-cft-')), 'cache')
    messages = []
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    rmSync(join(cacheDir, '..'), { recursive: true, force: true })
  })

  it('extracts the archive when its SHA-256 matches the pin', async () => {
    const { fetchImpl, options } = run(archive, sha256(archive))

    const executable = await fetchChromeForTesting(options)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(fetchImpl).toHaveBeenCalledWith(archiveUrl(VERSION, 'test64'))
    expect(executable).toBe(join(cacheDir, VERSION, EXECUTABLE))
    expect(readFileSync(executable, 'utf8')).toBe(BROWSER)
    // The downloaded archive and the staging folder are gone; only the version folder stays.
    expect(readdirSync(cacheDir)).toEqual([VERSION])
  })

  it('exits non-zero on a hash mismatch and leaves nothing extracted', async () => {
    const wrong = '0'.repeat(64)
    const { fetchImpl, options } = run(archive, wrong)

    expect(await main(options)).toBe(1)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(readdirSync(cacheDir)).toEqual([])
    expect(messages.join('\n')).toContain(`expected ${wrong}, got ${sha256(archive)}`)
  })

  // With no archive tool on PATH, extracting first would fail with "not found" instead.
  it('checks the hash before it runs the archive tool', async () => {
    vi.stubEnv('PATH', join(cacheDir, '..'))
    const { options } = run(archive, '0'.repeat(64))

    expect(await main(options)).toBe(1)

    expect(messages.join('\n')).toContain('SHA-256 mismatch')
    expect(messages.join('\n')).not.toContain('was not found on PATH')
  })

  it('exits zero without downloading when the pinned build is already in place', async () => {
    const first = run(archive, sha256(archive))
    expect(await main(first.options)).toBe(0)

    const second = run(archive, sha256(archive))
    expect(await main(second.options)).toBe(0)

    expect(second.fetchImpl).not.toHaveBeenCalled()
    expect(messages.at(-1)).toContain(join(cacheDir, VERSION, EXECUTABLE))
  })

  it('replaces a version folder that has lost its executable', async () => {
    mkdirSync(join(cacheDir, VERSION, 'chrome-test'), { recursive: true })
    const { fetchImpl, options } = run(archive, sha256(archive))

    expect(await main(options)).toBe(0)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(readFileSync(join(cacheDir, VERSION, EXECUTABLE), 'utf8')).toBe(BROWSER)
  })

  it('exits non-zero on an HTTP error and writes nothing', async () => {
    const { options } = run(null, sha256(archive), 404)

    expect(await main(options)).toBe(1)

    expect(readdirSync(cacheDir)).toEqual([])
    expect(messages.join('\n')).toContain(`HTTP 404 from ${archiveUrl(VERSION, 'test64')}`)
  })

  it('exits non-zero without downloading when nothing is pinned for this platform', async () => {
    const fetchImpl = serving(archive)

    expect(await main({ cacheDir, archives: {}, fetchImpl, log, error: log })).toBe(1)

    expect(fetchImpl).not.toHaveBeenCalled()
    expect(messages.join('\n')).toContain(`for ${HOST}`)
  })

  it('leaves no version folder when the archive lacks the pinned executable', async () => {
    const other = createStoredZip([{ name: 'chrome-test/ABOUT', data: 'about\n' }])
    const { options } = run(other, sha256(other))

    expect(await main(options)).toBe(1)

    expect(readdirSync(cacheDir)).toEqual([])
    expect(messages.join('\n')).toContain(`has no ${EXECUTABLE}`)
  })

  it('leaves no version folder when the archive tool rejects the file', async () => {
    const garbage = Buffer.from('not a zip archive')
    const { options } = run(garbage, sha256(garbage))

    expect(await main(options)).toBe(1)

    expect(readdirSync(cacheDir)).toEqual([])
    expect(messages.join('\n')).toContain('failed to extract the archive')
  })

  it('names the archive tool when it is not on PATH', async () => {
    vi.stubEnv('PATH', join(cacheDir, '..'))
    const { options } = run(archive, sha256(archive))

    expect(await main(options)).toBe(1)

    const [tool] = extractCommand(process.platform, 'a.zip', 'out')
    expect(messages.join('\n')).toContain(`\`${tool}\` was not found on PATH`)
    expect(readdirSync(cacheDir)).toEqual([])
  })
})

describe('extractCommand', () => {
  it.each(['linux', 'darwin'])('uses unzip on %s', (platform) => {
    expect(extractCommand(platform, 'a.zip', 'out')).toEqual([
      'unzip',
      ['-oq', 'a.zip', '-d', 'out']
    ])
  })

  it('uses tar on win32', () => {
    expect(extractCommand('win32', 'a.zip', 'out')).toEqual(['tar', ['-xf', 'a.zip', '-C', 'out']])
  })
})

describe('the shipped pin', () => {
  it('is the Chrome for Testing build the stage-2 probe passed on, with a SHA-256 for Linux x64', () => {
    expect(CHROME_FOR_TESTING_VERSION).toBe('149.0.7827.55')
    expect(ARCHIVES['linux-x64']).toEqual({
      platform: 'linux64',
      executable: 'chrome-linux64/chrome',
      sha256: expect.stringMatching(/^[0-9a-f]{64}$/)
    })
    expect(archiveUrl(CHROME_FOR_TESTING_VERSION, 'linux64')).toBe(
      'https://storage.googleapis.com/chrome-for-testing-public/149.0.7827.55/linux64/chrome-linux64.zip'
    )
  })
})
