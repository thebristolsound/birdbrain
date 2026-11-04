import { describe, expect, it, vi } from 'vitest'
import { win32 } from 'path'
import {
  BROWSER_FAMILY_LABELS,
  checkChosenExecutable,
  discoverBrowsers,
  INSTALL_LOCATIONS,
  listLaunchableBrowsers,
  type DiscoveryFs
} from '@main/services/launchedBrowser/discovery'
import { BROWSER_FAMILIES } from '@shared/types'

// Every way Node starts a process, so a discovery that started one would be recorded here.
const spawned = vi.hoisted(() => [] as string[])
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  const record =
    (name: string) =>
    (...args: unknown[]): never => {
      spawned.push(`${name} ${String(args[0])}`)
      throw new Error(`discovery started a process: ${name}`)
    }
  const fake = {
    ...actual,
    spawn: record('spawn'),
    spawnSync: record('spawnSync'),
    exec: record('exec'),
    execSync: record('execSync'),
    execFile: record('execFile'),
    execFileSync: record('execFileSync'),
    fork: record('fork')
  }
  return { ...fake, default: fake }
})

const SCRIPT = Buffer.from('#!/bin/bash\nexec /opt/real/browser "$@"\n')
const ELF = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01])

// A file system holding only the given executables. `checked` records every path asked about.
function fakeFs(executables: Record<string, Buffer> | string[]): DiscoveryFs & {
  checked: string[]
} {
  const files: Record<string, Buffer> = Array.isArray(executables)
    ? Object.fromEntries(executables.map((path) => [path, ELF]))
    : executables
  const checked: string[] = []
  return {
    checked,
    isExecutableFile: (path) => {
      checked.push(path)
      return path in files
    },
    readStart: (path, length) => files[path]?.subarray(0, length) ?? null
  }
}

describe('discoverBrowsers', () => {
  it('lists the Linux install locations that hold an executable, in table order', () => {
    const fs = fakeFs(['/usr/lib/chromium/chromium', '/opt/google/chrome/chrome'])
    expect(discoverBrowsers({ platform: 'linux', env: {}, fs })).toEqual([
      {
        family: 'chrome',
        label: 'Google Chrome',
        executablePath: '/opt/google/chrome/chrome',
        chosen: false
      },
      {
        family: 'chromium',
        label: 'Chromium',
        executablePath: '/usr/lib/chromium/chromium',
        chosen: false
      }
    ])
    expect(fs.checked).toEqual(INSTALL_LOCATIONS.linux.map(({ path }) => path))
  })

  it('finds Brave and Brave Origin under their own install folders', () => {
    const fs = fakeFs(['/opt/brave.com/brave/brave', '/opt/brave.com/brave-origin/brave'])
    expect(discoverBrowsers({ platform: 'linux', env: {}, fs })).toEqual([
      {
        family: 'brave',
        label: 'Brave',
        executablePath: '/opt/brave.com/brave/brave',
        chosen: false
      },
      {
        family: 'brave',
        label: 'Brave Origin',
        executablePath: '/opt/brave.com/brave-origin/brave',
        chosen: false
      }
    ])
  })

  it('looks for each Windows location under the per-user and both Program Files folders', () => {
    const env = {
      LOCALAPPDATA: 'C:\\Users\\op\\AppData\\Local',
      PROGRAMFILES: 'C:\\Program Files',
      'PROGRAMFILES(X86)': 'C:\\Program Files (x86)'
    }
    const fs = fakeFs([
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Users\\op\\AppData\\Local\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
    ])
    expect(discoverBrowsers({ platform: 'win32', env, fs })).toEqual([
      {
        family: 'chrome',
        label: 'Google Chrome',
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        chosen: false
      },
      {
        family: 'edge',
        label: 'Microsoft Edge',
        executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        chosen: false
      },
      {
        family: 'brave',
        label: 'Brave',
        executablePath:
          'C:\\Users\\op\\AppData\\Local\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
        chosen: false
      }
    ])
    expect(fs.checked).toHaveLength(INSTALL_LOCATIONS.win32.length * 3)
    expect(fs.checked.every((path) => win32.isAbsolute(path))).toBe(true)
  })

  it('skips a Windows folder whose variable is unset rather than checking a relative path', () => {
    const fs = fakeFs([])
    discoverBrowsers({ platform: 'win32', env: { PROGRAMFILES: 'C:\\Program Files' }, fs })
    expect(fs.checked).toHaveLength(INSTALL_LOCATIONS.win32.length)
    expect(fs.checked.every((path) => path.startsWith('C:\\Program Files\\'))).toBe(true)
  })

  it('lists the macOS applications that are installed', () => {
    const fs = fakeFs(['/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'])
    expect(discoverBrowsers({ platform: 'darwin', env: {}, fs })).toEqual([
      {
        family: 'edge',
        label: 'Microsoft Edge',
        executablePath: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        chosen: false
      }
    ])
  })

  it('finds nothing, and checks nothing, on a platform with no table', () => {
    const fs = fakeFs(['/opt/google/chrome/chrome'])
    expect(discoverBrowsers({ platform: 'freebsd', env: {}, fs })).toEqual([])
    expect(fs.checked).toEqual([])
  })

  it('has a row for each of the four products on each platform', () => {
    for (const rows of Object.values(INSTALL_LOCATIONS)) {
      expect(new Set(rows.map(({ family }) => family))).toEqual(
        new Set(['chrome', 'edge', 'brave', 'chromium'])
      )
    }
  })

  it('labels every browser family', () => {
    expect(Object.keys(BROWSER_FAMILY_LABELS).sort()).toEqual([...BROWSER_FAMILIES].sort())
  })
})

