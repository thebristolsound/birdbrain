// Rule-based data extraction engine
// Each rule contains category, subcategory, patterns, and optional normalize function.
// To add a new rule, simply append an entry to the EXTRACTION_RULES array.

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

// Validate IPv6: count colons and hexadecimal groups
function isValidIpv6(ip: string): boolean {
  // Strip IPv6 zone ID if present
  const addr = ip.split('%')[0]
  // Must contain at least one colon
  if (!addr.includes(':')) return false
  // Cannot have more than one '::'
  const doubleColonCount = (addr.match(/::/g) || []).length
  if (doubleColonCount > 1) return false
  // Validate each group is 1-4 hex digits (splitting around '::')
  const parts = addr.split('::')
  if (parts.length > 2) return false
  const groups = parts.flatMap((p) => (p ? p.split(':') : []))
  if (groups.some((g) => !/^[0-9a-fA-F]{1,4}$/.test(g))) return false
  return true
}
function isValidIpv4(ip: string): boolean {
  const parts = ip.split('.')
  if (parts.length !== 4) return false
  return parts.every((p) => {
    const n = parseInt(p, 10)
    return !isNaN(n) && n >= 0 && n <= 255 && p === String(n)
  })
}

// Extract domain from attribute value (href, src, action)
// Returns the hostname, filtering out javascript:, data:, mailto:, etc.
function extractDomainFromAttr(value: string): string | null {
  try {
    // If it's a full URL, parse it
    if (/^https?:\/\//i.test(value)) {
      const hostname = new URL(value).hostname
      // Filter out IP addresses (handled by IPv4/IPv6 rules) and localhost
      if (hostname && !/^\d+\.\d+\.\d+\.\d+$/.test(hostname) && hostname !== 'localhost') {
        return hostname
      }
    }
  } catch {
    // ignore parse errors
  }
  return null
}

