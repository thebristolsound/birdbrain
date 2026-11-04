import { accessSync, closeSync, constants, openSync, readSync, statSync } from 'fs'
import { win32 } from 'path'
import type { BrowserFamily, LaunchedBrowserOption } from '@shared/types'

// Finding the browsers a launch can start (spec, "Browser discovery and launch"). Discovery
// only asks the file system whether a path holds an executable: it starts no browser, so a
// row carries no version until Birdbrain has launched it.

export const BROWSER_FAMILY_LABELS: Readonly<Record<BrowserFamily, string>> = {
  chrome: 'Google Chrome',
  'chrome-for-testing': 'Chrome for Testing',
  edge: 'Microsoft Edge',
  brave: 'Brave',
  chromium: 'Chromium'
}

export interface FoundBrowser {
  family: BrowserFamily
  label: string
  executablePath: string
  // True for the executable the Operator chose in Settings.
  chosen: boolean
}

interface InstallRow {
  family: Exclude<BrowserFamily, 'chrome-for-testing'>
  label: string
  path: string
}

type DiscoveryPlatform = 'linux' | 'darwin' | 'win32'

// Each product's browser program itself, never the wrapper script a package puts on PATH: a
// wrapper can add switches to the list Birdbrain owns. Stable channels only; another channel
// is an executable the Operator chooses. Sources: playwright-core 1.64.1's channel table for
// Chrome and Edge, brave-core's installer and branding files for Brave, and Debian's and
// Fedora's packages and Chromium's install constants for Chromium. Windows rows are relative to
// the per-user and Program Files folders.
export const INSTALL_LOCATIONS: Readonly<Record<DiscoveryPlatform, readonly InstallRow[]>> = {
  linux: [
    { family: 'chrome', label: 'Google Chrome', path: '/opt/google/chrome/chrome' },
    { family: 'edge', label: 'Microsoft Edge', path: '/opt/microsoft/msedge/msedge' },
    { family: 'brave', label: 'Brave', path: '/opt/brave.com/brave/brave' },
    { family: 'brave', label: 'Brave Origin', path: '/opt/brave.com/brave-origin/brave' },
    { family: 'chromium', label: 'Chromium', path: '/usr/lib/chromium/chromium' },
    { family: 'chromium', label: 'Chromium', path: '/usr/lib64/chromium-browser/chromium-browser' }
  ],
  darwin: [
    {
      family: 'chrome',
      label: 'Google Chrome',
      path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    },
    {
      family: 'edge',
      label: 'Microsoft Edge',
      path: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
    },
    {
      family: 'brave',
      label: 'Brave',
      path: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'
    },
    {
      family: 'chromium',
      label: 'Chromium',
      path: '/Applications/Chromium.app/Contents/MacOS/Chromium'
    }
  ],
  win32: [
    { family: 'chrome', label: 'Google Chrome', path: 'Google\\Chrome\\Application\\chrome.exe' },
    { family: 'edge', label: 'Microsoft Edge', path: 'Microsoft\\Edge\\Application\\msedge.exe' },
    {
      family: 'brave',
      label: 'Brave',
      path: 'BraveSoftware\\Brave-Browser\\Application\\brave.exe'
    },
    {
      family: 'brave',
      label: 'Brave Origin',
      path: 'BraveSoftware\\Brave-Origin\\Application\\brave.exe'
    },
    { family: 'chromium', label: 'Chromium', path: 'Chromium\\Application\\chrome.exe' }
  ]
}

const WINDOWS_INSTALL_ROOTS = ['LOCALAPPDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)']

export interface DiscoveryFs {
  // True for a regular file this user may run (on Windows, one that exists).
  isExecutableFile: (path: string) => boolean
  // The file's first bytes, or null when it cannot be read.
  readStart: (path: string, length: number) => Buffer | null
}

const realFs: DiscoveryFs = {
  isExecutableFile: (path) => {
    try {
      if (!statSync(path).isFile()) return false
      accessSync(path, constants.X_OK)
      return true
    } catch {
      return false
    }
  },
  readStart: (path, length) => {
    let fd: number | undefined
    try {
      fd = openSync(path, 'r')
      const buffer = Buffer.alloc(length)
      return buffer.subarray(0, readSync(fd, buffer, 0, length, 0))
    } catch {
      return null
    } finally {
      if (fd !== undefined) closeSync(fd)
    }
  }
}

export interface DiscoveryOptions {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  fs?: DiscoveryFs
}

function isDiscoveryPlatform(platform: NodeJS.Platform): platform is DiscoveryPlatform {
  return Object.hasOwn(INSTALL_LOCATIONS, platform)
}

function candidatePaths(row: InstallRow, platform: DiscoveryPlatform, env: NodeJS.ProcessEnv) {
  if (platform !== 'win32') return [row.path]
  return WINDOWS_INSTALL_ROOTS.flatMap((name) => {
    const root = env[name]
    return root ? [win32.join(root, row.path)] : []
  })
}

