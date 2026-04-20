import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { extractHtmlFromMhtml } from '@main/services/mhtmlDecoder'
import { extractData } from '@main/services/dataExtractor'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadFixture(name: string): Buffer {
  return readFileSync(resolve(__dirname, 'fixtures', name))
}

/** Returns true if the given IPv4 string falls in any private/reserved range. */
function isPrivateOrReservedIpv4(ip: string): boolean {
  const parts = ip.split('.')
  if (parts.length !== 4) return false
  const [a, b, c] = parts.map(Number)

  if (a === 0) return true // 0.0.0.0/8
  if (a === 10) return true // 10.0.0.0/8 — RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true // 100.64.0.0/10 — CGNAT
  if (a === 127) return true // 127.0.0.0/8 — loopback
  if (a === 169 && b === 254) return true // 169.254.0.0/16 — link-local
  if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12 — RFC1918
  if (a === 192 && b === 0 && c === 2) return true // 192.0.2.0/24 — TEST-NET-1
  if (a === 192 && b === 168) return true // 192.168.0.0/16 — RFC1918
  if (a === 198 && b === 51 && c === 100) return true // 198.51.100.0/24 — TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true // 203.0.113.0/24 — TEST-NET-3
  if (a >= 224 && a <= 239) return true // 224.0.0.0/4 — multicast
  if (a >= 240) return true // 240.0.0.0/4 — reserved
  return false
}

/** SVG path coordinate false-positive patterns from the bug report. */
const SVG_PATH_FPS = ['10.94.75.75', '1.12.33.7', '2.94.75.75']

// ---------------------------------------------------------------------------
// Fixture: cnn-pope-synthetic.mhtml
// ---------------------------------------------------------------------------

describe('regression: cnn-pope-synthetic.mhtml', () => {
  const buf = loadFixture('cnn-pope-synthetic.mhtml')
  const html = extractHtmlFromMhtml(buf)
  const results = extractData(html)

  it('decodes the MHTML fixture to non-empty HTML', () => {
    expect(html.length).toBeGreaterThan(0)
  })

  it('extracts at least one indicator', () => {
    expect(results.length).toBeGreaterThan(0)
  })

  it('contains no @mhtml.blink emails (CID Content-Location FP)', () => {
    const mhtmlEmails = results.filter(
      (d) => d.subcategory === 'Email Address' && d.value.endsWith('@mhtml.blink')
    )
    expect(mhtmlEmails).toHaveLength(0)
  })

  it('contains no RFC1918 / reserved IPv4 addresses', () => {
    const privateIps = results.filter(
      (d) => d.subcategory === 'IPv4 Address' && isPrivateOrReservedIpv4(d.value)
    )
    expect(privateIps).toHaveLength(0)
  })

  it('contains no SVG path coordinate false positives as IPv4', () => {
    const svgFps = results.filter(
      (d) => d.subcategory === 'IPv4 Address' && SVG_PATH_FPS.includes(d.value)
    )
    expect(svgFps).toHaveLength(0)
  })

  it('extracts 8.8.8.8 as a public IPv4 indicator', () => {
    const has888 = results.some((d) => d.subcategory === 'IPv4 Address' && d.value === '8.8.8.8')
    expect(has888).toBe(true)
  })

  it('extracts CVE-2024-1234 as a CVE indicator', () => {
    const hasCve = results.some((d) => d.value === 'CVE-2024-1234')
    expect(hasCve).toBe(true)
  })

  it('extracts www.cnn.com as a Domain Reference', () => {
    const hasDomain = results.some(
      (d) => d.subcategory === 'Domain Reference' && d.value === 'www.cnn.com'
    )
    expect(hasDomain).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Fixture: cnn-iran-synthetic.mhtml
// ---------------------------------------------------------------------------

describe('regression: cnn-iran-synthetic.mhtml', () => {
  const buf = loadFixture('cnn-iran-synthetic.mhtml')
  const html = extractHtmlFromMhtml(buf)
  const results = extractData(html)

  it('decodes the MHTML fixture to non-empty HTML', () => {
    expect(html.length).toBeGreaterThan(0)
  })

  it('extracts at least one indicator', () => {
    expect(results.length).toBeGreaterThan(0)
  })

  it('contains no @mhtml.blink emails (CID Content-Location FP)', () => {
    const mhtmlEmails = results.filter(
      (d) => d.subcategory === 'Email Address' && d.value.endsWith('@mhtml.blink')
    )
    expect(mhtmlEmails).toHaveLength(0)
  })

  it('contains no RFC1918 / reserved IPv4 addresses (192.168.1.100 must not appear)', () => {
    const privateIps = results.filter(
      (d) => d.subcategory === 'IPv4 Address' && isPrivateOrReservedIpv4(d.value)
    )
    expect(privateIps).toHaveLength(0)
  })

  it('does not extract 192.168.1.100 (RFC1918 private address in body)', () => {
    const found = results.some(
      (d) => d.subcategory === 'IPv4 Address' && d.value === '192.168.1.100'
    )
    expect(found).toBe(false)
  })

  it('contains no SVG path coordinate false positives as IPv4', () => {
    const svgFps = results.filter(
      (d) => d.subcategory === 'IPv4 Address' && SVG_PATH_FPS.includes(d.value)
    )
    expect(svgFps).toHaveLength(0)
  })

  it('extracts 1.1.1.1 as a public IPv4 indicator', () => {
    const has111 = results.some((d) => d.subcategory === 'IPv4 Address' && d.value === '1.1.1.1')
    expect(has111).toBe(true)
  })

  it('extracts www.cnn.com as a Domain Reference', () => {
    const hasDomain = results.some(
      (d) => d.subcategory === 'Domain Reference' && d.value === 'www.cnn.com'
    )
    expect(hasDomain).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Explicit regression guard: no @mhtml.blink Email Address in either fixture
// ---------------------------------------------------------------------------

describe('regression guard: @mhtml.blink emails never extracted', () => {
  const fixtures = ['cnn-pope-synthetic.mhtml', 'cnn-iran-synthetic.mhtml']

  for (const fixtureName of fixtures) {
    it(`${fixtureName}: extractData returns zero Email Address entries ending in @mhtml.blink`, () => {
      const buf = loadFixture(fixtureName)
      const html = extractHtmlFromMhtml(buf)
      const results = extractData(html)
      const leaking = results.filter(
        (d) => d.subcategory === 'Email Address' && d.value.endsWith('@mhtml.blink')
      )
      expect(leaking).toHaveLength(0)
    })
  }
})
