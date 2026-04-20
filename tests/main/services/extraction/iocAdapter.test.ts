import { describe, it, expect } from 'vitest'
import { extractIocs } from '@main/services/extraction/iocAdapter'

const MIXED_IOC_TEXT =
  'Contact admin@example.com from 8.8.8.8 or 2001:db8::1. ' +
  'Tracking UA-12345-6, pub-1234567890123456. ' +
  'CVE-2024-1234. ' +
  'Hash: ' +
  'a'.repeat(64) +
  '. ' +
  'BTC 1BoatSLRHtKNngkdXEeobR76b53LETtpyT.'

describe('iocAdapter', () => {
  describe('extractIocs', () => {
    it('returns empty array for empty input', () => {
      expect(extractIocs('')).toEqual([])
    })

    it('extracts IPv4 addresses', () => {
      const results = extractIocs('Server at 8.8.8.8')
      expect(
        results.some(
          (r) =>
            r.category === 'Infrastructure' &&
            r.subcategory === 'IPv4 Address' &&
            r.value === '8.8.8.8'
        )
      ).toBe(true)
    })

    it('extracts IPv6 addresses', () => {
      const results = extractIocs('Address: 2001:db8::1')
      expect(
        results.some(
          (r) =>
            r.category === 'Infrastructure' &&
            r.subcategory === 'IPv6 Address' &&
            r.value === '2001:db8::1'
        )
      ).toBe(true)
    })

    it('extracts email addresses', () => {
      const results = extractIocs('Contact admin@example.com')
      expect(
        results.some(
          (r) =>
            r.category === 'Infrastructure' &&
            r.subcategory === 'Email Address' &&
            r.value === 'admin@example.com'
        )
      ).toBe(true)
    })

    it('extracts SHA256 hashes', () => {
      const hash = 'a'.repeat(64)
      const results = extractIocs('Hash: ' + hash)
      expect(
        results.some(
          (r) =>
            r.category === 'Infrastructure' && r.subcategory === 'SHA256 Hash' && r.value === hash
        )
      ).toBe(true)
    })

    it('extracts CVEs', () => {
      const results = extractIocs('Affected by CVE-2024-1234')
      expect(
        results.some(
          (r) =>
            r.category === 'Vulnerability' && r.subcategory === 'CVE' && r.value === 'CVE-2024-1234'
        )
      ).toBe(true)
    })

    it('extracts Bitcoin addresses', () => {
      const results = extractIocs('BTC 1BoatSLRHtKNngkdXEeobR76b53LETtpyT')
      expect(
        results.some(
          (r) =>
            r.category === 'Cryptocurrency' &&
            r.subcategory === 'Bitcoin Address' &&
            r.value === '1BoatSLRHtKNngkdXEeobR76b53LETtpyT'
        )
      ).toBe(true)
    })

    it('extracts Google Analytics tracking IDs', () => {
      const results = extractIocs('Tracking UA-12345-6')
      expect(
        results.some(
          (r) =>
            r.category === 'Tracking Code' &&
            r.subcategory === 'Google Analytics' &&
            r.value === 'UA-12345-6'
        )
      ).toBe(true)
    })

    it('extracts Google AdSense publisher IDs', () => {
      const results = extractIocs('Publisher pub-1234567890123456')
      expect(
        results.some(
          (r) =>
            r.category === 'Tracking Code' &&
            r.subcategory === 'Google AdSense' &&
            r.value === 'pub-1234567890123456'
        )
      ).toBe(true)
    })

    it('does not return urls entries', () => {
      const results = extractIocs('Visit https://example.com/page?q=1')
      expect(results.some((r) => r.subcategory === 'urls')).toBe(false)
    })

    it('does not return ssdeep entries', () => {
      // ssdeeps format: blocksize:hash1:hash2 — not mapped by the adapter
      const results = extractIocs('3:AXGBicFlgVNhBGcL6wCrFQEv:AXGBicFlgVNhBGcL6wCrFQEv')
      expect(results.some((r) => r.subcategory === 'ssdeep')).toBe(false)
    })

    it('extracts multiple IOC types from mixed text', () => {
      const results = extractIocs(MIXED_IOC_TEXT)
      const subcategories = new Set(results.map((r) => r.subcategory))
      expect(subcategories).toContain('Email Address')
      expect(subcategories).toContain('IPv4 Address')
      expect(subcategories).toContain('CVE')
      expect(subcategories).toContain('SHA256 Hash')
      expect(subcategories).toContain('Bitcoin Address')
    })

    it('returns ExtractedDatum shape with category, subcategory, value', () => {
      const results = extractIocs('8.8.8.8')
      expect(results.length).toBeGreaterThan(0)
      for (const r of results) {
        expect(typeof r.category).toBe('string')
        expect(typeof r.subcategory).toBe('string')
        expect(typeof r.value).toBe('string')
      }
    })
  })
})
