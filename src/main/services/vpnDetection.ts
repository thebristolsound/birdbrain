import { execFile } from 'child_process'
import { win32 } from 'path'
import { app } from 'electron'
import { logger } from '@main/services/logger'

// ADR-0032, "Birdbrain pushes the Operator toward a VPN, but only warns", rule 1: the check
// asks which adapter carries this computer's IPv4 traffic to the internet, from the routing
// table, and contacts no outside service. An adapter counts as a tunnel only when it is
// recognised as one. Anything unfamiliar reads as a VPN not seen, so the doubt falls on the
// side of a warning the Operator can mute, not of a silence.

// The routing lookups ask which route traffic to this address would take; nothing is sent to
// it (an RFC 5737 documentation address). Asking about an address rather than reading the
// 0.0.0.0/0 entry also sees a VPN that overrides the default route with 0.0.0.0/1 and
// 128.0.0.0/1, as OpenVPN does.
export const PROBE_ADDRESS = '192.0.2.1'

export interface NetworkIdentity {
  // The Wi-Fi network's name when the system reports one, '' otherwise.
  name: string
  routerMac: string
}

export interface NetworkReading {
  vpnSeen: boolean
  // "This network" for the warning's mute choice. Null when a VPN is seen, or when the
  // router's hardware address could not be read.
  network: NetworkIdentity | null
}

const NOT_SEEN: NetworkReading = { vpnSeen: false, network: null }
const SEEN: NetworkReading = { vpnSeen: true, network: null }

export type RunCommand = (file: string, args: readonly string[]) => Promise<string>

export const runCommand: RunCommand = (file, args) =>
  new Promise((resolve, reject) => {
    execFile(
      file,
      [...args],
      { timeout: 5000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => (err ? reject(err) : resolve(stdout))
    )
  })

export function normaliseMac(value: string): string | null {
  const parts = value.trim().toLowerCase().split(/[:-]/)
  if (parts.length !== 6 || !parts.every((part) => /^[0-9a-f]{1,2}$/.test(part))) return null
  const mac = parts.map((part) => part.padStart(2, '0')).join(':')
  return mac === '00:00:00:00:00:00' ? null : mac
}

function ipv4(address: string): number | null {
  const parts = address.split('.')
  if (parts.length !== 4) return null
  let value = 0
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part) || Number(part) > 255) return null
    value = value * 256 + Number(part)
  }
  return value
}

const PROBE = ipv4(PROBE_ADDRESS) as number

function coversProbe(network: number, prefix: number): boolean {
  const size = 2 ** (32 - prefix)
  return Math.floor(network / size) === Math.floor(PROBE / size)
}

// --- Linux ---------------------------------------------------------------------------------
//
// `ip route get` is the kernel's own answer, so it follows policy routing: wg-quick, for one,
// leaves the main table's default route alone and routes through a table of its own.

export interface LinuxRoute {
  device: string
  gateway: string | null
}

export function parseLinuxRoute(output: string): LinuxRoute | null {
  const words = output.trim().split(/\s+/)
  if (words[0] !== PROBE_ADDRESS) return null
  const after = (key: string): string | null => {
    const at = words.indexOf(key)
    return at >= 0 ? (words[at + 1] ?? null) : null
  }
  const device = after('dev')
  if (!device || !/^[\w.@-]+$/.test(device)) return null
  return { device, gateway: after('via') }
}

// The link kinds `ip -d link` names for tunnel adapters. PPP is left out: it also carries
// PPPoE and dial-up, which are not VPNs.
const LINUX_TUNNEL_KINDS = new Set(['tun', 'wireguard', 'xfrm', 'vti'])

// `ip -o -d link show` prints one line with `\` where the detail lines break; the kind,
// when there is one, starts one of those segments.
export function isLinuxTunnel(linkOutput: string): boolean {
  return linkOutput
    .split('\\')
    .slice(1)
    .some((segment) => LINUX_TUNNEL_KINDS.has(segment.trim().split(/\s+/)[0]))
}

