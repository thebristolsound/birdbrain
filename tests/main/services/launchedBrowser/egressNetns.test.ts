import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { EgressSetting } from '@shared/types'
import { prepareEgressChecks } from '@main/services/launchedBrowser/egressChecks'
import { launchBrowser, type LaunchedBrowser } from '@main/services/launchedBrowser/launcher'
import { browserProcesses, waitForExit } from '../../../helpers/browserProcesses'
import {
  buildSuiteLaunchArgs,
  loopbackOnly,
  PINNED_BROWSER,
  PINNED_VERSION,
  realBrowserSkipReason,
  suiteSpawn,
  withSwitches
} from '../../../helpers/launchedBrowserSuite'
import { startSocks5Fixture, type Socks5Fixture } from '../../../helpers/socks5Fixture'
import { startTargetFixture, type TargetFixture } from '../../../helpers/targetFixture'

const FILE = 'tests/main/services/launchedBrowser/egressNetns.test.ts'
const NETNS_COMMAND =
  `unshare -rn sh -c "ip link set lo up && unshare -U --map-user=$(id -u) ` +
  `--map-group=$(id -g) xvfb-run --auto-servernum pnpm test ${FILE}"`

function namespaceSkipReason(): string | null {
  if (loopbackOnly()) return null
  return `not in a loopback-only network namespace: run ${NETNS_COMMAND}`
}

const skipReason = realBrowserSkipReason() ?? namespaceSkipReason()

// The probe idled the browser for 120 seconds (P13); its own traffic in the first seconds is
// what this run holds.
const IDLE_MS = 10_000
const OUTSIDE = 'birdbrain-egress.test'
const EGRESS_PAGE =
  '<!doctype html><title>Egress</title>' +
  `<link rel="dns-prefetch" href="//prefetch.${OUTSIDE}">` +
  `<link rel="preconnect" href="https://preconnect.${OUTSIDE}">` +
  `<img src="http://img.${OUTSIDE}/a.png"><img src="https://tls.${OUTSIDE}/a.png">` +
  `<a href="http://anchor.${OUTSIDE}/">anchor</a>` +
  `<script>fetch('http://fetch.${OUTSIDE}/x').catch(() => {}).finally(() => fetch('/done'))` +
  '</script>'

interface NetLog {
  constants: { logEventTypes: Record<string, number> }
  events: Array<{ type: number; source: { id: number }; params?: Record<string, unknown> }>
}

interface NetLogSummary {
  tcpConnects: string[]
  udpConnects: string[]
  udpSends: number
  // Host names the browser looked up itself. A lookup leaves no socket in the namespace: on a
  // host whose resolver answers over a Unix socket, it reaches the host's resolver anyway.
  lookups: string[]
}

function summarizeNetLog(file: string): NetLogSummary {
  const { constants, events } = JSON.parse(readFileSync(file, 'utf8')) as NetLog
  const type = (name: string): number => {
    const id = constants.logEventTypes[name]
    if (id === undefined) throw new Error(`the net log has no event type ${name}`)
    return id
  }
  const tcpAttempt = type('TCP_CONNECT_ATTEMPT')
  const tcpConnect = type('TCP_CONNECT')
  const udpConnect = type('UDP_CONNECT')
  const udpSent = type('UDP_BYTES_SENT')
  const lookupJob = type('HOST_RESOLVER_MANAGER_JOB')
  const tcpConnects = new Set<string>()
  const udpConnects = new Set<string>()
  const lookups = new Set<string>()
  let udpSends = 0
  for (const { type: id, params = {} } of events) {
    if (id === tcpAttempt && typeof params.address === 'string') tcpConnects.add(params.address)
    if (id === tcpConnect && Array.isArray(params.address_list)) {
      for (const address of params.address_list) tcpConnects.add(String(address))
    }
    if (id === udpConnect && typeof params.address === 'string') udpConnects.add(params.address)
    if (id === udpSent) udpSends++
    if (id === lookupJob) lookups.add(String(params.host))
  }
  return {
    tcpConnects: [...tcpConnects],
    udpConnects: [...udpConnects],
    udpSends,
    lookups: [...lookups]
  }
}

