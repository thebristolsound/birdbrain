import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// The e2e switches are read only by an unpackaged build, so the test flips this.
const electronApp = vi.hoisted(() => ({ isPackaged: true }))
vi.mock('electron', () => ({ app: electronApp }))

const loggerInfo = vi.hoisted(() => vi.fn())
vi.mock('@main/services/logger', () => ({ logger: { info: loggerInfo } }))

import {
  E2E_NETWORK_SWITCH,
  E2E_VPN_SWITCH,
  PROBE_ADDRESS,
  detectNetwork,
  isLinuxTunnel,
  isMacTunnel,
  isWindowsTunnel,
  macRouteToProbe,
  macRouterAddress,
  normaliseMac,
  parseAirportNetwork,
  parseIwSsid,
  parseLinuxNeighbour,
  parseLinuxRoute,
  parseMacRoutes,
  readLinux,
  readMac,
  readNetwork,
  readWindows,
  runCommand,
  windowsReading,
  type RunCommand
} from '@main/services/vpnDetection'

// Route-table fixtures. The linux-*-wired, linux-link-tailscale and linux-neigh-router files
// were captured on a Linux machine with a wired connection and Tailscale running without an
// exit node, with its hardware addresses replaced by RFC 7042 documentation addresses. The
// others are written in each tool's output format: the Wi-Fi and WireGuard Linux outputs, the
// macOS `netstat -rn` tables and the Windows PowerShell snapshots.
function fixture(name: string): string {
  return readFileSync(join(__dirname, '../../fixtures/vpnDetection', name), 'utf-8')
}

// A RunCommand that answers each command line from a table, and fails any other.
function commands(table: Record<string, string>) {
  return vi.fn<RunCommand>(async (file, args) => {
    const line = [file, ...args].join(' ')
    if (line in table) return table[line]
    throw new Error(`unexpected command: ${line}`)
  })
}

const ROUTE = `ip -4 -o route get ${PROBE_ADDRESS}`

describe('normaliseMac', () => {
  it('reads colon and dash forms, in either case, with or without leading zeros', () => {
    expect(normaliseMac('00:00:5E:00:53:01')).toBe('00:00:5e:00:53:01')
    expect(normaliseMac('00-00-5E-00-53-01')).toBe('00:00:5e:00:53:01')
    expect(normaliseMac('0:0:5e:0:53:1')).toBe('00:00:5e:00:53:01')
  })

  it('refuses anything that is not six octets, and the all-zero address', () => {
    expect(normaliseMac('00:00:00:00:00:00')).toBeNull()
    expect(normaliseMac('link#11')).toBeNull()
    expect(normaliseMac('00:00:5e:00:53')).toBeNull()
    expect(normaliseMac('00:00:5e:00:53:001')).toBeNull()
  })
})