export function parseLinuxNeighbour(output: string): string | null {
  const lladdr = /\blladdr\s+(\S+)/.exec(output)
  return lladdr ? normaliseMac(lladdr[1]) : null
}

export function parseIwSsid(output: string): string {
  return /^\s*SSID: (.*)$/m.exec(output)?.[1] ?? ''
}

export async function readLinux(run: RunCommand): Promise<NetworkReading> {
  const route = parseLinuxRoute(await run('ip', ['-4', '-o', 'route', 'get', PROBE_ADDRESS]))
  if (!route) return NOT_SEEN
  if (isLinuxTunnel(await run('ip', ['-o', '-d', 'link', 'show', 'dev', route.device]))) {
    return SEEN
  }
  if (!route.gateway) return NOT_SEEN
  const routerMac = parseLinuxNeighbour(
    await run('ip', ['-4', 'neigh', 'show', route.gateway, 'dev', route.device])
  )
  if (!routerMac) return NOT_SEEN
  // `iw` names no SSID on a wired adapter and is missing on some systems; either way there
  // is no Wi-Fi name to read.
  const ssid = await run('iw', ['dev', route.device, 'link']).catch(() => '')
  return { vpnSeen: false, network: { name: parseIwSsid(ssid), routerMac } }
}

// --- macOS ---------------------------------------------------------------------------------
//
// macOS keeps utun adapters for its own services (ADR-0032 rule 1). The check reads only the
// IPv4 table and skips interface-scoped routes (the `I` flag), so a utun adapter counts only
// when an unscoped IPv4 route to the probe uses it.

export interface MacRoute {
  destination: string
  gateway: string
  flags: string
  netif: string
}

// The IPv4 rows of `netstat -rn`. The Netif column is found by its header, so a table with
// or without the Refs and Use columns parses.
export function parseMacRoutes(output: string): MacRoute[] {
  const lines = output.split(/\r?\n/)
  const start = lines.findIndex((line) => line.trim() === 'Internet:')
  if (start < 0) return []
  const header = (lines[start + 1] ?? '').trim().split(/\s+/)
  const netifColumn = header.indexOf('Netif')
  if (header[0] !== 'Destination' || netifColumn < 0) return []
  const routes: MacRoute[] = []
  for (const line of lines.slice(start + 2)) {
    if (!line.trim()) break
    const columns = line.trim().split(/\s+/)
    const [destination, gateway, flags] = columns
    const netif = columns[netifColumn]
    if (destination && gateway && flags && netif)
      routes.push({ destination, gateway, flags, netif })
  }
  return routes
}

