// Which web addresses aim a render at the Operator's own machine or network. The stored-page
// viewer's Capture link (#1708) refuses them up front, and the background capture refuses a
// link or redirect that lands on one (#1726). Both read this one classification, so the two
// cannot disagree.

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
  nat64: 'a NAT64 address'
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

/**
 * The kind of local address `url` names, or null for a public host and for a string that
 * is not a URL. The host is read after `URL` normalises it, so `http://0x7f.1/` is a
 * loopback address. Only literal addresses are caught: a public name that resolves to a
 * private address is not.
 */
export function localAddressKind(url: string): LocalAddressKind | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  // A trailing dot names the same host: `localhost.` is localhost.
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '')
  if (host === 'localhost' || host.endsWith('.localhost')) return 'this-computer'
  return host.startsWith('[') ? ipv6Kind(host) : ipv4Kind(host)
}
