import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHash } from 'crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'fs'
import { createServer } from 'net'
import { tmpdir } from 'os'
import { dirname, join, relative } from 'path'
import { MANIFEST_FILENAME } from '@shared/constants'
import type { BrowserFamily, EgressSetting, LaunchedBrowserStatus } from '@shared/types'
import { closeDatabase, initDatabase } from '@main/services/db/core'
import { createCase } from '@main/services/db/caseRepo'
import { getCaptureCount } from '@main/services/db/captureRepo'
import { initManifest } from '@main/services/manifest'
import { createSessionService, type SessionService } from '@main/services/session'
import { ensureCaseDir, initStorage } from '@main/services/storage'
import type { CdpClient } from '@main/services/launchedBrowser/cdpClient'
import {
  LAUNCHED_BROWSER_COMMANDS,
  type NetworkResponse
} from '@main/services/launchedBrowser/commands'
import {
  COMPONENT_EXTENSION_IDS,
  launchBrowser,
  type LaunchedBrowser,
  type LaunchHooks
} from '@main/services/launchedBrowser/launcher'
import type { LaunchArgsInput } from '@main/services/launchedBrowser/launchArgs'
import {
  createLaunchedBrowserService,
  type LaunchedBrowserService
} from '@main/services/launchedBrowser/service'
import {
  browserProcesses,
  listeningTcpSockets,
  processesNaming,
  stillRunning,
  waitForExit,
  type ProcessId
} from '../../../helpers/browserProcesses'
import {
  buildSuiteLaunchArgs,
  loopbackOnly,
  NEVER_SENT,
  PINNED_BROWSER,
  PINNED_VERSION,
  realBrowserSkipReason,
  suiteSpawn,
  withSwitches
} from '../../../helpers/launchedBrowserSuite'
import { startSocks5Fixture, type Socks5Fixture } from '../../../helpers/socks5Fixture'
import { startTargetFixture, type TargetFixture } from '../../../helpers/targetFixture'

// The known answers for the launched browser's connection, Egress and command log (spec,
// "Validation"), against the pinned Chrome for Testing build under xvfb-run. Each launch goes
// through the launched-browser service and a real Capture Session, with the suite's own argument
// list and spawn. Without the build, or outside xvfb-run, the suite reports itself skipped and
// says why.

const skipReason = realBrowserSkipReason()
const FAMILY: BrowserFamily = 'chrome-for-testing'
const BROWSER = {
  family: FAMILY,
  label: 'Google Chrome for Testing',
  executablePath: PINNED_BROWSER ?? ''
}
const DIRECT: EgressSetting = { kind: 'direct' }
const LAUNCH_MS = 60_000

const PAGES = {
  '/page':
    '<!doctype html><title>Fixture page</title><img src="/pixel.gif">' +
    "<script>fetch('/data')</script>",
  '/geolocation':
    '<!doctype html><title>Geolocation</title><script>' +
    'let done = false\n' +
    "const report = (answer) => { if (!done) { done = true; fetch('/report?geolocation=' + answer) } }\n" +
    'navigator.geolocation.getCurrentPosition(() => report("granted"), ' +
    '(e) => report(e.code === e.PERMISSION_DENIED ? "denied" : "error-" + e.code))\n' +
    'setTimeout(() => report("no-answer"), 5000)' +
    '</script>'
}

