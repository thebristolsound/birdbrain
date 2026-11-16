import { readWarc } from '../../src/packages/transaction-record/warcReader'

const BLOCK = '\r\n\r\n'

// Each record of a Transaction Record as text, with the two values that differ between two writes
// of the same exchanges replaced in its WARC headers: every record's random id and the `warcinfo`
// date, which is the moment of Capture. The block under the headers is left as written, so every
// other header and every text body the writer wrote is in the text. The gzip framing is not
// compared, and a body that is not UTF-8 would not be told apart byte for byte.
export function recordTexts(warcGz: Uint8Array): string[] {
  return readWarc(warcGz).map(({ inflated, warc }) => {
    const text = inflated.toString('utf8')
    const end = text.indexOf(BLOCK)
    const headers = text.slice(0, end).replace(/urn:uuid:[0-9a-f-]{36}/g, 'urn:uuid:ID')
    return (
      (warc('WARC-Type') === 'warcinfo'
        ? headers.replace(/^WARC-Date: .*$/m, 'WARC-Date: DATE')
        : headers) + text.slice(end)
    )
  })
}
