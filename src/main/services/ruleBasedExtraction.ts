import nlp from 'compromise'
import type { EntityType } from '@shared/types'

export interface ExtractedEntity {
  type: EntityType
  value: string
  context?: string
  confidence?: number
}

interface PatternDef {
  pattern: RegExp
  confidence: number
  validate?: (match: string) => boolean
}

const COMMON_TLDS = new Set([
  'com',
  'org',
  'net',
  'edu',
  'gov',
  'mil',
  'int',
  'io',
  'co',
  'us',
  'uk',
  'ca',
  'au',
  'de',
  'fr',
  'jp',
  'cn',
  'ru',
  'br',
  'in',
  'info',
  'biz',
  'name',
  'pro',
  'museum',
  'coop',
  'aero',
  'me',
  'tv',
  'cc',
  'ws',
  'mobi',
  'tel',
  'asia',
  'jobs',
  'travel',
  'xyz',
  'online',
  'site',
  'tech',
  'store',
  'app',
  'dev',
  'cloud'
])

const REGEX_PATTERNS: Partial<Record<EntityType, PatternDef[]>> = {
  email: [
    {
      pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
      confidence: 1.0
    }
  ],
  phone: [
    {
      pattern: /\+?\d{1,3}[-.\s]?\(?\d{1,4}\)?[-.\s]?\d{1,4}[-.\s]?\d{1,9}/g,
      confidence: 0.9,
      validate: (match: string) => {
        const digits = match.replace(/\D/g, '')
        // Explicitly reject IPv4-shaped strings like "192.168.1.1"
        const ipv4Like = /^\s*\d{1,3}(?:\.\d{1,3}){3}\s*$/
        if (ipv4Like.test(match)) {
          return false
        }
        return digits.length >= 7 && digits.length <= 15
      }
    }
  ],
  domain: [
    {
      pattern: /(?:(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,})/g,
      confidence: 1.0,
      validate: (match: string) => {
        const tld = match.split('.').pop()?.toLowerCase()
        if (!tld || !COMMON_TLDS.has(tld)) return false
        return match.includes('.')
      }
    }
  ],
  ip_address: [
    {
      pattern: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
      confidence: 1.0
    }
  ],
  username: [
    {
      pattern: /(?:^|[\s,;:!?([{])@([a-zA-Z0-9_]{2,30})\b/g,
      confidence: 0.8,
      validate: (match: string) => {
        return match.length >= 2
      }
    }
  ],
  crypto_wallet: [
    // Bitcoin legacy (1... or 3...)
    {
      pattern: /\b[13][a-km-zA-HJ-NP-Z1-9]{25,34}\b/g,
      confidence: 0.9
    },
    // Bitcoin bech32
    {
      pattern: /\bbc1[a-zA-HJ-NP-Z0-9]{25,89}\b/g,
      confidence: 0.9
    },
    // Ethereum
    {
      pattern: /\b0x[a-fA-F0-9]{40}\b/g,
      confidence: 0.9
    }
  ]
}

const NLP_TYPES = new Set<EntityType>(['person', 'organization', 'date'])

function getContext(text: string, start: number, end: number): string {
  const ctxStart = Math.max(0, start - 50)
  const ctxEnd = Math.min(text.length, end + 50)
  return text.slice(ctxStart, ctxEnd).trim()
}

function extractWithRegex(text: string, enabledTypes: EntityType[]): ExtractedEntity[] {
  const results: ExtractedEntity[] = []

  for (const type of enabledTypes) {
    const patterns = REGEX_PATTERNS[type]
    if (!patterns) continue

    for (const def of patterns) {
      const regex = new RegExp(def.pattern.source, def.pattern.flags)
      let match: RegExpExecArray | null

      while ((match = regex.exec(text)) !== null) {
        let value = match[0]

        // For username, use capture group and prepend @
        if (type === 'username' && match[1]) {
          value = '@' + match[1]
        }

        if (def.validate && !def.validate(value)) continue

        // For domains, check it's not part of an email
        if (type === 'domain') {
          const charBefore = match.index > 0 ? text[match.index - 1] : ''
          if (charBefore === '@') continue
        }

        results.push({
          type,
          value,
          context: getContext(text, match.index, match.index + match[0].length),
          confidence: def.confidence
        })
      }
    }
  }

  return results
}

function extractWithNlp(text: string, enabledTypes: EntityType[]): ExtractedEntity[] {
  const results: ExtractedEntity[] = []
  const doc = nlp(text)

  if (enabledTypes.includes('person')) {
    const people = doc.people().out('array') as string[]
    for (const person of people) {
      if (person.trim().length < 2) continue
      results.push({
        type: 'person',
        value: person.trim(),
        confidence: 0.7
      })
    }
  }

  if (enabledTypes.includes('organization')) {
    const orgs = doc.organizations().out('array') as string[]
    for (const org of orgs) {
      if (org.trim().length < 2) continue
      results.push({
        type: 'organization',
        value: org.trim(),
        confidence: 0.7
      })
    }
  }

  if (enabledTypes.includes('date')) {
    const dates = doc.match('#Date+').out('array') as string[]
    for (const date of dates) {
      if (date.trim().length < 2) continue
      results.push({
        type: 'date',
        value: date.trim(),
        confidence: 0.8
      })
    }
  }

  return results
}

function deduplicate(entities: ExtractedEntity[]): ExtractedEntity[] {
  const seen = new Map<string, ExtractedEntity>()

  for (const entity of entities) {
    const key = `${entity.type}::${entity.value}`
    const existing = seen.get(key)
    if (!existing || (entity.confidence ?? 0) > (existing.confidence ?? 0)) {
      seen.set(key, entity)
    }
  }

  return Array.from(seen.values())
}

export function extractEntitiesRuleBased(
  text: string,
  enabledTypes: EntityType[]
): ExtractedEntity[] {
  if (!text?.trim() || enabledTypes.length === 0) return []

  const regexTypes = enabledTypes.filter((t) => !NLP_TYPES.has(t))
  const nlpTypes = enabledTypes.filter((t) => NLP_TYPES.has(t))

  const regexResults = extractWithRegex(text, regexTypes)
  const nlpResults = nlpTypes.length > 0 ? extractWithNlp(text, nlpTypes) : []

  return deduplicate([...regexResults, ...nlpResults])
}
