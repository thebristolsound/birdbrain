import type { ExtractedDatum } from '@main/services/database'

interface ExtractionRule {
  category: string
  subcategory: string
  patterns: RegExp[]
  normalize?: (match: string) => string | null
}

// Validate IPv4 address (0-255 per octet)
function isValidIPv4(ip: string): boolean {
  const parts = ip.split('.')
  if (parts.length !== 4) return false
  return parts.every((part) => {
    const num = parseInt(part, 10)
    return num >= 0 && num <= 255 && part === String(num)
  })
}

// Extract domain from URL
function extractDomain(url: string): string | null {
  try {
    const urlObj = new URL(url)
    return urlObj.hostname
  } catch {
    return null
  }
}

const EXTRACTION_RULES: ExtractionRule[] = [
  // --- Tracking Code ---
  {
    category: 'Tracking Code',
    subcategory: 'Google Analytics',
    patterns: [
      /\bUA-\d{4,10}-\d{1,4}\b/g,
      /\bG-[A-Z0-9]{10,12}\b/g
    ]
  },
  {
    category: 'Tracking Code',
    subcategory: 'Google Tag Manager',
    patterns: [/\bGTM-[A-Z0-9]{4,8}\b/g]
  },
  {
    category: 'Tracking Code',
    subcategory: 'Facebook Pixel',
    patterns: [/fbq\s*\([^)]*['"](\d{15,16})['"]/g],
    normalize: (match) => {
      const m = match.match(/['"](\d{15,16})['"]/)
      return m ? m[1] : null
    }
  },
  {
    category: 'Tracking Code',
    subcategory: 'Google AdSense',
    patterns: [/\bca-pub-\d{10,16}\b/g]
  },
  {
    category: 'Tracking Code',
    subcategory: 'Google Ads',
    patterns: [/\bAW-\d{9,11}\b/g]
  },

  // --- Infrastructure ---
  {
    category: 'Infrastructure',
    subcategory: 'Email Address',
    patterns: [/\b[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\b/g],
    normalize: (match) => {
      // Filter out common false positives
      const lower = match.toLowerCase()
      if (
        lower.includes('@example.') ||
        lower.includes('@test.') ||
        lower.includes('@localhost') ||
        lower.includes('noreply@') ||
        lower === 'placeholder@email.com'
      ) {
        return null
      }
      return match
    }
  },
  {
    category: 'Infrastructure',
    subcategory: 'IPv4 Address',
    patterns: [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g],
    normalize: (match) => {
      // Validate IPv4
      if (!isValidIPv4(match)) return null
      // Filter out private/reserved ranges
      if (
        match.startsWith('127.') ||
        match.startsWith('10.') ||
        match.startsWith('192.168.') ||
        match.startsWith('169.254.') ||
        match.startsWith('0.') ||
        match === '255.255.255.255'
      ) {
        return null
      }
      // Check for 172.16-31.x.x
      const parts = match.split('.')
      if (parts[0] === '172') {
        const second = parseInt(parts[1], 10)
        if (second >= 16 && second <= 31) return null
      }
      return match
    }
  },
  {
    category: 'Infrastructure',
    subcategory: 'IPv6 Address',
    patterns: [
      /\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b/g,
      /\b(?:[0-9a-fA-F]{1,4}:){1,7}:\b/g,
      /\b::(?:[0-9a-fA-F]{1,4}:){0,6}[0-9a-fA-F]{1,4}\b/g,
      /\b(?:[0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}\b/g
    ],
    normalize: (match) => {
      // Filter out localhost and link-local
      if (match === '::1' || match.toLowerCase().startsWith('fe80:')) {
        return null
      }
      return match
    }
  },

  // --- Accounts (Social Media) ---
  {
    category: 'Accounts',
    subcategory: 'Twitter/X',
    patterns: [
      /(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]{1,15})\b/g
    ],
    normalize: (match) => {
      const m = match.match(/\/([a-zA-Z0-9_]{1,15})\b/)
      return m ? `@${m[1]}` : null
    }
  },
  {
    category: 'Accounts',
    subcategory: 'Facebook',
    patterns: [/facebook\.com\/([a-zA-Z0-9.]+)\b/g],
    normalize: (match) => {
      const m = match.match(/\/([a-zA-Z0-9.]+)\b/)
      if (!m) return null
      const username = m[1]
      // Filter out common paths
      if (
        ['pages', 'profile.php', 'sharer', 'plugins', 'login', 'groups'].includes(username)
      ) {
        return null
      }
      return username
    }
  },
  {
    category: 'Accounts',
    subcategory: 'Instagram',
    patterns: [/instagram\.com\/([a-zA-Z0-9_.]+)\b/g],
    normalize: (match) => {
      const m = match.match(/\/([a-zA-Z0-9_.]+)\b/)
      if (!m) return null
      const username = m[1]
      if (['p', 'explore', 'accounts', 'direct'].includes(username)) {
        return null
      }
      return `@${username}`
    }
  },
  {
    category: 'Accounts',
    subcategory: 'LinkedIn',
    patterns: [/linkedin\.com\/in\/([a-zA-Z0-9-]+)\b/g],
    normalize: (match) => {
      const m = match.match(/\/in\/([a-zA-Z0-9-]+)\b/)
      return m ? m[1] : null
    }
  },
  {
    category: 'Accounts',
    subcategory: 'YouTube',
    patterns: [
      /youtube\.com\/@([a-zA-Z0-9_-]+)\b/g,
      /youtube\.com\/channel\/([a-zA-Z0-9_-]+)\b/g,
      /youtube\.com\/user\/([a-zA-Z0-9_-]+)\b/g
    ],
    normalize: (match) => {
      const m = match.match(/\/@?([a-zA-Z0-9_-]+)\b/)
      return m ? m[1] : null
    }
  },
  {
    category: 'Accounts',
    subcategory: 'GitHub',
    patterns: [/github\.com\/([a-zA-Z0-9-]+)(?:\/|$|\b)/g],
    normalize: (match) => {
      const m = match.match(/github\.com\/([a-zA-Z0-9-]+)/)
      if (!m) return null
      const username = m[1]
      // Filter out common paths
      if (
        ['features', 'pricing', 'enterprise', 'explore', 'topics', 'collections', 'about', 'login', 'join'].includes(
          username
        )
      ) {
        return null
      }
      return username
    }
  },
  {
    category: 'Accounts',
    subcategory: 'Telegram',
    patterns: [/t\.me\/([a-zA-Z0-9_]+)\b/g],
    normalize: (match) => {
      const m = match.match(/\/([a-zA-Z0-9_]+)\b/)
      return m ? `@${m[1]}` : null
    }
  },

  // --- Darkweb ---
  {
    category: 'Darkweb',
    subcategory: 'Onion URL',
    patterns: [/\b[a-z2-7]{16,56}\.onion\b/gi],
    normalize: (match) => match.toLowerCase()
  },
  {
    category: 'Darkweb',
    subcategory: 'I2P URL',
    patterns: [/\b[a-zA-Z0-9-]+\.i2p\b/g],
    normalize: (match) => match.toLowerCase()
  }
]

// Extract domain references from HTML
function extractDomainReferences(html: string): ExtractedDatum[] {
  const domains = new Set<string>()

  // Extract from href, src, action attributes
  const attrPatterns = [
    /href\s*=\s*["']([^"']+)["']/gi,
    /src\s*=\s*["']([^"']+)["']/gi,
    /action\s*=\s*["']([^"']+)["']/gi
  ]

  for (const pattern of attrPatterns) {
    let match
    while ((match = pattern.exec(html)) !== null) {
      const url = match[1]
      const domain = extractDomain(url)
      if (domain && domain !== 'localhost' && !domain.startsWith('127.')) {
        domains.add(domain)
      }
    }
  }

  return Array.from(domains).map((domain) => ({
    category: 'Infrastructure',
    subcategory: 'Domain Reference',
    value: domain
  }))
}

export function extractData(html: string): ExtractedDatum[] {
  const results: ExtractedDatum[] = []
  const seen = new Set<string>()

  // Run all extraction rules
  for (const rule of EXTRACTION_RULES) {
    for (const pattern of rule.patterns) {
      let match
      while ((match = pattern.exec(html)) !== null) {
        let value = match[0]

        // Apply normalization if provided
        if (rule.normalize) {
          const normalized = rule.normalize(value)
          if (normalized === null) continue
          value = normalized
        }

        // Deduplicate within this extraction
        const key = `${rule.category}:${rule.subcategory}:${value}`
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

  // Extract domain references
  const domainRefs = extractDomainReferences(html)
  for (const ref of domainRefs) {
    const key = `${ref.category}:${ref.subcategory}:${ref.value}`
    if (!seen.has(key)) {
      seen.add(key)
      results.push(ref)
    }
  }

  return results
}