describe('checkChosenExecutable', () => {
  const linux = (path: string, fs: DiscoveryFs = fakeFs([path])) =>
    checkChosenExecutable(path, { platform: 'linux', fs })

  it('takes the family and label of a table row the path names', () => {
    expect(linux('/opt/brave.com/brave-origin/brave')).toEqual({
      ok: true,
      browser: {
        family: 'brave',
        label: 'Brave Origin',
        executablePath: '/opt/brave.com/brave-origin/brave',
        chosen: true
      }
    })
  })

  it('names the family from the file name of a browser outside the table', () => {
    expect(linux('/opt/brave-origin-bin/brave')).toMatchObject({
      ok: true,
      browser: { family: 'brave', label: 'Brave' }
    })
    expect(linux('/home/op/apps/msedge')).toMatchObject({
      ok: true,
      browser: { family: 'edge', label: 'Microsoft Edge' }
    })
    expect(linux('/usr/lib/chromium-browser/chromium-browser')).toMatchObject({
      ok: true,
      browser: { family: 'chromium', label: 'Chromium' }
    })
  })

  it('reads an executable named chrome by the folder it sits in', () => {
    expect(
      linux('/home/op/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome')
    ).toMatchObject({
      ok: true,
      browser: { family: 'chrome-for-testing', label: 'Chrome for Testing' }
    })
    expect(linux('/opt/google/chrome-beta/chrome')).toMatchObject({
      ok: true,
      browser: { family: 'chrome', label: 'Google Chrome' }
    })
    expect(linux('/home/op/chrome-linux/chrome')).toMatchObject({
      ok: true,
      browser: { family: 'chromium', label: 'Chromium' }
    })
  })

  it('reads a Windows chrome.exe by its install folder, whatever the case', () => {
    const windows = (path: string) =>
      checkChosenExecutable(path, { platform: 'win32', fs: fakeFs([path]) })
    expect(
      windows('C:\\Program Files\\Google\\Chrome Beta\\Application\\chrome.exe')
    ).toMatchObject({ ok: true, browser: { family: 'chrome' } })
    expect(windows('C:\\Users\\op\\Downloads\\CHROME-WIN64\\chrome.exe')).toMatchObject({
      ok: true,
      browser: { family: 'chrome-for-testing' }
    })
    expect(windows('D:\\Chromium\\Application\\chrome.exe')).toMatchObject({
      ok: true,
      browser: { family: 'chromium' }
    })
    expect(windows('D:\\Tools\\BRAVE.EXE')).toMatchObject({
      ok: true,
      browser: { family: 'brave' }
    })
    expect(
      windows('C:/Users/op/AppData/Local/BraveSoftware/Brave-Origin/Application/brave.exe')
    ).toMatchObject({ ok: true, browser: { family: 'brave' } })
    expect(
      windows('C:\\Users\\op\\AppData\\Local\\BRAVESOFTWARE\\Brave-Origin\\Application\\brave.exe')
    ).toMatchObject({ ok: true, browser: { family: 'brave', label: 'Brave Origin' } })
  })

  it('reads a macOS application by its executable name', () => {
    const path =
      '/Users/op/Downloads/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
    expect(checkChosenExecutable(path, { platform: 'darwin', fs: fakeFs([path]) })).toMatchObject({
      ok: true,
      browser: { family: 'chrome-for-testing' }
    })
  })

  it('refuses a path that is not an executable file', () => {
    expect(linux('/opt/google/chrome/chrome', fakeFs([]))).toEqual({
      ok: false,
      code: 'not-executable',
      message: '/opt/google/chrome/chrome is not a program Birdbrain can run.'
    })
  })

  it('refuses a script that starts a browser, since the script could add switches', () => {
    const path = '/usr/bin/chromium'
    expect(linux(path, fakeFs({ [path]: SCRIPT }))).toEqual({
      ok: false,
      code: 'script',
      message:
        '/usr/bin/chromium is a script that starts a browser. Choose the browser program itself.'
    })
  })

  it('refuses a program whose name is not one of the supported browsers', () => {
    expect(linux('/usr/bin/firefox')).toEqual({
      ok: false,
      code: 'unrecognized',
      message:
        'Birdbrain cannot tell which browser /usr/bin/firefox is from its name. It runs ' +
        'Google Chrome, Microsoft Edge, Brave and Chromium.'
    })
    for (const path of ['/usr/bin/google-chrome-stable', '/tmp/constructor', '/tmp/__proto__']) {
      expect(linux(path)).toMatchObject({ ok: false, code: 'unrecognized' })
    }
  })

  it('refuses a program whose first bytes cannot be read', () => {
    const fs: DiscoveryFs = { isExecutableFile: () => true, readStart: () => null }
    expect(linux('/opt/google/chrome/chrome', fs)).toMatchObject({
      ok: false,
      code: 'not-executable'
    })
  })
})

