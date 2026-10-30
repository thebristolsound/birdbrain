// Which web addresses aim a render at the Operator's own machine or network. The stored-page
// viewer's Capture link (#1708) refuses them up front, the background capture refuses a link
// or redirect that lands on one (#1726), and the viewer's Wayback link lookup refuses to send
// one to archive.org (#1737). All three read this one classification, so they cannot disagree.

export type LocalAddressKind =
  | 'this-computer'
  | 'loopback'
  | 'unspecified'
  | 'private'
  | 'shared'
  | 'link-local'
  | 'broadcast'
  | 'multicast'
  | 'ipv4-compatible'
  | 'nat64'
  | 'private-name'

const LABELS: Record<LocalAddressKind, string> = {
  'this-computer': 'this computer',
  loopback: 'a loopback address',
  unspecified: 'an unspecified address',
  private: 'a private address',
  shared: 'a shared address',
  'link-local': 'a link-local address',
  broadcast: 'a broadcast address',
  multicast: 'a multicast address',
  'ipv4-compatible': 'an IPv4-compatible address',
  nat64: 'a NAT64 address',
  'private-name': 'a private network'
}

/** How a refusal names the address class, as in "Points at a private address". */
export function localAddressLabel(kind: LocalAddressKind): string {
  return LABELS[kind]
}

function ipv4Kind(host: string): LocalAddressKind | null {
  const octets = host.split('.').map(Number)
  if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) {
    return null
  }
  const [a, b] = octets
  if (a === 127) return 'loopback'
  if (a === 0) return 'unspecified'
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return 'private'
  // 100.64.0.0/10, the space a carrier's NAT gives its subscribers (RFC 6598).
  if (a === 100 && b >= 64 && b <= 127) return 'shared'
  if (a === 169 && b === 254) return 'link-local'
  if (octets.every((o) => o === 255)) return 'broadcast'
  if (a >= 224 && a <= 239) return 'multicast'
  return null
}

// The last two groups of an IPv6 address as dotted IPv4, as `URL` writes them.
function embeddedIpv4(high: string, low: string): string {
  const h = parseInt(high, 16)
  const l = parseInt(low, 16)
  return `${h >> 8}.${h & 255}.${l >> 8}.${l & 255}`
}

function ipv6Kind(host: string): LocalAddressKind | null {
  const bare = host.replace(/^\[|\]$/g, '').toLowerCase()
  if (bare === '::1') return 'loopback'
  if (bare === '::') return 'unspecified'
  // `URL` writes an IPv4-mapped address as two hex groups: ::ffff:7f00:1.
  const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(bare)
  if (mapped) return ipv4Kind(embeddedIpv4(mapped[1], mapped[2]))
  // ::/96 (IPv4-compatible, deprecated) and 64:ff9b::/96 (NAT64) both carry an IPv4
  // address a gateway may route to; neither is a page's address to send a renderer to.
  if (/^::[0-9a-f]{1,4}(:[0-9a-f]{1,4})?$/.test(bare)) return 'ipv4-compatible'
  if (/^64:ff9b::([0-9a-f]{1,4}(:[0-9a-f]{1,4})?)?$/.test(bare)) return 'nat64'
  const first = parseInt(bare.split(':')[0] || '0', 16)
  if ((first & 0xfe00) === 0xfc00) return 'private'
  if ((first & 0xffc0) === 0xfe80) return 'link-local'
  if ((first & 0xff00) === 0xff00) return 'multicast'
  return null
}

// Names that only a local resolver answers: `.local` is multicast DNS (RFC 6762), `.home.arpa`
// is the home network's zone (RFC 8375), and `.internal` is reserved for private use.
const PRIVATE_SUFFIXES = ['local', 'internal', 'home.arpa']

// A web host that names the Operator's own network rather than a public site. A name with no
// dot (`wiki`, `intranet`) is completed by the local resolver's search domain. Ruling 3 of
// the viewer's slice 3 plan, 2026-10-26.
function isPrivateName(protocol: string, host: string): boolean {
  if ((protocol !== 'http:' && protocol !== 'https:') || !host) return false
  if (!host.includes('.')) return true
  return PRIVATE_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))
}

/**
 * The kind of local address `url` names, or null for a public host and for a string that
 * is not a URL. The host is read after `URL` normalises it, so `http://0x7f.1/` is a
 * loopback address. Literal addresses are caught, and so is a web host with no dot or under
 * a private-use suffix. A dotted public name that resolves to a private address is not.
 */
export function localAddressKind(url: string): LocalAddressKind | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  // Trailing dots name the same host: `localhost.` is localhost. `URL` keeps all but one of
  // them (`wiki..` stays `wiki..`), so every one is stripped before the host is read.
  const host = parsed.hostname.toLowerCase().replace(/\.+$/, '')
  if (host === 'localhost' || host.endsWith('.localhost')) return 'this-computer'
  if (host.startsWith('[')) return ipv6Kind(host)
  const kind = ipv4Kind(host)
  if (kind) return kind
  return isPrivateName(parsed.protocol, host) ? 'private-name' : null
}

/**
 * Why a link in a stored page may be neither captured nor looked up, or null when it may.
 * The page's author chose these URLs, so the Capture link menu, the Wayback lookup's menu
 * item and the main-process lookup handler all refuse the ones that would aim a render, or
 * a disclosure, at the Operator's own machine or network.
 */
export function captureLinkBlockReason(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return 'Not a web address'
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'Not a web address'
  const kind = localAddressKind(url)
  return kind ? `Points at ${localAddressLabel(kind)}` : null
}
