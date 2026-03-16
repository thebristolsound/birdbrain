import { describe, it, expect } from 'vitest'
import { extractEntitiesRuleBased } from '../../../src/main/services/ruleBasedExtraction'

describe('ruleBasedExtraction', () => {
  describe('email extraction', () => {
    it('extracts standard email addresses', () => {
      const text = 'Contact us at hello@example.com or support@test.org'
      const result = extractEntitiesRuleBased(text, ['email'])
      expect(result).toHaveLength(2)
      expect(result.map(e => e.value)).toContain('hello@example.com')
      expect(result.map(e => e.value)).toContain('support@test.org')
      expect(result[0].type).toBe('email')
      expect(result[0].confidence).toBe(1.0)
    })

    it('does not extract invalid emails', () => {
      const text = 'not-an-email@ or @invalid or user@'
      const result = extractEntitiesRuleBased(text, ['email'])
      expect(result).toHaveLength(0)
    })
  })

  describe('phone extraction', () => {
    it('extracts US phone numbers', () => {
      const text = 'Call (555) 123-4567 or 555-987-6543'
      const result = extractEntitiesRuleBased(text, ['phone'])
      expect(result.length).toBeGreaterThanOrEqual(2)
      expect(result[0].type).toBe('phone')
      expect(result[0].confidence).toBe(0.9)
    })

    it('extracts international phone numbers', () => {
      const text = 'International: +1-555-123-4567 or +44 20 7946 0958'
      const result = extractEntitiesRuleBased(text, ['phone'])
      expect(result.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('domain extraction', () => {
    it('extracts domains from text', () => {
      const text = 'Visit example.com and subdomain.test.org for more info'
      const result = extractEntitiesRuleBased(text, ['domain'])
      expect(result.length).toBeGreaterThanOrEqual(2)
      expect(result[0].type).toBe('domain')
      expect(result[0].confidence).toBe(1.0)
    })

    it('does not extract invalid TLDs', () => {
      const text = 'This is file.qqqq not a domain'
      const result = extractEntitiesRuleBased(text, ['domain'])
      expect(result).toHaveLength(0)
    })
  })

  describe('IP address extraction', () => {
    it('extracts IPv4 addresses', () => {
      const text = 'Server at 192.168.1.1 and 10.0.0.255'
      const result = extractEntitiesRuleBased(text, ['ip_address'])
      expect(result).toHaveLength(2)
      expect(result[0].type).toBe('ip_address')
      expect(result[0].confidence).toBe(1.0)
    })

    it('does not extract invalid IPs', () => {
      const text = 'Not an IP: 999.999.999.999 or 1.2.3'
      const result = extractEntitiesRuleBased(text, ['ip_address'])
      expect(result).toHaveLength(0)
    })
  })

  describe('username extraction', () => {
    it('extracts @-prefixed handles', () => {
      const text = 'Follow @johndoe and @jane_smith on Twitter'
      const result = extractEntitiesRuleBased(text, ['username'])
      expect(result).toHaveLength(2)
      expect(result.map(e => e.value)).toContain('@johndoe')
      expect(result.map(e => e.value)).toContain('@jane_smith')
    })
  })

  describe('crypto wallet extraction', () => {
    it('extracts Bitcoin addresses', () => {
      const text = 'Send BTC to 1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa'
      const result = extractEntitiesRuleBased(text, ['crypto_wallet'])
      expect(result).toHaveLength(1)
      expect(result[0].type).toBe('crypto_wallet')
    })

    it('extracts Ethereum addresses', () => {
      const text = 'ETH: 0x742d35Cc6634C0532925a3b844Bc9e7595f2bD18'
      const result = extractEntitiesRuleBased(text, ['crypto_wallet'])
      expect(result).toHaveLength(1)
    })
  })

  describe('filtering by enabled types', () => {
    it('only extracts enabled types', () => {
      const text = 'Email: test@example.com, IP: 192.168.1.1'
      const result = extractEntitiesRuleBased(text, ['email'])
      expect(result.every(e => e.type === 'email')).toBe(true)
    })

    it('returns empty for empty enabled types', () => {
      const text = 'Email: test@example.com'
      const result = extractEntitiesRuleBased(text, [])
      expect(result).toHaveLength(0)
    })
  })

  describe('deduplication', () => {
    it('deduplicates identical entities', () => {
      const text = 'test@example.com appears twice: test@example.com'
      const result = extractEntitiesRuleBased(text, ['email'])
      expect(result).toHaveLength(1)
    })
  })

  describe('edge cases', () => {
    it('handles empty text', () => {
      const result = extractEntitiesRuleBased('', ['email', 'phone'])
      expect(result).toHaveLength(0)
    })

    it('handles text with no entities', () => {
      const result = extractEntitiesRuleBased('Just some plain text here.', ['email', 'phone', 'ip_address'])
      expect(result).toHaveLength(0)
    })
  })

  describe('NLP: person extraction', () => {
    it('extracts person names', () => {
      const text = 'John Smith met with Sarah Johnson at the conference.'
      const result = extractEntitiesRuleBased(text, ['person'])
      expect(result.length).toBeGreaterThanOrEqual(1)
      expect(result[0].type).toBe('person')
      expect(result[0].confidence).toBeLessThan(1.0)
    })
  })

  describe('NLP: organization extraction', () => {
    it('extracts organization names', () => {
      const text = 'Microsoft and Google announced a partnership with the FBI.'
      const result = extractEntitiesRuleBased(text, ['organization'])
      expect(result.length).toBeGreaterThanOrEqual(1)
      expect(result[0].type).toBe('organization')
    })
  })

  describe('NLP: date extraction', () => {
    it('extracts dates from text', () => {
      const text = 'The meeting is scheduled for January 15th, 2025.'
      const result = extractEntitiesRuleBased(text, ['date'])
      expect(result.length).toBeGreaterThanOrEqual(1)
      expect(result[0].type).toBe('date')
    })
  })

  describe('mixed regex + NLP extraction', () => {
    it('extracts both regex and NLP entities', () => {
      const text = 'John Smith (john@example.com) works at 192.168.1.1'
      const result = extractEntitiesRuleBased(text, ['person', 'email', 'ip_address'])
      const types = result.map(e => e.type)
      expect(types).toContain('email')
      expect(types).toContain('ip_address')
    })
  })
})
