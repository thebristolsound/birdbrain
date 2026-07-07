import { parse as parseTld } from 'tldts'
import { sanitizeHtml, MAX_HTML_BYTES } from '@main/services/extraction/sanitizer'
import { extractIocs } from '@main/services/extraction/iocAdapter'
import {
  isPublicIpv4,
  isValidDomain,
  isValidDomainParsed,
  isValidEmail
} from '@main/services/extraction/validators'

const FB_PIXEL_ID = /["'](\d{15,16})["']/
const TWITTER_X_HANDLE = /(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]{1,15})/i
const FACEBOOK_SLUG = /facebook\.com\/([a-zA-Z0-9.]+)/i
const INSTAGRAM_SLUG = /instagram\.com\/([a-zA-Z0-9_.]+)/i
const LINKEDIN_SLUG = /linkedin\.com\/in\/([a-zA-Z0-9-]+)/i
const YOUTUBE_HANDLE = /youtube\.com\/(?:@|channel\/|user\/)([a-zA-Z0-9_-]+)/i
const GITHUB_SLUG = /github\.com\/([a-zA-Z0-9-]+)/i
const TELEGRAM_HANDLE = /t\.me\/([a-zA-Z0-9_]+)/i
const ONION_HOST = /([a-z2-7]{16,56}\.onion)/i
const I2P_HOST = /([a-zA-Z0-9-]+\.i2p)/i

const FACEBOOK_RESERVED = new Set([
  'sharer',
  'share',
  'plugins',
  'tr',
  'dialog',
  'login',
  'home',
  'pages'
])
const INSTAGRAM_RESERVED = new Set(['p', 'explore', 'stories', 'reel', 'reels', 'tv', 'accounts'])
const GITHUB_RESERVED = new Set([
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
])

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
      const m = match.match(FB_PIXEL_ID)
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
      const m = match.match(TWITTER_X_HANDLE)
      return m ? m[1] : null
    }
  },
  {
    category: 'Accounts',
    subcategory: 'Facebook',
    patterns: [/facebook\.com\/([a-zA-Z0-9.]{1,50})(?:[/?#"'\s>]|$)/gi],
    normalize: (match: string) => {
      const m = match.match(FACEBOOK_SLUG)
      if (!m) return null
      const slug = m[1]
      return FACEBOOK_RESERVED.has(slug.toLowerCase()) ? null : slug
    }
  },
  {
    category: 'Accounts',
    subcategory: 'Instagram',
    patterns: [/instagram\.com\/([a-zA-Z0-9_.]{1,30})(?:[/?#"'\s>]|$)/gi],
    normalize: (match: string) => {
      const m = match.match(INSTAGRAM_SLUG)
      if (!m) return null
      const slug = m[1]
      return INSTAGRAM_RESERVED.has(slug.toLowerCase()) ? null : slug
    }
  },
  {
    category: 'Accounts',
    subcategory: 'LinkedIn',
    patterns: [/linkedin\.com\/in\/([a-zA-Z0-9-]{1,100})(?:[/?#"'\s>]|$)/gi],
    normalize: (match: string) => {
      const m = match.match(LINKEDIN_SLUG)
      return m ? m[1] : null
    }
  },
  {
    category: 'Accounts',
    subcategory: 'YouTube',
    patterns: [/youtube\.com\/(?:@|channel\/|user\/)([a-zA-Z0-9_-]{1,100})(?:[/?#"'\s>]|$)/gi],
    normalize: (match: string) => {
      const m = match.match(YOUTUBE_HANDLE)
      return m ? m[1] : null
    }
  },
  {
    category: 'Accounts',
    subcategory: 'GitHub',
    patterns: [/github\.com\/([a-zA-Z0-9-]{1,39})(?:[/?#"'\s>]|$)/gi],
    normalize: (match: string) => {
      const m = match.match(GITHUB_SLUG)
      if (!m) return null
      const slug = m[1]
      return GITHUB_RESERVED.has(slug.toLowerCase()) ? null : slug
    }
  },
  {
    category: 'Accounts',
    subcategory: 'Telegram',
    patterns: [/t\.me\/([a-zA-Z0-9_]{5,32})(?:[/?#"'\s>]|$)/gi],
    normalize: (match: string) => {
      const m = match.match(TELEGRAM_HANDLE)
      return m ? m[1] : null
    }
  },
  {
    category: 'Darkweb',
    subcategory: 'Onion URL',
    patterns: [/[a-z2-7]{16,56}\.onion(?:[/?#:"'\s>]|$)/gi],
    normalize: (match: string) => {
      const m = match.match(ONION_HOST)
      return m ? m[1].toLowerCase() : null
    }
  },
  {
    category: 'Darkweb',
    subcategory: 'I2P URL',
    patterns: [/[a-zA-Z0-9-]{1,253}\.i2p(?:[/?#:"'\s]|$)/g],
    normalize: (match: string) => {
      const m = match.match(I2P_HOST)
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
  if (!result || !result.hostname) return null
  return isValidDomainParsed(result.hostname, result) ? result.hostname : null
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

  const { text, attrs } = sanitizeHtml(html)

  // Scannable blob: visible text + attr URLs. Social-account and darkweb rules
  // rely on URL patterns from href/src/action that aren't in sanitized visible text.
  const scanText = [text, ...attrs.href, ...attrs.src, ...attrs.action, ...attrs.mailto].join('\n')

  const iocs = extractIocs(scanText)
  const ruleMatches = runRules(scanText)

  // attr-sourced domains are pre-validated by harvestDomain's tldts pass, so
  // they skip the redundant isValidDomain re-parse in the filter below.
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

  const mailtoEmails: ExtractedDatum[] = attrs.mailto.map((value) => ({
    category: 'Infrastructure',
    subcategory: 'Email Address',
    value
  }))

  const filtered: ExtractedDatum[] = [...attrDomains]
  for (const datum of [...iocs, ...ruleMatches, ...mailtoEmails]) {
    if (datum.subcategory === 'IPv4 Address') {
      if (!isPublicIpv4(datum.value)) continue
    } else if (datum.subcategory === 'Domain Reference') {
      if (!isValidDomain(datum.value)) continue
    } else if (datum.subcategory === 'Email Address') {
      if (!isValidEmail(datum.value)) continue
    }
    filtered.push(datum)
  }

  // For case-insensitive subcategories (emails, domains, hashes), lowercase the
  // value before building the dedupe key AND store the normalized value so
  // downstream consumers see consistent casing.
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