// netstat shortens a network to its significant octets ("192.168.1" is a /24) and adds the
// prefix length when the octets do not imply it.
function macNetwork(destination: string): { address: number; prefix: number } | null {
  if (destination === 'default') return { address: 0, prefix: 0 }
  const [base, length] = destination.split('/')
  const octets = base.split('.')
  if (octets.length > 4) return null
  const address = ipv4([...octets, '0', '0', '0'].slice(0, 4).join('.'))
  const prefix = length === undefined ? octets.length * 8 : Number(length)
  if (address === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null
  return { address, prefix }
}

export function macRouteToProbe(routes: MacRoute[]): MacRoute | null {
  let best: { route: MacRoute; prefix: number } | null = null
  for (const route of routes) {
    if (!route.flags.includes('U') || route.flags.includes('I')) continue
    const network = macNetwork(route.destination)
    if (!network || !coversProbe(network.address, network.prefix)) continue
    if (!best || network.prefix > best.prefix) best = { route, prefix: network.prefix }
  }
  return best?.route ?? null
}

export function isMacTunnel(netif: string): boolean {
  return /^(utun|ipsec|tun|tap)\d+$/.test(netif)
}

// The router's own row: a host route to the gateway whose gateway column is its
// hardware address.
export function macRouterAddress(routes: MacRoute[], gateway: string): string | null {
  if (ipv4(gateway) === null) return null
  for (const { destination, gateway: hardware } of routes) {
    const mac = destination === gateway ? normaliseMac(hardware) : null
    if (mac) return mac
  }
  return null
}

export function parseAirportNetwork(output: string): string {
  return /^Current (?:Wi-Fi|AirPort) Network: (.*)$/m.exec(output)?.[1] ?? ''
}

export async function readMac(run: RunCommand): Promise<NetworkReading> {
  const routes = parseMacRoutes(await run('/usr/sbin/netstat', ['-rn']))
  const route = macRouteToProbe(routes)
  if (!route) return NOT_SEEN
  if (isMacTunnel(route.netif)) return SEEN
  const routerMac = macRouterAddress(routes, route.gateway)
  if (!routerMac) return NOT_SEEN
  // Any answer but a network name, or a failure, leaves the name empty, so the network is
  // known by its router alone.
  const airport = await run('/usr/sbin/networksetup', ['-getairportnetwork', route.netif]).catch(
    () => ''
  )
  return { vpnSeen: false, network: { name: parseAirportNetwork(airport), routerMac } }
}

// --- Windows -------------------------------------------------------------------------------
//
// The route table, interface metrics and adapters come out of PowerShell as JSON, and the
// route Windows would use is chosen here: the longest prefix, then the lowest route metric
// plus interface metric.

const WINDOWS_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
  '$routes = @(Get-NetRoute -AddressFamily IPv4 -PolicyStore ActiveStore |' +
    ' Select-Object DestinationPrefix, NextHop, RouteMetric, InterfaceIndex)',
  '$interfaces = @(Get-NetIPInterface -AddressFamily IPv4 |' +
    ' Select-Object InterfaceIndex, InterfaceMetric, ConnectionState)',
  '$adapters = @(Get-NetAdapter -IncludeHidden |' +
    ' Select-Object InterfaceIndex, Name, InterfaceDescription, InterfaceType, NdisPhysicalMedium)',
  '$neighbors = @(Get-NetNeighbor -AddressFamily IPv4 |' +
    ' Select-Object IPAddress, InterfaceIndex, LinkLayerAddress)',
  '$profiles = @(Get-NetConnectionProfile -ErrorAction SilentlyContinue |' +
    ' Select-Object InterfaceIndex, Name)',
  'ConvertTo-Json -Compress -Depth 3 -InputObject @{ routes = $routes; interfaces = $interfaces;' +
    ' adapters = $adapters; neighbors = $neighbors; profiles = $profiles }'
].join('; ')