export function discoverBrowsers(options: DiscoveryOptions = {}): FoundBrowser[] {
  const { platform = process.platform, env = process.env, fs = realFs } = options
  if (!isDiscoveryPlatform(platform)) return []
  return INSTALL_LOCATIONS[platform].flatMap((row) =>
    candidatePaths(row, platform, env)
      .filter((path) => fs.isExecutableFile(path))
      .map((executablePath) => ({
        family: row.family,
        label: row.label,
        executablePath,
        chosen: false
      }))
  )
}

// File names that name one family. `chrome` and `chrome.exe` do not: Google Chrome, Chromium and
// Chrome for Testing all use them.
const FAMILY_BY_FILE_NAME: ReadonlyMap<string, BrowserFamily> = new Map([
  ['msedge', 'edge'],
  ['msedge.exe', 'edge'],
  ['microsoft edge', 'edge'],
  ['brave', 'brave'],
  ['brave.exe', 'brave'],
  ['brave browser', 'brave'],
  ['chromium', 'chromium'],
  ['chromium-browser', 'chromium'],
  ['google chrome', 'chrome'],
  ['google chrome for testing', 'chrome-for-testing']
])

// The folder a Chrome for Testing archive unpacks to (`chrome-<platform>.zip`).
const TESTING_FOLDER = /^chrome-(linux64|win32|win64)$/

function familyOfChrome(folders: string[]): BrowserFamily {
  if (folders.some((folder) => TESTING_FOLDER.test(folder))) return 'chrome-for-testing'
  // Google's installers put Chrome in /opt/google/chrome* on Linux and Google\Chrome* on Windows.
  const google = folders.indexOf('google')
  if (google !== -1 && folders[google + 1]?.startsWith('chrome')) return 'chrome'
  return 'chromium'
}

function familyFromPath(path: string, platform: NodeJS.Platform): BrowserFamily | undefined {
  const parts = path.split(platform === 'win32' ? /[\\/]/ : '/').map((part) => part.toLowerCase())
  const name = parts[parts.length - 1]
  if (name === 'chrome' || name === 'chrome.exe') return familyOfChrome(parts.slice(0, -1))
  return FAMILY_BY_FILE_NAME.get(name)
}

export type ChosenExecutableCheck =
  | { ok: true; browser: FoundBrowser }
  | { ok: false; code: 'not-executable' | 'script' | 'unrecognized'; message: string }

// The executable the Operator chose. Its family comes from the table row it matches, or from its
// name, since the browser's own answer does not tell the families apart.
export function checkChosenExecutable(
  executablePath: string,
  options: Omit<DiscoveryOptions, 'env'> = {}
): ChosenExecutableCheck {
  const { platform = process.platform, fs = realFs } = options
  const start = fs.isExecutableFile(executablePath) ? fs.readStart(executablePath, 2) : null
  if (start === null) {
    return {
      ok: false,
      code: 'not-executable',
      message: `${executablePath} is not a program Birdbrain can run.`
    }
  }
  if (start.toString('latin1') === '#!') {
    return {
      ok: false,
      code: 'script',
      message:
        `${executablePath} is a script that starts a browser. ` +
        'Choose the browser program itself.'
    }
  }
  const row = isDiscoveryPlatform(platform)
    ? INSTALL_LOCATIONS[platform].find(({ path }) =>
        platform === 'win32'
          ? executablePath.toLowerCase().endsWith(`\\${path.toLowerCase()}`)
          : path === executablePath
      )
    : undefined
  const family = row?.family ?? familyFromPath(executablePath, platform)
  if (!family) {
    return {
      ok: false,
      code: 'unrecognized',
      message:
        `Birdbrain cannot tell which browser ${executablePath} is from its name. It runs ` +
        'Google Chrome, Microsoft Edge, Brave and Chromium.'
    }
  }
  return {
    ok: true,
    browser: {
      family,
      label: row?.label ?? BROWSER_FAMILY_LABELS[family],
      executablePath,
      chosen: true
    }
  }
}

// What Settings and the start dialog list, and so the only executables a launch may start: every
// browser discovery found, and the one the Operator chose while it still passes its checks.
export function listLaunchableBrowsers(
  chosenPath: string,
  versions: Readonly<Record<string, string>>,
  options: DiscoveryOptions = {}
): LaunchedBrowserOption[] {
  const found = discoverBrowsers(options)
  const check = chosenPath ? checkChosenExecutable(chosenPath, options) : null
  const chosen = check?.ok ? check.browser : null
  const listed =
    chosen && !found.some(({ executablePath }) => executablePath === chosenPath)
      ? [...found, chosen]
      : found
  return listed.map((browser) => ({
    ...browser,
    chosen: browser.executablePath === chosen?.executablePath,
    lastVersion: Object.hasOwn(versions, browser.executablePath)
      ? versions[browser.executablePath]
      : null
  }))
}
