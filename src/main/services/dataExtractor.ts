export interface ExtractionRule {
  category: string
  subcategory: string
  patterns: RegExp[]
  normalize?: (matchValue: string, match: RegExpExecArray) => string | null
}

export interface ExtractedDatum {
  category: string
  subcategory: string
  value: string
}

const MAX_HTML_LENGTH = 500_000

const rules: ExtractionRule[] = [
  {
    category: 'Tracking Code',
    subcategory: 'Google Analytics',
    patterns: [/\bUA-\d{4,10}-\d{1,4}\b/gi, /\bG-[A-Z0-9]{10,12}\b/g]
  },
  {
    category: 'Tracking Code',
    subcategory: 'Google Tag Manager',
    patterns: [/\bGTM-[A-Z0-9]{4,8}\b/g]
  },
  {
    category: 'Tracking Code',
    subcategory: 'Facebook Pixel',
    patterns: [/fbq\(.+?["'](\d{15,16})["']/gi],
    normalize: (_value, match) => match[1] ?? null
  },
  {
    category: 'Tracking Code',
    subcategory: 'Google AdSense',
    patterns: [/\bca-pub-\d{10,16}\b/gi]
  },
  {
    category: 'Tracking Code',
    subcategory: 'Google Ads',
    patterns: [/\bAW-\d{9,11}\b/g]
  },
  {
    category: 'Infrastructure',
    subcategory: 'Email Address',
    patterns: [/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g],
    normalize: (value) => value.toLowerCase()
  },
  {
    category: 'Infrastructure',
    subcategory: 'IPv4 Address',
    patterns: [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g],
    normalize: (value) => {
      const octets = value.split('.').map((n) => Number(n))
      if (octets.length !== 4) return null
      if (octets.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return null
      return octets.join('.')
    }
  },
  {
    category: 'Infrastructure',
    subcategory: 'IPv6 Address',
    patterns: [
      /\b(?:(?:[A-Fa-f0-9]{1,4}:){2,7}[A-Fa-f0-9]{1,4}|(?:[A-Fa-f0-9]{1,4}:){1,7}:|::(?:[A-Fa-f0-9]{1,4}:?){0,6}[A-Fa-f0-9]{1,4})\b/g,
      /\b::1\b/g
    ],
    normalize: (value) => value.toLowerCase()
  },
  {
    category: 'Infrastructure',
    subcategory: 'Domain Reference',
    patterns: [/\b(?:href|src|action)\s*=\s*["']([^"']+)["']/gi],
    normalize: (_value, match) => {
      const raw = match[1]?.trim()
      if (!raw) return null
      let url = raw
      if (url.startsWith('//')) {
        url = 'http:' + url
      }
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return null
      }
      try {
        const hostname = new URL(url).hostname.toLowerCase()
        if (!hostname || hostname.includes('localhost')) return null
        return hostname.startsWith('www.') ? hostname.slice(4) : hostname
      } catch {
        return null
      }
    }
  },
  {
    category: 'Accounts',
    subcategory: 'Twitter/X',
    patterns: [/(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]{1,15})/g],
    normalize: (_value, match) => (match[1] ? '@' + match[1] : null)
  },
  {
    category: 'Accounts',
    subcategory: 'Facebook',
    patterns: [/facebook\.com\/([a-zA-Z0-9.]+)/g],
    normalize: (_value, match) => match[1]?.toLowerCase() ?? null
  },
  {
    category: 'Accounts',
    subcategory: 'Instagram',
    patterns: [/instagram\.com\/([a-zA-Z0-9_.]+)/g],
    normalize: (_value, match) => match[1]?.toLowerCase() ?? null
  },
  {
    category: 'Accounts',
    subcategory: 'LinkedIn',
    patterns: [/linkedin\.com\/in\/([a-zA-Z0-9-]+)/g],
    normalize: (_value, match) => match[1]?.toLowerCase() ?? null
  },
  {
    category: 'Accounts',
    subcategory: 'YouTube',
    patterns: [/youtube\.com\/(?:@|channel\/|user\/)([a-zA-Z0-9_-]+)/g],
    normalize: (_value, match) => match[1]?.toLowerCase() ?? null
  },
  {
    category: 'Accounts',
    subcategory: 'GitHub',
    patterns: [/github\.com\/([a-zA-Z0-9-]+)/g],
    normalize: (_value, match) => match[1]?.toLowerCase() ?? null
  },
  {
    category: 'Accounts',
    subcategory: 'Telegram',
    patterns: [/t\.me\/([a-zA-Z0-9_]+)/g],
    normalize: (_value, match) => match[1]?.toLowerCase() ?? null
  },
  {
    category: 'Darkweb',
    subcategory: 'Onion URL',
    patterns: [/\b[a-z2-7]{16,56}\.onion\b/gi],
    normalize: (value) => value.toLowerCase()
  },
  {
    category: 'Darkweb',
    subcategory: 'I2P URL',
    patterns: [/\b[a-zA-Z0-9-]+\.i2p\b/g],
    normalize: (value) => value.toLowerCase()
  }
]

export function extractData(html: string): ExtractedDatum[] {
  const limited = html.length > MAX_HTML_LENGTH ? html.slice(0, MAX_HTML_LENGTH) : html
  const results: ExtractedDatum[] = []
  const seen = new Set<string>()

  for (const rule of rules) {
    for (const basePattern of rule.patterns) {
      const flags = basePattern.flags.includes('g') ? basePattern.flags : basePattern.flags + 'g'
      const pattern = new RegExp(basePattern.source, flags)
      let match: RegExpExecArray | null
      while ((match = pattern.exec(limited)) !== null) {
        const rawValue = match[1] ?? match[0]
        const normalized = rule.normalize ? rule.normalize(rawValue, match) : rawValue
        if (!normalized) continue
        const value = normalized.trim()
        if (!value) continue
        const key = `${rule.category}::${rule.subcategory}::${value}`
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