describe('Linux', () => {
  it('parses the device and gateway of the captured route lookup', () => {
    expect(parseLinuxRoute(fixture('linux-route-wired.txt'))).toEqual({
      device: 'enp86s0',
      gateway: '192.168.8.1'
    })
    expect(parseLinuxRoute(fixture('linux-route-wg-quick.txt'))).toEqual({
      device: 'wg0',
      gateway: null
    })
  })

  it('refuses output that is not a route to the probe address', () => {
    expect(parseLinuxRoute('')).toBeNull()
    expect(parseLinuxRoute('RTNETLINK answers: Network is unreachable')).toBeNull()
    expect(parseLinuxRoute(`${PROBE_ADDRESS} via 192.168.1.1 src 192.168.1.2`)).toBeNull()
    expect(parseLinuxRoute(`${PROBE_ADDRESS} dev $(reboot)`)).toBeNull()
  })

  it('counts tun and WireGuard links as tunnels, and an Ethernet link as not', () => {
    expect(isLinuxTunnel(fixture('linux-link-tailscale.txt'))).toBe(true)
    expect(isLinuxTunnel(fixture('linux-link-wg0.txt'))).toBe(true)
    expect(isLinuxTunnel(fixture('linux-link-wired.txt'))).toBe(false)
    expect(isLinuxTunnel(fixture('linux-link-wifi.txt'))).toBe(false)
  })

  it('reads the router address from the neighbour table and the Wi-Fi name from iw', () => {
    expect(parseLinuxNeighbour(fixture('linux-neigh-router.txt'))).toBe('00:00:5e:00:53:01')
    expect(parseLinuxNeighbour('192.168.1.1 INCOMPLETE')).toBeNull()
    expect(parseIwSsid(fixture('linux-iw-wifi.txt'))).toBe('Example Network')
    expect(parseIwSsid(fixture('linux-iw-wired.txt'))).toBe('')
  })

  it('sees no VPN on the captured wired machine, whose tun adapter is off the route', async () => {
    const run = commands({
      [ROUTE]: fixture('linux-route-wired.txt'),
      'ip -o -d link show dev enp86s0': fixture('linux-link-wired.txt'),
      'ip -4 neigh show 192.168.8.1 dev enp86s0': fixture('linux-neigh-router.txt'),
      'iw dev enp86s0 link': fixture('linux-iw-wired.txt')
    })
    expect(await readLinux(run)).toEqual({
      vpnSeen: false,
      network: { name: '', routerMac: '00:00:5e:00:53:01' }
    })
  })

  it('names a Wi-Fi network, and reads no name when iw is missing', async () => {
    const table = {
      [ROUTE]: fixture('linux-route-wifi.txt'),
      'ip -o -d link show dev wlan0': fixture('linux-link-wifi.txt'),
      'ip -4 neigh show 192.168.1.1 dev wlan0': fixture('linux-neigh-wifi-router.txt'),
      'iw dev wlan0 link': fixture('linux-iw-wifi.txt')
    }
    expect(await readLinux(commands(table))).toEqual({
      vpnSeen: false,
      network: { name: 'Example Network', routerMac: '00:00:5e:00:53:02' }
    })
    const withoutIw = Object.fromEntries(
      Object.entries(table).filter(([line]) => !/^iw /.test(line))
    )
    expect(await readLinux(commands(withoutIw))).toEqual({
      vpnSeen: false,
      network: { name: '', routerMac: '00:00:5e:00:53:02' }
    })
  })

  it('sees a VPN when policy routing sends the probe through a tunnel', async () => {
    const wg = commands({
      [ROUTE]: fixture('linux-route-wg-quick.txt'),
      'ip -o -d link show dev wg0': fixture('linux-link-wg0.txt')
    })
    expect(await readLinux(wg)).toEqual({ vpnSeen: true, network: null })
    const exitNode = commands({
      [ROUTE]: fixture('linux-route-tailscale-exit-node.txt'),
      'ip -o -d link show dev tailscale0': fixture('linux-link-tailscale.txt')
    })
    expect(await readLinux(exitNode)).toEqual({ vpnSeen: true, network: null })
  })

  it('names no network when there is no route, no gateway or no router address', async () => {
    const notSeen = { vpnSeen: false, network: null }
    expect(await readLinux(commands({ [ROUTE]: '' }))).toEqual(notSeen)
    const onLink = commands({
      [ROUTE]: `${PROBE_ADDRESS} dev enp86s0 src 192.0.2.9 uid 1000 \\    cache `,
      'ip -o -d link show dev enp86s0': fixture('linux-link-wired.txt')
    })
    expect(await readLinux(onLink)).toEqual(notSeen)
    const noNeighbour = commands({
      [ROUTE]: fixture('linux-route-wired.txt'),
      'ip -o -d link show dev enp86s0': fixture('linux-link-wired.txt'),
      'ip -4 neigh show 192.168.8.1 dev enp86s0': ''
    })
    expect(await readLinux(noNeighbour)).toEqual(notSeen)
  })
})

