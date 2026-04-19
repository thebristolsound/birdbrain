import { describe, it, expect } from 'vitest'
import { extractData, EXTRACTION_RULES } from '@main/services/dataExtractor'

describe('dataExtractor', () => {
  describe('EXTRACTION_RULES', () => {
    it('has at least one rule per major category', () => {
      const categories = new Set(EXTRACTION_RULES.map((r) => r.category))
      expect(categories).toContain('Tracking Code')
      expect(categories).toContain('Infrastructure')
      expect(categories).toContain('Accounts')
      expect(categories).toContain('Darkweb')
    })

    it('all rules have compiled RegExp patterns', () => {
      for (const rule of EXTRACTION_RULES) {
        expect(rule.patterns.length).toBeGreaterThan(0)
        for (const pattern of rule.patterns) {
          expect(pattern).toBeInstanceOf(RegExp)
        }
      }
    })
  })

  describe('extractData', () => {
    it('returns empty array for empty HTML', () => {
      expect(extractData('')).toEqual([])
    })

    it('extracts Google Analytics UA code', () => {
      const html = '<script>gtag("config", "UA-12345-1");</script>'
      const results = extractData(html)
      expect(results.some((r) => r.category === 'Tracking Code' && r.subcategory === 'Google Analytics' && r.value === 'UA-12345-1')).toBe(true)
    })

    it('extracts GA4 G- code', () => {
      const html = '<script>gtag("config", "G-ABCDEFGHIJ");</script>'
      const results = extractData(html)
      expect(results.some((r) => r.subcategory === 'Google Analytics' && r.value === 'G-ABCDEFGHIJ')).toBe(true)
    })

    it('extracts Google Tag Manager ID', () => {
      const html = '<script>(function(w,d,s,l,i){...})(window,document,"script","dataLayer","GTM-ABCD1234");</script>'
      const results = extractData(html)
      expect(results.some((r) => r.subcategory === 'Google Tag Manager' && r.value === 'GTM-ABCD1234')).toBe(true)
    })

    it('extracts Facebook Pixel ID', () => {
      const html = `<script>fbq('init', '1234567890123456');</script>`
      const results = extractData(html)
      expect(results.some((r) => r.subcategory === 'Facebook Pixel' && r.value === '1234567890123456')).toBe(true)
    })

    it('extracts Google AdSense publisher ID', () => {
      const html = '<script async src="//pagead2.googlesyndication.com/pagead/js/adsbygoogle.js" data-ad-client="ca-pub-1234567890"></script>'
      const results = extractData(html)
      expect(results.some((r) => r.subcategory === 'Google AdSense' && r.value === 'ca-pub-1234567890')).toBe(true)
    })

    it('extracts email addresses', () => {
      const html = '<a href="mailto:contact@example.com">Contact us</a>'
      const results = extractData(html)
      expect(results.some((r) => r.subcategory === 'Email Address' && r.value === 'contact@example.com')).toBe(true)
    })

    it('extracts valid IPv4 addresses', () => {
      const html = '<p>Server IP: 192.168.1.1</p>'
      const results = extractData(html)
      expect(results.some((r) => r.subcategory === 'IPv4 Address' && r.value === '192.168.1.1')).toBe(true)
    })

    it('does not extract invalid IPv4 addresses', () => {
      const html = '<p>Not an IP: 999.999.999.999</p>'
      const results = extractData(html)
      expect(results.some((r) => r.subcategory === 'IPv4 Address' && r.value === '999.999.999.999')).toBe(false)
    })

    it('extracts domain references from href attributes', () => {
      const html = '<a href="https://example.com/page">Link</a>'
      const results = extractData(html)
      expect(results.some((r) => r.subcategory === 'Domain Reference' && r.value === 'example.com')).toBe(true)
    })

    it('extracts Twitter/X handles', () => {
      const html = '<a href="https://twitter.com/johndoe">Follow</a>'
      const results = extractData(html)
      expect(results.some((r) => r.subcategory === 'Twitter/X' && r.value === 'johndoe')).toBe(true)
    })

    it('extracts X.com handles', () => {
      const html = '<a href="https://x.com/janedoe">Follow</a>'
      const results = extractData(html)
      expect(results.some((r) => r.subcategory === 'Twitter/X' && r.value === 'janedoe')).toBe(true)
    })

    it('extracts GitHub profiles', () => {
      const html = '<a href="https://github.com/myuser">Profile</a>'
      const results = extractData(html)
      expect(results.some((r) => r.subcategory === 'GitHub' && r.value === 'myuser')).toBe(true)
    })

    it('filters out common GitHub paths (e.g. login)', () => {
      const html = '<a href="https://github.com/login">Sign in</a>'
      const results = extractData(html)
      expect(results.some((r) => r.subcategory === 'GitHub' && r.value === 'login')).toBe(false)
    })

    it('extracts onion URLs', () => {
      const html = '<a href="http://facebookwkhpilnemxj.onion/">Facebook Tor</a>'
      const results = extractData(html)
      expect(results.some((r) => r.subcategory === 'Onion URL')).toBe(true)
    })

    it('extracts I2P URLs', () => {
      const html = '<a href="http://forum.i2p/thread/1">Forum</a>'
      const results = extractData(html)
      expect(results.some((r) => r.subcategory === 'I2P URL' && r.value === 'forum.i2p')).toBe(true)
    })

    it('deduplicates values within the same extraction', () => {
      const html = `
        <script>gtag("config", "UA-12345-1");</script>
        <script>gtag("config", "UA-12345-1");</script>
      `
      const results = extractData(html)
      const gaMatches = results.filter(
        (r) => r.subcategory === 'Google Analytics' && r.value === 'UA-12345-1'
      )
      expect(gaMatches).toHaveLength(1)
    })

    it('extracts multiple categories from the same HTML', () => {
      const html = `
        <script>gtag('config', 'UA-12345-1');</script>
        <a href="mailto:info@example.com">Email</a>
        <a href="https://twitter.com/myaccount">Twitter</a>
      `
      const results = extractData(html)
      const categories = new Set(results.map((r) => r.category))
      expect(categories.size).toBeGreaterThanOrEqual(3)
    })

    it('handles very large HTML by truncating at 5MB', () => {
      // Pad with 6MB of content but embed a tracker
      const padding = 'a'.repeat(6 * 1024 * 1024)
      const html = 'UA-99999-1' + padding
      // Should still find the tracker at the start
      const results = extractData(html)
      expect(results.some((r) => r.value === 'UA-99999-1')).toBe(true)
    })

    it('extracts Telegram handles', () => {
      const html = '<a href="https://t.me/mygroup">Telegram</a>'
      const results = extractData(html)
      expect(results.some((r) => r.subcategory === 'Telegram' && r.value === 'mygroup')).toBe(true)
    })

    it('extracts LinkedIn profiles', () => {
      const html = '<a href="https://linkedin.com/in/john-smith">LinkedIn</a>'
      const results = extractData(html)
      expect(results.some((r) => r.subcategory === 'LinkedIn' && r.value === 'john-smith')).toBe(true)
    })

    it('extracts YouTube channel handles', () => {
      const html = '<a href="https://youtube.com/@mychannelhandle">YouTube</a>'
      const results = extractData(html)
      expect(results.some((r) => r.subcategory === 'YouTube' && r.value === 'mychannelhandle')).toBe(true)
    })

    it('extracts Instagram accounts', () => {
      const html = '<a href="https://instagram.com/myaccount">Instagram</a>'
      const results = extractData(html)
      expect(results.some((r) => r.subcategory === 'Instagram' && r.value === 'myaccount')).toBe(true)
    })

    it('filters out generic Instagram paths', () => {
      const html = '<a href="https://instagram.com/p/abc123">Post</a>'
      const results = extractData(html)
      expect(results.some((r) => r.subcategory === 'Instagram' && r.value === 'p')).toBe(false)
    })

    it('extracts Google Ads conversion ID', () => {
      const html = '<script>gtag("config", "AW-123456789");</script>'
      const results = extractData(html)
      expect(results.some((r) => r.subcategory === 'Google Ads' && r.value === 'AW-123456789')).toBe(true)
    })
  })
})
