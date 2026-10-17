import { resolve } from 'path'
import type { ExtractedDatum } from '@main/services/dataExtractor'

// The rows the extraction pipeline produced for each fixture on the main
// process, before extraction moved into the utility process (#598): computed
// with extractData(extractHtmlFromMhtml(fixture)) at commit 3d9ef9a9.
export const FIXTURE_KNOWN_ANSWERS: Record<string, string[]> = {
  'cnn-pope-synthetic.mhtml': [
    'Infrastructure|Domain Reference|cnn.com',
    'Infrastructure|Domain Reference|www.cnn.com',
    'Infrastructure|Email Address|newsroom@cnn.com',
    'Infrastructure|IPv4 Address|8.8.8.8',
    'Infrastructure|MD5 Hash|d41d8cd98f00b204e9800998ecf8427e',
    'Vulnerability|CVE|CVE-2024-1234'
  ],
  'cnn-iran-synthetic.mhtml': [
    'Infrastructure|Domain Reference|cnn.com',
    'Infrastructure|Domain Reference|www.cnn.com',
    'Infrastructure|Email Address|cyberdesk@cnn.com',
    'Infrastructure|IPv4 Address|1.1.1.1'
  ]
}

export const FIXTURE_DIR = resolve(__dirname, '../main/services/extraction/fixtures')

export function rowKeys(
  rows: Pick<ExtractedDatum, 'category' | 'subcategory' | 'value'>[]
): string[] {
  return rows
    .map(({ category, subcategory, value }) => `${category}|${subcategory}|${value}`)
    .sort()
}