describe('macOS', () => {
  const NETSTAT = '/usr/sbin/netstat -rn'
  const AIRPORT = '/usr/sbin/networksetup -getairportnetwork en0'

  it('reads only the IPv4 table, by its own header', () => {
    const routes = parseMacRoutes(fixture('macos-netstat-utun-no-vpn.txt'))
    expect(routes).toHaveLength(11)
    expect(routes.some(({ netif }) => netif.startsWith('utun'))).toBe(false)
    expect(routes[0]).toEqual({
      destination: 'default',
      gateway: '192.168.1.1',
      flags: 'UGScg',
      netif: 'en0'
    })
    const older = parseMacRoutes(fixture('macos-netstat-refs-columns.txt'))
    expect(older[0]).toEqual({
      destination: 'default',
      gateway: '192.168.1.1',
      flags: 'UGSc',
      netif: 'en0'
    })
  })

  it('reads nothing from output with no IPv4 table or an unknown header', () => {
    expect(parseMacRoutes('Routing tables\n')).toEqual([])
    expect(parseMacRoutes('Internet:\nDest Gw Flags\ndefault 192.168.1.1 UGSc\n')).toEqual([])
  })

  it('takes the longest unscoped route to the probe', () => {
    const plain = parseMacRoutes(fixture('macos-netstat-utun-no-vpn.txt'))
    expect(macRouteToProbe(plain)?.netif).toBe('en0')
    const packetTunnel = parseMacRoutes(fixture('macos-netstat-packet-tunnel.txt'))
    expect(macRouteToProbe(packetTunnel)?.netif).toBe('utun4')
    const split = parseMacRoutes(fixture('macos-netstat-split-default.txt'))
    expect(macRouteToProbe(split)).toMatchObject({ destination: '128.0/1', netif: 'utun5' })
    expect(macRouteToProbe([])).toBeNull()
  })

  it('names tunnel interfaces only', () => {
    expect(['utun4', 'ipsec0', 'tun0', 'tap1'].every(isMacTunnel)).toBe(true)
    expect(['en0', 'bridge100', 'utun'].some(isMacTunnel)).toBe(false)
  })

  it("finds the router's hardware address in its own host row", () => {
    const routes = parseMacRoutes(fixture('macos-netstat-utun-no-vpn.txt'))
    expect(macRouterAddress(routes, '192.168.1.1')).toBe('00:00:5e:00:53:01')
    expect(macRouterAddress(routes, 'link#11')).toBeNull()
    expect(macRouterAddress(routes, '192.168.1.77')).toBeNull()
  })

  it('reads the Wi-Fi name, and none from a wired or withheld answer', () => {
    expect(parseAirportNetwork('Current Wi-Fi Network: Example Network\n')).toBe('Example Network')
    expect(parseAirportNetwork('Current AirPort Network: Example Network\n')).toBe(
      'Example Network'
    )
    expect(parseAirportNetwork('You are not associated with an AirPort network.\n')).toBe('')
    expect(parseAirportNetwork('en0 is not a Wi-Fi interface.\n')).toBe('')
  })

  it("sees no VPN with only the system's utun adapters", async () => {
    const run = commands({
      [NETSTAT]: fixture('macos-netstat-utun-no-vpn.txt'),
      [AIRPORT]: 'Current Wi-Fi Network: Example Network\n'
    })
    expect(await readMac(run)).toEqual({
      vpnSeen: false,
      network: { name: 'Example Network', routerMac: '00:00:5e:00:53:01' }
    })
  })

  it('reads no name when networksetup fails, as on a wired adapter', async () => {
    const run = commands({ [NETSTAT]: fixture('macos-netstat-refs-columns.txt') })
    expect(await readMac(run)).toEqual({
      vpnSeen: false,
      network: { name: '', routerMac: '00:00:5e:00:53:01' }
    })
  })

  it('sees a VPN that takes the default route or splits it in two', async () => {
    for (const name of ['macos-netstat-packet-tunnel.txt', 'macos-netstat-split-default.txt']) {
      expect(await readMac(commands({ [NETSTAT]: fixture(name) }))).toEqual({
        vpnSeen: true,
        network: null
      })
    }
  })

  it('names no network without a route or a router row', async () => {
    const notSeen = { vpnSeen: false, network: null }
    expect(await readMac(commands({ [NETSTAT]: '' }))).toEqual(notSeen)
    const noRouterRow = fixture('macos-netstat-utun-no-vpn.txt')
      .split('\n')
      .filter((line) => !line.startsWith('192.168.1.1  '))
      .join('\n')
    expect(await readMac(commands({ [NETSTAT]: noRouterRow }))).toEqual(notSeen)
  })
})