type JsonObject = Record<string, unknown>

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// An array, a lone object standing for a one-item array, or an array wrapped as
// { value, Count }.
function rows(value: unknown): JsonObject[] {
  if (Array.isArray(value)) return value.filter(isObject)
  if (!isObject(value)) return []
  return Array.isArray(value.value) ? rows(value.value) : [value]
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function numeric(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

// IANA ifType 131 is a tunnel. PPP (23) is left out, as on Linux.
const WINDOWS_TUNNEL_TYPE = 131
const WINDOWS_TUNNEL_NAME = /wireguard|wintun|tap-windows|openvpn|\btun\b|tunnel|vpn/i
// NDIS_PHYSICAL_MEDIUM: WirelessLan (1) and Native802_11 (9).
const WINDOWS_WIFI_MEDIA = new Set([1, 9])

export function isWindowsTunnel(adapter: JsonObject): boolean {
  if (numeric(adapter.InterfaceType) === WINDOWS_TUNNEL_TYPE) return true
  return WINDOWS_TUNNEL_NAME.test(`${text(adapter.InterfaceDescription)} ${text(adapter.Name)}`)
}

export function windowsReading(json: string): NetworkReading {
  const snapshot: unknown = JSON.parse(json)
  if (!isObject(snapshot)) return NOT_SEEN
  const metrics = new Map<number, number>()
  for (const row of rows(snapshot.interfaces)) {
    const index = numeric(row.InterfaceIndex)
    const connected = row.ConnectionState === 1 || row.ConnectionState === 'Connected'
    if (index !== null && connected) metrics.set(index, numeric(row.InterfaceMetric) ?? 0)
  }

  let best: { index: number; nextHop: string; prefix: number; metric: number } | null = null
  for (const row of rows(snapshot.routes)) {
    const index = numeric(row.InterfaceIndex)
    if (index === null || !metrics.has(index)) continue
    const [base, length] = text(row.DestinationPrefix).split('/')
    const address = ipv4(base)
    const prefix = Number(length)
    if (address === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) continue
    if (!coversProbe(address, prefix)) continue
    const metric = (numeric(row.RouteMetric) ?? 0) + (metrics.get(index) ?? 0)
    if (!best || prefix > best.prefix || (prefix === best.prefix && metric < best.metric)) {
      best = { index, nextHop: text(row.NextHop), prefix, metric }
    }
  }
  if (!best) return NOT_SEEN

  const { index, nextHop } = best
  const adapter = rows(snapshot.adapters).find((row) => row.InterfaceIndex === index)
  if (adapter && isWindowsTunnel(adapter)) return SEEN
  if (ipv4(nextHop) === null || nextHop === '0.0.0.0') return NOT_SEEN
  const neighbour = rows(snapshot.neighbors).find(
    (row) => row.IPAddress === nextHop && row.InterfaceIndex === index
  )
  const routerMac = neighbour ? normaliseMac(text(neighbour.LinkLayerAddress)) : null
  if (!routerMac) return NOT_SEEN
  const wifi = adapter && WINDOWS_WIFI_MEDIA.has(numeric(adapter.NdisPhysicalMedium) ?? -1)
  const profile = rows(snapshot.profiles).find((row) => row.InterfaceIndex === index)
  return { vpnSeen: false, network: { name: wifi ? text(profile?.Name) : '', routerMac } }
}

export async function readWindows(run: RunCommand): Promise<NetworkReading> {
  const powershell = win32.join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  )
  const json = await run(powershell, [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    WINDOWS_SCRIPT
  ])
  return windowsReading(json)
}

export function readNetwork(
  platform: NodeJS.Platform = process.platform,
  run: RunCommand = runCommand
): Promise<NetworkReading> {
  if (platform === 'linux') return readLinux(run)
  if (platform === 'darwin') return readMac(run)
  if (platform === 'win32') return readWindows(run)
  return Promise.resolve(NOT_SEEN)
}

// The e2e specs set what the check reads, so the warning flow runs the same on every machine.
// Only an unpackaged build reads these switches, as with the loopback switch in
// localAddressPolicy.ts.
export const E2E_VPN_SWITCH = 'BIRDBRAIN_E2E_VPN'
export const E2E_NETWORK_SWITCH = 'BIRDBRAIN_E2E_NETWORK'

function readingForTests(): NetworkReading | null {
  if (app?.isPackaged !== false) return null
  const vpn = process.env[E2E_VPN_SWITCH]
  if (vpn === 'seen') return SEEN
  if (vpn !== 'not-seen') return null
  const name = process.env[E2E_NETWORK_SWITCH] ?? ''
  return { vpnSeen: false, network: { name, routerMac: '00:00:5e:00:53:01' } }
}

let failureLogged = false

/** The reading behind the indicator and the warning. A failed read is a VPN not seen. */
export async function detectNetwork(
  read: () => Promise<NetworkReading> = readNetwork
): Promise<NetworkReading> {
  const stubbed = readingForTests()
  if (stubbed) return stubbed
  try {
    return await read()
  } catch (err) {
    if (!failureLogged) {
      failureLogged = true
      logger.info('app', 'app.vpn_check_failed', undefined, err)
    }
    return NOT_SEEN
  }
}