// The Egress item of the spec's Validation section, in a network namespace with loopback only.
// The spec's `unshare -rn` wrapper alone runs the browser as root, which Chrome refuses with its
// sandbox on (probe P13), so the run maps the caller's own user back in a nested user namespace.
// A socket counts when the browser connected or sent on it: Chrome's IPv6 reachability check
// opens UDP sockets to a public address that fail to connect and send nothing (P13), and those
// are allowed while no datagram leaves and none goes to a DNS port. The browser must also look
// up no host name itself, since a lookup can leave the namespace without a socket in it.
describe.skipIf(skipReason !== null)(
  `launched browser Egress in a loopback-only network namespace, Chrome for Testing ` +
    PINNED_VERSION +
    (skipReason ? ` (skipped: ${skipReason})` : ''),
  () => {
    let root: string
    let netLog: string
    let proxy: Socks5Fixture
    let target: TargetFixture
    let browser: LaunchedBrowser
    const bypasses: Error[] = []

    beforeAll(async () => {
      root = mkdtempSync(join(tmpdir(), 'bb-launched-netns-'))
      netLog = join(root, 'netlog.json')
      proxy = await startSocks5Fixture()
      target = await startTargetFixture({ '/egress': EGRESS_PAGE })
      const egress: EgressSetting = { kind: 'proxy', proxyUrl: proxy.url, label: 'SOCKS5 fixture' }
      const guard = await prepareEgressChecks(egress, 'Google Chrome for Testing')
      browser = await launchBrowser(
        {
          browser: {
            family: 'chrome-for-testing',
            label: 'Google Chrome for Testing',
            executablePath: PINNED_BROWSER ?? ''
          },
          egress: guard.egress,
          sessionDataPath: join(root, 'sessionData'),
          hooks: guard.hooks
        },
        {
          spawn: suiteSpawn,
          // The net log is this launch's alone; no shipped launch passes it.
          buildArgs: withSwitches(buildSuiteLaunchArgs, [`--log-net-log=${netLog}`])
        }
      )
      guard.enforce(browser, (error) => bypasses.push(error))
    }, 60_000)

    afterAll(async () => {
      browser?.kill()
      await proxy?.close()
      await target?.close()
      if (root) rmSync(root, { recursive: true, force: true })
    })

    it('connects to nothing but the proxy, sends no datagram and looks up no host name', async () => {
      await new Promise((resolve) => setTimeout(resolve, IDLE_MS))
      await browser.firstTab.session.send('Runtime.evaluate', {
        expression: `location.href = ${JSON.stringify(`${target.origin}/egress`)}`
      })
      const deadline = Date.now() + 20_000
      while (!target.requests.includes('/done') && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
      expect(target.requests).toContain('/done')
      const processes = browserProcesses(browser.pid as number)
      // Browser.close lets the browser finish writing the net log.
      await browser.stop()
      expect(await waitForExit(processes)).toEqual([])
      expect(bypasses).toEqual([])

      const { tcpConnects, udpConnects, udpSends, lookups } = summarizeNetLog(netLog)
      expect(tcpConnects).toEqual([`127.0.0.1:${proxy.port}`])
      expect(udpSends).toBe(0)
      expect(udpConnects.filter((address) => address.endsWith(':53'))).toEqual([])
      expect(lookups).toEqual([])
      // The page's hosts reached the proxy by name, and it refused them.
      expect(proxy.requests).toEqual(
        expect.arrayContaining([
          { host: `img.${OUTSIDE}`, port: 80, allowed: false },
          { host: `fetch.${OUTSIDE}`, port: 80, allowed: false }
        ])
      )
    }, 60_000)
  }
)
