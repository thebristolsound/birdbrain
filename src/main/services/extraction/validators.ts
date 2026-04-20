import { parse } from 'tldts'

type ParsedTld = ReturnType<typeof parse>

function parseOctets(ip: string): [number, number, number, number] | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  const octets: number[] = []
  for (const part of parts) {
    if (part.length === 0) return null
    // Reject leading zeros (e.g. "010") but allow bare "0"
    if (part.length > 1 && part[0] === '0') return null
    const n = Number(part)
    if (!Number.isInteger(n) || n < 0 || n > 255) return null
    // Reject anything that isn't purely digits (e.g. "1e2", "0x0a")
    if (!/^\d+$/.test(part)) return null
    octets.push(n)
  }
  return octets as [number, number, number, number]
}

export function isPublicIpv4(ip: string): boolean {
  if (typeof ip !== 'string') return false
  const octets = parseOctets(ip)
  if (octets === null) return false

  const [a, b, c] = octets

  switch (a) {
    case 0:
      return false // 0.0.0.0/8 — "this" network
    case 10:
      return false // 10.0.0.0/8 — RFC1918
    case 100:
      if (b >= 64 && b <= 127) return false // 100.64.0.0/10 — CGNAT
      break
    case 127:
      return false // 127.0.0.0/8 — loopback
    case 169:
      if (b === 254) return false // 169.254.0.0/16 — link-local
      break
    case 172:
      if (b >= 16 && b <= 31) return false // 172.16.0.0/12 — RFC1918
      break
    case 192:
      if (b === 0 && c === 0) return false // 192.0.0.0/24 — IETF protocol
      if (b === 0 && c === 2) return false // 192.0.2.0/24 — TEST-NET-1
      if (b === 88 && c === 99) return false // 192.88.99.0/24 — 6to4 relay
      if (b === 168) return false // 192.168.0.0/16 — RFC1918
      break
    case 198:
      if (b === 18 || b === 19) return false // 198.18.0.0/15 — benchmarking
      if (b === 51 && c === 100) return false // 198.51.100.0/24 — TEST-NET-2
      break
    case 203:
      if (b === 0 && c === 113) return false // 203.0.113.0/24 — TEST-NET-3
      break
    default:
      if (a >= 224 && a <= 239) return false // 224.0.0.0/4 — multicast
      if (a >= 240) return false // 240.0.0.0/4 — reserved (includes 255.255.255.255)
      break
  }

  return true
}

const DOMAIN_BLOCKLIST_EXACT = new Set([
  'localhost',
  'local',
  'invalid',
  'test',
  'example',
  'internal',
  'lan',
  'arpa'
])

const DOMAIN_BLOCKLIST_SUFFIX = [
  '.local',
  '.localhost',
  '.invalid',
  '.test',
  '.example',
  '.internal',
  '.lan',
  '.home',
  '.home.arpa',
  '.arpa'
]

export function isValidDomainParsed(host: string, parsed: ParsedTld): boolean {
  if (typeof host !== 'string') return false
  if (host.length > 253) return false
  if (!host.includes('.')) return false

  const lower = host.toLowerCase()

  if (DOMAIN_BLOCKLIST_EXACT.has(lower)) return false
  for (const suffix of DOMAIN_BLOCKLIST_SUFFIX) {
    if (lower === suffix.slice(1) || lower.endsWith(suffix)) return false
  }

  if (parsed.isIp) return false
  if (!parsed.publicSuffix || !parsed.domain) return false
  if (!parsed.isIcann) return false

  return true
}

export function isValidDomain(host: string): boolean {
  if (typeof host !== 'string') return false
  return isValidDomainParsed(host, parse(host.toLowerCase(), { validHosts: [] }))
}

const EMAIL_DOMAIN_DENYLIST = new Set([
  'mhtml.blink',
  'example.com',
  'example.org',
  'example.net',
  'example.edu',
  'localhost',
  'test',
  'invalid',
  'noreply.github.com',
  'users.noreply.github.com',
  'email.example.com',
  'donotreply.com',
  'do-not-reply.com'
])

export function isValidEmailDomain(domain: string): boolean {
  if (typeof domain !== 'string') return false
  const lower = domain.toLowerCase()
  if (EMAIL_DOMAIN_DENYLIST.has(lower)) return false
  return isValidDomain(lower)
}

export function isValidEmail(email: string): boolean {
  if (typeof email !== 'string') return false
  const atIdx = email.lastIndexOf('@')
  if (atIdx < 1) return false
  const local = email.slice(0, atIdx)
  const domain = email.slice(atIdx + 1)
  if (local.length < 1 || local.length > 64) return false
  if (domain.length < 1 || domain.length > 253) return false
  return isValidEmailDomain(domain)
}
