import { parse as parseTld } from 'tldts'
import { sanitizeHtml, MAX_HTML_BYTES } from './extraction/sanitizer'
import { extractIocs } from './extraction/iocAdapter'
import { isPublicIpv4, isValidDomain, isValidEmail } from './extraction/validators'

export interface ExtractionRule {
  category: string
  subcategory: string
  patterns: RegExp[]
  normalize?: (match: string) => string | null
}

export interface ExtractedDatum {
  category: string
  subcategory: string
  value: string
}

export { MAX_HTML_BYTES }

export const EXTRACTION_RULES: ExtractionRule[] = [
  {
    category: 'Tracking Code',
    subcategory: 'Google Tag Manager',
    patterns: [/GTM-[A-Z0-9]{4,8}/g]
  },
  {
    category: 'Tracking Code',
    subcategory: 'Google Analytics',
    patterns: [/G-[A-Z0-9]{10}/g]
  },
  {
    category: 'Tracking Code',
    subcategory: 'Facebook Pixel',
    patterns: [/fbq\s*\([^)]*?["'](\d{15,16})["']/g],
    normalize: (match: string) => {
      const m = match.match(/["'](\d{15,16})["']/)
      return m ? m[1] : null
    }
  },
  {
    category: 'Tracking Code',
    subcategory: 'Google Ads',
    patterns: [/AW-\d{9,11}/g]
  },
  {
    category: 'Accounts',
    subcategory: 'Twitter/X',
    patterns: [/(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]{1,15})(?:[/?#"'\s>]|$)/gi],
    normalize: (match: string) => {
      const m = match.match(/(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]{1,15})/i)
      return m ? m[1] : null
    }
  },
  {
    category: 'Accounts',
    subcategory: 'Facebook',
    patterns: [/facebook\.com\/([a-zA-Z0-9.]{1,50})(?:[/?#"'\s>]|$)/gi],
    normalize: (match: string) => {
      const m = match.match(/facebook\.com\/([a-zA-Z0-9.]+)/i)
      if (!m) return null
      const slug = m[1]
      if (
        ['sharer', 'share', 'plugins', 'tr', 'dialog', 'login', 'home', 'pages'].includes(
          slug.toLowerCase()
        )
      )
        return null
      return slug
    }
  },
  {
    category: 'Accounts',
    subcategory: 'Instagram',
    patterns: [/instagram\.com\/([a-zA-Z0-9_.]{1,30})(?:[/?#"'\s>]|$)/gi],
    normalize: (match: string) => {
      const m = match.match(/instagram\.com\/([a-zA-Z0-9_.]+)/i)
      if (!m) return null
      const slug = m[1]
      if (
        ['p', 'explore', 'stories', 'reel', 'reels', 'tv', 'accounts'].includes(slug.toLowerCase())
      )
        return null
      return slug
    }
  },
  {
    category: 'Accounts',
    subcategory: 'LinkedIn',
    patterns: [/linkedin\.com\/in\/([a-zA-Z0-9-]{1,100})(?:[/?#"'\s>]|$)/gi],
    normalize: (match: string) => {
      const m = match.match(/linkedin\.com\/in\/([a-zA-Z0-9-]+)/i)
      return m ? m[1] : null
    }
  },
  {
    category: 'Accounts',
    subcategory: 'YouTube',
    patterns: [/youtube\.com\/(?:@|channel\/|user\/)([a-zA-Z0-9_-]{1,100})(?:[/?#"'\s>]|$)/gi],
    normalize: (match: string) => {
      const m = match.match(/youtube\.com\/(?:@|channel\/|user\/)([a-zA-Z0-9_-]+)/i)
      return m ? m[1] : null
    }
  },
  {
    category: 'Accounts',
    subcategory: 'GitHub',
    patterns: [/github\.com\/([a-zA-Z0-9-]{1,39})(?:[/?#"'\s>]|$)/gi],
    normalize: (match: string) => {
      const m = match.match(/github\.com\/([a-zA-Z0-9-]+)/i)
      if (!m) return null
      const slug = m[1]
      if (
        [
          'login',
          'logout',
          'settings',
          'orgs',
          'issues',
          'pulls',
          'marketplace',
          'explore',
          'topics',
          'trending',
          'stars',
          'join',
          'new',
          'notifications',
          'features',
          'about',
          'pricing',
          'contact',
          'sponsors',
          'apps',
          'search'
        ].includes(slug.toLowerCase())
      )
        return null
      return slug
    }
  },
  {
    category: 'Accounts',
    subcategory: 'Telegram',
    patterns: [/t\.me\/([a-zA-Z0-9_]{5,32})(?:[/?#"'\s>]|$)/gi],
    normalize: (match: string) => {
      const m = match.match(/t\.me\/([a-zA-Z0-9_]+)/i)
      return m ? m[1] : null
    }
  },
  {
    category: 'Darkweb',
    subcategory: 'Onion URL',
    patterns: [/[a-z2-7]{16,56}\.onion(?:[/?#:"'\s>]|$)/gi],
    normalize: (match: string) => {
      const m = match.match(/([a-z2-7]{16,56}\.onion)/i)
      return m ? m[1].toLowerCase() : null
    }
  },
  {
    category: 'Darkweb',
    subcategory: 'I2P URL',
    patterns: [/[a-zA-Z0-9-]{1,253}\.i2p(?:[/?#:"'\s]|$)/g],
    normalize: (match: string) => {
      const m = match.match(/([a-zA-Z0-9-]+\.i2p)/i)
      return m ? m[1].toLowerCase() : null
    }
  }
]

// Only accept absolute http(s) URLs or protocol-relative `//host/...` forms.
// Relative paths (`/assets/app.js`, `script.js`) and other schemes (`ftp:`,
// `tel:`) produce noisy "Domain Reference" entries when fed through tldts.
const ABSOLUTE_URL = /^https?:\/\//i

function harvestDomain(url: string): string | null {
  if (!url) return null
  const trimmed = url.trim()
  if (!trimmed) return null
  const isProtocolRelative = trimmed.startsWith('//')
  if (!isProtocolRelative && !ABSOLUTE_URL.test(trimmed)) return null
  const candidate = isProtocolRelative ? `http:${trimmed}` : trimmed
  const result = parseTld(candidate, { validHosts: [] })
  if (!result || result.isIp) return null
  if (!result.hostname || !result.domain) return null
  return result.hostname
}

function runRules(text: string): ExtractedDatum[] {
  const out: ExtractedDatum[] = []
  for (const rule of EXTRACTION_RULES) {
    for (const pattern of rule.patterns) {
      pattern.lastIndex = 0

      let match: RegExpExecArray | null
      while ((match = pattern.exec(text)) !== null) {
        const raw = match[0]
        let value: string | null = raw

        if (rule.normalize) {
          value = rule.normalize(raw)
        }

        if (!value) continue
        value = value.trim()
        if (!value) continue

        out.push({ category: rule.category, subcategory: rule.subcategory, value })
      }
    }
  }
  return out
}

const CASE_INSENSITIVE_SUBCATEGORIES = new Set<string>([
  'Email Address',
  'Domain Reference',
  'MD5 Hash',
  'SHA1 Hash',
  'SHA256 Hash',
  'SHA512 Hash'
])

export function extractData(html: string): ExtractedDatum[] {
  if (!html) return []

  // Truncate to MAX_HTML_BYTES *before* parsing to avoid blocking on huge inputs.
  // Use Buffer-based slicing so the cap is enforced in real bytes regardless of
  // multi-byte characters (consistent with sanitizeHtml's internal truncation).
  const cappedHtml =
    Buffer.byteLength(html, 'utf8') > MAX_HTML_BYTES
      ? Buffer.from(html, 'utf8').slice(0, MAX_HTML_BYTES).toString('utf8')
      : html

  // (a) Sanitize HTML — strips script/style/comments, harvests attrs, returns visible text
  const { text, attrs } = sanitizeHtml(cappedHtml)

  // Build a scannable text blob: visible text + harvested attr values (URLs).
  // Social-account/darkweb rules rely on URL patterns from href/src/action that
  // are no longer present in sanitized visible text.
  const scanText = [text, ...attrs.href, ...attrs.src, ...attrs.action, ...attrs.mailto].join('\n')

  // (b) Run ioc-extractor against sanitized text + attr URLs
  const iocs = extractIocs(scanText)

  // (c) Run remaining hand-rolled rules against the same scannable text (NOT raw html)
  const ruleMatches = runRules(scanText)

  // (d) Harvest domains from href/src/action attrs via tldts
  const attrDomains: ExtractedDatum[] = []
  for (const list of [attrs.href, attrs.src, attrs.action]) {
    for (const url of list) {
      const host = harvestDomain(url)
      if (host) {
        attrDomains.push({
          category: 'Infrastructure',
          subcategory: 'Domain Reference',
          value: host
        })
      }
    }
  }

  // (e) mailto emails map to Email Address data
  const mailtoEmails: ExtractedDatum[] = attrs.mailto.map((value) => ({
    category: 'Infrastructure',
    subcategory: 'Email Address',
    value
  }))

  // (f) Merge and filter through validators
  const merged = [...iocs, ...ruleMatches, ...attrDomains, ...mailtoEmails]
  const filtered: ExtractedDatum[] = []
  for (const datum of merged) {
    if (datum.subcategory === 'IPv4 Address') {
      if (!isPublicIpv4(datum.value)) continue
    } else if (datum.subcategory === 'Domain Reference') {
      if (!isValidDomain(datum.value)) continue
    } else if (datum.subcategory === 'Email Address') {
      if (!isValidEmail(datum.value)) continue
    }
    filtered.push(datum)
  }

  // (g) Dedupe on category|subcategory|value. For case-insensitive subcategories
  // (emails, domains, hashes), lowercase the value before building the key AND
  // store the normalized value so downstream consumers see consistent casing.
  const seen = new Set<string>()
  const results: ExtractedDatum[] = []
  for (const datum of filtered) {
    const normalized = CASE_INSENSITIVE_SUBCATEGORIES.has(datum.subcategory)
      ? { ...datum, value: datum.value.toLowerCase() }
      : datum
    const key = `${normalized.category}|${normalized.subcategory}|${normalized.value}`
    if (seen.has(key)) continue
    seen.add(key)
    results.push(normalized)
  }

  return results
}
