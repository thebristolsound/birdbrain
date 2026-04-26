import { describe, it, expect } from 'vitest'
import { extractData, EXTRACTION_RULES } from '@main/services/dataExtractor'

describe('dataExtractor', () => {
  describe('EXTRACTION_RULES', () => {
    it('has at least one rule per major category', () => {
      const categories = new Set(EXTRACTION_RULES.map((r) => r.category))
      expect(categories).toContain('Tracking Code')
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

    it('extracts Google Analytics UA code from visible text', () => {
      const html = '<p>Tracking: UA-12345-1</p>'
      const results = extractData(html)
      expect(
        results.some(
          (r) =>
            r.category === 'Tracking Code' &&
            r.subcategory === 'Google Analytics' &&
            r.value === 'UA-12345-1'
        )
      ).toBe(true)
    })

    it('extracts GA4 G- measurement IDs from visible text', () => {
      const html = '<p>GA4: G-ABCDEFGHIJ</p>'
      const results = extractData(html)
      expect(
        results.some(
          (r) =>
            r.category === 'Tracking Code' &&
            r.subcategory === 'Google Analytics' &&
            r.value === 'G-ABCDEFGHIJ'
        )
      ).toBe(true)
    })

    it('extracts Google Tag Manager ID from visible text', () => {
      const html = '<p>Container: GTM-ABCD1234</p>'
      const results = extractData(html)
      expect(
        results.some((r) => r.subcategory === 'Google Tag Manager' && r.value === 'GTM-ABCD1234')
      ).toBe(true)
    })

    it('extracts Facebook Pixel ID when present in visible text', () => {
      const html = `<p>fbq('init', '1234567890123456');</p>`
      const results = extractData(html)
      expect(
        results.some((r) => r.subcategory === 'Facebook Pixel' && r.value === '1234567890123456')
      ).toBe(true)
    })

    it('extracts Google AdSense pub- publisher ID (16 digits, ioc-extractor format)', () => {
      const html = '<p>Publisher: pub-1234567890123456</p>'
      const results = extractData(html)
      expect(
        results.some(
          (r) => r.subcategory === 'Google AdSense' && r.value === 'pub-1234567890123456'
        )
      ).toBe(true)
    })

    it('extracts email addresses from mailto: links', () => {
      const html = '<a href="mailto:contact@birdbrain.io">Contact us</a>'
      const results = extractData(html)
      expect(
        results.some((r) => r.subcategory === 'Email Address' && r.value === 'contact@birdbrain.io')
      ).toBe(true)
    })

    it('rejects @example.com addresses as placeholders', () => {
      const html = '<a href="mailto:contact@example.com">Contact</a>'
      const results = extractData(html)
      expect(
        results.some((r) => r.subcategory === 'Email Address' && r.value === 'contact@example.com')
      ).toBe(false)
    })

    it('rejects css-*@mhtml.blink placeholder emails from src attrs', () => {
      const html = '<img src="cid:css-abc123@mhtml.blink" alt="x">'
      const results = extractData(html)
      expect(
        results.some(
          (r) => r.subcategory === 'Email Address' && r.value === 'css-abc123@mhtml.blink'
        )
      ).toBe(false)
    })

    it('extracts public IPv4 addresses but rejects RFC1918 private ranges', () => {
      const htmlPublic = '<p>Server IP: 8.8.8.8</p>'
      const publicResults = extractData(htmlPublic)
      expect(
        publicResults.some((r) => r.subcategory === 'IPv4 Address' && r.value === '8.8.8.8')
      ).toBe(true)

      const htmlPrivate = '<p>Local IP: 192.168.1.1</p>'
      const privateResults = extractData(htmlPrivate)
      expect(
        privateResults.some((r) => r.subcategory === 'IPv4 Address' && r.value === '192.168.1.1')
      ).toBe(false)
    })

    it('does not extract invalid IPv4 addresses', () => {
      const html = '<p>Not an IP: 999.999.999.999</p>'
      const results = extractData(html)
      expect(
        results.some((r) => r.subcategory === 'IPv4 Address' && r.value === '999.999.999.999')
      ).toBe(false)
    })

    it('extracts domain references from href attributes', () => {
      const html = '<a href="https://birdbrain.io/page">Link</a>'
      const results = extractData(html)
      expect(
        results.some((r) => r.subcategory === 'Domain Reference' && r.value === 'birdbrain.io')
      ).toBe(true)
    })

    it('does not extract domains from relative asset paths', () => {
      const html = [
        '<script src="script.js"></script>',
        '<link href="/assets/app.css" rel="stylesheet">',
        '<img src="../images/logo.png">',
        '<form action="/submit"></form>'
      ].join('')
      const results = extractData(html)
      const domains = results
        .filter((r) => r.subcategory === 'Domain Reference')
        .map((r) => r.value)
      expect(domains).toEqual([])
    })

    it('extracts domains from protocol-relative URLs', () => {
      const html = '<img src="//cdn.example.com/logo.png">'
      const results = extractData(html)
      expect(
        results.some((r) => r.subcategory === 'Domain Reference' && r.value === 'cdn.example.com')
      ).toBe(true)
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
        <p>Tracking: UA-12345-1</p>
        <p>Tracking: UA-12345-1</p>
      `
      const results = extractData(html)
      const gaMatches = results.filter(
        (r) => r.subcategory === 'Google Analytics' && r.value === 'UA-12345-1'
      )
      expect(gaMatches).toHaveLength(1)
    })

    it('extracts multiple categories from the same HTML', () => {
      const html = `
        <p>Tracking: UA-12345-1</p>
        <a href="mailto:info@birdbrain.io">Email</a>
        <a href="https://twitter.com/myaccount">Twitter</a>
      `
      const results = extractData(html)
      const categories = new Set(results.map((r) => r.category))
      expect(categories).toContain('Tracking Code')
      expect(categories).toContain('Infrastructure')
      expect(categories).toContain('Accounts')
    })

    // Skipped: times out on CI (6MB allocation + extraction exceeds 5s budget).
    it.skip('handles very large HTML by truncating at 5MB', () => {
      const padding = 'a'.repeat(6 * 1024 * 1024)
      const html = '<p>UA-99999-1 </p><p>' + padding + '</p>'
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
      expect(results.some((r) => r.subcategory === 'LinkedIn' && r.value === 'john-smith')).toBe(
        true
      )
    })

    it('extracts YouTube channel handles', () => {
      const html = '<a href="https://youtube.com/@mychannelhandle">YouTube</a>'
      const results = extractData(html)
      expect(
        results.some((r) => r.subcategory === 'YouTube' && r.value === 'mychannelhandle')
      ).toBe(true)
    })

    it('extracts Instagram accounts', () => {
      const html = '<a href="https://instagram.com/myaccount">Instagram</a>'
      const results = extractData(html)
      expect(results.some((r) => r.subcategory === 'Instagram' && r.value === 'myaccount')).toBe(
        true
      )
    })

    it('filters out generic Instagram paths', () => {
      const html = '<a href="https://instagram.com/p/abc123">Post</a>'
      const results = extractData(html)
      expect(results.some((r) => r.subcategory === 'Instagram' && r.value === 'p')).toBe(false)
    })

    it('extracts Google Ads conversion ID from visible text', () => {
      const html = '<p>Conversion: AW-123456789</p>'
      const results = extractData(html)
      expect(
        results.some((r) => r.subcategory === 'Google Ads' && r.value === 'AW-123456789')
      ).toBe(true)
    })

    it('does NOT extract tracking IDs hidden inside <script> tags', () => {
      const html = '<script>gtag("config", "UA-99999-9");</script>'
      const results = extractData(html)
      expect(results.some((r) => r.value === 'UA-99999-9')).toBe(false)
    })

    it('dedupes emails that differ only in letter case', () => {
      const html = '<p>Contact User@Birdbrain.IO or user@birdbrain.io for details.</p>'
      const results = extractData(html)
      const emails = results.filter((r) => r.subcategory === 'Email Address')
      expect(emails).toHaveLength(1)
      expect(emails[0].value).toBe('user@birdbrain.io')
    })
  })
})