describe('Windows', () => {
  it('sees no VPN on Wi-Fi, skipping the disconnected adapter', () => {
    expect(windowsReading(fixture('windows-wifi-no-vpn.json'))).toEqual({
      vpnSeen: false,
      network: { name: 'Example Network', routerMac: '00:00:5e:00:53:01' }
    })
  })

  it('takes the lower metric between equal prefixes, so a WireGuard tunnel wins', () => {
    expect(windowsReading(fixture('windows-wireguard.json'))).toEqual({
      vpnSeen: true,
      network: null
    })
  })

  it('takes the longer prefix, so a split default through a TAP adapter wins', () => {
    expect(windowsReading(fixture('windows-openvpn-tap.json'))).toEqual({
      vpnSeen: true,
      network: null
    })
  })

  it('names no network on a wired adapter, whose profile name is not a Wi-Fi name', () => {
    const snapshot = JSON.parse(fixture('windows-openvpn-tap.json'))
    snapshot.routes = snapshot.routes.filter(
      (route: { InterfaceIndex: number }) => route.InterfaceIndex === 12
    )
    expect(windowsReading(JSON.stringify(snapshot))).toEqual({
      vpnSeen: false,
      network: { name: '', routerMac: '00:00:5e:00:53:01' }
    })
  })

  it('reads a lone object and a { value, Count } wrapper as lists', () => {
    const snapshot = JSON.parse(fixture('windows-wifi-no-vpn.json'))
    const wrapped = {
      ...snapshot,
      routes: { value: snapshot.routes, Count: snapshot.routes.length },
      interfaces: snapshot.interfaces[0],
      adapters: snapshot.adapters[0],
      profiles: snapshot.profiles[0]
    }
    expect(windowsReading(JSON.stringify(wrapped))).toEqual(
      windowsReading(fixture('windows-wifi-no-vpn.json'))
    )
  })

  it('names a tunnel by its interface type or its description', () => {
    expect(isWindowsTunnel({ InterfaceType: 131 })).toBe(true)
    expect(isWindowsTunnel({ InterfaceDescription: 'NordLynx Tunnel', InterfaceType: 53 })).toBe(
      true
    )
    expect(isWindowsTunnel({ Name: 'Wi-Fi', InterfaceType: 71 })).toBe(false)
  })

  it('names no network without a route, a next hop or a router address', () => {
    const notSeen = { vpnSeen: false, network: null }
    expect(windowsReading('null')).toEqual(notSeen)
    expect(windowsReading('{}')).toEqual(notSeen)
    const snapshot = JSON.parse(fixture('windows-wifi-no-vpn.json'))
    expect(windowsReading(JSON.stringify({ ...snapshot, neighbors: [] }))).toEqual(notSeen)
    const onLink = {
      ...snapshot,
      routes: [{ DestinationPrefix: '0.0.0.0/0', NextHop: '0.0.0.0', InterfaceIndex: 12 }]
    }
    expect(windowsReading(JSON.stringify(onLink))).toEqual(notSeen)
    const malformed = {
      ...snapshot,
      routes: [{ DestinationPrefix: 'default', NextHop: '192.168.1.1', InterfaceIndex: 12 }]
    }
    expect(windowsReading(JSON.stringify(malformed))).toEqual(notSeen)
  })

  it('runs Windows PowerShell from the system directory with no profile', async () => {
    const run = vi.fn(async () => fixture('windows-wifi-no-vpn.json'))
    const reading = await readWindows(run)
    expect(reading.vpnSeen).toBe(false)
    const [[file, args]] = run.mock.calls as unknown as [[string, string[]]]
    expect(file.toLowerCase()).toMatch(/\\system32\\windowspowershell\\v1\.0\\powershell\.exe$/)
    expect(args.slice(0, 4)).toEqual(['-NoLogo', '-NoProfile', '-NonInteractive', '-Command'])
    expect(args[4]).toContain('Get-NetRoute -AddressFamily IPv4')
  })
})