async function waitFor<T>(
  read: () => T | null | undefined | false | Promise<T | null | undefined | false>,
  what: string,
  timeoutMs = 10_000
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await read()
    if (value) return value
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

// Chrome names an unpacked extension by its folder: the first 128 bits of the path's SHA-256,
// each hex digit written as a letter from a to p.
function unpackedExtensionId(folder: string): string {
  const hex = createHash('sha256').update(realpathSync(folder)).digest('hex').slice(0, 32)
  return [...hex].map((digit) => String.fromCharCode(97 + parseInt(digit, 16))).join('')
}

function writeFixtureExtension(folder: string): string {
  mkdirSync(folder, { recursive: true })
  writeFileSync(
    join(folder, 'manifest.json'),
    JSON.stringify({
      manifest_version: 3,
      name: 'Birdbrain D14 fixture',
      version: '1.0',
      background: { service_worker: 'background.js' }
    })
  )
  writeFileSync(join(folder, 'background.js'), "self.addEventListener('install', () => {})\n")
  return unpackedExtensionId(folder)
}

interface SpawnRecord {
  args: readonly string[]
  stdio: unknown
}

interface Harness {
  session: SessionService
  service: LaunchedBrowserService
  spawns: SpawnRecord[]
  responses: NetworkResponse[]
  firstTabCheck: () => 'not run' | 'passed' | 'failed'
  browser: () => LaunchedBrowser
  logged: string[]
}

describe.skipIf(skipReason !== null)(
  `launched browser known answers, Chrome for Testing ${PINNED_VERSION}` +
    (skipReason ? ` (skipped: ${skipReason})` : ''),
  () => {
    let root: string
    let sessionData: string
    let caseId: string
    let caseDir: string
    let manifestBefore: Buffer
    let caseFilesBefore: string[]
    let target: TargetFixture
    let proxy: Socks5Fixture
    let extensionDir: string
    let extensionId: string
    const clients: CdpClient[] = []
    const launched: LaunchedBrowser[] = []

    const proxyEgress = (url: string): EgressSetting => ({
      kind: 'proxy',
      proxyUrl: url,
      label: 'SOCKS5 fixture'
    })

    function harness(
      egress: EgressSetting,
      buildArgs: (input: LaunchArgsInput) => string[] = buildSuiteLaunchArgs
    ): Harness {
      const spawns: SpawnRecord[] = []
      const responses: NetworkResponse[] = []
      const logged: string[] = []
      let firstTabCheck: 'not run' | 'passed' | 'failed' = 'not run'
      let last: LaunchedBrowser | null = null
      const record = (_source: string, code: string): string => {
        logged.push(code)
        return code
      }
      const session = createSessionService({ onSessionEnded: () => service.sessionEnded() })
      const service = createLaunchedBrowserService({
        session,
        sessionDataPath: sessionData,
        readSettings: () => ({ operatorName: 'Known Answer', egress }),
        saveVersion: () => {},
        subscribeEgressChange: () => () => {},
        log: { info: record, warn: record, error: record },
        launch: async (request) => {
          const hooks = request.hooks ?? {}
          const { checkFirstTab } = hooks
          const tapped: LaunchHooks = {
            ...hooks,
            onRecordedSession: (cdpSession, targetInfo, recording) => {
              hooks.onRecordedSession?.(cdpSession, targetInfo, recording)
              cdpSession.on('Network.responseReceived', ({ response }) => responses.push(response))
            },
            ...(checkFirstTab && {
              checkFirstTab: (tab) =>
                checkFirstTab(tab).then(
                  () => {
                    firstTabCheck = 'passed'
                  },
                  (error: unknown) => {
                    firstTabCheck = 'failed'
                    throw error
                  }
                )
            })
          }
          const browser = await launchBrowser(
            { ...request, hooks: tapped },
            {
              buildArgs,
              spawn: (command, args, options) => {
                spawns.push({ args, stdio: options.stdio })
                return suiteSpawn(command, args, options)
              }
            }
          )
          clients.push(browser.client)
          launched.push(browser)
          last = browser
          return browser
        }
      })
      session.activateCase(caseId)
      return {
        session,
        service,
        spawns,
        responses,
        logged,
        firstTabCheck: () => firstTabCheck,
        browser: () => {
          if (!last) throw new Error('no browser launched')
          return last
        }
      }
    }

    function openSummary(status: LaunchedBrowserStatus) {
      if (status.state !== 'open') throw new Error(`the browser is ${status.state}`)
      return status.browser
    }

    // The first tab goes to `url` from its page; the engine's command list has no navigation.
    async function navigate(browser: LaunchedBrowser, url: string): Promise<void> {
      await browser.firstTab.session.send('Runtime.evaluate', {
        expression: `location.href = ${JSON.stringify(url)}`
      })
    }

    async function targetUrls(browser: LaunchedBrowser): Promise<string[]> {
      const { targetInfos } = await browser.client.send('Target.getTargets', {})
      return targetInfos.map(({ url }) => url)
    }

    // Stops the Capture Session as the app's switch does, and returns the processes left.
    async function stopSession(h: Harness): Promise<ProcessId[]> {
      const processes = browserProcesses(h.browser().pid as number)
      h.session.stop()
      await waitFor(() => h.service.status().state === 'none', 'the browser to close')
      return waitForExit(processes)
    }

    function caseFiles(): string[] {
      return readdirSync(caseDir, { recursive: true }).map(String).sort()
    }

    beforeAll(async () => {
      root = mkdtempSync(join(tmpdir(), 'bb-launched-ka-'))
      sessionData = join(root, 'sessionData')
      initStorage(join(root, 'captures'))
      await initDatabase(':memory:')
      caseId = createCase({ name: 'Launched browser known answers' }).id
      caseDir = ensureCaseDir(caseId)
      initManifest(caseDir)
      manifestBefore = readFileSync(join(caseDir, MANIFEST_FILENAME))
      caseFilesBefore = caseFiles()
      target = await startTargetFixture(PAGES)
      proxy = await startSocks5Fixture()
      extensionDir = join(root, 'extension')
      extensionId = writeFixtureExtension(extensionDir)
    })

    afterAll(async () => {
      // A test that failed before its stop leaves its browser open. The browser's children
      // outlive a kill briefly and still write to its profile, so the folder goes after them.
      const left = launched.flatMap(({ pid }) => browserProcesses(pid as number))
      for (const browser of launched) browser.kill()
      await Promise.all(launched.map(({ exited }) => exited))
      await waitForExit(left)
      await target?.close()
      await proxy?.close()
      closeDatabase()
      if (root) rmSync(root, { recursive: true, force: true })
    })

    describe('with the Egress Direct', () => {
      let h: Harness
      let processes: ProcessId[]

      beforeAll(async () => {
        h = harness(DIRECT)
        await h.service.launch(BROWSER)
        processes = browserProcesses(h.browser().pid as number)
      }, LAUNCH_MS)

      it('spawns the browser on the debugging pipe with a throwaway profile', () => {
        expect(h.spawns).toHaveLength(1)
        const [{ args, stdio }] = h.spawns
        expect(args).toContain('--remote-debugging-pipe')
        expect(args.some((arg) => arg.startsWith('--remote-debugging-port'))).toBe(false)
        const userDataDir = args
          .find((arg) => arg.startsWith('--user-data-dir='))
          ?.slice('--user-data-dir='.length)
        expect(userDataDir).toBe(h.browser().profile.profileDir)
        expect(relative(join(sessionData, 'launched-browsers'), userDataDir ?? '')).toMatch(
          new RegExp(`^session-[0-9a-f-]{36}/${FAMILY}$`)
        )
        expect((stdio as unknown[]).slice(3)).toEqual(['pipe', 'pipe'])
      })

      it('reads the pinned version from Browser.getVersion and starts the Capture Session', () => {
        expect(h.browser().identity).toMatchObject({ product: 'Chrome', version: PINNED_VERSION })
        expect(openSummary(h.service.status()).version).toBe(PINNED_VERSION)
        expect(h.session.snapshot()).toMatchObject({ activeCaseId: caseId, sessionActive: true })
      })

      it('holds no listening TCP socket in its process tree and writes no DevToolsActivePort', () => {
        expect(processes.length).toBeGreaterThan(1)
        expect(listeningTcpSockets(processes)).toEqual([])
        expect(existsSync(join(h.browser().profile.profileDir, 'DevToolsActivePort'))).toBe(false)
      })

      it(
        "denies a page the Operator's location",
        async () => {
          await navigate(h.browser(), `${target.origin}/geolocation`)
          const answer = await waitFor(
            () => target.requests.find((url) => url.startsWith('/report?geolocation=')),
            'the geolocation page to report'
          )
          expect(answer).toBe('/report?geolocation=denied')
        },
        LAUNCH_MS
      )

      it(
        'leaves no browser process and no session folder once the Capture Session stops',
        async () => {
          const sessionFolder = dirname(h.browser().profile.profileDir)
          expect(sessionFolder).toMatch(/\/launched-browsers\/session-[0-9a-f-]{36}$/)
          expect(await stopSession(h)).toEqual([])
          expect(existsSync(sessionFolder)).toBe(false)
          expect(h.service.status()).toEqual({ state: 'none' })
          expect(h.logged).toEqual([])
        },
        LAUNCH_MS
      )
    })

    describe('with the Egress on the SOCKS5 fixture', () => {
      let h: Harness

      beforeAll(async () => {
        h = harness(proxyEgress(proxy.url))
        await h.service.launch(BROWSER)
      }, LAUNCH_MS)

      it('passes the WebRTC check on the first tab before the launch resolves', () => {
        expect(h.firstTabCheck()).toBe('passed')
        expect(h.session.snapshot().sessionActive).toBe(true)
      })

      it(
        "receives every response on a recorded tab from the fixture proxy's address and port",
        async () => {
          await navigate(h.browser(), `${target.origin}/page`)
          await waitFor(
            () => h.responses.some(({ url }) => url === `${target.origin}/data`),
            "the page's fetch"
          )
          const urls = h.responses.map(({ url }) => url)
          expect(urls).toEqual(
            expect.arrayContaining([
              `${target.origin}/page`,
              `${target.origin}/pixel.gif`,
              `${target.origin}/data`
            ])
          )
          for (const { url, remoteIPAddress, remotePort } of h.responses) {
            expect({ url, remoteIPAddress, remotePort }).toEqual({
              url,
              remoteIPAddress: '127.0.0.1',
              remotePort: proxy.port
            })
          }
          const targetPort = Number(new URL(target.origin).port)
          expect(proxy.requests).toContainEqual({
            host: '127.0.0.1',
            port: targetPort,
            allowed: true
          })
          expect(h.service.status().state).toBe('open')
        },
        LAUNCH_MS
      )

      it(
        'shows no extension warning with no extension added',
        async () => {
          const [component] = COMPONENT_EXTENSION_IDS
          await waitFor(
            async () => (await targetUrls(h.browser())).some((url) => url.includes(component)),
            "the browser's component extension"
          )
          expect(openSummary(h.service.status()).extensionWarnings).toEqual([])
        },
        LAUNCH_MS
      )

      it(
        'leaves no browser process once the Capture Session stops',
        async () => {
          expect(await stopSession(h)).toEqual([])
          expect(h.logged).toEqual([])
        },
        LAUNCH_MS
      )
    })

    describe('an extension in the profile (D14)', () => {
      const withExtension = () =>
        withSwitches(buildSuiteLaunchArgs, [`--load-extension=${extensionDir}`])

      it(
        'warns in the panel while the Egress is not Direct, and the Capture Session runs on',
        async () => {
          const h = harness(proxyEgress(proxy.url), withExtension())
          await h.service.launch(BROWSER)
          const warnings = await waitFor(() => {
            const { extensionWarnings } = openSummary(h.service.status())
            return extensionWarnings.length > 0 && extensionWarnings
          }, 'the extension warning')
          expect(warnings).toEqual([extensionId])
          expect(h.session.snapshot().sessionActive).toBe(true)
          expect(await stopSession(h)).toEqual([])
        },
        LAUNCH_MS
      )

      it(
        'does not warn while the Egress is Direct',
        async () => {
          const h = harness(DIRECT, withExtension())
          await h.service.launch(BROWSER)
          await waitFor(
            async () =>
              (await targetUrls(h.browser())).some((url) =>
                url.startsWith(`chrome-extension://${extensionId}/`)
              ),
            'the fixture extension to start'
          )
          expect(openSummary(h.service.status()).extensionWarnings).toEqual([])
          expect(h.session.snapshot().sessionActive).toBe(true)
          expect(await stopSession(h)).toEqual([])
        },
        LAUNCH_MS
      )
    })

    it(
      'refuses the launch, naming the proxy, when the proxy accepts no connection',
      async () => {
        const stopped = await startSocks5Fixture()
        await stopped.close()
        const quiet = await startTargetFixture(PAGES)
        try {
          const h = harness(proxyEgress(stopped.url))
          await expect(h.service.launch(BROWSER)).rejects.toMatchObject({
            code: 'EGRESS_PROXY_UNREACHABLE',
            message: expect.stringContaining(stopped.url)
          })
          expect(h.spawns).toEqual([])
          expect(h.session.snapshot().sessionActive).toBe(false)
          expect(quiet.requests).toEqual([])
        } finally {
          await quiet.close()
        }
      },
      LAUNCH_MS
    )

    // A host candidate needs an interface other than loopback, which a loopback-only namespace
    // does not have.
    it.skipIf(loopbackOnly())(
      'finds a WebRTC candidate, and refuses the launch, without the WebRTC switch',
      async () => {
        const withoutPolicy = (input: LaunchArgsInput): string[] =>
          buildSuiteLaunchArgs(input).filter(
            (arg) => !arg.startsWith('--webrtc-ip-handling-policy')
          )
        const h = harness(proxyEgress(proxy.url), withoutPolicy)
        await expect(h.service.launch(BROWSER)).rejects.toMatchObject({
          code: 'EGRESS_WEBRTC_CANDIDATE'
        })
        expect(h.spawns).toHaveLength(1)
        expect(h.firstTabCheck()).toBe('failed')
        expect(h.session.snapshot().sessionActive).toBe(false)
        expect(h.service.status().state).toBe('none')
      },
      LAUNCH_MS
    )

    it(
      'leaves no browser process when Birdbrain quits with the browser open',
      async () => {
        const h = harness(DIRECT)
        await h.service.launch(BROWSER)
        const browser = h.browser()
        const processes = browserProcesses(browser.pid as number)
        expect(stillRunning(processes).length).toBeGreaterThan(1)
        h.service.killForQuit()
        await browser.exited
        expect(await waitForExit(processes)).toEqual([])
      },
      LAUNCH_MS
    )

    describe('after every launch above', () => {
      it('sent no command outside the list, and none the engine must never send', () => {
        const sent = new Set(clients.flatMap((client) => client.commandLog()))
        expect(clients.length).toBeGreaterThan(0)
        for (const method of sent) expect(LAUNCHED_BROWSER_COMMANDS).toContain(method)
        for (const method of NEVER_SENT) expect(sent.has(method as never)).toBe(false)
      })

      it("left no process that names the suite's profile folder", () => {
        expect(processesNaming(sessionData)).toEqual([])
      })

      it('appended no Manifest entry and wrote no Capture row or Case file', () => {
        expect(readFileSync(join(caseDir, MANIFEST_FILENAME))).toEqual(manifestBefore)
        expect(getCaptureCount(caseId)).toBe(0)
        expect(caseFiles()).toEqual(caseFilesBefore)
      })
    })
  }
)

// The /proc reads the suite's process checks rest on, against processes this test starts.
describe.runIf(process.platform === 'linux')("the suite's process checks", () => {
  it('find a listening TCP socket in a process that holds one', async () => {
    const server = createServer()
    const self = browserProcesses(process.pid).filter(({ pid }) => pid === process.pid)
    const before = listeningTcpSockets(self)
    try {
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
      expect(listeningTcpSockets(self)).toHaveLength(before.length + 1)
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  })
})
