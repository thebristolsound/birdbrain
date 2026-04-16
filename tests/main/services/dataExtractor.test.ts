import { describe, it, expect } from 'vitest'
import { extractData } from '@main/services/dataExtractor'

describe('dataExtractor', () => {
  it('should extract Google Analytics tracking codes', () => {
    const html = `
      <script>
        gtag('config', 'UA-123456-1');
        gtag('config', 'G-ABCDEFGHIJ');
      </script>
    `
    const results = extractData(html)

    const gaCodes = results.filter(
      (r) => r.category === 'Tracking Code' && r.subcategory === 'Google Analytics'
    )
    expect(gaCodes).toHaveLength(2)
    expect(gaCodes.map((c) => c.value)).toContain('UA-123456-1')
    expect(gaCodes.map((c) => c.value)).toContain('G-ABCDEFGHIJ')
  })

  it('should extract email addresses', () => {
    const html = `
      <a href="mailto:info@realcompany.com">Email us</a>
      <p>Support: support@company.org</p>
    `
    const results = extractData(html)

    const emails = results.filter(
      (r) => r.category === 'Infrastructure' && r.subcategory === 'Email Address'
    )
    expect(emails.length).toBeGreaterThan(0)
    expect(emails.map((e) => e.value)).toContain('info@realcompany.com')
    expect(emails.map((e) => e.value)).toContain('support@company.org')
  })

  it('should extract valid IPv4 addresses', () => {
    const html = `
      <p>Server: 8.8.8.8</p>
      <p>Private: 192.168.1.1</p>
      <p>Public: 203.0.113.45</p>
    `
    const results = extractData(html)

    const ips = results.filter(
      (r) => r.category === 'Infrastructure' && r.subcategory === 'IPv4 Address'
    )

    // Should extract public IP but not private IP
    expect(ips.map((ip) => ip.value)).toContain('8.8.8.8')
    expect(ips.map((ip) => ip.value)).toContain('203.0.113.45')
    expect(ips.map((ip) => ip.value)).not.toContain('192.168.1.1')
  })

  it('should extract social media accounts', () => {
    const html = `
      <a href="https://twitter.com/example">Twitter</a>
      <a href="https://github.com/birdbrain">GitHub</a>
      <a href="https://instagram.com/user123">Instagram</a>
    `
    const results = extractData(html)

    const twitter = results.filter(
      (r) => r.category === 'Accounts' && r.subcategory === 'Twitter/X'
    )
    const github = results.filter(
      (r) => r.category === 'Accounts' && r.subcategory === 'GitHub'
    )
    const instagram = results.filter(
      (r) => r.category === 'Accounts' && r.subcategory === 'Instagram'
    )

    expect(twitter.map((t) => t.value)).toContain('@example')
    expect(github.map((g) => g.value)).toContain('birdbrain')
    expect(instagram.map((i) => i.value)).toContain('@user123')
  })

  it('should extract onion URLs', () => {
    const html = `
      <a href="http://3g2upl4pq6kufc4m.onion/">DuckDuckGo Onion</a>
    `
    const results = extractData(html)

    const onion = results.filter(
      (r) => r.category === 'Darkweb' && r.subcategory === 'Onion URL'
    )
    expect(onion).toHaveLength(1)
    expect(onion[0].value).toBe('3g2upl4pq6kufc4m.onion')
  })

  it('should extract domain references from attributes', () => {
    const html = `
      <script src="https://cdn.example.com/script.js"></script>
      <img src="https://images.test.org/logo.png" />
      <form action="https://api.service.io/submit"></form>
    `
    const results = extractData(html)

    const domains = results.filter(
      (r) => r.category === 'Infrastructure' && r.subcategory === 'Domain Reference'
    )

    expect(domains.map((d) => d.value)).toContain('cdn.example.com')
    expect(domains.map((d) => d.value)).toContain('images.test.org')
    expect(domains.map((d) => d.value)).toContain('api.service.io')
  })

  it('should deduplicate extracted values', () => {
    const html = `
      <p>UA-123456-1</p>
      <p>UA-123456-1</p>
      <p>UA-123456-1</p>
    `
    const results = extractData(html)

    const gaCodes = results.filter(
      (r) => r.category === 'Tracking Code' && r.subcategory === 'Google Analytics'
    )
    expect(gaCodes).toHaveLength(1)
    expect(gaCodes[0].value).toBe('UA-123456-1')
  })

  it('should filter out localhost and private IPs', () => {
    const html = `
      <p>127.0.0.1</p>
      <p>10.0.0.1</p>
      <p>172.16.0.1</p>
      <p>169.254.0.1</p>
    `
    const results = extractData(html)

    const ips = results.filter(
      (r) => r.category === 'Infrastructure' && r.subcategory === 'IPv4 Address'
    )
    expect(ips).toHaveLength(0)
  })

  it('should filter out common false positive email addresses', () => {
    const html = `
      <p>noreply@example.com</p>
      <p>test@test.com</p>
      <p>user@localhost</p>
      <p>real@company.com</p>
    `
    const results = extractData(html)

    const emails = results.filter(
      (r) => r.category === 'Infrastructure' && r.subcategory === 'Email Address'
    )

    // Should only extract real@company.com
    expect(emails.map((e) => e.value)).not.toContain('noreply@example.com')
    expect(emails.map((e) => e.value)).not.toContain('test@test.com')
    expect(emails.map((e) => e.value)).not.toContain('user@localhost')
    expect(emails.map((e) => e.value)).toContain('real@company.com')
  })
})