describe('readNetwork', () => {
  it('reads the table of the platform it runs on, and nothing elsewhere', async () => {
    const run = commands({
      [ROUTE]: '',
      '/usr/sbin/netstat -rn': ''
    })
    const notSeen = { vpnSeen: false, network: null }
    expect(await readNetwork('linux', run)).toEqual(notSeen)
    expect(await readNetwork('darwin', run)).toEqual(notSeen)
    expect(await readNetwork('freebsd', run)).toEqual(notSeen)
    expect(run).toHaveBeenCalledTimes(2)
    const windows = vi.fn(async () => 'null')
    expect(await readNetwork('win32', windows)).toEqual(notSeen)
    expect(windows).toHaveBeenCalledTimes(1)
  })
})

describe('runCommand', () => {
  it('resolves with the output and rejects when the command fails', async () => {
    const node = process.execPath
    expect(await runCommand(node, ['-e', 'process.stdout.write("route")'])).toBe('route')
    await expect(runCommand(node, ['-e', 'process.exit(3)'])).rejects.toThrow()
  })
})

describe('detectNetwork', () => {
  beforeEach(() => {
    electronApp.isPackaged = true
    loggerInfo.mockClear()
  })

  afterEach(() => {
    delete process.env[E2E_VPN_SWITCH]
    delete process.env[E2E_NETWORK_SWITCH]
  })

  it('reads a failed check as a VPN not seen, and logs the first failure only', async () => {
    const read = vi.fn(async () => {
      throw new Error('spawn ip ENOENT')
    })
    expect(await detectNetwork(read)).toEqual({ vpnSeen: false, network: null })
    expect(await detectNetwork(read)).toEqual({ vpnSeen: false, network: null })
    expect(loggerInfo).toHaveBeenCalledTimes(1)
    expect(loggerInfo).toHaveBeenCalledWith(
      'app',
      'app.vpn_check_failed',
      undefined,
      expect.any(Error)
    )
  })

  it('ignores the e2e switches in a packaged build', async () => {
    process.env[E2E_VPN_SWITCH] = 'seen'
    const reading = { vpnSeen: false, network: null }
    expect(await detectNetwork(async () => reading)).toBe(reading)
  })

  it('takes the reading from the e2e switches in an unpackaged build', async () => {
    electronApp.isPackaged = false
    const read = vi.fn(async () => ({ vpnSeen: false, network: null }))
    process.env[E2E_VPN_SWITCH] = 'seen'
    expect(await detectNetwork(read)).toEqual({ vpnSeen: true, network: null })
    process.env[E2E_VPN_SWITCH] = 'not-seen'
    process.env[E2E_NETWORK_SWITCH] = 'cafe'
    expect(await detectNetwork(read)).toEqual({
      vpnSeen: false,
      network: { name: 'cafe', routerMac: '00:00:5e:00:53:01' }
    })
    delete process.env[E2E_NETWORK_SWITCH]
    expect((await detectNetwork(read)).network?.name).toBe('')
    process.env[E2E_VPN_SWITCH] = 'something-else'
    await detectNetwork(read)
    expect(read).toHaveBeenCalledTimes(1)
  })
})