describe('listLaunchableBrowsers', () => {
  const linux = (fs: DiscoveryFs) => ({ platform: 'linux' as const, env: {}, fs })

  it('lists what discovery found, then the chosen executable, each with its last launch', () => {
    const fs = fakeFs(['/usr/lib/chromium/chromium', '/home/op/apps/brave'])
    const versions = { '/usr/lib/chromium/chromium': '154.0.8037.97' }
    expect(listLaunchableBrowsers('/home/op/apps/brave', versions, linux(fs))).toEqual([
      {
        family: 'chromium',
        label: 'Chromium',
        executablePath: '/usr/lib/chromium/chromium',
        chosen: false,
        lastVersion: '154.0.8037.97'
      },
      {
        family: 'brave',
        label: 'Brave',
        executablePath: '/home/op/apps/brave',
        chosen: true,
        lastVersion: null
      }
    ])
  })

  it('marks a found browser as the chosen one rather than listing it twice', () => {
    const fs = fakeFs(['/opt/google/chrome/chrome'])
    expect(listLaunchableBrowsers('/opt/google/chrome/chrome', {}, linux(fs))).toEqual([
      {
        family: 'chrome',
        label: 'Google Chrome',
        executablePath: '/opt/google/chrome/chrome',
        chosen: true,
        lastVersion: null
      }
    ])
  })

  it('leaves out a chosen executable that no longer passes its checks', () => {
    const fs = fakeFs({ '/usr/lib/chromium/chromium': ELF, '/home/op/apps/chromium': SCRIPT })
    const listed = (chosen: string) =>
      listLaunchableBrowsers(chosen, {}, linux(fs)).map(({ executablePath }) => executablePath)
    expect(listed('/home/op/apps/chromium')).toEqual(['/usr/lib/chromium/chromium'])
    expect(listed('/home/op/gone/chromium')).toEqual(['/usr/lib/chromium/chromium'])
    expect(listed('')).toEqual(['/usr/lib/chromium/chromium'])
  })
})

describe('discovery starts no process', () => {
  it('records no call through child_process with the real file system', () => {
    spawned.length = 0
    discoverBrowsers()
    checkChosenExecutable(process.execPath)
    checkChosenExecutable('/nonexistent/chrome')
    listLaunchableBrowsers(process.execPath, {})
    listLaunchableBrowsers('/nonexistent/chrome', {})
    expect(spawned).toEqual([])
  })
})