export const EXTRACTION_RULES: ExtractionRule[] = [
  // --- Tracking Code ---
  {
    category: 'Tracking Code',
    subcategory: 'Google Analytics',
    patterns: [/UA-\d{4,10}-\d{1,4}/g, /G-[A-Z0-9]{10,12}/g]
  },
  {
    category: 'Tracking Code',
    subcategory: 'Google Tag Manager',
    patterns: [/GTM-[A-Z0-9]{4,8}/g]
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
    subcategory: 'Google AdSense',
    patterns: [/ca-pub-\d{10,16}/g]
  },
  {
    category: 'Tracking Code',
    subcategory: 'Google Ads',
    patterns: [/AW-\d{9,11}/g]
  },

  // --- Infrastructure ---
  {
    category: 'Infrastructure',
    subcategory: 'Email Address',
    patterns: [/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g]
  },
  {
    category: 'Infrastructure',
    subcategory: 'IPv4 Address',
    patterns: [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g],
    normalize: (match: string) => (isValidIpv4(match) ? match : null)
  },
  {
    category: 'Infrastructure',
    subcategory: 'IPv6 Address',
    // Simplified pattern covering full and compressed IPv6 formats
    patterns: [
      /(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}/g,
      /(?:[0-9a-fA-F]{1,4}:){1,7}:/g,
      /:(?::[0-9a-fA-F]{1,4}){1,7}/g,
      /(?:[0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}/g
    ],
    normalize: (match: string) => (isValidIpv6(match) ? match : null)
  },
  {
    category: 'Infrastructure',
    subcategory: 'Domain Reference',
    // Matches href/src/action attribute values
    patterns: [/(?:href|src|action)\s*=\s*["']([^"']+)["']/gi],
    normalize: (match: string) => {
      const m = match.match(/["']([^"']+)["']/)
      if (!m) return null
      return extractDomainFromAttr(m[1])
    }
  },

  // --- Accounts ---
  {
    category: 'Accounts',
    subcategory: 'Twitter/X',
    patterns: [/(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]{1,15})(?:[/?#]|$)/gi],
    normalize: (match: string) => {
      const m = match.match(/(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]{1,15})/i)
      return m ? m[1] : null
    }
  },
  {
    category: 'Accounts',
    subcategory: 'Facebook',
    patterns: [/facebook\.com\/([a-zA-Z0-9.]{1,50})(?:[/?#]|$)/gi],
    normalize: (match: string) => {
      const m = match.match(/facebook\.com\/([a-zA-Z0-9.]+)/i)
      if (!m) return null
      // Filter out generic Facebook paths
      const slug = m[1]
      if (['sharer', 'share', 'plugins', 'tr', 'dialog', 'login', 'home', 'pages'].includes(slug.toLowerCase())) return null
      return slug
    }
  },
  {
    category: 'Accounts',
    subcategory: 'Instagram',
    patterns: [/instagram\.com\/([a-zA-Z0-9_.]{1,30})(?:[/?#]|$)/gi],
    normalize: (match: string) => {
      const m = match.match(/instagram\.com\/([a-zA-Z0-9_.]+)/i)
      if (!m) return null
      const slug = m[1]
      if (['p', 'explore', 'stories', 'reel', 'reels', 'tv', 'accounts'].includes(slug.toLowerCase())) return null
      return slug
    }
  },
  {
    category: 'Accounts',
    subcategory: 'LinkedIn',
    patterns: [/linkedin\.com\/in\/([a-zA-Z0-9-]{1,100})(?:[/?#]|$)/gi],
    normalize: (match: string) => {
      const m = match.match(/linkedin\.com\/in\/([a-zA-Z0-9-]+)/i)
      return m ? m[1] : null
    }
  },
  {
    category: 'Accounts',
    subcategory: 'YouTube',
    patterns: [/youtube\.com\/(?:@|channel\/|user\/)([a-zA-Z0-9_-]{1,100})(?:[/?#]|$)/gi],
    normalize: (match: string) => {
      const m = match.match(/youtube\.com\/(?:@|channel\/|user\/)([a-zA-Z0-9_-]+)/i)
      return m ? m[1] : null
    }
  },
  {
    category: 'Accounts',
    subcategory: 'GitHub',
    patterns: [/github\.com\/([a-zA-Z0-9-]{1,39})(?:[/?#]|$)/gi],
    normalize: (match: string) => {
      const m = match.match(/github\.com\/([a-zA-Z0-9-]+)/i)
      if (!m) return null
      const slug = m[1]
      if (['login', 'logout', 'settings', 'orgs', 'issues', 'pulls', 'marketplace', 'explore', 'topics', 'trending', 'stars', 'join', 'new', 'notifications', 'features', 'about', 'pricing', 'contact', 'sponsors', 'apps', 'search'].includes(slug.toLowerCase())) return null
      return slug
    }
  },
  {
    category: 'Accounts',
    subcategory: 'Telegram',
    patterns: [/t\.me\/([a-zA-Z0-9_]{5,32})(?:[/?#]|$)/gi],
    normalize: (match: string) => {
      const m = match.match(/t\.me\/([a-zA-Z0-9_]+)/i)
      return m ? m[1] : null
    }
  },

  // --- Darkweb ---
  {
    category: 'Darkweb',
    subcategory: 'Onion URL',
    patterns: [/[a-z2-7]{16,56}\.onion(?:[/?#:]|$)/gi],
    normalize: (match: string) => {
      const m = match.match(/([a-z2-7]{16,56}\.onion)/i)
      return m ? m[1].toLowerCase() : null
    }
  },
  {
    category: 'Darkweb',
    subcategory: 'I2P URL',
    patterns: [/[a-zA-Z0-9-]+\.i2p(?:[/?#:]|$)/g],
    normalize: (match: string) => {
      const m = match.match(/([a-zA-Z0-9-]+\.i2p)/i)
      return m ? m[1].toLowerCase() : null
    }
  }
]

// Limit extraction to the first 5 MB of HTML to handle very large pages.
// Exported so callers can slice their Buffer before decoding, avoiding a full decode+allocation.
export const MAX_HTML_BYTES = 5 * 1024 * 1024

export function extractData(html: string): ExtractedDatum[] {
  const input = html.length > MAX_HTML_BYTES ? html.slice(0, MAX_HTML_BYTES) : html
  const seen = new Set<string>()
  const results: ExtractedDatum[] = []

  for (const rule of EXTRACTION_RULES) {
    for (const pattern of rule.patterns) {
      // Reset lastIndex for global regexes
      pattern.lastIndex = 0

      let match: RegExpExecArray | null
      while ((match = pattern.exec(input)) !== null) {
        const raw = match[0]
        let value: string | null = raw

        if (rule.normalize) {
          value = rule.normalize(raw)
        }

        if (!value) continue
        value = value.trim()
        if (!value) continue

        const key = `${rule.category}|${rule.subcategory}|${value}`
        if (seen.has(key)) continue
        seen.add(key)

        results.push({
          category: rule.category,
          subcategory: rule.subcategory,
          value
        })
      }
    }
  }

  return results
}
