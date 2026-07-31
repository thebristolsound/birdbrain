import { extractIOC } from 'ioc-extractor'
import type { ExtractedDatum } from '@main/services/dataExtractor'

const FIELD_MAPPINGS: Array<{
  field: keyof ReturnType<typeof extractIOC>
  category: string
  subcategory: string
}> = [
  { field: 'ipv4s', category: 'Infrastructure', subcategory: 'IPv4 Address' },
  { field: 'ipv6s', category: 'Infrastructure', subcategory: 'IPv6 Address' },
  { field: 'emails', category: 'Infrastructure', subcategory: 'Email Address' },
  { field: 'domains', category: 'Infrastructure', subcategory: 'Domain Reference' },
  { field: 'md5s', category: 'Infrastructure', subcategory: 'MD5 Hash' },
  { field: 'sha1s', category: 'Infrastructure', subcategory: 'SHA1 Hash' },
  { field: 'sha256s', category: 'Infrastructure', subcategory: 'SHA256 Hash' },
  { field: 'sha512s', category: 'Infrastructure', subcategory: 'SHA512 Hash' },
  { field: 'macAddresses', category: 'Infrastructure', subcategory: 'MAC Address' },
  { field: 'asns', category: 'Infrastructure', subcategory: 'ASN' },
  { field: 'cves', category: 'Vulnerability', subcategory: 'CVE' },
  { field: 'btcs', category: 'Cryptocurrency', subcategory: 'Bitcoin Address' },
  { field: 'eths', category: 'Cryptocurrency', subcategory: 'Ethereum Address' },
  { field: 'xmrs', category: 'Cryptocurrency', subcategory: 'Monero Address' },
  { field: 'gaTrackIDs', category: 'Tracking Code', subcategory: 'Google Analytics' },
  { field: 'gaPubIDs', category: 'Tracking Code', subcategory: 'Google AdSense' }
]

export function extractIocs(text: string): ExtractedDatum[] {
  if (!text) return []

  const ioc = extractIOC(text, { strict: true, refang: true })
  const results: ExtractedDatum[] = []

  for (const { field, category, subcategory } of FIELD_MAPPINGS) {
    for (const value of ioc[field]) {
      results.push({ category, subcategory, value })
    }
  }

  return results
}
